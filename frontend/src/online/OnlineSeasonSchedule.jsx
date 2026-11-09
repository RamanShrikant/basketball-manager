// Phase 2B.5: shared read-only season schedule. Never generates or mutates games.
import React, {useMemo,useState,useEffect} from 'react';
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
  const {leagueData,selectedTeam,lobbyId,revision,onAccepted,isHost,calendarSetup,retryCalendarSetup}=useGame();
  const [rangeBusy,setRangeBusy]=useState(false);
  const [boxGame,setBoxGame]=useState(null);
  useEffect(()=>{
    if(!boxGame)return;
    const close=e=>{if(e.key==='Escape')setBoxGame(null);};
    window.addEventListener('keydown',close);
    return ()=>window.removeEventListener('keydown',close);
  },[boxGame]);
  const games=useMemo(()=>readOnlineGames(leagueData),[leagueData]);
  const [teamFilter,setTeamFilter]=useState('all');
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
  const seasonYear=readOnlineSeasonYear(leagueData);
  return <main className="bmOnlineSeasonPage" data-online-season-view="schedule">
    <header className="bmOnlineSeasonHeading"><div><div className="bmOnlineSeasonEyebrow">BASKETBALL MANAGER · ONLINE FRANCHISE</div><h1>Schedule</h1><p>One shared calendar for every GM. Only games stored in the Online franchise appear here.</p></div>
      <div className="bmOnlineSeasonSummary"><small>SEASON</small><strong>{seasonYear?`${seasonYear}–${String(seasonYear+1).slice(-2)}`:'Not set'}</strong><span>{played} / {games.length} games completed</span></div></header>
    {!!games.length&&nextCheckpoint?.kind==='trade_deadline'&&<OnlineTradeDeadlineCheckpoint checkpoint={nextCheckpoint} lobbyId={lobbyId} revision={revision} isHost={isHost} onAccepted={onAccepted} disabled={rangeBusy}/>}
    {!!games.length&&(nextCheckpoint?.kind==='all_star'||leagueData?.onlineAllStars)&&<OnlineAllStarCheckpoint checkpoint={nextCheckpoint?.kind==='all_star'?nextCheckpoint:null} leagueData={leagueData} lobbyId={lobbyId} revision={revision} isHost={isHost} onAccepted={onAccepted} disabled={rangeBusy}/>}
    {!!games.length&&nextCheckpoint?.kind==='extension_deadline'&&<OnlineVeteranExtensionCheckpoint checkpoint={nextCheckpoint} lobbyId={lobbyId} revision={revision} isHost={isHost} onAccepted={onAccepted} disabled={rangeBusy}/>}
    {!!games.length&&isHost&&<OnlineSimulationBatchPanel leagueData={leagueData} lobbyId={lobbyId} revision={revision} onAccepted={onAccepted} disabled={hasPartiallyCompletedDay} onRunningChange={setRangeBusy}/>}
    <div className="bmOnlineSeasonToolbar"><div className="bmOnlineSeasonTabs" role="group" aria-label="Schedule team filter"><button type="button" className={teamFilter==='mine'?'active':''} onClick={()=>setTeamFilter('mine')}>My Team</button><button type="button" className={teamFilter==='all'?'active':''} onClick={()=>setTeamFilter('all')}>Entire NBA</button></div>
      {months.length>0&&<label>Month <select aria-label="Schedule month" value={monthFilter} onChange={e=>setMonthFilter(e.target.value)}><option value="all">All Months</option>{months.map(m=><option key={m} value={m}>{new Date(`${m}-01T12:00:00Z`).toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'})}</option>)}</select></label>}</div>
    {!games.length?<section className="bmOnlineSeasonEmpty" role="status"><div className="bmOnlineSeasonEmptyMark">NBA</div><h2>Preparing the shared NBA schedule</h2><p>The league creates one authoritative calendar automatically. Every GM sees the same dates, matchups and results after the server commits it.</p>
      {isHost&&calendarSetup?.error?<p className="bmOnlineSeasonActionError" role="alert">{calendarSetup.error} <button type="button" onClick={retryCalendarSetup}>Retry setup</button></p>:<span>{isHost?(calendarSetup?.pending?'Setting up the schedule…':'Waiting for the trusted simulation server…'):'Waiting for the host’s automatic season setup. No action required.'}</span>}
    </section>:
      !filtered.length?<section className="bmOnlineSeasonEmpty"><h2>No games match these filters</h2><p>Choose another team or month filter to see scheduled games.</p></section>:
      <div className="bmOnlineSeasonScroll" role="region" aria-label="Online NBA schedule">{groups.map(([date,rows])=><section key={date} className="bmOnlineSeasonDate"><h2>{formatGameDate(date)} <span>{rows.length} game{rows.length===1?'':'s'}</span></h2><div className="bmOnlineSeasonGameList">{rows.map((g,i)=><div className="bmOnlineSeasonGame" key={`${g.date}-${g.id}-${i}`}><div className="bmOnlineSeasonMatchup"><div>{logos.get(g.away)&&<img alt="" src={logos.get(g.away)}/>}<span>{g.away}</span></div><b>AT</b><div>{logos.get(g.home)&&<img alt="" src={logos.get(g.home)}/>}<span>{g.home}</span></div></div><div className="bmOnlineSeasonResult">{g.played?<><strong>{g.awayScore} – {g.homeScore}</strong><small>FINAL</small>{leagueData?.onlineResults?.[g.id]?.box&&<button type="button" className="bmOnlineSeasonBoxLink" onClick={()=>setBoxGame(String(g.id))}>Box score</button>}</>:<small>SCHEDULED</small>}</div></div>)}</div></section>)}</div>}
    {boxGame&&boxResult&&<div className="bmOnlineSeasonModalScrim" role="presentation" onClick={()=>setBoxGame(null)}>
      <section className="bmOnlineSeasonBoxModal" role="dialog" aria-modal="true" aria-label="Shared game box score" onClick={e=>e.stopPropagation()}>
        <div className="bmOnlineSeasonBoxHeader"><div><small>ONLINE FRANCHISE · FINAL</small><h2>{boxResult.away} {boxResult.awayScore} — {boxResult.homeScore} {boxResult.home}</h2><p>{formatGameDate(boxResult.date)}</p></div><button type="button" aria-label="Close box score" onClick={()=>setBoxGame(null)}>✕</button></div>
        {['away','home'].map(side=><div key={side} className="bmOnlineSeasonBoxTableWrap"><h3>{boxResult[side]}</h3><table><thead><tr>{['PLAYER','MIN','PTS','REB','AST','STL','BLK','FG','3PT','FT'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{(boxResult.box?.[side]||[]).map((p,i)=><tr key={i}><td>{p.player}</td><td>{p.min}</td><td>{p.pts}</td><td>{p.reb}</td><td>{p.ast}</td><td>{p.stl}</td><td>{p.blk}</td><td>{p.fg}</td><td>{p['3p']}</td><td>{p.ft}</td></tr>)}</tbody></table></div>)}
      </section>
    </div>}
    <footer className="bmOnlineSeasonFooter">{games.length?'Results are recorded once by the trusted simulation engine and shared with every GM.':'The shared schedule is created automatically and never invented or modified by this browser.'}</footer>
  </main>;
}
