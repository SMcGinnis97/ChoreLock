-- Bedtime: a per-kid nightly lock window (school nights + an optional Fri/Sat pair).
-- Fourth shield state ("bedtime", indigo) was plumbed in 0018/the shield extension; this
-- migration adds the schedule that drives it.
--
-- Ladder (kid_lock_state): grounded > away > critical > 15-min pass > BEDTIME > manual
-- override > chores. A pass beats bedtime because the bedtime shield's own button is
-- "Ask for 15 minutes"; a manual "Unlock now" set in the afternoon must NOT silently
-- defeat bedtime, so parents get an explicit "Stay up tonight" (bed_off_date) instead.
--
-- Enforcement on the device is native (DeviceActivity schedules registered by the app,
-- shield applied by the monitor extension, no network). The server side here is the
-- source of truth for the parent dashboard and sends the goodnight push at the start
-- (visible, time-sensitive — it also wakes the app to apply the shield) and a silent
-- reconcile push at the end.

alter table kids
  add column bed_start time,                 -- school-night window start (null = bedtime off)
  add column bed_end time,                   -- morning end
  add column bed_start_weekend time,         -- Fri & Sat nights, when different (both set or neither)
  add column bed_end_weekend time,
  add column bed_off_date date,              -- "stay up tonight": the evening's date that is skipped
  add column bed_notified_evening date,      -- last evening the goodnight push went out
  add column bed_end_notified_evening date;  -- last evening whose end-of-window reconcile push went out

-- The window that applies to a given evening: Fri/Sat use the weekend pair when set.
create or replace function bedtime_window(k kids, p_evening date, out w_start time, out w_end time)
language sql immutable as $$
  select
    case when extract(dow from p_evening) in (5, 6) and k.bed_start_weekend is not null and k.bed_end_weekend is not null
         then k.bed_start_weekend else k.bed_start end,
    case when extract(dow from p_evening) in (5, 6) and k.bed_start_weekend is not null and k.bed_end_weekend is not null
         then k.bed_end_weekend else k.bed_end end;
$$;

-- The evening whose bedtime window contains "now" (family-local), or null when the kid
-- is not in bedtime (off, outside the window, or the parent skipped that evening).
-- Mirrored client-side by bedtimeNow() in src/lib/store.tsx — keep them in step.
create or replace function bedtime_evening(k kids) returns date
language plpgsql stable set search_path = public as $$
declare
  lt timestamp; t time; d date; ev date; ws time; we time;
begin
  if k.bed_start is null or k.bed_end is null then return null; end if;
  lt := now() at time zone coalesce((select timezone from families where id = k.family_id), 'UTC');
  t := lt::time; d := lt::date;
  -- Two candidates: last night's window may still be running (it crossed midnight),
  -- or tonight's may have started.
  foreach ev in array array[d - 1, d] loop
    select w.w_start, w.w_end into ws, we from bedtime_window(k, ev) w;
    if (ws > we and ((ev = d - 1 and t < we) or (ev = d and t >= ws)))
       or (ws <= we and ev = d and t >= ws and t < we) then
      if k.bed_off_date = ev then return null; end if;
      return ev;
    end if;
  end loop;
  return null;
end $$;

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
    when k.unlock_until is not null and k.unlock_until > now() then 'unlocked'
    when bedtime_evening(k) is not null then 'locked'
    when k.override = 'unlock' and k.override_date = family_today(k.family_id) then 'unlocked'
    when k.override = 'lock'   and k.override_date = family_today(k.family_id) then 'locked'
    when not exists (
      select 1 from chore_instances ci join chores c on c.id = ci.chore_id join families f on f.id = k.family_id
      where ci.kid_id = k.id and ci.date = family_today(k.family_id) and c.required and ci.status <> 'approved'
        and (c.due_time is null or (now() at time zone f.timezone)::time >= c.due_time)
        and not (c.overdue = 'expire' and c.due_time is not null and (now() at time zone f.timezone)::time >= c.due_time)
    ) then 'unlocked'
    else 'locked'
  end as state
from kids k;

