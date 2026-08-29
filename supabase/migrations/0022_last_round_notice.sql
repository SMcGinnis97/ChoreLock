-- "Last round of the day" notice: when completing a critical round books the next
-- fire on a LATER local day (the repeat landed past window_end, or it's a
-- once-a-day task), tell the kid so the silence is explained ("done for today —
-- next fires tomorrow at 10:00 AM") instead of a round quietly never coming.
-- Everything else in complete_critical is unchanged from 0015/0019.

create or replace function complete_critical(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inst critical_instances; t critical_tasks; kid uuid := my_kid_id();
        tz text; v_next timestamptz;
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
      update critical_tasks set next_fire_at = private.critical_next_fire(t, now()) where id = t.id
        returning next_fire_at into v_next;
      select timezone into tz from families where id = t.family_id;
      if t.repeat_minutes is not null and v_next is not null
         and (v_next at time zone tz)::date > (now() at time zone tz)::date then
        perform private.notify_kids(array[inst.kid_id], 'quest',
          t.emoji || ' ' || t.title || ' — done for today',
          'The next round would land past the daily cutoff, so it fires tomorrow at '
            || trim(to_char(v_next at time zone tz, 'FMHH12:MI AM')) || '.');
      end if;
    end if;
  end if;
end $$;
