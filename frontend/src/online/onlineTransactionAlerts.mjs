// Phase G3B-A: presentation-only summaries of COMMITTED RLS-protected journal rows.
// Never infer a completed deal from a pending offer, a browser preview or a local save.
const PLAYER_KEYS = ['players','twoWayPlayers','stashPlayers','pendingRookieSignings'];
const compact = (value, fallback = '', max = 110) => {
  const s = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return s ? s.slice(0, max) : fallback;
};
const number = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const list = value => Array.isArray(value) ? value : [];

export function onlineAlertPlayerIndex(leagueData = {}) {
  const result = new Map();
  const teams = Array.isArray(leagueData?.teams) ? leagueData.teams : [
    ...list(leagueData?.conferences?.East), ...list(leagueData?.conferences?.West)
  ];
  const add = (player, team = '') => {
    const id = compact(player?.id ?? player?.playerId);
    if (!id) return;
    // Keep the authoritative current team for a completed trade or signing.
    result.set(id, { name: compact(player?.name ?? player?.playerName, 'Player'), team });
  };
  for (const team of teams) for (const bucket of PLAYER_KEYS) {
    for (const player of list(team?.[bucket])) add(player,compact(team?.name));
  }
  for (const player of list(leagueData?.freeAgents)) add(player,'Free Agency');
  return result;
}

function names(ids, playerIndex) {
  const raw = list(ids);
  if (!raw.length) return 'no players';
  const found = raw.map(id => playerIndex.get(String(id))?.name || 'unnamed player');
  return found.length > 3 ? `${found.slice(0,3).join(', ')} +${found.length-3} more` : found.join(', ');
}
function pickDescriptions(tokens, draftPicks=[]) {
  const picks=list(draftPicks);
  const values=list(tokens).map(token=>{
    const raw=compact(token,'',140);
    const swap=raw.match(/~swap:(best|worst)$/);
    const protection=raw.match(/~protect:([1-9]|1\d|2\d)$/);
    const id=raw.replace(/~swap:(best|worst)$/,'').replace(/~protect:(?:[1-9]|1\d|2\d)$/,'');
    const row=picks.find(p=>String(p?.id)===id);
    if(!row)return 'a draft pick';
    const year=number(row.year),round=number(row.round);
    if(!year || ![1,2].includes(round))return 'a draft pick';
    const source=compact(row.originalTeam??row.originalTeamName,'',42);
    return `${year} ${round===1?'1st':'2nd'}-round${source?` (${source})`:''}${protection?` · top-${protection[1]} protected`:''}${swap?` · ${swap[1]} swap`:''}`;
  });
  return values.length>2?`${values.slice(0,2).join(', ')} +${values.length-2} more`:values.join(', ');
}
function assets(players, picks, playerIndex, draftPicks) {
  const rows=[];
  if (list(players).length) rows.push(names(players,playerIndex));
  if (list(picks).length) rows.push(pickDescriptions(picks,draftPicks));
  return rows.join(' + ') || 'no assets listed';
}

function signedPlayer(d, playerIndex) {
  const playerId=compact(d.player_id ?? d.playerId ?? d.playerKey?.replace?.(/^id:/,''));
  return compact(d.player_name ?? d.playerName ?? playerIndex.get(playerId)?.name, 'a player');
}
function fromActor(actorId, members, people) {
  const actor=compact(actorId);
  const profile=people?.[actor];
  const member=list(members).find(m=>m?.user_id===actor);
  return {
    by:compact(profile?.display_name,'Another GM',64),
    actorTeam:compact(member?.team_name,'')
  };
}

