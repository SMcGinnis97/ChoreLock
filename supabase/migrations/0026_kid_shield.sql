-- kid_shield(kid): the lock state and shield copy for one kid, as JSON, so a push can
-- carry it and the DEVICE can apply the shield natively the moment the push lands —
-- no JS wake needed. Observed 2026-09-11: grounding / rejecting produced the alert on
-- the iPad but the shield stayed down until the app was opened (the web view doesn't
-- reliably run on a background push). The notification service extension and the app
-- delegate now both read this payload and drive ManagedSettings directly.
--
-- Copy mirrors buildShieldContent() in src/lib/store.tsx (minus the streak flourish).
-- Called with the service role from the notify-kid edge function.

create or replace function kid_shield(p_kid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  k kids; f families; lt timestamp; st text;
  v_state text; v_title text; v_sub text; v_allow boolean := true;
  crit record; remaining int; nxt text; ev date; we time;
begin
  select * into k from kids where id = p_kid;
  if not found then return null; end if;
  select * into f from families where id = k.family_id;
  lt := now() at time zone coalesce(f.timezone, 'UTC');
  select state into st from kid_lock_state where kid_id = p_kid;

  -- "Ask for 15 minutes" is hidden for an hour after a parent says no.
  v_allow := not exists (
    select 1 from unlock_requests r
    where r.kid_id = p_kid and r.kind = 'fifteen' and r.status = 'denied'
      and r.resolved_at is not null and r.resolved_at > now() - interval '1 hour');

  if k.grounded_until is not null and k.grounded_until > now() then
    v_state := 'grounded';
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
      v_state := 'critical';
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
      else
        select count(*), min(c.name) filter (where ci.status in ('todo', 'rejected')) into remaining, nxt
        from chore_instances ci join chores c on c.id = ci.chore_id
        where ci.kid_id = p_kid and ci.date = family_today(k.family_id) and c.required and ci.status <> 'approved';
        v_state := 'chores';
        v_title := greatest(remaining, 1) || ' to go, ' || k.name || ' 🔑';
        v_sub := 'Next up: ' || left(coalesce(nxt, 'your chores'), 34) || '.';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'state', coalesce(st, 'locked'),
    'shield', jsonb_build_object('state', v_state, 'title', v_title, 'subtitle', v_sub, 'allowRequest', v_allow));
end $$;

revoke execute on function kid_shield(uuid) from public, anon, authenticated;
grant execute on function kid_shield(uuid) to service_role;
