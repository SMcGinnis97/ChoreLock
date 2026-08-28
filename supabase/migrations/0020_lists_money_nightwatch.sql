-- Shared "We need" list, allowance/money, and night-watch storage.
-- Lists: any family member adds items ("we need milk"); anyone checks them off.
-- Money: streak milestones pay $X every N consecutive completed days (hourly cron,
--   ref-deduped); side quests can carry cents that pay out on approval; parents
--   record payouts/adjustments. Balance = sum(cents) client-side.
-- Night watch: parent-set night window; the kid device's DeviceActivityMonitor
--   records anonymous threshold events ("watched apps used >= N min in the window",
--   "first screen use after wake time") which the app syncs into night_events.

create table list_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  text text not null,
  added_by_kid uuid references kids(id) on delete set null,
  added_by_parent uuid,
  done_at timestamptz,
  done_by uuid,
  created_at timestamptz not null default now()
);
alter table list_items enable row level security;
create policy parent_list_items on list_items for all
  using (family_id = my_family_id()) with check (family_id = my_family_id());
create policy kid_read_list_items on list_items for select
  using (family_id = kid_family_id(my_kid_id()));
create policy kid_add_list_items on list_items for insert
  with check (family_id = kid_family_id(my_kid_id()) and added_by_kid = my_kid_id());
create policy kid_check_list_items on list_items for update
  using (family_id = kid_family_id(my_kid_id())) with check (family_id = kid_family_id(my_kid_id()));
alter publication supabase_realtime add table list_items;

alter table families add column streak_reward_days int, add column streak_reward_cents int;
alter table side_quests add column cents int;

create table money_ledger (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  kid_id uuid not null references kids(id) on delete cascade,
  cents int not null,
  kind text not null check (kind in ('streak', 'quest', 'payout', 'adjust')),
  note text,
  ref text,
  created_at timestamptz not null default now()
);
create unique index money_ledger_dedupe on money_ledger (kid_id, ref) where ref is not null;
alter table money_ledger enable row level security;
create policy parent_money on money_ledger for all
  using (family_id = my_family_id()) with check (family_id = my_family_id());
create policy kid_read_money on money_ledger for select using (kid_id = my_kid_id());
alter publication supabase_realtime add table money_ledger;

create or replace function private.on_quest_approved_money() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved'
     and coalesce(new.cents, 0) > 0 and new.kid_id is not null then
    insert into money_ledger (family_id, kid_id, cents, kind, note, ref)
    values (new.family_id, new.kid_id, new.cents, 'quest', new.title, 'quest-' || new.id)
    on conflict (kid_id, ref) where ref is not null do nothing;
    if found then
      perform private.notify_kids(array[new.kid_id], 'money', new.title,
        '$' || to_char(new.cents / 100.0, 'FM999990.00') || ' added to your stash.');
    end if;
  end if;
  return null;
end $$;
create trigger quest_money after update on side_quests
  for each row execute function private.on_quest_approved_money();

create or replace function private.award_streaks() returns void
language plpgsql security definer set search_path = public as $$
declare r record; s int;
begin
  for r in
    select k.id, k.family_id, f.streak_reward_days as d, f.streak_reward_cents as c
    from kids k join families f on f.id = k.family_id
    where coalesce(f.streak_reward_days, 0) > 0 and coalesce(f.streak_reward_cents, 0) > 0
  loop
    s := kid_streak(r.id);
    if s > 0 and s % r.d = 0 then
      insert into money_ledger (family_id, kid_id, cents, kind, note, ref)
      values (r.family_id, r.id, r.c, 'streak', s || '-day streak bonus',
              'streak-' || s || '-' || family_today(r.family_id))
      on conflict (kid_id, ref) where ref is not null do nothing;
      if found then
        perform private.notify_kids(array[r.id], 'money', s || '-day streak! 🔥',
          '$' || to_char(r.c / 100.0, 'FM999990.00') || ' streak bonus — keep it rolling.');
      end if;
    end if;
  end loop;
end $$;
select cron.schedule('chorekey-streak-awards', '7 * * * *', 'select private.award_streaks()');

create or replace function record_money(p_kid uuid, p_cents int, p_kind text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare fid uuid := my_family_id();
begin
  if (select family_id from kids where id = p_kid) is distinct from fid then raise exception 'not allowed'; end if;
  if p_kind not in ('payout', 'adjust') or p_cents = 0 then raise exception 'bad entry'; end if;
  insert into money_ledger (family_id, kid_id, cents, kind, note) values (fid, p_kid, p_cents, p_kind, p_note);
end $$;

alter table families add column night_start time, add column night_end time,
  add column night_threshold_min int not null default 15;

create table night_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  kid_id uuid not null references kids(id) on delete cascade,
  kind text not null check (kind in ('night', 'wake')),
  at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (kid_id, kind, at)
);
alter table night_events enable row level security;
create policy parent_night_events on night_events for all
  using (family_id = my_family_id()) with check (family_id = my_family_id());
create policy kid_night_events on night_events for select using (kid_id = my_kid_id());
create policy kid_add_night_events on night_events for insert
  with check (kid_id = my_kid_id() and family_id = kid_family_id(my_kid_id()));

-- Kid devices report night-watch flags through this (kid sessions don't know their
-- family id, and the unique constraint makes re-sends harmless).
create or replace function record_night_event(p_kind text, p_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare kid uuid := my_kid_id();
begin
  if kid is null then raise exception 'not allowed'; end if;
  if p_kind not in ('night', 'wake') then raise exception 'bad kind'; end if;
  insert into night_events (family_id, kid_id, kind, at)
  values (kid_family_id(kid), kid, p_kind, p_at)
  on conflict (kid_id, kind, at) do nothing;
end $$;

-- Add a "we need" item as either role (kid sessions don't know their family id).
create or replace function add_list_item(p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare kid uuid := my_kid_id(); fid uuid := my_family_id(); t text := trim(coalesce(p_text, ''));
begin
  if length(t) = 0 or length(t) > 120 then raise exception 'bad item'; end if;
  if fid is not null then
    insert into list_items (family_id, text, added_by_parent) values (fid, t, auth.uid());
  elsif kid is not null then
    insert into list_items (family_id, text, added_by_kid) values (kid_family_id(kid), t, kid);
  else
    raise exception 'not allowed';
  end if;
end $$;
