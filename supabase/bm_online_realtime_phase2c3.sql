-- 2C.3 partial: publish the small, RLS-protected action journal, NOT the large runtime state.
-- Requires bm_online_runtime_phase2c1.sql.
-- Run once in Supabase SQL editor; safe to rerun.
begin;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public' and tablename='bm_online_franchise_events') then
    alter publication supabase_realtime add table public.bm_online_franchise_events;
  end if;
end $$;
commit;
