-- Critical tasks: recurring must-do jobs ("Take the dogs out" every 2 hours) with an
-- escalation ladder. All enforcement flows through kid_lock_state, so the Screen Time
-- shield and the router agent pick it up with no changes:
--   fire            -> push to the assigned kid
--   +lock_after     -> that kid's internet locks (view clause), warning push
--   +broadcast      -> the task goes out to every kid ("anyone can do it")
--   +lock_all       -> every present kid locks (absent kids stay exempt), alert push
-- Completion lifts the locks, schedules an optional follow-up ("Bring the dogs back in",
-- same ladder), and books the next round (done + repeat_minutes, clamped to the window).
-- Escalation state is COMPUTED from due_at in the view (survives restarts); the level
-- column only tracks which pushes were already sent.

create table critical_tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  kid_id uuid not null references kids(id) on delete cascade,   -- primary assignee
  title text not null,
  emoji text not null default '🚨',
  note text,
  first_fire time not null,                 -- daily anchor (family-local), e.g. 14:00
  repeat_minutes int check (repeat_minutes is null or repeat_minutes >= 15), -- null = once a day
  window_end time,                          -- no fires after this local time (null = all day)
  lock_after_min int not null default 5,
  broadcast_after_min int not null default 15,
  lock_all_after_min int not null default 30,
  followup_title text,                      -- e.g. "Bring the dogs back in"
  followup_delay_min int not null default 15,
  active boolean not null default true,
  next_fire_at timestamptz,                 -- engine state; null while an instance is open
  created_at timestamptz not null default now()
);
alter table critical_tasks enable row level security;
create policy parent_critical_tasks on critical_tasks for all
  using (family_id = my_family_id()) with check (family_id = my_family_id());
create policy kid_read_critical_tasks on critical_tasks for select
  using (family_id = kid_family_id(my_kid_id()));

