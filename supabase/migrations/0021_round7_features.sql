-- Round 7 feature batch:
--   * "We need" list permissions: check-off ("got it") is parent-only; kids may
--     delete only their own additions (they still add freely)
--   * per-chore overdue behavior: block (default) / expire (missed, breaks streak)
--     / escalate (keeps blocking, parent sees an overdue banner) / rollover
--     (streak-neutral, re-books the chore the next day at reset)
--   * streak mercy on rejection: a parent can keep the day counting toward the
--     streak even if the redo never lands (chore_instances.streak_exempt)
--   * multi-photo: up to 5 reference photos on a chore, up to 5 proof photos per
--     submission (photo_paths[]; legacy photo_path still read)
--   * chore groups ("chore lists"): a named set of chores assigned to an ordered
--     kid rotation that advances weekly — List A is Child A's this week, Child B's next
--   * away hand-off: handoff_today() moves one kid's unfinished instances to a sibling
--   * side-quest claim timeout: 30 min to submit, push reminder, then 15 more
--     minutes before the quest goes back in the open pool (parent-assigned quests
--     never time out — only kid-claimed ones have claimed_at set)

-- ---------- 1) "We need" list permissions ----------
drop policy kid_check_list_items on list_items;
create policy kid_delete_own_list_items on list_items for delete
  using (added_by_kid = my_kid_id());

-- ---------- 2) overdue behavior + streak mercy + multi-photo columns ----------
create type overdue_mode as enum ('block','expire','escalate','rollover');
alter table chores
  add column overdue overdue_mode not null default 'block',
  add column ref_paths text[];
alter table chore_instances
  add column rolled boolean not null default false,
  add column streak_exempt boolean not null default false,
  add column photo_paths text[];

-- Expired chores stop blocking once their due time passes (the stick is the
-- streak, not the lock). Everything else in the view is unchanged from 0018.
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

-- Streak: a day counts when every required instance is approved, rolled over,
-- or streak-exempted by a merciful parent.
create or replace function kid_streak(p_kid uuid) returns int language sql stable security definer set search_path = public as $$
  with days as (
    select ci.date, bool_and(ci.status = 'approved' or ci.rolled or ci.streak_exempt) as ok
    from chore_instances ci join chores c on c.id = ci.chore_id
    where ci.kid_id = p_kid and c.required group by ci.date
  ), ranked as (
    select date, ok, row_number() over (order by date desc) as rn from days where date <= family_today((select family_id from kids where id = p_kid))
  ), run as (
    select rn from ranked r where ok and not exists (select 1 from ranked r2 where r2.rn < r.rn and not r2.ok)
  )
  select count(*)::int from run
$$;

-- Kids can read chore reference photos (proofs bucket, family/chores/...).
create policy kid_read_chore_refs on storage.objects for select
  using (bucket_id = 'proofs' and (storage.foldername(name))[1] = kid_family_id(my_kid_id())::text and (storage.foldername(name))[2] = 'chores');

-- ---------- 3) chore groups (rotating chore lists) ----------
create table chore_groups (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  emoji text not null default '📋',
  rotation_index int not null default 0,
  rotation_last date,
  created_at timestamptz not null default now()
);
create table chore_group_kids (
  group_id uuid not null references chore_groups(id) on delete cascade,
  kid_id uuid not null references kids(id) on delete cascade,
  position int not null default 0,
  primary key (group_id, kid_id)
);
alter table chores add column group_id uuid references chore_groups(id) on delete set null;

alter table chore_groups enable row level security;
alter table chore_group_kids enable row level security;
create policy parent_groups on chore_groups for all
  using (family_id = my_family_id()) with check (family_id = my_family_id());
create policy kid_read_groups on chore_groups for select
  using (family_id = kid_family_id(my_kid_id()));
create or replace function group_family_id(gid uuid) returns uuid language sql stable security definer set search_path = public as
  $$ select family_id from chore_groups where id = gid $$;
create policy parent_group_kids on chore_group_kids for all
  using (group_family_id(group_id) = my_family_id()) with check (group_family_id(group_id) = my_family_id());
