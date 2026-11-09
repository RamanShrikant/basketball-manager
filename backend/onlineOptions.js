// Phase 2E.4-A: authoritative option decisions using the unchanged single-player
// free_agency_logic.py. Multiple human teams submit independently, and the host
// closes options only after every human has submitted; no browser edits rosters.
import {spawnSync} from 'node:child_process';
import {runOriginalInWorker} from './onlineOriginalWorkerPool.mjs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
const worker=fileURLToPath(new URL('./online_options_python/online_options_worker.py',import.meta.url));
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const err=(code,message)=>{const e=new Error(message);e.status=code;throw e;};
const teams=s=>Array.isArray(s?.teams)?s.teams:Object.values(s?.conferences||{}).flat();
const counter=new Map();
const categories=['teamOptions','twoWay','stash'];
export function validateOptionChoices(choices){
 if(!choices||typeof choices!=='object'||Array.isArray(choices)||
    Object.keys(choices).sort().join(',')!==categories.slice().sort().join(','))err(400,'Invalid options decision categories.');
 let total=0;
 for(const category of categories){
  const group=choices[category];
  if(!group||typeof group!=='object'||Array.isArray(group))err(400,'Invalid options player choices.');
  if(Object.keys(group).length>25)err(400,'Too many option decisions for one team.');
  for(const [id,value] of Object.entries(group)){
   if(!id||id.length>150||['__proto__','constructor','prototype'].includes(id))err(400,'Invalid option player ID.');
   if(category==='teamOptions'&&typeof value!=='boolean')err(400,'Team option choices must be true or false.');
   if(category==='twoWay'&&!['extend','convert','release'].includes(value))err(400,'Invalid two-way choice.');
   if(category==='stash'&&!['two_way','standard','release'].includes(value))err(400,'Invalid stash choice.');
   total++;
  }
 }
 if(total>55)err(400,'Too many player decisions in the request.');
 return choices;
}
export function readyForOptions(state){
 const year=Number(state?.onlineDraft?.draftYear);
 if(!Number.isInteger(year)||year<2026||year>2100||
    state?.onlinePostseason?.phase!=='postseasonComplete'||
    state?.onlineRetirements?.status!=='complete'||
    state?.onlineDraft?.status!=='complete'||
    state?.onlineRookieSignings?.status!=='complete'||
    Number(state?.onlineRookieSignings?.draftYear)!==year||
    Number(state?.onlineDraftRights?.draftYear)!==year)
   err(409,'Finish retirement, lottery, draft and all rookie signings before Options & Rights.');
 if(state?.onlineOptions?.status==='complete'||state?.offseasonState?.optionsComplete)
   err(409,'The options stage has already been finalized for this offseason.');
 if(state?.onlineOptions&&Number(state.onlineOptions.year)!==year)
   err(409,'An options window from another season is still present.');
 if(teams(state).length!==30||new Set(teams(state).map(t=>t?.name)).size!==30)
   err(409,'The shared league must have thirty unique NBA teams.');
 return year;
}
export function runOriginalOptions(state,{mode,year,humanTeams,teamName,decisions,decisionsByTeam}){
 const exe=process.env.BM_PYTHON_BIN||(process.platform==='win32'?'python':'python3');
 const data={mode,league:state,year,humanTeams,teamName,decisions,decisionsByTeam};
 const r=spawnSync(exe,['-I',worker],{input:JSON.stringify(data),encoding:'utf8',windowsHide:true,timeout:90000,maxBuffer:35*1024*1024});
 if(r.error||r.status!==0||!r.stdout)err(503,'Original single-player options processor unavailable; no contracts were changed.');
 let result;try{result=JSON.parse(r.stdout);}catch{err(503,'Original options processor returned invalid JSON.');}
 if(result?.ok!==true)err(409,result?.reason||'Original options engine rejected this offseason.');
 return result;
}
// The trusted worker may return changed contracts, rights and free agents,
// but not new identities, cross-team signings, or unrelated state changes.
export function verifyOriginalOptionChanges(before,result,year){
 const after=result?.leagueData;
 const oldTeams=teams(before),newTeams=teams(after);
 if(!after||newTeams.length!==30||Number(result.year)!==year||
    Number(result.summary?.seasonYear)!==year)err(409,'Original options returned incomplete season results.');
 const oldTop=structuredClone(before),newTop=structuredClone(after);
 for(const x of [oldTop,newTop]){delete x.teams;delete x.conferences;delete x.freeAgents;}
 if(!isDeepStrictEqual(oldTop,newTop))err(409,'Original options attempted to modify unrelated league history.');
 const oldPlayers=new Map(),allOld=new Set(),allNew=new Set();
 const add=(set,id,label)=>{if(id==null||!String(id)||set.has(String(id)))err(409,`Duplicate or missing ${label} player ID.`);set.add(String(id));};
 for(let i=0;i<30;i++){
  const a=oldTeams[i],b=newTeams[i];
  if(a?.name!==b?.name)err(409,'Options changed NBA team identity or ordering.');
  const safe=t=>{const x=structuredClone(t);delete x.players;delete x.twoWayPlayers;delete x.stashPlayers;return x;};
  if(!isDeepStrictEqual(safe(a),safe(b)))err(409,'Options modified non-contract team data.');
  const own=new Set();
  for(const bucket of ['players','twoWayPlayers','stashPlayers']){
   for(const p of a[bucket]||[]){add(own,p.id,'existing');add(allOld,p.id,'existing');oldPlayers.set(String(p.id),p);}
  }
  for(const bucket of ['players','twoWayPlayers','stashPlayers']){
   for(const p of b[bucket]||[]){
    if(!own.has(String(p.id)))err(409,'Options attempted a cross-team transfer or created a player.');
    add(allNew,p.id,'result');
    const original=oldPlayers.get(String(p.id));
    for(const key of ['name','age','overall','potential','pos'])
     if(!isDeepStrictEqual(original?.[key],p?.[key]))err(409,'Options changed immutable player identity or ratings.');
   }
  }
 }
 for(const p of before.freeAgents||[]){add(allOld,p.id,'existing free agent');oldPlayers.set(String(p.id),p);}
 for(const p of after.freeAgents||[]){
  if(!allOld.has(String(p.id)))err(409,'Options created an unknown free agent.');
  add(allNew,p.id,'result free agent');
  const original=oldPlayers.get(String(p.id));
  for(const key of ['name','age','overall','potential','pos'])
   if(!isDeepStrictEqual(original?.[key],p?.[key]))err(409,'Options changed immutable free-agent ratings.');
 }
 if(allOld.size!==allNew.size||[...allOld].some(id=>!allNew.has(id)))
   err(409,'Option processing lost or duplicated a player.');
 return {teams:newTeams,freeAgents:after.freeAgents||[],summary:result.summary,decisionLog:result.decisionLog||[]};
}
function config(){
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key||!/^https:\/\/[\w.-]+$/i.test(url))err(503,'Trusted online offseason backend is not configured.');
 return {url:url.replace(/\/$/,''),key};
}
async function query(c,path){
 const r=await fetch(`${c.url}${path}`,{headers:{apikey:c.key,Authorization:`Bearer ${c.key}`},signal:AbortSignal.timeout(18000)});
 if(!r.ok)err(503,'Cannot read the authoritative online league.');return r.json();
}
export async function onlineOptionsRequest(req,res,mode){
 res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
 try{
  const b=req.body||{},preview=mode==='preview';
  const allowed=preview?['lobbyId','expectedRevision']:mode==='submit'?['lobbyId','expectedRevision','requestId','decisions']:['lobbyId','expectedRevision','requestId'];
  if(Object.keys(b).some(k=>!allowed.includes(k))||!UUID.test(String(b.lobbyId||''))||
    !Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<1||(!preview&&!UUID.test(String(b.requestId||''))))
    err(400,'Invalid Online Options request.');
  if(mode==='submit')validateOptionChoices(b.decisions);
  const token=String(req.get('authorization')||'').match(/^Bearer ([a-zA-Z\d_.-]{20,5000})$/)?.[1];
  if(!token)err(401,'Please sign in again to manage the online offseason.');
  const c=config(),who=await fetch(`${c.url}/auth/v1/user`,{
    headers:{apikey:c.key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)});
  if(!who.ok)err(401,'Your online session expired.');
  const user=await who.json();if(!UUID.test(String(user?.id||'')))err(401,'Unknown online identity.');
  const now=Date.now();for(const [id,v] of counter)if(now-v.start>60000)counter.delete(id);
  const prev=counter.get(user.id)||{start:now,count:0};
  if(prev.count>=24)err(429,'Too many requests. Review the current league before retrying.');
  counter.set(user.id,{start:prev.start,count:prev.count+1});
  const [lobbies,members]=await Promise.all([
    query(c,`/rest/v1/bm_online_lobbies?id=eq.${b.lobbyId}&select=host_id,status`),
    query(c,`/rest/v1/bm_online_lobby_members?lobby_id=eq.${b.lobbyId}&select=user_id,team_name`)]);
  if(lobbies.length!==1||lobbies[0].status!=='started'||!members.some(m=>m.user_id===user.id))
    err(403,'You are not a member of this online franchise.');
  const mine=members.find(m=>m.user_id===user.id)?.team_name;
  const humanTeams=members.map(m=>m.team_name).filter(Boolean);
  if(new Set(humanTeams).size!==humanTeams.length||humanTeams.length>4||!mine)
    err(409,'Invalid human team assignments in this lobby.');
  if(mode==='finalize'&&lobbies[0].host_id!==user.id)err(403,'Only the host can finalize the options window.');
  const inputHash=sha({action:`online_options_${mode}`,team:mode==='submit'?mine:null,
    decisions:mode==='submit'?b.decisions:null,year:null});
  if(!preview){
   const events=await query(c,`/rest/v1/bm_online_franchise_events?lobby_id=eq.${b.lobbyId}&request_id=eq.${b.requestId}&select=actor_id,action_type,revision,details`);
   if(events.length){const event=events[0];
    if(event.actor_id!==user.id||event.action_type!==`online_options_${mode}`||event.details?.inputHash!==inputHash)
      err(409,'This request ID was already used for a different action.');
    return res.json({ok:true,replayed:true,revision:event.revision});
   }
  }
  const rows=await query(c,`/rest/v1/bm_online_franchise_runtime?lobby_id=eq.${b.lobbyId}&select=state,revision`);
  if(rows.length!==1||Number(rows[0].revision)!==b.expectedRevision)
    err(409,'The shared league changed. Refresh your options before continuing.');
  const state=rows[0].state,year=readyForOptions(state);
  if(!teams(state).some(t=>t.name===mine))err(409,'Your managed team no longer exists.');
  if(mode==='preview'){
   const data=await runOriginalOptionsAsync(state,{mode:'preview',year,humanTeams,teamName:mine});
   return res.json({ok:true,year,rows:data.rows,summary:data.summary,
     submitted:Boolean(state?.onlineOptions?.decisionsByTeam?.[mine]),
     readyCount:Object.keys(state?.onlineOptions?.decisionsByTeam||{}).length,
     humanCount:humanTeams.length});
  }
  let payload,proc;
  if(mode==='submit'){
   await runOriginalOptionsAsync(state,{mode:'validate',year,humanTeams,teamName:mine,decisions:b.decisions});
   if(state?.onlineOptions?.decisionsByTeam?.[mine])err(409,'Your team already submitted. Refresh the shared options.');
   proc='bm_online_submit_options_phase2e4a';
   payload={p_decisions:b.decisions};
  }else if(mode==='finalize'){
   const decisionsByTeam=state?.onlineOptions?.decisionsByTeam||{};
   if(humanTeams.some(team=>!Object.hasOwn(decisionsByTeam,team))||
       Object.keys(decisionsByTeam).length!==humanTeams.length)
     err(409,'Every human GM must lock in their team options before finalization.');
   const result=await runOriginalOptionsAsync(state,{mode:'finalize',year,humanTeams,decisionsByTeam});
   const checked=verifyOriginalOptionChanges(state,result,year);
   proc='bm_online_finalize_options_phase2e4a';
   payload={p_teams:checked.teams,p_free_agents:checked.freeAgents,
     p_summary:checked.summary,p_decision_log:checked.decisionLog};
  }else err(400,'Unsupported options operation.');
  const r=await fetch(`${c.url}/rest/v1/rpc/${proc}`,{
   method:'POST',headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,'Content-Type':'application/json'},
   body:JSON.stringify({p_lobby:b.lobbyId,p_actor:user.id,p_request:b.requestId,
     p_expected_revision:b.expectedRevision,p_year:year,p_input_hash:inputHash,...payload}),
   signal:AbortSignal.timeout(50000)});
  const data=await r.json().catch(()=>null);
  if(!r.ok||data?.ok!==true)err(409,'Options were not confirmed by the authoritative league. Refresh before retrying.');
  res.json({ok:true,revision:data.revision,replayed:Boolean(data.replayed),year,
    complete:mode==='finalize',count:data.count});
 }catch(e){res.status(e.status||503).json({ok:false,error:e.message||'Online options are unavailable.'});}
}

const runOriginalOptionsAsync=(...args)=>runOriginalInWorker('options',args);
