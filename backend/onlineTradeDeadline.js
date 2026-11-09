// Phase 2D.2-D. Trusted host-only completion of the trade-deadline checkpoint.
// The browser cannot supply an actor, date, league state, or trade-window status.
import {firstBlockedOnlineCheckpoint,pendingOnlineGameDays} from '../frontend/src/online/onlineSimulationCheckpoints.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const budget=new Map();
function fail(code,message){const err=new Error(message);err.status=code;throw err;}
function env(){
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key||!/^https:\/\/[a-z0-9.-]+$/i.test(url))fail(503,'Trusted league-management service is not configured.');
  return {url:url.replace(/\/$/,''),key};
}
async function read(c,path){
  const r=await fetch(`${c.url}${path}`,{headers:{apikey:c.key,Authorization:`Bearer ${c.key}`},signal:AbortSignal.timeout(14000)});
  if(!r.ok)fail(503,'Could not verify the shared league.');
  return r.json();
}
export function evaluateTradeDeadlineReadiness(state){
  const pending=pendingOnlineGameDays(state);
  if(!pending.length)fail(409,'There is no remaining scheduled regular-season game day.');
  if(pending[0].played)fail(409,'A partial game day must be repaired before closing the trade window.');
  const blocked=firstBlockedOnlineCheckpoint(state,pending[0].date);
  if(blocked?.kind!=='trade_deadline')fail(409,'The trade deadline is not the next required league checkpoint.');
  return {date:blocked.date,nextGameDate:pending[0].date};
}
export async function closeOnlineTradeDeadlineRequest(req,res){
  res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
  try{
    const body=req.body||{};
    if(!UUID.test(String(body.lobbyId||''))||!UUID.test(String(body.requestId||''))||
      !Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<1||
      Object.keys(body).some(k=>!['lobbyId','requestId','expectedRevision'].includes(k)))
      fail(400,'Invalid trade-deadline request.');
    const bearer=String(req.get('authorization')||'').match(/^Bearer ([A-Za-z0-9_.-]{20,5000})$/)?.[1];
    if(!bearer)fail(401,'Sign in before managing the online deadline.');
    const c=env();
    const auth=await fetch(`${c.url}/auth/v1/user`,{headers:{apikey:c.key,Authorization:`Bearer ${bearer}`},signal:AbortSignal.timeout(12000)});
    if(!auth.ok)fail(401,'Online session expired.');
    const user=await auth.json();
    if(!UUID.test(String(user?.id||'')))fail(401,'Invalid online account.');
    const now=Date.now();
    for(const [k,v] of budget)if(now-v.at>60000)budget.delete(k);
    const old=budget.get(user.id),hits=(old?.hits||0)+1;
    if(hits>8)fail(429,'Too many checkpoint requests.');
    budget.set(user.id,{at:old?.at||now,hits});
    const lobbies=await read(c,`/rest/v1/bm_online_lobbies?id=eq.${body.lobbyId}&select=host_id,status`);
    if(lobbies.length!==1||lobbies[0].status!=='started'||lobbies[0].host_id!==user.id)
      fail(403,'Only the host of the started franchise can finalize the deadline.');
    const members=await read(c,`/rest/v1/bm_online_lobby_members?lobby_id=eq.${body.lobbyId}&user_id=eq.${user.id}&select=user_id`);
    if(members.length!==1)fail(403,'The league host is no longer a lobby member.');
    const previous=await read(c,`/rest/v1/bm_online_franchise_events?lobby_id=eq.${body.lobbyId}&request_id=eq.${body.requestId}&select=actor_id,action_type,revision,details`);
    if(previous.length){
      const row=previous[0];
      if(row.actor_id!==user.id||row.action_type!=='trade_deadline_closed')
        fail(409,'That request ID belongs to another operation.');
      return res.json({ok:true,replayed:true,revision:row.revision,date:row.details?.date,offersClosed:row.details?.offers_closed});
    }
    const runtime=await read(c,`/rest/v1/bm_online_franchise_runtime?lobby_id=eq.${body.lobbyId}&select=revision,state`);
    if(runtime.length!==1||Number(runtime[0].revision)!==body.expectedRevision)
      fail(409,'The online league changed. Refresh before closing the deadline.');
    const checkpoint=evaluateTradeDeadlineReadiness(runtime[0].state);
    const r=await fetch(`${c.url}/rest/v1/rpc/bm_online_close_trade_deadline_phase2d2d`,{
      method:'POST',headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,'Content-Type':'application/json'},
      body:JSON.stringify({p_lobby:body.lobbyId,p_actor:user.id,p_request:body.requestId,
        p_expected_revision:body.expectedRevision,p_date:checkpoint.date}),signal:AbortSignal.timeout(30000)
    });
    const result=await r.json().catch(()=>null);
    if(!r.ok||!result?.ok)fail(409,'Deadline was not confirmed. Refresh the franchise; do not assume it closed.');
    return res.json({ok:true,date:checkpoint.date,revision:result.revision,offersClosed:result.offers_closed||0,replayed:!!result.replayed});
  }catch(e){
    return res.status(e.status||503).json({ok:false,error:e.status===503?'Online league-management service temporarily unavailable.':e.message});
  }
}
