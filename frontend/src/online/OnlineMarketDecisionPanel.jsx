import React,{useMemo,useRef,useState} from 'react';
import {onlineOffseasonMarketAction} from './onlineFreeAgencyMarketClient.js';

// Existing Free Agents page: one slim multiplayer action panel, not a new screen.
const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(v||0));
export default function OnlineMarketDecisionPanel({leagueData,lobbyId,revision,selectedTeam,isHost,onAccepted}){
 const stage=leagueData?.onlineOffseasonMarket||{};
 const market=leagueData?.freeAgencyState||{};
 const team=typeof selectedTeam==='string'?selectedTeam:selectedTeam?.name;
 const [busy,setBusy]=useState('');const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const retry=useRef(null);
 const mine=useMemo(()=>[
  ...(market.pendingUserDecisions||[]).filter(x=>x?.teamName===team).map(x=>({...x,kind:'signing'})),
  ...(market.pendingRfaMatchDecisions||[]).filter(x=>x?.rightsTeamName===team).map(x=>({...x,kind:'rfa'}))
 ],[market.pendingUserDecisions,market.pendingRfaMatchDecisions,team]);
 if(stage.status!=='active'&&stage.status!=='complete')return null;
 const total=(market.pendingUserDecisions||[]).length+(market.pendingRfaMatchDecisions||[]).length;
 const action=async(mode,fields={},confirmation='')=>{
  if(busy||!lobbyId||!Number.isSafeInteger(Number(revision)))return;
  if(confirmation&&!window.confirm(confirmation))return;
  const marker=JSON.stringify([mode,fields,lobbyId,revision]);
  const attempt=retry.current?.marker===marker?retry.current:{marker,requestId:crypto.randomUUID()};
  retry.current=attempt;setBusy(marker);setError('');setNotice('');
  try{
   const result=await onlineOffseasonMarketAction(mode,{lobbyId,expectedRevision:Number(revision),
      requestId:attempt.requestId,...fields});
   retry.current=null;
   setNotice(result.replayed?'Already confirmed by the league.':
     result.phase==='complete'?'Offseason free agency is complete.':
     mode==='decision'?'Decision saved to the shared league.':
     `Market day updated. ${result.newSignings??0} player signings recorded.`);
   await onAccepted?.();
  }catch(e){setError(`${e.message||e} Refresh the shared league before retrying.`);
    try{await onAccepted?.();}catch{/* preserve the real backend error */}
  }finally{setBusy('');}
 };
 const disabled=Boolean(busy)||!lobbyId;
 const day=Number(stage.day||market.currentDay||1);
 return <div className="w-full max-w-7xl mb-3 rounded-xl border border-white/10 bg-neutral-900/90 p-3 text-white shadow-lg" data-online-market-resolution>
   <div className="flex flex-wrap items-center justify-between gap-2">
    <div className="min-w-0">
     <div className="text-[11px] font-bold uppercase tracking-widest text-orange-300">Offseason market · {stage.status==='complete'?'Complete':`Day ${day} of 10`}</div>
     <div className="text-sm text-neutral-300">{stage.status==='complete'?'Contracts have been recorded across the league.':
       total?`${total} manager decision${total===1?'':'s'} awaiting approval. The host cannot skip them.`:
       stage.phase==='needs_next'||stage.phase==='needs_finish'?'All decisions are settled. Host may continue.':
       'Offers are live. The host controls the next daily resolution.'}</div>
    </div>
    {stage.status==='active'&&isHost&&<div className="flex flex-wrap gap-2">
      {stage.phase==='offers'&&<button type="button" disabled={disabled} onClick={()=>action('resolve',{},`Resolve market day ${day} using the official player decision engine?`)}
        className="rounded-lg border border-orange-400/40 bg-orange-600 px-3 py-2 text-xs font-semibold hover:bg-orange-500 disabled:opacity-40">{busy?'Processing…':`Resolve day ${day}`}</button>}
      {['needs_next','needs_finish'].includes(stage.phase)&&<button type="button" disabled={disabled} onClick={()=>action('next',{},day>=10?'Finalize the 10-day free-agent market?':'Continue to the next free-agent bidding day?')}
        className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold hover:bg-orange-500 disabled:opacity-40">{busy?'Processing…':day>=10?'Finalize market':'Continue next day'}</button>}
    </div>}
   </div>
   {mine.length>0&&<div className="mt-3 space-y-2 border-t border-white/10 pt-3">
    <div className="text-xs font-semibold text-neutral-200">Your decisions ({mine.length})</div>
    {mine.map(row=><div key={`${row.kind}:${row.playerKey}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2">
     <div className="min-w-0">
      <div className="text-sm font-semibold">{row.playerName||'Free agent'} <span className="ml-1 text-[10px] font-normal uppercase tracking-wide text-orange-300">{row.kind==='rfa'?'RFA offer sheet':'Player accepted your offer'}</span></div>
      <div className="text-xs text-neutral-400">{row.kind==='rfa'?`Offer from ${row.offeringTeamName||'another team'}`:`Offer to ${team}`} · {money(row.currentYearSalary)} first year · {row.years||1} year{row.years===1?'':'s'}</div>
     </div>
     <div className="flex flex-wrap gap-2">
      <button type="button" disabled={disabled} onClick={()=>action('decision',{kind:row.kind,playerKey:row.playerKey,choice:row.kind==='rfa'?'match':'accept'},
        row.kind==='rfa'?`Match the offer sheet for ${row.playerName}?`:`Accept the confirmed signing of ${row.playerName}?`)}
       className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold hover:bg-emerald-500 disabled:opacity-40">{row.kind==='rfa'?'Match':'Accept signing'}</button>
      <button type="button" disabled={disabled} onClick={()=>action('decision',{kind:row.kind,playerKey:row.playerKey,choice:'decline'},
        row.kind==='rfa'?`Decline matching ${row.playerName}’s offer sheet?`:`Decline signing ${row.playerName}?`)}
       className="rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold hover:bg-white/10 disabled:opacity-40">Decline</button>
     </div>
    </div>)}
   </div>}
   {error&&<p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
   {notice&&<p role="status" className="mt-2 text-xs text-emerald-300">{notice}</p>}
 </div>;
}
