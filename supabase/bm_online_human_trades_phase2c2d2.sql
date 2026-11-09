-- Basketball Manager Online Phase 2C.2D-2: first live human-to-human standard-roster trades.
-- This is an intentionally CONSERVATIVE subset of the finished single-player rules:
-- 1–4 standard players each direction, salary-neutral within $1,000, 2026-27 only;
-- NO picks, CPU trades, exceptions, cash, swaps, three-team deals, or offseason trades.
-- Only the recipient GM can accept; server serializes against FA/release transactions.
-- SQL must be applied manually AFTER online runtime, signing, releases and contracts.
begin;

create table if not exists public.bm_online_trade_offers (
  id uuid primary key,
  lobby_id uuid not null references public.bm_online_franchise_runtime(lobby_id) on delete restrict,
  proposer_id uuid not null references auth.users(id),
  recipient_id uuid not null references auth.users(id),
  proposer_team text not null,
  recipient_team text not null,
  proposer_player_ids text[] not null,
  recipient_player_ids text[] not null,
  proposer_player_labels text[] not null,
  recipient_player_labels text[] not null,
  created_revision bigint not null check(created_revision >= 1),
  status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_revision bigint,
  check(proposer_id <> recipient_id),
  check(cardinality(proposer_player_ids) between 1 and 4),
  check(cardinality(recipient_player_ids) between 1 and 4)
);
create index if not exists bm_online_trade_offers_lobby_created
  on public.bm_online_trade_offers(lobby_id,created_at desc);
alter table public.bm_online_trade_offers enable row level security;
revoke all on public.bm_online_trade_offers from public,anon,authenticated;
grant select on public.bm_online_trade_offers to authenticated;
drop policy if exists bm_online_trade_offers_member_read on public.bm_online_trade_offers;
create policy bm_online_trade_offers_member_read on public.bm_online_trade_offers
  for select to authenticated using (public.bm_is_online_lobby_member(lobby_id));

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
  -- Guaranteed safe subset of single-player evaluateTradeFinancialLegality:
  -- both teams receive no more salary than sent out (+ $1,000 tolerance).
  if abs(v_salary_a-v_salary_b)>1000 then
    raise exception 'Early online human trades require salary-neutral packages (within $1,000)'; end if;
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

