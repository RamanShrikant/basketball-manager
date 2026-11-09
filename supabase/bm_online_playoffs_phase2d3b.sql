-- Basketball Manager Online 2D.3-B: best-of-seven rounds, Finals and champion.
-- MANUAL ONLY. Requires all earlier online SQL, especially phase2d3a Play-In.
-- Only the trusted backend service role may call the executor.
begin;

-- The same two-team high/low seeding policy used by original Playoffs.jsx.
create or replace function public.bm_online_wire_series_phase2d3b(
 p_post jsonb,p_conf text,p_target text[],p_a text,p_b text
) returns jsonb language plpgsql immutable set search_path='' as $$
declare v_target jsonb;v_a int;v_b int;v_high text;v_low text;v_hi int;v_lo int;
begin
 if p_a is null or p_b is null then return p_post;end if;
 if p_a=p_b or p_conf not in ('East','West') then raise exception 'Invalid advancing teams';end if;
 v_target:=p_post#>p_target;
 if pg_catalog.jsonb_typeof(v_target)<>'object' then raise exception 'Missing next-round series';end if;
 select t.ordinality::int into v_a from pg_catalog.jsonb_array_elements_text(p_post->'seedOrder'->p_conf) with ordinality as t(team,ordinality) where t.team=p_a;
 select t.ordinality::int into v_b from pg_catalog.jsonb_array_elements_text(p_post->'seedOrder'->p_conf) with ordinality as t(team,ordinality) where t.team=p_b;
 if v_a is null or v_b is null or v_a=v_b then raise exception 'Advancing team is not a frozen seed';end if;
 v_hi:=least(v_a,v_b);v_lo:=greatest(v_a,v_b);
 v_high:=case when v_a<v_b then p_a else p_b end;
 v_low:=case when v_a<v_b then p_b else p_a end;
 if v_target->>'highSeedTeam' is not null or v_target->>'lowSeedTeam' is not null then
   if v_target->>'highSeedTeam' is distinct from v_high or v_target->>'lowSeedTeam' is distinct from v_low or
      (v_target->>'highSeedNum')::int is distinct from v_hi or (v_target->>'lowSeedNum')::int is distinct from v_lo
   then raise exception 'A playoff series was seeded inconsistently';end if;
   return p_post;
 end if;
 return pg_catalog.jsonb_set(p_post,p_target,
    v_target||pg_catalog.jsonb_build_object('highSeedTeam',v_high,'lowSeedTeam',v_low,
       'highSeedNum',v_hi,'lowSeedNum',v_lo),false);
end $$;
revoke all on function public.bm_online_wire_series_phase2d3b(jsonb,text,text[],text,text) from public,anon,authenticated;
grant execute on function public.bm_online_wire_series_phase2d3b(jsonb,text,text[],text,text) to service_role;

