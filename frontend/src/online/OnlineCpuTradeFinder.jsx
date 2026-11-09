import {trustedOnlineApiBase} from './onlineCalendarBootstrap.js';
// Uses the exact single-player Python Trade Finder on the trusted backend.
// Search ideas are NOT accepted trades: the proposal screen reruns CPU evaluation
// and a separate Supabase RPC makes the authoritative final decision.
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {useNavigate,useParams} from 'react-router-dom';
import {useGame,useOnlineRouteNav} from './onlineReadOnlyContext.jsx';
import {isSupportedOnlineCpuTradeYear} from './onlineCpuTradeYear.mjs';
import {supabase} from '../auth/supabaseClient.js';
import {lobbyState} from './onlineApi.js';
import {getStandardPlayers,playerOverall} from '../utils/teamIntel_v1.js';
import './online.css';

const idOf=p=>String(p?.id??p?.playerId??'');
const salary=(p,year)=>Number(p?.contract?.salaryByYear?.[year-Number(p?.contract?.startYear??year)]||0);
const eligible=(p,year)=>!!(idOf(p)&&!p?.isTwoWay&&!p?.isStash&&!p?.retired&&salary(p,year)>=1200000);
const cash=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n||0);
const url=trustedOnlineApiBase();
const teamsOf=s=>Array.isArray(s?.teams)?s.teams:[...(s?.conferences?.East||[]),...(s?.conferences?.West||[])];

