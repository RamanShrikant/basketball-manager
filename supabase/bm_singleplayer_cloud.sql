-- Basketball Manager: PRIVATE single-player cloud backups.
-- Apply once in Supabase -> SQL Editor. Safe to rerun; does not affect auth.users.
-- Each user may read only their own snapshot and DB head.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bm-singleplayer-saves', 'bm-singleplayer-saves', false, 50000000, array['application/gzip'])
on conflict (id) do update set public = false, file_size_limit=50000000, allowed_mime_types=array['application/gzip'];

create table if not exists public.bm_cloud_save_heads (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null check (revision >= 1),
  snapshot_id uuid not null,
  storage_path text not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 50000000),
  content_sha256 text not null,
  updated_at timestamptz not null default now()
);

alter table public.bm_cloud_save_heads enable row level security;
drop policy if exists bm_cloud_select_own on public.bm_cloud_save_heads;
create policy bm_cloud_select_own on public.bm_cloud_save_heads
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.bm_cloud_save_heads from anon, authenticated;
grant select on public.bm_cloud_save_heads to authenticated;

-- Server-controlled compare-and-swap; browsers cannot directly rewrite the cloud pointer.
create or replace function public.bm_commit_cloud_snapshot(
  p_expected_revision bigint,
  p_snapshot_id uuid,
  p_storage_path text,
  p_size_bytes integer,
  p_content_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_revision bigint;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_expected_revision is null or p_expected_revision < 0 then raise exception 'Invalid revision'; end if;
  if p_snapshot_id is null or p_storage_path is null or
     left(p_storage_path, length(v_user::text) + 1) <> v_user::text || '/' or
     p_storage_path !~ '\.json\.gz$' then
    raise exception 'Invalid cloud snapshot path';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 50000000 then raise exception 'File size out of range'; end if;
  if p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Invalid digest'; end if;

  -- Serialize competing commits even if the user's head row is not created yet.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 92341));
  select revision into v_revision from public.bm_cloud_save_heads
   where user_id = v_user for update;
  if coalesce(v_revision, 0) <> p_expected_revision then
    return jsonb_build_object('ok', false, 'reason', 'version_conflict', 'revision', coalesce(v_revision, 0));
  end if;
  -- The object must already exist before the pointer is updated.
  if not exists (select 1 from storage.objects where bucket_id='bm-singleplayer-saves' and name=p_storage_path) then
    raise exception 'Uploaded cloud snapshot not found';
  end if;
  if v_revision is null then
    insert into public.bm_cloud_save_heads(user_id, revision, snapshot_id, storage_path, size_bytes, content_sha256)
    values (v_user, 1, p_snapshot_id, p_storage_path, p_size_bytes, p_content_sha256);
    v_revision := 1;
  else
    update public.bm_cloud_save_heads set revision=revision+1, snapshot_id=p_snapshot_id,
      storage_path=p_storage_path, size_bytes=p_size_bytes, content_sha256=p_content_sha256, updated_at=now()
      where user_id=v_user returning revision into v_revision;
  end if;
  return jsonb_build_object('ok', true, 'revision', v_revision);
end $$;
revoke all on function public.bm_commit_cloud_snapshot(bigint,uuid,text,integer,text) from public, anon;
grant execute on function public.bm_commit_cloud_snapshot(bigint,uuid,text,integer,text) to authenticated;

-- Store objects only in the owner's UUID folder; bucket is never public.
drop policy if exists bm_cloud_storage_read on storage.objects;
create policy bm_cloud_storage_read on storage.objects for select to authenticated
 using (bucket_id='bm-singleplayer-saves' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists bm_cloud_storage_upload on storage.objects;
create policy bm_cloud_storage_upload on storage.objects for insert to authenticated
 with check (bucket_id='bm-singleplayer-saves' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists bm_cloud_storage_delete on storage.objects;
create policy bm_cloud_storage_delete on storage.objects for delete to authenticated
 using (bucket_id='bm-singleplayer-saves' and (storage.foldername(name))[1]=(select auth.uid())::text);
