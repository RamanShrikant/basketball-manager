-- Online Phase 2C.2B: authoritative standard-roster releases.
-- Apply after bm_online_signing_phase2c2a.sql. Only ONLINE tables are written.
-- This implements the current single-player immediate-free-agency release semantics.
-- NBA waiver claims and claim priority are not implemented by this migration.
begin;

create or replace function public.bm_online_release_standard_player(
  p_lobby uuid, p_request uuid, p_expected_revision bigint, p_player_id text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_team text;
  v_state jsonb;
  v_revision bigint;
  v_prior public.bm_online_franchise_events%rowtype;
  v_path text[];
  v_team_obj jsonb;
  v_roster jsonb;
  v_player jsonb;
  v_player_count integer := 0;
  v_total_id_count integer := 0;
  v_p jsonb;
  v_idx integer;
  v_conf text;
  v_teams jsonb;
  v_entry jsonb;
  v_entry_index integer;
  v_year integer;
  v_start_year integer;
  v_salary_items jsonb;
  v_salary numeric;
  v_remaining jsonb := '[]'::jsonb;
  v_dead_rows jsonb := '[]'::jsonb;
  v_dead_map jsonb;
  v_team_dead jsonb;
  v_new_free jsonb;
  v_new_roster jsonb;
  v_new_state jsonb;
  v_released jsonb;
  v_total numeric := 0;
  v_rows integer := 0;
  v_name text;
  v_id text;
  v_group text;
  v_status text;
begin
  if v_actor is null then raise exception 'Sign in before releasing a player'; end if;
  if p_lobby is null or p_request is null or p_player_id is null
     or length(btrim(p_player_id))<1 or length(p_player_id)>120
     or p_expected_revision is null or p_expected_revision<1 then
    raise exception 'Invalid online release request';
  end if;

  -- Lock first, then authorize and test idempotency against the locked revision.
  select r.state, r.revision into v_state, v_revision
    from public.bm_online_franchise_runtime r where r.lobby_id=p_lobby for update;
  if not found then raise exception 'Shared franchise runtime not found'; end if;
  select l.status,m.team_name into v_status,v_team
    from public.bm_online_lobbies l
    join public.bm_online_lobby_members m on m.lobby_id=l.id and m.user_id=v_actor
    where l.id=p_lobby;
  if not found or v_status<>'started' or nullif(btrim(v_team),'') is null then
    raise exception 'You do not control a team in this started franchise';
  end if;
  select * into v_prior from public.bm_online_franchise_events
    where lobby_id=p_lobby and request_id=p_request;
  if found then
    if v_prior.actor_id<>v_actor or v_prior.action_type<>'release_standard_player'
       or v_prior.details->>'player_id'<>p_player_id
       or v_prior.details->>'team_name'<>v_team then
      raise exception 'Request ID reused for a different action';
    end if;
    return jsonb_build_object('ok',true,'replayed',true,'revision',v_prior.revision,
      'player_id',p_player_id,'team',v_team);
  end if;
  if v_revision<>p_expected_revision then
    raise exception 'Shared league changed (revision %). Refresh before releasing.',v_revision;
  end if;
  if jsonb_typeof(v_state)<>'object' or jsonb_typeof(v_state->'freeAgents')<>'array' then
    raise exception 'League roster or free agent market is unavailable';
  end if;
  v_year := case when (v_state->>'seasonYear')~'^20[0-9][0-9]$' then (v_state->>'seasonYear')::integer
                 when (v_state->>'seasonStartYear')~'^20[0-9][0-9]$' then (v_state->>'seasonStartYear')::integer
                 else 2026 end;
  if v_year<>2026 then raise exception 'Online releases currently require the supported 2026-27 season'; end if;

  -- Support both league layouts, but fail closed if the same team is stored twice.
  for v_conf in select x from unnest(array['teams','East','West']) x loop
    if v_conf='teams' then v_teams:=v_state->'teams';
    else v_teams:=v_state#>array['conferences',v_conf]; end if;
    if jsonb_typeof(v_teams)<>'array' then continue; end if;
    for v_entry,v_entry_index in select value,ordinality::integer-1
      from jsonb_array_elements(v_teams) with ordinality loop
      if v_entry->>'name'=v_team then
        if v_path is not null then raise exception 'Ambiguous team layout: refusing unsafe roster edit'; end if;
        if v_conf='teams' then v_path:=array['teams',v_entry_index::text];
        else v_path:=array['conferences',v_conf,v_entry_index::text]; end if;
        v_team_obj:=v_entry;
      end if;
      for v_p in select value from jsonb_array_elements(
        case when jsonb_typeof(v_entry->'players')='array' then v_entry->'players' else '[]'::jsonb end)
        union all select value from jsonb_array_elements(
        case when jsonb_typeof(v_entry->'twoWayPlayers')='array' then v_entry->'twoWayPlayers' else '[]'::jsonb end)
        union all select value from jsonb_array_elements(
        case when jsonb_typeof(v_entry->'stashPlayers')='array' then v_entry->'stashPlayers' else '[]'::jsonb end)
      loop
        if coalesce(v_p->>'id',v_p->>'playerId')=p_player_id then v_total_id_count:=v_total_id_count+1; end if;
      end loop;
    end loop;
  end loop;
  if v_path is null or jsonb_typeof(v_team_obj->'players')<>'array' then
    raise exception 'Assigned standard roster could not be resolved';
  end if;
  if v_total_id_count<>1 then raise exception 'Player is unavailable or has an ambiguous roster identity'; end if;
  v_roster:=v_team_obj->'players';
  for v_p in select value from jsonb_array_elements(v_roster) loop
    if coalesce(v_p->>'id',v_p->>'playerId')=p_player_id then
      v_player_count:=v_player_count+1; v_player:=v_p;
    end if;
  end loop;
  if v_player_count<>1 then raise exception 'Player is not on your standard roster'; end if;
  if coalesce(v_player->>'isTwoWay','false')='true'
     or coalesce(v_player->>'isStash','false')='true'
     or lower(coalesce(v_player->>'rosterStatus',v_player->>'contractType',v_player->'contract'->>'type',''))
        ~ '(two_way|two-way|stash|draft_rights)' then
    raise exception 'Two-way and stashed player releases require their own contract workflow';
  end if;
  v_name:=nullif(btrim(v_player->>'name'),'');
  if v_name is null then raise exception 'Player record is missing its name'; end if;
  for v_p in select value from jsonb_array_elements(v_state->'freeAgents') loop
    if coalesce(v_p->>'id',v_p->>'playerId')=p_player_id then
      raise exception 'Player is already listed in free agency';
    end if;
  end loop;

  -- Conservative financial policy: each remaining contractual salary is
  -- guaranteed, just like the existing Roster release preview. Do not silently
  -- erase money when the contract data is missing or malformed.
  if jsonb_typeof(v_player->'contract')='object'
    and jsonb_typeof(v_player->'contract'->'salaryByYear')='array' then
    v_salary_items:=v_player->'contract'->'salaryByYear';
    if (v_player->'contract'->>'startYear')~'^20[0-9][0-9]$' then
      v_start_year:=(v_player->'contract'->>'startYear')::integer;
    else v_start_year:=v_year; end if;
    if jsonb_array_length(v_salary_items)>10 then raise exception 'Contract duration is unsupported'; end if;
    for v_idx in 0..jsonb_array_length(v_salary_items)-1 loop
      if v_start_year+v_idx < v_year then continue; end if;
      if (v_salary_items->>v_idx) is null or
         (jsonb_typeof(v_salary_items->v_idx)<>'number'
         and (v_salary_items->>v_idx)!~'^[0-9]+(\.[0-9]+)?$') then
        raise exception 'Cannot calculate guaranteed salary from malformed contract';
      end if;
      v_salary:=(v_salary_items->>v_idx)::numeric;
      if v_salary<0 or v_salary>100000000 or v_salary<>trunc(v_salary) then
        raise exception 'Contract salary is outside safe range';
      end if;
      if v_salary=0 then continue; end if;
      v_rows:=v_rows+1;
      v_total:=v_total+v_salary;
      v_remaining:=v_remaining||jsonb_build_array(jsonb_build_object('seasonYear',v_start_year+v_idx,'amount',v_salary));
    end loop;
  elsif (jsonb_typeof(v_player->'contract')='object' and v_player->'contract'<>'{}'::jsonb)
    or (coalesce(v_player->>'salary','0')~'^[0-9]+(\.[0-9]+)?$'
    and (v_player->>'salary')::numeric>0) then
    raise exception 'Cannot safely release player: guaranteed contract breakdown missing';
  end if;
  -- A release must not make the assigned team exceed the permitted roster bounds.
  v_group:='online-release:'||p_request::text;
  for v_p in select value from jsonb_array_elements(v_remaining) loop
    v_dead_rows:=v_dead_rows||jsonb_build_array(jsonb_build_object(
      'playerId',p_player_id,'playerName',v_name,'teamName',v_team,
      'seasonYear',(v_p->>'seasonYear')::integer,'amount',(v_p->>'amount')::numeric,
      'netAmount',(v_p->>'amount')::numeric,'originalAmount',(v_p->>'amount')::numeric,
      'setOffCredit',0,'setOffAmount',0,'offsetAmount',0,
      'reason','release','source','released_player_contract',
      'deadCapMethod','normal_release','stretchApplied',false,
      'deadCapGroupId',v_group,'totalGuaranteedOwed',v_total,
      'remainingContractYears',v_rows,'originalRemainingRows',v_remaining
    ));
  end loop;

  select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb)
    into v_new_roster from jsonb_array_elements(v_roster) with ordinality
    where coalesce(value->>'id',value->>'playerId') is distinct from p_player_id;
  if jsonb_array_length(v_new_roster)<>jsonb_array_length(v_roster)-1 then
    raise exception 'Release roster removal failed';
  end if;
  v_released:=(v_player - 'rightsTeamName' - 'rights' - 'qualifyingOffer' - 'rfa' - 'restricted')
      || jsonb_build_object('previousContract',v_player->'contract',
        'contract',null,'salary',0,'rosterStatus','free_agent',
        'contractType',null,'isTwoWay',false,'isStash',false,'rightsRenounced',true);
  v_new_free:=v_state->'freeAgents'||jsonb_build_array(v_released);
  v_dead_map:=case when jsonb_typeof(v_state->'deadCapByTeam')='object'
    then v_state->'deadCapByTeam' else '{}'::jsonb end;
  v_team_dead:=case when jsonb_typeof(v_dead_map->v_team)='array'
    then v_dead_map->v_team else '[]'::jsonb end;
  v_dead_map:=jsonb_set(v_dead_map,array[v_team],v_team_dead||v_dead_rows,true);
  v_new_state:=jsonb_set(v_state,v_path||array['players'],v_new_roster,false);
  v_new_state:=jsonb_set(v_new_state,'{freeAgents}',v_new_free,false);
  v_new_state:=jsonb_set(v_new_state,'{deadCapByTeam}',v_dead_map,true);
  if v_new_state=v_state then raise exception 'Release produced no change'; end if;
  update public.bm_online_franchise_runtime set state=v_new_state,revision=revision+1,updated_at=now()
    where lobby_id=p_lobby;
  insert into public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
    values(p_lobby,v_revision+1,p_request,v_actor,'release_standard_player',
      jsonb_build_object('player_id',p_player_id,'player_name',v_name,
        'team_name',v_team,'dead_cap_total',v_total,'dead_cap_years',v_rows));
  return jsonb_build_object('ok',true,'replayed',false,'revision',v_revision+1,
    'player_id',p_player_id,'team',v_team,'dead_cap_total',v_total);
end $$;

revoke all on function public.bm_online_release_standard_player(uuid,uuid,bigint,text)
  from public,anon,authenticated;
grant execute on function public.bm_online_release_standard_player(uuid,uuid,bigint,text)
  to authenticated;
commit;