create or replace function public.bm_online_simulate_playoffs_phase2d3b(
 p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,p_game_id text,
 p_result jsonb,p_postseason jsonb,p_postseason_stats jsonb,p_rosters jsonb,p_injury_events jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_state jsonb;v_rev bigint;v_host uuid;v_status text;v_prior public.bm_online_franchise_events%rowtype;
 v_old_post jsonb;v_post jsonb;v_results jsonb;v_season int;
 v_conf text;v_round text;v_key text;v_node jsonb;v_path text[];
 v_node_conf text;v_node_round text;v_node_key text;v_node_path text[];
 v_i int;v_wins_high int;v_wins_low int;v_done boolean;v_ready boolean;
 v_id text;v_date text;v_home text;v_away text;
 v_next_id text;v_next_date text;v_next_home text;v_next_away text;
 v_next_conf text;v_next_round text;v_next_key text;v_next_path text[];v_next_i int;v_best boolean:=false;
 v_high text;v_low text;v_winner text;v_home_score int;v_away_score int;
 v_w18 text;v_w45 text;v_w36 text;v_w27 text;v_wt text;v_wb text;
 v_west text;v_east text;v_home_final text;v_away_final text;v_west_wins int;v_east_wins int;
 v_next jsonb;v_roster_mode text;v_old_teams jsonb;v_new_teams jsonb;
 v_old_team jsonb;v_new_team jsonb;v_old_player jsonb;v_new_player jsonb;v_t int;v_p int;
begin
 if p_lobby is null or p_actor is null or p_request is null or p_expected_revision<1 or
    p_game_id is null or pg_catalog.length(p_game_id)>140 or
    pg_catalog.jsonb_typeof(p_result)<>'object' or pg_catalog.jsonb_typeof(p_postseason)<>'object' or
    pg_catalog.octet_length(p_result::text)>140000 or pg_catalog.octet_length(p_postseason::text)>850000
 then raise exception 'Invalid playoff simulation request';end if;

 select r.state,r.revision into v_state,v_rev from public.bm_online_franchise_runtime r
  where r.lobby_id=p_lobby for update;
 if not found then raise exception 'Shared league is missing';end if;
 select l.host_id,l.status into v_host,v_status from public.bm_online_lobbies l where l.id=p_lobby;
 if v_host is distinct from p_actor or v_status is distinct from 'started' or not exists(
   select 1 from public.bm_online_lobby_members m where m.lobby_id=p_lobby and m.user_id=p_actor)
 then raise exception 'Only the host may simulate playoff games';end if;
 select * into v_prior from public.bm_online_franchise_events e
  where e.lobby_id=p_lobby and e.request_id=p_request;
 if found then
   if v_prior.actor_id is distinct from p_actor or v_prior.action_type is distinct from 'playoff_game_simulated' or
      v_prior.details->>'gameId' is distinct from p_game_id
   then raise exception 'Request ID already used for another operation';end if;
   return pg_catalog.jsonb_build_object('ok',true,'replayed',true,'revision',v_prior.revision,
     'gameId',p_game_id,'date',v_prior.details->>'date');
 end if;
 if v_rev<>p_expected_revision then raise exception 'The online league changed; refresh before retrying';end if;
 v_old_post:=v_state->'onlinePostseason';v_results:=coalesce(v_state->'onlinePostseasonResults','{}'::jsonb);
 if v_state#>>'{onlineSchedule,phase}' is distinct from 'postseason' or
    v_old_post->>'phase' is distinct from 'playoffs' or
    pg_catalog.jsonb_typeof(v_results)<>'object' or v_results ? p_game_id or
    pg_catalog.jsonb_typeof(v_old_post->'conf')<>'object' or
    pg_catalog.jsonb_typeof(v_old_post->'finals')<>'object'
 then raise exception 'Postseason is unavailable, completed or game was already played';end if;
 v_season:=(v_old_post->>'seasonYear')::int;
 if v_season<2025 or v_season>2094 then raise exception 'Invalid postseason year';end if;
 if (select count(*) from pg_catalog.jsonb_object_keys(v_old_post->'conf'))<>2 then raise exception 'Expected two conferences';end if;
 foreach v_conf in array array['West','East'] loop
   if v_old_post#>>array['conf',v_conf,'playIn','g78','played'] is distinct from 'true' or
      v_old_post#>>array['conf',v_conf,'playIn','g910','played'] is distinct from 'true' or
      v_old_post#>>array['conf',v_conf,'playIn','gFinal','played'] is distinct from 'true'
   then raise exception 'The complete Play-In is required before the playoffs';end if;
 end loop;

 -- Independently choose the chronological next unplayed game, including Finals.
 -- Fixed original game dates + game IDs eliminate client-selected order manipulation.
 for v_conf in select unnest(array['West','East','NBA']) loop
   for v_round in select unnest(case when v_conf='NBA' then array['finals'] else array['r1','r2','r3'] end) loop
     for v_key,v_node in
       select x.key,x.value from pg_catalog.jsonb_each(
         case when v_round='finals' then pg_catalog.jsonb_build_object('finals',v_old_post->'finals')
           else v_old_post#>array['conf',v_conf,'rounds',v_round] end) x
     loop
       v_path:=case when v_round='finals' then array['finals'] else array['conf',v_conf,'rounds',v_round,v_key] end;
       if pg_catalog.jsonb_typeof(v_node)<>'object' or v_node->>'type'<>'series' or
          (v_node->>'round')::int is distinct from (case v_round when 'r1' then 1 when 'r2' then 2 when 'r3' then 3 else 4 end) or
          v_node->>'conf' is distinct from v_conf or
          pg_catalog.jsonb_typeof(v_node->'gameIds')<>'array' or pg_catalog.jsonb_array_length(v_node->'gameIds')<>7 or
          pg_catalog.jsonb_typeof(v_node->'gameDates')<>'array' or pg_catalog.jsonb_array_length(v_node->'gameDates')<>7
       then raise exception 'Corrupt postseason series format';end if;
       v_i:=(v_node->>'nextGameIndex')::int;
       v_wins_high:=(v_node->>'winsHigh')::int;v_wins_low:=(v_node->>'winsLow')::int;
       v_done:=(v_node->>'complete')::boolean;
       if v_i is null or v_i not between 0 and 7 or v_wins_high is null or v_wins_low is null or
          v_wins_high not between 0 and 4 or v_wins_low not between 0 and 4 or v_i<>v_wins_high+v_wins_low or
          v_done is distinct from (greatest(v_wins_high,v_wins_low)=4) or
          (v_node->>'highSeedTeam' is null)<>(v_node->>'lowSeedTeam' is null)
       then raise exception 'Invalid playoff series record';end if;
       if v_done or v_node->>'highSeedTeam' is null then continue;end if;
       if v_i>6 then raise exception 'Playoff series has no remaining games';end if;
       v_id:=v_node->'gameIds'->>v_i;v_date:=v_node->'gameDates'->>v_i;
       if v_date is null or v_id is distinct from ('PO_'||v_season||'_'||v_conf||'_R'||
          (case v_round when 'r1' then 1 when 'r2' then 2 when 'r3' then 3 else 4 end)||'_'||(v_node->>'label')||'_G'||(v_i+1)) or
          v_date !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
       then raise exception 'Invalid playoff game ID or date';end if;
       v_high:=v_node->>'highSeedTeam';v_low:=v_node->>'lowSeedTeam';
       if v_high=v_low then raise exception 'A playoff team cannot face itself';end if;
       v_home:=case when v_i in (0,1,4,6) then v_high else v_low end;
       v_away:=case when v_i in (0,1,4,6) then v_low else v_high end;
       if not v_best or v_date<v_next_date or (v_date=v_next_date and v_id<v_next_id) then
         v_best:=true;v_next_id:=v_id;v_next_date:=v_date;v_next_home:=v_home;v_next_away:=v_away;
         v_next_conf:=v_conf;v_next_round:=v_round;v_next_key:=v_key;v_next_path:=v_path;v_next_i:=v_i;
       end if;
     end loop;
   end loop;
 end loop;
 if not v_best or v_next_id is distinct from p_game_id or
    (v_old_post#>>'{calendar,currentDate}')>v_next_date
 then raise exception 'Out-of-order, completed or clock-skipped playoff game';end if;
 if p_result->>'id' is distinct from v_next_id or p_result->>'date' is distinct from v_next_date or
    p_result->>'home' is distinct from v_next_home or p_result->>'away' is distinct from v_next_away or
    pg_catalog.jsonb_typeof(p_result->'homeScore')<>'number' or
    pg_catalog.jsonb_typeof(p_result->'awayScore')<>'number' or
    pg_catalog.jsonb_typeof(p_result#>'{box,home}')<>'array' or
    pg_catalog.jsonb_typeof(p_result#>'{box,away}')<>'array'
 then raise exception 'Invalid simulated game or matchup';end if;
 if (p_result->>'homeScore') !~ '^[0-9]{2,3}$' or (p_result->>'awayScore') !~ '^[0-9]{2,3}$' then
   raise exception 'Playoff scores must be whole numbers';end if;
 v_home_score:=(p_result->>'homeScore')::int;v_away_score:=(p_result->>'awayScore')::int;
 if v_home_score not between 60 and 250 or v_away_score not between 60 and 250 or
    v_home_score=v_away_score or
    (p_result#>>'{totals,home}')::int is distinct from v_home_score or
    (p_result#>>'{totals,away}')::int is distinct from v_away_score or
    (p_result#>>'{winner,home}')::int is distinct from v_home_score or
    (p_result#>>'{winner,away}')::int is distinct from v_away_score or
    p_result#>>'{winner,side}' is distinct from (case when v_home_score>v_away_score then 'home' else 'away' end) or
    (select coalesce(sum((x.value->>'pts')::int),0) from pg_catalog.jsonb_array_elements(p_result#>'{box,home}') x)<>v_home_score or
    (select coalesce(sum((x.value->>'pts')::int),0) from pg_catalog.jsonb_array_elements(p_result#>'{box,away}') x)<>v_away_score
 then raise exception 'Playoff final score and box score disagree';end if;
 if pg_catalog.jsonb_typeof(p_postseason_stats)<>'object' or
    pg_catalog.octet_length(p_postseason_stats::text)>1200000 or
    pg_catalog.jsonb_typeof(p_injury_events)<>'array' or
    pg_catalog.jsonb_array_length(p_injury_events)>500 or
    pg_catalog.octet_length(p_injury_events::text)>500000
 then raise exception 'Invalid postseason player statistics or injury ledger';end if;

 -- Injury-only roster changes, same locked enforcement as Play-In; neither browser nor
 -- backend may transfer players, change ratings, rewrite contracts or reorder identities.
 if pg_catalog.jsonb_typeof(v_state->'teams')='array' then
   v_roster_mode:='teams';v_old_teams:=v_state->'teams';v_new_teams:=p_rosters;
 elsif pg_catalog.jsonb_typeof(v_state->'conferences')='object' then
   v_roster_mode:='conferences';
   if pg_catalog.jsonb_typeof(p_rosters)<>'object' or
      (v_state->'conferences'-'East'-'West') is distinct from (p_rosters-'East'-'West')
   then raise exception 'Conference metadata cannot change during playoffs';end if;
   v_old_teams:=coalesce(v_state#>'{conferences,East}','[]'::jsonb)||coalesce(v_state#>'{conferences,West}','[]'::jsonb);
   v_new_teams:=coalesce(p_rosters->'East','[]'::jsonb)||coalesce(p_rosters->'West','[]'::jsonb);
 else raise exception 'Unsupported online roster shape';end if;
 if pg_catalog.jsonb_typeof(v_old_teams)<>'array' or pg_catalog.jsonb_typeof(v_new_teams)<>'array' or
    pg_catalog.jsonb_array_length(v_old_teams)<>30 or pg_catalog.jsonb_array_length(v_new_teams)<>30
 then raise exception 'Expected 30 unchanged NBA teams';end if;
 for v_t in 0..29 loop
   v_old_team:=v_old_teams->v_t;v_new_team:=v_new_teams->v_t;
   if (v_old_team-'players') is distinct from (v_new_team-'players') or
      pg_catalog.jsonb_typeof(v_old_team->'players')<>'array' or
      pg_catalog.jsonb_typeof(v_new_team->'players')<>'array' or
      pg_catalog.jsonb_array_length(v_old_team->'players')<>pg_catalog.jsonb_array_length(v_new_team->'players')
   then raise exception 'Postseason cannot change team metadata or player membership';end if;
   if pg_catalog.jsonb_array_length(v_old_team->'players')>0 then
     for v_p in 0..pg_catalog.jsonb_array_length(v_old_team->'players')-1 loop
       v_old_player:=v_old_team->'players'->v_p;v_new_player:=v_new_team->'players'->v_p;
       if (v_old_player-'injury') is distinct from (v_new_player-'injury') then
         raise exception 'Postseason cannot change player contracts, attributes or identities';end if;
     end loop;
   end if;
 end loop;

 v_post:=v_old_post;
 v_node:=v_post#>v_next_path;v_wins_high:=(v_node->>'winsHigh')::int;
 v_wins_low:=(v_node->>'winsLow')::int;
 v_high:=v_node->>'highSeedTeam';v_low:=v_node->>'lowSeedTeam';
 v_winner:=case when v_home_score>v_away_score then v_next_home else v_next_away end;
 if v_winner=v_high then v_wins_high:=v_wins_high+1;
 elsif v_winner=v_low then v_wins_low:=v_wins_low+1;
 else raise exception 'Result winner does not belong to series';end if;
 v_node:=v_node||pg_catalog.jsonb_build_object('nextGameIndex',v_next_i+1,
   'winsHigh',v_wins_high,'winsLow',v_wins_low,'complete',(v_wins_high=4 or v_wins_low=4));
 v_post:=pg_catalog.jsonb_set(v_post,v_next_path,v_node,false);
 if v_post#>>'{calendar,currentDate}'<v_next_date then
   v_post:=pg_catalog.jsonb_set(v_post,'{calendar,currentDate}',pg_catalog.to_jsonb(v_next_date),false);
 end if;

 -- Copy single-player progression: 1v8+4v5 -> top, 3v6+2v7 -> bottom,
 -- then conference championship, then Finals home court from frozen W/L.
 foreach v_conf in array array['West','East'] loop
   v_w18:=case when v_post#>>array['conf',v_conf,'rounds','r1','s1v8','complete']='true'
      then (case when (v_post#>>array['conf',v_conf,'rounds','r1','s1v8','winsHigh'])::int=4
        then v_post#>>array['conf',v_conf,'rounds','r1','s1v8','highSeedTeam'] else v_post#>>array['conf',v_conf,'rounds','r1','s1v8','lowSeedTeam'] end) end;
   v_w45:=case when v_post#>>array['conf',v_conf,'rounds','r1','s4v5','complete']='true'
      then (case when (v_post#>>array['conf',v_conf,'rounds','r1','s4v5','winsHigh'])::int=4
        then v_post#>>array['conf',v_conf,'rounds','r1','s4v5','highSeedTeam'] else v_post#>>array['conf',v_conf,'rounds','r1','s4v5','lowSeedTeam'] end) end;
   v_w36:=case when v_post#>>array['conf',v_conf,'rounds','r1','s3v6','complete']='true'
      then (case when (v_post#>>array['conf',v_conf,'rounds','r1','s3v6','winsHigh'])::int=4
        then v_post#>>array['conf',v_conf,'rounds','r1','s3v6','highSeedTeam'] else v_post#>>array['conf',v_conf,'rounds','r1','s3v6','lowSeedTeam'] end) end;
   v_w27:=case when v_post#>>array['conf',v_conf,'rounds','r1','s2v7','complete']='true'
      then (case when (v_post#>>array['conf',v_conf,'rounds','r1','s2v7','winsHigh'])::int=4
        then v_post#>>array['conf',v_conf,'rounds','r1','s2v7','highSeedTeam'] else v_post#>>array['conf',v_conf,'rounds','r1','s2v7','lowSeedTeam'] end) end;
   v_post:=public.bm_online_wire_series_phase2d3b(v_post,v_conf,
     array['conf',v_conf,'rounds','r2','top'],v_w18,v_w45);
   v_post:=public.bm_online_wire_series_phase2d3b(v_post,v_conf,
     array['conf',v_conf,'rounds','r2','bot'],v_w36,v_w27);
   v_wt:=case when v_post#>>array['conf',v_conf,'rounds','r2','top','complete']='true'
     then (case when (v_post#>>array['conf',v_conf,'rounds','r2','top','winsHigh'])::int=4
       then v_post#>>array['conf',v_conf,'rounds','r2','top','highSeedTeam'] else v_post#>>array['conf',v_conf,'rounds','r2','top','lowSeedTeam'] end) end;
   v_wb:=case when v_post#>>array['conf',v_conf,'rounds','r2','bot','complete']='true'
     then (case when (v_post#>>array['conf',v_conf,'rounds','r2','bot','winsHigh'])::int=4
       then v_post#>>array['conf',v_conf,'rounds','r2','bot','highSeedTeam'] else v_post#>>array['conf',v_conf,'rounds','r2','bot','lowSeedTeam'] end) end;
   v_post:=public.bm_online_wire_series_phase2d3b(v_post,v_conf,
     array['conf',v_conf,'rounds','r3','confFinals'],v_wt,v_wb);
 end loop;
 v_west:=case when v_post#>>'{conf,West,rounds,r3,confFinals,complete}'='true'
   then (case when (v_post#>>'{conf,West,rounds,r3,confFinals,winsHigh}')::int=4
      then v_post#>>'{conf,West,rounds,r3,confFinals,highSeedTeam}'
      else v_post#>>'{conf,West,rounds,r3,confFinals,lowSeedTeam}' end) end;
 v_east:=case when v_post#>>'{conf,East,rounds,r3,confFinals,complete}'='true'
   then (case when (v_post#>>'{conf,East,rounds,r3,confFinals,winsHigh}')::int=4
      then v_post#>>'{conf,East,rounds,r3,confFinals,highSeedTeam}'
      else v_post#>>'{conf,East,rounds,r3,confFinals,lowSeedTeam}' end) end;
 if v_west is not null and v_east is not null then
   select (x.value->>'wins')::int into v_west_wins from pg_catalog.jsonb_array_elements(v_post->'regularSeasonSnapshot') x where x.value->>'teamName'=v_west;
   select (x.value->>'wins')::int into v_east_wins from pg_catalog.jsonb_array_elements(v_post->'regularSeasonSnapshot') x where x.value->>'teamName'=v_east;
   if v_west_wins is null or v_east_wins is null then raise exception 'Missing frozen standings for Finals home court';end if;
   v_home_final:=case when v_west_wins>=v_east_wins then v_west else v_east end;
   v_away_final:=case when v_west_wins>=v_east_wins then v_east else v_west end;
   if v_post#>>'{finals,highSeedTeam}' is null and v_post#>>'{finals,lowSeedTeam}' is null then
     v_post:=pg_catalog.jsonb_set(v_post,'{finals}',v_post->'finals'||
       pg_catalog.jsonb_build_object('highSeedTeam',v_home_final,'lowSeedTeam',v_away_final),false);
   elsif v_post#>>'{finals,highSeedTeam}' is distinct from v_home_final or
         v_post#>>'{finals,lowSeedTeam}' is distinct from v_away_final
   then raise exception 'Finals home-court assignments do not match frozen standings';end if;
 end if;
 if v_post#>>'{finals,complete}'='true' then
   v_winner:=case when (v_post#>>'{finals,winsHigh}')::int=4
     then v_post#>>'{finals,highSeedTeam}' else v_post#>>'{finals,lowSeedTeam}' end;
   v_post:=pg_catalog.jsonb_set(v_post,'{champion}',pg_catalog.to_jsonb(v_winner),true);
   v_post:=pg_catalog.jsonb_set(v_post,'{phase}','"postseasonComplete"'::jsonb,false);
 else v_winner:=null;end if;
 if v_post is distinct from p_postseason then
   raise exception 'Submitted playoff progression differs from independent server transaction';end if;

 v_next:=pg_catalog.jsonb_set(v_state,'{onlinePostseason}',v_post,false);
 v_next:=pg_catalog.jsonb_set(v_next,'{onlinePostseasonResults}',v_results||pg_catalog.jsonb_build_object(p_game_id,p_result),true);
 v_next:=pg_catalog.jsonb_set(v_next,'{onlinePostseasonStats}',p_postseason_stats,true);
 v_next:=pg_catalog.jsonb_set(v_next,'{onlineInjuryEvents}',p_injury_events,true);
 if v_roster_mode='teams' then v_next:=pg_catalog.jsonb_set(v_next,'{teams}',p_rosters,false);
 else v_next:=pg_catalog.jsonb_set(v_next,'{conferences}',p_rosters,false);end if;
 perform pg_catalog.set_config('bm.online_postseason_write','1',true);
 update public.bm_online_franchise_runtime r set state=v_next,revision=v_rev+1,updated_at=now()
   where r.lobby_id=p_lobby;
 insert into public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
 values(p_lobby,v_rev+1,p_request,p_actor,'playoff_game_simulated',
   pg_catalog.jsonb_build_object('gameId',p_game_id,'date',v_next_date,'winner',
    (case when v_home_score>v_away_score then v_next_home else v_next_away end),
    'round',v_next_round,'conference',v_next_conf,'champion',v_winner));
 return pg_catalog.jsonb_build_object('ok',true,'revision',v_rev+1,
   'gameId',p_game_id,'date',v_next_date,'champion',v_winner);
end $$;
revoke all on function public.bm_online_simulate_playoffs_phase2d3b(uuid,uuid,uuid,bigint,text,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.bm_online_simulate_playoffs_phase2d3b(uuid,uuid,uuid,bigint,text,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
commit;
