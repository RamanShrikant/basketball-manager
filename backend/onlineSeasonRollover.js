// Phase 2E.4-E: host-only, server-authoritative transition to the next NBA season.
// Roster players, salary arrays and draft asset ownership never come from a browser.
import {createHash} from 'node:crypto';
import {compactSchedule} from './onlineCalendar.js';
import {planOnlineFutureDraftRights} from './onlineFutureDraftRights.js';

const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const usage=new Map();
function fail(status,message){const error=new Error(message);error.status=status;throw error;}
function teams(s){return Array.isArray(s?.teams)?s.teams:[...(s?.conferences?.East||[]),...(s?.conferences?.West||[])];}
export function rolloverReady(state){
 const y=Number(state?.onlineSchedule?.seasonYear),next=y+1;
 if(!Number.isInteger(y)||y<2025||y>2094||
    state?.onlinePostseason?.phase!=='postseasonComplete'||
    Number(state.onlinePostseason.seasonYear)!==y||!state.onlinePostseason.champion||
    state?.onlineDraft?.status!=='complete'||Number(state.onlineDraft.draftYear)!==next||
    state?.onlineRetirements?.status!=='complete'||
    state?.onlineRookieSignings?.status!=='complete'||
    state?.onlineOptions?.status!=='complete'||Number(state.onlineOptions.year)!==next||
    state?.onlineRights?.status!=='complete'||Number(state.onlineRights.year)!==next||
    state?.onlineOffseasonMarket?.status!=='complete'||Number(state.onlineOffseasonMarket.year)!==next||
    state?.onlineProgression?.status!=='complete'||Number(state.onlineProgression.seasonYear)!==next||
    state?.offseasonState?.active!==true||
    !['retirementsComplete','rookieSigningsComplete','optionsComplete','rightsManagementComplete','freeAgencyComplete','progressionComplete'].every(k=>state.offseasonState?.[k]===true)||
    state?.freeAgencyState?.marketComplete!==true||state?.freeAgencyState?.isActive!==false||
    (state.onlineOffseasonMarket?.pendingUserDecisions||[]).length||
    (state.onlineOffseasonMarket?.pendingRfaMatchDecisions||[]).length||
    (state.freeAgencyState?.pendingUserDecisions||[]).length||
    (state.freeAgencyState?.pendingRfaMatchDecisions||[]).length)
   fail(409,'Finish the championship, draft, all offseason decisions, ten-day market, and player progression before starting another season.');
 const list=teams(state);
 if(list.length!==30||list.some(t=>!t?.name)||new Set(list.map(t=>t.name)).size!==30)
   fail(409,'Next season requires all 30 NBA franchises.');
 if(state.onlineSeasonHistory!==undefined&&!Array.isArray(state.onlineSeasonHistory))
   fail(409,'Malformed NBA season-history ledger.');
 if((state.onlineSeasonHistory||[]).some(row=>Number(row.seasonYear)===y))
   fail(409,'This championship season was already archived. Refresh the franchise.');
 const ids=new Set();
 for(const p of [...list.flatMap(t=>['players','twoWayPlayers','stashPlayers','pendingRookieSignings'].flatMap(k=>t[k]||[])),...(state.freeAgents||[])]){
   if(!p?.id||ids.has(String(p.id)))fail(409,'Duplicate or missing player identity; rollover cannot proceed.');
   ids.add(String(p.id));
 }
 if(list.some(t=>(t.pendingRookieSignings||[]).length))fail(409,'Unsigned rookie rights remain; finish rookie signings first.');
 if(state?.onlineSchedule?.byDate==null||!state.onlineResults||Object.keys(state.onlineResults).length!==1230)
   fail(409,'Final regular-season results are incomplete.');
 // Validate the canonical pick ledger before requesting the locked SQL rollover.
 const picks=planOnlineFutureDraftRights(state,next);
 return {fromYear:y,toYear:next,champion:state.onlinePostseason.champion,teamCount:30,
   playerCount:ids.size,newFutureDraftYear:picks.futureYear,futureDraftRightsAdded:picks.addedCount};
}
export function buildRolloverCalendar(state){
 const details=rolloverReady(state);
 // seasonContext.js expects the season-opening year for salary and schedule indexing.
 const base={...state,seasonYear:details.toYear,currentSeasonYear:details.toYear,
   seasonStartYear:details.toYear,displaySeasonYear:details.toYear+1,
   seasonEndYear:details.toYear+1,calendar:{}};
 const schedule=compactSchedule(base);
 if(schedule.year!==details.toYear||schedule.gameCount!==1230)fail(409,'Original NBA scheduler could not build the next season.');
 return {details,byDate:schedule.byDate};
}
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function config(){const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key||!/^https:\/\/[a-z0-9.-]+$/i.test(url))fail(503,'Trusted online rollover backend is unavailable');
 return {url:url.replace(/\/$/,''),key};}
