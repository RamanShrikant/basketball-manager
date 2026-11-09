-- READ ONLY: F3B1 exact version check. No changes to the database.
SELECT
  coalesce((SELECT pg_catalog.md5(replace(p.prosrc,chr(13),'')) = '07808c1806ceb8c05dc7d6f44a5c5f2f'
            FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(
              'public.bm_online_prepare_human_pick_trade_base_2c2d9(jsonb,text,text,text[],text[],uuid)')),false)
    AS dynamic_pick_window_installed,
  coalesce((SELECT pg_catalog.md5(replace(p.prosrc,chr(13),'')) = '94f334a225fe338401f79d4523ee598e'
            FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(
              'public.bm_online_prepare_human_pick_trade(jsonb,text,text,text[],text[],uuid)')),false)
    AS dynamic_swap_window_installed;
