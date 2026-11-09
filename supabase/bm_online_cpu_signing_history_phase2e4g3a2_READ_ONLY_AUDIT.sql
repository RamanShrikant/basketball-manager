-- G3A2 READ ONLY AUDIT. Expected installed=true, server_exec=true, browser_exec=false.
WITH target AS (SELECT pg_catalog.to_regprocedure('public.bm_online_commit_cpu_player_trade(uuid,uuid,uuid,bigint,text,text[],text[])') AS fn)
SELECT
 coalesce(pg_catalog.strpos(p.prosrc,'G3A2_SIGNED_REVISION_CUTOFF')>0,false) AS installed,
 coalesce(pg_catalog.md5(pg_catalog.replace(p.prosrc,chr(13),''))='1ec5c6c67dbbcd6ecc2921508961d895',false) AS exact_body,
 coalesce(p.prosecdef,false) AS security_definer,
 coalesce(p.proconfig @> ARRAY['search_path=']::text[] OR p.proconfig @> ARRAY['search_path=""']::text[],false) AS locked_search_path,
 coalesce(pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE'),false) AS server_exec,
 coalesce(pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),false) OR
 coalesce(pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),false) AS browser_exec
FROM target t LEFT JOIN pg_catalog.pg_proc p ON p.oid=t.fn;
