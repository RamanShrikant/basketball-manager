// Online-only trade ideas for human GMs. Evaluates salary rules by importing
// the existing single-player pure evaluator; does not write a league or make
// CPU acceptance claims. A chosen idea opens the existing server-approved room.
import React,{useMemo,useState} from 'react';
import {useNavigate,useParams} from 'react-router-dom';
import {useGame,useOnlineRouteNav} from './onlineReadOnlyContext.jsx';
import {lobbyState} from './onlineApi.js';
import {getContractSeasonYear} from '../utils/seasonContext.js';
import {getStandardPlayers,playerOverall} from '../utils/teamIntel_v1.js';
import {evaluateTradeFinancialLegality} from '../utils/tradeExecution.js';
import {countStandardRosterPlayers,getAllowedTradeRosterMax} from '../utils/rosterRules.js';
import {findHumanTradeMatches,__tradeFinderTestHelpers} from './onlineHumanTradeFinder.mjs';
import './online.css';

const allTeams=league=>Array.isArray(league?.teams)?league.teams:Object.values(league?.conferences||{}).flat().filter(Boolean);
const currency=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n||0);
const id=p=>__tradeFinderTestHelpers.stringId(p);

export default function OnlineHumanTradeFinder(){
  const {leagueData,selectedTeam,lobbyId,revision}=useGame();
  const tradeClosed=leagueData?.onlineCheckpoints?.trade_deadline?.status==='closed';
  const navigate=useOnlineRouteNav();
  const router=useNavigate();
  const {id:franchiseId}=useParams();
  const [members,setMembers]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [target,setTarget]=useState('');
  const [sendId,setSendId]=useState('');
  const teams=useMemo(()=>allTeams(leagueData),[leagueData]);
  const year=getContractSeasonYear(leagueData);
  React.useEffect(()=>{
    let active=true;
    setLoading(true);
    lobbyState(lobbyId).then(room=>{
      if(!active)return;
      const available=(room?.members||[]).filter(m=>m?.team_name&&m.team_name!==selectedTeam?.name);
      setMembers(available);
      setTarget(old=>available.some(m=>m.team_name===old)?old:available[0]?.team_name||'');
    }).catch(e=>{if(active)setError(e.message||String(e));})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[lobbyId,selectedTeam?.name]);
  const own=useMemo(()=>getStandardPlayers(selectedTeam||{}).filter(p=>
    __tradeFinderTestHelpers.valid(p,year)).sort((a,b)=>playerOverall(b)-playerOverall(a)),[selectedTeam,year]);
  const chosen=own.find(p=>id(p)===(sendId||id(own[0])))||null;
  const targetTeam=teams.find(t=>t.name===target)||null;
  const other=useMemo(()=>getStandardPlayers(targetTeam||{}).filter(p=>
    __tradeFinderTestHelpers.valid(p,year)).sort((a,b)=>playerOverall(b)-playerOverall(a)),[targetTeam,year]);
  const suggestions=useMemo(()=>findHumanTradeMatches({sending:chosen,targetPlayers:other,year,
    ownRosterCount:countStandardRosterPlayers(selectedTeam||{}),
    theirRosterCount:countStandardRosterPlayers(targetTeam||{}),
    ownRosterMax:getAllowedTradeRosterMax(selectedTeam||{}),
    theirRosterMax:getAllowedTradeRosterMax(targetTeam||{}),
    evaluateMine:(outgoingSalary,incomingSalary)=>evaluateTradeFinancialLegality({
      team:selectedTeam,leagueData,outgoingSalary,incomingSalary}),
    evaluateTheirs:(outgoingSalary,incomingSalary)=>evaluateTradeFinancialLegality({
      team:targetTeam,leagueData,outgoingSalary,incomingSalary}),
  }),[chosen,other,selectedTeam,targetTeam,year,leagueData]);
  const useIdea=idea=>{
    if(tradeClosed)return;
    // Navigation only: the destination revalidates roster ownership. The client
    // cannot approve or commit anything using these URL parameters.
    const q=new URLSearchParams({view:'/trade-proposal',finderTeam:target,
      finderSend:idea.sendId,finderReceive:idea.receiveIds.join(','),finderRevision:String(revision)});
    router(`/online/franchise/${franchiseId}?${q.toString()}`);
  };
  return <main className="bmOnlineHumanTradeRoom" data-online-human-finder="true">
    <header className="bmOnlineTradeHeading"><div><small>BASKETBALL MANAGER · ONLINE TRADE CENTER</small>
      <h1>Trade Finder</h1><p>Explore financially compatible ideas with another human GM. Same league, shared rosters, real approval.</p></div>
      <button type="button" onClick={()=>navigate('/trades')}>← Trade Center</button></header>
    <div className="bmOnlineTradeGuard">Trade Finder is a negotiation aid, not an acceptance guarantee. These ideas use the single-player salary evaluator, but the league server validates assets, roster limits, deadlines, and finances again before an offer and on acceptance. CPU trading, protections and swaps remain unavailable.</div>
    {tradeClosed&&<div role="status" className="bmOnlineTradeGuard">The trade deadline has closed. No new trade offers can be created.</div>}
    {error&&<div role="alert" className="bmOnlineTradeError">{error}</div>}
    <section className="bmOnlineTradeBuilder">
      <div className="bmOnlineTradeFinderFilters">
        <label>Trade partner <select aria-label="Human GM trade partner" disabled={loading} value={target} onChange={e=>setTarget(e.target.value)}>
          {!members.length&&<option value="">{loading?'Loading managers…':'No other human GM available'}</option>}
          {members.map(m=><option key={m.user_id} value={m.team_name}>{m.team_name}</option>)}
        </select></label>
        <label>Player to offer <select aria-label="Your player to offer" value={chosen? id(chosen):''} onChange={e=>setSendId(e.target.value)}>
          {!own.length&&<option value="">No eligible players</option>}
          {own.map(p=><option key={id(p)} value={id(p)}>{p.name} · {playerOverall(p)} OVR · {currency(__tradeFinderTestHelpers.salaryAt(p,year))}</option>)}
        </select></label>
      </div>
      <div className="bmOnlineTradeFinderCaption"><strong>{suggestions.length} salary-compatible idea{suggestions.length===1?'':'s'}</strong><span>1 player offered · 1–2 players received · no assets move until the receiving GM accepts</span></div>
      <div className="bmOnlineTradeFinderResults">
        {suggestions.map((idea,index)=><article key={idea.receiveIds.join(':')} className="bmOnlineTradeFinderResult">
          <div className="bmOnlineTradeFinderIndex">{String(index+1).padStart(2,'0')}</div>
          <div className="bmOnlineTradeFinderDetails"><strong>{chosen?.name} <span>⇄</span> {idea.receiveNames.join(' + ')}</strong>
            <small>You send {currency(idea.sendSalary)} · Receive {currency(idea.receiveSalary)} · {target}</small></div>
          <button type="button" disabled={tradeClosed} onClick={()=>useIdea(idea)}>Build offer <span aria-hidden="true">›</span></button>
        </article>)}
        {!loading&&target&&chosen&&!suggestions.length&&<div className="bmOnlineTradeFinderEmpty">No qualifying 1-for-1 or 1-for-2 salary matches. Try another player or build a custom package.</div>}
        {!target&&<div className="bmOnlineTradeFinderEmpty">Another human GM must join this league to generate trade ideas.</div>}
      </div>
      <button type="button" className="bmOnlineTradeSecondary" disabled={tradeClosed} onClick={()=>navigate('/trade-proposal')}>Build a custom player and draft-pick offer</button>
    </section>
  </main>;
}
