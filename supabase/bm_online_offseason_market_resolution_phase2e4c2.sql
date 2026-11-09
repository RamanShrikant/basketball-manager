-- Basketball Manager Online 2E.4-C2: original-engine daily offer resolution + GM decisions.
-- MANUAL APPLICATION ONLY, after 2E.4-C1. Test on a disposable league.
-- No browser role can call this function. Revalidates server-generated roster deltas
-- independently while holding the authoritative league row lock.
BEGIN;
CREATE OR REPLACE FUNCTION public.bm_online_market_step_phase2e4c2(
 p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,
 p_year int,p_input_hash text,p_mode text,p_kind text,p_player_key text,
 p_choice text,p_new_state jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_old jsonb;v_new jsonb:=p_new_state;v_revision bigint;v_host uuid;v_team text;
 v_oldstage jsonb;v_newstage jsonb;v_oldmarket jsonb;v_newmarket jsonb;
 v_oldteams jsonb;v_newteams jsonb;v_oteam jsonb;v_nteam jsonb;
 v_oldpool jsonb;v_newpool jsonb;v_beforeplayer jsonb;v_afterplayer jsonb;
 v_player jsonb;v_row jsonb;v_roster jsonb;v_found jsonb;v_pending jsonb;
 v_bucket text;v_id text;v_old_id text;v_teamname text;v_name text;
 v_seen jsonb:='{}'::jsonb;v_signed jsonb:='{}'::jsonb;
 v_humans text[];v_ordinal bigint;v_removed int:=0;v_added int:=0;
 v_old_day int;v_new_day int;v_phase text;v_event text;v_generated int:=0;
 v_prior public.bm_online_franchise_events%ROWTYPE;
BEGIN
 IF p_lobby IS NULL OR p_actor IS NULL OR p_request IS NULL OR
    p_expected_revision IS NULL OR p_expected_revision<1 OR p_year NOT BETWEEN 2026 AND 2100 OR
    p_input_hash IS NULL OR p_input_hash !~ '^[a-f0-9]{64}$' OR
    p_mode IS NULL OR p_mode NOT IN ('resolve','decision','next') OR
    pg_catalog.jsonb_typeof(v_new) IS DISTINCT FROM 'object' OR
    pg_catalog.octet_length(v_new::text)>70000000
 THEN RAISE EXCEPTION 'Invalid authoritative market step';END IF;
 SELECT r.state,r.revision INTO v_old,v_revision FROM public.bm_online_franchise_runtime r
  WHERE r.lobby_id=p_lobby FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Shared league unavailable';END IF;
 SELECT l.host_id INTO v_host FROM public.bm_online_lobbies l
  WHERE l.id=p_lobby AND l.status='started';
 SELECT m.team_name INTO v_team FROM public.bm_online_lobby_members m
  WHERE m.lobby_id=p_lobby AND m.user_id=p_actor;
 IF v_host IS NULL OR v_team IS NULL THEN RAISE EXCEPTION 'Only an assigned online GM can act';END IF;
 SELECT pg_catalog.array_agg(m.team_name ORDER BY m.team_name) INTO v_humans
  FROM public.bm_online_lobby_members m WHERE m.lobby_id=p_lobby AND m.team_name IS NOT NULL;
 IF pg_catalog.array_length(v_humans,1) NOT BETWEEN 1 AND 4 OR
    (SELECT count(DISTINCT x) FROM pg_catalog.unnest(v_humans) AS x)<>
    pg_catalog.array_length(v_humans,1)
 THEN RAISE EXCEPTION 'Human-GM assignments are inconsistent';END IF;
 v_event:='online_market_'||p_mode;
 SELECT * INTO v_prior FROM public.bm_online_franchise_events e
  WHERE e.lobby_id=p_lobby AND e.request_id=p_request;
 IF FOUND THEN
  IF v_prior.actor_id IS DISTINCT FROM p_actor OR v_prior.action_type IS DISTINCT FROM v_event OR
      v_prior.details->>'inputHash' IS DISTINCT FROM p_input_hash
  THEN RAISE EXCEPTION 'Reused request ID with different market action';END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'replayed',true,'revision',v_prior.revision);
 END IF;
 IF v_revision<>p_expected_revision THEN RAISE EXCEPTION 'League changed, refresh the market';END IF;
 v_oldstage:=v_old->'onlineOffseasonMarket';v_newstage:=v_new->'onlineOffseasonMarket';
 v_oldmarket:=v_old->'freeAgencyState';v_newmarket:=v_new->'freeAgencyState';
 IF v_oldstage->>'status' IS DISTINCT FROM 'active' OR
    v_oldmarket->>'isActive' IS DISTINCT FROM 'true' OR
    (v_oldstage->>'year')::int IS DISTINCT FROM p_year OR
    (v_old->'onlineDraft'->>'draftYear')::int IS DISTINCT FROM p_year OR
    (v_oldstage->>'day')::int IS DISTINCT FROM (v_oldmarket->>'currentDay')::int OR
    pg_catalog.jsonb_typeof(v_newstage) IS DISTINCT FROM 'object' OR
    pg_catalog.jsonb_typeof(v_newmarket) IS DISTINCT FROM 'object' OR
    (v_newstage->>'year')::int IS DISTINCT FROM p_year OR
    (v_newstage->>'day')::int IS DISTINCT FROM (v_newmarket->>'currentDay')::int OR
    (v_newmarket->>'maxDays')::int IS DISTINCT FROM 10 OR
    (v_oldmarket->>'maxDays')::int IS DISTINCT FROM 10 OR
    v_old->'onlineRights' IS DISTINCT FROM v_new->'onlineRights'
 THEN RAISE EXCEPTION 'Invalid offseason market stage or year';END IF;
 v_old_day:=(v_oldmarket->>'currentDay')::int;v_new_day:=(v_newmarket->>'currentDay')::int;
 IF v_old_day NOT BETWEEN 1 AND 10 OR v_new_day NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Invalid market day';END IF;
 v_phase:=v_newstage->>'phase';
 IF p_mode='resolve' THEN
  IF p_actor IS DISTINCT FROM v_host OR v_oldstage->>'phase' IS DISTINCT FROM 'offers' OR
     (v_oldstage->>'lastResolvedDay')::int IS NOT DISTINCT FROM v_old_day OR
     (v_newstage->>'lastResolvedDay')::int IS DISTINCT FROM v_old_day OR
     ((v_phase='offers' AND v_new_day<>v_old_day+1) OR
      (v_phase IN ('decisions','complete') AND v_new_day<>v_old_day) OR
      v_phase NOT IN ('offers','decisions','complete'))
  THEN RAISE EXCEPTION 'Invalid or unauthorized daily market resolution';END IF;
 ELSIF p_mode='next' THEN
  IF p_actor IS DISTINCT FROM v_host OR v_oldstage->>'phase' NOT IN ('needs_next','needs_finish') OR
     (v_oldstage->>'lastResolvedDay')::int IS DISTINCT FROM v_old_day OR
     ((v_old_day<10 AND (v_phase<>'offers' OR v_new_day<>v_old_day+1)) OR
      (v_old_day=10 AND (v_phase<>'complete' OR v_new_day<>v_old_day)))
  THEN RAISE EXCEPTION 'Cannot continue market while decisions are unresolved';END IF;
 ELSE
  IF v_oldstage->>'phase' IS DISTINCT FROM 'decisions' OR
     v_new_day<>v_old_day OR
     (v_newstage->>'lastResolvedDay')::int IS DISTINCT FROM (v_oldstage->>'lastResolvedDay')::int OR
     v_phase NOT IN ('decisions','needs_next','needs_finish') OR
     p_player_key !~ '^id:[^[:space:]]{1,150}$' OR
     ((p_kind='signing' AND p_choice NOT IN ('accept','decline')) OR
      (p_kind='rfa' AND p_choice NOT IN ('match','decline')) OR
      p_kind NOT IN ('signing','rfa'))
  THEN RAISE EXCEPTION 'Invalid market player decision';END IF;
  IF p_kind='signing' THEN
   v_pending:=v_oldmarket->'pendingUserDecisions';
   IF NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(coalesce(v_pending,'[]'::jsonb)) x
       WHERE x.value->>'playerKey'=p_player_key AND x.value->>'teamName'=v_team)
   THEN RAISE EXCEPTION 'Only the offered GM may decide this player';END IF;
  ELSE
   v_pending:=v_oldmarket->'pendingRfaMatchDecisions';
   IF NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(coalesce(v_pending,'[]'::jsonb)) x
       WHERE x.value->>'playerKey'=p_player_key AND x.value->>'rightsTeamName'=v_team)
   THEN RAISE EXCEPTION 'Only the incumbent GM may match this RFA sheet';END IF;
  END IF;
 END IF;
 -- Every unrelated league key must be byte-for-byte-equivalent JSONB.
 IF (v_old-'teams'-'conferences'-'freeAgents'-'freeAgencyState'-'onlineOffseasonMarket'-'deadCapByTeam'-'offseasonState')
 IS DISTINCT FROM
 (v_new-'teams'-'conferences'-'freeAgents'-'freeAgencyState'-'onlineOffseasonMarket'-'deadCapByTeam'-'offseasonState') OR
 (v_old->'offseasonState'-'freeAgencyComplete') IS DISTINCT FROM
 (v_new->'offseasonState'-'freeAgencyComplete')
 THEN RAISE EXCEPTION 'Market attempted to rewrite unrelated franchise data';END IF;
 IF (pg_catalog.jsonb_typeof(v_old->'teams')='array') IS DISTINCT FROM
    (pg_catalog.jsonb_typeof(v_new->'teams')='array') OR
    (pg_catalog.jsonb_typeof(v_old->'conferences')='object') IS DISTINCT FROM
    (pg_catalog.jsonb_typeof(v_new->'conferences')='object')
 THEN RAISE EXCEPTION 'NBA roster layout was replaced';END IF;
 v_oldteams:=CASE WHEN pg_catalog.jsonb_typeof(v_old->'teams')='array' THEN v_old->'teams'
  ELSE coalesce(v_old#>'{conferences,East}','[]'::jsonb)||coalesce(v_old#>'{conferences,West}','[]'::jsonb) END;
 v_newteams:=CASE WHEN pg_catalog.jsonb_typeof(v_new->'teams')='array' THEN v_new->'teams'
  ELSE coalesce(v_new#>'{conferences,East}','[]'::jsonb)||coalesce(v_new#>'{conferences,West}','[]'::jsonb) END;
 IF pg_catalog.jsonb_typeof(v_oldteams)<>'array' OR pg_catalog.jsonb_array_length(v_oldteams)<>30 OR
    pg_catalog.jsonb_typeof(v_newteams)<>'array' OR pg_catalog.jsonb_array_length(v_newteams)<>30
 THEN RAISE EXCEPTION 'Invalid league team count';END IF;
 IF pg_catalog.jsonb_typeof(v_old->'conferences')='object' AND (
    (SELECT pg_catalog.array_agg(k.key ORDER BY k.key) FROM pg_catalog.jsonb_object_keys(v_old->'conferences') AS k(key))
      IS DISTINCT FROM
    (SELECT pg_catalog.array_agg(k.key ORDER BY k.key) FROM pg_catalog.jsonb_object_keys(v_new->'conferences') AS k(key))
   ) THEN RAISE EXCEPTION 'Market changed the NBA conference structure';END IF;
 v_oldpool:=coalesce(v_old->'freeAgents','[]'::jsonb);v_newpool:=coalesce(v_new->'freeAgents','[]'::jsonb);
 IF pg_catalog.jsonb_typeof(v_oldpool)<>'array' OR pg_catalog.jsonb_typeof(v_newpool)<>'array'
 THEN RAISE EXCEPTION 'Free agency pool is invalid';END IF;
 FOR v_oteam,v_ordinal IN SELECT value,ordinality FROM pg_catalog.jsonb_array_elements(v_oldteams) WITH ORDINALITY LOOP
  v_nteam:=v_newteams->(v_ordinal-1);
  v_name:=v_oteam->>'name';
  IF v_name IS NULL OR v_name IS DISTINCT FROM v_nteam->>'name' OR
     (v_oteam-'players'-'twoWayPlayers'-'stashPlayers') IS DISTINCT FROM
     (v_nteam-'players'-'twoWayPlayers'-'stashPlayers')
  THEN RAISE EXCEPTION 'Online market changed a team identity or financial metadata';END IF;
  FOREACH v_bucket IN ARRAY ARRAY['players','twoWayPlayers','stashPlayers'] LOOP
   v_roster:=coalesce(v_nteam->v_bucket,'[]'::jsonb);
   IF pg_catalog.jsonb_typeof(v_roster)<>'array' THEN RAISE EXCEPTION 'Invalid roster bucket';END IF;
   FOR v_player IN SELECT value FROM pg_catalog.jsonb_array_elements(coalesce(v_oteam->v_bucket,'[]'::jsonb)) LOOP
    v_id:=v_player->>'id';
    IF v_id IS NULL THEN RAISE EXCEPTION 'Missing roster player ID';END IF;
    SELECT x.value INTO v_afterplayer FROM pg_catalog.jsonb_array_elements(v_roster) x
      WHERE x.value->>'id'=v_id;
    IF NOT FOUND OR (v_player->'contract') IS DISTINCT FROM (v_afterplayer->'contract') OR
       v_player->>'name' IS DISTINCT FROM v_afterplayer->>'name' OR
       v_player->>'overall' IS DISTINCT FROM v_afterplayer->>'overall' OR
       v_player->>'potential' IS DISTINCT FROM v_afterplayer->>'potential' OR
       v_player->>'age' IS DISTINCT FROM v_afterplayer->>'age' OR
       v_player->>'pos' IS DISTINCT FROM v_afterplayer->>'pos'
    THEN RAISE EXCEPTION 'Market removed or changed an existing signed player';END IF;
   END LOOP;
   FOR v_player IN SELECT value FROM pg_catalog.jsonb_array_elements(v_roster) LOOP
    v_id:=v_player->>'id';
    IF v_id IS NULL OR v_seen ? v_id THEN RAISE EXCEPTION 'Duplicate roster player ID';END IF;
    v_seen:=pg_catalog.jsonb_set(v_seen,ARRAY[v_id],'true'::jsonb,true);
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(coalesce(v_oteam->v_bucket,'[]'::jsonb)) x
      WHERE x.value->>'id'=v_id) THEN
      IF v_bucket<>'players' OR
         EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(v_newpool) x WHERE x.value->>'id'=v_id)
      THEN RAISE EXCEPTION 'A free agency signing duplicated a player';END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(v_oldpool) x
        WHERE x.value->>'id'=v_id AND x.value->>'name'=v_player->>'name' AND
              x.value->>'overall' IS NOT DISTINCT FROM v_player->>'overall' AND
              x.value->>'potential' IS NOT DISTINCT FROM v_player->>'potential' AND
              x.value->>'age' IS NOT DISTINCT FROM v_player->>'age') THEN
       -- Original single-player engine can create low-impact CPU-only minimum
       -- roster fillers at market completion. All provenance must match.
       IF v_phase<>'complete' OR p_mode NOT IN ('resolve','next') OR v_name=ANY(v_humans) OR
          v_player->>'generatedEmergencyFiller' IS DISTINCT FROM 'true' OR
          v_player->>'generatedForTeamName' IS DISTINCT FROM v_name OR
          (v_player->>'generatedSeasonYear')::int IS DISTINCT FROM p_year OR
          v_id !~ ('^cpu_min_roster_filler_'||p_year||'_[[:alnum:]_]+_[0-9]+$') OR
          v_player->>'name' !~ '^Emergency (PG|SG|SF|PF|C) [0-9]+$' OR
          (v_player->>'overall')::int NOT BETWEEN 62 AND 66 OR
          (v_player->>'potential')::int IS DISTINCT FROM (v_player->>'overall')::int+1 OR
          (v_player->>'age')::int NOT BETWEEN 24 AND 31 OR
          (v_player#>>'{contract,startYear}')::int IS DISTINCT FROM p_year OR
          pg_catalog.jsonb_typeof(v_player#>'{contract,salaryByYear}') IS DISTINCT FROM 'array' OR
          pg_catalog.jsonb_array_length(v_player#>'{contract,salaryByYear}')<>1 OR
          (v_player#>>'{contract,salaryByYear,0}')::int NOT BETWEEN 1000000 AND 4000000
       THEN RAISE EXCEPTION 'Market created an unverified replacement player';END IF;
       v_generated:=v_generated+1;
      ELSE
       v_added:=v_added+1;v_signed:=pg_catalog.jsonb_set(v_signed,ARRAY[v_id],'true'::jsonb,true);
      END IF;
      IF p_mode='decision' AND v_id IS DISTINCT FROM pg_catalog.substr(p_player_key, 4) THEN
       RAISE EXCEPTION 'GM decision signed a different player';END IF;
      IF p_mode IN ('resolve','next') AND v_name=ANY(v_humans) THEN
       RAISE EXCEPTION 'Host or CPU engine tried to sign for another human GM';END IF;
      IF p_mode='decision' AND v_name IS DISTINCT FROM v_team THEN
       IF p_kind<>'rfa' OR p_choice<>'decline' OR NOT EXISTS(
         SELECT 1 FROM pg_catalog.jsonb_array_elements(coalesce(v_oldmarket->'pendingRfaMatchDecisions','[]'::jsonb)) x
          WHERE x.value->>'playerKey'='id:'||v_id AND x.value->>'rightsTeamName'=v_team AND
                x.value->>'offeringTeamName'=v_name)
       THEN RAISE EXCEPTION 'GM decision tried to sign another team player';END IF;
      END IF;
    END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 FOR v_player IN SELECT value FROM pg_catalog.jsonb_array_elements(v_newpool) LOOP
  v_id:=v_player->>'id';
  IF v_id IS NULL OR v_seen ? v_id THEN RAISE EXCEPTION 'Duplicate free agent/roster player';END IF;
  v_seen:=pg_catalog.jsonb_set(v_seen,ARRAY[v_id],'true'::jsonb,true);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(v_oldpool) x
     WHERE x.value->>'id'=v_id AND x.value->>'name'=v_player->>'name' AND
           x.value->>'overall' IS NOT DISTINCT FROM v_player->>'overall' AND
           x.value->>'potential' IS NOT DISTINCT FROM v_player->>'potential' AND
           x.value->>'age' IS NOT DISTINCT FROM v_player->>'age')
  THEN RAISE EXCEPTION 'Market fabricated or rewrote an unsigned free agent';END IF;
 END LOOP;
 FOR v_player IN SELECT value FROM pg_catalog.jsonb_array_elements(v_oldpool) LOOP
  v_id:=v_player->>'id';
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(v_newpool) x WHERE x.value->>'id'=v_id) THEN
   IF NOT (v_signed ? v_id) THEN RAISE EXCEPTION 'Player disappeared from the free agent pool without signing';END IF;
   v_removed:=v_removed+1;
  END IF;
 END LOOP;
 IF v_added<>v_removed OR v_generated>60 THEN RAISE EXCEPTION 'Roster moves and free agent departures do not reconcile';END IF;
 IF pg_catalog.jsonb_typeof(v_newmarket->'pendingUserDecisions')<>'array' OR
    pg_catalog.jsonb_typeof(v_newmarket->'pendingRfaMatchDecisions')<>'array' OR
    pg_catalog.jsonb_typeof(v_newmarket->'signedPlayersLog')<>'array' OR
    pg_catalog.jsonb_typeof(v_newmarket->'offersByPlayer')<>'object' OR
    pg_catalog.jsonb_array_length(v_newmarket->'signedPlayersLog')<
    pg_catalog.jsonb_array_length(coalesce(v_oldmarket->'signedPlayersLog','[]'::jsonb))
 THEN RAISE EXCEPTION 'Malformed or truncated market decision ledger';END IF;
 FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(v_newmarket->'pendingUserDecisions') LOOP
  IF NOT (v_row->>'teamName'=ANY(v_humans)) OR
     NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(v_newpool) p WHERE p.value->>'id'=v_row->>'playerId')
  THEN RAISE EXCEPTION 'Pending signing belongs to an invalid manager or player';END IF;
 END LOOP;
 FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(v_newmarket->'pendingRfaMatchDecisions') LOOP
  IF NOT (v_row->>'rightsTeamName'=ANY(v_humans)) OR
     NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(v_newpool) p WHERE p.value->>'id'=v_row->>'playerId')
  THEN RAISE EXCEPTION 'Pending RFA decision belongs to an invalid manager or player';END IF;
 END LOOP;
 IF v_phase='decisions' AND
    pg_catalog.jsonb_array_length(v_newmarket->'pendingUserDecisions')+
    pg_catalog.jsonb_array_length(v_newmarket->'pendingRfaMatchDecisions')=0
 THEN RAISE EXCEPTION 'Empty GM decision checkpoint';END IF;
 IF v_phase IN ('offers','needs_next','needs_finish','complete') AND
    (pg_catalog.jsonb_array_length(v_newmarket->'pendingUserDecisions')+
     pg_catalog.jsonb_array_length(v_newmarket->'pendingRfaMatchDecisions'))<>0
 THEN RAISE EXCEPTION 'Pending GM decisions were skipped';END IF;
 IF v_phase='complete' THEN
  IF v_newstage->>'status' IS DISTINCT FROM 'complete' OR v_newmarket->>'isActive' IS DISTINCT FROM 'false' OR
     v_newmarket->>'marketComplete' IS DISTINCT FROM 'true' OR
     v_new#>>'{offseasonState,freeAgencyComplete}' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'Market closed without completing the authoritative resolution';END IF;
 ELSE
  IF v_newstage->>'status' IS DISTINCT FROM 'active' OR
     v_newmarket->>'isActive' IS DISTINCT FROM 'true' OR
     v_new#>>'{offseasonState,freeAgencyComplete}' IS DISTINCT FROM 'false'
  THEN RAISE EXCEPTION 'Invalid still-open free-agency state';END IF;
 END IF;
 PERFORM pg_catalog.set_config('bm.online_free_agency_write',p_lobby::text,true);
 UPDATE public.bm_online_franchise_runtime r SET state=v_new,revision=v_revision+1,updated_at=now()
  WHERE r.lobby_id=p_lobby;
 INSERT INTO public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
 VALUES(p_lobby,v_revision+1,p_request,p_actor,v_event,
  pg_catalog.jsonb_build_object('year',p_year,'day',v_old_day,'phase',v_phase,
   'kind',p_kind,'playerKey',p_player_key,'choice',p_choice,'signings',v_added,'emergencyFillers',v_generated,'inputHash',p_input_hash));
 RETURN pg_catalog.jsonb_build_object('ok',true,'revision',v_revision+1,
   'phase',v_phase,'day',v_new_day,'signings',v_added);
