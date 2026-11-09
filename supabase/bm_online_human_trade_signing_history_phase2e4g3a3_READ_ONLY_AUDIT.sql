-- G3A3 read-only installed function and permission audit.
-- Three user-facing human trade RPCs should be G3A3=true, security=true,
-- locked search_path=true, authenticated=true, anonymous=false.
-- Private cutoff helper: G3A3 body present, authenticated=false, anonymous=false,
-- service_role=true.
WITH expected(label, signature, expected_browser) AS (VALUES
 ('basic_offer','public.bm_online_offer_human_trade(uuid,uuid,bigint,text,text[],text[])',true),
 ('asset_offer','public.bm_online_offer_human_asset_trade(uuid,uuid,bigint,text,text[],text[],text[],text[])',true),
 ('response','public.bm_online_respond_human_trade(uuid,uuid,uuid,bigint,text)',true),
 ('private_cutoff','public.bm_online_human_trade_signing_cutoff_phase2e4g3a3(uuid,jsonb,bigint)',false)
)
SELECT e.label, p.oid IS NOT NULL AS exists,
 COALESCE(pg_catalog.strpos(p.prosrc,CASE WHEN e.label='private_cutoff' THEN
   'Human trade signing eligibility needs consistent NBA season archives'
   ELSE 'G3A3_SIGNED_REVISION_CUTOFF' END)>0,false) AS g3a3_installed,
 COALESCE(p.prosecdef,false) AS security_definer,
 COALESCE(p.proconfig @> ARRAY['search_path=']::text[] OR
    p.proconfig @> ARRAY['search_path=""']::text[],false) AS locked_search_path,
 COALESCE(pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),false) AS authenticated_exec,
 COALESCE(pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),false) AS anon_exec,
 COALESCE(pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE'),false) AS service_exec
FROM expected e LEFT JOIN pg_catalog.pg_proc p
 ON p.oid=pg_catalog.to_regprocedure(e.signature)
ORDER BY e.label;
