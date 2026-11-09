-- Read only: EXACT F3B1 live source/security and G2A/F3B2 dependencies.
-- Requires 4 rows READY before applying G2B. No database modifications.
WITH expected(label,signature,hash_a,hash_b) AS (
 VALUES
 ('pick_base','public.bm_online_prepare_human_pick_trade_base_2c2d9(jsonb,text,text,text[],text[],uuid)','07808c1806ceb8c05dc7d6f44a5c5f2f','257e34cb1a08954a35fe6dc506cb319a'),
 ('swap_wrapper','public.bm_online_prepare_human_pick_trade(jsonb,text,text,text[],text[],uuid)','94f334a225fe338401f79d4523ee598e','86dba6a635450ad0d93390c21568f854')
), checks AS (
 SELECT e.label,e.signature,
  CASE WHEN p.oid IS NULL THEN 'MISSING - STOP'
       WHEN pg_catalog.md5(pg_catalog.replace(p.prosrc,chr(13),'')) NOT IN (e.hash_a,e.hash_b)
         THEN 'DIFFERENT SOURCE - STOP'
       WHEN NOT p.prosecdef OR NOT
          (p.proconfig @> ARRAY['search_path=']::text[] OR p.proconfig @> ARRAY['search_path=""']::text[])
         THEN 'SECURITY SETTINGS MISMATCH - STOP'
       ELSE 'READY' END AS status,
  pg_catalog.md5(pg_catalog.replace(p.prosrc,chr(13),'')) AS live_hash
 FROM expected e LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(e.signature)
), dependencies AS (
 SELECT 'g2a_asset_helper'::text AS label,
 CASE WHEN p.oid IS NULL THEN 'MISSING - STOP'
      WHEN pg_catalog.strpos(p.prosrc,'G2A: 2028-29 human player-only trades')=0 THEN 'DIFFERENT SOURCE - STOP'
      WHEN NOT p.prosecdef OR NOT
       (p.proconfig @> ARRAY['search_path=']::text[] OR p.proconfig @> ARRAY['search_path=""']::text[])
       THEN 'SECURITY SETTINGS MISMATCH - STOP'
      ELSE 'READY' END AS status
 FROM (SELECT 1) seed LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure('public.bm_online_prepare_human_asset_trade(jsonb,text,text,text[],text[],text[],text[],uuid)')
 UNION ALL
 SELECT 'f3b2_rollover',
 CASE WHEN p.oid IS NULL THEN 'MISSING - STOP'
      WHEN pg_catalog.strpos(p.prosrc,'v_future_year := p_to_year+7;')=0 THEN 'DIFFERENT SOURCE - STOP'
      WHEN NOT p.prosecdef OR NOT
       (p.proconfig @> ARRAY['search_path=']::text[] OR p.proconfig @> ARRAY['search_path=""']::text[])
       THEN 'SECURITY SETTINGS MISMATCH - STOP'
      ELSE 'READY' END
 FROM (SELECT 1) seed LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure('public.bm_online_rollover_season_phase2e4e(uuid,uuid,uuid,bigint,integer,integer,text,jsonb)')
)
SELECT label,status,live_hash FROM checks
UNION ALL SELECT label,status,NULL::text FROM dependencies
ORDER BY label;
