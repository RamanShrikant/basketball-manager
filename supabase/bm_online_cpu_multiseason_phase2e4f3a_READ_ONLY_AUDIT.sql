-- Phase 2E.4-F3A PRE-FLIGHT - READ ONLY, NO MIGRATION
-- Run in the SAME Supabase project where prior F1 and F2 were installed.
SELECT
  to_regprocedure('public.bm_online_commit_cpu_player_trade(uuid,uuid,uuid,bigint,text,text[],text[])') IS NOT NULL AS cpu_trade_commit_exists,
  to_regprocedure('public.bm_online_prepare_human_asset_trade(jsonb,text,text,text[],text[],text[],text[],uuid)') IS NOT NULL AS asset_trade_helper_exists,
  COALESCE(strpos(pg_get_functiondef(to_regprocedure('public.bm_online_prepare_human_player_trade(jsonb,text,text,text[],text[],uuid)')),
    'Complete season rollover before trading')>0,false) AS f1_player_trade_installed,
  COALESCE(strpos(pg_get_functiondef(to_regprocedure('public.bm_online_validate_human_trade_finances(jsonb,jsonb,numeric,numeric,jsonb,jsonb)')),
    'Second-season trade financials require completed rollover')>0,false) AS f1_financials_installed,
  COALESCE(strpos(pg_get_functiondef(to_regprocedure('public.bm_online_sign_cap_room_free_agent(uuid,uuid,bigint,text,bigint)')),
    'bm_online_f2_cap_room_ceiling(v_state)')>0,false) AS f2_signing_installed;
