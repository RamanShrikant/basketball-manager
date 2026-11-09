-- Phase 2C.2D-6: private, atomic CPU player-trade commit.
-- The browser cannot execute this RPC. ONLY the trusted backend evaluates
-- the original single-player Python trade brain, then calls as service_role.
-- Dependencies: runtime, full human asset-trade + salary-parity migrations.
begin;

create or replace function public.bm_online_commit_cpu_player_trade(
  p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,
  p_target_team text,p_sending_ids text[],p_receiving_ids text[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_state jsonb;
  v_revision bigint;
  v_mine text;
  v_status text;
  v_prior public.bm_online_franchise_events%rowtype;
  v_result jsonb;
  v_updated jsonb;
  v_record jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Private CPU trade execution only';
  end if;
  if p_actor is null or p_lobby is null or p_request is null or p_expected_revision<1 or
     p_target_team is null or p_target_team='' or length(p_target_team)>90 or
     p_sending_ids is null or p_receiving_ids is null or
     cardinality(p_sending_ids) not between 1 and 4 or cardinality(p_receiving_ids) not between 1 and 4 then
    raise exception 'Malformed CPU trade';
  end if;
  select r.state,r.revision into v_state,v_revision
    from public.bm_online_franchise_runtime r where r.lobby_id=p_lobby for update;
  if not found then raise exception 'Shared franchise runtime missing'; end if;
  select l.status,m.team_name into v_status,v_mine
    from public.bm_online_lobbies l
    join public.bm_online_lobby_members m on m.lobby_id=l.id and m.user_id=p_actor
    where l.id=p_lobby;
  if not found or v_status<>'started' or nullif(v_mine,'') is null then
    raise exception 'CPU trade actor is not a member of started league'; end if;
  if v_mine=p_target_team then raise exception 'Cannot trade with own team'; end if;
  if exists (select 1 from public.bm_online_lobby_members m
    where m.lobby_id=p_lobby and m.team_name=p_target_team) then
    raise exception 'Target team is controlled by human GM'; end if;
  select * into v_prior from public.bm_online_franchise_events
    where lobby_id=p_lobby and request_id=p_request;
  if found then
    if v_prior.actor_id<>p_actor or v_prior.action_type<>'cpu_trade_accepted' or
       v_prior.details->>'from_team'<>v_mine or v_prior.details->>'to_team'<>p_target_team or
       v_prior.details->'sending' is distinct from to_jsonb(p_sending_ids) or
       v_prior.details->'receiving' is distinct from to_jsonb(p_receiving_ids) then
      raise exception 'Request ID reused for different transaction'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'revision',v_prior.revision);
  end if;
  if v_revision is distinct from p_expected_revision then
    raise exception 'League revision changed during negotiation'; end if;
  -- Enforce eligibility, ownership, roster, salary matching, apron rules,
  -- active season & deadlines against the locked authoritative snapshot.
  if exists (select 1 from public.bm_online_franchise_events e
    where e.lobby_id=p_lobby and e.action_type in ('sign_cap_room_contract','sign_cap_room_free_agent')
    and e.details->>'player_id'=any(p_sending_ids||p_receiving_ids)) then
    raise exception 'Recently signed player is not yet eligible for trade'; end if;
  v_result:=public.bm_online_prepare_human_asset_trade(
    v_state,v_mine,p_target_team,p_sending_ids,p_receiving_ids,
    array[]::text[],array[]::text[],p_request
  );
  v_updated:=v_result->'state';
  v_record:=v_result->'record';
  -- Distinguish human-vs-CPU history without discarding the proven structure.
  v_record:=v_record||jsonb_build_object('onlineCpuTrade',true,
    'source','online_cpu_trade','tradeType','human_cpu_trade',
    'cpuDecision','accept','origin','trusted_cpu_trade',
    'reasoning',jsonb_build_object(v_mine,'Server-authorized trade submitted',p_target_team,'CPU evaluator accepted'));
  v_updated:=jsonb_set(v_updated,'{lastTrade}',v_record,true);
  if jsonb_typeof(v_updated->'tradeHistory')='array' and jsonb_array_length(v_updated->'tradeHistory')>0 then
    v_updated:=jsonb_set(v_updated,array['tradeHistory',(jsonb_array_length(v_updated->'tradeHistory')-1)::text],v_record,false);
  end if;
  update public.bm_online_franchise_runtime
    set state=v_updated,revision=revision+1,updated_at=now() where lobby_id=p_lobby;
  insert into public.bm_online_franchise_events
    (lobby_id,revision,request_id,actor_id,action_type,details)
    values (p_lobby,v_revision+1,p_request,p_actor,'cpu_trade_accepted',
      jsonb_build_object('from_team',v_mine,'to_team',p_target_team,
        'sending',to_jsonb(p_sending_ids),'receiving',to_jsonb(p_receiving_ids)));
  return jsonb_build_object('ok',true,'replayed',false,'revision',v_revision+1);
end $$;
revoke all on function public.bm_online_commit_cpu_player_trade(uuid,uuid,uuid,bigint,text,text[],text[]) from public,anon,authenticated;
grant execute on function public.bm_online_commit_cpu_player_trade(uuid,uuid,uuid,bigint,text,text[],text[]) to service_role;
commit;
