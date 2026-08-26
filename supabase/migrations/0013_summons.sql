-- (applied via MCP 2026-08-26)
-- Summons: a parent calls one kid (or everyone — a family meeting) to a location.
-- The kid's devices get a time-sensitive alert push that REPEATS every 30 seconds
-- until the kid taps "On my way!" in the app, the parent cancels, or it expires
-- (15 minutes). True bypass-silent-switch sound needs Apple's Critical Alerts
-- entitlement; the payload upgrade lives in notify-kid behind APNS_CRITICAL.

create table summons (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  kid_id uuid not null references kids(id) on delete cascade,
  location text not null,
  note text,
  meeting boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  acknowledged_at timestamptz,
  canceled_at timestamptz
);
alter table summons enable row level security;
create policy parent_summons on summons for all using (family_id = my_family_id()) with check (family_id = my_family_id());
create policy kid_read_summons on summons for select using (kid_id = my_kid_id());
alter publication supabase_realtime add table summons;

-- Parent calls kids: supersede any active summons for them, insert, ding immediately.
create or replace function call_kids(p_kids uuid[], p_location text, p_note text default null, p_meeting boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare fid uuid := my_family_id(); v_title text;
begin
  if fid is null then raise exception 'not allowed'; end if;
  if p_kids is null or cardinality(p_kids) = 0 or p_location is null or length(trim(p_location)) = 0 then raise exception 'bad call'; end if;
  if exists (select 1 from kids where id = any(p_kids) and family_id is distinct from fid) then raise exception 'not allowed'; end if;
  update summons set canceled_at = now()
    where kid_id = any(p_kids) and acknowledged_at is null and canceled_at is null and expires_at > now();
  insert into summons (family_id, kid_id, location, note, meeting, created_by)
    select fid, k, trim(p_location), nullif(trim(coalesce(p_note, '')), ''), p_meeting, auth.uid() from unnest(p_kids) k;
  v_title := case when p_meeting then 'Family meeting — ' else 'Come to the ' end || trim(p_location);
  perform private.notify_kids(p_kids, 'summon', v_title, p_note);
end $$;

-- Kid taps "On my way!" — stops the dings.
create or replace function ack_summon(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update summons set acknowledged_at = now()
    where id = p_id and kid_id = my_kid_id() and acknowledged_at is null and canceled_at is null;
end $$;

-- Re-ding every 30 seconds while a summon is live.
create or replace function private.ping_summons() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select s.kid_id, s.location, s.note, s.meeting from summons s
    where s.acknowledged_at is null and s.canceled_at is null and s.expires_at > now()
  loop
    perform private.notify_kids(array[r.kid_id], 'summon',
      case when r.meeting then 'Family meeting — ' else 'Come to the ' end || r.location, r.note);
  end loop;
end $$;
select cron.schedule('chorekey-summon-ping', '30 seconds', 'select private.ping_summons()');
