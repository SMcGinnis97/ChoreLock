-- (applied via MCP 2026-08-25)
-- Kid devices prove a parent is present by typing the family's parent code.
-- Kids cannot select from parent_invites (RLS), so this definer fn only confirms a match
-- within the caller's own family — it never reveals the code.
create or replace function verify_parent_code(code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from parent_invites pi
    where pi.family_id = coalesce(my_family_id(), kid_family_id(my_kid_id()))
      and pi.code = upper(trim(verify_parent_code.code))
  )
$$;
