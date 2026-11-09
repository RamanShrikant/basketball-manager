-- Basketball Manager G3A3 read-only precheck. DO NOT apply until 3/3 READY.
-- Source exactness (CRLF normalized), SECURITY DEFINER, locked search_path,
-- browser role ACL, archive and journal dependencies are all checked.
WITH expected(label,signature,md5_body) AS (VALUES
 ('basic_offer','public.bm_online_offer_human_trade(uuid,uuid,bigint,text,text[],text[])','98393b5cf7e176972338f427c29d703b'),
 ('asset_offer','public.bm_online_offer_human_asset_trade(uuid,uuid,bigint,text,text[],text[],text[],text[])','6323a1a36cb9f68b3d8f975e3a2965ed'),
 ('response','public.bm_online_respond_human_trade(uuid,uuid,uuid,bigint,text)','b02c239e73ce858600d18695bfc43a26')
), current AS (
 SELECT e.*, p.oid, p.prosrc, p.prosecdef, p.proconfig
 FROM expected e LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(e.signature)
)
SELECT c.label,
 CASE
  WHEN c.oid IS NULL THEN 'MISSING - STOP'
  WHEN pg_catalog.md5(pg_catalog.replace(c.prosrc,chr(13),'')) <> c.md5_body THEN 'DIFFERENT SOURCE - STOP'
  WHEN NOT c.prosecdef OR NOT (c.proconfig @> ARRAY['search_path=']::text[] OR
       c.proconfig @> ARRAY['search_path=""']::text[]) THEN 'SECURITY MISMATCH - STOP'
  WHEN pg_catalog.has_function_privilege('anon',c.oid,'EXECUTE') OR
       NOT pg_catalog.has_function_privilege('authenticated',c.oid,'EXECUTE') THEN 'PERMISSIONS MISMATCH - STOP'
  WHEN pg_catalog.to_regclass('public.bm_online_season_archives') IS NULL OR
       pg_catalog.to_regclass('public.bm_online_franchise_events') IS NULL THEN 'MISSING ARCHIVE / EVENTS - STOP'
  WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p2 WHERE p2.oid=pg_catalog.to_regprocedure(
    'public.bm_online_commit_cpu_player_trade(uuid,uuid,uuid,bigint,text,text[],text[])')
    AND pg_catalog.strpos(p2.prosrc,'G3A2_SIGNED_REVISION_CUTOFF')>0) THEN 'G3A2 NOT INSTALLED - STOP'
  WHEN pg_catalog.to_regprocedure(
    'public.bm_online_human_trade_signing_cutoff_phase2e4g3a3(uuid,jsonb,bigint)') IS NOT NULL
    THEN 'G3A3 HELPER ALREADY EXISTS - STOP'
  ELSE 'READY' END AS status,
 pg_catalog.md5(pg_catalog.replace(c.prosrc,chr(13),'')) AS live_hash
FROM current c ORDER BY c.label;
