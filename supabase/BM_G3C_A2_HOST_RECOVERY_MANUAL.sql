-- Basketball Manager Online G3C-A2: atomic commissioner transfer + quorum recovery.
-- MANUAL SQL ONLY. Install after the Online Phase 2A franchise schema.
-- Does not change roster ownership, franchise seed_state, runtime revision, games, or saves.
-- A precheck must return READY for all rows before installation.
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.bm_online_lobbies') IS NULL OR
     to_regclass('public.bm_online_franchises') IS NULL OR
     to_regclass('public.bm_online_lobby_members') IS NULL THEN
     RAISE EXCEPTION 'G3C-A2 prerequisites missing; no installation performed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'bm_online_host_%') OR
    to_regclass('public.bm_online_host_governance') IS NOT NULL OR
    to_regclass('public.bm_online_host_recovery_votes') IS NOT NULL OR
    to_regclass('public.bm_online_host_audit') IS NOT NULL THEN
    RAISE EXCEPTION 'G3C-A2 objects already exist; stop and inspect before retrying';
  END IF;
END $guard$;

CREATE TABLE public.bm_online_host_governance (
  lobby_id uuid PRIMARY KEY REFERENCES public.bm_online_lobbies(id) ON DELETE CASCADE,
  host_last_seen_at timestamptz NOT NULL DEFAULT now(),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation >= 1),
  nominee_id uuid,
  nominee_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bm_g3ca2_nomination_pair CHECK ((nominee_id IS NULL) = (nominee_at IS NULL))
);
CREATE TABLE public.bm_online_host_recovery_votes (
  lobby_id uuid NOT NULL REFERENCES public.bm_online_lobbies(id) ON DELETE CASCADE,
  voter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL,
  generation bigint NOT NULL CHECK (generation >= 1),
  voted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(lobby_id,voter_id)
);
CREATE INDEX bm_g3ca2_recovery_vote_tally ON public.bm_online_host_recovery_votes(lobby_id,generation,candidate_id,voted_at);
CREATE TABLE public.bm_online_host_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lobby_id uuid NOT NULL REFERENCES public.bm_online_lobbies(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('nominate','cancel_nomination','accept_transfer','recovery_vote','recovery_transfer')),
  actor_id uuid NOT NULL,
  former_host_id uuid NOT NULL,
  new_host_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bm_g3ca2_audit_lookup ON public.bm_online_host_audit(lobby_id,id DESC);

ALTER TABLE public.bm_online_host_governance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bm_online_host_recovery_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bm_online_host_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bm_online_host_governance, public.bm_online_host_recovery_votes,
  public.bm_online_host_audit FROM PUBLIC, anon, authenticated;
-- No direct browser reads or writes to governance state. All data is returned by a scoped RPC.

-- Initial timestamp is the migration/install time for existing franchises, NOT a guessed
-- earlier last-seen time. Thus nobody can immediately seize an old league after install.
INSERT INTO public.bm_online_host_governance(lobby_id)
SELECT f.lobby_id FROM public.bm_online_franchises f
JOIN public.bm_online_lobbies l ON l.id=f.lobby_id AND l.status='started';

CREATE FUNCTION public.bm_online_host_governance_init()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  INSERT INTO public.bm_online_host_governance(lobby_id) VALUES (NEW.lobby_id)
    ON CONFLICT(lobby_id) DO NOTHING;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.bm_online_host_governance_init() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER bm_g3ca2_host_governance_init
AFTER INSERT ON public.bm_online_franchises
FOR EACH ROW EXECUTE FUNCTION public.bm_online_host_governance_init();

