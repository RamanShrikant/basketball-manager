// Phase 2D.2-E — authoritative All-Star checkpoint using untouched Python selector.
// Browser supplies only lobby, request ID and expected revision. No client picks, stats or scores.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {firstBlockedOnlineCheckpoint,pendingOnlineGameDays} from '../frontend/src/online/onlineSimulationCheckpoints.mjs';
import {leagueTeams} from './onlineSimulationCore.js';

const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const script=fileURLToPath(new URL('./online_sim_python/online_allstar_selector.py',import.meta.url));
const budgets=new Map();
function fail(status,message){const e=new Error(message);e.status=status;throw e;}
function configuration(){
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key||!/^https:\/\/[a-z0-9.-]+$/i.test(url))fail(503,'Online All-Star service is not configured.');
  return {url:url.replace(/\/$/,''),key};
}
async function read(c,path){
  const response=await fetch(`${c.url}${path}`,{
    headers:{apikey:c.key,Authorization:`Bearer ${c.key}`},signal:AbortSignal.timeout(15000)
  });
  if(!response.ok)fail(503,'Could not verify online franchise state.');
  return response.json();
}
export function evaluateAllStarReadiness(state){
  const pending=pendingOnlineGameDays(state);
  if(!pending.length)fail(409,'No regular-season games remain for All-Star selection.');
  if(pending[0].played)fail(409,'A partially completed game day must be repaired first.');
  const checkpoint=firstBlockedOnlineCheckpoint(state,pending[0].date);
  if(checkpoint?.kind!=='all_star'||checkpoint.date>=pending[0].date)
    fail(409,'All-Star selection is not the next required checkpoint.');
  if(state?.onlineAllStars||state?.onlineCheckpoints?.all_star)
    fail(409,'All-Star selections were already recorded. Refresh the online franchise.');
  return {date:checkpoint.date,seasonYear:Number(state.onlineSchedule.seasonYear)};
}
function teamConf(team){
  const text=String(team?.conference||team?.conf||team?.conferenceName||'').toLowerCase();
  return /\beast(ern)?\b/.test(text)?'East':/\bwest(ern)?\b/.test(text)?'West':null;
}
export function prepareAllStarInput(state,date){
  const teams=leagueTeams(state);
  if(teams.length!==30||new Set(teams.map(t=>t?.name)).size!==30)
    fail(409,'The shared league must have 30 distinct teams before selection.');
  const confs={East:[],West:[]};
  const stored=state?.conferences||{};
  const known=new Map();
  for(const [label,rows] of [['East',stored.East||stored.east],['West',stored.West||stored.west]]){
    for(const t of Array.isArray(rows)?rows:[]){
      const name=typeof t==='string'?t:t?.name||t?.team;
      if(name){if(known.has(name)&&known.get(name)!==label)fail(409,'A team is listed in both conferences.');known.set(name,label);}
    }
  }
  const rosterNames=new Set();
  for(const team of teams){
    const conf=known.get(team.name)||teamConf(team);
    if(!conf)fail(409,`Conference for ${team.name} is missing. Repair the shared league first.`);
    if(!Array.isArray(team.players)||team.players.length<5)fail(409,'A team roster is incomplete.');
    confs[conf].push({name:team.name});
    for(const player of team.players){
      const name=player?.name||player?.player;
      if(!name||rosterNames.has(name))fail(409,'Duplicate or unnamed active players prevent reliable All-Star selection.');
      rosterNames.add(name);
    }
  }
  if(confs.East.length!==15||confs.West.length!==15)fail(409,'Online conferences must have 15 teams each.');
  const stats=state?.onlinePlayerStats;
  if(!stats||typeof stats!=='object'||Array.isArray(stats))fail(409,'Shared season player statistics have not been recorded.');
  const filtered={};
  for(const [key,entry] of Object.entries(stats)){
    if(!entry||typeof entry!=='object'||!rosterNames.has(entry.player||entry.name))continue;
    const gp=Number(entry.gp);
    if(!Number.isFinite(gp)||gp<0||gp>82)fail(409,'Online player statistics contain invalid game counts.');
    filtered[key]=entry;
  }
  if(Object.keys(filtered).length<24)fail(409,'Not enough played NBA games for authentic All-Star selections.');
  const byDate=state?.onlineSchedule?.byDate;
  if(!byDate||typeof byDate!=='object')fail(409,'Online season calendar is missing.');
  const results={};
  for(const [key,result] of Object.entries(state.onlineResults||{})){
    if(!result||result.date>=date)continue;
    const home=Number(result.homeScore),away=Number(result.awayScore);
    if(!Number.isInteger(home)||!Number.isInteger(away)||home===away)fail(409,'A recorded NBA result is invalid.');
    results[key]={totals:{home,away}};
  }
  return {season:`${state.onlineSchedule.seasonYear}-${Number(state.onlineSchedule.seasonYear)+1}`,
    cutoff_date:date,min_games:12,playerStats:filtered,
    leagueData:{teams,conferences:confs},scheduleByDate:byDate,resultsById:results};
}
export function runOriginalAllStarSelector(payload,{python=process.env.BM_PYTHON_BIN||(process.platform==='win32'?'python':'python3'),timeoutMs=25000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(python,['-I',script],{
      cwd:fileURLToPath(new URL('./online_sim_python/',import.meta.url)),
      env:{PATH:process.env.PATH||'',PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'},
      stdio:['pipe','pipe','pipe'],windowsHide:true
    });
    let stdout='',stderr='',done=false;
    const abort=message=>{if(done)return;done=true;child.kill('SIGKILL');reject(new Error(message));};
    const timer=setTimeout(()=>abort('Original All-Star selector timed out.'),timeoutMs);
    child.stdout.on('data',chunk=>{stdout+=chunk.toString();if(stdout.length>150000)abort('All-Star result was oversized.');});
    child.stderr.on('data',chunk=>{stderr+=chunk.toString();if(stderr.length>12000)abort('All-Star selector failed.');});
    child.on('error',()=>{clearTimeout(timer);if(!done){done=true;reject(new Error('Trusted Python All-Star selector cannot start.'));}});
    child.on('close',code=>{
      clearTimeout(timer);if(done)return;done=true;
      if(code!==0)return reject(new Error('Original single-player All-Star selector failed. No checkpoint was committed.'));
      try{resolve(JSON.parse(stdout));}catch{reject(new Error('All-Star selector returned malformed output.'));}
    });
    child.stdin.on('error',()=>{});
    const json=JSON.stringify(payload);
    if(json.length>11000000){abort('Season statistics exceed the trusted selection limit.');return;}
    child.stdin.end(json);
  });
}
export function validateAllStarOutput(input,result){
  if(result?.season!==input.season||result?.cutoff_date!==input.cutoff_date||
    typeof result?.all_star_version!=='string'||result.all_star_version.length>90)
    fail(409,'All-Star selector returned the wrong season, date or version.');
  const selected=new Set();
  const league=new Map(input.leagueData.teams.map(t=>[t.name,new Set(t.players.map(p=>p.name||p.player))]));
  for(const [conference,count] of [['east',5],['west',5]]){
    const teams=new Set(input.leagueData.conferences[conference==='east'?'East':'West'].map(t=>t.name));
    for(const [bucket,expected] of [['starters',count],['reserves',7]]){
      const rows=result?.[conference]?.[bucket];
      if(!Array.isArray(rows)||rows.length!==expected)fail(409,'An All-Star conference team is incomplete.');
      for(const row of rows){
        if(!teams.has(row?.team)||!league.get(row.team)?.has(row?.player)||
          selected.has(row.player)||!Number.isFinite(Number(row.gp))||Number(row.gp)<12)
          fail(409,'All-Star selection includes invalid, duplicate or ineligible players.');
        selected.add(row.player);
      }
    }
  }
  if(selected.size!==24)fail(409,'All-Star selections must contain 24 distinct eligible players.');
  if(JSON.stringify(result).length>95000)fail(409,'All-Star result exceeds shared league limits.');
  return result;
}
export async function selectOnlineAllStarsRequest(req,res){
  res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
  try{
    const b=req.body||{};
    if(Object.keys(b).some(k=>!['lobbyId','requestId','expectedRevision'].includes(k))||
      !UUID.test(String(b.lobbyId||''))||!UUID.test(String(b.requestId||''))||
      !Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<1)fail(400,'Invalid All-Star selection request.');
    const token=String(req.get('authorization')||'').match(/^Bearer ([A-Za-z0-9_.-]{20,5000})$/)?.[1];
    if(!token)fail(401,'Sign in to select the shared All-Star teams.');
    const c=configuration();
    const auth=await fetch(`${c.url}/auth/v1/user`,{headers:{apikey:c.key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)});
    if(!auth.ok)fail(401,'Online session expired.');
    const user=await auth.json();
    if(!UUID.test(String(user?.id||'')))fail(401,'Invalid online account.');
    const now=Date.now();for(const [id,entry] of budgets)if(now-entry.at>60000)budgets.delete(id);
    const prior=budgets.get(user.id);const hits=(prior?.hits||0)+1;
    if(hits>8)fail(429,'Too many checkpoint requests.');
    budgets.set(user.id,{at:prior?.at||now,hits});
    const lobbies=await read(c,`/rest/v1/bm_online_lobbies?id=eq.${b.lobbyId}&select=host_id,status`);
    if(lobbies.length!==1||lobbies[0].status!=='started'||lobbies[0].host_id!==user.id)
      fail(403,'Only the current league host may select All-Stars.');
    const members=await read(c,`/rest/v1/bm_online_lobby_members?lobby_id=eq.${b.lobbyId}&user_id=eq.${user.id}&select=user_id`);
    if(members.length!==1)fail(403,'The host is not a member of the online league.');
    const events=await read(c,`/rest/v1/bm_online_franchise_events?lobby_id=eq.${b.lobbyId}&request_id=eq.${b.requestId}&select=actor_id,action_type,revision,details`);
    if(events.length){
      const event=events[0];
      if(event.actor_id!==user.id||event.action_type!=='all_star_selected')fail(409,'Request ID belongs to another operation.');
      return res.json({ok:true,replayed:true,revision:event.revision,date:event.details?.date});
    }
    const rows=await read(c,`/rest/v1/bm_online_franchise_runtime?lobby_id=eq.${b.lobbyId}&select=state,revision`);
    if(rows.length!==1||Number(rows[0].revision)!==b.expectedRevision)fail(409,'Shared franchise changed. Refresh before selecting.');
    const checkpoint=evaluateAllStarReadiness(rows[0].state);
    const input=prepareAllStarInput(rows[0].state,checkpoint.date);
    const output=validateAllStarOutput(input,await runOriginalAllStarSelector(input));
    // Database row lock and revision check ensure the Python result is still current.
    const r=await fetch(`${c.url}/rest/v1/rpc/bm_online_select_all_stars_phase2d2e`,{
      method:'POST',headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,'Content-Type':'application/json'},
      body:JSON.stringify({p_lobby:b.lobbyId,p_actor:user.id,p_request:b.requestId,
        p_expected_revision:b.expectedRevision,p_date:checkpoint.date,p_all_stars:output}),
      signal:AbortSignal.timeout(30000)
    });
    const committed=await r.json().catch(()=>null);
    if(!r.ok||!committed?.ok)fail(409,'All-Star selection was not committed. Refresh the shared league.');
    return res.json({ok:true,date:checkpoint.date,revision:committed.revision,replayed:!!committed.replayed});
  }catch(e){const status=e.status||503;return res.status(status).json({ok:false,error:status===503?'Trusted online All-Star service is unavailable. No selection was committed.':e.message});}
}
