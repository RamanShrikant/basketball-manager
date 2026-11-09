-- Basketball Manager Online 2E.2 — manually apply after 2E.1.
-- Trusted service-role-only draft settlement, generated class and GM/CPU picks.
-- Does not sign rookies or roll to the following season.
begin;

create or replace function public.bm_online_settle_draft_rights_phase2e2(
 p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,p_rights jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_state jsonb;v_rev bigint;v_prior public.bm_online_franchise_events%rowtype;
 v_year integer;v_lottery jsonb;v_origin jsonb;v_order jsonb;v_names text[];
 v_row jsonb;v_natural jsonb;v_found int;v_seen int[]:=array[]::int[];v_deleted int[]:=array[]::int[];
 v_key text;v_forfeit boolean;v_next jsonb;v_seen_natural text[]:=array[]::text[];
begin
 if p_lobby is null or p_actor is null or p_request is null or p_expected_revision<1 or
    pg_catalog.jsonb_typeof(p_rights)<>'object' or pg_catalog.octet_length(p_rights::text)>500000
 then raise exception 'Invalid rights settlement request';end if;
 select r.state,r.revision into v_state,v_rev from public.bm_online_franchise_runtime r
  where r.lobby_id=p_lobby for update;
 if not found then raise exception 'Online league is unavailable';end if;
 if not exists(select 1 from public.bm_online_lobbies l where l.id=p_lobby and
   l.host_id=p_actor and l.status='started') or not exists(
   select 1 from public.bm_online_lobby_members m where m.lobby_id=p_lobby and m.user_id=p_actor)
 then raise exception 'Only the online host can settle draft rights';end if;
 select * into v_prior from public.bm_online_franchise_events e where e.lobby_id=p_lobby and e.request_id=p_request;
 if found then
   if v_prior.actor_id is distinct from p_actor or v_prior.action_type<>'nba_draft_rights_settled'
     then raise exception 'Request ID belongs to another operation';end if;
   return pg_catalog.jsonb_build_object('ok',true,'replayed',true,'revision',v_prior.revision);
 end if;
 if v_rev<>p_expected_revision then raise exception 'The shared league changed; refresh the draft';end if;
 v_lottery:=v_state->'onlineDraftLottery';
 if v_lottery->>'stage'<>'orderDrawn' or v_lottery->>'rightsSettlement'<>'pending' or
   v_state ? 'onlineDraftRights' or v_state ? 'onlineDraft' or
   p_rights->>'status'<>'settled' then raise exception 'The draft is already settled or not ready';end if;
 v_year:=(v_lottery->>'draftYear')::int;
 if (p_rights->>'draftYear')::int is distinct from v_year or
    (p_rights->>'seasonYear')::int is distinct from (v_lottery->>'seasonYear')::int or
    (v_state#>>'{onlinePostseason,seasonYear}')::int is distinct from v_year-1 or
    v_state#>>'{onlinePostseason,phase}'<>'postseasonComplete' or
    p_rights->>'ownershipVersion' is null or
    p_rights->>'rightsSourceSha256' !~ '^[a-f0-9]{64}$' or
    p_rights->'settledAt' is distinct from 'null'::jsonb
 then raise exception 'Draft-rights settlement belongs to another season';end if;
 v_order:=p_rights->'order';v_origin:=v_lottery#>'{result,fullDraftOrder}';
 if pg_catalog.jsonb_typeof(v_order)<>'array' or pg_catalog.jsonb_typeof(v_origin)<>'array' or
    pg_catalog.jsonb_array_length(v_origin)<>60 or pg_catalog.jsonb_array_length(v_order)>60 or
    pg_catalog.jsonb_array_length(v_order)<50 or
    pg_catalog.jsonb_typeof(p_rights->'removedSlots')<>'array'
 then raise exception 'Incomplete settled draft order';end if;
 select pg_catalog.array_agg(t->>'name') into v_names from pg_catalog.jsonb_array_elements(
   case when pg_catalog.jsonb_typeof(v_state->'teams')='array' then v_state->'teams'
        else (select pg_catalog.jsonb_agg(value) from pg_catalog.jsonb_each(v_state->'conferences') c,
          pg_catalog.jsonb_array_elements(c.value)) end) as t;
 if pg_catalog.array_length(v_names,1)<>30 then raise exception 'NBA teams are missing';end if;
 for v_row in select value from pg_catalog.jsonb_array_elements(v_order) loop
   if (v_row->>'pick') !~ '^[1-9][0-9]?$' or (v_row->>'pick')::int not between 1 and 60
     then raise exception 'Invalid draft slot';end if;
   v_seen:=pg_catalog.array_append(v_seen,(v_row->>'pick')::int);
   v_natural:=v_origin->((v_row->>'pick')::int-1);
   if v_natural is null or v_row->>'originalTeamName' is distinct from v_natural->>'originalTeamName' or
      v_row->>'round' is distinct from v_natural->>'round' or
      v_row->>'pickInRound' is distinct from v_natural->>'pickInRound' or
      v_row->>'teamName' is distinct from v_row->>'currentOwnerTeamName' or
      v_row->>'currentOwnerTeamName' is null or not(v_row->>'currentOwnerTeamName'=any(v_names))
   then raise exception 'Draft order does not match the original lottery slots';end if;
   v_key:=(v_row->>'round')||'|'||(v_row->>'originalTeamName');
   if v_key=any(v_seen_natural)then raise exception 'Duplicate natural draft entitlement';end if;
   v_seen_natural:=pg_catalog.array_append(v_seen_natural,v_key);
 end loop;
 if (select count(distinct x) from pg_catalog.unnest(v_seen) x)<>pg_catalog.array_length(v_seen,1)
 then raise exception 'A draft slot was assigned more than once';end if;
 for v_natural in select value from pg_catalog.jsonb_array_elements(v_origin) loop
   if not (v_natural->>'pick')::int=any(v_seen) then
     v_forfeit:=exists(select 1 from pg_catalog.jsonb_array_elements(
         case when pg_catalog.jsonb_typeof(v_state->'draftPickForfeitures')='array' then
           v_state->'draftPickForfeitures' else '[]'::jsonb end) f
       where (f->>'year')::int=v_year and f->>'round'=v_natural->>'round' and
         coalesce(f->>'originalTeam',f->>'originalTeamName')=v_natural->>'originalTeamName')
       or exists(select 1 from pg_catalog.jsonb_array_elements(
         case when pg_catalog.jsonb_typeof(v_state->'draftPicks')='array' then
           v_state->'draftPicks' else '[]'::jsonb end) a
       where (a->>'year')::int=v_year and a->>'round'=v_natural->>'round' and
         coalesce(a->>'originalTeam',a->>'originalTeamName')=v_natural->>'originalTeamName' and
         (a->>'status'='forfeited' or a->>'forfeited'='true'));
     if not v_forfeit then raise exception 'A non-forfeited pick disappeared from the draft';end if;
     v_deleted:=pg_catalog.array_append(v_deleted,(v_natural->>'pick')::int);
   end if;
 end loop;
 if (select coalesce(pg_catalog.array_agg(value::int order by value::int),'{}'::int[])
      from pg_catalog.jsonb_array_elements_text(p_rights->'removedSlots'))
    is distinct from (select coalesce(pg_catalog.array_agg(x order by x),'{}'::int[]) from pg_catalog.unnest(v_deleted) x)
 then raise exception 'Forfeited positions do not reconcile';end if;
 -- Do not rewrite original lottery or any source rights. Only reveal settlement.
 v_next:=pg_catalog.jsonb_set(v_state,'{onlineDraftRights}',p_rights,true);
 v_next:=pg_catalog.jsonb_set(v_next,'{onlineDraftLottery,rightsSettlement}','"settled"'::jsonb,true);
 perform pg_catalog.set_config('bm.online_draft_write',p_lobby::text,true);
 update public.bm_online_franchise_runtime r set state=v_next,revision=v_rev+1,updated_at=now() where r.lobby_id=p_lobby;
 insert into public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
 values(p_lobby,v_rev+1,p_request,p_actor,'nba_draft_rights_settled',
    pg_catalog.jsonb_build_object('draftYear',v_year,'picks',pg_catalog.jsonb_array_length(v_order)));
 return pg_catalog.jsonb_build_object('ok',true,'revision',v_rev+1);
end $$;
revoke all on function public.bm_online_settle_draft_rights_phase2e2(uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.bm_online_settle_draft_rights_phase2e2(uuid,uuid,uuid,bigint,jsonb) to service_role;

create or replace function public.bm_online_start_draft_phase2e2(
 p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,p_draft jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_state jsonb;v_rev bigint;v_prev public.bm_online_franchise_events%rowtype;
 v_rights jsonb;v_board jsonb;v_year int;
begin
 if p_expected_revision<1 or p_request is null or p_actor is null or
   pg_catalog.jsonb_typeof(p_draft)<>'object' or pg_catalog.octet_length(p_draft::text)>6000000
 then raise exception 'Invalid draft start request';end if;
 select state,revision into v_state,v_rev from public.bm_online_franchise_runtime where lobby_id=p_lobby for update;
 if not found then raise exception 'Online draft does not exist';end if;
 if not exists(select 1 from public.bm_online_lobbies where id=p_lobby and host_id=p_actor and status='started') or
    not exists(select 1 from public.bm_online_lobby_members where lobby_id=p_lobby and user_id=p_actor)
 then raise exception 'Only the host can start this draft';end if;
 select * into v_prev from public.bm_online_franchise_events where lobby_id=p_lobby and request_id=p_request;
 if found then
  if v_prev.actor_id is distinct from p_actor or v_prev.action_type<>'nba_draft_started' then
    raise exception 'Request ID already belongs to another operation';end if;
  return pg_catalog.jsonb_build_object('ok',true,'replayed',true,'revision',v_prev.revision);
 end if;
 if v_rev<>p_expected_revision then raise exception 'Shared draft changed, refresh';end if;
 v_rights:=v_state->'onlineDraftRights';v_board:=p_draft->'draftState';v_year:=(v_rights->>'draftYear')::int;
 if v_rights->>'status'<>'settled' or v_state ? 'onlineDraft' or
    v_state#>>'{onlineDraftLottery,rightsSettlement}'<>'settled' or
    p_draft->>'status'<>'active' or p_draft->>'classMode'<>'single_player_auto' or
    (p_draft->>'draftYear')::int is distinct from v_year or
    (p_draft->>'seasonYear')::int is distinct from v_year-1 or
    (v_board->>'seasonYear')::int is distinct from v_year or
    v_board->'draftOrder' is distinct from v_rights->'order' or
    pg_catalog.jsonb_typeof(v_board->'draftClass')<>'array' or
    pg_catalog.jsonb_typeof(v_board->'availableProspects')<>'array' or
    pg_catalog.jsonb_array_length(v_board->'availableProspects')<pg_catalog.jsonb_array_length(v_rights->'order') or
    pg_catalog.jsonb_typeof(v_board->'draftedPicks')<>'array' or
    pg_catalog.jsonb_array_length(v_board->'draftedPicks')<>0 or
    (v_board->>'currentPickIndex')::int is distinct from 0 or v_board->>'completed'<>'false'
 then raise exception 'Draft engine board does not match settled picks';end if;
 if exists(select 1 from pg_catalog.jsonb_array_elements(v_board->'availableProspects') p
      where nullif(p->>'id','') is null) or
    (select count(distinct p->>'id') from pg_catalog.jsonb_array_elements(v_board->'availableProspects') p)<>
    pg_catalog.jsonb_array_length(v_board->'availableProspects')
 then raise exception 'Generated draft class has duplicate or missing player identifiers';end if;
 perform pg_catalog.set_config('bm.online_draft_write',p_lobby::text,true);
 update public.bm_online_franchise_runtime r set state=pg_catalog.jsonb_set(v_state,'{onlineDraft}',p_draft,true),
   revision=v_rev+1,updated_at=now() where lobby_id=p_lobby;
 insert into public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
 values(p_lobby,v_rev+1,p_request,p_actor,'nba_draft_started',
  pg_catalog.jsonb_build_object('draftYear',v_year,'picks',pg_catalog.jsonb_array_length(v_rights->'order')));
 return pg_catalog.jsonb_build_object('ok',true,'revision',v_rev+1);
end $$;
revoke all on function public.bm_online_start_draft_phase2e2(uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.bm_online_start_draft_phase2e2(uuid,uuid,uuid,bigint,jsonb) to service_role;

create or replace function public.bm_online_make_draft_pick_phase2e2(
 p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,
 p_pick jsonb,p_player jsonb,p_next_draft jsonb,p_undrafted jsonb,p_owner text,p_cpu boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_state jsonb;v_rev bigint;v_prev public.bm_online_franchise_events%rowtype;
 v_draft jsonb;v_old jsonb;v_order jsonb;v_turn jsonb;v_index int;v_year int;v_next jsonb;
 v_player_id text;v_name text;v_team jsonb;v_teams jsonb;v_new_teams jsonb:='[]'::jsonb;
 v_confs jsonb;v_new_conf jsonb;v_conf text;v_group jsonb;v_count int:=0;v_human_owner uuid;
 v_old_avail jsonb;v_new_avail jsonb;v_changed int;v_record jsonb;v_undrafted_row jsonb;
 v_user_team text;v_prev_pick jsonb;v_ordinal bigint;
begin
 if p_lobby is null or p_actor is null or p_request is null or p_expected_revision<1 or
   pg_catalog.jsonb_typeof(p_pick)<>'object' or pg_catalog.jsonb_typeof(p_player)<>'object' or
   pg_catalog.jsonb_typeof(p_next_draft)<>'object' or pg_catalog.jsonb_typeof(p_undrafted)<>'array' or
   pg_catalog.octet_length(p_next_draft::text)>6000000 or pg_catalog.octet_length(p_player::text)>50000 or
   p_owner is null or pg_catalog.length(p_owner)>100 or p_cpu is null
 then raise exception 'Malformed draft-pick transaction';end if;
 select state,revision into v_state,v_rev from public.bm_online_franchise_runtime where lobby_id=p_lobby for update;
 if not found then raise exception 'Online league does not exist';end if;
 if not exists(select 1 from public.bm_online_lobbies where id=p_lobby and status='started') or
    not exists(select 1 from public.bm_online_lobby_members where lobby_id=p_lobby and user_id=p_actor)
 then raise exception 'Account is not a current online manager';end if;
 select * into v_prev from public.bm_online_franchise_events where lobby_id=p_lobby and request_id=p_request;
 if found then
   if v_prev.actor_id is distinct from p_actor or v_prev.action_type<>'nba_draft_pick_made'
      then raise exception 'Request ID belongs to another operation';end if;
   return pg_catalog.jsonb_build_object('ok',true,'replayed',true,'revision',v_prev.revision,'pick',v_prev.details->'pick');
 end if;
 if v_rev<>p_expected_revision then raise exception 'Another GM already advanced the draft';end if;
 v_draft:=v_state->'onlineDraft';v_old:=v_draft->'draftState';v_order:=v_old->'draftOrder';
 v_index:=(v_old->>'currentPickIndex')::int;v_year:=(v_draft->>'draftYear')::int;
 if v_draft->>'status'<>'active' or v_state#>>'{onlineDraftRights,status}'<>'settled' or
   pg_catalog.jsonb_typeof(v_order)<>'array' or v_index<0 or v_index>=pg_catalog.jsonb_array_length(v_order) or
   v_old->>'completed'<>'false' or v_draft->>'draftYear' is distinct from
      v_state#>>'{onlineDraftRights,draftYear}'
 then raise exception 'The NBA Draft is not accepting picks';end if;
 v_turn:=v_order->v_index;
 if p_owner is distinct from v_turn->>'currentOwnerTeamName' or
    p_pick->>'teamName' is distinct from p_owner or
    (p_pick->>'pick')::int is distinct from (v_turn->>'pick')::int or
    (p_pick->>'round')::int is distinct from (v_turn->>'round')::int
 then raise exception 'The current pick belongs to another franchise';end if;
 select m.user_id into v_human_owner from public.bm_online_lobby_members m
   where m.lobby_id=p_lobby and m.team_name=p_owner;
 if p_cpu then
   if v_human_owner is not null or not exists(select 1 from public.bm_online_lobbies l
      where l.id=p_lobby and l.host_id=p_actor) then
      raise exception 'Only the host may advance a CPU-controlled team';end if;
 else
   if v_human_owner is distinct from p_actor then
      raise exception 'Only the GM assigned to this team may make its selection';end if;
 end if;
 v_old_avail:=v_old->'availableProspects';v_new_avail:=p_next_draft->'availableProspects';
 if pg_catalog.jsonb_typeof(v_old_avail)<>'array' or pg_catalog.jsonb_typeof(v_new_avail)<>'array' or
    pg_catalog.jsonb_typeof(p_next_draft->'draftedPicks')<>'array' or
    (p_next_draft->>'currentPickIndex')::int is distinct from v_index+1 or
    p_next_draft->'draftOrder' is distinct from v_order or
    p_next_draft->'draftClass' is distinct from v_old->'draftClass' or
    p_next_draft->'classMeta' is distinct from v_old->'classMeta' or
    pg_catalog.jsonb_array_length(p_next_draft->'draftedPicks')<>v_index+1 or
    pg_catalog.jsonb_array_length(v_new_avail)<>pg_catalog.jsonb_array_length(v_old_avail)-1 or
    p_next_draft->>'completed' is distinct from
       (case when v_index+1=pg_catalog.jsonb_array_length(v_order) then 'true' else 'false' end)
 then raise exception 'The draft engine changed more than the current selection';end if;
 if (p_next_draft - 'currentPickIndex' - 'availableProspects' - 'draftedPicks' - 'completed'
       - 'undraftedProcessed' - 'undraftedAddedToFreeAgency') is distinct from
    (v_old - 'currentPickIndex' - 'availableProspects' - 'draftedPicks' - 'completed'
       - 'undraftedProcessed' - 'undraftedAddedToFreeAgency')
 then raise exception 'Draft engine rewrote immutable player or class information';end if;
 for v_record,v_ordinal in select value,ordinality from pg_catalog.jsonb_array_elements(v_old->'draftedPicks') with ordinality loop
   if v_record is distinct from p_next_draft->'draftedPicks'->(v_ordinal::int-1)
   then raise exception 'Previously announced draft picks cannot be rewritten';end if;
 end loop;
 v_prev_pick:=p_next_draft->'draftedPicks'->v_index;
 if v_prev_pick is distinct from p_pick or p_pick->>'playerId' is distinct from p_player->>'id' or
    p_pick->>'playerName' is distinct from p_player->>'name' or
    p_player->>'team' is distinct from p_owner or
    p_player->>'rookieSigningPending'<>'true' or
    p_player#>>'{contract,pendingRookieSigning}'<>'true' or
    p_player->>'contractType'<>'unsigned_rookie' or
    p_player#>>'{meta,draftYear}' is distinct from v_year::text or
    (p_player#>>'{meta,draftPick}')::int is distinct from (v_turn->>'pick')::int
 then raise exception 'Rookie signing provenance does not match the official pick';end if;
 select count(*) into v_changed from pg_catalog.jsonb_array_elements(v_old_avail) a
    where not exists(select 1 from pg_catalog.jsonb_array_elements(v_new_avail) b where b->>'id'=a->>'id');
 if v_changed<>1 or exists(select 1 from pg_catalog.jsonb_array_elements(v_new_avail) b where not exists(
    select 1 from pg_catalog.jsonb_array_elements(v_old_avail) a where a->>'id'=b->>'id' and a=b))
 then raise exception 'A prospect was duplicated or altered during the selection';end if;
 if (select count(*) from pg_catalog.jsonb_array_elements(v_old_avail) a
     where a->>'name'=p_pick->>'playerName' and not exists(
       select 1 from pg_catalog.jsonb_array_elements(v_new_avail) b where b->>'id'=a->>'id'))<>1
 then raise exception 'The selected prospect was not removed from the official draft board';end if;
 if exists(select 1 from pg_catalog.jsonb_array_elements(
     case when pg_catalog.jsonb_typeof(v_state->'freeAgents')='array' then v_state->'freeAgents'
       else '[]'::jsonb end) a where a->>'id'=p_player->>'id')
 then raise exception 'A drafted rookie cannot already be a free agent';end if;
 if exists(select 1 from pg_catalog.jsonb_array_elements(
     case when pg_catalog.jsonb_typeof(v_state->'teams')='array' then v_state->'teams'
     else (select pg_catalog.jsonb_agg(t.value) from pg_catalog.jsonb_each(v_state->'conferences') c,
          pg_catalog.jsonb_array_elements(c.value) t) end) current_team
     cross join lateral pg_catalog.jsonb_array_elements(
       (case when pg_catalog.jsonb_typeof(current_team->'players')='array' then current_team->'players'
             else '[]'::jsonb end)||
       (case when pg_catalog.jsonb_typeof(current_team->'pendingRookieSignings')='array' then current_team->'pendingRookieSignings'
             else '[]'::jsonb end)) existing_player
     where existing_player->>'id'=p_player->>'id')
 then raise exception 'Drafted rookie identifier already exists on a league roster';end if;
 if p_next_draft->>'completed'='false' and pg_catalog.jsonb_array_length(p_undrafted)<>0 then
    raise exception 'Undrafted players cannot enter free agency before the final pick';end if;
 if pg_catalog.jsonb_array_length(p_undrafted)>24 then raise exception 'Undrafted class is too large';end if;
 if (select count(distinct p->>'id') from pg_catalog.jsonb_array_elements(p_undrafted) p)
      is distinct from pg_catalog.jsonb_array_length(p_undrafted) or
    exists(select 1 from pg_catalog.jsonb_array_elements(p_undrafted) p
      where exists(select 1 from pg_catalog.jsonb_array_elements(
       case when pg_catalog.jsonb_typeof(v_state->'freeAgents')='array' then v_state->'freeAgents'
       else '[]'::jsonb end) a where a->>'id'=p->>'id')) or
    exists(select 1 from pg_catalog.jsonb_array_elements(p_undrafted) p
      where exists(select 1 from pg_catalog.jsonb_array_elements(
       case when pg_catalog.jsonb_typeof(v_state->'teams')='array' then v_state->'teams'
       else (select pg_catalog.jsonb_agg(t.value) from pg_catalog.jsonb_each(v_state->'conferences') c,
          pg_catalog.jsonb_array_elements(c.value) t) end) club
        cross join lateral pg_catalog.jsonb_array_elements(
          (case when pg_catalog.jsonb_typeof(club->'players')='array' then club->'players' else '[]'::jsonb end)||
          (case when pg_catalog.jsonb_typeof(club->'pendingRookieSignings')='array' then club->'pendingRookieSignings' else '[]'::jsonb end)) roster_player
        where roster_player->>'id'=p->>'id'))
 then raise exception 'Undrafted rookies duplicate existing player identifiers';end if;
 for v_undrafted_row in select value from pg_catalog.jsonb_array_elements(p_undrafted) loop
    if nullif(v_undrafted_row->>'id','') is null or v_undrafted_row->>'team'<>'Free Agent' or
       v_undrafted_row->>'rookieSigningPending'<>'false' or v_undrafted_row->>'id'=p_player->>'id'
    then raise exception 'Undrafted players must be legitimate free agents';end if;
 end loop;
 -- Update ONLY one team's pending rights; all 15-man rosters remain unchanged.
 if pg_catalog.jsonb_typeof(v_state->'teams')='array' then
   for v_team in select value from pg_catalog.jsonb_array_elements(v_state->'teams') loop
     if v_team->>'name'=p_owner then
       v_count:=v_count+1;
       if exists(select 1 from pg_catalog.jsonb_array_elements(
         case when pg_catalog.jsonb_typeof(v_team->'pendingRookieSignings')='array'
            then v_team->'pendingRookieSignings' else '[]'::jsonb end) p
         where p->>'id'=p_player->>'id') then raise exception 'Rookie was already drafted';end if;
       v_team:=pg_catalog.jsonb_set(v_team,'{pendingRookieSignings}',
        coalesce(v_team->'pendingRookieSignings','[]'::jsonb)||pg_catalog.jsonb_build_array(p_player),true);
     end if;
     v_new_teams:=v_new_teams||pg_catalog.jsonb_build_array(v_team);
   end loop;
   v_next:=pg_catalog.jsonb_set(v_state,'{teams}',v_new_teams,true);
 else
   v_next:=v_state;
   for v_conf,v_group in select key,value from pg_catalog.jsonb_each(v_state->'conferences') loop
     v_new_conf:='[]'::jsonb;
     for v_team in select value from pg_catalog.jsonb_array_elements(v_group) loop
       if v_team->>'name'=p_owner then
         v_count:=v_count+1;
         if exists(select 1 from pg_catalog.jsonb_array_elements(
             case when pg_catalog.jsonb_typeof(v_team->'pendingRookieSignings')='array'
                then v_team->'pendingRookieSignings' else '[]'::jsonb end) x
           where x->>'id'=p_player->>'id') then raise exception 'Rookie was already drafted';end if;
         v_team:=pg_catalog.jsonb_set(v_team,'{pendingRookieSignings}',
          coalesce(v_team->'pendingRookieSignings','[]'::jsonb)||pg_catalog.jsonb_build_array(p_player),true);
       end if;
       v_new_conf:=v_new_conf||pg_catalog.jsonb_build_array(v_team);
     end loop;
     v_next:=pg_catalog.jsonb_set(v_next,ARRAY['conferences',v_conf]::text[],v_new_conf,false);
   end loop;
 end if;
 if v_count<>1 then raise exception 'Draft pick does not identify exactly one current team';end if;
 v_next:=pg_catalog.jsonb_set(v_next,'{onlineDraft,draftState}',p_next_draft,true);
 if p_next_draft->>'completed'='true' then
   v_next:=pg_catalog.jsonb_set(v_next,'{onlineDraft,status}','"complete"'::jsonb,false);
   v_next:=pg_catalog.jsonb_set(v_next,'{freeAgents}',
     (case when pg_catalog.jsonb_typeof(v_state->'freeAgents')='array' then v_state->'freeAgents'
         else '[]'::jsonb end)||p_undrafted,true);
 end if;
 perform pg_catalog.set_config('bm.online_draft_write',p_lobby::text,true);
 perform pg_catalog.set_config('bm.online_postseason_write','1',true);
 update public.bm_online_franchise_runtime r set state=v_next,revision=v_rev+1,updated_at=now() where lobby_id=p_lobby;
 insert into public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
 values(p_lobby,v_rev+1,p_request,p_actor,'nba_draft_pick_made',
   pg_catalog.jsonb_build_object('draftYear',v_year,'team',p_owner,'cpu',p_cpu,'pick',p_pick));
 return pg_catalog.jsonb_build_object('ok',true,'revision',v_rev+1,'pick',p_pick);
end $$;
revoke all on function public.bm_online_make_draft_pick_phase2e2(uuid,uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.bm_online_make_draft_pick_phase2e2(uuid,uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,text,boolean) to service_role;

-- Older signing/trade/roster RPCs must not silently alter the settled ownership
-- or in-progress draft once this phase is entered. Subsequent offseason phase
-- must explicitly introduce a new, audited transition/rollover permission.
create or replace function public.bm_online_draft_runtime_guard_phase2e2()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.state->'onlineDraftRights' is not null and
    (old.state->'onlineDraftRights' is distinct from new.state->'onlineDraftRights' or
     old.state->'draftPicks' is distinct from new.state->'draftPicks')
 then raise exception 'Settled draft ownership cannot be changed by an older trade or roster endpoint';end if;
 if old.state->'onlineDraftRights' is null and new.state->'onlineDraftRights' is not null and
    pg_catalog.current_setting('bm.online_draft_write',true) is distinct from new.lobby_id::text
 then raise exception 'Draft rights can only be settled by the trusted NBA Draft transaction';end if;
 if (old.state->'onlineDraft' is not null or new.state->'onlineDraft' is not null) and
     old.state->'onlineDraft' is distinct from new.state->'onlineDraft' and
     pg_catalog.current_setting('bm.online_draft_write',true) is distinct from new.lobby_id::text
 then raise exception 'NBA Draft state requires the trusted server-only draft transaction';end if;
 if (old.state#>>'{onlineDraftLottery,rightsSettlement}'='settled' and
      old.state->'onlineDraftLottery' is distinct from new.state->'onlineDraftLottery') or
    (old.state#>>'{onlineDraftLottery,rightsSettlement}'<>'settled' and
      new.state#>>'{onlineDraftLottery,rightsSettlement}'='settled' and
      pg_catalog.current_setting('bm.online_draft_write',true) is distinct from new.lobby_id::text)
 then raise exception 'Official draft lottery settlement cannot be changed';end if;
 return new;
end $$;
revoke all on function public.bm_online_draft_runtime_guard_phase2e2() from public,anon,authenticated;
drop trigger if exists bm_online_draft_runtime_guard_phase2e2 on public.bm_online_franchise_runtime;
create trigger bm_online_draft_runtime_guard_phase2e2 before update on public.bm_online_franchise_runtime
 for each row execute function public.bm_online_draft_runtime_guard_phase2e2();
commit;
