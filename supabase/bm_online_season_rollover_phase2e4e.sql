-- Basketball Manager Multiplayer Phase 2E.4-E — server-authorized season rollover.
-- MANUAL INSTALLATION ONLY. Preserves existing leagues. Migration changes schema/functions,
-- but performs NO league-state changes until the host deliberately invokes its RPC.
-- Prerequisites: 2E.4-D successfully applied. Use only on the matching online schema.
BEGIN;

-- Full pre-rollover snapshot is stored independently so a new season never
-- overwrites the prior championship, box scores, stats, draft and offseason records.
CREATE TABLE IF NOT EXISTS public.bm_online_season_archives (
 lobby_id uuid NOT NULL REFERENCES public.bm_online_lobbies(id) ON DELETE CASCADE,
 season_year integer NOT NULL CHECK (season_year BETWEEN 2025 AND 2095),
 snapshot jsonb NOT NULL,
 archived_at timestamptz NOT NULL DEFAULT now(),
 archived_revision bigint NOT NULL,
 PRIMARY KEY(lobby_id,season_year)
);
ALTER TABLE public.bm_online_season_archives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bm_online_season_archives FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.bm_online_season_archives TO authenticated;
DROP POLICY IF EXISTS bm_online_archive_members_read_phase2e4e ON public.bm_online_season_archives;
CREATE POLICY bm_online_archive_members_read_phase2e4e ON public.bm_online_season_archives
 FOR SELECT TO authenticated USING (
 EXISTS (SELECT 1 FROM public.bm_online_lobby_members m
 WHERE m.lobby_id=bm_online_season_archives.lobby_id AND m.user_id=(SELECT auth.uid()))
);

-- Two older guards intentionally make completed postseason and settled draft
-- immutable. Retain EVERY existing guard condition for all ordinary writes;
-- permit ONLY this scoped, service-role-only, locked rollover operation.

create or replace function public.bm_online_draft_runtime_guard_phase2e2()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 IF pg_catalog.current_setting('bm.online_rollover_write',true)=NEW.lobby_id::text THEN RETURN NEW; END IF;
 if old.state->'onlineDraftRights' is not null and
    (old.state->'onlineDraftRights' is distinct from new.state->'onlineDraftRights' or
     old.state->'draftPicks' is distinct from new.state->'draftPicks')
 then raise exception 'Settled draft ownership cannot be changed by an older trade or roster endpoint';end if;
 if old.state->'onlineDraftRights' is null and new.state->'onlineDraftRights' is not null and
    pg_catalog.current_setting('bm.online_draft_write',true) is distinct from new.lobby_id::text
 then raise exception 'Draft rights can only be settled by the trusted NBA Draft transaction';end if;
 if (old.state->'onlineDraft' is not null or new.state->'onlineDraft' is not null) and
     old.state->'onlineDraft' is distinct from new.state->'onlineDraft' and
     pg_catalog.current_setting('bm.online_draft_write',true) is distinct from new.lobby_id::text
 then raise exception 'NBA Draft state requires the trusted server-only draft transaction';end if;
 if (old.state#>>'{onlineDraftLottery,rightsSettlement}'='settled' and
      old.state->'onlineDraftLottery' is distinct from new.state->'onlineDraftLottery') or
    (old.state#>>'{onlineDraftLottery,rightsSettlement}'<>'settled' and
      new.state#>>'{onlineDraftLottery,rightsSettlement}'='settled' and
      pg_catalog.current_setting('bm.online_draft_write',true) is distinct from new.lobby_id::text)
 then raise exception 'Official draft lottery settlement cannot be changed';end if;
 return new;
end $$;

create or replace function public.bm_online_postseason_guard_phase2d3a()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 IF pg_catalog.current_setting('bm.online_rollover_write',true)=NEW.lobby_id::text THEN RETURN NEW; END IF;
 if (old.state->'onlinePostseason' is not null or new.state->'onlinePostseason' is not null) and
   (old.state->'onlinePostseason' is distinct from new.state->'onlinePostseason' or
    old.state->'onlinePostseasonResults' is distinct from new.state->'onlinePostseasonResults' or
    old.state->'onlinePostseasonStats' is distinct from new.state->'onlinePostseasonStats' or
    old.state#>>'{onlineSchedule,phase}' is distinct from new.state#>>'{onlineSchedule,phase}') and
    coalesce(pg_catalog.current_setting('bm.online_postseason_write',true),'')<>'1'
 then raise exception 'Postseason state requires the trusted server-only operation';end if;
 if old.state->'onlinePostseason' is not null and
    old.state->'onlineResults' is distinct from new.state->'onlineResults'
 then raise exception 'Finalized regular-season scores cannot change after postseason seeding';end if;
 if old.state->'onlinePostseason' is not null and
    (old.state->'teams' is distinct from new.state->'teams' or
     old.state->'conferences' is distinct from new.state->'conferences') and
    coalesce(pg_catalog.current_setting('bm.online_postseason_write',true),'')<>'1'
 then raise exception 'Postseason rosters are locked to authorized simulation injury changes';end if;
 return new;
end $$;


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
    'games',1230,'inputHash',p_input_hash));
 RETURN pg_catalog.jsonb_build_object('ok',true,'revision',v_revision+1,'toYear',p_to_year);
END $$;
REVOKE ALL ON FUNCTION public.bm_online_rollover_season_phase2e4e(uuid,uuid,uuid,bigint,int,int,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bm_online_rollover_season_phase2e4e(uuid,uuid,uuid,bigint,int,int,text,jsonb)
 TO service_role;
COMMIT;
