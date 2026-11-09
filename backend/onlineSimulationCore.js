// Phase 2D.2-A. Online-only simulation planning and original game-result integration.
// Source basketball engines are copied unchanged in onlineSimShared and online_sim_python.
import {randomBytes} from 'node:crypto';
import {selectOnlineGameplan} from './onlineGameplanCore.js';
import {
  isPlayerInjured,
  recoverPlayersForDate, processGameInjuries
} from './onlineSimShared/injurySystem.mjs';

export class SimulationConflict extends Error {
  constructor(message, status=409){super(message);this.status=status;}
}
const fail = (message,status) => {throw new SimulationConflict(message,status);};
const plain = obj => obj && typeof obj==='object' && !Array.isArray(obj);
const iso = d => /^20\d\d-\d\d-\d\d$/.test(d||'') && new Date(`${d}T12:00:00Z`).toISOString().slice(0,10)===d;
export const leagueTeams = state => Array.isArray(state?.teams) ? state.teams :
  [...(state?.conferences?.East||[]),...(state?.conferences?.West||[])];

export function nextOnlineSimulationDay(state){
  const schedule=state?.onlineSchedule;
  if(!plain(schedule)||schedule.phase!=='regular-season'||!plain(schedule.byDate))fail('A regular-season calendar must be initialized first.');
  const results=plain(state.onlineResults)?state.onlineResults:{};
  const dates=Object.keys(schedule.byDate).sort();
  if(!dates.length||dates.some(d=>!iso(d)||!Array.isArray(schedule.byDate[d])))fail('Shared schedule is invalid.');
  for(const date of dates){
    const rows=schedule.byDate[date];
    const pending=rows.filter(g=>!Object.prototype.hasOwnProperty.call(results,String(g?.id)));
    if(pending.length && pending.length!==rows.length)fail('A partially completed game day requires recovery, not another simulation.');
    if(pending.length){
      if(pending.length>16||pending.some(g=>!g?.id||!g?.home||!g?.away||g.home===g.away))fail('Game day is not safe to simulate.');
      if(new Set(pending.map(g=>String(g.id))).size!==pending.length)fail('Duplicate game IDs on this date.');
      const occupied=new Set();
      for(const game of pending)for(const name of [game.home,game.away]){
        if(occupied.has(name))fail('A team has two games on this day.');occupied.add(name);
      }
      return {date, games:pending};
    }
  }
  fail('All scheduled regular-season games are completed. Playoffs are a separate phase.');
}

export function buildOnlineGameBatch(state){
  if(!plain(state))fail('Invalid shared league state.');
  const {date,games}=nextOnlineSimulationDay(state);
  const snapshot=structuredClone(state); // Never mutate fetched state before RPC acceptance.
  recoverPlayersForDate(snapshot,date,{rebuildGameplans:false});
  const teams=leagueTeams(snapshot);
  const byName=new Map(teams.map(team=>[team?.name,team]));
  if(teams.length!==30||byName.size!==30)fail('Online NBA league rosters are incomplete.');
  const inputs=games.map(game=>{
    const prepared={id:String(game.id)};
    for(const side of ['home','away']){
      const source=byName.get(game[side]);
      if(!source||!Array.isArray(source.players))fail('Scheduled team is missing from the current league.');
      const names=source.players.map(p=>p?.name);
      if(names.some(n=>typeof n!=='string'||!n.trim())||new Set(names).size!==names.length)fail(`Duplicate or missing player names on ${source.name}.`);
      const available=source.players.filter(p=>!isPlayerInjured(p,date));
      if(available.length<5)fail(`${source.name} has fewer than five healthy players. Repair the roster before simulating.`);
      // Reuse saved authorized GM rotation only when still legal; original smart rotation handles injured/stale rosters.
      const plan=selectOnlineGameplan(snapshot,source,date);
      const minutes=plan.minutes;
      const sum=Object.values(minutes).reduce((n,m)=>n+Number(m),0);
      if(sum!==240||Object.values(minutes).some(n=>!Number.isInteger(n)||n<0||n>48))
        fail(`${source.name} does not have a valid 240-minute rotation.`);
      for(const player of source.players){if(isPlayerInjured(player,date)&&Number(minutes[player.name])>0)fail('Injured players must have zero assigned minutes.');}
      prepared[side]={...source,players:source.players.map(p=>({...p,secondaryPos:p.secondaryPos||null})),minutes};
    }
    return prepared;
  });
  return {date,games,inputs,snapshot};
}

