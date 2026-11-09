// Phase 2E.3-B. Original single-player retirement calculation behind a trusted,
// host-owned revisioned transaction. No local save or browser-provided roll.
import {spawnSync} from 'node:child_process';
import {runOriginalInWorker} from './onlineOriginalWorkerPool.mjs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const worker=fileURLToPath(new URL('./online_retirement_python/online_retirement_worker.py',import.meta.url));
const attempts=new Map();
const fail=(status,message)=>{const e=new Error(message);e.status=status;throw e;};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const teams=s=>Array.isArray(s?.teams)?s.teams:[...(s?.conferences?.East||[]),...(s?.conferences?.West||[])];
const json=x=>JSON.stringify(x);
function ready(state){
 const season=Number(state?.onlinePostseason?.seasonYear);
 if(state?.onlinePostseason?.phase!=='postseasonComplete'||!state.onlinePostseason.champion||
    !Number.isInteger(season)||season<2025||season>2099)
  fail(409,'Complete the official NBA Finals before player retirements.');
 if(state.onlineDraftLottery||state.onlineDraft||state.onlineDraftRights?.status==='settled')
  fail(409,'The lottery has already started. Retirements belong before the lottery in the original single-player offseason.');
 if(state.onlineRetirements?.status==='complete'||state.offseasonState?.retirementsComplete)
  fail(409,'The official retirement event has already completed for this offseason.');
 if(teams(state).length!==30||new Set(teams(state).map(t=>t?.name)).size!==30)
  fail(409,'The shared league must contain all 30 NBA teams.');
 return season+1;
}
export function originalRetirementRun(state,{mode='commit',seasonYear}={}){
 const executable=process.env.BM_PYTHON_BIN||(process.platform==='win32'?'python':'python3');
 const ret=spawnSync(executable,['-I',worker],{input:json({league:state,mode,
    seasonYear,statsByKey:state.onlinePlayerStats||{}}),encoding:'utf8',timeout:60000,
   maxBuffer:16*1024*1024,windowsHide:true});
 if(ret.error||ret.status!==0||!ret.stdout)fail(503,'Original retirement engine unavailable; no roster changes were committed.');
 let out;try{out=JSON.parse(ret.stdout);}catch{fail(503,'Original retirement engine returned invalid JSON.');}
 if(!out.ok)fail(409,out.reason||'The original retirement engine rejected this snapshot.');
 return out;
}
function indexPlayers(rows,label){
 if(!Array.isArray(rows))fail(409,`Invalid ${label} players.`);
 const seen=new Set();
 for(const p of rows){if(!p||p.id===null||p.id===undefined||!String(p.id).trim()||seen.has(String(p.id)))fail(409,`Missing or duplicate player ID in ${label}.`);seen.add(String(p.id));}
 return seen;
}
export function retirementTransaction(state,result,seasonYear){
 const updated=result?.leagueData;
 if(!updated||!Array.isArray(result.retiredPlayers)||!result.summary)fail(409,'Incomplete original retirement result.');
 const original=teams(state),next=teams(updated);
 if(next.length!==30||original.some((t,i)=>t.name!==next[i]?.name))fail(409,'Retirement engine changed team identities.');
 const oldBare=structuredClone(state),newBare=structuredClone(updated);
 const teamRemovals=[],freeRemovals=[],oldIds=new Set(),removedIds=new Set();
 for(let i=0;i<30;i++){
  const a=original[i],b=next[i];
  indexPlayers(a.players||[],a.name);indexPlayers(b.players||[],b.name);
  const keep=new Set((b.players||[]).map(p=>String(p.id)));
  const removed=(a.players||[]).filter(p=>!keep.has(String(p.id)));
  const derived=(a.players||[]).filter(p=>keep.has(String(p.id)));
  if(json(derived)!==json(b.players||[]))fail(409,'Retirement output changed a non-retired roster player.');
  for(const p of a.players||[]){if(oldIds.has(String(p.id)))fail(409,'Duplicate player ID across NBA rosters.');oldIds.add(String(p.id));}
  for(const p of removed){if(removedIds.has(String(p.id)))fail(409,'Duplicate retired player ID.');removedIds.add(String(p.id));teamRemovals.push({teamName:a.name,id:String(p.id)});}
  // A retirement operation may remove players, never rewrite contracts, team metadata,
  // pending rookies, two-way buckets, draft rights, game results, or injuries.
  const at=structuredClone(a),bt=structuredClone(b);delete at.players;delete bt.players;
  if(json(at)!==json(bt))fail(409,'Retirement engine changed unrelated team data.');
 }
 const oldFa=state.freeAgents||[],newFa=updated.freeAgents||[];
 indexPlayers(oldFa,'free agency');indexPlayers(newFa,'free agency');
 const faKeep=new Set(newFa.map(p=>String(p.id)));
 if(json(oldFa.filter(p=>faKeep.has(String(p.id))))!==json(newFa))fail(409,'Retirement engine rewrote free-agent data.');
 for(const p of oldFa){if(oldIds.has(String(p.id)))fail(409,'Player exists on roster and in free agency.');oldIds.add(String(p.id));}
 for(const p of oldFa.filter(p=>!faKeep.has(String(p.id)))){if(removedIds.has(String(p.id)))fail(409,'Duplicate free-agent retirement.');removedIds.add(String(p.id));freeRemovals.push(String(p.id));}
 const history=state.retiredPlayersHistory||[],nextHistory=updated.retiredPlayersHistory||[];
 if(!Array.isArray(history)||!Array.isArray(nextHistory)||
    json(nextHistory.slice(0,history.length))!==json(history)||
    json(nextHistory.slice(history.length))!==json(result.retiredPlayers))
  fail(409,'Original retirement history was changed inconsistently.');
 if(result.retiredPlayers.length!==removedIds.size||
    new Set(result.retiredPlayers.map(p=>String(p?.id))).size!==removedIds.size||
    result.retiredPlayers.some(p=>!removedIds.has(String(p.id))||!p.retired||Number(p.retiredSeasonYear)!==seasonYear))
  fail(409,'Retirement result does not match the exact removed player IDs.');
 const removeLeagueFields=obj=>{
   delete obj.teams;delete obj.conferences;delete obj.freeAgents;delete obj.retiredPlayersHistory;
   return obj;
 };
 if(json(removeLeagueFields(oldBare))!==json(removeLeagueFields(newBare)))
  fail(409,'Retirement engine changed unrelated shared league state.');
 if(!Number.isInteger(result.summary.retiredCount)||result.summary.retiredCount!==removedIds.size)
  fail(409,'Retirement count does not match removed players.');
 return {teamRemovals,freeRemovals,retiredPlayers:result.retiredPlayers,
   summary:result.summary,seasonYear};
}
function config(){
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key||!/^https:\/\/[\w.-]+$/i.test(url))fail(503,'Trusted online offseason backend is not configured.');
 return {url:url.replace(/\/$/,''),key};
}
async function query(c,path){
 const r=await fetch(`${c.url}${path}`,{headers:{apikey:c.key,Authorization:`Bearer ${c.key}`},signal:AbortSignal.timeout(18000)});
 if(!r.ok)fail(503,'Cannot read the current shared league.');return r.json();
}
export async function onlineRetirementRequest(req,res,mode){
 res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
 try{
  const b=req.body||{};
  const allowed=mode==='preview'?['lobbyId','expectedRevision']:['lobbyId','expectedRevision','requestId'];
  if(Object.keys(b).some(k=>!allowed.includes(k))||!UUID.test(String(b.lobbyId||''))||
     !Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<1||
     (mode!=='preview'&&!UUID.test(String(b.requestId||''))))fail(400,'Invalid online retirement request.');
  const token=String(req.get('authorization')||'').match(/^Bearer ([a-zA-Z\d_.-]{20,5000})$/)?.[1];
  if(!token)fail(401,'Sign in to your online franchise.');
  const c=config();
  const a=await fetch(`${c.url}/auth/v1/user`,{headers:{apikey:c.key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)});
  if(!a.ok)fail(401,'Online session expired.');
  const user=await a.json();if(!UUID.test(String(user?.id||'')))fail(401,'Invalid online identity.');
  const now=Date.now();for(const [id,v] of attempts)if(now-v.start>60000)attempts.delete(id);
  const rate=attempts.get(user.id)||{start:now,count:0};
  if(rate.count>=12)fail(429,'Too many offseason requests. Try again later.');
  attempts.set(user.id,{start:rate.start,count:rate.count+1});
  const [lobby,members]=await Promise.all([
    query(c,`/rest/v1/bm_online_lobbies?id=eq.${b.lobbyId}&select=host_id,status`),
    query(c,`/rest/v1/bm_online_lobby_members?lobby_id=eq.${b.lobbyId}&user_id=eq.${user.id}&select=user_id`)]);
  if(lobby.length!==1||lobby[0].status!=='started'||members.length!==1)
   fail(403,'You are not a member of this online franchise.');
  if(mode==='run'&&lobby[0].host_id!==user.id)fail(403,'Only the host can finalize retirements.');
  const inputHash=hash({action:'online_player_retirements',lobbyId:b.lobbyId,expectedRevision:b.expectedRevision});
  if(mode==='run'){
   const events=await query(c,`/rest/v1/bm_online_franchise_events?lobby_id=eq.${b.lobbyId}&request_id=eq.${b.requestId}&select=actor_id,action_type,revision,details`);
   if(events.length){const e=events[0];if(e.actor_id!==user.id||e.action_type!=='online_player_retirements'||
     e.details?.inputHash!==inputHash)fail(409,'Request ID belongs to another operation.');
     return res.json({ok:true,replayed:true,revision:e.revision});}
  }
  const rows=await query(c,`/rest/v1/bm_online_franchise_runtime?lobby_id=eq.${b.lobbyId}&select=state,revision`);
  if(rows.length!==1||Number(rows[0].revision)!==b.expectedRevision)
   fail(409,'Shared league changed. Refresh before continuing.');
  const seasonYear=ready(rows[0].state);
  const result=await originalRetirementRunAsync(rows[0].state,{mode:mode==='preview'?'preview':'commit',seasonYear});
  if(mode==='preview')return res.json({ok:true,seasonYear,total:result.preview.length,
    preview:result.preview.slice(0,28).map(p=>({name:p.name,team:p.currentTeam,age:p.age,overall:p.overall,
      probability:p.retirementProbability,currentStatus:p.currentStatus}))});
  const payload=retirementTransaction(rows[0].state,result,seasonYear);
  const response=await fetch(`${c.url}/rest/v1/rpc/bm_online_apply_retirements_phase2e3b`,{
    method:'POST',headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,'Content-Type':'application/json'},
    body:json({p_lobby:b.lobbyId,p_actor:user.id,p_request:b.requestId,p_expected_revision:b.expectedRevision,
      p_input_hash:inputHash,p_season_year:seasonYear,p_team_removals:payload.teamRemovals,
      p_free_removals:payload.freeRemovals,p_retired:payload.retiredPlayers,p_summary:payload.summary}),
    signal:AbortSignal.timeout(45000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data?.ok)fail(409,'Retirements were not confirmed. Refresh before trying again.');
  return res.json({ok:true,revision:data.revision,replayed:!!data.replayed,count:payload.retiredPlayers.length});
 }catch(e){return res.status(e.status||503).json({ok:false,error:e.message||'Online retirements are unavailable.'});}
}

const originalRetirementRunAsync=(...args)=>runOriginalInWorker('retirements',args);
