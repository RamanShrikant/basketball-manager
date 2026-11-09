-- Basketball Manager Phase G3A3: Human trade historical-signing eligibility.
-- Run MANUALLY in Supabase only after 3/3 READY precheck.
-- Changes only offer/response functions and adds a locked season-cutoff helper.
-- Does not modify league rows, sign players, or execute trades during migration.
BEGIN;
DO $g3a3_preflight$
DECLARE v_oid oid;
BEGIN
 IF pg_catalog.to_regprocedure('public.bm_online_human_trade_signing_cutoff_phase2e4g3a3(uuid,jsonb,bigint)') IS NOT NULL THEN
  RAISE EXCEPTION 'G3A3 signing cutoff helper already exists; STOP'; END IF;
 IF pg_catalog.to_regclass('public.bm_online_season_archives') IS NULL OR
    pg_catalog.to_regclass('public.bm_online_franchise_events') IS NULL THEN
  RAISE EXCEPTION 'G3A3 requires season archives and signed-event journal'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(
  'public.bm_online_commit_cpu_player_trade(uuid,uuid,uuid,bigint,text,text[],text[])')
  AND pg_catalog.strpos(p.prosrc,'G3A2_SIGNED_REVISION_CUTOFF')>0) THEN
  RAISE EXCEPTION 'G3A2 CPU historical signing repair must be installed first'; END IF;
 v_oid:=pg_catalog.to_regprocedure('public.bm_online_offer_human_trade(uuid,uuid,bigint,text,text[],text[])');
 IF v_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=v_oid
    AND pg_catalog.md5(pg_catalog.replace(p.prosrc,chr(13),''))='98393b5cf7e176972338f427c29d703b'
    AND p.prosecdef AND
        (p.proconfig @> ARRAY['search_path=']::text[] OR p.proconfig @> ARRAY['search_path=""']::text[])) OR
    pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE') OR
    NOT pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE') THEN
   RAISE EXCEPTION 'G3A3 unexpected live basic_offer definition/permissions; STOP'; END IF;
 v_oid:=pg_catalog.to_regprocedure('public.bm_online_offer_human_asset_trade(uuid,uuid,bigint,text,text[],text[],text[],text[])');
 IF v_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=v_oid
    AND pg_catalog.md5(pg_catalog.replace(p.prosrc,chr(13),''))='6323a1a36cb9f68b3d8f975e3a2965ed'
    AND p.prosecdef AND
        (p.proconfig @> ARRAY['search_path=']::text[] OR p.proconfig @> ARRAY['search_path=""']::text[])) OR
    pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE') OR
    NOT pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE') THEN
   RAISE EXCEPTION 'G3A3 unexpected live asset_offer definition/permissions; STOP'; END IF;
 v_oid:=pg_catalog.to_regprocedure('public.bm_online_respond_human_trade(uuid,uuid,uuid,bigint,text)');
 IF v_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=v_oid
    AND pg_catalog.md5(pg_catalog.replace(p.prosrc,chr(13),''))='b02c239e73ce858600d18695bfc43a26'
    AND p.prosecdef AND
        (p.proconfig @> ARRAY['search_path=']::text[] OR p.proconfig @> ARRAY['search_path=""']::text[])) OR
    pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE') OR
    NOT pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE') THEN
   RAISE EXCEPTION 'G3A3 unexpected live response definition/permissions; STOP'; END IF;
END $g3a3_preflight$;

