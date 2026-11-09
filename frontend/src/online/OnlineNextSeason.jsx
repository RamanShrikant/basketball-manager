// The existing online offseason layout hosts the final checkpoint.
import React,{useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {useGame} from './onlineReadOnlyContext.jsx';
import {startOnlineNextSeason} from './onlineSeasonRolloverClient.js';
import {onlinePostseasonRequestId,clearOnlinePostseasonRequestId} from './onlinePostseasonRequestId.mjs';
import './online-season.css';
import './online-progression.css';
import './online-rollover.css';
export default function OnlineNextSeason(){
 const {leagueData,lobbyId,revision,isHost,onAccepted}=useGame();
 const from=Number(leagueData?.onlineSchedule?.seasonYear||0);
 const year=from+1;
 const progression=leagueData?.onlineProgression;
 const ready=progression?.status==='complete'&&Number(progression.seasonYear)===year&&
   leagueData?.onlineOffseasonMarket?.status==='complete'&&
   leagueData?.freeAgencyState?.marketComplete===true&&
   leagueData?.offseasonState?.progressionComplete===true;
 const completed=!ready&&Number(leagueData?.onlineSeasonRollover?.toYear)===from&&
   Number(leagueData?.onlineSeasonRollover?.fromYear)===from-1;
 const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');const pending=useRef(false);
 useEffect(()=>{setConfirm(false);setError('');setNotice('');},[revision,lobbyId]);
 async function run(){
  if(!isHost||!ready||!confirm||busy||pending.current)return;
  const expectedRevision=Number(revision);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)return;
  pending.current=true;setBusy(true);setError('');
  const action=`rollover-${from}-${expectedRevision}`;
  try{
   const result=await startOnlineNextSeason({lobbyId,expectedRevision,requestId:onlinePostseasonRequestId(lobbyId,action)});
   clearOnlinePostseasonRequestId(lobbyId,action);setConfirm(false);
   setNotice(`Season ${result.toYear}–${result.toYear+1} is now live for all GMs.`);
   await onAccepted?.();
  }catch(e){setConfirm(false);setError(`${e.message||e} Refresh the league before trying again.`);
   try{await onAccepted?.();}catch{/* keep original error */}
  }finally{pending.current=false;setBusy(false);}
 }
 return <main className="bmOnlineSeasonPage bmOnlineRollover" data-online-season-view="rollover">
  <header className="bmOnlineSeasonHeading"><div><div className="bmOnlineSeasonEyebrow">BASKETBALL MANAGER · ONLINE OFFSEASON</div>
   <h1>Next Season</h1><p>The final franchise transition. Preserve every roster, contract, and draft asset; archive the completed year and create a fresh NBA calendar.</p></div>
   <div className="bmOnlineSeasonSummary"><small>LEAGUE TRANSITION</small><strong>{completed?'SEASON LIVE':ready?'READY':'LOCKED'}</strong>
    <span>{completed?`${from}–${from+1}`:`${from||'—'}–${year||'—'} championship → ${year||'—'}–${year+1||'—'} season`}</span></div>
  </header>
  {completed?<section className="bmOnlineSeasonHostControls"><div><small>ROLLOVER COMPLETE</small><strong>Your next season is live</strong>
   <p>The championship and prior season records have been archived. All managers now share the fresh 1,230-game schedule.</p></div>
   <Link to={`?view=${encodeURIComponent('/calendar')}`}>View New Schedule</Link></section>
  :ready?<section className="bmOnlineSeasonHostControls"><div><small>FINAL OFFSEASON CHECKPOINT</small><strong>Start the {year}–{year+1} NBA season</strong>
   <p>One host-only transaction saves a permanent season archive, advances payroll and calendar years, clears completed seasonal checkpoints, and generates a new 82-game schedule for every NBA team.</p>
   <p>Signed contracts remain indexed by their original start years. Draft-pick ownership, player ratings, progression, and GM assignments will not change.</p>
   {!isHost&&<span>Waiting for the host to authorize the next season.</span>}
   {confirm&&<p className="bmOnlineRolloverWarning">This checkpoint cannot be undone through the game. Confirm only after verifying every GM has completed the offseason.</p>}</div>
   {isHost&&<div className="bmOnlineSeasonHostActions">
     {confirm&&<button type="button" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button>}
     <button className="primary" type="button" disabled={busy} onClick={()=>confirm?run():setConfirm(true)}>{busy?'Preparing NBA schedule…':confirm?'Confirm Next Season':'Start Next Season'}</button>
   </div>}</section>
  :<section className="bmOnlineSeasonEmpty"><h2>Complete player progression first</h2><p>The host can begin the next season only after the 10-day free-agent market, rookie signings, Bird rights, and player development are finalized.</p>
   <Link to={`?view=${encodeURIComponent('/player-progression')}`}>Go to Player Progression</Link></section>}
  {error&&<p className="bmOnlineSeasonActionError" role="alert">{error} <button type="button" onClick={()=>onAccepted?.()}>Refresh</button></p>}
  {notice&&<p className="bmOnlineRolloverNotice" role="status">{notice}</p>}
  <footer className="bmOnlineSeasonFooter">One shared NBA universe. This event never starts a browser game or deploys a server automatically.</footer>
 </main>;
}
