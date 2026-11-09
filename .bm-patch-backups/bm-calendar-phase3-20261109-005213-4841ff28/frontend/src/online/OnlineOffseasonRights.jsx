// Phase 2E.4-B — original single-player Bird rights and qualifying-offer decisions.
// Browser sends player-ID choices only; original Python and private SQL own all results.
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {supabase} from '../auth/supabaseClient.js';
import {useGame} from './onlineReadOnlyContext.jsx';
import './online-season.css';
import './online-options.css';
import './online-rights.css';
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n||0));
const labels={keep:'Retain Bird rights',renounce:'Renounce all rights',extend_qo:'Tender qualifying offer',
 decline_qo:'Decline qualifying offer',withdraw_qo:'Withdraw qualifying offer',keep_qo:'Keep qualifying offer'};
const types={bird:'Bird rights',early_bird:'Early Bird',non_bird:'Non-Bird',none:'No Bird rights'};
const draftKey=(l,t,y)=>`bm-online-rights-draft:${l}:${t}:${y}`;
const requestKey=(l,a)=>`bm-online-rights-request:${l}:${a}`;
const requestId=(l,a,sig)=>{try{const k=requestKey(l,a),v=JSON.parse(sessionStorage.getItem(k)||'null');
 if(v?.signature===sig&&/^[0-9a-f-]{36}$/i.test(v.id))return v.id;
 const id=crypto.randomUUID();sessionStorage.setItem(k,JSON.stringify({id,signature:sig}));return id;
 }catch{return crypto.randomUUID();}};
