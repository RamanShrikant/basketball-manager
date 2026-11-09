-- READ ONLY; run after applying G3C-A1 SQL. Both rows must PASS.
WITH guard AS (
 SELECT pg_catalog.to_regprocedure('public.bm_online_seed_integrity_g3ca1()') AS oid
)
SELECT 'new_franchise_trigger' AS check_name,
 CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
   WHERE tgrelid='public.bm_online_franchises'::regclass
     AND tgname='bm_online_seed_integrity_g3ca1' AND NOT tgisinternal AND tgenabled='O')
 THEN 'PASS' ELSE 'FAIL' END AS status
UNION ALL
SELECT 'private_locked_validator',
 CASE WHEN p.prosecdef AND pg_catalog.array_to_string(p.proconfig,',') LIKE '%search_path=%'
   AND NOT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
   AND NOT pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
 THEN 'PASS' ELSE 'FAIL' END
FROM guard g LEFT JOIN pg_catalog.pg_proc p ON p.oid=g.oid;
