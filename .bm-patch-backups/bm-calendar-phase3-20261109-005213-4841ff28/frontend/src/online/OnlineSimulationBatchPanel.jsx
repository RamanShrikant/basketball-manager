// Phase 2D.2-C: host-only sequential simulation orchestration.
// Never generates game scores in the browser; every date is a private server/RPC commit.
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from '../auth/supabaseClient.js';
import {readOnlineRuntime} from './onlineRuntimeClient.js';
import {planOnlineSimToDate,pendingOnlineGameDays} from './onlineSimulationCheckpoints.mjs';
import {formatGameDate} from './onlineSeasonReadModel.mjs';

const LIMIT=12;
const storageKey=id=>`bm-online-pending-sim-day:${id}`;
const addDays=(date,n)=>{const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
function pendingId(lobbyId,date){
  const key=storageKey(lobbyId);
  try {
    const saved=JSON.parse(sessionStorage.getItem(key)||'null');
    if(saved?.date===date&&/^[a-f0-9-]{36}$/i.test(saved.id))return saved.id;
    const id=crypto.randomUUID();sessionStorage.setItem(key,JSON.stringify({date,id}));return id;
  }catch{return crypto.randomUUID();}
}
function forgetId(lobbyId,date){
  try{const key=storageKey(lobbyId);const saved=JSON.parse(sessionStorage.getItem(key)||'null');if(saved?.date===date)sessionStorage.removeItem(key);}catch{}
}
export default function OnlineSimulationBatchPanel({leagueData,lobbyId,revision,onAccepted,disabled=false,onRunningChange}){
  const pending=useMemo(()=>pendingOnlineGameDays(leagueData),[leagueData]);
  const lastDate=pending.at(-1)?.date||'';
  const nextDate=pending[0]?.date||'';
  const [target,setTarget]=useState('');
  const [confirm,setConfirm]=useState(false);
  const [running,setRunning]=useState(false);
  const [completed,setCompleted]=useState(0);
  const [total,setTotal]=useState(0);
  const [current,setCurrent]=useState('');
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const stopRef=useRef(false);
  const activeRef=useRef(true);
  const lockRef=useRef(false);
  useEffect(()=>{activeRef.current=true;return()=>{activeRef.current=false;stopRef.current=true;onRunningChange?.(false);};},[lobbyId]);
  useEffect(()=>{setTarget(old=>old|| (nextDate?((lastDate&&addDays(nextDate,21)>lastDate)?lastDate:addDays(nextDate,21)):''));},[nextDate,lastDate]);
  const plan=useMemo(()=>{
    try{return target?planOnlineSimToDate(leagueData,target,{maxDays:LIMIT}):{days:[],blocked:null,more:false};}
    catch{return {days:[],blocked:null,more:false};}
  },[leagueData,target]);
  async function run(){
    if(lockRef.current||disabled||running||!confirm||!plan.days.length)return;
    lockRef.current=true;stopRef.current=false;setRunning(true);onRunningChange?.(true);
    setCompleted(0);setTotal(plan.days.length);setCurrent('');setError('');setMessage('');setConfirm(false);
    let done=0;
    try{
      if(!lobbyId||!Number.isSafeInteger(Number(revision)))throw Error('Shared league identity is missing.');
      const initial=await readOnlineRuntime(lobbyId);
      if(Number(initial.revision)!==Number(revision))throw Error('Another GM changed this league. Refresh before simulating.');
      let lastRevision=Number(revision);
      let live=initial;
      for(const date of plan.days){
        if(stopRef.current||!activeRef.current)break;
        const nextPlan=planOnlineSimToDate(live.state,date,{maxDays:1});
        if(nextPlan.days[0]!==date)throw Error('The league schedule or a checkpoint changed. Stopped before another game.');
        setCurrent(date);
        const {data:{session},error:authError}=await supabase.auth.getSession();
        if(authError||!session?.access_token)throw Error('Your online login expired. No additional games were requested.');
        const base=String(import.meta.env.VITE_BM_ONLINE_CPU_API_URL||'').replace(/\/$/,'');
        if(!base)throw Error('Trusted online simulation backend is not configured.');
        // Persist one ID per date until confirmed. Refresh/retry cannot duplicate a committed game day.
        const requestId=pendingId(lobbyId,date);
        const response=await fetch(`${base}/api/online/calendar/simulate-next-day`,{
          method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
          body:JSON.stringify({lobbyId,expectedRevision:lastRevision,requestId})
        });
        const result=await response.json().catch(()=>null);
        if(!response.ok||!result?.ok)throw Error(result?.error||'A game day was not confirmed. Refresh before retrying.');
        if(result.date!==date)throw Error('The server returned a different game date. Refresh and inspect the league.');
        // A replay can have the same revision, but a new commit must advance the shared version.
        if(!Number.isSafeInteger(Number(result.revision))||Number(result.revision)<lastRevision)
          throw Error('Unexpected committed league revision. Stop and inspect the franchise.');
        forgetId(lobbyId,date);
        done++;
        if(activeRef.current)setCompleted(done);
        // Reload authoritative state after every transaction, including injuries and GM actions.
        await onAccepted?.();
        live=await readOnlineRuntime(lobbyId);
        if(Number(live.revision)!==Number(result.revision))
          throw Error('Another manager changed the league during simulation. Progress is saved; refresh to continue.');
        lastRevision=Number(live.revision);
      }
      if(activeRef.current){
        if(stopRef.current)setMessage(`${done} game day${done===1?'':'s'} committed. Stopped at your request.`);
        else if(plan.more)setMessage(`${done} game days committed. Batch safety limit reached; run again to continue.`);
        else if(plan.blocked)setMessage(`${done} game days committed. Stopped before ${plan.blocked.label.toLowerCase()} (${formatGameDate(plan.blocked.date)}).`);
        else setMessage(`${done} game day${done===1?'':'s'} safely committed. League results are shared.`);
      }
    }catch(err){if(activeRef.current)setError(`${err?.message||String(err)} ${done?'Previously confirmed days remain saved.':''}`);}
    finally{
      lockRef.current=false;
      if(activeRef.current){setRunning(false);setCurrent('');onRunningChange?.(false);}
    }
  }
  return <section className="bmOnlineSeasonBatchPanel" aria-label="Host sim-to-date controls">
    <div className="bmOnlineSeasonBatchIntro"><small>HOST · SIMULATION QUEUE</small><strong>Sim to date</strong>
      <p>Uses the original Python simulator. Each NBA day commits independently; you can stop between dates without losing completed games.</p></div>
    <div className="bmOnlineSeasonBatchActions">
      <label>SIMULATE THROUGH <input type="date" min={nextDate||undefined} max={lastDate||undefined} value={target} disabled={running||!nextDate} onChange={e=>{setTarget(e.target.value);setConfirm(false);setMessage('');}} /></label>
      {running?<button type="button" onClick={()=>{stopRef.current=true;setMessage('Finishing the current date before stopping…');}} disabled={stopRef.current}>Stop after this day</button>:
        confirm?<div className="bmOnlineSeasonBatchConfirm"><button type="button" onClick={()=>setConfirm(false)}>Back</button><button type="button" className="primary" disabled={disabled||!plan.days.length} onClick={run}>Confirm {plan.days.length} days</button></div>:
        <button type="button" className="primary" disabled={disabled||!plan.days.length} onClick={()=>{setError('');setConfirm(true);}}>Prepare sim</button>}
    </div>
    <div className="bmOnlineSeasonBatchFoot" role="status" aria-live="polite">
      {running?<><span>{completed}/{total} game days saved</span>{current&&<span>Simulating {formatGameDate(current)}</span>}<div className="bmOnlineSeasonBatchBar"><div style={{width:`${total?Math.round(completed*100/total):0}%`}}/></div></>:
        <span>{nextDate?`${plan.days.length} upcoming game day${plan.days.length===1?'':'s'} in this batch · max ${LIMIT} per run`:'No remaining regular-season dates'}</span>}
      {!running&&plan.more&&<span>Batch limit: continue with another run</span>}
      {!running&&plan.blocked&&<span className="warning">Stops before {plan.blocked.label} · {formatGameDate(plan.blocked.date)} (online checkpoint pending)</span>}
      {message&&<span>{message}</span>}
      {error&&<span className="warning" role="alert">{error} <button type="button" onClick={()=>onAccepted?.()}>Refresh</button></span>}
    </div>
  </section>;
}
