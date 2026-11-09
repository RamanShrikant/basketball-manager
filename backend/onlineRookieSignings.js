// Phase 2E.3A: server-owned rookie contracts. Reuses the unmodified
// single-player Python engine, commits only original draft-rookie transitions.
import {spawnSync} from 'node:child_process';
import {runOriginalInWorker} from './onlineOriginalWorkerPool.mjs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const pythonWorker=fileURLToPath(new URL('./online_rookie_python/online_rookie_worker.py',import.meta.url));
const fail=(code,message)=>{const e=new Error(message);e.status=code;throw e;};
const teams=s=>Array.isArray(s?.teams)?s.teams:Object.values(s?.conferences||{}).flat();
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const budgets=new Map();
function config(){
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key||!/^https:\/\/[\w.-]+$/i.test(url))fail(503,'Trusted online rookie backend is not configured.');
 return {url:url.replace(/\/$/,''),key};
}
async function query(c,path){
 const r=await fetch(`${c.url}${path}`,{headers:{apikey:c.key,Authorization:`Bearer ${c.key}`},signal:AbortSignal.timeout(18000)});
 if(!r.ok)fail(503,'Cannot read the current shared league.');return r.json();
}
async function authorize(req,kind){
 const b=req.body||{},preview=kind==='preview';
 const allowed=preview?['lobbyId','expectedRevision']:['lobbyId','expectedRevision','requestId',...(kind==='sign'?['decisions']:[])];
 if(Object.keys(b).some(k=>!allowed.includes(k))||!UUID.test(String(b.lobbyId||''))||
   !Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<1||(!preview&&!UUID.test(String(b.requestId||''))))
   fail(400,'Invalid online rookie request.');
 if(kind==='sign'&&(typeof b.decisions!=='object'||!b.decisions||Array.isArray(b.decisions)||
     Object.keys(b.decisions).length>60||Object.keys(b.decisions).some(id=>id.length>145||!id)||
     Object.values(b.decisions).some(d=>!['standard','two_way','stash','release'].includes(d))))
   fail(400,'Every rookie needs a valid contract decision.');
 const token=String(req.get('authorization')||'').match(/^Bearer ([a-zA-Z\d_.-]{20,5000})$/)?.[1];
 if(!token)fail(401,'Sign in to Basketball Manager Online.');
 const c=config();
 const auth=await fetch(`${c.url}/auth/v1/user`,{headers:{apikey:c.key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)});
 if(!auth.ok)fail(401,'Online session expired.');
 const user=await auth.json();if(!UUID.test(String(user?.id||'')))fail(401,'Invalid online account.');
 const now=Date.now();for(const [id,v] of budgets)if(now-v.start>60000)budgets.delete(id);
 const bucket=budgets.get(user.id)||{start:now,count:0};
 if(bucket.count>=30)fail(429,'Too many rookie requests. Try again later.');
 budgets.set(user.id,{start:bucket.start,count:bucket.count+1});
 const [lobbies,members]=await Promise.all([
   query(c,`/rest/v1/bm_online_lobbies?id=eq.${b.lobbyId}&select=host_id,status`),
   query(c,`/rest/v1/bm_online_lobby_members?lobby_id=eq.${b.lobbyId}&select=user_id,team_name`)]);
 if(lobbies.length!==1||lobbies[0].status!=='started'||!members.some(m=>m.user_id===user.id))
   fail(403,'You are not in this active online franchise.');
 const mine=members.find(m=>m.user_id===user.id).team_name;
 const host=lobbies[0].host_id===user.id;
 if(kind==='cpu'&&!host)fail(403,'Only the host may resolve CPU rookie contracts.');
 const requestInputHash=hash({action:kind,team:kind==='sign'?mine:null,decisions:kind==='sign'?b.decisions:null});
 if(!preview){
   const events=await query(c,`/rest/v1/bm_online_franchise_events?lobby_id=eq.${b.lobbyId}&request_id=eq.${b.requestId}&select=actor_id,action_type,revision,details`);
   if(events.length){
     if(events[0].actor_id!==user.id||events[0].action_type!==(kind==='sign'?'rookie_signings_human':'rookie_signings_cpu')||
       events[0].details?.requestInputHash!==requestInputHash)
       fail(409,'This request ID was already used for a different rookie operation.');
     return {replay:{ok:true,replayed:true,revision:events[0].revision},c,b,user};
   }
 }
 const rows=await query(c,`/rest/v1/bm_online_franchise_runtime?lobby_id=eq.${b.lobbyId}&select=state,revision`);
 if(rows.length!==1||Number(rows[0].revision)!==b.expectedRevision)fail(409,'The online league changed. Refresh before signing.');
 const state=rows[0].state, draft=state?.onlineDraft;
 if(draft?.status!=='complete'||draft?.draftState?.completed!==true||
    draft?.draftState?.draftedPicks?.length!==draft?.draftState?.draftOrder?.length)
   fail(409,'Complete the official online NBA Draft before rookie signings.');
 const year=Number(draft.draftYear);
 if(!Number.isInteger(year)||year<2026||year>2100||
    Number(state?.onlineDraftRights?.draftYear)!==year)fail(409,'Draft year does not match official pick ownership.');
 if(state?.onlineRookieSignings?.status==='complete'&&!preview)fail(409,'Rookie signings are already complete.');
 return {c,b,user,state,mine,host,year,members,requestInputHash};
}
export function runOriginalRookieEngine(state,{mode,teamNames,decisions={},draftYear}){
 const executable=process.env.BM_PYTHON_BIN||(process.platform==='win32'?'python':'python3');
 const result=spawnSync(executable,['-I',pythonWorker],{
   input:JSON.stringify({league:state,mode,teamNames,decisions,draftYear}),
   encoding:'utf8',windowsHide:true,timeout:80000,maxBuffer:10*1024*1024
 });
 if(result.error||result.status!==0||!result.stdout)
   fail(503,'Original rookie-signing engine unavailable. No contracts were committed.');
 let parsed;try{parsed=JSON.parse(result.stdout);}catch{fail(503,'Original rookie engine returned unreadable output.');}
 if(!parsed?.ok)fail(409,parsed?.reason||'Original rookie engine rejected the operation.');
 return parsed;
}
function verifyChanges(state,actions,scope){
 const originals=teams(state);
 const rosterIds=new Set(),pending=new Map();
 for(const team of originals){
   for(const row of [...(team.players||[]),...(team.twoWayPlayers||[]),...(team.stashPlayers||[])]){
     if(!row?.id||rosterIds.has(String(row.id)))fail(409,'Duplicate or invalid existing roster ID.');
     rosterIds.add(String(row.id));
   }
   for(const row of team.pendingRookieSignings||[]){
     if(!row?.id||pending.has(String(row.id)))fail(409,'Duplicate or invalid unsigned rookie ID.');
     pending.set(String(row.id),{row,team:team.name});
   }
 }
 for(const row of state.freeAgents||[]){if(!row?.id||rosterIds.has(String(row.id)))fail(409,'Duplicate free-agent ID.');rosterIds.add(String(row.id));}
 const processed=new Set();
 if(actions.length!==scope.length||new Set(actions.map(a=>a.teamName)).size!==scope.length)fail(409,'Signing teams changed in the Python engine.');
 for(const a of actions){
   if(!scope.includes(a.teamName))fail(409,'Original engine returned an unauthorized team.');
   const team=originals.find(t=>t.name===a.teamName),source=team?.pendingRookieSignings||[];
   if(source.length!==a.rookies?.length||!source.length)fail(409,'Rookie signing roster count changed.');
   for(const c of a.rookies){
     const id=String(c.id),original=pending.get(id),player=c.player;
     if(processed.has(id)||original?.team!==a.teamName||!player||String(player.id)!==id||
       original.row.name!==player.name||player.rookieSigningPending!==false||
       !['standard','two_way','stash','release'].includes(c.decision)||
       player.meta?.rookieSigningDecision!==c.decision||
       !player.contract||player.contract.pendingRookieSigning)
       fail(409,'Original engine produced an invalid rookie transition.');
     if(rosterIds.has(id))fail(409,'Drafted rookie already appears elsewhere in the shared league.');
     if(c.decision==='release'?(player.team!=='Free Agent'||player.contractType!=='free_agent'):
        (player.team!==a.teamName||player.contractType!==(c.decision==='standard'?'standard':c.decision==='two_way'?'two_way':'stash')))
       fail(409,'Rookie contract destination is inconsistent.');
     processed.add(id);
   }
 }
 return processed.size;
}
async function commit(session,actions,mode){
 const {c,b,user,requestInputHash}=session;
 const r=await fetch(`${c.url}/rest/v1/rpc/bm_online_apply_rookie_signings_phase2e3a`,{
   method:'POST',headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,'Content-Type':'application/json'},
   body:JSON.stringify({p_lobby:b.lobbyId,p_actor:user.id,p_request:b.requestId,
     p_expected_revision:b.expectedRevision,p_mode:mode,p_input_hash:requestInputHash,p_actions:actions}),
   signal:AbortSignal.timeout(45000)
 });
 const data=await r.json().catch(()=>null);
 if(!r.ok||!data?.ok)fail(409,'Rookie signing was not confirmed. Refresh shared league to check for a committed transaction.');
 return data;
}
export async function onlineRookieSigningsRequest(req,res,kind){
 res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
 try{
  const session=await authorize(req,kind);
  if(session.replay)return res.json(session.replay);
  const humanNames=new Set(session.members.map(m=>m.team_name).filter(Boolean));
  if(kind==='preview'){
    const rows=await runOriginalRookieEngineAsync(session.state,{mode:'preview',teamNames:[session.mine],draftYear:session.year});
    return res.json({ok:true,rows:rows.rows,summary:rows.summary,year:session.year});
  }
  const target=kind==='sign'?[session.mine]:teams(session.state)
     .filter(t=>!humanNames.has(t.name)&&(t.pendingRookieSignings||[]).length>0).map(t=>t.name);
  if(!target.length)fail(409,'There are no eligible rookie rights to resolve in this category.');
  const result=await runOriginalRookieEngineAsync(session.state,{mode:kind==='sign'?'human':'cpu',teamNames:target,
    decisions:kind==='sign'?session.b.decisions:{},draftYear:session.year});
  const count=verifyChanges(session.state,result.actions,target);
  const committed=await commit(session,result.actions,kind==='sign'?'human':'cpu');
  return res.json({ok:true,revision:committed.revision,replayed:!!committed.replayed,count,
     complete:!!committed.complete});
 }catch(e){return res.status(e.status||503).json({ok:false,error:e.message||'Online rookie contracts unavailable.'});}
}

const runOriginalRookieEngineAsync=(...args)=>runOriginalInWorker('rookies',args);