-- Parent sets (or clears, p_start null) a kid's bedtime. The weekend pair only sticks as a pair.
create or replace function set_bedtime(p_kid uuid, p_start time, p_end time, p_start_weekend time default null, p_end_weekend time default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select family_id from kids where id = p_kid) is distinct from my_family_id() then raise exception 'not allowed'; end if;
  update kids set
    bed_start = p_start,
    bed_end = case when p_start is null then null else p_end end,
    bed_start_weekend = case when p_start is null or p_start_weekend is null or p_end_weekend is null then null else p_start_weekend end,
    bed_end_weekend   = case when p_start is null or p_start_weekend is null or p_end_weekend is null then null else p_end_weekend end,
    bed_off_date = case when p_start is null then null else bed_off_date end
  where id = p_kid;
end $$;

-- "Stay up tonight" (p_skip true) / "bedtime back on" (false). The skipped evening is the
-- one whose window is running right now (past midnight = last night), else tonight.
create or replace function skip_bedtime(p_kid uuid, p_skip boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select family_id from kids where id = p_kid) is distinct from my_family_id() then raise exception 'not allowed'; end if;
  update kids k set bed_off_date = case when p_skip then coalesce(bedtime_evening(k), family_today(k.family_id)) else null end
  where k.id = p_kid;
end $$;

-- Kid-device pushes for bedtime changes, alongside the override/absence/grounding ones (0024).
create or replace function private.on_kid_override() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.override is distinct from old.override or new.override_date is distinct from old.override_date
     or new.absent_until is distinct from old.absent_until then
    if new.override = 'unlock' and old.override is distinct from 'unlock' then
      perform private.notify_kids(array[new.id], 'lockstate', '🔓 You’re unlocked',
        'A parent switched your Wi-Fi on. Enjoy!');
    elsif new.override = 'lock' and old.override is distinct from 'lock' then
      perform private.notify_kids(array[new.id], 'lockstate', '🔒 You’re locked',
        'A parent switched your Wi-Fi off for now.');
    else
      perform private.notify_kids(array[new.id], 'state');
    end if;
  end if;
  if new.grounded_until is distinct from old.grounded_until or new.grounded_reason is distinct from old.grounded_reason then
    if new.grounded_until is not null and new.grounded_until > now() then
      perform private.notify_kids(array[new.id], 'grounded', null, new.grounded_reason);
    elsif old.grounded_until is not null then
      perform private.notify_kids(array[new.id], 'ungrounded');
    else
      perform private.notify_kids(array[new.id], 'state');
    end if;
  end if;
  if new.bed_off_date is distinct from old.bed_off_date then
    if new.bed_off_date is not null then
      -- Visible + time-sensitive: if this lands mid-bedtime the app must wake to drop the shield.
      perform private.notify_kids(array[new.id], 'lockstate', '🌙 Bedtime’s off tonight',
        'A parent said you can stay up. Chores still count.');
    else
      perform private.notify_kids(array[new.id], 'state');
    end if;
  elsif (new.bed_start, new.bed_end, new.bed_start_weekend, new.bed_end_weekend)
        is distinct from (old.bed_start, old.bed_end, old.bed_start_weekend, old.bed_end_weekend) then
    -- Silent: the kid app re-registers its native bedtime schedules on reconcile.
    perform private.notify_kids(array[new.id], 'state');
  end if;
  return new;
end $$;

-- Every minute: goodnight push when a window opens, silent reconcile when it closes.
create or replace function private.run_bedtimes() returns void
language plpgsql security definer set search_path = public as $$
declare r kids; ev date; we time;
begin
  for r in select * from kids where bed_start is not null and bed_end is not null loop
    ev := bedtime_evening(r);
    if ev is not null then
      if r.bed_notified_evening is distinct from ev then
        if r.absent_until is null or r.absent_until < family_today(r.family_id) then
          select w.w_end into we from bedtime_window(r, ev) w;
          perform private.notify_kids(array[r.id], 'lockstate', '🌙 Goodnight, ' || r.name,
            'Screens are off until ' || to_char(we, 'FMHH12:MI AM') || '. See you in the morning.');
        end if;
        update kids set bed_notified_evening = ev where id = r.id;
      end if;
    elsif r.bed_notified_evening is not null and r.bed_end_notified_evening is distinct from r.bed_notified_evening then
      -- The window just closed (or a parent switched bedtime off): nudge the device to reconcile.
      perform private.notify_kids(array[r.id], 'state');
      update kids set bed_end_notified_evening = r.bed_notified_evening where id = r.id;
    end if;
  end loop;
end $$;

select cron.schedule('chorekey-bedtime', '* * * * *', 'select private.run_bedtimes()');
