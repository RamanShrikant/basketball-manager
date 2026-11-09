// Online-only checkpoint guard. No browser score authority and no single-player state writes.
// Milestones without server-side lifecycle handlers must NEVER be auto-skipped.
import {getSeasonCalendarConfig} from '../utils/seasonContext.js';
import {readOnlineGames} from './onlineSeasonReadModel.mjs';

const datePattern=/^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
export function isOnlineISODate(value){
  if(typeof value!=='string'||!datePattern.test(value))return false;
  return new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value;
}

export function pendingOnlineGameDays(state){
  if(state?.onlineSchedule?.phase!=='regular-season')return [];
  const games=readOnlineGames(state);
  const rows=new Map();
  for(const game of games){
    if(!rows.has(game.date))rows.set(game.date,{date:game.date,scheduled:0,played:0});
    const row=rows.get(game.date);row.scheduled++;if(game.played)row.played++;
  }
  return [...rows.values()].filter(r=>r.played<r.scheduled).sort((a,b)=>a.date.localeCompare(b.date));
}

export function onlineUnimplementedCheckpoints(state){
  const conf=getSeasonCalendarConfig(state||{});
  const entries=[
    {date:conf.tradeDeadlineDate,label:'Trade deadline',kind:'trade_deadline'},
    {date:conf.allStarSelectionDate,label:'All-Star selection',kind:'all_star'},
    {date:conf.veteranExtensionDeadlineDate,label:'Veteran extension deadline',kind:'extension_deadline'},
  ];
  // Same single-player calendar source; never trust browser-supplied checkpoint dates.
  return entries.filter(c=>isOnlineISODate(c.date)).sort((a,b)=>a.date.localeCompare(b.date));
}

export function isOnlineTradeDeadlineClosed(state,date){
  const marker=state?.onlineCheckpoints?.trade_deadline;
  const season=Number(state?.onlineSchedule?.seasonYear);
  return isOnlineISODate(date)&&marker?.status==='closed'&&marker?.date===date&&
    Number.isInteger(season)&&season>=2025&&season<2095&&
    Number(marker?.seasonYear)===season&&Number(marker?.revision)>0;
}

export function isOnlineAllStarSelected(state,date){
  const marker=state?.onlineCheckpoints?.all_star;
  const result=state?.onlineAllStars;
  const year=Number(state?.onlineSchedule?.seasonYear);
  return isOnlineISODate(date)&&Number.isInteger(year)&&year>=2025&&year<2095&&
    marker?.status==='selected'&&marker?.date===date&&Number(marker?.seasonYear)===year&&
    Number(marker?.revision)>0&&result?.cutoff_date===date&&
    result?.season===`${year}-${year+1}`&&
    ['east','west'].every(conf=>Array.isArray(result?.[conf]?.starters)&&
      result[conf].starters.length===5&&Array.isArray(result?.[conf]?.reserves)&&
      result[conf].reserves.length===7);
}

export function isOnlineVeteranExtensionClosed(state,date){
  const marker=state?.onlineCheckpoints?.veteran_extension;
  const year=Number(state?.onlineSchedule?.seasonYear);
  return isOnlineISODate(date)&&Number.isInteger(year)&&year>=2025&&year<=2094&&
    marker?.status==='closed'&&marker?.date===date&&
    Number(marker.seasonYear)===year&&Number(marker.revision)>0&&
    state?.contractExtensionState?.closedTypes?.includes('veteran');
}

export function firstBlockedOnlineCheckpoint(state,nextGameDate){
  if(!isOnlineISODate(nextGameDate))return {date:String(nextGameDate),kind:'invalid_date',label:'Invalid schedule date'};
  // Only a trusted, season/date-matched server event may clear a deadline.
  // An old closed marker copied into a later season must never unlock it.
  return onlineUnimplementedCheckpoints(state).find(c => {
    if(c.date>nextGameDate)return false;
    if(c.kind==='trade_deadline')return !isOnlineTradeDeadlineClosed(state,c.date);
    if(c.kind==='all_star')return !isOnlineAllStarSelected(state,c.date);
    if(c.kind==='extension_deadline')return !isOnlineVeteranExtensionClosed(state,c.date);
    return true;
  })||null;
}

export function planOnlineSimToDate(state,targetDate,{maxDays=12}={}){
  if(!isOnlineISODate(targetDate))throw new Error('Choose a valid simulation end date.');
  if(!Number.isInteger(maxDays)||maxDays<1||maxDays>30)throw new Error('Invalid simulation batch limit.');
  const pending=pendingOnlineGameDays(state);
  if(pending.some(row=>row.played>0))return {days:[],blocked:{label:'Partially completed game day',kind:'partial_day',date:pending.find(r=>r.played>0).date},more:false};
  const days=[];let blocked=null;let more=false;
  for(const row of pending){
    if(row.date>targetDate)break;
    const checkpoint=firstBlockedOnlineCheckpoint(state,row.date);
    if(checkpoint){blocked=checkpoint;break;}
    if(days.length>=maxDays){more=true;break;}
    days.push(row.date);
  }
  return {days,blocked,more};
}
