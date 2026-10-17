-- Basketball Manager Online Beta: identity, friendships, invitations and waiting-room lobbies.
-- Review in Supabase SQL Editor. Does NOT touch single-player save tables or auth.users rows.
-- Players cannot start a shared franchise in this phase; the waiting room is the milestone.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.bm_online_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check(length(display_name) between 2 and 24),
  player_tag char(4) not null unique check(player_tag ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.bm_online_friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bm_online_friend_request_not_self check(sender_id <> recipient_id)
);
create unique index if not exists bm_online_fr_pending_unique
  on public.bm_online_friend_requests(sender_id,recipient_id) where status='pending';
create table if not exists public.bm_online_friends (
  user_low uuid not null references auth.users(id) on delete cascade,
  user_high uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_low,user_high),
  check(user_low < user_high)
);
create table if not exists public.bm_online_lobbies (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  join_code text not null unique check(join_code ~ '^[0-9A-F]{8}$'),
  status text not null default 'waiting' check(status in ('waiting','closed')),
  roster_kind text not null check(roster_kind in ('default','custom')),
  roster_path text,
  team_names text[] not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.bm_online_lobby_members (
  lobby_id uuid not null references public.bm_online_lobbies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  team_name text,
  ready boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key(lobby_id,user_id)
);
create unique index if not exists bm_online_unique_lobby_team
  on public.bm_online_lobby_members(lobby_id,team_name) where team_name is not null;
create table if not exists public.bm_online_lobby_invites (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.bm_online_lobbies(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  message text not null default '' check(length(message) <= 140),
  status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(lobby_id,recipient_id),
  check(sender_id <> recipient_id)
);

alter table public.bm_online_profiles enable row level security;
alter table public.bm_online_friend_requests enable row level security;
alter table public.bm_online_friends enable row level security;
alter table public.bm_online_lobbies enable row level security;
alter table public.bm_online_lobby_members enable row level security;
alter table public.bm_online_lobby_invites enable row level security;

-- Users may read only public display names + tags (never email), and their own relationships.
revoke all on public.bm_online_profiles, public.bm_online_friend_requests, public.bm_online_friends,
 public.bm_online_lobbies, public.bm_online_lobby_members, public.bm_online_lobby_invites from anon;
revoke all on public.bm_online_profiles, public.bm_online_friend_requests, public.bm_online_friends,
 public.bm_online_lobbies, public.bm_online_lobby_members, public.bm_online_lobby_invites from authenticated;
grant select on public.bm_online_profiles, public.bm_online_friend_requests, public.bm_online_friends,
 public.bm_online_lobbies, public.bm_online_lobby_members, public.bm_online_lobby_invites to authenticated;

create or replace function public.bm_is_online_lobby_member(p_lobby uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists (select 1 from public.bm_online_lobby_members m where m.lobby_id = p_lobby and m.user_id = (select auth.uid()));
$$;
revoke all on function public.bm_is_online_lobby_member(uuid) from public, anon;
grant execute on function public.bm_is_online_lobby_member(uuid) to authenticated;

drop policy if exists bm_online_profiles_read on public.bm_online_profiles;
create policy bm_online_profiles_read on public.bm_online_profiles for select to authenticated using (true);
drop policy if exists bm_online_requests_read on public.bm_online_friend_requests;
create policy bm_online_requests_read on public.bm_online_friend_requests for select to authenticated
  using(sender_id=(select auth.uid()) or recipient_id=(select auth.uid()));
drop policy if exists bm_online_friends_read on public.bm_online_friends;
create policy bm_online_friends_read on public.bm_online_friends for select to authenticated
  using(user_low=(select auth.uid()) or user_high=(select auth.uid()));
drop policy if exists bm_online_lobbies_read on public.bm_online_lobbies;
create policy bm_online_lobbies_read on public.bm_online_lobbies for select to authenticated
  using (host_id=(select auth.uid()) or public.bm_is_online_lobby_member(id));
drop policy if exists bm_online_members_read on public.bm_online_lobby_members;
create policy bm_online_members_read on public.bm_online_lobby_members for select to authenticated
  using (public.bm_is_online_lobby_member(lobby_id));
drop policy if exists bm_online_invites_read on public.bm_online_lobby_invites;
create policy bm_online_invites_read on public.bm_online_lobby_invites for select to authenticated
  using(sender_id=(select auth.uid()) or recipient_id=(select auth.uid()));

-- All database mutations are SECURITY DEFINER RPCs. No client INSERT/UPDATE/DELETE permissions.
create or replace function public.bm_online_profile(p_name text default null)
returns public.bm_online_profiles language plpgsql security definer set search_path = '' as $$
declare v_id uuid := auth.uid(); v_result public.bm_online_profiles; v_name text; v_tag text; v_i int;
begin
 if v_id is null then raise exception 'Sign in first'; end if;
 select * into v_result from public.bm_online_profiles where user_id=v_id;
 if found then
   if p_name is not null then
     v_name:=btrim(p_name);
     if length(v_name)<2 or length(v_name)>24 or v_name !~ '^[a-zA-Z0-9 _.-]+$' then raise exception 'Use 2–24 letters, numbers, spaces, dots, dashes or underscores'; end if;
     update public.bm_online_profiles set display_name=v_name,updated_at=now() where user_id=v_id returning * into v_result;
   end if;
   return v_result;
 end if;
 v_name:=btrim(coalesce(p_name,''));
 if length(v_name)<2 or length(v_name)>24 or v_name !~ '^[a-zA-Z0-9 _.-]+$' then raise exception 'Choose a display name (2–24 letters/numbers)'; end if;
 for v_i in 1..100 loop
   v_tag:=lpad((floor(random()*10000)::int)::text,4,'0');
   insert into public.bm_online_profiles(user_id,display_name,player_tag) values(v_id,v_name,v_tag)
    on conflict do nothing returning * into v_result;
   if found then return v_result; end if;
 end loop;
 raise exception 'Could not allocate a unique player ID, please retry';
end $$;

create or replace function public.bm_send_friend_request(p_tag text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid:=auth.uid();v_to uuid;v_id uuid;
begin
 if v_me is null then raise exception 'Sign in first'; end if;
 select user_id into v_to from public.bm_online_profiles where player_tag=p_tag;
 if v_to is null then raise exception 'No player has that four-digit ID'; end if;
 if v_to=v_me then raise exception 'You cannot add yourself'; end if;
 if exists(select 1 from public.bm_online_friends where user_low=least(v_me,v_to) and user_high=greatest(v_me,v_to)) then raise exception 'Already friends'; end if;
 if exists(select 1 from public.bm_online_friend_requests where sender_id=v_to and recipient_id=v_me and status='pending') then raise exception 'They already sent you a friend request — accept it instead'; end if;
 insert into public.bm_online_friend_requests(sender_id,recipient_id) values(v_me,v_to)
   on conflict(sender_id,recipient_id) where status='pending' do nothing returning id into v_id;
 if v_id is null then raise exception 'Friend request already pending'; end if;
 return v_id;
end $$;

create or replace function public.bm_answer_friend_request(p_request uuid,p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_request public.bm_online_friend_requests;
begin
 select * into v_request from public.bm_online_friend_requests where id=p_request and recipient_id=auth.uid() and status='pending' for update;
 if not found then raise exception 'Friend request unavailable'; end if;
 update public.bm_online_friend_requests set status=case when p_accept then 'accepted' else 'declined' end,updated_at=now() where id=p_request;
 if p_accept then
   insert into public.bm_online_friends(user_low,user_high)
    values(least(v_request.sender_id,v_request.recipient_id),greatest(v_request.sender_id,v_request.recipient_id)) on conflict do nothing;
   update public.bm_online_friend_requests set status='cancelled',updated_at=now()
    where sender_id=v_request.recipient_id and recipient_id=v_request.sender_id and status='pending';
 end if;
end $$;
create or replace function public.bm_cancel_friend_request(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 update public.bm_online_friend_requests set status='cancelled',updated_at=now()
  where id=p_request and sender_id=auth.uid() and status='pending';
 if not found then raise exception 'Friend request unavailable'; end if;
end $$;
create or replace function public.bm_remove_friend(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 delete from public.bm_online_friends where user_low=least(auth.uid(),p_user) and user_high=greatest(auth.uid(),p_user);
 if not found then raise exception 'Friend not found'; end if;
end $$;

create or replace function public.bm_create_online_lobby(p_roster_kind text,p_team_names text[],p_roster_path text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid:=auth.uid();v_id uuid;v_code text;v_i int;
begin
 if v_me is null or not exists(select 1 from public.bm_online_profiles where user_id=v_me) then raise exception 'Create an Online profile first'; end if;
 if p_roster_kind not in ('default','custom') or array_length(p_team_names,1) is null or array_length(p_team_names,1) not between 2 and 64 then
  raise exception 'Invalid roster selection'; end if;
 if exists(select 1 from unnest(p_team_names) x where x is null or length(btrim(x))<2 or length(x)>80)
 or (select count(distinct x) from unnest(p_team_names) x)<>cardinality(p_team_names) then raise exception 'Roster has missing or duplicate team names';end if;
 if p_roster_kind='custom' then
   if p_roster_path is null or split_part(p_roster_path,'/',1)<>v_me::text or not exists (
     select 1 from storage.objects where bucket_id='bm-online-rosters' and name=p_roster_path
   ) then raise exception 'Custom roster upload not found'; end if;
 elsif p_roster_path is not null then raise exception 'Default roster cannot include an uploaded file'; end if;
 if exists(select 1 from public.bm_online_lobbies where host_id=v_me and status='waiting') then raise exception 'Close your existing lobby before hosting another';end if;
 for v_i in 1..40 loop
   v_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
   insert into public.bm_online_lobbies(host_id,join_code,roster_kind,roster_path,team_names)
    values(v_me,v_code,p_roster_kind,p_roster_path,p_team_names)
    on conflict(join_code) do nothing returning id into v_id;
   if v_id is not null then exit; end if;
 end loop;
 if v_id is null then raise exception 'Could not generate lobby code';end if;
 insert into public.bm_online_lobby_members(lobby_id,user_id) values(v_id,v_me);
 return v_id;
end $$;

create or replace function public.bm_join_online_lobby(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid:=auth.uid();v_lobby public.bm_online_lobbies;
begin
 if v_me is null or not exists(select 1 from public.bm_online_profiles where user_id=v_me) then raise exception 'Create your Online profile first';end if;
 select * into v_lobby from public.bm_online_lobbies where join_code=upper(btrim(p_code)) and status='waiting' for update;
 if not found then raise exception 'Lobby code not found or lobby closed';end if;
 if exists(select 1 from public.bm_online_lobby_members where lobby_id=v_lobby.id and user_id=v_me) then return v_lobby.id;end if;
 if (select count(*) from public.bm_online_lobby_members where lobby_id=v_lobby.id)>=4 then raise exception 'Lobby is full (4/4)';end if;
 insert into public.bm_online_lobby_members(lobby_id,user_id) values(v_lobby.id,v_me);
 return v_lobby.id;
end $$;

create or replace function public.bm_set_online_team(p_lobby uuid,p_team text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_lobby public.bm_online_lobbies;
begin
 select * into v_lobby from public.bm_online_lobbies where id=p_lobby and status='waiting' for update;
 if not found then raise exception 'Lobby closed';end if;
 if p_team is not null and not (p_team=any(v_lobby.team_names)) then raise exception 'Team does not exist in this league';end if;
 if not exists(select 1 from public.bm_online_lobby_members where lobby_id=p_lobby and user_id=auth.uid()) then raise exception 'Not a lobby member';end if;
 if p_team is not null and exists(select 1 from public.bm_online_lobby_members where lobby_id=p_lobby and team_name=p_team and user_id<>auth.uid()) then
  raise exception 'Another player already selected that team';end if;
 update public.bm_online_lobby_members set team_name=p_team,ready=false where lobby_id=p_lobby and user_id=auth.uid();
end $$;
create or replace function public.bm_set_online_ready(p_lobby uuid,p_ready boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from public.bm_online_lobbies where id=p_lobby and status='waiting' for update;
 if not found then raise exception 'Lobby closed';end if;
 update public.bm_online_lobby_members set ready=p_ready where lobby_id=p_lobby and user_id=auth.uid() and team_name is not null;
 if not found then raise exception 'Select a team before readying up';end if;
end $$;
create or replace function public.bm_leave_online_lobby(p_lobby uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_host uuid;
begin
 select host_id into v_host from public.bm_online_lobbies where id=p_lobby for update;
 if v_host=auth.uid() then
  update public.bm_online_lobbies set status='closed',updated_at=now() where id=p_lobby;
  update public.bm_online_lobby_invites set status='cancelled',updated_at=now() where lobby_id=p_lobby and status='pending';
 else
  delete from public.bm_online_lobby_members where lobby_id=p_lobby and user_id=auth.uid();
 end if;
end $$;

create or replace function public.bm_send_online_lobby_invite(p_lobby uuid,p_recipient uuid,p_message text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid:=auth.uid();v_id uuid;
begin
 if not exists(select 1 from public.bm_online_lobbies where id=p_lobby and host_id=v_me and status='waiting') then raise exception 'Only the host can invite';end if;
 if not exists(select 1 from public.bm_online_friends where user_low=least(v_me,p_recipient) and user_high=greatest(v_me,p_recipient)) then raise exception 'Invite someone on your friends list';end if;
 if exists(select 1 from public.bm_online_lobby_members where lobby_id=p_lobby and user_id=p_recipient) then raise exception 'Friend already in lobby';end if;
 insert into public.bm_online_lobby_invites(lobby_id,sender_id,recipient_id,message,status)
  values(p_lobby,v_me,p_recipient,left(coalesce(p_message,''),140),'pending')
  on conflict(lobby_id,recipient_id) do update set status='pending',message=excluded.message,updated_at=now(),sender_id=excluded.sender_id
  returning id into v_id;
 return v_id;
end $$;
create or replace function public.bm_cancel_online_lobby_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 update public.bm_online_lobby_invites set status='cancelled',updated_at=now() where id=p_invite and sender_id=auth.uid() and status='pending';
 if not found then raise exception 'Invite is no longer pending';end if;
end $$;
create or replace function public.bm_answer_online_lobby_invite(p_invite uuid,p_accept boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_invite public.bm_online_lobby_invites; v_lobby public.bm_online_lobbies; v_lobby_id uuid;
begin
 -- Always lock lobby before invitation, matching the host-close lock order.
 select lobby_id into v_lobby_id from public.bm_online_lobby_invites
  where id=p_invite and recipient_id=auth.uid() and status='pending';
 if not found then raise exception 'Invite unavailable';end if;
 select * into v_lobby from public.bm_online_lobbies where id=v_lobby_id and status='waiting' for update;
 if not found then raise exception 'Lobby is closed';end if;
 select * into v_invite from public.bm_online_lobby_invites where id=p_invite and recipient_id=auth.uid() and status='pending' for update;
 if not found then raise exception 'Invite unavailable';end if;
 if not p_accept then
  update public.bm_online_lobby_invites set status='declined',updated_at=now() where id=p_invite;
  return null;
 end if;
 if not exists(select 1 from public.bm_online_lobby_members where lobby_id=v_lobby.id and user_id=auth.uid()) then
  if (select count(*) from public.bm_online_lobby_members where lobby_id=v_lobby.id)>=4 then raise exception 'Lobby is full';end if;
  insert into public.bm_online_lobby_members(lobby_id,user_id) values(v_lobby.id,auth.uid());
 end if;
 update public.bm_online_lobby_invites set status='accepted',updated_at=now() where id=p_invite;
 return v_lobby.id;
end $$;

-- Guard mutations: only authenticated users may execute RPCs.
do $$ declare r record; begin
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in (
  'bm_online_profile','bm_send_friend_request','bm_answer_friend_request','bm_cancel_friend_request',
  'bm_remove_friend','bm_create_online_lobby','bm_join_online_lobby','bm_set_online_team',
  'bm_set_online_ready','bm_leave_online_lobby','bm_send_online_lobby_invite',
  'bm_cancel_online_lobby_invite','bm_answer_online_lobby_invite') loop
  execute format('revoke all on function %s from public, anon',r.signature);
  execute format('grant execute on function %s to authenticated',r.signature);
 end loop;
end $$;

-- Private custom roster files; membership is required to read a hosted roster.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('bm-online-rosters','bm-online-rosters',false,10000000,array['application/json'])
on conflict(id) do update set public=false,file_size_limit=10000000,allowed_mime_types=array['application/json'];
drop policy if exists bm_online_rosters_upload on storage.objects;
create policy bm_online_rosters_upload on storage.objects for insert to authenticated
 with check(bucket_id='bm-online-rosters' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists bm_online_rosters_read on storage.objects;
create policy bm_online_rosters_read on storage.objects for select to authenticated
 using(bucket_id='bm-online-rosters' and (
  (storage.foldername(name))[1]=(select auth.uid())::text or exists(
    select 1 from public.bm_online_lobbies l join public.bm_online_lobby_members m on m.lobby_id=l.id
    where l.roster_path=name and m.user_id=(select auth.uid())
  )
 ));

-- Make Postgres Changes events available to the beta UI (still governed by RLS).
do $$ declare v text; begin
 foreach v in array array['bm_online_profiles','bm_online_friend_requests','bm_online_friends','bm_online_lobbies','bm_online_lobby_members','bm_online_lobby_invites'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v) then
   execute format('alter publication supabase_realtime add table public.%I',v);
  end if;
 end loop;
end $$;
