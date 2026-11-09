// 2E.2: locked post-lottery rights settlement. The underlying resolver is a
// byte-identical copy of the finished single-player draftPicks.js module.
import {createHash} from 'node:crypto';
import {
  applyDraftPickOwnershipToLotteryResult, auditDraftPickIntegrity,
  getForfeitedDraftPickKeys, getOwnedPickRange, isActiveDraftPickAsset,
  isSwapDraftPickAsset, normalizeDraftPicks, normalizeTeamName,
} from './online_draft_shared/draftPicks.js';

const fail = message => {const error=new Error(message);error.status=409;throw error;};
const obj = v => v && typeof v==='object' && !Array.isArray(v);
const same = (a,b) => normalizeTeamName(a)===normalizeTeamName(b);
const origin = p => p?.originalTeam||p?.originalTeamName;
const owner = p => p?.ownerTeam||p?.currentOwnerTeamName||p?.currentOwner;
const direction = p => String(p?.protection||p?.protections||p?.displayProtection||'').toLowerCase().includes('worst')?'worst':'best';
const number = v => Number(v);
const pairTeams = p => {
  const participants=p?.realLifeDetails?.swapParticipants || p?.swapParticipants;
  if(Array.isArray(participants)&&participants.length===2)return participants;
  return [origin(p),p?.swapWithTeam||p?.swapTeam||p?.swap?.withTeam];
};

export function preflightDraftRights(state, draftYear){
  const leagueTeams=Array.isArray(state?.teams)?state.teams:Object.values(state?.conferences||{}).flat();
  const names=leagueTeams.map(t=>t?.name);
  if(names.length!==30||new Set(names.map(normalizeTeamName)).size!==30||names.some(n=>!n))fail('Draft requires 30 unique teams.');
  if(!Array.isArray(state?.draftPicks))fail('The online draft-rights ledger is unavailable.');
  if(Array.isArray(state?.draftState?.draftPicks)&&state.draftState.draftPicks.length)
    fail('Two competing draft-rights ledgers must be reconciled before the draft.');
  const known = n=>names.some(x=>same(x,n));
  const source=state.draftPicks;
  const entries=normalizeDraftPicks(source,names).filter(p=>number(p.year)===draftYear&&isActiveDraftPickAsset(p));
  const seenIds=new Set();
  const byNatural=new Map();
  const swapGroups=new Map();
  const participantUsed=new Set();
  for(const p of entries){
    if(!obj(p)||typeof p.id!=='string'||!p.id||seenIds.has(p.id)||!known(owner(p)))
      fail('Draft-right identifiers or owners are missing, duplicate, or unknown.');
    seenIds.add(p.id);
    const yr=number(p.year),round=number(p.round);
    if(yr!==draftYear||![1,2].includes(round)||!known(origin(p)))fail('Draft-right source is malformed.');
    if(p?.realLifeDetails?.rollover||p?.realLifeDetails?.conveyance||p?.realLifeDetails?.fallback||
       p?.conditionalConveyance||p?.rolloverConditions||p?.futureConveyance)
      fail('A conditional rollover chain requires reconciliation before the draft.');
    if(isSwapDraftPickAsset(p)){
      const [a,b]=pairTeams(p);
      if(!known(a)||!known(b)||same(a,b)||round!==1)fail('Unsupported or ambiguous swap participants.');
      const key=`${round}|${[normalizeTeamName(a),normalizeTeamName(b)].sort().join('|')}`;
      if(!swapGroups.has(key))swapGroups.set(key,[]);
      swapGroups.get(key).push(p);
    }else{
      const key=`${round}|${normalizeTeamName(origin(p))}`;
      if(!byNatural.has(key))byNatural.set(key,[]);
      byNatural.get(key).push(p);
    }
  }
  for(const [key,group] of swapGroups){
    // Original import may use a different conditional model. Do not silently
    // ignore one-sided swaps or choose an arbitrary right holder.
    if(group.length!==2||new Set(group.map(direction)).size!==2)
      fail('A paired swap is incomplete; draft ownership cannot be settled.');
    for(const team of pairTeams(group[0])){
      const nk=`1|${normalizeTeamName(team)}`;
      if(participantUsed.has(nk)||byNatural.has(nk))
        fail('Draft pick has overlapping direct and swap ownership.');
      participantUsed.add(nk);
    }
  }
  for(const [key,group] of byNatural){
    if(group.length>1){
      const covered=new Set();
      for(const p of group){
        const range=getOwnedPickRange(p);
        if(!range||!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<1||
           range.end>(key.startsWith('1|')?30:60)||range.end<range.start)
          fail('Split draft rights require explicit valid numbered ownership ranges.');
        for(let pos=range.start;pos<=range.end;pos++){
          if(covered.has(pos))fail('Two managers own the same protected pick slot.');
          covered.add(pos);
        }
      }
      const expected=key.startsWith('1|')?Array.from({length:30},(_,i)=>i+1):Array.from({length:30},(_,i)=>i+31);
      if(expected.some(x=>!covered.has(x)))fail('A protected pick has uncovered ownership positions.');
    }
  }
  const audit=auditDraftPickIntegrity(state);
  const relevant=(audit.errors||[]).filter(e=>{
    const key=String(e.key||e.slot||'');return key.startsWith(`${draftYear}|`)||
      key.includes(`|${draftYear}|`)||!key;
  });
  if(relevant.length)fail(`The original draft-rights audit found ${relevant.length} conflicts.`);
  return {names,entries,source};
}

