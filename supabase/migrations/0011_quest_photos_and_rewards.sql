-- (applied via MCP 2026-08-25)
-- Side quests: multiple prompt photos.
alter table side_quests add column prompt_paths text[] not null default '{}';
update side_quests set prompt_paths = array[prompt_path] where prompt_path is not null;

-- Rewards catalog: spend earned quest points on parent-defined rewards.
create table rewards (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  title text not null,
  emoji text not null default '🎁',
  points int not null,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create table reward_claims (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references rewards(id) on delete cascade,
  kid_id uuid not null references kids(id) on delete cascade,
  status text not null default 'requested' check (status in ('requested','granted','denied')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table rewards enable row level security;
alter table reward_claims enable row level security;
create policy parent_rewards on rewards for all
  using (family_id = my_family_id()) with check (family_id = my_family_id());
create policy kid_read_rewards on rewards for select
  using (family_id = kid_family_id(my_kid_id()));
create policy parent_claims on reward_claims for all
  using (kid_family_id(kid_id) = my_family_id()) with check (kid_family_id(kid_id) = my_family_id());
create policy kid_own_claims on reward_claims for select using (kid_id = my_kid_id());
create policy kid_request_claims on reward_claims for insert
  with check (kid_id = my_kid_id() and status = 'requested');
alter publication supabase_realtime add table rewards, reward_claims;

-- Points = earned (approved quests) minus spent (granted rewards).
create or replace view kid_points as
  select k.id as kid_id,
    (coalesce((select sum(q.points) from side_quests q where q.kid_id = k.id and q.status = 'approved'), 0)
   - coalesce((select sum(r.points) from reward_claims rc join rewards r on r.id = rc.reward_id
               where rc.kid_id = k.id and rc.status = 'granted'), 0))::int as points
  from kids k;
