-- Online Phase 2C.2D-3A: broaden human trade salary matching while retaining server authority.
-- Run AFTER bm_online_human_trades_phase2c2d2.sql. No single-player data touched.
begin;

-- Port of the single-player tradeExecution.js financial evaluator's 2026-27
-- salary bands plus the userTradeRules.js first/second apron, hard-cap and
-- second-apron aggregation checks. Online uses the same authoritative league
-- snapshot and rechecks when offers are accepted. No browser approvals.
create or replace function public.bm_online_validate_human_trade_finances(
  p_state jsonb,p_team jsonb,p_outgoing numeric,p_incoming numeric,
  p_outgoing_players jsonb,p_incoming_players jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare
  v_year integer := 2026;
  v_team_name text := coalesce(p_team->>'name','This team');
  v_cap numeric := 164961000;
  v_first numeric := 209015000;
  v_second numeric := 221686000;
  v_hard numeric := 221686000;
  v_inflation numeric := 1;
  v_base_year integer;
  v_current_financial_year integer;
  v_financials jsonb := p_state->'financials';
  v_rules jsonb := p_state#>'{settings,tradeRules}';
  v_player jsonb;
  v_contract jsonb;
  v_salaries jsonb;
  v_start integer;
  v_offset integer;
  v_salary numeric;
  v_payroll numeric := 0;
  v_projected numeric;
  v_cap_room numeric;
  v_matching numeric;
  v_dead_rows jsonb;
  v_dead jsonb;
  v_dead_year integer;
  v_dead_amount text;
  v_money text;
  v_highest_out numeric := 0;
  v_highest_in numeric := 0;
  v_count_out integer := 0;
  v_count_in integer := 0;
  v_matching_on boolean := true;
  v_first_on boolean := true;
  v_second_on boolean := true;
  v_hard_on boolean := true;
begin
  if jsonb_typeof(p_team)<>'object' or jsonb_typeof(p_team->'players')<>'array'
    or jsonb_typeof(p_outgoing_players)<>'array' or jsonb_typeof(p_incoming_players)<>'array'
    or p_outgoing<0 or p_incoming<0 then raise exception 'Malformed trade salary inputs'; end if;
  -- The previous trade and contract RPCs are limited to the opening season.
  -- Future season cap inflation is deliberately blocked until online calendar parity.
  if coalesce(p_state->>'seasonYear',p_state->>'seasonStartYear','') <> '2026' then
    raise exception 'Online trade financial rules require 2026-27 season'; end if;
  -- Match the stored normalized financial aliases used by tradeExecution.js.
  -- The 2026-27 constants above are the same official rules as Online FA.
  -- Custom caps without normalized aliases fail closed instead of guessing.
  v_base_year:=case when (v_financials->>'baseSeasonYear')~'^20[0-9][0-9]$'
    then (v_financials->>'baseSeasonYear')::integer else 2027 end;
  v_current_financial_year:=case when (p_state->>'currentFinancialSeasonYear')~'^20[0-9][0-9]$'
    then (p_state->>'currentFinancialSeasonYear')::integer else 2027 end;
  if v_current_financial_year<>2027 then
    raise exception 'Online trade finances not initialized for 2026-27'; end if;
  v_inflation:=power(1+coalesce(case when (v_financials->>'annualInflationRate')~'^[0-9]+(\.[0-9]+)?$'
    then (v_financials->>'annualInflationRate')::numeric else null end,0.065),
    greatest(0,v_current_financial_year-v_base_year));
  v_inflation:=greatest(0.5,v_inflation);
  -- tradeExecution chooses these top-level aliases ahead of generated rules.
  if (p_state->>'salaryCap')~'^[0-9]+(\.[0-9]+)?$' and (p_state->>'salaryCap')::numeric>0
    then v_cap:=(p_state->>'salaryCap')::numeric;
  elsif (p_state->>'capLimit')~'^[0-9]+(\.[0-9]+)?$' and (p_state->>'capLimit')::numeric>0
    then v_cap:=(p_state->>'capLimit')::numeric;
  elsif jsonb_typeof(v_financials->'baseRules')='object' and (v_financials->'baseRules'->>'salaryCap')~'^[0-9]+(\.[0-9]+)?$'
    then v_cap:=round((v_financials->'baseRules'->>'salaryCap')::numeric*v_inflation/1000)*1000;
  end if;
  if (p_state->>'firstApron')~'^[0-9]+(\.[0-9]+)?$' and (p_state->>'firstApron')::numeric>0
    then v_first:=(p_state->>'firstApron')::numeric;
  elsif (p_state->>'apron1')~'^[0-9]+(\.[0-9]+)?$' and (p_state->>'apron1')::numeric>0
    then v_first:=(p_state->>'apron1')::numeric;
  elsif jsonb_typeof(v_financials->'baseRules')='object' and (v_financials->'baseRules'->>'firstApron')~'^[0-9]+(\.[0-9]+)?$'
    then v_first:=round((v_financials->'baseRules'->>'firstApron')::numeric*v_inflation/1000)*1000;
  end if;
  if (p_state->>'secondApron')~'^[0-9]+(\.[0-9]+)?$' and (p_state->>'secondApron')::numeric>0
    then v_second:=(p_state->>'secondApron')::numeric;
  elsif (p_state->>'apron2')~'^[0-9]+(\.[0-9]+)?$' and (p_state->>'apron2')::numeric>0
    then v_second:=(p_state->>'apron2')::numeric;
  elsif jsonb_typeof(v_financials->'baseRules')='object' and (v_financials->'baseRules'->>'secondApron')~'^[0-9]+(\.[0-9]+)?$'
    then v_second:=round((v_financials->'baseRules'->>'secondApron')::numeric*v_inflation/1000)*1000;
  end if;
  if (p_state->>'hardCap')~'^[0-9]+(\.[0-9]+)?$' and (p_state->>'hardCap')::numeric>0
    then v_hard:=(p_state->>'hardCap')::numeric;
  elsif (p_state->>'hardCapLimit')~'^[0-9]+(\.[0-9]+)?$' and (p_state->>'hardCapLimit')::numeric>0
    then v_hard:=(p_state->>'hardCapLimit')::numeric;
  elsif jsonb_typeof(v_financials->'baseRules')='object' and (v_financials->'baseRules'->>'hardCap')~'^[0-9]+(\.[0-9]+)?$'
    then v_hard:=round((v_financials->'baseRules'->>'hardCap')::numeric*v_inflation/1000)*1000;
  else v_hard:=v_second; end if;
  if v_cap<=0 or v_first<=v_cap or v_second<v_first or v_hard<v_first or v_inflation>4 then
    raise exception 'Invalid stored online salary cap/apron configuration'; end if;
  v_matching_on:=coalesce((v_rules->>'salaryMatching')::boolean,true);
  v_first_on:=coalesce((v_rules->>'firstApron')::boolean,true);
  v_second_on:=coalesce((v_rules->>'secondApron')::boolean,true);
  v_hard_on:=coalesce((v_rules->>'hardCapApronCeiling')::boolean,true);
  -- Mirrors getSalaryForPayrollYear: salaryByYear, then legacy salary fields.
  -- Never trust a client-provided payroll; calculate from the locked roster.
  for v_player in select value from jsonb_array_elements(p_team->'players') loop
    v_contract:=v_player->'contract';v_salaries:=v_contract->'salaryByYear';v_salary:=0;
    if jsonb_typeof(v_salaries)='array' and jsonb_array_length(v_salaries)>0 then
      v_start:=case when (v_contract->>'startYear')~'^20[0-9][0-9]$'
        then (v_contract->>'startYear')::integer else v_year end;
      v_offset:=v_year-v_start;
      if v_offset>=0 and v_offset<jsonb_array_length(v_salaries) then
        v_money:=v_salaries->>v_offset;
        if v_money~'^[0-9]+(\.[0-9]+)?$' then v_salary:=v_money::numeric;
        elsif v_money is not null then raise exception 'Malformed roster salary'; end if;
      end if;
    else
      v_money:=coalesce(v_player->>'salary',v_player->>'currentSalary',v_player->>'contractSalary',v_player->>'capHit',v_player->>'aav');
      if v_money~'^[0-9]+(\.[0-9]+)?$' then v_salary:=v_money::numeric;
      elsif v_money is not null then raise exception 'Malformed legacy player salary'; end if;
    end if;
    if v_salary>100000000 then raise exception 'Invalid payroll salary'; end if;
    v_payroll:=v_payroll+v_salary;
  end loop;
  v_dead_rows:=p_state->'deadCapByTeam'->v_team_name;
  if jsonb_typeof(v_dead_rows)='array' then
    for v_dead in select value from jsonb_array_elements(v_dead_rows) loop
      v_dead_year:=case when (v_dead->>'seasonYear')~'^20[0-9][0-9]$'
        then (v_dead->>'seasonYear')::integer else v_year end;
      if v_dead_year<>v_year then continue; end if;
      v_dead_amount:=coalesce(v_dead->>'amount',v_dead->>'netAmount',v_dead->>'originalAmount','0');
      if v_dead_amount !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'Malformed dead-cap salary'; end if;
      v_payroll:=v_payroll+v_dead_amount::numeric;
    end loop;
  end if;
  -- Identical fallback to getTeamBasePayroll when the roster has no salary.
  if v_payroll<=0 then
    v_money:=coalesce(p_team->>'payroll',p_team->>'totalSalary',p_team->'financials'->>'payroll','0');
    if v_money~'^[0-9]+(\.[0-9]+)?$' then v_payroll:=v_money::numeric; end if;
  end if;
  v_projected:=greatest(0,v_payroll-p_outgoing+p_incoming);
  v_cap_room:=greatest(0,v_cap-v_payroll);
  if v_first_on and v_payroll>=v_first-1000 and p_incoming>p_outgoing+1000 then
    raise exception '% cannot receive more salary at/above the first apron',v_team_name; end if;
  if v_second_on and v_payroll>=v_second-1000 then
    if p_incoming>p_outgoing+1000 then
      raise exception '% cannot receive more salary at/above the second apron',v_team_name; end if;
    v_count_out:=jsonb_array_length(p_outgoing_players);
    v_count_in:=jsonb_array_length(p_incoming_players);
    if v_count_out>1 and v_count_in=1 then
      for v_player in select value from jsonb_array_elements(p_outgoing_players) loop
        v_contract:=v_player->'contract';v_salaries:=v_contract->'salaryByYear';
        v_start:=case when (v_contract->>'startYear')~'^20[0-9][0-9]$'
          then (v_contract->>'startYear')::integer else v_year end;
        v_offset:=v_year-v_start;
        if v_offset>=0 and v_offset<jsonb_array_length(v_salaries) then
          v_highest_out:=greatest(v_highest_out,(v_salaries->>v_offset)::numeric);end if;
      end loop;
      for v_player in select value from jsonb_array_elements(p_incoming_players) loop
        v_contract:=v_player->'contract';v_salaries:=v_contract->'salaryByYear';
        v_start:=case when (v_contract->>'startYear')~'^20[0-9][0-9]$'
          then (v_contract->>'startYear')::integer else v_year end;
        v_offset:=v_year-v_start;
        if v_offset>=0 and v_offset<jsonb_array_length(v_salaries) then
          v_highest_in:=greatest(v_highest_in,(v_salaries->>v_offset)::numeric);end if;
      end loop;
      if v_highest_in>v_highest_out+1000 then
        raise exception '% cannot aggregate multiple salaries for a larger player at the second apron',v_team_name; end if;
    end if;
  end if;
  if v_hard_on and v_projected>v_hard+1000 and
      (v_payroll<=v_hard+1000 or v_projected>v_payroll+1000) then
    raise exception '% trade would exceed its hard cap',v_team_name; end if;
  if v_matching_on and p_incoming>p_outgoing+1000 then
    if not (v_payroll<v_cap and p_incoming<=p_outgoing+v_cap_room+1000) then
      if p_outgoing<=0 then v_matching:=0;
      elsif p_outgoing<=7500000*v_inflation then v_matching:=p_outgoing*2+250000*v_inflation;
      elsif p_outgoing<=29000000*v_inflation then v_matching:=p_outgoing+7500000*v_inflation;
      else v_matching:=p_outgoing*1.25+250000*v_inflation;end if;
      if p_incoming>v_matching+1000 then
        raise exception '% can receive at most $% in this trade under salary matching',
          v_team_name,round(v_matching);end if;
      -- tradeExecution's basic financial evaluator blocks extra salary
      -- matching when the projected team ends at/above the first apron.
      if v_first_on and v_projected>=v_first-1000 then
        raise exception '% cannot use below-apron matching to end at the first apron',v_team_name; end if;
    end if;
  end if;
end $$;
revoke all on function public.bm_online_validate_human_trade_finances(jsonb,jsonb,numeric,numeric,jsonb,jsonb)
  from public,anon,authenticated;

-- Pure validator / state constructor. Never trusts a client-supplied player object.
-- Uses team/player records in the locked authoritative league JSON only.
create or replace function public.bm_online_prepare_human_player_trade(
  p_state jsonb, p_team_a text, p_team_b text, p_ids_a text[], p_ids_b text[], p_trade_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_year integer;
  v_date text;
  v_phase text;
  v_conf text;
  v_container jsonb;
  v_team jsonb;
  v_index integer;
  v_path_a text[];
  v_path_b text[];
  v_a jsonb;
  v_b jsonb;
  v_roster_a jsonb;
  v_roster_b jsonb;
  v_keep_a jsonb := '[]'::jsonb;
  v_keep_b jsonb := '[]'::jsonb;
  v_send_a jsonb := '[]'::jsonb;
  v_send_b jsonb := '[]'::jsonb;
  v_names_a jsonb := '[]'::jsonb;
  v_names_b jsonb := '[]'::jsonb;
  v_detail_a jsonb := '[]'::jsonb;
  v_detail_b jsonb := '[]'::jsonb;
  v_p jsonb;
  v_id text;
  v_count_a integer := 0;
  v_count_b integer := 0;
  v_standard_a integer := 0;
  v_standard_b integer := 0;
  v_salary_a numeric := 0;
  v_salary_b numeric := 0;
  v_salary numeric;
  v_contract jsonb;
  v_salary_array jsonb;
  v_start integer;
  v_offset integer;
  v_date_lock text;
  v_status text;
  v_eligibility text;
  v_state_next jsonb;
  v_effective_lock_date text;
  v_move_row jsonb;
  v_locked_send_a jsonb := '[]'::jsonb;
  v_locked_send_b jsonb := '[]'::jsonb;
  v_record jsonb;
  v_reason_a text;
  v_reason_b text;
  v_total_identity_count integer;
begin
  if jsonb_typeof(p_state)<>'object' then raise exception 'Online league is malformed'; end if;
  v_year := case when (p_state->>'seasonYear')~'^20[0-9][0-9]$' then (p_state->>'seasonYear')::integer
     when (p_state->>'seasonStartYear')~'^20[0-9][0-9]$' then (p_state->>'seasonStartYear')::integer else 0 end;
  if v_year<>2026 then raise exception 'Human trades currently support the 2026-27 season only'; end if;
  v_phase := lower(coalesce(p_state->>'phase',p_state->'seasonState'->>'phase',p_state->'calendar'->>'phase',''));
  if v_phase ~ '(offseason|draft|retire|free.agency|playoff)' then
    raise exception 'Online trades are locked during this league phase'; end if;
  v_date := coalesce(nullif(p_state->>'currentDate',''),nullif(p_state->>'leagueDate',''),
    nullif(p_state->'calendar'->>'currentDate',''),nullif(p_state->'scheduleState'->>'currentDate',''));
  if v_date is not null and v_date ~ '^20[0-9][0-9]-[0-9]{2}-[0-9]{2}$'
     and v_date >= '2027-02-05' then raise exception 'The trade deadline has passed'; end if;
  if p_team_a is null or p_team_b is null or p_team_a=p_team_b or length(p_team_a)>90 or length(p_team_b)>90 then
    raise exception 'Invalid trade teams'; end if;
  if p_ids_a is null or p_ids_b is null or cardinality(p_ids_a) not between 1 and 4
    or cardinality(p_ids_b) not between 1 and 4 then raise exception 'Select 1–4 standard players per team'; end if;
  if exists(select 1 from unnest(p_ids_a||p_ids_b) as x where x is null or length(btrim(x))<1 or length(x)>120) then
    raise exception 'Trade contains an invalid player identifier'; end if;
  if (select count(distinct x) from unnest(p_ids_a||p_ids_b) as x)
     <> cardinality(p_ids_a)+cardinality(p_ids_b) then
    raise exception 'A player cannot be included more than once'; end if;

  -- Fail closed on dual team representations; never update only one copy.
  for v_conf in select x from unnest(array['teams','East','West']) as x loop
    if v_conf='teams' then v_container:=p_state->'teams';
    else v_container:=p_state#>array['conferences',v_conf]; end if;
    if jsonb_typeof(v_container)<>'array' then continue; end if;
    for v_team,v_index in select value,ordinality::integer-1 from jsonb_array_elements(v_container) with ordinality loop
      if v_team->>'name'=p_team_a then
        if v_path_a is not null then raise exception 'Ambiguous first team roster'; end if;
        v_path_a:=case when v_conf='teams' then array['teams',v_index::text]
          else array['conferences',v_conf,v_index::text] end;
        v_a:=v_team;
      end if;
      if v_team->>'name'=p_team_b then
        if v_path_b is not null then raise exception 'Ambiguous second team roster'; end if;
        v_path_b:=case when v_conf='teams' then array['teams',v_index::text]
          else array['conferences',v_conf,v_index::text] end;
        v_b:=v_team;
      end if;
    end loop;
  end loop;
  if v_path_a is null or v_path_b is null or jsonb_typeof(v_a->'players')<>'array'
     or jsonb_typeof(v_b->'players')<>'array' then raise exception 'Trade teams have no unique standard roster'; end if;
  v_roster_a:=v_a->'players';v_roster_b:=v_b->'players';

  for v_p in select value from jsonb_array_elements(v_roster_a) loop
    v_status:=lower(coalesce(v_p->>'rosterStatus',v_p->>'contractType',v_p->'contract'->>'type','standard'));
    if coalesce(v_p->>'isTwoWay','false')<>'true' and coalesce(v_p->>'isStash','false')<>'true'
      and v_status !~ '(two.way|stash|draft.rights|unsigned.rookie|rookie.pending)' then
      v_standard_a:=v_standard_a+1; end if;
    v_id:=coalesce(v_p->>'id',v_p->>'playerId');
    if v_id=any(p_ids_a) then
      v_count_a:=v_count_a+1;
      v_contract:=v_p->'contract';
      v_status:=lower(coalesce(v_p->>'rosterStatus',v_p->>'contractType',v_contract->>'type',''));
      if coalesce(v_p->>'isTwoWay','false')='true' or coalesce(v_p->>'isStash','false')='true'
        or v_status ~ '(two.way|stash|unsigned|rookie.pending)' or coalesce(v_p->>'retired','false')='true' then
        raise exception 'Trade includes an ineligible development or unsigned player'; end if;
      v_date_lock:=coalesce(v_p->'tradeMeta'->>'acquiredTradeEligibleDate',v_p->'tradeRestrictions'->>'acquiredTradeEligibleDate');
      if (v_p->'tradeMeta'->>'onlineTradePendingClock')='true' then
        raise exception 'This recently traded player needs a confirmed league clock before another trade'; end if;
      if v_date_lock is not null and (v_date is null or v_date<v_date_lock) then
        raise exception 'Recently acquired player is still trade-restricted'; end if;
      if jsonb_typeof(v_contract)<>'object' or jsonb_typeof(v_contract->'salaryByYear')<>'array'
        or jsonb_array_length(v_contract->'salaryByYear')=0 then
        raise exception 'Trade player has no verified standard contract salary'; end if;
      v_salary_array:=v_contract->'salaryByYear';
      v_start:=case when (v_contract->>'startYear') ~ '^20[0-9][0-9]$' then (v_contract->>'startYear')::integer else v_year end;
      v_offset:=v_year-v_start;
      if v_offset<0 or v_offset>=jsonb_array_length(v_salary_array) or (v_salary_array->>v_offset)!~'^[0-9]+(\.[0-9]+)?$' then
        raise exception 'Trade salary cannot be verified for this season'; end if;
      v_salary:=(v_salary_array->>v_offset)::numeric;
      if v_salary<1200000 or v_salary>100000000 then raise exception 'Invalid trade salary'; end if;
      v_salary_a:=v_salary_a+v_salary;
      v_send_a:=v_send_a||jsonb_build_array(v_p);
      v_names_a:=v_names_a||jsonb_build_array(coalesce(v_p->>'name','Player'));
      v_detail_a:=v_detail_a||jsonb_build_array(jsonb_build_object('type','player','label',v_p->>'name',
        'playerName',v_p->>'name','playerId',v_id,'teamName',p_team_a,'salary',v_salary));
    else v_keep_a:=v_keep_a||jsonb_build_array(v_p); end if;
  end loop;
  for v_p in select value from jsonb_array_elements(v_roster_b) loop
    v_status:=lower(coalesce(v_p->>'rosterStatus',v_p->>'contractType',v_p->'contract'->>'type','standard'));
    if coalesce(v_p->>'isTwoWay','false')<>'true' and coalesce(v_p->>'isStash','false')<>'true'
      and v_status !~ '(two.way|stash|draft.rights|unsigned.rookie|rookie.pending)' then
      v_standard_b:=v_standard_b+1; end if;
    v_id:=coalesce(v_p->>'id',v_p->>'playerId');
    if v_id=any(p_ids_b) then
      v_count_b:=v_count_b+1;
      v_contract:=v_p->'contract';
      v_status:=lower(coalesce(v_p->>'rosterStatus',v_p->>'contractType',v_contract->>'type',''));
      if coalesce(v_p->>'isTwoWay','false')='true' or coalesce(v_p->>'isStash','false')='true'
        or v_status ~ '(two.way|stash|unsigned|rookie.pending)' or coalesce(v_p->>'retired','false')='true' then
        raise exception 'Trade includes an ineligible development or unsigned player'; end if;
      v_date_lock:=coalesce(v_p->'tradeMeta'->>'acquiredTradeEligibleDate',v_p->'tradeRestrictions'->>'acquiredTradeEligibleDate');
      if (v_p->'tradeMeta'->>'onlineTradePendingClock')='true' then
        raise exception 'This recently traded player needs a confirmed league clock before another trade'; end if;
      if v_date_lock is not null and (v_date is null or v_date<v_date_lock) then
        raise exception 'Recently acquired player is still trade-restricted'; end if;
      if jsonb_typeof(v_contract)<>'object' or jsonb_typeof(v_contract->'salaryByYear')<>'array'
        or jsonb_array_length(v_contract->'salaryByYear')=0 then
        raise exception 'Trade player has no verified standard contract salary'; end if;
      v_salary_array:=v_contract->'salaryByYear';
      v_start:=case when (v_contract->>'startYear') ~ '^20[0-9][0-9]$' then (v_contract->>'startYear')::integer else v_year end;
      v_offset:=v_year-v_start;
      if v_offset<0 or v_offset>=jsonb_array_length(v_salary_array) or (v_salary_array->>v_offset)!~'^[0-9]+(\.[0-9]+)?$' then
        raise exception 'Trade salary cannot be verified for this season'; end if;
      v_salary:=(v_salary_array->>v_offset)::numeric;
      if v_salary<1200000 or v_salary>100000000 then raise exception 'Invalid trade salary'; end if;
      v_salary_b:=v_salary_b+v_salary;
      v_send_b:=v_send_b||jsonb_build_array(v_p);
      v_names_b:=v_names_b||jsonb_build_array(coalesce(v_p->>'name','Player'));
      v_detail_b:=v_detail_b||jsonb_build_array(jsonb_build_object('type','player','label',v_p->>'name',
        'playerName',v_p->>'name','playerId',v_id,'teamName',p_team_b,'salary',v_salary));
    else v_keep_b:=v_keep_b||jsonb_build_array(v_p); end if;
  end loop;
  if v_count_a<>cardinality(p_ids_a) or v_count_b<>cardinality(p_ids_b) then
    raise exception 'A trade asset is no longer owned by its offering team'; end if;
  -- Both teams must independently satisfy the single-player financial bands.
  -- No client-provided salary or payroll values are trusted; validate against
  -- locked state at offer creation AND again when the receiving GM accepts.
  perform public.bm_online_validate_human_trade_finances(
    p_state,v_a,v_salary_a,v_salary_b,v_send_a,v_send_b);
  perform public.bm_online_validate_human_trade_finances(
    p_state,v_b,v_salary_b,v_salary_a,v_send_b,v_send_a);
  -- Exact single-player trade-roster ceiling from rosterRules.js:
  -- allow temporary 16, or one more than an already-oversized roster.
  -- Underfilled/overfilled teams must repair before game simulation, not before trading.
  if v_standard_a-v_count_a+v_count_b>greatest(16,v_standard_a+1)
    or v_standard_b-v_count_b+v_count_a>greatest(16,v_standard_b+1) then
    raise exception 'Trade exceeds the existing temporary standard-roster limit'; end if;
  -- Check globally that each player ID exists EXACTLY ONCE, including two-way/stash.
  for v_id in select x from unnest(p_ids_a||p_ids_b) as x loop
    v_total_identity_count:=0;
    for v_conf in select x from unnest(array['teams','East','West']) as x loop
      if v_conf='teams' then v_container:=p_state->'teams';
      else v_container:=p_state#>array['conferences',v_conf]; end if;
      if jsonb_typeof(v_container)<>'array' then continue; end if;
      for v_team in select value from jsonb_array_elements(v_container) loop
        for v_p in select value from jsonb_array_elements(
          (case when jsonb_typeof(v_team->'players')='array' then v_team->'players' else '[]'::jsonb end)||
          (case when jsonb_typeof(v_team->'twoWayPlayers')='array' then v_team->'twoWayPlayers' else '[]'::jsonb end)||
          (case when jsonb_typeof(v_team->'stashPlayers')='array' then v_team->'stashPlayers' else '[]'::jsonb end)) loop
          if coalesce(v_p->>'id',v_p->>'playerId')=v_id then v_total_identity_count:=v_total_identity_count+1; end if;
        end loop;
      end loop;
    end loop;
    if v_total_identity_count<>1 then raise exception 'Ambiguous player identity found: transaction blocked'; end if;
    for v_p in select value from jsonb_array_elements(case when jsonb_typeof(p_state->'freeAgents')='array'
       then p_state->'freeAgents' else '[]'::jsonb end) loop
       if coalesce(v_p->>'id',v_p->>'playerId')=v_id then
         raise exception 'Player appears in free agency and on a roster'; end if;
    end loop;
  end loop;
  -- Stamp recent-acquisition restrictions on the receiving team without
  -- modifying contract terms, ratings, or single-player saves. When the Online
  -- calendar is not yet initialized, fail closed on immediate re-trades.
  v_effective_lock_date:=case when v_date ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
    then to_char(v_date::date + 30,'YYYY-MM-DD') else null end;
  for v_move_row in select value from jsonb_array_elements(v_send_a) loop
    -- Match single-player transferStandardPlayer's team field reassignment.
    v_move_row:=v_move_row||jsonb_build_object('isTwoWay',false,'isStash',false);
    if v_move_row ? 'teamName' then v_move_row:=jsonb_set(v_move_row,'{teamName}',to_jsonb(p_team_b),false); end if;
    if v_move_row ? 'currentTeam' then v_move_row:=jsonb_set(v_move_row,'{currentTeam}',to_jsonb(p_team_b),false); end if;
    if jsonb_typeof(v_move_row->'team')='string' then
      v_move_row:=jsonb_set(v_move_row,'{team}',to_jsonb(p_team_b),false); end if;
    v_locked_send_a:=v_locked_send_a||jsonb_build_array(jsonb_set(v_move_row,'{tradeMeta}',
      (case when jsonb_typeof(v_move_row->'tradeMeta')='object' then v_move_row->'tradeMeta' else '{}'::jsonb end)||jsonb_build_object(
        'onlineTradeId',p_trade_id::text,'onlineTradePendingClock',v_effective_lock_date is null,
        'acquiredTradeEligibleDate',v_effective_lock_date),true));
  end loop;
  for v_move_row in select value from jsonb_array_elements(v_send_b) loop
    v_move_row:=v_move_row||jsonb_build_object('isTwoWay',false,'isStash',false);
    if v_move_row ? 'teamName' then v_move_row:=jsonb_set(v_move_row,'{teamName}',to_jsonb(p_team_a),false); end if;
    if v_move_row ? 'currentTeam' then v_move_row:=jsonb_set(v_move_row,'{currentTeam}',to_jsonb(p_team_a),false); end if;
    if jsonb_typeof(v_move_row->'team')='string' then
      v_move_row:=jsonb_set(v_move_row,'{team}',to_jsonb(p_team_a),false); end if;
    v_locked_send_b:=v_locked_send_b||jsonb_build_array(jsonb_set(v_move_row,'{tradeMeta}',
      (case when jsonb_typeof(v_move_row->'tradeMeta')='object' then v_move_row->'tradeMeta' else '{}'::jsonb end)||jsonb_build_object(
        'onlineTradeId',p_trade_id::text,'onlineTradePendingClock',v_effective_lock_date is null,
        'acquiredTradeEligibleDate',v_effective_lock_date),true));
  end loop;
  v_reason_a:=p_team_a||' approved a human GM trade with '||p_team_b||'.';
  v_reason_b:=p_team_b||' approved a human GM trade with '||p_team_a||'.';
  v_record:=jsonb_build_object(
    'id','online-trade-'||p_trade_id::text,'source','online_human_trade','tradeType','human_human_trade',
    'completedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'seasonYear',v_year,'date',coalesce(v_date,''),'userTeamName',p_team_a,
    'cpuTeamName',p_team_b,'fromTeamName',p_team_a,'toTeamName',p_team_b,
    'userSent',jsonb_build_object('players',v_names_a,'picks','[]'::jsonb),
    'cpuSent',jsonb_build_object('players',v_names_b,'picks','[]'::jsonb),
    'userSentAssets',v_detail_a,'cpuSentAssets',v_detail_b,
    'movedPlayers',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (
      select jsonb_build_object('name',value,'fromTeam',p_team_a,'toTeam',p_team_b) as x from jsonb_array_elements_text(v_names_a)
      union all select jsonb_build_object('name',value,'fromTeam',p_team_b,'toTeam',p_team_a) from jsonb_array_elements_text(v_names_b)
    ) q),'movedPicks','[]'::jsonb,'cpuDecision','human_approved',
    'teamPackages',jsonb_build_array(
      jsonb_build_object('teamName',p_team_a,'received',v_detail_b,'sent',v_detail_a,'reason',v_reason_a),
      jsonb_build_object('teamName',p_team_b,'received',v_detail_a,'sent',v_detail_b,'reason',v_reason_b)),
    'reasoning',jsonb_build_object(p_team_a,v_reason_a,p_team_b,v_reason_b));
  v_state_next:=jsonb_set(p_state,v_path_a||array['players'],v_keep_a||v_locked_send_b,false);
  v_state_next:=jsonb_set(v_state_next,v_path_b||array['players'],v_keep_b||v_locked_send_a,false);
  v_state_next:=jsonb_set(v_state_next,'{tradeHistory}',
    (case when jsonb_typeof(p_state->'tradeHistory')='array' then p_state->'tradeHistory' else '[]'::jsonb end)||jsonb_build_array(v_record),true);
  v_state_next:=jsonb_set(v_state_next,'{lastTrade}',v_record,true);
  return jsonb_build_object('state',v_state_next,'record',v_record,
    'salary_a',v_salary_a,'salary_b',v_salary_b);
end $$;
revoke all on function public.bm_online_prepare_human_player_trade(jsonb,text,text,text[],text[],uuid)
  from public,anon,authenticated;

commit;
