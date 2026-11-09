// 2D.3-B — authoritative best-of-seven games using the original Playoffs.jsx
// series node, 2-2-1-1-1 home order and winner wiring. No single-player edits.
import {buildOnlineGameBatch,integrateOnlineSimulation,SimulationConflict} from './onlineSimulationCore.js';
import {setPostseasonCurrentDate,normalizeIsoDate} from './onlineSimShared/leagueClock.mjs';

const fail=message=>{throw new SimulationConflict(message,409);};
const rounds=[['r1',1],['r2',2],['r3',3],['finals',4]];
const homePattern=['H','H','A','A','H','A','H'];
const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export const playoffSeriesWinner=s=>s?.complete&&(s.winsHigh===4||s.winsLow===4)?(s.winsHigh===4?s.highSeedTeam:s.lowSeedTeam):null;

function validateSeries(s,round,conf,season){
  if(!isObj(s)||s.type!=='series'||s.round!==round||s.conf!==conf||!Array.isArray(s.gameIds)||!Array.isArray(s.gameDates)||s.gameIds.length!==7||s.gameDates.length!==7||
     !Number.isInteger(s.nextGameIndex)||s.nextGameIndex<0||s.nextGameIndex>7||
     !Number.isInteger(s.winsHigh)||!Number.isInteger(s.winsLow)||s.winsHigh<0||s.winsLow<0||s.winsHigh>4||s.winsLow>4||
     s.winsHigh+s.winsLow!==s.nextGameIndex||Boolean(s.complete)!==(Math.max(s.winsHigh,s.winsLow)===4)||
     s.gameIds.some((id,i)=>id!==`PO_${season}_${conf}_R${round}_${s.label}_G${i+1}`)||
     s.gameDates.some(date=>!normalizeIsoDate(date)))fail('Postseason series integrity check failed.');
  if(s.winsHigh===4&&s.winsLow===4)fail('A completed series has two winners.');
  if(Boolean(s.highSeedTeam)!==Boolean(s.lowSeedTeam))fail('Postseason contains a half-seeded series.');
  return Boolean(s.highSeedTeam&&s.lowSeedTeam);
}
function listSeries(post){
  if(!isObj(post)||!isObj(post.conf)||Object.keys(post.conf).sort().join(',')!=='East,West'||!isObj(post.finals)||!Number.isInteger(post.seasonYear))fail('Invalid shared postseason bracket.');
  const out=[];
  for(const [round,num] of rounds){
    for(const conf of (round==='finals'?['NBA']:['West','East'])){
      const group=round==='finals'?{finals:post.finals}:post.conf[conf]?.rounds?.[round];
      const expected=round==='r1'?['s1v8','s4v5','s3v6','s2v7']:round==='r2'?['top','bot']:round==='r3'?['confFinals']:['finals'];
      if(!isObj(group)||Object.keys(group).sort().join(',')!==[...expected].sort().join(','))fail('Postseason series list is incomplete.');
      for(const key of expected){const series=group[key];const ready=validateSeries(series,num,conf,post.seasonYear);out.push({round,num,conf,key,series,ready});}
    }
  }
  if(out.length!==15)fail('NBA postseason must have exactly fifteen series.');
  return out;
}
function validateTransition(post){
  if(!['playoffs','postseasonComplete'].includes(post.phase))fail('Play-In must finish before best-of-seven simulation.');
  if(!['West','East'].every(conf=>['g78','g910','gFinal'].every(key=>post.conf[conf]?.playIn?.[key]?.played)))fail('Play-In has not fully completed.');
  const entries=listSeries(post);
  const teams=new Set();
  for(const entry of entries){
    const s=entry.series;
    if(s.highSeedTeam&&s.lowSeedTeam&&s.highSeedTeam===s.lowSeedTeam)fail('A team cannot play itself in a playoff series.');
    if(entry.round==='r1'&&(!entry.ready||!post.seedOrder?.[entry.conf]?.includes(s.highSeedTeam)||!post.seedOrder?.[entry.conf]?.includes(s.lowSeedTeam)))fail('First-round seeds are incomplete.');
    if(entry.round==='r1'){for(const team of [s.highSeedTeam,s.lowSeedTeam]){
      const id=`${entry.conf}:${team}`;if(teams.has(id))fail('A team appears in two first-round series.');teams.add(id);
    }}
  }
  if(post.phase==='postseasonComplete'&&(post.champion!==playoffSeriesWinner(post.finals)||!post.champion))fail('The stored NBA champion does not match the Finals.');
  if(post.phase==='playoffs'&&post.finals.complete)fail('Finals winner is missing the completed postseason phase.');
  return entries;
}
export function nextOnlinePlayoffGame(state){
  const post=state?.onlinePostseason;
  if(state?.onlineSchedule?.phase!=='postseason'||!post)fail('The online league is not in postseason play.');
  const entries=validateTransition(post);
  if(post.phase==='postseasonComplete')return null;
  const choices=[];
  for(const {round,num,conf,key,series:s,ready} of entries){
    if(!ready||s.complete)continue;
    if(s.nextGameIndex>=7)fail('A series exhausted its schedule without a winner.');
    const i=s.nextGameIndex,date=s.gameDates[i],id=s.gameIds[i];
    const highHome=homePattern[i]==='H';
    choices.push({round,num,conf,key,index:i,id,date,home:highHome?s.highSeedTeam:s.lowSeedTeam,
      away:highHome?s.lowSeedTeam:s.highSeedTeam,highTeam:s.highSeedTeam,lowTeam:s.lowSeedTeam});
  }
  if(!choices.length)fail('The bracket cannot progress: no executable playoff game exists.');
  // Original postseason calendar is fixed by round; simultaneous matchups break ties by immutable game ID.
  choices.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  const next=choices[0];
  if(post.calendar?.currentDate&&next.date<post.calendar.currentDate){
    // The league clock may advance through other simultaneous games, but never past an unplayed match.
    fail('Postseason clock is ahead of an unplayed game. Refresh and inspect the league.');
  }
  return next;
}
function seedOrder(post,conf,team){const idx=post.seedOrder?.[conf]?.indexOf(team)??-1;return idx>=0?idx+1:null;}
function wireSeries(target,conf,a,b){
  if(!a||!b)return;
  if(target.highSeedTeam||target.lowSeedTeam)return;
  const sa=seedOrder(target.__post,conf,a),sb=seedOrder(target.__post,conf,b);
  if(!sa||!sb||sa===sb)fail('Postseason advancement has invalid original seed numbers.');
  const high=sa<sb?a:b,low=sa<sb?b:a;
  target.highSeedTeam=high;target.lowSeedTeam=low;target.highSeedNum=Math.min(sa,sb);target.lowSeedNum=Math.max(sa,sb);
}
function advanceBracket(post){
  for(const conf of ['West','East']){
    const {r1,r2,r3}=post.conf[conf].rounds;
    const w=series=>playoffSeriesWinner(series);
    const targetTop={...r2.top,__post:post};wireSeries(targetTop,conf,w(r1.s1v8),w(r1.s4v5));delete targetTop.__post;r2.top=targetTop;
    const targetBot={...r2.bot,__post:post};wireSeries(targetBot,conf,w(r1.s3v6),w(r1.s2v7));delete targetBot.__post;r2.bot=targetBot;
    const targetFinal={...r3.confFinals,__post:post};wireSeries(targetFinal,conf,w(r2.top),w(r2.bot));delete targetFinal.__post;r3.confFinals=targetFinal;
  }
  const west=playoffSeriesWinner(post.conf.West.rounds.r3.confFinals);
  const east=playoffSeriesWinner(post.conf.East.rounds.r3.confFinals);
  if(west&&east&&!post.finals.highSeedTeam&&!post.finals.lowSeedTeam){
    const snapshot=post.regularSeasonSnapshot||[];
    const record=name=>snapshot.find(row=>row.teamName===name);
    const w=record(west),e=record(east);
    if(!w||!e||w.gamesPlayed!==82||e.gamesPlayed!==82||!Number.isInteger(w.wins)||!Number.isInteger(e.wins))fail('Frozen standings are missing for Finals home-court advantage.');
    // Same single-player rule: higher winning percentage gets home court; ties favor West (bracket left).
    post.finals.highSeedTeam=w.wins>=e.wins?west:east;
    post.finals.lowSeedTeam=w.wins>=e.wins?east:west;
  }
  const champion=playoffSeriesWinner(post.finals);
  if(champion){post.champion=champion;post.phase='postseasonComplete';}
}
export function applyOnlinePlayoffGameResult(bracket,game,result){
  const next=nextOnlinePlayoffGame({onlinePostseason:bracket,onlineSchedule:{phase:'postseason'}});
  if(!next||game?.id!==next.id||game?.conf!==next.conf||game?.key!==next.key||game?.index!==next.index||
     result?.id!==next.id||result?.date!==next.date||result?.home!==next.home||result?.away!==next.away||
     !Number.isInteger(result.homeScore)||!Number.isInteger(result.awayScore)||result.homeScore===result.awayScore)fail('Stale or invalid playoff result.');
  const copy=structuredClone(bracket);
  const s=next.round==='finals'?copy.finals:copy.conf[next.conf].rounds[next.round][next.key];
  const winner=result.homeScore>result.awayScore?next.home:next.away;
  if(winner===s.highSeedTeam)s.winsHigh++;else if(winner===s.lowSeedTeam)s.winsLow++;else fail('Winner is not a member of the selected series.');
  s.nextGameIndex++;
  if(s.winsHigh>=4||s.winsLow>=4)s.complete=true;
  setPostseasonCurrentDate(copy,next.date);
  advanceBracket(copy);
  validateTransition(copy);
  return copy;
}
export function buildOnlinePlayoffBatch(state){
  const next=nextOnlinePlayoffGame(state);
  if(!next)fail('The NBA champion is already crowned.');
  const games=[{id:next.id,date:next.date,home:next.home,away:next.away}];
  const shadow={...state,onlineSchedule:{...state.onlineSchedule,phase:'regular-season',byDate:{[next.date]:games}},
    onlineResults:state.onlinePostseasonResults||{},onlinePlayerStats:state.onlinePostseasonStats||{}};
  const batch=buildOnlineGameBatch(shadow);
  if(batch.date!==next.date||batch.games.length!==1)fail('Unexpected series simulation batch.');
  return {next,batch};
}
export function integrateOnlinePlayoffGame(state,game,raw,seed){
  const {next,batch}=buildOnlinePlayoffBatch(state);
  if(next.id!==game.id||next.index!==game.index)fail('Playoff schedule changed before game simulation.');
  const delta=integrateOnlineSimulation(batch,raw,seed);
  const result=delta.results[next.id];
  if(!result)fail('Missing playoff simulation result.');
  const bracket=applyOnlinePlayoffGameResult(state.onlinePostseason,next,result);
  return {game:next,result,bracket,stats:delta.stats,rosters:delta.rosters,injuryEvents:delta.injuryEvents};
}