create policy kid_read_group_kids on chore_group_kids for select
  using (group_family_id(group_id) = kid_family_id(my_kid_id()));
alter publication supabase_realtime add table chore_groups, chore_group_kids;

-- Kids must be able to read group-chore definitions even with no assignment row.
create or replace function my_kid_group_ids() returns setof uuid language sql stable security definer set search_path = public as
  $$ select group_id from chore_group_kids where kid_id = my_kid_id() $$;
drop policy kid_read_chores on chores;
create policy kid_read_chores on chores for select
  using (id in (select my_kid_chore_ids()) or group_id in (select my_kid_group_ids()));

-- This week's kid for a group: ordered by position, offset by rotation_index,
-- absent kids skipped (falls back to the indexed kid if everyone is away).
create or replace function group_kid(p_group uuid, d date) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare pool uuid[]; n int; idx int; i int; cand uuid;
begin
  select array_agg(kid_id order by position, kid_id) into pool from chore_group_kids where group_id = p_group;
  n := coalesce(cardinality(pool), 0);
  if n = 0 then return null; end if;
  select rotation_index % n into idx from chore_groups where id = p_group;
  for i in 0..n-1 loop
    cand := pool[((idx + i) % n) + 1];
    if not kid_absent(cand, d) then return cand; end if;
  end loop;
  return pool[idx + 1];
end $$;

-- rotation_tick: per-chore rotations as before, plus weekly group advance.
create or replace function rotation_tick(fid uuid, d date) returns void
language plpgsql security definer set search_path = public as $$
declare dow int := extract(dow from d);
begin
  update chores set rotation_last = d
  where family_id = fid and rotation <> 'none' and rotation_last is null;
  update chores set rotation_index = rotation_index + 1, rotation_last = d
  where family_id = fid and not archived and rotation_last < d
    and (recurrence = 'daily' or (recurrence = 'weekdays' and dow between 1 and 5) or (recurrence = 'custom' and dow = any(days)))
    and (rotation = 'daily'
      or (rotation = 'weekly' and date_trunc('week', rotation_last::timestamp) < date_trunc('week', d::timestamp))
      or (rotation = 'every_other_day' and d - rotation_last >= 2));
  update chore_groups set rotation_last = d where family_id = fid and rotation_last is null;
  update chore_groups set rotation_index = rotation_index + 1, rotation_last = d
  where family_id = fid and rotation_last < d
    and date_trunc('week', rotation_last::timestamp) < date_trunc('week', d::timestamp);
end $$;

-- gen_today: assignment-based chores (group-less) as before, plus group chores
-- for whichever kid holds the group this week.
create or replace function gen_today(p_kid uuid, d date) returns void
language plpgsql security definer set search_path = public as $$
declare dow int := extract(dow from d);
begin
  if kid_absent(p_kid, d) then return; end if;
  insert into chore_instances(chore_id, kid_id, date)
  select c.id, p_kid, d from chores c join chore_assignments a on a.chore_id = c.id
  where a.kid_id = p_kid and not c.archived and c.group_id is null
    and (c.recurrence = 'daily' or (c.recurrence = 'weekdays' and dow between 1 and 5) or (c.recurrence = 'custom' and dow = any(c.days)))
    and (c.rotation = 'none' or rotation_kid(c.id, d) = p_kid)
  on conflict do nothing;
  insert into chore_instances(chore_id, kid_id, date)
  select c.id, p_kid, d from chores c
  where c.group_id is not null and not c.archived
    and c.family_id = (select family_id from kids where id = p_kid)
    and (c.recurrence = 'daily' or (c.recurrence = 'weekdays' and dow between 1 and 5) or (c.recurrence = 'custom' and dow = any(c.days)))
    and group_kid(c.group_id, d) = p_kid
  on conflict do nothing;
end $$;

