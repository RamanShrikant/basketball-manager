-- READ ONLY. Expect four rows PASS after manual migration.
WITH f AS (
 SELECT pg_catalog.to_regprocedure('public.bm_online_draft_deadline_g3ca3(uuid,integer,integer)') AS deadline,
 pg_catalog.to_regprocedure('public.bm_online_draft_fallback_eligible_g3ca3(uuid,integer,integer,uuid)') AS eligible,
 pg_catalog.to_regprocedure('public.bm_online_draft_clock_g3ca3(uuid)') AS clock,
 pg_catalog.to_regprocedure('public.bm_online_make_draft_pick_phase2e2(uuid,uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,text,boolean)') AS commit_fn
), x AS (
 SELECT 'server_deadline' AS check_name,
  f.deadline IS NOT NULL AND NOT pg_catalog.has_function_privilege('authenticated',f.deadline,'EXECUTE') AND
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=f.deadline AND p.prosecdef AND
   EXISTS(SELECT 1 FROM pg_catalog.unnest(p.proconfig) AS u(setting) WHERE setting IN ('search_path=','search_path=""'))) AS ok FROM f
 UNION ALL SELECT 'private_fallback_eligibility',
  f.eligible IS NOT NULL AND NOT pg_catalog.has_function_privilege('authenticated',f.eligible,'EXECUTE') AND
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=f.eligible AND p.prosecdef AND
   EXISTS(SELECT 1 FROM pg_catalog.unnest(p.proconfig) AS u(setting) WHERE setting IN ('search_path=','search_path=""'))) FROM f
 UNION ALL SELECT 'member_clock_read',
  f.clock IS NOT NULL AND pg_catalog.has_function_privilege('authenticated',f.clock,'EXECUTE') AND
  NOT pg_catalog.has_function_privilege('anon',f.clock,'EXECUTE') AND
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=f.clock AND p.prosecdef AND
   EXISTS(SELECT 1 FROM pg_catalog.unnest(p.proconfig) AS u(setting) WHERE setting IN ('search_path=','search_path=""'))) FROM f
 UNION ALL SELECT 'trusted_commit_guard',
  f.commit_fn IS NOT NULL AND pg_catalog.strpos(pg_catalog.pg_get_functiondef(f.commit_fn),
     'public.bm_online_draft_fallback_eligible_g3ca3(p_lobby,v_year,v_index,v_human_owner)')>0 AND
  NOT pg_catalog.has_function_privilege('authenticated',f.commit_fn,'EXECUTE') AND
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=f.commit_fn AND p.prosecdef AND
   EXISTS(SELECT 1 FROM pg_catalog.unnest(p.proconfig) AS u(setting) WHERE setting IN ('search_path=','search_path=""'))) FROM f
)
SELECT check_name,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS status FROM x ORDER BY check_name;
