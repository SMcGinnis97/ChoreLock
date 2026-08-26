-- (applied via MCP 2026-08-26)
-- Communication notifications: summon pushes carry the calling parent's name so the
-- Notification Service Extension can render them as a message *from that parent*.

create or replace function private.notify_kids(p_kids uuid[], p_kind text, p_chore text default null, p_reason text default null, p_sender text default null) returns void
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_url text; v_key text;
begin
  select c.value into v_url from private.config c where c.key = 'functions_url';
  select c.value into v_key from private.config c where c.key = 'service_role_key';
  if v_url is null or v_key is null or p_kids is null or cardinality(p_kids) = 0 then return; end if;
  perform net.http_post(
    url := v_url || '/notify-kid',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body := jsonb_build_object('kid_ids', to_jsonb(p_kids), 'kind', p_kind, 'chore', p_chore, 'reason', p_reason, 'sender', p_sender)
  );
end $$;

create or replace function call_kids(p_kids uuid[], p_location text, p_note text default null, p_meeting boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare fid uuid := my_family_id(); v_title text; v_sender text;
begin
  if fid is null then raise exception 'not allowed'; end if;
  if p_kids is null or cardinality(p_kids) = 0 or p_location is null or length(trim(p_location)) = 0 then raise exception 'bad call'; end if;
  if exists (select 1 from kids where id = any(p_kids) and family_id is distinct from fid) then raise exception 'not allowed'; end if;
  update summons set canceled_at = now()
    where kid_id = any(p_kids) and acknowledged_at is null and canceled_at is null and expires_at > now();
  insert into summons (family_id, kid_id, location, note, meeting, created_by)
    select fid, k, trim(p_location), nullif(trim(coalesce(p_note, '')), ''), p_meeting, auth.uid() from unnest(p_kids) k;
  v_title := case when p_meeting then 'Family meeting — ' else 'Come to the ' end || trim(p_location);
  select display_name into v_sender from parents where user_id = auth.uid();
  perform private.notify_kids(p_kids, 'summon', v_title, p_note, v_sender);
end $$;

create or replace function private.ping_summons() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select s.kid_id, s.location, s.note, s.meeting, p.display_name as sender
    from summons s left join parents p on p.user_id = s.created_by
    where s.acknowledged_at is null and s.canceled_at is null and s.expires_at > now()
  loop
    perform private.notify_kids(array[r.kid_id], 'summon',
      case when r.meeting then 'Family meeting — ' else 'Come to the ' end || r.location, r.note, r.sender);
  end loop;
end $$;
