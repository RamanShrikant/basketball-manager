// Online-only trusted calendar bootstrap. No schedule generation or result mutation in the browser.
import {supabase} from '../auth/supabaseClient.js';

export function trustedOnlineApiBase(){
  const configured=String(import.meta.env.VITE_BM_ONLINE_CPU_API_URL||'').trim().replace(/\/+$/,'');
  if(configured)return configured;
  // In local Vite development the /api/online proxy forwards to the trusted server.
  if(import.meta.env.DEV && typeof window!=='undefined')return window.location.origin;
  return '';
}

export function requireTrustedOnlineApiBase(){
  const base=trustedOnlineApiBase();
  if(!base)throw new Error('The trusted multiplayer simulation server is not configured for this deployment.');
  return base;
}

export async function initializeOnlineCalendar({lobbyId,expectedRevision,requestId}){
  const {data:{session},error:authError}=await supabase.auth.getSession();
  if(authError||!session?.access_token)throw new Error('Please sign in again to prepare your shared season.');
  let response;
  try {
    response=await fetch(`${requireTrustedOnlineApiBase()}/api/online/calendar/initialize`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
      body:JSON.stringify({lobbyId,expectedRevision:Number(expectedRevision),requestId})
    });
  } catch(error){
    throw new Error('Cannot reach the trusted multiplayer server. The shared schedule is unchanged.');
  }
  const result=await response.json().catch(()=>null);
  if(!response.ok||!result?.ok){
    const error=new Error(result?.error||`Calendar initialization failed (HTTP ${response.status}).`);
    error.status=response.status;
    throw error;
  }
  return result;
}
