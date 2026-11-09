// Online-only Coach Gameplan. Same manual 240-minute limits as finished single-player.
// No single-player persistence is mounted or written.
import React, {useEffect,useMemo,useRef,useState} from 'react';
import {useGame} from './onlineReadOnlyContext.jsx';
import {saveOnlineCoachGameplan} from './onlineRuntimeClient.js';
import {buildAvailabilityGameplanPayload,isPlayerInjured} from '../utils/injurySystem.js';
import {readOnlineGames} from './onlineSeasonReadModel.mjs';
import PlayerPortraitFrame from '../components/PlayerPortraitFrame';
import PlayerRatingRing from '../components/PlayerRatingRing.jsx';
import '../styles/BMAnimations.css';

const allTeams = league => Array.isArray(league?.teams)?league.teams:Object.values(league?.conferences||{}).flat().filter(Boolean);
const logo = team => team?.logo||team?.teamLogo||team?.newTeamLogo||team?.logoUrl||'';
const rating = p => Number(p?.overall??p?.ovr??0)||0;
const total = minutes => Object.values(minutes||{}).reduce((n,value)=>n+Number(value||0),0);
const sameNames = (team,plan) => {
  const names=(team?.players||[]).map(p=>p?.name);
  return Array.isArray(plan?.order)&&plan.order.length===names.length&&new Set(plan.order).size===names.length&&
    names.every(name=>plan.order.includes(name))&&Object.keys(plan.minutes||{}).length===names.length&&
    (!plan.rosterPlayerIds||names.every(name=>String(plan.rosterPlayerIds[name]??'')===String(team.players.find(p=>p.name===name)?.id??team.players.find(p=>p.name===name)?.playerId??'')));
};
function defaultPlan(team,date) {
  const auto=buildAvailabilityGameplanPayload(team,date,{source:'online_server_auto_rotation'});
  return {order:auto.order,minutes:auto.minutes};
}
// Existing public projection helper retained for older preview assertions.
export function projectedRotation(team){
  const plan=defaultPlan(team,null);
  const map=new Map((team?.players||[]).map(p=>[p.name,p]));
  return {players:plan.order.map(name=>map.get(name)).filter(Boolean),mins:plan.minutes,assigned:total(plan.minutes)};
}
export default function OnlineCoachGameplanPreview(){
  const {leagueData,selectedTeam,lobbyId,revision,onAccepted}=useGame();
  const teams=useMemo(()=>allTeams(leagueData).slice().sort((a,b)=>a.name.localeCompare(b.name)),[leagueData]);
  const [teamName,setTeamName]=useState(null);
  const team=teams.find(t=>t.name===(teamName||selectedTeam?.name))||selectedTeam||teams[0];
  const canEdit=team?.name===selectedTeam?.name;
  const [playerName,setPlayerName]=useState(null);
  const [draft,setDraft]=useState(null);
  const [dirty,setDirty]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  const request=useRef(null);
  const savedRevision=useRef(null);
  const games=useMemo(()=>readOnlineGames(leagueData),[leagueData]);
  const date=games.find(g=>!g.played)?.date||null;
  const persisted=leagueData?.onlineGameplans?.[team?.name];
  const rosterIdentity=team?.players?.map(p=>`${p.name}:${p.id||p.playerId||''}`).sort().join('|');
  // Reinitialize only on team/roster change, not every background journal refresh.
  useEffect(()=>{
    if(!team)return;
    const base=sameNames(team,persisted)?{order:[...persisted.order],minutes:{...persisted.minutes}}:defaultPlan(team,date);
    setDraft(base);setDirty(false);setError('');setSuccess('');request.current=null;savedRevision.current=String(revision);
  },[team?.name,rosterIdentity]);
  // Follow other managers' league changes while idle; never overwrite unsaved edits.
  useEffect(()=>{
    if(!team||dirty||saving||String(savedRevision.current)===String(revision))return;
    setDraft(sameNames(team,persisted)?{order:[...persisted.order],minutes:{...persisted.minutes}}:defaultPlan(team,date));
    savedRevision.current=String(revision);request.current=null;
  },[revision,dirty,saving,team?.name,rosterIdentity,persisted,date]);
  const actual=useMemo(()=>{
    if(!team)return null;
    if(draft&&sameNames(team,draft))return draft;
    return sameNames(team,persisted)?{order:persisted.order,minutes:persisted.minutes}:defaultPlan(team,date);
  },[team,draft,persisted,date]);
  const players=useMemo(()=>{
    const map=new Map((team?.players||[]).map(p=>[p.name,p]));
    return (actual?.order||[]).map(name=>map.get(name)).filter(Boolean);
  },[team,actual]);
  const assigned=total(actual?.minutes);
  const activePlayer=players.find(p=>p.name===playerName)||players[0];
  const index=teams.findIndex(t=>t.name===team?.name);
  const moveTeam=direction=>{if(!teams.length)return;const next=teams[(index+direction+teams.length)%teams.length];setTeamName(next.name);setPlayerName(null);};
  const editMinutes=(name,value)=>{
    if(!canEdit||saving)return;
    const idx=actual.order.indexOf(name),player=players[idx];
    if(isPlayerInjured(player,date))return;
    const next=Number(value),max=idx<5?48:47,min=idx<5?1:0;
    if(!Number.isInteger(next)||next<min||next>max)return;
    setDraft({...actual,minutes:{...actual.minutes,[name]:next}});
    setDirty(true);setError('');setSuccess('');request.current=null;
  };
  const movePlayer=(name,delta)=>{
    if(!canEdit||saving)return;
    const idx=actual.order.indexOf(name),target=idx+delta;
    if(idx<0||target<0||target>=actual.order.length)return;
    const reordered=[...actual.order];[reordered[idx],reordered[target]]=[reordered[target],reordered[idx]];
    const adjusted={...actual.minutes};
    // A promoted starter must play and an injured player cannot start.
    if(reordered.slice(0,5).some(n=>isPlayerInjured(team.players.find(p=>p.name===n),date)||adjusted[n]<1)){
      setError('Give every starter at least one minute and keep injured players on the bench before changing the starting five.');return;
    }
    if(reordered.slice(5).some(n=>adjusted[n]>47)){
      setError('Bench players cannot be assigned more than 47 minutes.');return;
    }
    setDraft({...actual,order:reordered});setDirty(true);setError('');setSuccess('');request.current=null;
  };
  const auto=()=>{if(!canEdit||saving)return;setDraft(defaultPlan(team,date));setDirty(true);setError('');setSuccess('');request.current=null;};
  const save=async()=>{
    if(!canEdit||saving||!dirty)return;
    if(String(savedRevision.current)!==String(revision)){
      setError('Your league changed while editing. Refresh this screen to review the current roster before saving.');return;
    }
    if(assigned!==240){setError(`Allocate exactly 240 minutes (${assigned} currently).`);return;}
    for(const [i,name] of actual.order.entries()){
      const m=actual.minutes[name],p=team.players.find(p=>p.name===name);
      if(!Number.isInteger(m)||m<(i<5?1:0)||m>(i<5?48:47)|| (m>0&&isPlayerInjured(p,date))){
        setError('Starters must play 1–48 minutes, bench players 0–47, and injured players 0.');return;
      }
    }
    setSaving(true);setError('');
    try{
      if(!request.current)request.current=crypto.randomUUID();
      await saveOnlineCoachGameplan({lobbyId,requestId:request.current,expectedRevision:revision,order:actual.order,minutes:actual.minutes});
      request.current=null;setDirty(false);setSuccess('Rotation saved for your shared franchise.');
      await onAccepted?.();
    }catch(e){setError(e?.message||String(e));}
    finally{setSaving(false);}
  };
  if(!team||!actual)return <div className="bmOnlinePreviewEmpty">No teams are available in the shared league.</div>;
  return <div className="bmOnlinePreviewPage bmOnlineCoachPreview" data-online-preview="coach-gameplan">
    <header className="bmOnlinePreviewHeader">
      <button type="button" aria-label="Previous Team" onClick={()=>moveTeam(-1)}>◄</button>
      <div>{logo(team)&&<img alt="" src={logo(team)}/>}<h1>{team.name} Coach Gameplan</h1></div>
      <button type="button" aria-label="Next Team" onClick={()=>moveTeam(1)}>►</button>
    </header>
    <div className="bmOnlinePreviewSub">{canEdit?'Your rotation · Shared franchise · Server-authorized saves':'Viewing another team · Only its manager may edit'} {persisted&&canEdit?' · Saved manual gameplan':''}</div>
    <section className="bmOnlineCoachHero">
      {activePlayer&&<>
        <div className="bmOnlineCoachPlayer">
          <PlayerPortraitFrame src={activePlayer.headshot} player={activePlayer} team={team} teamName={team.name} alt={activePlayer.name} className="bmOnlineCoachPortrait"/>
          <div><h2>{activePlayer.name}</h2><p>{activePlayer.pos||activePlayer.position||'—'} · Age {activePlayer.age??'—'}</p></div>
        </div>
        <div className="bmOnlineCoachHeroRight"><PlayerRatingRing overall={rating(activePlayer)} size={84} showPotential={false}/><div className="bmOnlineCoachMinutes"><strong>{assigned} / 240</strong><small>ASSIGNED MINUTES</small></div></div>
      </>}
    </section>
    <div className="bmOnlineCoachTable" role="region" aria-label="Online coach gameplan minutes and lineup">
      <table><thead><tr><th>LINEUP</th><th>POS</th><th>PLAYER</th><th>OVR</th><th>MINUTES</th>{canEdit&&<th>ORDER</th>}</tr></thead><tbody>
        {players.map((p,i)=><React.Fragment key={p.id||p.playerId||p.name}>
          {i===5&&<tr className="bmOnlineCoachSection"><td colSpan={canEdit?6:5}>BENCH</td></tr>}
          <tr className={p.name===activePlayer?.name?'bmOnlineCoachSelected':''} onClick={()=>setPlayerName(p.name)}>
            <td>{i<5?'STARTER':i+1}</td><td>{p.pos||p.position||'—'}</td><td>{p.name}{isPlayerInjured(p,date)&&<small className="bmOnlineCoachInjured">INJURED</small>}</td><td>{rating(p)}</td>
            <td><div className="bmOnlineCoachMinutesCell"><span className="bmOnlineCoachTrack"><i style={{width:`${Math.min(100,Math.max(0,actual.minutes[p.name]||0)/48*100)}%`}}/></span>
              {canEdit?<input aria-label={`${p.name} minutes`} type="number" min={i<5?1:0} max={i<5?48:47} step="1" value={actual.minutes[p.name]||0} disabled={saving||isPlayerInjured(p,date)} onClick={e=>e.stopPropagation()} onChange={e=>editMinutes(p.name,e.target.value)} />:<b>{actual.minutes[p.name]||0}</b>}</div></td>
            {canEdit&&<td><div className="bmOnlineCoachOrder"><button type="button" aria-label={`Move ${p.name} up`} disabled={saving||i===0} onClick={e=>{e.stopPropagation();movePlayer(p.name,-1);}}>↑</button><button type="button" aria-label={`Move ${p.name} down`} disabled={saving||i===players.length-1} onClick={e=>{e.stopPropagation();movePlayer(p.name,1);}}>↓</button></div></td>}
          </tr>
        </React.Fragment>)}
      </tbody></table>
    </div>
    {error&&<div className="bmOnlineCoachMessage" role="alert">{error}</div>}
    {success&&!error&&<div className="bmOnlineCoachMessage success" role="status">{success}</div>}
    <footer className="bmOnlinePreviewFooter"><span>{canEdit?'Starting five: 1–48 min · Bench: 0–47 min · Injured: 0 min':'Read-only: another team controls this rotation'}{dirty?' · UNSAVED':''}</span>
      {canEdit&&<div className="bmOnlineCoachActions">{dirty&&String(savedRevision.current)!==String(revision)&&<button type="button" disabled={saving} onClick={()=>{setDraft(sameNames(team,persisted)?{order:[...persisted.order],minutes:{...persisted.minutes}}:defaultPlan(team,date));setDirty(false);setError('');savedRevision.current=String(revision);request.current=null;}}>Reload shared state</button>}<button type="button" disabled={saving} onClick={auto}>Auto rotation</button><button type="button" className="bmOnlineCoachSave" disabled={!dirty||saving||assigned!==240} onClick={save}>{saving?'Saving…':'Save Gameplan'}</button></div>}
    </footer>
  </div>;
}
