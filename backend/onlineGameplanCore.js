// Phase 2D.2-B: online-only manual gameplans; original single-player auto builder remains the fallback.
import {buildAvailabilityGameplanPayload, isPlayerInjured} from './onlineSimShared/injurySystem.mjs';
import {GAMEPLAN_VERSION, getRosterSignatureForGameplan} from './onlineSimShared/ensureGameplans.mjs';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validateOnlineManualGameplan(team, saved, date = null) {
  if (!team?.name || !Array.isArray(team.players) || !isObject(saved) ||
      saved.teamName !== team.name || saved.source !== 'coach_gameplan' ||
      saved.manualLocked !== true || !Array.isArray(saved.order) || !isObject(saved.minutes))
    return {valid:false, reason:'missing or invalid manual gameplan'};
  const names = team.players.map(player => player?.name);
  if(names.length<5 || names.some(name => typeof name !== 'string' || !name.trim()) ||
     new Set(names).size!==names.length || saved.order.length!==names.length ||
     new Set(saved.order).size!==names.length ||
     names.some(name=>!saved.order.includes(name)) ||
     Object.keys(saved.minutes).length!==names.length ||
     names.some(name=>!Object.hasOwn(saved.minutes,name)))
    return {valid:false, reason:'roster changed or ambiguous player names'};
  const players = new Map(team.players.map(player=>[player.name,player]));
  if(!isObject(saved.rosterPlayerIds) || Object.keys(saved.rosterPlayerIds).length !== names.length ||
     names.some(name => String(saved.rosterPlayerIds[name]??'') !== String(players.get(name)?.id??players.get(name)?.playerId??'')))
    return {valid:false,reason:'roster player identities changed'};
  let assigned=0;
  for(const [index,name] of saved.order.entries()) {
    const minutes=saved.minutes[name];
    if(!Number.isInteger(minutes) || minutes<0 || minutes>(index<5?48:47) ||
      (index<5 && minutes<1))return {valid:false,reason:'illegal manual minutes or starting five'};
    if(minutes>0 && isPlayerInjured(players.get(name),date))
      return {valid:false,reason:'injured player in saved rotation'};
    assigned+=minutes;
  }
  if(assigned!==240)return {valid:false,reason:'gameplan must allocate 240 minutes'};
  return {valid:true,reason:null};
}

export function selectOnlineGameplan(state,team,date) {
  const saved=state?.onlineGameplans?.[team?.name];
  const check=validateOnlineManualGameplan(team,saved,date);
  if(check.valid){
    return {minutes:{...saved.minutes},order:[...saved.order],source:'manual',fallbackReason:null};
  }
  const auto=buildAvailabilityGameplanPayload(team,date,{source:'online_server_auto_rotation'});
  return {minutes:auto.minutes,order:auto.order,source:'auto',fallbackReason:saved?check.reason:null};
}

export function makeOnlineManualGameplan(team,order,minutes) {
  const saved={teamName:team.name,order:[...order],minutes:{...minutes},source:'coach_gameplan',
    manualLocked:true,userEdited:true,version:GAMEPLAN_VERSION,
    rosterSignature:getRosterSignatureForGameplan(team.players),
    rosterPlayerIds:Object.fromEntries(team.players.map(p=>[p.name,String(p.id??p.playerId??'')])),updatedAt:Date.now()};
  const check=validateOnlineManualGameplan(team,saved);
  if(!check.valid)throw new Error(check.reason);
  return saved;
}
