// Phase 2D.3-A — pure online postseason preparation and Play-In progression.
// Original Basketball Manager seeding, bracket and game engine functions are reused.
import {computeCanonicalStandings,sortCanonicalTeamNames,normalizeStandingsConference} from './onlinePostseasonCanonical.mjs';
import {buildRegularSeasonSnapshot,buildInitialPostseason} from './onlinePostseasonOriginal.mjs';
import {ensurePostseasonCalendar,setPostseasonCurrentDate} from './onlineSimShared/leagueClock.mjs';
import {buildOnlineGameBatch,integrateOnlineSimulation,SimulationConflict} from './onlineSimulationCore.js';
import {onlineUnimplementedCheckpoints,isOnlineTradeDeadlineClosed,isOnlineAllStarSelected,isOnlineVeteranExtensionClosed} from '../frontend/src/online/onlineSimulationCheckpoints.mjs';

const fail=(m)=>{throw new SimulationConflict(m,409);};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const safeDate=date=>typeof date==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;

export function verifyCompletedRegularSeason(state){
  const schedule=state?.onlineSchedule;
  const results=state?.onlineResults;
  if(!object(schedule)||!object(schedule.byDate)||!object(results)||schedule.phase!=='regular-season')fail('The regular-season schedule must be complete before the Play-In.');
  if(state.onlinePostseason)fail('A postseason bracket already exists. Refresh the league.');
  const year=Number(schedule.seasonYear);
  if(!Number.isInteger(year)||year<2025||year>2094)fail('Online season year is invalid.');
  const teams=Array.isArray(state?.teams)?state.teams:[...(state?.conferences?.East||[]),...(state?.conferences?.West||[])];
  if(teams.length!==30)fail('A complete 30-team NBA roster is required.');
  const names=new Set(),conference=new Map(),confs={East:[],West:[]};
  for(const [key,rows] of Object.entries(state.conferences||{})){
    const conf=normalizeStandingsConference(key);
    if(!['East','West'].includes(conf)||!Array.isArray(rows))continue;
    for(const row of rows){const name=typeof row==='string'?row:row?.name;if(name){if(conference.has(name)&&conference.get(name)!==conf)fail('A team belongs to two conferences.');conference.set(name,conf);}}
  }
  for(const t of teams){
    const name=t?.name,conf=conference.get(name)||normalizeStandingsConference(t?.conference||t?.conf);
    if(typeof name!=='string'||!name||names.has(name)||!['East','West'].includes(conf))fail('A team is missing, duplicated, or assigned to an unknown conference.');
    names.add(name);conference.set(name,conf);confs[conf].push(name);
  }
  if(confs.East.length!==15||confs.West.length!==15)fail('The NBA must contain 15 teams in each conference.');
  const counts=new Map([...names].map(n=>[n,0]));
  const ids=new Set();let total=0,lastDate='';
  for(const [date,games] of Object.entries(schedule.byDate).sort(([a],[b])=>a.localeCompare(b))){
    if(!safeDate(date)||!Array.isArray(games)||!games.length||games.length>16)fail('Shared schedule contains an invalid day.');
    if(date<lastDate)fail('Schedule dates are not ordered.');lastDate=date;
    const dayTeams=new Set();
    for(const g of games){
      const id=String(g?.id??'');
      if(!id||ids.has(id)||!names.has(g?.home)||!names.has(g?.away)||g.home===g.away)fail('Schedule has a duplicate or invalid matchup.');
      if(dayTeams.has(g.home)||dayTeams.has(g.away))fail('A team appears twice on one game day.');
      ids.add(id);dayTeams.add(g.home);dayTeams.add(g.away);
      counts.set(g.home,counts.get(g.home)+1);counts.set(g.away,counts.get(g.away)+1);total++;
      const r=results[id];
      if(!object(r)||r.id!==id||r.date!==date||r.home!==g.home||r.away!==g.away||
         !Number.isInteger(r.homeScore)||!Number.isInteger(r.awayScore)||r.homeScore<60||r.awayScore<60||r.homeScore===r.awayScore||
         Number(r?.totals?.home)!==r.homeScore||Number(r?.totals?.away)!==r.awayScore)fail('Regular season has a missing or inconsistent final result.');
    }
  }
  if(total!==1230||ids.size!==1230||Object.keys(results).length!==1230||[...counts.values()].some(v=>v!==82))
    fail('The NBA regular season must have exactly 1,230 final games and 82 per team.');
  for(const checkpoint of onlineUnimplementedCheckpoints(state)){
    const ready=checkpoint.kind==='trade_deadline'?isOnlineTradeDeadlineClosed(state,checkpoint.date):
      checkpoint.kind==='all_star'?isOnlineAllStarSelected(state,checkpoint.date):
      checkpoint.kind==='extension_deadline'?isOnlineVeteranExtensionClosed(state,checkpoint.date):false;
    if(!ready)fail(`Unresolved or mismatched ${checkpoint.label} checkpoint prevents postseason seeding.`);
    if(lastDate<checkpoint.date)fail('The NBA regular season ends before a required league checkpoint.');
  }
  return {teams,confs,conference,year};
}

