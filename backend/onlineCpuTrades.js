// Trust boundary: only this server (using a server-side service-role key) can
// call the CPU trade commit RPC. Browser-submitted objects/CPU decisions are
// NEVER accepted as authority. The evaluator is the unchanged single-player Python.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const pythonAdapter = path.join(moduleDirectory, 'cpu_trade_python', 'evaluate_cpu_trade.py');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const simpleId = /^[a-z0-9_:.-]{1,120}$/i;
const requests = new Map();

function fail(status, message) { const e = new Error(message); e.httpStatus=status; throw e; }
function serviceConfig() {
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !/^https:\/\/[\w.-]+$/.test(url)) fail(503,'CPU trading server is not configured.');
  return {url:url.replace(/\/$/,''),key};
}
async function supabaseGet(config, route, bearer=config.key) {
  const response=await fetch(`${config.url}${route}`,{headers:{apikey:config.key,Authorization:`Bearer ${bearer}`},signal:AbortSignal.timeout(10000)});
  const value=await response.json().catch(()=>null);
  if(!response.ok)fail(response.status===401?401:503,'Unable to verify the authoritative online league.');
  return value;
}
async function supabaseRpc(config, fn, payload) {
  const response=await fetch(`${config.url}/rest/v1/rpc/${fn}`,{
    method:'POST',headers:{apikey:config.key,Authorization:`Bearer ${config.key}`,'Content-Type':'application/json'},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)
  });
  const value=await response.json().catch(()=>null);
  if(!response.ok){
    // Never leak raw SQL/schema/backend details to browser.
    const conflict=String(value?.message||'').match(/revision|changed|stale|moved|owned|eligible|restricted|deadline|roster|salary|cap|season|missing|duplicate/i);
    fail(conflict?409:422,conflict?'Trade cannot be completed against the current league. Refresh and retry.':'Server declined this trade; no assets moved.');
  }
  return value;
}
function rosterTeams(state){
  const list=Array.isArray(state?.teams)?state.teams:
    [...(state?.conferences?.East||[]),...(state?.conferences?.West||[])];
  if(!Array.isArray(list))fail(409,'Shared league rosters are not available.');
  const names=list.map(x=>x?.name);
  if(names.some(n=>typeof n!=='string')||new Set(names).size!==names.length)fail(409,'Ambiguous shared team rosters.');
  return list;
}
// Phase 2E.4-F3A: use only the locked runtime, never a browser-provided
// season, cap table, payroll year, deadline or CPU decision.
function validatedCpuSeason(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state))
    fail(409,'Online season state is unavailable.');
  const year = Number(state.seasonYear ?? state.seasonStartYear);
  if (!Number.isInteger(year) || (year !== 2026 && year !== 2027 && year !== 2028))
    fail(409,'CPU trading is not supported for this season.');
  if (year === 2026) return year; // Preserve original first-season behavior.
  const schedule = state.onlineSchedule;
  const rollover = state.onlineSeasonRollover;
  const financials = state.financials;
  const rules = financials?.baseRules;
  if (Number(state.seasonStartYear) !== year ||
      Number(schedule?.seasonYear) !== year || schedule?.phase !== 'regular-season' ||
      rollover?.status !== 'complete' || Number(rollover?.toYear) !== year ||
      Number(state.currentFinancialSeasonYear) !== year + 1 ||
      Number(financials?.currentFinancialSeasonYear) !== year + 1 ||
      Number(financials?.baseSeasonYear) < 2026 ||
      Number(financials?.baseSeasonYear) > year + 1 ||
      !Number.isInteger(Number(financials?.baseSeasonYear)) ||
      !rules || typeof rules !== 'object' || Array.isArray(rules) ||
      state.offseasonState?.active === true ||
      /(offseason|draft|retire|free.agency|playoff)/i.test(String(state.phase ?? state.seasonState?.phase ?? '')))
    fail(409,'CPU trades require a completed rollover and verified financial season.');
  // Phase 2E.4-G2A: the third season must have TWO archived championships,
  // not merely a changed seasonYear field. A duplicate archived year is invalid.
  if (year === 2028) {
    const history = state.onlineSeasonHistory;
    if (!Array.isArray(history) ||
        Number(rollover?.fromYear) !== 2027 ||
        [2026, 2027].some(y => history.filter(row =>
          row && typeof row === 'object' && !Array.isArray(row) && Number(row.seasonYear) === y
        ).length !== 1))
      fail(409,'Third-season CPU trades require both archived prior seasons.');
  }
  // F1 financial SQL uses a normalized immutable base and inflation, not the
  // potentially stale 2026 top-level salary-cap aliases.
  const rate = financials?.annualInflationRate;
  if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(String(rate ?? '')) ||
      !['salaryCap','firstApron','secondApron','hardCap'].every(k =>
        /^\d+(?:\.\d+)?$/.test(String(rules[k] ?? '')) &&
        Number.isFinite(Number(rules[k])) && Number(rules[k]) > 0) ||
      Number(rules.firstApron) <= Number(rules.salaryCap) ||
      Number(rules.secondApron) < Number(rules.firstApron) ||
      Number(rules.hardCap) < Number(rules.firstApron))
    fail(409,'CPU trades require verified multi-season cap and apron rules.');
  // The old F1 SQL trade-deadline helper can see a stale top-level 2026 date
  // after rollover. Independently enforce the ACTUAL online schedule cursor.
  const cursor = schedule.cursor;
  if (typeof cursor !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(cursor) ||
      cursor < `${year}-09-01` || cursor >= `${year+1}-02-05` ||
      Number.isNaN(Date.parse(`${cursor}T12:00:00Z`)))
    fail(409,'CPU trades are unavailable outside the verified trade window.');
  if (state.onlineCheckpoints?.trade_deadline?.status === 'closed')
    fail(409,'The Online trade deadline is closed for this season.');
  return year;
}
function cpuEvaluatorRoster(team, year) {
  if (year === 2026) return {...team, players: team.players.map(p=>({...p}))};
  return {...team,players:team.players.map(p=>{
    const salaries=p?.contract?.salaryByYear;
    const start=Number(p?.contract?.startYear);
    const offset=year-start;
    if(!Number.isInteger(start)||!Array.isArray(salaries)||offset<0||offset>=salaries.length)
      return {...p};
    const salary=Number(salaries[offset]);
    if(!Number.isFinite(salary)||salary<0||salary>100000000) return {...p};
    return {...p,salary,currentSalary:salary,yearsLeft:salaries.length-offset,contractYears:salaries.length-offset};
  })};
}

