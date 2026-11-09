-- Phase 2C.2D-5: broadcast small human-GM offer changes to lobby members.
-- Prerequisite: bm_online_human_trades_phase2c2d2.sql (RLS read policy).
-- Safe to rerun. Online offer INSERT/UPDATE only, never broadcast league state.
-- SQL deployment is MANUAL. This does not enable CPU trades.
begin;
-- Sanity check: do not add offers to realtime if the member-scoped RLS policy
-- is absent. Realtime must never be enabled on unprotected offers.
do $$ begin
  if to_regclass('public.bm_online_trade_offers') is null or
     not exists (select 1 from pg_policies
       where schemaname='public' and tablename='bm_online_trade_offers'
         and policyname='bm_online_trade_offers_member_read' and cmd='SELECT') then
    raise exception 'Online trade-offer table/member RLS policy missing. Apply 2C.2D-2 first';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='bm_online_trade_offers' and c.relrowsecurity) then
    raise exception 'Online trade-offer row level security must be enabled';
  end if;
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
     and not exists (select 1 from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public' and tablename='bm_online_trade_offers') then
    alter publication supabase_realtime add table public.bm_online_trade_offers;
  end if;
end $$;
commit;
