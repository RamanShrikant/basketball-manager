import {trustedOnlineApiBase} from './onlineCalendarBootstrap.js';
// Online postseason. Bracket/player rules are generated on the trusted backend.
// Original single-player bracket layout is preserved via onlineReadModel adapter.
import React,{useMemo,useRef,useState,useEffect} from 'react';
import {Link} from 'react-router-dom';
import {useGame} from './onlineReadOnlyContext.jsx';
import {supabase} from '../auth/supabaseClient.js';
import {readOnlineBracket,readOnlineGames,formatGameDate} from './onlineSeasonReadModel.mjs';
import {onlinePostseasonRequestId,clearOnlinePostseasonRequestId} from './onlinePostseasonRequestId.mjs';
import {findPendingOnlinePlayoffGame,onlineSeriesPlayedGames,onlinePlayoffCompletion} from './onlinePlayoffReadModel.mjs';
import './online-season.css';

const allTeams=league=>Array.isArray(league?.teams)?league.teams:Object.values(league?.conferences||{}).flat().filter(Boolean);
const logoOf=t=>t?.logo||t?.teamLogo||t?.newTeamLogo||t?.logoUrl||'';
function nameOf(team){return typeof team==='string'?team:'';}
function Series({data,title,logos,results,onBox}){
  const high=nameOf(data?.highSeedTeam)||'TBD',low=nameOf(data?.lowSeedTeam)||'TBD';
  const played=onlineSeriesPlayedGames(data,results);
  const won=data?.complete?(Number(data.winsHigh)===4?high:low):null;
  return <div className="bmOnlineSeries" data-series-complete={Boolean(data?.complete)}>
    <header>{title}{data?.complete&&<span className="bmOnlineSeriesStatus">FINAL</span>}</header>
    {[[high,data?.highSeedNum,data?.winsHigh],[low,data?.lowSeedNum,data?.winsLow]].map(([name,seed,wins],i)=><div key={i} className="bmOnlineSeriesTeam"><small>{seed||'—'}</small>{logos.get(name)&&<img src={logos.get(name)} alt=""/>}<strong className={name==='TBD'?'pending':''}>{name}{won===name?' ✓':''}</strong><span>{Number.isFinite(Number(wins))&&data?Number(wins):'—'}</span></div>)}
    {!!played.length&&<div className="bmOnlineSeriesGames" aria-label={`Completed games in ${title}`}>
      {played.map(g=><button type="button" key={g.id} title={`Game ${g.gameNumber} · ${g.result?'View box score':'Result unavailable'}`} disabled={!g.result?.box} onClick={()=>onBox(g.id)}>G{g.gameNumber}</button>)}
    </div>}
  </div>;
}
function ConferenceBracket({name,data,logos,results,onBox}){
  const rounds=data?.rounds||{};
  const groups=[['FIRST ROUND',rounds.r1],['SEMIFINALS',rounds.r2],['CONFERENCE FINALS',rounds.r3]];
  return <section className="bmOnlineConference"><h2>{name}</h2><div className="bmOnlineBracketRounds">{groups.map(([title,series])=><div key={title} className="bmOnlineBracketRound"><h3>{title}</h3>{Object.entries(series||{}).map(([key,item])=><Series key={key} data={item} title={title} logos={logos} results={results} onBox={onBox}/>)}{!series||!Object.keys(series).length?<p>Not seeded</p>:null}</div>)}</div></section>;
}
function pendingPlayIn(bracket){
  const rows=[];
  for(const [conf,data] of Object.entries(bracket?.conferences||{})){
    for(const k of ['g78','g910','gFinal']){
      const node=data?.playIn?.[k];
      if(node&&!node.played&&node.home&&node.away&&node.date)rows.push({conf,key:k,...node});
    }
  }
  return rows.sort((a,b)=>a.date.localeCompare(b.date)||String(a.id).localeCompare(String(b.id)));
}
export default function OnlinePlayoffPicturePreview(){
  const {leagueData,lobbyId,revision,isHost,onAccepted}=useGame();
  const bracket=readOnlineBracket(leagueData);
  const games=useMemo(()=>readOnlineGames(leagueData),[leagueData]);
  const completed=games.filter(g=>g.played).length;
  const readyToSeed=games.length===1230&&completed===1230;
  const logos=useMemo(()=>new Map(allTeams(leagueData).map(t=>[t.name,logoOf(t)])),[leagueData]);
  const [show,setShow]=useState('play-in');
  const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [boxGame,setBoxGame]=useState(null);
  const lock=useRef(false);
  const confs=bracket?.conferences||{};
  const pending=pendingPlayIn(bracket);
  const next=pending[0]||null;
  const stage=bracket?.phase||null;
  const nextSeries=useMemo(()=>findPendingOnlinePlayoffGame(leagueData?.onlinePostseason),[leagueData?.onlinePostseason]);
  const seriesProgress=useMemo(()=>onlinePlayoffCompletion(leagueData?.onlinePostseason),[leagueData?.onlinePostseason]);
  const boxResult=boxGame?leagueData?.onlinePostseasonResults?.[boxGame]:null;
  useEffect(()=>{if(stage==='playoffs'||stage==='postseasonComplete')setShow('playoffs');},[stage]);
  useEffect(()=>{
    if(!boxGame)return;
    const onEscape=e=>{if(e.key==='Escape')setBoxGame(null);};
    window.addEventListener('keydown',onEscape);return ()=>window.removeEventListener('keydown',onEscape);
  },[boxGame]);
  async function performAction(action){
    if(!isHost||!confirm||busy||lock.current||!lobbyId)return;
    lock.current=true;setBusy(true);setError('');
    const operation=action==='seed'?'seed':action==='playoff'?`playoff:${nextSeries?.id||'none'}`:`play-in:${next?.id||'none'}`;
    try{
      const {data:{session},error:authError}=await supabase.auth.getSession();
      if(authError||!session?.access_token)throw Error('Your online session expired. Sign in again.');
      const url=trustedOnlineApiBase();
      if(!url)throw Error('Trusted multiplayer postseason backend is not configured.');
      const route=action==='seed'?'initialize':action==='playoff'?'simulate-playoff':'simulate-playin';
      const response=await fetch(`${url}/api/online/postseason/${route}`,{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
        body:JSON.stringify({lobbyId,expectedRevision:Number(revision),requestId:onlinePostseasonRequestId(lobbyId,operation)})
      });
      const data=await response.json().catch(()=>null);
      if(!response.ok||!data?.ok)throw Error(data?.error||'The postseason operation was not committed.');
      clearOnlinePostseasonRequestId(lobbyId,operation);setConfirm(false);
      await onAccepted?.();
    }catch(e){setError(e?.message||String(e));}
    finally{setBusy(false);lock.current=false;}
  }
  return <main className="bmOnlineSeasonPage bmOnlinePlayoffs" data-online-season-view="playoff-picture">
    <header className="bmOnlineSeasonHeading"><div><div className="bmOnlineSeasonEyebrow">BASKETBALL MANAGER · ONLINE FRANCHISE</div><h1>Playoff Picture</h1><p>One shared NBA postseason, seeded from completed regular-season results.</p></div><div className="bmOnlineSeasonSummary"><small>LEAGUE STATUS</small><strong>{bracket?(stage==='postseasonComplete'?'NBA Champion Crowned':stage==='playoffs'?'NBA Playoffs':'Play-In tournament'):readyToSeed?'Ready to seed':'Regular season'}</strong><span>{completed} / {games.length} regular-season games final</span></div></header>
    {!bracket&&readyToSeed&&<section className="bmOnlineSeasonHostControls" aria-label="Postseason seeding"><div><small>{isHost?'HOST CONTROL':'AWAITING HOST'}</small><strong>Initialize NBA postseason</strong><p>Freeze the completed standings using the same single-player tiebreakers, then create both Play-In brackets and the complete seven-game series structure. This can only happen once.</p></div>
      {isHost&&(confirm?<div className="bmOnlineSeasonHostActions"><button type="button" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button><button type="button" className="primary" disabled={busy} onClick={()=>performAction('seed')}>{busy?'Seeding…':'Confirm seeds'}</button></div>:<button type="button" onClick={()=>{setError('');setConfirm(true);}}>Seed postseason</button>)}
    </section>}
    {bracket&&stage==='playIn'&&<section className="bmOnlineSeasonHostControls" aria-label="Host Play-In simulation"><div><small>{isHost?'HOST · PLAY-IN':'PLAY-IN IN PROGRESS'}</small><strong>{next?`${next.conf} · ${next.home} vs ${next.away}`:'Preparing first-round bracket'}</strong><p>{next?`${formatGameDate(next.date)} · One authoritative game, original Python engine, shared box score and injury updates.`:'All Play-In games have finished. Refresh the shared league.'}</p></div>
      {isHost&&next&&(confirm?<div className="bmOnlineSeasonHostActions"><button type="button" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button><button type="button" className="primary" disabled={busy} onClick={()=>performAction('game')}>{busy?'Simulating…':'Confirm game'}</button></div>:<button type="button" disabled={busy} onClick={()=>{setError('');setConfirm(true);}}>Simulate next Play-In</button>)}
    </section>}
    {bracket&&stage==='playoffs'&&nextSeries&&<section className="bmOnlineSeasonHostControls bmOnlinePlayoffNext" aria-label="Next authoritative playoff game"><div><small>{isHost?'HOST · PLAYOFFS':'PLAYOFFS IN PROGRESS'}</small><strong>{nextSeries.conf==='NBA'?'NBA FINALS':`${nextSeries.conf} · ${nextSeries.round.toUpperCase()}`} · Game {nextSeries.gameNumber}</strong><p>{nextSeries.away} at {nextSeries.home} · {formatGameDate(nextSeries.date)}</p><p>{seriesProgress.finished} of 15 series completed · Every game is saved to the shared league before the next begins.</p></div>
      {isHost&&(confirm?<div className="bmOnlineSeasonHostActions"><button type="button" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button><button type="button" className="primary" disabled={busy} onClick={()=>performAction('playoff')}>{busy?'Simulating…':'Confirm playoff game'}</button></div>:<button type="button" disabled={busy} onClick={()=>{setError('');setShow('playoffs');setConfirm(true);}}>Simulate next playoff game</button>)}
    </section>}
    {bracket&&stage==='postseasonComplete'&&<section className="bmOnlineChampionPanel" aria-label="NBA champion"><small>{bracket.seasonYear}–{Number(bracket.seasonYear)+1} · NBA CHAMPIONS</small><h2>{bracket.champion}</h2><p>The Finals have concluded. All series results and box scores are frozen in the shared online franchise.</p><Link className="bmOnlineDraftContinue" to={`/online/franchise/${lobbyId}?view=${encodeURIComponent("/draft-lottery")}`}>Continue to NBA Draft Lottery</Link></section>}
    {error&&<p className="bmOnlineSeasonActionError" role="alert">{error} <button type="button" onClick={()=>onAccepted?.()}>Refresh league</button></p>}
    {bracket?<><div className="bmOnlineSeasonToolbar"><div className="bmOnlineSeasonTabs" role="group" aria-label="Postseason view"><button type="button" className={show==='play-in'?'active':''} onClick={()=>{setShow('play-in');setConfirm(false);}}>Play-In</button><button type="button" className={show==='playoffs'?'active':''} onClick={()=>{setShow('playoffs');setConfirm(false);}}>Playoffs</button></div></div>
    {show==='playoffs'?<div className="bmOnlineSeasonScroll bmOnlineBracketScroll"><div className="bmOnlineBracketConferences">{Object.entries(confs).map(([name,data])=><ConferenceBracket key={name} name={name} data={data} logos={logos} results={leagueData?.onlinePostseasonResults} onBox={setBoxGame}/>)}</div><section className="bmOnlineFinals"><h2>NBA Finals</h2><Series data={bracket.finals} title="CHAMPIONSHIP" logos={logos} results={leagueData?.onlinePostseasonResults} onBox={setBoxGame}/>{bracket.champion&&<p>Champion: {bracket.champion}</p>}</section></div>:
    <div className="bmOnlineSeasonScroll bmOnlinePlayInGrid">{Object.entries(confs).map(([name,data])=><section key={name} className="bmOnlineConference"><h2>{name} Play-In</h2>{['g78','g910','gFinal'].map((k,i)=>{const node=data?.playIn?.[k],result=node?.id&&leagueData?.onlinePostseasonResults?.[node.id];return <div key={k} className="bmOnlinePlayInNode"><h3>{['7 vs 8','9 vs 10','Final Seed Game'][i]}</h3><p>{node?.home||'TBD'} <b>vs</b> {node?.away||'TBD'}</p>{node?.date&&<small>{formatGameDate(node.date)}</small>}{node?.played&&<div className="bmOnlinePlayInOutcome"><strong>{node.awayScore} – {node.homeScore}</strong><span>{node.winner} advances</span>{result?.box&&<button type="button" onClick={()=>setBoxGame(String(node.id))}>Box score</button>}</div>}</div>;})}<p className="bmOnlinePlayInSeeding">7th seed: {data?.playIn?.seed7||'TBD'} · 8th seed: {data?.playIn?.seed8||'TBD'}</p></section>)}</div>}
    </>:<section className="bmOnlineSeasonEmpty"><div className="bmOnlineSeasonEmptyMark">NBA</div><h2>{games.length?'Complete the regular season to unlock the Play-In':'The Online playoffs haven’t been seeded'}</h2><p>Only the league host can initialize a postseason from all 1,230 completed shared results. No browser-side predictions or single-player save data are used.</p></section>}
    {boxGame&&boxResult&&<div className="bmOnlineSeasonModalScrim" role="presentation" onClick={()=>setBoxGame(null)}><section className="bmOnlineSeasonBoxModal" role="dialog" aria-modal="true" aria-label="Shared postseason box score" onClick={e=>e.stopPropagation()}><div className="bmOnlineSeasonBoxHeader"><div><small>NBA POSTSEASON · FINAL</small><h2>{boxResult.away} {boxResult.awayScore} — {boxResult.homeScore} {boxResult.home}</h2><p>{formatGameDate(boxResult.date)}</p></div><button type="button" aria-label="Close postseason box score" onClick={()=>setBoxGame(null)}>✕</button></div>{['away','home'].map(side=><div key={side} className="bmOnlineSeasonBoxTableWrap"><h3>{boxResult[side]}</h3><table><thead><tr>{['PLAYER','MIN','PTS','REB','AST','STL','BLK','FG','3PT','FT'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{(boxResult.box?.[side]||[]).map((p,i)=><tr key={i}><td>{p.player}</td><td>{p.min}</td><td>{p.pts}</td><td>{p.reb}</td><td>{p.ast}</td><td>{p.stl}</td><td>{p.blk}</td><td>{p.fg}</td><td>{p['3p']}</td><td>{p.ft}</td></tr>)}</tbody></table></div>)}</section></div>}
    <footer className="bmOnlineSeasonFooter">Play-In and best-of-seven series use the original Python game engine and locked shared-league transactions. Host actions cannot rewrite completed games.</footer>
  </main>;
}
