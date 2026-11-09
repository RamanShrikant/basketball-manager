// PHASE 2B4B: read-only list from the saved Online franchise seed.
// Never import the single-player FreeAgents.jsx (it mutates game and browser saves).
import React, {useMemo,useState,useEffect,useRef} from 'react';
import {signOnlineCapRoomFreeAgent} from './onlineRuntimeClient.js';
import {useGame} from './onlineReadOnlyContext.jsx';
import PlayerPortraitFrame from '../components/PlayerPortraitFrame';
import PlayerRatingRing from '../components/PlayerRatingRing.jsx';
import '../styles/BMAnimations.css';

const overall=p=>Number(p?.overall??p?.ovr??0)||0;
const potential=p=>Number(p?.potential??p?.pot??0)||0;
const position=p=>String(p?.pos||p?.position||'—');
const salary=p=>Number(p?.marketValue??p?.askingSalary??p?.salary??p?.contract?.salary??0)||0;
const money=n=>n>0?'$'+(n/1e6).toFixed(1)+'M':'—';
const key=p=>String(p?.id??p?.playerId??p?.name??'');
const freeAgents=league=>Array.isArray(league?.freeAgents)?league.freeAgents:[];

export default function OnlineFreeAgencyPreview(){
  const {leagueData,selectedTeam,revision,lobbyId,onAccepted}=useGame();
  const [offerSalary,setOfferSalary]=useState(1200000);
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState("");
  const [signError,setSignError]=useState("");
  const retry=useRef(null);
  const [filter,setFilter]=useState('All');
  const [query,setQuery]=useState('');
  const [sort,setSort]=useState('overall');
  const [direction,setDirection]=useState(-1);
  const [selectedKey,setSelectedKey]=useState(null);
  const rows=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return freeAgents(leagueData).filter(p=>p?.name&&(!q||p.name.toLowerCase().includes(q))&&(filter==='All'||position(p).split(/\s*\/\s*/).includes(filter))).sort((a,b)=>{
      const av=sort==='age'?Number(a.age??0):sort==='potential'?potential(a):sort==='salary'?salary(a):overall(a);
      const bv=sort==='age'?Number(b.age??0):sort==='potential'?potential(b):sort==='salary'?salary(b):overall(b);
      return direction*(av-bv)||a.name.localeCompare(b.name);
    });
  },[leagueData,filter,query,sort,direction]);
  const player=rows.find(p=>key(p)===selectedKey)||rows[0];
  const total=freeAgents(leagueData).length;
  const rosterSlots=Array.isArray(selectedTeam?.players) ? selectedTeam.players.filter(p=>!p?.isTwoWay&&!p?.isStash&&!/two[-_]way|stash|draft_rights/i.test(String(p?.rosterStatus||p?.contractType||''))).length : 15;
  const stableId=player?.id ?? player?.playerId;
  const canTrySigning=!!(player && stableId!==undefined && stableId!==null && lobbyId && revision && !busy && rosterSlots<15);
  useEffect(()=>{
    const suggested=salary(player);
    setOfferSalary(Math.min(57800000,Math.max(1200000,Math.round((suggested||1200000)/1000)*1000)));
    retry.current=null;setResult('');setSignError('');
  },[stableId]);
  async function signSelected(){
    if(!canTrySigning)return;
    const amount=Number(offerSalary);
    if(!Number.isSafeInteger(amount)||amount<1200000||amount>57800000){setSignError('Enter a supported one-year salary between $1.2M and $57.8M.');return;}
    const identity=String(stableId);
    if(!window.confirm(`Offer ${player.name} a one-year cap-room-only contract worth ${money(amount)} for ${selectedTeam.name}? This is a real change to the shared Online franchise.`))return;
    setBusy(true);setSignError('');setResult('');
    const attempt=retry.current&&retry.current.playerId===identity&&retry.current.salary===amount&&retry.current.revision===revision
      ?retry.current :{requestId:crypto.randomUUID(),playerId:identity,salary:amount,revision};
    retry.current=attempt;
    try{
      const result=await signOnlineCapRoomFreeAgent({lobbyId,requestId:attempt.requestId,expectedRevision:attempt.revision,playerId:identity,salary:amount});
      retry.current=null;
      setResult(`${player.name} signed with ${selectedTeam.name}. League revision ${result.revision}.`);
      setSelectedKey(null);
      if(onAccepted)await onAccepted();
    }catch(error){
      setSignError(`${error.message||String(error)} Refresh shared state to review the current market.`);
      if(onAccepted)await onAccepted();
    }finally{setBusy(false);}
  }
  const changeSort=next=>{if(sort===next)setDirection(d=>-d);else{setSort(next);setDirection(-1);}};
  return <div className="bmOnlinePreviewPage bmOnlineFreeAgencyPreview" data-online-preview="free-agency">
    <header className="bmOnlineFreeTitle"><h1>Free Agents</h1><span>Shared NBA universe · Cap-room signing beta</span></header>
    <div className="bmOnlinePreviewSub">Free agents are sourced from this Online franchise only. One-year cap-room signings are enabled when eligible. NBA exceptions, restricted free agency, multiyear offers and day advancement remain locked.</div>
    <div className="bmOnlineFreeStats"><span><small>FREE AGENTS</small><b>{total}</b></span><span><small>MY TEAM</small><b>{selectedTeam?.name||'—'}</b></span><span><small>STANDARD ROSTER</small><b>{rosterSlots}/15</b></span></div>
    {total===0?<section className="bmOnlinePreviewEmpty"><h2>No free agents in the current Online market</h2><p>Signing will be available after a server-authorized market is populated. The game will not invent free agents or read players from a single-player save.</p></section>:<>
      <section className="bmOnlineFreeHero">{player&&<>
        <div className="bmOnlineFreeHeroPlayer"><PlayerPortraitFrame src={player.headshot} player={player} teamName="Free Agents" alt={player.name} className="bmOnlineCoachPortrait"/><div><h2>{player.name}</h2><p>{position(player)} &nbsp;|&nbsp; Age {player.age??'—'}</p><span>Estimated salary: {money(salary(player))}</span></div></div>
        <PlayerRatingRing overall={overall(player)} size={80} showPotential={false}/>
      </>}</section>
      <div className="bmOnlineFreeFilters"><input aria-label="Search free agents" placeholder="Search free agents..." value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Filter position" value={filter} onChange={e=>setFilter(e.target.value)}>{['All','PG','SG','SF','PF','C'].map(p=><option key={p}>{p}</option>)}</select></div>
      <div className="bmOnlineFreeTable" role="region" aria-label="Shared free agency market"><table><thead><tr><th>PLAYER</th><th>POS</th><th onClick={()=>changeSort('age')}>AGE</th><th onClick={()=>changeSort('overall')}>OVR</th><th onClick={()=>changeSort('potential')}>POT</th><th onClick={()=>changeSort('salary')}>EST. SALARY</th><th>STATUS</th></tr></thead><tbody>{rows.map(p=><tr key={key(p)} className={player&&key(p)===key(player)?'bmOnlineCoachSelected':''} onClick={()=>setSelectedKey(key(p))}><td>{p.name}</td><td>{position(p)}</td><td>{p.age??'—'}</td><td>{overall(p)}</td><td>{potential(p)||'—'}</td><td>{money(salary(p))}</td><td>Available</td></tr>)}</tbody></table></div>
    </>}
    <footer className="bmOnlinePreviewFooter" style={{display:'flex',flexWrap:'wrap',gap:10,alignItems:'center'}}>
      <span>One-year CAP ROOM only · 15 standard players maximum · Exceptions unavailable</span>
      {player&&<label style={{display:'flex',alignItems:'center',gap:6}}>Annual salary ($)
        <input aria-label="One-year signing salary in dollars" style={{width:165}} type="number" min="1200000" max="57800000" step="1000" disabled={busy}
          value={offerSalary} onChange={e=>{setOfferSalary(Number(e.target.value));retry.current=null;}}/>
      </label>}
      <button type="button" disabled={!canTrySigning} onClick={signSelected}>{busy?'Submitting…':rosterSlots>=15?'Roster full — signing locked':'Sign one-year free agent'}</button>
      {signError&&<span role="alert" style={{color:'#ff9999'}}>{signError}</span>}
      {result&&<span role="status" style={{color:'#9fe4b5'}}>{result}</span>}
    </footer>
  </div>;
}
