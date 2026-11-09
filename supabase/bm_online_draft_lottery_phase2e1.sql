-- Basketball Manager Online 2E.1 — trusted immutable NBA draft lottery.
-- Manual deployment only, after the Online 2D.3-B postseason migration.
-- Lottery order is NOT final draft ownership. Traded protections/swaps are
-- deliberately not settled here; the draft cannot start until that step exists.
begin;
create or replace function public.bm_online_draw_draft_lottery_phase2e1(
  p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,p_lottery jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_state jsonb;v_rev bigint;v_host uuid;v_status text;v_prior public.bm_online_franchise_events%rowtype;
 v_post jsonb;v_season int;v_draft int;v_system text;v_names text[];v_first jsonb;v_second jsonb;v_full jsonb;
 v_round jsonb;v_pick jsonb;v_pick_index int;v_owner text;v_seen text[];v_expected_count int;
begin
 if p_lobby is null or p_actor is null or p_request is null or p_expected_revision<1 or
    pg_catalog.jsonb_typeof(p_lottery)<>'object' or pg_catalog.octet_length(p_lottery::text)>2500000
 then raise exception 'Invalid shared draft lottery request';end if;

 select r.state,r.revision into v_state,v_rev from public.bm_online_franchise_runtime r
   where r.lobby_id=p_lobby for update;
 if not found then raise exception 'The online league does not exist';end if;
 select l.host_id,l.status into v_host,v_status from public.bm_online_lobbies l where l.id=p_lobby;
 if v_host is distinct from p_actor or v_status is distinct from 'started' or not exists(
   select 1 from public.bm_online_lobby_members m where m.lobby_id=p_lobby and m.user_id=p_actor)
 then raise exception 'Only the host may draw the online lottery';end if;
 select * into v_prior from public.bm_online_franchise_events e
   where e.lobby_id=p_lobby and e.request_id=p_request;
 if found then
   if v_prior.actor_id is distinct from p_actor or v_prior.action_type is distinct from 'draft_lottery_drawn'
     then raise exception 'Request ID already belongs to a different operation';end if;
   return pg_catalog.jsonb_build_object('ok',true,'replayed',true,'revision',v_prior.revision,
     'draftYear',v_prior.details->'draftYear');
 end if;
 if v_rev<>p_expected_revision then raise exception 'Shared league changed; refresh and retry';end if;
 if v_state ? 'onlineDraftLottery' or v_state#>>'{draftState,draftLotteryComplete}'='true'
   then raise exception 'The draft lottery was already drawn';end if;
 v_post:=v_state->'onlinePostseason';
 if pg_catalog.jsonb_typeof(v_post)<>'object' or v_post->>'phase'<>'postseasonComplete' or
    pg_catalog.length(coalesce(v_post->>'champion',''))=0 or
    v_state#>>'{onlineSchedule,phase}' is distinct from 'postseason'
 then raise exception 'The NBA Finals must finish before the draft lottery';end if;
 v_season:=(v_post->>'seasonYear')::int;
 if v_season<2025 or v_season>2094 or
    (v_state#>>'{onlineSchedule,seasonYear}')::int is distinct from v_season
 then raise exception 'The completed postseason year is inconsistent';end if;
 v_draft:=v_season+1;
 v_system:=case when v_draft>=2027 then 'three_two_one' else 'legacy_14' end;
 if (p_lottery->>'seasonYear')::int is distinct from v_season or
    (p_lottery->>'draftYear')::int is distinct from v_draft or
    p_lottery->>'system' is distinct from v_system or
    p_lottery->>'stage' is distinct from 'orderDrawn' or
    p_lottery->>'rightsSettlement' is distinct from 'pending' or
    p_lottery#>>'{result,meta,system}' is distinct from v_system or
    p_lottery#>>'{result,ok}' is distinct from 'true' or
    (p_lottery#>>'{result,seasonYear}')::int is distinct from v_draft
 then raise exception 'Draft engine result does not match the completed season';end if;
 if pg_catalog.jsonb_typeof(v_post->'regularSeasonSnapshot')<>'array' or
    pg_catalog.jsonb_array_length(v_post->'regularSeasonSnapshot')<>30
 then raise exception 'Frozen NBA standings are incomplete';end if;
 select array_agg(r->>'teamName') into v_names from
   pg_catalog.jsonb_array_elements(v_post->'regularSeasonSnapshot') r;
 if pg_catalog.array_length(v_names,1)<>30 or
    (select count(distinct n) from pg_catalog.unnest(v_names) as n)<>30 or
    not (v_post->>'champion'=any(v_names))
 then raise exception 'Frozen standings contain duplicate or missing franchises';end if;
 v_first:=p_lottery#>'{result,firstRoundOrder}';
 v_second:=p_lottery#>'{result,secondRoundOrder}';
 v_full:=p_lottery#>'{result,fullDraftOrder}';
 if pg_catalog.jsonb_typeof(v_first)<>'array' or pg_catalog.jsonb_typeof(v_second)<>'array' or
    pg_catalog.jsonb_typeof(v_full)<>'array' or
    pg_catalog.jsonb_array_length(v_first)<>30 or pg_catalog.jsonb_array_length(v_second)<>30 or
    pg_catalog.jsonb_array_length(v_full)<>60 or
    pg_catalog.jsonb_typeof(p_lottery#>'{result,lotteryTeams}')<>'array' or
    pg_catalog.jsonb_array_length(p_lottery#>'{result,lotteryTeams}')<>
        (case when v_system='three_two_one' then 16 else 14 end)
 then raise exception 'Original Python lottery result has invalid pick counts';end if;
 for v_round in select value from pg_catalog.jsonb_array_elements(
    pg_catalog.jsonb_build_array(v_first,v_second)) loop
   v_seen:=array[]::text[];
   for v_pick,v_pick_index in select value,ordinality::int from
     pg_catalog.jsonb_array_elements(v_round) with ordinality loop
     v_owner:=v_pick->>'teamName';
     if v_owner is null or not (v_owner=any(v_names)) or v_owner=any(v_seen) or
        v_pick->>'originalTeamName' is distinct from v_owner or
        v_pick->>'currentOwnerTeamName' is distinct from v_owner or
        (v_pick->>'pickInRound')::int is distinct from v_pick_index or
        (v_pick->>'round')::int is distinct from (case when v_round=v_first then 1 else 2 end) or
        (v_pick->>'pick')::int is distinct from v_pick_index+(case when v_round=v_first then 0 else 30 end) or
        v_pick is distinct from (v_full->(v_pick_index-1+(case when v_round=v_first then 0 else 30 end)))
     then raise exception 'Draft pick order contains invalid or duplicate team ownership';end if;
     v_seen:=pg_catalog.array_append(v_seen,v_owner);
   end loop;
   if pg_catalog.array_length(v_seen,1)<>30 then raise exception 'Draft round missing teams';end if;
 end loop;

 -- The actual traded-rights ledger is intentionally untouched.
 -- Existing runtime guards permit this single, logged, authoritative state update.
 perform pg_catalog.set_config('bm.online_postseason_write','1',true);
 update public.bm_online_franchise_runtime r
   set state=pg_catalog.jsonb_set(v_state,'{onlineDraftLottery}',p_lottery,true),
       revision=v_rev+1,updated_at=now()
   where r.lobby_id=p_lobby;
 insert into public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
   values(p_lobby,v_rev+1,p_request,p_actor,'draft_lottery_drawn',
     pg_catalog.jsonb_build_object('seasonYear',v_season,'draftYear',v_draft,'system',v_system));
 return pg_catalog.jsonb_build_object('ok',true,'revision',v_rev+1,'draftYear',v_draft);
end $$;
revoke all on function public.bm_online_draw_draft_lottery_phase2e1(uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.bm_online_draw_draft_lottery_phase2e1(uuid,uuid,uuid,bigint,jsonb) to service_role;
commit;
