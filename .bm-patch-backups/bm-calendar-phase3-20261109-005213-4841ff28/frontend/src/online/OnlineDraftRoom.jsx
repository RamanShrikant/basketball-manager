// Online NBA Draft: the original single-player rookie generator and drafting
// intelligence execute on the trusted backend. No local save mutations.
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {supabase} from '../auth/supabaseClient.js';
import {useGame} from './onlineReadOnlyContext.jsx';
import {onlinePostseasonRequestId,clearOnlinePostseasonRequestId} from './onlinePostseasonRequestId.mjs';
import './online-season.css';

const allTeams=s=>Array.isArray(s?.teams)?s.teams:Object.values(s?.conferences||{}).flat();
const nameOf=p=>p?.name||p?.playerName||'Unknown prospect';
const val=(p,key,other)=>Number(p?.[key]??p?.[other]??0);
export default function OnlineDraftRoom(){
 const {leagueData,selectedTeam,lobbyId,revision,isHost,onAccepted,humanTeamNames=[]}=useGame();
 const leagueYear=Number(leagueData?.onlineDraftLottery?.draftYear||0);
 const rights=leagueData?.onlineDraftRights, online=leagueData?.onlineDraft;
 const draft=online?.draftState;
 const order=rights?.order||[];
 const active=online?.status==='active';
 const complete=online?.status==='complete';
 const index=Number(draft?.currentPickIndex||0);
 const current=active?draft?.draftOrder?.[index]:null;
 const currentOwner=current?.currentOwnerTeamName||current?.teamName;
 const myTurn=active&&currentOwner===selectedTeam?.name;
 const cpuTurn=active&&!!currentOwner&&!humanTeamNames.includes(currentOwner);
 const memberOwners=useMemo(()=>new Map(allTeams(leagueData).map(t=>[t.name,
    t.logo||t.teamLogo||t.newTeamLogo||t.logoUrl||''])),[leagueData]);
 const [selected,setSelected]=useState('');
 const [search,setSearch]=useState('');
 const [show,setShow]=useState('board');
 const [confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [draftClock,setDraftClock]=useState(null);
 const lock=useRef(false);
 useEffect(()=>{setSelected('');setConfirmed(false);setError('');setNotice('');},[revision,lobbyId]);
 useEffect(()=>{
   let cancelled=false;
   if(!active||!lobbyId||!humanTeamNames.includes(currentOwner)){
     setDraftClock(null);return;
   }
   async function updateClock(){
     const {data,error:rpcError}=await supabase.rpc('bm_online_draft_clock_g3ca3',{p_lobby:lobbyId});
     if(!cancelled)setDraftClock(!rpcError&&data?.active&&Number(data.pickIndex)===index?data:null);
   }
   setDraftClock(null);updateClock();
   const timer=setInterval(updateClock,60000);
   return ()=>{cancelled=true;clearInterval(timer);};
 },[active,lobbyId,revision,index,currentOwner,humanTeamNames.join('|')]);
 const expiredOtherHuman=Boolean(active&&isHost&&!myTurn&&humanTeamNames.includes(currentOwner)&&
   draftClock?.eligible===true&&Number(draftClock?.pickIndex)===index);
 const prospects=useMemo(()=>Array.isArray(draft?.availableProspects)?draft.availableProspects:[],[draft?.availableProspects]);
 const visibleProspects=useMemo(()=>prospects.filter(p=>!search||
   `${nameOf(p)} ${p?.pos||p?.position||''} ${p?.college||p?.school||''}`.toLowerCase().includes(search.trim().toLowerCase()))
   .slice(0,150),[prospects,search]);
 const history=Array.isArray(draft?.draftedPicks)?draft.draftedPicks:[];
 const last=history.at(-1);
 async function act(action){
   if(lock.current||busy||!lobbyId||!Number.isSafeInteger(Number(revision))||!confirmed)return;
   if(action==='settle'&&(!isHost||leagueData?.onlineDraftLottery?.stage!=='orderDrawn'||leagueData?.onlineDraftLottery?.rightsSettlement!=='pending'||rights))return;
   if(action==='start'&&(!isHost||rights?.status!=='settled'||online))return;
   if(action==='pick'&&(!active||(!myTurn&&!(isHost&&cpuTurn)&&!expiredOtherHuman)))return;
   if(action==='pick'&&myTurn&&!selected)return;
   lock.current=true;setBusy(true);setError('');setNotice('');
   const key=action==='pick'?`draft-pick:${leagueYear}:${index}`:`draft-${action}:${leagueYear}`;
   try{
     const {data:{session},error:authError}=await supabase.auth.getSession();
     if(authError||!session?.access_token)throw Error('Please sign back into Basketball Manager Online.');
     const url=String(import.meta.env.VITE_BM_ONLINE_CPU_API_URL||'').replace(/\/$/,'');
     if(!url)throw Error('The trusted NBA Draft backend is not configured.');
     const id=onlinePostseasonRequestId(lobbyId,key);
     const response=await fetch(`${url}/api/online/draft/${action==='settle'?'settle-rights':(action==='pick'&&expiredOtherHuman)?'auto-pick':action}`,{
       method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},
       body:JSON.stringify({lobbyId,requestId:id,expectedRevision:Number(revision),
         ...(action==='pick'&&myTurn?{prospectId:selected}:{})})
     });
     const result=await response.json().catch(()=>null);
     if(!response.ok||!result?.ok)throw Error(result?.error||'Could not confirm the official draft transaction. Refresh and check the current pick.');
     clearOnlinePostseasonRequestId(lobbyId,key);
     setConfirmed(false);setSelected('');setSearch('');
     setNotice(action==='settle'?'Official draft ownership finalized.':action==='start'?'Draft class generated and shared.':
       `Selection committed: ${result?.pick?.playerName||'rookie'}!`);
     await onAccepted?.();
   }catch(e){setError(e.message||String(e));setConfirmed(false);}
   finally{lock.current=false;setBusy(false);}
 }
 const lobbyPath=lobbyId?`/online/franchise/${lobbyId}`:'/online';
 const currentEligible=Boolean(current&&(myTurn||(isHost&&cpuTurn)||expiredOtherHuman));
 const action=!rights?'settle':!online?'start':'pick';
 const actionText=action==='settle'?'Finalize official pick ownership':action==='start'?'Open NBA Draft':
   myTurn?'Draft selected prospect':expiredOtherHuman?'Auto-pick after expired GM deadline':'Simulate CPU selection';
 const rightsPending=leagueData?.onlineDraftLottery?.stage==='orderDrawn'&&leagueData?.onlineDraftLottery?.rightsSettlement==='pending'&&!rights;
 const canAction=(action==='settle'&&isHost&&rightsPending)||
   (action==='start'&&isHost&&rights?.status==='settled')||
   (action==='pick'&&currentEligible&&(myTurn?Boolean(selected):isHost));
 const owned=order.filter(p=>p.currentOwnerTeamName===selectedTeam?.name);
 return <main className="bmOnlineSeasonPage bmOnlineDraftRoom" data-online-season-view="draft-room">
   <header className="bmOnlineSeasonHeading"><div><div className="bmOnlineSeasonEyebrow">BASKETBALL MANAGER · ONLINE FRANCHISE</div>
     <h1>{leagueYear||'NBA'} NBA Draft</h1><p>The original rookie generator and CPU draft engine. One board, one shared league, every GM on the clock.</p></div>
     <div className="bmOnlineSeasonSummary"><small>DRAFT STATUS</small><strong>{complete?'FINAL':active?`#${current?.pick||'—'}`:rights?'READY':'PENDING'}</strong>
     <span>{complete?'All picks complete':active?`${history.length} of ${draft.draftOrder.length} selections`:rights?'Ownership locked':'Requires official lottery'}</span></div>
   </header>
   {!leagueData?.onlineDraftLottery&&<section className="bmOnlineSeasonEmpty"><h2>Complete the Draft Lottery</h2><p>The NBA Finals and official draft order must be complete before any GM can select players.</p>
     <Link className="bmOnlineDraftContinue" to={`${lobbyPath}?view=${encodeURIComponent('/draft-lottery')}`}>Go to Draft Lottery</Link></section>}
   {leagueData?.onlineDraftLottery&&<>
     <section className="bmOnlineDraftSummary" aria-label="Draft status">
       <div><small>OFFICIAL RIGHTS</small><strong className={!rights?'pending':''}>{rights?'Settled':'Awaiting settlement'}</strong><span>{rights?`${order.length} assigned slots · ${rights.removedSlots?.length||0} forfeitures`:'Protected picks and swaps must be resolved before drafting'}</span></div>
       <div><small>YOUR PICKS</small><strong>{rights?owned.length:'—'}</strong><span>{selectedTeam?.name||'Your team'} · {rights?'Draft order locked':'Ownership pending'}</span></div>
       <div><small>ON THE CLOCK</small><strong>{currentOwner|| (complete?'Draft complete':'Awaiting host')}</strong><span>{last?`Last: #${last.pick} ${last.playerName}`:'No selections yet'}</span></div>
     </section>
     {(rightsPending||rights&&!online||active)&&<section className="bmOnlineSeasonHostControls bmOnlineDraftHost">
       <div><small>{active?(myTurn?'YOUR SELECTION':currentOwner?'CURRENT SELECTION':'DRAFT PAUSED'):(isHost?'HOST CONTROL':'AWAITING HOST')}</small>
         <strong>{rightsPending?'Settle protected picks and swap entitlements':rights&&!online?'Generate the official rookie class':
           myTurn?`You are on the clock at #${current?.pick}`:`${currentOwner} is on the clock`}</strong>
         <p>{rightsPending?'This locks final ownership using the original single-player pick resolver. It cannot be rerolled.':
           rights&&!online?'Generate prospects once and freeze the shared draft board.':
           myTurn?'Choose an available prospect below. The rookie goes into pending rookie signings.':
           expiredOtherHuman?'The other GM’s 24-hour selection window has expired. The original CPU draft engine will choose automatically; you cannot select their prospect.':
           'Human picks belong to their assigned GM. The commissioner may use the original CPU engine only after a server-verified 24-hour deadline.'}</p>
         {active&&humanTeamNames.includes(currentOwner)&&draftClock?.deadlineAt&&<p className="bmOnlineDraftInlineNotice">Human pick deadline: {new Date(draftClock.deadlineAt).toLocaleString()}. The GM may select until another confirmed pick advances the board.</p>}</div>
       {canAction&&<div className="bmOnlineSeasonHostActions">
         {confirmed?<><button type="button" disabled={busy} onClick={()=>setConfirmed(false)}>Cancel</button>
           <button type="button" className="primary" disabled={busy} onClick={()=>act(action)}>{busy?'Processing…':`Confirm ${action==='pick'?'selection':'operation'}`}</button></>:
           <button type="button" className="primary" disabled={busy} onClick={()=>setConfirmed(true)}>{actionText}</button>}
       </div>}
     </section>}
     {rights&&<div className="bmOnlineSeasonToolbar"><div className="bmOnlineSeasonTabs" role="group" aria-label="Draft tabs">
       {[['board','Draft order'],['prospects','Prospects'],['results','Selections']].map(([key,label])=><button type="button" key={key} className={show===key?'active':''} onClick={()=>setShow(key)}>{label}</button>)}</div>
       {show==='prospects'&&<input className="bmOnlineDraftSearch" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search prospects or positions" aria-label="Search prospects"/>}</div>}
     {rights&&<div className="bmOnlineSeasonScroll bmOnlineDraftScroll" role="region" aria-label="NBA Draft information">
       {show==='board'&&<div className="bmOnlineDraftTable"><div className="bmOnlineDraftTableTitle">OFFICIAL PICK OWNERSHIP · {leagueYear}</div>
         {order.map((p,i)=><div key={p.pick} className={`bmOnlineDraftPick ${active&&i===index?'on-clock':''}`}>
           <div className="bmOnlineDraftPosition">#{p.pick}</div>{memberOwners.get(p.currentOwnerTeamName)&&<img src={memberOwners.get(p.currentOwnerTeamName)} alt=""/>}
           <div className="bmOnlineDraftTeam"><strong>{p.currentOwnerTeamName}</strong><span>From {p.originalTeamName}{p.ownershipType?.startsWith('swap')?' · Swap right':p.draftPickProtection&&p.draftPickProtection!=='Unprotected'?` · ${p.draftPickProtection}`:''}</span></div>
           <span className="bmOnlineDraftPickOwnership">{i<history.length?history[i]?.playerName||'Selected':active&&i===index?'On the clock':`Round ${p.round}`}</span>
         </div>)}
       </div>}
       {show==='prospects'&&<div className="bmOnlineDraftProspects"><div className="bmOnlineDraftTableTitle">AVAILABLE PROSPECTS · {prospects.length} REMAINING</div>
         {!draft&&<p className="bmOnlineDraftInlineNotice">The draft class becomes available after the host opens the NBA Draft.</p>}
         {visibleProspects.map(p=><button type="button" key={p.id} className={`bmOnlineDraftProspect ${selected===String(p.id)?'selected':''}`} disabled={!myTurn||busy} onClick={()=>{setSelected(String(p.id));setConfirmed(false);}}>
           <div className="bmOnlineDraftProspectRank">#{p.draftProjection||p.rank||'—'}</div>
           <div className="bmOnlineDraftProspectInfo"><strong>{nameOf(p)}</strong><span>{p.pos||p.position||'—'} · {p.age||'—'} yrs · {p.college||p.school||p.draftSource||'Prospect'}</span></div>
           <div className="bmOnlineDraftProspectRatings"><b>{val(p,'overall','ovr')}</b><span>OVR</span></div>
           <div className="bmOnlineDraftProspectRatings"><b>{val(p,'potential','pot')}</b><span>POT</span></div>
           {selected===String(p.id)&&<span className="bmOnlineDraftChosen">Selected</span>}
         </button>)}
         {active&&!visibleProspects.length&&<p className="bmOnlineDraftInlineNotice">No available prospects match this search.</p>}
       </div>}
       {show==='results'&&<div className="bmOnlineDraftTable"><div className="bmOnlineDraftTableTitle">OFFICIAL SELECTION HISTORY</div>
         {history.map(row=><div key={row.pick} className="bmOnlineDraftPick"><div className="bmOnlineDraftPosition">#{row.pick}</div>
          <div className="bmOnlineDraftTeam"><strong>{row.playerName}</strong><span>{row.teamName} · {row.pos} · OVR {row.overall} / POT {row.potential}</span></div>
          <span className="bmOnlineDraftPickOwnership">Pending rookie signing</span></div>)}
         {!history.length&&<p className="bmOnlineDraftInlineNotice">No draft picks have been submitted yet.</p>}
       </div>}
     </div>}
   </>}
   {error&&<div className="bmOnlineSeasonActionError" role="alert">{error} <button type="button" onClick={()=>onAccepted?.()}>Refresh league</button></div>}
   {notice&&<div className="bmOnlineDraftInlineNotice" role="status">{notice}</div>}
   {complete&&<Link className="bmOnlineDraftContinue" to={`${lobbyPath}?view=${encodeURIComponent('/rookie-signings')}`}>Continue to Rookie Signings</Link>}
   <footer className="bmOnlineSeasonFooter">Draft results are server-authorized. Unsigned rookies require a separate Rookie Signings stage. No local single-player league data is written.</footer>
 </main>;
}
