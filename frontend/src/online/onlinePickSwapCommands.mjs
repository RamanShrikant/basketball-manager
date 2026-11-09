import {onlineDraftTradeWindow} from './onlineDraftTradeWindow.mjs';
// Advisory UI token codec. Server independently validates both original rights.
// Only the proposer may request a paired swap; the receiving GM approves it.
const SUFFIX = '~swap:';
export function parseOnlineSwapToken(token) {
  if (typeof token !== 'string' || token.length > 120) return null;
  const at = token.indexOf(SUFFIX);
  if (at < 1 || token.indexOf(SUFFIX, at + SUFFIX.length) >= 0) return null;
  const id = token.slice(0, at);
  const direction = token.slice(at + SUFFIX.length);
  if (!id || id.includes('~protect:') || !['best','worst'].includes(direction)) return null;
  return { id, direction };
}
export function makeOnlineSwapToken(id,direction) {
  if (typeof id !== 'string' || !id.trim() || id.includes('~swap:') || id.includes('~protect:')) return null;
  return parseOnlineSwapToken(`${id}${SUFFIX}${direction}`) ? `${id}${SUFFIX}${direction}` : null;
}
export function parseOnlineTradePickToken(token) {
  const swap = parseOnlineSwapToken(token);
  if (swap) return {id:swap.id,topN:null,swapDirection:swap.direction};
  if (typeof token !== 'string' || token.length > 120 || token.includes(SUFFIX)) return null;
  if (token.includes('~protect:')) {
    const match = token.match(/^(.+)~protect:([1-9]|1[0-9]|2[0-9])$/);
    if (!match || match[1].includes('~protect:')) return null;
    return {id:match[1],topN:Number(match[2]),swapDirection:null};
  }
  if (!token) return null;
  return {id:token,topN:null,swapDirection:null};
}
export function canOnlineCreateSwapPair(a,b,rows=[],leagueData=null) {
  const window=onlineDraftTradeWindow(leagueData);
  if (!window || !a || !b || a.id===b.id || String(a.originalTeam)===String(b.originalTeam) ||
      Number(a.year)!==Number(b.year) || Number(a.round)!==1 || Number(b.round)!==1 ||
      Number(a.year)<window.firstPickYear || Number(a.year)>window.lastSwapYear) return false;
  for (const p of [a,b]) {
    if (String(p.status||'active').toLowerCase()!=='active' || String(p.assetType||p.type||'pick').toLowerCase()!=='pick') return false;
    if (!['unprotected','none','null'].includes(String(p.protections||p.protection||'unprotected').toLowerCase())) return false;
    if (p.ownedSlots||p.ownedRange||p.tradeRule||p.swapId||p.swapWithTeam||p.conditionalConveyance||
        p.futureConveyance||p.rolloverConditions||p.resolvedPickNumber||p.pickNumber||p.fallbackPick) return false;
    const same = rows.filter(peer=>String(peer.originalTeam||peer.originalTeamName)===String(p.originalTeam)&&
      Number(peer.year)===Number(p.year)&&Number(peer.round)===1&&
      String(peer.status||'active').toLowerCase()==='active');
    if (same.length!==1 || same[0].id!==p.id) return false;
  }
  return true;
}
