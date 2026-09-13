-- Parent notification system: every parent hears, in real time, what the kids and the
-- other parents just did. Three pieces:
--   1. parent_devices — APNs tokens for parent installs (kid tokens stay in devices).
--   2. family_events  — the durable feed (Insights → "Family activity"), realtime-published.
--   3. private.notify_parents(...) — logs the event, then pushes to every parent in the
--      family EXCEPT the one who caused it (auth.uid()), honouring per-parent prefs.
-- Hooks are triggers on the tables the app already writes (no RPC rewrites), grouped
-- into five categories a parent can mute in Settings → Notifications:
--   approvals  proof submitted / auto-approved / all done / reward or quest requests
--   requests   lock-screen asks ("Ask for 15", "doing it now"), summons acknowledged
--   coparent   what another parent did (approve/reject, ground, unlock, bedtime, calls)
--   critical   critical-task fires, escalations, completions
--   lists      "We need" additions
--
-- Also in this migration (bedtime/shield field-test fixes, 2026-09-12):
--   * set_bedtime rejects windows under 15 minutes server-side (a 23:00–23:01 test window
--     got through the client guard tonight; DeviceActivity can't schedule it).
--   * kid_shield() now also carries `bedtimeSuppressed` + `after` so the push-driven
--     native path keeps the monitor extension's bedtime hand-off state fresh even when
--     the web view never runs (grounding lifted by push while the app slept).
--   * kid_lock_state logic moved into kid_lock_state_of(k, ignore_bedtime) so the "after
--     bedtime" state can be computed server-side; the view is unchanged for consumers.

-- ---------------------------------------------------------------- devices + prefs
create table if not exists parent_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  identifier text not null,
  push_token text,
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, identifier)
);
alter table parent_devices enable row level security;
create policy own_parent_devices on parent_devices for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- {"approvals":true,"requests":true,"coparent":true,"critical":true,"lists":true}; a
-- missing key means on.
alter table parents add column if not exists notify_prefs jsonb not null default '{}'::jsonb;

create or replace function set_notify_prefs(p_prefs jsonb) returns void
language sql security definer set search_path = public as $$
  update parents set notify_prefs = coalesce(p_prefs, '{}'::jsonb) where user_id = auth.uid();
$$;

-- Same view, plus each parent's prefs (so the Settings toggles can show your own).
create or replace view family_parents as
  select p.user_id, p.family_id, p.display_name, u.email, p.notify_prefs
  from parents p join auth.users u on u.id = p.user_id
  where p.family_id = my_family_id();

-- ---------------------------------------------------------------- feed
create table if not exists family_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  kid_id uuid references kids(id) on delete set null,
  actor uuid,                 -- parent user id who caused it; null = a kid or the system
  kind text not null,         -- approvals | requests | coparent | critical | lists
  emoji text,
  title text not null,
  body text,
  route text,                 -- parent-app route to open from the push
  created_at timestamptz not null default now()
);
create index if not exists family_events_family_idx on family_events (family_id, created_at desc);
alter table family_events enable row level security;
create policy parent_read_events on family_events for select using (family_id = my_family_id());
alter publication supabase_realtime add table family_events;

-- Never null: a missing/unknown uid reads "A parent" so titles never violate not-null.
create or replace function private.parent_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(p.display_name, split_part(u.email, '@', 1))
    from parents p join auth.users u on u.id = p.user_id where p.user_id = p_user), 'A parent');
$$;

