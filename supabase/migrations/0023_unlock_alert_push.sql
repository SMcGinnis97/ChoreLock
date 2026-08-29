-- Manual "Unlock now" sends a VISIBLE push, not just a silent one. Observed
-- 2026-08-29 ~00:45: parent unlocked Dawson, server flipped to unlocked, but the
-- silent 'state' push was throttled (iOS deprioritizes background pushes at
-- night) and the shield stayed up until the app was opened. Alert pushes are
-- high-priority and reliably delivered (every critical alert landed the same
-- night), and their content-available flag also wakes the app to drop the
-- shield — same pattern the 15-minute pass ('quarter') already uses.
-- Everything else in the trigger is unchanged from 0012.

create or replace function private.on_kid_override() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.override is distinct from old.override or new.override_date is distinct from old.override_date
     or new.absent_until is distinct from old.absent_until then
    if new.override = 'unlock' and old.override is distinct from 'unlock' then
      perform private.notify_kids(array[new.id], 'lockstate', '🔓 You’re unlocked',
        'A parent switched your Wi-Fi on. Enjoy!');
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
  return new;
end $$;
