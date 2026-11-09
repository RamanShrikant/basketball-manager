// Online-only deadline confirmation. The original Python engine processes CPU
// teams only; SQL locks the shared league and protects all human GM rosters.
import React,{useRef,useState} from 'react';
import {supabase} from '../auth/supabaseClient.js';
import {formatGameDate} from './onlineSeasonReadModel.mjs';
import {useOnlineRouteNav} from './onlineReadOnlyContext.jsx';

const storageKey=(lobby,date)=>`bm-online-veteran-extensions:${lobby}:${date}`;
function requestId(lobby,date){
  try{
    const existing=sessionStorage.getItem(storageKey(lobby,date));
    if(existing&&/^[a-f\d-]{36}$/i.test(existing))return existing;
    const id=crypto.randomUUID();sessionStorage.setItem(storageKey(lobby,date),id);return id;
  }catch{return crypto.randomUUID();}
}
function clearId(lobby,date){try{sessionStorage.removeItem(storageKey(lobby,date));}catch{}}
export default function OnlineVeteranExtensionCheckpoint({checkpoint,lobbyId,revision,isHost,onAccepted,disabled=false}){
  const go=useOnlineRouteNav();
  const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const lock=useRef(false);
  if(checkpoint?.kind!=='extension_deadline')return null;
  async function closeWindow(){
    if(!isHost||busy||lock.current||!confirm||disabled)return;
    lock.current=true;setBusy(true);setError('');
    try{
      const {data:{session},error:authError}=await supabase.auth.getSession();
      if(authError||!session?.access_token)throw Error('Sign in again to manage the online league.');
      const api=String(import.meta.env.VITE_BM_ONLINE_CPU_API_URL||'').replace(/\/$/,'');
      if(!api)throw Error('Trusted online contract backend is not configured.');
      const r=await fetch(`${api}/api/online/extensions/close-veteran`,{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
        body:JSON.stringify({lobbyId,requestId:requestId(lobbyId,checkpoint.date),expectedRevision:Number(revision)})
      });
      const data=await r.json().catch(()=>null);
      if(!r.ok||!data?.ok)throw Error(data?.error||'Extension window was not finalized. Refresh the online league before retrying.');
      clearId(lobbyId,checkpoint.date);setConfirm(false);
      await onAccepted?.();
    }catch(e){setError(e?.message||String(e));}
    finally{lock.current=false;setBusy(false);}
  }
  return <section className="bmOnlineTradeCheckpoint" aria-label="Veteran contract extension checkpoint">
    <div className="bmOnlineTradeCheckpointInfo"><small>LEAGUE CHECKPOINT · {formatGameDate(checkpoint.date)}</small>
      <strong>Veteran extension deadline</strong>
      <p>{isHost?'Every GM should finish their own player negotiations first. Finalizing processes the original CPU-team extension decisions, permanently closes the window and unlocks the next game day.':'The host must close the extension window. You can review your team’s negotiations before the deadline is finalized.'}</p>
      {error&&<span className="bmOnlineTradeCheckpointError" role="alert">{error} <button type="button" onClick={()=>onAccepted?.()}>Refresh league</button></span>}
    </div>
    <div className="bmOnlineTradeCheckpointActions"><button type="button" onClick={()=>go('/contract-extensions')}>My Extensions</button>
      {isHost&&(confirm?<><span>Close veteran extensions for all GMs and process CPU teams?</span>
        <button type="button" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button>
        <button type="button" className="primary" disabled={busy||disabled} onClick={closeWindow}>{busy?'Processing CPU teams…':'Finalize deadline'}</button></>
      :<button type="button" disabled={busy||disabled} onClick={()=>{setError('');setConfirm(true);}}>Close extension window</button>)}
    </div>
  </section>;
}