const n = val => {const num=Number(val);return Number.isFinite(num)?num:0;};
const pair = value => {
  if(typeof value==='string'){
    const m=value.match(/^(\d+)\s*[-/]\s*(\d+)$/);
    if(m)return [Number(m[1]),Number(m[2])];
  }
  return [0,0];
};
const toBox = rows => rows.map(p=>{
  const fg=pair(p.fg), tp=pair(p['3p']),ft=pair(p.ft);
  if(!fg[1] && p.fga!=null){fg[0]=n(p.fgm);fg[1]=n(p.fga);}
  if(!tp[1] && p.tpa!=null){tp[0]=n(p.tpm);tp[1]=n(p.tpa);}
  if(!ft[1] && p.fta!=null){ft[0]=n(p.ftm);ft[1]=n(p.fta);}
  return {player:String(p.player??p.name??''),min:n(p.min??p.minutes),pts:n(p.pts),reb:n(p.reb),ast:n(p.ast),stl:n(p.stl),blk:n(p.blk),fg:`${fg[0]}-${fg[1]}`,'3p':`${tp[0]}-${tp[1]}`,ft:`${ft[0]}-${ft[1]}`,to:n(p.to??p.tov),pf:n(p.pf)};
});
export function normalizeSimulatedResult(game,raw,date){
  if(!plain(raw)||!plain(raw.score)||!Array.isArray(raw.box_home)||!Array.isArray(raw.box_away))fail('Python simulator returned an incomplete result.');
  const homeScore=n(raw.score.home),awayScore=n(raw.score.away);
  if(!Number.isInteger(homeScore)||!Number.isInteger(awayScore)||homeScore<60||awayScore<60||homeScore>250||awayScore>250||homeScore===awayScore)
    fail('Simulator returned an impossible NBA final score.');
  const boxHome=toBox(raw.box_home),boxAway=toBox(raw.box_away);
  if(!boxHome.length||!boxAway.length)fail('A simulated game is missing player box scores.');
  if(boxHome.some(p=>!p.player)||boxAway.some(p=>!p.player))fail('Simulation contains an unnamed player.');
  const homePeriods=raw.quarters_home||[],awayPeriods=raw.quarters_away||[];
  if(!Array.isArray(homePeriods)||!Array.isArray(awayPeriods)||homePeriods.length<4||homePeriods.length!==awayPeriods.length||
    homePeriods.reduce((a,b)=>a+n(b),0)!==homeScore||awayPeriods.reduce((a,b)=>a+n(b),0)!==awayScore)
    fail('Simulated quarter totals do not match the final score.');
  return {id:String(game.id),date,home:game.home,away:game.away,
    homeScore,awayScore,winner:{home:homeScore,away:awayScore,side:homeScore>awayScore?'home':'away',score:`${homeScore}-${awayScore}`,ot:Math.max(0,homePeriods.length-4)},
    totals:{home:homeScore,away:awayScore},periods:{home:homePeriods.slice(0,4),away:awayPeriods.slice(0,4),ots:{home:homePeriods.slice(4),away:awayPeriods.slice(4)},otCount:Math.max(0,homePeriods.length-4)},
    box:{home:boxHome,away:boxAway}};
}
function updateStats(stats,result,team,side){
  const rows=result.box[side].filter(row=>row.min>0);
  const starters=new Set([...rows].sort((a,b)=>b.min-a.min).slice(0,5).map(row=>row.player));
  for(const row of rows){
    const key=`${row.player}__${team}`;
    const r=stats[key]||{player:row.player,team,gp:0,min:0,pts:0,reb:0,ast:0,stl:0,blk:0,fgm:0,fga:0,tpm:0,tpa:0,ftm:0,fta:0,to:0,pf:0,started:0,sixth:0};
    r.gp++;for(const field of ['min','pts','reb','ast','stl','blk','to','pf'])r[field]+=n(row[field]);
    for(const [boxField,made,attempted] of [['fg','fgm','fga'],['3p','tpm','tpa'],['ft','ftm','fta']]){
      const [m,a]=pair(row[boxField]);r[made]+=m;r[attempted]+=a;
    }
    if(starters.has(row.player))r.started++;else r.sixth++;
    stats[key]=r;
  }
}
function seededRng(seed){let s=seed>>>0;return ()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
export function integrateOnlineSimulation(batch,output,seed=randomBytes(4).readUInt32BE(0)){
  if(!Array.isArray(output?.games)||output.games.length!==batch.games.length)fail('Simulator did not return the complete date.');
  const byId=new Map(output.games.map(x=>[String(x?.id),x.result]));
  if(byId.size!==batch.games.length)fail('Duplicate or missing simulated games.');
  const state=batch.snapshot;
  const results={...(plain(state.onlineResults)?state.onlineResults:{})};
  const stats={...(plain(state.onlinePlayerStats)?state.onlinePlayerStats:{})};
  const injuryEvents=[];
  const rng=seededRng(seed);
  for(const game of batch.games){
    if(!byId.has(String(game.id))||Object.hasOwn(results,String(game.id)))fail('Conflicting or missing game result.');
    const result=normalizeSimulatedResult(game,byId.get(String(game.id)),batch.date);
    for(const side of ['home','away']){
      const roster=batch.inputs.find(x=>String(x.id)===String(game.id))?.[side]?.players||[];
      const names=new Set(roster.map(p=>p.name));
      const seen=new Set();
      for(const line of result.box[side]){
        if(!names.has(line.player)||seen.has(line.player)||line.min<0||line.min>88||!Number.isInteger(line.min))
          fail('Python box score does not match the committed team roster.');
        seen.add(line.player);
      }
      if(result.box[side].reduce((sum,row)=>sum+row.pts,0)!==result[`${side}Score`])
        fail('Individual player points do not reconcile with the final score.');
    }
    results[String(game.id)]=result;
    updateStats(stats,result,game.home,'home');updateStats(stats,result,game.away,'away');
    const injuries=processGameInjuries({leagueData:state,game,result,currentDate:batch.date,rng});
    injuryEvents.push(...injuries.events);
  }
  if(Object.keys(stats).length>1200||JSON.stringify(results).length>12000000)fail('Season result payload exceeds safe limits.');
  const rosters=Array.isArray(state.teams)?state.teams:state.conferences;
  return {date:batch.date,results:Object.fromEntries(batch.games.map(g=>[String(g.id),results[String(g.id)]])),stats,rosters,
    injuryEvents:[...(Array.isArray(state.onlineInjuryEvents)?state.onlineInjuryEvents:[]),...injuryEvents].slice(-500),gameCount:batch.games.length};
}
