-- Read-only final verification after G3C H1 SQL
WITH defs AS (
 SELECT p.proname,p.prosecdef,p.proconfig,
 pg_catalog.pg_get_functiondef(p.oid) AS definition
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.oid IN (
 'public.bm_create_online_lobby(text,text[],text)'::regprocedure,
 'public.bm_launch_online_franchise(uuid,jsonb)'::regprocedure)
)
SELECT proname,
 CASE WHEN proname='bm_create_online_lobby' THEN pg_catalog.strpos(definition,'array_length(p_team_names,1) <> 30')>0
 WHEN proname='bm_launch_online_franchise' THEN pg_catalog.strpos(definition,'v_total<>30')>0 END AS exactly_30_guard_installed,
 prosecdef AS security_definer,proconfig AS function_settings
FROM defs ORDER BY proname;
