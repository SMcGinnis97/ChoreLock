-- Round 1 feature batch (applied via MCP 2026-08-25):
--   * chore rotation between assigned kids (daily / weekly / every other day / after each completion)
--   * kid absences (skip chore generation + unlock while away)
--   * side quests (ad-hoc bonus tasks with points, open-to-claim or assigned, photo prompt/proof)
--   * per-chore due time (chore only blocks Wi-Fi after its due time passes; default = blocks all day)
--   * server-side auto-approval (first attempt only) so a parent can reject an auto-approved chore
--     and the resubmission always needs manual review

create type rotation_mode as enum ('none','daily','weekly','every_other_day','after_done');
create type quest_status as enum ('open','claimed','submitted','approved','rejected');

alter table chores
  add column rotation rotation_mode not null default 'none',
  add column rotation_index int not null default 0,
  add column rotation_last date,
  add column due_time time;

alter table kids add column absent_until date;

create table side_quests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  title text not null,
  note text,
  points int not null default 5,
  prompt_path text,                 -- parent's photo of the task (storage: family/quests/<id>.jpg)
  kid_id uuid references kids(id) on delete set null,  -- null = open for any kid to claim
  status quest_status not null default 'open',
  proof_path text,                  -- kid's proof (storage: family/<kid>/quests/<id>.<ext>)
  proof_note text,
  rejection_reason text,
  claimed_at timestamptz,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table side_quests enable row level security;
create policy parent_quests on side_quests for all
  using (family_id = my_family_id()) with check (family_id = my_family_id());
create policy kid_read_quests on side_quests for select
  using (family_id = kid_family_id(my_kid_id()));
create policy kid_work_quests on side_quests for update
  using (family_id = kid_family_id(my_kid_id()) and (kid_id is null or kid_id = my_kid_id()) and status in ('open','claimed','rejected'))
  with check (kid_id = my_kid_id() and status in ('claimed','submitted'));
alter publication supabase_realtime add table side_quests;

create or replace view kid_points as
  select k.id as kid_id, coalesce(sum(q.points) filter (where q.status = 'approved'), 0)::int as points
  from kids k left join side_quests q on q.kid_id = k.id group by k.id;

-- Storage: parents may upload (quest prompt photos); kids may read quest prompts.
create policy parent_write_proofs on storage.objects for insert
  with check (bucket_id = 'proofs' and (storage.foldername(name))[1] = my_family_id()::text);
create policy kid_read_quest_prompts on storage.objects for select
  using (bucket_id = 'proofs' and (storage.foldername(name))[1] = kid_family_id(my_kid_id())::text and (storage.foldername(name))[2] = 'quests');

-- ---------- rotation + absence aware instance generation ----------

create or replace function kid_absent(p_kid uuid, d date) returns boolean
language sql stable security definer set search_path = public as
  $$ select coalesce((select absent_until >= d from kids where id = p_kid), false) $$;

-- Active kid for a rotating chore on date d: pool ordered by kids.created_at,
-- start at rotation_index, skip absent kids (falls back to the indexed kid if all absent).
create or replace function rotation_kid(p_chore uuid, d date) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare pool uuid[]; n int; idx int; i int; cand uuid;
begin
  select array_agg(k.id order by k.created_at, k.id) into pool
  from chore_assignments a join kids k on k.id = a.kid_id where a.chore_id = p_chore;
  n := coalesce(cardinality(pool), 0);
  if n = 0 then return null; end if;
  select rotation_index % n into idx from chores where id = p_chore;
  for i in 0..n-1 loop
    cand := pool[((idx + i) % n) + 1];
    if not kid_absent(cand, d) then return cand; end if;
  end loop;
  return pool[idx + 1];
end $$;

-- Advance rotation counters for every chore in the family scheduled on d. Idempotent per day.
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
end $$;

-- Insert today's instances for one kid (no-op while absent; rotating chores only for the active kid).
create or replace function gen_today(p_kid uuid, d date) returns void
language plpgsql security definer set search_path = public as $$
declare dow int := extract(dow from d);
begin
  if kid_absent(p_kid, d) then return; end if;
  insert into chore_instances(chore_id, kid_id, date)
  select c.id, p_kid, d from chores c join chore_assignments a on a.chore_id = c.id
  where a.kid_id = p_kid and not c.archived
    and (c.recurrence = 'daily' or (c.recurrence = 'weekdays' and dow between 1 and 5) or (c.recurrence = 'custom' and dow = any(c.days)))
    and (c.rotation = 'none' or rotation_kid(c.id, d) = p_kid)
  on conflict do nothing;
