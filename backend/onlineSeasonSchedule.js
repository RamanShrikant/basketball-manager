// Read-only extraction of the finished single-player Calendar.jsx schedule generator.
// DO NOT EDIT the original Calendar or single-player state; compare source slices in tests.
import {resolveTeamDivision,getDivisionConference} from '../frontend/src/utils/leagueDivisions.js';
const slugifyId = v => String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
const fmt = d => d.toISOString().slice(0,10);
const addDays = (d,n) => {const x=new Date(d); x.setDate(x.getDate()+n); return x;};
const rangeDays=(start,end)=>{const out=[];for(let d=new Date(start);d<=end;d=addDays(d,1))out.push(new Date(d));return out;};
function parseCalendarDate(value){const m=String(value||'').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return null;const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));return d.getFullYear()===Number(m[1])&&d.getMonth()===Number(m[2])-1&&d.getDate()===Number(m[3])?d:null;}
function stableHashNumber(value = "") {
  let hash = 2166136261;
  for (const ch of String(value)) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function resolveCalendarTeamMeta(teams = []) {
  const byCanon = {};
  const byConference = { East: [], West: [] };
  const byDivision = {};

  teams.forEach((t) => {
    const cid = slugifyId(t.name);
    const division = resolveTeamDivision(t, t.conference || t.conf || "");
    const conference = getDivisionConference(division) || t.conference || t.conf || "";
    const row = {
      id: cid,
      name: t.name,
      division,
      conference,
      logo: t.logo || t.teamLogo || t.logoUrl || t.image || t.img || t.newTeamLogo || "",
    };
    byCanon[cid] = row;
    if (!byConference[conference]) byConference[conference] = [];
    byConference[conference].push(row);
    if (!byDivision[division]) byDivision[division] = [];
    byDivision[division].push(row);
  });

  return { byCanon, byConference, byDivision };
}

function addSeriesGames(matchups, a, b, count, seedLabel = "", threeGameTwoHomeTeamId = null) {
  if (!a || !b || a.id === b.id) return;
  if (count === 4) {
    matchups.push({ home: a.id, away: b.id }, { home: b.id, away: a.id }, { home: a.id, away: b.id }, { home: b.id, away: a.id });
    return;
  }
  if (count === 2) {
    matchups.push({ home: a.id, away: b.id }, { home: b.id, away: a.id });
    return;
  }

  const aGetsTwoHome = threeGameTwoHomeTeamId
    ? a.id === threeGameTwoHomeTeamId
    : stableHashNumber(`${seedLabel}|${a.id}|${b.id}`) % 2 === 0;
  matchups.push(
    { home: aGetsTwoHome ? a.id : b.id, away: aGetsTwoHome ? b.id : a.id },
    { home: aGetsTwoHome ? b.id : a.id, away: aGetsTwoHome ? a.id : b.id },
    { home: aGetsTwoHome ? a.id : b.id, away: aGetsTwoHome ? b.id : a.id }
  );
}

function getExtraFourGamePairsForConference(confTeams = []) {
  const divisions = {};
  for (const team of confTeams) {
    if (!divisions[team.division]) divisions[team.division] = [];
    divisions[team.division].push(team);
  }
  const divisionRows = Object.values(divisions).map((rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name)));
  const extras = new Set();
  for (let i = 0; i < divisionRows.length; i += 1) {
    for (let j = i + 1; j < divisionRows.length; j += 1) {
      const aRows = divisionRows[i];
      const bRows = divisionRows[j];
      const limit = Math.min(aRows.length, bRows.length);
      for (let idx = 0; idx < limit; idx += 1) {
        for (let shift = 0; shift < Math.min(3, limit); shift += 1) {
          const a = aRows[idx];
          const b = bRows[(idx + shift) % limit];
          extras.add([a.id, b.id].sort().join("__"));
        }
      }
    }
  }
  return extras;
}