-- Log + push. The caller's auth.uid() is the actor when it is a parent of this family;
-- they never get their own notification. Kids and cron have no parent uid → everyone.
create or replace function private.notify_parents(
  p_family uuid, p_kind text, p_title text, p_body text default null,
  p_kid uuid default null, p_route text default '/parent', p_emoji text default null, p_urgent boolean default false
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_url text; v_key text; v_actor uuid; ids uuid[];
begin
  select user_id into v_actor from parents where user_id = auth.uid() and family_id = p_family;
  insert into family_events (family_id, kid_id, actor, kind, emoji, title, body, route)
  values (p_family, p_kid, v_actor, p_kind, p_emoji, p_title, p_body, p_route);
  delete from family_events where family_id = p_family and created_at < now() - interval '30 days';

  select array_agg(p.user_id) into ids from parents p
  where p.family_id = p_family and p.user_id is distinct from v_actor
    and coalesce((p.notify_prefs ->> p_kind)::boolean, true);
  if ids is null then return; end if;

  select c.value into v_url from private.config c where c.key = 'functions_url';
  select c.value into v_key from private.config c where c.key = 'service_role_key';
  if v_url is null or v_key is null then return; end if;
  perform net.http_post(
    url := v_url || '/notify-kid',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('parent_ids', to_jsonb(ids), 'kind', 'parent', 'category', p_kind,
      'chore', coalesce(p_emoji || ' ', '') || p_title, 'reason', p_body, 'route', p_route, 'urgent', p_urgent)
  );
exception when others then
  -- A notification must never roll back the write that caused it.
  raise warning '[notify_parents] % — %', p_title, sqlerrm;
end $$;

-- ---------------------------------------------------------------- hooks
-- Chores: submitted (needs review) / auto-approved / co-parent reviewed / all done today.
create or replace function private.on_instance_parent_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare kname text; fid uuid; cname text; creq boolean; auto boolean; remaining int;
begin
  if new.status is not distinct from old.status then return null; end if;
  select k.name, k.family_id into kname, fid from kids k where k.id = new.kid_id;
  select c.name, c.required into cname, creq from chores c where c.id = new.chore_id;
  if new.status = 'submitted' then
    select f.auto_approve into auto from families f where f.id = fid;
    -- First attempts under auto-approve flip to approved in the same statement; that
    -- branch announces it instead.
    if not coalesce(auto, false) or new.attempt > 1 then
      perform private.notify_parents(fid, 'approvals', kname || ' submitted ' || cname, 'Tap to review the proof.', new.kid_id, '/parent/approvals', '📸');
    end if;
  elsif new.status = 'approved' then
    if new.reviewed_by is null then
      perform private.notify_parents(fid, 'approvals', kname || ' did ' || cname, 'Auto-approved.', new.kid_id, '/parent', '✅');
    else
      perform private.notify_parents(fid, 'coparent', private.parent_name(new.reviewed_by) || ' approved ' || kname || '’s ' || cname, null, new.kid_id, '/parent', '✅');
    end if;
    if coalesce(creq, false) then
      select count(*) into remaining from chore_instances ci join chores c on c.id = ci.chore_id
      where ci.kid_id = new.kid_id and ci.date = new.date and c.required and ci.status <> 'approved' and not ci.rolled;
      if remaining = 0 then
        perform private.notify_parents(fid, 'approvals', kname || ' is all done for today', 'Every required chore is approved.', new.kid_id, '/parent', '🎉');
      end if;
    end if;
  elsif new.status = 'rejected' then
    perform private.notify_parents(fid, 'coparent', private.parent_name(new.reviewed_by) || ' sent back ' || kname || '’s ' || cname, new.rejection_reason, new.kid_id, '/parent/approvals', '↩️');
  elsif new.status = 'todo' and old.status = 'approved' then
    perform private.notify_parents(fid, 'coparent', private.parent_name(auth.uid()) || ' reopened ' || kname || '’s ' || cname, null, new.kid_id, '/parent', '↩️');
  end if;
  return null;
end $$;
drop trigger if exists trg_instance_parent_notify on chore_instances;
create trigger trg_instance_parent_notify after update on chore_instances
  for each row execute function private.on_instance_parent_notify();

-- Side quests: submitted / reviewed.
create or replace function private.on_quest_parent_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare kname text;
begin
  if new.status is not distinct from old.status then return null; end if;
  select name into kname from kids where id = new.kid_id;
  if new.status = 'submitted' then
    perform private.notify_parents(new.family_id, 'approvals', coalesce(kname, 'A kid') || ' finished the quest “' || new.title || '”', 'Tap to review.', new.kid_id, '/parent/approvals', '⭐');
  elsif new.status = 'approved' and new.reviewed_by is not null then
    perform private.notify_parents(new.family_id, 'coparent', private.parent_name(new.reviewed_by) || ' approved the quest “' || new.title || '”' || coalesce(' (' || kname || ')', ''), null, new.kid_id, '/parent', '⭐');
  elsif new.status = 'rejected' and new.reviewed_by is not null then
    perform private.notify_parents(new.family_id, 'coparent', private.parent_name(new.reviewed_by) || ' sent back the quest “' || new.title || '”', new.rejection_reason, new.kid_id, '/parent/approvals', '↩️');
  end if;
  return null;
end $$;
drop trigger if exists trg_quest_parent_notify on side_quests;
create trigger trg_quest_parent_notify after update on side_quests
  for each row execute function private.on_quest_parent_notify();

-- Rewards: a kid cashes in / a parent decides.
create or replace function private.on_claim_parent_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare kname text; fid uuid; rtitle text; rpts int;
begin
  select k.name, k.family_id into kname, fid from kids k where k.id = new.kid_id;
  select title, points into rtitle, rpts from rewards where id = new.reward_id;
  if tg_op = 'INSERT' then
    perform private.notify_parents(fid, 'approvals', kname || ' wants to cash in: ' || rtitle, rpts || ' points. Tap to grant or deny.', new.kid_id, '/parent/approvals', '🎁');
  elsif new.status is distinct from old.status and new.status in ('granted', 'denied') and new.resolved_by is not null then
    perform private.notify_parents(fid, 'coparent', private.parent_name(new.resolved_by) || case when new.status = 'granted' then ' granted ' else ' denied ' end || kname || '’s reward: ' || rtitle, null, new.kid_id, '/parent', case when new.status = 'granted' then '🎁' else '🚫' end);
  end if;
  return null;
end $$;
drop trigger if exists trg_claim_parent_notify on reward_claims;
create trigger trg_claim_parent_notify after insert or update on reward_claims
  for each row execute function private.on_claim_parent_notify();

-- Lock-screen asks. Until now these only appeared as a Dashboard card.
create or replace function private.on_unlock_request_parent_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare kname text;
begin
  select name into kname from kids where id = new.kid_id;
  if tg_op = 'INSERT' then
    if new.kind = 'fifteen' then
      perform private.notify_parents(new.family_id, 'requests', kname || ' is asking for 15 minutes', 'From the lock screen. Tap to answer.', new.kid_id, '/parent', '🙏', true);
    else
      perform private.notify_parents(new.family_id, 'requests', kname || ' says they’re doing it now', 'Tapped on the critical-task lock screen.', new.kid_id, '/parent', '💪');
    end if;
  elsif new.status is distinct from old.status and new.status in ('granted', 'denied') and new.resolved_by is not null then
    perform private.notify_parents(new.family_id, 'coparent',
      private.parent_name(new.resolved_by) || case when new.status = 'granted' then ' gave ' || kname || ' 15 minutes' else ' told ' || kname || ' not now' end,
      null, new.kid_id, '/parent', case when new.status = 'granted' then '⏱️' else '🚫' end);
  end if;
  return null;
end $$;
drop trigger if exists trg_unlock_request_parent_notify on unlock_requests;
create trigger trg_unlock_request_parent_notify after insert or update on unlock_requests
  for each row execute function private.on_unlock_request_parent_notify();

-- Summons: a parent calls the kids (one event per call, not per kid) / a kid answers.
create or replace function private.on_summon_parent_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare kname text; n int; who text;
begin
  select name into kname from kids where id = new.kid_id;
  if tg_op = 'INSERT' then
    -- Rows of one call share created_at; only the smallest id announces, with the count.
    if new.id = (select min(id) from summons where family_id = new.family_id and created_at = new.created_at) then
      select count(*) into n from summons where family_id = new.family_id and created_at = new.created_at;
      who := case when n = 1 then kname else n || ' kids' end;
      perform private.notify_parents(new.family_id, 'coparent',
        private.parent_name(new.created_by) || case when new.meeting then ' called a family meeting — ' else ' called ' || who || ' to the ' end || new.location,
        new.note, case when n = 1 then new.kid_id else null end, '/parent', '📢');
    end if;
  elsif new.acknowledged_at is not null and old.acknowledged_at is null then
    perform private.notify_parents(new.family_id, 'requests', kname || ' is on the way', case when new.meeting then 'Family meeting' else 'To the ' || new.location end, new.kid_id, '/parent', '🏃');
  end if;
  return null;
end $$;
drop trigger if exists trg_summon_parent_notify on summons;
create trigger trg_summon_parent_notify after insert or update on summons
  for each row execute function private.on_summon_parent_notify();

-- Kid state changed by a parent (or expiry): grounding, manual lock/unlock, away, bedtime.
create or replace function private.on_kid_parent_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare tz text; who text := private.parent_name(auth.uid()); untl text;
begin
  select timezone into tz from families where id = new.family_id;
  if new.grounded_until is distinct from old.grounded_until then
    if new.grounded_until is not null and new.grounded_until > now() then
      untl := case when new.grounded_until > timestamptz '9999-01-01' then 'a parent lifts it'
        else to_char(new.grounded_until at time zone coalesce(tz, 'UTC'), 'Dy FMHH12:MI AM') end;
      perform private.notify_parents(new.family_id, 'coparent', coalesce(who, 'A parent') || ' grounded ' || new.name || ' until ' || untl, new.grounded_reason, new.id, '/parent', '⛔');
    elsif old.grounded_until is not null then
      if auth.uid() is null then
        perform private.notify_parents(new.family_id, 'coparent', new.name || '’s grounding ended', 'It ran out on its own.', new.id, '/parent', '🔓');
      else
        perform private.notify_parents(new.family_id, 'coparent', coalesce(who, 'A parent') || ' lifted ' || new.name || '’s grounding', null, new.id, '/parent', '🔓');
      end if;
    end if;
  end if;
  if new.override is distinct from old.override or new.override_date is distinct from old.override_date then
    if new.override = 'unlock' and new.override_date = family_today(new.family_id) then
      perform private.notify_parents(new.family_id, 'coparent', coalesce(who, 'A parent') || ' unlocked ' || new.name || ' for today', null, new.id, '/parent', '🔓');
    elsif new.override = 'lock' and new.override_date = family_today(new.family_id) then
      perform private.notify_parents(new.family_id, 'coparent', coalesce(who, 'A parent') || ' locked ' || new.name || ' for today', null, new.id, '/parent', '🔒');
    elsif new.override is null and old.override is not null and old.override_date = family_today(new.family_id) then
      perform private.notify_parents(new.family_id, 'coparent', coalesce(who, 'A parent') || ' put ' || new.name || ' back on chores', null, new.id, '/parent', '🔑');
    end if;
  end if;
  if new.absent_until is distinct from old.absent_until then
    if new.absent_until is not null and new.absent_until >= family_today(new.family_id) then
      perform private.notify_parents(new.family_id, 'coparent', coalesce(who, 'A parent') || ' marked ' || new.name || ' away until ' || to_char(new.absent_until, 'Dy Mon FMDD'), null, new.id, '/parent', '✈️');
    else
      perform private.notify_parents(new.family_id, 'coparent', coalesce(who, 'A parent') || ' marked ' || new.name || ' back home', null, new.id, '/parent', '🏠');
    end if;
  end if;
  if new.bed_off_date is distinct from old.bed_off_date then
    if new.bed_off_date is not null then
      perform private.notify_parents(new.family_id, 'coparent', coalesce(who, 'A parent') || ' let ' || new.name || ' stay up tonight', 'No bedtime lock this evening.', new.id, '/parent', '🌙');
    elsif auth.uid() is not null then
      perform private.notify_parents(new.family_id, 'coparent', coalesce(who, 'A parent') || ' put ' || new.name || '’s bedtime back on', null, new.id, '/parent', '🛏️');
    end if;
  elsif (new.bed_start, new.bed_end, new.bed_start_weekend, new.bed_end_weekend)
        is distinct from (old.bed_start, old.bed_end, old.bed_start_weekend, old.bed_end_weekend) then
    if new.bed_start is null then
      perform private.notify_parents(new.family_id, 'coparent', coalesce(who, 'A parent') || ' turned off ' || new.name || '’s bedtime', null, new.id, '/parent/settings', '🛏️');
    else
      perform private.notify_parents(new.family_id, 'coparent', coalesce(who, 'A parent') || ' set ' || new.name || '’s bedtime to ' || to_char(new.bed_start, 'FMHH12:MI AM') || ' – ' || to_char(new.bed_end, 'FMHH12:MI AM')
        || case when new.bed_start_weekend is not null then ' (Fri & Sat ' || to_char(new.bed_start_weekend, 'FMHH12:MI AM') || ' – ' || to_char(new.bed_end_weekend, 'FMHH12:MI AM') || ')' else '' end,
        null, new.id, '/parent/settings', '🛏️');
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_kid_parent_notify on kids;
create trigger trg_kid_parent_notify after update on kids
  for each row execute function private.on_kid_parent_notify();

-- Critical tasks: fired / escalated / done — from the engine's own row changes.
create or replace function private.on_critical_parent_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare kname text; late int;
begin
  select name into kname from kids where id = new.kid_id;
  if tg_op = 'INSERT' then
    if new.status = 'open' then
      perform private.notify_parents(new.family_id, 'critical', new.title || ' fired for ' || kname, 'They have been pinged. Escalation starts if it isn’t done.', new.kid_id, '/parent', '🚨');
    end if;
    return null;
  end if;
  if new.status = 'open' and old.status = 'scheduled' then
    perform private.notify_parents(new.family_id, 'critical', 'Follow-up due: ' || new.title, 'Assigned to ' || kname || '.', new.kid_id, '/parent', '⏰');
  end if;
  if new.level is distinct from old.level and new.status = 'open' then
    late := greatest(1, floor(extract(epoch from (now() - new.due_at)) / 60))::int;
    if new.level = 1 then
      perform private.notify_parents(new.family_id, 'critical', kname || '’s internet is off: ' || new.title, late || ' minutes late.', new.kid_id, '/parent', '🔒', true);
    elsif new.level = 2 then
      perform private.notify_parents(new.family_id, 'critical', new.title || ' went family-wide', kname || ' hasn’t done it (' || late || ' min). The other kids were asked.', new.kid_id, '/parent', '📣', true);
    elsif new.level = 3 then
      perform private.notify_parents(new.family_id, 'critical', 'Everyone is locked until ' || new.title || ' is done', late || ' minutes late.', new.kid_id, '/parent', '🚫', true);
    end if;
  end if;
  if new.status = 'done' and old.status is distinct from 'done' then
    if new.done_by is not null then
      select name into kname from kids where id = new.done_by;
      perform private.notify_parents(new.family_id, 'critical', kname || ' handled ' || new.title, null, new.done_by, '/parent', '✅');
    else
      perform private.notify_parents(new.family_id, 'coparent', private.parent_name(auth.uid()) || ' marked ' || new.title || ' done', null, new.kid_id, '/parent', '✅');
    end if;
  elsif new.status = 'canceled' and old.status is distinct from 'canceled' then
    perform private.notify_parents(new.family_id, 'coparent', private.parent_name(auth.uid()) || ' canceled ' || new.title, null, new.kid_id, '/parent', '🚫');
  end if;
  return null;
end $$;
drop trigger if exists trg_critical_parent_notify on critical_instances;
create trigger trg_critical_parent_notify after insert or update on critical_instances
  for each row execute function private.on_critical_parent_notify();

-- "We need" list.
create or replace function private.on_list_item_parent_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare kname text;
begin
  if new.added_by_kid is not null then
    select name into kname from kids where id = new.added_by_kid;
    perform private.notify_parents(new.family_id, 'lists', kname || ' added “' || new.text || '” to We need', null, new.added_by_kid, '/parent', '🛒');
  else
    perform private.notify_parents(new.family_id, 'lists', private.parent_name(new.added_by_parent) || ' added “' || new.text || '” to We need', null, null, '/parent', '🛒');
  end if;
  return null;
end $$;
drop trigger if exists trg_list_item_parent_notify on list_items;
create trigger trg_list_item_parent_notify after insert on list_items
  for each row execute function private.on_list_item_parent_notify();

-- ---------------------------------------------------------------- bedtime guard
create or replace function set_bedtime(p_kid uuid, p_start time, p_end time, p_start_weekend time default null, p_end_weekend time default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select family_id from kids where id = p_kid) is distinct from my_family_id() then raise exception 'not allowed'; end if;
  -- DeviceActivity refuses windows under 15 minutes; a 1-minute test window would lock via
  -- push and never register natively.
  if p_start is not null and (p_end is null
     or ((extract(epoch from p_end) - extract(epoch from p_start))::int / 60 + 1440) % 1440 < 15) then
    raise exception 'bedtime window must be at least 15 minutes';
  end if;
  if p_start is not null and p_start_weekend is not null and p_end_weekend is not null
     and ((extract(epoch from p_end_weekend) - extract(epoch from p_start_weekend))::int / 60 + 1440) % 1440 < 15 then
    raise exception 'weekend bedtime window must be at least 15 minutes';
  end if;
  update kids set
    bed_start = p_start,
    bed_end = case when p_start is null then null else p_end end,
    bed_start_weekend = case when p_start is null or p_start_weekend is null or p_end_weekend is null then null else p_start_weekend end,
    bed_end_weekend   = case when p_start is null or p_start_weekend is null or p_end_weekend is null then null else p_end_weekend end,
    bed_off_date = case when p_start is null then null else bed_off_date end
  where id = p_kid;
end $$;

-- ---------------------------------------------------------------- lock state as a function
-- Same ladder as the view (grounded > away > critical > pass > bedtime > override > chores);
-- p_ignore_bedtime = the state to fall back to when tonight's window closes.
create or replace function kid_lock_state_of(k kids, p_ignore_bedtime boolean default false) returns text
language sql stable set search_path = public as $$
  select case
    when k.grounded_until is not null and k.grounded_until > now() then 'locked'
    when k.absent_until is not null and k.absent_until >= family_today(k.family_id) then 'unlocked'
    when exists (
      select 1 from critical_instances ci join critical_tasks ct on ct.id = ci.task_id
      where ci.status = 'open' and ci.kid_id = k.id and now() >= ci.due_at + make_interval(mins => ct.lock_after_min)
    ) then 'locked'
    when exists (
      select 1 from critical_instances ci join critical_tasks ct on ct.id = ci.task_id
      where ci.status = 'open' and ci.family_id = k.family_id and now() >= ci.due_at + make_interval(mins => ct.lock_all_after_min)
    ) then 'locked'
    when k.unlock_until is not null and k.unlock_until > now() then 'unlocked'
    when not p_ignore_bedtime and bedtime_evening(k) is not null then 'locked'
    when k.override = 'unlock' and k.override_date = family_today(k.family_id) then 'unlocked'
    when k.override = 'lock'   and k.override_date = family_today(k.family_id) then 'locked'
    when not exists (
      select 1 from chore_instances ci join chores c on c.id = ci.chore_id join families f on f.id = k.family_id
      where ci.kid_id = k.id and ci.date = family_today(k.family_id) and c.required and ci.status <> 'approved' and not ci.rolled
        and (coalesce(ci.due_override, c.due_time) is null or (now() at time zone f.timezone)::time >= coalesce(ci.due_override, c.due_time))
        and not (c.overdue = 'expire' and coalesce(ci.due_override, c.due_time) is not null and (now() at time zone f.timezone)::time >= coalesce(ci.due_override, c.due_time))
    ) then 'unlocked'
    else 'locked'
  end
$$;

create or replace view kid_lock_state as
  select k.id as kid_id, k.family_id, kid_lock_state_of(k, false) as state from kids k;

-- ---------------------------------------------------------------- kid_shield + bedtime hand-off
-- Adds `bedtimeSuppressed` (a grounding/critical lock owns the copy, so the bedtime
-- start must not repaint it) and `after` (what to restore when the window closes),
-- mirroring the extras the app sends via setShield. PushLock writes both to the app group.
create or replace function kid_shield(p_kid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  k kids; f families; st text;
  v_state text; v_title text; v_sub text; v_allow boolean := true;
  c_title text; c_sub text; c_allow boolean;
  crit record; remaining int; nxt text; ev date; we time; suppressed boolean := false;
begin
  select * into k from kids where id = p_kid;
  if not found then return null; end if;
  select * into f from families where id = k.family_id;
  st := kid_lock_state_of(k, false);

  -- "Ask for 15 minutes" is hidden for an hour after a parent says no.
  c_allow := not exists (
    select 1 from unlock_requests r
    where r.kid_id = p_kid and r.kind = 'fifteen' and r.status = 'denied'
      and r.resolved_at is not null and r.resolved_at > now() - interval '1 hour');
  -- Chores copy: the default, and the state bedtime hands back to.
  select count(*), min(c.name) filter (where ci.status in ('todo', 'rejected')) into remaining, nxt
  from chore_instances ci join chores c on c.id = ci.chore_id
  where ci.kid_id = p_kid and ci.date = family_today(k.family_id) and c.required and ci.status <> 'approved' and not ci.rolled;
  c_title := greatest(remaining, 1) || ' to go, ' || k.name || ' 🔑';
  c_sub := 'Next up: ' || left(coalesce(nxt, 'your chores'), 34) || '.';

  if k.grounded_until is not null and k.grounded_until > now() then
    v_state := 'grounded'; suppressed := true;
    v_title := 'Grounded until ' || case when k.grounded_until > timestamptz '9999-01-01' then 'a parent lifts it'
      else to_char(k.grounded_until at time zone coalesce(f.timezone, 'UTC'), 'Dy FMHH12:MI AM') end;
    v_sub := case when k.grounded_reason is not null and k.grounded_reason <> ''
      then 'Reason: ' || left(k.grounded_reason, 34) || '. Only a parent can lift this early.'
      else 'Only a parent can lift this early.' end;
    v_allow := false;
  else
    select ci.title, ct.emoji, floor(extract(epoch from (now() - ci.due_at)) / 60)::int as late into crit
    from critical_instances ci join critical_tasks ct on ct.id = ci.task_id
    where ci.status = 'open' and ci.family_id = k.family_id
      and ((ci.kid_id = p_kid and now() >= ci.due_at + make_interval(mins => ct.lock_after_min))
        or now() >= ci.due_at + make_interval(mins => ct.lock_all_after_min))
    order by ci.due_at limit 1;
    if crit.title is not null then
      v_state := 'critical'; suppressed := true;
      v_title := crit.emoji || ' ' || crit.title;
      v_sub := greatest(1, crit.late) || ' minutes late. Nothing unlocks until this one’s done.';
      v_allow := false;
    else
      ev := bedtime_evening(k);
      if ev is not null then
        select w.w_end into we from bedtime_window(k, ev) w;
        v_state := 'bedtime';
        v_title := 'Goodnight, ' || k.name || ' 🌙';
        v_sub := 'Screens are back at ' || to_char(we, 'FMHH12:MI AM') || '.';
        v_allow := c_allow;
      else
        v_state := 'chores'; v_title := c_title; v_sub := c_sub; v_allow := c_allow;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'state', coalesce(st, 'locked'),
    'shield', jsonb_build_object('state', v_state, 'title', v_title, 'subtitle', v_sub, 'allowRequest', v_allow),
    'bedtimeSuppressed', suppressed,
    'after', jsonb_build_object('enabled', kid_lock_state_of(k, true) = 'locked',
      'state', 'chores', 'title', c_title, 'subtitle', c_sub, 'allowRequest', c_allow));
end $$;
