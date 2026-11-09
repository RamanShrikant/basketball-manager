// Online-owned contract-extension workspace. The finished single-player Python
// engine supplies eligibility, player asks, negotiations, and salary schedules.
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from '../auth/supabaseClient.js';
import {useGame} from './onlineReadOnlyContext.jsx';
import {getSeasonCalendarConfig} from '../utils/seasonContext.js';
import './online-season.css';
import './online-extensions.css';

const money=n=>Number.isFinite(Number(n))?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n)):'—';
const idKey=lobby=>`bm-online-extension-attempt:${lobby}`;
async function endpoint(name,data){
  const {data:{session},error}=await supabase.auth.getSession();
  if(error||!session?.access_token)throw Error('Please sign in again to manage your online team.');
  const base=String(import.meta.env.VITE_BM_ONLINE_CPU_API_URL||'').replace(/\/$/,'');
  if(!base)throw Error('Trusted online extension backend is not configured.');
  const r=await fetch(`${base}/api/online/extensions/${name}`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
    body:JSON.stringify(data)
  });
  const result=await r.json().catch(()=>null);
  if(!r.ok||!result?.ok)throw Error(result?.error||'Extension request was not confirmed. Refresh the league before retrying.');
  return result;
}
function savedRequest(lobby,signature){
  try{
    const existing=JSON.parse(sessionStorage.getItem(idKey(lobby))||'null');
    if(existing?.signature===signature&&/^[0-9a-f-]{36}$/i.test(existing.id))return existing.id;
    const id=crypto.randomUUID();sessionStorage.setItem(idKey(lobby),JSON.stringify({signature,id}));return id;
  }catch{return crypto.randomUUID();}
}
function clearRequest(lobby){try{sessionStorage.removeItem(idKey(lobby));}catch{}}