create table critical_instances (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references critical_tasks(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  kid_id uuid not null references kids(id) on delete cascade,
  kind text not null default 'main' check (kind in ('main', 'followup')),
  title text not null,
  due_at timestamptz not null,              -- fire moment; the escalation clock
  status text not null default 'open' check (status in ('scheduled', 'open', 'done', 'canceled')),
  level int not null default 0,             -- highest escalation already pushed (0..3)
  done_at timestamptz,
  done_by uuid references kids(id),         -- null when a parent marked it done
  created_at timestamptz not null default now()
);
alter table critical_instances enable row level security;
create policy parent_critical_instances on critical_instances for all
  using (family_id = my_family_id()) with check (family_id = my_family_id());
create policy kid_read_critical_instances on critical_instances for select
  using (family_id = kid_family_id(my_kid_id()));

alter publication supabase_realtime add table critical_instances;
alter publication supabase_realtime add table critical_tasks;

-- ---------- lock state: critical escalation slots under grounding/absence ----------
-- Absent kids stay exempt from the lock-all step ("each child present").
create or replace view kid_lock_state as
select k.id as kid_id, k.family_id,
  case
    when k.grounded_until is not null and k.grounded_until > now() then 'locked'
    when k.absent_until is not null and k.absent_until >= family_today(k.family_id) then 'unlocked'
    when exists (
      select 1 from critical_instances ci join critical_tasks ct on ct.id = ci.task_id
      where ci.status = 'open' and ci.kid_id = k.id
        and now() >= ci.due_at + make_interval(mins => ct.lock_after_min)
    ) then 'locked'
    when exists (
      select 1 from critical_instances ci join critical_tasks ct on ct.id = ci.task_id
      where ci.status = 'open' and ci.family_id = k.family_id
        and now() >= ci.due_at + make_interval(mins => ct.lock_all_after_min)
    ) then 'locked'
    when k.override = 'unlock' and k.override_date = family_today(k.family_id) then 'unlocked'
    when k.override = 'lock'   and k.override_date = family_today(k.family_id) then 'locked'
    when not exists (
      select 1 from chore_instances ci join chores c on c.id = ci.chore_id join families f on f.id = k.family_id
      where ci.kid_id = k.id and ci.date = family_today(k.family_id) and c.required and ci.status <> 'approved'
        and (c.due_time is null or (now() at time zone f.timezone)::time >= c.due_time)
    ) then 'unlocked'
    else 'locked'
  end as state
from kids k;

-- ---------- scheduling helpers ----------
-- Next fire from scratch (task created/edited): today's grid slot (first_fire + n*repeat)
-- still ahead and inside the window, else tomorrow at first_fire.
create or replace function private.critical_first_fire(t critical_tasks) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare tz text; nowl timestamp; d date; cand timestamp;
begin
  select timezone into tz from families where id = t.family_id;
  nowl := now() at time zone tz;
  d := nowl::date;
  cand := d + t.first_fire;
  if t.repeat_minutes is not null then
    while cand <= nowl loop cand := cand + make_interval(mins => t.repeat_minutes); end loop;
    if cand::date > d or (t.window_end is not null and cand::time > t.window_end) then
      cand := (d + 1) + t.first_fire;
    end if;
  elsif cand <= nowl then
    cand := (d + 1) + t.first_fire;
  end if;
  return cand at time zone tz;
end $$;

-- Next fire after a completion: done + repeat, unless that lands outside the daily
-- window — then tomorrow at first_fire. One-a-day tasks always go to tomorrow.
create or replace function private.critical_next_fire(t critical_tasks, ref timestamptz) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare tz text; cand timestamptz; local_c timestamp; local_r timestamp;
begin
  select timezone into tz from families where id = t.family_id;
  local_r := ref at time zone tz;
  if t.repeat_minutes is not null then
    cand := ref + make_interval(mins => t.repeat_minutes);
    local_c := cand at time zone tz;
    if local_c::date = local_r::date and local_c::time >= t.first_fire
       and (t.window_end is null or local_c::time <= t.window_end) then
      return cand;
    end if;
  end if;
  return ((local_r::date + 1) + t.first_fire) at time zone tz;
end $$;

-- ---------- parent RPCs ----------
create or replace function save_critical_task(
  p_id uuid, p_kid uuid, p_title text, p_emoji text, p_note text,
  p_first_fire time, p_repeat_minutes int, p_window_end time,
  p_lock_after int, p_broadcast_after int, p_lock_all_after int,
  p_followup_title text, p_followup_delay int, p_active boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare fid uuid := my_family_id(); v_id uuid; t critical_tasks;
begin
  if fid is null then raise exception 'not allowed'; end if;
  if (select family_id from kids where id = p_kid) is distinct from fid then raise exception 'not allowed'; end if;
  if p_title is null or length(trim(p_title)) = 0 or p_first_fire is null then raise exception 'bad task'; end if;
  if p_id is null then
    insert into critical_tasks (family_id, kid_id, title, emoji, note, first_fire, repeat_minutes, window_end,
                                lock_after_min, broadcast_after_min, lock_all_after_min,
                                followup_title, followup_delay_min, active)
    values (fid, p_kid, trim(p_title), coalesce(p_emoji, '🚨'), nullif(trim(coalesce(p_note, '')), ''),
            p_first_fire, p_repeat_minutes, p_window_end,
            coalesce(p_lock_after, 5), coalesce(p_broadcast_after, 15), coalesce(p_lock_all_after, 30),
            nullif(trim(coalesce(p_followup_title, '')), ''), coalesce(p_followup_delay, 15), coalesce(p_active, true))
    returning id into v_id;
  else
    update critical_tasks set kid_id = p_kid, title = trim(p_title), emoji = coalesce(p_emoji, emoji),
      note = nullif(trim(coalesce(p_note, '')), ''), first_fire = p_first_fire, repeat_minutes = p_repeat_minutes,
      window_end = p_window_end, lock_after_min = coalesce(p_lock_after, lock_after_min),
      broadcast_after_min = coalesce(p_broadcast_after, broadcast_after_min),
      lock_all_after_min = coalesce(p_lock_all_after, lock_all_after_min),
      followup_title = nullif(trim(coalesce(p_followup_title, '')), ''),
      followup_delay_min = coalesce(p_followup_delay, followup_delay_min), active = coalesce(p_active, active)
    where id = p_id and family_id = fid
    returning id into v_id;
    if v_id is null then raise exception 'not found'; end if;
  end if;
  -- (Re)book the next fire unless a round is already in flight. Deactivating cancels open rounds.
  select * into t from critical_tasks where id = v_id;
  if not t.active then
    update critical_instances set status = 'canceled' where task_id = v_id and status in ('open', 'scheduled');
    update critical_tasks set next_fire_at = null where id = v_id;
    perform private.notify_kids((select array_agg(id) from kids where family_id = fid), 'state');
  elsif not exists (select 1 from critical_instances where task_id = v_id and status in ('open', 'scheduled')) then
    update critical_tasks set next_fire_at = private.critical_first_fire(t) where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function delete_critical_task(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare fid uuid := my_family_id();
begin
  if (select family_id from critical_tasks where id = p_id) is distinct from fid then raise exception 'not allowed'; end if;
  delete from critical_tasks where id = p_id;
  perform private.notify_kids((select array_agg(id) from kids where family_id = fid), 'state');
end $$;

create or replace function cancel_critical(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inst critical_instances; t critical_tasks;
begin
  select * into inst from critical_instances where id = p_id and status in ('open', 'scheduled');
  if not found or inst.family_id is distinct from my_family_id() then raise exception 'not allowed'; end if;
  update critical_instances set status = 'canceled' where id = p_id;
  select * into t from critical_tasks where id = inst.task_id;
  if t.active then update critical_tasks set next_fire_at = private.critical_next_fire(t, now()) where id = t.id; end if;
  if inst.level >= 3 then
    perform private.notify_kids((select array_agg(id) from kids where family_id = inst.family_id), 'state');
  elsif inst.level >= 1 then
    perform private.notify_kids(array[inst.kid_id], 'state');
  end if;
end $$;

-- ---------- completion (kid or parent) ----------
create or replace function complete_critical(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inst critical_instances; t critical_tasks; kid uuid := my_kid_id();
begin
  select * into inst from critical_instances where id = p_id and status = 'open';
  if not found then return; end if;  -- already done/canceled: no-op, not an error
  if inst.family_id = my_family_id() then
    kid := null;  -- a parent marked it done
  elsif kid is not null and kid_family_id(kid) = inst.family_id
        and (kid = inst.kid_id or inst.level >= 2) then
    null;  -- the assignee, or any kid once it went family-wide
  else
    raise exception 'not allowed';
  end if;
  update critical_instances set status = 'done', done_at = now(), done_by = kid where id = p_id;
  select * into t from critical_tasks where id = inst.task_id;
  -- Lift whatever locks the escalation created (silent state pushes re-run the shield).
  if inst.level >= 3 then
    perform private.notify_kids((select array_agg(id) from kids where family_id = inst.family_id), 'state');
  elsif inst.level >= 1 then
    perform private.notify_kids(array[inst.kid_id], 'state');
  end if;
  if inst.kind = 'main' then
    if t.followup_title is not null then
      insert into critical_instances (task_id, family_id, kid_id, kind, title, due_at, status)
      values (t.id, t.family_id, coalesce(kid, inst.kid_id), 'followup', t.followup_title,
              now() + make_interval(mins => t.followup_delay_min), 'scheduled');
    end if;
    if t.active then
      update critical_tasks set next_fire_at = private.critical_next_fire(t, now()) where id = t.id;
    end if;
  end if;
end $$;

-- ---------- the engine (cron, every minute) ----------
create or replace function private.run_criticals() returns void
language plpgsql security definer set search_path = public as $$
declare r record; others uuid[]; everyone uuid[];
begin
  -- Follow-ups coming due open + ping their kid.
  for r in select * from critical_instances where status = 'scheduled' and due_at <= now() loop
    update critical_instances set status = 'open' where id = r.id;
    perform private.notify_kids(array[r.kid_id], 'critical', r.title, 'It''s time — mark it done in ChoreKey when it''s handled.');
  end loop;

  -- Fire tasks whose slot arrived (never while a round is still in flight).
  for r in
    select t.* from critical_tasks t
    where t.active and t.next_fire_at is not null and t.next_fire_at <= now()
      and not exists (select 1 from critical_instances ci where ci.task_id = t.id and ci.status in ('open', 'scheduled'))
  loop
    insert into critical_instances (task_id, family_id, kid_id, title, due_at)
    values (r.id, r.family_id, r.kid_id, r.title, now());
    update critical_tasks set next_fire_at = null where id = r.id;
    perform private.notify_kids(array[r.kid_id], 'critical', r.title,
      coalesce(r.note, 'Do it now and mark it done in ChoreKey.'));
  end loop;

  -- Escalate overdue rounds. Levels catch up in one pass if the cron was down.
  for r in
    select ci.id, ci.kid_id, ci.family_id, ci.title, ci.level, ci.due_at,
           ct.lock_after_min, ct.broadcast_after_min, ct.lock_all_after_min
    from critical_instances ci join critical_tasks ct on ct.id = ci.task_id
    where ci.status = 'open'
  loop
    if r.level < 1 and now() >= r.due_at + make_interval(mins => r.lock_after_min) then
      update critical_instances set level = 1 where id = r.id;
      perform private.notify_kids(array[r.kid_id], 'critical', r.title, 'Internet is off until this is done.');
      perform private.notify_kids(array[r.kid_id], 'state');
      r.level := 1;
    end if;
    if r.level < 2 and now() >= r.due_at + make_interval(mins => r.broadcast_after_min) then
      update critical_instances set level = 2 where id = r.id;
      select array_agg(id) into others from kids where family_id = r.family_id and id <> r.kid_id;
      if others is not null then
        perform private.notify_kids(others, 'critical', r.title, 'Still not done — anyone can do it. First one there wins.');
      end if;
      r.level := 2;
    end if;
    if r.level < 3 and now() >= r.due_at + make_interval(mins => r.lock_all_after_min) then
      update critical_instances set level = 3 where id = r.id;
      select array_agg(id) into everyone from kids where family_id = r.family_id;
      perform private.notify_kids(everyone, 'critical', r.title, 'Everyone''s internet is off until it''s done.');
      perform private.notify_kids(everyone, 'state');
    end if;
  end loop;
end $$;
select cron.schedule('chorekey-criticals', '* * * * *', 'select private.run_criticals()');
