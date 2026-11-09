-- G2A read only: expected true,true,false for first three result columns.
WITH expected(label,signature) AS (
 VALUES ('asset_trade_helper','public.bm_online_prepare_human_asset_trade(jsonb,text,text,text[],text[],text[],text[],uuid)'),
 ('financials','public.bm_online_validate_human_trade_finances(jsonb,jsonb,numeric,numeric,jsonb,jsonb)'),
 ('player_trades','public.bm_online_prepare_human_player_trade(jsonb,text,text,text[],text[],uuid)')
)
SELECT e.label,
 COALESCE(strpos(p.prosrc,CASE WHEN e.label='asset_trade_helper' THEN 'G2A: 2028-29 human player-only trades' ELSE 'BM ONLINE PHASE 2E.4-G2A' END)>0,false) AS g2a_installed,
 COALESCE(p.prosecdef,false) AS security_definer,
 COALESCE(p.proconfig @> ARRAY['search_path=']::text[] OR p.proconfig @> ARRAY['search_path=""']::text[],false) AS locked_search_path,
 COALESCE(pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),false) AS authenticated_can_execute
FROM expected e LEFT JOIN pg_catalog.pg_proc p ON p.oid=to_regprocedure(e.signature)
ORDER BY e.label;