function buildDivisionAwareMatchups(teams = []) {
  const { byCanon, byConference } = resolveCalendarTeamMeta(teams);
  const ids = Object.keys(byCanon);
  const matchups = [];
  const extrasByConference = Object.fromEntries(
    Object.entries(byConference).map(([conference, rows]) => [conference, getExtraFourGamePairsForConference(rows)])
  );
  const threeGameTwoHomeCounts = Object.fromEntries(ids.map((id) => [id, 0]));

  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = byCanon[ids[i]];
      const b = byCanon[ids[j]];
      if (!a || !b) continue;

      let count = 2;
      if (a.conference === b.conference) {
        if (a.division === b.division) {
          count = 4;
        } else {
          const extras = extrasByConference[a.conference] || new Set();
          const key = [a.id, b.id].sort().join("__");
          count = extras.has(key) ? 4 : 3;
        }
      }
      let twoHomeTeamId = null;
      if (count === 3) {
        const aCount = threeGameTwoHomeCounts[a.id] || 0;
        const bCount = threeGameTwoHomeCounts[b.id] || 0;
        if (aCount < 2 && bCount >= 2) twoHomeTeamId = a.id;
        else if (bCount < 2 && aCount >= 2) twoHomeTeamId = b.id;
        else twoHomeTeamId = stableHashNumber(`${a.id}|${b.id}|three-home`) % 2 === 0 ? a.id : b.id;
        threeGameTwoHomeCounts[twoHomeTeamId] = (threeGameTwoHomeCounts[twoHomeTeamId] || 0) + 1;
      }
      addSeriesGames(matchups, a, b, count, `${a.conference}|${a.division}|${b.division}`, twoHomeTeamId);
    }
  }

  return { matchups, byCanon };
}

function hasTeamGameOn(scheduleTeamDates, teamId, dateStr) {
  return Boolean(scheduleTeamDates?.[teamId]?.has(dateStr));
}

function violatesThreeStraight(scheduleTeamDates, teamId, dateStr) {
  const d = parseCalendarDate(dateStr);
  if (!d) return false;
  const prev1 = fmt(addDays(d, -1));
  const prev2 = fmt(addDays(d, -2));
  const next1 = fmt(addDays(d, 1));
  const next2 = fmt(addDays(d, 2));
  return (
    (hasTeamGameOn(scheduleTeamDates, teamId, prev1) && hasTeamGameOn(scheduleTeamDates, teamId, prev2)) ||
    (hasTeamGameOn(scheduleTeamDates, teamId, prev1) && hasTeamGameOn(scheduleTeamDates, teamId, next1)) ||
    (hasTeamGameOn(scheduleTeamDates, teamId, next1) && hasTeamGameOn(scheduleTeamDates, teamId, next2))
  );
}

function sortedPairKey(a, b) {
  return [String(a || ""), String(b || "")].sort().join("__");
}

function daysBetweenDateStrings(a, b) {
  const left = parseCalendarDate(a);
  const right = parseCalendarDate(b);
  if (!left || !right) return 0;
  return Math.round((right.getTime() - left.getTime()) / 86400000);
}

function spansAllowedAllStarBreak(a, b, allStarBreakSet) {
  const left = parseCalendarDate(a);
  const right = parseCalendarDate(b);
  if (!left || !right || !allStarBreakSet?.size) return false;
  for (const dateStr of allStarBreakSet) {
    const d = parseCalendarDate(dateStr);
    if (d && d > left && d < right) return true;
  }
  return false;
}

function buildCompactSeasonRoundDates(playableDays, neededRounds, allStarBreakSet) {
  if (!Array.isArray(playableDays) || neededRounds <= 0) return [];
  if (playableDays.length <= neededRounds) return playableDays.slice(0, neededRounds);

  let indexes = [];

  // The normal NBA rhythm is basically game, off day, game. When the number of
  // playable dates permits it, start from every-other-day slots, then inject a
  // few controlled back-to-back/two-day-rest pairs without ever creating long
  // dead zones outside the All-Star break.
  if (playableDays.length >= neededRounds * 2 - 1) {
    indexes = Array.from({ length: neededRounds }, (_, index) => index * 2);
  } else {
    const maxIndex = playableDays.length - 1;
    indexes = Array.from({ length: neededRounds }, (_, index) =>
      Math.round((index * maxIndex) / Math.max(1, neededRounds - 1))
    );
  }

  // De-dupe/fill defensive path for custom shortened seasons.
  const used = new Set();
  indexes = indexes.map((raw) => {
    let next = Math.max(0, Math.min(playableDays.length - 1, Number(raw) || 0));
    while (used.has(next) && next < playableDays.length - 1) next += 1;
    while (used.has(next) && next > 0) next -= 1;
    used.add(next);
    return next;
  }).sort((a, b) => a - b);

  while (indexes.length < neededRounds) {
    const existing = new Set(indexes);
    const next = playableDays.findIndex((_, index) => !existing.has(index));
    if (next < 0) break;
    indexes.push(next);
    indexes.sort((a, b) => a - b);
  }

  // Add occasional back-to-backs by moving the middle date in a three-date run
  // from x+2 to x+1. The following interval then becomes x+1 -> x+4, which is
  // exactly two off days. Skip the tweak if a trade-deadline/all-star removed
  // date would make the real calendar gap too large.
  for (let pivot = 8; pivot + 2 < indexes.length; pivot += 14) {
    const leftIndex = indexes[pivot];
    const rightIndex = indexes[pivot + 2];
    const shiftedMiddle = leftIndex + 1;
    if (shiftedMiddle >= rightIndex || shiftedMiddle >= playableDays.length) continue;
    if (indexes.includes(shiftedMiddle)) continue;

    const leftDate = playableDays[leftIndex];
    const middleDate = playableDays[shiftedMiddle];
    const rightDate = playableDays[rightIndex];
    const leftGap = daysBetweenDateStrings(leftDate, middleDate);
    const rightGap = daysBetweenDateStrings(middleDate, rightDate);
    const rightGapAllowed = rightGap <= 3 || spansAllowedAllStarBreak(middleDate, rightDate, allStarBreakSet);

    if (leftGap === 1 && rightGapAllowed) {
      indexes[pivot + 1] = shiftedMiddle;
    }
  }

  indexes = [...new Set(indexes)].sort((a, b) => a - b).slice(0, neededRounds);
  return indexes.map((index) => playableDays[index]).filter(Boolean);
}