export function settleOnlineDraftRights(state){
  const lottery=state?.onlineDraftLottery;
  if(!obj(lottery)||lottery.stage!=='orderDrawn'||lottery.rightsSettlement!=='pending'||
    !obj(lottery.result)||state?.onlineDraftRights||state?.onlineDraft)
    fail('Official draft lottery must be drawn exactly once before settling rights.');
  const year=Number(lottery.draftYear);
  if(!Number.isInteger(year)||year<2026||year>2095||year!==Number(state?.onlinePostseason?.seasonYear)+1)
    fail('Draft season is inconsistent with the completed NBA Finals.');
  const {names,source}=preflightDraftRights(state,year);
  const original=lottery.result.fullDraftOrder;
  if(!Array.isArray(original)||original.length!==60||original.some((row,i)=>
    !obj(row)||Number(row.pick)!==i+1||!names.some(n=>same(n,row.originalTeamName))))
    fail('Official lottery order has malformed or duplicate natural picks.');
  const resolved=applyDraftPickOwnershipToLotteryResult(lottery.result,{leagueData:state,seasonYear:year});
  const order=resolved.fullDraftOrder;
  const firstForfeited=getForfeitedDraftPickKeys(state,year,1);
  const secondForfeited=getForfeitedDraftPickKeys(state,year,2);
  const forfeited=new Set([...firstForfeited,...secondForfeited]);
  if(!Array.isArray(order)||order.length!==60-forfeited.size)
    fail('Resolved draft size disagrees with the original forfeiture rules.');
  const naturalKeys=new Set(),slots=new Set();
  for(const row of order){
    const pick=Number(row.pick),round=Number(row.round),raw=original[pick-1];
    const naturalKey=`${round}|${normalizeTeamName(row.originalTeamName)}`;
    if(!Number.isInteger(pick)||pick<1||pick>60||slots.has(pick)||naturalKeys.has(naturalKey)||
       !raw||round!==Number(raw.round)||!same(row.originalTeamName,raw.originalTeamName)||
       !names.some(n=>same(n,row.currentOwnerTeamName))||!same(row.currentOwnerTeamName,row.teamName)||
       forfeited.has(naturalKey))fail('A settled draft slot duplicates or misidentifies ownership.');
    slots.add(pick);naturalKeys.add(naturalKey);
  }
  for(const row of original){
    const key=`${row.round}|${normalizeTeamName(row.originalTeamName)}`;
    if(!forfeited.has(key)&&!naturalKeys.has(key))fail('Draft settlement lost a franchise entitlement.');
  }
  const digest=createHash('sha256').update(JSON.stringify({year,draftPicks:source,
    draftPickForfeitures:state.draftPickForfeitures||[]})).digest('hex');
  return {status:'settled',seasonYear:Number(lottery.seasonYear),draftYear:year,
    rightsSourceSha256:digest,order,removedSlots:[...slots].length===60?[]:
       original.filter(p=>!slots.has(Number(p.pick))).map(p=>Number(p.pick)),
    ownershipVersion:resolved.pickOwnershipVersion||'single-player-original',
    // Preserve original result unchanged, and never publish browser-generated owners.
    settledAt:null};
}
