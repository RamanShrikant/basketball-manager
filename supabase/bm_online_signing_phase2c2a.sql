-- Basketball Manager Online 2C.2A: one-year, CAP-ROOM-ONLY free-agent signing.
-- Requires Phase 2A and 2C.1 runtime + events; ONLINE ONLY. No single-player tables.
-- Intentionally rejects full rosters, RFA rights, 2-way deals, all exceptions and future seasons.
-- This narrow first transaction allows real atomic conflict testing, NOT full NBA free agency.
begin;

create or replace function public.bm_online_sign_cap_room_free_agent(
  p_lobby uuid, p_request uuid, p_expected_revision bigint,
  p_player_id text, p_first_year_salary bigint
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_team text;
  v_status text;
  v_state jsonb;
  v_revision bigint;
  v_prior public.bm_online_franchise_events%rowtype;
  v_free jsonb;
  v_player jsonb;
  v_player_index integer;
  v_matches integer := 0;
  v_team_path text[];
  v_team_obj jsonb;
  v_team_players jsonb;
  v_standard_count integer := 0;
  v_payroll numeric := 0;
  v_salary numeric;
  v_year integer;
  v_cap numeric;
  v_min numeric := 1200000;
  v_max numeric := 57800000;
  v_contract jsonb;
  v_new_state jsonb;
  v_new_free jsonb;
  v_total_seen integer := 0;
  v_id text;
  v_p jsonb;
  v_conf text;
  v_team_entry jsonb;
  v_teams jsonb;
  v_index integer;
  v_idx integer;
  v_type text;
begin
  if v_actor is null then raise exception 'Sign in before editing a franchise'; end if;
  if p_lobby is null or p_request is null or p_player_id is null or length(btrim(p_player_id))<1 or length(p_player_id)>120 then
    raise exception 'Invalid transaction identifiers';
  end if;
  if p_first_year_salary is null or p_first_year_salary < 1200000 or p_first_year_salary > 57800000 then
    raise exception 'Only supported one-year salary offers are allowed';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 then raise exception 'Invalid expected revision'; end if;

  -- All roster modifications serialize on ONE row. No browser-wide JSON update privileges.
  select r.state,r.revision into v_state,v_revision
    from public.bm_online_franchise_runtime r where r.lobby_id=p_lobby for update;
  if not found then raise exception 'Shared franchise runtime not found'; end if;
  select l.status,m.team_name into v_status,v_team
    from public.bm_online_lobbies l
    join public.bm_online_lobby_members m on m.lobby_id=l.id and m.user_id=v_actor
    where l.id=p_lobby;
  if not found or v_status <> 'started' or v_team is null then
    raise exception 'You are not an active manager of this started franchise';
  end if;

  -- Retry safety: same request UUID cannot apply twice, even after client timeout.
  select * into v_prior from public.bm_online_franchise_events
    where lobby_id=p_lobby and request_id=p_request;
  if found then
    if v_prior.actor_id <> v_actor or v_prior.action_type <> 'sign_cap_room_free_agent'
      or v_prior.details->>'player_id' <> p_player_id
      or v_prior.details->>'team_name' <> v_team
      or (v_prior.details->>'salary')::bigint <> p_first_year_salary then
      raise exception 'Request ID was reused for another operation';
    end if;
    return jsonb_build_object('ok',true,'revision',v_prior.revision,'replayed',true,
                              'team',v_team,'player_id',p_player_id);
  end if;
  if v_revision <> p_expected_revision then
    raise exception 'Shared league has changed. Refresh and review before trying again (revision %).',v_revision;
  end if;
  if jsonb_typeof(v_state)<>'object' then raise exception 'Invalid runtime state'; end if;
  v_year := case when (v_state->>'seasonYear') ~ '^20[0-9][0-9]$' then (v_state->>'seasonYear')::integer
                 when (v_state->>'seasonStartYear') ~ '^20[0-9][0-9]$' then (v_state->>'seasonStartYear')::integer
                 else 2026 end;
  if v_year<>2026 then raise exception 'Cap-room signing is currently supported for the 2026-27 season only'; end if;
  -- Cap matches the project's 2026-27 financial rules. No mid-level/minimum exceptions yet.
  v_cap := 164961000;
  if jsonb_typeof(v_state->'freeAgents')<>'array' then
    raise exception 'This franchise has no active free-agent market';
  end if;
  v_free := v_state->'freeAgents';
  for v_p,v_idx in select value,ordinality::integer-1 from jsonb_array_elements(v_free) with ordinality loop
    v_id := coalesce(v_p->>'id',v_p->>'playerId');
    if v_id=p_player_id then v_matches:=v_matches+1;v_player:=v_p;v_player_index:=v_idx; end if;
  end loop;
  if v_matches<>1 or v_player is null or jsonb_typeof(v_player)<>'object' then
    raise exception 'Free agent unavailable or ambiguous. Refresh the shared market';
  end if;
  if nullif(btrim(v_player->>'name'),'') is null then raise exception 'Free agent record is invalid'; end if;
  if jsonb_typeof(v_player->'contract')='object' and jsonb_typeof(v_player->'contract'->'salaryByYear')='array'
     and jsonb_array_length(v_player->'contract'->'salaryByYear')>0 then
    raise exception 'An active contract requires a later rights or waiver workflow';
  end if;
  if coalesce(v_player->>'rightsTeamName','')<>'' or coalesce(v_player->>'restricted','false')='true'
     or coalesce(v_player->>'rfa','false')='true' then
    raise exception 'Restricted free agents need a later offer-sheet workflow';
  end if;

  -- Locate the manager's team and reject any duplicate player ID on any roster.
  for v_conf in select x from unnest(array['teams','East','West']) x loop
    if v_conf='teams' then v_teams:=v_state->'teams';
    else v_teams:=v_state#>array['conferences',v_conf]; end if;
    if jsonb_typeof(v_teams)<>'array' then continue; end if;
    for v_team_entry,v_index in select value,ordinality::integer-1 from jsonb_array_elements(v_teams) with ordinality loop
      if v_team_entry->>'name'=v_team then
        if v_team_path is not null then raise exception 'Ambiguous manager team in seed'; end if;
        if v_conf='teams' then v_team_path:=array['teams',v_index::text];
        else v_team_path:=array['conferences',v_conf,v_index::text]; end if;
        v_team_obj:=v_team_entry;
      end if;
      for v_p in select value from jsonb_array_elements(case when jsonb_typeof(v_team_entry->'players')='array' then v_team_entry->'players' else '[]'::jsonb end)
                 union all select value from jsonb_array_elements(case when jsonb_typeof(v_team_entry->'twoWayPlayers')='array' then v_team_entry->'twoWayPlayers' else '[]'::jsonb end)
                 union all select value from jsonb_array_elements(case when jsonb_typeof(v_team_entry->'stashPlayers')='array' then v_team_entry->'stashPlayers' else '[]'::jsonb end)
      loop
        if coalesce(v_p->>'id',v_p->>'playerId')=p_player_id then v_total_seen:=v_total_seen+1; end if;
      end loop;
    end loop;
  end loop;
  if v_total_seen>0 then raise exception 'Player is already assigned to an NBA roster'; end if;
  if v_team_path is null then raise exception 'Your team is missing from this league'; end if;
  if jsonb_typeof(v_team_obj->'players')<>'array' then raise exception 'Team roster is missing'; end if;
  v_team_players:=v_team_obj->'players';
  -- One standard roster slot needed. We don't grant two-way/stash/exception slots here.
  for v_p in select value from jsonb_array_elements(v_team_players) loop
    v_type:=lower(coalesce(v_p->>'rosterStatus',v_p->>'contractType',v_p->'contract'->>'type',''));
    if coalesce((v_p->>'isTwoWay')::boolean,false) or coalesce((v_p->>'isStash')::boolean,false)
       or (v_type like '%two_way%' or v_type like '%two-way%') or v_type like '%stash%' or v_type like '%draft_rights%' then continue; end if;
    v_standard_count:=v_standard_count+1;
    if jsonb_typeof(v_p->'contract')='object' and jsonb_typeof(v_p->'contract'->'salaryByYear')='array' then
      v_idx:=v_year - coalesce(case when (v_p->'contract'->>'startYear')~'^[0-9]{4}$' then (v_p->'contract'->>'startYear')::integer end,v_year);
      if v_idx>=0 and v_idx<jsonb_array_length(v_p->'contract'->'salaryByYear') then
        v_salary:=(v_p->'contract'->'salaryByYear'->>v_idx)::numeric;
      else v_salary:=0; end if;
    elsif (v_p->>'salary')~'^[0-9]+(\.[0-9]+)?$' then v_salary:=(v_p->>'salary')::numeric;
    else raise exception 'Cannot calculate team payroll safely; a player contract is incomplete'; end if;
    if v_salary<0 or v_salary>100000000 then raise exception 'Player salary is out of range'; end if;
    v_payroll:=v_payroll+v_salary;
  end loop;
  if v_standard_count>=15 then raise exception 'Roster has 15 standard contracts. Free a roster slot first'; end if;
  if v_payroll+p_first_year_salary>v_cap then
    raise exception 'Cap-room-only signing cannot exceed the salary cap (payroll %, offer %, cap %).',v_payroll,p_first_year_salary,v_cap;
  end if;
  v_contract:=jsonb_build_object('startYear',v_year,'salaryByYear',jsonb_build_array(p_first_year_salary),
                                 'years',1,'type','standard');
  v_player := (v_player - 'rightsTeamName' - 'restricted' - 'rfa') ||
      jsonb_build_object('contract',v_contract,'salary',p_first_year_salary,'rosterStatus','standard','contractType','standard');
  select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into v_new_free
    from jsonb_array_elements(v_free) with ordinality where ordinality-1<>v_player_index;
  v_new_state := jsonb_set(v_state,'{freeAgents}',v_new_free,false);
  v_new_state := jsonb_set(v_new_state,v_team_path||array['players'],v_team_players||jsonb_build_array(v_player),false);
  if v_new_state=v_state then raise exception 'Transaction did not change the shared roster'; end if;
  update public.bm_online_franchise_runtime set state=v_new_state,revision=revision+1,updated_at=now()
    where lobby_id=p_lobby;
  insert into public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
    values(p_lobby,v_revision+1,p_request,v_actor,'sign_cap_room_free_agent',
      jsonb_build_object('player_id',p_player_id,'player_name',v_player->>'name','team_name',v_team,'salary',p_first_year_salary,'years',1));
  return jsonb_build_object('ok',true,'revision',v_revision+1,'replayed',false,'team',v_team,'player_id',p_player_id);
end $$;

revoke all on function public.bm_online_sign_cap_room_free_agent(uuid,uuid,bigint,text,bigint) from public,anon,authenticated;
grant execute on function public.bm_online_sign_cap_room_free_agent(uuid,uuid,bigint,text,bigint) to authenticated;
commit;