function buildPairQueues(matchups = []) {
  const queues = {};
  for (const game of matchups) {
    const key = sortedPairKey(game.home, game.away);
    if (!queues[key]) queues[key] = [];
    queues[key].push(game);
  }
  return queues;
}

function buildRoundPairsFromQueues(pairQueues = {}, teamIds = [], neededRounds = 82, scheduleSeed = "") {
  // Build 82 full-league rounds from the 82-game NBA matchup graph. Each round
  // has every team playing once, which naturally creates the game/off/game rhythm
  // Raman wanted and removes random 4-6 day dead zones from the old greedy spread.
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const pairCounts = {};
    for (const [key, queue] of Object.entries(pairQueues)) {
      pairCounts[key] = Array.isArray(queue) ? queue.length : 0;
    }

    const lastOpponent = Object.fromEntries(teamIds.map((id) => [id, null]));
    const rounds = [];

    const remainingBetween = (a, b) => pairCounts[sortedPairKey(a, b)] || 0;
    const remainingDegreeWithin = (team, available) => {
      let total = 0;
      for (const other of available) {
        if (other !== team) total += remainingBetween(team, other);
      }
      return total;
    };

    const candidateCountWithin = (team, available) => {
      let count = 0;
      for (const other of available) {
        if (other !== team && remainingBetween(team, other) > 0) count += 1;
      }
      return count;
    };

    const findRound = (roundIndex) => {
      const available = new Set(teamIds);
      const pairs = [];
      const failedStates = new Set();

      const recurse = () => {
        if (available.size === 0) return true;

        const state = [...available].sort().join("|");
        if (failedStates.has(state)) return false;

        let team = null;
        let bestMeta = null;
        for (const candidate of available) {
          const possible = candidateCountWithin(candidate, available);
          const degree = remainingDegreeWithin(candidate, available);
          const meta = [possible, -degree, stableHashNumber(`${scheduleSeed}|${attempt}|${roundIndex}|pick|${candidate}`)];
          if (
            !bestMeta ||
            meta[0] < bestMeta[0] ||
            (meta[0] === bestMeta[0] && meta[1] < bestMeta[1]) ||
            (meta[0] === bestMeta[0] && meta[1] === bestMeta[1] && meta[2] < bestMeta[2])
          ) {
            team = candidate;
            bestMeta = meta;
          }
        }

        if (!team || bestMeta?.[0] <= 0) {
          failedStates.add(state);
          return false;
        }

        const opponents = [...available]
          .filter((other) => other !== team && remainingBetween(team, other) > 0)
          .sort((a, b) => {
            const remainingDiff = remainingBetween(team, b) - remainingBetween(team, a);
            if (remainingDiff) return remainingDiff;

            const repeatA = lastOpponent[team] === a || lastOpponent[a] === team ? 1 : 0;
            const repeatB = lastOpponent[team] === b || lastOpponent[b] === team ? 1 : 0;
            if (repeatA !== repeatB) return repeatA - repeatB;

            const degreeDiff = remainingDegreeWithin(b, available) - remainingDegreeWithin(a, available);
            if (degreeDiff) return degreeDiff;

            return stableHashNumber(`${scheduleSeed}|${attempt}|${roundIndex}|${team}|${a}`) - stableHashNumber(`${scheduleSeed}|${attempt}|${roundIndex}|${team}|${b}`);
          });

        available.delete(team);
        for (const opponent of opponents) {
          if (!available.has(opponent)) continue;
          available.delete(opponent);
          pairs.push([team, opponent]);

          if (recurse()) return true;

          pairs.pop();
          available.add(opponent);
        }
        available.add(team);

        failedStates.add(state);
        return false;
      };

      return recurse() ? pairs : null;
    };

    let ok = true;
    for (let roundIndex = 0; roundIndex < neededRounds; roundIndex += 1) {
      const pairs = findRound(roundIndex);
      if (!pairs) {
        ok = false;
        break;
      }

      for (const [a, b] of pairs) {
        const key = sortedPairKey(a, b);
        pairCounts[key] = (pairCounts[key] || 0) - 1;
        lastOpponent[a] = b;
        lastOpponent[b] = a;
      }
      rounds.push(pairs);
    }

    const remaining = Object.values(pairCounts).reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0);
    if (ok && remaining === 0) return rounds;
  }

  return null;
}

