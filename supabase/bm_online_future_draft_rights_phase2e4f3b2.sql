-- Basketball Manager 2E.4-F3B2 - atomic online future draft-rights replenishment.
-- MANUAL SQL ONLY; changes a stored procedure but NEVER rolls a league on installation.
-- Before installation: 2E.4-E and 2E.4-F3B1 must already be installed.
-- Preserves all existing future rights, protections, swaps and ownership. Fail closed
-- on prepopulated outer years, ambiguous rights or forfeitures requiring review.
BEGIN;
DO $f3b2_preflight$
DECLARE v_body text;
BEGIN
 SELECT pg_catalog.replace(p.prosrc, pg_catalog.chr(13), '') INTO v_body
 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(
   'public.bm_online_rollover_season_phase2e4e(uuid,uuid,uuid,bigint,integer,integer,text,jsonb)');
 IF v_body IS NULL OR pg_catalog.md5(v_body) <> 'ca0c1098dee2c3b040939fa99c65eb7f' THEN
   RAISE EXCEPTION 'Unexpected Phase E rollover function definition; STOP and audit';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(
   'public.bm_online_prepare_human_pick_trade(jsonb,text,text,text[],text[],uuid)')
   AND pg_catalog.strpos(p.prosrc,'v_first_pick_year := v_active_season+1;')>0)
 THEN RAISE EXCEPTION 'F3B1 rolling pick window is not installed; STOP'; END IF;
 IF pg_catalog.to_regclass('public.bm_online_season_archives') IS NULL OR
    pg_catalog.to_regclass('public.bm_online_trade_offers') IS NULL
 THEN RAISE EXCEPTION 'Season archive or prior trade dependency is missing'; END IF;
END $f3b2_preflight$;

