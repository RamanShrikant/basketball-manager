// Online-only GM-to-GM trade offer/approval. Trade Center remains the original
// single-player visual reference, but this page NEVER writes a local league save.
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useLocation} from 'react-router-dom';
import {useGame,useOnlineRouteNav} from './onlineReadOnlyContext.jsx';
import {lobbyState} from './onlineApi.js';
import {listOnlineHumanTradeOffers,offerOnlineHumanAssetTrade,respondOnlineHumanTrade,subscribeOnlineTradeOffers} from './onlineRuntimeClient.js';
import {inspectPendingOnlineTradeOffer} from './onlineTradeOfferSafety.mjs';
import {getContractSeasonYear} from '../utils/seasonContext.js';
import {getStandardPlayers,playerOverall} from '../utils/teamIntel_v1.js';
import {countStandardRosterPlayers,getAllowedTradeRosterMax} from '../utils/rosterRules.js';
import {evaluateTradeFinancialLegality} from '../utils/tradeExecution.js';
import {normalizeDraftPicks,isProtectedDraftPickAsset} from '../utils/draftPicks.js';
import {classifyOnlineExistingPickRight} from './onlineExistingPickRights.mjs';
import {makeOnlineProtectionToken,canOnlineAddPickProtection} from './onlineCustomPickProtections.mjs';
import {parseOnlineTradePickToken,makeOnlineSwapToken,canOnlineCreateSwapPair} from './onlinePickSwapCommands.mjs';
import './online.css';

const allTeams=league=>Array.isArray(league?.teams)?league.teams:
  Object.values(league?.conferences||{}).flat().filter(Boolean);
const pid=p=>String(p?.id??p?.playerId??'');
const dollar=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n||0);
const name=p=>p?.name||p?.player||'Player';
const playerSalary=(p,year)=>{
  const c=p?.contract||{};
  if(!Array.isArray(c.salaryByYear)||!c.salaryByYear.length)return 0;
  const index=year-Number(c.startYear??year);
  return index>=0&&index<c.salaryByYear.length?Number(c.salaryByYear[index])||0:0;
};
const eligible=p=>Boolean(pid(p)&&!p?.isTwoWay&&!p?.isStash&&!p?.retired&&
  Array.isArray(p?.contract?.salaryByYear)&&p.contract.salaryByYear.length);

function PlayerSelection({team,selected,onChange,year,label}) {
  const players=useMemo(()=>getStandardPlayers(team||{}).filter(eligible)
    .sort((a,b)=>playerOverall(b)-playerOverall(a)),[team]);
  return <section className="bmOnlineTradeSide">
    <h3>{label} <small>{team?.name||'Select team'}</small></h3>
    <p>Choose up to four standard-contract players.</p>
    <div className="bmOnlineTradePlayerList">
      {players.map(p=>{
        const id=pid(p),checked=selected.includes(id);
        return <label key={id} className={`bmOnlineTradePlayer ${checked?'selected':''}`}>
          <input type="checkbox" checked={checked} disabled={!checked&&selected.length>=4}
            onChange={e=>onChange(e.target.checked?[...selected,id]:selected.filter(x=>x!==id))}/>
          <span className="bmOnlineTradePlayerName">{name(p)} <small>{p?.pos||p?.position||''} · {playerOverall(p)} OVR</small></span>
          <strong>{dollar(playerSalary(p,year))}</strong>
        </label>;
      })}
      {!players.length&&<p className="bmOnlineTradeMuted">No eligible players with stable IDs and contract data.</p>}
    </div>
  </section>;
}

