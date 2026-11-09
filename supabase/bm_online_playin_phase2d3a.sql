-- Basketball Manager ONLINE 2D.3-A: bracket seeding and one-game-at-a-time Play-In.
-- MANUAL SQL. Requires runtime/journal, calendar, simulation, trade-deadline, All-Stars,
-- and veteran extensions migrations. Only service_role can invoke these functions.
-- Test with a disposable complete Online season before using a valuable franchise.
begin;

create or replace function public.bm_online_seed_postseason_phase2d3a(
 p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,p_postseason jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_state jsonb;v_rev bigint;v_host uuid;v_status text;v_prior public.bm_online_franchise_events%rowtype;
 v_schedule jsonb;v_results jsonb;v_season int;v_count int;v_conf text;v_seed jsonb;v_roster jsonb;
 v_team_name text;v_team_count int;v_next jsonb;
begin
 if p_lobby is null or p_actor is null or p_request is null or p_expected_revision<1 or
    pg_catalog.jsonb_typeof(p_postseason)<>'object' or pg_catalog.octet_length(p_postseason::text)>200000
 then raise exception 'Invalid postseason seeding request';end if;
 select r.state,r.revision into v_state,v_rev from public.bm_online_franchise_runtime r
   where r.lobby_id=p_lobby for update;
 if not found then raise exception 'Online league is unavailable';end if;
 select l.host_id,l.status into v_host,v_status from public.bm_online_lobbies l where l.id=p_lobby;
 if v_status is distinct from 'started' or v_host is distinct from p_actor or not exists(
    select 1 from public.bm_online_lobby_members m where m.lobby_id=p_lobby and m.user_id=p_actor)
 then raise exception 'Only the current host may seed the postseason';end if;
 select * into v_prior from public.bm_online_franchise_events e
   where e.lobby_id=p_lobby and e.request_id=p_request;
 if found then
   if v_prior.actor_id is distinct from p_actor or v_prior.action_type is distinct from 'postseason_seeded'
   then raise exception 'Request identifier already belongs to another action';end if;
   return pg_catalog.jsonb_build_object('ok',true,'replayed',true,'revision',v_prior.revision);
 end if;
 if v_rev<>p_expected_revision then raise exception 'League changed before bracket creation';end if;
 if v_state->'onlinePostseason' is not null then raise exception 'Postseason was already seeded';end if;
 if v_state#>>'{onlineSchedule,phase}'<>'regular-season' then raise exception 'Regular season is not initialized';end if;
 v_schedule:=v_state#>'{onlineSchedule,byDate}';v_results:=v_state->'onlineResults';
 v_season:=(v_state#>>'{onlineSchedule,seasonYear}')::int;
 if v_season<2025 or v_season>2094 or pg_catalog.jsonb_typeof(v_schedule)<>'object' or
    pg_catalog.jsonb_typeof(v_results)<>'object' or
    (select count(*) from pg_catalog.jsonb_object_keys(v_results))<>1230
 then raise exception 'Regular-season results must be complete';end if;
 select count(*) into v_count from pg_catalog.jsonb_each(v_schedule) d
  cross join lateral pg_catalog.jsonb_array_elements(d.value) g;
 if v_count<>1230 or exists(
  select 1 from pg_catalog.jsonb_each(v_schedule) d
    cross join lateral pg_catalog.jsonb_array_elements(d.value) g
   where not(v_results ? (g.value->>'id')) or
    v_results->(g.value->>'id')->>'home' is distinct from g.value->>'home' or
    v_results->(g.value->>'id')->>'away' is distinct from g.value->>'away' or
    v_results->(g.value->>'id')->>'date' is distinct from d.key)
 then raise exception 'A final regular-season score is missing or mismatched';end if;
 if v_state#>>'{onlineCheckpoints,trade_deadline,status}'<>'closed' or
    v_state#>>'{onlineCheckpoints,all_star,status}'<>'selected' or
    v_state#>>'{onlineCheckpoints,veteran_extension,status}'<>'closed'
 then raise exception 'Unresolved regular-season checkpoints';end if;
 if p_postseason->>'phase' is distinct from 'playIn' or
    (p_postseason->>'seasonYear')::int<>v_season or
    pg_catalog.jsonb_typeof(p_postseason->'conf')<>'object' or
    pg_catalog.jsonb_typeof(p_postseason->'seedOrder')<>'object' or
    p_postseason#>>'{calendar,regularSeasonEndDate}' is null or
    p_postseason#>>'{calendar,currentDate}' is null
 then raise exception 'Bracket initialization is invalid';end if;
 if pg_catalog.jsonb_typeof(v_state->'teams')='array' then
    v_roster:=v_state->'teams';
 else v_roster:=coalesce(v_state#>'{conferences,East}','[]'::jsonb)||
                      coalesce(v_state#>'{conferences,West}','[]'::jsonb);
 end if;
 if pg_catalog.jsonb_array_length(v_roster)<>30 then raise exception 'Expected 30 teams';end if;
 foreach v_conf in array array['West','East'] loop
   v_seed:=p_postseason->'seedOrder'->v_conf;
   if pg_catalog.jsonb_typeof(v_seed)<>'array' or pg_catalog.jsonb_array_length(v_seed)<>10 or
      pg_catalog.jsonb_typeof(p_postseason->'conf'->v_conf)<>'object'
   then raise exception 'A conference seed list is missing';end if;
   if (select count(distinct x.value) from pg_catalog.jsonb_array_elements_text(v_seed) x)<>10
   then raise exception 'Duplicate postseason seeds';end if;
   for v_team_count in 0..9 loop
     v_team_name:=v_seed->>v_team_count;
     if not exists (select 1 from pg_catalog.jsonb_array_elements(v_roster) t
       where t.value->>'name'=v_team_name) then raise exception 'Unknown playoff seed';end if;
   end loop;
   if p_postseason#>>array['conf',v_conf,'playIn','g78','home'] is distinct from v_seed->>6 or
      p_postseason#>>array['conf',v_conf,'playIn','g78','away'] is distinct from v_seed->>7 or
      p_postseason#>>array['conf',v_conf,'playIn','g910','home'] is distinct from v_seed->>8 or
      p_postseason#>>array['conf',v_conf,'playIn','g910','away'] is distinct from v_seed->>9 or
      p_postseason#>>array['conf',v_conf,'rounds','r1','s1v8','highSeedTeam'] is distinct from v_seed->>0 or
      p_postseason#>>array['conf',v_conf,'rounds','r1','s2v7','highSeedTeam'] is distinct from v_seed->>1
   then raise exception 'Play-In or first-round seeds do not match frozen standings';end if;
 end loop;
 v_next:=pg_catalog.jsonb_set(v_state,'{onlinePostseason}',p_postseason,true);
 v_next:=pg_catalog.jsonb_set(v_next,'{onlineSchedule,phase}','"postseason"'::jsonb,false);
 v_next:=pg_catalog.jsonb_set(v_next,'{onlinePostseasonResults}','{}'::jsonb,true);
 v_next:=pg_catalog.jsonb_set(v_next,'{onlinePostseasonStats}','{}'::jsonb,true);
 perform pg_catalog.set_config('bm.online_postseason_write','1',true);
 update public.bm_online_franchise_runtime r set state=v_next,revision=v_rev+1,updated_at=now()
  where r.lobby_id=p_lobby;
 insert into public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
 values(p_lobby,v_rev+1,p_request,p_actor,'postseason_seeded',
   pg_catalog.jsonb_build_object('seasonYear',v_season,'date',p_postseason#>>'{calendar,currentDate}','teams',20));
 return pg_catalog.jsonb_build_object('ok',true,'revision',v_rev+1);
end $$;
revoke all on function public.bm_online_seed_postseason_phase2d3a(uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.bm_online_seed_postseason_phase2d3a(uuid,uuid,uuid,bigint,jsonb) to service_role;

create or replace function public.bm_online_simulate_playin_phase2d3a(
 p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,p_game_id text,
 p_result jsonb,p_postseason jsonb,p_postseason_stats jsonb,p_rosters jsonb,p_injury_events jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_state jsonb;v_rev bigint;v_host uuid;v_status text;v_prior public.bm_online_franchise_events%rowtype;
 v_old_post jsonb;v_post jsonb;v_conf text;v_key text;v_node jsonb;v_winner text;v_loser text;
 v_expected_id text;v_date text;v_home text;v_away text;v_home_score int;v_away_score int;
 v_candidates int;v_playin jsonb;v_existing jsonb;v_next jsonb;v_stage_conf text;
 v_roster_mode text;v_old_teams jsonb;v_new_teams jsonb;v_team_old jsonb;v_team_new jsonb;
 v_player_old jsonb;v_player_new jsonb;v_idx int;v_pi int;v_completed boolean;
begin
 if p_lobby is null or p_actor is null or p_request is null or p_expected_revision<1 or
    p_game_id is null or pg_catalog.length(p_game_id)>140 or
    pg_catalog.jsonb_typeof(p_result)<>'object' or pg_catalog.jsonb_typeof(p_postseason)<>'object' or
    pg_catalog.octet_length(p_result::text)>140000 or pg_catalog.octet_length(p_postseason::text)>800000
 then raise exception 'Invalid Play-In simulation request';end if;
 select r.state,r.revision into v_state,v_rev from public.bm_online_franchise_runtime r
  where r.lobby_id=p_lobby for update;
 if not found then raise exception 'Online league is missing';end if;
 select l.host_id,l.status into v_host,v_status from public.bm_online_lobbies l where l.id=p_lobby;
 if v_host is distinct from p_actor or v_status<>'started' or not exists(
   select 1 from public.bm_online_lobby_members m where m.lobby_id=p_lobby and m.user_id=p_actor)
 then raise exception 'Only the host can simulate Play-In games';end if;
 select * into v_prior from public.bm_online_franchise_events e
  where e.lobby_id=p_lobby and e.request_id=p_request;
 if found then
   if v_prior.actor_id is distinct from p_actor or v_prior.action_type is distinct from 'play_in_game_simulated' or
      v_prior.details->>'gameId' is distinct from p_game_id
   then raise exception 'Request identifier already used for another action';end if;
   return pg_catalog.jsonb_build_object('ok',true,'replayed',true,'revision',v_prior.revision);
 end if;
 if v_rev<>p_expected_revision then raise exception 'Shared online league changed';end if;
 v_old_post:=v_state->'onlinePostseason';v_existing:=coalesce(v_state->'onlinePostseasonResults','{}'::jsonb);
 if v_state#>>'{onlineSchedule,phase}'<>'postseason' or v_old_post->>'phase'<>'playIn' or
    pg_catalog.jsonb_typeof(v_existing)<>'object' or v_existing ? p_game_id
 then raise exception 'Play-In phase has ended or game was already played';end if;
 -- Choose the next ready matchup by trusted date and ID, never by browser choice.
 select r.conf,r.key,r.node,r.node->>'id',r.node->>'date',r.node->>'home',r.node->>'away'
  into v_conf,v_key,v_node,v_expected_id,v_date,v_home,v_away
 from (
  select c.key as conf, k.key as key, c.value->'playIn'->k.key as node
  from pg_catalog.jsonb_each(v_old_post->'conf') c
  cross join (values('g78'),('g910'),('gFinal')) k(key)
  where c.key in ('West','East') and
    coalesce((c.value->'playIn'->k.key->>'played')::boolean,false)=false and
    (k.key<>'gFinal' or
      (coalesce((c.value#>>'{playIn,g78,played}')::boolean,false) and
       coalesce((c.value#>>'{playIn,g910,played}')::boolean,false)))
 ) r
 where r.node->>'home' is not null and r.node->>'away' is not null and
   r.node->>'date' ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
 order by r.node->>'date',r.node->>'id' limit 1;
 if v_expected_id is null or v_expected_id is distinct from p_game_id or
    v_home is null or v_away is null or v_home=v_away then
    raise exception 'Out-of-order or unavailable Play-In game';end if;
 if p_result->>'id' is distinct from v_expected_id or p_result->>'date' is distinct from v_date or
    p_result->>'home' is distinct from v_home or p_result->>'away' is distinct from v_away or
    pg_catalog.jsonb_typeof(p_result->'homeScore')<>'number' or
    pg_catalog.jsonb_typeof(p_result->'awayScore')<>'number' or
    pg_catalog.jsonb_typeof(p_result#>'{box,home}')<>'array' or
    pg_catalog.jsonb_typeof(p_result#>'{box,away}')<>'array' or
    pg_catalog.jsonb_array_length(p_result#>'{box,home}')<1 or
    pg_catalog.jsonb_array_length(p_result#>'{box,away}')<1
 then raise exception 'Play-In box score or matchup is invalid';end if;
 v_home_score:=(p_result->>'homeScore')::int;
 v_away_score:=(p_result->>'awayScore')::int;
 if v_home_score not between 60 and 250 or v_away_score not between 60 and 250 or v_home_score=v_away_score or
    (p_result#>>'{totals,home}')::int<>v_home_score or
    (p_result#>>'{totals,away}')::int<>v_away_score
 then raise exception 'Play-In result contains an invalid final score';end if;
 if p_result#>>'{winner,side}' is distinct from (case when v_home_score>v_away_score then 'home' else 'away' end) or
    (p_result#>>'{winner,home}')::int is distinct from v_home_score or
    (p_result#>>'{winner,away}')::int is distinct from v_away_score or
    (select coalesce(sum((x.value->>'pts')::int),0) from pg_catalog.jsonb_array_elements(p_result#>'{box,home}') x)<>v_home_score or
    (select coalesce(sum((x.value->>'pts')::int),0) from pg_catalog.jsonb_array_elements(p_result#>'{box,away}') x)<>v_away_score
 then raise exception 'Play-In winner or box-score totals do not reconcile';end if;
 if pg_catalog.jsonb_typeof(p_postseason_stats)<>'object' or
    pg_catalog.octet_length(p_postseason_stats::text)>1200000 or
    pg_catalog.jsonb_typeof(p_injury_events)<>'array' or
    pg_catalog.jsonb_array_length(p_injury_events)>500 or
    pg_catalog.octet_length(p_injury_events::text)>500000
 then raise exception 'Postseason statistics or injury ledger is invalid';end if;
 -- Same allowed injury-only roster delta as regular-season simulation.
 if pg_catalog.jsonb_typeof(v_state->'teams')='array' then
   v_roster_mode:='teams';v_old_teams:=v_state->'teams';v_new_teams:=p_rosters;
 elsif pg_catalog.jsonb_typeof(v_state->'conferences')='object' then
   v_roster_mode:='conferences';
   if pg_catalog.jsonb_typeof(p_rosters)<>'object' or
      (v_state->'conferences' - 'East' - 'West') is distinct from (p_rosters - 'East' - 'West')
   then raise exception 'Conference metadata cannot change';end if;
   v_old_teams:=coalesce(v_state#>'{conferences,East}','[]'::jsonb)||coalesce(v_state#>'{conferences,West}','[]'::jsonb);
   v_new_teams:=coalesce(p_rosters->'East','[]'::jsonb)||coalesce(p_rosters->'West','[]'::jsonb);
 else raise exception 'Online roster format is unsupported';end if;
 if pg_catalog.jsonb_typeof(v_old_teams)<>'array' or pg_catalog.jsonb_typeof(v_new_teams)<>'array' or
    pg_catalog.jsonb_array_length(v_old_teams)<>30 or pg_catalog.jsonb_array_length(v_new_teams)<>30
 then raise exception 'Postseason expects 30 team rosters';end if;
 for v_idx in 0..29 loop
   v_team_old:=v_old_teams->v_idx;v_team_new:=v_new_teams->v_idx;
   if (v_team_old-'players') is distinct from (v_team_new-'players') or
      pg_catalog.jsonb_typeof(v_team_old->'players')<>'array' or
      pg_catalog.jsonb_typeof(v_team_new->'players')<>'array' or
      pg_catalog.jsonb_array_length(v_team_old->'players')<>pg_catalog.jsonb_array_length(v_team_new->'players')
   then raise exception 'Play-In cannot change roster membership or team metadata';end if;
   if pg_catalog.jsonb_array_length(v_team_old->'players')>0 then
     for v_pi in 0..pg_catalog.jsonb_array_length(v_team_old->'players')-1 loop
       v_player_old:=v_team_old->'players'->v_pi;v_player_new:=v_team_new->'players'->v_pi;
       if (v_player_old-'injury') is distinct from (v_player_new-'injury') then
         raise exception 'Play-In cannot change player identities, ratings, or contracts';end if;
     end loop;
   end if;
 end loop;
 v_winner:=case when v_home_score>v_away_score then v_home else v_away end;
 v_loser:=case when v_home_score>v_away_score then v_away else v_home end;
 v_post:=pg_catalog.jsonb_set(v_old_post,array['conf',v_conf,'playIn',v_key],
   v_node||pg_catalog.jsonb_build_object('played',true,'winner',v_winner,'loser',v_loser,
     'homeScore',v_home_score,'awayScore',v_away_score,
     'otCount',coalesce((p_result#>>'{winner,ot}')::int,0),'boxScore',p_result),false);
 if v_key='g78' then
   v_post:=pg_catalog.jsonb_set(v_post,array['conf',v_conf,'playIn','seed7'],pg_catalog.to_jsonb(v_winner),false);
 end if;
 if v_key in ('g78','g910') then
   v_playin:=v_post#>array['conf',v_conf,'playIn'];
   if (v_playin#>>'{g78,played}')::boolean and (v_playin#>>'{g910,played}')::boolean then
     v_post:=pg_catalog.jsonb_set(v_post,array['conf',v_conf,'playIn','gFinal','home'],
       v_playin#>'{g78,loser}',false);
     v_post:=pg_catalog.jsonb_set(v_post,array['conf',v_conf,'playIn','gFinal','away'],
       v_playin#>'{g910,winner}',false);
   end if;
 else
   v_post:=pg_catalog.jsonb_set(v_post,array['conf',v_conf,'playIn','seed8'],pg_catalog.to_jsonb(v_winner),false);
   v_post:=pg_catalog.jsonb_set(v_post,array['conf',v_conf,'rounds','r1','s1v8','lowSeedTeam'],
     pg_catalog.to_jsonb(v_winner),false);
   v_post:=pg_catalog.jsonb_set(v_post,array['conf',v_conf,'rounds','r1','s2v7','lowSeedTeam'],
     v_post#>array['conf',v_conf,'playIn','seed7'],false);
 end if;
 if v_post#>>'{calendar,currentDate}' < v_date then
   v_post:=pg_catalog.jsonb_set(v_post,'{calendar,currentDate}',pg_catalog.to_jsonb(v_date),false);
 end if;
 v_completed:=true;
 foreach v_stage_conf in array array['West','East'] loop
   if v_post#>>array['conf',v_stage_conf,'playIn','g78','played']<>'true' or
      v_post#>>array['conf',v_stage_conf,'playIn','g910','played']<>'true' or
      v_post#>>array['conf',v_stage_conf,'playIn','gFinal','played']<>'true'
   then v_completed:=false;end if;
 end loop;
 if v_completed then v_post:=pg_catalog.jsonb_set(v_post,'{phase}','"playoffs"'::jsonb,false);end if;
 if v_post is distinct from p_postseason then raise exception 'Submitted postseason state differs from independently checked bracket progression';end if;
 v_next:=pg_catalog.jsonb_set(v_state,'{onlinePostseason}',v_post,false);
 v_next:=pg_catalog.jsonb_set(v_next,'{onlinePostseasonResults}',v_existing||
   pg_catalog.jsonb_build_object(p_game_id,p_result),true);
 v_next:=pg_catalog.jsonb_set(v_next,'{onlinePostseasonStats}',p_postseason_stats,true);
 v_next:=pg_catalog.jsonb_set(v_next,'{onlineInjuryEvents}',p_injury_events,true);
 if v_roster_mode='teams' then v_next:=pg_catalog.jsonb_set(v_next,'{teams}',p_rosters,false);
 else v_next:=pg_catalog.jsonb_set(v_next,'{conferences}',p_rosters,false);end if;
 perform pg_catalog.set_config('bm.online_postseason_write','1',true);
 update public.bm_online_franchise_runtime r set state=v_next,revision=v_rev+1,updated_at=now()
   where r.lobby_id=p_lobby;
 insert into public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
 values(p_lobby,v_rev+1,p_request,p_actor,'play_in_game_simulated',
   pg_catalog.jsonb_build_object('gameId',p_game_id,'date',v_date,'winner',v_winner,'conference',v_conf));
 return pg_catalog.jsonb_build_object('ok',true,'revision',v_rev+1,'gameId',p_game_id,'date',v_date);
end $$;
revoke all on function public.bm_online_simulate_playin_phase2d3a(uuid,uuid,uuid,bigint,text,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.bm_online_simulate_playin_phase2d3a(uuid,uuid,uuid,bigint,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;

-- Isolate the postseason ledger from older RPCs, including stale service clients.
create or replace function public.bm_online_postseason_guard_phase2d3a()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (old.state->'onlinePostseason' is not null or new.state->'onlinePostseason' is not null) and
   (old.state->'onlinePostseason' is distinct from new.state->'onlinePostseason' or
    old.state->'onlinePostseasonResults' is distinct from new.state->'onlinePostseasonResults' or
    old.state->'onlinePostseasonStats' is distinct from new.state->'onlinePostseasonStats' or
    old.state#>>'{onlineSchedule,phase}' is distinct from new.state#>>'{onlineSchedule,phase}') and
    coalesce(pg_catalog.current_setting('bm.online_postseason_write',true),'')<>'1'
 then raise exception 'Postseason state requires the trusted server-only operation';end if;
 if old.state->'onlinePostseason' is not null and
    old.state->'onlineResults' is distinct from new.state->'onlineResults'
 then raise exception 'Finalized regular-season scores cannot change after postseason seeding';end if;
 if old.state->'onlinePostseason' is not null and
    (old.state->'teams' is distinct from new.state->'teams' or
     old.state->'conferences' is distinct from new.state->'conferences') and
    coalesce(pg_catalog.current_setting('bm.online_postseason_write',true),'')<>'1'
 then raise exception 'Postseason rosters are locked to authorized simulation injury changes';end if;
 return new;
end $$;
revoke all on function public.bm_online_postseason_guard_phase2d3a() from public,anon,authenticated;
drop trigger if exists bm_online_postseason_runtime_guard_phase2d3a on public.bm_online_franchise_runtime;
create trigger bm_online_postseason_runtime_guard_phase2d3a
 before update on public.bm_online_franchise_runtime for each row
 execute function public.bm_online_postseason_guard_phase2d3a();
commit;