/** Return null for non-final actions, own events, CPU draft picks, and invalid journal rows. */
export function formatOnlineTransactionAlert(event, options={}) {
  if (!event || typeof event!=='object' || event.actor_id == null ||
      String(event.actor_id) === String(options.currentUserId)) return null;
  const revision=compact(event.revision);
  if (!/^[1-9]\d*$/.test(revision)) return null;
  const d=event.details && typeof event.details==='object' && !Array.isArray(event.details) ? event.details : {};
  const players=options.playerIndex instanceof Map ? options.playerIndex : onlineAlertPlayerIndex(options.leagueData);
  const who=fromActor(event.actor_id,options.members,options.people);
  const team=compact(d.team_name ?? d.teamName ?? d.team,who.actorTeam||'A team',86);
  let kind='',headline='',detail='';
  switch(event.action_type){
    case 'sign_cap_room_free_agent':
    case 'sign_cap_room_contract': {
      if (!d.player_id && !d.player_name) return null;
      kind='signing';headline=`${team} signed ${signedPlayer(d,players)}`;
      const years=number(d.years);
      detail=years?`${years}-year contract confirmed`:'Free-agent contract confirmed';
      break;
    }
    case 'release_standard_player': {
      if (!d.player_id && !d.player_name) return null;
      kind='release';headline=`${team} released ${signedPlayer(d,players)}`;
      detail='Player moved to free agency · guaranteed salary obligations remain';
      break;
    }
    case 'human_trade_accepted':
    case 'cpu_trade_accepted': {
      const from=compact(d.from_team, 'First team',86), to=compact(d.to_team,'Second team',86);
      if (!Array.isArray(d.sending) || !Array.isArray(d.receiving)) return null;
      kind='trade';headline=`${from} ↔ ${to}`;
      detail=`${from} traded ${assets(d.sending,d.sending_picks,players,options.leagueData?.draftPicks)}; ${to} traded ${assets(d.receiving,d.receiving_picks,players,options.leagueData?.draftPicks)}`;
      break;
    }
    case 'nba_draft_pick_made': {
      if (d.cpu===true || d.cpu==='true') return null;
      const pick=d.pick && typeof d.pick==='object' ? d.pick : {};
      const picked=compact(pick.playerName ?? pick.name ?? players.get(String(pick.playerId))?.name);
      if (!picked) return null;
      kind='draft';headline=`${team} drafted ${picked}`;
      const pickNum=number(pick.pick);
      detail=pickNum?`NBA Draft · pick #${pickNum}`:'NBA Draft selection confirmed';
      break;
    }
    case 'rookie_signings_human': {
      const count=number(d.count);
      if (!count) return null;
      kind='signing';headline=`${team} finalized rookie contracts`;
      detail=`${count} rookie decision${count===1?'':'s'} confirmed · individual names not included in this event`;
      break;
    }
    case 'online_market_decision': {
      if (!number(d.signings)) return null;
      const key=compact(d.playerKey).replace(/^id:/,'');
      const row=players.get(key);
      if (!row?.name || !row?.team || row.team==='Free Agency') return null;
      kind='signing';headline=`${row.team} signed ${row.name}`;
      detail='Offseason free-agency decision confirmed';
      break;
    }
    default:return null; // A bid or proposal is NEVER announced as a signing or trade.
  }
  return {
    id:`${compact(event.request_id,'revision')}:${revision}`,
    revision,kind,headline,detail,
    by:who.by, team:who.actorTeam,
  };
}

/** Pure cursor and deduplication helper shared by the live activity component and tests. */
export function collectFreshOnlineAlerts(events, cursor, options, limit=3) {
  const start=BigInt(cursor || 0);
  const playerIndex=onlineAlertPlayerIndex(options.leagueData);
  const rows=list(events).filter(e=>/^[1-9]\d*$/.test(String(e?.revision||''))&&BigInt(e.revision)>start)
    .sort((a,b)=>BigInt(a.revision)<BigInt(b.revision)?-1:1);
  let highest=start;
  const notifications=[];
  for (const row of rows) {
    highest=BigInt(row.revision)>highest?BigInt(row.revision):highest;
    const notice=formatOnlineTransactionAlert(row,{...options,playerIndex});
    if(notice)notifications.push(notice);
  }
  return {cursor:highest.toString(),alerts:notifications.slice(-limit)};
}
