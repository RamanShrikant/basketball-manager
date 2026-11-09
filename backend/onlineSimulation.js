// Phase 2D.2-A — trusted, host-only Online game-day simulation.
// The browser only sends {lobbyId, expectedRevision, requestId}.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {buildOnlineGameBatch,integrateOnlineSimulation,SimulationConflict} from './onlineSimulationCore.js';
import {firstBlockedOnlineCheckpoint} from '../frontend/src/online/onlineSimulationCheckpoints.mjs';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const script=fileURLToPath(new URL('./online_sim_python/online_game_batch.py',import.meta.url));
const PYTHON=()=>process.env.BM_PYTHON_BIN||(process.platform==='win32'?'python':'python3');
const throwHttp=(status,message)=>{throw new SimulationConflict(message,status);};
const budget=new Map();
const configuration=()=>{
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key||!/^https:\/\/[a-z0-9.-]+$/i.test(url))throwHttp(503,'Online simulation backend is not configured.');
  return {url:url.replace(/\/$/,''),key};
};
async function get(c,path,token=c.key){
  const response=await fetch(`${c.url}${path}`,{headers:{apikey:c.key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throwHttp(503,'Could not verify the shared online franchise.');
  return response.json();
}
async function commit(c,payload){
  const response=await fetch(`${c.url}/rest/v1/rpc/bm_online_simulate_day_phase2d2`,{
    method:'POST',headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,'Content-Type':'application/json'},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)
  });
  const result=await response.json().catch(()=>null);
  if(!response.ok)throwHttp(409,'Simulation was not committed. Refresh the shared league before retrying.');
  if(!result?.ok)throwHttp(409,'Online simulation was not confirmed by the database.');
  return result;
}

// Python original game_sim.py, once per game, sequentially in a restricted worker.
// A failed worker never writes ANY league result. Only the private SQL RPC commits.
export function simulatePythonBatch(inputs,{seed=randomBytes(4).readUInt32BE(0),python=PYTHON(),timeoutMs=60000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(python,['-I',script],{
      cwd:fileURLToPath(new URL('./online_sim_python/',import.meta.url)),
      env:{PATH:process.env.PATH||'',PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'},
      stdio:['pipe','pipe','pipe'],windowsHide:true
    });
    let stdout='',stderr='',finished=false;
    const abort=message=>{if(!finished){finished=true;child.kill('SIGKILL');reject(new Error(message));}};
    const timer=setTimeout(()=>abort('Python game simulation exceeded its time limit.'),timeoutMs);
    child.stdout.on('data',chunk=>{stdout+=chunk.toString();if(stdout.length>3500000)abort('Simulator returned an oversized result.');});
    child.stderr.on('data',chunk=>{stderr+=chunk.toString();if(stderr.length>25000)abort('Simulator emitted excessive diagnostic output.');});
    child.on('error',()=>{clearTimeout(timer);if(!finished){finished=true;reject(new Error('Python game simulator could not start.'));}});
    child.on('close',code=>{
      clearTimeout(timer);if(finished)return;finished=true;
      if(code!==0)return reject(new Error('Original Python game simulator failed without changing league results.'));
      try{
        const obj=JSON.parse(stdout);
        if(!Array.isArray(obj?.games))throw Error();
        resolve(obj);
      }catch{return reject(new Error('Python simulator returned malformed results.'));}
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify({seed,games:inputs}));
  });
}
export async function simulateOnlineDayRequest(req,res){
  res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
  try{
    const body=req.body||{};
    if(Object.keys(body).some(k=>!['lobbyId','requestId','expectedRevision'].includes(k))||
      !uuid.test(String(body.lobbyId||''))||!uuid.test(String(body.requestId||''))||
      !Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<1)
      throwHttp(400,'Invalid host simulation request.');
    const token=String(req.get('authorization')||'').match(/^Bearer ([a-zA-Z0-9_.-]{20,5000})$/)?.[1];
    if(!token)throwHttp(401,'Sign in to simulate the shared league.');
    const config=configuration();
    const response=await fetch(`${config.url}/auth/v1/user`,{headers:{apikey:config.key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)});
    if(!response.ok)throwHttp(401,'Your Online session expired.');
    const user=await response.json();
    if(!uuid.test(String(user?.id||'')))throwHttp(401,'Invalid online account.');
    const now=Date.now();for(const [key,b] of budget)if(now-b.time>60000)budget.delete(key);
    const old=budget.get(user.id);
    if(old&&old.count>=30)throwHttp(429,'Too many simulation requests. Try again shortly.');
    budget.set(user.id,{time:old?.time||now,count:(old?.count||0)+1});
    const lobbies=await get(config,`/rest/v1/bm_online_lobbies?id=eq.${body.lobbyId}&select=host_id,status`);
    if(lobbies.length!==1||lobbies[0].status!=='started'||lobbies[0].host_id!==user.id)
      throwHttp(403,'Only the active franchise host may advance games.');
    const members=await get(config,`/rest/v1/bm_online_lobby_members?lobby_id=eq.${body.lobbyId}&user_id=eq.${user.id}&select=user_id`);
    if(members.length!==1)throwHttp(403,'Host must be a member of the league.');
    // Replay before revision check: lost HTTP responses do not resimulate a completed date.
    const previous=await get(config,`/rest/v1/bm_online_franchise_events?lobby_id=eq.${body.lobbyId}&request_id=eq.${body.requestId}&select=actor_id,action_type,revision,details`);
    if(previous.length){
      const row=previous[0];
      if(row.actor_id!==user.id||row.action_type!=='regular_season_day_simulated')throwHttp(409,'This request identifier belongs to another league operation.');
      return res.json({ok:true,replayed:true,revision:row.revision,date:row.details?.date,games:row.details?.games});
    }
    const runtime=await get(config,`/rest/v1/bm_online_franchise_runtime?lobby_id=eq.${body.lobbyId}&select=state,revision`);
    if(runtime.length!==1||Number(runtime[0].revision)!==body.expectedRevision)
      throwHttp(409,'Shared league changed; refresh before simulating.');
    const batch=buildOnlineGameBatch(runtime[0].state);
    const checkpoint=firstBlockedOnlineCheckpoint(runtime[0].state,batch.date);
    if(checkpoint)throwHttp(409,`${checkpoint.label} (${checkpoint.date}) requires its online management window before simulating further.`);
    const seed=randomBytes(4).readUInt32BE(0);
    const raw=await simulatePythonBatch(batch.inputs,{seed});
    const delta=integrateOnlineSimulation(batch,raw,seed^0xA3B19E52);
    const committed=await commit(config,{
      p_lobby:body.lobbyId,p_actor:user.id,p_request:body.requestId,
      p_expected_revision:body.expectedRevision,p_date:delta.date,p_results:delta.results,
      p_stats:delta.stats,p_rosters:delta.rosters,p_injury_events:delta.injuryEvents
    });
    return res.json({ok:true,revision:committed.revision,date:delta.date,games:delta.gameCount,
      injuries:delta.injuryEvents.length});
  }catch(error){
    const status=error.status||503;
    return res.status(status).json({ok:false,error:status===503?'Online simulation is unavailable. No games were committed.':error.message});
  }
}
