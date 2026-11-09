// Phase 2D.2-F: trusted Online contract extensions; original Python gameplay unchanged.
// Only member/host actions, server-owned snapshots, and locked SQL commits.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {getSeasonCalendarConfig} from '../frontend/src/utils/seasonContext.js';
import {isOnlineISODate,firstBlockedOnlineCheckpoint,pendingOnlineGameDays} from '../frontend/src/online/onlineSimulationCheckpoints.mjs';

const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const script=fileURLToPath(new URL('./online_extension_python/online_extension_worker.py',import.meta.url));
const budget=new Map();
const omit=(o,keys)=>Object.fromEntries(Object.entries(o||{}).filter(([key])=>!keys.includes(key)));
function fail(code,msg){const e=new Error(msg);e.status=code;throw e;}
function config(){
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key||!/^https:\/\/[a-z0-9.-]+$/i.test(url))fail(503,'Online extension service is not configured.');
  return {url:url.replace(/\/$/,''),key};
}
async function get(c,path,token=c.key){
  const r=await fetch(`${c.url}${path}`,{headers:{apikey:c.key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(14000)});
  if(!r.ok)fail(503,'Could not verify the current online league.');
  return r.json();
}
function teams(state){
  if(Array.isArray(state?.teams))return state.teams;
  return Object.entries(state?.conferences||{}).flatMap(([,rows])=>Array.isArray(rows)?rows:[]);
}
export function evaluateExtensionWindow(state,{closing=false}={}){
  if(state?.onlineSchedule?.phase!=='regular-season')fail(409,'Extensions require an active regular season.');
  const year=Number(state?.onlineSchedule?.seasonYear);
  if(!Number.isInteger(year)||year<2025||year>2094)fail(409,'Online season year is invalid.');
  const date=getSeasonCalendarConfig(state).veteranExtensionDeadlineDate;
  if(!isOnlineISODate(date)||Number(date.slice(0,4))!==year+1)fail(409,'Veteran extension date is invalid.');
  if(state?.onlineCheckpoints?.veteran_extension||state?.contractExtensionState?.closedTypes?.includes('veteran'))
    fail(409,'The veteran extension window is already closed.');
  const pending=pendingOnlineGameDays(state);
  if(!pending.length)fail(409,'The Online regular-season schedule has no remaining game days.');
  if(pending[0].played)fail(409,'Partially completed game day requires recovery first.');
  const nextDate=pending[0].date;
  if(closing){
    if(nextDate<=date)fail(409,'Finish all games before the extension deadline.');
    const blocked=firstBlockedOnlineCheckpoint(state,nextDate);
    if(blocked?.kind!=='extension_deadline'||blocked.date!==date)
      fail(409,'An earlier league checkpoint must be resolved first.');
  }else if(nextDate>date){
    const blocked=firstBlockedOnlineCheckpoint(state,nextDate);
    if(blocked?.kind!=='extension_deadline'||blocked.date!==date)
      fail(409,'This extension window cannot be reopened after advancing.');
  }
  const currentDate=nextDate>date?date:nextDate;
  return {date,currentDate,seasonYear:year,nextGameDate:nextDate};
}

// Only extension-related player properties and existing salary-array suffixes may change.
const playerKeys=['contract','history','rights','meta','rookieScale','restrictedFreeAgent',
  'qualifyingOffer','qualifyingOfferEligible','rfaOfferSheet','offerSheet','rfaMatched','rfaMatch',
  'rfaStatus','tenderedQO','contractType','rosterStatus'];
const rootKeys=['teams','conferences','contractExtensionHistory','contractExtensionState','playerMoodState'];
export function validateExtensionDelta(before,after,{mode,teamName,playerId,humanTeams=[]}={}){
  if(!after||typeof after!=='object'||Array.isArray(after)||
    !isDeepStrictEqual(omit(before,rootKeys),omit(after,rootKeys)))
    fail(409,'Extension engine tried to modify unrelated shared-league state.');
  if(Array.isArray(before?.teams)!==Array.isArray(after?.teams)||
    !isDeepStrictEqual(omit(before?.conferences,['East','West']),omit(after?.conferences,['East','West'])))
    fail(409,'Extension engine changed league team organization.');
  const previous=teams(before),updated=teams(after);
  if(previous.length!==updated.length||previous.length!==30)fail(409,'Online extension rosters must preserve 30 teams.');
  let changed=0;
  for(let i=0;i<previous.length;i++){
    const oldTeam=previous[i],newTeam=updated[i];
    if(oldTeam?.name!==newTeam?.name||
      !isDeepStrictEqual(omit(oldTeam,['players']),omit(newTeam,['players']))||
      !Array.isArray(oldTeam?.players)||!Array.isArray(newTeam?.players)||
      oldTeam.players.length!==newTeam.players.length)
      fail(409,'An extension cannot move players or change team metadata.');
    for(let j=0;j<oldTeam.players.length;j++){
      const old=oldTeam.players[j],fresh=newTeam.players[j];
      if(old?.id!==fresh?.id||old?.name!==fresh?.name||
        !isDeepStrictEqual(omit(old,playerKeys),omit(fresh,playerKeys)))
        fail(409,'The extension engine tried to alter a player outside contract/rights/mood fields.');
      if(isDeepStrictEqual(old,fresh))continue;
      changed++;
      if(mode==='offer'&&(oldTeam.name!==teamName||String(old.id)!==String(playerId)))
        fail(409,'An online GM extension can only change its selected player.');
      if(mode==='close'&&humanTeams.includes(oldTeam.name))
        fail(409,'CPU extension closure cannot alter a human-controlled player.');
      const oldSalary=old?.contract?.salaryByYear,nowSalary=fresh?.contract?.salaryByYear;
      // Contract changes must append future salary, not rewrite existing years.
      if(!isDeepStrictEqual(old?.contract,fresh?.contract)){
        if(!Array.isArray(oldSalary)||!Array.isArray(nowSalary)||nowSalary.length<oldSalary.length||
          nowSalary.length>oldSalary.length+5||!isDeepStrictEqual(nowSalary.slice(0,oldSalary.length),oldSalary)||
          old?.contract?.startYear!==fresh?.contract?.startYear)
          fail(409,'Extensions may append only future salary years.');
      }
    }
  }
  if(mode==='offer'&&changed>1)fail(409,'One offer cannot change multiple players.');
  if(mode==='close'&&!after?.contractExtensionState?.closedTypes?.includes('veteran'))
    fail(409,'Veteran extension deadline was not closed by the original engine.');
  if(JSON.stringify(after).length>15000000)fail(409,'Shared extension payload exceeds supported size.');
  return {changed};
}

export function runOriginalExtensions(input,{python=process.env.BM_PYTHON_BIN||(process.platform==='win32'?'python':'python3'),timeoutMs=60000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(python,['-I',script],{cwd:fileURLToPath(new URL('./online_extension_python/',import.meta.url)),
      env:{PATH:process.env.PATH||'',PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'},
      stdio:['pipe','pipe','pipe'],windowsHide:true});
    let stdout='',stderr='',done=false;
    const stop=message=>{if(done)return;done=true;child.kill('SIGKILL');reject(new Error(message));};
    const timer=setTimeout(()=>stop('Original extension engine timed out.'),timeoutMs);
    child.stdout.on('data',d=>{stdout+=d.toString();if(stdout.length>18000000)stop('Extension engine output is too large.');});
    child.stderr.on('data',d=>{stderr+=d.toString();if(stderr.length>25000)stop('Extension engine logs are too large.');});
    child.on('error',()=>{clearTimeout(timer);if(!done){done=true;reject(new Error('Trusted extension Python engine could not start.'));}});
    child.on('close',code=>{clearTimeout(timer);if(done)return;done=true;
      if(code!==0)return reject(new Error('Original extension engine failed without modifying the league.'));
      try{const r=JSON.parse(stdout);resolve(r);}catch{reject(new Error('Original extension engine returned invalid JSON.'));}
    });
    child.stdin.on('error',()=>{});
    const json=JSON.stringify(input);
    if(json.length>15000000){stop('Authoritative franchise exceeds extension engine size limit.');return;}
    child.stdin.end(json);
  });
}

function validateOffer(offer){
  if(!offer||typeof offer!=='object'||Array.isArray(offer)||
    Object.keys(offer).some(k=>!['askPackageId','years','firstYearSalary','annualRaisePct','optionType'].includes(k)))
    fail(400,'Invalid extension structure.');
  if(typeof offer.askPackageId==='string'){
    if(Object.keys(offer).length!==1||!/^[a-zA-Z0-9:_-]{3,80}$/.test(offer.askPackageId))fail(400,'Invalid player-requested package.');
  }else if(!Number.isInteger(offer.years)||offer.years<1||offer.years>5||
    !Number.isSafeInteger(offer.firstYearSalary)||offer.firstYearSalary<1000000||offer.firstYearSalary>100000000||
    !Number.isFinite(offer.annualRaisePct)||offer.annualRaisePct<0||offer.annualRaisePct>8||
    !['none','team','player'].includes(offer.optionType))fail(400,'Invalid custom extension offer.');
}

export async function onlineExtensionsRequest(req,res,mode){
  res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
  try{
    const b=req.body||{};
    const fields=mode==='preview'?['lobbyId','expectedRevision']:mode==='offer'?
      ['lobbyId','expectedRevision','requestId','playerId','offer']:['lobbyId','expectedRevision','requestId'];
    if(Object.keys(b).some(k=>!fields.includes(k))||!UUID.test(String(b.lobbyId||''))||
      !Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<1||
      (mode!=='preview'&&!UUID.test(String(b.requestId||''))))fail(400,'Invalid online extension request.');
    if(mode==='offer'){
      if(typeof b.playerId!=='string'||b.playerId.length<1||b.playerId.length>150)fail(400,'Choose a valid roster player.');
      validateOffer(b.offer);
    }
    const token=String(req.get('authorization')||'').match(/^Bearer ([a-zA-Z0-9_.-]{20,5000})$/)?.[1];
    if(!token)fail(401,'Sign in to manage online extensions.');
    const c=config();
    const response=await fetch(`${c.url}/auth/v1/user`,{headers:{apikey:c.key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)});
    if(!response.ok)fail(401,'Online session expired.');
    const user=await response.json();
    if(!UUID.test(String(user?.id||'')))fail(401,'Online account is invalid.');
    const now=Date.now();for(const [id,entry] of budget)if(now-entry.start>60000)budget.delete(id);
    const row=budget.get(user.id);const hits=(row?.hits||0)+1;
    if(hits>(mode==='preview'?35:12))fail(429,'Too many online extension requests.');
    budget.set(user.id,{start:row?.start||now,hits});
    const lobby=await get(c,`/rest/v1/bm_online_lobbies?id=eq.${b.lobbyId}&select=host_id,status`);
    if(lobby.length!==1||lobby[0].status!=='started')fail(403,'This online franchise is not started.');
    const member=await get(c,`/rest/v1/bm_online_lobby_members?lobby_id=eq.${b.lobbyId}&user_id=eq.${user.id}&select=team_name,user_id`);
    if(member.length!==1||!member[0].team_name)fail(403,'You must be an assigned GM in this league.');
    if(mode==='close'&&lobby[0].host_id!==user.id)fail(403,'Only the active host can finalize extensions.');
    // Confirm unique request ID before comparing revisions; safe lost-response retry.
    if(mode!=='preview'){
      const previous=await get(c,`/rest/v1/bm_online_franchise_events?lobby_id=eq.${b.lobbyId}&request_id=eq.${b.requestId}&select=actor_id,action_type,revision,details`);
      if(previous.length){
        const e=previous[0],expected=mode==='offer'?'contract_extension_offered':'veteran_extensions_closed';
        if(e.actor_id!==user.id||e.action_type!==expected||
          (mode==='offer'&&(e.details?.player_id!==b.playerId||!isDeepStrictEqual(e.details?.offer,b.offer))))
          fail(409,'Request identifier belongs to another league action.');
        return res.json({ok:true,replayed:true,revision:e.revision,date:e.details?.date,accepted:e.details?.accepted});
      }
    }
    const runtime=await get(c,`/rest/v1/bm_online_franchise_runtime?lobby_id=eq.${b.lobbyId}&select=revision,state`);
    if(runtime.length!==1||Number(runtime[0].revision)!==b.expectedRevision)
      fail(409,'The league changed. Refresh before submitting your extension.');
    const state=runtime[0].state;
    const window=evaluateExtensionWindow(state,{closing:mode==='close'});
    const controlled=await get(c,`/rest/v1/bm_online_lobby_members?lobby_id=eq.${b.lobbyId}&select=team_name`);
    const humanTeams=[...new Set(controlled.map(m=>m.team_name).filter(Boolean))];
    if(humanTeams.length<1||humanTeams.length>4||!humanTeams.includes(member[0].team_name))
      fail(409,'Human GM team assignments are inconsistent.');
    const engineInput={action:mode==='preview'?'preview':mode==='offer'?'offer':'close',
      leagueData:state,currentDate:window.currentDate,teamName:member[0].team_name,
      humanTeams,playerId:b.playerId,offer:b.offer};
    const result=await runOriginalExtensions(engineInput);
    if(!result?.ok){fail(409,String(result?.reason||'Original extension rules rejected the request.').slice(0,350));}
    if(mode==='preview')return res.json({ok:true,revision:b.expectedRevision,date:window.currentDate,
      teamName:member[0].team_name,players:result.players,summary:result.summary,state:result.state});
    validateExtensionDelta(state,result.leagueData,{mode,teamName:member[0].team_name,playerId:b.playerId,humanTeams});
    const r=await fetch(`${c.url}/rest/v1/rpc/bm_online_commit_extension_phase2d2f`,{
      method:'POST',headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,'Content-Type':'application/json'},
      body:JSON.stringify({p_lobby:b.lobbyId,p_actor:user.id,p_request:b.requestId,
        p_expected_revision:b.expectedRevision,p_action:mode,p_date:window.currentDate,
        p_player_id:mode==='offer'?b.playerId:null,p_offer:mode==='offer'?b.offer:null,
        p_updated_state:result.leagueData}),signal:AbortSignal.timeout(40000)
    });
    const committed=await r.json().catch(()=>null);
    if(!r.ok||!committed?.ok)fail(409,'Extension was not committed. Refresh the league before trying again.');
    return res.json({ok:true,revision:committed.revision,replayed:!!committed.replayed,
      date:window.currentDate,accepted:mode==='offer'?!!result.accepted:undefined,
      summary:mode==='close'?result.summary:undefined,cpuSigned:mode==='close'?result.cpuSigned:undefined,
      decision:mode==='offer'?result.decision:undefined});
  }catch(e){const code=e.status||503;
    return res.status(code).json({ok:false,error:code===503?'Trusted Online extension service is unavailable. No contracts were changed.':e.message});}
}
