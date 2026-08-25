-- Second-parent support (applied via MCP 2026-08-25): a family-wide parent invite code.
-- Kept in its own table (not a families column) so kid RLS on families can't leak it —
-- a kid who learned the code could join as a parent.

create table parent_invites (
  family_id uuid primary key references families(id) on delete cascade,
  code text unique not null default gen_join_code()
);
alter table parent_invites enable row level security;
create policy parent_invites_own on parent_invites for all
  using (family_id = my_family_id()) with check (family_id = my_family_id());

insert into parent_invites(family_id) select id from families on conflict do nothing;

create or replace function private.on_family_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into parent_invites(family_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger family_invite after insert on families
  for each row execute function private.on_family_created();

create or replace function join_as_parent(code text, parent_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'Create a parent account (email or Apple) before joining';
  end if;
  select family_id into fid from parent_invites pi where pi.code = upper(trim(join_as_parent.code));
  if fid is null then raise exception 'Invalid parent code'; end if;
  insert into parents(user_id, family_id, display_name) values (auth.uid(), fid, parent_name)
    on conflict (user_id) do update set family_id = excluded.family_id,
      display_name = coalesce(excluded.display_name, parents.display_name);
  return fid;
end $$;
