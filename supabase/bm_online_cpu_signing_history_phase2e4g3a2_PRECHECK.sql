-- G3A2 READ ONLY PRECHECK (NO changes). Expected 1 row: READY.
WITH expected AS (
 SELECT pg_catalog.to_regprocedure('public.bm_online_commit_cpu_player_trade(uuid,uuid,uuid,bigint,text,text[],text[])') AS fn
)
SELECT CASE
 WHEN p.oid IS NULL THEN 'MISSING - STOP'
 WHEN pg_catalog.md5(pg_catalog.replace(p.prosrc,chr(13),'')) <> '271b1bcaa6f1de2ac0441ad161887299' THEN 'SOURCE MISMATCH - STOP'
 WHEN NOT p.prosecdef OR NOT (p.proconfig @> ARRAY['search_path=']::text[] OR
     p.proconfig @> ARRAY['search_path=""']::text[]) THEN 'SECURITY MISMATCH - STOP'
 WHEN NOT pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') OR
     pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') OR
     pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') THEN 'PERMISSIONS MISMATCH - STOP'
 WHEN pg_catalog.to_regclass('public.bm_online_season_archives') IS NULL THEN 'MISSING ARCHIVE - STOP'
 ELSE 'READY' END AS status,
 pg_catalog.md5(pg_catalog.replace(p.prosrc,chr(13),'')) AS live_hash
FROM expected e LEFT JOIN pg_catalog.pg_proc p ON p.oid=e.fn;
