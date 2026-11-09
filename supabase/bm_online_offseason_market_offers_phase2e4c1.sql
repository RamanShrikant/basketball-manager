-- Basketball Manager Online 2E.4-C1 — opening market + server-evaluated GM bids.
-- Apply manually AFTER 2E.4-B. This intentionally DOES NOT settle bids or sign players.
BEGIN;

CREATE OR REPLACE FUNCTION public.bm_online_open_market_phase2e4c(
 p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,
 p_year int,p_input_hash text,p_market jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_state jsonb;v_rev bigint;v_host uuid;v_count int;v_unique int;
 v_prior public.bm_online_franchise_events%ROWTYPE;v_offer jsonb;
 v_id text;v_team text;v_humans text[];v_teams jsonb;v_next jsonb;
BEGIN
 IF p_lobby IS NULL OR p_actor IS NULL OR p_request IS NULL OR
    p_expected_revision IS NULL OR p_expected_revision<1 OR p_year NOT BETWEEN 2026 AND 2100 OR
    p_input_hash IS NULL OR p_input_hash !~ '^[a-f0-9]{64}$' OR
    pg_catalog.jsonb_typeof(p_market) IS DISTINCT FROM 'object' OR
    pg_catalog.octet_length(p_market::text)>12000000
 THEN RAISE EXCEPTION 'Invalid offseason market request';END IF;
 SELECT r.state,r.revision INTO v_state,v_rev FROM public.bm_online_franchise_runtime r
  WHERE r.lobby_id=p_lobby FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No shared online league';END IF;
 SELECT l.host_id INTO v_host FROM public.bm_online_lobbies l
  WHERE l.id=p_lobby AND l.status='started';
 IF v_host IS DISTINCT FROM p_actor OR NOT EXISTS(
  SELECT 1 FROM public.bm_online_lobby_members m WHERE m.lobby_id=p_lobby AND m.user_id=p_actor
 ) THEN RAISE EXCEPTION 'Only the current league host can open offseason free agency';END IF;
 SELECT * INTO v_prior FROM public.bm_online_franchise_events e
  WHERE e.lobby_id=p_lobby AND e.request_id=p_request;
 IF FOUND THEN
  IF v_prior.actor_id IS DISTINCT FROM p_actor OR v_prior.action_type<>'online_market_open' OR
     v_prior.details->>'inputHash' IS DISTINCT FROM p_input_hash
  THEN RAISE EXCEPTION 'Reused request ID for another operation';END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'replayed',true,'revision',v_prior.revision);
 END IF;
 IF v_rev<>p_expected_revision THEN RAISE EXCEPTION 'Online league changed; refresh';END IF;
 IF v_state#>>'{onlineRights,status}' IS DISTINCT FROM 'complete' OR
    (v_state#>>'{onlineRights,year}')::int IS DISTINCT FROM p_year OR
    v_state#>>'{offseasonState,rightsManagementComplete}' IS DISTINCT FROM 'true' OR
    v_state#>>'{onlineOptions,status}' IS DISTINCT FROM 'complete' OR
    v_state#>>'{offseasonState,optionsComplete}' IS DISTINCT FROM 'true' OR
    v_state#>>'{onlineRookieSignings,status}' IS DISTINCT FROM 'complete' OR
    (v_state#>>'{onlineDraft,draftYear}')::int IS DISTINCT FROM p_year OR
    coalesce(v_state#>>'{offseasonState,freeAgencyComplete}','false')='true' OR
    coalesce(v_state#>>'{onlineOffseasonMarket,status}','not_started')<>'not_started' OR
    coalesce(v_state#>>'{freeAgencyState,isActive}','false')='true'
 THEN RAISE EXCEPTION 'Rights must finish before opening the unique offseason market';END IF;
 IF p_market->>'status' IS DISTINCT FROM 'active' OR
    p_market->>'isActive' IS DISTINCT FROM 'true' OR
    (p_market->>'currentDay')::int IS DISTINCT FROM 1 OR
    (p_market->>'maxDays')::int IS DISTINCT FROM 10 OR
    (p_market->>'seasonYear')::int IS DISTINCT FROM p_year OR
    pg_catalog.jsonb_typeof(p_market->'offersByPlayer') IS DISTINCT FROM 'object' OR
    p_market->'pendingUserDecisions' IS DISTINCT FROM '[]'::jsonb OR
    p_market->'pendingRfaMatchDecisions' IS DISTINCT FROM '[]'::jsonb OR
    p_market->'signedPlayersLog' IS DISTINCT FROM '[]'::jsonb OR
    p_market->>'marketComplete' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Invalid original engine market-open payload';END IF;
 SELECT count(*),count(distinct m.team_name),pg_catalog.array_agg(m.team_name)
  INTO v_count,v_unique,v_humans FROM public.bm_online_lobby_members m
  WHERE m.lobby_id=p_lobby AND m.team_name IS NOT NULL;
 IF v_count NOT BETWEEN 1 AND 4 OR v_unique<>v_count THEN RAISE EXCEPTION 'Invalid human GMs';END IF;
 v_teams:=CASE WHEN pg_catalog.jsonb_typeof(v_state->'teams')='array' THEN v_state->'teams'
  ELSE coalesce(v_state#>'{conferences,East}','[]'::jsonb)||coalesce(v_state#>'{conferences,West}','[]'::jsonb) END;
 IF pg_catalog.jsonb_array_length(v_teams)<>30 THEN RAISE EXCEPTION 'Invalid NBA league teams';END IF;
 FOR v_id,v_offer IN SELECT key,value FROM pg_catalog.jsonb_each(p_market->'offersByPlayer') LOOP
  IF pg_catalog.jsonb_typeof(v_offer)<>'array' OR pg_catalog.jsonb_array_length(v_offer)>30
  THEN RAISE EXCEPTION 'Invalid CPU offer board';END IF;
  FOR v_offer IN SELECT value FROM pg_catalog.jsonb_array_elements(v_offer) LOOP
   v_team:=v_offer->>'teamName';
   IF v_offer->>'source' IS DISTINCT FROM 'cpu' OR
      v_team=ANY(v_humans) OR NOT EXISTS(
       SELECT 1 FROM pg_catalog.jsonb_array_elements(v_teams) t WHERE t.value->>'name'=v_team) OR
      NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(coalesce(v_state->'freeAgents','[]'::jsonb)) p
       WHERE p.value->>'id'=v_offer->>'playerId') OR
      v_offer->>'playerKey' IS DISTINCT FROM v_id
   THEN RAISE EXCEPTION 'CPU free-agent offer targets an invalid team or player';END IF;
  END LOOP;
 END LOOP;
 v_next:=pg_catalog.jsonb_set(v_state,'{freeAgencyState}',p_market,true);
 v_next:=pg_catalog.jsonb_set(v_next,'{onlineOffseasonMarket}',
  pg_catalog.jsonb_build_object('status','active','year',p_year,'phase','offers','day',1),true);
 PERFORM pg_catalog.set_config('bm.online_free_agency_write',p_lobby::text,true);
 UPDATE public.bm_online_franchise_runtime r SET state=v_next,revision=v_rev+1,updated_at=now()
  WHERE r.lobby_id=p_lobby;
 INSERT INTO public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
  VALUES(p_lobby,v_rev+1,p_request,p_actor,'online_market_open',
   pg_catalog.jsonb_build_object('year',p_year,'inputHash',p_input_hash));
 RETURN pg_catalog.jsonb_build_object('ok',true,'revision',v_rev+1);
END $$;
REVOKE ALL ON FUNCTION public.bm_online_open_market_phase2e4c(uuid,uuid,uuid,bigint,int,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bm_online_open_market_phase2e4c(uuid,uuid,uuid,bigint,int,text,jsonb) TO service_role;

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
    (v_state#>>'{freeAgencyState,currentDay}')::int IS DISTINCT FROM 1 OR
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
    (p_offer->>'submittedDay')::int IS DISTINCT FROM 1 OR
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
     pg_catalog.jsonb_build_object('status','replaced','replacedByOfferId',p_offer->>'offerId','replacedOnDay',1));
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
    'day',1,'type','offer_replaced','playerKey',v_key,'playerName',p_offer->>'playerName',
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

-- Prevent older direct market-state writes from bypassing authenticated offers.
CREATE OR REPLACE FUNCTION public.bm_online_market_guard_phase2e4c()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF pg_catalog.current_setting('bm.online_free_agency_write',true) IS DISTINCT FROM NEW.lobby_id::text AND
    (OLD.state->'onlineOffseasonMarket' IS DISTINCT FROM NEW.state->'onlineOffseasonMarket' OR
      ((coalesce(OLD.state#>>'{onlineOffseasonMarket,status}','')='active' OR
        coalesce(NEW.state#>>'{onlineOffseasonMarket,status}','')='active') AND
       OLD.state->'freeAgencyState' IS DISTINCT FROM NEW.state->'freeAgencyState'))
 THEN RAISE EXCEPTION 'Only trusted offseason free-agency functions may change the market';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bm_online_market_guard_phase2e4c() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS bm_online_market_guard_phase2e4c ON public.bm_online_franchise_runtime;
CREATE TRIGGER bm_online_market_guard_phase2e4c BEFORE UPDATE ON public.bm_online_franchise_runtime
 FOR EACH ROW EXECUTE FUNCTION public.bm_online_market_guard_phase2e4c();
COMMIT;