export function seedOnlinePostseason(state){
  const verified=verifyCompletedRegularSeason(state);
  const standings=computeCanonicalStandings({
    teams:verified.teams,scheduleByDate:state.onlineSchedule.byDate,
    resultsById:state.onlineResults,confOf:name=>verified.conference.get(name)
  });
  const seeds=Object.fromEntries(Object.entries(verified.confs).map(([conf,names])=>[
    conf,sortCanonicalTeamNames(names,standings).slice(0,10)
  ]));
  for(const name of verified.conference.keys())if(standings[name]?.gp!==82)fail('Final standings contain an incomplete team record.');
  const snapshot=buildRegularSeasonSnapshot({standings,seeds});
  const bracket=buildInitialPostseason({seasonYear:verified.year,seeds,regularSeasonSnapshot:snapshot});
  ensurePostseasonCalendar(bracket,{scheduleByDate:state.onlineSchedule.byDate,seasonStartYear:verified.year});
  if(bracket?.conf?.East?.playIn?.g78?.home!==seeds.East[6]||bracket?.conf?.West?.playIn?.g910?.away!==seeds.West[9])
    fail('The original playoff bracket could not be seeded safely.');
  bracket.phase='playIn';
  return bracket;
}

export function nextOnlinePlayInGame(state){
  const post=state?.onlinePostseason;
  if(!object(post)||!object(post.conf)||state?.onlineSchedule?.phase!=='postseason'||post.phase!=='playIn')
    fail('The shared league is not in the Play-In stage.');
  if(Object.keys(post.conf).length!==2||!post.conf.East||!post.conf.West)fail('The postseason bracket is missing a conference.');
  const options=[];
  for(const conf of ['West','East']){
    const pi=post.conf[conf]?.playIn;
    if(!pi||!pi.g78||!pi.g910||!pi.gFinal)fail('Play-In bracket is incomplete.');
    for(const [key,node] of [['g78',pi.g78],['g910',pi.g910],['gFinal',pi.gFinal]]){
      if(node.played)continue;
      if(key==='gFinal'&&(!pi.g78.played||!pi.g910.played))continue;
      if(!node.id||!safeDate(node.date)||!node.home||!node.away||node.home===node.away)fail('An upcoming Play-In matchup is invalid.');
      options.push({conf,key,id:String(node.id),date:node.date,home:node.home,away:node.away});
    }
  }
  if(!options.length){
    const complete=['West','East'].every(conf=>['g78','g910','gFinal'].every(k=>post.conf[conf].playIn[k].played));
    if(!complete)fail('The Play-In is partially corrupted and cannot advance.');
    return null;
  }
  return options.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))[0];
}

export function buildOnlinePlayInBatch(state){
  const next=nextOnlinePlayInGame(state);
  if(!next)fail('All Play-In games are already complete.');
  const games=[{id:next.id,home:next.home,away:next.away,date:next.date}];
  // Reuse exact rotation, injury recovery and roster checks of regular-season batch.
  // Isolate postseason results and postseason player totals from regular-season ledgers.
  const shadow={...state,
    onlineSchedule:{...state.onlineSchedule,phase:'regular-season',byDate:{[next.date]:games}},
    onlineResults:state.onlinePostseasonResults||{},
    onlinePlayerStats:state.onlinePostseasonStats||{}};
  const batch=buildOnlineGameBatch(shadow);
  if(batch.date!==next.date||batch.games.length!==1)fail('An unexpected Play-In game was selected.');
  return {next,batch};
}

export function applyOnlinePlayInResult(bracket,game,result){
  const next=nextOnlinePlayInGame({onlinePostseason:bracket,onlineSchedule:{phase:'postseason'}});
  if(!next||next.id!==game.id||next.conf!==game.conf||next.key!==game.key||
     result.id!==game.id||result.date!==game.date||result.home!==game.home||result.away!==game.away)
    fail('Stale Play-In result or out-of-sequence matchup.');
  const copy=structuredClone(bracket);
  const pi=copy.conf[next.conf].playIn;
  const node=pi[next.key];
  const homeWon=result.homeScore>result.awayScore;
  const winner=homeWon?node.home:node.away,loser=homeWon?node.away:node.home;
  node.played=true;node.winner=winner;node.loser=loser;
  node.homeScore=result.homeScore;node.awayScore=result.awayScore;
  node.otCount=result.winner.ot;node.boxScore=result;
  setPostseasonCurrentDate(copy,node.date);
  if(next.key==='g78')pi.seed7=winner;
  if(next.key==='g78'||next.key==='g910'){
    if(pi.g78.played&&pi.g910.played){pi.gFinal.home=pi.g78.loser;pi.gFinal.away=pi.g910.winner;}
  }else{
    pi.seed8=winner;
    copy.conf[next.conf].rounds.r1.s1v8.lowSeedTeam=winner;
    copy.conf[next.conf].rounds.r1.s2v7.lowSeedTeam=pi.seed7;
  }
  if(['West','East'].every(c=>['g78','g910','gFinal'].every(k=>copy.conf[c].playIn[k].played)))copy.phase='playoffs';
  return copy;
}

export function integrateOnlinePlayInGame(state,game,raw,seed){
  const {next,batch}=buildOnlinePlayInBatch(state);
  if(next.id!==game.id||next.date!==game.date)fail('Shared league changed during Play-In simulation.');
  const delta=integrateOnlineSimulation(batch,raw,seed);
  const result=delta.results[game.id];
  if(!result)fail('The simulator did not return the Play-In game.');
  const bracket=applyOnlinePlayInResult(state.onlinePostseason,game,result);
  return {game,result,bracket,stats:delta.stats,rosters:delta.rosters,
    injuryEvents:delta.injuryEvents};
}