function PickSelection({team,leagueData,selected,onChange,label}) {
  // Keep restricted rights visible. Existing protected and numbered-slice
  // entitlements can now transfer, subject to a locked SQL recheck.
  // A custom protection splits a full unprotected first into numbered ranges;
  // SQL must independently validate the command and create both rights.
  const picks=useMemo(()=>{
    const rows=normalizeDraftPicks(leagueData?.draftPicks||[],allTeams(leagueData).map(t=>t.name));
    const owned=rows.filter(p=>p.id&&p.ownerTeam===team?.name);
    return owned.map(p=>{
      const reason=classifyOnlineExistingPickRight(p,rows,leagueData);
      return {...p,lockedReason:reason};
    }).sort((a,b)=>Number(a.year)-Number(b.year)||Number(a.round)-Number(b.round));
  },[team,leagueData]);
  const available=picks.filter(p=>!p.lockedReason);
  return <section className="bmOnlineTradeSide">
    <h3>{label} <small>{team?.name||'Select team'}</small></h3>
    <p>{available.length} eligible pick{available.length===1?'':'s'} · Top-N protections, existing rights, and paired clean first-round swaps supported. Conditional rollover remains locked.</p>
    <div className="bmOnlineTradePlayerList">
      {picks.map(p=>{
        const id=String(p.id),active=selected.find(token=>parseOnlineTradePickToken(token)?.id===id);
        const checked=Boolean(active),locked=Boolean(p.lockedReason);
        const parsed=active?parseOnlineTradePickToken(active):null;
        const canProtect=!locked && canOnlineAddPickProtection(p,rows,leagueData) && id.length<=108 && !parsed?.swapDirection;
        return <div key={id} title={p.lockedReason||'Eligible draft right — final ownership and protections validated by server'} className={`bmOnlineTradePlayer ${checked?'selected':''} ${locked?'bmOnlinePickLocked':''}`}>
          <label className="bmOnlinePickToggle">
            <input type="checkbox" checked={checked} disabled={locked||(!checked&&selected.length>=3)}
              onChange={e=>{if(!locked)onChange(e.target.checked?[...selected,id]:selected.filter(x=>parseOnlineTradePickToken(x)?.id!==id));}}/>
            <span className="bmOnlineTradePlayerName">{p.year} {Number(p.round)===1?'1st':'2nd'} <small>{p.originalTeam||'Original pick'} · {p.lockedReason||(isProtectedDraftPickAsset(p)?(p.displayProtection||p.protections||'Existing protected right'):'Unprotected right')}</small></span>
          </label>
          {checked&&canProtect&&<select className="bmOnlinePickProtectionSelect" value={parsed?.topN??'none'}
            aria-label={`Protection for ${p.year} ${p.originalTeam} first-round pick`}
            onChange={e=>{const token=makeOnlineProtectionToken(id,e.target.value);
              if(token)onChange([...selected.filter(x=>parseOnlineTradePickToken(x)?.id!==id),token]);}}>
            <option value="none">Unprotected</option>
            {Array.from({length:29},(_,i)=>i+1).map(n=><option key={n} value={n}>Top {n}</option>)}
          </select>}
        </div>;
      })}
      {!picks.length&&<p className="bmOnlineTradeMuted">No draft ownership rights are listed for this team.</p>}
    </div>
  </section>;
}

