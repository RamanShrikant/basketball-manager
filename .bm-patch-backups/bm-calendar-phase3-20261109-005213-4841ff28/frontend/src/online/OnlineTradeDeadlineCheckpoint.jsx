// Phase 2D.2-D: online-only host confirmation. The database is authoritative.
import React,{useRef,useState} from 'react';
import {supabase} from '../auth/supabaseClient.js';
import {formatGameDate} from './onlineSeasonReadModel.mjs';

const key=(lobby,date)=>`bm-online-close-trade-deadline:${lobby}:${date}`;
function pendingId(lobby,date){
  try{
    const stored=sessionStorage.getItem(key(lobby,date));
    if(stored&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(stored))return stored;
    const id=crypto.randomUUID();sessionStorage.setItem(key(lobby,date),id);return id;
  }catch{return crypto.randomUUID();}
}
function clearPendingId(lobby,date){try{sessionStorage.removeItem(key(lobby,date));}catch{}}

export default function OnlineTradeDeadlineCheckpoint({checkpoint,lobbyId,revision,isHost,onAccepted,disabled=false}){
  const [confirm,setConfirm]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const locked=useRef(false);
  if(checkpoint?.kind!=='trade_deadline')return null;
  async function finish(){
    if(!isHost||disabled||locked.current||!confirm)return;
    locked.current=true;setBusy(true);setError('');setMessage('');
    try{
      const {data:{session},error:authError}=await supabase.auth.getSession();
      if(authError||!session?.access_token)throw Error('Online session expired. Sign in again.');
      const base=String(import.meta.env.VITE_BM_ONLINE_CPU_API_URL||'').replace(/\/$/,'');
      if(!base)throw Error('Trusted online league-management backend is not configured.');
      const requestId=pendingId(lobbyId,checkpoint.date);
      const response=await fetch(`${base}/api/online/calendar/close-trade-deadline`,{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
        body:JSON.stringify({lobbyId,requestId,expectedRevision:Number(revision)})
      });
      const result=await response.json().catch(()=>null);
      if(!response.ok||!result?.ok)throw Error(result?.error||'Deadline closure was not confirmed. Refresh before retrying.');
      if(result.date!==checkpoint.date)throw Error('The server returned a different checkpoint. Refresh this league.');
      setMessage(`Trade window closed. ${result.offersClosed||0} pending offer(s) cancelled.`);
      await onAccepted?.();
      clearPendingId(lobbyId,checkpoint.date);
      setConfirm(false);
    }catch(e){setError(e?.message||String(e));}
    finally{locked.current=false;setBusy(false);}
  }
  return <section className="bmOnlineTradeCheckpoint" aria-label="Online trade deadline checkpoint">
    <div className="bmOnlineTradeCheckpointInfo"><small>LEAGUE CHECKPOINT · {formatGameDate(checkpoint.date)}</small>
      <strong>Trade deadline</strong>
      <p>{isHost?'The league has reached its trade-deadline window. Finalizing permanently closes new trades for this season and cancels pending GM offers.':'The host must finalize the shared trade deadline before the calendar can advance.'}</p>
      {message&&<span role="status">{message}</span>}
      {error&&<span role="alert" className="bmOnlineTradeCheckpointError">{error} <button type="button" onClick={()=>onAccepted?.()}>Refresh</button></span>}
    </div>
    {isHost&&<div className="bmOnlineTradeCheckpointActions">
      {confirm?<><span>Close this season's trade window for every GM?</span>
        <button type="button" disabled={busy} onClick={()=>setConfirm(false)}>Keep trading</button>
        <button type="button" className="primary" disabled={busy||disabled} onClick={finish}>{busy?'Finalizing…':'Confirm closure'}</button></>
      :<button type="button" disabled={busy||disabled} onClick={()=>{setError('');setConfirm(true);}}>Finalize trade deadline</button>}
    </div>}
  </section>;
}
