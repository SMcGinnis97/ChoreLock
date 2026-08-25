-- (applied via MCP 2026-08-25)
-- Parents can see who else has parent access. parent_self RLS hides other parents' rows,
-- so expose them through a definer view (also joins auth.users for the email).
create or replace view family_parents as
  select p.user_id, p.family_id, p.display_name, u.email
  from parents p join auth.users u on u.id = p.user_id
  where p.family_id = my_family_id();
