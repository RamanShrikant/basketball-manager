import {trustedOnlineApiBase} from './onlineCalendarBootstrap.js';
// Trusted online offseason market calls only; never send a league snapshot or a team name.
import {supabase} from '../auth/supabaseClient.js';
export async function onlineOffseasonMarketAction(action,payload){
 if(!['open','offer','resolve','decision','next'].includes(action))throw Error('Unknown offseason market action');
 const {data,error}=await supabase.auth.getSession();
 if(error||!data?.session?.access_token)throw Error('Sign in to manage the online market.');
 const base=trustedOnlineApiBase();
 if(!base)throw Error('Trusted offseason backend is not configured.');
 const r=await fetch(`${base}/api/online/offseason/free-agency/${action}`,{
  method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},
  body:JSON.stringify(payload)});
 const response=await r.json().catch(()=>null);
 if(!r.ok||response?.ok!==true)throw Error(response?.error||'The league did not confirm your action. Refresh first.');
 return response;
}