export default function OnlineHumanTradeRoom(){
  const {leagueData,selectedTeam,revision,lobbyId,onAccepted}=useGame();
  const tradeClosed=leagueData?.onlineCheckpoints?.trade_deadline?.status==='closed';
  const navigate=useOnlineRouteNav();
  const location=useLocation();
  const filledIdeaRef=useRef(null);
  const [room,setRoom]=useState(null);
  const [offers,setOffers]=useState([]);
  const [target,setTarget]=useState('');
  const [send,setSend]=useState([]);
  const [receive,setReceive]=useState([]);
  const [sendingPicks,setSendingPicks]=useState([]);
  const [receivingPicks,setReceivingPicks]=useState([]);
  const [busy,setBusy]=useState(false);
  const [confirmOfferId,setConfirmOfferId]=useState(null);
  const [offerFilter,setOfferFilter]=useState('pending');
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [loading,setLoading]=useState(true);
  const [inboxConnection,setInboxConnection]=useState('connecting');
  const refreshGeneration=useRef(0);
  const requestRef=useRef(null);
  const responseRequestRef=useRef(new Map());
  const teams=useMemo(()=>allTeams(leagueData),[leagueData]);
  const otherGms=useMemo(()=>room?.members?.filter(m=>m?.team_name&&m.team_name!==selectedTeam?.name)||[],[room,selectedTeam]);
  // Trade Finder prefill is only a UI suggestion. Never trust query strings as
  // league assets: verify current ownership and human-GM team assignment.
  useEffect(()=>{
    const params=new URLSearchParams(location.search);
    const team=params.get('finderTeam');
    const sending=params.get('finderSend');
    const incoming=params.get('finderReceive');
    const sourceRevision=params.get('finderRevision');
    if(!team||!sending||!incoming||!otherGms.length||!selectedTeam)return;
    const token=`${team}|${sending}|${incoming}|${sourceRevision}`;
    if(filledIdeaRef.current===token)return;
    filledIdeaRef.current=token;
    const opponent=teams.find(t=>t.name===team);
    const sendingExists=getStandardPlayers(selectedTeam).some(p=>pid(p)===sending);
    const incomingIds=incoming.split(',').filter(Boolean);
    const theirIds=new Set(getStandardPlayers(opponent||{}).map(pid));
    if(sourceRevision!==String(revision)||!otherGms.some(m=>m.team_name===team)||
      !sendingExists||incomingIds.length<1||incomingIds.length>4||
      new Set(incomingIds).size!==incomingIds.length||incomingIds.some(id=>!theirIds.has(id))) {
      setError('That trade idea is no longer current. Refresh the Trade Finder or select players manually.');
      return;
    }
    setTarget(team);setSend([sending]);setReceive(incomingIds);
    setSendingPicks([]);setReceivingPicks([]);requestRef.current=null;
    setMessage('Trade Finder idea loaded. Review the package before requesting GM approval.');
  },[location.search,otherGms,teams,selectedTeam,revision]);
  const targetTeam=teams.find(t=>t.name===target);
  const selectedSwap=parseOnlineTradePickToken(sendingPicks[0]||'')?.swapDirection||null;
  const eligibleSwapPair=useMemo(()=>{
    if(sendingPicks.length!==1||receivingPicks.length!==1)return false;
    const a=parseOnlineTradePickToken(sendingPicks[0]);
    const b=parseOnlineTradePickToken(receivingPicks[0]);
    if(!a||!b||b.topN!==null||b.swapDirection||a.topN!==null)return false;
    const all=Array.isArray(leagueData?.draftPicks)?leagueData.draftPicks:[];
    return canOnlineCreateSwapPair(all.find(p=>String(p.id)===a.id),all.find(p=>String(p.id)===b.id),all,leagueData);
  },[sendingPicks,receivingPicks,leagueData]);
  const year=getContractSeasonYear(leagueData);
  const sum=(team,ids)=>getStandardPlayers(team||{}).filter(p=>ids.includes(pid(p))).reduce((s,p)=>s+playerSalary(p,year),0);
  const sentSalary=sum(selectedTeam,send),receivedSalary=sum(targetTeam,receive);
  const projectedMine=countStandardRosterPlayers(selectedTeam||{})-send.length+receive.length;
  const projectedOther=countStandardRosterPlayers(targetTeam||{})-receive.length+send.length;
  const rosterValid=projectedMine<=getAllowedTradeRosterMax(selectedTeam||{})&&
    projectedOther<=getAllowedTradeRosterMax(targetTeam||{});
  // Reuse the FINISHED single-player salary evaluator for the preview.
  // The RPC applies the corresponding checks again to its locked league JSON;
  // the browser cannot authorize or mutate a trade.
  const mineFinancial=useMemo(()=>evaluateTradeFinancialLegality({
    team:selectedTeam,leagueData,outgoingSalary:sentSalary,incomingSalary:receivedSalary,
  }),[selectedTeam,leagueData,sentSalary,receivedSalary]);
  const otherFinancial=useMemo(()=>evaluateTradeFinancialLegality({
    team:targetTeam,leagueData,outgoingSalary:receivedSalary,incomingSalary:sentSalary,
  }),[targetTeam,leagueData,sentSalary,receivedSalary]);
  const salaryValid=send.length>0&&receive.length>0&&sentSalary>0&&receivedSalary>0&&
    rosterValid&&mineFinancial.ok&&otherFinancial.ok;
  const refresh=useCallback(async()=>{
    const generation=++refreshGeneration.current;
    const [r,o]=await Promise.all([lobbyState(lobbyId),listOnlineHumanTradeOffers(lobbyId)]);
    // A slow earlier response must never erase a later update/revision.
    if(generation!==refreshGeneration.current)return;
    setRoom(r);setOffers(o);
  },[lobbyId]);
  useEffect(()=>{
    let live=true;
    refresh().catch(e=>{if(live)setError(e.message||String(e));})
      .finally(()=>{if(live)setLoading(false);});
    const timer=setInterval(()=>{if(live)void refresh().catch(()=>{});},8000);
    // Trade offers are not league revisions: listen to the offer table, while
    // retaining polling for browsers with blocked/suspended Realtime sockets.
    const unsubscribe=subscribeOnlineTradeOffers(lobbyId,
      ()=>{if(live)void refresh().catch(()=>{});},
      status=>{if(live)setInboxConnection(status==='SUBSCRIBED'?'live':'polling');});
    const recover=()=>{if(live && (!document.hidden || navigator.onLine))void refresh().catch(()=>{});};
    window.addEventListener('online',recover);
    document.addEventListener('visibilitychange',recover);
    return()=>{live=false;refreshGeneration.current++;clearInterval(timer);
      unsubscribe();window.removeEventListener('online',recover);
      document.removeEventListener('visibilitychange',recover);};
  },[refresh]);
  useEffect(()=>{if(!loading && !otherGms.some(m=>m.team_name===target)){
    const intendedTeam=new URLSearchParams(location.search).get('finderTeam');
    // The finder prefill effect runs in the same commit as this sync effect.
    // Never clear its selection before React commits the new target value.
    if(intendedTeam && otherGms.some(m=>m.team_name===intendedTeam))return;
    setTarget(otherGms[0]?.team_name||'');setSend([]);setReceive([]);setSendingPicks([]);setReceivingPicks([]);
  }},[otherGms,target,loading,location.search]);
  const create=async()=>{
    if(busy||tradeClosed||!salaryValid||(selectedSwap&&!eligibleSwapPair))return;
    setBusy(true);setError('');setMessage('');
    const request=requestRef.current||crypto.randomUUID();requestRef.current=request;
    try{
      await offerOnlineHumanAssetTrade({lobbyId,requestId:request,expectedRevision:revision,
        targetTeam:target,sendingIds:send,receivingIds:receive,sendingPickIds:sendingPicks,receivingPickIds:receivingPicks});
      requestRef.current=null;
      setMessage('Trade offer sent. The other human GM must accept before either roster changes.');
      setSend([]);setReceive([]);setSendingPicks([]);setReceivingPicks([]);
      await refresh();
    }catch(e){setError(e.message||String(e));}
    finally{setBusy(false);}
  };
  const respond=async(offer,decision)=>{
    if(busy||(tradeClosed&&decision==='accept'))return;
    setBusy(true);setError('');setMessage('');
    const responseKey=`${offer.id}:${decision}`;
    const responseId=responseRequestRef.current.get(responseKey)||crypto.randomUUID();
    responseRequestRef.current.set(responseKey,responseId);
    try{
      await respondOnlineHumanTrade({lobbyId,offerId:offer.id,requestId:responseId,
        expectedRevision:revision,decision});
      responseRequestRef.current.delete(responseKey);
      setConfirmOfferId(null);
      setMessage(decision==='accept'?'Trade completed! Shared rosters and history have been updated.':
        decision==='decline'?'Trade declined.':'Trade offer cancelled.');
      if(decision==='accept')await onAccepted?.();
      await refresh();
    }catch(e){setError(e.message||String(e));}
    finally{setBusy(false);}
  };
  const playerLabel=(team,id)=>name(getStandardPlayers(teams.find(t=>t.name===team)||{}).find(p=>pid(p)===id)||{name:`Player ${id}`});
  const relevant=offers.filter(o=>o.proposer_team===selectedTeam?.name||o.recipient_team===selectedTeam?.name);
  const displayedOffers=relevant.filter(o=>offerFilter==='all'||(offerFilter==='pending'?o.status==='pending':o.status!=='pending'));
  const offerChecks=useMemo(()=>new Map(relevant.map(o=>[o.id,inspectPendingOnlineTradeOffer(o,leagueData)])),[relevant,leagueData]);
  return <main className="bmOnlineHumanTradeRoom" data-online-trade-room="true">
    <header className="bmOnlineTradeHeading">
      <div><small>BASKETBALL MANAGER · ONLINE TRADE CENTER</small><h1>GM Trade Proposals</h1>
        <p>Offer standard-roster players and optional draft picks, with custom first-round protections or paired swap rights. The receiving GM must approve the full package.</p></div>
      <div className="bmOnlineTradeHeadingActions"><button type="button" onClick={()=>navigate('/trade-finder')}>Trade Finder</button><button type="button" onClick={()=>navigate('/trades')}>← Trade Center</button></div>
    </header>
    <div className="bmOnlineTradeGuard">Online salary matching now uses the existing single-player cap-room and apron calculations, with the server making the final decision for both teams. Standard players (1–4 per side) and eligible rights (up to 3 per side). Top-N protections and paired clean first-round swaps are validated atomically. Conditional rollover remains locked.</div>
    {tradeClosed&&<div role="status" className="bmOnlineTradeGuard">Trade deadline finalized. New offers and acceptances are closed for the season; past transactions remain in history.</div>}
    {error&&<div role="alert" className="bmOnlineTradeError">{error}</div>}
    {message&&<div role="status" className="bmOnlineTradeSuccess">{message}</div>}
    <section className="bmOnlineTradeBuilder">
      <div className="bmOnlineTradeTarget"><label htmlFor="online-human-trade-team">Trade with human GM</label>
        <select id="online-human-trade-team" value={target} disabled={busy}
          onChange={e=>{setTarget(e.target.value);setSend([]);setReceive([]);setSendingPicks([]);setReceivingPicks([]);requestRef.current=null;}}>
          {otherGms.length===0&&<option value="">No other human GMs in this league</option>}
          {otherGms.map(m=><option key={m.user_id} value={m.team_name}>{m.team_name}</option>)}
        </select></div>
      <div className="bmOnlineTradeColumns">
        <PlayerSelection label="You send" team={selectedTeam} selected={send} year={year}
          onChange={ids=>{setSend(ids);requestRef.current=null;}}/>
        <PlayerSelection label="They send" team={targetTeam} selected={receive} year={year}
          onChange={ids=>{setReceive(ids);requestRef.current=null;}}/>
      </div>
      <div className="bmOnlineTradeColumns">
        <PickSelection label="Your draft picks" team={selectedTeam} leagueData={leagueData} selected={sendingPicks}
          onChange={ids=>{setSendingPicks(ids);requestRef.current=null;}}/>
        <PickSelection label="Their draft picks" team={targetTeam} leagueData={leagueData} selected={receivingPicks}
          onChange={ids=>{setReceivingPicks(ids);setSendingPicks(prev=>prev.map(token=>parseOnlineTradePickToken(token)?.swapDirection?parseOnlineTradePickToken(token).id:token));requestRef.current=null;}}/>
      </div>
      {sendingPicks.length===1&&receivingPicks.length===1&&<div className="bmOnlineSwapOptions">
        <label htmlFor="bm-online-swap-direction">Draft-pick arrangement</label>
        <select id="bm-online-swap-direction" value={selectedSwap||'trade'} disabled={busy||(!eligibleSwapPair&&!selectedSwap)}
          onChange={e=>{
            const parsed=parseOnlineTradePickToken(sendingPicks[0]);if(!parsed)return;
            const token=e.target.value==='trade'?parsed.id:makeOnlineSwapToken(parsed.id,e.target.value);
            if(token){setSendingPicks([token]);requestRef.current=null;}
          }}>
          <option value="trade">Trade the picks outright</option>
          {eligibleSwapPair&&<><option value="best">Swap: other GM receives the better pick</option>
            <option value="worst">Swap: other GM receives the worse pick</option></>}
        </select>
        {selectedSwap&&<p role="status">Both original picks become paired Swap Best / Swap Worst rights. The GM receiving the {selectedSwap==='best'?'better':'worse'} pick must approve. This does not immediately exchange a pick.</p>}
        {!eligibleSwapPair&&<p className="bmOnlineTradeMuted">A swap needs two clean, different, unprotected first-round picks in the same supported draft year.</p>}
      </div>}
      <div className="bmOnlineTradeTotals"><span>You send: <b>{dollar(sentSalary)}</b></span><span>You receive: <b>{dollar(receivedSalary)}</b></span>
        <strong className={salaryValid?'valid':''}>{salaryValid?'Salary matching preview: valid for both teams':!rosterValid?'Trade exceeds the temporary 16-player (or current +1) roster limit':send.length===0||receive.length===0?'Select players for both teams':!mineFinancial.ok?`Your team: ${mineFinancial.message}`:!otherFinancial.ok?`${targetTeam?.name||'Other team'}: ${otherFinancial.message}`:'Trade validation pending'}</strong></div>
      <button type="button" className="bmOnlineTradePrimary" disabled={busy||tradeClosed||!salaryValid||!target||(selectedSwap&&!eligibleSwapPair)}
        onClick={create}>{busy?'Processing…':'Send trade offer for GM approval'}</button>
    </section>
    <section className="bmOnlineTradeOffers"><div className="bmOnlineTradeOffersTitle"><h2>Human GM Trade Inbox</h2>
      <div className="bmOnlineTradeInboxControls"><span className="bmOnlineTradeConnection" aria-live="polite">
        <i className={inboxConnection==='live'?'live':''} aria-hidden="true"/>
        {inboxConnection==='live'?'Live offers':'Auto-refresh every 8s'}
      </span><button type="button" disabled={busy} onClick={()=>void refresh().catch(e=>setError(e.message||String(e)))}>↻ Refresh offers</button></div></div>
      <div className="bmOnlineTradeInboxFilters" aria-label="Trade offer filter">
        {[['pending','Pending'],['resolved','History'],['all','All']].map(([key,label])=>
          <button key={key} type="button" aria-pressed={offerFilter===key}
            className={offerFilter===key?'active':''} onClick={()=>{setOfferFilter(key);setConfirmOfferId(null);}}>
            {label}{key==='pending'?` (${relevant.filter(o=>o.status==='pending').length})`:''}
          </button>)}
      </div>
      {loading?<p>Loading proposals…</p>:displayedOffers.length===0?<p className="bmOnlineTradeMuted">No {offerFilter==='pending'?'pending':offerFilter==='resolved'?'resolved':''} offers in this view.</p>:
        displayedOffers.map(o=><article className="bmOnlineTradeOffer" key={o.id}>
          <div className="bmOnlineTradeOfferHeader"><b>{o.proposer_team} ↔ {o.recipient_team}</b><span>{o.status.toUpperCase()}</span></div>
          {o.status==='pending'&&!offerChecks.get(o.id)?.current&&<p className="bmOnlineTradeStaleNote" role="status">
            <strong>Needs review</strong> · {offerChecks.get(o.id)?.reason} The league server will not accept invalid assets.
          </p>}
          <p>{o.proposer_team} sends: {(o.proposer_player_labels?.length?o.proposer_player_labels:o.proposer_player_ids.map(id=>playerLabel(o.proposer_team,id))).join(', ')}</p>
          {!!o.proposer_pick_ids?.length&&<p>{o.proposer_team} sends picks: {(o.proposer_pick_labels?.length?o.proposer_pick_labels:o.proposer_pick_ids).join(', ')}</p>}
          <p>{o.recipient_team} sends: {(o.recipient_player_labels?.length?o.recipient_player_labels:o.recipient_player_ids.map(id=>playerLabel(o.recipient_team,id))).join(', ')}</p>
          {!!o.recipient_pick_ids?.length&&<p>{o.recipient_team} sends picks: {(o.recipient_pick_labels?.length?o.recipient_pick_labels:o.recipient_pick_ids).join(', ')}</p>}
          {o.status==='pending'&&<div className="bmOnlineTradeOfferActions">
            {o.recipient_team===selectedTeam?.name&&<><button disabled={busy||tradeClosed||!offerChecks.get(o.id)?.current} title={!offerChecks.get(o.id)?.current?'This offer is no longer valid in the current shared league':undefined} onClick={()=>setConfirmOfferId(o.id)}>Review & accept</button>
              <button disabled={busy} onClick={()=>respond(o,'decline')}>Decline</button></>}
            {o.proposer_team===selectedTeam?.name&&<button disabled={busy} onClick={()=>respond(o,'cancel')}>Cancel offer</button>}
          </div>}
          {o.status==='pending'&&offerChecks.get(o.id)?.current&&confirmOfferId===o.id&&o.recipient_team===selectedTeam?.name&&
            <div className="bmOnlineTradeConfirm" role="group" aria-label="Confirm proposed trade">
              <strong>Confirm roster and pick transfer?</strong>
              <p>The league server will recheck both teams, the latest revision, and every asset before any change is committed. This approval cannot be undone.</p>
              <div><button type="button" disabled={busy||tradeClosed||!offerChecks.get(o.id)?.current} onClick={()=>respond(o,'accept')}>{busy?'Validating…':'Confirm trade'}</button>
                <button type="button" disabled={busy} onClick={()=>setConfirmOfferId(null)}>Go back</button></div>
            </div>}
        </article>)}
    </section>
  </main>;
}