-- ---------- 4) daily reset: rollover chores re-book the next day ----------
create or replace function private.run_resets() returns integer
language plpgsql security definer set search_path = public as $$
declare f record; k record; n int := 0; kids_arr uuid[];
begin
  for f in
    select id, family_today(id) as today from families
    where (last_reset_date is null or last_reset_date < family_today(id))
      and (now() at time zone timezone)::time >= reset_time
  loop
    -- Unfinished rollover instances from earlier days: streak-neutral, then re-booked below.
    update chore_instances ci set rolled = true
    from chores c where c.id = ci.chore_id and c.family_id = f.id
      and c.overdue = 'rollover' and ci.date < f.today and ci.status <> 'approved' and not ci.rolled;
    perform rotation_tick(f.id, f.today);
    kids_arr := array[]::uuid[];
    for k in select id from kids where family_id = f.id loop
      perform gen_today(k.id, f.today);
      update kids set override = null, override_date = null where id = k.id and override_date < f.today;
      update kids set absent_until = null where id = k.id and absent_until is not null and absent_until < f.today;
      kids_arr := kids_arr || k.id;
    end loop;
    -- Re-book rolled chores for today even when today isn't a scheduled day.
    insert into chore_instances(chore_id, kid_id, date)
    select distinct ci.chore_id, ci.kid_id, f.today
    from chore_instances ci join chores c on c.id = ci.chore_id
    where c.family_id = f.id and not c.archived and c.overdue = 'rollover'
      and ci.rolled and ci.date = f.today - 1 and not kid_absent(ci.kid_id, f.today)
    on conflict do nothing;
    update families set last_reset_date = f.today where id = f.id;
    perform private.notify_kids(kids_arr, 'reset');
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- 5) away hand-off ----------
-- Move one kid's unfinished instances for today onto a sibling. Instances the
-- target already has (same chore, same day) stay put. Returns how many moved.
create or replace function handoff_today(p_from uuid, p_to uuid) returns int
language plpgsql security definer set search_path = public as $$
declare fid uuid := my_family_id(); d date; moved int;
begin
  if fid is null
     or (select family_id from kids where id = p_from) is distinct from fid
     or (select family_id from kids where id = p_to) is distinct from fid
     or p_from = p_to then raise exception 'not allowed'; end if;
  d := family_today(fid);
  update chore_instances ci set kid_id = p_to
  where ci.kid_id = p_from and ci.date = d and ci.status <> 'approved'
    and not exists (select 1 from chore_instances x where x.chore_id = ci.chore_id and x.kid_id = p_to and x.date = d);
  get diagnostics moved = row_count;
  if moved > 0 then
    perform private.notify_kids(array[p_to], 'quest', 'Chores handed to you',
      (select name from kids where id = p_from) || ' is away — ' || moved || ' of their chores are yours today.');
  end if;
  return moved;
end $$;

-- ---------- 6) side-quest claim timeout ----------
alter table side_quests add column reminded_at timestamptz;

create or replace function private.quest_claim_sweep() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select id, kid_id, title from side_quests
    where status = 'claimed' and claimed_at is not null and reminded_at is null
      and claimed_at < now() - interval '30 minutes'
  loop
    update side_quests set reminded_at = now() where id = r.id;
    perform private.notify_kids(array[r.kid_id], 'quest', 'Still on it? ⏳',
      '“' || r.title || '” goes back up for grabs in 15 minutes unless you submit proof.');
  end loop;
  for r in
    select id, kid_id, title from side_quests
    where status = 'claimed' and claimed_at is not null and reminded_at is not null
      and reminded_at < now() - interval '15 minutes'
  loop
    update side_quests set status = 'open', kid_id = null, claimed_at = null, reminded_at = null where id = r.id;
    perform private.notify_kids(array[r.kid_id], 'quest', 'Back up for grabs',
      '“' || r.title || '” was unclaimed — grab it again if you’re still on it.');
  end loop;
end $$;
select cron.schedule('chorekey-quest-claims', '*/5 * * * *', 'select private.quest_claim_sweep()');

-- Re-claiming resets the reminder clock.
create or replace function private.on_quest_claimed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'claimed' and old.status is distinct from 'claimed' then
    new.reminded_at := null;
  end if;
  return new;
end $$;
create trigger quest_claim_reset before update on side_quests
  for each row execute function private.on_quest_claimed();
