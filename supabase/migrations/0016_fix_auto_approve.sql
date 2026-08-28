-- Auto-approve broke kid submissions entirely: as a BEFORE UPDATE trigger it
-- flipped status to 'approved' inside the kid's own UPDATE, so the final row
-- failed the kid_submit WITH CHECK (status = 'submitted') and Postgres rejected
-- the whole write - photo uploaded, row stayed 'todo', and the client swallowed
-- the error. Re-done as an AFTER trigger: the kid's write lands as 'submitted',
-- then this definer-owned function approves it in a second UPDATE that bypasses
-- RLS. (Re-firing on that second update is a no-op: status is no longer
-- transitioning to 'submitted'.)

drop trigger auto_approve on chore_instances;

create or replace function private.auto_approve_submission() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'submitted' and old.status is distinct from 'submitted' and new.attempt = 1
     and (select f.auto_approve from families f join kids k on k.family_id = f.id where k.id = new.kid_id) then
    update chore_instances set status = 'approved', reviewed_at = now() where id = new.id;
  end if;
  return null;
end $$;

create trigger auto_approve after update on chore_instances
  for each row execute function private.auto_approve_submission();
