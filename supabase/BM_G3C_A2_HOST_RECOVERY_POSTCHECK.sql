-- G3C-A2 READ ONLY postcheck. Six function rows + one table/trigger row.
WITH expected(proname) AS ( VALUES
 ('bm_online_host_heartbeat'),
 ('bm_online_host_nominate'),
 ('bm_online_host_accept'),
 ('bm_online_host_recovery_vote'),
 ('bm_online_host_status'),
 ('bm_online_host_governance_init')
), funcs AS (
 SELECT e.proname,p.oid,p.prosecdef,p.proconfig,
        pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_exec,
        pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') AS anon_exec
 FROM expected e LEFT JOIN pg_catalog.pg_proc p ON p.proname=e.proname
   AND p.pronamespace='public'::regnamespace
)
SELECT proname AS check_name,
 CASE WHEN oid IS NOT NULL AND prosecdef
      AND EXISTS(SELECT 1 FROM unnest(proconfig) s WHERE s IN ('search_path=','search_path=""'))
      AND NOT anon_exec
      AND authenticated_exec=(proname<>'bm_online_host_governance_init')
 THEN 'PASS' ELSE 'STOP' END AS status
FROM funcs
UNION ALL
SELECT 'locked_governance_tables_and_init_trigger',
 CASE WHEN to_regclass('public.bm_online_host_governance') IS NOT NULL
 AND to_regclass('public.bm_online_host_recovery_votes') IS NOT NULL
 AND to_regclass('public.bm_online_host_audit') IS NOT NULL
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname='bm_g3ca2_host_governance_init' AND NOT tgisinternal)
 AND (SELECT count(*)=3 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname IN ('bm_online_host_governance','bm_online_host_recovery_votes','bm_online_host_audit')
       AND c.relrowsecurity)
 THEN 'PASS' ELSE 'STOP' END;
