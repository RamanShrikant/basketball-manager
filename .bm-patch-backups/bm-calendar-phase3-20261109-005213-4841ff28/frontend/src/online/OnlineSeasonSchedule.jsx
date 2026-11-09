// Phase 2B.5: shared read-only season schedule. Never generates or mutates games.
import React, {useMemo,useState,useRef,useEffect} from 'react';
import {supabase} from '../auth/supabaseClient.js';
import {useGame} from './onlineReadOnlyContext.jsx';
import {readOnlineGames, readOnlineSeasonYear,formatGameDate} from './onlineSeasonReadModel.mjs';
import OnlineSimulationBatchPanel from './OnlineSimulationBatchPanel.jsx';
import OnlineTradeDeadlineCheckpoint from './OnlineTradeDeadlineCheckpoint.jsx';
import OnlineAllStarCheckpoint from './OnlineAllStarCheckpoint.jsx';
import OnlineVeteranExtensionCheckpoint from './OnlineVeteranExtensionCheckpoint.jsx';
import {firstBlockedOnlineCheckpoint} from './onlineSimulationCheckpoints.mjs';
import './online-season.css';

const allTeams=league=>Array.isArray(league?.teams)?league.teams:Object.values(league?.conferences||{}).flat().filter(Boolean);
const logoOf=t=>t?.logo||t?.teamLogo||t?.newTeamLogo||t?.logoUrl||'';

