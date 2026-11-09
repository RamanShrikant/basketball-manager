import {canOnlineAddPickProtection} from './onlineCustomPickProtections.mjs';
import {parseOnlineTradePickToken,canOnlineCreateSwapPair} from './onlinePickSwapCommands.mjs';
// Advisory checks for the online Trade Center inbox. These never authorize a
// transaction; the Supabase RPC re-resolves and locks every asset on acceptance.
// Keep this pure and offline-testable. No single-player writes or save reads.
const listTeams = league => Array.isArray(league?.teams)
  ? league.teams
  : Object.values(league?.conferences || {}).flat().filter(Boolean);
const playerId = p => String(p?.id ?? p?.playerId ?? '').trim();
const ids = values => Array.isArray(values) ? values.map(String) : [];

export function inspectPendingOnlineTradeOffer(offer, league) {
  if (!offer || offer.status !== 'pending') return {current:true,reason:''};
  const teams = listTeams(league);
  const firstTeam = String(offer.proposer_team || '');
  const secondTeam = String(offer.recipient_team || '');
  if (!firstTeam || !secondTeam || firstTeam === secondTeam ||
    teams.filter(t => t?.name === firstTeam).length !== 1 ||
    teams.filter(t => t?.name === secondTeam).length !== 1) {
    return {current:false,reason:'One of the trade teams is no longer available in this league.'};
  }
  const sending = ids(offer.proposer_player_ids);
  const incoming = ids(offer.recipient_player_ids);
  if (!sending.length || !incoming.length ||
    sending.length > 4 || incoming.length > 4 ||
    new Set([...sending,...incoming]).size !== sending.length + incoming.length) {
    return {current:false,reason:'This proposal has invalid or repeated player IDs.'};
  }
  // Find the owner in the ENTIRE league, not only the two displayed rosters.
  // Repeated IDs in another roster should not be presented as a valid trade.
  const owners = new Map();
  for (const team of teams) {
    for (const p of Array.isArray(team?.players) ? team.players : []) {
      const id = playerId(p);
      if (!id) continue;
      const existing = owners.get(id) || [];
      existing.push(team.name);
      owners.set(id,existing);
    }
  }
  for (const [teamName,playerIds] of [[firstTeam,sending],[secondTeam,incoming]]) {
    for (const id of playerIds) {
      const found = owners.get(id) || [];
      if (found.length !== 1 || found[0] !== teamName) {
        return {current:false,reason:'A player in this offer has moved, disappeared, or has ambiguous ownership.'};
      }
    }
  }
  const sendingPicks = ids(offer.proposer_pick_ids);
  const incomingPicks = ids(offer.recipient_pick_ids);
  const parsedTokens=[...sendingPicks,...incomingPicks].map(parseOnlineTradePickToken);
  if (sendingPicks.length > 3 || incomingPicks.length > 3 || parsedTokens.some(token=>!token) ||
      new Set(parsedTokens.map(token=>token?.id)).size !== sendingPicks.length + incomingPicks.length) {
    return {current:false,reason:'This offer has invalid or repeated draft-pick IDs.'};
  }
  const swapRequests=parsedTokens.filter(token=>token?.swapDirection);
  if (swapRequests.length) {
    if (swapRequests.length!==1 || sendingPicks.length!==1 || incomingPicks.length!==1 ||
        !parseOnlineTradePickToken(sendingPicks[0])?.swapDirection ||
        parseOnlineTradePickToken(incomingPicks[0])?.swapDirection ||
        parseOnlineTradePickToken(incomingPicks[0])?.topN!==null) {
      return {current:false,reason:'A swap requires exactly one unprotected first-round pick from each GM.'};
    }
    if (!Array.isArray(league?.draftPicks)) return {current:false,reason:'The draft-rights ledger is unavailable.'};
    const from=league.draftPicks.filter(p=>String(p.id)===parsedTokens[0].id);
    const to=league.draftPicks.filter(p=>String(p.id)===parsedTokens[1].id);
    if (from.length!==1 || to.length!==1 || !canOnlineCreateSwapPair(from[0],to[0],league.draftPicks,league)) {
      return {current:false,reason:'One of the paired swap rights is no longer eligible.'};
    }
  }
  if (sendingPicks.length || incomingPicks.length) {
    if (!Array.isArray(league?.draftPicks)) {
      return {current:false,reason:'The shared draft ownership ledger is unavailable.'};
    }
    for (const [teamName,pickIds] of [[firstTeam,sendingPicks],[secondTeam,incomingPicks]]) {
      for (const token of pickIds) {
        const {id,topN} = parseOnlineTradePickToken(token);
        const matches = league.draftPicks.filter(p => String(p?.id || '') === id);
        if (matches.length !== 1) {
          return {current:false,reason:'A traded draft pick is unavailable or has ambiguous ownership.'};
        }
        const pick = matches[0];
        if (topN!==null && !canOnlineAddPickProtection(pick,league.draftPicks,league)) {
          return {current:false,reason:'This pick can no longer receive the requested Top-N protection.'};
        }
        const aliases = [pick.ownerTeam,pick.owner,pick.currentOwnerTeamName]
          .filter(v => typeof v === 'string' && v.trim());
        if (!aliases.length || aliases.some(v => v !== teamName) ||
          String(pick.status || 'active').toLowerCase() !== 'active') {
          return {current:false,reason:'Draft-pick ownership or availability changed.'};
        }
      }
    }
  }
  return {current:true,reason:''};
}
