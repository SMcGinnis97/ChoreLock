-- Manual "Lock now" also sends a VISIBLE push (mirror of 0023's unlock alert):
-- alert pushes are delivered with high priority and their content-available flag
-- wakes the app to raise the shield; the silent-only 'state' push proved
-- throttleable. Kids also simply deserve to see "a parent locked you" rather
-- than discover it mid-stream. Other transitions (clearing an override, absence
-- changes) stay silent.

create or replace function private.on_kid_override() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.override is distinct from old.override or new.override_date is distinct from old.override_date
     or new.absent_until is distinct from old.absent_until then
    if new.override = 'unlock' and old.override is distinct from 'unlock' then
      perform private.notify_kids(array[new.id], 'quest', '🔓 You’re unlocked',
        'A parent switched your Wi-Fi on. Enjoy!');
    elsif new.override = 'lock' and old.override is distinct from 'lock' then
      perform private.notify_kids(array[new.id], 'quest', '🔒 You’re locked',
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
  return new;
end $$;
