import {trustedOnlineApiBase} from './onlineCalendarBootstrap.js';
// Online Rookie Signings: same single-player contract options, server authority.
// Never mounts GameContext, local autosave, or a client-side contract engine.
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {supabase} from '../auth/supabaseClient.js';
import {useGame} from './onlineReadOnlyContext.jsx';
import './online-season.css';

const options=[['standard','Standard contract'],['two_way','Two-way contract'],['stash','One-year stash'],['release','Release rights']];
const keyFor=(lobby,action)=>`bm-online-rookies:${lobby}:${action}`;
function nextId(lobby,action,signature){
 try{const key=keyFor(lobby,action),old=JSON.parse(sessionStorage.getItem(key)||'null');
   if(old?.signature===signature&&/^[0-9a-f-]{36}$/i.test(old.id))return old.id;
   const id=crypto.randomUUID();sessionStorage.setItem(key,JSON.stringify({id,signature}));return id;
 }catch{return crypto.randomUUID();}
}
function clearId(lobby,action){try{sessionStorage.removeItem(keyFor(lobby,action));}catch{}}
async function api(action,data){
 const {data:{session},error}=await supabase.auth.getSession();
 if(error||!session?.access_token)throw Error('Please sign in again to manage rookie signings.');
 const base=trustedOnlineApiBase();
 if(!base)throw Error('The trusted Online NBA Rookie backend is not configured.');
 const response=await fetch(`${base}/api/online/rookies/${action}`,{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
   body:JSON.stringify(data)
 });
 const json=await response.json().catch(()=>null);
 if(!response.ok||!json?.ok)throw Error(json?.error||'Rookie signing was not confirmed. Refresh the league to verify its status.');
 return json;
}
const allTeams=s=>Array.isArray(s?.teams)?s.teams:Object.values(s?.conferences||{}).flat();
export default function OnlineRookieSignings(){
 const {leagueData,selectedTeam,lobbyId,revision,isHost,onAccepted,humanTeamNames=[]}=useGame();
 const year=Number(leagueData?.onlineDraft?.draftYear||0);
 const complete=leagueData?.onlineDraft?.status==='complete';
 const signed=leagueData?.onlineRookieSignings?.status==='complete';
 const [preview,setPreview]=useState(null),[decisions,setDecisions]=useState({});
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState('');
 const lock=useRef(false);
 const myPending=useMemo(()=>selectedTeam?.pendingRookieSignings||[],[selectedTeam]);
 const cpuTeams=useMemo(()=>allTeams(leagueData).filter(t=>!humanTeamNames.includes(t.name)&&
   (t.pendingRookieSignings||[]).length>0),[leagueData,humanTeamNames]);
 const humanPending=useMemo(()=>allTeams(leagueData).filter(t=>humanTeamNames.includes(t.name))
   .reduce((sum,t)=>sum+(t.pendingRookieSignings||[]).length,0),[leagueData,humanTeamNames]);
 useEffect(()=>{
   let active=true;setError('');setNotice('');setConfirm('');setPreview(null);
   if(!complete||signed||!lobbyId||!selectedTeam?.name)return;
   setLoading(true);
   api('preview',{lobbyId,expectedRevision:Number(revision)})
     .then(data=>{if(!active)return;setPreview(data);
       setDecisions(Object.fromEntries((data.rows||[]).map(r=>[String(r.playerId),r.recommendedDecision||'standard'])));})
     .catch(e=>{if(active)setError(e.message||String(e));})
     .finally(()=>{if(active)setLoading(false);});
   return()=>{active=false;};
 },[lobbyId,revision,selectedTeam?.name,complete,signed]);
 const rows=preview?.rows||[];
 const ready=rows.length===myPending.length&&rows.length>0&&rows.every(r=>options.some(([v])=>v===decisions[String(r.playerId)]));
 async function submit(mode){
   if(lock.current||busy||!complete||signed||!lobbyId||
      (mode==='sign'&&!ready)||(mode==='resolve-cpu'&&(!isHost||cpuTeams.length===0)))return;
   if(confirm!==mode){setConfirm(mode);return;}
   lock.current=true;setBusy(true);setError('');setNotice('');
   const chosen=mode==='sign'?Object.fromEntries(rows.map(r=>[String(r.playerId),decisions[String(r.playerId)]])):null;
   const signature=JSON.stringify({year,revision,mode,team:selectedTeam?.name,decisions:chosen});
   const requestId=nextId(lobbyId,mode,signature);
   try{
     const result=await api(mode,{lobbyId,expectedRevision:Number(revision),requestId,...(chosen?{decisions:chosen}:{})});
     clearId(lobbyId,mode);setConfirm('');
     setNotice(`${result.count||0} rookie rights resolved${result.complete?' · Stage complete':''}.`);
     await onAccepted?.();
   }catch(e){setError(e.message||String(e));setConfirm('');}
   finally{lock.current=false;setBusy(false);}
 }
 return <main className="bmOnlineSeasonPage bmOnlineRookiePage" data-online-season-view="rookie-signings">
   <header className="bmOnlineSeasonHeading"><div><div className="bmOnlineSeasonEyebrow">BASKETBALL MANAGER · ONLINE OFFSEASON</div>
     <h1>Rookie Signings</h1><p>Use the original single-player contract engine to decide where each drafted rookie begins their NBA career.</p></div>
     <div className="bmOnlineSeasonSummary"><small>ROOKIE RIGHTS</small><strong>{signed?'COMPLETE':complete?`${myPending.length} YOURS`:'LOCKED'}</strong>
       <span>{year||'—'} Draft · {cpuTeams.reduce((n,t)=>n+t.pendingRookieSignings.length,0)} CPU pending</span></div>
   </header>
   {!complete?<section className="bmOnlineSeasonEmpty"><h2>Finish the NBA Draft first</h2>
     <p>The official board must be complete before any rookie contract decisions can be made.</p>
     <Link className="bmOnlineDraftContinue" to={`/online/franchise/${lobbyId}?view=${encodeURIComponent('/nba-draft')}`}>Open NBA Draft</Link>
   </section>:<>
     <section className="bmOnlineDraftSummary" aria-label="Rookie contract status">
       <div><small>YOUR PENDING ROOKIES</small><strong>{myPending.length}</strong><span>{selectedTeam?.name}</span></div>
       <div><small>CPU TEAMS PENDING</small><strong>{cpuTeams.length}</strong><span>Host-managed, original CPU decisions</span></div>
       <div><small>OTHER HUMAN RIGHTS</small><strong>{Math.max(0,humanPending-myPending.length)}</strong><span>Each GM signs their own players</span></div>
     </section>
     {signed?<section className="bmOnlineSeasonEmpty"><h2>All rookie rights resolved</h2>
       <p>Contract, stash and free-agent destinations are committed to the shared league. Veteran options and the remaining offseason stages follow separately.</p>
     </section>:<>
       <section className="bmOnlineSeasonHostControls"><div><small>YOUR TEAM</small><strong>Make your rookie decisions</strong>
         <p>First-round scale, second-round contracts, two-way paths, stashes and releases use the original Python rules. Overfilled offseason rosters must be trimmed before games.</p></div>
         <div className="bmOnlineSeasonHostActions">
           {confirm==='sign'?<><button disabled={busy} onClick={()=>setConfirm('')}>Cancel</button>
             <button className="primary" disabled={busy||!ready} onClick={()=>submit('sign')}>{busy?'Processing…':'Confirm signings'}</button></>:
             <button className="primary" disabled={busy||!ready||loading} onClick={()=>submit('sign')}>{loading?'Loading…':myPending.length?'Review & commit':'No pending rookies'}</button>}
         </div>
       </section>
       <section className="bmOnlineRookieGrid" aria-label="Unsigned rookie contracts">
         {rows.map(row=><article className="bmOnlineRookieCard" key={row.playerId}>
           <div className="bmOnlineRookieTop"><span className="bmOnlineRookiePick">#{row.draftPick||'—'} PICK</span>
             <span className="bmOnlineRookieOvr">{row.overall} OVR · {row.potential} POT</span></div>
           <h3>{row.playerName}</h3><p>{row.pos||'—'} · {row.age||'—'} years · {row.college||row.nationality||'Rookie'}</p>
           <label htmlFor={`bm-rookie-${row.playerId}`}>Contract path</label>
           <select id={`bm-rookie-${row.playerId}`} disabled={busy} value={decisions[String(row.playerId)]||'standard'}
             onChange={e=>{setDecisions(s=>({...s,[String(row.playerId)]:e.target.value}));setConfirm('');}}>
             {options.map(([v,text])=><option key={v} value={v}>{text}</option>)}
           </select><small>Suggested: {options.find(([v])=>v===row.recommendedDecision)?.[1]||'Review with your GM'}</small>
         </article>)}
         {!loading&&!myPending.length&&<div className="bmOnlineRookieEmpty">Your team has no unsigned rookies. Other GMs retain control of their own picks.</div>}
       </section>
       {isHost&&cpuTeams.length>0&&<section className="bmOnlineSeasonHostControls bmOnlineRookieCpu"><div>
         <small>HOST ONLY · CPU TEAMS</small><strong>Resolve {cpuTeams.length} CPU team{cpuTeams.length===1?'':'s'}</strong>
         <p>Run the original single-player CPU signing decisions. Human teams are excluded, and all affected CPU rosters commit in one transaction.</p></div>
         <div className="bmOnlineSeasonHostActions">
           {confirm==='resolve-cpu'?<><button disabled={busy} onClick={()=>setConfirm('')}>Cancel</button>
             <button className="primary" disabled={busy} onClick={()=>submit('resolve-cpu')}>Confirm CPU contracts</button></>:
             <button disabled={busy} className="primary" onClick={()=>submit('resolve-cpu')}>Resolve CPU signings</button>}
         </div></section>}
     </>}
   </>}
   {error&&<div className="bmOnlineSeasonActionError" role="alert">{error} <button type="button" onClick={()=>onAccepted?.()}>Refresh league</button></div>}
   {notice&&<div className="bmOnlineDraftInlineNotice" role="status">{notice}</div>}
   <footer className="bmOnlineSeasonFooter">Server-authorized rookie signings. No local or single-player saves are modified. Contract rights and team ownership are checked again on commit.</footer>
 </main>;
}