-- G3A3: called only from the locked human-trade RPCs.
-- Return the final revision of the last archived NBA season. Every signing
-- event after that revision belongs to the current active NBA season.
CREATE OR REPLACE FUNCTION public.bm_online_human_trade_signing_cutoff_phase2e4g3a3(
 p_lobby uuid,p_state jsonb,p_revision bigint
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_year integer;
 v_prior_year integer;
 v_archive_revision bigint;
 v_prior_cutoff bigint := 0;
BEGIN
 IF p_lobby IS NULL OR p_state IS NULL OR p_revision IS NULL OR p_revision<1 THEN
  RAISE EXCEPTION 'Invalid human-trade season-boundary inputs'; END IF;
 v_year:=CASE
   WHEN (p_state->>'seasonYear') ~ '^20[0-9][0-9]$' THEN (p_state->>'seasonYear')::integer
   WHEN (p_state->>'seasonStartYear') ~ '^20[0-9][0-9]$' THEN (p_state->>'seasonStartYear')::integer
   ELSE 0 END;
 -- Match the bounded 2026-2028 human/CPU trading support. No silent 2029 unlock.
 IF v_year NOT BETWEEN 2026 AND 2028 OR
    p_state->>'seasonStartYear' IS DISTINCT FROM v_year::text THEN
  RAISE EXCEPTION 'Human trade signing eligibility requires a supported active season'; END IF;
 IF v_year=2026 THEN
  RETURN 0; -- Original season: preserve the pre-existing full-season signing lock.
 END IF;
 IF p_state#>>'{onlineSeasonRollover,fromYear}' IS DISTINCT FROM (v_year-1)::text OR
    p_state#>>'{onlineSeasonRollover,toYear}' IS DISTINCT FROM v_year::text OR
    p_state#>>'{onlineSeasonRollover,status}' IS DISTINCT FROM 'complete' OR
    p_state#>>'{onlineSchedule,seasonYear}' IS DISTINCT FROM v_year::text OR
    p_state#>>'{onlineSchedule,phase}' IS DISTINCT FROM 'regular-season' OR
    pg_catalog.jsonb_typeof(p_state->'onlineSeasonHistory') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Human trade signing eligibility requires completed season rollover'; END IF;
 -- Every prior season must have exactly one matching immutable archive/history.
 FOR v_prior_year IN 2026..(v_year-1) LOOP
  SELECT a.archived_revision INTO v_archive_revision
   FROM public.bm_online_season_archives a
   WHERE a.lobby_id=p_lobby AND a.season_year=v_prior_year;
  IF NOT FOUND OR v_archive_revision IS NULL OR v_archive_revision<1 OR
     v_archive_revision>=p_revision OR v_archive_revision<=v_prior_cutoff OR
     (SELECT count(*) FROM pg_catalog.jsonb_array_elements(p_state->'onlineSeasonHistory') h
        WHERE h.value->>'seasonYear'=v_prior_year::text AND
              h.value->>'archiveRevision'=v_archive_revision::text)<>1 THEN
   RAISE EXCEPTION 'Human trade signing eligibility needs consistent NBA season archives'; END IF;
  v_prior_cutoff:=v_archive_revision;
 END LOOP;
 IF (SELECT max(a.season_year) FROM public.bm_online_season_archives a
      WHERE a.lobby_id=p_lobby) IS DISTINCT FROM v_year-1 THEN
  RAISE EXCEPTION 'Human trade archive does not match active NBA season'; END IF;
 RETURN v_prior_cutoff;
END $$;
REVOKE ALL ON FUNCTION public.bm_online_human_trade_signing_cutoff_phase2e4g3a3(uuid,jsonb,bigint)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bm_online_human_trade_signing_cutoff_phase2e4g3a3(uuid,jsonb,bigint)
 TO service_role;

create or replace function public.bm_online_offer_human_trade(
  p_lobby uuid,p_request uuid,p_expected_revision bigint,p_target_team text,
  p_sending_ids text[],p_receiving_ids text[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();
  v_state jsonb;
  v_revision bigint;
  v_status text;
  v_team text;
  v_recipient uuid;
  v_recipients uuid[];
  v_existing public.bm_online_trade_offers%rowtype;
  v_preview jsonb;
  v_signed_cutoff bigint;
begin
  if v_actor is null or p_lobby is null or p_request is null or p_expected_revision is null or p_expected_revision<1 then
    raise exception 'Invalid authenticated online trade request'; end if;
  select state,revision into v_state,v_revision from public.bm_online_franchise_runtime
    where lobby_id=p_lobby for update;
  if not found then raise exception 'Online franchise missing'; end if;
  select l.status,m.team_name into v_status,v_team from public.bm_online_lobbies l
    join public.bm_online_lobby_members m on m.lobby_id=l.id and m.user_id=v_actor
    where l.id=p_lobby;
  if not found or v_status<>'started' or nullif(btrim(v_team),'') is null then
    raise exception 'You must control a team in the started online franchise'; end if;
  select * into v_existing from public.bm_online_trade_offers where id=p_request;
  if found then
    if v_existing.lobby_id<>p_lobby or v_existing.proposer_id<>v_actor
      or v_existing.proposer_team<>v_team or v_existing.recipient_team<>p_target_team
      or v_existing.proposer_player_ids is distinct from p_sending_ids
      or v_existing.recipient_player_ids is distinct from p_receiving_ids then
      raise exception 'Request ID was already used for another trade'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'offer_id',p_request,'status',v_existing.status);
  end if;
  if v_revision<>p_expected_revision then raise exception 'Shared league changed. Refresh before offering a trade.'; end if;
  select array_agg(m.user_id) into v_recipients from public.bm_online_lobby_members m
    where m.lobby_id=p_lobby and m.team_name=p_target_team;
  if cardinality(v_recipients) is distinct from 1 then
    raise exception 'Target team must have exactly one human GM'; end if;
  v_recipient:=v_recipients[1];
  if v_recipient=v_actor then raise exception 'You cannot trade with your own team'; end if;
  v_preview:=public.bm_online_prepare_human_player_trade(v_state,v_team,p_target_team,
    p_sending_ids,p_receiving_ids,p_request);
  -- G3A3_SIGNED_REVISION_CUTOFF: require a consistent active NBA-season archive.
  v_signed_cutoff:=public.bm_online_human_trade_signing_cutoff_phase2e4g3a3(p_lobby,v_state,v_revision);
  -- A just-signed online free agent is locked until the Online calendar can
  -- establish the usual signing cooldown. Never allow immediate flips.
  if exists (select 1 from public.bm_online_franchise_events e
    where e.lobby_id=p_lobby and e.revision>v_signed_cutoff
      and e.action_type in ('sign_cap_room_contract','sign_cap_room_free_agent')
      and e.details->>'player_id'=any(p_sending_ids||p_receiving_ids)) then
    raise exception 'A recently signed player is not yet trade eligible'; end if;
  insert into public.bm_online_trade_offers(id,lobby_id,proposer_id,recipient_id,proposer_team,recipient_team,
    proposer_player_ids,recipient_player_ids,proposer_player_labels,recipient_player_labels,created_revision)
  values(p_request,p_lobby,v_actor,v_recipient,v_team,p_target_team,p_sending_ids,p_receiving_ids,
    array(select jsonb_array_elements_text(v_preview->'record'->'userSent'->'players')),
    array(select jsonb_array_elements_text(v_preview->'record'->'cpuSent'->'players')),v_revision);
  return jsonb_build_object('ok',true,'replayed',false,'offer_id',p_request,'status','pending');
end $$;
create or replace function public.bm_online_offer_human_asset_trade(
  p_lobby uuid,p_request uuid,p_expected_revision bigint,p_target_team text,
  p_sending_ids text[],p_receiving_ids text[],p_sending_pick_ids text[],p_receiving_pick_ids text[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();
  v_state jsonb;
  v_revision bigint;
  v_status text;
  v_team text;
  v_recipient uuid;
  v_recipients uuid[];
  v_existing public.bm_online_trade_offers%rowtype;
  v_preview jsonb;
  v_signed_cutoff bigint;
begin
  if v_actor is null or p_lobby is null or p_request is null or p_expected_revision is null or p_expected_revision<1 then
    raise exception 'Invalid authenticated online trade request'; end if;
  select state,revision into v_state,v_revision from public.bm_online_franchise_runtime
    where lobby_id=p_lobby for update;
  if not found then raise exception 'Online franchise missing'; end if;
  select l.status,m.team_name into v_status,v_team from public.bm_online_lobbies l
    join public.bm_online_lobby_members m on m.lobby_id=l.id and m.user_id=v_actor
    where l.id=p_lobby;
  if not found or v_status<>'started' or nullif(btrim(v_team),'') is null then
    raise exception 'You must control a team in the started online franchise'; end if;
  select * into v_existing from public.bm_online_trade_offers where id=p_request;
  if found then
    if v_existing.lobby_id<>p_lobby or v_existing.proposer_id<>v_actor
      or v_existing.proposer_team<>v_team or v_existing.recipient_team<>p_target_team
      or v_existing.proposer_player_ids is distinct from p_sending_ids
      or v_existing.recipient_player_ids is distinct from p_receiving_ids
      or v_existing.proposer_pick_ids is distinct from p_sending_pick_ids
      or v_existing.recipient_pick_ids is distinct from p_receiving_pick_ids then
      raise exception 'Request ID was already used for another trade'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'offer_id',p_request,'status',v_existing.status);
  end if;
  if v_revision<>p_expected_revision then raise exception 'Shared league changed. Refresh before offering a trade.'; end if;
  select array_agg(m.user_id) into v_recipients from public.bm_online_lobby_members m
    where m.lobby_id=p_lobby and m.team_name=p_target_team;
  if cardinality(v_recipients) is distinct from 1 then
    raise exception 'Target team must have exactly one human GM'; end if;
  v_recipient:=v_recipients[1];
  if v_recipient=v_actor then raise exception 'You cannot trade with your own team'; end if;
  v_preview:=public.bm_online_prepare_human_asset_trade(v_state,v_team,p_target_team,
    p_sending_ids,p_receiving_ids,p_sending_pick_ids,p_receiving_pick_ids,p_request);
  -- G3A3_SIGNED_REVISION_CUTOFF: require a consistent active NBA-season archive.
  v_signed_cutoff:=public.bm_online_human_trade_signing_cutoff_phase2e4g3a3(p_lobby,v_state,v_revision);
  -- A just-signed online free agent is locked until the Online calendar can
  -- establish the usual signing cooldown. Never allow immediate flips.
  if exists (select 1 from public.bm_online_franchise_events e
    where e.lobby_id=p_lobby and e.revision>v_signed_cutoff
      and e.action_type in ('sign_cap_room_contract','sign_cap_room_free_agent')
      and e.details->>'player_id'=any(p_sending_ids||p_receiving_ids)) then
    raise exception 'A recently signed player is not yet trade eligible'; end if;
  insert into public.bm_online_trade_offers(id,lobby_id,proposer_id,recipient_id,proposer_team,recipient_team,
    proposer_player_ids,recipient_player_ids,proposer_player_labels,recipient_player_labels,
    proposer_pick_ids,recipient_pick_ids,proposer_pick_labels,recipient_pick_labels,created_revision)
  values(p_request,p_lobby,v_actor,v_recipient,v_team,p_target_team,p_sending_ids,p_receiving_ids,
    array(select jsonb_array_elements_text(v_preview->'record'->'userSent'->'players')),
    array(select jsonb_array_elements_text(v_preview->'record'->'cpuSent'->'players')),
    p_sending_pick_ids,p_receiving_pick_ids,
    array(select jsonb_array_elements_text(v_preview->'record'->'userSent'->'picks')),
    array(select jsonb_array_elements_text(v_preview->'record'->'cpuSent'->'picks')),v_revision);
  return jsonb_build_object('ok',true,'replayed',false,'offer_id',p_request,'status','pending');
end $$;
create or replace function public.bm_online_respond_human_trade(
  p_lobby uuid,p_offer uuid,p_request uuid,p_expected_revision bigint,p_decision text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();
  v_state jsonb;
  v_revision bigint;
  v_lobby_status text;
  v_offer public.bm_online_trade_offers%rowtype;
  v_prior public.bm_online_franchise_events%rowtype;
  v_preview jsonb;
  v_signed_cutoff bigint;
  v_updated jsonb;
  v_actor_team text;
begin
  if v_actor is null or p_lobby is null or p_offer is null or p_request is null
    or p_expected_revision is null or p_expected_revision<1
    or p_decision is null or p_decision not in ('accept','decline','cancel') then
    raise exception 'Invalid online trade response'; end if;
  select state,revision into v_state,v_revision from public.bm_online_franchise_runtime
    where lobby_id=p_lobby for update;
  if not found then raise exception 'Online league missing'; end if;
  select l.status,m.team_name into v_lobby_status,v_actor_team
    from public.bm_online_lobbies l join public.bm_online_lobby_members m
    on m.lobby_id=l.id and m.user_id=v_actor where l.id=p_lobby;
  if not found or v_lobby_status<>'started' then raise exception 'Online GM authorization failed'; end if;
  select * into v_offer from public.bm_online_trade_offers where id=p_offer and lobby_id=p_lobby for update;
  if not found then raise exception 'Trade offer does not exist'; end if;
  if p_decision='cancel' then
    if v_actor<>v_offer.proposer_id or v_actor_team<>v_offer.proposer_team then
      raise exception 'Only the offering GM can cancel'; end if;
  elsif v_actor<>v_offer.recipient_id or v_actor_team<>v_offer.recipient_team then
    raise exception 'Only the receiving GM can respond'; end if;
  -- A repeat accept uses the event journal to prove the same action was committed.
  select * into v_prior from public.bm_online_franchise_events
    where lobby_id=p_lobby and request_id=p_request;
  if found then
    if v_prior.actor_id<>v_actor or v_prior.action_type<>'human_trade_accepted'
       or v_prior.details->>'offer_id'<>p_offer::text or p_decision<>'accept' then
      raise exception 'Request ID reused for a different action'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'revision',v_prior.revision,'status','accepted');
  end if;
  if v_offer.status<>'pending' then
    if (p_decision='decline' and v_offer.status='declined')
       or (p_decision='cancel' and v_offer.status='cancelled') then
       return jsonb_build_object('ok',true,'replayed',true,'status',v_offer.status,'revision',v_revision);
    end if;
    raise exception 'This trade offer has already been resolved';
  end if;
  if p_decision<>'accept' then
    update public.bm_online_trade_offers set status=case when p_decision='decline' then 'declined' else 'cancelled' end,
      resolved_at=now() where id=p_offer;
    return jsonb_build_object('ok',true,'status',case when p_decision='decline' then 'declined' else 'cancelled' end,
      'revision',v_revision);
  end if;
  if v_revision<>p_expected_revision then raise exception 'Shared league changed. Refresh before accepting.'; end if;
  if not exists(select 1 from public.bm_online_lobby_members
    where lobby_id=p_lobby and user_id=v_offer.proposer_id and team_name=v_offer.proposer_team) then
    raise exception 'The offering GM no longer controls that team'; end if;
  -- G3A3_SIGNED_REVISION_CUTOFF: current NBA season only; old archived signings expire.
  v_signed_cutoff:=public.bm_online_human_trade_signing_cutoff_phase2e4g3a3(p_lobby,v_state,v_revision);
  -- Re-resolve every original asset against the *current locked* runtime.
  if exists (select 1 from public.bm_online_franchise_events e
    where e.lobby_id=p_lobby and e.revision>v_signed_cutoff
      and e.action_type in ('sign_cap_room_contract','sign_cap_room_free_agent')
      and e.details->>'player_id'=any(v_offer.proposer_player_ids||v_offer.recipient_player_ids)) then
    raise exception 'A recently signed player is not yet trade eligible'; end if;
  v_preview:=public.bm_online_prepare_human_asset_trade(v_state,v_offer.proposer_team,
    v_offer.recipient_team,v_offer.proposer_player_ids,v_offer.recipient_player_ids,
    v_offer.proposer_pick_ids,v_offer.recipient_pick_ids,p_offer);
  v_updated:=v_preview->'state';
  update public.bm_online_franchise_runtime set state=v_updated,revision=revision+1,updated_at=now()
    where lobby_id=p_lobby;
  insert into public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
    values(p_lobby,v_revision+1,p_request,v_actor,'human_trade_accepted',
      jsonb_build_object('offer_id',p_offer,'from_team',v_offer.proposer_team,
        'to_team',v_offer.recipient_team,'sending',to_jsonb(v_offer.proposer_player_ids),
        'receiving',to_jsonb(v_offer.recipient_player_ids),
        'sending_picks',to_jsonb(v_offer.proposer_pick_ids),'receiving_picks',to_jsonb(v_offer.recipient_pick_ids)));
  update public.bm_online_trade_offers set status='accepted',resolved_at=now(),resolved_revision=v_revision+1
    where id=p_offer;
  return jsonb_build_object('ok',true,'replayed',false,'status','accepted',
    'revision',v_revision+1,'trade_id',p_offer);
end $$;
REVOKE ALL ON FUNCTION public.bm_online_offer_human_trade(uuid,uuid,bigint,text,text[],text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bm_online_offer_human_trade(uuid,uuid,bigint,text,text[],text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.bm_online_offer_human_asset_trade(uuid,uuid,bigint,text,text[],text[],text[],text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bm_online_offer_human_asset_trade(uuid,uuid,bigint,text,text[],text[],text[],text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.bm_online_respond_human_trade(uuid,uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bm_online_respond_human_trade(uuid,uuid,uuid,bigint,text) TO authenticated;
COMMIT;
