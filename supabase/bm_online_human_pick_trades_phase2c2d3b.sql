-- Online phase 2C.2D-3B: human GM draft-pick packages + atomic player/pick transactions.
-- SQL runs MANUALLY after human trades and salary parity migrations.
-- Mirrors existing single-player draftPicks ledger; preserves original rights provenance.
-- Conservative subset: active, full-range, unprotected, unswapped future assets.
-- No CPU trades, swaps, protections modifications, resolved picks or pick-only deals.
begin;

alter table public.bm_online_trade_offers
  add column if not exists proposer_pick_ids text[] not null default '{}',
  add column if not exists recipient_pick_ids text[] not null default '{}',
  add column if not exists proposer_pick_labels text[] not null default '{}',
  add column if not exists recipient_pick_labels text[] not null default '{}';

-- Return updated state plus ordered pick labels/detail. Client supplies ONLY IDs;
-- full pick records and ownership are resolved from locked runtime state.
create or replace function public.bm_online_prepare_human_pick_trade(
  p_state jsonb,p_team_a text,p_team_b text,p_ids_a text[],p_ids_b text[],p_trade_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_old jsonb := p_state->'draftPicks';
  v_next jsonb := '[]'::jsonb;
  v_row jsonb;
  v_item jsonb;
  v_type text;
  v_from text;
  v_to text;
  v_original text;
  v_id text;
  v_year integer;
  v_round integer;
  v_protection text;
  v_key text;
  v_record jsonb;
  v_swap jsonb;
  v_swap_team text;
  v_names_a jsonb := '[]'::jsonb;
  v_names_b jsonb := '[]'::jsonb;
  v_details_a jsonb := '[]'::jsonb;
  v_details_b jsonb := '[]'::jsonb;
  v_moves jsonb := '[]'::jsonb;
  v_name text;
  v_before_first boolean;
  v_before_next boolean;
  v_after_first boolean;
  v_after_next boolean;
  v_max_first integer;
  v_year_scan integer;
  v_owner text;
  v_target text;
begin
  if p_ids_a is null or p_ids_b is null or cardinality(p_ids_a)>3 or cardinality(p_ids_b)>3 then
    raise exception 'Select zero to three draft assets per team'; end if;
  if cardinality(p_ids_a)+cardinality(p_ids_b)=0 then
    return jsonb_build_object('state',p_state,'labels_a',v_names_a,'labels_b',v_names_b,
      'details_a',v_details_a,'details_b',v_details_b,'moves',v_moves); end if;
  if jsonb_typeof(v_old)<>'array' then raise exception 'Online draft ownership ledger is missing'; end if;
  if jsonb_typeof(p_state->'draftState'->'draftPicks')='array' and jsonb_array_length(p_state->'draftState'->'draftPicks')>0 then
    raise exception 'Multiple draft ownership ledgers need reconciliation before online pick trades'; end if;
  if exists(select 1 from unnest(p_ids_a||p_ids_b) as x where x is null or length(btrim(x))<1 or length(x)>120) or
    (select count(distinct x) from unnest(p_ids_a||p_ids_b) as x) <> cardinality(p_ids_a)+cardinality(p_ids_b) then
    raise exception 'Duplicate or invalid draft-pick identifier'; end if;
  -- Check ALL ledger rows and fail closed on ambiguous pick IDs before modifying anything.
  for v_id in select x from unnest(p_ids_a||p_ids_b) as x loop
    if (select count(*) from jsonb_array_elements(v_old) as pickrow(pick) where pickrow.pick->>'id'=v_id)<>1 then
      raise exception 'Draft pick no longer exists uniquely in this online league'; end if;
  end loop;
  for v_row in select value from jsonb_array_elements(v_old) loop
    v_id:=v_row->>'id';
    if v_id=any(p_ids_a) or v_id=any(p_ids_b) then
      v_from:=case when v_id=any(p_ids_a) then p_team_a else p_team_b end;
      v_to:=case when v_id=any(p_ids_a) then p_team_b else p_team_a end;
      v_owner:=coalesce(v_row->>'ownerTeam',v_row->>'currentOwnerTeamName',v_row->>'owner');
      if v_owner is distinct from v_from or
        (v_row ? 'owner' and v_row->>'owner' is distinct from v_from) or
        (v_row ? 'currentOwnerTeamName' and v_row->>'currentOwnerTeamName' is distinct from v_from) then
        raise exception 'GM does not currently own the requested draft pick'; end if;
      v_type:=lower(coalesce(v_row->>'assetType',v_row->>'type','pick'));
      v_protection:=lower(btrim(coalesce(nullif(v_row->>'protections',''),nullif(v_row->>'protection',''),nullif(v_row->>'displayProtection',''),'unprotected')));
      v_year:=case when (v_row->>'year')~'^20[0-9][0-9]$' then (v_row->>'year')::integer else 0 end;
      v_round:=case when (v_row->>'round')~'^[12]$' then (v_row->>'round')::integer else 0 end;
      v_original:=coalesce(v_row->>'originalTeam',v_row->>'originalTeamName');
      if v_type<>'pick' or lower(coalesce(v_row->>'status','active'))<>'active' or
        v_year not between 2027 and 2033 or v_round not in (1,2) or nullif(v_original,'') is null or
        v_protection not in ('unprotected','none','null') or
        nullif(v_row->'tradeRule','null'::jsonb) is not null or
        nullif(v_row->'ownedRange','null'::jsonb) is not null or
        nullif(v_row->'ownedPickRange','null'::jsonb) is not null or (v_row->>'resolvedPickNumber') is not null then
        raise exception 'Only active, unprotected, unswapped future picks can be included'; end if;
      -- If a natural pick is represented by multiple active slices, never
      -- transfer just one slice as though it were an entire NBA draft asset.
      if (select count(*) from jsonb_array_elements(v_old) as ap(pick) where
        ap.pick->>'year'=v_year::text and ap.pick->>'round'=v_round::text
        and coalesce(ap.pick->>'originalTeam',ap.pick->>'originalTeamName')=v_original
        and lower(coalesce(ap.pick->>'status','active'))='active'
        and lower(coalesce(ap.pick->>'assetType',ap.pick->>'type','pick'))='pick')<>1 then
        raise exception 'Draft pick has ambiguous ownership slices'; end if;
      -- All swap participants in the same year/round/original-pick lineage
      -- must be excluded. Protect existing single-player swap chains.
      for v_swap in select value from jsonb_array_elements(v_old) loop
        if lower(coalesce(v_swap->>'status','active'))='active' and
          lower(coalesce(v_swap->>'assetType',v_swap->>'type','pick'))='swap' and
          (v_swap->>'year')=v_year::text and (v_swap->>'round')=v_round::text then
          v_swap_team:=coalesce(v_swap->>'swapWithTeam',v_swap->>'swapTeam',v_swap->'swap'->>'withTeam','');
          if v_original=any(array[coalesce(v_swap->>'originalTeam',''),v_swap_team]) then
            raise exception 'Draft pick is encumbered by an active swap right'; end if;
        end if;
      end loop;
      -- Preserve single-player natural pick lineage and metadata. Only change owner aliases.
      v_record:=jsonb_build_object('tradeId',p_trade_id::text,'fromTeam',v_from,
        'toTeam',v_to,'action','online_pick_transfer','seasonYear',2026);
      v_row:=v_row||jsonb_build_object('ownerTeam',v_to,'owner',v_to,'currentOwner',v_to,
        'currentOwnerTeamName',v_to,'ownerTeamName',v_to,'lastTrade',v_record);
      v_row:=jsonb_set(v_row,'{tradeHistory}',
        (case when jsonb_typeof(v_row->'tradeHistory')='array' then v_row->'tradeHistory' else '[]'::jsonb end)||jsonb_build_array(v_record),true);
      v_name:=v_year::text||' '||(case when v_round=1 then '1st' else '2nd' end)||' ('||v_original||')';
      v_item:=jsonb_build_object('type','pick','label',v_name,'pickId',v_id,'teamName',v_from,
        'year',v_year,'round',v_round,'originalTeam',v_original,'ownerTeam',v_from,'protection','Unprotected');
      if v_from=p_team_a then v_names_a:=v_names_a||jsonb_build_array(v_name);
        v_details_a:=v_details_a||jsonb_build_array(v_item);
      else v_names_b:=v_names_b||jsonb_build_array(v_name);
        v_details_b:=v_details_b||jsonb_build_array(v_item); end if;
      v_moves:=v_moves||jsonb_build_array(jsonb_build_object('pickId',v_id,
        'fromTeam',v_from,'toTeam',v_to,'year',v_year,'round',v_round,'originalTeam',v_original));
    end if;
    v_next:=v_next||jsonb_build_array(v_row);
  end loop;
  -- Conservative Stepien guard: reject any NEW consecutive missing guaranteed
  -- first-round picks. Existing deficits remain grandfathered (no worsening).
  -- For now, reject a team's furthest owned future unprotected 1st regardless
  -- of apron to avoid releasing picks restricted by second-apron rules.
  for v_target in select unnest(array[p_team_a,p_team_b]) loop
    select max((pickrow.pick->>'year')::integer) into v_max_first from jsonb_array_elements(v_old) as pickrow(pick)
      where pickrow.pick->>'ownerTeam'=v_target and coalesce(pickrow.pick->>'assetType','pick')='pick'
        and pickrow.pick->>'round'='1' and lower(coalesce(pickrow.pick->>'status','active'))='active'
        and (pickrow.pick->>'year') ~ '^20[0-9][0-9]$' and (pickrow.pick->>'year')::integer between 2027 and 2033
        and lower(coalesce(pickrow.pick->>'protections','unprotected')) in ('unprotected','none','null');
    if exists(select 1 from jsonb_array_elements(v_old) as pickrow(pick)
      where pickrow.pick->>'ownerTeam'=v_target and pickrow.pick->>'id'=any(
        case when v_target=p_team_a then p_ids_a else p_ids_b end)
        and pickrow.pick->>'round'='1' and pickrow.pick->>'year'=v_max_first::text) then
      raise exception 'Furthest future unprotected first is locked for online safety'; end if;
    for v_year_scan in 2027..2032 loop
      select exists(select 1 from jsonb_array_elements(v_old) as pickrow(pick) where
        pickrow.pick->>'ownerTeam'=v_target and pickrow.pick->>'round'='1' and pickrow.pick->>'year'=v_year_scan::text
        and lower(coalesce(pickrow.pick->>'status','active'))='active'
        and lower(coalesce(pickrow.pick->>'protections','unprotected')) in ('unprotected','none','null')) into v_before_first;
      select exists(select 1 from jsonb_array_elements(v_old) as pickrow(pick) where
        pickrow.pick->>'ownerTeam'=v_target and pickrow.pick->>'round'='1' and pickrow.pick->>'year'=(v_year_scan+1)::text
        and lower(coalesce(pickrow.pick->>'status','active'))='active'
        and lower(coalesce(pickrow.pick->>'protections','unprotected')) in ('unprotected','none','null')) into v_before_next;
      select exists(select 1 from jsonb_array_elements(v_next) as pickrow(pick) where
        pickrow.pick->>'ownerTeam'=v_target and pickrow.pick->>'round'='1' and pickrow.pick->>'year'=v_year_scan::text
        and lower(coalesce(pickrow.pick->>'status','active'))='active'
        and lower(coalesce(pickrow.pick->>'protections','unprotected')) in ('unprotected','none','null')) into v_after_first;
      select exists(select 1 from jsonb_array_elements(v_next) as pickrow(pick) where
        pickrow.pick->>'ownerTeam'=v_target and pickrow.pick->>'round'='1' and pickrow.pick->>'year'=(v_year_scan+1)::text
        and lower(coalesce(pickrow.pick->>'status','active'))='active'
        and lower(coalesce(pickrow.pick->>'protections','unprotected')) in ('unprotected','none','null')) into v_after_next;
      if (v_before_first or v_before_next) and not (v_after_first or v_after_next) then
        raise exception 'Trade creates a new Stepien consecutive-first-round violation'; end if;
    end loop;
  end loop;
  return jsonb_build_object('state',jsonb_set(p_state,'{draftPicks}',v_next,false),
    'labels_a',v_names_a,'labels_b',v_names_b,'details_a',v_details_a,'details_b',v_details_b,'moves',v_moves);
end $$;
revoke all on function public.bm_online_prepare_human_pick_trade(jsonb,text,text,text[],text[],uuid)
  from public,anon,authenticated;

-- Wrapper around the EXISTING salary-validated player-trade constructor.
-- Keeps both asset classes in one atomic shared-state revision and history record.
create or replace function public.bm_online_prepare_human_asset_trade(
  p_state jsonb,p_team_a text,p_team_b text,p_ids_a text[],p_ids_b text[],
  p_pick_ids_a text[],p_pick_ids_b text[],p_trade_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_players jsonb;
  v_picks jsonb;
  v_state jsonb;
  v_history jsonb;
  v_record jsonb;
  v_idx integer;
begin
  v_players:=public.bm_online_prepare_human_player_trade(p_state,p_team_a,p_team_b,p_ids_a,p_ids_b,p_trade_id);
  v_picks:=public.bm_online_prepare_human_pick_trade(v_players->'state',p_team_a,p_team_b,p_pick_ids_a,p_pick_ids_b,p_trade_id);
  v_state:=v_picks->'state';
  v_record:=v_players->'record';
  v_record:=jsonb_set(v_record,'{userSent,picks}',v_picks->'labels_a',true);
  v_record:=jsonb_set(v_record,'{cpuSent,picks}',v_picks->'labels_b',true);
  v_record:=jsonb_set(v_record,'{movedPicks}',v_picks->'moves',true);
  v_record:=jsonb_set(v_record,'{userSentAssets}',(v_record->'userSentAssets')||(v_picks->'details_a'),true);
  v_record:=jsonb_set(v_record,'{cpuSentAssets}',(v_record->'cpuSentAssets')||(v_picks->'details_b'),true);
  v_record:=jsonb_set(v_record,'{teamPackages,0,sent}',
    (v_record#>'{teamPackages,0,sent}')||(v_picks->'details_a'),false);
  v_record:=jsonb_set(v_record,'{teamPackages,0,received}',
    (v_record#>'{teamPackages,0,received}')||(v_picks->'details_b'),false);
  v_record:=jsonb_set(v_record,'{teamPackages,1,sent}',
    (v_record#>'{teamPackages,1,sent}')||(v_picks->'details_b'),false);
  v_record:=jsonb_set(v_record,'{teamPackages,1,received}',
    (v_record#>'{teamPackages,1,received}')||(v_picks->'details_a'),false);
  v_history:=v_state->'tradeHistory';
  v_idx:=jsonb_array_length(v_history)-1;
  v_history:=jsonb_set(v_history,array[v_idx::text],v_record,false);
  v_state:=jsonb_set(v_state,'{tradeHistory}',v_history,false);
  v_state:=jsonb_set(v_state,'{lastTrade}',v_record,true);
  return jsonb_build_object('state',v_state,'record',v_record);
end $$;
revoke all on function public.bm_online_prepare_human_asset_trade(jsonb,text,text,text[],text[],text[],text[],uuid)
  from public,anon,authenticated;

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
  -- A just-signed online free agent is locked until the Online calendar can
  -- establish the usual signing cooldown. Never allow immediate flips.
  if exists (select 1 from public.bm_online_franchise_events e
    where e.lobby_id=p_lobby and e.action_type in ('sign_cap_room_contract','sign_cap_room_free_agent')
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
revoke all on function public.bm_online_offer_human_asset_trade(uuid,uuid,bigint,text,text[],text[],text[],text[]) from public,anon,authenticated;
grant execute on function public.bm_online_offer_human_asset_trade(uuid,uuid,bigint,text,text[],text[],text[],text[]) to authenticated;


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
  -- Re-resolve every original asset against the *current locked* runtime.
  if exists (select 1 from public.bm_online_franchise_events e
    where e.lobby_id=p_lobby and e.action_type in ('sign_cap_room_contract','sign_cap_room_free_agent')
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
revoke all on function public.bm_online_respond_human_trade(uuid,uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.bm_online_respond_human_trade(uuid,uuid,uuid,bigint,text) to authenticated;

commit;
