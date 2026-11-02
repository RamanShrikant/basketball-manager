-- Basketball Manager Online Phase 2A (read-only shared franchise bootstrapping).
-- APPLY AFTER bm_online_social_lobbies_v1.sql. Does not touch single-player tables.
-- A franchise holds exactly one immutable starting NBA universe, and a frozen mapping
-- of all human GMs to their selected teams. Future gameplay uses new revisioned RPCs.
begin;

alter table public.bm_online_lobbies drop constraint if exists bm_online_lobbies_status_check;
alter table public.bm_online_lobbies add constraint bm_online_lobbies_status_check
  check (status in ('waiting','closed','started'));

create table if not exists public.bm_online_franchises (
  lobby_id uuid primary key references public.bm_online_lobbies(id) on delete restrict,
  host_id uuid not null references auth.users(id),
  roster_kind text not null check (roster_kind in ('default','custom')),
  seed_state jsonb not null,
  schema_version integer not null default 1 check (schema_version=1),
  revision bigint not null default 1 check (revision=1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bm_online_franchises enable row level security;
revoke all on public.bm_online_franchises from public, anon, authenticated;
grant select on public.bm_online_franchises to authenticated;
drop policy if exists bm_franchises_member_read on public.bm_online_franchises;
create policy bm_franchises_member_read on public.bm_online_franchises
  for select to authenticated using (public.bm_is_online_lobby_member(lobby_id));

-- Launch is serialized on the lobby row, the same lock used by join/team/ready RPCs.
-- The seed is immutable: no browser can write it after launch (not even the host).
create or replace function public.bm_launch_online_franchise(p_lobby uuid, p_seed jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_lobby public.bm_online_lobbies;
  v_count integer;
  v_assigned integer;
  v_names text[];
  v_seed_teams jsonb;
  v_total integer;
begin
  if auth.uid() is null then raise exception 'Sign in first';end if;
  select * into v_lobby from public.bm_online_lobbies where id=p_lobby for update;
  if not found then raise exception 'Lobby not found';end if;
  if v_lobby.host_id<>auth.uid() then raise exception 'Only the host can start the franchise';end if;
  if v_lobby.status='started' and exists(select 1 from public.bm_online_franchises where lobby_id=p_lobby) then
    return p_lobby; -- A retry cannot create a second universe.
  end if;
  if v_lobby.status<>'waiting' then raise exception 'Lobby is not waiting';end if;
  select count(*),count(*) filter (where ready and team_name is not null)
    into v_count,v_assigned from public.bm_online_lobby_members where lobby_id=p_lobby;
  if v_count<2 or v_count>4 or v_count<>v_assigned then
    raise exception 'All 2–4 players must choose a team and ready up';
  end if;
  if jsonb_typeof(p_seed)<>'object' then raise exception 'Invalid franchise JSON';end if;
  if octet_length(p_seed::text)>12000000 then raise exception 'Franchise seed exceeds 12 MB limit';end if;
  if jsonb_typeof(p_seed->'teams')='array' then
    v_seed_teams:=p_seed->'teams';
  elsif jsonb_typeof(p_seed#>'{conferences,East}')='array' and jsonb_typeof(p_seed#>'{conferences,West}')='array' then
    v_seed_teams:=(p_seed#>'{conferences,East}')||(p_seed#>'{conferences,West}');
  else raise exception 'Franchise seed has no teams or East/West conferences';end if;
  v_total:=jsonb_array_length(v_seed_teams);
  if v_total<>cardinality(v_lobby.team_names) then raise exception 'Roster differs from the lobby team list';end if;
  if exists(select 1 from jsonb_array_elements(v_seed_teams) x
    where jsonb_typeof(x)<>'object' or jsonb_typeof(x->'name')<>'string' or
       length(btrim(x->>'name'))<2 or length(btrim(x->>'name'))>80) then
    raise exception 'Franchise has invalid teams';end if;
  select array_agg(name order by name) into v_names from
    (select btrim(x->>'name') name from jsonb_array_elements(v_seed_teams) x) a;
  if v_names is distinct from (select array_agg(name order by name) from unnest(v_lobby.team_names) name) then
    raise exception 'Franchise seed team names must match lobby selection';end if;
  if exists (select 1 from public.bm_online_lobby_members m
    where m.lobby_id=p_lobby and not m.team_name=any(v_names)) then
    raise exception 'Selected human team is missing';end if;
  insert into public.bm_online_franchises(lobby_id,host_id,roster_kind,seed_state)
    values (p_lobby,auth.uid(),v_lobby.roster_kind,p_seed);
  update public.bm_online_lobbies set status='started',updated_at=now() where id=p_lobby;
  update public.bm_online_lobby_invites set status='cancelled',updated_at=now()
    where lobby_id=p_lobby and status='pending';
  return p_lobby;
end $$;
revoke all on function public.bm_launch_online_franchise(uuid,jsonb) from public, anon;
grant execute on function public.bm_launch_online_franchise(uuid,jsonb) to authenticated;

-- Once launched, no player can remove their membership (which would orphan access),
-- nor can a host accidentally close the persistent shared franchise.
create or replace function public.bm_leave_online_lobby(p_lobby uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_host uuid; v_status text;
begin
  select host_id,status into v_host,v_status from public.bm_online_lobbies where id=p_lobby for update;
  if not found then raise exception 'Lobby not found';end if;
  if v_status='started' then raise exception 'Started franchises remain saved. Use Online Home to continue.';end if;
  if v_host=auth.uid() then
    update public.bm_online_lobbies set status='closed',updated_at=now() where id=p_lobby;
    update public.bm_online_lobby_invites set status='cancelled',updated_at=now() where lobby_id=p_lobby and status='pending';
  else
    delete from public.bm_online_lobby_members where lobby_id=p_lobby and user_id=auth.uid();
  end if;
end $$;
revoke all on function public.bm_leave_online_lobby(uuid) from public, anon;
grant execute on function public.bm_leave_online_lobby(uuid) to authenticated;

commit;
