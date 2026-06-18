import { computeTeamRatings } from "../api/teamRatings";

export const GAMEPLAN_VERSION = 10;

// Helpers to support both league shapes: { teams: [...] } or { conferences: { ... } }
function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function getRosterSignature(teamPlayers = []) {
  return [...teamPlayers]
    .map((p) =>
      [
        p.name || "",
        p.pos || "",
        p.secondaryPos || "",
        Number(p.overall) || 0,
      ].join("|")
    )
    .sort()
    .join("||");
}

function getRosterNames(teamPlayers = []) {
  return new Set(
    (teamPlayers || [])
      .map((p) => p?.name)
      .filter(Boolean)
  );
}

function safeParseGameplan(raw) {
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setsMatch(a, b) {
  if (a.size !== b.size) return false;

  for (const value of a) {
    if (!b.has(value)) return false;
  }

  return true;
}

function hasValidMinutesMap(minutes, rosterNames) {
  if (!minutes || typeof minutes !== "object") return false;

  const minuteNames = new Set(Object.keys(minutes));

  if (!setsMatch(rosterNames, minuteNames)) return false;

  for (const name of minuteNames) {
    if (!Number.isFinite(Number(minutes[name]))) return false;
  }

  return true;
}

function hasValidOrder(order, rosterNames) {
  if (!Array.isArray(order)) return false;

  const orderNames = new Set(order.filter(Boolean));
  return setsMatch(rosterNames, orderNames);
}

function isManualLockedGameplan(savedPlan) {
  return Boolean(
    savedPlan?.manualLocked ||
      savedPlan?.userEdited ||
      savedPlan?.source === "coach_gameplan"
  );
}

function hasValidManualGameplanForRoster(team, savedPlan) {
  if (!team?.name) return false;
  if (!savedPlan || typeof savedPlan !== "object") return false;
  if (!isManualLockedGameplan(savedPlan)) return false;
  if (savedPlan.version !== GAMEPLAN_VERSION) return false;
  if (savedPlan.teamName !== team.name) return false;

  const liveNames = getRosterNames(team?.players || []);
  if (!hasValidOrder(savedPlan.order, liveNames)) return false;
  if (!hasValidMinutesMap(savedPlan.minutes, liveNames)) return false;

  return true;
}

function shouldRebuildGameplan(team, savedPlan) {
  if (!team?.name) return false;
  if (!savedPlan || typeof savedPlan !== "object") return true;

  const teamPlayers = team?.players || [];
  const liveSignature = getRosterSignature(teamPlayers);
  const liveNames = getRosterNames(teamPlayers);

  // Preserve user-edited rotations during sim. OVR/progression changes can
  // change the full roster signature, but that should not wipe custom minutes
  // as long as the actual roster names still match.
  if (hasValidManualGameplanForRoster(team, savedPlan)) return false;

  if (savedPlan.version !== GAMEPLAN_VERSION) return true;
  if (savedPlan.teamName !== team.name) return true;
  if (savedPlan.rosterSignature !== liveSignature) return true;
  if (!hasValidOrder(savedPlan.order, liveNames)) return true;
  if (!hasValidMinutesMap(savedPlan.minutes, liveNames)) return true;

  return false;
}

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const STARTER_MINUTES = 24;
const BENCH_MINUTES = [17, 14, 12, 11, 10];
const FULL_TEAM_MINUTES = 5;
const ROTATION_SIZE = 10;
const STARTER_MAX_MINUTES = 42;
const BENCH_MAX_MINUTES = 30;
const HARD_MAX_MINUTES = 48;
const BENCH_SEARCH_LIMIT = 20;
const BENCH_FINALIST_LIMIT = 64;

const POT_FUTURE_WINDOWS = [
  { years: 3, weight: 0.30 },
  { years: 5, weight: 0.35 },
  { years: 7, weight: 0.35 },
];

const POT_SCALE_BASE = 77.8156;
const POT_SCALE_FLOOR_VALUE = 70;
const POT_SCALE_MULTIPLIER = 2.0199;
const POT_PROOF_BASE_OVERALL = 84;
const POT_PROOF_MULTIPLIER = 0.20;
const POT_ELITE_PROOF_BASE_OVERALL = 92;
const POT_ELITE_PROOF_MULTIPLIER = 1.10;

const POT_AGE_POINTS = [
  [18, 1.10],
  [20, 1.10],
  [22, 1.09],
  [24, 1.06],
  [26, 1.02],
  [27, 1.00],
  [28, 0.98],
  [29, 0.95],
  [30, 0.92],
  [31, 0.89],
  [32, 0.85],
  [33, 0.80],
  [34, 0.74],
  [35, 0.68],
  [36, 0.60],
  [37, 0.50],
  [38, 0.40],
  [39, 0.30],
  [40, 0.22],
  [41, 0.15],
  [42, 0.10],
  [45, 0.04],
];

function playerValue(p) {
  const overall = Number(p?.overall ?? 75);
  const off = Number(p?.offRating ?? overall);
  const def = Number(p?.defRating ?? overall);
  const stamina = Number(p?.stamina ?? 75);

  return (
    overall * 1.0 +
    off * 0.18 +
    def * 0.18 +
    (stamina - 70) * 0.08
  );
}

function comparePlayers(a, b) {
  const diff = playerValue(b) - playerValue(a);
  if (Math.abs(diff) > 1e-9) return diff;

  const ovrDiff = Number(b?.overall ?? 0) - Number(a?.overall ?? 0);
  if (ovrDiff !== 0) return ovrDiff;

  return String(a?.name || "").localeCompare(String(b?.name || ""));
}

function uniquePlayers(players) {
  const seen = new Set();
  const out = [];

  for (const p of players || []) {
    if (!p?.name || seen.has(p.name)) continue;
    seen.add(p.name);
    out.push(p);
  }

  return out;
}

function combos(arr, k) {
  const res = [];
  const go = (start, path) => {
    if (path.length === k) {
      res.push(path.slice());
      return;
    }

    for (let j = start; j < arr.length; j++) {
      path.push(arr[j]);
      go(j + 1, path);
      path.pop();
    }
  };

  go(0, []);
  return res;
}

function buildBenchPool(valid, starterNames) {
  const remaining = valid.filter((p) => !starterNames.has(p.name));
  if (remaining.length <= BENCH_SEARCH_LIMIT) return remaining;

  const locked = [];

  for (const pos of POSITIONS) {
    const bestAtPos = remaining
      .filter((p) => p.pos === pos || p.secondaryPos === pos)
      .sort(comparePlayers)
      .slice(0, 2);

    locked.push(...bestAtPos);
  }

  return uniquePlayers([
    ...locked,
    ...remaining.sort(comparePlayers),
  ]).slice(0, BENCH_SEARCH_LIMIT);
}

function isEligibleForPosition(player, pos) {
  return player?.pos === pos || player?.secondaryPos === pos;
}

function compareStarterForSlot(pos) {
  return (a, b) => {
    const ovrDiff = Number(b?.overall ?? 0) - Number(a?.overall ?? 0);
    if (ovrDiff !== 0) return ovrDiff;

    const primaryDiff = Number(b?.pos === pos) - Number(a?.pos === pos);
    if (primaryDiff !== 0) return primaryDiff;

    const secondaryDiff = Number(b?.secondaryPos === pos) - Number(a?.secondaryPos === pos);
    if (secondaryDiff !== 0) return secondaryDiff;

    const valueDiff = playerValue(b) - playerValue(a);
    if (Math.abs(valueDiff) > 1e-9) return valueDiff;

    return String(a?.name || "").localeCompare(String(b?.name || ""));
  };
}

function starterScoreFromMap(mapping) {
  let totalOvr = 0;
  let primaryHits = 0;
  let secondaryUses = 0;
  let totalValue = 0;

  for (const pos of POSITIONS) {
    const p = mapping[pos];
    if (!p) return -Infinity;

    totalOvr += Number(p.overall ?? 0);
    totalValue += playerValue(p);

    if (p.pos === pos) primaryHits += 1;
    else if (p.secondaryPos === pos) secondaryUses += 1;
  }

  // Hard priority order:
  // 1) highest possible starter OVR total while legally filling PG/SG/SF/PF/C
  // 2) most players in their primary position
  // 3) fewest secondary-position starts
  // 4) better all-around value as a final tie-breaker
  return (
    totalOvr * 1_000_000_000 +
    primaryHits * 1_000_000 +
    (POSITIONS.length - secondaryUses) * 10_000 +
    totalValue
  );
}

function emergencyStarterFallback(valid) {
  const used = new Set();
  const starters = [];

  for (const pos of POSITIONS) {
    const legal = valid
      .filter((p) => !used.has(p.name) && isEligibleForPosition(p, pos))
      .sort(compareStarterForSlot(pos));

    const pool = legal.length
      ? legal
      : valid
          .filter((p) => !used.has(p.name))
          .sort(compareStarterForSlot(pos));

    if (!pool.length) break;

    const picked = pool[0];
    used.add(picked.name);
    starters.push(picked);
  }

  return starters;
}

function chooseStarters(valid) {
  const roster = uniquePlayers(valid).filter(
    (p) => p && p.name && Number.isFinite(Number(p.overall))
  );

  if (roster.length <= 5) {
    return emergencyStarterFallback(roster);
  }

  const candidatesByPos = {};
  for (const pos of POSITIONS) {
    candidatesByPos[pos] = roster
      .filter((p) => isEligibleForPosition(p, pos))
      .sort(compareStarterForSlot(pos));
  }

  // If the roster truly cannot fill every position legally, only then use the
  // emergency fallback. Normal NBA rosters should take the exhaustive legal path.
  if (POSITIONS.some((pos) => candidatesByPos[pos].length === 0)) {
    return emergencyStarterFallback(roster);
  }

  let bestMap = null;
  let bestScore = -Infinity;
  const used = new Set();
  const mapping = {};

  const search = (slotIdx) => {
    if (slotIdx >= POSITIONS.length) {
      const score = starterScoreFromMap(mapping);
      if (score > bestScore) {
        bestScore = score;
        bestMap = { ...mapping };
      }
      return;
    }

    const pos = POSITIONS[slotIdx];
    for (const player of candidatesByPos[pos]) {
      if (used.has(player.name)) continue;

      used.add(player.name);
      mapping[pos] = player;
      search(slotIdx + 1);
      delete mapping[pos];
      used.delete(player.name);
    }
  };

  search(0);

  if (!bestMap) {
    return emergencyStarterFallback(roster);
  }

  return POSITIONS.map((pos) => bestMap[pos]).filter(Boolean);
}

function makeZeroMinutes(valid) {
  const obj = {};
  for (const p of valid) obj[p.name] = 0;
  return obj;
}

function localFatiguePenaltyForTie(mins, stamina) {
  const threshold = 0.359 * (Number(stamina ?? 75)) + 2.46;
  const over = Math.max(0, (mins || 0) - threshold);
  return Math.max(0.68, 1 - 0.010 * over);
}

function continuousTieScore(valid, minutesObj) {
  const POS_TARGET = 48;
  const SECONDARY_POS_CREDIT = 0.55;
  const posMin = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
  const active = [];
  let weighted = 0;

  for (const p of valid) {
    const m = Math.max(0, Number(minutesObj?.[p.name] || 0));
    if (m <= 0) continue;

    const overall = Number(p.overall ?? 75);
    const off = Number(p.offRating ?? overall);
    const def = Number(p.defRating ?? overall);
    const pen = localFatiguePenaltyForTie(m, p.stamina ?? 75);
    weighted += (m / 240) * ((overall * 0.5 + off * 0.25 + def * 0.25) * pen);

    const primaryPos = p.pos || "SG";
    const secondaryPos = p.secondaryPos || null;

    if (primaryPos && posMin[primaryPos] !== undefined) {
      posMin[primaryPos] += m;
    }

    active.push({
      minutes: m,
      pos: primaryPos,
      secondaryPos,
    });
  }

  // Match teamRatings.js: secondary positions are flex credit only. They fill
  // a shortage but never create extra overage, so a PG/SG is never worse than a
  // pure PG just because SG is already full.
  for (const p of active) {
    const secondary = p.secondaryPos;
    if (!secondary || secondary === p.pos || posMin[secondary] === undefined) {
      continue;
    }

    const shortage = Math.max(0, POS_TARGET - (posMin[secondary] || 0));
    if (shortage <= 0) continue;

    const flexCredit = Math.min(p.minutes * SECONDARY_POS_CREDIT, shortage);
    posMin[secondary] += flexCredit;
  }

  const coverageError = POSITIONS.reduce(
    (sum, pos) => sum + Math.abs((posMin[pos] || 0) - POS_TARGET),
    0
  );

  return weighted - coverageError * 0.018;
}

function scoreMinutes(valid, minutesObj) {
  const ratings = computeTeamRatings({ players: valid }, minutesObj);

  // Use exact 4-decimal ratings internally so rotations/sim-adjacent logic do
  // not treat two rounded display ratings as identical.
  const overall = Number(ratings.exactOverall ?? ratings.overall ?? 0);
  const off = Number(ratings.exactOff ?? ratings.off ?? 0);
  const def = Number(ratings.exactDef ?? ratings.def ?? 0);

  return (
    overall * 1_000_000 +
    off * 10_000 +
    def * 100 +
    continuousTieScore(valid, minutesObj)
  );
}

function getMinuteCap(p, starterNames, relaxed = false) {
  if (relaxed) return HARD_MAX_MINUTES;
  return starterNames.has(p.name) ? STARTER_MAX_MINUTES : BENCH_MAX_MINUTES;
}

function seedRotation(valid, starters, benchPlayers) {
  const rotation = [...starters, ...benchPlayers];
  const minByName = {};
  const minutesObj = makeZeroMinutes(valid);

  for (const p of starters) {
    minutesObj[p.name] = STARTER_MINUTES;
    minByName[p.name] = STARTER_MINUTES;
  }

  benchPlayers.forEach((p, idx) => {
    const min = BENCH_MINUTES[idx] ?? 10;
    minutesObj[p.name] = min;
    minByName[p.name] = min;
  });

  return {
    starters,
    bench: benchPlayers,
    rotation,
    minutesObj,
    minByName,
    score: scoreMinutes(valid, minutesObj),
  };
}

function optimizeSeededRotation(valid, seeded) {
  const starters = seeded.starters;
  const benchPlayers = seeded.bench;
  const rotation = seeded.rotation;
  const starterNames = new Set(starters.map((p) => p.name));
  const minByName = { ...seeded.minByName };
  const minutesObj = { ...seeded.minutesObj };

  let used = Object.values(minutesObj).reduce((sum, value) => sum + Number(value || 0), 0);
  let remain = Math.max(0, 240 - used);

  const addBestMinute = (relaxed = false) => {
    let best = null;
    let bestScore = -Infinity;

    for (const p of rotation) {
      const cap = getMinuteCap(p, starterNames, relaxed);
      if ((minutesObj[p.name] || 0) >= cap) continue;

      minutesObj[p.name] += 1;
      const score = scoreMinutes(valid, minutesObj);
      minutesObj[p.name] -= 1;

      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }

    if (!best) return false;

    minutesObj[best.name] += 1;
    return true;
  };

  while (remain > 0) {
    if (!addBestMinute(false)) break;
    remain--;
  }

  // Safety valve for unusual rosters where normal caps cannot reach 240.
  while (remain > 0) {
    if (!addBestMinute(true)) break;
    remain--;
  }

  let currentScore = scoreMinutes(valid, minutesObj);
  let improved = true;
  let passes = 0;

  while (improved && passes < 60) {
    improved = false;
    passes++;

    let bestMove = null;
    let bestScore = currentScore;

    for (const from of rotation) {
      if ((minutesObj[from.name] || 0) <= (minByName[from.name] || 0)) continue;

      for (const to of rotation) {
        if (from.name === to.name) continue;
        if ((minutesObj[to.name] || 0) >= getMinuteCap(to, starterNames, false)) continue;

        minutesObj[from.name] -= 1;
        minutesObj[to.name] += 1;

        const testScore = scoreMinutes(valid, minutesObj);

        minutesObj[from.name] += 1;
        minutesObj[to.name] -= 1;

        if (testScore > bestScore + 1e-9) {
          bestScore = testScore;
          bestMove = { from, to };
        }
      }
    }

    if (bestMove) {
      minutesObj[bestMove.from.name] -= 1;
      minutesObj[bestMove.to.name] += 1;
      currentScore = bestScore;
      improved = true;
    }
  }

  return {
    starters,
    bench: benchPlayers,
    rotation,
    minutesObj,
    score: currentScore,
  };
}


function displayedRatings(valid, minutesObj) {
  const ratings = computeTeamRatings({ players: valid }, minutesObj);
  return {
    overall: Number(ratings?.overall || 0),
    off: Number(ratings?.off || 0),
    def: Number(ratings?.def || 0),
    exactOverall: Number(ratings?.exactOverall ?? ratings?.overall ?? 0),
    exactOff: Number(ratings?.exactOff ?? ratings?.off ?? 0),
    exactDef: Number(ratings?.exactDef ?? ratings?.def ?? 0),
  };
}

function ratingOverall(ratings) {
  return Number(ratings?.exactOverall ?? ratings?.overall ?? 0);
}

function ratingSideSum(ratings) {
  const off = Number(ratings?.exactOff ?? ratings?.off ?? 0);
  const def = Number(ratings?.exactDef ?? ratings?.def ?? 0);
  return off + def;
}

function acceptsRealismSwap(baseRatings, testRatings) {
  if (ratingOverall(testRatings) > ratingOverall(baseRatings)) return true;
  if (ratingOverall(testRatings) < ratingOverall(baseRatings)) return false;

  // When exact OVR is unchanged, allow the higher-OVR bench player to win as
  // long as the OFF/DEF profile is not meaningfully worse.
  return ratingSideSum(testRatings) >= ratingSideSum(baseRatings) - 1;
}

function playerOverall(p) {
  return Number(p?.overall ?? 0);
}

function playerOffRating(p) {
  return Number(p?.offRating ?? p?.overall ?? 0);
}

function playerDefRating(p) {
  return Number(p?.defRating ?? p?.overall ?? 0);
}

function isSamePrimaryStrictUpgrade(incoming, outgoing) {
  if (!incoming?.pos || incoming.pos !== outgoing?.pos) return false;

  return (
    playerOverall(incoming) > playerOverall(outgoing) &&
    playerOffRating(incoming) >= playerOffRating(outgoing) &&
    playerDefRating(incoming) >= playerDefRating(outgoing)
  );
}

function acceptsSamePrimaryUpgrade(currentRatings, testRatings) {
  return ratingOverall(testRatings) >= ratingOverall(currentRatings);
}

function playablePositions(p) {
  return new Set([p?.pos, p?.secondaryPos].filter(Boolean));
}

function sharesPlayablePosition(a, b) {
  const aPos = playablePositions(a);
  for (const pos of playablePositions(b)) {
    if (aPos.has(pos)) return true;
  }
  return false;
}

function applyBenchRealismPass(valid, optimized) {
  if (!optimized?.rotation?.length) return optimized;

  const starters = optimized.starters || [];
  const starterNames = new Set(starters.map((p) => p.name));
  let bench = (optimized.bench || []).filter((p) => p?.name && !starterNames.has(p.name));
  let rotation = [...starters, ...bench];
  let minutesObj = { ...optimized.minutesObj };
  let currentRatings = displayedRatings(valid, minutesObj);

  const getBenchWithMinutes = () =>
    bench.filter((p) => Number(minutesObj[p.name] || 0) > 0);

  const getZeroBenchCandidates = () => {
    const benchNames = new Set(bench.map((p) => p.name));
    return valid
      .filter(
        (p) =>
          p?.name &&
          !starterNames.has(p.name) &&
          !benchNames.has(p.name) &&
          Number(minutesObj[p.name] || 0) === 0
      )
      .sort((a, b) => {
        const ovrDiff = playerOverall(b) - playerOverall(a);
        if (ovrDiff !== 0) return ovrDiff;
        return comparePlayers(a, b);
      });
  };

  // Pass 1: if a better same-role player is currently at 0 minutes, try giving
  // them a lower-rated bench player's role. If displayed OVR stays the same or
  // improves, keep the higher-OVR player.
  let changed = true;
  let passes = 0;
  while (changed && passes < 10) {
    changed = false;
    passes++;

    const zeroCandidates = getZeroBenchCandidates();
    const currentBench = getBenchWithMinutes()
      .slice()
      .sort((a, b) => playerOverall(a) - playerOverall(b));

    for (const incoming of zeroCandidates) {
      let accepted = false;

      for (const outgoing of currentBench) {
        if (playerOverall(incoming) <= playerOverall(outgoing)) continue;
        if (!sharesPlayablePosition(incoming, outgoing)) continue;

        const outgoingMinutes = Number(minutesObj[outgoing.name] || 0);
        if (outgoingMinutes <= 0) continue;

        const testMinutes = { ...minutesObj };
        testMinutes[incoming.name] = outgoingMinutes;
        testMinutes[outgoing.name] = 0;

        const testRatings = displayedRatings(valid, testMinutes);
        const samePrimaryUpgrade = isSamePrimaryStrictUpgrade(incoming, outgoing);
        const acceptedByRatings = samePrimaryUpgrade
          ? acceptsSamePrimaryUpgrade(currentRatings, testRatings)
          : acceptsRealismSwap(currentRatings, testRatings);
        if (!acceptedByRatings) continue;

        minutesObj = testMinutes;
        currentRatings = testRatings;
        bench = bench.map((p) => (p.name === outgoing.name ? incoming : p));
        changed = true;
        accepted = true;
        break;
      }

      if (accepted) break;
    }
  }

  // Pass 2: if a higher-rated bench player has fewer minutes than a lower-rated
  // bench player, try flipping their minutes. If displayed OVR does not drop,
  // prefer the higher-rated player receiving the larger role.
  changed = true;
  passes = 0;
  while (changed && passes < 30) {
    changed = false;
    passes++;

    const currentBench = getBenchWithMinutes();
    let bestFlip = null;
    let bestFlipRatings = null;
    let bestOvrGain = 0;

    for (const higher of currentBench) {
      for (const lower of currentBench) {
        if (higher.name === lower.name) continue;
        if (playerOverall(higher) <= playerOverall(lower)) continue;

        const higherMinutes = Number(minutesObj[higher.name] || 0);
        const lowerMinutes = Number(minutesObj[lower.name] || 0);
        if (higherMinutes >= lowerMinutes) continue;

        const testMinutes = { ...minutesObj };
        testMinutes[higher.name] = lowerMinutes;
        testMinutes[lower.name] = higherMinutes;

        const testRatings = displayedRatings(valid, testMinutes);
        const samePrimaryUpgrade = isSamePrimaryStrictUpgrade(higher, lower);
        const acceptedByRatings = samePrimaryUpgrade
          ? acceptsSamePrimaryUpgrade(currentRatings, testRatings)
          : acceptsRealismSwap(currentRatings, testRatings);
        if (!acceptedByRatings) continue;

        const ovrGain = playerOverall(higher) - playerOverall(lower);
        if (!bestFlip || ovrGain > bestOvrGain) {
          bestFlip = { higher, lower, testMinutes };
          bestFlipRatings = testRatings;
          bestOvrGain = ovrGain;
        }
      }
    }

    if (bestFlip) {
      minutesObj = bestFlip.testMinutes;
      currentRatings = bestFlipRatings;
      changed = true;
    }
  }

  rotation = [...starters, ...bench];

  return {
    ...optimized,
    bench,
    rotation,
    minutesObj,
    score: scoreMinutes(valid, minutesObj),
  };
}


function seedFullTeamRotation(valid, starters, benchPlayers) {
  const starterNames = new Set(starters.map((p) => p.name));
  const benchNames = new Set(benchPlayers.map((p) => p.name));
  const others = valid
    .filter((p) => !starterNames.has(p.name) && !benchNames.has(p.name))
    .sort(comparePlayers);
  const rotation = uniquePlayers([...starters, ...benchPlayers, ...others]);
  const minutesObj = makeZeroMinutes(valid);
  const minByName = {};

  for (const p of starters) {
    minutesObj[p.name] = STARTER_MINUTES;
    minByName[p.name] = STARTER_MINUTES;
  }

  benchPlayers.forEach((p, idx) => {
    const min = BENCH_MINUTES[idx] ?? 10;
    minutesObj[p.name] = min;
    minByName[p.name] = min;
  });

  for (const p of others) {
    minutesObj[p.name] = FULL_TEAM_MINUTES;
    minByName[p.name] = FULL_TEAM_MINUTES;
  }

  const used = Object.values(minutesObj).reduce((sum, value) => sum + Number(value || 0), 0);

  // Normal rosters fit the starter/bench floors plus 5 minutes for everyone
  // else. This fallback only protects odd offseason/test rosters.
  if (used > 240) {
    for (const p of valid) {
      minutesObj[p.name] = FULL_TEAM_MINUTES;
      minByName[p.name] = FULL_TEAM_MINUTES;
    }
  }

  return {
    starters,
    bench: benchPlayers,
    rotation,
    minutesObj,
    minByName,
    score: scoreMinutes(valid, minutesObj),
  };
}

function buildOptimizedFullTeamRotation(teamPlayers) {
  const valid = (teamPlayers || []).filter(
    (p) => p && p.name && Number.isFinite(Number(p.overall))
  );

  if (valid.length === 0) return null;

  const starters = chooseStarters(valid);
  const starterNames = new Set(starters.map((p) => p.name));
  const benchNeeded = Math.max(0, Math.min(ROTATION_SIZE, valid.length) - starters.length);
  const benchCandidates = buildBenchPool(valid, starterNames);

  let best = null;

  if (benchNeeded > 0 && benchCandidates.length >= benchNeeded) {
    const seededCandidates = [];

    for (const benchCombo of combos(benchCandidates, benchNeeded)) {
      const benchOrdered = [...benchCombo].sort(comparePlayers);
      seededCandidates.push(seedFullTeamRotation(valid, starters, benchOrdered));
    }

    seededCandidates.sort((a, b) => b.score - a.score);

    for (const seeded of seededCandidates.slice(0, BENCH_FINALIST_LIMIT)) {
      const candidate = optimizeSeededRotation(valid, seeded);

      if (!best || candidate.score > best.score) {
        best = candidate;
      }
    }
  }

  if (!best) {
    const benchFallback = benchCandidates
      .slice()
      .sort(comparePlayers)
      .slice(0, benchNeeded);

    best = optimizeSeededRotation(
      valid,
      seedFullTeamRotation(valid, starters, benchFallback)
    );
  }

  return { valid, ...best };
}

export function buildFullTeamRating(teamPlayers) {
  const built = buildOptimizedFullTeamRotation(teamPlayers);

  if (!built) {
    return {
      ftr: 0,
      ftrOff: 0,
      ftrDef: 0,
      exactFtr: 0,
      exactFtrOff: 0,
      exactFtrDef: 0,
      minutes: {},
    };
  }

  const ratings = computeTeamRatings({ players: built.valid }, built.minutesObj);

  return {
    // Whole-number values are display-only.
    ftr: Number(ratings.overall || 0),
    ftrOff: Number(ratings.off || 0),
    ftrDef: Number(ratings.def || 0),

    // Exact 4-decimal values are available internally/debugging/future use.
    exactFtr: Number(ratings.exactOverall ?? ratings.overall ?? 0),
    exactFtrOff: Number(ratings.exactOff ?? ratings.off ?? 0),
    exactFtrDef: Number(ratings.exactDef ?? ratings.def ?? 0),
    minutes: built.minutesObj,
  };
}

// FULL smart rotation builder - returns BOTH sorted players and minutes obj
export function buildSmartRotation(teamPlayers) {
  const valid = (teamPlayers || []).filter(
    (p) => p && p.name && Number.isFinite(Number(p.overall))
  );

  if (valid.length === 0) return { sorted: [], obj: {} };

  const starters = chooseStarters(valid);
  const starterNames = new Set(starters.map((p) => p.name));
  const benchNeeded = Math.max(0, Math.min(ROTATION_SIZE, valid.length) - starters.length);
  const benchCandidates = buildBenchPool(valid, starterNames);

  let best = null;

  if (benchNeeded > 0 && benchCandidates.length >= benchNeeded) {
    const seededCandidates = [];

    for (const benchCombo of combos(benchCandidates, benchNeeded)) {
      // Stronger bench players get the larger mandatory bench roles first:
      // 17, 14, 12, 11, 10.
      const benchOrdered = [...benchCombo].sort(comparePlayers);
      seededCandidates.push(seedRotation(valid, starters, benchOrdered));
    }

    seededCandidates.sort((a, b) => b.score - a.score);

    for (const seeded of seededCandidates.slice(0, BENCH_FINALIST_LIMIT)) {
      const candidate = optimizeSeededRotation(valid, seeded);

      if (!best || candidate.score > best.score) {
        best = candidate;
      }
    }
  }

  if (!best) {
    const benchFallback = benchCandidates
      .slice()
      .sort(comparePlayers)
      .slice(0, benchNeeded);

    best = optimizeSeededRotation(
      valid,
      seedRotation(valid, starters, benchFallback)
    );
  }

  best = applyBenchRealismPass(valid, best);

  const starterIds = new Set(best.starters.map((p) => p.name));
  const rotationIds = new Set(best.rotation.map((p) => p.name));

  const bench = best.bench
    .filter((p) => !starterIds.has(p.name))
    .sort((a, b) => {
      const minDiff = (best.minutesObj[b.name] || 0) - (best.minutesObj[a.name] || 0);
      if (minDiff !== 0) return minDiff;
      return comparePlayers(a, b);
    });

  const others = valid
    .filter((p) => !rotationIds.has(p.name))
    .sort(comparePlayers);

  const sorted = [...best.starters, ...bench, ...others];

  const obj = makeZeroMinutes(valid);
  for (const p of best.rotation) {
    obj[p.name] = Number(best.minutesObj[p.name] || 0);
  }

  return { sorted, obj };
}


function round4(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function hasFiniteRating(value) {
  return Number.isFinite(Number(value));
}

function getPlayerPotentialValue(player) {
  if (hasFiniteRating(player?.potential)) return Number(player.potential);
  if (hasFiniteRating(player?.overall)) return Number(player.overall);
  return 75;
}

function getPlayerOverallValue(player) {
  if (hasFiniteRating(player?.overall)) return Number(player.overall);
  return getPlayerPotentialValue(player);
}

function potentialAgeMultiplier(age) {
  const numericAge = Number(age || 0);

  if (numericAge <= POT_AGE_POINTS[0][0]) return POT_AGE_POINTS[0][1];

  for (let i = 1; i < POT_AGE_POINTS.length; i += 1) {
    const [prevAge, prevValue] = POT_AGE_POINTS[i - 1];
    const [nextAge, nextValue] = POT_AGE_POINTS[i];

    if (numericAge <= nextAge) {
      const t = (numericAge - prevAge) / (nextAge - prevAge);
      return prevValue + (nextValue - prevValue) * t;
    }
  }

  return 0.04;
}

function playerPotentialWindowScore(player, yearsAhead) {
  const potential = getPlayerPotentialValue(player);
  const overall = getPlayerOverallValue(player);
  const futureAge = Number(player?.age ?? 25) + yearsAhead;
  const ageMultiplier = potentialAgeMultiplier(futureAge);

  // A raw prospect still gets rewarded heavily, but a huge POT/OVR gap is
  // discounted slightly because that ceiling is less certain than an already
  // realized young star.
  const upsideGap = Math.max(0, potential - overall);
  const uncertaintyPenalty = Math.min(5, upsideGap * 0.35) * ageMultiplier;

  // Elite ceilings should separate from normal good young players.
  const eliteBonus = Math.max(0, potential - 92) * 0.12 * ageMultiplier;

  return 58 + (potential - 58) * ageMultiplier + eliteBonus - uncertaintyPenalty;
}

function averageTop(scores, count) {
  const usableCount = Math.min(count, scores.length);
  if (usableCount <= 0) return 0;

  return scores.slice(0, usableCount).reduce((sum, value) => sum + value, 0) / usableCount;
}

function weightedFullRosterAverage(scores) {
  let numerator = 0;
  let denominator = 0;

  scores.forEach((score, index) => {
    const weight = Math.pow(0.86, index);
    numerator += score * weight;
    denominator += weight;
  });

  return denominator > 0 ? numerator / denominator : 0;
}

function potentialWindowTeamScore(players, yearsAhead) {
  const scores = (players || [])
    .map((player) => playerPotentialWindowScore(player, yearsAhead))
    .filter((score) => Number.isFinite(score))
    .sort((a, b) => b - a);

  if (scores.length === 0) return 0;

  return (
    0.48 * averageTop(scores, 2) +
    0.37 * averageTop(scores, 5) +
    0.15 * weightedFullRosterAverage(scores)
  );
}

function getAutoBuiltExactOverallForPotential(teamPlayers) {
  try {
    const built = buildSmartRotation(teamPlayers);
    const ratings = computeTeamRatings({ players: teamPlayers || [] }, built.obj || {});
    return Number(ratings.exactOverall ?? ratings.overall ?? 0);
  } catch (error) {
    console.warn("Team POT proof bonus fallback:", error);
    return 0;
  }
}

export function calculateTeamPotentialRating(teamPlayers) {
  const valid = (teamPlayers || []).filter(
    (player) => player && player.name && (hasFiniteRating(player.potential) || hasFiniteRating(player.overall))
  );

  if (valid.length === 0) {
    return {
      pot: 0,
      exactPot: 0,
      rawPot: 0,
      adjustedRawPot: 0,
      windows: { threeYear: 0, fiveYear: 0, sevenYear: 0 },
    };
  }

  const windowScores = POT_FUTURE_WINDOWS.map((window) => ({
    ...window,
    score: potentialWindowTeamScore(valid, window.years),
  }));

  const rawPot = windowScores.reduce(
    (sum, window) => sum + window.score * window.weight,
    0
  );

  // Only teams that are already elite and also have a strong future raw score
  // get a small proof bonus. This helps proven young cores without turning POT
  // into another current-OVR rating.
  const exactCurrentOverall = getAutoBuiltExactOverallForPotential(valid);
  const futureStrength = Math.max(0, rawPot - 84) / 10;
  const proofBonus =
    Math.max(0, exactCurrentOverall - POT_PROOF_BASE_OVERALL) *
      futureStrength *
      POT_PROOF_MULTIPLIER +
    Math.max(0, exactCurrentOverall - POT_ELITE_PROOF_BASE_OVERALL) *
      futureStrength *
      POT_ELITE_PROOF_MULTIPLIER;
  const adjustedRawPot = rawPot + proofBonus;

  // Scaled to be comparable to normal team OVR. The current league naturally
  // lands around 96.4 to 70 with this curve, but those are not hard caps.
  // The only hard cap is 99, so a generational roster cannot display 100+.
  const exactPot = Math.min(
    99,
    POT_SCALE_FLOOR_VALUE + (adjustedRawPot - POT_SCALE_BASE) * POT_SCALE_MULTIPLIER
  );

  return {
    pot: Math.round(exactPot),
    exactPot: round4(exactPot),
    rawPot: round4(rawPot),
    adjustedRawPot: round4(adjustedRawPot),
    windows: {
      threeYear: round4(windowScores.find((window) => window.years === 3)?.score || 0),
      fiveYear: round4(windowScores.find((window) => window.years === 5)?.score || 0),
      sevenYear: round4(windowScores.find((window) => window.years === 7)?.score || 0),
    },
  };
}

function buildGameplanPayload(team) {
  const teamPlayers = team?.players || [];
  const { sorted, obj } = buildSmartRotation(teamPlayers);

  return {
    version: GAMEPLAN_VERSION,
    teamName: team?.name || "",
    rosterSignature: getRosterSignature(teamPlayers),
    order: sorted.map((p) => p.name),
    minutes: obj,
    manualLocked: false,
    userEdited: false,
    source: "auto_rotation",
    updatedAt: Date.now(),
  };
}

function saveGameplan(team) {
  if (!team?.name) return false;

  const payload = buildGameplanPayload(team);
  localStorage.setItem(`gameplan_${team.name}`, JSON.stringify(payload));
  return true;
}

export function ensureSingleTeamGameplan(team) {
  if (!team?.name) {
    return { created: false, rebuilt: false, skipped: true };
  }

  const key = `gameplan_${team.name}`;
  const raw = localStorage.getItem(key);
  const saved = safeParseGameplan(raw);

  if (!shouldRebuildGameplan(team, saved)) {
    return { created: false, rebuilt: false, skipped: true };
  }

  const existedBefore = !!raw;
  saveGameplan(team);

  return {
    created: !existedBefore,
    rebuilt: existedBefore,
    skipped: false,
  };
}

// creates missing plans and rebuilds stale ones
export function ensureGameplansForLeague(leagueData) {
  const teams = getAllTeamsFromLeague(leagueData);
  if (!teams.length) return { created: 0, rebuilt: 0, skipped: 0 };

  let created = 0;
  let rebuilt = 0;
  let skipped = 0;

  for (const t of teams) {
    const res = ensureSingleTeamGameplan(t);

    if (res.created) created++;
    else if (res.rebuilt) rebuilt++;
    else skipped++;
  }

  return { created, rebuilt, skipped };
}

// force rebuilds ALL teams, but preserve user-edited rotations by default
export function rebuildGameplansForLeague(leagueData, options = {}) {
  const teams = getAllTeamsFromLeague(leagueData);
  if (!teams.length) return { rebuilt: 0, skipped: 0 };

  const skipUserTeamName = options.skipUserTeamName || null;
  const preserveManual = options.preserveManual !== false;
  let rebuilt = 0;
  let skipped = 0;

  for (const t of teams) {
    if (!t?.name) continue;
    if (skipUserTeamName && t.name === skipUserTeamName) {
      skipped++;
      continue;
    }

    if (preserveManual) {
      const saved = safeParseGameplan(localStorage.getItem(`gameplan_${t.name}`));
      if (hasValidManualGameplanForRoster(t, saved)) {
        skipped++;
        continue;
      }
    }

    if (saveGameplan(t)) rebuilt++;
  }

  return { rebuilt, skipped };
}

export function rebuildSingleTeamGameplan(team, options = {}) {
  if (!team?.name) return false;

  if (options.preserveManual !== false) {
    const saved = safeParseGameplan(localStorage.getItem(`gameplan_${team.name}`));
    if (hasValidManualGameplanForRoster(team, saved)) return false;
  }

  return saveGameplan(team);
}

export function getRosterSignatureForGameplan(teamPlayers = []) {
  return getRosterSignature(teamPlayers);
}