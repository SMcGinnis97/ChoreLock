-- ChoreLock schema. Apply with `supabase db push` or the MCP apply_migration tool.

create extension if not exists pgcrypto;

create type chore_status as enum ('todo','submitted','approved','rejected');
create type recurrence as enum ('daily','weekdays','custom');
create type lock_override as enum ('lock','unlock');
create type device_platform as enum ('ios','other');

create table families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  reset_time time not null default '00:00',
  auto_approve boolean not null default false,
  timezone text not null default 'America/Chicago',
  created_at timestamptz not null default now()
);

-- One row per adult login. auth.users -> parent.
create table parents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  display_name text
);

-- Kids do not get email logins; they join a device with a short code.
create table kids (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  age int,
  avatar_color text not null default '#5B5BD6',
  streak_days int not null default 0,
  override lock_override,           -- parent manual override for today
  override_date date,               -- override auto-clears at reset
  join_code text unique,            -- 6-char code typed on the kid's device
  created_at timestamptz not null default now()
);

create table chores (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  emoji text not null default '🧹',
  instruction text,
  recurrence recurrence not null default 'daily',
  days smallint[] not null default '{}',   -- 0=Sun..6=Sat when custom
  required boolean not null default true,  -- false = bonus
  photo_proof boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table chore_assignments (
  chore_id uuid references chores(id) on delete cascade,
  kid_id uuid references kids(id) on delete cascade,
  primary key (chore_id, kid_id)
);

-- Materialised per-day instances, generated at reset by the cron job.
create table chore_instances (
  id uuid primary key default gen_random_uuid(),
  chore_id uuid not null references chores(id) on delete cascade,
  kid_id uuid not null references kids(id) on delete cascade,
  date date not null,
  status chore_status not null default 'todo',
  attempt int not null default 1,
  photo_path text,                 -- storage object path in bucket "proofs"
  note text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  rejection_reason text,
  unique (chore_id, kid_id, date)
);

-- Kid devices. iOS installs self-register with a token; others are MAC rows for router control.
create table devices (
  id uuid primary key default gen_random_uuid(),
  kid_id uuid not null references kids(id) on delete cascade,
  name text not null,
  platform device_platform not null,
  identifier text not null,        -- ios: install id; other: MAC
  push_token text,                 -- APNs token for ios
  device_secret text,              -- bearer used by the kid device (no auth.users row)
  last_seen timestamptz,
  created_at timestamptz not null default now(),
  unique (kid_id, identifier)
);

-- Lock state as the single source of truth the device polls / is pushed.
create or replace view kid_lock_state as
select k.id as kid_id, k.family_id,
  case
    when k.override = 'unlock' and k.override_date = current_date then 'unlocked'
    when k.override = 'lock'   and k.override_date = current_date then 'locked'
    when not exists (
      select 1 from chore_instances ci join chores c on c.id = ci.chore_id
      where ci.kid_id = k.id and ci.date = current_date and c.required and ci.status <> 'approved'
    ) then 'unlocked'
    else 'locked'
  end as state
from kids k;

-- ---------- RLS ----------
alter table families enable row level security;
alter table parents enable row level security;
alter table kids enable row level security;
alter table chores enable row level security;
alter table chore_assignments enable row level security;
alter table chore_instances enable row level security;
alter table devices enable row level security;

create or replace function my_family_id() returns uuid language sql stable as
  $$ select family_id from parents where user_id = auth.uid() $$;

create policy parent_family on families for all using (id = my_family_id());
create policy parent_self on parents for all using (user_id = auth.uid());
create policy parent_kids on kids for all using (family_id = my_family_id());
create policy parent_chores on chores for all using (family_id = my_family_id());
create policy parent_assign on chore_assignments for all using (exists (select 1 from chores c where c.id = chore_id and c.family_id = my_family_id()));
create policy parent_instances on chore_instances for all using (exists (select 1 from kids k where k.id = kid_id and k.family_id = my_family_id()));
create policy parent_devices on devices for all using (exists (select 1 from kids k where k.id = kid_id and k.family_id = my_family_id()));

-- Kid devices talk through the `kid-api` edge function using device_secret
-- (service role inside the function), so no anon policies are needed.

-- ---------- Storage ----------
insert into storage.buckets (id, name, public) values ('proofs', 'proofs', false) on conflict do nothing;
create policy parent_read_proofs on storage.objects for select using (
  bucket_id = 'proofs' and (storage.foldername(name))[1] = my_family_id()::text
);
