import {trustedOnlineApiBase} from './onlineCalendarBootstrap.js';
// Client only requests host action; never supplies rosters, salaries, schedule, or calendar.
import {supabase} from '../auth/supabaseClient.js';
export async function startOnlineNextSeason({lobbyId,expectedRevision,requestId}){
 const {data,error}=await supabase.auth.getSession();
 if(error||!data?.session?.access_token)throw Error('Sign in to your franchise');
 const base=trustedOnlineApiBase();
 if(!base)throw Error('Trusted online backend is not configured');
 const r=await fetch(`${base}/api/online/offseason/start-next-season`,{method:'POST',
  headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},
  body:JSON.stringify({lobbyId,expectedRevision,requestId})});
 const output=await r.json().catch(()=>null);
 if(!r.ok||output?.ok!==true)throw Error(output?.error||'Next season was not confirmed; refresh the league');
 return output;
}
