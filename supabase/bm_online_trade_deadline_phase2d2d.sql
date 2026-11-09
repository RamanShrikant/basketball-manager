-- Phase 2D.2-D: trusted trade-deadline closure and independent database guards.
-- MANUAL MIGRATION. Requires online runtime/events, human trade offers, and calendar/simulation migrations.
-- Does NOT implement All-Star, veteran extensions, postseason, or CPU season transactions.
begin;

-- Derive the server-side deadline independently of caller-supplied dates.
-- Mirrors getSeasonCalendarConfig: calendar.tradeDeadlineDate for the correct year,
-- otherwise Feb 4 of the NBA season's concluding year.
create or replace function public.bm_online_trade_deadline_for_state(p_state jsonb)
returns text language plpgsql stable set search_path = '' as $$
declare
 v_year int;v_date text;v_expected text;
begin
 v_year:=case when (p_state#>>'{onlineSchedule,seasonYear}') ~ '^20[0-9]{2}$'
    then (p_state#>>'{onlineSchedule,seasonYear}')::int else null end;
 if v_year is null or v_year not between 2025 and 2094 then
   raise exception 'Online season calendar has no supported season year'; end if;
 v_expected:=to_char(pg_catalog.make_date(v_year+1,2,4),'YYYY-MM-DD');
 v_date:=p_state#>>'{calendar,tradeDeadlineDate}';
 if v_date ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' and
    pg_catalog.substring(v_date, 1, 4)::int=v_year+1 then
   begin
     if pg_catalog.to_char(v_date::date,'YYYY-MM-DD')=v_date then return v_date;end if;
   exception when invalid_datetime_format or datetime_field_overflow then null;
   end;
 end if;
 v_date:=p_state#>>'{calendar,tradeDeadline}';
 if v_date ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' and
    pg_catalog.substring(v_date, 1, 4)::int=v_year+1 then
   begin
     if pg_catalog.to_char(v_date::date,'YYYY-MM-DD')=v_date then return v_date;end if;
   exception when invalid_datetime_format or datetime_field_overflow then null;
   end;
 end if;
 return v_expected;
end $$;
revoke all on function public.bm_online_trade_deadline_for_state(jsonb) from public,anon,authenticated;
grant execute on function public.bm_online_trade_deadline_for_state(jsonb) to service_role;

create or replace function public.bm_online_close_trade_deadline_phase2d2d(
 p_lobby uuid,p_actor uuid,p_request uuid,p_expected_revision bigint,p_date text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_state jsonb;v_revision bigint;v_host uuid;v_status text;
 v_previous public.bm_online_franchise_events%rowtype;
 v_deadline text;v_next text;v_games jsonb;v_results jsonb;
 v_new jsonb;v_pending_count int;v_year int;
begin
 if p_lobby is null or p_actor is null or p_request is null or p_expected_revision is null or
    p_expected_revision<1 or p_date is null then raise exception 'Invalid deadline request'; end if;
 select state,revision into v_state,v_revision from public.bm_online_franchise_runtime
   where lobby_id=p_lobby for update;
 if not found then raise exception 'Online league is missing';end if;
 select host_id,status into v_host,v_status from public.bm_online_lobbies where id=p_lobby;
 if v_host is distinct from p_actor or v_status<>'started' or not exists(
   select 1 from public.bm_online_lobby_members where lobby_id=p_lobby and user_id=p_actor)
   then raise exception 'Only the current league host may finalize the deadline';end if;
 v_deadline:=public.bm_online_trade_deadline_for_state(v_state);
 if p_date<>v_deadline then raise exception 'Trade deadline does not match season rules';end if;
 select * into v_previous from public.bm_online_franchise_events
   where lobby_id=p_lobby and request_id=p_request;
 if found then
   if v_previous.actor_id<>p_actor or v_previous.action_type<>'trade_deadline_closed' or
      v_previous.details->>'date'<>p_date then raise exception 'Request ID belongs to a different operation';end if;
   return jsonb_build_object('ok',true,'replayed',true,'revision',v_previous.revision,
     'date',p_date,'offers_closed',v_previous.details->'offers_closed');
 end if;
 if v_revision<>p_expected_revision then raise exception 'League revision changed. Refresh and retry';end if;
 if v_state#>>'{onlineSchedule,phase}'<>'regular-season' then
   raise exception 'This checkpoint requires the active regular-season calendar';end if;
 if v_state#>>'{onlineCheckpoints,trade_deadline,status}'='closed' then
   raise exception 'This trade deadline was already finalized';end if;
 v_games:=v_state#>'{onlineSchedule,byDate}';
 v_results:=coalesce(v_state->'onlineResults','{}'::jsonb);
 if pg_catalog.jsonb_typeof(v_games)<>'object' or pg_catalog.jsonb_typeof(v_results)<>'object' then
   raise exception 'Online schedule or result ledger is malformed';end if;
 -- Only close when every scheduled game strictly before the deadline was committed.
 -- A partial game day may never be used to leap over a management checkpoint.
 select min(d.key) into v_next from pg_catalog.jsonb_each(v_games) d
   where exists (select 1 from pg_catalog.jsonb_array_elements(d.value) g
     where not (v_results ? (g.value->>'id')));
 if v_next is null or v_next<=v_deadline then
   raise exception 'Finish all pre-deadline games before closing the trade window';end if;
 if exists(select 1 from pg_catalog.jsonb_array_elements(v_games->v_next) g
   where v_results ? (g.value->>'id')) then
   raise exception 'A partially simulated game day must be repaired first';end if;
 v_year:=(v_state#>>'{onlineSchedule,seasonYear}')::int;
 v_new:=pg_catalog.jsonb_set(v_state,'{onlineCheckpoints}',
   coalesce(v_state->'onlineCheckpoints','{}'::jsonb)||
   jsonb_build_object('trade_deadline',jsonb_build_object(
     'status','closed','date',v_deadline,'seasonYear',v_year,
     'closedBy',p_actor,'revision',v_revision+1)),true);
 -- Row lock prevents interleaving with trade RPCs; the journal will reflect
 -- both this closure and automatic cancellation of any outstanding offers.
 update public.bm_online_franchise_runtime
   set state=v_new,revision=v_revision+1,updated_at=now() where lobby_id=p_lobby;
 with cancelled as (
   update public.bm_online_trade_offers set status='cancelled',resolved_at=now()
   where lobby_id=p_lobby and status='pending' returning id
 ) select count(*) into v_pending_count from cancelled;
 insert into public.bm_online_franchise_events
   (lobby_id,revision,request_id,actor_id,action_type,details)
 values(p_lobby,v_revision+1,p_request,p_actor,'trade_deadline_closed',
    jsonb_build_object('date',v_deadline,'season_year',v_year,'offers_closed',v_pending_count));
 return jsonb_build_object('ok',true,'revision',v_revision+1,'date',v_deadline,
    'offers_closed',v_pending_count);
end $$;
revoke all on function public.bm_online_close_trade_deadline_phase2d2d(uuid,uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.bm_online_close_trade_deadline_phase2d2d(uuid,uuid,uuid,bigint,text) to service_role;

-- Fail closed regardless of which historical trade RPC the client calls.
-- Offer inserts and acceptance both read the *locked* franchise state; the
-- trade RPCs already acquire that row lock before manipulating offers.
create or replace function public.bm_online_closed_trade_offer_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_state jsonb;
begin
 if (tg_op='INSERT' and new.status='pending') or
    (tg_op='UPDATE' and new.status='accepted' and old.status is distinct from new.status) then
   select state into v_state from public.bm_online_franchise_runtime where lobby_id=new.lobby_id;
   if v_state#>>'{onlineCheckpoints,trade_deadline,status}'='closed' then
     raise exception 'The Online trade deadline is closed';end if;
 end if;
 return new;
end $$;
revoke all on function public.bm_online_closed_trade_offer_guard() from public,anon,authenticated;
drop trigger if exists bm_online_trade_offer_deadline_guard on public.bm_online_trade_offers;
create trigger bm_online_trade_offer_deadline_guard
before insert or update on public.bm_online_trade_offers
for each row execute function public.bm_online_closed_trade_offer_guard();

-- Guard legacy CPU/human commit functions that may have been installed in
-- earlier phases. An event failure rolls back that transaction's roster write.
create or replace function public.bm_online_closed_trade_event_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_state jsonb;
begin
 if new.action_type in ('human_trade_accepted','cpu_trade_accepted') or
    new.action_type ~* '(^|_)trade_(executed|approved|completed)$' then
   select state into v_state from public.bm_online_franchise_runtime where lobby_id=new.lobby_id;
   if v_state#>>'{onlineCheckpoints,trade_deadline,status}'='closed' then
     raise exception 'The Online trade deadline is closed';end if;
 end if;
 return new;
end $$;
revoke all on function public.bm_online_closed_trade_event_guard() from public,anon,authenticated;
drop trigger if exists bm_online_trade_event_deadline_guard on public.bm_online_franchise_events;
create trigger bm_online_trade_event_deadline_guard
before insert on public.bm_online_franchise_events
for each row execute function public.bm_online_closed_trade_event_guard();

-- Defense in depth: even an older backend running the previous simulation RPC
-- cannot insert results dated after the deadline before the checkpoint closes.
-- Also prevents the same season's closed marker from being overwritten by
-- later roster, signing, trade, gameplan, or simulation RPC updates.
create or replace function public.bm_online_deadline_runtime_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare
 v_closed_old boolean;v_closed_new boolean;v_date text;v_first_new text;
 v_old_results jsonb;v_new_results jsonb;
begin
 v_closed_old:=old.state#>>'{onlineCheckpoints,trade_deadline,status}'='closed';
 v_closed_new:=new.state#>>'{onlineCheckpoints,trade_deadline,status}'='closed';
 if v_closed_old and old.state#>>'{onlineSchedule,seasonYear}'=
       new.state#>>'{onlineSchedule,seasonYear}' and
    new.state#>'{onlineCheckpoints,trade_deadline}' is distinct from
      old.state#>'{onlineCheckpoints,trade_deadline}' then
   raise exception 'Cannot rewrite a finalized trade deadline in this season';end if;
 v_old_results:=coalesce(old.state->'onlineResults','{}'::jsonb);
 v_new_results:=coalesce(new.state->'onlineResults','{}'::jsonb);
 if pg_catalog.jsonb_typeof(v_new_results)<>'object' or pg_catalog.jsonb_typeof(v_old_results)<>'object' then
   raise exception 'Online results ledger must remain an object';end if;
 if not v_closed_new and v_old_results is distinct from v_new_results then
   select min(r.value->>'date') into v_first_new from pg_catalog.jsonb_each(v_new_results) r
      where not (v_old_results ? r.key);
   if v_first_new is not null then
     v_date:=public.bm_online_trade_deadline_for_state(new.state);
     if v_first_new>=v_date then
       raise exception 'Cannot simulate past an unresolved Online trade deadline';end if;
   end if;
 end if;
 return new;
end $$;
revoke all on function public.bm_online_deadline_runtime_guard() from public,anon,authenticated;
drop trigger if exists bm_online_deadline_runtime_guard on public.bm_online_franchise_runtime;
create trigger bm_online_deadline_runtime_guard
before update on public.bm_online_franchise_runtime
for each row execute function public.bm_online_deadline_runtime_guard();

commit;
