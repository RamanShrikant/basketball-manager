-- READ ONLY. Both rows must be READY before applying G3C-A1.
WITH checks AS (
 SELECT pg_catalog.to_regclass('public.bm_online_franchises') AS table_oid,
        pg_catalog.to_regprocedure('public.bm_launch_online_franchise(uuid,jsonb)') AS launch_oid,
        pg_catalog.to_regprocedure('public.bm_online_seed_integrity_g3ca1()') AS guard_oid
), launch AS (
 SELECT p.oid,p.prosecdef,p.proconfig FROM pg_catalog.pg_proc p, checks c
 WHERE p.oid=c.launch_oid
), installed AS (
 SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t, checks c
     WHERE t.tgrelid=c.table_oid AND t.tgname='bm_online_seed_integrity_g3ca1' AND NOT t.tgisinternal) AS trigger_present
)
SELECT 'authoritative_launch' AS check_name,
 CASE WHEN c.table_oid IS NOT NULL AND l.prosecdef
       AND (pg_catalog.array_to_string(l.proconfig,',') LIKE '%search_path=%')
       AND pg_catalog.has_function_privilege('authenticated',l.oid,'EXECUTE')
       AND NOT pg_catalog.has_function_privilege('anon',l.oid,'EXECUTE')
   THEN 'READY' ELSE 'STOP' END AS status
FROM checks c LEFT JOIN launch l ON true
UNION ALL
SELECT 'new_seed_guard',
 CASE WHEN c.table_oid IS NOT NULL AND c.guard_oid IS NULL AND NOT i.trigger_present
  THEN 'READY' ELSE 'STOP_OR_ALREADY_INSTALLED' END
FROM checks c CROSS JOIN installed i;
