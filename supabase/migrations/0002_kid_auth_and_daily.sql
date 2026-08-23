-- Applied to project 2026-08-23 via MCP (migrations: kid_auth_and_daily, fix_policy_recursion, harden_functions,
-- restore_helper_grants, revoke_public_execute). Consolidated here for reference / fresh environments.

create table kid_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  kid_id uuid not null references kids(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table kid_users enable row level security;

create or replace function my_kid_id() returns uuid language sql stable security definer set search_path = public as
  $$ select kid_id from kid_users where user_id = auth.uid() $$;
create or replace function my_kid_chore_ids() returns setof uuid language sql stable security definer set search_path = public as
  $$ select chore_id from chore_assignments where kid_id = my_kid_id() $$;
create or replace function chore_family_id(cid uuid) returns uuid language sql stable security definer set search_path = public as
  $$ select family_id from chores where id = cid $$;
create or replace function kid_family_id(kid uuid) returns uuid language sql stable security definer set search_path = public as
  $$ select family_id from kids where id = kid $$;
create or replace function gen_join_code() returns text language sql volatile set search_path = public, extensions as
  $$ select upper(substr(replace(replace(encode(gen_random_bytes(6),'base64'),'/',''),'+',''),1,6)) $$;
alter table kids alter column join_code set default gen_join_code();

create or replace function join_as_kid(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare kid uuid;
begin
  select id into kid from kids where join_code = upper(trim(code));
  if kid is null then raise exception 'Invalid join code'; end if;
  insert into kid_users(user_id, kid_id) values (auth.uid(), kid)
    on conflict (user_id) do update set kid_id = excluded.kid_id;
  return kid;
end $$;

-- Policies (parent ones replace the 0001 versions to avoid cross-table recursion)
create policy kid_self on kid_users for select using (user_id = auth.uid());
create policy parent_kid_users on kid_users for select using (kid_family_id(kid_id) = my_family_id());
create policy kid_read_self on kids for select using (id = my_kid_id());
create policy kid_read_family on families for select using (id = kid_family_id(my_kid_id()));
create policy kid_read_chores on chores for select using (id in (select my_kid_chore_ids()));
create policy kid_read_assign on chore_assignments for select using (kid_id = my_kid_id());
create policy kid_read_instances on chore_instances for select using (kid_id = my_kid_id());
create policy kid_submit on chore_instances for update using (kid_id = my_kid_id()) with check (kid_id = my_kid_id() and status = 'submitted');
create policy kid_devices on devices for all using (kid_id = my_kid_id()) with check (kid_id = my_kid_id());
create policy kid_upload_proofs on storage.objects for insert with check (bucket_id = 'proofs' and (storage.foldername(name))[2] = my_kid_id()::text);
create policy kid_read_proofs on storage.objects for select using (bucket_id = 'proofs' and (storage.foldername(name))[2] = my_kid_id()::text);

drop policy if exists parent_assign on chore_assignments;
create policy parent_assign on chore_assignments for all using (chore_family_id(chore_id) = my_family_id()) with check (chore_family_id(chore_id) = my_family_id());
drop policy if exists parent_instances on chore_instances;
create policy parent_instances on chore_instances for all using (kid_family_id(kid_id) = my_family_id()) with check (kid_family_id(kid_id) = my_family_id());
drop policy if exists parent_devices on devices;
create policy parent_devices on devices for all using (kid_family_id(kid_id) = my_family_id()) with check (kid_family_id(kid_id) = my_family_id());

create or replace function family_today(fid uuid) returns date language sql stable set search_path = public as
  $$ select (now() at time zone coalesce((select timezone from families where id = fid),'UTC'))::date $$;

create or replace function ensure_today(p_kid uuid) returns date
language plpgsql security definer set search_path = public as $$
declare fid uuid; d date; dow int;
begin
  select family_id into fid from kids where id = p_kid;
  if fid is null or (my_family_id() is distinct from fid and my_kid_id() is distinct from p_kid) then raise exception 'not allowed'; end if;
  d := family_today(fid); dow := extract(dow from d);
  insert into chore_instances(chore_id, kid_id, date)
  select c.id, p_kid, d from chores c join chore_assignments a on a.chore_id = c.id
  where a.kid_id = p_kid and not c.archived and (
    c.recurrence = 'daily' or (c.recurrence = 'weekdays' and dow between 1 and 5) or (c.recurrence = 'custom' and dow = any(c.days)))
  on conflict do nothing;
  update kids set override = null, override_date = null where id = p_kid and override_date is not null and override_date < d;
  return d;
end $$;

create or replace function kid_streak(p_kid uuid) returns int language sql stable security definer set search_path = public as $$
  with days as (
    select ci.date, bool_and(ci.status = 'approved') as ok
    from chore_instances ci join chores c on c.id = ci.chore_id
    where ci.kid_id = p_kid and c.required group by ci.date
  ), ranked as (
    select date, ok, row_number() over (order by date desc) as rn from days where date <= family_today((select family_id from kids where id = p_kid))
  ), run as (
    select rn from ranked r where ok and not exists (select 1 from ranked r2 where r2.rn < r.rn and not r2.ok)
  )
  select count(*)::int from run
$$;

create or replace function set_override(p_kid uuid, mode lock_override) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select family_id from kids where id = p_kid) is distinct from my_family_id() then raise exception 'not allowed'; end if;
  update kids set override = mode, override_date = case when mode is null then null else family_today(family_id) end where id = p_kid;
end $$;

alter publication supabase_realtime add table chore_instances, kids;

-- Hardening: no function is callable without a session.
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public;
grant execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public grant execute on functions to authenticated, service_role;

-- ---- 0003 (applied 2026-08-23 as push_and_reset) ----
-- pg_net + pg_cron; private.config(functions_url, service_role_key); private.notify_kids() -> edge fn notify-kid;
-- triggers on chore_instances (approved/rejected) and kids (override) ; families.last_reset_date;
-- private.run_resets() scheduled every 5 min as 'chorelock-daily-reset'. See supabase/functions/notify-kid.
