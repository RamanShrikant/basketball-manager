import {onlineDraftTradeWindow} from './onlineDraftTradeWindow.mjs';
// Online-only, conservative mirror of the trusted SQL draft-rights eligibility.
// This is explanatory UI, never an authorization check. SQL revalidates everything.
import {
  isActiveDraftPickAsset,
  isProtectedDraftPickAsset,
  isDraftPickEncumberedByActiveSwap,
  getOwnedPickRange,
  getDefaultPickOwnedRange,
} from '../utils/draftPicks.js';

const own=(row)=>String(row?.ownerTeam||row?.currentOwnerTeamName||row?.owner||'');
const origin=row=>String(row?.originalTeam||row?.originalTeamName||'');
const number=value=>Number(value||0);
const assetType=row=>String(row?.assetType||row?.type||'pick').toLowerCase();
const structuredRange=row=>row?.ownedSlots||row?.ownedRange||row?.realLifeDetails?.ownedSlots||null;
const rangeWithin=(range,round)=>{
  const base=getDefaultPickOwnedRange(round);
  return !!range&&Number.isInteger(Number(range.start))&&Number.isInteger(Number(range.end))&&
    Number(range.start)>=base.start&&Number(range.end)<=base.end&&Number(range.start)<=Number(range.end);
};
const trueRange=row=>getOwnedPickRange(row)||getDefaultPickOwnedRange(row?.round);
const protectedLabel=row=>String(row?.protections||row?.protection||row?.displayProtection||'unprotected').trim().toLowerCase();

export function classifyOnlineExistingPickRight(row,rows=[],leagueData=null){
  if(!row||!row.id)return 'Draft right has no stable identifier';
  const status=String(row.status||'active').toLowerCase();
  if(!isActiveDraftPickAsset(row)||status!=='active')return 'Inactive or resolved draft right';
  if(assetType(row)!=='pick')return 'Swap rights require their own settlement model';
  const yr=number(row.year),rnd=number(row.round);
  const window=onlineDraftTradeWindow(leagueData);
  if(!window)return 'Active online draft-trade season is not verified';
  if(!Number.isInteger(yr)||yr<window.firstPickYear||yr>window.lastPickYear||![1,2].includes(rnd))return 'Outside the supported online draft window';
  if(!origin(row))return 'Missing original-team lineage';
  if(row.tradeRule||row.resolvedPickNumber!=null||row.pickNumber!=null||row.rolloverConditions!=null||
     row.conditionalConveyance!=null||row.futureConveyance!=null||row.fallbackPick!=null||
     row.realLifeDetails?.conveyance!=null||row.realLifeDetails?.rollover!=null||row.realLifeDetails?.fallback!=null){
    return 'Conditional, resolved, or future-linked entitlement needs reconciliation';
  }
  if(row.ownedPickRange!=null&&!structuredRange(row))return 'Unsupported ownership-range encoding';
  const owner=own(row);
  if(!owner)return 'Missing current owner';
  if(['owner','currentOwnerTeamName'].some(field=>row[field]!=null&&String(row[field])!==owner)){
    return 'Conflicting owner fields';
  }
  const sameId=(rows||[]).filter(peer=>String(peer?.id||'')===String(row.id));
  if(sameId.length!==1)return 'Ambiguous or duplicate pick identifier';
  if(isDraftPickEncumberedByActiveSwap(row,rows,leagueData))return 'Already committed to active swap rights';
  const lineage=(rows||[]).filter(peer=>assetType(peer)==='pick'&&
    String(peer?.status||'active').toLowerCase()==='active'&&
    number(peer.year)===yr&&number(peer.round)===rnd&&origin(peer)===origin(row));
  const range=trueRange(row);
  if(!rangeWithin(range,rnd))return 'Invalid pick-number ownership range';
  if(lineage.length>1){
    if(!structuredRange(row))return 'Split rights must have explicit numbered ranges';
    for(const peer of lineage){
      if(peer===row||String(peer?.id)===String(row.id))continue;
      if(!structuredRange(peer))return 'Another rights slice has ambiguous ownership';
      const other=trueRange(peer);
      if(!rangeWithin(other,rnd)||range.start<=other.end&&other.start<=range.end){
        return 'Overlapping or invalid draft-right slices';
      }
    }
  } else if(isProtectedDraftPickAsset(row)&&!getOwnedPickRange(row)){
    const label=protectedLabel(row);
    if(!/^top\s+\d{1,2}\s+protected\b/.test(label)&&!/^lottery\s+protected\b/.test(label)){
      return 'This protection cannot yet be resolved by the draft engine';
    }
  }
  // The existing private SQL function conservatively prohibits trading a
  // team's furthest unprotected future first-rounder.
  if(rnd===1){
    const eligibleYears=(rows||[]).filter(p=>own(p)===owner&&assetType(p)==='pick'&&
      number(p.round)===1&&number(p.year)>=window.firstPickYear&&number(p.year)<=window.lastPickYear&&
      String(p.status||'active').toLowerCase()==='active'&&
      ['unprotected','none','null'].includes(protectedLabel(p))
    ).map(p=>number(p.year));
    if(!isProtectedDraftPickAsset(row)&&yr===Math.max(0,...eligibleYears)){
      return 'Furthest future unprotected first is temporarily restricted';
    }
  }
  return '';
}
