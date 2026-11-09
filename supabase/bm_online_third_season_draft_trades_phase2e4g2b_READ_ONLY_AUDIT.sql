-- Read only: installed 2028-29 pick/swap function markers and permissions.
-- Expected two rows with installed/security true, browser_execute false.
WITH expected(label,signature) AS (VALUES
 ('pick_base','public.bm_online_prepare_human_pick_trade_base_2c2d9(jsonb,text,text,text[],text[],uuid)'),
 ('swap_wrapper','public.bm_online_prepare_human_pick_trade(jsonb,text,text,text[],text[],uuid)')
)
SELECT e.label,
 COALESCE(pg_catalog.strpos(p.prosrc,'PHASE 2E.4-G2B')>0,false) AS g2b_installed,
 COALESCE(pg_catalog.strpos(p.prosrc,'v_active_season not between 2026 and 2028')>0,false) AS third_season_enabled,
 COALESCE(p.prosecdef,false) AS security_definer,
 COALESCE(p.proconfig @> ARRAY['search_path=']::text[] OR p.proconfig @> ARRAY['search_path=""']::text[],false) AS locked_search_path,
 COALESCE(pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),false) AS browser_execute
FROM expected e LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(e.signature)
ORDER BY e.label;
