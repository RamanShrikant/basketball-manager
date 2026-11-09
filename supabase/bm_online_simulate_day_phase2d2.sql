-- Phase 2D.2-A: host-only, server-generated, atomic regular-season game day.
-- Run AFTER bm_online_calendar_phase2d1.sql and prior runtime/journal migrations.
-- ONLY the trusted service_role may call this; the browser cannot send scores.
-- Locks the complete franchise revision shared by trades, signings, releases and calendar.
begin;
create or replace function public.bm_online_simulate_day_phase2d2(
  p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,
  p_date text,p_results jsonb,p_stats jsonb,p_rosters jsonb,p_injury_events jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_state jsonb;v_rev bigint;v_host uuid;v_status text;
  v_by_date jsonb;v_existing jsonb;v_day jsonb;v_first_unplayed text;
  v_game jsonb;v_result jsonb;v_game_id text;v_day_count int;
  v_original_teams jsonb;v_next_teams jsonb;v_old_team jsonb;v_new_team jsonb;
  v_old_player jsonb;v_new_player jsonb;v_index int;v_player_index int;
  v_updated jsonb;v_roster_mode text;
begin
  if p_lobby is null or p_actor is null or p_request is null or p_expected_revision is null or
     p_date !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Invalid simulation request';
  end if;
  select r.state,r.revision into v_state,v_rev
    from public.bm_online_franchise_runtime r where r.lobby_id=p_lobby for update;
  if not found then raise exception 'Shared franchise is missing';end if;
  select l.host_id,l.status into v_host,v_status from public.bm_online_lobbies l where l.id=p_lobby;
  if v_host is distinct from p_actor or v_status<>'started' or not exists(
    select 1 from public.bm_online_lobby_members m where m.lobby_id=p_lobby and m.user_id=p_actor)
    then raise exception 'Only the active host may simulate';end if;
  if exists(select 1 from public.bm_online_franchise_events e where e.lobby_id=p_lobby and e.request_id=p_request)
    then raise exception 'Simulation request identifier was used already';end if;
  if v_rev<>p_expected_revision then raise exception 'Shared league revision changed';end if;
  if v_state#>>'{onlineSchedule,phase}'<>'regular-season' then raise exception 'Season is not in regular-season phase';end if;
  v_by_date:=v_state#>'{onlineSchedule,byDate}';
  if jsonb_typeof(v_by_date)<>'object' then raise exception 'Online calendar missing';end if;
  v_existing:=coalesce(v_state->'onlineResults','{}'::jsonb);
  if jsonb_typeof(v_existing)<>'object' then raise exception 'Existing result ledger invalid';end if;
  -- Refuse skipping dates, resimulation, or a partially simulated date.
  select min(d.key) into v_first_unplayed from jsonb_each(v_by_date) d
  where exists(select 1 from jsonb_array_elements(d.value) g where not (v_existing ? (g.value->>'id')));
  if v_first_unplayed is null or v_first_unplayed<>p_date then raise exception 'Only the next unplayed date may advance';end if;
  v_day:=v_by_date->p_date;
  if jsonb_typeof(v_day)<>'array' then raise exception 'Scheduled game day missing';end if;
  v_day_count:=jsonb_array_length(v_day);
  if v_day_count<1 or v_day_count>16 then raise exception 'Invalid number of games on date';end if;
  if jsonb_typeof(p_results)<>'object' or
    (select count(*) from jsonb_object_keys(p_results))<>v_day_count or
    octet_length(p_results::text)>1500000 then raise exception 'Incomplete or oversized game result batch';end if;
  for v_game in select value from jsonb_array_elements(v_day) loop
    v_game_id:=v_game->>'id';
    if v_game_id is null or v_existing ? v_game_id or not p_results ? v_game_id then
      raise exception 'A game is missing or already final';end if;
    v_result:=p_results->v_game_id;
    if jsonb_typeof(v_result)<>'object' or
       v_result->>'id'<>v_game_id or v_result->>'date'<>p_date or
       v_result->>'home'<>v_game->>'home' or v_result->>'away'<>v_game->>'away' or
       jsonb_typeof(v_result->'homeScore')<>'number' or jsonb_typeof(v_result->'awayScore')<>'number' or
       (v_result->>'homeScore')::numeric not between 60 and 250 or
       (v_result->>'awayScore')::numeric not between 60 and 250 or
       v_result->>'homeScore'=v_result->>'awayScore' or
       jsonb_typeof(v_result#>'{box,home}')<>'array' or
       jsonb_typeof(v_result#>'{box,away}')<>'array' or
       jsonb_array_length(v_result#>'{box,home}')<1 or
       jsonb_array_length(v_result#>'{box,away}')<1
    then raise exception 'Invalid game result or box score';end if;
  end loop;
  if jsonb_typeof(p_stats)<>'object' or octet_length(p_stats::text)>1200000 then
    raise exception 'Invalid accumulated player statistics';end if;
  if jsonb_typeof(p_injury_events)<>'array' or jsonb_array_length(p_injury_events)>500 or
    octet_length(p_injury_events::text)>500000 then raise exception 'Invalid injury history';end if;
  -- Only injury property changes are permitted in the carried-forward rosters.
  -- All player identities, contract values, ratings, team metadata, and ordering
  -- must be byte-for-byte equivalent in JSONB to the locked original snapshot.
  if jsonb_typeof(v_state->'teams')='array' then
    v_roster_mode:='teams';
    if jsonb_typeof(p_rosters)<>'array' then raise exception 'Invalid new roster format';end if;
    v_original_teams:=v_state->'teams';v_next_teams:=p_rosters;
  elsif jsonb_typeof(v_state->'conferences')='object' then
    v_roster_mode:='conferences';
    if jsonb_typeof(p_rosters)<>'object' or
       jsonb_typeof(p_rosters->'East')<>'array' or
       jsonb_typeof(p_rosters->'West')<>'array' then raise exception 'Invalid conference format';end if;
    if (v_state->'conferences' - 'East' - 'West') <> (p_rosters - 'East' - 'West') then
      raise exception 'Conference metadata cannot change during simulation';end if;
    v_original_teams:=coalesce(v_state#>'{conferences,East}','[]'::jsonb)||coalesce(v_state#>'{conferences,West}','[]'::jsonb);
    v_next_teams:=(p_rosters->'East')||(p_rosters->'West');
  else raise exception 'Shared roster format unsupported';end if;
  if jsonb_array_length(v_original_teams)<>30 or jsonb_array_length(v_next_teams)<>30 then
    raise exception 'Expected 30 unchanged NBA teams';end if;
  for v_index in 0..29 loop
    v_old_team:=v_original_teams->v_index;v_new_team:=v_next_teams->v_index;
    if (v_old_team - 'players')<>(v_new_team - 'players') or
       jsonb_typeof(v_old_team->'players')<>'array' or jsonb_typeof(v_new_team->'players')<>'array' or
       jsonb_array_length(v_old_team->'players')<>jsonb_array_length(v_new_team->'players')
       then raise exception 'Team composition cannot change during game simulation';end if;
    for v_player_index in 0..(jsonb_array_length(v_old_team->'players')-1) loop
      v_old_player:=v_old_team->'players'->v_player_index;
      v_new_player:=v_new_team->'players'->v_player_index;
      if (v_old_player - 'injury')<>(v_new_player - 'injury') then
        raise exception 'Game simulation cannot alter player or contract data';end if;
    end loop;
  end loop;
  v_updated:=jsonb_set(v_state,'{onlineResults}',v_existing||p_results,true);
  v_updated:=jsonb_set(v_updated,'{onlinePlayerStats}',p_stats,true);
  v_updated:=jsonb_set(v_updated,'{onlineInjuryEvents}',p_injury_events,true);
  if v_roster_mode='teams' then
    v_updated:=jsonb_set(v_updated,'{teams}',p_rosters,false);
  else
    v_updated:=jsonb_set(v_updated,'{conferences}',p_rosters,false);
  end if;
  v_updated:=jsonb_set(v_updated,'{onlineSchedule,cursor}',to_jsonb(p_date),false);
  v_updated:=jsonb_set(v_updated,'{onlineSchedule,lastSimulatedDate}',to_jsonb(p_date),true);
  update public.bm_online_franchise_runtime r set state=v_updated,revision=v_rev+1,updated_at=now()
    where r.lobby_id=p_lobby;
  insert into public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
  values(p_lobby,v_rev+1,p_request,p_actor,'regular_season_day_simulated',
    jsonb_build_object('date',p_date,'games',v_day_count,'total_played',(select count(*) from jsonb_object_keys(v_existing||p_results))));
  return jsonb_build_object('ok',true,'revision',v_rev+1,'date',p_date,'games',v_day_count);
end;
$$;
revoke all on function public.bm_online_simulate_day_phase2d2(uuid,uuid,uuid,bigint,text,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.bm_online_simulate_day_phase2d2(uuid,uuid,uuid,bigint,text,jsonb,jsonb,jsonb,jsonb) to service_role;
commit;