-- Offer creation requires an authenticated human GM, and a real human recipient GM.
create or replace function public.bm_online_offer_human_trade(
  p_lobby uuid,p_request uuid,p_expected_revision bigint,p_target_team text,
  p_sending_ids text[],p_receiving_ids text[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();
  v_state jsonb;
  v_revision bigint;
  v_status text;
  v_team text;
  v_recipient uuid;
  v_recipients uuid[];
  v_existing public.bm_online_trade_offers%rowtype;
  v_preview jsonb;
begin
  if v_actor is null or p_lobby is null or p_request is null or p_expected_revision is null or p_expected_revision<1 then
    raise exception 'Invalid authenticated online trade request'; end if;
  select state,revision into v_state,v_revision from public.bm_online_franchise_runtime
    where lobby_id=p_lobby for update;
  if not found then raise exception 'Online franchise missing'; end if;
  select l.status,m.team_name into v_status,v_team from public.bm_online_lobbies l
    join public.bm_online_lobby_members m on m.lobby_id=l.id and m.user_id=v_actor
    where l.id=p_lobby;
  if not found or v_status<>'started' or nullif(btrim(v_team),'') is null then
    raise exception 'You must control a team in the started online franchise'; end if;
  select * into v_existing from public.bm_online_trade_offers where id=p_request;
  if found then
    if v_existing.lobby_id<>p_lobby or v_existing.proposer_id<>v_actor
      or v_existing.proposer_team<>v_team or v_existing.recipient_team<>p_target_team
      or v_existing.proposer_player_ids is distinct from p_sending_ids
      or v_existing.recipient_player_ids is distinct from p_receiving_ids then
      raise exception 'Request ID was already used for another trade'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'offer_id',p_request,'status',v_existing.status);
  end if;
  if v_revision<>p_expected_revision then raise exception 'Shared league changed. Refresh before offering a trade.'; end if;
  select array_agg(m.user_id) into v_recipients from public.bm_online_lobby_members m
    where m.lobby_id=p_lobby and m.team_name=p_target_team;
  if cardinality(v_recipients) is distinct from 1 then
    raise exception 'Target team must have exactly one human GM'; end if;
  v_recipient:=v_recipients[1];
  if v_recipient=v_actor then raise exception 'You cannot trade with your own team'; end if;
  v_preview:=public.bm_online_prepare_human_player_trade(v_state,v_team,p_target_team,
    p_sending_ids,p_receiving_ids,p_request);
  -- A just-signed online free agent is locked until the Online calendar can
  -- establish the usual signing cooldown. Never allow immediate flips.
  if exists (select 1 from public.bm_online_franchise_events e
    where e.lobby_id=p_lobby and e.action_type in ('sign_cap_room_contract','sign_cap_room_free_agent')
      and e.details->>'player_id'=any(p_sending_ids||p_receiving_ids)) then
    raise exception 'A recently signed player is not yet trade eligible'; end if;
  insert into public.bm_online_trade_offers(id,lobby_id,proposer_id,recipient_id,proposer_team,recipient_team,
    proposer_player_ids,recipient_player_ids,proposer_player_labels,recipient_player_labels,created_revision)
  values(p_request,p_lobby,v_actor,v_recipient,v_team,p_target_team,p_sending_ids,p_receiving_ids,
    array(select jsonb_array_elements_text(v_preview->'record'->'userSent'->'players')),
    array(select jsonb_array_elements_text(v_preview->'record'->'cpuSent'->'players')),v_revision);
  return jsonb_build_object('ok',true,'replayed',false,'offer_id',p_request,'status','pending');
end $$;
revoke all on function public.bm_online_offer_human_trade(uuid,uuid,bigint,text,text[],text[]) from public,anon,authenticated;
grant execute on function public.bm_online_offer_human_trade(uuid,uuid,bigint,text,text[],text[]) to authenticated;

-- Accept / decline / cancel. Acceptance is exactly one JSON revision + one journal entry.
-- Row lock order is always runtime -> offer; concurrent accept or roster mutation cannot both succeed.
create or replace function public.bm_online_respond_human_trade(
  p_lobby uuid,p_offer uuid,p_request uuid,p_expected_revision bigint,p_decision text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();
  v_state jsonb;
  v_revision bigint;
  v_lobby_status text;
  v_offer public.bm_online_trade_offers%rowtype;
  v_prior public.bm_online_franchise_events%rowtype;
  v_preview jsonb;
  v_updated jsonb;
  v_actor_team text;
begin
  if v_actor is null or p_lobby is null or p_offer is null or p_request is null
    or p_expected_revision is null or p_expected_revision<1
    or p_decision is null or p_decision not in ('accept','decline','cancel') then
    raise exception 'Invalid online trade response'; end if;
  select state,revision into v_state,v_revision from public.bm_online_franchise_runtime
    where lobby_id=p_lobby for update;
  if not found then raise exception 'Online league missing'; end if;
  select l.status,m.team_name into v_lobby_status,v_actor_team
    from public.bm_online_lobbies l join public.bm_online_lobby_members m
    on m.lobby_id=l.id and m.user_id=v_actor where l.id=p_lobby;
  if not found or v_lobby_status<>'started' then raise exception 'Online GM authorization failed'; end if;
  select * into v_offer from public.bm_online_trade_offers where id=p_offer and lobby_id=p_lobby for update;
  if not found then raise exception 'Trade offer does not exist'; end if;
  if p_decision='cancel' then
    if v_actor<>v_offer.proposer_id or v_actor_team<>v_offer.proposer_team then
      raise exception 'Only the offering GM can cancel'; end if;
  elsif v_actor<>v_offer.recipient_id or v_actor_team<>v_offer.recipient_team then
    raise exception 'Only the receiving GM can respond'; end if;
  -- A repeat accept uses the event journal to prove the same action was committed.
  select * into v_prior from public.bm_online_franchise_events
    where lobby_id=p_lobby and request_id=p_request;
  if found then
    if v_prior.actor_id<>v_actor or v_prior.action_type<>'human_trade_accepted'
       or v_prior.details->>'offer_id'<>p_offer::text or p_decision<>'accept' then
      raise exception 'Request ID reused for a different action'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'revision',v_prior.revision,'status','accepted');
  end if;
  if v_offer.status<>'pending' then
    if (p_decision='decline' and v_offer.status='declined')
       or (p_decision='cancel' and v_offer.status='cancelled') then
       return jsonb_build_object('ok',true,'replayed',true,'status',v_offer.status,'revision',v_revision);
    end if;
    raise exception 'This trade offer has already been resolved';
  end if;
  if p_decision<>'accept' then
    update public.bm_online_trade_offers set status=case when p_decision='decline' then 'declined' else 'cancelled' end,
      resolved_at=now() where id=p_offer;
    return jsonb_build_object('ok',true,'status',case when p_decision='decline' then 'declined' else 'cancelled' end,
      'revision',v_revision);
  end if;
  if v_revision<>p_expected_revision then raise exception 'Shared league changed. Refresh before accepting.'; end if;
  if not exists(select 1 from public.bm_online_lobby_members
    where lobby_id=p_lobby and user_id=v_offer.proposer_id and team_name=v_offer.proposer_team) then
    raise exception 'The offering GM no longer controls that team'; end if;
  -- Re-resolve every original asset against the *current locked* runtime.
  if exists (select 1 from public.bm_online_franchise_events e
    where e.lobby_id=p_lobby and e.action_type in ('sign_cap_room_contract','sign_cap_room_free_agent')
      and e.details->>'player_id'=any(v_offer.proposer_player_ids||v_offer.recipient_player_ids)) then
    raise exception 'A recently signed player is not yet trade eligible'; end if;
  v_preview:=public.bm_online_prepare_human_player_trade(v_state,v_offer.proposer_team,
    v_offer.recipient_team,v_offer.proposer_player_ids,v_offer.recipient_player_ids,p_offer);
  v_updated:=v_preview->'state';
  update public.bm_online_franchise_runtime set state=v_updated,revision=revision+1,updated_at=now()
    where lobby_id=p_lobby;
  insert into public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
    values(p_lobby,v_revision+1,p_request,v_actor,'human_trade_accepted',
      jsonb_build_object('offer_id',p_offer,'from_team',v_offer.proposer_team,
        'to_team',v_offer.recipient_team,'sending',to_jsonb(v_offer.proposer_player_ids),
        'receiving',to_jsonb(v_offer.recipient_player_ids)));
  update public.bm_online_trade_offers set status='accepted',resolved_at=now(),resolved_revision=v_revision+1
    where id=p_offer;
  return jsonb_build_object('ok',true,'replayed',false,'status','accepted',
    'revision',v_revision+1,'trade_id',p_offer);
end $$;
revoke all on function public.bm_online_respond_human_trade(uuid,uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.bm_online_respond_human_trade(uuid,uuid,uuid,bigint,text) to authenticated;
commit;
