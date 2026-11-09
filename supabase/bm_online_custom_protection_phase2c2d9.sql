-- Basketball Manager Online 2C.2D-9: custom Top-N protection splitting and existing-right transfers.
-- Apply MANUALLY after 2C.2D-3B and other trade migrations.
-- No new auth grant. Existing authenticated offer/response RPCs invoke this
-- private, security-definer helper with a locked runtime snapshot.
-- Limits: custom first-round Top-N split only; no swaps, rollover chains or CPU pick deals.
begin;

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
  v_range jsonb;
  v_start integer;
  v_end integer;
  v_low integer;
  v_high integer;
  v_peer jsonb;
  v_peer_range jsonb;
  v_peer_start integer;
  v_peer_end integer;
  v_owns_text text;
  v_match text[];
  v_was_protected boolean;
  v_peer_active integer;
  v_protection_label text;
  v_token text;
  v_top_n integer;
  v_base_ids_a text[];
  v_base_ids_b text[];
  v_retained jsonb;
  v_conveyed jsonb;
  v_generated_id_ret text;
  v_generated_id_con text;
  v_protection_base text;
  v_retained_range jsonb;
  v_conveyed_range jsonb;
  v_history jsonb;
begin
  if jsonb_typeof(v_old) is distinct from 'array' then
    raise exception 'Online draft rights ledger is unavailable'; end if;
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
  -- The offer stores exact tokens; only a terminal ~protect:N suffix is an
  -- online custom-protection command. Resolve all ID ownership from state,
  -- never from any client-supplied pick details.
  if exists(select 1 from unnest(p_ids_a||p_ids_b) as x
      where x like '%~protect:%' and x !~ '^.+~protect:([1-9]|1[0-9]|2[0-9])$') then
    raise exception 'Invalid custom protection command'; end if;
  v_base_ids_a:=array(select split_part(x,'~protect:',1) from unnest(p_ids_a) as x);
  v_base_ids_b:=array(select split_part(x,'~protect:',1) from unnest(p_ids_b) as x);
  if exists(select 1 from unnest(v_base_ids_a||v_base_ids_b) as x
      where x is null or length(btrim(x))=0 or length(x)>120)
    or (select count(distinct x) from unnest(v_base_ids_a||v_base_ids_b) as x)
       <>cardinality(v_base_ids_a)+cardinality(v_base_ids_b) then
    raise exception 'The same underlying draft right cannot be offered twice'; end if;
  -- Check ALL ledger rows and fail closed on ambiguous pick IDs before modifying anything.
  for v_id in select x from unnest(v_base_ids_a||v_base_ids_b) as x loop
    if (select count(*) from jsonb_array_elements(v_old) as pickrow(pick) where pickrow.pick->>'id'=v_id)<>1 then
      raise exception 'Draft pick no longer exists uniquely in this online league'; end if;
  end loop;
  for v_row in select value from jsonb_array_elements(v_old) loop
    v_id:=v_row->>'id';
    if v_id=any(v_base_ids_a) or v_id=any(v_base_ids_b) then
      v_from:=case when v_id=any(v_base_ids_a) then p_team_a else p_team_b end;
      v_to:=case when v_id=any(v_base_ids_a) then p_team_b else p_team_a end;
      select x into v_token from unnest(p_ids_a||p_ids_b) as x
        where split_part(x,'~protect:',1)=v_id limit 1;
      v_top_n:=case when v_token like '%~protect:%'
        then split_part(v_token,'~protect:',2)::integer else null end;
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
        nullif(v_row->'tradeRule','null'::jsonb) is not null or
        (v_row->>'resolvedPickNumber') is not null or
        (v_row->>'pickNumber') is not null or
        coalesce(v_row->>'protectionType','')='forfeiture' or
        v_row ? 'rolloverConditions' or v_row ? 'conditionalConveyance' or
        v_row ? 'futureConveyance' or v_row ? 'fallbackPick' or
        (v_row ? 'ownedPickRange' and v_row->'ownedSlots' is null and v_row->'ownedRange' is null) then
        raise exception 'Only unresolved, active, standalone draft rights can be transferred'; end if;
      -- Match the finished single-player getOwnedPickRange() precedence.
      -- A protected row can encode a conditional 1-30 right (Top-N protection),
      -- or an explicit numbered owned slice. Neither can be inferred from a
      -- browser-selected ownership claim: only the locked ledger is trusted.
      v_low:=case when v_round=1 then 1 else 31 end;
      v_high:=case when v_round=1 then 30 else 60 end;
      v_range:=coalesce(v_row->'ownedSlots',v_row->'ownedRange',
        v_row->'realLifeDetails'->'ownedSlots');
      if v_range is not null and jsonb_typeof(v_range)<>'object' then
        raise exception 'Malformed draft-right owned range'; end if;
      v_owns_text:=concat_ws(' | ',v_row->>'displayProtection',v_row->>'protections',
        v_row->>'protection',v_row->>'conditions',v_row->>'notes',
        v_row->'realLifeDetails'->>'playableDisplayRule');
      v_match:=regexp_match(v_owns_text,'Owns[[:space:]]*#?[[:space:]]*([0-9]{1,2})[[:space:]]*-[[:space:]]*#?[[:space:]]*([0-9]{1,2})','i');
      if v_range is not null then
        if coalesce(v_range->>'start',v_range->>'from',v_range->>'min',v_range->>'low','') !~ '^[0-9]{1,2}$'
          or coalesce(v_range->>'end',v_range->>'to',v_range->>'max',v_range->>'high','') !~ '^[0-9]{1,2}$' then
          raise exception 'Draft-right owned range is not numeric'; end if;
        v_start:=coalesce(v_range->>'start',v_range->>'from',v_range->>'min',v_range->>'low')::integer;
        v_end:=coalesce(v_range->>'end',v_range->>'to',v_range->>'max',v_range->>'high')::integer;
      elsif v_match is not null then
        v_start:=v_match[1]::integer;v_end:=v_match[2]::integer;
      else
        v_start:=v_low;v_end:=v_high;
      end if;
      if v_range is null and v_match is null and v_protection not in ('unprotected','none','null')
        and v_protection !~ '^top[[:space:]]+[0-9]{1,2}[[:space:]]+protected'
        and v_protection !~ '^lottery[[:space:]]+protected' then
        raise exception 'Unsupported conditional draft protection cannot be resolved safely'; end if;
      if v_start<v_low or v_end>v_high or v_start>v_end then
        raise exception 'Draft-right range extends outside its round'; end if;
      -- Any legacy conditional chain that cannot be represented by one
      -- existing ledger row is deliberately locked for future migration.
      if v_row->'realLifeDetails' ? 'conveyance' or
        v_row->'realLifeDetails' ? 'rollover' or
        v_row->'realLifeDetails' ? 'fallback' then
        raise exception 'Linked future conveyance needs rights reconciliation'; end if;
      v_peer_active:=0;
      for v_peer in select value from jsonb_array_elements(v_old) loop
        if v_peer->>'year'=v_year::text and v_peer->>'round'=v_round::text
           and coalesce(v_peer->>'originalTeam',v_peer->>'originalTeamName')=v_original
           and lower(coalesce(v_peer->>'status','active'))='active'
           and lower(coalesce(v_peer->>'assetType',v_peer->>'type','pick'))='pick' then
          v_peer_active:=v_peer_active+1;
          if coalesce(v_peer->>'id','')=v_id then continue; end if;
          -- Multiple slices are legal only if every slice has an EXPLICIT,
          -- non-overlapping ownership range. Never assume a missing range.
          v_peer_range:=coalesce(v_peer->'ownedSlots',v_peer->'ownedRange',
            v_peer->'realLifeDetails'->'ownedSlots');
          if v_peer_range is null or jsonb_typeof(v_peer_range)<>'object' then
            raise exception 'Other draft-right slice has ambiguous ownership'; end if;
          if coalesce(v_peer_range->>'start',v_peer_range->>'from',v_peer_range->>'min',v_peer_range->>'low','') !~ '^[0-9]{1,2}$'
             or coalesce(v_peer_range->>'end',v_peer_range->>'to',v_peer_range->>'max',v_peer_range->>'high','') !~ '^[0-9]{1,2}$' then
            raise exception 'Other draft-right slice has invalid range'; end if;
          v_peer_start:=coalesce(v_peer_range->>'start',v_peer_range->>'from',v_peer_range->>'min',v_peer_range->>'low')::integer;
          v_peer_end:=coalesce(v_peer_range->>'end',v_peer_range->>'to',v_peer_range->>'max',v_peer_range->>'high')::integer;
          if v_peer_start<v_low or v_peer_end>v_high or v_peer_start>v_peer_end
            or (v_start<=v_peer_end and v_peer_start<=v_end) then
            raise exception 'Draft-right slices overlap or are invalid'; end if;
        end if;
      end loop;
      if v_peer_active>1 and v_range is null then
        raise exception 'Split draft-right transfer must have an explicit owned range'; end if;
      -- All swap participants in the same year/round/original-pick lineage
      -- must be excluded. Protect existing single-player swap chains.
      for v_swap in select value from jsonb_array_elements(v_old) loop
        if lower(coalesce(v_swap->>'status','active'))='active' and
          lower(coalesce(v_swap->>'assetType',v_swap->>'type','pick'))='swap' and
          (v_swap->>'year')=v_year::text and (v_swap->>'round')=v_round::text then
          v_swap_team:=coalesce(v_swap->>'swapWithTeam',v_swap->>'swapTeam',v_swap->'swap'->>'withTeam','');
          if v_original=any(array[coalesce(v_swap->>'originalTeam',''),v_swap_team])
            or exists(select 1 from jsonb_array_elements_text(
                 case when jsonb_typeof(v_swap->'realLifeDetails'->'swapParticipants')='array'
                      then v_swap->'realLifeDetails'->'swapParticipants' else '[]'::jsonb end
                ) as sp(name) where sp.name=v_original) then
            raise exception 'Draft pick is encumbered by an active swap right'; end if;
        end if;
      end loop;
      -- Preserve the single-player protected split: the original GM owns 1..N,
      -- and the receiving GM owns N+1..30. Both rights MUST replace the direct
      -- original pick atomically; leaving it in the ledger duplicates ownership.
      if v_top_n is not null then
        if v_round<>1 or v_protection not in ('unprotected','none','null')
          or v_peer_active<>1 or v_start<>1 or v_end<>30 or v_range is not null
          or v_match is not null or v_top_n not between 1 and 29
          or v_row ? 'swapWithTeam' or v_row ? 'swapId'
          or coalesce(v_row->>'logicType','') in ('trade_machine_swap','trade_machine_protected_split') then
          raise exception 'Custom Top-N protections require one full, active, unprotected first-round right'; end if;
        -- Even a future pick already tied to a complicated conditional chain
        -- cannot be split. All other lineage/swap checks above still apply.
        v_protection_base:='Top '||v_top_n::text||' Protected';
        v_retained_range:=jsonb_build_object('start',1,'end',v_top_n);
        v_conveyed_range:=jsonb_build_object('start',v_top_n+1,'end',30);
        v_generated_id_ret:='onp:'||replace(p_trade_id::text,'-','')||':'||substr(md5(v_id||'|'||v_from),1,12)||':r';
        v_generated_id_con:='onp:'||replace(p_trade_id::text,'-','')||':'||substr(md5(v_id||'|'||v_from),1,12)||':c';
        if exists(select 1 from jsonb_array_elements(v_old) as x
          where x->>'id' in (v_generated_id_ret,v_generated_id_con)) then
          raise exception 'Generated draft-right identifiers already exist'; end if;
        v_record:=jsonb_build_object('tradeId',p_trade_id::text,'fromTeam',v_from,'toTeam',v_to,
          'action','protected_split','seasonYear',2026,'originalPickId',v_id,
          'protection',v_protection_base,'retainedRange',v_retained_range,'conveyedRange',v_conveyed_range);
        v_history:=(case when jsonb_typeof(v_row->'tradeHistory')='array' then v_row->'tradeHistory' else '[]'::jsonb end)
          ||jsonb_build_array(v_record);
        v_retained:=v_row||jsonb_build_object('id',v_generated_id_ret,'assetType','pick','type','pick',
          'ownerTeam',v_from,'owner',v_from,'currentOwner',v_from,'currentOwnerTeamName',v_from,
          'ownerTeamName',v_from,'teamName',v_from,'ownedSlots',v_retained_range,'ownedRange',v_retained_range,
          'protection',v_protection_base,'protections',v_protection_base,
          'displayProtection',v_protection_base||' (Owns 1-'||v_top_n::text||')',
          'protectionType','protected_range','logicType','trade_machine_protected_split',
          'tradeHistory',v_history,'lastTrade',v_record);
        v_conveyed:=v_row||jsonb_build_object('id',v_generated_id_con,'assetType','pick','type','pick',
          'ownerTeam',v_to,'owner',v_to,'currentOwner',v_to,'currentOwnerTeamName',v_to,
          'ownerTeamName',v_to,'teamName',v_to,'ownedSlots',v_conveyed_range,'ownedRange',v_conveyed_range,
          'protection',v_protection_base,'protections',v_protection_base,
          'displayProtection',v_protection_base||' (Owns '||(v_top_n+1)::text||'-30)',
          'protectionType','protected_range','logicType','trade_machine_protected_split',
          'tradeHistory',v_history,'lastTrade',v_record);
        v_next:=v_next||jsonb_build_array(v_retained,v_conveyed);
        v_name:=v_year::text||' 1st ('||v_original||') · '||v_protection_base
          ||' ['||(v_top_n+1)::text||'-30]';
        v_protection_label:=v_protection_base;
        v_item:=jsonb_build_object('type','pick','label',v_name,'pickId',v_id,'teamName',v_from,
          'year',v_year,'round',1,'originalTeam',v_original,'ownerTeam',v_from,'protection',v_protection_base,
          'ownedRange',v_conveyed_range,'action','protected_split');
      else
        -- Existing unprotected or protected-right transfers are unchanged.
        v_record:=jsonb_build_object('tradeId',p_trade_id::text,'fromTeam',v_from,
          'toTeam',v_to,'action','online_pick_transfer','seasonYear',2026);
        v_row:=v_row||jsonb_build_object('ownerTeam',v_to,'owner',v_to,'currentOwner',v_to,
          'currentOwnerTeamName',v_to,'ownerTeamName',v_to,'teamName',v_to,'lastTrade',v_record);
        v_row:=jsonb_set(v_row,'{tradeHistory}',
          (case when jsonb_typeof(v_row->'tradeHistory')='array' then v_row->'tradeHistory' else '[]'::jsonb end)||jsonb_build_array(v_record),true);
        v_was_protected:=v_protection not in ('unprotected','none','null');
        v_protection_label:=coalesce(nullif(v_row->>'displayProtection',''),nullif(v_row->>'protections',''),
           nullif(v_row->>'protection',''),'Unprotected');
        v_name:=v_year::text||' '||(case when v_round=1 then '1st' else '2nd' end)||' ('||v_original||')'
          ||(case when v_was_protected or v_start<>v_low or v_end<>v_high
            then ' · '||v_protection_label||' ['||v_start::text||'-'||v_end::text||']' else '' end);
        v_item:=jsonb_build_object('type','pick','label',v_name,'pickId',v_id,'teamName',v_from,
          'year',v_year,'round',v_round,'originalTeam',v_original,'ownerTeam',v_from,'protection',v_protection_label,
          'ownedRange',jsonb_build_object('start',v_start,'end',v_end));
      end if;
      if v_from=p_team_a then v_names_a:=v_names_a||jsonb_build_array(v_name);
        v_details_a:=v_details_a||jsonb_build_array(v_item);
      else v_names_b:=v_names_b||jsonb_build_array(v_name);
        v_details_b:=v_details_b||jsonb_build_array(v_item); end if;
      v_moves:=v_moves||jsonb_build_array(jsonb_build_object('pickId',v_id,
        'fromTeam',v_from,'toTeam',v_to,'year',v_year,'round',v_round,'originalTeam',v_original,
        'action',case when v_top_n is null then 'online_pick_transfer' else 'protected_split' end,
        'retainedId',case when v_top_n is not null then v_generated_id_ret else null end,
        'conveyedId',case when v_top_n is not null then v_generated_id_con else null end));
    end if;
    if v_top_n is null then v_next:=v_next||jsonb_build_array(v_row); end if;
    v_top_n:=null;
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
        case when v_target=p_team_a then v_base_ids_a else v_base_ids_b end)
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

-- Keep helper private; offers/responses use their pre-existing grants.
revoke all on function public.bm_online_prepare_human_pick_trade(jsonb,text,text,text[],text[],uuid)
  from public,anon,authenticated;
commit;