export default function OnlineCpuTradeFinder(){
  const {leagueData,selectedTeam,lobbyId,revision}=useGame();
  const tradeClosed=leagueData?.onlineCheckpoints?.trade_deadline?.status==='closed';
  const navigate=useOnlineRouteNav();
  const router=useNavigate();
  const {id:franchiseId}=useParams();
  const year=Number(leagueData?.seasonYear??leagueData?.seasonStartYear??2026);
  const supportedCpuSeason=isSupportedOnlineCpuTradeYear(year);
  const players=useMemo(()=>getStandardPlayers(selectedTeam||{}).filter(p=>eligible(p,year))
    .sort((a,b)=>playerOverall(b)-playerOverall(a)),[selectedTeam,year]);
  const [selected,setSelected]=useState([]);
  const [partner,setPartner]=useState('');
  const [humanTeams,setHumanTeams]=useState([]);
  const [loadingTeams,setLoadingTeams]=useState(true);
  const [busy,setBusy]=useState(false);
  const [results,setResults]=useState(null);
  const [error,setError]=useState('');
  const active=useRef(null);
  const all=useMemo(()=>teamsOf(leagueData),[leagueData]);
  const cpuTeams=all.filter(t=>t?.name!==selectedTeam?.name&&!humanTeams.includes(t.name));
  useEffect(()=>{
    let live=true;setLoadingTeams(true);
    lobbyState(lobbyId).then(room=>{if(live)setHumanTeams((room?.members||[]).map(m=>m.team_name).filter(Boolean));})
      .catch(e=>{if(live)setError(e.message||'Unable to identify CPU teams.');})
      .finally(()=>{if(live)setLoadingTeams(false);});
    return()=>{live=false;};
  },[lobbyId]);
  // Any selection, team, league or revision change invalidates the displayed results.
  useEffect(()=>{active.current?.abort();setResults(null);setError('');},[selected.join('|'),partner,revision,lobbyId]);
  useEffect(()=>()=>active.current?.abort(),[]);
  const ready=!tradeClosed&&!loadingTeams&&!busy&&url&&supportedCpuSeason&&selected.length>0&&cpuTeams.length>0;
  const search=async()=>{
    if(!ready)return;
    active.current?.abort();const controller=new AbortController();active.current=controller;
    setBusy(true);setError('');setResults(null);
    const timeout=setTimeout(()=>controller.abort(),18000);
    try{
      const {data,error:authError}=await supabase.auth.getSession();
      if(authError||!data?.session?.access_token)throw Error('Sign in again to search trades.');
      const response=await fetch(`${url}/api/online/cpu-trade-finder`,{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},
        body:JSON.stringify({lobbyId,expectedRevision:Number(revision),sendingIds:selected,targetTeam:partner}),
        signal:controller.signal
      });
      const value=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(value.error||'Search unavailable. Refresh your league.');
      if(controller.signal.aborted)return;
      setResults(value);
    }catch(e){if(!controller.signal.aborted)setError(e?.message||'CPU Trade Finder failed.');
      else setError('Search stopped or timed out. No trade was executed.');}
    finally{clearTimeout(timeout);if(active.current===controller){active.current=null;setBusy(false);}}
  };
  const openOffer=offer=>{
    if(String(results?.revision)!==String(revision) || !cpuTeams.some(t=>t.name===offer.teamName)){
      setResults(null);setError('League or GM ownership changed. Search again.');return;
    }
    const params=new URLSearchParams({view:'/cpu-trades',finderTeam:offer.teamName,
      finderSend:selected.join(','),finderReceive:offer.receivingIds.join(','),finderRevision:String(revision)});
    router(`/online/franchise/${franchiseId}?${params.toString()}`);
  };
  return <main className="bmOnlineHumanTradeRoom bmOnlineCpuFinder" data-online-cpu-finder="true">
    <header className="bmOnlineTradeHeading"><div><small>BASKETBALL MANAGER · ONLINE TRADE CENTER</small>
      <h1>CPU Trade Finder</h1><p>Your original single-player trade intelligence, searching the shared league.</p></div>
      <button type="button" onClick={()=>navigate('/trades')}>← Trade Center</button></header>
    <div className="bmOnlineTradeGuard">CPU suggestions are provisional, not guaranteed offers. The negotiation screen reruns the CPU decision against current shared rosters; Supabase validates every asset and financial rule before a trade commits. CPU Trade Finder proposes standard-player trades only; draft picks and swaps are not part of CPU negotiations.</div>
    {!url&&<p className="bmOnlineTradeError" role="alert">Trusted CPU backend not configured. Set VITE_BM_ONLINE_CPU_API_URL before searching.</p>}
    {tradeClosed&&<p className="bmOnlineTradeGuard" role="status">Trading is closed for this season. CPU trade suggestions are unavailable.</p>}
    {error&&<p className="bmOnlineTradeError" role="alert">{error}</p>}
    <section className="bmOnlineTradeBuilder">
      <div className="bmOnlineTradeFinderFilters"><label>CPU teams
        <select value={partner} disabled={busy||loadingTeams} onChange={e=>setPartner(e.target.value)} aria-label="Search CPU teams">
          <option value="">All available CPU teams</option>
          {cpuTeams.map(t=><option key={t.name} value={t.name}>{t.name}</option>)}
        </select></label><div className="bmOnlineCpuFinderIntro"><strong>{selected.length}/4 players offered</strong><small>Choose up to four of your eligible players below.</small></div></div>
      <div className="bmOnlineCpuFinderGrid">{players.map(p=>{
        const id=idOf(p),checked=selected.includes(id);
        return <label key={id} className={`bmOnlineTradePlayer ${checked?'selected':''}`}>
          <input type="checkbox" checked={checked} disabled={busy||(!checked&&selected.length>=4)}
            onChange={e=>setSelected(old=>e.target.checked?[...old,id]:old.filter(x=>x!==id))}/>
          <span className="bmOnlineTradePlayerName">{p.name||p.player||'Player'} <small>{p.position||p.pos||''} · {playerOverall(p)} OVR</small></span>
          <strong>{cash(salary(p,year))}</strong>
        </label>;})}</div>
      <div className="bmOnlineCpuTradeFooter"><div><strong>Search for interested CPU teams</strong>
        <small>The server evaluates authentic CPU trade scores without modifying any roster.</small></div>
        <button type="button" className="bmOnlineCpuTradeSubmit" disabled={!ready} onClick={search}>{busy?'Searching…':'Find CPU offers'}</button></div>
      {!supportedCpuSeason&&<p className="bmOnlineTradeMuted">CPU trading is currently supported only through the 2028–29 season. The server also verifies the active season, financial rules and trade deadline.</p>}
    </section>
    {results&&<section className="bmOnlineTradeBuilder" aria-live="polite">
      <div className="bmOnlineTradeFinderCaption"><strong>{results.offers.length} CPU suggestion{results.offers.length===1?'':'s'}</strong>
        <span>{results.teamsChecked} CPU teams evaluated · League revision {results.revision}</span></div>
      <div className="bmOnlineTradeFinderResults">{results.offers.map((offer,index)=><article className="bmOnlineTradeFinderResult" key={`${offer.teamName}:${offer.receivingIds.join('-')}`}>
        <div className="bmOnlineTradeFinderIndex">{String(index+1).padStart(2,'0')}</div>
        <div className="bmOnlineTradeFinderDetails"><strong>{offer.teamName}</strong>
          <small>Receive {offer.receivingPlayers.map(p=>p.name).join(' + ')} · {offer.receivingPlayers.map(p=>cash(p.salary)).join(' + ')}</small>
          <small>CPU interest based on original trade AI · Subject to fresh salary and eligibility checks</small></div>
        <button type="button" onClick={()=>openOffer(offer)} disabled={busy}>Build offer <span aria-hidden="true">›</span></button>
      </article>)}
      {!results.offers.length&&<div className="bmOnlineTradeFinderEmpty">No CPU-acceptable player offers found for this package. Try another player or team. No changes were made.</div>}
      </div>
    </section>}
  </main>;
}
