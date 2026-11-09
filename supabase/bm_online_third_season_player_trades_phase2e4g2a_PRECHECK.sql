-- Read only; install G2A ONLY if both functions are READY.
WITH expected(label, signature, md5_body) AS (
 VALUES
 ('financials','public.bm_online_validate_human_trade_finances(jsonb,jsonb,numeric,numeric,jsonb,jsonb)','1155614ac019e8a8b520cdf5674172a3'),
 ('asset_trade_helper','public.bm_online_prepare_human_asset_trade(jsonb,text,text,text[],text[],text[],text[],uuid)','97fae52ba209c2d4e98d3c8800b68b65'),
 ('player_trades','public.bm_online_prepare_human_player_trade(jsonb,text,text,text[],text[],uuid)','fcdd044f25d444d6ba769ace1ddbc0b7')
)
SELECT e.label,
 CASE WHEN p.oid IS NULL THEN 'MISSING'
 WHEN md5(replace(p.prosrc,chr(13),''))<>e.md5_body
  AND NOT (e.label='player_trades' AND md5(replace(p.prosrc,chr(13),''))='8f32b9953c8c2e80bef5ba5980114fe3')
  THEN 'DIFFERENT SOURCE - STOP'
 WHEN NOT p.prosecdef OR NOT (p.proconfig @> ARRAY['search_path=']::text[] OR p.proconfig @> ARRAY['search_path=""']::text[]) THEN 'SECURITY MISMATCH - STOP'
 ELSE 'READY' END AS status,
 md5(replace(p.prosrc,chr(13),'')) AS live_hash
FROM expected e LEFT JOIN pg_catalog.pg_proc p ON p.oid=to_regprocedure(e.signature)
ORDER BY e.label;
