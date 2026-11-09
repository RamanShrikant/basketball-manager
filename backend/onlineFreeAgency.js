// Online 2E.4-C1: original single-player offseason offer engine behind authenticated,
// host/GM-only, revision-locked Supabase RPCs. No browser-provided league state.
import {spawnSync} from 'node:child_process';
import {runOriginalInWorker} from './onlineOriginalWorkerPool.mjs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateResolutionRequest,verifyMarketStep} from './onlineMarketSettlement.js';

const worker=fileURLToPath(new URL('./online_options_python/online_free_agency_worker.py',import.meta.url));
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const rates=new Map();
function fail(status,message){const e=new Error(message);e.status=status;throw e;}
function digest(x){return createHash('sha256').update(JSON.stringify(x)).digest('hex');}
export function freeAgencyStage(state){
 const year=Number(state?.onlineDraft?.draftYear);
 if(!Number.isInteger(year)||year<2026||year>2100||
    state?.onlineRights?.status!=='complete'||Number(state?.onlineRights?.year)!==year||
    state?.offseasonState?.rightsManagementComplete!==true||
    state?.onlineOptions?.status!=='complete'||Number(state.onlineOptions.year)!==year||
    state?.offseasonState?.optionsComplete!==true||
    state?.onlineRookieSignings?.status!=='complete'||
    state?.offseasonState?.freeAgencyComplete===true)
   fail(409,'Finish the current offseason options and rights windows before opening the free-agent market.');
 return year;
}
export function validateMarketRequest(mode,body){
 if(!['open','offer','resolve','decision','next'].includes(mode))fail(400,'Unknown market action');
 if(['resolve','decision','next'].includes(mode))return validateResolutionRequest(mode,body);
 const keys=mode==='open'?['lobbyId','expectedRevision','requestId']:
   ['lobbyId','expectedRevision','requestId','playerId','salary','years','optionType'];
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k))||
    !UUID.test(String(body.lobbyId||''))||!UUID.test(String(body.requestId||''))||
    !Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<1)
   fail(400,'Invalid market request or revision');
 if(mode==='offer'&&(!body.playerId||!['string','number'].includes(typeof body.playerId)||
    String(body.playerId).length>150||!Number.isSafeInteger(body.salary)||body.salary<100000||body.salary>120000000||
    body.salary%1000!==0||!Number.isInteger(body.years)||body.years<1||body.years>5||
    !['none','team','player'].includes(body.optionType)||(body.years===1&&body.optionType!=='none')))
   fail(400,'Invalid offer terms');
 return body;
}
export function runOriginalFreeAgency(state,info){
 const binary=process.env.BM_PYTHON_BIN||(process.platform==='win32'?'python':'python3');
 const p=spawnSync(binary,['-I',worker],{input:JSON.stringify({league:state,...info}),
  encoding:'utf8',timeout:90000,maxBuffer:48*1024*1024,windowsHide:true});
 if(p.error||p.status!==0||!p.stdout)fail(503,'The original free-agency engine is unavailable; no shared state changed.');
 let result;try{result=JSON.parse(p.stdout);}catch{fail(503,'The free-agency engine returned invalid output');}
 if(result?.ok!==true)fail(409,String(result?.reason||'Original contract engine rejected the action').slice(0,300));
 return result;
}
export function verifyMarketOutput(oldState,result,{mode,humanTeams,team,playerId,year}){
 const market=result?.market;
 if(result?.year!==year||!market||typeof market!=='object'||Array.isArray(market)||
    market.isActive!==true||!Number.isInteger(market.currentDay)||market.currentDay<1||market.currentDay>10||
    market.maxDays!==10||market.status!=='active'||
    market.pendingUserDecisions?.length!==0||market.pendingRfaMatchDecisions?.length!==0||
    !market.offersByPlayer||typeof market.offersByPlayer!=='object'||
    !Array.isArray(market.dailyLog)||!Array.isArray(market.offerHistory)||
    !Array.isArray(market.signedPlayersLog)||
    (mode==='open'&&(market.currentDay!==1||market.signedPlayersLog.length!==0)))
   fail(409,'Original market output did not preserve the safe opening state');
 const actual=oldState.freeAgencyState;
 if(mode==='offer'){
   if(!actual||actual.isActive!==true||actual.currentDay!==market.currentDay)
    fail(409,'Offer unexpectedly changed the market day');
   for(const k of new Set([...Object.keys(actual),...Object.keys(market)])){
    if(!['offersByPlayer','offerHistory','dailyLog'].includes(k)&&JSON.stringify(actual[k])!==JSON.stringify(market[k]))
     fail(409,'Original offer attempted to alter the cap ledger or unrelated league state');
   }
   const offer=result.submittedOffer;
   if(!offer||String(offer.playerId)!==String(playerId)||offer.teamName!==team||
      offer.source!=='user'||offer.status!=='active'||offer.submittedDay!==market.currentDay||
      offer.playerKey!==`id:${playerId}`||!Array.isArray(offer.salaryByYear)||
      offer.salaryByYear.length<1||offer.salaryByYear.length>5)
     fail(409,'Original engine returned a malformed human offer');
   for(const key of new Set([...Object.keys(actual.offersByPlayer||{}),...Object.keys(market.offersByPlayer||{})])){
     const before=actual.offersByPlayer?.[key]||[],after=market.offersByPlayer?.[key]||[];
     if(key!==`id:${playerId}`){
       if(JSON.stringify(before)!==JSON.stringify(after))fail(409,'An offer changed another player bid');
     }else if(JSON.stringify(before.filter(o=>o.teamName!==team))!==JSON.stringify(after.filter(o=>o.teamName!==team)))
       fail(409,'An offer changed another GM’s bid');
   }
   const target=market.offersByPlayer[`id:${playerId}`]||[];
   if(target.filter(o=>o.teamName===team&&o.status==='active').length!==1||
      JSON.stringify(target.find(o=>o.teamName===team&&o.status==='active'))!==JSON.stringify(offer))
     fail(409,'Original engine did not register exactly one active offer');
 }else{
  const humans=new Set(humanTeams);
  const rosterNames=new Set((oldState.teams||Object.values(oldState.conferences||{}).flat()).map(t=>t.name));
  const faIds=new Set((oldState.freeAgents||[]).map(p=>String(p.id)));
  const seen=new Set();
  for(const rows of Object.values(market.offersByPlayer)){
   if(!Array.isArray(rows))fail(409,'Malformed CPU free-agent market board');
   for(const offer of rows){
    if(offer.source!=='cpu'||humans.has(offer.teamName)||!rosterNames.has(offer.teamName)||
       !faIds.has(String(offer.playerId))||!['active','withdrawn','replaced'].includes(offer.status||'active'))
     fail(409,'CPU free-agency board attempted to target a human team or invalid player');
    const key=`${offer.playerKey}|${offer.teamName}`;
    if(seen.has(key))fail(409,'Duplicate CPU free-agent offers detected');seen.add(key);
   }
  }
 }
 return market;
}
function config(){
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key||!/^https:\/\/[\w.-]+$/i.test(url))fail(503,'Online offseason service is not configured');
 return {url:url.replace(/\/$/,''),key};
}
async function get(c,path){
 const r=await fetch(`${c.url}${path}`,{headers:{apikey:c.key,Authorization:`Bearer ${c.key}`},signal:AbortSignal.timeout(18000)});
 if(!r.ok)fail(503,'Could not read the authoritative online league');return r.json();
}
export async function onlineFreeAgencyRequest(req,res,mode){
 res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
 try{
  const body=validateMarketRequest(mode,req.body);
  const token=String(req.get('authorization')||'').match(/^Bearer ([a-z\d_.-]{20,5000})$/i)?.[1];
  if(!token)fail(401,'Sign in to manage free agency');
  const c=config();
  const r=await fetch(`${c.url}/auth/v1/user`,{headers:{apikey:c.key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)});
  if(!r.ok)fail(401,'Your online session has expired');
  const user=await r.json();if(!UUID.test(String(user?.id||'')))fail(401,'Invalid account identity');
  const now=Date.now(),previous=rates.get(user.id)||{start:now,count:0};
  const next=now-previous.start>60000?{start:now,count:1}:{start:previous.start,count:previous.count+1};
  rates.set(user.id,next);if(next.count>20)fail(429,'Too many offseason actions. Please retry after a minute.');
  const [lobbies,members]=await Promise.all([
   get(c,`/rest/v1/bm_online_lobbies?id=eq.${body.lobbyId}&select=host_id,status`),
   get(c,`/rest/v1/bm_online_lobby_members?lobby_id=eq.${body.lobbyId}&select=user_id,team_name`)]);
  if(lobbies.length!==1||lobbies[0].status!=='started'||!members.some(m=>m.user_id===user.id))
   fail(403,'Not an active GM in this league');
  const myTeam=members.find(m=>m.user_id===user.id)?.team_name;
  const humans=members.map(m=>m.team_name).filter(Boolean);
  if(!myTeam||humans.length<1||humans.length>4||new Set(humans).size!==humans.length)
   fail(409,'Invalid active human-GM assignments');
  if(['open','resolve','next'].includes(mode)&&lobbies[0].host_id!==user.id)fail(403,'Only the host can advance offseason free agency');
  const dataHash=digest({mode,team:['offer','decision'].includes(mode)?myTeam:null,kind:mode==='decision'?body.kind:null,choice:mode==='decision'?body.choice:null,playerKey:mode==='decision'?body.playerKey:null,playerId:mode==='offer'?String(body.playerId):null,
    salary:mode==='offer'?body.salary:null,years:mode==='offer'?body.years:null,optionType:mode==='offer'?body.optionType:null});
  const prior=await get(c,`/rest/v1/bm_online_franchise_events?lobby_id=eq.${body.lobbyId}&request_id=eq.${body.requestId}&select=actor_id,action_type,revision,details`);
  if(prior.length){
   const p=prior[0];if(p.actor_id!==user.id||p.action_type!==`online_market_${mode}`||p.details?.inputHash!==dataHash)
    fail(409,'This request ID was used for another operation');
   return res.json({ok:true,replayed:true,revision:p.revision});
  }
  const rows=await get(c,`/rest/v1/bm_online_franchise_runtime?lobby_id=eq.${body.lobbyId}&select=state,revision`);
  if(rows.length!==1||Number(rows[0].revision)!==body.expectedRevision)fail(409,'The league changed. Refresh market offers first.');
  const state=rows[0].state,year=freeAgencyStage(state);
  if(mode==='open'&&(state.onlineOffseasonMarket?.status==='active'||state.freeAgencyState?.isActive))
   fail(409,'The shared offseason market is already open');
  if(mode!=='open'&&(state.onlineOffseasonMarket?.status!=='active'||Number(state.onlineOffseasonMarket.year)!==year||
       state.freeAgencyState?.isActive!==true))fail(409,'The host must open offseason free agency first');
  if(mode==='offer'&&(state.onlineOffseasonMarket?.phase!=='offers'||
       state.freeAgencyState?.pendingUserDecisions?.length||state.freeAgencyState?.pendingRfaMatchDecisions?.length))
       fail(409,'Resolve outstanding GM decisions before submitting additional offers');
  const result=await runOriginalFreeAgencyAsync(state,{mode,year,humanTeams:humans,
    ...(mode==='offer'?{teamName:myTeam,playerId:String(body.playerId),salary:body.salary,
      years:body.years,optionType:body.optionType}:{}),
    ...(mode==='decision'?{teamName:myTeam,playerKey:body.playerKey,kind:body.kind,choice:body.choice}:{})});
  let market;
  let stepSummary;
  if(['resolve','decision','next'].includes(mode)){
    stepSummary=verifyMarketStep(state,result,{mode,humans,actorTeam:myTeam});
  }else{
    market=verifyMarketOutput(state,result,{mode,humanTeams:humans,team:myTeam,playerId:body.playerId,year});
  }
  const rpc=['resolve','decision','next'].includes(mode)?'bm_online_market_step_phase2e4c2':
    mode==='open'?'bm_online_open_market_phase2e4c':'bm_online_submit_market_offer_phase2e4c';
  const data={p_lobby:body.lobbyId,p_actor:user.id,p_request:body.requestId,
   p_expected_revision:body.expectedRevision,p_year:year,p_input_hash:dataHash,
   ...(['resolve','decision','next'].includes(mode)?{p_mode:mode,p_kind:body.kind||'',p_player_key:body.playerKey||'',
      p_choice:body.choice||'',p_new_state:result.state}:{p_market:market}),
   ...(mode==='offer'?{p_player_id:String(body.playerId),p_offer:result.submittedOffer}:{})};
  const commit=await fetch(`${c.url}/rest/v1/rpc/${rpc}`,{method:'POST',
   headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,'Content-Type':'application/json'},
   body:JSON.stringify(data),signal:AbortSignal.timeout(50000)});
  const confirmed=await commit.json().catch(()=>null);
  if(!commit.ok||confirmed?.ok!==true)fail(409,'The authoritative league rejected the market action. Refresh and retry.');
  return res.json({ok:true,revision:confirmed.revision,replayed:Boolean(confirmed.replayed),
   year,offerId:mode==='offer'?result.submittedOffer.offerId:undefined,
   openingCpuOffers:mode==='open'?result.generatedOffers:undefined,
   ...(stepSummary?{...stepSummary}:{}),replayConfirmed:true});
 }catch(e){return res.status(e.status||503).json({ok:false,error:e.message||'Online free agency unavailable'});}
}

const runOriginalFreeAgencyAsync=(...args)=>runOriginalInWorker('freeagency',args);
