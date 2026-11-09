// Phase 2D.2-E: existing single-player All-Star presentation, online-owned event.
import React,{useEffect,useRef,useState} from 'react';
import {supabase} from '../auth/supabaseClient.js';
import {AllStarsContent} from '../pages/AllStars.jsx';
import {formatGameDate} from './onlineSeasonReadModel.mjs';
import {isOnlineAllStarSelected} from './onlineSimulationCheckpoints.mjs';
import './online-season.css';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const storageKey=(lobby,date)=>`bm-online-allstar-select:${lobby}:${date}`;
function requestId(lobby,date){
  try{
    const key=storageKey(lobby,date),old=sessionStorage.getItem(key);
    if(uuid.test(old||''))return old;
    const id=crypto.randomUUID();sessionStorage.setItem(key,id);return id;
  }catch{return crypto.randomUUID();}
}
function forgetId(lobby,date){try{sessionStorage.removeItem(storageKey(lobby,date));}catch{}}

export default function OnlineAllStarCheckpoint({checkpoint,leagueData,lobbyId,revision,isHost,onAccepted,disabled=false}){
  const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[show,setShow]=useState(false);
  const lock=useRef(false);
  const data=leagueData?.onlineAllStars;
  const ready=Boolean(data&&isOnlineAllStarSelected(leagueData,data.cutoff_date));
  useEffect(()=>{if(!show)return;const onKey=e=>{if(e.key==='Escape')setShow(false);};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[show]);
  async function select(){
    if(!isHost||disabled||busy||lock.current||!confirm||!checkpoint||ready)return;
    lock.current=true;setBusy(true);setError('');
    try{
      const {data:{session},error:authError}=await supabase.auth.getSession();
      if(authError||!session?.access_token)throw Error('Sign in again to manage this league.');
      const api=String(import.meta.env.VITE_BM_ONLINE_CPU_API_URL||'').replace(/\/$/,'');
      if(!api)throw Error('Trusted online season backend is not configured.');
      const key=requestId(lobbyId,checkpoint.date);
      const r=await fetch(`${api}/api/online/calendar/select-all-stars`,{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
        body:JSON.stringify({lobbyId,requestId:key,expectedRevision:Number(revision)})
      });
      const result=await r.json().catch(()=>null);
      if(!r.ok||!result?.ok)throw Error(result?.error||'All-Star selection was not confirmed. Refresh before retrying.');
      if(result.date!==checkpoint.date)throw Error('The shared checkpoint date changed. Refresh this league.');
      await onAccepted?.();forgetId(lobbyId,checkpoint.date);setConfirm(false);setShow(true);
    }catch(e){setError(e?.message||String(e));}
    finally{lock.current=false;setBusy(false);}
  }
  if(!checkpoint&&!ready)return null;
  return <>
    <section className="bmOnlineTradeCheckpoint" aria-label="Online All-Star selection checkpoint">
      <div className="bmOnlineTradeCheckpointInfo">
        <small>LEAGUE CHECKPOINT · {formatGameDate(checkpoint?.date||data?.cutoff_date)}</small>
        <strong>All-Star Weekend</strong>
        <p>{ready?'The shared Eastern and Western Conference All-Star teams are official. Every GM sees the same selections.':isHost?'Select both conferences using the original single-player Python All-Star algorithm and the shared season statistics.':'All-Star selection is awaiting the league host. Simulation pauses until the teams are official.'}</p>
        {error&&<span className="bmOnlineTradeCheckpointError" role="alert">{error} <button type="button" onClick={()=>onAccepted?.()}>Refresh league</button></span>}
      </div>
      <div className="bmOnlineTradeCheckpointActions">
        {ready&&<button type="button" onClick={()=>setShow(true)}>View All-Stars</button>}
        {!ready&&isHost&&checkpoint&&(confirm?<>
          <span>Make these selections official for the entire online league?</span>
          <button type="button" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button>
          <button type="button" className="primary" disabled={busy||disabled} onClick={select}>{busy?'Selecting teams…':'Confirm selection'}</button>
        </>:<button type="button" disabled={busy||disabled} onClick={()=>{setError('');setConfirm(true);}}>Select All-Stars</button>)}
      </div>
    </section>
    {show&&ready&&<div className="bmOnlineSeasonModalScrim" role="presentation" onClick={()=>setShow(false)}>
      <section className="bmOnlineSeasonAllStarModal" role="dialog" aria-modal="true" aria-label="Online All-Star Teams" onClick={e=>e.stopPropagation()}>
        <div className="bmOnlineSeasonBoxHeader"><div><small>OFFICIAL SHARED LEAGUE SELECTION</small><h2>All-Star Weekend</h2></div><button type="button" aria-label="Close All-Stars" onClick={()=>setShow(false)}>Close</button></div>
        <AllStarsContent data={data} leagueData={leagueData}/>
      </section>
    </div>}
  </>;
}
