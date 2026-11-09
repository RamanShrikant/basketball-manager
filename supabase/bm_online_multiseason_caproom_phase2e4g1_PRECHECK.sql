-- Phase 2E.4-G1 read-only database preflight. No schema/runtime changes.
-- Requires exact F2 function bodies as provided in this context snapshot.
WITH expected(label,signature,body_hash) AS (
 VALUES
 ('cap_room_ceiling','public.bm_online_f2_cap_room_ceiling(jsonb)','dba665380ac7c1e59eddc1b3e514fb98'),
 ('one_year_signing','public.bm_online_sign_cap_room_free_agent(uuid,uuid,bigint,text,bigint)','1e9c104d173281ed8b19c8daccbf671e'),
 ('multiyear_signing','public.bm_online_sign_cap_room_contract(uuid,uuid,bigint,text,bigint,integer,text)','31fb5aeb94fd57c9c2353f136c3b3634'),
 ('standard_release','public.bm_online_release_standard_player(uuid,uuid,bigint,text)','26f9c7dad839fcde28269bcc1f568e1a')
)
SELECT e.label,
 CASE WHEN p.oid IS NULL THEN 'MISSING'
      WHEN pg_catalog.md5(pg_catalog.replace(p.prosrc,chr(13),''))<>e.body_hash
        THEN 'DIFFERENT SOURCE - STOP'
      WHEN p.prosecdef IS DISTINCT FROM true OR
         (p.proconfig IS DISTINCT FROM ARRAY['search_path=']::text[] AND p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[])
        THEN 'SECURITY SETTINGS MISMATCH - STOP'
      ELSE 'READY' END AS status,
 pg_catalog.md5(pg_catalog.replace(p.prosrc,chr(13),'')) AS live_hash
FROM expected e
LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(e.signature)
ORDER BY e.label;
-- Expected all 4 rows READY. If not, STOP and export function definitions for audit.
