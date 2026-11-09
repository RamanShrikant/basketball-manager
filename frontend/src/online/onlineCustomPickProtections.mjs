import {onlineDraftTradeWindow} from './onlineDraftTradeWindow.mjs';
// A trade offer stores an opaque pick ID with an optional ~protect:N command.
// This is an advisory UI encoding ONLY: the SQL resolver must independently
// prove ownership and split the locked pick ledger on acceptance.
const SUFFIX = '~protect:';
export function parseOnlineProtectionToken(token) {
  if (typeof token !== 'string' || !token || token.length > 120) return null;
  const at = token.indexOf(SUFFIX);
  if (at < 0) return {id:token,topN:null};
  if (at === 0 || token.indexOf(SUFFIX,at+SUFFIX.length) >= 0) return null;
  const text=token.slice(at+SUFFIX.length);
  if (!/^(?:[1-9]|1[0-9]|2[0-9])$/.test(text)) return null;
  return {id:token.slice(0,at),topN:Number(text)};
}
export function makeOnlineProtectionToken(id, topN = null) {
  if (typeof id !== 'string' || !id.trim() || id.includes(SUFFIX)) return null;
  const token=topN===null || topN==='none' ? id : `${id}${SUFFIX}${Number(topN)}`;
  const parsed=parseOnlineProtectionToken(token);
  return parsed && parsed.id===id ? token : null;
}
export function canOnlineAddPickProtection(pick, allPicks = [], leagueData = null) {
  const window=onlineDraftTradeWindow(leagueData);
  if (!window || !pick || Number(pick.round)!==1 || Number(pick.year)<window.firstPickYear || Number(pick.year)>window.lastPickYear) return false;
  if (String(pick.protection||pick.protections||'unprotected').toLowerCase()!=='unprotected') return false;
  if (pick.ownedSlots || pick.ownedRange || pick.realLifeDetails?.ownedSlots ||
      pick.tradeRule || pick.swapWithTeam || pick.swapId || pick.rolloverConditions ||
      pick.futureConveyance || pick.conditionalConveyance || pick.fallbackPick) return false;
  const lineage=(allPicks||[]).filter(p=>Number(p.year)===Number(pick.year)&&
    Number(p.round)===1&&String(p.originalTeam)===String(pick.originalTeam)&&
    String(p.status||'active').toLowerCase()==='active'&&
    String(p.assetType||p.type||'pick').toLowerCase()==='pick');
  return lineage.length===1 && lineage[0].id===pick.id;
}
