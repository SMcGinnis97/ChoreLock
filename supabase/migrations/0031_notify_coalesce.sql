-- Field test 2026-09-13: adjusting a bedtime with the time picker committed several times
-- while the wheel was spinning, and the co-parent got five "set Dawson's bedtime" pushes.
-- notify_parents gains p_coalesce: when a recent event (3 minutes) carries the same key,
-- the feed line is updated in place with the latest wording and no new push goes out.
-- Used for bedtime window edits and stay-up toggles; other events are unchanged.

alter table family_events add column if not exists coalesce_key text;
create index if not exists family_events_coalesce_idx on family_events (family_id, coalesce_key, created_at desc) where coalesce_key is not null;

-- Same name with an extra defaulted argument would be a second overload and make every
-- existing call ambiguous; replace the function outright.
drop function if exists private.notify_parents(uuid, text, text, text, uuid, text, text, boolean);

create or replace function private.notify_parents(
  p_family uuid, p_kind text, p_title text, p_body text default null,
  p_kid uuid default null, p_route text default '/parent', p_emoji text default null, p_urgent boolean default false,
  p_coalesce text default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_url text; v_key text; v_actor uuid; ids uuid[]; prev uuid;
begin
  select user_id into v_actor from parents where user_id = auth.uid() and family_id = p_family;

  if p_coalesce is not null then
    select id into prev from family_events
    where family_id = p_family and coalesce_key = p_coalesce and created_at > now() - interval '3 minutes'
    order by created_at desc limit 1;
    if prev is not null then
      -- Same change still being dialled in: refresh the feed line, don't push again.
      update family_events set title = p_title, body = p_body, emoji = p_emoji, actor = v_actor, created_at = now() where id = prev;
      return;
    end if;
  end if;

  insert into family_events (family_id, kid_id, actor, kind, emoji, title, body, route, coalesce_key)
  values (p_family, p_kid, v_actor, p_kind, p_emoji, p_title, p_body, p_route, p_coalesce);
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
  raise warning '[notify_parents] % — %', p_title, sqlerrm;
end $$;

-- Bedtime edits and stay-up toggles coalesce per kid.
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
      perform private.notify_parents(new.family_id, 'coparent', coalesce(who, 'A parent') || ' let ' || new.name || ' stay up tonight', 'No bedtime lock this evening.', new.id, '/parent', '🌙', false, 'bedskip:' || new.id);
    elsif auth.uid() is not null then
      perform private.notify_parents(new.family_id, 'coparent', coalesce(who, 'A parent') || ' put ' || new.name || '’s bedtime back on', null, new.id, '/parent', '🛏️', false, 'bedskip:' || new.id);
    end if;
  elsif (new.bed_start, new.bed_end, new.bed_start_weekend, new.bed_end_weekend)
        is distinct from (old.bed_start, old.bed_end, old.bed_start_weekend, old.bed_end_weekend) then
    if new.bed_start is null then
      perform private.notify_parents(new.family_id, 'coparent', coalesce(who, 'A parent') || ' turned off ' || new.name || '’s bedtime', null, new.id, '/parent/settings', '🛏️', false, 'bedtime:' || new.id);
    else
      perform private.notify_parents(new.family_id, 'coparent', coalesce(who, 'A parent') || ' set ' || new.name || '’s bedtime to ' || to_char(new.bed_start, 'FMHH12:MI AM') || ' – ' || to_char(new.bed_end, 'FMHH12:MI AM')
        || case when new.bed_start_weekend is not null then ' (Fri & Sat ' || to_char(new.bed_start_weekend, 'FMHH12:MI AM') || ' – ' || to_char(new.bed_end_weekend, 'FMHH12:MI AM') || ')' else '' end,
        null, new.id, '/parent/settings', '🛏️', false, 'bedtime:' || new.id);
    end if;
  end if;
  return null;
end $$;
