-- G3C-A2 READ ONLY precheck. Expect every status READY before applying the migration.
WITH checks AS (
 SELECT 'started_franchise_schema'::text AS check_name,
   (to_regclass('public.bm_online_lobbies') IS NOT NULL AND
    to_regclass('public.bm_online_franchises') IS NOT NULL AND
    to_regclass('public.bm_online_lobby_members') IS NOT NULL AND
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bm_online_lobbies' AND column_name='host_id') AND
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bm_online_franchises' AND column_name='host_id')) AS ready
 UNION ALL
 SELECT 'no_prior_a2_objects',
   (to_regclass('public.bm_online_host_governance') IS NULL AND
    to_regclass('public.bm_online_host_recovery_votes') IS NULL AND
    to_regclass('public.bm_online_host_audit') IS NULL AND
    NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname LIKE 'bm_online_host_%'))
 UNION ALL
 SELECT 'source_authorization',
   (EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname='bm_online_lobbies' AND c.relrowsecurity) AND
    EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname='bm_online_franchises' AND c.relrowsecurity))
)
SELECT check_name,CASE WHEN ready THEN 'READY' ELSE 'STOP' END AS status FROM checks ORDER BY check_name;
