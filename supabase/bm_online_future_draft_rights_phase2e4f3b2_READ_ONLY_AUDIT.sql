-- F3B2 read-only post-install audit. The migration itself never rolls a league.
WITH proc AS (
 SELECT p.oid,p.prosrc FROM pg_catalog.pg_proc p
 WHERE p.oid=pg_catalog.to_regprocedure(
 'public.bm_online_rollover_season_phase2e4e(uuid,uuid,uuid,bigint,integer,integer,text,jsonb)')
)
SELECT
 EXISTS (SELECT 1 FROM proc WHERE pg_catalog.strpos(prosrc,'v_future_year := p_to_year+7;')>0
    AND pg_catalog.strpos(prosrc,'Outer draft year already has rights')>0
    AND pg_catalog.strpos(prosrc,'retiredDraftAssets')>0) AS f3b2_rollover_installed,
 EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(
   'public.bm_online_prepare_human_pick_trade(jsonb,text,text,text[],text[],uuid)')
   AND pg_catalog.strpos(p.prosrc,'v_first_pick_year := v_active_season+1;')>0)
    AS f3b1_trade_window_installed,
 COALESCE(pg_catalog.has_function_privilege('service_role',
     'public.bm_online_rollover_season_phase2e4e(uuid,uuid,uuid,bigint,integer,integer,text,jsonb)',
     'EXECUTE'),false) AS service_role_can_rollover,
 COALESCE(pg_catalog.has_function_privilege('authenticated',
     'public.bm_online_rollover_season_phase2e4e(uuid,uuid,uuid,bigint,integer,integer,text,jsonb)',
     'EXECUTE'),false) AS browser_can_rollover;
-- Expected: true, true, true, false.