export function generateFullSeasonSchedule(teams, startDate, endDate, calendarConfig = null) {
  const canonicalIds = teams.map((t) => slugifyId(t.name));
  if (canonicalIds.length < 2) return { byDate: {}, list: [] };

  const scheduleSeed = String(calendarConfig?.scheduleSeed || ('schedule-v2|' + startDate.getFullYear()));
  const { matchups, byCanon } = buildDivisionAwareMatchups(teams);
  // Rotate home/away every year while retaining each pair's game count.
  if (startDate.getFullYear() % 2) for (const game of matchups) [game.home, game.away] = [game.away, game.home];
  const days = rangeDays(startDate, endDate);
  const byDate = {};
  for (const d of days) byDate[fmt(d)] = [];

  const gameStart =
    parseCalendarDate(calendarConfig?.regularSeasonGameStart) ||
    new Date(startDate.getFullYear(), 9, 21);
  const allStarDate = parseCalendarDate(calendarConfig?.allStarSelectionDate) || new Date(endDate.getFullYear(), 1, 15);
  const allStarStart = parseCalendarDate(calendarConfig?.allStarStart) || addDays(allStarDate, -5);
  const allStarEnd = parseCalendarDate(calendarConfig?.allStarEnd) || addDays(allStarDate, 3);
  const tradeDeadline = calendarConfig?.tradeDeadlineDate || fmt(new Date(endDate.getFullYear(), 1, 4));
  const extensionBlackoutDays = new Set([
    calendarConfig?.rookieExtensionDeadlineDate,
    calendarConfig?.contractExtensionDeadlineDate,
    calendarConfig?.veteranExtensionDeadlineDate,
  ].filter(Boolean));
  const allStarBreak = new Set(rangeDays(allStarStart, allStarEnd).map(fmt));

  const playableDays = days
    .filter((d) => d >= gameStart)
    .map(fmt)
    .filter((dateStr) => dateStr !== tradeDeadline && !extensionBlackoutDays.has(dateStr) && !allStarBreak.has(dateStr));

  const gamesPerFullRound = canonicalIds.length / 2;
  const neededRounds =
    canonicalIds.length % 2 === 0 && gamesPerFullRound > 0
      ? Math.round(matchups.length / gamesPerFullRound)
      : 0;

  const pairQueues = buildPairQueues(matchups);
  const rounds = neededRounds > 0
    ? buildRoundPairsFromQueues(pairQueues, canonicalIds, neededRounds, scheduleSeed)
    : null;
  const roundDates = buildCompactSeasonRoundDates(playableDays, neededRounds, allStarBreak);

  if (!rounds || roundDates.length < neededRounds) {
    console.warn("[Calendar] compact NBA schedule builder failed; using balanced fallback schedule.");
    return generateBalancedFallbackSchedule({
      teams,
      startDate,
      endDate,
      calendarConfig,
      matchups,
      byCanon,
      canonicalIds,
      playableDays,
      allStarBreak,
      tradeDeadline,
    });
  }

  rounds.forEach((pairs, roundIndex) => {
    const dateStr = roundDates[roundIndex];
    if (!dateStr) return;

    for (const [a, b] of pairs) {
      const key = sortedPairKey(a, b);
      const queued = pairQueues[key]?.shift();
      if (!queued) continue;

      const homeMeta = byCanon[queued.home];
      const awayMeta = byCanon[queued.away];
      if (!homeMeta || !awayMeta) continue;

      const roundGameIndex = byDate[dateStr].length;
      byDate[dateStr].push({
        id: `${dateStr}_${queued.away}_at_${queued.home}_${roundIndex}_${roundGameIndex}`,
        date: dateStr,
        homeId: queued.home,
        awayId: queued.away,
        home: homeMeta.name,
        away: awayMeta.name,
        homeLogo: homeMeta.logo,
        awayLogo: awayMeta.logo,
        homeTeamObj: homeMeta,
        awayTeamObj: awayMeta,
        confHome: homeMeta.conference,
        confAway: awayMeta.conference,
        divisionHome: homeMeta.division,
        divisionAway: awayMeta.division,
        played: false,
      });
    }
  });

  for (const dateStr of Object.keys(byDate)) {
    byDate[dateStr].sort((a, b) => String(a.away).localeCompare(String(b.away)) || String(a.home).localeCompare(String(b.home)));
  }

  return { byDate, list: Object.values(byDate).flat() };
}

