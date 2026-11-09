import {trustedOnlineApiBase} from './onlineCalendarBootstrap.js';
// Phase 2E.4-A — single-player option decisions, shared online authorization.
// GMs submit exactly their own decisions; only the host can finalize all teams.
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {supabase} from '../auth/supabaseClient.js';
import {useGame} from './onlineReadOnlyContext.jsx';
import './online-season.css';
import './online-options.css';

const types={teamOptions:'Team options',twoWay:'Two-way decisions',stash:'Stash decisions'};
const initial={teamOptions:{},twoWay:{},stash:{}};
const choicesFor=(category,row)=>category==='teamOptions'?
  [['true','Exercise option'],['false','Decline option']]:
  (row.availableDecisions||[]).map(value=>[value,({two_way:'Sign two-way',standard:'Standard deal',extend:'Extend',convert:'Convert',release:'Release'})[value]||value]);
const idFor=(lobby,action,signature)=>{
 try{const key=`bm-online-options:${lobby}:${action}`,previous=JSON.parse(sessionStorage.getItem(key)||'null');
  if(previous?.signature===signature&&/^[a-f\d-]{36}$/i.test(previous.id))return previous.id;
  const id=crypto.randomUUID();sessionStorage.setItem(key,JSON.stringify({signature,id}));return id;
 }catch{return crypto.randomUUID();}
};
const clearId=(lobby,action)=>{try{sessionStorage.removeItem(`bm-online-options:${lobby}:${action}`);}catch{}};
const draftKey=(lobby,team,year)=>`bm-online-options-draft:${lobby}:${team}:${year}`;
function readDraft(lobby,team,year){try{return JSON.parse(sessionStorage.getItem(draftKey(lobby,team,year))||'null');}catch{return null;}}
function saveDraft(lobby,team,year,choices){try{sessionStorage.setItem(draftKey(lobby,team,year),JSON.stringify(choices));}catch{}}
async function api(mode,payload){
 const {data:{session},error}=await supabase.auth.getSession();
 if(error||!session?.access_token)throw Error('Your online session has expired. Sign in again.');
 const base=trustedOnlineApiBase();
 if(!base)throw Error('The trusted offseason backend is not configured.');
 const response=await fetch(`${base}/api/online/offseason/options/${mode}`,{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
   body:JSON.stringify(payload)});
 const result=await response.json().catch(()=>null);
 if(!response.ok||!result?.ok)throw Error(result?.error||'Options could not be confirmed. Refresh your shared franchise.');
 return result;
}
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n||0));
export default function OnlineOffseasonOptions(){
 const {leagueData,selectedTeam,lobbyId,revision,isHost,onAccepted,humanTeamNames=[]}=useGame();
 const year=Number(leagueData?.onlineDraft?.draftYear||0);
 const ready=leagueData?.onlineRookieSignings?.status==='complete';
 const stage=leagueData?.onlineOptions||{};
 const complete=stage.status==='complete'||Boolean(leagueData?.offseasonState?.optionsComplete);
 const submitted=Boolean(stage.decisionsByTeam?.[selectedTeam?.name]);
 const readyCount=humanTeamNames.filter(t=>Object.hasOwn(stage.decisionsByTeam||{},t)).length;
 const allSubmitted=humanTeamNames.length>0&&readyCount===humanTeamNames.length;
 const [preview,setPreview]=useState(null),[decisions,setDecisions]=useState(initial);
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState('');
 const lock=useRef(false);
 useEffect(()=>{
  let active=true;setError('');setNotice('');setConfirm('');setPreview(null);setDecisions(initial);
  if(!ready||complete||!selectedTeam?.name||!lobbyId)return;
  setLoading(true);
  api('preview',{lobbyId,expectedRevision:Number(revision)}).then(result=>{
   if(!active)return;
   setPreview(result);
   const existing=readDraft(lobbyId,selectedTeam.name,year);
   const defaults={
    teamOptions:Object.fromEntries((result.rows?.teamOptions||[]).map(p=>[String(p.playerId),
      Boolean(p.cpuTeamOptionDecision?.exerciseOption)])),
    twoWay:Object.fromEntries((result.rows?.twoWay||[]).map(p=>[String(p.playerId),p.recommendedDecision||'release'])),
    stash:Object.fromEntries((result.rows?.stash||[]).map(p=>[String(p.playerId),p.recommendedDecision||'release']))};
   // Keep unsent user choices when another GM increments the shared revision.
   // Never reuse choices for a player no longer present or newly ineligible.
   for(const category of Object.keys(types))for(const row of result.rows?.[category]||[]){
     const id=String(row.playerId),choice=existing?.[category]?.[id];
     if(choicesFor(category,row).some(([value])=>value===String(choice)))defaults[category][id]=choice;
   }
   setDecisions(defaults);
  }).catch(e=>{if(active)setError(e.message||String(e));})
    .finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[lobbyId,revision,selectedTeam?.name,ready,complete]);
 const rows=preview?.rows||{};
 const valid=Boolean(preview)&&Object.keys(types).every(category=>(rows[category]||[]).every(row=>{
  const options=choicesFor(category,row).map(c=>c[0]);
  return options.includes(String(decisions[category]?.[String(row.playerId)]));
 }));
 const count=Object.keys(types).reduce((n,k)=>n+(rows[k]?.length||0),0);
 async function submit(action){
  if(lock.current||busy||!ready||complete||!lobbyId||
     (action==='submit'&&(!valid||submitted))||
     (action==='finalize'&&(!isHost||!allSubmitted)))return;
  if(confirm!==action){setConfirm(action);return;}
  lock.current=true;setBusy(true);setError('');setNotice('');
  const chosen=action==='submit'?Object.fromEntries(Object.keys(types).map(category=>[
   category,Object.fromEntries((rows[category]||[]).map(p=>[String(p.playerId),decisions[category][String(p.playerId)]]))])):null;
  const signature=JSON.stringify({year,revision,action,team:selectedTeam?.name,choices:chosen});
  const requestId=idFor(lobbyId,action,signature);
  try{
   const result=await api(action,{lobbyId,expectedRevision:Number(revision),requestId,
     ...(chosen?{decisions:chosen}:{})});
   clearId(lobbyId,action);if(action==='submit')try{sessionStorage.removeItem(draftKey(lobbyId,selectedTeam.name,year));}catch{}
   setConfirm('');
   setNotice(action==='submit'?'Your options are locked in.':'League options finalized. Rights management is next.');
   await onAccepted?.();
  }catch(e){setError(e.message||String(e));setConfirm('');}
  finally{lock.current=false;setBusy(false);}
 }
 return <main className="bmOnlineSeasonPage bmOnlineOptionsPage" data-online-season-view="options">
  <header className="bmOnlineSeasonHeading"><div><div className="bmOnlineSeasonEyebrow">BASKETBALL MANAGER · ONLINE OFFSEASON</div>
   <h1>Player & Team Options</h1><p>The original single-player option rules, with independent human GM decisions and one shared finalization.</p></div>
   <div className="bmOnlineSeasonSummary"><small>OPTION WINDOW</small>
    <strong>{complete?'COMPLETE':ready?`${readyCount}/${humanTeamNames.length}`:'LOCKED'}</strong>
    <span>{year||'—'} · {complete?'Resolved':submitted?'Your decisions submitted':'Awaiting decisions'}</span></div>
  </header>
  {!ready?<div className="bmOnlineSeasonEmpty"><h2>Finish rookie signings first</h2><p>All human and CPU rookie rights must be resolved before the option window opens.</p>
   <Link to={`?view=${encodeURIComponent('/rookie-signings')}`}>Go to Rookie Signings</Link></div>:
   complete?<div className="bmOnlineSeasonEmpty"><h2>Options finalized</h2>
    <p>Player options, expiring deals, team options and CPU decisions were resolved for the shared league. Rights management and qualifying offers are the next checkpoint.</p>
    <strong>{stage.summary?.enteredFreeAgencyCount||0} players entered free agency</strong><Link to="?view=%2Ffree-agent-rights">Continue to Free Agent Rights</Link></div>:
   <div className="bmOnlineSeasonScroll">
    <div className="bmOnlineOptionsIntro"><div><small>YOUR TEAM</small><h2>{selectedTeam?.name||'Unassigned GM'}</h2>
      <p>{submitted?'Your decisions are locked. Other managers may still be reviewing theirs.':
        'Exercise or decline team options. Players decide their own options; the host runs CPU choices only after all human GMs finish.'}</p></div>
      <strong>{loading?'LOADING':submitted?'SUBMITTED':`${count} DECISIONS`}</strong></div>
    {Object.entries(types).map(([category,label])=><section className="bmOnlineOptionsSection" key={category}>
      <div className="bmOnlineOptionsSectionHead"><h3>{label}</h3><span>{(rows[category]||[]).length} pending</span></div>
      {(rows[category]||[]).length===0?<p className="bmOnlineOptionsQuiet">No decisions needed in this category.</p>:
       <div className="bmOnlineOptionsRows">{rows[category].map(row=><div className="bmOnlineOptionsRow" key={String(row.playerId)}>
         <div className="bmOnlineOptionsPlayer"><strong>{row.playerName}</strong><span>{row.position||'NBA'} · {row.overall||'—'} OVR · {money(row.salaryThisYear)}</span></div>
         <select aria-label={`${row.playerName} ${label}`} disabled={submitted||busy} value={String(decisions[category]?.[String(row.playerId)]??'')}
          onChange={e=>setDecisions(current=>{const next={...current,[category]:{...current[category],[String(row.playerId)]:
           category==='teamOptions'?e.target.value==='true':e.target.value}};
           saveDraft(lobbyId,selectedTeam.name,year,next);return next;})}>
          {choicesFor(category,row).map(([value,title])=><option key={value} value={value}>{title}</option>)}
         </select></div>)}</div>}
    </section>)}
    <section className="bmOnlineOptionsSection"><div className="bmOnlineOptionsSectionHead"><h3>Player-controlled options & expiring deals</h3><span>Read only</span></div>
     <p className="bmOnlineOptionsQuiet">These resolve through the original player-decision and free-agency engine, not by a GM toggle.</p>
     {[...(rows.playerOptions||[]),...(rows.expiredContracts||[])].map(row=><div className="bmOnlineOptionsRow" key={`${row.status}-${row.playerId}`}>
      <div className="bmOnlineOptionsPlayer"><strong>{row.playerName}</strong><span>{row.status==='player_option'?'Player option':'Expiring contract'} · {money(row.salaryThisYear)}</span></div>
      <span className="bmOnlineOptionsReadonly">ENGINE DECISION</span></div>)}
    </section>
   </div>}
  {ready&&!complete&&<footer className="bmOnlineOptionsFooter">
   <div><strong>{readyCount}/{humanTeamNames.length} GMs ready</strong>
    <p>{submitted?'Awaiting the remaining managers.':valid?'Your decisions are ready to submit.':'Review every required option decision.'}</p>
    {error&&<p role="alert" className="bmOnlineOptionsError">{error}</p>}{notice&&<p className="bmOnlineOptionsSuccess">{notice}</p>}</div>
   <div className="bmOnlineOptionsActions">
    {!submitted&&<button type="button" disabled={busy||!valid||loading} onClick={()=>submit('submit')}>
      {confirm==='submit'?'Confirm team decisions':'Lock in my decisions'}</button>}
    {isHost&&<button type="button" className="primary" disabled={busy||!allSubmitted} onClick={()=>submit('finalize')}>
     {confirm==='finalize'?'Confirm league finalization':'Finalize all NBA options'}</button>}
    {confirm&&<button type="button" className="secondary" onClick={()=>setConfirm('')}>Cancel</button>}
   </div></footer>}
 </main>;
}
