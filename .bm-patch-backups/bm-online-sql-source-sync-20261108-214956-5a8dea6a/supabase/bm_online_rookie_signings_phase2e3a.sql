-- Basketball Manager Online 2E.3-A. Apply manually AFTER 2E.2.
-- Trusted original Python engine generates contracts; this atomic RPC only
-- moves the official unsigned rookie rows and never accepts a replacement league.
begin;
create or replace function public.bm_online_apply_rookie_signings_phase2e3a(
 p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,
 p_mode text,p_input_hash text,p_actions jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_state jsonb;v_next jsonb;v_rev bigint;v_prev public.bm_online_franchise_events%rowtype;
 v_year int;v_team jsonb;v_action jsonb;v_rookie jsonb;v_old jsonb;v_new jsonb;
 v_pending jsonb;v_list jsonb;v_free jsonb;v_updated jsonb;v_out jsonb;v_conf text;v_group jsonb;v_out_group jsonb;
 v_team_name text;v_key text;v_destination text;v_index int;v_target boolean;
 v_human boolean;v_count int:=0;v_target_count int:=0;v_expected_count int:=0;
 v_seen_team text[]:=array[]::text[];v_seen_id text[]:=array[]::text[];
 v_complete boolean:=true;v_team_list jsonb;v_player_id text;v_request_type text;
begin
 if p_lobby is null or p_actor is null or p_request is null or p_expected_revision<1 or
    (p_mode is null or p_mode not in ('human','cpu')) or p_input_hash !~ '^[0-9a-f]{64}$' or
    pg_catalog.jsonb_typeof(p_actions)<>'array' or pg_catalog.jsonb_array_length(p_actions)<1 or
    pg_catalog.jsonb_array_length(p_actions)>30 or pg_catalog.octet_length(p_actions::text)>2800000
 then raise exception 'Malformed online rookie signing transaction';end if;
 v_request_type:=case when p_mode='human' then 'rookie_signings_human' else 'rookie_signings_cpu' end;
 select r.state,r.revision into v_state,v_rev from public.bm_online_franchise_runtime r where r.lobby_id=p_lobby for update;
 if not found then raise exception 'Online franchise is unavailable';end if;
 if not exists(select 1 from public.bm_online_lobbies l where l.id=p_lobby and l.status='started' and
    (p_mode='human' or l.host_id=p_actor)) or
    not exists(select 1 from public.bm_online_lobby_members m where m.lobby_id=p_lobby and m.user_id=p_actor)
 then raise exception 'Only the owning GM or host may resolve rookie contracts';end if;
 select * into v_prev from public.bm_online_franchise_events e where e.lobby_id=p_lobby and e.request_id=p_request;
 if found then
   if v_prev.actor_id is distinct from p_actor or v_prev.action_type<>v_request_type or
      v_prev.details->>'requestInputHash' is distinct from p_input_hash
   then raise exception 'Rookie signing request ID belongs to a different operation';end if;
   return pg_catalog.jsonb_build_object('ok',true,'replayed',true,'revision',v_prev.revision);
 end if;
 if v_rev<>p_expected_revision then raise exception 'Shared roster revision changed. Refresh before signing';end if;
 if v_state#>>'{onlineDraft,status}'<>'complete' or
    v_state#>>'{onlineDraft,draftState,completed}'<>'true' or
    v_state#>>'{onlineDraftRights,status}'<>'settled' or
    v_state#>>'{onlineRookieSignings,status}'='complete'
 then raise exception 'The official NBA Draft must be complete before rookie signings';end if;
 v_year:=(v_state#>>'{onlineDraft,draftYear}')::int;
 if v_year not between 2026 and 2100 or v_year is distinct from (v_state#>>'{onlineDraftRights,draftYear}')::int
 then raise exception 'Rookie signing draft year mismatch';end if;
 if pg_catalog.jsonb_typeof(v_state->'teams')='array' then
   v_team_list:=v_state->'teams';
 else
   select pg_catalog.coalesce(pg_catalog.jsonb_agg(t.value),'[]'::jsonb) into v_team_list
     from pg_catalog.jsonb_each(v_state->'conferences') c,
       pg_catalog.jsonb_array_elements(c.value) t;
 end if;
 if pg_catalog.jsonb_array_length(v_team_list)<>30 then raise exception 'Shared NBA teams missing';end if;
 for v_action in select value from pg_catalog.jsonb_array_elements(p_actions) loop
   v_team_name:=v_action->>'teamName';
   if v_team_name is null or v_team_name=any(v_seen_team) or
      pg_catalog.jsonb_typeof(v_action->'rookies')<>'array' or
      pg_catalog.jsonb_array_length(v_action->'rookies')<1 or
      pg_catalog.jsonb_array_length(v_action->'rookies')>60
   then raise exception 'Duplicate or invalid signing team';end if;
   v_seen_team:=pg_catalog.array_append(v_seen_team,v_team_name);
   if not exists(select 1 from pg_catalog.jsonb_array_elements(v_team_list) t where t->>'name'=v_team_name)
   then raise exception 'Signing team does not belong to the current league';end if;
   v_human:=exists(select 1 from public.bm_online_lobby_members m where m.lobby_id=p_lobby and m.team_name=v_team_name);
   if p_mode='human' then
     if not v_human or not exists(select 1 from public.bm_online_lobby_members m
       where m.lobby_id=p_lobby and m.user_id=p_actor and m.team_name=v_team_name)
     then raise exception 'A GM cannot sign rookies belonging to another team';end if;
   elsif v_human then raise exception 'CPU signing cannot modify human-controlled teams';end if;
 end loop;
 if p_mode='human' and pg_catalog.jsonb_array_length(p_actions)<>1 then
    raise exception 'Resolve only your own team in one transaction';end if;
 -- Enforce ALL pending rookies for the selected category, not an arbitrary
 -- subset chosen by a compromised backend; one operation, one revision.
 for v_team in select value from pg_catalog.jsonb_array_elements(v_team_list) loop
   v_team_name:=v_team->>'name';
   v_pending:=case when pg_catalog.jsonb_typeof(v_team->'pendingRookieSignings')='array'
                    then v_team->'pendingRookieSignings' else '[]'::jsonb end;
   v_target:= (p_mode='human' and v_team_name=any(v_seen_team)) or
     (p_mode='cpu' and not exists(select 1 from public.bm_online_lobby_members m
          where m.lobby_id=p_lobby and m.team_name=v_team_name) and pg_catalog.jsonb_array_length(v_pending)>0);
   if v_target then
     v_expected_count:=v_expected_count+1;
     if not(v_team_name=any(v_seen_team)) or pg_catalog.jsonb_array_length(v_pending)=0
     then raise exception 'Rookie signing team is missing or has no pending rookies';end if;
   end if;
 end loop;
 if v_expected_count<>pg_catalog.jsonb_array_length(p_actions) then
   raise exception 'CPU rookie signing batch must include every eligible CPU team';end if;
 v_free:=case when pg_catalog.jsonb_typeof(v_state->'freeAgents')='array'
       then v_state->'freeAgents' else '[]'::jsonb end;
 -- Validate and move only the draft rookies. Existing players, league records,
 -- and the original draft board are copied from the locked snapshot untouched.
 for v_action in select value from pg_catalog.jsonb_array_elements(p_actions) loop
   v_team_name:=v_action->>'teamName';
   select t.value into v_team from pg_catalog.jsonb_array_elements(v_team_list) t where t.value->>'name'=v_team_name;
   v_pending:=case when pg_catalog.jsonb_typeof(v_team->'pendingRookieSignings')='array'
                      then v_team->'pendingRookieSignings' else '[]'::jsonb end;
   if pg_catalog.jsonb_array_length(v_pending)<>pg_catalog.jsonb_array_length(v_action->'rookies')
   then raise exception 'Every unsigned rookie must have exactly one decision';end if;
   v_updated:=v_team;
   for v_rookie in select value from pg_catalog.jsonb_array_elements(v_action->'rookies') loop
     v_player_id:=v_rookie->>'id';v_destination:=v_rookie->>'decision';v_new:=v_rookie->'player';
     if v_player_id is null or v_player_id=any(v_seen_id) or
        v_destination not in ('standard','two_way','stash','release') or
        pg_catalog.jsonb_typeof(v_new)<>'object' or
        v_new->>'id' is distinct from v_player_id
     then raise exception 'Invalid or duplicate rookie signing result';end if;
     v_seen_id:=pg_catalog.array_append(v_seen_id,v_player_id);
     select p.value into v_old from pg_catalog.jsonb_array_elements(v_pending) p where p.value->>'id'=v_player_id;
     if not found or v_old->>'rookieSigningPending'<>'true' or
        v_old#>>'{contract,pendingRookieSigning}'<>'true' or
        v_old->>'contractType'<>'unsigned_rookie' or
        v_old->>'team' is distinct from v_team_name or
        v_old#>>'{meta,draftYear}' is distinct from v_year::text or
        v_new#>>'{meta,draftYear}' is distinct from v_old#>>'{meta,draftYear}' or
        v_new#>>'{meta,draftPick}' is distinct from v_old#>>'{meta,draftPick}' or
        v_new#>>'{meta,draftRound}' is distinct from v_old#>>'{meta,draftRound}' or
        v_new->>'rookieSigningPending'<>'false' or v_new#>>'{contract,pendingRookieSigning}'='true' or
        v_new#>>'{meta,rookieSigningDecision}' is distinct from v_destination or
        (v_new->'contract'->>'startYear')::int is distinct from
          (case when v_destination='stash' then v_year+1 else v_year end)
     then raise exception 'Signing does not match an original unsigned draft player';end if;
     if not exists(select 1 from pg_catalog.jsonb_array_elements(
         v_state#>'{onlineDraft,draftState,draftedPicks}') p where p->>'playerId'=v_player_id and p->>'teamName'=v_team_name)
     then raise exception 'Unsigned rookie has no matching official draft selection';end if;
     -- The Python engine may modify the signed player's contract/rights/history,
     -- but cannot rewrite basketball attributes, ID, age or draft provenance.
     if (v_old - 'contract' - 'contractType' - 'rights' - 'meta' - 'history' - 'rosterStatus'
           - 'assignmentStatus' - 'team' - 'rookieSigningPending' - 'qualifyingOffer'
           - 'qualifyingOfferEligible' - 'rightsRenounced' - 'freeAgencyMeta' - 'stashMeta' - 'twoWayMeta')
        is distinct from
        (v_new - 'contract' - 'contractType' - 'rights' - 'meta' - 'history' - 'rosterStatus'
           - 'assignmentStatus' - 'team' - 'rookieSigningPending' - 'qualifyingOffer'
           - 'qualifyingOfferEligible' - 'rightsRenounced' - 'freeAgencyMeta' - 'stashMeta' - 'twoWayMeta')
     then raise exception 'Rookie attributes were altered while signing';end if;
     if (v_destination='standard' and (
          pg_catalog.jsonb_typeof(v_new#>'{contract,salaryByYear}')<>'array' or
          pg_catalog.jsonb_array_length(v_new#>'{contract,salaryByYear}')<>
             (case when v_old#>>'{meta,draftRound}'='1' then 4 else 2 end) or
          v_new#>>'{contract,source}' is distinct from
             (case when v_old#>>'{meta,draftRound}'='1'
                then 'first_round_rookie_scale_contract' else 'second_round_rookie_contract' end) or
          v_new#>>'{rights,heldByTeam}' is distinct from v_team_name)) or
        (v_destination='two_way' and (v_new#>>'{contract,source}'<>'rookie_two_way_contract' or
          v_new#>'{contract,salaryByYear}' is distinct from '[]'::jsonb or
          v_new#>>'{rights,heldByTeam}' is distinct from v_team_name)) or
        (v_destination='stash' and (v_new#>>'{contract,source}'<>'one_year_rookie_stash' or
          v_new#>'{contract,salaryByYear}' is distinct from '[]'::jsonb or
          v_new#>>'{rights,heldByTeam}' is distinct from v_team_name)) or
        (v_destination='release' and (v_new#>'{contract,salaryByYear}' is distinct from '[]'::jsonb or
          v_new#>>'{rights,heldByTeam}' is not null))
     then raise exception 'Rookie salary schedule or team-control rights are inconsistent';end if;
     if pg_catalog.jsonb_typeof(v_new#>'{history,transactions}')<>'array' or
        pg_catalog.jsonb_array_length(v_new#>'{history,transactions}') <>
          (case when pg_catalog.jsonb_typeof(v_old#>'{history,transactions}')='array'
             then pg_catalog.jsonb_array_length(v_old#>'{history,transactions}') else 0 end)+1
     then raise exception 'Rookie transaction history is inconsistent';end if;
     if exists(select 1 from pg_catalog.jsonb_array_elements(v_free) f where f->>'id'=v_player_id) or
       exists(select 1 from pg_catalog.jsonb_array_elements(v_team_list) club
         cross join lateral pg_catalog.jsonb_array_elements(
           (case when pg_catalog.jsonb_typeof(club->'players')='array' then club->'players' else '[]'::jsonb end)||
           (case when pg_catalog.jsonb_typeof(club->'twoWayPlayers')='array' then club->'twoWayPlayers' else '[]'::jsonb end)||
           (case when pg_catalog.jsonb_typeof(club->'stashPlayers')='array' then club->'stashPlayers' else '[]'::jsonb end)) existing_player
           where existing_player->>'id'=v_player_id)
     then raise exception 'Rookie already occupies a signed roster or free-agent slot';end if;
     v_key:=case v_destination when 'standard' then 'players' when 'two_way' then 'twoWayPlayers'
             when 'stash' then 'stashPlayers' else 'freeAgents' end;
     if v_destination='release' then
       if v_new->>'team'<>'Free Agent' or v_new->>'contractType'<>'free_agent' or
          v_new#>>'{contract,type}'<>'free_agent'
       then raise exception 'Released rookie must enter free agency';end if;
       v_free:=v_free||pg_catalog.jsonb_build_array(v_new);
     else
       if v_new->>'team' is distinct from v_team_name or
          v_new->>'contractType' is distinct from v_destination or
          v_new#>>'{contract,type}' is distinct from v_destination
       then raise exception 'Signed rookie contract type does not match its roster';end if;
       v_list:=case when pg_catalog.jsonb_typeof(v_updated->v_key)='array'
                then v_updated->v_key else '[]'::jsonb end;
       v_updated:=pg_catalog.jsonb_set(v_updated,ARRAY[v_key],v_list||pg_catalog.jsonb_build_array(v_new),true);
     end if;
     v_pending:=(select pg_catalog.coalesce(pg_catalog.jsonb_agg(x.value),'[]'::jsonb)
       from pg_catalog.jsonb_array_elements(v_pending) x where x.value->>'id' is distinct from v_player_id);
     v_count:=v_count+1;
   end loop;
   if pg_catalog.jsonb_array_length(v_pending)<>0 then
      raise exception 'Incomplete rookie rights were left unresolved';end if;
   v_updated:=pg_catalog.jsonb_set(v_updated,'{pendingRookieSignings}','[]'::jsonb,true);
   -- Replace this team's object in the canonical flattened working copy.
   v_out:='[]'::jsonb;
   for v_team in select value from pg_catalog.jsonb_array_elements(v_team_list) loop
      v_out:=v_out||pg_catalog.jsonb_build_array(case when v_team->>'name'=v_team_name then v_updated else v_team end);
   end loop;
   v_team_list:=v_out;
 end loop;
 if v_count<1 or v_count>60 then raise exception 'Rookie contract batch size is invalid';end if;
 -- Preserve original state storage shape: flat teams or two conferences.
 v_next:=v_state;
 if pg_catalog.jsonb_typeof(v_state->'teams')='array' then
   v_next:=pg_catalog.jsonb_set(v_next,'{teams}',v_team_list,true);
 else
   for v_conf,v_group in select key,value from pg_catalog.jsonb_each(v_state->'conferences') loop
      v_out_group:='[]'::jsonb;
      for v_team in select value from pg_catalog.jsonb_array_elements(v_group) loop
         select x.value into v_updated from pg_catalog.jsonb_array_elements(v_team_list) x
            where x.value->>'name'=v_team->>'name';
         v_out_group:=v_out_group||pg_catalog.jsonb_build_array(v_updated);
      end loop;
      v_next:=pg_catalog.jsonb_set(v_next,ARRAY['conferences',v_conf],v_out_group,false);
   end loop;
 end if;
 v_next:=pg_catalog.jsonb_set(v_next,'{freeAgents}',v_free,true);
 for v_team in select value from pg_catalog.jsonb_array_elements(v_team_list) loop
   if pg_catalog.jsonb_typeof(v_team->'pendingRookieSignings')='array' and
      pg_catalog.jsonb_array_length(v_team->'pendingRookieSignings')>0
   then v_complete:=false;exit;end if;
 end loop;
 v_next:=pg_catalog.jsonb_set(v_next,'{onlineRookieSignings}',
    pg_catalog.jsonb_build_object('status',case when v_complete then 'complete' else 'active' end,
      'draftYear',v_year,'resolvedCount',v_count,'lastAction',p_mode),true);
 if v_complete then
   v_next:=pg_catalog.jsonb_set(v_next,'{rookieSigningState}',pg_catalog.jsonb_build_object(
       'seasonYear',v_year,'complete',true,'remainingCount',0),true);
   v_next:=pg_catalog.jsonb_set(v_next,'{offseasonState,rookieSigningsComplete}','true'::jsonb,true);
 end if;
 perform pg_catalog.set_config('bm.online_draft_write',p_lobby::text,true);
 perform pg_catalog.set_config('bm.online_rookie_write',p_lobby::text,true);
 perform pg_catalog.set_config('bm.online_postseason_write','1',true);
 update public.bm_online_franchise_runtime r set state=v_next,revision=v_rev+1,updated_at=now() where r.lobby_id=p_lobby;
 insert into public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
 values(p_lobby,v_rev+1,p_request,p_actor,v_request_type,
   pg_catalog.jsonb_build_object('draftYear',v_year,'count',v_count,'complete',v_complete,
      'requestInputHash',p_input_hash,'teams',v_seen_team));
 return pg_catalog.jsonb_build_object('ok',true,'revision',v_rev+1,'count',v_count,'complete',v_complete);
end $$;
revoke all on function public.bm_online_apply_rookie_signings_phase2e3a(uuid,uuid,uuid,bigint,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.bm_online_apply_rookie_signings_phase2e3a(uuid,uuid,uuid,bigint,text,text,jsonb) to service_role;

create or replace function public.bm_online_rookie_signing_guard_phase2e3a()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_before jsonb;v_after jsonb;v_team jsonb;
begin
 if old.state#>>'{onlineDraft,status}'='complete' and
    pg_catalog.current_setting('bm.online_rookie_write',true) is distinct from new.lobby_id::text
 then
    if old.state->'onlineRookieSignings' is distinct from new.state->'onlineRookieSignings' or
       old.state->'rookieSigningState' is distinct from new.state->'rookieSigningState' or
       old.state#>'{offseasonState,rookieSigningsComplete}' is distinct from
         new.state#>'{offseasonState,rookieSigningsComplete}'
    then raise exception 'Only the trusted rookie transaction may change signing progress';end if;
    if pg_catalog.jsonb_typeof(old.state->'teams')='array' then
      for v_team in select value from pg_catalog.jsonb_array_elements(old.state->'teams') loop
        select t.value into v_after from pg_catalog.jsonb_array_elements(new.state->'teams') t
           where t.value->>'name'=v_team->>'name';
        if v_after is null or v_after->'pendingRookieSignings' is distinct from v_team->'pendingRookieSignings'
        then raise exception 'Unsigned rookie rights require the authoritative signing transaction';end if;
      end loop;
    else
      for v_team in select t.value from pg_catalog.jsonb_each(old.state->'conferences') c,
          pg_catalog.jsonb_array_elements(c.value) t loop
        select x.value into v_after from pg_catalog.jsonb_each(new.state->'conferences') c,
          pg_catalog.jsonb_array_elements(c.value) x where x.value->>'name'=v_team->>'name';
        if v_after is null or v_after->'pendingRookieSignings' is distinct from v_team->'pendingRookieSignings'
        then raise exception 'Unsigned rookie rights require the authoritative signing transaction';end if;
      end loop;
    end if;
 end if;
 return new;
end $$;
revoke all on function public.bm_online_rookie_signing_guard_phase2e3a() from public,anon,authenticated;
drop trigger if exists bm_online_rookie_signing_guard_phase2e3a on public.bm_online_franchise_runtime;
create trigger bm_online_rookie_signing_guard_phase2e3a before update on public.bm_online_franchise_runtime
 for each row execute function public.bm_online_rookie_signing_guard_phase2e3a();
commit;
