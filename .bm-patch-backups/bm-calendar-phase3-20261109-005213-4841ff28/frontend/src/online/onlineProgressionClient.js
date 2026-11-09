// Online-only: browser sends an identity/revision/idempotency token, never player ratings.
import {supabase} from '../auth/supabaseClient.js';
export async function runOnlinePlayerProgression({lobbyId,expectedRevision,requestId}){
 const {data,error}=await supabase.auth.getSession();
 if(error||!data?.session?.access_token)throw Error('Sign in to manage the online offseason.');
 const base=String(import.meta.env.VITE_BM_ONLINE_CPU_API_URL||'').replace(/\/$/,'');
 if(!base)throw Error('The trusted offseason backend is not configured.');
 const r=await fetch(`${base}/api/online/offseason/progression/run`,{
  method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},
  body:JSON.stringify({lobbyId,expectedRevision,requestId})});
 const out=await r.json().catch(()=>null);
 if(!r.ok||out?.ok!==true)throw Error(out?.error||'Progression was not confirmed. Refresh the shared league.');
 return out;
}