end $$;

create or replace function ensure_today(p_kid uuid) returns date
language plpgsql security definer set search_path = public as $$
declare fid uuid; d date;
begin
  select family_id into fid from kids where id = p_kid;
  if fid is null or (my_family_id() is distinct from fid and my_kid_id() is distinct from p_kid) then raise exception 'not allowed'; end if;
  d := family_today(fid);
  perform rotation_tick(fid, d);
  perform gen_today(p_kid, d);
  update kids set override = null, override_date = null where id = p_kid and override_date is not null and override_date < d;
  update kids set absent_until = null where id = p_kid and absent_until is not null and absent_until < d;
  return d;
end $$;

create or replace function private.run_resets() returns integer
language plpgsql security definer set search_path = public as $$
declare f record; k record; n int := 0; kids_arr uuid[];
begin
  for f in
    select id, family_today(id) as today from families
    where (last_reset_date is null or last_reset_date < family_today(id))
      and (now() at time zone timezone)::time >= reset_time
  loop
    perform rotation_tick(f.id, f.today);
    kids_arr := array[]::uuid[];
    for k in select id from kids where family_id = f.id loop
      perform gen_today(k.id, f.today);
      update kids set override = null, override_date = null where id = k.id and override_date < f.today;
      update kids set absent_until = null where id = k.id and absent_until is not null and absent_until < f.today;
      kids_arr := kids_arr || k.id;
    end loop;
    update families set last_reset_date = f.today where id = f.id;
    perform private.notify_kids(kids_arr, 'reset');
    n := n + 1;
  end loop;
  return n;
end $$;

-- 'after_done' rotation: hand the chore to the next kid each time it is approved.
create or replace function private.on_rotation_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    update chores set rotation_index = rotation_index + 1 where id = new.chore_id and rotation = 'after_done';
  end if;
  return new;
end $$;
create trigger rotation_after_done after update on chore_instances
  for each row execute function private.on_rotation_done();

-- ---------- server-side auto-approval ----------
-- First attempt only: a rejected-and-resubmitted chore (attempt > 1) always waits for a parent,
-- so rejecting an auto-approved chore forces manual review of the redo.
create or replace function private.auto_approve_submission() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'submitted' and old.status is distinct from 'submitted' and new.attempt = 1
     and (select f.auto_approve from families f join kids k on k.family_id = f.id where k.id = new.kid_id) then
    new.status := 'approved';
    new.reviewed_at := now();
  end if;
  return new;
end $$;
create trigger auto_approve before update on chore_instances
  for each row execute function private.auto_approve_submission();

-- ---------- lock state: absence + due time ----------
-- A required chore with a due_time only blocks Wi-Fi once that (family-local) time has passed.
-- No due_time = blocks all day (existing behavior). Absent kids are always unlocked.
create or replace view kid_lock_state as
select k.id as kid_id, k.family_id,
  case
    when k.absent_until is not null and k.absent_until >= family_today(k.family_id) then 'unlocked'
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

-- Ping kid devices when a due time just passed so the shield engages without an app open.
create or replace function private.notify_due() returns void
language plpgsql security definer set search_path = public as $$
declare f record; kids_arr uuid[];
begin
  for f in select id, timezone from families loop
    select array_agg(distinct ci.kid_id) into kids_arr
    from chore_instances ci join chores c on c.id = ci.chore_id
    where c.family_id = f.id and c.required and c.due_time is not null
      and ci.date = family_today(f.id) and ci.status <> 'approved'
      and (now() at time zone f.timezone)::time >= c.due_time
      and (now() at time zone f.timezone)::time < c.due_time + interval '6 minutes';
    if kids_arr is not null then perform private.notify_kids(kids_arr, 'state'); end if;
  end loop;
end $$;
select cron.schedule('chorelock-due-check', '*/5 * * * *', 'select private.notify_due()');

-- Absence changes ping the kid device the same way overrides do.
create or replace function private.on_kid_override() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.override is distinct from old.override or new.override_date is distinct from old.override_date
     or new.absent_until is distinct from old.absent_until then
    perform private.notify_kids(array[new.id], 'state');
  end if;
  return new;
end $$;

-- Function grants follow the 0002 default privileges (authenticated + service_role).
