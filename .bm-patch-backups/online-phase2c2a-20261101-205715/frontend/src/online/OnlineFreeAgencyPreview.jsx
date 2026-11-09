// PHASE 2B4B: read-only list from the saved Online franchise seed.
// Never import the single-player FreeAgents.jsx (it mutates game and browser saves).
import React, {useMemo,useState} from 'react';
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
  const {leagueData,selectedTeam}=useGame();
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
  const changeSort=next=>{if(sort===next)setDirection(d=>-d);else{setSort(next);setDirection(-1);}};
  return <div className="bmOnlinePreviewPage bmOnlineFreeAgencyPreview" data-online-preview="free-agency">
    <header className="bmOnlineFreeTitle"><h1>Free Agents</h1><span>Shared NBA universe · Read-only market</span></header>
    <div className="bmOnlinePreviewSub">Free agents are sourced from this Online franchise only. Offers, signings, cap holds and day advancement aren't enabled yet.</div>
    <div className="bmOnlineFreeStats"><span><small>FREE AGENTS</small><b>{total}</b></span><span><small>MY TEAM</small><b>{selectedTeam?.name||'—'}</b></span><span><small>OFFERS</small><b>Locked</b></span></div>
    {total===0?<section className="bmOnlinePreviewEmpty"><h2>No free agents in the starting league snapshot</h2><p>This league currently contains no available free agents. Online offseason generation and the live market will be added with authoritative league management.</p></section>:<>
      <section className="bmOnlineFreeHero">{player&&<>
        <div className="bmOnlineFreeHeroPlayer"><PlayerPortraitFrame src={player.headshot} player={player} teamName="Free Agents" alt={player.name} className="bmOnlineCoachPortrait"/><div><h2>{player.name}</h2><p>{position(player)} &nbsp;|&nbsp; Age {player.age??'—'}</p><span>Estimated salary: {money(salary(player))}</span></div></div>
        <PlayerRatingRing overall={overall(player)} size={80} showPotential={false}/>
      </>}</section>
      <div className="bmOnlineFreeFilters"><input aria-label="Search free agents" placeholder="Search free agents..." value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Filter position" value={filter} onChange={e=>setFilter(e.target.value)}>{['All','PG','SG','SF','PF','C'].map(p=><option key={p}>{p}</option>)}</select></div>
      <div className="bmOnlineFreeTable" role="region" aria-label="Shared free agency market"><table><thead><tr><th>PLAYER</th><th>POS</th><th onClick={()=>changeSort('age')}>AGE</th><th onClick={()=>changeSort('overall')}>OVR</th><th onClick={()=>changeSort('potential')}>POT</th><th onClick={()=>changeSort('salary')}>EST. SALARY</th><th>STATUS</th></tr></thead><tbody>{rows.map(p=><tr key={key(p)} className={player&&key(p)===key(player)?'bmOnlineCoachSelected':''} onClick={()=>setSelectedKey(key(p))}><td>{p.name}</td><td>{position(p)}</td><td>{p.age??'—'}</td><td>{overall(p)}</td><td>{potential(p)||'—'}</td><td>{money(salary(p))}</td><td>Available</td></tr>)}</tbody></table></div>
    </>}
    <footer className="bmOnlinePreviewFooter"><span>Read-only preview — all contracts and player movement remain unchanged.</span><button type="button" disabled>Make Offer · Coming Soon</button></footer>
  </div>;
}