function stablePlayers(team,ids,year){
  const all=team?.players;
  if(!Array.isArray(all))fail(409,'Team roster not available.');
  const result=ids.map(id=>{
    const matches=all.filter(p=>String(p?.id??p?.playerId??'')===id);
    if(matches.length!==1)fail(409,'Selected player is no longer uniquely owned by this team.');
    const player=matches[0];
    if(player?.isTwoWay||player?.isStash||player?.retired)fail(409,'Selected player is ineligible.');
    const contract=player?.contract;
    const start=Number(contract?.startYear??year);
    const salary=contract?.salaryByYear?.[year-start];
    if(!Number.isFinite(Number(salary))||Number(salary)<1200000)fail(409,'Current player salary cannot be verified.');
    // CPU evaluator's `player_salary` prefers salary and first contract year.
    // Only adapt the ephemeral model input; NEVER alter the league snapshot.
    const current={...player,salary:Number(salary),currentSalary:Number(salary)};
    if(year>=2027) {
      const remaining=contract.salaryByYear.length-(year-start);
      current.yearsLeft=remaining; current.contractYears=remaining;
    }
    return current;
  });
  if(new Set(result.map(p=>String(p.id??p.playerId))).size!==ids.length)fail(400,'Duplicate player.');
  return result;
}
function parseBody(body){
  const {lobbyId,requestId,expectedRevision,targetTeam,sendingIds,receivingIds}=body||{};
  if(!uuid.test(String(lobbyId||''))||!uuid.test(String(requestId||'')))fail(400,'Invalid trade request identifiers.');
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)fail(400,'Invalid league revision.');
  if(typeof targetTeam!=='string'||targetTeam.length<2||targetTeam.length>90)fail(400,'Invalid CPU team.');
  for(const ids of [sendingIds,receivingIds]){
    if(!Array.isArray(ids)||ids.length<1||ids.length>4||ids.some(id=>typeof id!=='string'||!simpleId.test(id))||new Set(ids).size!==ids.length)
      fail(400,'Select 1–4 unique standard players on each side.');
  }
  if(new Set([...sendingIds,...receivingIds]).size!==sendingIds.length+receivingIds.length)fail(400,'A player cannot be on both sides.');
  return {lobbyId,requestId,expectedRevision,targetTeam,sendingIds,receivingIds};
}
function evalCpu(proposal, python=process.env.BM_PYTHON_BIN||'python3'){
  return new Promise((resolve,reject)=>{
    const child=spawn(python,['-I',pythonAdapter],{cwd:moduleDirectory,env:{PATH:process.env.PATH||'',PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'},stdio:['pipe','pipe','pipe'],windowsHide:true});
    let output='',err='';let stopped=false;
    const timer=setTimeout(()=>{stopped=true;child.kill('SIGKILL');},7500);
    child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.length>500000)child.kill('SIGKILL');});
    child.stderr.on('data',chunk=>{err+=chunk.toString();if(err.length>50000)child.kill('SIGKILL');});
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{
      clearTimeout(timer);
      if(stopped||code!==0||output.length>500000)return reject(new Error('CPU evaluator unavailable.'));
      try{const response=JSON.parse(output);if(!['accept','counter','reject'].includes(response.decision))throw Error();resolve(response);}catch{return reject(new Error('CPU evaluator returned an invalid decision.'));}
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify(proposal));
  });
}
function securityHeaders(res){res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');}

export async function cpuTradeRequest(req,res){
  securityHeaders(res);
  try{
    const config=serviceConfig();
    const token=String(req.get('authorization')||'').match(/^Bearer ([A-Za-z0-9_.-]{20,5000})$/)?.[1];
    if(!token)fail(401,'Sign in to negotiate CPU trades.');
    const userResponse=await fetch(`${config.url}/auth/v1/user`,{headers:{apikey:config.key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
    if(!userResponse.ok)fail(401,'Your sign-in has expired.');
    const user=await userResponse.json();
    if(!uuid.test(String(user?.id||'')))fail(401,'Invalid online account.');
    const input=parseBody(req.body);
    const now=Date.now();
    for(const [key,bucket] of requests){if(now-bucket.started>60000)requests.delete(key);}
    const limiter=`${user.id}:${Math.floor(now/60000)}`;
    const hits=requests.get(limiter)?.count||0;
    if(hits>=12)fail(429,'Too many negotiations. Try again shortly.');
    requests.set(limiter,{count:hits+1,started:now});
    const lobby=await supabaseGet(config,`/rest/v1/bm_online_lobbies?id=eq.${input.lobbyId}&select=status`);
    if(lobby.length!==1||lobby[0].status!=='started')fail(403,'This online league has not started.');
    const members=await supabaseGet(config,`/rest/v1/bm_online_lobby_members?lobby_id=eq.${input.lobbyId}&select=user_id,team_name`);
    const mine=members.find(m=>m.user_id===user.id);
    if(!mine?.team_name)fail(403,'You are not an assigned GM in this league.');
    if(mine.team_name===input.targetTeam||members.some(m=>m.team_name===input.targetTeam))fail(403,'That team is controlled by a human GM.');
    // Idempotent replay: never rerun the decision on a newer league revision.
    const prior=await supabaseGet(config,`/rest/v1/bm_online_franchise_events?lobby_id=eq.${input.lobbyId}&request_id=eq.${input.requestId}&select=actor_id,action_type,revision,details`);
    if(prior.length){
      const row=prior[0],d=row.details||{};
      if(row.actor_id!==user.id||row.action_type!=='cpu_trade_accepted'||d.from_team!==mine.team_name||d.to_team!==input.targetTeam||
        JSON.stringify(d.sending)!==JSON.stringify(input.sendingIds)||JSON.stringify(d.receiving)!==JSON.stringify(input.receivingIds))fail(409,'Request identifier was already used.');
      return res.json({ok:true,replayed:true,decision:'accept',revision:row.revision});
    }
    const rows=await supabaseGet(config,`/rest/v1/bm_online_franchise_runtime?lobby_id=eq.${input.lobbyId}&select=revision,state`);
    if(rows.length!==1||rows[0].revision!==input.expectedRevision)fail(409,'Shared league changed. Refresh before negotiating.');
    const state=rows[0].state;
    if(state?.onlineCheckpoints?.trade_deadline?.status==='closed')
      fail(409,'The Online trade deadline is closed for this season.');
    const all=rosterTeams(state);
    const from=all.find(t=>t.name===mine.team_name);
    const to=all.find(t=>t.name===input.targetTeam);
    if(!from||!to)fail(409,'Trade teams are no longer available.');
    const year=validatedCpuSeason(state);
    const sends=stablePlayers(from,input.sendingIds,year);
    const receives=stablePlayers(to,input.receivingIds,year);
    const evaluation=await evalCpu({userTeam:from.name,cpuTeam:to.name,cpuTeamObject:cpuEvaluatorRoster(to,year),
      teamContext:state.teamContext||{},cpuReceives:{players:sends,picks:[]},cpuSends:{players:receives,picks:[]}});
    if(evaluation.decision!=='accept'||evaluation.accepted!==true)return res.json({ok:true,committed:false,
      decision:evaluation.decision,message:evaluation.message,counterSuggestions:evaluation.counterSuggestions||[],score:evaluation.score,revision:rows[0].revision});
    const committed=await supabaseRpc(config,'bm_online_commit_cpu_player_trade',{
      p_lobby:input.lobbyId,p_actor:user.id,p_request:input.requestId,p_expected_revision:input.expectedRevision,
      p_target_team:input.targetTeam,p_sending_ids:input.sendingIds,p_receiving_ids:input.receivingIds
    });
    return res.json({ok:true,committed:true,decision:'accept',message:evaluation.message,revision:committed.revision,replayed:!!committed.replayed});
  }catch(error){
    if (process.env.BM_CPU_TEST_DEBUG === "1") console.error("CPU DEBUG",error);
    const status=Number(error.httpStatus)||503;
    return res.status(status).json({ok:false,error:status===503?'CPU trading is temporarily unavailable.':error.message});
  }
}

export const cpuTradeTestHelpers={parseBody,stablePlayers,rosterTeams,validatedCpuSeason,cpuEvaluatorRoster};


// CPU Trade Finder — read-only. The request contains IDs, never arbitrary
// player objects, team context, CPU decisions, scores or asset ownership.
// Every finder suggestion must be negotiated again by cpuTradeRequest, and only
// the separate, private Supabase RPC may commit the resulting trade.
const finderLimits = new Map();
function parseFinderBody(body){
  const {lobbyId,expectedRevision,sendingIds,targetTeam=''}=body||{};
  if(!uuid.test(String(lobbyId||''))||!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
    fail(400,'Invalid online finder request.');
  if(!Array.isArray(sendingIds)||sendingIds.length<1||sendingIds.length>4||
     sendingIds.some(x=>typeof x!=='string'||!simpleId.test(x))||new Set(sendingIds).size!==sendingIds.length)
    fail(400,'Select 1–4 unique eligible players to offer.');
  if(typeof targetTeam!=='string'||targetTeam.length>90)fail(400,'Invalid search team.');
  return {lobbyId,expectedRevision,sendingIds,targetTeam};
}
function finderRoster(team,year){
  if(!Array.isArray(team?.players))return {...team,players:[]};
  const seen=new Set();
  const players=[];
  for(const p of team.players){
    const id=String(p?.id??p?.playerId??'');
    if(!simpleId.test(id)||seen.has(id))continue;
    seen.add(id);
    try{players.push(stablePlayers(team,[id],year)[0]);}catch{/* omit ineligible or malformed */}
  }
  return {...team,players};
}
function mapFinderOffers(results,sendingIds,rosterMap,year){
  const unique=new Set();
  const offers=[];
  for(const item of results?.offers||[]){
    const name=item?.teamName;
    const team=rosterMap.get(name);
    if(!team||item?.decision!=='accept'||item?.accepted!==true||!Array.isArray(item?.offer))continue;
    const selected=item.offer;
    if(selected.length<1||selected.length>2||selected.some(x=>x?.type!=='player'))continue;
    const receivingIds=selected.map(x=>String(x.player?.id??x.player?.playerId??''));
    if(receivingIds.some(x=>!simpleId.test(x))||new Set(receivingIds).size!==receivingIds.length||
      receivingIds.some(x=>sendingIds.includes(x)))continue;
    let players;
    try{players=stablePlayers(team,receivingIds,year);}catch{continue;}
    const key=name+':'+receivingIds.join(':');if(unique.has(key))continue;
    unique.add(key);
    offers.push({teamName:name,receivingIds,receivingPlayers:players.map(p=>({
      id:String(p.id??p.playerId),name:String(p.name||p.player||'Player').slice(0,100),
      overall:Number(p.overall??p.ovr??0),salary:Number(p.salary)
    })),decision:'accept',score:Number(item.score),quality:'CPU interest',
      sendingIds:[...sendingIds]});
  }
  return offers.slice(0,12);
}
export async function cpuTradeFinderRequest(req,res){
  securityHeaders(res);
  try{
    const config=serviceConfig();
    const token=String(req.get('authorization')||'').match(/^Bearer ([A-Za-z0-9_.-]{20,5000})$/)?.[1];
    if(!token)fail(401,'Sign in to use the CPU Trade Finder.');
    const auth=await fetch(`${config.url}/auth/v1/user`,{headers:{apikey:config.key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
    if(!auth.ok)fail(401,'Your session has expired.');
    const user=await auth.json();
    if(!uuid.test(String(user?.id||'')))fail(401,'Invalid account.');
    const input=parseFinderBody(req.body);
    const now=Date.now();
    for(const [key,v] of finderLimits){if(now-v.started>60000)finderLimits.delete(key);}
    const limitKey=`${user.id}:${Math.floor(now/60000)}`;
    const count=finderLimits.get(limitKey)?.count||0;
    if(count>=12)fail(429,'Too many Trade Finder searches. Try again shortly.');
    finderLimits.set(limitKey,{started:now,count:count+1});
    const [lobby,members,rows]=await Promise.all([
      supabaseGet(config,`/rest/v1/bm_online_lobbies?id=eq.${input.lobbyId}&select=status`),
      supabaseGet(config,`/rest/v1/bm_online_lobby_members?lobby_id=eq.${input.lobbyId}&select=user_id,team_name`),
      supabaseGet(config,`/rest/v1/bm_online_franchise_runtime?lobby_id=eq.${input.lobbyId}&select=revision,state`)
    ]);
    if(lobby.length!==1||lobby[0]?.status!=='started')fail(403,'Online franchise has not started.');
    const mine=members.find(m=>m.user_id===user.id);
    if(!mine?.team_name)fail(403,'You are not a GM in this franchise.');
    if(rows.length!==1||rows[0].revision!==input.expectedRevision)
      fail(409,'League changed. Refresh before searching.');
    const state=rows[0].state;
    if(state?.onlineCheckpoints?.trade_deadline?.status==='closed')
      fail(409,'The Online trade deadline is closed for this season.');
    const year=validatedCpuSeason(state);
    const all=rosterTeams(state);
    const from=all.find(x=>x.name===mine.team_name);
    if(!from)fail(409,'Your controlled team has changed.');
    const sending=stablePlayers(from,input.sendingIds,year);
    const humanTeams=new Set(members.map(m=>m.team_name).filter(Boolean));
    const cpu=all.filter(t=>t.name!==from.name&&!humanTeams.has(t.name)&&
      (!input.targetTeam||input.targetTeam===t.name)).map(t=>finderRoster(t,year));
    if(input.targetTeam&&!cpu.length)fail(403,'Requested partner is not a CPU-controlled team.');
    const candidates=cpu.filter(t=>t.players.length>0);
    const raw=await evalCpuFinder({selectedTeamName:from.name,
      selectedItems:sending.map(player=>({type:'player',player})),
      teams:[finderRoster(from,year),...candidates],
      // Keep picks out until swaps, protected rights and Stepien equivalence are enforceable.
      draftPicks:[],teamContext:state.teamContext||{},maxOffers:12});
    if(!raw||raw.ok!==true||!Array.isArray(raw.offers))fail(503,'CPU Trade Finder could not evaluate these offers.');
    const offers=mapFinderOffers(raw,input.sendingIds,new Map(candidates.map(t=>[t.name,t])),year);
    return res.json({ok:true,revision:rows[0].revision,sendingIds:input.sendingIds,
      offers,teamsChecked:candidates.length,
      notice:'CPU interest is provisional. Salary, roster rules, deadlines and ownership are checked again before any trade commits.'});
  }catch(error){
    if(process.env.BM_CPU_TEST_DEBUG==='1')console.error('CPU FINDER DEBUG',error);
    const status=Number(error.httpStatus)||503;
    return res.status(status).json({ok:false,error:status===503?'CPU Trade Finder is temporarily unavailable.':error.message});
  }
}

function evalCpuFinder(input,python=process.env.BM_PYTHON_BIN||'python3'){
  return new Promise((resolve,reject)=>{
    const child=spawn(python,['-I',pythonAdapter],{cwd:moduleDirectory,
      env:{PATH:process.env.PATH||'',PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'},
      stdio:['pipe','pipe','pipe'],windowsHide:true});
    let output='';let failed=false,settled=false;
    const finish=(err,val)=>{if(settled)return;settled=true;clearTimeout(timer);err?reject(err):resolve(val);};
    const timer=setTimeout(()=>{failed=true;child.kill('SIGKILL');},12000);
    child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.length>350000){failed=true;child.kill('SIGKILL');}});
    child.stderr.on('data',()=>{});
    child.on('error',err=>finish(err));
    child.on('close',code=>{
      if(failed||code!==0)return finish(new Error('CPU finder timed out or failed.'));
      try{finish(null,JSON.parse(output));}catch{finish(new Error('CPU finder returned invalid data.'));}
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify({operation:'find',search:input}));
  });
}
export const cpuFinderTestHelpers={parseFinderBody,finderRoster,mapFinderOffers};
