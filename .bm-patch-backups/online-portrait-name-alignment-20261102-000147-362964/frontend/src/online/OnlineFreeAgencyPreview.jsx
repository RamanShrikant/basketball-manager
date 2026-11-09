// Online Free Agency, exact presentation skeleton from src/pages/FreeAgents.jsx.
// Only the data source and server-authorized one-year signing action are Online-specific.
// Never mount the single-player GameProvider, local-storage-based FreeAgents component,
// or its IndexedDB persistence helpers inside an Online franchise.
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {createPlayerResolver} from '../utils/playerResolver.js';
import {signOnlineCapRoomFreeAgent} from './onlineRuntimeClient.js';
import {useGame} from './onlineReadOnlyContext.jsx';
import OnlinePlayerQuickView from './OnlinePlayerQuickView.jsx';
import PlayerPortraitFrame from '../components/PlayerPortraitFrame.jsx';
import PlayerRatingRing from '../components/PlayerRatingRing.jsx';
import PageFade from '../components/PageFade.jsx';
import styles from '../pages/FreeAgents.module.css';
import '../styles/BMAnimations.css';

const MIN_SALARY = 1_200_000;
const MAX_SALARY = 57_800_000;
const ATTR_COLUMNS = [
  {key:'attr0',label:'3PT',index:0},{key:'attr1',label:'MID',index:1},
  {key:'attr2',label:'CLOSE',index:2},{key:'attr3',label:'FT',index:3},
  {key:'attr4',label:'BALL',index:4},{key:'attr5',label:'PASS',index:5},
  {key:'attr8',label:'PER D',index:8},{key:'attr9',label:'INS D',index:9},
  {key:'attr10',label:'BLK',index:10},{key:'attr11',label:'STL',index:11},
  {key:'attr12',label:'REB',index:12},{key:'attr7',label:'ATH',index:7},
  {key:'attr13',label:'OIQ',index:13},{key:'attr14',label:'DIQ',index:14},
];
const POSITION_ORDER = ['PG','SG','SF','PF','C'];
const finite = (v, fallback=0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const identity = p => String(p?.id ?? p?.playerId ?? `name:${p?.name||''}`);
const serverId = p => p?.id ?? p?.playerId;
const overall = p => finite(p?.overall ?? p?.ovr);
const potential = p => finite(p?.potential ?? p?.pot);
const portrait = p => p?.headshot || p?.portrait || p?.image || p?.photo || p?.img || p?.face || '';
const pos = p => p?.pos || p?.position || '-';
const rights = p => p?.rights && typeof p.rights==='object' ? p.rights : {};
const isRfa = p => Boolean(rights(p).restrictedFreeAgent || p?.qualifyingOffer?.amount);
const askingSalary = p => {
  const mv = p?.marketValue;
  const candidates = [mv?.contractExpectedYear1Salary,mv?.expectedYear1Salary,mv?.contractExpectedAAV,mv?.expectedAAV,
    mv?.contractMinAcceptableAAV,mv?.minAcceptableAAV,p?.askingSalary,p?.salary];
  return candidates.map(v=>Number(v)).find(v=>Number.isFinite(v)&&v>0)||0;
};
const formatDollars = amount => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(amount||0));
const formatShort = amount => amount>0?(amount/1_000_000).toFixed(1).replace(/\.0$/,''):'-';
const showRating = (v, letters) => {
  if(!letters)return v ?? '-';
  const n=Number(v);
  if(!Number.isFinite(n))return '-';
  for(const [limit,letter] of [[94,'A+'],[87,'A'],[80,'A-'],[77,'B+'],[73,'B'],[70,'B-'],[67,'C+'],[63,'C'],[60,'C-'],[57,'D+'],[53,'D'],[50,'D-']]){
    if(n>=limit)return letter;
  }
  return 'F';
};

