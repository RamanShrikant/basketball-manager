// Phase 2E.1: immutable server-drawn lottery, no local draft or pick-owner writes.
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {useGame} from './onlineReadOnlyContext.jsx';
import {supabase} from '../auth/supabaseClient.js';
import {onlinePostseasonRequestId,clearOnlinePostseasonRequestId} from './onlinePostseasonRequestId.mjs';
import './online-season.css';
const teamsOf=league=>Array.isArray(league?.teams)?league.teams:Object.values(league?.conferences||{}).flat().filter(Boolean);
export default function OnlineDraftLottery(){
  const {leagueData,lobbyId,revision,isHost,onAccepted}=useGame();
  const championship=leagueData?.onlinePostseason;
  const lottery=leagueData?.onlineDraftLottery;
  const result=lottery?.result;
  const rights=leagueData?.onlineDraftRights;
  const settledOrder=rights?.order||[];
  const ownerBySlot=new Map(settledOrder.map(p=>[Number(p.pick),p]));
  const ready=championship?.phase==='postseasonComplete';
  const retirementReady=leagueData?.onlineRetirements?.status==='complete';
  const seasonYear=Number(championship?.seasonYear);
  const draftYear=lottery?.draftYear||(Number.isInteger(seasonYear)?seasonYear+1:null);
  const [stage,setStage]=useState('first');
  const [confirm,setConfirm]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const lock=useRef(false);
  const logos=useMemo(()=>new Map(teamsOf(leagueData).map(team=>[
    team?.name,team?.logo||team?.teamLogo||team?.newTeamLogo||team?.logoUrl||''
  ])),[leagueData]);
  useEffect(()=>{setConfirm(false);setError('');},[revision,lobbyId]);
  async function draw(){
    if(!isHost||!ready||!retirementReady||lottery||!confirm||busy||lock.current||!lobbyId)return;
    lock.current=true;setBusy(true);setError('');
    try{
      const {data:{session},error:authError}=await supabase.auth.getSession();
      if(authError||!session?.access_token)throw Error('Your online session expired. Sign in again.');
      const backend=String(import.meta.env.VITE_BM_ONLINE_CPU_API_URL||'').replace(/\/$/,'');
      if(!backend)throw Error('The trusted online draft backend is not configured.');
      const requestId=onlinePostseasonRequestId(lobbyId,'draft-lottery');
      const response=await fetch(`${backend}/api/online/draft/draw-lottery`,{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
        body:JSON.stringify({lobbyId,requestId,expectedRevision:Number(revision)})
      });
      const answer=await response.json().catch(()=>null);
      if(!response.ok||!answer?.ok)throw Error(answer?.error||'The shared lottery was not committed.');
      clearOnlinePostseasonRequestId(lobbyId,'draft-lottery');setConfirm(false);
      await onAccepted?.();
    }catch(e){setError(e.message||String(e));}
    finally{setBusy(false);lock.current=false;}
  }
  const picks=stage==='second'?result?.secondRoundOrder||[]:result?.firstRoundOrder||[];
  return <main className="bmOnlineSeasonPage bmOnlineDraftLottery" data-online-season-view="draft-lottery">
    <header className="bmOnlineSeasonHeading"><div><div className="bmOnlineSeasonEyebrow">BASKETBALL MANAGER · ONLINE FRANCHISE</div>
      <h1>NBA Draft Lottery</h1><p>The original single-player NBA lottery, generated once for every manager.</p></div>
      <div className="bmOnlineSeasonSummary"><small>DRAFT CLASS</small><strong>{draftYear||'—'}</strong><span>{lottery?'Official shared order':ready?'Ready for host draw':'Postseason in progress'}</span></div>
    </header>
    {!ready&&<div className="bmOnlineSeasonEmpty"><div className="bmOnlineSeasonEmptyMark">NBA</div><h2>Finish the NBA Finals first</h2><p>The lottery uses the final standings and Play-In results. It cannot be drawn while postseason games remain unfinished.</p></div>}
    {ready&&!retirementReady&&!lottery&&<section className="bmOnlineSeasonEmpty"><h2>Complete retirements first</h2><p>The original single-player offseason processes retirements before the NBA Draft Lottery.</p><Link className="bmOnlineDraftContinue" to={`/online/franchise/${lobbyId}?view=${encodeURIComponent('/retirements')}`}>Open Retirements</Link></section>}
    {ready&&retirementReady&&!lottery&&<section className="bmOnlineSeasonHostControls"><div><small>{isHost?'HOST · NBA DRAFT':'AWAITING HOST'}</small><strong>Draw the {draftYear} NBA Draft Lottery</strong><p>Use the original Python odds and complete shared-season standings. This is a single irreversible draw; the host cannot reroll it, and no pick rights transfer yet.</p></div>
      {isHost&&(confirm?<div className="bmOnlineSeasonHostActions"><button type="button" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button><button type="button" className="primary" disabled={busy} onClick={draw}>{busy?'Drawing…':'Confirm official draw'}</button></div>:<button type="button" onClick={()=>setConfirm(true)}>Prepare lottery</button>)}
    </section>}
    {ready&&lottery&&<>
      <div className="bmOnlineDraftSummary" role="status"><div><small>OFFICIAL ORDER</small><strong>{result?.meta?.systemLabel||lottery.system||'NBA Draft Lottery'}</strong><span>One result shared across all connected GMs</span></div><div><small>LOTTERY ENTRIES</small><strong>{result?.lotteryTeams?.length||'—'}</strong><span>Original lottery algorithm</span></div><div><small>PICK OWNERSHIP</small><strong className={rights?"":"pending"}>{rights?"Official ownership settled":"Pending settlement"}</strong><span>{rights?"All protected rights and swaps are finalized":"Protections and swaps resolve in NBA Draft"}</span></div></div>
      <div className="bmOnlineSeasonToolbar"><div className="bmOnlineSeasonTabs" role="group" aria-label="Draft order round"><button type="button" className={stage==='first'?'active':''} onClick={()=>setStage('first')}>First round</button><button type="button" className={stage==='second'?'active':''} onClick={()=>setStage('second')}>Second round</button><button type="button" className={stage==='odds'?'active':''} onClick={()=>setStage('odds')}>Lottery odds</button></div></div>
      <div className="bmOnlineSeasonScroll bmOnlineDraftScroll" role="region" aria-label="Official NBA draft lottery order">
        {stage==='odds'?<div className="bmOnlineDraftTable"><div className="bmOnlineDraftTableTitle">LOTTERY ENTRIES · {result?.meta?.systemLabel}</div>
          {(result?.preLotteryOdds||[]).map((row,i)=><div key={row.teamName||i} className="bmOnlineDraftPick"><div className="bmOnlineDraftPosition">{String(i+1).padStart(2,'0')}</div>{logos.get(row.teamName)&&<img alt="" src={logos.get(row.teamName)}/>}
          <div className="bmOnlineDraftTeam"><strong>{row.teamName}</strong><span>{row.wins}–{row.losses} · Expected #{row.expectedPick??'—'}</span></div><div className="bmOnlineDraftOdds">{Number(row.firstPickOddsPct||0).toFixed(1)}% <small>NO. 1</small></div></div>)}
        </div>:<div className="bmOnlineDraftTable"><div className="bmOnlineDraftTableTitle">ROUND {stage==='first'?1:2} · ORIGINAL TEAM ORDER</div>
          {picks.map(row=><div key={`${row.round}-${row.pick}`} className="bmOnlineDraftPick"><div className="bmOnlineDraftPosition">#{row.pick}</div>{logos.get(row.teamName)&&<img alt="" src={logos.get(row.teamName)}/>}
            <div className="bmOnlineDraftTeam"><strong>{ownerBySlot.get(Number(row.pick))?.currentOwnerTeamName||row.teamName}</strong><span>Original: {row.originalTeamName||row.teamName} · {row.wins}–{row.losses}</span></div><span className="bmOnlineDraftPickOwnership">{rights?(ownerBySlot.has(Number(row.pick))?"Official owner":"Forfeited"):"Rights pending"}</span></div>)}
        </div>}
      </div>
    </>}
    {ready&&lottery&&<Link className="bmOnlineDraftContinue" to={`/online/franchise/${lobbyId}?view=${encodeURIComponent("/nba-draft")}`}>Continue to NBA Draft</Link>}
    {error&&<p role="alert" className="bmOnlineSeasonActionError">{error} <button type="button" onClick={()=>onAccepted?.()}>Refresh league</button></p>}
    <footer className="bmOnlineSeasonFooter">The lottery order is final once drawn. It does not transfer traded picks, settle Top-N protections or swaps, assign rookies or advance the season. Those require the authoritative Online Draft.</footer>
  </main>;
}
