-- Shield secondary buttons become real: "Ask for 15 minutes 🙏" (chores/bedtime
-- shields) and "I'm doing it now! 💪" (critical shield). The ShieldAction extension
-- queues taps in the app group; the app drains them into request_unlock(). Parents
-- see pending asks on the dashboard and grant/deny; a grant sets kids.unlock_until,
-- a 15-minute pass that beats the chore lock (never grounding or critical locks).
-- A denied ask suppresses the shield's request button for an hour (client-side via
-- shieldAllowRequest, computed from these rows).

alter table kids add column unlock_until timestamptz;

create table unlock_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  kid_id uuid not null references kids(id) on delete cascade,
  kind text not null check (kind in ('fifteen', 'inprogress')),
  status text not null default 'pending' check (status in ('pending', 'granted', 'denied')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
alter table unlock_requests enable row level security;
create policy parent_unlock_requests on unlock_requests for all
  using (family_id = my_family_id()) with check (family_id = my_family_id());
create policy kid_read_unlock_requests on unlock_requests for select
  using (kid_id = my_kid_id());
alter publication supabase_realtime add table unlock_requests;

-- ---------- lock state: the 15-minute pass slots UNDER grounding + criticals ----------
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
    ) then 'unlocked'
    else 'locked'
  end as state
from kids k;

-- ---------- kid asks (drained from shield taps; also callable from the app) ----------
create or replace function request_unlock(p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare kid uuid := my_kid_id(); fid uuid;
begin
  if kid is null then raise exception 'not allowed'; end if;
  if p_kind not in ('fifteen', 'inprogress') then raise exception 'bad kind'; end if;
  fid := kid_family_id(kid);
  if p_kind = 'fifteen' then
    -- One pending ask at a time; an hour of quiet after a denial.
    if exists (select 1 from unlock_requests where kid_id = kid and kind = 'fifteen'
               and (status = 'pending' or (status = 'denied' and resolved_at > now() - interval '1 hour'))) then
      return;
    end if;
  else
    -- "I'm doing it now" pings at most every 10 minutes.
    if exists (select 1 from unlock_requests where kid_id = kid and kind = 'inprogress'
               and created_at > now() - interval '10 minutes') then
      return;
    end if;
  end if;
  insert into unlock_requests (family_id, kid_id, kind, status)
  values (fid, kid, p_kind, case when p_kind = 'inprogress' then 'granted' else 'pending' end);
end $$;

-- ---------- parent grants or denies a fifteen ----------
create or replace function resolve_unlock_request(p_id uuid, p_grant boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r unlock_requests;
begin
  select * into r from unlock_requests where id = p_id and status = 'pending';
  if not found or r.family_id is distinct from my_family_id() then raise exception 'not allowed'; end if;
  update unlock_requests set status = case when p_grant then 'granted' else 'denied' end,
    resolved_at = now(), resolved_by = auth.uid() where id = p_id;
  if p_grant then
    update kids set unlock_until = now() + interval '15 minutes' where id = r.kid_id;
    perform private.notify_kids(array[r.kid_id], 'quarter');
  end if;
  perform private.notify_kids(array[r.kid_id], 'state');
end $$;

-- ---------- pass expiry: re-engage the shield the minute it lapses ----------
create or replace function private.expire_unlocks() returns void
language plpgsql security definer set search_path = public as $$
declare ks uuid[];
begin
  select array_agg(id) into ks from kids
  where unlock_until is not null and unlock_until <= now() and unlock_until > now() - interval '90 seconds';
  if ks is not null then perform private.notify_kids(ks, 'state'); end if;
end $$;
select cron.schedule('chorekey-unlock-expiry', '* * * * *', 'select private.expire_unlocks()');
