-- Basketball Manager Online Phase 2E.4-F2: 2027-28 cap-room signings / releases.
-- ONLINE ONLY. Manual migration, no mutation of existing league rows.
-- Prerequisites: 2C2A signing hardening, 2C2B release, 2C2C multi-year,
-- 2E4E completed rollover and 2E4F1 trade compatibility.
-- Limits: 2026 and 2027 only; cap-room standard contracts (not Bird/RFA),
-- and standard guaranteed-salary roster releases. No waiver-claim priority.
-- Replaces exactly 3 RPC definitions after locked baseline/source checks.
BEGIN;
DO $f2_guard$
DECLARE v_def text;
BEGIN
  IF pg_catalog.to_regprocedure('public.bm_online_sign_cap_room_free_agent(uuid,uuid,bigint,text,bigint)') IS NULL THEN
    RAISE EXCEPTION 'Missing Phase 2C prerequisite: bm_online_sign_cap_room_free_agent'; END IF;
  SELECT pg_catalog.pg_get_functiondef('public.bm_online_sign_cap_room_free_agent(uuid,uuid,bigint,text,bigint)'::regprocedure) INTO v_def;
  IF pg_catalog.strpos(v_def,'Cap-room signing is currently supported for the 2026-27 season only') = 0 THEN
    RAISE EXCEPTION 'Unexpected existing bm_online_sign_cap_room_free_agent source. STOP; do not overwrite'; END IF;
  IF pg_catalog.strpos(v_def,'Cannot calculate team dead cap safely') = 0 THEN
    RAISE EXCEPTION 'Signing hardening prerequisite is missing'; END IF;
  IF pg_catalog.to_regprocedure('public.bm_online_sign_cap_room_contract(uuid,uuid,bigint,text,bigint,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'Missing Phase 2C prerequisite: bm_online_sign_cap_room_contract'; END IF;
  SELECT pg_catalog.pg_get_functiondef('public.bm_online_sign_cap_room_contract(uuid,uuid,bigint,text,bigint,integer,text)'::regprocedure) INTO v_def;
  IF pg_catalog.strpos(v_def,'Cap-room signing is currently supported for the 2026-27 season only') = 0 THEN
    RAISE EXCEPTION 'Unexpected existing bm_online_sign_cap_room_contract source. STOP; do not overwrite'; END IF;
  IF pg_catalog.to_regprocedure('public.bm_online_release_standard_player(uuid,uuid,bigint,text)') IS NULL THEN
    RAISE EXCEPTION 'Missing Phase 2C prerequisite: bm_online_release_standard_player'; END IF;
  SELECT pg_catalog.pg_get_functiondef('public.bm_online_release_standard_player(uuid,uuid,bigint,text)'::regprocedure) INTO v_def;
  IF pg_catalog.strpos(v_def,'Online releases currently require the supported 2026-27 season') = 0 THEN
    RAISE EXCEPTION 'Unexpected existing bm_online_release_standard_player source. STOP; do not overwrite'; END IF;
END $f2_guard$;
-- F2: canonical cap-room and season-rollover validation for the first
-- post-rollover year. Pure JSON in, salary cap out; no runtime writes.
CREATE OR REPLACE FUNCTION public.bm_online_f2_cap_room_ceiling(p_state jsonb)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $f2$
DECLARE
  v_year integer;
  v_financials jsonb := p_state->'financials';
  v_base jsonb;
  v_base_year integer;
  v_payroll_year integer;
  v_rate numeric;
  v_cap numeric;
BEGIN
  IF pg_catalog.jsonb_typeof(p_state) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid franchise financial state'; END IF;
  v_year := CASE WHEN (p_state->>'seasonYear') ~ '^20[0-9][0-9]$'
    THEN (p_state->>'seasonYear')::integer
    WHEN (p_state->>'seasonStartYear') ~ '^20[0-9][0-9]$'
    THEN (p_state->>'seasonStartYear')::integer ELSE 0 END;
  IF v_year = 2026 THEN RETURN 164961000; END IF;
  IF v_year <> 2027 THEN RAISE EXCEPTION 'Unsupported regular-season signing year'; END IF;
  IF (p_state->>'seasonYear') IS DISTINCT FROM '2027' OR
     (p_state->>'seasonStartYear') IS DISTINCT FROM '2027' OR
     p_state#>>'{onlineSchedule,seasonYear}' IS DISTINCT FROM '2027' OR
     p_state#>>'{onlineSeasonRollover,toYear}' IS DISTINCT FROM '2027' OR
     p_state#>>'{onlineSeasonRollover,status}' IS DISTINCT FROM 'complete' OR
     p_state#>>'{onlineSchedule,phase}' IS DISTINCT FROM 'regular-season' OR
     p_state->'onlineOffseasonMarket' IS NOT NULL OR
     p_state->'offseasonState' IS NOT NULL THEN
    RAISE EXCEPTION 'Complete the 2027-28 season rollover before regular-season roster transactions'; END IF;
  IF pg_catalog.jsonb_typeof(v_financials) IS DISTINCT FROM 'object' OR
     pg_catalog.jsonb_typeof(v_financials->'baseRules') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Missing immutable financial base rules'; END IF;
  v_base := v_financials->'baseRules';
  IF COALESCE((v_financials->>'baseSeasonYear') ~ '^20[0-9][0-9]$',false) = false OR
     COALESCE((v_financials->>'currentFinancialSeasonYear') ~ '^20[0-9][0-9]$',false) = false OR
     COALESCE((p_state->>'currentFinancialSeasonYear') ~ '^20[0-9][0-9]$',false) = false OR
     COALESCE((v_financials->>'annualInflationRate') ~ '^(0(\.[0-9]+)?|1(\.0+)?)$',false) = false OR
     COALESCE((v_base->>'salaryCap') ~ '^[0-9]+(\.[0-9]+)?$',false) = false THEN
    RAISE EXCEPTION 'Malformed post-rollover cap inputs'; END IF;
  v_base_year := (v_financials->>'baseSeasonYear')::integer;
  v_payroll_year := (v_financials->>'currentFinancialSeasonYear')::integer;
  v_rate := (v_financials->>'annualInflationRate')::numeric;
  IF v_base_year NOT BETWEEN 2026 AND 2028 OR
     v_payroll_year <> 2028 OR
     (p_state->>'currentFinancialSeasonYear')::integer <> 2028 OR
     (v_base->>'salaryCap')::numeric NOT BETWEEN 10000000 AND 500000000 THEN
    RAISE EXCEPTION 'Post-rollover financial years or salary cap are inconsistent'; END IF;
  v_cap := pg_catalog.round((v_base->>'salaryCap')::numeric *
    pg_catalog.power(1 + v_rate, v_payroll_year-v_base_year) / 1000) * 1000;
  IF v_cap < 10000000 OR v_cap > 1000000000 THEN
    RAISE EXCEPTION 'Computed salary cap is out of range'; END IF;
  RETURN v_cap;
END $f2$;
REVOKE ALL ON FUNCTION public.bm_online_f2_cap_room_ceiling(jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bm_online_f2_cap_room_ceiling(jsonb)
 TO service_role;
-- bm_online_sign_cap_room_free_agent: preserve exact auth, team locks, roster/contract/dead-cap logic
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
  v_service_years integer;
  v_draft_year integer;
  v_source jsonb;
  v_key text;
  v_number_text text;
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
  v_dead_rows jsonb;
  v_dead_row jsonb;
  v_dead_season integer;
  v_dead_amount numeric;
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
  if v_year not in (2026,2027) then raise exception 'Unsupported regular-season signing year'; end if;
  -- Cap matches the project's 2026-27 financial rules. No mid-level/minimum exceptions yet.
  v_cap := public.bm_online_f2_cap_room_ceiling(v_state);
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
  -- New 2027-28 signings must respect the same service-year salary window
  -- used by the existing multiyear standard cap-room engine. 2026 unchanged.
  if v_year=2027 then
    v_service_years:=null;
    foreach v_source in array array[v_player,coalesce(v_player->'meta','{}'::jsonb)] loop
      foreach v_key in array array['proSeasons','seasonsPro','yearsPro','yearsOfExperience','yoe','serviceYears'] loop
        v_number_text:=v_source->>v_key;
        if v_number_text is not null and v_number_text<>'' then
          if v_number_text !~ '^[0-9]+(\.[0-9]+)?$' then
            raise exception 'Player service years are malformed'; end if;
          v_service_years:=greatest(0,round(v_number_text::numeric))::integer;
          exit;
        end if;
      end loop;
      exit when v_service_years is not null;
    end loop;
    if v_service_years is null then
      foreach v_source in array array[v_player,coalesce(v_player->'meta','{}'::jsonb),coalesce(v_player->'draft','{}'::jsonb)] loop
        foreach v_key in array array['draftYear','yearDrafted','draftedYear','year'] loop
          v_number_text:=v_source->>v_key;
          if v_number_text ~ '^[0-9]{4}$' and v_number_text::integer between 2000 and 2100 then
            v_draft_year:=v_number_text::integer;
            exit;
          end if;
        end loop;
        exit when v_draft_year is not null;
      end loop;
      if v_draft_year is not null then
        v_service_years:=greatest(0,v_year-v_draft_year); end if;
    end if;
    if v_service_years is null then
      v_number_text:=v_player->>'age';
      v_service_years:=greatest(0,least(25,
        (case when v_number_text ~ '^[0-9]+(\.[0-9]+)?$'
          then round(v_number_text::numeric)::integer else 19 end)-19));
    end if;
    v_min:=case when v_service_years>=10 then 3300000
      when v_service_years>=6 then 2900000
      when v_service_years>=3 then 2500000
      when v_service_years>=2 then 2200000
      when v_service_years>=1 then 1900000 else 1300000 end;
    v_min:=round(v_min*v_cap/164961000/1000)*1000;
    v_max:=round(v_cap*(case when v_service_years>=10 then 0.35
      when v_service_years>=7 then 0.30 else 0.25 end)/1000)*1000;
    if p_first_year_salary<v_min or p_first_year_salary>v_max then
      raise exception '2027-28 offer must be within the player salary window'; end if;
  end if;

  if jsonb_typeof(v_player->'contract')='object' and jsonb_typeof(v_player->'contract'->'salaryByYear')='array'
     and jsonb_array_length(v_player->'contract'->'salaryByYear')>0 then
    raise exception 'An active contract requires a later rights or waiver workflow';
  end if;
  if coalesce(v_player->>'rightsTeamName','')<>'' or coalesce(v_player->'rights'->>'restrictedFreeAgent','false')='true'
     or coalesce((v_player->'qualifyingOffer'->>'amount')::numeric,0)>0 or coalesce(v_player->>'restricted','false')='true'
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
  -- Guaranteed released-player salary remains on the old team's cap.
  -- Release must never create fictitious cap room for another signing.
  v_dead_rows:=v_state#>array['deadCapByTeam',v_team];
  if jsonb_typeof(v_dead_rows)='array' then
    for v_dead_row in select value from jsonb_array_elements(v_dead_rows) loop
      if coalesce(v_dead_row->>'seasonYear','')~'^[0-9]{4}$' then
        v_dead_season:=(v_dead_row->>'seasonYear')::integer;
      else raise exception 'Malformed dead-cap season'; end if;
      if v_dead_season<>v_year then continue; end if;
      if coalesce(v_dead_row->>'amount',v_dead_row->>'netAmount','')!~'^[0-9]+(\.[0-9]+)?$' then
        raise exception 'Cannot calculate team dead cap safely';
      end if;
      v_dead_amount:=coalesce(v_dead_row->>'amount',v_dead_row->>'netAmount')::numeric;
      if v_dead_amount<0 or v_dead_amount>100000000 then
        raise exception 'Dead-cap amount outside safe range'; end if;
      v_payroll:=v_payroll+v_dead_amount;
    end loop;
  end if;
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
REVOKE ALL ON FUNCTION public.bm_online_sign_cap_room_free_agent(uuid,uuid,bigint,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bm_online_sign_cap_room_free_agent(uuid,uuid,bigint,text,bigint) TO authenticated;

-- bm_online_sign_cap_room_contract: preserve exact auth, team locks, roster/contract/dead-cap logic
create or replace function public.bm_online_sign_cap_room_contract(
  p_lobby uuid, p_request uuid, p_expected_revision bigint,
  p_player_id text, p_first_year_salary bigint, p_years integer, p_option_type text
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
  v_dead_rows jsonb;
  v_dead_row jsonb;
  v_dead_season integer;
  v_dead_amount numeric;
  v_salary_by_year jsonb := '[]'::jsonb;
  v_year_index integer;
  v_option jsonb;
  v_service_years integer;
  v_draft_year integer;
  v_source jsonb;
  v_key text;
  v_number_text text;
  v_salary_floor numeric;
  v_salary_ceiling numeric;
begin
  if v_actor is null then raise exception 'Sign in before editing a franchise'; end if;
  if p_lobby is null or p_request is null or p_player_id is null or length(btrim(p_player_id))<1 or length(p_player_id)>120 then
    raise exception 'Invalid transaction identifiers';
  end if;
  if p_first_year_salary is null or p_first_year_salary < 1200000 or p_first_year_salary > 57800000 then
    raise exception 'First-year salary outside the supported cap-room offer range';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 then raise exception 'Invalid expected revision'; end if;
  if p_years is null or p_years < 1 or p_years > 4 then
    raise exception 'Cap-room contracts must be between one and four seasons';
  end if;
  if p_option_type is null or p_option_type not in ('none','team','player') then
    raise exception 'Invalid contract option';
  end if;
  if p_years=1 and p_option_type<>'none' then
    raise exception 'A one-year contract cannot contain an option year';
  end if;

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
    if v_prior.actor_id <> v_actor or v_prior.action_type <> 'sign_cap_room_contract'
      or v_prior.details->>'player_id' is distinct from p_player_id
      or v_prior.details->>'team_name' is distinct from v_team
      or (v_prior.details->>'salary')::bigint is distinct from p_first_year_salary
      or (v_prior.details->>'years')::integer is distinct from p_years
      or v_prior.details->>'option_type' is distinct from p_option_type then
      raise exception 'Request ID was reused for another operation';
    end if;
    return jsonb_build_object('ok',true,'revision',v_prior.revision,'replayed',true,
                              'team',v_team,'player_id',p_player_id,
                              'years',p_years,'option_type',p_option_type);
  end if;
  if v_revision <> p_expected_revision then
    raise exception 'Shared league has changed. Refresh and review before trying again (revision %).',v_revision;
  end if;
  if jsonb_typeof(v_state)<>'object' then raise exception 'Invalid runtime state'; end if;
  v_year := case when (v_state->>'seasonYear') ~ '^20[0-9][0-9]$' then (v_state->>'seasonYear')::integer
                 when (v_state->>'seasonStartYear') ~ '^20[0-9][0-9]$' then (v_state->>'seasonStartYear')::integer
                 else 2026 end;
  if v_year not in (2026,2027) then raise exception 'Unsupported regular-season signing year'; end if;
  -- Cap matches the project's 2026-27 financial rules. No mid-level/minimum exceptions yet.
  v_cap := public.bm_online_f2_cap_room_ceiling(v_state);
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
  -- Match freeAgencyContractRules.js service-years and player-legal salary range.
  -- Prefer recorded service years, then draft year, then the age-based fallback.
  foreach v_source in array array[v_player, coalesce(v_player->'meta','{}'::jsonb)] loop
    foreach v_key in array array['proSeasons','seasonsPro','yearsPro','yearsOfExperience','yoe','serviceYears'] loop
      v_number_text:=v_source->>v_key;
      if v_number_text is not null and v_number_text<>'' then
        if v_number_text !~ '^[0-9]+(\.[0-9]+)?$' then
          raise exception 'Player service years are malformed';
        end if;
        v_service_years:=greatest(0,round(v_number_text::numeric))::integer;
        exit;
      end if;
    end loop;
    exit when v_service_years is not null;
  end loop;
  if v_service_years is null then
    foreach v_source in array array[v_player,coalesce(v_player->'meta','{}'::jsonb),coalesce(v_player->'draft','{}'::jsonb)] loop
      foreach v_key in array array['draftYear','yearDrafted','draftedYear','year'] loop
        v_number_text:=v_source->>v_key;
        if v_number_text ~ '^[0-9]{4}$' and v_number_text::integer between 2000 and 2100 then
          v_draft_year:=v_number_text::integer;
          exit;
        end if;
      end loop;
      exit when v_draft_year is not null;
    end loop;
    if v_draft_year is not null then
      v_service_years:=greatest(0,v_year-v_draft_year);
    end if;
  end if;
  if v_service_years is null then
    v_number_text:=v_player->>'age';
    v_service_years:=greatest(0,least(25,
      (case when v_number_text ~ '^[0-9]+(\.[0-9]+)?$' then round(v_number_text::numeric)::integer else 19 end)-19));
  end if;
  v_salary_floor:=case when v_service_years>=10 then 3300000
    when v_service_years>=6 then 2900000
    when v_service_years>=3 then 2500000
    when v_service_years>=2 then 2200000
    when v_service_years>=1 then 1900000 else 1300000 end;
  v_salary_ceiling:=round(v_cap * (case when v_service_years>=10 then 0.35
    when v_service_years>=7 then 0.30 else 0.25 end)/1000)*1000;
  if v_year=2027 then
    v_salary_floor := round(v_salary_floor * v_cap / 164961000 / 1000)*1000;
  end if;
  if p_first_year_salary < v_salary_floor or p_first_year_salary > v_salary_ceiling then
    raise exception 'First-year salary must be between % and % for this player',v_salary_floor,v_salary_ceiling;
  end if;
  if jsonb_typeof(v_player->'contract')='object' and jsonb_typeof(v_player->'contract'->'salaryByYear')='array'
     and jsonb_array_length(v_player->'contract'->'salaryByYear')>0 then
    raise exception 'An active contract requires a later rights or waiver workflow';
  end if;
  if coalesce(v_player->>'rightsTeamName','')<>'' or coalesce(v_player->'rights'->>'restrictedFreeAgent','false')='true'
     or coalesce((v_player->'qualifyingOffer'->>'amount')::numeric,0)>0 or coalesce(v_player->>'restricted','false')='true'
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
  -- Guaranteed released-player salary remains on the old team's cap.
  -- Release must never create fictitious cap room for another signing.
  v_dead_rows:=v_state#>array['deadCapByTeam',v_team];
  if jsonb_typeof(v_dead_rows)='array' then
    for v_dead_row in select value from jsonb_array_elements(v_dead_rows) loop
      if coalesce(v_dead_row->>'seasonYear','')~'^[0-9]{4}$' then
        v_dead_season:=(v_dead_row->>'seasonYear')::integer;
      else raise exception 'Malformed dead-cap season'; end if;
      if v_dead_season<>v_year then continue; end if;
      if coalesce(v_dead_row->>'amount',v_dead_row->>'netAmount','')!~'^[0-9]+(\.[0-9]+)?$' then
        raise exception 'Cannot calculate team dead cap safely';
      end if;
      v_dead_amount:=coalesce(v_dead_row->>'amount',v_dead_row->>'netAmount')::numeric;
      if v_dead_amount<0 or v_dead_amount>100000000 then
        raise exception 'Dead-cap amount outside safe range'; end if;
      v_payroll:=v_payroll+v_dead_amount;
    end loop;
  end if;
  if v_standard_count>=15 then raise exception 'Roster has 15 standard contracts. Free a roster slot first'; end if;
  if v_payroll+p_first_year_salary>v_cap then
    raise exception 'Cap-room-only signing cannot exceed the salary cap (payroll %, offer %, cap %).',v_payroll,p_first_year_salary,v_cap;
  end if;
  -- Never trust a client-submitted salary schedule or option object.
  -- Single-player buildLegalFreeAgentSalarySchedule uses simple, not compound,
  -- raises: roundMoney(firstYear * (1 + 0.05 * index), 1000).
  for v_year_index in 0..p_years-1 loop
    v_salary_by_year:=v_salary_by_year || jsonb_build_array(
      (round((p_first_year_salary::numeric * (1 + 0.05 * v_year_index))/1000)*1000)::bigint
    );
  end loop;
  v_option:=case when p_option_type='none' then 'null'::jsonb
    else jsonb_build_object('type',p_option_type,'yearIndex',p_years-1,
      'yearIndices',jsonb_build_array(p_years-1),'picked',null) end;
  v_contract:=jsonb_build_object('startYear',v_year,'salaryByYear',v_salary_by_year,
                                'years',p_years,'type','standard','option',v_option);
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
    values(p_lobby,v_revision+1,p_request,v_actor,'sign_cap_room_contract',
      jsonb_build_object('player_id',p_player_id,'player_name',v_player->>'name','team_name',v_team,'salary',p_first_year_salary,'years',p_years,
        'option_type',p_option_type,'salary_by_year',v_salary_by_year));
  return jsonb_build_object('ok',true,'revision',v_revision+1,'replayed',false,
    'team',v_team,'player_id',p_player_id,'salary_by_year',v_salary_by_year,
    'years',p_years,'option_type',p_option_type);
end $$;
REVOKE ALL ON FUNCTION public.bm_online_sign_cap_room_contract(uuid,uuid,bigint,text,bigint,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bm_online_sign_cap_room_contract(uuid,uuid,bigint,text,bigint,integer,text) TO authenticated;

-- bm_online_release_standard_player: preserve exact auth, team locks, roster/contract/dead-cap logic
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
  if v_year not in (2026,2027) then raise exception 'Unsupported online release season'; end if;
  if v_year=2027 then perform public.bm_online_f2_cap_room_ceiling(v_state); end if;

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
REVOKE ALL ON FUNCTION public.bm_online_release_standard_player(uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bm_online_release_standard_player(uuid,uuid,bigint,text) TO authenticated;
COMMIT;
