// Real single-player CPU trade brain, invoked by the trusted online backend.
// This screen is an ONLINE adapter, never a local-save mutation.
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {useLocation} from 'react-router-dom';
import {useGame,useOnlineRouteNav} from './onlineReadOnlyContext.jsx';
import {isSupportedOnlineCpuTradeYear} from './onlineCpuTradeYear.mjs';
import {lobbyState} from './onlineApi.js';
import {supabase} from '../auth/supabaseClient.js';
import {getStandardPlayers,playerOverall} from '../utils/teamIntel_v1.js';
import './online.css';

const teamsOf=s=>Array.isArray(s?.teams)?s.teams:[...(s?.conferences?.East||[]),...(s?.conferences?.West||[])];
const idOf=p=>String(p?.id??p?.playerId??'');
const dollar=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n||0);
const salary=(p,year)=>{
  const c=p?.contract||{};
  return Number(c.salaryByYear?.[year-Number(c.startYear??year)]||0);
};
const eligible=(p,year)=>!!(idOf(p)&&!p?.isTwoWay&&!p?.isStash&&!p?.retired&&salary(p,year)>=1200000);
const url=String(import.meta.env.VITE_BM_ONLINE_CPU_API_URL||'').replace(/\/$/,'');
function PlayerList({title,team,year,selected,onChange,disabled}){
  const players=getStandardPlayers(team||{}).filter(p=>eligible(p,year)).sort((a,b)=>playerOverall(b)-playerOverall(a));
  return <section className="bmOnlineCpuTradeRoster"><div className="bmOnlineCpuTradeRosterTitle"><strong>{title}</strong><small>{team?.name||'Select team'}</small></div>
    <div className="bmOnlineTradePlayerList">{players.map(p=>{const id=idOf(p);return <label key={id} className={`bmOnlineTradePlayer ${selected.includes(id)?'selected':''}`}>
      <input type="checkbox" checked={selected.includes(id)} disabled={disabled||(!selected.includes(id)&&selected.length>=4)}
        onChange={e=>onChange(e.target.checked?[...selected,id]:selected.filter(x=>x!==id))}/>
      <span className="bmOnlineTradePlayerName">{p.name||p.player||'Player'} <small>{p.position||p.pos||''} · {playerOverall(p)} OVR</small></span>
      <strong>{dollar(salary(p,year))}</strong>
    </label>;})}</div>
    {players.length===0&&<p className="bmOnlineTradeMuted">No eligible standard-contract players.</p>}
  </section>;
}
export default function OnlineCpuTradeRoom(){
  const {leagueData,selectedTeam,lobbyId,revision,onAccepted}=useGame();
  const tradeClosed=leagueData?.onlineCheckpoints?.trade_deadline?.status==='closed';
  const navigate=useOnlineRouteNav();
  const location=useLocation();
  const appliedFinder=useRef('');
  const teams=useMemo(()=>teamsOf(leagueData),[leagueData]);
  const year=Number(leagueData?.seasonYear??leagueData?.seasonStartYear??2026);
  const supportedCpuSeason=isSupportedOnlineCpuTradeYear(year);
  const [humanTeams,setHumanTeams]=useState([]);
  const [partner,setPartner]=useState('');
  const [send,setSend]=useState([]);
  const [receive,setReceive]=useState([]);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [outcome,setOutcome]=useState(null);
  const request=useRef(null);
  useEffect(()=>{
    let active=true;
    setLoading(true);
    lobbyState(lobbyId).then(room=>{if(active)setHumanTeams((room?.members||[]).map(m=>m.team_name).filter(Boolean));})
      .catch(e=>{if(active)setError(e?.message||'Could not check GM teams.');})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[lobbyId]);
  const cpuTeams=teams.filter(t=>t?.name&&t.name!==selectedTeam?.name&&!humanTeams.includes(t.name));
  const currentPartner=cpuTeams.some(t=>t.name===partner)?partner:cpuTeams[0]?.name||'';
  const target=cpuTeams.find(t=>t.name===currentPartner)||null;
  useEffect(()=>{
    if(loading||!location.search||appliedFinder.current===location.search)return;
    const q=new URLSearchParams(location.search);
    if(!q.has('finderRevision'))return;
    appliedFinder.current=location.search;
    const team=q.get('finderTeam')||'';
    const sendIds=(q.get('finderSend')||'').split(',').filter(Boolean);
    const receivedIds=(q.get('finderReceive')||'').split(',').filter(Boolean);
    const ownSet=new Set(getStandardPlayers(selectedTeam||{}).filter(p=>eligible(p,year)).map(idOf));
    const other=cpuTeams.find(t=>t.name===team);
    const theirSet=new Set(getStandardPlayers(other||{}).filter(p=>eligible(p,year)).map(idOf));
    if(q.get('finderRevision')!==String(revision)||!other||sendIds.length<1||sendIds.length>4||
      receivedIds.length<1||receivedIds.length>4||new Set(sendIds).size!==sendIds.length||
      new Set(receivedIds).size!==receivedIds.length||!sendIds.every(id=>ownSet.has(id))||
      !receivedIds.every(id=>theirSet.has(id))){
      setError('Finder suggestion expired or assets moved. Search again.');return;
    }
    setPartner(team);setSend(sendIds);setReceive(receivedIds);request.current=null;
    setOutcome(null);setError('');
  },[loading,location.search,revision,selectedTeam,year,humanTeams.join('|')]);
  const reset=()=>{setSend([]);setReceive([]);setOutcome(null);setError('');request.current=null;};
  const ready=!tradeClosed&&!loading&&!busy&&!!target&&!!url&&send.length>0&&receive.length>0&&supportedCpuSeason;
  const negotiate=async()=>{
    if(!ready)return;
    setBusy(true);setError('');setOutcome(null);
    const key=request.current||crypto.randomUUID();request.current=key;
    try{
      const {data,error:authError}=await supabase.auth.getSession();
      if(authError||!data?.session?.access_token)throw new Error('Sign in again before negotiating.');
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),20000);
      let response;
      try{response=await fetch(`${url}/api/online/cpu-trade`,{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},
        body:JSON.stringify({lobbyId,requestId:key,expectedRevision:Number(revision),targetTeam:currentPartner,sendingIds:send,receivingIds:receive}),
        signal:controller.signal,
      });}finally{clearTimeout(timeout);}
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||'Trade was not completed. Refresh the online league.');
      request.current=null;
      setOutcome(result);
      if(result.committed||result.replayed){reset();setOutcome(result);await onAccepted?.();}
    }catch(e){setError(e.name==='AbortError'?'Request timed out. The result may be unknown. Retry the same offer or refresh the shared league.':e.message||String(e));}
    finally{setBusy(false);}
  };
  useEffect(()=>{request.current=null;setOutcome(null);setError('');},[revision]);
  return <main className="bmOnlineHumanTradeRoom bmOnlineCpuTradeRoom" data-online-cpu-trades="true">
    <header className="bmOnlineTradeHeading"><div><small>BASKETBALL MANAGER · ONLINE TRADE CENTER</small><h1>CPU Negotiations</h1>
      <p>The same Python CPU trade evaluator used by single-player, with final authorization through the shared league server.</p></div>
      <div className="bmOnlineCpuFinderActions"><button type="button" onClick={()=>navigate('/cpu-trade-finder')}>Find CPU offers</button>
      <button type="button" onClick={()=>navigate('/trades')}>← Trade Center</button></div></header>
    <div className="bmOnlineTradeGuard">Standard-contract player trades only · Supported seasons: 2026–27 through 2028–29 · 1–4 players per side. CPU pick-inclusive trades and swaps remain locked. Trade Finder suggestions are provisional; CPU acceptance never bypasses salary, roster or deadline restrictions.</div>
    {!url&&<div className="bmOnlineTradeError" role="alert">CPU trading service is not configured. Set VITE_BM_ONLINE_CPU_API_URL and deploy the trusted backend before using this screen.</div>}
    {tradeClosed&&<div className="bmOnlineTradeGuard" role="status">Trading is closed for this season. You can review past trades in the Trade Center.</div>}
    {error&&<div className="bmOnlineTradeError" role="alert">{error}</div>}
    {outcome&&<div className={outcome.committed||outcome.replayed?'bmOnlineTradeSuccess':'bmOnlineTradeGuard'} role="status">
      <strong>{outcome.committed||outcome.replayed?'Trade completed':outcome.decision==='counter'?'Counteroffer requested':'CPU declined'}</strong> · {outcome.message||'Check the shared league.'}
      {Array.isArray(outcome.counterSuggestions)&&outcome.counterSuggestions.map((c,i)=><p key={i}>{c.message}</p>)}
    </div>}
    <section className="bmOnlineTradeBuilder">
      <div className="bmOnlineTradeTarget"><label htmlFor="bm-online-cpu-team">Negotiate with CPU team</label>
        <select id="bm-online-cpu-team" disabled={busy||loading} value={currentPartner} onChange={e=>{setPartner(e.target.value);reset();}}>
          {cpuTeams.length===0&&<option value="">{loading?'Checking league teams…':'No CPU teams available'}</option>}
          {cpuTeams.map(t=><option key={t.name} value={t.name}>{t.name}</option>)}
        </select></div>
      <div className="bmOnlineTradeColumns">
        <PlayerList title="You send" team={selectedTeam} year={year} selected={send} onChange={ids=>{setSend(ids);request.current=null;setOutcome(null);}} disabled={busy}/>
        <PlayerList title="CPU sends" team={target} year={year} selected={receive} onChange={ids=>{setReceive(ids);request.current=null;setOutcome(null);}} disabled={busy}/>
      </div>
      <div className="bmOnlineCpuTradeFooter"><div><strong>{send.length} for {receive.length} players</strong><small>CPU decisions are generated from the authoritative current roster. All moves are committed atomically or not at all.</small></div>
        <button type="button" className="bmOnlineCpuTradeSubmit" onClick={negotiate} disabled={!ready}>{busy?'Negotiating…':'Submit to CPU'}</button></div>
      {!supportedCpuSeason&&<p className="bmOnlineTradeMuted">CPU trading is currently supported only through the 2028–29 season. The server independently validates rollover, payroll, phase and deadline rules.</p>}
    </section>
  </main>;
}
