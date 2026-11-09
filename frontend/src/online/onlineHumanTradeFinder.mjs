// Human-GM matching suggestions for the ONLINE Trade Center.
// Pure, deterministic, bounded, non-authoritative. The single-player financial
// evaluator is injected by the UI and Supabase rechecks every proposed deal.
const stringId = player => String(player?.id ?? player?.playerId ?? '').trim();
const salaryAt = (player, year) => {
  const c = player?.contract || {};
  const index = year - Number(c.startYear ?? year);
  const value = Array.isArray(c.salaryByYear) ? c.salaryByYear[index] : null;
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
};
const rating = p => Number(p?.overall ?? p?.ovr ?? p?.rating ?? 0) || 0;
const valid = (p, year) => Boolean(stringId(p) && !p?.isTwoWay && !p?.isStash && !p?.retired && salaryAt(p,year)>0);

export function findHumanTradeMatches({sending, targetPlayers, year, evaluateMine, evaluateTheirs,
  ownRosterCount=15, theirRosterCount=15, ownRosterMax=16, theirRosterMax=16, maxResults=12}) {
  if (!valid(sending,year) || !Array.isArray(targetPlayers) ||
      typeof evaluateMine!=='function' || typeof evaluateTheirs!=='function') return [];
  const mySalary=salaryAt(sending,year);
  const pool=targetPlayers.filter(p=>valid(p,year) && stringId(p)!==stringId(sending))
    .slice(0,40);
  const offers=[];
  const seen=new Set();
  // Exact singles plus two-player packages; cap search at 820 checks per GM.
  for (let i=0;i<pool.length;i++) {
    for (let j=-1;j<i;j++) {
      const receive=j<0?[pool[i]]:[pool[j],pool[i]];
      const theirSalary=receive.reduce((n,p)=>n+salaryAt(p,year),0);
      if (ownRosterCount-1+receive.length>ownRosterMax ||
        theirRosterCount-receive.length+1>theirRosterMax) continue;
      if (!evaluateMine(mySalary,theirSalary)?.ok ||
        !evaluateTheirs(theirSalary,mySalary)?.ok) continue;
      const ids=receive.map(stringId);
      const key=ids.slice().sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      // A proximity ranking only — NOT an AI acceptance prediction.
      const theirOverall=receive.reduce((n,p)=>n+rating(p),0)/receive.length;
      const score=Math.abs(mySalary-theirSalary)/Math.max(1,mySalary) +
        Math.abs(rating(sending)-theirOverall)/100 + (receive.length-1)*0.045;
      offers.push({sendId:stringId(sending),receiveIds:ids,
        receiveNames:receive.map(p=>p?.name||p?.player||'Player'),
        sendSalary:mySalary,receiveSalary:theirSalary,score});
    }
  }
  return offers.sort((a,b)=>a.score-b.score || a.receiveIds.join('|').localeCompare(b.receiveIds.join('|')))
    .slice(0,Math.max(1,Math.min(25,Math.floor(maxResults)||12)));
}

export const __tradeFinderTestHelpers = {salaryAt,stringId,valid};
