-- Basketball Manager Online — Franchise Library V1.
-- Run AFTER bm_online_social_lobbies_v1.sql AND bm_online_franchise_phase2a.sql.
-- Adds per-player archive visibility only. No franchise data is deleted or changed.
-- Does NOT touch single-player tables, browser saves or auth account rows.
begin;

create table if not exists public.bm_online_franchise_visibility (
  lobby_id uuid not null references public.bm_online_franchises(lobby_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(lobby_id,user_id)
);

alter table public.bm_online_franchise_visibility enable row level security;
revoke all on public.bm_online_franchise_visibility from public,anon,authenticated;
grant select on public.bm_online_franchise_visibility to authenticated;
drop policy if exists bm_online_franchise_visibility_member_read on public.bm_online_franchise_visibility;
create policy bm_online_franchise_visibility_member_read
  on public.bm_online_franchise_visibility for select to authenticated
  using (user_id=(select auth.uid()) and public.bm_is_online_lobby_member(lobby_id));

-- The only allowed change is to hide/show a league in the CALLER's own library.
-- Membership is always checked on the server; no caller can archive it for anyone else.
create or replace function public.bm_set_online_franchise_hidden(p_lobby uuid,p_hidden boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  if p_lobby is null or p_hidden is null then raise exception 'Invalid archive request'; end if;
  if not exists (
    select 1 from public.bm_online_franchises f
      join public.bm_online_lobby_members m on m.lobby_id=f.lobby_id
      where f.lobby_id=p_lobby and m.user_id=v_user
  ) then raise exception 'Franchise unavailable to this account'; end if;
  insert into public.bm_online_franchise_visibility(lobby_id,user_id,hidden,updated_at)
    values(p_lobby,v_user,p_hidden,now())
    on conflict(lobby_id,user_id) do update
    set hidden=excluded.hidden,updated_at=excluded.updated_at;
  return p_hidden;
end $$;
revoke all on function public.bm_set_online_franchise_hidden(uuid,boolean) from public,anon,authenticated;
grant execute on function public.bm_set_online_franchise_hidden(uuid,boolean) to authenticated;

commit;
