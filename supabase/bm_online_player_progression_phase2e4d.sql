-- Basketball Manager Online Phase 2E.4-D — authoritative player progression.
-- MANUAL SQL EDITOR INSTALLATION ONLY, after successful Phase 2E.4-C2.
-- Installs a service-role-only RPC, revisioned/idempotent transaction, and guard.
-- Does not update existing league rows during migration.
BEGIN;

CREATE OR REPLACE FUNCTION public.bm_online_apply_progression_phase2e4d(
 p_lobby uuid, p_actor uuid, p_request uuid, p_expected_revision bigint,
 p_year int, p_input_hash text, p_new_state jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_old jsonb; v_new jsonb:=p_new_state; v_revision bigint; v_host uuid;
 v_old_teams jsonb; v_new_teams jsonb; v_ot jsonb; v_nt jsonb;
 v_op jsonb; v_np jsonb; v_old_arr jsonb; v_new_arr jsonb;
 v_count int:=0; v_improved int:=0; v_declined int:=0; v_held int:=0;
 v_aged int:=0; v_rookies int:=0; v_old_age int; v_new_age int;
 v_old_ovr int; v_new_ovr int; v_delta int; v_draft_year int;
 v_old_pot int; v_new_pot int; v_birth_year int;
 v_teamname text; v_bucket text; v_pid text; v_name text;
 v_seen text[]:=ARRAY[]::text[]; v_changes jsonb:='[]'::jsonb;
 v_summary jsonb; v_existing public.bm_online_franchise_events%ROWTYPE;
 v_i int; v_j int;
BEGIN
 IF p_lobby IS NULL OR p_actor IS NULL OR p_request IS NULL OR
    p_expected_revision IS NULL OR p_expected_revision<1 OR
    p_year NOT BETWEEN 2026 AND 2100 OR
    p_input_hash IS NULL OR p_input_hash !~ '^[a-f0-9]{64}$' OR
    pg_catalog.jsonb_typeof(v_new) IS DISTINCT FROM 'object' OR
    pg_catalog.octet_length(v_new::text)>70000000
 THEN RAISE EXCEPTION 'Invalid progression transaction'; END IF;

 SELECT r.state,r.revision INTO v_old,v_revision FROM public.bm_online_franchise_runtime r
  WHERE r.lobby_id=p_lobby FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Online NBA franchise unavailable'; END IF;
 SELECT l.host_id INTO v_host FROM public.bm_online_lobbies l
  WHERE l.id=p_lobby AND l.status='started';
 IF v_host IS NULL OR v_host IS DISTINCT FROM p_actor OR NOT EXISTS (
    SELECT 1 FROM public.bm_online_lobby_members m
    WHERE m.lobby_id=p_lobby AND m.user_id=p_actor
 ) THEN RAISE EXCEPTION 'Only the assigned, authenticated host may finalize progression'; END IF;

 SELECT * INTO v_existing FROM public.bm_online_franchise_events e
  WHERE e.lobby_id=p_lobby AND e.request_id=p_request;
 IF FOUND THEN
  IF v_existing.actor_id IS DISTINCT FROM p_actor OR
     v_existing.action_type IS DISTINCT FROM 'online_player_progression' OR
     v_existing.details->>'inputHash' IS DISTINCT FROM p_input_hash
  THEN RAISE EXCEPTION 'Progression request ID belongs to another operation'; END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'replayed',true,'revision',v_existing.revision);
 END IF;
 IF v_revision IS DISTINCT FROM p_expected_revision THEN
  RAISE EXCEPTION 'Shared NBA league revision changed; refresh and retry'; END IF;

 IF (v_old#>>'{onlineDraft,draftYear}')::int IS DISTINCT FROM p_year OR
    v_old#>>'{onlineRookieSignings,status}' IS DISTINCT FROM 'complete' OR
    v_old#>>'{onlineOptions,status}' IS DISTINCT FROM 'complete' OR
    (v_old#>>'{onlineOptions,year}')::int IS DISTINCT FROM p_year OR
    v_old#>>'{onlineRights,status}' IS DISTINCT FROM 'complete' OR
    (v_old#>>'{onlineRights,year}')::int IS DISTINCT FROM p_year OR
    v_old#>>'{onlineOffseasonMarket,status}' IS DISTINCT FROM 'complete' OR
    (v_old#>>'{onlineOffseasonMarket,year}')::int IS DISTINCT FROM p_year OR
    v_old#>>'{freeAgencyState,marketComplete}' IS DISTINCT FROM 'true' OR
    v_old#>>'{freeAgencyState,isActive}' IS DISTINCT FROM 'false' OR
    v_old#>>'{offseasonState,active}' IS DISTINCT FROM 'true' OR
    v_old#>>'{offseasonState,optionsComplete}' IS DISTINCT FROM 'true' OR
    v_old#>>'{offseasonState,rightsManagementComplete}' IS DISTINCT FROM 'true' OR
    v_old#>>'{offseasonState,freeAgencyComplete}' IS DISTINCT FROM 'true' OR
    v_old->'onlineProgression' IS NOT NULL OR
    v_old#>>'{offseasonState,progressionComplete}'='true'
 THEN RAISE EXCEPTION 'Complete the NBA offseason market before progressing players once'; END IF;

 -- Only rosters, FA player ratings, progression results, and the two
 -- progression flags may change. Preserve all contracts, awards, picks,
 -- season logs, C2 ledgers, schedule, and standings byte-for-byte in JSONB.
 IF (v_old-'teams'-'conferences'-'freeAgents'-'onlineProgression'-'offseasonState')
    IS DISTINCT FROM
    (v_new-'teams'-'conferences'-'freeAgents'-'onlineProgression'-'offseasonState') OR
    (coalesce(v_old->'offseasonState','{}'::jsonb)-'progressionComplete'-'progressionSeasonYear')
    IS DISTINCT FROM
    (coalesce(v_new->'offseasonState','{}'::jsonb)-'progressionComplete'-'progressionSeasonYear') OR
    v_new#>>'{offseasonState,progressionComplete}' IS DISTINCT FROM 'true' OR
    (v_new#>>'{offseasonState,progressionSeasonYear}')::int IS DISTINCT FROM p_year OR
    v_new#>>'{onlineProgression,status}' IS DISTINCT FROM 'complete' OR
    (v_new#>>'{onlineProgression,seasonYear}')::int IS DISTINCT FROM p_year OR
    pg_catalog.jsonb_typeof(v_new#>'{onlineProgression,changes}') IS DISTINCT FROM 'array' OR
    pg_catalog.jsonb_typeof(v_new#>'{onlineProgression,summary}') IS DISTINCT FROM 'object' OR
    (v_new->'onlineProgression'-'status'-'seasonYear'-'summary'-'changes')<>'{}'::jsonb
 THEN RAISE EXCEPTION 'Progression attempted to rewrite unrelated NBA franchise state'; END IF;

 IF pg_catalog.jsonb_typeof(v_old->'teams')='array' THEN
  IF pg_catalog.jsonb_typeof(v_new->'teams') IS DISTINCT FROM 'array' OR
     v_old ? 'conferences' OR v_new ? 'conferences'
  THEN RAISE EXCEPTION 'Unexpected NBA roster layout change'; END IF;
  v_old_teams:=v_old->'teams'; v_new_teams:=v_new->'teams';
 ELSE
  IF pg_catalog.jsonb_typeof(v_old->'conferences') IS DISTINCT FROM 'object' OR
     pg_catalog.jsonb_typeof(v_new->'conferences') IS DISTINCT FROM 'object' OR
     v_old ? 'teams' OR v_new ? 'teams' OR
     (v_old->'conferences'-'East'-'West') IS DISTINCT FROM
     (v_new->'conferences'-'East'-'West') OR
     pg_catalog.jsonb_typeof(v_old#>'{conferences,East}') IS DISTINCT FROM 'array' OR
     pg_catalog.jsonb_typeof(v_old#>'{conferences,West}') IS DISTINCT FROM 'array' OR
     pg_catalog.jsonb_typeof(v_new#>'{conferences,East}') IS DISTINCT FROM 'array' OR
     pg_catalog.jsonb_typeof(v_new#>'{conferences,West}') IS DISTINCT FROM 'array' OR
     pg_catalog.jsonb_array_length(v_old#>'{conferences,East}')<1 OR
     pg_catalog.jsonb_array_length(v_old#>'{conferences,West}')<1 OR
     pg_catalog.jsonb_array_length(v_old#>'{conferences,East}')<>
     pg_catalog.jsonb_array_length(v_new#>'{conferences,East}') OR
     pg_catalog.jsonb_array_length(v_old#>'{conferences,West}')<>
     pg_catalog.jsonb_array_length(v_new#>'{conferences,West}')
  THEN RAISE EXCEPTION 'Unexpected NBA conference layout change'; END IF;
  v_old_teams:=(v_old#>'{conferences,East}')||(v_old#>'{conferences,West}');
  v_new_teams:=(v_new#>'{conferences,East}')||(v_new#>'{conferences,West}');
 END IF;
 IF pg_catalog.jsonb_array_length(v_old_teams)<>30 OR
    pg_catalog.jsonb_array_length(v_new_teams)<>30 OR
    (SELECT count(DISTINCT t.value->>'name') FROM pg_catalog.jsonb_array_elements(v_old_teams) t)<>30 OR
    pg_catalog.jsonb_typeof(coalesce(v_old->'freeAgents','[]'::jsonb)) IS DISTINCT FROM 'array' OR
    pg_catalog.jsonb_typeof(coalesce(v_new->'freeAgents','[]'::jsonb)) IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Progression requires 30 unique NBA teams and valid free agents'; END IF;

 FOR v_i IN 0..29 LOOP
  v_ot:=v_old_teams->v_i; v_nt:=v_new_teams->v_i;
  IF v_ot->>'name' IS DISTINCT FROM v_nt->>'name' OR
     (v_ot-'players'-'twoWayPlayers'-'stashPlayers') IS DISTINCT FROM
     (v_nt-'players'-'twoWayPlayers'-'stashPlayers') OR
     (v_ot ? 'players') IS DISTINCT FROM (v_nt ? 'players') OR
     (v_ot ? 'twoWayPlayers') IS DISTINCT FROM (v_nt ? 'twoWayPlayers') OR
     (v_ot ? 'stashPlayers') IS DISTINCT FROM (v_nt ? 'stashPlayers')
  THEN RAISE EXCEPTION 'Team identity, contracts, finances or roster structure changed'; END IF;
  v_teamname:=v_ot->>'name';
  FOREACH v_bucket IN ARRAY ARRAY['players','twoWayPlayers','stashPlayers'] LOOP
   v_old_arr:=coalesce(v_ot->v_bucket,'[]'::jsonb);
   v_new_arr:=coalesce(v_nt->v_bucket,'[]'::jsonb);
   IF pg_catalog.jsonb_typeof(v_old_arr) IS DISTINCT FROM 'array' OR
      pg_catalog.jsonb_typeof(v_new_arr) IS DISTINCT FROM 'array' OR
      pg_catalog.jsonb_array_length(v_old_arr)<>pg_catalog.jsonb_array_length(v_new_arr)
   THEN RAISE EXCEPTION 'Progression inserted, removed or reassigned roster players'; END IF;
   FOR v_j IN 0..pg_catalog.jsonb_array_length(v_old_arr)-1 LOOP
    v_op:=v_old_arr->v_j; v_np:=v_new_arr->v_j;
    -- All buckets are checked again by the uniform player audit below.
    v_pid:=v_op->>'id';
    IF v_pid IS NULL OR pg_catalog.length(v_pid)>150 OR v_pid=ANY(v_seen) OR
       v_pid IS DISTINCT FROM v_np->>'id'
    THEN RAISE EXCEPTION 'Duplicate, missing or moved roster player ID'; END IF;
    v_seen:=pg_catalog.array_append(v_seen,v_pid);
    -- Only career-development fields and nested devProfileV25 can change.
    IF (v_op-'age'-'lastBirthdayYear'-'overall'-'potential'-'attrs'-'offRating'-'defRating'-'stamina'-'scoringRating'-'birthMonth'-'birthDay'-'devProfileV25'-'careerTimingProfile'-'developmentMomentum'-'meta')
       IS DISTINCT FROM
       (v_np-'age'-'lastBirthdayYear'-'overall'-'potential'-'attrs'-'offRating'-'defRating'-'stamina'-'scoringRating'-'birthMonth'-'birthDay'-'devProfileV25'-'careerTimingProfile'-'developmentMomentum'-'meta') OR
       (coalesce(v_op->'meta','{}'::jsonb)-'devProfileV25') IS DISTINCT FROM
       (coalesce(v_np->'meta','{}'::jsonb)-'devProfileV25')
    THEN RAISE EXCEPTION 'Progression changed immutable player data'; END IF;
    v_old_age:=coalesce((v_op->>'age')::int,25);
    v_new_age:=coalesce((v_np->>'age')::int,-1);
    v_old_ovr:=coalesce((v_op->>'overall')::int,0);
    v_new_ovr:=coalesce((v_np->>'overall')::int,-1);
    v_old_pot:=coalesce((v_op->>'potential')::int,0);
    v_new_pot:=coalesce((v_np->>'potential')::int,-1);
    v_birth_year:=coalesce((v_op->>'lastBirthdayYear')::int,p_year-1);
    v_draft_year:=coalesce((v_op#>>'{meta,draftYear}')::int,(v_op->>'draftYear')::int,
      (v_op->>'draftClassYear')::int,(v_op->>'draftedYear')::int,0);
    IF v_draft_year=p_year AND (
        pg_catalog.strpos(pg_catalog.lower(coalesce(v_op#>>'{meta,acquiredVia}',v_op->>'acquiredVia','')),'draft')>0 OR
        pg_catalog.left(v_pid,pg_catalog.length('rookie_'||p_year::text||'_'))=('rookie_'||p_year::text||'_') OR
        v_op#>>'{rights,rookieScale}'='true' OR v_op->>'rookieSigningPending'='true'
       ) THEN
      IF v_op IS DISTINCT FROM v_np THEN RAISE EXCEPTION 'Current-draft rookie progressed before year one'; END IF;
      v_rookies:=v_rookies+1;
    ELSE
      IF v_old_age<17 OR v_new_age>52 OR
         v_new_age IS DISTINCT FROM (v_old_age+CASE WHEN v_birth_year<p_year THEN 1 ELSE 0 END) OR
         v_new_ovr NOT BETWEEN 40 AND 99 OR v_new_pot NOT BETWEEN 40 AND 99 OR
         pg_catalog.abs(v_new_ovr-v_old_ovr)>25 OR
         pg_catalog.abs(v_new_pot-coalesce((v_op->>'potential')::int,v_old_ovr))>25 OR
         pg_catalog.jsonb_typeof(v_np->'attrs') IS DISTINCT FROM 'array' OR
         pg_catalog.jsonb_array_length(v_np->'attrs')<>15 OR
         EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(v_np->'attrs') a
                 WHERE a.value::numeric NOT BETWEEN 0 AND 100) OR
         coalesce((v_np->>'offRating')::numeric,-1) NOT BETWEEN 0 AND 100 OR
         coalesce((v_np->>'defRating')::numeric,-1) NOT BETWEEN 0 AND 100 OR
         coalesce((v_np->>'stamina')::numeric,-1) NOT BETWEEN 0 AND 100 OR
         coalesce((v_np->>'scoringRating')::numeric,-1) NOT BETWEEN 0 AND 100
      THEN RAISE EXCEPTION 'Player rating or aging exceeded permitted original-engine limits'; END IF;
      IF v_new_age>v_old_age THEN v_aged:=v_aged+1; END IF;
    END IF;
    v_delta:=v_new_ovr-v_old_ovr;
    IF v_delta>0 THEN v_improved:=v_improved+1;
    ELSIF v_delta<0 THEN v_declined:=v_declined+1;
    ELSE v_held:=v_held+1;END IF;
    v_count:=v_count+1;
    v_changes:=v_changes||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id',v_pid,'name',coalesce(v_op->>'name',''),'team',v_teamname,'bucket',v_bucket,
      'ageBefore',coalesce((v_op->>'age')::int,0),'ageAfter',coalesce((v_np->>'age')::int,0),
      'overallBefore',v_old_ovr,'overallAfter',v_new_ovr,'overallDelta',v_delta,
      'potentialBefore',v_old_pot,'potentialAfter',v_new_pot));
   END LOOP;
  END LOOP;
 END LOOP;
 -- Free agents are equally progression-relevant and cannot be transferred.
 IF (v_old ? 'freeAgents') IS DISTINCT FROM (v_new ? 'freeAgents') THEN
  RAISE EXCEPTION 'Progression changed the free-agent layout'; END IF;
 v_old_arr:=coalesce(v_old->'freeAgents','[]'::jsonb);
 v_new_arr:=coalesce(v_new->'freeAgents','[]'::jsonb);
 IF pg_catalog.jsonb_array_length(v_old_arr)<>pg_catalog.jsonb_array_length(v_new_arr) THEN
  RAISE EXCEPTION 'Progression signed or released a free agent'; END IF;
 FOR v_j IN 0..pg_catalog.jsonb_array_length(v_old_arr)-1 LOOP
  v_op:=v_old_arr->v_j; v_np:=v_new_arr->v_j;
  v_pid:=v_op->>'id';
  IF v_pid IS NULL OR pg_catalog.length(v_pid)>150 OR v_pid=ANY(v_seen) OR
     v_pid IS DISTINCT FROM v_np->>'id'
  THEN RAISE EXCEPTION 'Duplicate or changed free-agent identity'; END IF;
  v_seen:=pg_catalog.array_append(v_seen,v_pid);
  IF (v_op-'age'-'lastBirthdayYear'-'overall'-'potential'-'attrs'-'offRating'-'defRating'-'stamina'-'scoringRating'-'birthMonth'-'birthDay'-'devProfileV25'-'careerTimingProfile'-'developmentMomentum'-'meta')
     IS DISTINCT FROM
     (v_np-'age'-'lastBirthdayYear'-'overall'-'potential'-'attrs'-'offRating'-'defRating'-'stamina'-'scoringRating'-'birthMonth'-'birthDay'-'devProfileV25'-'careerTimingProfile'-'developmentMomentum'-'meta') OR
     (coalesce(v_op->'meta','{}'::jsonb)-'devProfileV25') IS DISTINCT FROM
     (coalesce(v_np->'meta','{}'::jsonb)-'devProfileV25')
  THEN RAISE EXCEPTION 'Progression changed free-agent rights, identity or contracts'; END IF;
  v_old_age:=coalesce((v_op->>'age')::int,25);v_new_age:=coalesce((v_np->>'age')::int,-1);
  v_old_ovr:=coalesce((v_op->>'overall')::int,0);v_new_ovr:=coalesce((v_np->>'overall')::int,-1);
  v_old_pot:=coalesce((v_op->>'potential')::int,0);v_new_pot:=coalesce((v_np->>'potential')::int,-1);
  v_birth_year:=coalesce((v_op->>'lastBirthdayYear')::int,p_year-1);
  v_draft_year:=coalesce((v_op#>>'{meta,draftYear}')::int,(v_op->>'draftYear')::int,
    (v_op->>'draftClassYear')::int,(v_op->>'draftedYear')::int,0);
  IF v_draft_year=p_year AND (
     pg_catalog.strpos(pg_catalog.lower(coalesce(v_op#>>'{meta,acquiredVia}',v_op->>'acquiredVia','')),'draft')>0 OR
     pg_catalog.left(v_pid,pg_catalog.length('rookie_'||p_year::text||'_'))=('rookie_'||p_year::text||'_') OR
     v_op#>>'{rights,rookieScale}'='true' OR v_op->>'rookieSigningPending'='true'
  ) THEN
    IF v_op IS DISTINCT FROM v_np THEN RAISE EXCEPTION 'Current-year undrafted rookie progressed'; END IF;
    v_rookies:=v_rookies+1;
  ELSE
    IF v_old_age<17 OR v_new_age>52 OR
       v_new_age IS DISTINCT FROM (v_old_age+CASE WHEN v_birth_year<p_year THEN 1 ELSE 0 END) OR
       v_new_ovr NOT BETWEEN 40 AND 99 OR v_new_pot NOT BETWEEN 40 AND 99 OR
       pg_catalog.abs(v_new_ovr-v_old_ovr)>25 OR
       pg_catalog.abs(v_new_pot-coalesce((v_op->>'potential')::int,v_old_ovr))>25 OR
       pg_catalog.jsonb_typeof(v_np->'attrs') IS DISTINCT FROM 'array' OR
       pg_catalog.jsonb_array_length(v_np->'attrs')<>15 OR
       EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(v_np->'attrs') a
               WHERE a.value::numeric NOT BETWEEN 0 AND 100) OR
       coalesce((v_np->>'offRating')::numeric,-1) NOT BETWEEN 0 AND 100 OR
       coalesce((v_np->>'defRating')::numeric,-1) NOT BETWEEN 0 AND 100 OR
       coalesce((v_np->>'stamina')::numeric,-1) NOT BETWEEN 0 AND 100 OR
       coalesce((v_np->>'scoringRating')::numeric,-1) NOT BETWEEN 0 AND 100
    THEN RAISE EXCEPTION 'Free-agent aging or rating is invalid'; END IF;
    IF v_new_age>v_old_age THEN v_aged:=v_aged+1; END IF;
  END IF;
  v_delta:=v_new_ovr-v_old_ovr;
  IF v_delta>0 THEN v_improved:=v_improved+1;
  ELSIF v_delta<0 THEN v_declined:=v_declined+1;
  ELSE v_held:=v_held+1; END IF;
  v_count:=v_count+1;
  v_changes:=v_changes||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'id',v_pid,'name',coalesce(v_op->>'name',''),'team','Free Agents','bucket','freeAgents',
    'ageBefore',coalesce((v_op->>'age')::int,0),'ageAfter',coalesce((v_np->>'age')::int,0),
    'overallBefore',v_old_ovr,'overallAfter',v_new_ovr,'overallDelta',v_delta,
    'potentialBefore',v_old_pot,'potentialAfter',v_new_pot));
 END LOOP;
 IF v_count NOT BETWEEN 200 AND 2000 OR
    v_changes IS DISTINCT FROM v_new#>'{onlineProgression,changes}'
 THEN RAISE EXCEPTION 'Progression audit does not match the saved player population'; END IF;
 v_summary:=v_new#>'{onlineProgression,summary}';
 IF coalesce((v_summary->>'playerCount')::int,-1)<>v_count OR
    coalesce((v_summary->>'improved')::int,-1)<>v_improved OR
    coalesce((v_summary->>'declined')::int,-1)<>v_declined OR
    coalesce((v_summary->>'unchanged')::int,-1)<>v_held OR
    coalesce((v_summary->>'aged')::int,-1)<>v_aged OR
    coalesce((v_summary->>'protectedRookies')::int,-1)<>v_rookies OR
    pg_catalog.length(coalesce(v_summary->>'engineVersion',''))<5 OR
    (v_summary-'playerCount'-'improved'-'declined'-'unchanged'-'aged'-'protectedRookies'-'engineVersion')<>'{}'::jsonb
 THEN RAISE EXCEPTION 'Progression summary is inconsistent with roster ratings'; END IF;

 -- Existing postseason trigger locks all roster writes; authorize just this
 -- one audited trusted transaction while holding the runtime row lock.
 PERFORM pg_catalog.set_config('bm.online_postseason_write','1',true);
 PERFORM pg_catalog.set_config('bm.online_progression_write',p_lobby::text,true);
 UPDATE public.bm_online_franchise_runtime r
    SET state=v_new,revision=v_revision+1,updated_at=now()
    WHERE r.lobby_id=p_lobby;
 INSERT INTO public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
 VALUES(p_lobby,v_revision+1,p_request,p_actor,'online_player_progression',
   pg_catalog.jsonb_build_object('year',p_year,'count',v_count,'improved',v_improved,
     'declined',v_declined,'aged',v_aged,'inputHash',p_input_hash));
 RETURN pg_catalog.jsonb_build_object('ok',true,'revision',v_revision+1,'count',v_count);
END $$;

REVOKE ALL ON FUNCTION public.bm_online_apply_progression_phase2e4d(uuid,uuid,uuid,bigint,int,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bm_online_apply_progression_phase2e4d(uuid,uuid,uuid,bigint,int,text,jsonb)
 TO service_role;

CREATE OR REPLACE FUNCTION public.bm_online_progression_guard_phase2e4d()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF pg_catalog.current_setting('bm.online_progression_write',true) IS DISTINCT FROM NEW.lobby_id::text AND
    (OLD.state->'onlineProgression' IS DISTINCT FROM NEW.state->'onlineProgression' OR
     OLD.state#>'{offseasonState,progressionComplete}' IS DISTINCT FROM
     NEW.state#>'{offseasonState,progressionComplete}' OR
     OLD.state#>'{offseasonState,progressionSeasonYear}' IS DISTINCT FROM
     NEW.state#>'{offseasonState,progressionSeasonYear}')
 THEN RAISE EXCEPTION 'Only trusted player progression may change completion or results'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bm_online_progression_guard_phase2e4d() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS bm_online_progression_guard_phase2e4d ON public.bm_online_franchise_runtime;
CREATE TRIGGER bm_online_progression_guard_phase2e4d
 BEFORE UPDATE ON public.bm_online_franchise_runtime
 FOR EACH ROW EXECUTE FUNCTION public.bm_online_progression_guard_phase2e4d();
COMMIT;