-- Host heartbeat: only a signed-in, assigned, current commissioner may send one.
-- Heartbeats are triggered on actual user interactions, not unconditional background polls.
-- Reappearance after a recovery vote begins invalidates all outstanding votes atomically.
CREATE FUNCTION public.bm_online_host_heartbeat(p_lobby uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_host uuid; v_status text; v_me uuid:=auth.uid(); v_g public.bm_online_host_governance;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT host_id,status INTO v_host,v_status FROM public.bm_online_lobbies WHERE id=p_lobby FOR UPDATE;
  IF NOT FOUND OR v_status<>'started' OR v_host<>v_me THEN
    RAISE EXCEPTION 'Only the active commissioner can record activity';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.bm_online_lobby_members WHERE lobby_id=p_lobby AND user_id=v_me) THEN
    RAISE EXCEPTION 'Commissioner must be an assigned member';
  END IF;
  SELECT * INTO v_g FROM public.bm_online_host_governance WHERE lobby_id=p_lobby FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commissioner governance state missing'; END IF;
  IF v_g.host_last_seen_at > now() - interval '30 seconds' THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM public.bm_online_host_recovery_votes WHERE lobby_id=p_lobby) THEN
    DELETE FROM public.bm_online_host_recovery_votes WHERE lobby_id=p_lobby;
    UPDATE public.bm_online_host_governance SET generation=generation+1,
      host_last_seen_at=now(),updated_at=now() WHERE lobby_id=p_lobby;
  ELSE
    UPDATE public.bm_online_host_governance SET host_last_seen_at=now(),
      updated_at=now() WHERE lobby_id=p_lobby;
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.bm_online_host_heartbeat(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bm_online_host_heartbeat(uuid) TO authenticated;

-- Voluntary transfer requires current host nomination and nominee's explicit acceptance.
CREATE FUNCTION public.bm_online_host_nominate(p_lobby uuid,p_candidate uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_host uuid;v_status text;v_me uuid:=auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT host_id,status INTO v_host,v_status FROM public.bm_online_lobbies WHERE id=p_lobby FOR UPDATE;
  IF NOT FOUND OR v_status<>'started' OR v_host<>v_me THEN
    RAISE EXCEPTION 'Only the current commissioner may nominate a replacement';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.bm_online_lobby_members WHERE lobby_id=p_lobby AND user_id=v_me) THEN
    RAISE EXCEPTION 'Commissioner must be a member';
  END IF;
  IF p_candidate IS NOT NULL AND (p_candidate=v_me OR NOT EXISTS(
     SELECT 1 FROM public.bm_online_lobby_members WHERE lobby_id=p_lobby AND user_id=p_candidate)) THEN
    RAISE EXCEPTION 'Replacement commissioner must be another assigned GM';
  END IF;
  UPDATE public.bm_online_host_governance SET nominee_id=p_candidate,
    nominee_at=CASE WHEN p_candidate IS NULL THEN NULL ELSE now() END,
    host_last_seen_at=now(),generation=generation+1,updated_at=now() WHERE lobby_id=p_lobby;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commissioner governance state missing'; END IF;
  DELETE FROM public.bm_online_host_recovery_votes WHERE lobby_id=p_lobby;
  INSERT INTO public.bm_online_host_audit(lobby_id,action,actor_id,former_host_id,new_host_id)
  VALUES (p_lobby,CASE WHEN p_candidate IS NULL THEN 'cancel_nomination' ELSE 'nominate' END,v_me,v_me,p_candidate);
END $fn$;
REVOKE ALL ON FUNCTION public.bm_online_host_nominate(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bm_online_host_nominate(uuid,uuid) TO authenticated;

CREATE FUNCTION public.bm_online_host_accept(p_lobby uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_old uuid;v_status text;v_me uuid:=auth.uid();v_g public.bm_online_host_governance;v_rows int;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT host_id,status INTO v_old,v_status FROM public.bm_online_lobbies WHERE id=p_lobby FOR UPDATE;
  IF NOT FOUND OR v_status<>'started' THEN RAISE EXCEPTION 'Started franchise not found'; END IF;
  SELECT * INTO v_g FROM public.bm_online_host_governance WHERE lobby_id=p_lobby FOR UPDATE;
  IF NOT FOUND OR v_g.nominee_id IS DISTINCT FROM v_me OR
      v_g.nominee_at IS NULL OR v_g.nominee_at < now()-interval '7 days' THEN
    RAISE EXCEPTION 'No current commissioner nomination for this account';
  END IF;
  IF v_me=v_old OR NOT EXISTS(SELECT 1 FROM public.bm_online_lobby_members
         WHERE lobby_id=p_lobby AND user_id=v_me) THEN RAISE EXCEPTION 'Nominee must be a different league GM'; END IF;
  -- Ensure the original records agree BEFORE either is modified.
  IF NOT EXISTS(SELECT 1 FROM public.bm_online_franchises WHERE lobby_id=p_lobby AND host_id=v_old) THEN
    RAISE EXCEPTION 'Franchise host mismatch; refusing handoff';
  END IF;
  UPDATE public.bm_online_franchises SET host_id=v_me,updated_at=now()
    WHERE lobby_id=p_lobby AND host_id=v_old;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN RAISE EXCEPTION 'Franchise host update failed'; END IF;
  UPDATE public.bm_online_lobbies SET host_id=v_me,updated_at=now()
    WHERE id=p_lobby AND host_id=v_old;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN RAISE EXCEPTION 'Lobby host update failed'; END IF;
  UPDATE public.bm_online_host_governance SET nominee_id=NULL,nominee_at=NULL,
    host_last_seen_at=now(),generation=generation+1,updated_at=now() WHERE lobby_id=p_lobby;
  DELETE FROM public.bm_online_host_recovery_votes WHERE lobby_id=p_lobby;
  INSERT INTO public.bm_online_host_audit(lobby_id,action,actor_id,former_host_id,new_host_id)
    VALUES(p_lobby,'accept_transfer',v_me,v_old,v_me);
END $fn$;
REVOKE ALL ON FUNCTION public.bm_online_host_accept(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bm_online_host_accept(uuid) TO authenticated;

-- A recovery vote is available only after 48h with no recorded commissioner activity.
-- Quorum is a STRICT majority of NON-HOST league GMs: 1/1, 2/2, 2/3.
-- The candidate must cast a self-vote to consent. Votes expire after 24h.
-- Every voter is a distinct authenticated lobby member; host cannot vote.
-- The lobby row lock serializes elections against heartbeat and voluntary transfer.
CREATE FUNCTION public.bm_online_host_recovery_vote(p_lobby uuid,p_candidate uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_host uuid;v_status text;v_me uuid:=auth.uid();v_g public.bm_online_host_governance;
 v_total int;v_needed int;v_votes int;v_rows int;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT host_id,status INTO v_host,v_status FROM public.bm_online_lobbies WHERE id=p_lobby FOR UPDATE;
  IF NOT FOUND OR v_status<>'started' THEN RAISE EXCEPTION 'Started franchise not found'; END IF;
  IF v_me=v_host OR NOT EXISTS(SELECT 1 FROM public.bm_online_lobby_members
         WHERE lobby_id=p_lobby AND user_id=v_me) THEN
    RAISE EXCEPTION 'Only a non-host league GM can vote';
  END IF;
  IF p_candidate IS NULL OR p_candidate=v_host OR NOT EXISTS(
      SELECT 1 FROM public.bm_online_lobby_members WHERE lobby_id=p_lobby AND user_id=p_candidate) THEN
    RAISE EXCEPTION 'Candidate must be another eligible league GM';
  END IF;
  SELECT * INTO v_g FROM public.bm_online_host_governance WHERE lobby_id=p_lobby FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commissioner governance state missing'; END IF;
  IF v_g.host_last_seen_at > now()-interval '48 hours' THEN
    RAISE EXCEPTION 'Commissioner recovery requires 48 hours without recorded host activity';
  END IF;
  -- A stale vote can never count if the host was active since the voter last voted.
  DELETE FROM public.bm_online_host_recovery_votes WHERE lobby_id=p_lobby AND
    (generation<>v_g.generation OR voted_at<now()-interval '24 hours');
  INSERT INTO public.bm_online_host_recovery_votes(lobby_id,voter_id,candidate_id,generation,voted_at)
    VALUES(p_lobby,v_me,p_candidate,v_g.generation,now())
    ON CONFLICT(lobby_id,voter_id) DO UPDATE SET candidate_id=EXCLUDED.candidate_id,
      generation=EXCLUDED.generation,voted_at=now();
  INSERT INTO public.bm_online_host_audit(lobby_id,action,actor_id,former_host_id,new_host_id)
    VALUES(p_lobby,'recovery_vote',v_me,v_host,p_candidate);
  SELECT count(*) INTO v_total FROM public.bm_online_lobby_members WHERE lobby_id=p_lobby;
  IF v_total<2 OR v_total>4 THEN RAISE EXCEPTION 'Unsupported league membership count'; END IF;
  v_needed:=((v_total-1)/2)+1;
  SELECT count(*) INTO v_votes FROM public.bm_online_host_recovery_votes
    WHERE lobby_id=p_lobby AND generation=v_g.generation AND candidate_id=p_candidate
      AND voted_at>=now()-interval '24 hours';
  IF v_votes<v_needed OR NOT EXISTS (
    SELECT 1 FROM public.bm_online_host_recovery_votes
     WHERE lobby_id=p_lobby AND voter_id=p_candidate AND candidate_id=p_candidate
       AND generation=v_g.generation AND voted_at>=now()-interval '24 hours') THEN
    RETURN false;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.bm_online_franchises WHERE lobby_id=p_lobby AND host_id=v_host) THEN
    RAISE EXCEPTION 'Franchise host mismatch; refusing recovery';
  END IF;
  UPDATE public.bm_online_franchises SET host_id=p_candidate,updated_at=now()
    WHERE lobby_id=p_lobby AND host_id=v_host;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN RAISE EXCEPTION 'Franchise host update failed'; END IF;
  UPDATE public.bm_online_lobbies SET host_id=p_candidate,updated_at=now()
    WHERE id=p_lobby AND host_id=v_host;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN RAISE EXCEPTION 'Lobby host update failed'; END IF;
  UPDATE public.bm_online_host_governance SET nominee_id=NULL,nominee_at=NULL,
    host_last_seen_at=now(),generation=generation+1,updated_at=now() WHERE lobby_id=p_lobby;
  DELETE FROM public.bm_online_host_recovery_votes WHERE lobby_id=p_lobby;
  INSERT INTO public.bm_online_host_audit(lobby_id,action,actor_id,former_host_id,new_host_id)
    VALUES(p_lobby,'recovery_transfer',v_me,v_host,p_candidate);
  RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.bm_online_host_recovery_vote(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bm_online_host_recovery_vote(uuid,uuid) TO authenticated;

-- Member-scoped read model; no direct table permissions are exposed to browsers.
CREATE FUNCTION public.bm_online_host_status(p_lobby uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_me uuid:=auth.uid();v_host uuid;v_status text;v_g public.bm_online_host_governance;
  v_total int;v_quorum int;v_votes jsonb;
BEGIN
  IF v_me IS NULL OR NOT EXISTS(SELECT 1 FROM public.bm_online_lobby_members
      WHERE lobby_id=p_lobby AND user_id=v_me) THEN
    RAISE EXCEPTION 'League membership required';
  END IF;
  SELECT host_id,status INTO v_host,v_status FROM public.bm_online_lobbies WHERE id=p_lobby;
  IF NOT FOUND OR v_status<>'started' THEN RAISE EXCEPTION 'Started franchise not found'; END IF;
  SELECT * INTO v_g FROM public.bm_online_host_governance WHERE lobby_id=p_lobby;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commissioner governance state missing'; END IF;
  SELECT count(*) INTO v_total FROM public.bm_online_lobby_members WHERE lobby_id=p_lobby;
  v_quorum:=((v_total-1)/2)+1;
  SELECT coalesce(jsonb_agg(jsonb_build_object('candidate_id',candidate_id,'votes',n) ORDER BY n DESC),'[]'::jsonb)
    INTO v_votes FROM (
    SELECT candidate_id,count(*)::int AS n FROM public.bm_online_host_recovery_votes
    WHERE lobby_id=p_lobby AND generation=v_g.generation AND voted_at>=now()-interval '24 hours'
    GROUP BY candidate_id
  ) t;
  RETURN jsonb_build_object(
    'host_id',v_host, 'host_last_seen_at',v_g.host_last_seen_at,
    'server_now',now(), 'is_host',(v_me=v_host), 'recovery_eligible',(v_me<>v_host AND v_g.host_last_seen_at<=now()-interval '48 hours'),
    'inactivity_hours',48, 'quorum',v_quorum, 'votes',v_votes,
    'nominee_id',CASE WHEN v_g.nominee_at>=now()-interval '7 days' THEN v_g.nominee_id ELSE NULL END,
    'nominee_until',CASE WHEN v_g.nominee_at>=now()-interval '7 days' THEN v_g.nominee_at+interval '7 days' ELSE NULL END,
    'my_vote',(SELECT candidate_id FROM public.bm_online_host_recovery_votes
       WHERE lobby_id=p_lobby AND voter_id=v_me AND generation=v_g.generation AND voted_at>=now()-interval '24 hours'),
    'generation',v_g.generation
  );
END $fn$;
REVOKE ALL ON FUNCTION public.bm_online_host_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bm_online_host_status(uuid) TO authenticated;

COMMIT;