export default function OnlineSeasonSchedule(){
  const {leagueData,selectedTeam,lobbyId,revision,onAccepted,isHost}=useGame();
  const [creationStep,setCreationStep]=useState(false);
  const [busy,setBusy]=useState(false);
  const [actionError,setActionError]=useState('');
  const [simConfirm,setSimConfirm]=useState(false);
  const [simBusy,setSimBusy]=useState(false);
  const [rangeBusy,setRangeBusy]=useState(false);
  const simRequestRef=useRef(null);
  const [boxGame,setBoxGame]=useState(null);
  useEffect(()=>{
    if(!boxGame)return;
    const close=e=>{if(e.key==='Escape')setBoxGame(null);};
    window.addEventListener('keydown',close);
    return ()=>window.removeEventListener('keydown',close);
  },[boxGame]);
  const requestRef=useRef(null);
  const trustedApi=String(import.meta.env.VITE_BM_ONLINE_CPU_API_URL||'').replace(/\/$/,'');
  async function initializeSchedule(){
    if(!isHost||busy||!creationStep||games.length)return;
    setBusy(true);setActionError('');
    try{
      const {data:{session},error:authError}=await supabase.auth.getSession();
      if(authError||!session?.access_token)throw Error('Please sign in again.');
      if(!trustedApi)throw Error('Trusted Online backend is not configured for Calendar.');
      if(!requestRef.current)requestRef.current=crypto.randomUUID();
      const response=await fetch(`${trustedApi}/api/online/calendar/initialize`,{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
        body:JSON.stringify({lobbyId,expectedRevision:Number(revision),requestId:requestRef.current})
      });
      const data=await response.json().catch(()=>null);
      if(!response.ok||!data?.ok)throw Error(data?.error||'The calendar was not committed.');
      requestRef.current=null;setCreationStep(false);
      await onAccepted?.();
    }catch(error){setActionError(error?.message||String(error));}
    finally{setBusy(false);}
  }
  const games=useMemo(()=>readOnlineGames(leagueData),[leagueData]);
  const [teamFilter,setTeamFilter]=useState('mine');
  const [monthFilter,setMonthFilter]=useState('all');
  const teamName=selectedTeam?.name||'';
  const logos=useMemo(()=>new Map(allTeams(leagueData).map(t=>[t.name,logoOf(t)])),[leagueData]);
  const months=useMemo(()=>[...new Set(games.map(g=>g.date.slice(0,7)))],[games]);
  const filtered=games.filter(g=>(teamFilter!=='mine'||g.home===teamName||g.away===teamName)&&(monthFilter==='all'||g.date.startsWith(monthFilter)));
  const groups=Object.entries(Object.groupBy ? Object.groupBy(filtered,g=>g.date) : filtered.reduce((o,g)=>{(o[g.date]??=[]).push(g);return o;},{}));
  const played=games.filter(g=>g.played).length;
  const pending=games.filter(g=>!g.played);
  const nextDay=pending[0]?.date||null;
  const nextDayGames=nextDay?pending.filter(g=>g.date===nextDay):[];
  const hasPartiallyCompletedDay=nextDay?games.some(g=>g.date===nextDay&&g.played):false;
  const nextCheckpoint=nextDay?firstBlockedOnlineCheckpoint(leagueData,nextDay):null;
  const boxResult=boxGame?leagueData?.onlineResults?.[boxGame]:null;
  async function advanceNextDay(){
    if(!isHost||!simConfirm||simBusy||rangeBusy||!nextDay||hasPartiallyCompletedDay||nextCheckpoint)return;
    setSimBusy(true);setActionError('');
    try{
      const {data:{session},error}=await supabase.auth.getSession();
      if(error||!session?.access_token)throw Error('Please sign in again.');
      if(!trustedApi)throw Error('The trusted Online simulation backend is not configured.');
      if(!simRequestRef.current)simRequestRef.current=crypto.randomUUID();
      const response=await fetch(`${trustedApi}/api/online/calendar/simulate-next-day`,{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
        body:JSON.stringify({lobbyId,expectedRevision:Number(revision),requestId:simRequestRef.current})
      });
      const data=await response.json().catch(()=>null);
      if(!response.ok||!data?.ok)throw Error(data?.error||'No games were committed.');
      simRequestRef.current=null;setSimConfirm(false);
      await onAccepted?.();
    }catch(error){setActionError(error?.message||String(error));}
    finally{setSimBusy(false);}
  }
  const seasonYear=readOnlineSeasonYear(leagueData);
  return <main className="bmOnlineSeasonPage" data-online-season-view="schedule">
    <header className="bmOnlineSeasonHeading"><div><div className="bmOnlineSeasonEyebrow">BASKETBALL MANAGER · ONLINE FRANCHISE</div><h1>Schedule</h1><p>One shared calendar for every GM. Only games stored in the Online franchise appear here.</p></div>
      <div className="bmOnlineSeasonSummary"><small>SEASON</small><strong>{seasonYear?`${seasonYear}–${String(seasonYear+1).slice(-2)}`:'Not set'}</strong><span>{played} / {games.length} games completed</span></div></header>
    {!games.length&&isHost&&<section className="bmOnlineSeasonHostControls" aria-label="Host calendar initialization">
      <div><small>HOST CONTROL</small><strong>Initialize the shared NBA season</strong>
        <p>Use the original single-player 82-game schedule generator. Once created, all GMs share the same 1,230 games. This cannot be regenerated over existing games.</p></div>
      {creationStep?<div className="bmOnlineSeasonHostActions"><button type="button" disabled={busy} onClick={()=>setCreationStep(false)}>Cancel</button><button type="button" disabled={busy} className="primary" onClick={initializeSchedule}>{busy?'Creating shared calendar…':'Confirm initialization'}</button></div>
        :<button type="button" onClick={()=>{requestRef.current=null;setCreationStep(true);}}>Prepare season</button>}
    </section>}
    {!!games.length&&isHost&&<section className="bmOnlineSeasonHostControls" aria-label="Host simulation controls">
      <div><small>HOST · REGULAR SEASON</small><strong>{nextDay?`Next game day · ${formatGameDate(nextDay)}`:'Regular season complete'}</strong>
        <p>{nextDay?`${nextDayGames.length} scheduled game${nextDayGames.length===1?'':'s'} · Original Python game simulation · Shared box scores, injuries and player stats.`:'All regular-season results are final. Postseason progression is a separate upcoming phase.'}</p>
        {hasPartiallyCompletedDay&&<p className="bmOnlineSeasonActionError">Partial results detected. Refresh or restore this date before advancing.</p>}
        {nextCheckpoint&&<p className="bmOnlineSeasonActionError">{nextCheckpoint.label} ({formatGameDate(nextCheckpoint.date)}) must be resolved before more games can advance.</p>}
      </div>
      {nextDay&&!hasPartiallyCompletedDay&&!nextCheckpoint&&(simConfirm?<div className="bmOnlineSeasonHostActions">
        <button type="button" disabled={simBusy||rangeBusy} onClick={()=>setSimConfirm(false)}>Cancel</button>
        <button type="button" disabled={simBusy||rangeBusy} className="primary" onClick={advanceNextDay}>{simBusy?'Simulating the NBA…':'Confirm next game day'}</button>
      </div>:<button type="button" onClick={()=>{simRequestRef.current=null;setActionError('');setSimConfirm(true);}}>Simulate next day</button>)}
    </section>}
    {!!games.length&&nextCheckpoint?.kind==='trade_deadline'&&<OnlineTradeDeadlineCheckpoint checkpoint={nextCheckpoint} lobbyId={lobbyId} revision={revision} isHost={isHost} onAccepted={onAccepted} disabled={simBusy||rangeBusy||busy}/>}
    {!!games.length&&(nextCheckpoint?.kind==='all_star'||leagueData?.onlineAllStars)&&<OnlineAllStarCheckpoint checkpoint={nextCheckpoint?.kind==='all_star'?nextCheckpoint:null} leagueData={leagueData} lobbyId={lobbyId} revision={revision} isHost={isHost} onAccepted={onAccepted} disabled={simBusy||rangeBusy||busy}/>}
    {!!games.length&&nextCheckpoint?.kind==='extension_deadline'&&<OnlineVeteranExtensionCheckpoint checkpoint={nextCheckpoint} lobbyId={lobbyId} revision={revision} isHost={isHost} onAccepted={onAccepted} disabled={simBusy||rangeBusy||busy}/>}
    {!!games.length&&isHost&&<OnlineSimulationBatchPanel leagueData={leagueData} lobbyId={lobbyId} revision={revision} onAccepted={onAccepted} disabled={simBusy||hasPartiallyCompletedDay} onRunningChange={setRangeBusy}/>}
    {actionError&&<p className="bmOnlineSeasonActionError" role="alert">{actionError} <button type="button" onClick={()=>onAccepted?.()}>Refresh league</button></p>}
    <div className="bmOnlineSeasonToolbar"><div className="bmOnlineSeasonTabs" role="group" aria-label="Schedule team filter"><button type="button" className={teamFilter==='mine'?'active':''} onClick={()=>setTeamFilter('mine')}>My Team</button><button type="button" className={teamFilter==='all'?'active':''} onClick={()=>setTeamFilter('all')}>Entire NBA</button></div>
      {months.length>0&&<label>Month <select aria-label="Schedule month" value={monthFilter} onChange={e=>setMonthFilter(e.target.value)}><option value="all">All Months</option>{months.map(m=><option key={m} value={m}>{new Date(`${m}-01T12:00:00Z`).toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'})}</option>)}</select></label>}</div>
    {!games.length?<section className="bmOnlineSeasonEmpty"><div className="bmOnlineSeasonEmptyMark">NBA</div><h2>Shared calendar not initialized</h2><p>The franchise is saved, but the Online simulation engine hasn't generated a league schedule yet. We won't load a single-player calendar or invent games for this league.</p><span>The host may initialize the real shared season. The host can initialize the schedule before simulating games.</span></section>:
      !filtered.length?<section className="bmOnlineSeasonEmpty"><h2>No games match these filters</h2><p>Choose another team or month filter to see scheduled games.</p></section>:
      <div className="bmOnlineSeasonScroll" role="region" aria-label="Online NBA schedule">{groups.map(([date,rows])=><section key={date} className="bmOnlineSeasonDate"><h2>{formatGameDate(date)} <span>{rows.length} game{rows.length===1?'':'s'}</span></h2><div className="bmOnlineSeasonGameList">{rows.map((g,i)=><div className="bmOnlineSeasonGame" key={`${g.date}-${g.id}-${i}`}><div className="bmOnlineSeasonMatchup"><div>{logos.get(g.away)&&<img alt="" src={logos.get(g.away)}/>}<span>{g.away}</span></div><b>AT</b><div>{logos.get(g.home)&&<img alt="" src={logos.get(g.home)}/>}<span>{g.home}</span></div></div><div className="bmOnlineSeasonResult">{g.played?<><strong>{g.awayScore} – {g.homeScore}</strong><small>FINAL</small>{leagueData?.onlineResults?.[g.id]?.box&&<button type="button" className="bmOnlineSeasonBoxLink" onClick={()=>setBoxGame(String(g.id))}>Box score</button>}</>:<small>SCHEDULED</small>}</div></div>)}</div></section>)}</div>}
    {boxGame&&boxResult&&<div className="bmOnlineSeasonModalScrim" role="presentation" onClick={()=>setBoxGame(null)}>
      <section className="bmOnlineSeasonBoxModal" role="dialog" aria-modal="true" aria-label="Shared game box score" onClick={e=>e.stopPropagation()}>
        <div className="bmOnlineSeasonBoxHeader"><div><small>ONLINE FRANCHISE · FINAL</small><h2>{boxResult.away} {boxResult.awayScore} — {boxResult.homeScore} {boxResult.home}</h2><p>{formatGameDate(boxResult.date)}</p></div><button type="button" aria-label="Close box score" onClick={()=>setBoxGame(null)}>✕</button></div>
        {['away','home'].map(side=><div key={side} className="bmOnlineSeasonBoxTableWrap"><h3>{boxResult[side]}</h3><table><thead><tr>{['PLAYER','MIN','PTS','REB','AST','STL','BLK','FG','3PT','FT'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{(boxResult.box?.[side]||[]).map((p,i)=><tr key={i}><td>{p.player}</td><td>{p.min}</td><td>{p.pts}</td><td>{p.reb}</td><td>{p.ast}</td><td>{p.stl}</td><td>{p.blk}</td><td>{p.fg}</td><td>{p['3p']}</td><td>{p.ft}</td></tr>)}</tbody></table></div>)}
      </section>
    </div>}
    <footer className="bmOnlineSeasonFooter">{games.length?'Results come from the trusted Python game engine and are recorded once for every GM. Season checkpoints and postseason simulation are still being integrated.':'No games will be invented in this browser. Only the host can initialize the authoritative schedule.'}</footer>
  </main>;
}
