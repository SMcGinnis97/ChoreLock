-- Bedtime push fixes from the 2026-09-11 field test.
--
-- 1. The goodnight push was keyed on the evening alone, so a window that CHANGED
--    after that evening's push (parent edits the time; the picker ticks through
--    intermediate values) never fired again that night. Key on (evening, start).
-- 2. The end-of-window nudge was a silent 'state' push — the throttleable kind —
--    but it is what lifts the shield when the device never registered its native
--    schedule. Make it a visible, soundless 'morning' alert so the service
--    extension runs and applies the unlocked state on arrival.

alter table kids
  add column bed_notified_start time,
  add column bed_end_notified_start time;

create or replace function private.run_bedtimes() returns void
language plpgsql security definer set search_path = public as $$
declare r kids; ev date; ws time; we time;
begin
  for r in select * from kids where bed_start is not null and bed_end is not null loop
    ev := bedtime_evening(r);
    if ev is not null then
      select w.w_start, w.w_end into ws, we from bedtime_window(r, ev) w;
      if r.bed_notified_evening is distinct from ev or r.bed_notified_start is distinct from ws then
        if r.absent_until is null or r.absent_until < family_today(r.family_id) then
          perform private.notify_kids(array[r.id], 'lockstate', '🌙 Goodnight, ' || r.name,
            'Screens are off until ' || to_char(we, 'FMHH12:MI AM') || '. See you in the morning.');
        end if;
        update kids set bed_notified_evening = ev, bed_notified_start = ws where id = r.id;
      end if;
    elsif r.bed_notified_evening is not null
      and (r.bed_end_notified_evening is distinct from r.bed_notified_evening
        or r.bed_end_notified_start is distinct from r.bed_notified_start) then
      -- Window closed (or bedtime switched off): visible so the device reliably reconciles.
      perform private.notify_kids(array[r.id], 'morning', '☀️ Morning, ' || r.name,
        'Screens are back. Chores still count today.');
      update kids set bed_end_notified_evening = r.bed_notified_evening, bed_end_notified_start = r.bed_notified_start where id = r.id;
    end if;
  end loop;
end $$;
