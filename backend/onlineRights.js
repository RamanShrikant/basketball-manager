// 2E.4-B: original single-player Bird/QO engine, trusted human-GM decisions.
// No browser provides a roster, rights state, cap values or human-team assignment.
import {spawnSync} from 'node:child_process';
import {runOriginalInWorker} from './onlineOriginalWorkerPool.mjs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const worker=fileURLToPath(new URL('./online_options_python/online_rights_worker.py',import.meta.url));
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const decisionsAllowed=new Set(['keep','renounce','extend_qo','decline_qo','withdraw_qo','keep_qo']);
const rate=new Map();
const error=(code,msg)=>{const e=new Error(msg);e.status=code;throw e;};
const hash=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');

export function validateRightsDecisions(decisions){
 if(!decisions||typeof decisions!=='object'||Array.isArray(decisions)||Object.keys(decisions).length>100)
  error(400,'Invalid qualifying-offer and Bird-rights decisions.');
 for(const [id,value] of Object.entries(decisions)){
  if(!id||id.length>150||['constructor','prototype','__proto__'].includes(id)||
     typeof value!=='string'||!decisionsAllowed.has(value))error(400,'Invalid player ID or rights decision.');
 }
 return decisions;
}
export function rightsSeason(state){
 const year=Number(state?.onlineDraft?.draftYear);
 if(!Number.isInteger(year)||year<2026||year>2100||
    state?.onlineOptions?.status!=='complete'||Number(state?.onlineOptions?.year)!==year||
    state?.offseasonState?.optionsComplete!==true||
    state?.onlineRookieSignings?.status!=='complete'||
    (state?.offseasonState?.rightsManagementComplete===true)||state?.onlineRights?.status==='complete')
  error(409,'Complete this offseason’s NBA Options stage before managing free-agent rights.');
 if(state?.onlineRights&&Number(state.onlineRights.year)!==year)
  error(409,'Rights decisions from a different offseason need resolution.');
 return year;
}
export function originalRights(state,{mode,year,humanTeams,teamName,decisions,decisionsByTeam}){
 const bin=process.env.BM_PYTHON_BIN||(process.platform==='win32'?'python':'python3');
 const r=spawnSync(bin,['-I',worker],{input:JSON.stringify({league:state,mode,year,humanTeams,teamName,decisions,decisionsByTeam}),
  encoding:'utf8',timeout:90000,maxBuffer:40*1024*1024,windowsHide:true});
 if(r.error||r.status!==0||!r.stdout)error(503,'The original Bird-rights engine is unavailable; no rights were changed.');
 let result;try{result=JSON.parse(r.stdout);}catch{error(503,'The original rights engine returned invalid output.');}
 if(result?.ok!==true)error(409,String(result?.reason||'Original rights evaluation rejected this decision.').slice(0,360));
 return result;
}
export function verifyRightsResult(state,result,year,submitted){
 if(result?.year!==year||!Array.isArray(result.freeAgents)||!Array.isArray(state?.freeAgents)||
    result.freeAgents.length!==state.freeAgents.length||!Array.isArray(result.decisionLog)||
    !result.summary||typeof result.summary!=='object')error(409,'Incomplete rights engine result.');
 const SAFE=new Set(['rights','rightsRenounced','qualifyingOffer','qualifyingOfferEligible','marketValue']);
 const ids=new Set(),teamChoices=Object.entries(submitted);
 for(let i=0;i<result.freeAgents.length;i++){
  const a=state.freeAgents[i],b=result.freeAgents[i];
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||
     a.id==null||String(a.id)!==String(b.id)||ids.has(String(b.id)))error(409,'Free-agent identities changed.');
  ids.add(String(b.id));
  for(const key of new Set([...Object.keys(a),...Object.keys(b)])){
   if(!SAFE.has(key)&&JSON.stringify(a[key])!==JSON.stringify(b[key]))
    error(409,'Rights update attempted to change player statistics, contracts, or unrelated fields.');
  }
  const owner=a.rightsRenounced?null:a.rights?.heldByTeam||null;
  const choice=teamChoices.find(([team,d])=>team===owner&&Object.hasOwn(d,String(a.id)))?.[1]?.[String(a.id)];
  if(!choice){
   const originalRights=a.rights||{},nextRights=b.rights||{};
   if((originalRights.heldByTeam||null)!==(nextRights.heldByTeam||null)||
      Boolean(originalRights.restrictedFreeAgent)!==Boolean(nextRights.restrictedFreeAgent)||
      JSON.stringify(a.qualifyingOffer||null)!==JSON.stringify(b.qualifyingOffer||null)||
      JSON.stringify(a.qualifyingOfferEligible||null)!==JSON.stringify(b.qualifyingOfferEligible||null)||
      Boolean(a.rightsRenounced)!==Boolean(b.rightsRenounced))
     error(409,'Original rights engine modified an unsubmitted team’s control rights.');
  }else if(choice==='renounce'){
   if(b.rights?.heldByTeam||b.rights?.restrictedFreeAgent||b.rightsRenounced!==true||b.qualifyingOffer||b.qualifyingOfferEligible)
    error(409,'A renounced player still has active team control rights.');
  }else if(choice==='extend_qo'||choice==='keep_qo'){
   if(b.rights?.heldByTeam!==owner||!b.rights?.restrictedFreeAgent||b.qualifyingOffer?.status!=='extended'||
      b.qualifyingOffer?.teamName!==owner||!(Number(b.qualifyingOffer?.amount)>0))
    error(409,'A qualifying offer was not preserved correctly.');
  }else if(choice==='decline_qo'||choice==='withdraw_qo'){
   if(b.rights?.heldByTeam!==owner||b.rights?.restrictedFreeAgent||b.qualifyingOffer||b.qualifyingOfferEligible)
    error(409,'Declined qualifying offer incorrectly retained RFA status.');
  }else if(choice==='keep'&&b.rights?.heldByTeam!==owner)
   error(409,'Bird rights ownership changed unexpectedly.');
 }
 const logged=new Set();for(const item of result.decisionLog){
  const k=`${item.teamName}:${item.playerId}`;
  if(logged.has(k)||!Object.hasOwn(submitted[item.teamName]||{},String(item.playerId))||
    submitted[item.teamName][String(item.playerId)]!==item.decision)
   error(409,'An unexpected rights transaction was generated.');
  logged.add(k);
 }
 if(logged.size!==teamChoices.reduce((n,[,d])=>n+Object.keys(d).length,0))
  error(409,'Some human GM rights decisions were not applied.');
 return {freeAgents:result.freeAgents,summary:result.summary,decisionLog:result.decisionLog};
}
function serverConfig(){
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key||!/^https:\/\/[\w.-]+$/i.test(url))error(503,'Trusted Online offseason backend is not configured.');
 return {url:url.replace(/\/$/,''),key};
}
async function read(c,path){
 const response=await fetch(`${c.url}${path}`,{headers:{apikey:c.key,Authorization:`Bearer ${c.key}`},signal:AbortSignal.timeout(18000)});
 if(!response.ok)error(503,'Could not read authoritative online franchise data.');
 return response.json();
}
export async function onlineRightsRequest(req,res,mode){
 res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
 try{
  if(!['preview','submit','finalize'].includes(mode))error(400,'Unknown rights operation.');
  const b=req.body||{};
  const keys=mode==='preview'?['lobbyId','expectedRevision']:mode==='submit'?['lobbyId','expectedRevision','requestId','decisions']:['lobbyId','expectedRevision','requestId'];
  if(Object.keys(b).some(k=>!keys.includes(k))||!UUID.test(String(b.lobbyId||''))||
     !Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<1||
     (mode!=='preview'&&!UUID.test(String(b.requestId||''))))error(400,'Invalid rights request.');
  if(mode==='submit')validateRightsDecisions(b.decisions);
  const token=String(req.get('authorization')||'').match(/^Bearer ([a-zA-Z\d_.-]{20,5000})$/)?.[1];
  if(!token)error(401,'Sign in to manage your online franchise.');
  const c=serverConfig();
  const who=await fetch(`${c.url}/auth/v1/user`,{headers:{apikey:c.key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)});
  if(!who.ok)error(401,'Your session expired.');
  const user=await who.json();if(!UUID.test(String(user?.id||'')))error(401,'Invalid online identity.');
  const now=Date.now(),previous=rate.get(user.id)||{start:now,count:0};
  if(now-previous.start>60000)rate.set(user.id,{start:now,count:1});
  else{if(previous.count>=24)error(429,'Too many offseason requests.');rate.set(user.id,{start:previous.start,count:previous.count+1});}
  const [lobbies,members]=await Promise.all([
   read(c,`/rest/v1/bm_online_lobbies?id=eq.${b.lobbyId}&select=host_id,status`),
   read(c,`/rest/v1/bm_online_lobby_members?lobby_id=eq.${b.lobbyId}&select=user_id,team_name`)]);
  if(lobbies.length!==1||lobbies[0].status!=='started'||!members.some(m=>m.user_id===user.id))
   error(403,'You are not an active member of this online league.');
  const mine=members.find(m=>m.user_id===user.id)?.team_name;
  const humanTeams=members.map(m=>m.team_name).filter(Boolean);
  if(!mine||humanTeams.length<1||humanTeams.length>4||new Set(humanTeams).size!==humanTeams.length)
   error(409,'Online human-GM team assignments are invalid.');
  if(mode==='finalize'&&lobbies[0].host_id!==user.id)error(403,'Only the host can finalize Bird rights.');
  const inputHash=hash({mode,team:mode==='submit'?mine:null,decisions:mode==='submit'?b.decisions:null});
  if(mode!=='preview'){
   const events=await read(c,`/rest/v1/bm_online_franchise_events?lobby_id=eq.${b.lobbyId}&request_id=eq.${b.requestId}&select=actor_id,action_type,revision,details`);
   if(events.length){const prior=events[0];
    if(prior.actor_id!==user.id||prior.action_type!==`online_rights_${mode}`||prior.details?.inputHash!==inputHash)
     error(409,'This request ID already belongs to a different operation.');
    return res.json({ok:true,replayed:true,revision:prior.revision});
   }
  }
  const rows=await read(c,`/rest/v1/bm_online_franchise_runtime?lobby_id=eq.${b.lobbyId}&select=state,revision`);
  if(rows.length!==1||Number(rows[0].revision)!==b.expectedRevision)error(409,'The shared league changed. Refresh your rights decisions.');
  const state=rows[0].state,year=rightsSeason(state);
  if(mode==='preview'){
   const result=await originalRightsAsync(state,{mode,year,humanTeams,teamName:mine});
   return res.json({ok:true,year,rows:result.rows,summary:result.summary,
    submitted:Boolean(state.onlineRights?.decisionsByTeam?.[mine]),
    readyCount:Object.keys(state.onlineRights?.decisionsByTeam||{}).length,humanCount:humanTeams.length});
  }
  let proc,payload;
  if(mode==='submit'){
   if(Object.hasOwn(state.onlineRights?.decisionsByTeam||{},mine))error(409,'Your GM has already submitted rights decisions.');
   await originalRightsAsync(state,{mode:'validate',year,humanTeams,teamName:mine,decisions:b.decisions});
   proc='bm_online_submit_rights_phase2e4b';payload={p_decisions:b.decisions};
  }else{
   const decisionsByTeam=state.onlineRights?.decisionsByTeam||{};
   if(Object.keys(decisionsByTeam).length!==humanTeams.length||humanTeams.some(team=>!Object.hasOwn(decisionsByTeam,team)))
    error(409,'All human GMs must submit rights decisions first.');
   const result=await originalRightsAsync(state,{mode:'finalize',year,humanTeams,decisionsByTeam});
   const verified=verifyRightsResult(state,result,year,decisionsByTeam);
   proc='bm_online_finalize_rights_phase2e4b';payload={p_free_agents:verified.freeAgents,p_summary:verified.summary,p_decision_log:verified.decisionLog};
  }
  const confirmation=await fetch(`${c.url}/rest/v1/rpc/${proc}`,{
   method:'POST',headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,'Content-Type':'application/json'},
   body:JSON.stringify({p_lobby:b.lobbyId,p_actor:user.id,p_request:b.requestId,
    p_expected_revision:b.expectedRevision,p_year:year,p_input_hash:inputHash,...payload}),
   signal:AbortSignal.timeout(50000)});
  const result=await confirmation.json().catch(()=>null);
  if(!confirmation.ok||result?.ok!==true)error(409,'The authoritative league rejected the rights operation. Refresh and try again.');
  return res.json({ok:true,revision:result.revision,replayed:Boolean(result.replayed),complete:mode==='finalize',year});
 }catch(e){return res.status(e.status||503).json({ok:false,error:e.message||'Online rights management is unavailable.'});}
}

const originalRightsAsync=(...args)=>runOriginalInWorker('rights',args);