async function read(c,path,token=c.key){
 const r=await fetch(`${c.url}${path}`,{headers:{apikey:c.key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
 if(!r.ok)fail(r.status===401?401:503,'Unable to verify the online franchise');return r.json();}
export async function onlineSeasonRolloverRequest(req,res){
 res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
 try{
   const b=req.body;
   if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['lobbyId','requestId','expectedRevision'].includes(k))||
      !UUID.test(String(b.lobbyId||''))||!UUID.test(String(b.requestId||''))||
      !Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<1)fail(400,'Invalid next-season request');
   const bearer=String(req.get('authorization')||'').match(/^Bearer ([a-z\d_.-]{20,5000})$/i)?.[1];
   if(!bearer)fail(401,'Sign in to the shared franchise');
   const c=config(),user=await read(c,'/auth/v1/user',bearer);
   if(!UUID.test(String(user?.id||'')))fail(401,'Invalid authenticated account');
   const now=Date.now(),old=usage.get(user.id),current=!old||now-old.start>60000?{start:now,count:1}:{...old,count:old.count+1};
   usage.set(user.id,current);if(current.count>5)fail(429,'Too many season transition attempts');
   const [lobbies,members,events]=await Promise.all([
      read(c,`/rest/v1/bm_online_lobbies?id=eq.${b.lobbyId}&select=host_id,status`),
      read(c,`/rest/v1/bm_online_lobby_members?lobby_id=eq.${b.lobbyId}&select=user_id`),
      read(c,`/rest/v1/bm_online_franchise_events?lobby_id=eq.${b.lobbyId}&request_id=eq.${b.requestId}&select=actor_id,action_type,revision,details`)]);
   if(lobbies.length!==1||lobbies[0].status!=='started'||lobbies[0].host_id!==user.id||
      !members.some(m=>m.user_id===user.id))fail(403,'Only the host of this started NBA league may transition the season');
   const inputHash=hash({action:'online_season_rollover',lobbyId:b.lobbyId,expectedRevision:b.expectedRevision});
   if(events.length){const e=events[0];if(e.actor_id!==user.id||e.action_type!=='online_season_rollover'||e.details?.inputHash!==inputHash)
      fail(409,'Request identifier belongs to a different operation');
     return res.json({ok:true,replayed:true,revision:e.revision,toYear:e.details?.toYear});}
   const runtimes=await read(c,`/rest/v1/bm_online_franchise_runtime?lobby_id=eq.${b.lobbyId}&select=state,revision`);
   if(runtimes.length!==1||Number(runtimes[0].revision)!==b.expectedRevision)fail(409,'Franchise revision changed; refresh before rollover');
   const {details,byDate}=buildRolloverCalendar(runtimes[0].state);
   const r=await fetch(`${c.url}/rest/v1/rpc/bm_online_rollover_season_phase2e4e`,{
     method:'POST',headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,'Content-Type':'application/json'},
     body:JSON.stringify({p_lobby:b.lobbyId,p_actor:user.id,p_request:b.requestId,p_expected_revision:b.expectedRevision,
       p_from_year:details.fromYear,p_to_year:details.toYear,p_input_hash:inputHash,p_by_date:byDate}),
     signal:AbortSignal.timeout(90000)});
   const result=await r.json().catch(()=>null);
   if(!r.ok||result?.ok!==true)fail(409,`Season rollover not committed. ${String(result?.message||'Refresh and review the league.').slice(0,240)}`);
   return res.json({ok:true,revision:result.revision,toYear:details.toYear,replayed:result.replayed===true});
 }catch(error){return res.status(error.status||503).json({ok:false,error:error.status===503?'The trusted NBA transition service is unavailable.':String(error.message||error).slice(0,360)});}
}
