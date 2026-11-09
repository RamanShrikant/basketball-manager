-- Phase 2D.1: online-only host schedule initialization.
-- Requires earlier online runtime (2C1) and event journal migrations.
-- ONLY the trusted backend service_role can execute. No client-provided schedule is trusted.
begin;
create or replace function public.bm_online_initialize_calendar_phase2d1(
 p_lobby uuid, p_actor uuid, p_request uuid, p_expected_revision bigint,
 p_season_year int, p_by_date jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_state jsonb; v_rev bigint; v_host uuid; v_status text; v_teams jsonb;
 v_count int; v_unique int; v_dates int; v_first text; v_last text;
begin
 if p_lobby is null or p_actor is null or p_request is null or p_expected_revision is null then
   raise exception 'Invalid calendar request';end if;
 -- Row-level serialization for every live franchise mutation.
 select r.state,r.revision into v_state,v_rev
 from public.bm_online_franchise_runtime r where r.lobby_id=p_lobby for update;
 if not found then raise exception 'Online runtime is missing';end if;
 select l.host_id,l.status into v_host,v_status from public.bm_online_lobbies l where l.id=p_lobby;
 if v_host is distinct from p_actor or v_status<>'started' then raise exception 'Only the started franchise host may initialize';end if;
 if not exists(select 1 from public.bm_online_lobby_members m where m.lobby_id=p_lobby and m.user_id=p_actor)
 then raise exception 'Host is not a franchise member';end if;
 if exists(select 1 from public.bm_online_franchise_events e where e.lobby_id=p_lobby and e.request_id=p_request)
 then raise exception 'Calendar request identifier has already been used';end if;
 if v_rev<>p_expected_revision then raise exception 'Shared league revision changed';end if;
 if v_state ? 'onlineSchedule' then raise exception 'A shared calendar already exists';end if;
 if v_state ? 'onlineResults' then raise exception 'Existing online results must not be overwritten';end if;
 if p_season_year is null or p_season_year<2025 or p_season_year>2095 then raise exception 'Invalid season year';end if;
 if coalesce(nullif(v_state->>'seasonStartYear','')::int,nullif(v_state->>'seasonYear','')::int,2025)<>p_season_year then
   raise exception 'Calendar season does not match franchise';end if;
 if jsonb_typeof(p_by_date)<>'object' or octet_length(p_by_date::text)>1500000 then
   raise exception 'Invalid or oversized calendar';end if;
 if exists(select 1 from jsonb_each(p_by_date) d where
   d.key !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' or jsonb_typeof(d.value)<>'array' or
   (d.key < p_season_year::text||'-09-01') or (d.key > (p_season_year+1)::text||'-06-30')) then
   raise exception 'Calendar dates are invalid';end if;
 select count(*),min(key),max(key) into v_dates,v_first,v_last from jsonb_each(p_by_date);
 if v_dates<150 or v_dates>250 or v_first is null then raise exception 'Incomplete NBA date range';end if;
 v_teams:=case when jsonb_typeof(v_state->'teams')='array' then v_state->'teams'
 else coalesce(v_state#>'{conferences,East}','[]'::jsonb)||coalesce(v_state#>'{conferences,West}','[]'::jsonb) end;
 if jsonb_array_length(v_teams)<>30 then raise exception 'Online calendar requires 30 NBA teams';end if;
 with games as (
   select d.key as day,g.value as item from jsonb_each(p_by_date) d
   cross join lateral jsonb_array_elements(d.value) g(value)
 ) select count(*),count(distinct item->>'id') into v_count,v_unique from games;
 if v_count<>1230 or v_unique<>1230 then raise exception 'Calendar must contain 1,230 unique NBA games';end if;
 if exists (
   with games as (
     select d.key as day,g.value as item from jsonb_each(p_by_date) d
     cross join lateral jsonb_array_elements(d.value) g(value)
   ) select 1 from games where
       jsonb_typeof(item)<>'object' or
       jsonb_typeof(item->'id')<>'string' or length(item->>'id') not between 10 and 180 or
       item->>'date'<>day or
       jsonb_typeof(item->'home')<>'string' or jsonb_typeof(item->'away')<>'string' or
       item->>'home'=item->>'away' or
       item ? 'played' or item ? 'homeScore' or item ? 'awayScore' or item ? 'result' or
       not exists(select 1 from jsonb_array_elements(v_teams) t where t->>'name'=item->>'home') or
       not exists(select 1 from jsonb_array_elements(v_teams) t where t->>'name'=item->>'away')
 ) then raise exception 'Invalid game or unknown team in schedule';end if;
 -- No team can appear twice on the same day, and each team plays 82 games.
 if exists (
   with games as (
     select d.key as day,g.value as item from jsonb_each(p_by_date) d cross join lateral jsonb_array_elements(d.value) g(value)
   ), appearances as (
     select day,item->>'home' as team from games union all select day,item->>'away' from games
   ) select 1 from appearances group by day,team having count(*)>1
 ) then raise exception 'Team double-booked in NBA schedule';end if;
 if exists (
   with games as (
     select g.value as item from jsonb_each(p_by_date) d cross join lateral jsonb_array_elements(d.value) g(value)
   ), appearances as (
     select item->>'home' as team from games union all select item->>'away' from games
   ) select 1 from appearances group by team having count(*)<>82
 ) then raise exception 'Every team must have exactly 82 games';end if;
 update public.bm_online_franchise_runtime r set
  state=jsonb_set(v_state,'{onlineSchedule}',jsonb_build_object(
   'byDate',p_by_date,'seasonYear',p_season_year,'source','singleplayer-calendar-v2',
   'cursor',v_first,'phase','regular-season'),true),
  revision=v_rev+1,updated_at=now()
 where r.lobby_id=p_lobby;
 insert into public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
 values(p_lobby,v_rev+1,p_request,p_actor,'calendar_initialized',
   jsonb_build_object('season_year',p_season_year,'games',v_count,'first_date',v_first,'last_date',v_last));
 return jsonb_build_object('ok',true,'revision',v_rev+1,'seasonYear',p_season_year,'games',v_count);
end;$$;
revoke all on function public.bm_online_initialize_calendar_phase2d1(uuid,uuid,uuid,bigint,int,jsonb) from public,anon,authenticated;
grant execute on function public.bm_online_initialize_calendar_phase2d1(uuid,uuid,uuid,bigint,int,jsonb) to service_role;
commit;