export default function OnlineContractExtensions(){
  const {leagueData,selectedTeam,lobbyId,revision,onAccepted}=useGame();
  const [result,setResult]=useState(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const [playerId,setPlayerId]=useState('');
  const [choice,setChoice]=useState(''),[custom,setCustom]=useState(false);
  const [terms,setTerms]=useState({years:3,firstYearSalary:15000000,annualRaisePct:5,optionType:'none'});
  const [confirm,setConfirm]=useState(false);
  const lock=useRef(false);
  const snapshot=useRef(null);
  const deadline=getSeasonCalendarConfig(leagueData||{}).veteranExtensionDeadlineDate;
  const closed=leagueData?.onlineCheckpoints?.veteran_extension?.status==='closed'||
    leagueData?.contractExtensionState?.closedTypes?.includes('veteran');
  const teamName=selectedTeam?.name||'';
  useEffect(()=>{
    let alive=true;
    setLoading(true);setResult(null);setError('');setNotice('');setConfirm(false);
    snapshot.current=String(revision);
    if(!teamName||!lobbyId){setLoading(false);return;}
    endpoint('preview',{lobbyId,expectedRevision:Number(revision)})
      .then(data=>{if(alive){setResult(data);setPlayerId(current=>data.players?.some(p=>String(p.playerId)===current)?current:String(data.players?.[0]?.playerId||''));}})
      .catch(e=>{if(alive)setError(e.message||String(e));})
      .finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[lobbyId,revision,teamName]);
  const players=useMemo(()=>result?.players||[],[result]);
  const row=players.find(p=>String(p.playerId)===playerId)||players[0];
  const asks=Array.isArray(row?.askPackages)?row.askPackages:[];
  useEffect(()=>{
    setChoice(asks[0]?.askPackageId||asks[0]?.packageId||'');
    setTerms({years:Math.max(1,Number(row?.minYears)||1),firstYearSalary:Number(row?.recommendedFirstYearSalary||row?.minFirstYearSalary||15000000),annualRaisePct:5,optionType:'none'});
    setCustom(false);setConfirm(false);setNotice('');
  },[row?.playerId,revision]);
  const packageRow=asks.find(p=>String(p.askPackageId||p.packageId)===choice)||asks[0];
  const offer=custom?{years:Number(terms.years),firstYearSalary:Number(terms.firstYearSalary),annualRaisePct:Number(terms.annualRaisePct),optionType:terms.optionType}: {askPackageId:String(packageRow?.askPackageId||packageRow?.packageId||'')};
  const validOffer=custom?Number.isInteger(offer.years)&&offer.years>=Number(row?.minYears||1)&&offer.years<=Number(row?.maxYears||5)&&
    Number.isSafeInteger(offer.firstYearSalary)&&offer.firstYearSalary>=Number(row?.minFirstYearSalary||1)&&offer.firstYearSalary<=Number(row?.maxFirstYearSalary||1e8)&&
    offer.annualRaisePct>=0&&offer.annualRaisePct<=Number(row?.maxAnnualRaisePct||8):Boolean(packageRow);
  const canOffer=!closed&&!loading&&!busy&&!!result&&row?.eligible&&validOffer&&String(snapshot.current)===String(revision);
  async function submit(){
    if(!canOffer||!confirm||lock.current)return;
    lock.current=true;setBusy(true);setError('');setNotice('');
    try{
      const signature=JSON.stringify({revision,lobbyId,playerId:row.playerId,offer});
      const requestId=savedRequest(lobbyId,signature);
      const data=await endpoint('offer',{lobbyId,expectedRevision:Number(revision),requestId,
        playerId:String(row.playerId),offer});
      clearRequest(lobbyId);setConfirm(false);
      setNotice(data.accepted?'Contract extension signed and saved to the shared league.':'The player declined this offer. Their decision is recorded for every GM.');
      await onAccepted?.();
    }catch(e){setError(e?.message||String(e));}
    finally{lock.current=false;setBusy(false);}
  }
  return <main className="bmOnlineExtensionsPage" data-online-view="contract-extensions">
    <header className="bmOnlineExtensionsHeader">
      <div><small>FRONT OFFICE / {teamName.toUpperCase()||'ONLINE LEAGUE'}</small><h1>Contract Extensions</h1>
        <p>The original single-player eligibility and player-negotiation system, applied to your shared Online franchise.</p></div>
      <div className="bmOnlineExtensionsWindow"><span>VETERAN WINDOW</span><strong>{closed?'Closed':deadline||'Active season'}</strong></div>
    </header>
    {error&&<div className="bmOnlineExtensionsAlert" role="alert">{error} <button type="button" onClick={()=>onAccepted?.()}>Refresh league</button></div>}
    {notice&&<div className="bmOnlineExtensionsNotice" role="status">{notice}</div>}
    {loading?<div className="bmOnlineExtensionsEmpty">Checking extension eligibility against the live online roster…</div>:
      !result?<div className="bmOnlineExtensionsEmpty">Extension negotiations are unavailable for the current calendar position. Earlier season checkpoints or server setup may still be required.</div>:
      <div className="bmOnlineExtensionsColumns">
        <section className="bmOnlineExtensionsRoster" aria-label="Your team's contract extension candidates">
          <div className="bmOnlineExtensionsSectionTitle"><strong>YOUR ROSTER</strong><span>{result.summary?.eligibleCount||0} eligible</span></div>
          <div className="bmOnlineExtensionsRosterList">{players.map(p=><button type="button" key={p.playerId||p.playerName}
            className={String(p.playerId)===String(row?.playerId)?'active':''}
            onClick={()=>{setPlayerId(String(p.playerId||''));setError('');setNotice('');}}>
            <span><b>{p.playerName}</b><small>{p.position||'—'} · {p.overall||'—'} OVR</small></span>
            <em className={p.eligible?'eligible':''}>{p.eligible?'ELIGIBLE':'LOCKED'}</em>
          </button>)}</div>
        </section>
        <section className="bmOnlineExtensionsDetail" aria-label="Extension negotiation details">
          {!row?<div className="bmOnlineExtensionsEmpty">No roster player is available for extension negotiations.</div>:<>
            <div className="bmOnlineExtensionsPlayer"><div><small>PLAYER NEGOTIATION</small><h2>{row.playerName}</h2>
              <p>{row.position||'—'} · Age {row.age||'—'} · {row.overall||'—'} OVR</p></div>
              <strong>{row.extensionType==='rookie_scale'?'ROOKIE SCALE':'VETERAN'}</strong></div>
            {!row.eligible?<div className="bmOnlineExtensionsReason"><strong>Not currently eligible</strong><p>{row.reason||'This player cannot sign an extension at this time.'}</p></div>:
              <><div className="bmOnlineExtensionsFacts">
                <div><small>LEGAL TERMS</small><b>{row.minYears||1}–{row.maxYears||5} years</b></div>
                <div><small>FIRST-YEAR RANGE</small><b>{money(row.minFirstYearSalary)} – {money(row.maxFirstYearSalary)}</b></div>
              </div>
              <div className="bmOnlineExtensionsSectionTitle"><strong>OFFER STRUCTURE</strong><span>Original player asks or custom</span></div>
              <div className="bmOnlineExtensionsMode"><button className={!custom?'selected':''} type="button" onClick={()=>{setCustom(false);setConfirm(false);}}>Player's asks</button><button type="button" className={custom?'selected':''} onClick={()=>{setCustom(true);setConfirm(false);}}>Custom offer</button></div>
              {custom?<div className="bmOnlineExtensionsForm">
                <label>Years<select value={terms.years} onChange={e=>{setTerms(t=>({...t,years:Number(e.target.value)}));setConfirm(false);}}>{Array.from({length:Math.max(0,Math.min(5,Number(row.maxYears)||0)-(Number(row.minYears)||1)+1)},(_,i)=>(Number(row.minYears)||1)+i).map(n=><option key={n} value={n}>{n} years</option>)}</select></label>
                <label>First-year salary<input type="number" min={row.minFirstYearSalary||1000000} max={row.maxFirstYearSalary||100000000} step="1000" value={terms.firstYearSalary} onChange={e=>{setTerms(t=>({...t,firstYearSalary:Number(e.target.value)}));setConfirm(false);}}/></label>
                <label>Annual raise<select value={terms.annualRaisePct} onChange={e=>{setTerms(t=>({...t,annualRaisePct:Number(e.target.value)}));setConfirm(false);}}>{[0,3,5,8].filter(n=>n<=Number(row.maxAnnualRaisePct||8)).map(n=><option key={n} value={n}>{n}%</option>)}</select></label>
                <label>Final-year option<select value={terms.optionType} onChange={e=>{setTerms(t=>({...t,optionType:e.target.value}));setConfirm(false);}}><option value="none">No option</option><option value="team">Team option</option><option value="player">Player option</option></select></label>
              </div>:<div className="bmOnlineExtensionsPackages">{asks.length?asks.map(p=><button type="button" key={p.packageId||p.askPackageId} className={choice===(p.askPackageId||p.packageId)?'active':''} onClick={()=>{setChoice(p.askPackageId||p.packageId);setConfirm(false);}}>
                <span><strong>{p.label||"Player’s preferred deal"}</strong><small>{p.years} years · {p.annualRaisePct||0}% raises · {p.optionType||'none'} option</small></span>
                <b>{money(p.firstYearSalary)} <small>YEAR 1</small></b>
              </button>):<p className="bmOnlineExtensionsHint">No player-ask packages available. Use a custom offer within the legal range.</p>}</div>}
              <div className="bmOnlineExtensionsActions">
                <span>{!validOffer?'Select a valid contract package.':'Only your assigned GM team may submit. The server decides and saves the result.'}</span>
                {confirm?<div><button type="button" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button><button type="button" disabled={!canOffer} className="primary" onClick={submit}>{busy?'Submitting…':'Confirm offer'}</button></div>:
                  <button type="button" className="primary" disabled={!canOffer} onClick={()=>{setConfirm(true);setError('');setNotice('');}}>Offer extension</button>}
              </div></>}
          </>}
        </section>
      </div>}
    <footer className="bmOnlineExtensionsFooter">All decisions are evaluated by the unchanged Python extension engine on the trusted backend. Existing salaries cannot be rewritten. The host handles CPU-team deadline processing; no human team is auto-negotiated.</footer>
  </main>;
}
