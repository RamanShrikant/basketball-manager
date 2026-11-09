-- Phase 2D.2-E. All-Star selection is a trusted, server-scored, atomic checkpoint.
-- Depends on Online runtime/events, schedule/day simulation and 2D.2-D deadline.
-- Run manually in Supabase SQL Editor. No browser may execute this RPC.
begin;

create or replace function public.bm_online_all_star_date_for_state(p_state jsonb)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_year int;v_date text;v_candidate text;v_feb date;
begin
 v_year:=nullif(p_state#>>'{onlineSchedule,seasonYear}','')::int+1;
 if v_year<2025 or v_year>2095 then raise exception 'Invalid Online All-Star season';end if;
 v_feb:=pg_catalog.make_date(v_year,2,1);
 v_date:=pg_catalog.to_char(v_feb+(((7-pg_catalog.extract(dow from v_feb)::int)%7)+14),'YYYY-MM-DD');
 foreach v_candidate in array array[p_state#>>'{calendar,allStarSelectionDate}',p_state#>>'{calendar,allStarDate}'] loop
   if v_candidate ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' and pg_catalog.left(v_candidate,4)::int=v_year then
     begin
       if pg_catalog.to_char(v_candidate::date,'YYYY-MM-DD')=v_candidate then return v_candidate;end if;
     exception when invalid_datetime_format or datetime_field_overflow then null;
     end;
   end if;
 end loop;
 return v_date;
end $$;
revoke all on function public.bm_online_all_star_date_for_state(jsonb) from public,anon,authenticated;
grant execute on function public.bm_online_all_star_date_for_state(jsonb) to service_role;

create or replace function public.bm_online_select_all_stars_phase2d2e(
 p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,p_date text,p_all_stars jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_state jsonb;v_revision bigint;v_host uuid;v_status text;
 v_previous public.bm_online_franchise_events%rowtype;
 v_date text;v_year int;v_games jsonb;v_results jsonb;v_next text;
 v_rows jsonb;v_rosters jsonb;v_all_count int;v_distinct_count int;v_new jsonb;
begin
 if p_lobby is null or p_actor is null or p_request is null or p_expected_revision is null or
    p_expected_revision<1 or p_date is null or p_all_stars is null then
   raise exception 'Invalid All-Star request';end if;
 select state,revision into v_state,v_revision from public.bm_online_franchise_runtime
   where lobby_id=p_lobby for update;
 if not found then raise exception 'Online franchise was not found';end if;
 select host_id,status into v_host,v_status from public.bm_online_lobbies where id=p_lobby;
 if v_host is distinct from p_actor or v_status<>'started' or not exists (
     select 1 from public.bm_online_lobby_members where lobby_id=p_lobby and user_id=p_actor)
   then raise exception 'Only the current started-league host may select All-Stars';end if;
 v_date:=public.bm_online_all_star_date_for_state(v_state);
 if p_date<>v_date then raise exception 'All-Star date does not match server season rules';end if;
 select * into v_previous from public.bm_online_franchise_events
   where lobby_id=p_lobby and request_id=p_request;
 if found then
   if v_previous.actor_id<>p_actor or v_previous.action_type<>'all_star_selected' or
      v_previous.details->>'date'<>p_date then raise exception 'Request ID belongs to another operation';end if;
   return pg_catalog.jsonb_build_object('ok',true,'replayed',true,'revision',v_previous.revision,'date',v_date);
 end if;
 if v_revision<>p_expected_revision then raise exception 'League revision changed. Refresh and retry';end if;
 if v_state#>>'{onlineSchedule,phase}'<>'regular-season' then raise exception 'All-Star selection requires the regular season';end if;
 if v_state->'onlineAllStars' is not null or v_state#>'{onlineCheckpoints,all_star}' is not null then
   raise exception 'This season already has an All-Star selection';end if;
 v_year:=(v_state#>>'{onlineSchedule,seasonYear}')::int;
 v_games:=v_state#>'{onlineSchedule,byDate}';
 v_results:=coalesce(v_state->'onlineResults','{}'::jsonb);
 if pg_catalog.jsonb_typeof(v_games)<>'object' or pg_catalog.jsonb_typeof(v_results)<>'object' then
   raise exception 'Online calendar or result ledger is invalid';end if;
 select min(d.key) into v_next from pg_catalog.jsonb_each(v_games) d
   where exists(select 1 from pg_catalog.jsonb_array_elements(d.value) g
     where not (v_results ? (g.value->>'id')));
 if v_next is null or v_next<=v_date then
   raise exception 'All games before All-Star selection must be final';end if;
 if exists(select 1 from pg_catalog.jsonb_array_elements(v_games->v_next) g
   where v_results ? (g.value->>'id')) then
   raise exception 'A partially completed game day must be recovered first';end if;
 if exists(select 1 from pg_catalog.jsonb_each(v_results) r
   where (r.value->>'date')>=v_date) then
   raise exception 'Cannot choose All-Stars after games beyond the selection date';end if;
 if p_all_stars->>'season'<>(v_year::text||'-'||(v_year+1)::text) or
    p_all_stars->>'cutoff_date'<>v_date or
    pg_catalog.length(coalesce(p_all_stars->>'all_star_version','')) not between 5 and 90 or
    pg_catalog.length(p_all_stars::text)>95000 then
   raise exception 'All-Star result has invalid season, date or version';end if;
 if pg_catalog.jsonb_typeof(p_all_stars#>'{east,starters}')<>'array' or
    pg_catalog.jsonb_typeof(p_all_stars#>'{east,reserves}')<>'array' or
    pg_catalog.jsonb_typeof(p_all_stars#>'{west,starters}')<>'array' or
    pg_catalog.jsonb_typeof(p_all_stars#>'{west,reserves}')<>'array' or
    pg_catalog.jsonb_array_length(p_all_stars#>'{east,starters}')<>5 or
    pg_catalog.jsonb_array_length(p_all_stars#>'{east,reserves}')<>7 or
    pg_catalog.jsonb_array_length(p_all_stars#>'{west,starters}')<>5 or
    pg_catalog.jsonb_array_length(p_all_stars#>'{west,reserves}')<>7 then
    raise exception 'All-Star rosters must have 5 starters and 7 reserves per conference';end if;
 v_rows:=(p_all_stars#>'{east,starters}')||(p_all_stars#>'{east,reserves}')||
    (p_all_stars#>'{west,starters}')||(p_all_stars#>'{west,reserves}');
 select count(*),count(distinct player->>'player') into v_all_count,v_distinct_count
    from pg_catalog.jsonb_array_elements(v_rows) player;
 if v_all_count<>24 or v_distinct_count<>24 or exists(
    select 1 from pg_catalog.jsonb_array_elements(v_rows) player
    where coalesce(player->>'player','')='' or coalesce(player->>'team','')='' or
      coalesce((player->>'gp')::int,0)<12
 ) then raise exception 'All-Star selections must contain 24 distinct eligible players';end if;
 -- All selected athletes must belong to a current, authoritative team roster.
 v_rosters:=case when pg_catalog.jsonb_typeof(v_state->'teams')='array'
   then v_state->'teams'
   else coalesce(v_state#>'{conferences,East}','[]'::jsonb)||
        coalesce(v_state#>'{conferences,West}','[]'::jsonb) end;
 if exists(
   select 1 from pg_catalog.jsonb_array_elements(v_rows) chosen
   where not exists(
     select 1 from pg_catalog.jsonb_array_elements(v_rosters) t
     cross join lateral pg_catalog.jsonb_array_elements(coalesce(t.value->'players','[]'::jsonb)) p
     where t.value->>'name'=chosen.value->>'team' and
           coalesce(p.value->>'name',p.value->>'player')=chosen.value->>'player'
   )
 ) then raise exception 'A selected All-Star no longer belongs to the current roster';end if;
 -- Separate locked write and event append; SQL errors roll back both atomically.
 perform pg_catalog.set_config('bm.online_allstar_commit',p_lobby::text,true);
 v_new:=pg_catalog.jsonb_set(v_state,'{onlineCheckpoints}',
   coalesce(v_state->'onlineCheckpoints','{}'::jsonb)||pg_catalog.jsonb_build_object(
     'all_star',pg_catalog.jsonb_build_object('status','selected','date',v_date,
      'seasonYear',v_year,'revision',v_revision+1,'selectedBy',p_actor)),true);
 v_new:=pg_catalog.jsonb_set(v_new,'{onlineAllStars}',p_all_stars,true);
 update public.bm_online_franchise_runtime set state=v_new,revision=v_revision+1,updated_at=now()
   where lobby_id=p_lobby;
 insert into public.bm_online_franchise_events
   (lobby_id,revision,request_id,actor_id,action_type,details)
 values(p_lobby,v_revision+1,p_request,p_actor,'all_star_selected',
     pg_catalog.jsonb_build_object('date',v_date,'season_year',v_year,
      'selection_version',p_all_stars->>'all_star_version'));
 return pg_catalog.jsonb_build_object('ok',true,'revision',v_revision+1,'date',v_date);
end $$;
revoke all on function public.bm_online_select_all_stars_phase2d2e(uuid,uuid,uuid,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.bm_online_select_all_stars_phase2d2e(uuid,uuid,uuid,bigint,text,jsonb) to service_role;

-- Defense-in-depth: old game-sim RPCs cannot advance beyond an unselected
-- All-Star break. Later patches must explicitly handle veteran extension windows.
create or replace function public.bm_online_all_star_runtime_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_date text;v_old_selected boolean;v_new_selected boolean;v_old_results jsonb;v_new_results jsonb;
begin
 v_old_selected:=old.state#>>'{onlineCheckpoints,all_star,status}'='selected';
 v_new_selected:=new.state#>>'{onlineCheckpoints,all_star,status}'='selected';
 if v_old_selected and old.state#>>'{onlineSchedule,seasonYear}'=new.state#>>'{onlineSchedule,seasonYear}' and
    (new.state#>'{onlineCheckpoints,all_star}' is distinct from old.state#>'{onlineCheckpoints,all_star}' or
     new.state->'onlineAllStars' is distinct from old.state->'onlineAllStars') then
   raise exception 'Cannot overwrite official All-Star selections in the same season';end if;
 if not v_old_selected and v_new_selected and
    pg_catalog.current_setting('bm.online_allstar_commit',true) is distinct from new.lobby_id::text then
   raise exception 'All-Star selection must be finalized through the trusted checkpoint transaction';end if;
 if v_new_selected and (
    new.state#>>'{onlineCheckpoints,all_star,date}' is distinct from
      public.bm_online_all_star_date_for_state(new.state) or
    new.state#>>'{onlineCheckpoints,all_star,seasonYear}' is distinct from
      new.state#>>'{onlineSchedule,seasonYear}') then
   raise exception 'All-Star selection marker does not match this season';end if;
 v_old_results:=coalesce(old.state->'onlineResults','{}'::jsonb);
 v_new_results:=coalesce(new.state->'onlineResults','{}'::jsonb);
 if pg_catalog.jsonb_typeof(v_old_results)<>'object' or pg_catalog.jsonb_typeof(v_new_results)<>'object' then
   raise exception 'Online result ledger is malformed';end if;
 if not v_new_selected and v_old_results is distinct from v_new_results then
   v_date:=public.bm_online_all_star_date_for_state(new.state);
   if exists(select 1 from pg_catalog.jsonb_each(v_new_results) r
     where not (v_old_results ? r.key) and r.value->>'date'>=v_date) then
     raise exception 'Cannot simulate past unresolved All-Star selection';end if;
 end if;
 return new;
end $$;
revoke all on function public.bm_online_all_star_runtime_guard() from public,anon,authenticated;
drop trigger if exists bm_online_all_star_runtime_guard on public.bm_online_franchise_runtime;
create trigger bm_online_all_star_runtime_guard
before update on public.bm_online_franchise_runtime
for each row execute function public.bm_online_all_star_runtime_guard();

commit;
