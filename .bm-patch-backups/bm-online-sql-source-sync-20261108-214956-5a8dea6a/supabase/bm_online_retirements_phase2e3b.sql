-- Phase 2E.3-B — original NBA retirement engine, authoritative ownership ledger.
-- Apply manually after the previous Online Draft/Rookie patches. No source rewrite.
-- Safeguard: future lottery draws require retirement stage completion, as in single-player.
begin;
create or replace function public.bm_online_apply_retirements_phase2e3b(
 p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,
 p_input_hash text,p_season_year int,p_team_removals jsonb,p_free_removals jsonb,
 p_retired jsonb,p_summary jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_state jsonb;v_next jsonb;v_revision bigint;v_previous public.bm_online_franchise_events%rowtype;
 v_post jsonb;v_teams jsonb;v_team jsonb;v_new_teams jsonb:='[]'::jsonb;
 v_arr jsonb;v_next_arr jsonb;v_row jsonb;v_old jsonb;v_record jsonb;
 v_team_name text;v_id text;v_seen text[]:=array[]::text[];v_seen_records text[]:=array[]::text[];v_removed int:=0;
 v_conf text;v_conf_teams jsonb;v_new_conf jsonb;v_free jsonb;v_next_free jsonb;
 v_history jsonb;v_matches int;v_original_team text;
begin
 if p_lobby is null or p_actor is null or p_request is null or
    p_expected_revision<1 or p_season_year not between 2026 and 2100 or
    p_input_hash is null or p_input_hash !~ '^[0-9a-f]{64}$' or
    pg_catalog.jsonb_typeof(p_team_removals)<>'array' or
    pg_catalog.jsonb_typeof(p_free_removals)<>'array' or
    pg_catalog.jsonb_typeof(p_retired)<>'array' or
    pg_catalog.jsonb_typeof(p_summary)<>'object' or
    pg_catalog.jsonb_array_length(p_team_removals)>650 or
    pg_catalog.jsonb_array_length(p_free_removals)>2000 or
    pg_catalog.jsonb_array_length(p_retired)>2650 or
    pg_catalog.octet_length(p_retired::text)>2500000
 then raise exception 'Invalid retirement request';end if;
 select r.state,r.revision into v_state,v_revision
   from public.bm_online_franchise_runtime r where r.lobby_id=p_lobby for update;
 if not found then raise exception 'Shared league is unavailable';end if;
 if not exists(select 1 from public.bm_online_lobbies l
   where l.id=p_lobby and l.status='started' and l.host_id=p_actor) or
   not exists(select 1 from public.bm_online_lobby_members m
     where m.lobby_id=p_lobby and m.user_id=p_actor)
 then raise exception 'Only the authorized league host may finalize retirements';end if;
 select * into v_previous from public.bm_online_franchise_events e
   where e.lobby_id=p_lobby and e.request_id=p_request;
 if found then
   if v_previous.actor_id is distinct from p_actor or
      v_previous.action_type<>'online_player_retirements' or
      v_previous.details->>'inputHash' is distinct from p_input_hash
   then raise exception 'Retirement request ID was reused for another action';end if;
   return pg_catalog.jsonb_build_object('ok',true,'replayed',true,'revision',v_previous.revision);
 end if;
 if v_revision<>p_expected_revision then raise exception 'Shared league changed; refresh';end if;
 v_post:=v_state->'onlinePostseason';
 if v_post->>'phase'<>'postseasonComplete' or
    pg_catalog.length(coalesce(v_post->>'champion',''))=0 or
    p_season_year is distinct from ((v_post->>'seasonYear')::int+1)
 then raise exception 'Official NBA Finals must be complete before retirements';end if;
 if coalesce(v_state->'onlineDraftLottery','null'::jsonb)<>'null'::jsonb or
    coalesce(v_state->'onlineDraft','null'::jsonb)<>'null'::jsonb or
    coalesce(v_state#>>'{onlineRetirements,status}','')='complete' or
    coalesce(v_state#>>'{offseasonState,retirementsComplete}','false')='true'
 then raise exception 'Retirement stage must be run exactly once, before the lottery';end if;
 if (p_summary->>'retiredCount')::int is distinct from pg_catalog.jsonb_array_length(p_retired) or
    (p_summary->>'seasonYear')::int is distinct from p_season_year or
    pg_catalog.jsonb_array_length(p_retired) <>
      pg_catalog.jsonb_array_length(p_team_removals)+pg_catalog.jsonb_array_length(p_free_removals)
 then raise exception 'Retirement history and removals are inconsistent';end if;
 if pg_catalog.jsonb_typeof(v_state->'teams')='array' then
   v_teams:=v_state->'teams';
 else
   select pg_catalog.coalesce(pg_catalog.jsonb_agg(t.value),'[]'::jsonb) into v_teams
     from pg_catalog.jsonb_each(v_state->'conferences') c,
       pg_catalog.jsonb_array_elements(c.value) t;
 end if;
 if pg_catalog.jsonb_array_length(v_teams)<>30 or
    (select count(distinct t->>'name') from pg_catalog.jsonb_array_elements(v_teams) t)<>30
 then raise exception 'NBA roster list is invalid';end if;
 -- Pre-check every removal against the locked current roster. Exactly one owner;
 -- no player may be retired twice or injected by the backend payload.
 for v_row in select value from pg_catalog.jsonb_array_elements(p_team_removals) loop
   v_team_name:=v_row->>'teamName';v_id:=v_row->>'id';
   if v_id is null or pg_catalog.length(v_id)>150 or v_id=any(v_seen) or
      v_team_name is null or
      not exists(select 1 from pg_catalog.jsonb_array_elements(v_teams) t
          where t->>'name'=v_team_name and
          exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(t->'players','[]'::jsonb)) p
                where p->>'id'=v_id))
   then raise exception 'Invalid or previously moved retirement player';end if;
   v_seen:=pg_catalog.array_append(v_seen,v_id);
 end loop;
 for v_row in select value from pg_catalog.jsonb_array_elements(p_free_removals) loop
   v_id:=v_row#>>'{}';
   if v_id is null or pg_catalog.length(v_id)>150 or v_id=any(v_seen) or
      not exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(v_state->'freeAgents','[]'::jsonb)) p
         where p->>'id'=v_id)
   then raise exception 'Invalid or duplicate free agent retirement';end if;
   v_seen:=pg_catalog.array_append(v_seen,v_id);
 end loop;
 -- Independently ensure that each appended record belongs to exactly one
 -- original player and matches immutable identifying fields.
 for v_record in select value from pg_catalog.jsonb_array_elements(p_retired) loop
   v_id:=v_record->>'id';
   if v_id is null or not (v_id=any(v_seen)) or v_id=any(v_seen_records) or
      v_record->>'retired'<>'true' or (v_record->>'retiredSeasonYear')::int<>p_season_year or
      coalesce((v_record->>'retirementProbability')::numeric,-1) not between 0 and 1 or
      coalesce((v_record->>'retirementRoll')::numeric,-1) not between 0 and 1 or
      exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(v_state->'retiredPlayersHistory','[]'::jsonb)) p
        where p->>'id'=v_id)
   then raise exception 'Retirement history contains invalid or existing player';end if;
   select t.value into v_team from pg_catalog.jsonb_array_elements(v_teams) t
     where exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(t.value->'players','[]'::jsonb)) p
       where p->>'id'=v_id);
   if found then
     v_original_team:=v_team->>'name';
     select p.value into v_old from pg_catalog.jsonb_array_elements(v_team->'players') p
       where p.value->>'id'=v_id;
   else
     v_original_team:='Free Agency';
     select p.value into v_old from pg_catalog.jsonb_array_elements(coalesce(v_state->'freeAgents','[]'::jsonb)) p
       where p.value->>'id'=v_id;
   end if;
   if v_old is null or v_record->>'name' is distinct from coalesce(v_old->>'name',v_old->>'playerName',v_old->>'player','Unknown') or
      v_record->>'retiredFromTeam' is distinct from v_original_team or
      (v_record->>'age')::int is distinct from coalesce((v_old->>'age')::int,0) or
      (v_record->>'overall')::int is distinct from coalesce((v_old->>'overall')::int,(v_old->>'ovr')::int,0)
   then raise exception 'Retirement record does not match its original player';end if;
   v_seen_records:=pg_catalog.array_append(v_seen_records,v_id);
   v_removed:=v_removed+1;
 end loop;
 if v_removed<>pg_catalog.array_length(v_seen,1) and not (v_removed=0 and pg_catalog.array_length(v_seen,1) is null)
 then raise exception 'Retirement players were not represented exactly once';end if;
 -- Remove only selected standard roster members; team metadata and other
 -- player buckets remain untouched. Keep original order for every survivor.
 for v_team in select value from pg_catalog.jsonb_array_elements(v_teams) loop
   v_team_name:=v_team->>'name';
   select pg_catalog.coalesce(pg_catalog.jsonb_agg(p.value order by p.ordinality),'[]'::jsonb)
      into v_next_arr from pg_catalog.jsonb_array_elements(coalesce(v_team->'players','[]'::jsonb)) with ordinality p
      where not exists(select 1 from pg_catalog.jsonb_array_elements(p_team_removals) rem
       where rem->>'teamName'=v_team_name and rem->>'id'=p.value->>'id');
   v_new_teams:=v_new_teams||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_set(v_team,'{players}',v_next_arr,true));
 end loop;
 if pg_catalog.jsonb_typeof(v_state->'teams')='array' then
   v_next:=pg_catalog.jsonb_set(v_state,'{teams}',v_new_teams,true);
 else
   v_next:=v_state;
   for v_conf in select key from pg_catalog.jsonb_each(v_state->'conferences') loop
     v_new_conf:='[]'::jsonb;
     for v_team in select value from pg_catalog.jsonb_array_elements(v_state#>array['conferences',v_conf]) loop
       select t.value into v_row from pg_catalog.jsonb_array_elements(v_new_teams) t
         where t.value->>'name'=v_team->>'name';
       v_new_conf:=v_new_conf||pg_catalog.jsonb_build_array(v_row);
     end loop;
     v_next:=pg_catalog.jsonb_set(v_next,array['conferences',v_conf],v_new_conf,false);
   end loop;
 end if;
 select pg_catalog.coalesce(pg_catalog.jsonb_agg(p.value order by p.ordinality),'[]'::jsonb)
    into v_next_free from pg_catalog.jsonb_array_elements(coalesce(v_state->'freeAgents','[]'::jsonb)) with ordinality p
     where not exists(select 1 from pg_catalog.jsonb_array_elements(p_free_removals) rem
        where rem#>>'{}'=p.value->>'id');
 v_next:=pg_catalog.jsonb_set(v_next,'{freeAgents}',v_next_free,true);
 v_history:=coalesce(v_state->'retiredPlayersHistory','[]'::jsonb)||p_retired;
 v_next:=pg_catalog.jsonb_set(v_next,'{retiredPlayersHistory}',v_history,true);
 v_next:=pg_catalog.jsonb_set(v_next,'{onlineRetirements}',pg_catalog.jsonb_build_object(
    'status','complete','seasonYear',p_season_year,'retiredPlayers',p_retired,'summary',p_summary),true);
 v_next:=pg_catalog.jsonb_set(v_next,'{offseasonState}',
    coalesce(v_next->'offseasonState','{}'::jsonb)||
    pg_catalog.jsonb_build_object('seasonYear',p_season_year,'active',true,'retirementsComplete',true),true);
 perform pg_catalog.set_config('bm.online_postseason_write','1',true);
 perform pg_catalog.set_config('bm.online_retirement_write',p_lobby::text,true);
 update public.bm_online_franchise_runtime r set state=v_next,revision=v_revision+1,updated_at=now()
    where r.lobby_id=p_lobby;
 insert into public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
 values(p_lobby,v_revision+1,p_request,p_actor,'online_player_retirements',
   pg_catalog.jsonb_build_object('seasonYear',p_season_year,'count',v_removed,'inputHash',p_input_hash));
 return pg_catalog.jsonb_build_object('ok',true,'revision',v_revision+1,'count',v_removed);
end $$;
revoke all on function public.bm_online_apply_retirements_phase2e3b(uuid,uuid,uuid,bigint,text,int,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.bm_online_apply_retirements_phase2e3b(uuid,uuid,uuid,bigint,text,int,jsonb,jsonb,jsonb,jsonb) to service_role;

-- Prevent a stale client from drawing the lottery before retirements, or
-- forging a completed retirement stage through an unrelated write endpoint.
create or replace function public.bm_online_retirement_runtime_guard_phase2e3b()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if pg_catalog.current_setting('bm.online_retirement_write',true) is distinct from new.lobby_id::text then
   if old.state->'onlineRetirements' is distinct from new.state->'onlineRetirements' or
      old.state->'retiredPlayersHistory' is distinct from new.state->'retiredPlayersHistory' or
      old.state#>'{offseasonState,retirementsComplete}' is distinct from new.state#>'{offseasonState,retirementsComplete}'
   then raise exception 'Only the trusted retirement event can update retired-player records';end if;
 end if;
 if coalesce(old.state->'onlineDraftLottery','null'::jsonb)='null'::jsonb and
    coalesce(new.state->'onlineDraftLottery','null'::jsonb)<>'null'::jsonb and
    coalesce(old.state#>>'{onlineRetirements,status}','')<>'complete'
 then raise exception 'Player retirements must complete before the official NBA Draft Lottery';end if;
 return new;
end $$;
revoke all on function public.bm_online_retirement_runtime_guard_phase2e3b() from public,anon,authenticated;
drop trigger if exists bm_online_retirement_runtime_guard_phase2e3b on public.bm_online_franchise_runtime;
create trigger bm_online_retirement_runtime_guard_phase2e3b before update on public.bm_online_franchise_runtime
 for each row execute function public.bm_online_retirement_runtime_guard_phase2e3b();
commit;
