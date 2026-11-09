-- Phase 2E.4-A: Server-authoritative player/team options.
-- Manual application ONLY after 2E.3-B. No browser may call these functions.
begin;
create or replace function public.bm_online_submit_options_phase2e4a(
 p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,
 p_year int,p_input_hash text,p_decisions jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_state jsonb;v_rev bigint;v_prior public.bm_online_franchise_events%rowtype;
 v_team_name text;v_team jsonb;v_next jsonb;v_stage jsonb;v_group text;v_id text;v_choice jsonb;
begin
 if p_lobby is null or p_actor is null or p_request is null or
    p_expected_revision<1 or p_year not between 2026 and 2100 or
    p_input_hash is null or p_input_hash !~ '^[0-9a-f]{64}$' or
    pg_catalog.jsonb_typeof(p_decisions)<>'object' or
    (select count(*) from pg_catalog.jsonb_object_keys(p_decisions))<>3 or
    not (p_decisions ?& array['teamOptions','twoWay','stash']) or
    pg_catalog.octet_length(p_decisions::text)>12000
 then raise exception 'Invalid options decision payload';end if;
 select r.state,r.revision into v_state,v_rev from public.bm_online_franchise_runtime r
  where r.lobby_id=p_lobby for update;
 if not found then raise exception 'Online franchise does not exist';end if;
 select m.team_name into v_team_name from public.bm_online_lobby_members m
  join public.bm_online_lobbies l on l.id=m.lobby_id
  where l.id=p_lobby and l.status='started' and m.user_id=p_actor;
 if v_team_name is null then raise exception 'Not a member with an assigned NBA team';end if;
 select * into v_prior from public.bm_online_franchise_events e
  where e.lobby_id=p_lobby and e.request_id=p_request;
 if found then
  if v_prior.actor_id is distinct from p_actor or
     v_prior.action_type<>'online_options_submit' or
     v_prior.details->>'inputHash' is distinct from p_input_hash
  then raise exception 'Options request ID reused for a different operation';end if;
  return pg_catalog.jsonb_build_object('ok',true,'replayed',true,'revision',v_prior.revision);
 end if;
 if v_rev<>p_expected_revision then raise exception 'Shared league revision changed';end if;
 if v_state#>>'{onlinePostseason,phase}'<>'postseasonComplete' or
    v_state#>>'{onlineRetirements,status}'<>'complete' or
    v_state#>>'{onlineDraft,status}'<>'complete' or
    v_state#>>'{onlineRookieSignings,status}'<>'complete' or
    (v_state#>>'{onlineDraft,draftYear}')::int is distinct from p_year or
    coalesce(v_state#>>'{onlineOptions,status}','collecting')='complete' or
    coalesce(v_state#>>'{offseasonState,optionsComplete}','false')='true'
 then raise exception 'Not currently in the option decision window';end if;
 if v_state#>'{onlineOptions,decisionsByTeam}' ? v_team_name then
    raise exception 'This GM has already locked in options';end if;
 if pg_catalog.jsonb_typeof(v_state->'teams')='array' then
  select t.value into v_team from pg_catalog.jsonb_array_elements(v_state->'teams') t where t.value->>'name'=v_team_name;
 else
  select t.value into v_team from pg_catalog.jsonb_each(v_state->'conferences') c,
   pg_catalog.jsonb_array_elements(c.value) t where t.value->>'name'=v_team_name;
 end if;
 if v_team is null then raise exception 'Cannot find current controlled team';end if;
 for v_group,v_choice in select key,value from pg_catalog.jsonb_each(p_decisions) loop
  if pg_catalog.jsonb_typeof(v_choice)<>'object' or
     (select count(*) from pg_catalog.jsonb_object_keys(v_choice))>25
  then raise exception 'Invalid option choice group';end if;
  for v_id,v_choice in select key,value from pg_catalog.jsonb_each(v_choice) loop
   if pg_catalog.length(v_id)>150 or pg_catalog.length(v_id)=0 or
      not exists(select 1 from pg_catalog.jsonb_array_elements(
        case v_group when 'teamOptions' then coalesce(v_team->'players','[]'::jsonb)
          when 'twoWay' then coalesce(v_team->'twoWayPlayers','[]'::jsonb)
          else coalesce(v_team->'stashPlayers','[]'::jsonb) end) p
        where p.value->>'id'=v_id)
   then raise exception 'Option player is not in the controlled roster';end if;
   if (v_group='teamOptions' and pg_catalog.jsonb_typeof(v_choice)<>'boolean') or
      (v_group='twoWay' and v_choice#>>'{}' not in ('extend','convert','release')) or
      (v_group='stash' and v_choice#>>'{}' not in ('two_way','standard','release'))
   then raise exception 'Illegal option choice';end if;
  end loop;
 end loop;
 v_stage:=coalesce(v_state->'onlineOptions','{}'::jsonb);
 v_stage:=v_stage||pg_catalog.jsonb_build_object('status','collecting','year',p_year,
   'decisionsByTeam',coalesce(v_stage->'decisionsByTeam','{}'::jsonb));
 v_stage:=pg_catalog.jsonb_set(v_stage,array['decisionsByTeam',v_team_name],p_decisions,true);
 v_next:=pg_catalog.jsonb_set(v_state,'{onlineOptions}',v_stage,true);
 perform pg_catalog.set_config('bm.online_options_write',p_lobby::text,true);
 update public.bm_online_franchise_runtime r set state=v_next,revision=v_rev+1,updated_at=now() where r.lobby_id=p_lobby;
 insert into public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
 values(p_lobby,v_rev+1,p_request,p_actor,'online_options_submit',
  pg_catalog.jsonb_build_object('teamName',v_team_name,'year',p_year,'inputHash',p_input_hash));
 return pg_catalog.jsonb_build_object('ok',true,'revision',v_rev+1);
end $$;
revoke all on function public.bm_online_submit_options_phase2e4a(uuid,uuid,uuid,bigint,int,text,jsonb) from public,anon,authenticated;
grant execute on function public.bm_online_submit_options_phase2e4a(uuid,uuid,uuid,bigint,int,text,jsonb) to service_role;

create or replace function public.bm_online_finalize_options_phase2e4a(
 p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,p_year int,
 p_input_hash text,p_teams jsonb,p_free_agents jsonb,p_summary jsonb,p_decision_log jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_state jsonb;v_next jsonb;v_rev bigint;v_prior public.bm_online_franchise_events%rowtype;
 v_old_teams jsonb;v_old_team jsonb;v_new_team jsonb;v_old_free jsonb;
 v_out jsonb;v_group jsonb;v_conf text;v_id text;v_old_ids text[]:=array[]::text[];
 v_new_ids text[]:=array[]::text[];v_own_ids text[];v_team_name text;
 v_player jsonb;v_bucket text;v_member record;v_count int:=0;
begin
 if p_lobby is null or p_actor is null or p_request is null or
    p_expected_revision<1 or p_year not between 2026 and 2100 or
    p_input_hash is null or p_input_hash !~ '^[0-9a-f]{64}$' or
    pg_catalog.jsonb_typeof(p_teams)<>'array' or pg_catalog.jsonb_array_length(p_teams)<>30 or
    pg_catalog.jsonb_typeof(p_free_agents)<>'array' or
    pg_catalog.jsonb_typeof(p_summary)<>'object' or
    (p_summary->>'seasonYear')::int is distinct from p_year or
    pg_catalog.jsonb_typeof(p_decision_log)<>'array' or
    pg_catalog.jsonb_array_length(p_decision_log)>2500 or
    pg_catalog.octet_length(p_teams::text)>20000000 or
    pg_catalog.octet_length(p_free_agents::text)>7000000
 then raise exception 'Invalid original-engine options result';end if;
 select r.state,r.revision into v_state,v_rev from public.bm_online_franchise_runtime r
  where r.lobby_id=p_lobby for update;
 if not found then raise exception 'Shared league not found';end if;
 if not exists(select 1 from public.bm_online_lobbies l
   join public.bm_online_lobby_members m on m.lobby_id=l.id and m.user_id=p_actor
   where l.id=p_lobby and l.host_id=p_actor and l.status='started')
 then raise exception 'Only the authorized league host can finalize options';end if;
 select * into v_prior from public.bm_online_franchise_events e
  where e.lobby_id=p_lobby and e.request_id=p_request;
 if found then
  if v_prior.actor_id is distinct from p_actor or
     v_prior.action_type<>'online_options_finalize' or
     v_prior.details->>'inputHash' is distinct from p_input_hash
  then raise exception 'Options request ID reused';end if;
  return pg_catalog.jsonb_build_object('ok',true,'replayed',true,'revision',v_prior.revision);
 end if;
 if v_rev<>p_expected_revision then raise exception 'Shared league revision changed';end if;
 if v_state#>>'{onlinePostseason,phase}'<>'postseasonComplete' or
    v_state#>>'{onlineRetirements,status}'<>'complete' or
    v_state#>>'{onlineDraft,status}'<>'complete' or
    v_state#>>'{onlineRookieSignings,status}'<>'complete' or
    (v_state#>>'{onlineDraft,draftYear}')::int is distinct from p_year or
    coalesce(v_state#>>'{onlineOptions,status}','collecting')='complete' or
    coalesce(v_state#>>'{offseasonState,optionsComplete}','false')='true'
 then raise exception 'Options are not in a finalizable offseason state';end if;
 for v_member in select m.team_name from public.bm_online_lobby_members m
    where m.lobby_id=p_lobby and m.team_name is not null loop
   if not (coalesce(v_state#>'{onlineOptions,decisionsByTeam}','{}'::jsonb) ? v_member.team_name)
   then raise exception 'A human GM has not submitted option decisions';end if;
   v_count:=v_count+1;
 end loop;
 if v_count not between 1 and 4 or
    (select count(*) from pg_catalog.jsonb_object_keys(coalesce(v_state#>'{onlineOptions,decisionsByTeam}','{}'::jsonb)))<>v_count
 then raise exception 'Unexpected human option submissions';end if;
 if pg_catalog.jsonb_typeof(v_state->'teams')='array' then v_old_teams:=v_state->'teams';
 else
  select coalesce(pg_catalog.jsonb_agg(t.value),'[]'::jsonb) into v_old_teams
  from pg_catalog.jsonb_each(v_state->'conferences') c, pg_catalog.jsonb_array_elements(c.value) t;
 end if;
 if pg_catalog.jsonb_array_length(v_old_teams)<>30 or
    (select count(distinct t->>'name') from pg_catalog.jsonb_array_elements(p_teams) t)<>30
 then raise exception 'Invalid NBA team map';end if;
 -- Independent locked-state checks. Teams cannot be added, removed, renamed, or
 -- have non-roster metadata rewritten by this contract operation.
 for v_new_team in select value from pg_catalog.jsonb_array_elements(p_teams) loop
  v_team_name:=v_new_team->>'name';
  select t.value into v_old_team from pg_catalog.jsonb_array_elements(v_old_teams) t
    where t.value->>'name'=v_team_name;
  if v_old_team is null or
     (v_old_team-'players'-'twoWayPlayers'-'stashPlayers') is distinct from
       (v_new_team-'players'-'twoWayPlayers'-'stashPlayers')
  then raise exception 'Options attempted to modify unrelated NBA team data';end if;
  v_own_ids:=array[]::text[];
  foreach v_bucket in array array['players','twoWayPlayers','stashPlayers'] loop
   for v_player in select value from pg_catalog.jsonb_array_elements(coalesce(v_old_team->v_bucket,'[]'::jsonb)) loop
    v_id:=v_player->>'id';
    if v_id is null or pg_catalog.length(v_id)>150 or v_id=any(v_old_ids) or v_id=any(v_own_ids)
    then raise exception 'Invalid existing player ID in online options';end if;
    v_old_ids:=pg_catalog.array_append(v_old_ids,v_id);
    v_own_ids:=pg_catalog.array_append(v_own_ids,v_id);
   end loop;
  end loop;
  foreach v_bucket in array array['players','twoWayPlayers','stashPlayers'] loop
   for v_player in select value from pg_catalog.jsonb_array_elements(coalesce(v_new_team->v_bucket,'[]'::jsonb)) loop
    v_id:=v_player->>'id';
    if v_id is null or not v_id=any(v_own_ids) or v_id=any(v_new_ids) or
       coalesce(v_player->>'name','')='' or
       not exists (select 1 from pg_catalog.jsonb_array_elements(
         coalesce(v_old_team->'players','[]'::jsonb)||
         coalesce(v_old_team->'twoWayPlayers','[]'::jsonb)||
         coalesce(v_old_team->'stashPlayers','[]'::jsonb)) orig
         where orig.value->>'id'=v_id and
         (orig.value->'name') is not distinct from (v_player->'name') and
         (orig.value->'age') is not distinct from (v_player->'age') and
         (orig.value->'overall') is not distinct from (v_player->'overall') and
         (orig.value->'potential') is not distinct from (v_player->'potential') and
         (orig.value->'pos') is not distinct from (v_player->'pos')) then
      raise exception 'Options produced a new, duplicate, or cross-team player';end if;
    v_new_ids:=pg_catalog.array_append(v_new_ids,v_id);
   end loop;
  end loop;
 end loop;
 -- Existing free agents must stay available, while expired/declined-contract
 -- players move from their ORIGINAL team into the same unique free-agent pool.
 v_old_free:=coalesce(v_state->'freeAgents','[]'::jsonb);
 for v_player in select value from pg_catalog.jsonb_array_elements(v_old_free) loop
  v_id:=v_player->>'id';
  if v_id is null or v_id=any(v_old_ids) then raise exception 'Invalid original free agent ID';end if;
  v_old_ids:=pg_catalog.array_append(v_old_ids,v_id);
 end loop;
 for v_player in select value from pg_catalog.jsonb_array_elements(p_free_agents) loop
  v_id:=v_player->>'id';
  if v_id is null or not v_id=any(v_old_ids) or v_id=any(v_new_ids) or
     coalesce(v_player->>'name','')='' or
     not exists (select 1 from (
       select p.value as original from pg_catalog.jsonb_array_elements(v_old_free) p
       union all
       select p.value as original from pg_catalog.jsonb_array_elements(v_old_teams) t,
         pg_catalog.jsonb_array_elements(
           coalesce(t.value->'players','[]'::jsonb)||
           coalesce(t.value->'twoWayPlayers','[]'::jsonb)||
           coalesce(t.value->'stashPlayers','[]'::jsonb)) p) olds
       where olds.original->>'id'=v_id and
         olds.original->'name' is not distinct from v_player->'name' and
         olds.original->'age' is not distinct from v_player->'age' and
         olds.original->'overall' is not distinct from v_player->'overall' and
         olds.original->'potential' is not distinct from v_player->'potential' and
         olds.original->'pos' is not distinct from v_player->'pos') then
   raise exception 'Options created or duplicated a free-agent identity';end if;
  v_new_ids:=pg_catalog.array_append(v_new_ids,v_id);
 end loop;
 if pg_catalog.array_length(v_old_ids,1) is distinct from pg_catalog.array_length(v_new_ids,1) then
  raise exception 'Options dropped or duplicated roster players';end if;
 v_next:=v_state;
 if pg_catalog.jsonb_typeof(v_state->'teams')='array' then
  v_out:='[]'::jsonb;
  for v_old_team in select value from pg_catalog.jsonb_array_elements(v_old_teams) loop
   select t.value into v_new_team from pg_catalog.jsonb_array_elements(p_teams) t
    where t.value->>'name'=v_old_team->>'name';
   v_out:=v_out||pg_catalog.jsonb_build_array(v_new_team);
  end loop;
  v_next:=pg_catalog.jsonb_set(v_next,'{teams}',v_out,true);
 else
  for v_conf,v_group in select key,value from pg_catalog.jsonb_each(v_state->'conferences') loop
   v_out:='[]'::jsonb;
   for v_old_team in select value from pg_catalog.jsonb_array_elements(v_group) loop
    select t.value into v_new_team from pg_catalog.jsonb_array_elements(p_teams) t
     where t.value->>'name'=v_old_team->>'name';
    v_out:=v_out||pg_catalog.jsonb_build_array(v_new_team);
   end loop;
   v_next:=pg_catalog.jsonb_set(v_next,array['conferences',v_conf],v_out,false);
  end loop;
 end if;
 v_next:=pg_catalog.jsonb_set(v_next,'{freeAgents}',p_free_agents,true);
 v_next:=pg_catalog.jsonb_set(v_next,'{onlineOptions}',
    coalesce(v_state->'onlineOptions','{}'::jsonb)||pg_catalog.jsonb_build_object(
      'status','complete','year',p_year,'summary',p_summary,'decisionLog',p_decision_log),true);
 v_next:=pg_catalog.jsonb_set(v_next,'{offseasonState}',
    coalesce(v_state->'offseasonState','{}'::jsonb)||pg_catalog.jsonb_build_object(
      'seasonYear',p_year,'active',true,'optionsComplete',true,'optionsResolvedSeasonYear',p_year,
      'rightsManagementComplete',false),true);
 perform pg_catalog.set_config('bm.online_options_write',p_lobby::text,true);
 perform pg_catalog.set_config('bm.online_postseason_write','1',true);
 update public.bm_online_franchise_runtime r set state=v_next,revision=v_rev+1,updated_at=now()
  where r.lobby_id=p_lobby;
 insert into public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
 values(p_lobby,v_rev+1,p_request,p_actor,'online_options_finalize',
  pg_catalog.jsonb_build_object('year',p_year,'count',pg_catalog.jsonb_array_length(p_decision_log),'inputHash',p_input_hash));
 return pg_catalog.jsonb_build_object('ok',true,'revision',v_rev+1,'count',pg_catalog.jsonb_array_length(p_decision_log));
end $$;
revoke all on function public.bm_online_finalize_options_phase2e4a(uuid,uuid,uuid,bigint,int,text,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.bm_online_finalize_options_phase2e4a(uuid,uuid,uuid,bigint,int,text,jsonb,jsonb,jsonb,jsonb) to service_role;

create or replace function public.bm_online_options_guard_phase2e4a()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if pg_catalog.current_setting('bm.online_options_write',true) is distinct from new.lobby_id::text then
  if old.state->'onlineOptions' is distinct from new.state->'onlineOptions' or
     old.state#>'{offseasonState,optionsComplete}' is distinct from new.state#>'{offseasonState,optionsComplete}' or
     old.state#>'{offseasonState,optionsResolvedSeasonYear}' is distinct from new.state#>'{offseasonState,optionsResolvedSeasonYear}'
  then raise exception 'Only trusted Online Options may change the options window';end if;
 end if;
 return new;
end $$;
revoke all on function public.bm_online_options_guard_phase2e4a() from public,anon,authenticated;
drop trigger if exists bm_online_options_guard_phase2e4a on public.bm_online_franchise_runtime;
create trigger bm_online_options_guard_phase2e4a before update on public.bm_online_franchise_runtime
 for each row execute function public.bm_online_options_guard_phase2e4a();
commit;
