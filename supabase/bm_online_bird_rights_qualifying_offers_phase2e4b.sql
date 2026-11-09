-- Basketball Manager Online 2E.4-B: Bird rights, RFA qualifying-offer tender,
-- QO decline/withdrawal and renunciation. Apply MANUALLY after 2E.4-A.
-- Service-role RPCs only; browser supplies choices to authenticated Express backend.
BEGIN;

CREATE OR REPLACE FUNCTION public.bm_online_submit_rights_phase2e4b(
 p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,
 p_year int,p_input_hash text,p_decisions jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_state jsonb;v_rev bigint;v_team text;v_stage jsonb;v_next jsonb;
 v_prior public.bm_online_franchise_events%ROWTYPE;
 v_id text;v_decision text;v_player jsonb;v_rows jsonb;v_held text;
 v_eligible boolean;v_extended boolean;v_count int:=0;
BEGIN
 IF p_lobby IS NULL OR p_actor IS NULL OR p_request IS NULL OR
    p_expected_revision IS NULL OR p_expected_revision<1 OR p_year IS NULL OR p_year NOT BETWEEN 2026 AND 2100 OR
    p_input_hash IS NULL OR p_input_hash !~ '^[a-f0-9]{64}$' OR
    pg_catalog.jsonb_typeof(p_decisions) IS DISTINCT FROM 'object' OR
    pg_catalog.octet_length(p_decisions::text)>16000
 THEN RAISE EXCEPTION 'Invalid rights request';END IF;
 SELECT r.state,r.revision INTO v_state,v_rev FROM public.bm_online_franchise_runtime r
  WHERE r.lobby_id=p_lobby FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Shared NBA franchise is unavailable';END IF;
 SELECT m.team_name INTO v_team FROM public.bm_online_lobby_members m
  JOIN public.bm_online_lobbies l ON l.id=m.lobby_id
  WHERE l.id=p_lobby AND l.status='started' AND m.user_id=p_actor;
 IF v_team IS NULL THEN RAISE EXCEPTION 'No eligible human GM team';END IF;
 SELECT * INTO v_prior FROM public.bm_online_franchise_events e
  WHERE e.lobby_id=p_lobby AND e.request_id=p_request;
 IF FOUND THEN
  IF v_prior.actor_id IS DISTINCT FROM p_actor OR
     v_prior.action_type <> 'online_rights_submit' OR
     v_prior.details->>'inputHash' IS DISTINCT FROM p_input_hash
  THEN RAISE EXCEPTION 'Request ID already used for another operation';END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'replayed',true,'revision',v_prior.revision);
 END IF;
 IF v_rev <> p_expected_revision THEN RAISE EXCEPTION 'Shared league changed; refresh';END IF;
 IF v_state#>>'{onlineOptions,status}' IS DISTINCT FROM 'complete' OR
    v_state#>>'{offseasonState,optionsComplete}' IS DISTINCT FROM 'true' OR
    (v_state#>>'{onlineOptions,year}')::int IS DISTINCT FROM p_year OR
    (v_state#>>'{onlineDraft,draftYear}')::int IS DISTINCT FROM p_year OR
    coalesce(v_state#>>'{offseasonState,rightsManagementComplete}','false')='true' OR
    coalesce(v_state#>>'{onlineRights,status}','collecting')='complete' OR
    ((v_state#>>'{onlineRights,year}') IS NOT NULL AND
     (v_state#>>'{onlineRights,year}')::int IS DISTINCT FROM p_year)
 THEN RAISE EXCEPTION 'Rights stage is not currently accepting decisions';END IF;
 IF coalesce(v_state#>'{onlineRights,decisionsByTeam}','{}'::jsonb) ? v_team THEN
  RAISE EXCEPTION 'This GM has already submitted rights choices';END IF;
 v_rows:=coalesce(v_state->'freeAgents','[]'::jsonb);
 IF pg_catalog.jsonb_typeof(v_rows)<>'array' THEN RAISE EXCEPTION 'Invalid free agent pool';END IF;
 FOR v_id,v_decision IN SELECT key,value#>>'{}' FROM pg_catalog.jsonb_each(p_decisions) LOOP
  v_count:=v_count+1;
  IF v_count>100 OR pg_catalog.length(v_id) NOT BETWEEN 1 AND 150 OR
     v_id IN ('constructor','prototype','__proto__') OR
     (SELECT pg_catalog.jsonb_typeof(p_decisions->v_id))<>'string'
  THEN RAISE EXCEPTION 'Invalid rights decision player ID';END IF;
  SELECT p.value INTO v_player FROM pg_catalog.jsonb_array_elements(v_rows) p
   WHERE p.value->>'id'=v_id;
  IF v_player IS NULL OR coalesce(v_player->>'rightsRenounced','false')='true' OR
     v_player#>>'{rights,heldByTeam}' IS DISTINCT FROM v_team
  THEN RAISE EXCEPTION 'This team does not own the submitted player rights';END IF;
  v_eligible:=v_player#>>'{qualifyingOfferEligible,status}'='pending';
  v_extended:=v_player#>>'{qualifyingOffer,status}'='extended';
  IF (v_eligible AND v_decision NOT IN ('extend_qo','decline_qo','renounce')) OR
     (v_extended AND v_decision NOT IN ('keep_qo','withdraw_qo','renounce')) OR
     (NOT v_eligible AND NOT v_extended AND v_decision NOT IN ('keep','renounce'))
  THEN RAISE EXCEPTION 'Invalid qualifying offer choice';END IF;
 END LOOP;
 v_stage:=coalesce(v_state->'onlineRights','{}'::jsonb)||
  pg_catalog.jsonb_build_object('status','collecting','year',p_year,
    'decisionsByTeam',coalesce(v_state#>'{onlineRights,decisionsByTeam}','{}'::jsonb));
 v_stage:=pg_catalog.jsonb_set(v_stage,ARRAY['decisionsByTeam',v_team],p_decisions,true);
 v_next:=pg_catalog.jsonb_set(v_state,'{onlineRights}',v_stage,true);
 PERFORM pg_catalog.set_config('bm.online_rights_write',p_lobby::text,true);
 UPDATE public.bm_online_franchise_runtime r SET state=v_next,revision=v_rev+1,updated_at=now()
  WHERE r.lobby_id=p_lobby;
 INSERT INTO public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
 VALUES(p_lobby,v_rev+1,p_request,p_actor,'online_rights_submit',
  pg_catalog.jsonb_build_object('year',p_year,'teamName',v_team,'count',v_count,'inputHash',p_input_hash));
 RETURN pg_catalog.jsonb_build_object('ok',true,'revision',v_rev+1);
END $$;
REVOKE ALL ON FUNCTION public.bm_online_submit_rights_phase2e4b(uuid,uuid,uuid,bigint,int,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bm_online_submit_rights_phase2e4b(uuid,uuid,uuid,bigint,int,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.bm_online_finalize_rights_phase2e4b(
 p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,
 p_year int,p_input_hash text,p_free_agents jsonb,p_summary jsonb,p_decision_log jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_state jsonb;v_rev bigint;v_prior public.bm_online_franchise_events%ROWTYPE;
 v_old jsonb;v_old_p jsonb;v_new_p jsonb;v_decisions jsonb;v_next jsonb;
 v_team text;v_id text;v_choice text;v_qo jsonb;v_old_qo jsonb;
 v_old_rights jsonb;v_new_rights jsonb;v_actor_host uuid;
 v_count int;v_index int;v_human_count int;v_seen text[]:=ARRAY[]::text[];
 v_eligible boolean;v_extended boolean;
BEGIN
 IF p_lobby IS NULL OR p_actor IS NULL OR p_request IS NULL OR p_expected_revision IS NULL OR
    p_expected_revision<1 OR p_year NOT BETWEEN 2026 AND 2100 OR
    p_input_hash IS NULL OR p_input_hash !~ '^[0-9a-f]{64}$' OR
    pg_catalog.jsonb_typeof(p_free_agents) IS DISTINCT FROM 'array' OR
    pg_catalog.jsonb_typeof(p_summary) IS DISTINCT FROM 'object' OR
    pg_catalog.jsonb_typeof(p_decision_log) IS DISTINCT FROM 'array' OR
    pg_catalog.octet_length(p_free_agents::text)>9000000 OR
    pg_catalog.jsonb_array_length(p_decision_log)>400
 THEN RAISE EXCEPTION 'Invalid trusted rights result';END IF;
 SELECT r.state,r.revision INTO v_state,v_rev FROM public.bm_online_franchise_runtime r
  WHERE r.lobby_id=p_lobby FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Shared NBA franchise is unavailable';END IF;
 SELECT l.host_id INTO v_actor_host FROM public.bm_online_lobbies l
  WHERE l.id=p_lobby AND l.status='started';
 IF v_actor_host IS DISTINCT FROM p_actor OR NOT EXISTS(
    SELECT 1 FROM public.bm_online_lobby_members m WHERE m.lobby_id=p_lobby AND m.user_id=p_actor)
 THEN RAISE EXCEPTION 'Only the authenticated franchise host can finalize rights';END IF;
 SELECT * INTO v_prior FROM public.bm_online_franchise_events e
  WHERE e.lobby_id=p_lobby AND e.request_id=p_request;
 IF FOUND THEN
  IF v_prior.actor_id IS DISTINCT FROM p_actor OR
     v_prior.action_type<>'online_rights_finalize' OR
     v_prior.details->>'inputHash' IS DISTINCT FROM p_input_hash
  THEN RAISE EXCEPTION 'Request ID already used for another operation';END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'replayed',true,'revision',v_prior.revision);
 END IF;
 IF v_rev<>p_expected_revision THEN RAISE EXCEPTION 'Shared league changed; refresh';END IF;
 IF v_state#>>'{onlineOptions,status}' IS DISTINCT FROM 'complete' OR
    v_state#>>'{offseasonState,optionsComplete}' IS DISTINCT FROM 'true' OR
    (v_state#>>'{onlineOptions,year}')::int IS DISTINCT FROM p_year OR
    (v_state#>>'{onlineDraft,draftYear}')::int IS DISTINCT FROM p_year OR
    coalesce(v_state#>>'{offseasonState,rightsManagementComplete}','false')='true' OR
    coalesce(v_state#>>'{onlineRights,status}','collecting')='complete'
 THEN RAISE EXCEPTION 'Offseason rights stage is not open';END IF;
 v_decisions:=coalesce(v_state#>'{onlineRights,decisionsByTeam}','{}'::jsonb);
 SELECT count(*),count(distinct m.team_name) INTO v_human_count,v_count
  FROM public.bm_online_lobby_members m WHERE m.lobby_id=p_lobby AND m.team_name IS NOT NULL;
 IF v_human_count<1 OR v_human_count>4 OR v_count<>v_human_count OR
    (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v_decisions))<>v_human_count OR
    EXISTS(SELECT 1 FROM public.bm_online_lobby_members m WHERE m.lobby_id=p_lobby AND m.team_name IS NOT NULL
      AND NOT (v_decisions ? m.team_name))
 THEN RAISE EXCEPTION 'All unique human GMs must submit before the host finalizes';END IF;
 v_old:=coalesce(v_state->'freeAgents','[]'::jsonb);
 IF pg_catalog.jsonb_typeof(v_old) IS DISTINCT FROM 'array' OR
    pg_catalog.jsonb_array_length(v_old) IS DISTINCT FROM pg_catalog.jsonb_array_length(p_free_agents)
 THEN RAISE EXCEPTION 'Free agent population cannot change during rights management';END IF;
 v_count:=pg_catalog.jsonb_array_length(v_old);
 IF v_count>0 THEN
  FOR v_index IN 0..(v_count-1) LOOP
   v_old_p:=v_old->v_index;v_new_p:=p_free_agents->v_index;
   v_id:=v_old_p->>'id';
   IF v_id IS NULL OR v_id='' OR v_id=ANY(v_seen) OR
      v_new_p->>'id' IS DISTINCT FROM v_id OR
      (v_old_p-ARRAY['rights','rightsRenounced','qualifyingOffer','qualifyingOfferEligible','marketValue'])
      IS DISTINCT FROM
      (v_new_p-ARRAY['rights','rightsRenounced','qualifyingOffer','qualifyingOfferEligible','marketValue'])
   THEN RAISE EXCEPTION 'Rights transaction altered player identity, contracts, stats or roster membership';END IF;
   v_seen:=pg_catalog.array_append(v_seen,v_id);
   v_team:=CASE WHEN coalesce(v_old_p->>'rightsRenounced','false')='true' THEN NULL
     ELSE v_old_p#>>'{rights,heldByTeam}' END;
   v_choice:=v_decisions->v_team->>v_id;
   v_old_rights:=coalesce(v_old_p->'rights','{}'::jsonb);
   v_new_rights:=coalesce(v_new_p->'rights','{}'::jsonb);
   v_eligible:=v_old_p#>>'{qualifyingOfferEligible,status}'='pending';
   v_extended:=v_old_p#>>'{qualifyingOffer,status}'='extended';
   IF v_choice IS NULL THEN
    IF v_old_rights->>'heldByTeam' IS DISTINCT FROM v_new_rights->>'heldByTeam' OR
       coalesce(v_old_rights->>'restrictedFreeAgent','false') IS DISTINCT FROM
       coalesce(v_new_rights->>'restrictedFreeAgent','false') OR
       v_old_p->'qualifyingOffer' IS DISTINCT FROM v_new_p->'qualifyingOffer' OR
       v_old_p->'qualifyingOfferEligible' IS DISTINCT FROM v_new_p->'qualifyingOfferEligible' OR
       coalesce(v_old_p->>'rightsRenounced','false') IS DISTINCT FROM
       coalesce(v_new_p->>'rightsRenounced','false')
    THEN RAISE EXCEPTION 'An unsubmitted team lost or gained player rights';END IF;
   ELSIF v_choice='renounce' THEN
    IF coalesce(v_new_rights->>'heldByTeam','')<>'' OR
       coalesce(v_new_rights->>'restrictedFreeAgent','false')<>'false' OR
       v_new_p->>'rightsRenounced' IS DISTINCT FROM 'true' OR
       v_new_p ? 'qualifyingOffer' OR v_new_p ? 'qualifyingOfferEligible'
    THEN RAISE EXCEPTION 'Renunciation did not clear all team-control rights';END IF;
   ELSIF v_choice IN ('extend_qo','keep_qo') THEN
    v_qo:=v_new_p->'qualifyingOffer';
    IF v_new_rights->>'heldByTeam' IS DISTINCT FROM v_team OR
       v_new_rights->>'restrictedFreeAgent'<>'true' OR
       v_qo->>'status' IS DISTINCT FROM 'extended' OR
       v_qo->>'teamName' IS DISTINCT FROM v_team OR
       coalesce((v_qo->>'amount')::numeric,0)<=0 OR
       v_new_p ? 'qualifyingOfferEligible' OR coalesce(v_new_p->>'rightsRenounced','false')='true'
    THEN RAISE EXCEPTION 'Qualifying-offer tender or retention is invalid';END IF;
    IF v_choice='extend_qo' AND (NOT v_eligible OR
      v_qo->>'amount' IS DISTINCT FROM v_old_p#>>'{qualifyingOfferEligible,amount}')
    THEN RAISE EXCEPTION 'Qualifying-offer amount does not match original eligible tender';END IF;
    IF v_choice='keep_qo' AND (NOT v_extended OR
       v_qo->>'amount' IS DISTINCT FROM v_old_p#>>'{qualifyingOffer,amount}')
    THEN RAISE EXCEPTION 'Existing qualifying-offer amount changed unexpectedly';END IF;
   ELSIF v_choice IN ('decline_qo','withdraw_qo') THEN
    IF v_new_rights->>'heldByTeam' IS DISTINCT FROM v_team OR
       coalesce(v_new_rights->>'restrictedFreeAgent','false')<>'false' OR
       v_new_p ? 'qualifyingOffer' OR v_new_p ? 'qualifyingOfferEligible' OR
       coalesce(v_new_p->>'rightsRenounced','false')='true' OR
       (v_choice='decline_qo' AND NOT v_eligible) OR
       (v_choice='withdraw_qo' AND NOT v_extended)
    THEN RAISE EXCEPTION 'QO declined or withdrawn incorrectly';END IF;
   ELSIF v_choice='keep' THEN
    IF v_new_rights->>'heldByTeam' IS DISTINCT FROM v_team OR v_eligible OR v_extended OR
       coalesce(v_new_rights->>'restrictedFreeAgent','false') IS DISTINCT FROM
       coalesce(v_old_rights->>'restrictedFreeAgent','false')
    THEN RAISE EXCEPTION 'Retained Bird-rights state is invalid';END IF;
   ELSE RAISE EXCEPTION 'Unrecognized rights decision in submitted league';END IF;
  END LOOP;
 END IF;
 v_next:=pg_catalog.jsonb_set(v_state,'{freeAgents}',p_free_agents,true);
 v_next:=pg_catalog.jsonb_set(v_next,'{onlineRights}',
   coalesce(v_state->'onlineRights','{}'::jsonb)||pg_catalog.jsonb_build_object(
    'status','complete','year',p_year,'summary',p_summary,'decisionLog',p_decision_log),true);
 v_next:=pg_catalog.jsonb_set(v_next,'{offseasonState}',
   coalesce(v_state->'offseasonState','{}'::jsonb)||pg_catalog.jsonb_build_object(
    'rightsManagementComplete',true,'rightsResolvedSeasonYear',p_year),true);
 PERFORM pg_catalog.set_config('bm.online_rights_write',p_lobby::text,true);
 UPDATE public.bm_online_franchise_runtime r SET state=v_next,revision=v_rev+1,updated_at=now()
  WHERE r.lobby_id=p_lobby;
 INSERT INTO public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
 VALUES(p_lobby,v_rev+1,p_request,p_actor,'online_rights_finalize',
   pg_catalog.jsonb_build_object('year',p_year,'count',pg_catalog.jsonb_array_length(p_decision_log),'inputHash',p_input_hash));
 RETURN pg_catalog.jsonb_build_object('ok',true,'revision',v_rev+1,'count',pg_catalog.jsonb_array_length(p_decision_log));
END $$;
REVOKE ALL ON FUNCTION public.bm_online_finalize_rights_phase2e4b(uuid,uuid,uuid,bigint,int,text,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bm_online_finalize_rights_phase2e4b(uuid,uuid,uuid,bigint,int,text,jsonb,jsonb,jsonb) TO service_role;

-- Prevent older application paths from forging the readiness checkpoint.
CREATE OR REPLACE FUNCTION public.bm_online_rights_guard_phase2e4b()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF pg_catalog.current_setting('bm.online_rights_write',true) IS DISTINCT FROM NEW.lobby_id::text THEN
  IF OLD.state->'onlineRights' IS DISTINCT FROM NEW.state->'onlineRights' OR
     OLD.state#>'{offseasonState,rightsManagementComplete}' IS DISTINCT FROM NEW.state#>'{offseasonState,rightsManagementComplete}' OR
     OLD.state#>'{offseasonState,rightsResolvedSeasonYear}' IS DISTINCT FROM NEW.state#>'{offseasonState,rightsResolvedSeasonYear}'
  THEN RAISE EXCEPTION 'Only trusted Online Rights Management may change offseason rights completion';END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bm_online_rights_guard_phase2e4b() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS bm_online_rights_guard_phase2e4b ON public.bm_online_franchise_runtime;
CREATE TRIGGER bm_online_rights_guard_phase2e4b BEFORE UPDATE ON public.bm_online_franchise_runtime
 FOR EACH ROW EXECUTE FUNCTION public.bm_online_rights_guard_phase2e4b();
-- While an offseason options/rights window is active, pre-existing cap-room
-- sign/release RPCs must not bypass the 10-day free-agency stage (not yet
-- implemented online). Options finalization changes optionsComplete from
-- false to true and therefore is NOT blocked by this guard.
CREATE OR REPLACE FUNCTION public.bm_online_offseason_market_gate_phase2e4b()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF coalesce(OLD.state#>>'{offseasonState,active}','false')='true' AND
    coalesce(OLD.state#>>'{offseasonState,optionsComplete}','false')='true' AND
    coalesce(OLD.state#>>'{offseasonState,freeAgencyComplete}','false')<>'true' AND
    OLD.state->'freeAgents' IS DISTINCT FROM NEW.state->'freeAgents' AND
    pg_catalog.current_setting('bm.online_rights_write',true) IS DISTINCT FROM NEW.lobby_id::text AND
    pg_catalog.current_setting('bm.online_free_agency_write',true) IS DISTINCT FROM NEW.lobby_id::text
 THEN RAISE EXCEPTION 'The offseason free-agency market is not yet open; do not bypass rights management';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bm_online_offseason_market_gate_phase2e4b() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS bm_online_offseason_market_gate_phase2e4b ON public.bm_online_franchise_runtime;
CREATE TRIGGER bm_online_offseason_market_gate_phase2e4b BEFORE UPDATE ON public.bm_online_franchise_runtime
 FOR EACH ROW EXECUTE FUNCTION public.bm_online_offseason_market_gate_phase2e4b();
COMMIT;
