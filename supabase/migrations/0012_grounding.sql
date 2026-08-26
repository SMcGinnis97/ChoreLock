-- (applied via MCP 2026-08-26)
-- Grounding: a parent locks a kid down for a reason, regardless of chores.
-- The kid gets an alert push with the reason; grounding trumps absence and
-- unlock overrides in lock state. Auto-expires (cron) with an "ungrounded" push.

alter table kids
  add column grounded_until timestamptz,
  add column grounded_reason text;

-- Grounding wins over everything else.
create or replace view kid_lock_state as
select k.id as kid_id, k.family_id,
  case
    when k.grounded_until is not null and k.grounded_until > now() then 'locked'
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

-- Parent-only: ground (until + reason) or lift (null, null).
create or replace function set_grounding(p_kid uuid, p_until timestamptz, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select family_id from kids where id = p_kid) is distinct from my_family_id() then raise exception 'not allowed'; end if;
  update kids set
    grounded_until = p_until,
    grounded_reason = case when p_until is null then null else p_reason end
  where id = p_kid;
end $$;

-- Kid-state change pushes: silent 'state' for overrides/absence (unchanged), plus
-- alert pushes when grounding starts ('grounded', carries the reason) or ends ('ungrounded').
create or replace function private.on_kid_override() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.override is distinct from old.override or new.override_date is distinct from old.override_date
     or new.absent_until is distinct from old.absent_until then
    perform private.notify_kids(array[new.id], 'state');
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
  return new;
end $$;

-- Expired groundings: clear the columns (the trigger then sends 'ungrounded').
create or replace function private.expire_groundings() returns void
language plpgsql security definer set search_path = public as $$
begin
  update kids set grounded_until = null, grounded_reason = null
  where grounded_until is not null and grounded_until <= now();
end $$;
select cron.schedule('chorekey-grounding-expiry', '*/5 * * * *', 'select private.expire_groundings()');
