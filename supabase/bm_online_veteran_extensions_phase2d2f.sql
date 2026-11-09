-- BM Online Phase 2D.2-F: trusted original-Python contract extensions.
-- MANUAL migration. Prereqs: runtime, calendar, day simulation, trade deadline, All-Stars.
-- No browser role can invoke this RPC. Live validation on a disposable league required.
begin;

create or replace function public.bm_online_veteran_extension_date_phase2d2f(p_state jsonb)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_year int;v_date text;v_candidate text;
begin
 v_year:=nullif(p_state#>>'{onlineSchedule,seasonYear}','')::int+1;
 if v_year<2026 or v_year>2095 then raise exception 'Invalid online veteran extension season';end if;
 foreach v_candidate in array array[p_state#>>'{calendar,veteranExtensionDeadlineDate}',
   p_state#>>'{calendar,veteranContractExtensionDeadlineDate}'] loop
   if v_candidate ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' and left(v_candidate,4)::int=v_year then
     begin
       if pg_catalog.to_char(v_candidate::date,'YYYY-MM-DD')=v_candidate then return v_candidate;end if;
     exception when invalid_datetime_format or datetime_field_overflow then null;
     end;
   end if;
 end loop;
 return pg_catalog.to_char(pg_catalog.make_date(v_year,3,31),'YYYY-MM-DD');
end $$;
revoke all on function public.bm_online_veteran_extension_date_phase2d2f(jsonb) from public,anon,authenticated;
grant execute on function public.bm_online_veteran_extension_date_phase2d2f(jsonb) to service_role;

create or replace function public.bm_online_extension_rosters_phase2d2f(p_state jsonb)
returns jsonb language plpgsql immutable security definer set search_path='' as $$
declare v_rosters jsonb;
begin
 if pg_catalog.jsonb_typeof(p_state->'teams')='array' then
   v_rosters:=p_state->'teams';
 elsif pg_catalog.jsonb_typeof(p_state->'conferences')='object' and
   pg_catalog.jsonb_typeof(p_state#>'{conferences,East}')='array' and
   pg_catalog.jsonb_typeof(p_state#>'{conferences,West}')='array' then
   v_rosters:=p_state#>'{conferences,East}'||p_state#>'{conferences,West}';
 else raise exception 'Extension roster layout is unsupported';end if;
 if pg_catalog.jsonb_array_length(v_rosters)<>30 then raise exception 'Expected 30 team rosters';end if;
 return v_rosters;
end $$;
revoke all on function public.bm_online_extension_rosters_phase2d2f(jsonb) from public,anon,authenticated;
grant execute on function public.bm_online_extension_rosters_phase2d2f(jsonb) to service_role;

create or replace function public.bm_online_commit_extension_phase2d2f(
 p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,
 p_action text,p_date text,p_player_id text,p_offer jsonb,p_updated_state jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_old jsonb;v_revision bigint;v_next text;v_date text;v_year int;
 v_host uuid;v_status text;v_team text;
 v_prior public.bm_online_franchise_events%rowtype;
 v_by_date jsonb;v_results jsonb;v_old_rosters jsonb;v_new_rosters jsonb;
 v_old_team jsonb;v_new_team jsonb;v_old_player jsonb;v_new_player jsonb;
 v_old_salaries jsonb;v_new_salaries jsonb;
 v_team_count int;v_player_count int;v_modified int:=0;v_idx int;v_pi int;v_si int;
 v_allowed_player_keys text[]:=array['contract','history','rights','meta','rookieScale','restrictedFreeAgent',
  'qualifyingOffer','qualifyingOfferEligible','rfaOfferSheet','offerSheet','rfaMatched','rfaMatch',
  'rfaStatus','tenderedQO','contractType','rosterStatus'];
 v_root_keys text[]:=array['teams','conferences','contractExtensionHistory','contractExtensionState','playerMoodState'];
 v_details jsonb;
begin
 if p_lobby is null or p_actor is null or p_request is null or p_expected_revision<1 or
   p_action not in ('offer','close') or pg_catalog.jsonb_typeof(p_updated_state)<>'object' or
   pg_catalog.length(p_updated_state::text)>15000000
 then raise exception 'Invalid online extension commit';end if;
 if p_action='offer' and (nullif(p_player_id,'') is null or pg_catalog.length(p_player_id)>150 or
   pg_catalog.jsonb_typeof(p_offer)<>'object' or pg_catalog.length(p_offer::text)>1000) then
   raise exception 'Invalid online extension offer';end if;
 select r.state,r.revision into v_old,v_revision from public.bm_online_franchise_runtime r
   where r.lobby_id=p_lobby for update;
 if not found then raise exception 'Online franchise is unavailable';end if;
 select l.host_id,l.status,m.team_name into v_host,v_status,v_team
   from public.bm_online_lobbies l join public.bm_online_lobby_members m
     on m.lobby_id=l.id and m.user_id=p_actor where l.id=p_lobby;
 if not found or v_status<>'started' or nullif(v_team,'') is null then
   raise exception 'Only assigned GMs may manage extensions';end if;
 if p_action='close' and v_host is distinct from p_actor then
   raise exception 'Only the host can close veteran extensions';end if;
 select * into v_prior from public.bm_online_franchise_events
   where lobby_id=p_lobby and request_id=p_request;
 if found then
   if v_prior.actor_id is distinct from p_actor or
     v_prior.action_type is distinct from (case when p_action='offer' then 'contract_extension_offered' else 'veteran_extensions_closed' end) or
     (p_action='offer' and (v_prior.details->>'player_id' is distinct from p_player_id or
       v_prior.details->'offer' is distinct from p_offer))
   then raise exception 'Extension request ID belongs to another operation';end if;
   return pg_catalog.jsonb_build_object('ok',true,'replayed',true,'revision',v_prior.revision);
 end if;
 if v_revision<>p_expected_revision then raise exception 'League changed. Refresh before extending';end if;
 if v_old#>>'{onlineSchedule,phase}'<>'regular-season' then
   raise exception 'Contract extensions require the regular season';end if;
 v_year:=(v_old#>>'{onlineSchedule,seasonYear}')::int;
 v_date:=public.bm_online_veteran_extension_date_phase2d2f(v_old);
 if v_old#>'{onlineCheckpoints,veteran_extension}' is not null or
   v_old#>'{contractExtensionState,closedTypes}' @> '["veteran"]'::jsonb then
   raise exception 'Veteran extension deadline has already closed';end if;
 v_by_date:=v_old#>'{onlineSchedule,byDate}';v_results:=coalesce(v_old->'onlineResults','{}'::jsonb);
 if pg_catalog.jsonb_typeof(v_by_date)<>'object' or pg_catalog.jsonb_typeof(v_results)<>'object' then
   raise exception 'Shared season schedule or results are invalid';end if;
 select min(d.key) into v_next from pg_catalog.jsonb_each(v_by_date) d
   where exists(select 1 from pg_catalog.jsonb_array_elements(d.value) g
     where not (v_results ? (g.value->>'id')));
 if v_next is null then raise exception 'No remaining regular-season game dates';end if;
 if exists(select 1 from pg_catalog.jsonb_array_elements(v_by_date->v_next) g
   where v_results ? (g.value->>'id')) then raise exception 'Partially played game day';end if;
 if p_date is distinct from (case when v_next>v_date then v_date else v_next end) then
   raise exception 'Extension event has a stale league date';end if;
 if p_action='close' then
   if v_next<=v_date then raise exception 'Finish games before the extension deadline first';end if;
   if v_old#>>'{onlineCheckpoints,trade_deadline,status}'<>'closed' or
     v_old#>>'{onlineCheckpoints,all_star,status}'<>'selected' then
     raise exception 'Earlier league checkpoints must be finalized first';end if;
   if not (p_updated_state#>'{contractExtensionState,closedTypes}' @> '["veteran"]'::jsonb) then
     raise exception 'The extension engine did not finalize the veteran window';end if;
 else
   if v_next>v_date and (v_old#>>'{onlineCheckpoints,all_star,status}'<>'selected' or
     v_old#>>'{onlineCheckpoints,trade_deadline,status}'<>'closed') then
     raise exception 'An earlier league checkpoint is unresolved';end if;
 end if;
 -- Only five top-level extension keys may change. No score, date, injury,
 -- existing draft right, gameplan, results, or unrelated GM state may change.
 if (v_old - v_root_keys) is distinct from (p_updated_state - v_root_keys) then
   raise exception 'Extension cannot modify unrelated league records';end if;
 if (v_old->'teams') is not null and (p_updated_state->'teams') is null or
    (v_old->'teams') is null and (p_updated_state->'teams') is not null or
    (v_old->'conferences' - 'East' - 'West') is distinct from
       (p_updated_state->'conferences' - 'East' - 'West') then
   raise exception 'Roster hierarchy changed during extension';end if;
 v_old_rosters:=public.bm_online_extension_rosters_phase2d2f(v_old);
 v_new_rosters:=public.bm_online_extension_rosters_phase2d2f(p_updated_state);
 for v_idx in 0..29 loop
   v_old_team:=v_old_rosters->v_idx;v_new_team:=v_new_rosters->v_idx;
   if v_old_team->>'name' is distinct from v_new_team->>'name' or
     (v_old_team-'players') is distinct from (v_new_team-'players') or
     pg_catalog.jsonb_typeof(v_old_team->'players')<>'array' or
     pg_catalog.jsonb_typeof(v_new_team->'players')<>'array' or
     pg_catalog.jsonb_array_length(v_old_team->'players')<>pg_catalog.jsonb_array_length(v_new_team->'players')
   then raise exception 'Roster/team identity changed during extensions';end if;
   v_team_count:=pg_catalog.jsonb_array_length(v_old_team->'players');
   if v_team_count>0 then
    for v_pi in 0..v_team_count-1 loop
     v_old_player:=v_old_team->'players'->v_pi;v_new_player:=v_new_team->'players'->v_pi;
     if coalesce(v_old_player->>'id',v_old_player->>'playerId',v_old_player->>'name') is distinct from
        coalesce(v_new_player->>'id',v_new_player->>'playerId',v_new_player->>'name') or
       (v_old_player-v_allowed_player_keys) is distinct from (v_new_player-v_allowed_player_keys) then
       raise exception 'Extension cannot alter player identity, team or ratings';end if;
     if v_old_player is not distinct from v_new_player then continue;end if;
     v_modified:=v_modified+1;
     if p_action='offer' and (v_old_team->>'name' is distinct from v_team or
       coalesce(v_old_player->>'id',v_old_player->>'playerId') is distinct from p_player_id) then
       raise exception 'A GM may extend only their selected roster player';end if;
     if p_action='close' and exists(select 1 from public.bm_online_lobby_members m
        where m.lobby_id=p_lobby and m.team_name=v_old_team->>'name') then
       raise exception 'CPU deadline cannot negotiate for human-controlled team';end if;
     if v_old_player->'contract' is distinct from v_new_player->'contract' then
       if pg_catalog.jsonb_typeof(v_old_player#>'{contract,salaryByYear}')<>'array' or
          pg_catalog.jsonb_typeof(v_new_player#>'{contract,salaryByYear}')<>'array' or
          v_old_player#>>'{contract,startYear}' is distinct from v_new_player#>>'{contract,startYear}' then
         raise exception 'Extension modified the existing contract term';end if;
       v_old_salaries:=v_old_player#>'{contract,salaryByYear}';
       v_new_salaries:=v_new_player#>'{contract,salaryByYear}';
       if pg_catalog.jsonb_array_length(v_new_salaries)<pg_catalog.jsonb_array_length(v_old_salaries) or
         pg_catalog.jsonb_array_length(v_new_salaries)>pg_catalog.jsonb_array_length(v_old_salaries)+5 then
         raise exception 'Extension salary years are invalid';end if;
       if pg_catalog.jsonb_array_length(v_old_salaries)>0 then
        for v_si in 0..pg_catalog.jsonb_array_length(v_old_salaries)-1 loop
         if v_old_salaries->v_si is distinct from v_new_salaries->v_si then
           raise exception 'Extension rewrote guaranteed salary in an existing year';end if;
        end loop;
       end if;
       if v_new_player#>'{contract,extensionMeta}' is null then
         raise exception 'Extended player is missing the original contract extension metadata';end if;
     end if;
    end loop;
   end if;
  end loop;
 if p_action='offer' and v_modified>1 then raise exception 'One extension offer changed multiple players';end if;
 if p_action='close' and p_updated_state#>>'{contractExtensionState,closedDate}' is null then
   raise exception 'Deadline closure is missing the extension history date';end if;
 if p_action='close' then
   p_updated_state:=pg_catalog.jsonb_set(p_updated_state,'{onlineCheckpoints}',
     coalesce(v_old->'onlineCheckpoints','{}'::jsonb)||pg_catalog.jsonb_build_object(
       'veteran_extension',pg_catalog.jsonb_build_object('status','closed','date',v_date,
         'seasonYear',v_year,'revision',v_revision+1,'closedBy',p_actor)),true);
 end if;
 update public.bm_online_franchise_runtime set state=p_updated_state,revision=v_revision+1,updated_at=now()
   where lobby_id=p_lobby;
 v_details:=pg_catalog.jsonb_build_object('date',p_date,'season_year',v_year,
   'changed_players',v_modified);
 if p_action='offer' then
   v_details:=v_details||pg_catalog.jsonb_build_object('team',v_team,'player_id',p_player_id,
     'offer',p_offer,'accepted',v_modified>0);
 end if;
 insert into public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
 values(p_lobby,v_revision+1,p_request,p_actor,
   case when p_action='offer' then 'contract_extension_offered' else 'veteran_extensions_closed' end,
   v_details);
 return pg_catalog.jsonb_build_object('ok',true,'revision',v_revision+1,
   'accepted',case when p_action='offer' then v_modified>0 else null end,
   'changed_players',v_modified);
end $$;
revoke all on function public.bm_online_commit_extension_phase2d2f(uuid,uuid,uuid,bigint,text,text,text,jsonb,jsonb)
 from public,anon,authenticated;
grant execute on function public.bm_online_commit_extension_phase2d2f(uuid,uuid,uuid,bigint,text,text,text,jsonb,jsonb)
 to service_role;

-- Defense in depth against old simulation backends that don't know about
-- extension windows. Once closed, same-season marker cannot be rewritten.
create or replace function public.bm_online_veteran_extension_guard_phase2d2f()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_date text;v_closed boolean;v_results_old jsonb;v_results_new jsonb;v_next_date text;
begin
 v_closed:=old.state#>>'{onlineCheckpoints,veteran_extension,status}'='closed';
 if v_closed and old.state#>>'{onlineSchedule,seasonYear}'=
     new.state#>>'{onlineSchedule,seasonYear}' and
   (new.state#>'{onlineCheckpoints,veteran_extension}' is distinct from
    old.state#>'{onlineCheckpoints,veteran_extension}' or
    new.state->'contractExtensionState' is distinct from old.state->'contractExtensionState')
 then raise exception 'Finalized veteran extensions cannot be changed in this season';end if;
 v_results_old:=coalesce(old.state->'onlineResults','{}'::jsonb);
 v_results_new:=coalesce(new.state->'onlineResults','{}'::jsonb);
 if pg_catalog.jsonb_typeof(v_results_old)<>'object' or pg_catalog.jsonb_typeof(v_results_new)<>'object' then
   raise exception 'Shared online game results ledger is invalid';end if;
 if new.state#>>'{onlineCheckpoints,veteran_extension,status}' is distinct from 'closed' and
   v_results_old is distinct from v_results_new then
   select min(r.value->>'date') into v_next_date from pg_catalog.jsonb_each(v_results_new) r
     where not(v_results_old ? r.key);
   if v_next_date is not null then
     v_date:=public.bm_online_veteran_extension_date_phase2d2f(new.state);
     if v_next_date>=v_date then
       raise exception 'Cannot simulate past an unresolved veteran extension deadline';end if;
   end if;
 end if;
 return new;
end $$;
revoke all on function public.bm_online_veteran_extension_guard_phase2d2f() from public,anon,authenticated;
drop trigger if exists bm_online_veteran_extension_runtime_guard on public.bm_online_franchise_runtime;
create trigger bm_online_veteran_extension_runtime_guard before update on public.bm_online_franchise_runtime
 for each row execute function public.bm_online_veteran_extension_guard_phase2d2f();
commit;
