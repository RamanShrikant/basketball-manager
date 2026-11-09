// Phase 2E.4-D: visualizes the SAME shared league result for every human GM.
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {useGame} from './onlineReadOnlyContext.jsx';
import {runOnlinePlayerProgression} from './onlineProgressionClient.js';
import {onlinePostseasonRequestId,clearOnlinePostseasonRequestId} from './onlinePostseasonRequestId.mjs';
import './online-season.css';
import './online-progression.css';

const fmt=v=>Number.isFinite(Number(v))?String(v):'—';
const sign=v=>v>0?`+${v}`:String(v);
export default function OnlinePlayerProgression(){
 const {leagueData,lobbyId,revision,isHost,selectedTeam,onAccepted}=useGame();
 const year=Number(leagueData?.onlineDraft?.draftYear||0);
 const team=selectedTeam?.name||'';
 const market=leagueData?.onlineOffseasonMarket||{};
 const stage=leagueData?.onlineProgression;
 const done=stage?.status==='complete'&&Number(stage.seasonYear)===year;
 const ready=market.status==='complete'&&Number(market.year)===year&&
  leagueData?.freeAgencyState?.marketComplete===true&&
  leagueData?.offseasonState?.freeAgencyComplete===true&&
  leagueData?.onlineRookieSignings?.status==='complete'&&
  leagueData?.onlineOptions?.status==='complete'&&
  leagueData?.onlineRights?.status==='complete'&&!stage&&
  leagueData?.offseasonState?.progressionComplete!==true;
 const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [scope,setScope]=useState('team'),[sort,setSort]=useState('rising'),[query,setQuery]=useState('');
 const pending=useRef(false);
 useEffect(()=>{setConfirm(false);setError('');setNotice('');},[year,revision,lobbyId]);
 const data=useMemo(()=>{
  if(!done)return [];
  const needle=query.trim().toLowerCase();
  const rows=(stage.changes||[]).filter(p=>{
    if(scope==='team'&&p.team!==team)return false;
    if(scope==='fa'&&p.bucket!=='freeAgents')return false;
    if(needle&&!`${p.name||''} ${p.team||''}`.toLowerCase().includes(needle))return false;
    return true;
  });
  rows.sort((a,b)=>sort==='falling'?Number(a.overallDelta||0)-Number(b.overallDelta||0):
    sort==='overall'?Number(b.overallAfter||0)-Number(a.overallAfter||0):
    sort==='age'?Number(b.ageAfter||0)-Number(a.ageAfter||0):
    Number(b.overallDelta||0)-Number(a.overallDelta||0));
  return rows;
 },[done,stage?.changes,scope,team,sort,query]);
 const run=async()=>{
  if(!isHost||!ready||!confirm||busy||pending.current||!lobbyId)return;
  const expectedRevision=Number(revision);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)return;
  pending.current=true;setBusy(true);setError('');setNotice('');
  const action=`progression-${year}-${expectedRevision}`;
  try{
   const out=await runOnlinePlayerProgression({lobbyId,expectedRevision,requestId:onlinePostseasonRequestId(lobbyId,action)});
   clearOnlinePostseasonRequestId(lobbyId,action);setConfirm(false);
   setNotice(out.replayed?'The league has already recorded this progression event.':
    `Progression saved to the shared league. ${out.summary?.playerCount??0} players checked.`);
   await onAccepted?.();
  }catch(e){setConfirm(false);setError(`${e.message||e} Refresh the shared franchise to confirm its current revision.`);
   try{await onAccepted?.();}catch{/* preserve initial error */}
  }finally{pending.current=false;setBusy(false);}
 };
 const summary=stage?.summary||{};
 return <main className="bmOnlineSeasonPage bmOnlineProgression" data-online-season-view="progression">
  <header className="bmOnlineSeasonHeading"><div><div className="bmOnlineSeasonEyebrow">BASKETBALL MANAGER · ONLINE OFFSEASON</div>
   <h1>Player Progression</h1><p>Original single-player development and V19 ratings. One official result, synchronized for every GM.</p></div>
   <div className="bmOnlineSeasonSummary"><small>{year||'—'} OFFSEASON</small><strong>{done?'COMPLETE':ready?'READY':'LOCKED'}</strong>
    <span>{done?'Official shared player ratings':isHost?'Host-managed league transition':'Awaiting host'}</span></div>
  </header>
  {!done&&!ready&&<section className="bmOnlineSeasonEmpty"><h2>Finish the 10-day free-agency market first</h2>
    <p>All RFA matching and signing decisions must be completed. Player development cannot change contracts, teams, or the official bidding ledger.</p>
    <Link to={`?view=${encodeURIComponent('/free-agents')}`}>Return to Free Agency</Link></section>}
  {!done&&ready&&<section className="bmOnlineSeasonHostControls bmOnlineProgressionReady">
    <div><small>OFFSEASON CHECKPOINT · {year}</small><strong>League-wide player development and age-up</strong>
     <p>The server runs the original progression model for every NBA team and eligible free agent. The current draft class is protected, age-ups happen only once, and existing contracts and ownership remain unchanged.</p>
     {!isHost&&<span>Only the host can finalize this irreversible offseason stage. Your roster will synchronize automatically.</span>}
    </div>
    {isHost&&<div className="bmOnlineSeasonHostActions">
      {confirm&&<button type="button" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button>}
      <button className="primary" type="button" disabled={busy} onClick={()=>confirm?run():setConfirm(true)}>
       {busy?'Computing league ratings…':confirm?'Confirm official progression':'Run Player Progression'}</button>
    </div>}
  </section>}
  {done&&<div className="bmOnlineSeasonScroll bmOnlineProgressionScroll">
    <section className="bmOnlineProgressionSummary" aria-label="Official progression summary">
      <div><small>PLAYERS CHECKED</small><strong>{fmt(summary.playerCount)}</strong><span>All 30 NBA teams + free agents</span></div>
      <div><small>IMPROVED</small><strong className="positive">{fmt(summary.improved)}</strong><span>Overall rating gained</span></div>
      <div><small>REGRESSED</small><strong className="negative">{fmt(summary.declined)}</strong><span>Overall rating declined</span></div>
      <div><small>AGED</small><strong>{fmt(summary.aged)}</strong><span>{fmt(summary.protectedRookies)} new rookies protected</span></div>
    </section>
    <section className="bmOnlineProgressionBoard">
      <div className="bmOnlineProgressionToolbar">
       <div><small>OFFICIAL DEVELOPMENT REPORT</small><h2>{scope==='team'?team:scope==='fa'?'Free Agents':'League-Wide Progression'}</h2></div>
       <div className="bmOnlineProgressionFilters">
        <label>Roster <select aria-label="Progression roster" value={scope} onChange={e=>setScope(e.target.value)}><option value="team">My Team</option><option value="league">Entire League</option><option value="fa">Free Agents</option></select></label>
        <label>Sort <select aria-label="Progression sort" value={sort} onChange={e=>setSort(e.target.value)}><option value="rising">Biggest risers</option><option value="falling">Biggest fallers</option><option value="overall">Highest overall</option><option value="age">Oldest first</option></select></label>
        <label>Search <input aria-label="Search progression players" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Player or team" maxLength={80}/></label>
       </div>
      </div>
      <div className="bmOnlineProgressionRows" role="table" aria-label="Player development results">
       <div className="bmOnlineProgressionRow bmOnlineProgressionRowHead" role="row"><span>PLAYER</span><span>AGE</span><span>OVERALL</span><span>CHANGE</span><span>POTENTIAL</span></div>
       {data.slice(0,80).map(p=><div className="bmOnlineProgressionRow" role="row" key={`${p.id}:${p.bucket}`}>
        <span className="bmOnlineProgressionName"><strong>{p.name}</strong><small>{p.team} · {p.bucket==='twoWayPlayers'?'Two-Way':p.bucket==='stashPlayers'?'Stash':p.bucket==='freeAgents'?'Free Agent':'NBA'}</small></span>
        <span>{fmt(p.ageBefore)} <b className="bmOnlineProgressionArrow">→</b> {fmt(p.ageAfter)}</span>
        <span>{fmt(p.overallBefore)} <b className="bmOnlineProgressionArrow">→</b> {fmt(p.overallAfter)}</span>
        <span className={Number(p.overallDelta)>0?'positive':Number(p.overallDelta)<0?'negative':'neutral'}>{sign(Number(p.overallDelta)||0)}</span>
        <span>{fmt(p.potentialBefore)} <b className="bmOnlineProgressionArrow">→</b> {fmt(p.potentialAfter)}</span>
       </div>)}
       {!data.length&&<p className="bmOnlineProgressionEmpty">No players match the selected filters.</p>}
      </div>
      <footer className="bmOnlineProgressionCount">Showing {Math.min(data.length,80)} of {data.length} results · Updated ratings are already saved server-side.</footer>
    </section>
    <section className="bmOnlineProgressionNext"><strong>Official progression is complete.</strong><span>Player development is saved to the league. Advancing to the next season is a separate upcoming checkpoint; it has not happened automatically.</span></section>
  </div>}
  {error&&<p className="bmOnlineSeasonActionError" role="alert">{error} <button type="button" onClick={()=>onAccepted?.()}>Refresh league</button></p>}
  {notice&&<p className="bmOnlineProgressionNotice" role="status">{notice}</p>}
  <footer className="bmOnlineSeasonFooter">Player progression is a one-time, host-authorized shared event. It does not roll the schedule, clear history, change contracts, or launch the next season.</footer>
 </main>;
}
