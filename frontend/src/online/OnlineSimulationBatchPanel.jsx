// Unified host-only Online simulation controls. All scores and mutations come
// from the trusted backend; checkpoints and revisions are checked every day.
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from '../auth/supabaseClient.js';
import {readOnlineRuntime} from './onlineRuntimeClient.js';
import {planOnlineSimToDate,pendingOnlineGameDays} from './onlineSimulationCheckpoints.mjs';
import {formatGameDate} from './onlineSeasonReadModel.mjs';
import {requireTrustedOnlineApiBase} from './onlineCalendarBootstrap.js';

const LIMIT=12;
const MAX_SEASON_DAYS=220;
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
  const [mode,setMode]=useState('date');
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
  const endDate=mode==='next'?nextDate:mode==='season'?lastDate:target;
  const plan=useMemo(()=>{
    try{return endDate?planOnlineSimToDate(leagueData,endDate,{maxDays:mode==='next'?1:LIMIT}):{days:[],blocked:null,more:false};}
    catch{return {days:[],blocked:null,more:false};}
  },[leagueData,endDate,mode]);
  function changeMode(value){
    if(running)return;
    setMode(value);setConfirm(false);setMessage('');setError('');
  }
  async function run(){
    if(lockRef.current||disabled||running||!confirm||!plan.days.length)return;
    lockRef.current=true;stopRef.current=false;setRunning(true);onRunningChange?.(true);
    let done=0;
    const requestedMode=mode;
    const requestedEnd=endDate;
    const dayLimit=requestedMode==='season'?MAX_SEASON_DAYS:requestedMode==='next'?1:plan.days.length;
    const totalDays=pending.filter(p=>p.date<=requestedEnd).length;
    setCompleted(0);setTotal(Math.min(dayLimit,totalDays));setCurrent('');setError('');setMessage('');setConfirm(false);
    try{
      if(!lobbyId||!Number.isSafeInteger(Number(revision)))throw Error('Shared league identity is missing.');
      const initial=await readOnlineRuntime(lobbyId);
      if(Number(initial.revision)!==Number(revision))throw Error('Another GM changed this league. Refresh before simulating.');
      let lastRevision=Number(revision);
      let live=initial;
      let stopReason='';
      for(let index=0;index<dayLimit;index++){
        if(stopRef.current||!activeRef.current)break;
        // Re-plan from the authoritative runtime after EVERY committed day.
        // This prevents a season run from ever jumping past an NBA checkpoint.
        const nextPlan=planOnlineSimToDate(live.state,requestedEnd,{maxDays:1});
        if(!nextPlan.days.length){
          if(nextPlan.blocked)stopReason=`Stopped before ${nextPlan.blocked.label.toLowerCase()} (${formatGameDate(nextPlan.blocked.date)}). Resolve the checkpoint to continue.`;
          break;
        }
        const date=nextPlan.days[0];
        if(requestedMode!=='season'&&date!==plan.days[index])throw Error('The league schedule changed. Stopped before another game day.');
        setCurrent(date);
        const {data:{session},error:authError}=await supabase.auth.getSession();
        if(authError||!session?.access_token)throw Error('Your online login expired. No additional games were requested.');
        const base=requireTrustedOnlineApiBase();
        const requestId=pendingId(lobbyId,date);
        const response=await fetch(`${base}/api/online/calendar/simulate-next-day`,{
          method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
          body:JSON.stringify({lobbyId,expectedRevision:lastRevision,requestId})
        });
        const result=await response.json().catch(()=>null);
        if(!response.ok||!result?.ok)throw Error(result?.error||'A game day was not confirmed. Refresh before retrying.');
        if(result.date!==date)throw Error('The server returned a different game date. Refresh and inspect the league.');
        if(!Number.isSafeInteger(Number(result.revision))||Number(result.revision)<lastRevision)
          throw Error('Unexpected committed league revision. Stop and inspect the franchise.');
        forgetId(lobbyId,date);
        done++;
        if(activeRef.current)setCompleted(done);
        await onAccepted?.();
        live=await readOnlineRuntime(lobbyId);
        if(Number(live.revision)!==Number(result.revision))
          throw Error('Another manager changed the league during simulation. Progress is saved; refresh to continue.');
        lastRevision=Number(live.revision);
        // The trusted endpoint permits at most 30 requests/minute. A season run
        // spaces its requests so normal quick days cannot exhaust that budget.
        if(requestedMode==='season'&&!stopRef.current)await new Promise(resolve=>setTimeout(resolve,2100));
      }
      if(activeRef.current){
        if(stopRef.current)setMessage(`${done} game day${done===1?'':'s'} saved. Stopped at your request.`);
        else if(stopReason)setMessage(`${done} game day${done===1?'':'s'} saved. ${stopReason}`);
        else if(requestedMode==='season'&&done===MAX_SEASON_DAYS)setMessage(`${done} game days committed. Safety limit reached; run again to finish.`);
        else if(requestedMode==='date'&&plan.more)setMessage(`${done} game days committed. Continue simulating to reach your chosen date.`);
        else setMessage(`${done} game day${done===1?'':'s'} committed. All managers share the results.`);
      }
    }catch(err){if(activeRef.current)setError(`${err?.message||String(err)} ${done?'Previously confirmed days remain saved.':''}`);}
    finally{
      lockRef.current=false;
      if(activeRef.current){setRunning(false);setCurrent('');onRunningChange?.(false);}
    }
  }
  return <section className="bmOnlineSeasonBatchPanel" aria-label="Host simulation controls">
    <div className="bmOnlineSeasonBatchIntro"><small>COMMISSIONER · SIMULATION</small><strong>Advance the shared season</strong>
      <p>Only the host can simulate. Game results appear automatically for every GM. Simulations pause at required league checkpoints.</p></div>
    <div className="bmOnlineSeasonBatchActions">
      <div className="bmOnlineSeasonBatchModes" role="group" aria-label="Simulation range">
        <button type="button" aria-pressed={mode==='next'} disabled={running} className={mode==='next'?'selected':''} onClick={()=>changeMode('next')}>Next day</button>
        <button type="button" aria-pressed={mode==='date'} disabled={running} className={mode==='date'?'selected':''} onClick={()=>changeMode('date')}>Sim to date</button>
        <button type="button" aria-pressed={mode==='season'} disabled={running} className={mode==='season'?'selected':''} onClick={()=>changeMode('season')}>Sim season</button>
      </div>
      {mode==='date'&&<label>THROUGH <input type="date" min={nextDate||undefined} max={lastDate||undefined} value={target} disabled={running||!nextDate} onChange={e=>{setTarget(e.target.value);setConfirm(false);setMessage('');}} /></label>}
      {running?<button type="button" onClick={()=>{stopRef.current=true;setMessage('Finishing the current game day before stopping…');}} disabled={stopRef.current}>Stop after this day</button>:
        confirm?<div className="bmOnlineSeasonBatchConfirm"><button type="button" onClick={()=>setConfirm(false)}>Cancel</button><button type="button" className="primary" disabled={disabled||!plan.days.length} onClick={run}>{mode==='season'?'Confirm season simulation':mode==='next'?'Confirm next day':`Confirm ${plan.days.length} days`}</button></div>:
        <button type="button" className="primary" disabled={disabled||!plan.days.length} onClick={()=>{setError('');setConfirm(true);}}>{mode==='season'?'Simulate season':mode==='next'?'Simulate next day':'Simulate to date'}</button>}
    </div>
    <div className="bmOnlineSeasonBatchFoot" role="status" aria-live="polite">
      {running?<><span>{completed}/{total} game days saved</span>{current&&<span>Simulating {formatGameDate(current)}</span>}<div className="bmOnlineSeasonBatchBar"><div style={{width:`${total?Math.round(completed/total*100):0}%`}}/></div></>:
        <span>{nextDate?(mode==='season'?`${pending.length} game days remaining · pauses at checkpoints`:mode==='next'?`Next game day: ${formatGameDate(nextDate)}`:`${plan.days.length} upcoming game days in this run · max ${LIMIT} per date batch`):'Regular season complete'}</span>}
      {!running&&mode==='date'&&plan.more&&<span>Continue in another batch to reach the selected date</span>}
      {!running&&plan.blocked&&<span className="warning">Stops before {plan.blocked.label} · {formatGameDate(plan.blocked.date)}</span>}
      {message&&<span>{message}</span>}
      {error&&<span className="warning" role="alert">{error} <button type="button" onClick={()=>onAccepted?.()}>Refresh</button></span>}
    </div>
  </section>;
}
