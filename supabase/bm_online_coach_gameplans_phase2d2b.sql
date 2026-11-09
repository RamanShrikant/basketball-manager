-- Phase 2D.2-B: online-only, roster-owned coaching gameplans.
-- Run MANUALLY after online runtime, event journal, calendar and game-day simulation migrations.
-- Browser can choose order/minutes; only this function can write to the shared franchise.
-- Simulation validates saved plans again against the live roster and injuries.
begin;
create or replace function public.bm_online_save_coach_gameplan_phase2d2b(
  p_lobby uuid, p_request uuid, p_expected_revision bigint,
  p_order text[], p_minutes jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_status text;
  v_team text;
  v_state jsonb;
  v_revision bigint;
  v_prior public.bm_online_franchise_events%rowtype;
  v_team_data jsonb;
  v_roster jsonb;
  v_list jsonb;
  v_candidate jsonb;
  v_player jsonb;
  v_name text;
  v_idx integer;
  v_count integer := 0;
  v_minutes integer;
  v_total integer := 0;
  v_date text;
  v_results jsonb;
  v_by_date jsonb;
  v_plan jsonb;
  v_player_ids jsonb := '{}'::jsonb;
  v_updated jsonb;
begin
  if v_actor is null then raise exception 'Sign in before editing an Online gameplan';end if;
  if p_lobby is null or p_request is null or p_expected_revision is null or p_expected_revision<1 or
    p_order is null or cardinality(p_order)<5 or cardinality(p_order)>30 or
    jsonb_typeof(p_minutes)<>'object' or
    (select count(*) from jsonb_object_keys(p_minutes))<>cardinality(p_order) or
    exists(select 1 from unnest(p_order) name where name is null or length(btrim(name))=0 or length(name)>150) or
    (select count(distinct name) from unnest(p_order) name)<>cardinality(p_order)
  then raise exception 'Invalid Online gameplan request';end if;

  select r.state,r.revision into v_state,v_revision
    from public.bm_online_franchise_runtime r where r.lobby_id=p_lobby for update;
  if not found then raise exception 'Online franchise is unavailable';end if;
  select l.status,m.team_name into v_status,v_team
    from public.bm_online_lobbies l
    join public.bm_online_lobby_members m on m.lobby_id=l.id and m.user_id=v_actor
    where l.id=p_lobby;
  if not found or v_status<>'started' or nullif(btrim(v_team),'') is null
    then raise exception 'Only an assigned GM may edit their team gameplan';end if;

  select * into v_prior from public.bm_online_franchise_events
    where lobby_id=p_lobby and request_id=p_request;
  if found then
    if v_prior.actor_id is distinct from v_actor or v_prior.action_type is distinct from 'coach_gameplan_saved' or
       v_prior.details->>'team' is distinct from v_team or
       v_prior.details->'order' is distinct from to_jsonb(p_order) or
       v_prior.details->'minutes' is distinct from p_minutes
    then raise exception 'Request ID already used for another action';end if;
    return jsonb_build_object('ok',true,'replayed',true,'revision',v_prior.revision,'team',v_team);
  end if;
  if v_revision<>p_expected_revision then raise exception 'Shared franchise changed; refresh before saving gameplan';end if;
  if jsonb_typeof(v_state)<>'object' then raise exception 'Invalid shared franchise state';end if;
  if jsonb_typeof(v_state->'onlineGameplans') not in ('object') and v_state ? 'onlineGameplans'
    then raise exception 'Online gameplan ledger is invalid';end if;

  -- Resolve the controlled team exactly once. Never trust a team name from browser.
  for v_list in select v_state->'teams' union all select v_state#>'{conferences,East}' union all select v_state#>'{conferences,West}' loop
    if jsonb_typeof(v_list) <> 'array' then continue;end if;
    for v_candidate in select value from jsonb_array_elements(v_list) loop
      if v_candidate->>'name'=v_team then
        v_count:=v_count+1;
        v_team_data:=v_candidate;
      end if;
    end loop;
  end loop;
  if v_count<>1 or jsonb_typeof(v_team_data->'players')<>'array'
    then raise exception 'Assigned GM team cannot be resolved uniquely';end if;
  v_roster:=v_team_data->'players';
  if jsonb_array_length(v_roster)<>cardinality(p_order)
    then raise exception 'Gameplan roster has changed';end if;

  -- Derive next game date from locked shared schedule for injury eligibility.
  v_results:=coalesce(v_state->'onlineResults','{}'::jsonb);
  v_by_date:=v_state#>'{onlineSchedule,byDate}';
  if jsonb_typeof(v_by_date)='object' and jsonb_typeof(v_results)='object' then
    select min(d.key) into v_date from jsonb_each(v_by_date) d
    where jsonb_typeof(d.value)='array' and exists (
      select 1 from jsonb_array_elements(d.value) g where not (v_results ? (g.value->>'id'))
    );
  end if;
  for v_idx in 1..cardinality(p_order) loop
    v_name:=p_order[v_idx];
    if not p_minutes ? v_name or (p_minutes->>v_name) !~ '^(0|[1-9][0-9]?)$'
      then raise exception 'Every player must have whole-number minutes';end if;
    v_minutes:=(p_minutes->>v_name)::integer;
    if v_minutes < (case when v_idx<=5 then 1 else 0 end) or
       v_minutes > (case when v_idx<=5 then 48 else 47 end)
      then raise exception 'Invalid starter or bench minute limit';end if;
    select value into v_player from jsonb_array_elements(v_roster)
      where value->>'name'=v_name;
    if not found or (select count(*) from jsonb_array_elements(v_roster) p where p.value->>'name'=v_name)<>1
      then raise exception 'Gameplan includes missing or duplicate roster player';end if;
    if nullif(coalesce(v_player->>'id',v_player->>'playerId',''),'') is null
      then raise exception 'Gameplan player needs a stable identity';end if;
    v_player_ids:=v_player_ids||jsonb_build_object(v_name,coalesce(v_player->>'id',v_player->>'playerId',''));
    if v_minutes>0 and jsonb_typeof(v_player->'injury')='object' and
       coalesce(v_player->'injury'->>'active','true')<>'false' and
       (v_date is null or coalesce(v_player#>>'{injury,returnDate}','9999-12-31')>v_date)
      then raise exception 'An injured player cannot receive minutes';end if;
    v_total:=v_total+v_minutes;
  end loop;
  if v_total<>240 then raise exception 'An Online gameplan must allocate exactly 240 minutes';end if;

  v_plan:=jsonb_build_object('teamName',v_team,'order',to_jsonb(p_order),'minutes',p_minutes,
    'source','coach_gameplan','manualLocked',true,'userEdited',true,'version',20,
    'rosterPlayerIds',v_player_ids,
    'updatedAt',extract(epoch from now())*1000);
  v_updated:=jsonb_set(v_state,'{onlineGameplans}',
    coalesce(v_state->'onlineGameplans','{}'::jsonb)||jsonb_build_object(v_team,v_plan),true);
  update public.bm_online_franchise_runtime set state=v_updated,revision=v_revision+1,updated_at=now()
    where lobby_id=p_lobby;
  insert into public.bm_online_franchise_events(lobby_id,revision,request_id,actor_id,action_type,details)
  values(p_lobby,v_revision+1,p_request,v_actor,'coach_gameplan_saved',
    jsonb_build_object('team',v_team,'order',to_jsonb(p_order),'minutes',p_minutes));
  return jsonb_build_object('ok',true,'team',v_team,'revision',v_revision+1);
end;
$$;
revoke all on function public.bm_online_save_coach_gameplan_phase2d2b(uuid,uuid,bigint,text[],jsonb) from public,anon;
grant execute on function public.bm_online_save_coach_gameplan_phase2d2b(uuid,uuid,bigint,text[],jsonb) to authenticated;
commit;