export default function OnlineFreeAgencyPreview(){
  const {leagueData,selectedTeam,revision,lobbyId,onAccepted}=useGame();
  const [sortConfig,setSortConfig]=useState({key:'overall',direction:'desc'});
  const [showLetters,setShowLetters]=useState(false); // Deliberately not the single-player localStorage setting.
  const [selectedKey,setSelectedKey]=useState('');
  const [playerCardPlayer,setPlayerCardPlayer]=useState(null);
  const [signTarget,setSignTarget]=useState(null);
  const [offerSalaryText,setOfferSalaryText]=useState('1.2');
  const [busy,setBusy]=useState(false);
  const [signError,setSignError]=useState('');
  const [result,setResult]=useState('');
  const retry=useRef(null);

  const freeAgents=useMemo(()=>{
    const resolve=createPlayerResolver(leagueData||{});
    return (Array.isArray(leagueData?.freeAgents)?leagueData.freeAgents:[]).map(resolve).filter(Boolean);
  },[leagueData]);
  const rosterCount=Array.isArray(selectedTeam?.players)
    ? selectedTeam.players.filter(p=>!p?.isTwoWay&&!p?.isStash&&!/two[-_]way|stash|draft_rights/i.test(String(p?.rosterStatus||p?.contractType||''))).length
    : 15;
  const maxRosterSize=Number(leagueData?.rosterLimit||leagueData?.maxRosterSize||15);
  const affordable=p=>{
    if(rosterCount>=maxRosterSize)return {label:'NO',tone:'red',sortValue:0,title:'Your roster is full. Release space before signing.'};
    if(isRfa(p))return {label:'RFA',tone:'orange',sortValue:2,title:'Restricted free agent offer sheets are not supported by the Online one-year signing beta.'};
    if(serverId(p)==null)return {label:'NO',tone:'red',sortValue:0,title:'Player has no stable server ID.'};
    return {label:'CHECK',tone:'neutral',sortValue:10,title:'Cap room and eligibility are validated by the Online server when you submit.'};
  };
  const sortedPlayers=useMemo(()=>{
    const copy=[...freeAgents];
    const {key,direction}=sortConfig;
    if(direction==='default')return copy;
    copy.sort((a,b)=>{
      const multiplier=direction==='asc'?1:-1;
      if(key==='name')return multiplier*String(a.name||'').localeCompare(String(b.name||''));
      if(key==='pos')return multiplier*(POSITION_ORDER.indexOf(pos(a))-POSITION_ORDER.indexOf(pos(b)));
      if(key==='rfa')return multiplier*(Number(isRfa(a))-Number(isRfa(b)));
      if(key==='affordable')return multiplier*(affordable(a).sortValue-affordable(b).sortValue);
      if(key==='expectedSalary')return multiplier*(askingSalary(a)-askingSalary(b));
      if(key.startsWith('attr')){
        const i=Number(key.slice(4));return multiplier*(finite(a.attrs?.[i])-finite(b.attrs?.[i]));
      }
      const value=p=>key==='overall'?overall(p):key==='potential'?potential(p):finite(p?.[key]);
      return multiplier*(value(a)-value(b));
    });
    return copy;
  },[freeAgents,sortConfig,rosterCount,maxRosterSize]);
  const player=sortedPlayers.find(p=>identity(p)===selectedKey)||sortedPlayers[0]||null;
  const target=signTarget&&freeAgents.find(p=>identity(p)===identity(signTarget));
  const salaryAmount=Math.round(Number(offerSalaryText)*1_000_000);
  const salaryValid=Number.isSafeInteger(salaryAmount)&&salaryAmount>=MIN_SALARY&&salaryAmount<=MAX_SALARY;
  const eligible=Boolean(target&&serverId(target)!=null&&lobbyId&&Number.isInteger(Number(revision))&&rosterCount<maxRosterSize&&!isRfa(target));

  useEffect(()=>{
    if(!signTarget)return;
    if(!target){setSignTarget(null);retry.current=null;}
  },[freeAgents,signTarget,target]);
  const handleSort=key=>setSortConfig(current=>({key,direction:current.key===key?(current.direction==='desc'?'asc':current.direction==='asc'?'default':'desc'):'desc'}));
  const openSignModal=p=>{
    setSignTarget(p);
    const estimated=askingSalary(p);
    const dollars=Math.min(MAX_SALARY,Math.max(MIN_SALARY,Math.round((estimated||MIN_SALARY)/1000)*1000));
    setOfferSalaryText((dollars/1_000_000).toFixed(3).replace(/\.?0+$/,''));
    retry.current=null;
    setSignError('');setResult('');
  };
  const closeSignModal=()=>{if(busy)return;setSignTarget(null);setSignError('');};
  const changeSalary=value=>{setOfferSalaryText(value);retry.current=null;setSignError('');};
  const submitSigning=async()=>{
    if(busy||!eligible||!salaryValid)return;
    const id=String(serverId(target));
    const team=selectedTeam?.name||'';
    const amount=salaryAmount;
    const name=target.name;
    if(!window.confirm(`Offer ${name} a one-year cap-room-only contract worth ${formatDollars(amount)} for ${team}? This will change the shared Online franchise.`))return;
    const attempt=retry.current&&retry.current.playerId===id&&retry.current.salary===amount&&retry.current.revision===revision
      ?retry.current:{requestId:crypto.randomUUID(),playerId:id,salary:amount,revision};
    retry.current=attempt;
    setBusy(true);setSignError('');setResult('');
    try{
      const answer=await signOnlineCapRoomFreeAgent({lobbyId,requestId:attempt.requestId,expectedRevision:attempt.revision,playerId:id,salary:amount});
      retry.current=null;
      setSignTarget(null);
      setSelectedKey('');
      setResult(`${name} signed with ${team}. League revision ${answer.revision}.`);
      if(onAccepted)await onAccepted();
    }catch(error){
      setSignError(`${error?.message||String(error)} Refresh shared state to confirm the current market.`);
      if(onAccepted){try{await onAccepted();}catch{/* Preserve the original signing error. */}}
    }finally{setBusy(false);}
  };
  return <PageFade>
    <div className={`${styles.freeAgentsPage} ${styles.viewportShell} bmOnlineFaRoot h-full min-h-0 overflow-hidden text-white flex flex-col items-center px-4 py-3`} data-online-preview="free-agency">
      {/* Original single-player heading and layout, not the custom Online FA header/stats/filter/footer. */}
      <div className="w-full max-w-7xl flex shrink-0 items-center justify-center mb-2 select-none">
        <h1 className="text-3xl font-extrabold text-orange-500 text-center leading-none">Free Agents</h1>
      </div>
      {result&&<div role="status" className="w-full max-w-7xl mb-1 text-xs font-semibold text-emerald-300">{result}</div>}
      {!player?<div className="w-full max-w-7xl flex-1 grid place-items-center text-gray-300">No free agents available in this Online franchise.</div>:<>
        <div className="w-full flex justify-center">
          <div className="relative bg-neutral-800/95 backdrop-blur-md border border-neutral-700 w-full max-w-7xl px-5 pt-3 pb-1 rounded-t-xl shadow-2xl">
            <div className="pointer-events-none absolute left-0 right-0 bottom-0 z-20 h-[3px] bg-white opacity-60"/>
            <div className="flex items-end justify-between relative">
              <div className="flex items-end gap-6">
                <PlayerPortraitFrame src={portrait(player)} player={player} teamName="Free Agent" alt={player.name||'Free agent'} className="h-[100px] w-[142px]" fallback={<div className="flex h-full w-full items-center justify-center rounded-t-lg bg-neutral-700 text-neutral-300">No Image</div>}/>
                <div className="flex flex-col justify-end mb-3">
                  <h2 className="text-[26px] font-bold leading-tight">{player.name||'-'}</h2>
                  <p className="text-gray-400 text-[16px] mt-0.5">{pos(player)}{player.secondaryPos?` / ${player.secondaryPos}`:''} • Age {player.age??'-'}</p>
                  <p className="text-gray-500 text-[13px] mt-0.5">Unsigned Free Agent</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={()=>openSignModal(player)} disabled={!selectedTeam||!player.name} className="px-5 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold transition">Offer Contract</button>
                    <button type="button" onClick={()=>setPlayerCardPlayer(player)} className="px-5 py-2 bg-white/[0.06] hover:bg-orange-500/15 border border-white/10 hover:border-orange-400/40 rounded-lg font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed">Player Card</button>
                  </div>
                </div>
              </div>
              <PlayerRatingRing overall={overall(player)} potential={potential(player)} size="sm" className="mr-3 mb-1" ariaLabel={`${player.name||'Free agent'} overall and potential`}/>
            </div>
          </div>
        </div>
        <div className="w-full flex flex-1 min-h-0 justify-center transition-opacity duration-300 ease-in-out mt-[-1px]">
          <div className={`${styles.tableViewport} bmTableScroller w-full max-w-7xl min-h-0 overflow-auto rounded-b-xl border border-neutral-700 border-t-0 bg-neutral-900`}>
            <div className="min-w-[1400px] w-max">
              <table className="w-full border-collapse text-center">
                <thead className="sticky top-0 z-20 bg-neutral-800 text-gray-300 text-[13px] font-semibold"><tr>
                  {[{key:'name',label:'Name'},{key:'pos',label:'POS'},{key:'rfa',label:'RFA'},
                    {key:'affordable',label:'AFFORD'},{key:'expectedSalary',label:'EXP'},
                    {key:'age',label:'AGE'},{key:'overall',label:'OVR'},
                    {key:'stamina',label:'STAM'},{key:'potential',label:'POT'},...ATTR_COLUMNS].map(col=><th key={col.key} className={`py-2 px-3 min-w-[88px] ${col.key==='name'?'min-w-[210px] text-left pl-4':'text-center'} cursor-pointer select-none`} onClick={e=>{e.stopPropagation();handleSort(col.key);}}>
                      {col.label}{sortConfig.key===col.key&&<span className="ml-1 text-orange-400">{sortConfig.direction==='asc'?'▲':sortConfig.direction==='desc'?'▼':''}</span>}
                    </th>)}
                </tr></thead>
                <tbody className="text-[14px] font-medium">{sortedPlayers.map((p,idx)=>{
                  const afford=affordable(p);
                  return <tr key={`${identity(p)}-${idx}`} onClick={()=>setSelectedKey(identity(p))} className={`cursor-pointer transition ${identity(player)===identity(p)?'bg-orange-600 text-white':'hover:bg-neutral-800'}`}>
                    <td className="py-2 px-3 whitespace-nowrap text-left pl-4" onDoubleClick={e=>{e.stopPropagation();openSignModal(p);}} title="Double click to offer contract"><button type="button" onClick={e=>{e.stopPropagation();setSelectedKey(identity(p));setPlayerCardPlayer(p);}} className="text-left font-bold underline-offset-4 hover:text-orange-200 hover:underline" title="Open player card">{p.name}</button></td>
                    <td className="py-2 px-3">{pos(p)}</td>
                    <td className="py-2 px-3">{isRfa(p)?<span className="inline-flex px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-xs font-bold uppercase">Yes</span>:<span className="inline-flex px-2 py-0.5 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-300 text-xs font-bold uppercase">No</span>}</td>
                    <td className="py-2 px-3"><span title={afford.title} className={`inline-flex px-2 py-0.5 rounded-full border text-xs font-bold uppercase whitespace-nowrap ${afford.tone==='red'?'bg-red-500/15 border-red-500/30 text-red-200':afford.tone==='orange'?'bg-orange-500/15 border-orange-500/30 text-orange-200':'bg-neutral-800 border-neutral-700 text-neutral-300'}`}>{afford.label}</span></td>
                    <td className="py-2 px-3 text-emerald-200 font-bold whitespace-nowrap" title={askingSalary(p)>0?`Expected first-year salary: ${formatDollars(askingSalary(p))}`:'No reliable estimated salary in shared data'}>{formatShort(askingSalary(p))}</td>
                    <td className="py-2 px-3">{p.age??'-'}</td>
                    <td className="py-2 px-3" onDoubleClick={()=>setShowLetters(v=>!v)}>{showRating(overall(p),showLetters)}</td>
                    <td className="py-2 px-3" onDoubleClick={()=>setShowLetters(v=>!v)}>{showRating(p.stamina,showLetters)}</td>
                    <td className="py-2 px-3" onDoubleClick={()=>setShowLetters(v=>!v)}>{showRating(potential(p),showLetters)}</td>
                    {ATTR_COLUMNS.map(a=><td key={a.key} className="py-2 px-3" onDoubleClick={()=>setShowLetters(v=>!v)}>{p.attrs?.[a.index]==null?'-':showRating(p.attrs[a.index],showLetters)}</td>)}
                  </tr>;
                })}</tbody>
              </table>
            </div>
          </div>
        </div>
      </>}
      <OnlinePlayerQuickView open={!!playerCardPlayer} player={playerCardPlayer} teamName="Free Agent" onClose={()=>setPlayerCardPlayer(null)}/>
      {target&&createPortal(<div className="fixed inset-0 bg-black/70 flex items-center justify-center overflow-hidden z-[9999] px-3 py-3" onClick={closeSignModal} role="presentation">
        <div className="w-full max-w-[96rem] bg-neutral-800 rounded-2xl border border-neutral-700 shadow-2xl p-4 text-white" onClick={e=>e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Offer Contract">
          <h2 className="text-lg font-bold text-orange-400 mb-0.5">Offer Contract</h2>
          <p className="text-white text-sm mb-0.5">{target.name}</p>
          <p className="text-gray-400 text-xs mb-2">Offering from {selectedTeam?.name||'No Team Selected'}</p>
          <div className="mb-2 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-100">Online beta supports only one-year, unrestricted free-agent contracts using actual cap room. Multiyear deals, player/team options, exceptions and offseason bidding are unavailable until the authoritative multiplayer engine supports them.</div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start mb-2">
            <div className="bg-neutral-900 rounded-lg p-2.5 border border-neutral-700">
              <div className="text-sm font-semibold text-gray-300 mb-1.5">Money</div>
              <input type="number" min={MIN_SALARY/1_000_000} max={MAX_SALARY/1_000_000} step="0.001" value={offerSalaryText} disabled={busy} onChange={e=>changeSalary(e.target.value)} placeholder="First-year salary in millions" className="w-full px-3 py-1.5 rounded-lg bg-neutral-800 border border-neutral-600 text-white outline-none focus:border-orange-500" aria-label="First-year salary in millions"/>
              <input type="range" min={MIN_SALARY/1_000_000} max={MAX_SALARY/1_000_000} step="0.001" value={salaryValid?Number(offerSalaryText):MIN_SALARY/1_000_000} disabled={busy} onChange={e=>changeSalary(e.target.value)} className="w-full accent-green-500 mt-2" aria-label="First-year salary slider"/>
              <div className="text-sm text-gray-400 mt-2">First-year salary: <span className="text-white font-semibold">{salaryValid?formatDollars(salaryAmount):'Invalid amount'}</span></div>
            </div>
            <div className="space-y-2">
              <div className="bg-neutral-900 rounded-lg p-2.5 border border-neutral-700"><div className="text-sm font-semibold text-gray-300 mb-1.5">Years</div><button type="button" disabled className="px-3 py-1.5 rounded-lg font-semibold bg-orange-600 text-white">1Y</button></div>
              <div className="bg-neutral-900 rounded-lg p-2.5 border border-neutral-700"><div className="text-sm font-semibold text-gray-300 mb-1.5">Option</div><div className="text-sm text-gray-300">No Option</div></div>
            </div>
          </div>
          <div className="bg-neutral-900 rounded-lg p-2.5 border border-neutral-700 mb-2"><div className="text-sm font-semibold text-gray-300 mb-1.5">Contract Preview</div><div className="flex justify-between gap-4 text-sm text-gray-300"><span>One season</span><span>{salaryValid?formatDollars(salaryAmount):'—'}</span></div><div className="text-xs text-gray-500 mt-2">The Online server validates salary-cap room, player availability, roster spots and franchise revision before committing.</div></div>
          {!eligible&&<div role="status" className="mb-2 text-yellow-300 text-sm font-semibold">{rosterCount>=maxRosterSize?`Your roster is full (${rosterCount}/${maxRosterSize}). Free up a spot before signing.`:isRfa(target)?'Restricted free-agent offers are not available in this Online phase.':'This player cannot be signed by the current Online beta.'}</div>}
          {signError&&<div role="alert" className="mb-2 text-red-300 text-sm font-semibold">{signError}</div>}
          <div className="flex justify-end gap-3"><button type="button" onClick={closeSignModal} disabled={busy} className="px-4 py-2 rounded-lg bg-gray-600 hover:bg-gray-500 text-white font-semibold transition disabled:opacity-50">Cancel</button><button type="button" onClick={submitSigning} disabled={!eligible||!salaryValid||busy} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold transition">{busy?'Signing…':'Sign Player'}</button></div>
        </div>
      </div>,document.body)}
    </div>
  </PageFade>;
}