function generateBalancedFallbackSchedule({
  teams,
  startDate,
  endDate,
  calendarConfig,
  matchups,
  byCanon,
  canonicalIds,
  playableDays,
  allStarBreak,
  tradeDeadline,
}) {
  const days = rangeDays(startDate, endDate);
  const byDate = {};
  for (const d of days) byDate[fmt(d)] = [];

  const dayLoad = Object.fromEntries(playableDays.map((dateStr) => [dateStr, 0]));
  const teamDates = Object.fromEntries(canonicalIds.map((id) => [id, new Set()]));
  const ordered = [...matchups].sort((a, b) => {
    const ha = stableHashNumber(`${a.home}|${a.away}`);
    const hb = stableHashNumber(`${b.home}|${b.away}`);
    return ha - hb;
  });
  const avgGamesPerDay = ordered.length / Math.max(1, playableDays.length);

  const pickDateForGame = (game, strict = true) => {
    let best = null;
    let bestScore = Infinity;
    for (let index = 0; index < playableDays.length; index += 1) {
      const dateStr = playableDays[index];
      if (hasTeamGameOn(teamDates, game.home, dateStr) || hasTeamGameOn(teamDates, game.away, dateStr)) continue;
      if (strict && (violatesThreeStraight(teamDates, game.home, dateStr) || violatesThreeStraight(teamDates, game.away, dateStr))) continue;
      const d = parseCalendarDate(dateStr);
      const restHomePrev = hasTeamGameOn(teamDates, game.home, fmt(addDays(d, -1))) ? 0 : 1;
      const restAwayPrev = hasTeamGameOn(teamDates, game.away, fmt(addDays(d, -1))) ? 0 : 1;
      const loadPenalty = Math.abs((dayLoad[dateStr] || 0) - avgGamesPerDay);
      const restMixBonus = restHomePrev === 0 || restAwayPrev === 0 ? -0.10 : 0;
      const score = loadPenalty * 2 + (dayLoad[dateStr] || 0) * 0.35 + restMixBonus + stableHashNumber(`${dateStr}|${game.home}|${game.away}`) / 1e12;
      if (score < bestScore) {
        bestScore = score;
        best = dateStr;
      }
    }
    return best;
  };

  ordered.forEach((game, gameIndex) => {
    let dateStr = pickDateForGame(game, true) || pickDateForGame(game, false) || playableDays[gameIndex % playableDays.length];
    if (!dateStr) return;
    const homeMeta = byCanon[game.home];
    const awayMeta = byCanon[game.away];
    const roundGameIndex = byDate[dateStr].length;
    byDate[dateStr].push({
      id: `${dateStr}_${game.away}_at_${game.home}_${gameIndex}_${roundGameIndex}`,
      date: dateStr,
      homeId: game.home,
      awayId: game.away,
      home: homeMeta.name,
      away: awayMeta.name,
      homeLogo: homeMeta.logo,
      awayLogo: awayMeta.logo,
      homeTeamObj: homeMeta,
      awayTeamObj: awayMeta,
      confHome: homeMeta.conference,
      confAway: awayMeta.conference,
      divisionHome: homeMeta.division,
      divisionAway: awayMeta.division,
      played: false,
    });
    dayLoad[dateStr] = (dayLoad[dateStr] || 0) + 1;
    teamDates[game.home].add(dateStr);
    teamDates[game.away].add(dateStr);
  });

  for (const dateStr of Object.keys(byDate)) {
    byDate[dateStr].sort((a, b) => String(a.away).localeCompare(String(b.away)) || String(a.home).localeCompare(String(b.home)));
  }

  return { byDate, list: Object.values(byDate).flat() };
}
