-- (applied via MCP 2026-08-25)
-- Community devices (shared PS5 / smart TV): owned by the family, not one kid.
-- They stay blocked until EVERY kid's required chores are approved.
alter table devices alter column kid_id drop not null;
alter table devices add column family_id uuid references families(id) on delete cascade;
alter table devices add constraint device_owner check (kid_id is not null or family_id is not null);

drop policy if exists parent_devices on devices;
create policy parent_devices on devices for all
  using (coalesce(kid_family_id(kid_id), family_id) = my_family_id())
  with check (coalesce(kid_family_id(kid_id), family_id) = my_family_id());

-- Agent-facing truth: is the whole family clear? (all kids unlocked)
create or replace view family_all_clear as
  select f.id as family_id, bool_and(kls.state = 'unlocked') as all_clear
  from families f join kid_lock_state kls on kls.family_id = f.id
  group by f.id;
