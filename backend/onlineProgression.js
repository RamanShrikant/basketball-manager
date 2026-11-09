// Phase 2E.4-D: host-only, server-authoritative original-engine progression.
// The local single-player files are NEVER modified or executed by a browser.
import {spawnSync} from 'node:child_process';
import {runOriginalInWorker} from './onlineOriginalWorkerPool.mjs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {recomputeDerivedRatingsInLeague} from './online_progression_shared/playerProgressionDerived_v1.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const worker=fileURLToPath(new URL('./online_progression_python/online_progression_worker.py',import.meta.url));
const rates=new Map();
const BUCKETS=['players','twoWayPlayers','stashPlayers'];
const RATING_KEYS=new Set(['age','lastBirthdayYear','overall','potential','attrs','offRating','defRating','stamina','scoringRating','birthMonth','birthDay','devProfileV25','careerTimingProfile','developmentMomentum']);
const fail=(status,msg)=>{const e=new Error(msg);e.status=status;throw e;};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const serialized=v=>JSON.stringify(v);
const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj||{},key);
function allTeams(state){
 if(Array.isArray(state?.teams))return state.teams;
 if(state?.conferences&&typeof state.conferences==='object')return [...(state.conferences.East||[]),...(state.conferences.West||[])];
 return [];
}
function yearToProgress(state){
 const year=Number(state?.onlineDraft?.draftYear);
 if(!Number.isInteger(year)||year<2026||year>2100||
  state?.onlineRookieSignings?.status!=='complete'||
  state?.onlineOptions?.status!=='complete'||Number(state.onlineOptions.year)!==year||
  state?.onlineRights?.status!=='complete'||Number(state.onlineRights.year)!==year||
  state?.onlineOffseasonMarket?.status!=='complete'||Number(state.onlineOffseasonMarket.year)!==year||
  state?.freeAgencyState?.marketComplete!==true||state.freeAgencyState?.isActive!==false||
  state?.offseasonState?.freeAgencyComplete!==true||
  state?.offseasonState?.optionsComplete!==true||
  state?.offseasonState?.rightsManagementComplete!==true||
  state?.offseasonState?.active!==true)
  fail(409,'Complete the draft, rookie signings, options, rights, and official 10-day free-agency market first.');
 if(state?.onlineProgression||state?.offseasonState?.progressionComplete===true)
  fail(409,'Player progression already happened this offseason.');
 const teams=allTeams(state);
 if(teams.length!==30||new Set(teams.map(t=>t?.name)).size!==30||
   teams.some(t=>!t?.name))fail(409,'Progression needs all 30 NBA teams.');
 return year;
}
function rookie(p,year){
 const meta=p?.meta||{};
 const dy=Number(meta?.draftYear??p?.draftYear??p?.draftClassYear??p?.draftedYear??0);
 return dy===year&&(String(meta?.acquiredVia||p?.acquiredVia||'').toLowerCase().includes('draft')||
  String(p?.id||'').toLowerCase().startsWith(`rookie_${year}_`)||
  p?.rights?.rookieScale===true||p?.rookieSigningPending===true);
}
function playerRows(state){
 const rows=[],seen=new Set(),teams=allTeams(state);
 for(const t of teams){
  for(const bucket of BUCKETS){
   if(t[bucket]!==undefined&&!Array.isArray(t[bucket]))fail(409,'Invalid roster bucket');
   for(const p of t[bucket]||[])rows.push({team:t.name,bucket,player:p});
  }
 }
 if(state.freeAgents!==undefined&&!Array.isArray(state.freeAgents))fail(409,'Invalid free-agent pool');
 for(const p of state.freeAgents||[])rows.push({team:'Free Agents',bucket:'freeAgents',player:p});
 if(rows.length<200||rows.length>2000)fail(409,'Invalid NBA progression player count');
 for(const row of rows){
  const id=String(row.player?.id??'');
  if(!id||id.length>150||seen.has(id))fail(409,'Duplicate/missing player ID across league');
  seen.add(id);
 }
 return rows;
}
function without(obj,keys){const out={...(obj||{})};for(const key of keys)delete out[key];return out;}
function allowedPlayer(before,after,year){
 if(serialized(without(before,RATING_KEYS))!==serialized(without(after,RATING_KEYS))) {
  // meta.devProfileV25 is the one permissible nested metadata change.
  const a=without(before,RATING_KEYS),b=without(after,RATING_KEYS);
  const mA=a.meta,mB=b.meta;
  if(mA===undefined&&mB!==undefined){
   if(serialized(without(mB,['devProfileV25']))!==serialized({}))
    fail(409,'Progression added unauthorized player metadata');
   delete b.meta;
  }
  else if(mA!==undefined&&mB===undefined)fail(409,'Progression removed player metadata');
  else if(mA!==undefined&&mB!==undefined){a.meta=without(mA,['devProfileV25']);b.meta=without(mB,['devProfileV25']);}
  if(serialized(a)!==serialized(b))fail(409,'Progression attempted to alter player contracts, team, rights, or history');
 }
 if(rookie(before,year)){
  if(serialized(before)!==serialized(after))fail(409,'A freshly drafted rookie was aged or progressed before their first season');
  return;
 }
 const age=Number(before.age??25),nextAge=Number(after.age),last=Number(before.lastBirthdayYear??year-1);
 if(!Number.isInteger(age)||!Number.isInteger(nextAge)||nextAge!==age+(last<year?1:0)||age<17||nextAge>52)
  fail(409,'Progression violated single-player once-a-year birthday rules');
 for(const field of ['overall','potential']){
  const old=Number(before[field]??(field==='potential'?before.overall:0)),val=Number(after[field]);
  if(!Number.isInteger(val)||val<40||val>99||!Number.isFinite(old)||Math.abs(val-old)>25)
   fail(409,'Progression ratings exceeded trusted bounds');
 }
 if(!Array.isArray(after.attrs)||after.attrs.length!==15||after.attrs.some(v=>!Number.isFinite(v)||v<0||v>100))
  fail(409,'Progression returned invalid player attributes');
 for(const field of ['offRating','defRating','stamina','scoringRating']){
  const v=Number(after[field]);if(!Number.isFinite(v)||v<0||v>100)fail(409,`Invalid derived ${field} rating`);
 }
 if(after.lastBirthdayYear!==undefined&&!Number.isInteger(Number(after.lastBirthdayYear)))fail(409,'Invalid birthday marker');
}
export function verifyProgressionOutput(before,after,year){
 if(!after||typeof after!=='object'||Array.isArray(after))fail(409,'Progression returned no shared league state');
 const rootAllowed=['teams','conferences','freeAgents','onlineProgression','offseasonState'];
 if(serialized(without(before,rootAllowed))!==serialized(without(after,rootAllowed)))
  fail(409,'Progression attempted to modify unrelated league state');
 if((own(before,'teams'))!==(own(after,'teams'))||(own(before,'conferences'))!==(own(after,'conferences')))
  fail(409,'Progression switched roster layouts');
 if(before.conferences&&serialized(Object.keys(before.conferences))!==serialized(Object.keys(after.conferences||{})))
  fail(409,'Progression changed conferences');
 const ta=allTeams(before),tb=allTeams(after);
 if(ta.length!==30||tb.length!==30)fail(409,'Progression lost an NBA team');
 for(let i=0;i<ta.length;i++){
  if(ta[i]?.name!==tb[i]?.name||serialized(without(ta[i],BUCKETS))!==serialized(without(tb[i],BUCKETS)))
   fail(409,'Progression altered team ownership or finances');
  for(const bucket of BUCKETS){
   if((own(ta[i],bucket))!==own(tb[i],bucket)||
      (ta[i][bucket]||[]).length!==(tb[i][bucket]||[]).length)
    fail(409,'Progression changed a team roster bucket');
  }
 }
 const a=playerRows(before),b=playerRows(after);
 if(a.length!==b.length)fail(409,'Progression changed total player population');
 if(own(before,'freeAgents')!==own(after,'freeAgents'))fail(409,'Free agent pool unexpectedly created or removed');
 const expected=[];
 for(let i=0;i<a.length;i++){
  const o=a[i],n=b[i];
  if(o.team!==n.team||o.bucket!==n.bucket||String(o.player.id)!==String(n.player.id))
   fail(409,'Progression moved or swapped a player');
  allowedPlayer(o.player,n.player,year);
  expected.push({id:String(o.player.id),name:String(o.player.name||''),team:o.team,bucket:o.bucket,
   ageBefore:Number(o.player.age||0),ageAfter:Number(n.player.age||0),
   overallBefore:Number(o.player.overall||0),overallAfter:Number(n.player.overall||0),
   overallDelta:Number(n.player.overall||0)-Number(o.player.overall||0),
   potentialBefore:Number(o.player.potential||0),potentialAfter:Number(n.player.potential||0)});
 }
 const stage=after.onlineProgression||{},os=before.offseasonState||{},next=after.offseasonState||{};
 if(before.onlineProgression!==undefined||
  serialized(without(stage,['status','seasonYear','summary','changes']))!==serialized({})||
  stage.status!=='complete'||stage.seasonYear!==year||
  !Array.isArray(stage.changes)||serialized(stage.changes)!==serialized(expected)||
  next.progressionComplete!==true||next.progressionSeasonYear!==year||
  serialized(without(os,['progressionComplete','progressionSeasonYear']))!==
  serialized(without(next,['progressionComplete','progressionSeasonYear'])))
  fail(409,'Progression changed offseason stage or displayed incorrect player results');
 const summary={playerCount:expected.length,improved:expected.filter(p=>p.overallDelta>0).length,
  declined:expected.filter(p=>p.overallDelta<0).length,
  unchanged:expected.filter(p=>p.overallDelta===0).length,
  aged:expected.filter(p=>p.ageAfter>p.ageBefore).length,
  protectedRookies:a.filter(x=>rookie(x.player,year)).length,
  engineVersion:stage.summary?.engineVersion};
 if(typeof summary.engineVersion!=='string'||summary.engineVersion.length<5||
   serialized(stage.summary)!==serialized(summary))
  fail(409,'Progression audit totals do not match roster changes');
 return summary;
}
export function originalProgression(state,year,seed){
 const executable=process.env.BM_PYTHON_BIN||(process.platform==='win32'?'python':'python3');
 const p=spawnSync(executable,['-I',worker],{input:serialized({league:state,year,seed}),
  encoding:'utf8',timeout:180000,maxBuffer:96*1024*1024,windowsHide:true});
 if(p.error||p.status!==0||!p.stdout)fail(503,'Original player progression engine unavailable. No state saved.');
 let out;try{out=JSON.parse(p.stdout);}catch{fail(503,'Original progression engine returned invalid JSON');}
 if(out?.ok!==true)fail(409,String(out?.reason||'Progression engine rejected the league').slice(0,330));
 const oldRows=playerRows(state);
 playerRows(out.state);
 // The single-player UI always normalizes derived ratings after Python.
 // Copy the exact V19 JS source into the backend and restore protected rookies.
 recomputeDerivedRatingsInLeague(out.state,{preserveOverall:true});
 const newRows=playerRows(out.state);
 for(let i=0;i<newRows.length;i++){
  if(rookie(oldRows[i].player,year)){
   const dest=newRows[i].player,original=oldRows[i].player;
   for(const key of Object.keys(dest))delete dest[key];
   Object.assign(dest,structuredClone(original));
  }
 }
 // No extra pass on the age/potential model; update display rows using
 // the FINAL V19 normalized saved state, not intermediate Python deltas.
 const changes=out.state.onlineProgression.changes;
 for(let i=0;i<changes.length;i++){
  const row=changes[i],player=newRows[i].player;
  row.ageAfter=Number(player.age||0);
  row.overallAfter=Number(player.overall||0);
  row.overallDelta=row.overallAfter-row.overallBefore;
  row.potentialAfter=Number(player.potential||0);
 }
 const summary=out.state.onlineProgression.summary;
 summary.improved=changes.filter(p=>p.overallDelta>0).length;
 summary.declined=changes.filter(p=>p.overallDelta<0).length;
 summary.unchanged=changes.filter(p=>p.overallDelta===0).length;
 summary.aged=changes.filter(p=>p.ageAfter>p.ageBefore).length;
 verifyProgressionOutput(state,out.state,year);
 return out.state;
}
function config(){
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key||!/^https:\/\/[\w.-]+$/i.test(url))fail(503,'Trusted progression backend is not configured');
 return {url:url.replace(/\/$/,''),key};
}
async function get(c,path){
 const r=await fetch(`${c.url}${path}`,{headers:{apikey:c.key,Authorization:`Bearer ${c.key}`},signal:AbortSignal.timeout(20000)});
 if(!r.ok)fail(503,'Unable to read shared league');return r.json();
}
export async function onlineProgressionRequest(req,res){
 res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
 try{
  const body=req.body||{};
  if(typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['lobbyId','expectedRevision','requestId'].includes(k))||
   !UUID.test(String(body.lobbyId||''))||!UUID.test(String(body.requestId||''))||
   !Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<1)
   fail(400,'Invalid progression request or revision');
  const token=String(req.get('authorization')||'').match(/^Bearer ([a-z\d_.-]{20,5000})$/i)?.[1];
  if(!token)fail(401,'Sign in to your online franchise');
  const c=config();
  const auth=await fetch(`${c.url}/auth/v1/user`,{headers:{apikey:c.key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)});
  if(!auth.ok)fail(401,'Online session expired');
  const user=await auth.json();if(!UUID.test(String(user?.id||'')))fail(401,'Invalid online account');
  const now=Date.now(),rate=rates.get(user.id)||{start:now,count:0};
  if(now-rate.start>60000)rates.set(user.id,{start:now,count:1});
  else {if(rate.count>=8)fail(429,'Too many progression attempts');rates.set(user.id,{start:rate.start,count:rate.count+1});}
  const [lobby,members]=await Promise.all([
   get(c,`/rest/v1/bm_online_lobbies?id=eq.${body.lobbyId}&select=host_id,status`),
   get(c,`/rest/v1/bm_online_lobby_members?lobby_id=eq.${body.lobbyId}&user_id=eq.${user.id}&select=user_id`)]);
  if(lobby.length!==1||lobby[0].status!=='started'||members.length!==1)
   fail(403,'Not a member of the online league');
  if(lobby[0].host_id!==user.id)fail(403,'Only the host can finalize player progression');
  const inputHash=hash({action:'online_player_progression',lobbyId:body.lobbyId,expectedRevision:body.expectedRevision});
  const events=await get(c,`/rest/v1/bm_online_franchise_events?lobby_id=eq.${body.lobbyId}&request_id=eq.${body.requestId}&select=actor_id,action_type,revision,details`);
  if(events.length){const event=events[0];
   if(event.actor_id!==user.id||event.action_type!=='online_player_progression'||event.details?.inputHash!==inputHash)
    fail(409,'Request ID was used for a different operation');
   return res.json({ok:true,replayed:true,revision:event.revision});
  }
  const rows=await get(c,`/rest/v1/bm_online_franchise_runtime?lobby_id=eq.${body.lobbyId}&select=state,revision`);
  if(rows.length!==1||Number(rows[0].revision)!==body.expectedRevision)
   fail(409,'The league changed. Refresh before progressing players.');
  const state=rows[0].state,year=yearToProgress(state);
  const seed=parseInt(hash({lobby:body.lobbyId,year,phase:'2E4D'}).slice(0,7),16);
  const after=await originalProgressionAsync(state,year,seed);
  const payload={p_lobby:body.lobbyId,p_actor:user.id,p_request:body.requestId,
   p_expected_revision:body.expectedRevision,p_year:year,p_input_hash:inputHash,p_new_state:after};
  const commit=await fetch(`${c.url}/rest/v1/rpc/bm_online_apply_progression_phase2e4d`,{
   method:'POST',headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,'Content-Type':'application/json'},
   body:serialized(payload),signal:AbortSignal.timeout(80000)});
  const outcome=await commit.json().catch(()=>null);
  if(!commit.ok||outcome?.ok!==true)
   fail(409,'The authoritative database rejected progression. No unconfirmed changes accepted; refresh and retry.');
  return res.json({ok:true,revision:outcome.revision,seasonYear:year,summary:after.onlineProgression.summary,replayConfirmed:true});
 }catch(e){return res.status(e.status||503).json({ok:false,error:e.message||'Online progression is unavailable'});}
}

const originalProgressionAsync=(...args)=>runOriginalInWorker('progression',args);
