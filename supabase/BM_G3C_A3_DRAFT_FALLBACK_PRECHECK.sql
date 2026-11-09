-- READ ONLY. Must show all 4 READY before running A3a migration.
WITH target AS (
 SELECT pg_catalog.to_regprocedure('public.bm_online_make_draft_pick_phase2e2(uuid,uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,text,boolean)') AS fn
), detail AS (
 SELECT p.prosrc,p.prosecdef,p.proconfig,p.oid
 FROM target t LEFT JOIN pg_catalog.pg_proc p ON p.oid=t.fn
), checks AS (
 SELECT 'trusted_draft_commit' AS check_name,
   (d.oid IS NOT NULL AND d.prosecdef AND EXISTS(SELECT 1 FROM pg_catalog.unnest(d.proconfig) AS u(setting) WHERE setting IN ('search_path=','search_path=""')) AND
    pg_catalog.strpos(d.prosrc,'if v_human_owner is not null or not exists(select 1 from public.bm_online_lobbies l')>0 AND
    NOT pg_catalog.has_function_privilege('authenticated',d.oid,'EXECUTE') AND
    NOT pg_catalog.has_function_privilege('anon',d.oid,'EXECUTE')) AS ready FROM detail d
 UNION ALL SELECT 'immutable_draft_journal',
  pg_catalog.to_regclass('public.bm_online_franchise_events') IS NOT NULL AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bm_online_franchise_events' AND column_name='occurred_at')
 UNION ALL SELECT 'active_runtime',
   pg_catalog.to_regclass('public.bm_online_franchise_runtime') IS NOT NULL
 UNION ALL SELECT 'human_team_membership',
   pg_catalog.to_regclass('public.bm_online_lobby_members') IS NOT NULL AND
   pg_catalog.to_regclass('public.bm_online_lobbies') IS NOT NULL
)
SELECT check_name,CASE WHEN ready THEN 'READY' ELSE 'STOP' END AS status
FROM checks ORDER BY check_name;
