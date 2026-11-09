-- G3C-A3a: a server-clocked, 24-hour human draft selection window.
-- This is ONLY a draft-pick recovery mechanism. It does not resolve options,
-- Bird rights, or free-agency holds (those are audited separately).
-- Run ONLY after the read-only precheck returns READY for every row.
BEGIN;

-- Never let a client supply the start time, draft year, or selected prospect.
-- Derive the pick's deadline solely from committed draft journal events.
CREATE OR REPLACE FUNCTION public.bm_online_draft_deadline_g3ca3(
  p_lobby uuid,p_year integer,p_index integer
) RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_state jsonb;v_start_rev bigint;v_started timestamptz;
        v_count bigint;v_last timestamptz;
BEGIN
 IF p_lobby IS NULL OR p_year IS NULL OR p_index IS NULL OR p_index<0 THEN RETURN NULL;END IF;
 SELECT state INTO v_state FROM public.bm_online_franchise_runtime WHERE lobby_id=p_lobby;
 IF NOT FOUND OR v_state#>>'{onlineDraft,status}'<>'active' OR
    (v_state#>>'{onlineDraft,draftYear}')::integer IS DISTINCT FROM p_year OR
    (v_state#>>'{onlineDraft,draftState,currentPickIndex}')::integer IS DISTINCT FROM p_index
 THEN RETURN NULL; END IF;
 SELECT e.revision,e.occurred_at INTO v_start_rev,v_started
 FROM public.bm_online_franchise_events e
 WHERE e.lobby_id=p_lobby AND e.action_type='nba_draft_started'
   AND e.details->>'draftYear'=p_year::text
 ORDER BY e.revision DESC LIMIT 1;
 IF v_start_rev IS NULL THEN RETURN NULL; END IF;
 SELECT count(*),max(e.occurred_at) INTO v_count,v_last
 FROM public.bm_online_franchise_events e
 WHERE e.lobby_id=p_lobby AND e.revision>v_start_rev
   AND e.action_type='nba_draft_pick_made'
   AND e.details->>'draftYear'=p_year::text;
 IF v_count IS DISTINCT FROM p_index THEN RETURN NULL; END IF;
 RETURN coalesce(v_last,v_started)+INTERVAL '24 hours';
END $$;
REVOKE ALL ON FUNCTION public.bm_online_draft_deadline_g3ca3(uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bm_online_draft_deadline_g3ca3(uuid,integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.bm_online_draft_fallback_eligible_g3ca3(
 p_lobby uuid,p_year integer,p_index integer,p_owner uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_state jsonb;v_team text;v_deadline timestamptz;
BEGIN
 IF p_owner IS NULL THEN RETURN false; END IF;
 SELECT state INTO v_state FROM public.bm_online_franchise_runtime WHERE lobby_id=p_lobby;
 IF NOT FOUND OR v_state#>>'{onlineDraft,status}'<>'active' THEN RETURN false; END IF;
 -- Read the owner directly from the locked current draft board, not from a caller-provided name.
 SELECT pick->>'currentOwnerTeamName' INTO v_team
 FROM pg_catalog.jsonb_array_elements(v_state#>'{onlineDraft,draftState,draftOrder}') WITH ORDINALITY AS x(pick,n)
 WHERE x.n=p_index+1;
 IF v_team IS NULL OR NOT EXISTS (
   SELECT 1 FROM public.bm_online_lobby_members m
   WHERE m.lobby_id=p_lobby AND m.team_name=v_team AND m.user_id=p_owner
 ) THEN RETURN false; END IF;
 v_deadline:=public.bm_online_draft_deadline_g3ca3(p_lobby,p_year,p_index);
 RETURN v_deadline IS NOT NULL AND pg_catalog.clock_timestamp()>=v_deadline;
END $$;
REVOKE ALL ON FUNCTION public.bm_online_draft_fallback_eligible_g3ca3(uuid,integer,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bm_online_draft_fallback_eligible_g3ca3(uuid,integer,integer,uuid) TO service_role;

-- Read-only clock for league members. The role returned is informational;
-- authoritative host/member and expiry checks are repeated at draft commit.
CREATE OR REPLACE FUNCTION public.bm_online_draft_clock_g3ca3(
 p_lobby uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_state jsonb;v_year int;v_idx int;v_team text;v_owner uuid;
        v_deadline timestamptz;v_active boolean;
BEGIN
 IF p_lobby IS NULL OR auth.uid() IS NULL OR NOT EXISTS (
   SELECT 1 FROM public.bm_online_lobby_members m
   WHERE m.lobby_id=p_lobby AND m.user_id=auth.uid())
 THEN RAISE EXCEPTION 'Not a member of this league';END IF;
 SELECT state INTO v_state FROM public.bm_online_franchise_runtime WHERE lobby_id=p_lobby;
 v_active:=found AND v_state#>>'{onlineDraft,status}'='active';
 IF NOT v_active THEN RETURN pg_catalog.jsonb_build_object('active',false); END IF;
 v_year:=(v_state#>>'{onlineDraft,draftYear}')::int;
 v_idx:=(v_state#>>'{onlineDraft,draftState,currentPickIndex}')::int;
 SELECT pick->>'currentOwnerTeamName' INTO v_team
 FROM pg_catalog.jsonb_array_elements(v_state#>'{onlineDraft,draftState,draftOrder}') WITH ORDINALITY AS x(pick,n)
 WHERE x.n=v_idx+1;
 SELECT m.user_id INTO v_owner FROM public.bm_online_lobby_members m
 WHERE m.lobby_id=p_lobby AND m.team_name=v_team;
 v_deadline:=CASE WHEN v_owner IS NOT NULL
   THEN public.bm_online_draft_deadline_g3ca3(p_lobby,v_year,v_idx) ELSE NULL END;
 RETURN pg_catalog.jsonb_build_object('active',true,'pickIndex',v_idx,
  'humanOwned',v_owner IS NOT NULL,'deadlineAt',v_deadline,
  'eligible',v_owner IS NOT NULL AND v_deadline IS NOT NULL
     AND pg_catalog.clock_timestamp()>=v_deadline);
END $$;
REVOKE ALL ON FUNCTION public.bm_online_draft_clock_g3ca3(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bm_online_draft_clock_g3ca3(uuid) TO authenticated,service_role;

-- Preserve the entire currently-installed draft commit body; modify ONE
-- legacy owner check only, and fail closed if its exact anchor is absent.
DO $guard$
DECLARE v_oid oid;v_def text;v_anchor text;v_insert text;
BEGIN
 v_oid:=pg_catalog.to_regprocedure('public.bm_online_make_draft_pick_phase2e2(uuid,uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,text,boolean)');
 IF v_oid IS NULL THEN RAISE EXCEPTION 'Missing trusted NBA Draft commit function';END IF;
 SELECT pg_catalog.pg_get_functiondef(v_oid) INTO v_def;
 v_anchor:='if v_human_owner is not null or not exists(select 1 from public.bm_online_lobbies l';
 v_insert:='if (v_human_owner is not null and not public.bm_online_draft_fallback_eligible_g3ca3(p_lobby,v_year,v_index,v_human_owner)) or not exists(select 1 from public.bm_online_lobbies l';
 IF pg_catalog.strpos(v_def,v_insert)>0 THEN
   RAISE NOTICE 'G3C-A3 draft commit already patched; retaining body';
 ELSIF pg_catalog.strpos(v_def,v_anchor)=0 OR
     pg_catalog.strpos(pg_catalog.substr(v_def,pg_catalog.strpos(v_def,v_anchor)+1),v_anchor)>0 OR
     pg_catalog.strpos(v_def,'Only the GM assigned to this team may make its selection')=0 OR
     pg_catalog.strpos(v_def,'Another GM already advanced the draft')=0
 THEN RAISE EXCEPTION 'Draft commit differs from audited body; migration stopped, nothing committed';
 ELSE
   EXECUTE pg_catalog.replace(v_def,v_anchor,v_insert);
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=v_oid
   AND p.prosecdef AND EXISTS (SELECT 1 FROM pg_catalog.unnest(p.proconfig) AS u(setting) WHERE setting IN ('search_path=','search_path=""'))
 ) THEN RAISE EXCEPTION 'Draft commit security configuration is inconsistent'; END IF;
END $guard$;
-- Existing commit is server-only; this migration does not grant it to clients.
REVOKE ALL ON FUNCTION public.bm_online_make_draft_pick_phase2e2(uuid,uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bm_online_make_draft_pick_phase2e2(uuid,uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,text,boolean) TO service_role;
COMMIT;
