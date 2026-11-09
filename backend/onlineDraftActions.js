// 2E.2: trusted online draft. Only source of owners is the locked rights ledger.
// Only source of player attributes/CPU choices is the original Python engine.
import {spawnSync} from 'node:child_process';
import {runOriginalInWorker} from './onlineOriginalWorkerPool.mjs';
import {chooseTrustedDraftPickMode} from './onlineDraftFallbackPolicy.g3ca3.mjs';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {settleOnlineDraftRights} from './onlineDraftRightsCore.mjs';
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const worker=fileURLToPath(new URL('./online_draft_python/online_draft_worker.py',import.meta.url));
const attemptBudget=new Map();
const fail=(status,message)=>{const e=new Error(message);e.status=status;throw e;};
const getTeams=s=>Array.isArray(s?.teams)?s.teams:Object.values(s?.conferences||{}).flat();
function python(action,league,payload){
  const runner=process.env.BM_PYTHON_BIN||(process.platform==='win32'?'python':'python3');
  const result=spawnSync(runner,['-I',worker],{input:JSON.stringify({action,league,payload}),
    encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:48*1024*1024});
  if(result.error||result.status!==0||!result.stdout)
    fail(503,'The original NBA Draft engine is unavailable. No pick was committed.');
  let data;try{data=JSON.parse(result.stdout);}catch{fail(503,'Original NBA Draft result was unreadable.');}
  if(data?.ok!==true||!data.draftState)fail(409,`NBA Draft engine declined: ${data?.reason||'invalid state'}`);
  return data;
}
export function initializeAuthoritativeOnlineDraft(state,seed){
  const rights=state?.onlineDraftRights;
  if(rights?.status!=='settled'||state?.onlineDraft||!Array.isArray(rights.order)||rights.order.length<50)
    fail(409,'Settle the official draft-pick owners before starting the NBA Draft.');
  const source=structuredClone(state);
  // Old local draft artifacts must never overwrite the online board.
  delete source.draftState;
  const result=python('initialize_draft',source,{seasonYear:rights.draftYear,
    draftOrder:rights.order,classSeed:seed});
  const draftState=result.draftState;
  if(draftState.seasonYear!==rights.draftYear||draftState.currentPickIndex!==0||
     !Array.isArray(draftState.draftOrder)||JSON.stringify(draftState.draftOrder)!==JSON.stringify(rights.order)||
     !Array.isArray(draftState.availableProspects)||draftState.availableProspects.length<rights.order.length||
     !Array.isArray(draftState.draftedPicks)||draftState.draftedPicks.length||draftState.completed)
    fail(409,'Original draft engine returned an inconsistent initial board.');
  const ids=draftState.availableProspects.map(p=>String(p?.id||''));
  if(ids.some(id=>!id)||new Set(ids).size!==ids.length)fail(409,'Draft class contains duplicate or invalid prospect IDs.');
  return {status:'active',draftYear:rights.draftYear,seasonYear:rights.seasonYear,
    classMode:'single_player_auto',draftState};
}
export function makeAuthoritativeOnlinePick(state,{actorTeam,forceCpu=false,prospectId=null}){
  const online=state?.onlineDraft,rights=state?.onlineDraftRights;
  if(online?.status!=='active'||rights?.status!=='settled'||
     Number(online?.draftYear)!==Number(rights.draftYear))
    fail(409,'The shared NBA Draft is not active.');
  const draft=online.draftState,index=Number(draft?.currentPickIndex);
  if(!Number.isInteger(index)||index<0||!Array.isArray(draft?.draftOrder)||
    index>=draft.draftOrder.length||draft?.completed)
    fail(409,'The current NBA Draft pick is not available.');
  const turn=draft.draftOrder[index],team=turn.currentOwnerTeamName||turn.teamName;
  if(!getTeams(state).some(t=>t.name===team))fail(409,'The current draft-pick owner is invalid.');
  if(forceCpu){if(prospectId!==null)fail(400,'CPU picks cannot be directed by a browser.');}
  else if(actorTeam!==team||typeof prospectId!=='string'||!prospectId||prospectId.length>140)
    fail(403,'Only the manager who owns this pick can choose an available prospect.');
  const source=structuredClone(state);
  delete source.draftState;
  const selected=forceCpu?null:prospectId;
  const result=python(forceCpu?'sim_one_pick':'make_user_pick',source,
    {seasonYear:rights.draftYear,draftState:draft,userTeamName:forceCpu?null:team,...(selected?{prospectId:selected}:{})});
  const next=result.draftState,pick=result.pick;
  if(!pick||next.currentPickIndex!==index+1||JSON.stringify(next.draftOrder)!==JSON.stringify(draft.draftOrder)||
     !Array.isArray(next.draftedPicks)||next.draftedPicks.length!==index+1||
     JSON.stringify(next.draftedPicks.slice(0,index))!==JSON.stringify(draft.draftedPicks)||
     String(pick.teamName)!==team||Number(pick.pick)!==Number(turn.pick)||
     String(next.draftedPicks.at(-1)?.playerId)!==String(pick.playerId))
    fail(409,'Original draft engine returned an inconsistent selection.');
  if(!Array.isArray(next.availableProspects)||next.availableProspects.length!==draft.availableProspects.length-1)
    fail(409,'Draft selection did not consume exactly one prospect.');
  const remaining=new Set(next.availableProspects.map(p=>String(p.id)));
  const removed=draft.availableProspects.filter(p=>!remaining.has(String(p.id)));
  if(removed.length!==1||(!forceCpu&&String(removed[0].id)!==selected)||
     String(pick.playerName)!==String(removed[0].name||removed[0].playerName))
    fail(409,'The draft pick did not match exactly one available prospect.');
  const outputTeam=getTeams(result.leagueData).find(t=>t?.name===team);
  const player=(outputTeam?.pendingRookieSignings||[]).find(p=>String(p.id)===String(pick.playerId));
  const already=(getTeams(state).find(t=>t?.name===team)?.pendingRookieSignings||[]).some(p=>String(p.id)===String(pick.playerId));
  if(!player||already||!player.rookieSigningPending||!player.contract?.pendingRookieSigning)
    fail(409,'Rookie is not held for official unsigned-rookie signing.');
  const completion=Boolean(next.completed);
  if(completion!== (index+1===draft.draftOrder.length))fail(409,'Draft completion flag is inconsistent.');
  // A generated rookie ID must never collide with an existing roster, pending
  // signing, or free agent in the shared league (including another team's rights).
  const alreadyOwned=getTeams(state).some(t=>[...(t?.players||[]),...(t?.pendingRookieSignings||[])].some(p=>String(p?.id)===String(player.id)));
  if(alreadyOwned)fail(409,'Rookie ID already exists in the shared league.');
  const originalFreeAgents=Array.isArray(state.freeAgents)?state.freeAgents:[];
  const updatedFreeAgents=Array.isArray(result.leagueData.freeAgents)?result.leagueData.freeAgents:[];
  if(completion&&updatedFreeAgents.length-originalFreeAgents.length>24)
    fail(409,'Draft engine created too many undrafted free agents.');
  if(!completion&&updatedFreeAgents.length!==originalFreeAgents.length)
    fail(409,'Undrafted free agents cannot be added before the final pick.');
  const undrafted=completion?updatedFreeAgents.slice(originalFreeAgents.length):[];
  const existingIds=new Set([...getTeams(state).flatMap(t=>[...(t?.players||[]),...(t?.pendingRookieSignings||[])]),...originalFreeAgents,player].map(p=>String(p?.id)));
  if(new Set(undrafted.map(p=>String(p?.id))).size!==undrafted.length||undrafted.some(p=>!p?.id||existingIds.has(String(p.id))))
    fail(409,'Undrafted class includes duplicate or existing player IDs.');
  return {pick,player,nextDraft:next,teamName:team,undrafted};
}
function config(){
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key||!/^https:\/\/[\w.-]+$/i.test(url))fail(503,'Online draft backend is not configured.');
 return {url:url.replace(/\/$/,''),key};
}
async function query(c,path){
 const r=await fetch(`${c.url}${path}`,{headers:{apikey:c.key,Authorization:`Bearer ${c.key}`},signal:AbortSignal.timeout(15000)});
 if(!r.ok)fail(503,'Could not verify the online draft league.');return r.json();
}
async function verifiedExpiredHumanPick(session,{year,index,ownerId}){
  // This is an early guard to avoid expensive Python work for premature attempts.
  // The SQL commit independently rechecks after locking the current runtime revision.
  const r=await fetch(`${session.c.url}/rest/v1/rpc/bm_online_draft_fallback_eligible_g3ca3`,{
    method:'POST',headers:{apikey:session.c.key,Authorization:`Bearer ${session.c.key}`,'Content-Type':'application/json'},
    body:JSON.stringify({p_lobby:session.b.lobbyId,p_year:year,p_index:index,p_owner:ownerId}),
    signal:AbortSignal.timeout(15000)});
  if(!r.ok)fail(503,'Draft recovery protection is unavailable. Confirm G3C-A3 SQL is installed.');
  return (await r.json())===true;
}
async function authorize(req,action){
 const b=req.body||{};
 const allowed=action==='nba_draft_pick_made'?['lobbyId','requestId','expectedRevision','prospectId']:['lobbyId','requestId','expectedRevision'];
 if(Object.keys(b).some(k=>!allowed.includes(k))||!UUID.test(String(b.lobbyId||''))||
    !UUID.test(String(b.requestId||''))||!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<1||
    (b.prospectId!==undefined&&(typeof b.prospectId!=='string'||!b.prospectId||b.prospectId.length>140)))
  fail(400,'Malformed Online NBA Draft action.');
 const token=String(req.get('authorization')||'').match(/^Bearer ([a-zA-Z\d_.-]{20,5000})$/)?.[1];
 if(!token)fail(401,'Sign in to your online franchise.');
 const c=config();
 const auth=await fetch(`${c.url}/auth/v1/user`,{headers:{apikey:c.key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)});
 if(!auth.ok)fail(401,'Your online session expired.');
 const user=await auth.json();if(!UUID.test(String(user?.id||'')))fail(401,'Invalid online account.');
 const now=Date.now();for(const [id,v] of attemptBudget)if(now-v.start>60000)attemptBudget.delete(id);
 const v=attemptBudget.get(user.id)||{start:now,count:0};
 if(v.count>=18)fail(429,'Too many draft operations; refresh the league.');
 attemptBudget.set(user.id,{start:v.start,count:v.count+1});
 const [lobbies,member,events]=await Promise.all([
  query(c,`/rest/v1/bm_online_lobbies?id=eq.${b.lobbyId}&select=host_id,status`),
  query(c,`/rest/v1/bm_online_lobby_members?lobby_id=eq.${b.lobbyId}&user_id=eq.${user.id}&select=user_id,team_name`),
  query(c,`/rest/v1/bm_online_franchise_events?lobby_id=eq.${b.lobbyId}&request_id=eq.${b.requestId}&select=actor_id,action_type,revision,details`)
 ]);
 if(lobbies.length!==1||lobbies[0].status!=='started'||member.length!==1)
  fail(403,'You do not belong to this active online franchise.');
 if(events.length){if(events[0].actor_id!==user.id||events[0].action_type!==action)
   fail(409,'Request ID is already used for another operation.');
  return {replay:{ok:true,replayed:true,revision:events[0].revision,pick:events[0].details?.pick},c,b,user};}
 const rows=await query(c,`/rest/v1/bm_online_franchise_runtime?lobby_id=eq.${b.lobbyId}&select=state,revision`);
 if(rows.length!==1||Number(rows[0].revision)!==b.expectedRevision)fail(409,'Shared draft changed. Refresh before continuing.');
 return {c,b,user,state:rows[0].state,team:member[0].team_name,
    host:lobbies[0].host_id===user.id};
}
async function commit(session,rpc,payload){
 const {c}=session;
 const r=await fetch(`${c.url}/rest/v1/rpc/${rpc}`,{method:'POST',headers:{apikey:c.key,
   Authorization:`Bearer ${c.key}`,'Content-Type':'application/json'},
   body:JSON.stringify({...payload,p_lobby:session.b.lobbyId,p_actor:session.user.id,
     p_request:session.b.requestId,p_expected_revision:session.b.expectedRevision}),
   signal:AbortSignal.timeout(45000)});
 const data=await r.json().catch(()=>null);
 if(!r.ok||!data?.ok)fail(409,'The draft transaction was not committed. Refresh the shared league to check its state.');
 return data;
}
export async function onlineDraftAction(req,res,kind){
 res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
 const type={settle:'nba_draft_rights_settled',start:'nba_draft_started',pick:'nba_draft_pick_made','auto-pick':'nba_draft_pick_made'}[kind];
 try{
  const session=await authorize(req,type);
  if(session.replay)return res.json(session.replay);
  let data;
  if(kind==='settle'){
    if(!session.host)fail(403,'Only the host can finalize draft ownership.');
    const rights=settleOnlineDraftRights(session.state);
    data=await commit(session,'bm_online_settle_draft_rights_phase2e2',{p_rights:rights});
  }else if(kind==='start'){
    if(!session.host)fail(403,'Only the host can open the NBA Draft.');
    const draft=await initializeAuthoritativeOnlineDraftAsync(session.state,randomBytes(4).readUInt32BE(0));
    data=await commit(session,'bm_online_start_draft_phase2e2',{p_draft:draft});
  }else if(kind==='pick'||kind==='auto-pick'){
    const current=session.state?.onlineDraft?.draftState;
    const next=current?.draftOrder?.[current.currentPickIndex];
    if(!next)fail(409,'There is no active draft selection.');
    const pickOwner=next.currentOwnerTeamName||next.teamName;
    const humanTeams=await query(session.c,`/rest/v1/bm_online_lobby_members?lobby_id=eq.${session.b.lobbyId}&select=user_id,team_name`);
    const humanOwner=humanTeams.find(m=>m.team_name===pickOwner);
    const human=Boolean(humanOwner);
    const otherHuman=human&&session.team!==pickOwner;
    // Existing /pick always preserves the old ownership rule. Recovery is
    // a separate explicit /auto-pick endpoint, never a silent behavior change.
    if(kind==='pick'&&otherHuman)fail(403,'This pick belongs to another human GM.');
    if(kind==='auto-pick'&&(!otherHuman||!session.host))fail(403,'Only the commissioner can recover another GM’s expired pick.');
    if(kind==='auto-pick'&&req.body.prospectId!==undefined)fail(400,'Commissioner may not select the prospect for another GM.');
    const expired=Boolean(kind==='auto-pick'&&
      await verifiedExpiredHumanPick(session,{year:Number(session.state?.onlineDraft?.draftYear),
        index:Number(current.currentPickIndex),ownerId:humanOwner.user_id}));
    const access=chooseTrustedDraftPickMode({human,isHost:session.host,
      actorOwnsPick:!otherHuman,submittedProspect:req.body.prospectId!==undefined,expired});
    if(!access.ok)fail(access.status,access.error);
    const forceCpu=access.forceCpu;
    const result=await makeAuthoritativeOnlinePickAsync(session.state,{actorTeam:session.team,
      forceCpu,prospectId:forceCpu?null:req.body.prospectId});
    data=await commit(session,'bm_online_make_draft_pick_phase2e2',{
      p_pick:result.pick,p_player:result.player,p_next_draft:result.nextDraft,
      p_undrafted:result.undrafted,p_owner:pickOwner,p_cpu:forceCpu});
  }else fail(400,'Unsupported NBA Draft action.');
  return res.json({ok:true,revision:data.revision,replayed:!!data.replayed,
    ...(data.pick?{pick:data.pick}:{})});
 }catch(e){return res.status(e.status||503).json({ok:false,error:e.message||'Online draft service unavailable.'});}
}

const initializeAuthoritativeOnlineDraftAsync=(...args)=>runOriginalInWorker('draft.initialize',args);
const makeAuthoritativeOnlinePickAsync=(...args)=>runOriginalInWorker('draft.pick',args);
