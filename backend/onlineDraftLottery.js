// Trusted NBA Draft Lottery: authenticated host + frozen standings + unchanged
// single-player Python lottery + locked Supabase transaction.
import {spawnSync} from 'node:child_process';
import {runOriginalInWorker} from './onlineOriginalWorkerPool.mjs';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildAuthoritativeLotteryRecords,validateOriginalLotteryResult} from './onlineDraftLotteryCore.mjs';
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const worker=fileURLToPath(new URL('./online_draft_python/online_lottery_worker.py',import.meta.url));
const attempts=new Map();
const error=(status,message)=>{const e=new Error(message);e.status=status;throw e;};
const config=()=>{
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key||!/^https:\/\/[\w.-]+$/i.test(url))error(503,'Online draft backend is not configured.');
  return {url:url.replace(/\/$/,''),key};
};
async function query(c,path){
  const response=await fetch(`${c.url}${path}`,{
    headers:{apikey:c.key,Authorization:`Bearer ${c.key}`},signal:AbortSignal.timeout(15000)});
  if(!response.ok)error(503,'The shared online draft state could not be read.');
  return response.json();
}
export function runOriginalDraftLottery(state,seed){
  const {draftYear,records}=buildAuthoritativeLotteryRecords(state);
  const runner=process.env.BM_PYTHON_BIN||(process.platform==='win32'?'python':'python3');
  const payload={league:{teams:[]},payload:{seasonYear:draftYear,teamRecords:records,
    forceLotterySystem:'auto',seed}};
  const result=spawnSync(runner,['-I',worker],{
    input:JSON.stringify(payload),encoding:'utf8',timeout:60000,maxBuffer:12*1024*1024,
    windowsHide:true
  });
  if(result.error||result.status!==0||!result.stdout)
    error(503,'The original NBA lottery engine is unavailable; no draft was committed.');
  let lottery;
  try{lottery=JSON.parse(result.stdout);}catch{error(503,'The original NBA lottery output was malformed.');}
  validateOriginalLotteryResult(lottery,records,draftYear);
  return {seasonYear:state.onlinePostseason.seasonYear,draftYear,
    system:lottery.meta.system,result:lottery,stage:'orderDrawn',
    // Actual pick owners are NOT resolved until the protected-rights ledger is settled.
    rightsSettlement:'pending'};
}
export async function drawOnlineDraftLotteryRequest(req,res){
  res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
  try{
    const b=req.body||{};
    if(Object.keys(b).some(key=>!['lobbyId','requestId','expectedRevision'].includes(key))||
       !UUID.test(String(b.lobbyId||''))||!UUID.test(String(b.requestId||''))||
       !Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<1)
      error(400,'Invalid Online Draft Lottery request.');
    const token=String(req.get('authorization')||'').match(/^Bearer ([a-zA-Z\d_.-]{20,5000})$/)?.[1];
    if(!token)error(401,'Sign in to your online franchise.');
    const c=config();
    const auth=await fetch(`${c.url}/auth/v1/user`,{
      headers:{apikey:c.key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)});
    if(!auth.ok)error(401,'Online session expired.');
    const user=await auth.json();
    if(!UUID.test(String(user?.id||'')))error(401,'Invalid account.');
    const now=Date.now();
    for(const [id,value] of attempts)if(now-value.started>60000)attempts.delete(id);
    const prior=attempts.get(user.id);
    if(prior?.count>=8)error(429,'Too many lottery requests.');
    attempts.set(user.id,{started:prior?.started??now,count:(prior?.count??0)+1});
    const lobbies=await query(c,`/rest/v1/bm_online_lobbies?id=eq.${b.lobbyId}&select=host_id,status`);
    const member=await query(c,`/rest/v1/bm_online_lobby_members?lobby_id=eq.${b.lobbyId}&user_id=eq.${user.id}&select=user_id`);
    if(lobbies.length!==1||lobbies[0].host_id!==user.id||lobbies[0].status!=='started'||member.length!==1)
      error(403,'Only the current online host can draw the lottery.');
    const events=await query(c,`/rest/v1/bm_online_franchise_events?lobby_id=eq.${b.lobbyId}&request_id=eq.${b.requestId}&select=actor_id,action_type,revision,details`);
    if(events.length){
      if(events[0].actor_id!==user.id||events[0].action_type!=='draft_lottery_drawn')
        error(409,'Request ID belongs to another operation.');
      return res.json({ok:true,replayed:true,revision:events[0].revision,
        draftYear:events[0].details?.draftYear});
    }
    const rows=await query(c,`/rest/v1/bm_online_franchise_runtime?lobby_id=eq.${b.lobbyId}&select=state,revision`);
    if(rows.length!==1||Number(rows[0].revision)!==b.expectedRevision)
      error(409,'The shared league changed. Refresh before drawing.');
    const {state}=rows[0];
    // Secure random seed generated on the server; browser cannot choose outcomes.
    const draw=await runOriginalDraftLotteryAsync(state,randomBytes(16).toString('hex'));
    const response=await fetch(`${c.url}/rest/v1/rpc/bm_online_draw_draft_lottery_phase2e1`,{
      method:'POST',headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,'Content-Type':'application/json'},
      body:JSON.stringify({p_lobby:b.lobbyId,p_actor:user.id,p_request:b.requestId,
        p_expected_revision:b.expectedRevision,p_lottery:draw}),signal:AbortSignal.timeout(45000)});
    const data=await response.json().catch(()=>null);
    if(!response.ok||!data?.ok)error(409,'Draft draw was not committed. Refresh the shared league before retrying.');
    return res.json({ok:true,revision:data.revision,replayed:!!data.replayed,draftYear:draw.draftYear});
  }catch(e){return res.status(e.status||503).json({ok:false,error:e.message||'Trusted draft service unavailable.'});}
}

const runOriginalDraftLotteryAsync=(...args)=>runOriginalInWorker('lottery',args);
