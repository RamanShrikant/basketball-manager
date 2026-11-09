import {trustedOnlineApiBase} from './onlineCalendarBootstrap.js';
// Phase 2E.3-B · Host-only original-engine retirement event, before the lottery.
import React,{useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {useGame} from './onlineReadOnlyContext.jsx';
import {supabase} from '../auth/supabaseClient.js';
import {onlinePostseasonRequestId,clearOnlinePostseasonRequestId} from './onlinePostseasonRequestId.mjs';
import './online-season.css';
const top=(rows)=>[...(rows||[])].sort((a,b)=>Number(b?.overall||0)-Number(a?.overall||0));
export default function OnlineRetirements(){
 const {leagueData,lobbyId,revision,isHost,onAccepted}=useGame();
 const event=leagueData?.onlineRetirements;
 const post=leagueData?.onlinePostseason;
 const year=Number(post?.seasonYear||0)+1;
 const champion=post?.phase==='postseasonComplete';
 const alreadyDraft=Boolean(leagueData?.onlineDraftLottery||leagueData?.onlineDraft);
 const finished=event?.status==='complete';
 const eligible=champion&&!alreadyDraft&&!finished;
 const [preview,setPreview]=useState(null);
 const [loading,setLoading]=useState(false);
 const [busy,setBusy]=useState(false);
 const [confirm,setConfirm]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const inflight=useRef(false);
 useEffect(()=>{setPreview(null);setConfirm(false);setError('');setNotice('');},[lobbyId,revision]);
 const call=async(mode)=>{
  const {data:{session},error:authError}=await supabase.auth.getSession();
  if(authError||!session?.access_token)throw Error('Online session expired. Sign in again.');
  const url=trustedOnlineApiBase();
  if(!url)throw Error('The trusted offseason backend has not been configured.');
  const body={lobbyId,expectedRevision:Number(revision)};
  if(mode==='run')body.requestId=onlinePostseasonRequestId(lobbyId,'retirements');
  const response=await fetch(`${url}/api/online/offseason/retirements/${mode==='run'?'run':'preview'}`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
    body:JSON.stringify(body)});
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data?.ok)throw Error(data?.error||'Online retirement event did not complete.');
  return data;
 };
 async function inspect(){
  if(!eligible||loading||busy)return;
  setLoading(true);setError('');
  try{setPreview(await call('preview'));}catch(e){setError(e?.message||String(e));}
  finally{setLoading(false);}
 }
 async function finalize(){
  if(!eligible||!isHost||!confirm||inflight.current)return;
  inflight.current=true;setBusy(true);setError('');
  try{
   const result=await call('run');
   clearOnlinePostseasonRequestId(lobbyId,'retirements');setNotice(`${result.count} retirements officially recorded.`);
   setConfirm(false);await onAccepted?.();
  }catch(e){setError(e?.message||String(e));setConfirm(false);}
  finally{inflight.current=false;setBusy(false);}
 }
 const summary=event?.summary||{};
 const players=finished?top(event?.retiredPlayers):[];
 return <main className="bmOnlineSeasonPage bmOnlineRetirementPage" data-online-season-view="retirements">
  <header className="bmOnlineSeasonHeading"><div><div className="bmOnlineSeasonEyebrow">BASKETBALL MANAGER · ONLINE OFFSEASON</div>
   <h1>Player Retirements</h1><p>The original single-player retirement model, with one official result shared by every GM.</p></div>
   <div className="bmOnlineSeasonSummary"><small>{year} OFFSEASON</small><strong>{finished?'COMPLETE':eligible?'PENDING':'LOCKED'}</strong><span>{finished?`${summary.retiredCount??players.length} retired players`:'Host-managed league event'}</span></div>
  </header>
  {!champion&&<section className="bmOnlineSeasonEmpty"><h2>Finish the NBA Finals first</h2><p>Player retirements are the first offseason event. The postseason must finish before the host can run them.</p></section>}
  {champion&&alreadyDraft&&!finished&&<section className="bmOnlineSeasonEmpty"><h2>Draft already started</h2><p>In single-player, retirements happen before the lottery. This franchise already passed that stage, so the server won't retroactively change rosters after the draft.</p><p>Use a new disposable league to validate the complete offseason sequence.</p></section>}
  {eligible&&<section className="bmOnlineSeasonHostControls"><div><small>{isHost?'HOST · OFFSEASON CONTROL':'AWAITING HOST'}</small><strong>Finalize {year} retirements</strong>
    <p>The trusted backend checks every team and free-agent pool using the finished retirement engine. The database will remove only confirmed retirees and append their records once.</p>
   </div><div className="bmOnlineSeasonHostActions"><button type="button" disabled={loading||busy} onClick={inspect}>{loading?'Analyzing…':'Preview retirement odds'}</button>
    {isHost&&(confirm?<><button type="button" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button><button className="primary" type="button" disabled={busy} onClick={finalize}>{busy?'Finalizing…':'Confirm retirements'}</button></>:<button className="primary" type="button" disabled={busy} onClick={()=>setConfirm(true)}>Finalize event</button>)}
   </div></section>}
  {eligible&&preview&&<section className="bmOnlineRetirementList" aria-label="Retirement probability preview"><div className="bmOnlineRetirementListHeader"><strong>Highest retirement probabilities</strong><span>{preview.total} players evaluated · outcomes remain private until the official event</span></div>
   {preview.preview.map((p,i)=><div className="bmOnlineRetirementRow" key={`${p.name}-${p.team}-${i}`}><span className="bmOnlineRetirementIndex">{String(i+1).padStart(2,'0')}</span><div><strong>{p.name||'Player'}</strong><small>{p.team||'Free Agency'} · {p.age} years · {p.overall} OVR</small></div><span className="bmOnlineRetirementOdds">{Math.round(Number(p.probability||0)*100)}%</span></div>)}
  </section>}
  {finished&&<><div className="bmOnlineDraftSummary"><div><small>RETIRED PLAYERS</small><strong>{summary.retiredCount??players.length}</strong><span>{year} offseason</span></div><div><small>TEAMS AFFECTED</small><strong>{summary.teamsAffected??0}</strong><span>NBA teams and free agency</span></div><div><small>AVERAGE AGE</small><strong>{summary.averageAge??'—'}</strong><span>Original retirement model</span></div></div>
   <section className="bmOnlineRetirementList" aria-label="Official retired players"><div className="bmOnlineRetirementListHeader"><strong>Official retirement class</strong><span>Saved to your shared franchise history</span></div>
    {players.map((p,i)=><div className="bmOnlineRetirementRow" key={`${p.id}-${i}`}><span className="bmOnlineRetirementIndex">{String(i+1).padStart(2,'0')}</span><div><strong>{p.name}</strong><small>{p.retiredFromTeam} · {p.age} years</small></div><span className="bmOnlineRetirementOdds">{p.overall} OVR</span></div>)}
    {players.length===0&&<div className="bmOnlineRookieEmpty">No players retired this offseason. The official event was still completed and recorded.</div>}
   </section>
   <Link className="bmOnlineDraftContinue" to={`/online/franchise/${lobbyId}?view=${encodeURIComponent('/draft-lottery')}`}>Continue to Draft Lottery</Link>
  </>}
  {error&&<p className="bmOnlineSeasonActionError" role="alert">{error} <button onClick={()=>onAccepted?.()}>Refresh league</button></p>}
  {notice&&<p className="bmOnlineDraftInlineNotice" role="status">{notice}</p>}
  <footer className="bmOnlineSeasonFooter">Finalizing retirements is irreversible for this season. No client chooses the outcomes, and nothing is written to single-player saves. Player progression comes later, after offseason free agency.</footer>
 </main>;
}
