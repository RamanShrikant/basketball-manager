-- PHASE G1: READ ONLY, no runtime writes, no migrations.
-- Check all four new function bodies and role permissions after the migration.
WITH expected(function_name,signature) AS (
 VALUES
 ('cap_room_ceiling','public.bm_online_f2_cap_room_ceiling(jsonb)'),
 ('one_year_signing','public.bm_online_sign_cap_room_free_agent(uuid,uuid,bigint,text,bigint)'),
 ('multiyear_signing','public.bm_online_sign_cap_room_contract(uuid,uuid,bigint,text,bigint,integer,text)'),
 ('standard_release','public.bm_online_release_standard_player(uuid,uuid,bigint,text)')
)
SELECT e.function_name,
 COALESCE(pg_catalog.strpos(p.prosrc,'PHASE 2E.4-G1')>0,false) AS g1_body_installed,
 COALESCE(p.prosecdef,false) AS security_definer,
 COALESCE(p.proconfig = ARRAY['search_path=']::text[] OR p.proconfig = ARRAY['search_path=""']::text[],false) AS locked_search_path,
 COALESCE(pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),false) AS authenticated_can_execute,
 COALESCE(pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),false) AS anon_can_execute
FROM expected e
LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(e.signature)
ORDER BY e.function_name;
-- Expected installed/definer/search path true for all.
-- authenticated_can_execute: FALSE for cap_room_ceiling, TRUE for the three transactions.
-- anon_can_execute: FALSE for all four.
