-- G3C H1: Protect the authoritative calendar from incompatible custom leagues.
-- ONLINE ONLY. Manual Supabase SQL Editor; DO NOT execute if PRECHECK != READY.
-- Harden BOTH create-lobby and franchise-launch validation.
BEGIN;
DO $g3c$
DECLARE
  create_oid oid := 'public.bm_create_online_lobby(text,text[],text)'::regprocedure;
  launch_oid oid := 'public.bm_launch_online_franchise(uuid,jsonb)'::regprocedure;
  create_def text := pg_catalog.pg_get_functiondef(create_oid);
  launch_def text := pg_catalog.pg_get_functiondef(launch_oid);
  create_old text := 'array_length(p_team_names,1) not between 2 and 64';
  create_new text := 'array_length(p_team_names,1) <> 30';
  launch_old text := 'v_total:=jsonb_array_length(v_seed_teams);';
  launch_new text := 'v_total:=jsonb_array_length(v_seed_teams);' || E'\n' ||
    '  if v_total<>30 then raise exception ''The online NBA calendar requires exactly 30 teams'';end if;';
BEGIN
  IF pg_catalog.length(create_def) - pg_catalog.length(pg_catalog.replace(create_def,create_old,'')) <> pg_catalog.length(create_old) THEN
    RAISE EXCEPTION 'CREATE lobby function version mismatch; stop';
  END IF;
  IF pg_catalog.length(launch_def) - pg_catalog.length(pg_catalog.replace(launch_def,launch_old,'')) <> pg_catalog.length(launch_old) THEN
    RAISE EXCEPTION 'LAUNCH franchise function version mismatch; stop';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=create_oid AND p.prosecdef AND (pg_catalog.array_to_string(p.proconfig,',') LIKE '%search_path=""%' OR pg_catalog.array_to_string(p.proconfig,',') LIKE '%search_path=%')) OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=launch_oid AND p.prosecdef AND (pg_catalog.array_to_string(p.proconfig,',') LIKE '%search_path=""%' OR pg_catalog.array_to_string(p.proconfig,',') LIKE '%search_path=%')) THEN
    RAISE EXCEPTION 'Security-definer or search-path setting unexpected; stop';
  END IF;
  EXECUTE pg_catalog.replace(create_def,create_old,create_new);
  EXECUTE pg_catalog.replace(launch_def,launch_old,launch_new);
END
$g3c$;
COMMIT;