async function send(mode,payload){
 const {data,error}=await supabase.auth.getSession();
 if(error||!data?.session?.access_token)throw Error('Your online session expired. Sign in again.');
 const base=String(import.meta.env.VITE_BM_ONLINE_CPU_API_URL||'').replace(/\/$/,'');
 if(!base)throw Error('Trusted online offseason service is not configured.');
 const r=await fetch(`${base}/api/online/offseason/rights/${mode}`,{
  method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},
  body:JSON.stringify(payload)});
 const out=await r.json().catch(()=>null);
 if(!r.ok||!out?.ok)throw Error(out?.error||'Rights action not confirmed. Refresh the league.');
 return out;
}
export default function OnlineOffseasonRights(){
 const {leagueData,selectedTeam,lobbyId,revision,isHost,onAccepted,humanTeamNames=[]}=useGame();
 const team=selectedTeam?.name||'',year=Number(leagueData?.onlineDraft?.draftYear||0);
 const ready=leagueData?.onlineOptions?.status==='complete'&&leagueData?.offseasonState?.optionsComplete===true;
 const stage=leagueData?.onlineRights||{},done=stage.status==='complete'||leagueData?.offseasonState?.rightsManagementComplete===true;
 const submitted=Object.hasOwn(stage.decisionsByTeam||{},team);
 const readyCount=humanTeamNames.filter(t=>Object.hasOwn(stage.decisionsByTeam||{},t)).length;
 const everyone=humanTeamNames.length>0&&readyCount===humanTeamNames.length;
 const [preview,setPreview]=useState(null),[choices,setChoices]=useState({});
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState('');
 const locked=useRef(false);
 useEffect(()=>{
  let mounted=true;setPreview(null);setError('');setNotice('');setConfirm('');setLoading(false);
  if(!lobbyId||!team||!ready||done)return;
  setLoading(true);
  send('preview',{lobbyId,expectedRevision:Number(revision)}).then(out=>{
   if(!mounted)return;
   setPreview(out);
   let saved={};try{saved=JSON.parse(sessionStorage.getItem(draftKey(lobbyId,team,year))||'{}')||{};}catch{}
   const next={};for(const row of out.rows||[]){
    const id=String(row.playerId),choices=row.availableDecisions||[];
    next[id]=choices.includes(saved[id])?saved[id]:choices[0];
   }
   setChoices(next);
  }).catch(e=>{if(mounted)setError(e.message||String(e));}).finally(()=>{if(mounted)setLoading(false);});
  return()=>{mounted=false;};
 },[lobbyId,team,year,revision,ready,done]);
 const rows=preview?.rows||[];
 const valid=Boolean(preview)&&rows.every(r=>(r.availableDecisions||[]).includes(choices[String(r.playerId)]));
 const holds=useMemo(()=>rows.reduce((n,row)=>n+Number(row.capHold||0),0),[rows]);
 const freed=useMemo(()=>rows.filter(row=>choices[String(row.playerId)]==='renounce')
  .reduce((n,row)=>n+Number(row.capHold||0),0),[rows,choices]);
 const submit=async(action)=>{
  if(locked.current||busy||!ready||done||!lobbyId||
    (action==='submit'&&(!valid||submitted))||
    (action==='finalize'&&(!everyone||!isHost)))return;
  if(confirm!==action){setConfirm(action);return;}
  locked.current=true;setBusy(true);setError('');setNotice('');
  const decisions=action==='submit'?Object.fromEntries(rows.map(r=>[String(r.playerId),choices[String(r.playerId)]])):null;
  const signature=JSON.stringify({year,revision,action,team:action==='submit'?team:'host',decisions});
  const id=requestId(lobbyId,action,signature);
  try{
   await send(action,{lobbyId,expectedRevision:Number(revision),requestId:id,...(decisions?{decisions}:{})});
   try{sessionStorage.removeItem(requestKey(lobbyId,action));if(action==='submit')sessionStorage.removeItem(draftKey(lobbyId,team,year));}catch{}
   setConfirm('');setNotice(action==='submit'?'Your free-agent rights decisions are locked.':'League rights finalized; free agency can open once its market is integrated.');
   await onAccepted?.();
  }catch(e){setError(e.message||String(e));setConfirm('');}
  finally{locked.current=false;setBusy(false);}
 };
 const setChoice=(id,value)=>{setConfirm('');setChoices(prev=>{
  const next={...prev,[id]:value};try{sessionStorage.setItem(draftKey(lobbyId,team,year),JSON.stringify(next));}catch{}
  return next;
 });};
 return <main className="bmOnlineSeasonPage bmOnlineRightsPage" data-online-season-view="rights">
  <header className="bmOnlineSeasonHeading"><div><div className="bmOnlineSeasonEyebrow">BASKETBALL MANAGER · ONLINE OFFSEASON</div>
   <h1>Free Agent Rights</h1><p>Preserve Bird rights, decide qualifying offers, and prepare the shared offseason market.</p></div>
   <div className="bmOnlineSeasonSummary"><small>RIGHTS WINDOW</small><strong>{done?'COMPLETE':ready?`${readyCount}/${humanTeamNames.length}`:'LOCKED'}</strong>
    <span>{year||'—'} · {submitted?'Team submitted':'GM decisions'}</span></div>
  </header>
  {!ready?<section className="bmOnlineSeasonEmpty"><h2>Finish Player & Team Options first</h2><p>Options must resolve before free-agent rights and qualifying offers become official.</p>
   <Link to="?view=%2Fplayer-team-options">Go to Options</Link></section>:
   done?<section className="bmOnlineSeasonEmpty"><h2>Rights finalized</h2><p>The original Bird-rights and qualifying-offer decisions are now saved to the shared league. The next stage is the live offseason free-agency market.</p>
    <strong>{stage.summary?.decisions||0} human-GM decisions recorded</strong></section>:
   <div className="bmOnlineSeasonScroll">
    <section className="bmOnlineRightsHero"><div><small>YOUR FRANCHISE</small><h2>{team}</h2>
     <p>{submitted?'Your choices are final. Other GMs may still be reviewing their players.':
      'Keep your rights to re-sign players, tender an eligible rookie qualifying offer, or renounce a cap hold to free room.'}</p></div>
     <div className="bmOnlineRightsTotals"><div><small>CAP HOLDS</small><strong>{loading?'…':money(holds)}</strong></div>
      <div><small>ROOM FROM RENOUNCING</small><strong>{loading?'…':money(freed)}</strong></div></div>
    </section>
    <div className="bmOnlineRightsInfo" role="note">Renouncing rights is permanent for this offseason. A qualifying offer preserves restricted-free-agent matching eligibility; declining it does not automatically erase Bird rights. Salary figures are cap holds, not signed contracts.</div>
    <section className="bmOnlineOptionsSection"><div className="bmOnlineOptionsSectionHead"><h3>Rights & qualifying offers</h3><span>{loading?'Loading…':`${rows.length} decisions`}</span></div>
     {loading?<p className="bmOnlineOptionsQuiet">Checking your team’s rights against the shared league…</p>:
      !rows.length?<p className="bmOnlineOptionsQuiet">No pending Bird-rights or qualifying-offer decisions for your franchise.</p>:
      <div className="bmOnlineOptionsRows">{rows.map(row=><div className="bmOnlineOptionsRow bmOnlineRightsRow" key={String(row.playerId)}>
       <div className="bmOnlineOptionsPlayer"><strong>{row.playerName}</strong><span>{row.position||'NBA'} · {row.overall??'—'} OVR · {types[row.birdLevel]||'Rights'} · Cap hold {money(row.capHold)}</span>
        {(row.qualifyingOfferEligible||row.qualifyingOffer)&&<span className="bmOnlineRightsTender">Qualifying offer {money((row.qualifyingOfferEligible||row.qualifyingOffer)?.amount)} · {row.qualifyingOfferEligible?'Pending':'Extended'}</span>}</div>
       <select aria-label={`${row.playerName} rights decision`} disabled={submitted||busy} value={choices[String(row.playerId)]||''}
        onChange={e=>setChoice(String(row.playerId),e.target.value)}>
        {(row.availableDecisions||[]).map(option=><option key={option} value={option}>{labels[option]||option}</option>)}
       </select></div>)}</div>}
    </section>
   </div>}
  {ready&&!done&&<footer className="bmOnlineOptionsFooter"><div><strong>{readyCount}/{humanTeamNames.length} GMs ready</strong>
    <p>{submitted?'Your rights are locked until the host finalizes.':valid?'Review the qualifying-offer and renunciation decisions before locking them in.':'Load all eligible player rights to proceed.'}</p>
    {error&&<p role="alert" className="bmOnlineOptionsError">{error}</p>}{notice&&<p className="bmOnlineOptionsSuccess">{notice}</p>}
   </div><div className="bmOnlineOptionsActions">
    {!submitted&&<button type="button" disabled={busy||loading||!valid} onClick={()=>submit('submit')}>{confirm==='submit'?'Confirm all decisions':'Lock in rights'}</button>}
    {isHost&&<button type="button" className="primary" disabled={busy||!everyone} onClick={()=>submit('finalize')}>{confirm==='finalize'?'Confirm league rights':'Finalize rights window'}</button>}
    {confirm&&<button type="button" className="secondary" onClick={()=>setConfirm('')}>Cancel</button>}
   </div></footer>}
 </main>;
}