END $$;
REVOKE ALL ON FUNCTION public.bm_online_market_step_phase2e4c2(uuid,uuid,uuid,bigint,int,text,text,text,text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bm_online_market_step_phase2e4c2(uuid,uuid,uuid,bigint,int,text,text,text,text,text,jsonb)
 TO service_role;
-- The 2E.4-C1 GM bid RPC originally accepted only day 1. Update it here
-- for every bidding day; preserve all prior team/offer ledger protections.
CREATE OR REPLACE FUNCTION public.bm_online_submit_market_offer_phase2e4c(
 p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,
 p_year int,p_input_hash text,p_market jsonb,p_player_id text,p_offer jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_state jsonb;v_rev bigint;v_team text;v_old jsonb;v_key text;v_board jsonb;
 v_next_board jsonb;v_next_rows jsonb;v_old_rows jsonb;v_row jsonb;
 v_history jsonb;v_daily jsonb;v_expected jsonb;v_count int:=0;v_previous int:=0;
 v_prior public.bm_online_franchise_events%ROWTYPE;v_next jsonb;
BEGIN
 IF p_lobby IS NULL OR p_actor IS NULL OR p_request IS NULL OR p_expected_revision IS NULL OR p_expected_revision<1 OR
    p_year NOT BETWEEN 2026 AND 2100 OR p_input_hash IS NULL OR p_input_hash !~ '^[a-f0-9]{64}$' OR
    p_player_id IS NULL OR pg_catalog.length(p_player_id) NOT BETWEEN 1 AND 150 OR
    pg_catalog.jsonb_typeof(p_market) IS DISTINCT FROM 'object' OR
    pg_catalog.jsonb_typeof(p_offer) IS DISTINCT FROM 'object' OR
    pg_catalog.octet_length(p_market::text)>12000000
 THEN RAISE EXCEPTION 'Malformed online GM free agent offer';END IF;
 SELECT r.state,r.revision INTO v_state,v_rev FROM public.bm_online_franchise_runtime r
  WHERE r.lobby_id=p_lobby FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Online league unavailable';END IF;
 SELECT m.team_name INTO v_team FROM public.bm_online_lobby_members m
  JOIN public.bm_online_lobbies l ON l.id=m.lobby_id
  WHERE m.lobby_id=p_lobby AND m.user_id=p_actor AND l.status='started';
 IF v_team IS NULL THEN RAISE EXCEPTION 'GM does not own an online team';END IF;
 SELECT * INTO v_prior FROM public.bm_online_franchise_events e
  WHERE e.lobby_id=p_lobby AND e.request_id=p_request;
 IF FOUND THEN
  IF v_prior.actor_id IS DISTINCT FROM p_actor OR v_prior.action_type<>'online_market_offer' OR
     v_prior.details->>'inputHash' IS DISTINCT FROM p_input_hash
  THEN RAISE EXCEPTION 'Reused request ID for another operation';END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'replayed',true,'revision',v_prior.revision);
 END IF;
 IF v_rev<>p_expected_revision THEN RAISE EXCEPTION 'Shared league revision changed';END IF;
 IF v_state#>>'{onlineOffseasonMarket,status}' IS DISTINCT FROM 'active' OR
    v_state#>>'{onlineOffseasonMarket,phase}' IS DISTINCT FROM 'offers' OR
    (v_state#>>'{onlineOffseasonMarket,year}')::int IS DISTINCT FROM p_year OR
    (v_state#>>'{onlineDraft,draftYear}')::int IS DISTINCT FROM p_year OR
    v_state#>>'{freeAgencyState,isActive}' IS DISTINCT FROM 'true' OR
    (v_state#>>'{freeAgencyState,currentDay}')::int NOT BETWEEN 1 AND 10 OR
    (v_state#>>'{onlineOffseasonMarket,day}')::int IS DISTINCT FROM
     (v_state#>>'{freeAgencyState,currentDay}')::int OR
    v_state#>>'{offseasonState,rightsManagementComplete}' IS DISTINCT FROM 'true' OR
    coalesce(v_state#>>'{offseasonState,freeAgencyComplete}','false')='true'
 THEN RAISE EXCEPTION 'Shared free agency is not accepting bids';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(coalesce(v_state->'freeAgents','[]'::jsonb)) p
    WHERE p.value->>'id'=p_player_id) THEN RAISE EXCEPTION 'Free agent is unavailable';END IF;
 v_old:=v_state->'freeAgencyState';v_key:='id:'||p_player_id;
 IF p_offer->>'teamName' IS DISTINCT FROM v_team OR
    p_offer->>'playerId' IS DISTINCT FROM p_player_id OR
    p_offer->>'playerKey' IS DISTINCT FROM v_key OR
    p_offer->>'offerId' IS DISTINCT FROM (v_key||'|'||v_team) OR
    p_offer->>'source' IS DISTINCT FROM 'user' OR p_offer->>'status' IS DISTINCT FROM 'active' OR
    (p_offer->>'submittedDay')::int IS DISTINCT FROM (v_old->>'currentDay')::int OR
    pg_catalog.jsonb_typeof(p_offer->'salaryByYear') IS DISTINCT FROM 'array' OR
    pg_catalog.jsonb_array_length(p_offer->'salaryByYear') NOT BETWEEN 1 AND 5 OR
    p_offer->'salaryByYear' IS DISTINCT FROM p_offer#>'{contract,salaryByYear}'
 THEN RAISE EXCEPTION 'Forged or invalid original-engine player offer';END IF;
 IF (v_old-'offersByPlayer'-'offerHistory'-'dailyLog') IS DISTINCT FROM
    (p_market-'offersByPlayer'-'offerHistory'-'dailyLog') OR
    p_market->>'status' IS DISTINCT FROM 'active' OR
    p_market->>'isActive' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'An offer cannot change contracts, season dates, or cap ledgers';END IF;
 v_board:=coalesce(v_old->'offersByPlayer','{}'::jsonb);
 IF pg_catalog.jsonb_typeof(v_board)<>'object' OR
    pg_catalog.jsonb_typeof(p_market->'offersByPlayer')<>'object' OR
    (v_board-v_key) IS DISTINCT FROM (p_market->'offersByPlayer'-v_key)
 THEN RAISE EXCEPTION 'An offer cannot edit another player or team bid';END IF;
 v_old_rows:=coalesce(v_board->v_key,'[]'::jsonb);
 v_next_rows:='[]'::jsonb;
 v_history:=coalesce(v_old->'offerHistory','[]'::jsonb);
 v_daily:=coalesce(v_old->'dailyLog','[]'::jsonb);
 IF pg_catalog.jsonb_typeof(v_old_rows)<>'array' OR pg_catalog.jsonb_array_length(v_old_rows)>30 OR
    pg_catalog.jsonb_typeof(v_history)<>'array' OR pg_catalog.jsonb_typeof(v_daily)<>'array'
 THEN RAISE EXCEPTION 'Existing market offer board is invalid';END IF;
 FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(v_old_rows) LOOP
  IF v_row->>'teamName'=v_team THEN
   v_previous:=v_previous+1;
   v_history:=v_history||pg_catalog.jsonb_build_array(v_row||
     pg_catalog.jsonb_build_object('status','replaced','replacedByOfferId',p_offer->>'offerId','replacedOnDay',(v_old->>'currentDay')::int));
  ELSE v_next_rows:=v_next_rows||pg_catalog.jsonb_build_array(v_row);
  END IF;
 END LOOP;
 IF v_previous>1 THEN RAISE EXCEPTION 'Duplicate existing bids for this GM';END IF;
 v_next_rows:=v_next_rows||pg_catalog.jsonb_build_array(p_offer);
 v_next_board:=pg_catalog.jsonb_set(v_board,ARRAY[v_key],v_next_rows,true);
 IF v_next_board IS DISTINCT FROM p_market->'offersByPlayer' OR
    v_history IS DISTINCT FROM p_market->'offerHistory'
 THEN RAISE EXCEPTION 'Original free-agency engine bid ledger mismatch';END IF;
 IF v_previous=1 THEN
  v_daily:=v_daily||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'day',(v_old->>'currentDay')::int,'type','offer_replaced','playerKey',v_key,'playerName',p_offer->>'playerName',
    'teamName',v_team,'newOfferId',p_offer->>'offerId'));
 END IF;
 IF v_daily IS DISTINCT FROM p_market->'dailyLog' THEN
  RAISE EXCEPTION 'Unexpected changes to offseason market event history';END IF;
 v_next:=pg_catalog.jsonb_set(v_state,'{freeAgencyState}',p_market,true);
 PERFORM pg_catalog.set_config('bm.online_free_agency_write',p_lobby::text,true);
 UPDATE public.bm_online_franchise_runtime r SET state=v_next,revision=v_rev+1,updated_at=now()
  WHERE r.lobby_id=p_lobby;
 INSERT INTO public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
 VALUES(p_lobby,v_rev+1,p_request,p_actor,'online_market_offer',
  pg_catalog.jsonb_build_object('year',p_year,'teamName',v_team,'playerId',p_player_id,'inputHash',p_input_hash));
 RETURN pg_catalog.jsonb_build_object('ok',true,'revision',v_rev+1);
END $$;
REVOKE ALL ON FUNCTION public.bm_online_submit_market_offer_phase2e4c(uuid,uuid,uuid,bigint,int,text,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bm_online_submit_market_offer_phase2e4c(uuid,uuid,uuid,bigint,int,text,jsonb,text,jsonb) TO service_role;


COMMIT;