CREATE OR REPLACE FUNCTION public.bm_online_rollover_season_phase2e4e(
 p_lobby uuid, p_actor uuid, p_request uuid, p_expected_revision bigint,
 p_from_year integer, p_to_year integer, p_input_hash text, p_by_date jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_old jsonb;v_next jsonb;v_revision bigint;v_host uuid;v_status text;
 v_teams jsonb;v_team_count integer;v_game_count integer;v_id_count integer;
 v_first text;v_last text;v_dates integer;v_details jsonb;
 v_event public.bm_online_franchise_events%ROWTYPE;
 v_year integer;v_archive_count integer;v_history jsonb;v_champion text;
 v_financials jsonb;v_calendar jsonb;v_ids integer;
 -- 2E.4-F3B2: canonical rights rollover (no browser-supplied entitlement payload).
 v_existing_picks jsonb;v_new_picks jsonb;v_pick_meta jsonb;
 v_future_year integer;v_asset jsonb;v_team_row jsonb;v_team_name text;
 v_team_token text;v_id text;v_note text;v_round integer;v_removed integer;
BEGIN
 IF p_lobby IS NULL OR p_actor IS NULL OR p_request IS NULL OR
    p_expected_revision IS NULL OR p_expected_revision<1 OR
    p_to_year IS DISTINCT FROM p_from_year+1 OR
    p_from_year NOT BETWEEN 2025 AND 2094 OR
    p_input_hash IS NULL OR p_input_hash !~ '^[a-f0-9]{64}$' OR
    pg_catalog.jsonb_typeof(p_by_date) IS DISTINCT FROM 'object' OR
    pg_catalog.octet_length(p_by_date::text)>1800000
 THEN RAISE EXCEPTION 'Invalid NBA rollover request'; END IF;

 SELECT r.state,r.revision INTO v_old,v_revision
 FROM public.bm_online_franchise_runtime r WHERE r.lobby_id=p_lobby FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Online franchise does not exist'; END IF;
 SELECT l.host_id,l.status INTO v_host,v_status FROM public.bm_online_lobbies l WHERE l.id=p_lobby;
 IF v_host IS DISTINCT FROM p_actor OR v_status IS DISTINCT FROM 'started' OR
    NOT EXISTS (SELECT 1 FROM public.bm_online_lobby_members m
     WHERE m.lobby_id=p_lobby AND m.user_id=p_actor)
 THEN RAISE EXCEPTION 'Only the started franchise host can begin the next NBA season'; END IF;

 SELECT * INTO v_event FROM public.bm_online_franchise_events e
 WHERE e.lobby_id=p_lobby AND e.request_id=p_request;
 IF FOUND THEN
  IF v_event.actor_id IS DISTINCT FROM p_actor OR
     v_event.action_type IS DISTINCT FROM 'online_season_rollover' OR
     v_event.details->>'inputHash' IS DISTINCT FROM p_input_hash OR
     (v_event.details->>'fromYear')::int IS DISTINCT FROM p_from_year OR
     (v_event.details->>'toYear')::int IS DISTINCT FROM p_to_year
  THEN RAISE EXCEPTION 'Season request ID belongs to another operation'; END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'replayed',true,'revision',v_event.revision,'toYear',p_to_year);
 END IF;
 IF v_revision IS DISTINCT FROM p_expected_revision THEN
  RAISE EXCEPTION 'Shared league revision changed; refresh the franchise'; END IF;

 -- Fully completed NBA year and offseason, never an unfinished decision.
 IF (v_old#>>'{onlineSchedule,seasonYear}')::int IS DISTINCT FROM p_from_year OR
    (v_old->>'seasonStartYear')::int NOT IN (p_from_year,p_to_year) OR
    v_old#>>'{onlinePostseason,phase}' IS DISTINCT FROM 'postseasonComplete' OR
    (v_old#>>'{onlinePostseason,seasonYear}')::int IS DISTINCT FROM p_from_year OR
    coalesce(v_old#>>'{onlinePostseason,champion}','')='' OR
    v_old#>>'{onlineDraft,status}' IS DISTINCT FROM 'complete' OR
    (v_old#>>'{onlineDraft,draftYear}')::int IS DISTINCT FROM p_to_year OR
    v_old#>>'{onlineRetirements,status}' IS DISTINCT FROM 'complete' OR
    v_old#>>'{onlineRookieSignings,status}' IS DISTINCT FROM 'complete' OR
    v_old#>>'{onlineOptions,status}' IS DISTINCT FROM 'complete' OR
    (v_old#>>'{onlineOptions,year}')::int IS DISTINCT FROM p_to_year OR
    v_old#>>'{onlineRights,status}' IS DISTINCT FROM 'complete' OR
    (v_old#>>'{onlineRights,year}')::int IS DISTINCT FROM p_to_year OR
    v_old#>>'{onlineOffseasonMarket,status}' IS DISTINCT FROM 'complete' OR
    (v_old#>>'{onlineOffseasonMarket,year}')::int IS DISTINCT FROM p_to_year OR
    v_old#>>'{onlineProgression,status}' IS DISTINCT FROM 'complete' OR
    (v_old#>>'{onlineProgression,seasonYear}')::int IS DISTINCT FROM p_to_year OR
    v_old#>>'{freeAgencyState,marketComplete}' IS DISTINCT FROM 'true' OR
    v_old#>>'{freeAgencyState,isActive}' IS DISTINCT FROM 'false' OR
    v_old#>>'{offseasonState,active}' IS DISTINCT FROM 'true' OR
    v_old#>>'{offseasonState,retirementsComplete}' IS DISTINCT FROM 'true' OR
    v_old#>>'{offseasonState,rookieSigningsComplete}' IS DISTINCT FROM 'true' OR
    v_old#>>'{offseasonState,optionsComplete}' IS DISTINCT FROM 'true' OR
    v_old#>>'{offseasonState,rightsManagementComplete}' IS DISTINCT FROM 'true' OR
    v_old#>>'{offseasonState,freeAgencyComplete}' IS DISTINCT FROM 'true' OR
    v_old#>>'{offseasonState,progressionComplete}' IS DISTINCT FROM 'true' OR
    pg_catalog.jsonb_array_length(coalesce(v_old#>'{freeAgencyState,pendingUserDecisions}','[]'::jsonb))<>0 OR
    pg_catalog.jsonb_array_length(coalesce(v_old#>'{freeAgencyState,pendingRfaMatchDecisions}','[]'::jsonb))<>0 OR
    pg_catalog.jsonb_array_length(coalesce(v_old#>'{onlineOffseasonMarket,pendingUserDecisions}','[]'::jsonb))<>0 OR
    pg_catalog.jsonb_array_length(coalesce(v_old#>'{onlineOffseasonMarket,pendingRfaMatchDecisions}','[]'::jsonb))<>0
 THEN RAISE EXCEPTION 'Finish the championship, draft, free agency and progression before rollover'; END IF;

 IF pg_catalog.jsonb_typeof(coalesce(v_old->'onlineSeasonHistory','[]'::jsonb)) IS DISTINCT FROM 'array' OR
    EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(coalesce(v_old->'onlineSeasonHistory','[]'::jsonb)) h
       WHERE (h.value->>'seasonYear')::int=p_from_year) OR
    EXISTS (SELECT 1 FROM public.bm_online_season_archives a WHERE a.lobby_id=p_lobby AND a.season_year=p_from_year)
 THEN RAISE EXCEPTION 'Completed NBA year already archived; refresh'; END IF;
 IF pg_catalog.jsonb_typeof(v_old->'onlineResults') IS DISTINCT FROM 'object' OR
    (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v_old->'onlineResults'))<>1230 OR
    pg_catalog.jsonb_typeof(v_old#>'{onlineSchedule,byDate}') IS DISTINCT FROM 'object' OR
    (SELECT count(*) FROM pg_catalog.jsonb_each(v_old#>'{onlineSchedule,byDate}') d
     CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(d.value) g)<>1230
 THEN RAISE EXCEPTION 'The completed season is missing NBA scores or games'; END IF;

 v_teams:=CASE WHEN pg_catalog.jsonb_typeof(v_old->'teams')='array' THEN v_old->'teams'
 ELSE coalesce(v_old#>'{conferences,East}','[]'::jsonb)||coalesce(v_old#>'{conferences,West}','[]'::jsonb) END;
 IF pg_catalog.jsonb_typeof(v_teams)<>'array' OR pg_catalog.jsonb_array_length(v_teams)<>30 OR
   (SELECT count(distinct t.value->>'name') FROM pg_catalog.jsonb_array_elements(v_teams) t)<>30 OR
   EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_teams) t
      WHERE pg_catalog.jsonb_array_length(coalesce(t.value->'pendingRookieSignings','[]'::jsonb))>0)
 THEN RAISE EXCEPTION 'Expected 30 teams with no unsigned rookies'; END IF;

 WITH players AS (
  SELECT p.value->>'id' AS id FROM pg_catalog.jsonb_array_elements(v_teams) t
   CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
     coalesce(t.value->'players','[]'::jsonb)||coalesce(t.value->'twoWayPlayers','[]'::jsonb)||
     coalesce(t.value->'stashPlayers','[]'::jsonb)) p
  UNION ALL SELECT p.value->>'id' FROM pg_catalog.jsonb_array_elements(coalesce(v_old->'freeAgents','[]'::jsonb)) p
 ) SELECT count(*),count(distinct id) INTO v_ids,v_archive_count FROM players;
 IF v_ids<200 OR v_ids>2000 OR v_archive_count<>v_ids OR
    EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_teams) t WHERE t.value->>'name' IS NULL)
 THEN RAISE EXCEPTION 'Invalid or duplicated NBA player identities'; END IF;

 -- F3B2: the completed draft year is consumed and only genuine future
 -- entitlements may survive. The completed season snapshot stays immutable.
 IF v_old#>>'{onlineDraftRights,status}' IS DISTINCT FROM 'settled' OR
    (v_old#>>'{onlineDraftRights,draftYear}')::integer IS DISTINCT FROM p_to_year
 THEN RAISE EXCEPTION 'Draft entitlement rollover requires settled current draft ownership'; END IF;
 v_future_year := p_to_year+7; -- follows the supported seven-year pick window
 IF v_future_year>2094 THEN RAISE EXCEPTION 'Future draft year is outside supported bounds'; END IF;
 v_existing_picks:=v_old->'draftPicks';
 v_pick_meta:=v_old->'draftPickMeta';
 IF pg_catalog.jsonb_typeof(v_existing_picks) IS DISTINCT FROM 'array' OR
    pg_catalog.jsonb_array_length(v_existing_picks) NOT BETWEEN 60 AND 2000 OR
    (v_pick_meta IS NOT NULL AND pg_catalog.jsonb_typeof(v_pick_meta) IS DISTINCT FROM 'object')
 THEN RAISE EXCEPTION 'Canonical online draft ledger is malformed'; END IF;
 IF (v_pick_meta->>'lastRolledCompletedSeasonYear') ~ '^20[0-9][0-9]$' AND
    (v_pick_meta->>'lastRolledCompletedSeasonYear')::integer >= p_to_year
 THEN RAISE EXCEPTION 'The completed NBA Draft was already rolled forward'; END IF;
 IF v_old->'draftPickForfeitures' IS NOT NULL AND
    pg_catalog.jsonb_typeof(v_old->'draftPickForfeitures') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Malformed draft forfeiture ledger'; END IF;
 IF EXISTS (
   SELECT 1 FROM pg_catalog.jsonb_array_elements(v_existing_picks) a WHERE
     pg_catalog.jsonb_typeof(a.value) IS DISTINCT FROM 'object' OR
     length(coalesce(a.value->>'id',''))<1 OR
     coalesce(a.value->>'year',a.value->>'seasonYear','') !~ '^20[0-9][0-9]$' OR
     coalesce(a.value->>'round','') NOT IN ('1','2') OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_teams) t
       WHERE pg_catalog.lower(pg_catalog.btrim(t.value->>'name'))=
             pg_catalog.lower(pg_catalog.btrim(a.value->>'originalTeam'))) OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_teams) t
       WHERE pg_catalog.lower(pg_catalog.btrim(t.value->>'name'))=
             pg_catalog.lower(pg_catalog.btrim(a.value->>'ownerTeam')))
 ) OR (SELECT count(*) FROM pg_catalog.jsonb_array_elements(v_existing_picks)) <>
      (SELECT count(DISTINCT a.value->>'id') FROM pg_catalog.jsonb_array_elements(v_existing_picks) a)
 THEN RAISE EXCEPTION 'Duplicate or invalid current draft asset ownership'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_existing_picks) a
    WHERE (coalesce(a.value->>'year',a.value->>'seasonYear'))::integer >= v_future_year)
 THEN RAISE EXCEPTION 'Outer draft year already has rights; reconcile before automatic replenishment'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_existing_picks) a
    WHERE (coalesce(a.value->>'year',a.value->>'seasonYear'))::integer=v_future_year-1)
 THEN RAISE EXCEPTION 'Prior outer draft year missing; cannot extend the draft horizon'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(
      coalesce(v_old->'draftPickForfeitures','[]'::jsonb)) a
    WHERE coalesce(a.value->>'year',a.value->>'seasonYear')=v_future_year::text)
 THEN RAISE EXCEPTION 'Outer-year draft forfeiture needs manual review before rights creation'; END IF;

 -- The trusted backend provides a generated NBA schedule; SQL independently
 -- validates 1,230 unique NBA games, dates, all teams, and 82/team.
 WITH games AS (
  SELECT d.key AS day,g.value AS item FROM pg_catalog.jsonb_each(p_by_date) d
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(d.value) g
 ) SELECT count(*),count(distinct item->>'id') INTO v_game_count,v_id_count FROM games;
 SELECT min(key),max(key),count(*) INTO v_first,v_last,v_dates FROM pg_catalog.jsonb_each(p_by_date);
 IF v_game_count<>1230 OR v_id_count<>1230 OR v_dates<150 OR v_dates>250 OR
    v_first NOT BETWEEN p_to_year::text||'-09-01' AND (p_to_year+1)::text||'-06-30' OR
    v_last NOT BETWEEN p_to_year::text||'-09-01' AND (p_to_year+1)::text||'-06-30' OR
    EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(p_by_date) d WHERE
      d.key !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' OR pg_catalog.jsonb_typeof(d.value)<>'array') OR
    EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_each(p_by_date) d
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(d.value) g WHERE
         pg_catalog.jsonb_typeof(g.value)<>'object' OR g.value->>'date' IS DISTINCT FROM d.key OR
         length(coalesce(g.value->>'id','')) NOT BETWEEN 10 AND 180 OR
         coalesce(g.value->>'home','')=coalesce(g.value->>'away','') OR
         NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(v_teams) t WHERE t.value->>'name'=g.value->>'home') OR
         NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(v_teams) t WHERE t.value->>'name'=g.value->>'away') OR
         (g.value-'id'-'date'-'home'-'away')<>'{}'::jsonb
    )
 THEN RAISE EXCEPTION 'Next-year schedule is incomplete or malformed'; END IF;
 IF EXISTS (
   WITH games AS (SELECT d.key AS day,g.value AS item FROM pg_catalog.jsonb_each(p_by_date) d
     CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(d.value) g),
   appearances AS (SELECT day,item->>'home' AS team FROM games UNION ALL
                   SELECT day,item->>'away' FROM games)
   SELECT 1 FROM appearances GROUP BY team HAVING count(*)<>82
 ) OR EXISTS (
   WITH games AS (SELECT d.key AS day,g.value AS item FROM pg_catalog.jsonb_each(p_by_date) d
     CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(d.value) g),
   appearances AS (SELECT day,item->>'home' AS team FROM games UNION ALL
                   SELECT day,item->>'away' FROM games)
   SELECT 1 FROM appearances GROUP BY day,team HAVING count(*)>1
 ) THEN RAISE EXCEPTION 'Next-year NBA schedule has duplicate matchups or non-82-game teams'; END IF;

 -- Cancel any unresolved prior-season trade offers so they cannot be accepted
 -- during a later NBA season; preserve the offer rows as historical records.
 UPDATE public.bm_online_trade_offers
    SET status='cancelled',resolved_at=now()
    WHERE lobby_id=p_lobby AND status='pending';

 -- Archive is immutable, transactionally saved BEFORE current-season reset.
 INSERT INTO public.bm_online_season_archives(lobby_id,season_year,snapshot,archived_revision)
 VALUES(p_lobby,p_from_year,v_old,v_revision);
 v_champion:=v_old#>>'{onlinePostseason,champion}';
 v_history:=coalesce(v_old->'onlineSeasonHistory','[]'::jsonb)||pg_catalog.jsonb_build_array(
  pg_catalog.jsonb_build_object('seasonYear',p_from_year,'champion',v_champion,
   'archiveRevision',v_revision,'nextSeasonYear',p_to_year,'games',1230));

 -- Replicate single-player's post-draft entitlement refresh in the same
 -- locked transaction as archiving/season reset. Old draft rights are in the
 -- immutable archive; future rights retain every original JSONB field.
 SELECT count(*) INTO v_removed FROM pg_catalog.jsonb_array_elements(v_existing_picks) a
   WHERE (coalesce(a.value->>'year',a.value->>'seasonYear'))::integer<=p_to_year;
 SELECT coalesce(pg_catalog.jsonb_agg(a.value ORDER BY a.ord),'[]'::jsonb)
 INTO v_new_picks FROM pg_catalog.jsonb_array_elements(v_existing_picks)
   WITH ORDINALITY AS a(value,ord)
 WHERE (coalesce(a.value->>'year',a.value->>'seasonYear'))::integer>p_to_year;
 FOR v_team_row IN SELECT value FROM pg_catalog.jsonb_array_elements(v_teams) LOOP
   v_team_name:=pg_catalog.btrim(v_team_row->>'name');
   v_team_token:=pg_catalog.left(pg_catalog.btrim(
       pg_catalog.regexp_replace(pg_catalog.upper(v_team_name),'[^A-Z0-9]+','_','g'),'_'),28);
   IF v_team_token='' THEN RAISE EXCEPTION 'Invalid future pick team token'; END IF;
   FOR v_round IN 1..2 LOOP
     v_id:='PICK_'||v_future_year::text||'_'||v_team_token||'_R'||v_round::text||
       '_'||v_team_token||'_OWN_FUTURE';
     IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_existing_picks) a
       WHERE a.value->>'id'=v_id)
     THEN RAISE EXCEPTION 'Future pick identifier collides with an existing right'; END IF;
     v_note:=v_team_name||' owns its own '||v_future_year::text||' '||
       (CASE WHEN v_round=1 THEN '1st' ELSE '2nd' END)||' round pick.';
     v_new_picks:=v_new_picks||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
       'id',v_id,'assetType','pick','type','pick','year',v_future_year,
       'round',v_round,'originalTeam',v_team_name,'ownerTeam',v_team_name,
       'protections','Unprotected','displayProtection','Unprotected',
       'protectionType','unprotected','logicType','auto_future_pick',
       'status','active','notes',v_note,
       'source','Auto-added rolling future draft assets',
       'realLifeDetails',pg_catalog.jsonb_build_object(
          'source','Auto-added rolling future draft assets',
          'cleanupVersion','auto_future_pick','playableDisplayRule',v_note)));
   END LOOP;
 END LOOP;
 IF pg_catalog.jsonb_array_length(v_new_picks)>2000 OR
    (SELECT count(DISTINCT a.value->>'id') FROM pg_catalog.jsonb_array_elements(v_new_picks) a)<>
    pg_catalog.jsonb_array_length(v_new_picks)
 THEN RAISE EXCEPTION 'Future draft ledger exceeds size or has duplicate identifiers'; END IF;

 -- Remove ONLY year-specific online checkpoints. Contract schedules, salaries,
 -- players, free agents, draft assets and franchise membership remain unchanged.
 v_next:=v_old-
  'onlineSchedule'-'onlineResults'-'onlinePlayerStats'-'onlinePostseason'-
  'onlinePostseasonResults'-'onlinePostseasonStats'-'onlineCheckpoints'-
  'onlineAllStars'-'onlineDraftLottery'-'onlineDraftRights'-'onlineDraft'-'draftState'-
  'onlineRetirements'-'onlineRookieSignings'-'rookieSigningState'-
  'onlineOptions'-'onlineRights'-'onlineOffseasonMarket'-'onlineProgression'-
  'freeAgencyState'-'offseasonState'-'contractExtensionState';
 v_next:=v_next||pg_catalog.jsonb_build_object(
   'seasonYear',p_to_year,'currentSeasonYear',p_to_year,'seasonStartYear',p_to_year,
   'displaySeasonYear',p_to_year+1,'seasonEndYear',p_to_year+1,
   'contractSeasonYear',p_to_year,'payrollSeasonYear',p_to_year,
   'currentPayrollSeasonYear',p_to_year,'salarySeasonYear',p_to_year,
   'currentSalarySeasonYear',p_to_year,'draftYear',p_to_year,'currentDraftYear',p_to_year,
   'financialSeasonYear',p_to_year+1,'currentFinancialSeasonYear',p_to_year+1,
   'onlineResults','{}'::jsonb,'onlinePlayerStats','{}'::jsonb,
   'onlinePostseasonResults','{}'::jsonb,'onlinePostseasonStats','{}'::jsonb,
   'onlineCheckpoints','{}'::jsonb,'onlineSeasonHistory',v_history,
   'onlineSeasonRollover',pg_catalog.jsonb_build_object(
       'fromYear',p_from_year,'toYear',p_to_year,'champion',v_champion,'status','complete'),
   'onlineSchedule',pg_catalog.jsonb_build_object('seasonYear',p_to_year,'source','singleplayer-calendar-v2',
     'phase','regular-season','cursor',v_first,'byDate',p_by_date)
 );
 -- The outer-year 60 unencumbered natural rights are born only on rollover.
 v_next:=pg_catalog.jsonb_set(v_next,'{draftPicks}',v_new_picks,true);
 v_next:=pg_catalog.jsonb_set(v_next,'{draftPickMeta}',
   coalesce(v_pick_meta,'{}'::jsonb)||pg_catalog.jsonb_build_object(
     'lastRolledCompletedSeasonYear',p_to_year,
     'lastAutoAddedFutureYear',v_future_year,
     'rollingWindowVersion','online_future_draft_rights_f3b2'),true);
 -- Calendar source preferences are retained, but dates belong to the new year.
 v_calendar:=coalesce(v_old->'calendar','{}'::jsonb)-
    'regularSeasonStart'-'regularSeasonGameStart'-'regularSeasonEnd'-
    'rookieExtensionDeadlineDate'-'contractExtensionDeadlineDate'-
    'extensionDeadlineDate'-'veteranExtensionDeadlineDate'-
    'veteranContractExtensionDeadlineDate'-'allStarStart'-'allStarEnd'-
    'allStarSelectionDate'-'tradeDeadlineDate'-'calendarStartDate'-'seasonEndDate'-
    'allStarBreakStart'-'allStarWeekendEnd'-'allStarDate'-'tradeDeadline';
 v_next:=pg_catalog.jsonb_set(v_next,'{calendar}',v_calendar,true);
 v_financials:=coalesce(v_old->'financials','{}'::jsonb)||pg_catalog.jsonb_build_object(
    'currentSeasonYear',p_to_year+1,'currentFinancialSeasonYear',p_to_year+1);
 v_next:=pg_catalog.jsonb_set(v_next,'{financials}',v_financials,true);

 -- Allow precisely this locked service-role transaction to cross the two
 -- immutable-season guards. Other stage guards use their existing scoped flags.
 PERFORM pg_catalog.set_config('bm.online_rollover_write',p_lobby::text,true);
 PERFORM pg_catalog.set_config('bm.online_postseason_write','1',true);
 PERFORM pg_catalog.set_config('bm.online_retirement_write',p_lobby::text,true);
 PERFORM pg_catalog.set_config('bm.online_rookie_write',p_lobby::text,true);
 PERFORM pg_catalog.set_config('bm.online_options_write',p_lobby::text,true);
 PERFORM pg_catalog.set_config('bm.online_rights_write',p_lobby::text,true);
 PERFORM pg_catalog.set_config('bm.online_free_agency_write',p_lobby::text,true);
 PERFORM pg_catalog.set_config('bm.online_progression_write',p_lobby::text,true);
 PERFORM pg_catalog.set_config('bm.online_draft_write',p_lobby::text,true);

 UPDATE public.bm_online_franchise_runtime r
 SET state=v_next,revision=v_revision+1,updated_at=now() WHERE r.lobby_id=p_lobby;
 INSERT INTO public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
 VALUES(p_lobby,v_revision+1,p_request,p_actor,'online_season_rollover',
  pg_catalog.jsonb_build_object('fromYear',p_from_year,'toYear',p_to_year,'champion',v_champion,
    'games',1230,'inputHash',p_input_hash,
    'futureDraftYear',v_future_year,'addedFutureRights',60,'retiredDraftAssets',v_removed));
 RETURN pg_catalog.jsonb_build_object('ok',true,'revision',v_revision+1,'toYear',p_to_year);
END $$;
REVOKE ALL ON FUNCTION public.bm_online_rollover_season_phase2e4e(uuid,uuid,uuid,bigint,int,int,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bm_online_rollover_season_phase2e4e(uuid,uuid,uuid,bigint,int,int,text,jsonb)
 TO service_role;
COMMIT;
