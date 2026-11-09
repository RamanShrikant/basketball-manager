-- Basketball Manager Online Phase 2C.1: durable runtime foundation.
-- Execute AFTER bm_online_franchise_phase2a.sql. This is ONLINE ONLY.
-- Existing seed_state is untouched, including previously started franchises.
-- SECURITY: no direct browser insert/update/delete privileges on runtime or journal.
-- Future roster actions must use separate, operation-specific, server-validated RPCs.
begin;

create table if not exists public.bm_online_franchise_runtime (
  lobby_id uuid primary key references public.bm_online_franchises(lobby_id) on delete restrict,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  revision bigint not null default 1 check (revision >= 1),
  schema_version integer not null default 1 check (schema_version = 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bm_online_franchise_runtime enable row level security;
revoke all on public.bm_online_franchise_runtime from public, anon, authenticated;
grant select on public.bm_online_franchise_runtime to authenticated;
drop policy if exists bm_online_runtime_member_read on public.bm_online_franchise_runtime;
create policy bm_online_runtime_member_read on public.bm_online_franchise_runtime
  for select to authenticated
  using (public.bm_is_online_lobby_member(lobby_id));

-- Reserved server-only journal for the upcoming transaction RPCs.
-- Each accepted action will have a unique request ID and unique resulting revision.
create table if not exists public.bm_online_franchise_events (
  lobby_id uuid not null references public.bm_online_franchise_runtime(lobby_id) on delete restrict,
  revision bigint not null check (revision > 1),
  request_id uuid not null,
  actor_id uuid not null references auth.users(id),
  action_type text not null check (char_length(action_type) between 2 and 80),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  primary key (lobby_id, revision),
  unique (lobby_id, request_id)
);

alter table public.bm_online_franchise_events enable row level security;
revoke all on public.bm_online_franchise_events from public, anon, authenticated;
grant select on public.bm_online_franchise_events to authenticated;
drop policy if exists bm_online_events_member_read on public.bm_online_franchise_events;
create policy bm_online_events_member_read on public.bm_online_franchise_events
  for select to authenticated
  using (public.bm_is_online_lobby_member(lobby_id));

-- Idempotently initialize runtime from the original immutable seed.
-- The franchise row lock serializes concurrent initialization by multiple GMs.
-- A caller must be a member of an already STARTED franchise.
create or replace function public.bm_init_online_franchise_runtime(p_lobby uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_seed jsonb;
  v_revision bigint;
begin
  if v_user is null then
    raise exception 'Sign in to access Online';
  end if;
  if p_lobby is null then
    raise exception 'Invalid franchise identifier';
  end if;
  if not exists (
    select 1 from public.bm_online_lobby_members m
    where m.lobby_id = p_lobby and m.user_id = v_user
  ) then
    raise exception 'You are not a member of this franchise';
  end if;

  select f.seed_state into v_seed
  from public.bm_online_franchises f
  join public.bm_online_lobbies l on l.id = f.lobby_id
  where f.lobby_id = p_lobby and l.status = 'started'
  for update of f;
  if not found then
    raise exception 'Started franchise not found';
  end if;

  insert into public.bm_online_franchise_runtime(lobby_id, state, revision)
  values (p_lobby, v_seed, 1)
  on conflict (lobby_id) do nothing;

  select r.revision into v_revision
  from public.bm_online_franchise_runtime r
  where r.lobby_id = p_lobby;
  return v_revision;
end;
$$;

revoke all on function public.bm_init_online_franchise_runtime(uuid) from public, anon, authenticated;
grant execute on function public.bm_init_online_franchise_runtime(uuid) to authenticated;

commit;
