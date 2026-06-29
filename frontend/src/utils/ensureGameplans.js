import { computeTeamRatings } from "../api/teamRatings";

export const GAMEPLAN_VERSION = 18;

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
  // Manual/user-edited rotations are the user's coaching choice. Preserve them
  // across auto-rotation version bumps as long as the same roster is still
  // present and the saved minutes/order are structurally valid.
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
const MINUTE_OPTIMIZER_STEP = 4;
const BENCH_SEARCH_LIMIT = 20;
const BENCH_FINALIST_LIMIT = 4;
const BENCH_LINEUP_SECONDARY_CREDIT = 0.95;
const BENCH_LINEUP_ASSIGNMENT_WEIGHT = 250_000;
const BENCH_LINEUP_HOLE_PENALTY = 50;
const BENCH_UNIT_CANDIDATES_PER_POSITION = 10;
const BENCH_COMBO_POOL_LIMIT = 16;
const BENCH_ACTUAL_SEARCH_POOL_LIMIT = 9;
const SAME_ROLE_UPGRADE_OVR_TOLERANCE = 0.15;
const SAME_ROLE_UPGRADE_SIDE_TOLERANCE = 2.0;
const ROTATION_CACHE_MAX = 300;
const SMART_ROTATION_BREAKDOWN_KEY = "bm_smart_rotation_breakdown_v1";

const smartRotationCache = new Map();
const fullTeamRatingCache = new Map();
const potentialRatingCache = new Map();

let activeSmartRotationBreakdownRow = null;
let smartRotationBreakdownCallCounter = 0;

function smartNow() {
  try {
    if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
  } catch {}
  return Date.now();
}

function safeLocalStorageReadForSmartDiag(key) {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function isSmartRotationBreakdownEnabled() {
  try {
    if (typeof window !== "undefined" && window.__TF_SMART_ROTATION_BREAKDOWN_ENABLED === true) return true;
  } catch {}
  return safeLocalStorageReadForSmartDiag(SMART_ROTATION_BREAKDOWN_KEY) === "1";
}

function getSmartRotationBreakdownStore() {
  if (typeof window === "undefined") return null;
  if (!window.__TF_SMART_ROTATION_BREAKDOWN || !Array.isArray(window.__TF_SMART_ROTATION_BREAKDOWN.rows)) {
    window.__TF_SMART_ROTATION_BREAKDOWN = {
      createdAt: new Date().toISOString(),
      rows: [],
      totals: {
        calls: 0,
        cacheHits: 0,
        cacheMisses: 0,
      },
    };
  }
  return window.__TF_SMART_ROTATION_BREAKDOWN;
}

function addSmartMetric(row, key, value) {
  if (!row || !key) return;
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return;
  row.metrics[key] = round4(Number(row.metrics[key] || 0) + n);
}

function incSmartMetric(row, key, amount = 1) {
  if (!row || !key) return;
  row.metrics[key] = Number(row.metrics[key] || 0) + amount;
}

function measureSmart(row, key, fn) {
  const start = smartNow();
  try {
    return fn();
  } finally {
    addSmartMetric(row, key, smartNow() - start);
  }
}

function createSmartRotationBreakdownRow(teamPlayers = []) {
  if (!isSmartRotationBreakdownEnabled()) return null;
  smartRotationBreakdownCallCounter += 1;
  return {
    callIndex: smartRotationBreakdownCallCounter,
    playerCount: Array.isArray(teamPlayers) ? teamPlayers.length : 0,
    topPlayers: [...(teamPlayers || [])]
      .filter((p) => p?.name)
      .sort(comparePlayers)
      .slice(0, 5)
      .map((p) => `${p.name}:${Number(p.overall ?? 0)}`),
    metrics: {},
  };
}

function finalizeSmartRotationBreakdownRow(row) {
  if (!row) return;
  const store = getSmartRotationBreakdownStore();
  if (!store) return;
  store.rows.push(row);
  while (store.rows.length > 500) store.rows.shift();
  store.totals.calls = Number(store.totals.calls || 0) + 1;
  if (row.cacheHit) store.totals.cacheHits = Number(store.totals.cacheHits || 0) + 1;
  else store.totals.cacheMisses = Number(store.totals.cacheMisses || 0) + 1;
  for (const [key, value] of Object.entries(row.metrics || {})) {
    store.totals[key] = round4(Number(store.totals[key] || 0) + Number(value || 0));
  }
}

const POT_FUTURE_WINDOWS = [
  { years: 3, weight: 0.30 },
  { years: 5, weight: 0.35 },
  { years: 7, weight: 0.35 },
];

const POT_SCALE_BASE = 77.8156;
const POT_SCALE_FLOOR_VALUE = 70;
const POT_SCALE_MULTIPLIER = 2.0199;
const POT_TOP_CURVE_START = 90;
const POT_TOP_CURVE_MULTIPLIER = 0.74;
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

function touchLimitedCache(cache, key, value, maxSize = ROTATION_CACHE_MAX) {
  if (!key) return value;
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);

  while (cache.size > maxSize) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }

  return value;
}

function getLimitedCache(cache, key) {
  if (!key || !cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function getRatingRosterSignature(teamPlayers = []) {
  return [...(teamPlayers || [])]
    .map((p) =>
      [
        p?.id ?? p?.playerId ?? p?.player_id ?? p?.uuid ?? "",
        p?.name || p?.player || "",
        p?.pos || "",
        p?.secondaryPos || "",
        Number(p?.age ?? 0) || 0,
        Number(p?.overall ?? p?.ovr ?? 0) || 0,
        Number(p?.potential ?? p?.pot ?? 0) || 0,
        Number(p?.offRating ?? p?.off ?? p?.overall ?? p?.ovr ?? 0) || 0,
        Number(p?.defRating ?? p?.def ?? p?.overall ?? p?.ovr ?? 0) || 0,
        Number(p?.stamina ?? p?.sta ?? 75) || 75,
      ].join("|")
    )
    .sort()
    .join("||");
}

function cacheSmartRotationResult(valid, result) {
  const order = (result?.sorted || []).map((player) => player?.name).filter(Boolean);
  const orderedNames = new Set(order);
  const missing = (valid || [])
    .filter((player) => player?.name && !orderedNames.has(player.name))
    .sort(comparePlayers)
    .map((player) => player.name);

  return {
    order: [...order, ...missing],
    obj: { ...(result?.obj || {}) },
  };
}

function inflateSmartRotationResult(valid, cached) {
  const byName = new Map((valid || []).map((player) => [player.name, player]));
  const used = new Set();
  const sorted = [];

  for (const name of cached?.order || []) {
    const player = byName.get(name);
    if (!player || used.has(name)) continue;
    sorted.push(player);
    used.add(name);
  }

  for (const player of valid || []) {
    if (!player?.name || used.has(player.name)) continue;
    sorted.push(player);
    used.add(player.name);
  }

  const obj = makeZeroMinutes(valid || []);
  for (const player of valid || []) {
    obj[player.name] = Number(cached?.obj?.[player.name] || 0);
  }

  return { sorted, obj };
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


function assignmentCreditForPosition(player, pos) {
  if (!player || !pos) return 0;
  if (player.pos === pos) return 1.0;
  if (player.secondaryPos === pos) return BENCH_LINEUP_SECONDARY_CREDIT;
  return 0;
}

function benchPlayerQuality(player) {
  const overall = Number(player?.overall ?? 75);
  const off = Number(player?.offRating ?? overall);
  const def = Number(player?.defRating ?? overall);
  const stamina = Number(player?.stamina ?? 75);

  // Bench selection should mostly follow visible OVR. OFF/DEF/stamina still
  // matter as tie-breakers, but they should not let a clearly worse same-role
  // player steal minutes from a better, flexible player.
  return overall * 10 + off * 0.16 + def * 0.16 + (stamina - 70) * 0.04;
}

function getBenchCoverageDetails(benchPlayers = []) {
  const bench = uniquePlayers(benchPlayers).filter(
    (p) => p && p.name && Number.isFinite(Number(p.overall))
  );

  if (!bench.length) {
    return {
      score: -POSITIONS.length * BENCH_LINEUP_HOLE_PENALTY,
      holes: POSITIONS.length,
      primaryHits: 0,
      secondaryUses: 0,
    };
  }

  let best = {
    score: -Infinity,
    holes: POSITIONS.length,
    primaryHits: 0,
    secondaryUses: 0,
  };
  const used = new Set();

  const isBetter = (candidate, incumbent) => {
    if (candidate.score !== incumbent.score) return candidate.score > incumbent.score;
    if (candidate.holes !== incumbent.holes) return candidate.holes < incumbent.holes;
    if (candidate.secondaryUses !== incumbent.secondaryUses) return candidate.secondaryUses < incumbent.secondaryUses;
    return candidate.primaryHits > incumbent.primaryHits;
  };

  const search = (posIdx, score, holes, primaryHits, secondaryUses) => {
    if (posIdx >= POSITIONS.length) {
      const candidate = { score, holes, primaryHits, secondaryUses };
      if (isBetter(candidate, best)) best = candidate;
      return;
    }

    const pos = POSITIONS[posIdx];
    for (const player of bench) {
      if (used.has(player.name)) continue;

      const credit = assignmentCreditForPosition(player, pos);
      if (credit <= 0) continue;

      used.add(player.name);
      const isPrimary = player.pos === pos;
      search(
        posIdx + 1,
        score + benchPlayerQuality(player) * credit + (isPrimary ? 0.15 : 0),
        holes,
        primaryHits + (isPrimary ? 1 : 0),
        secondaryUses + (isPrimary ? 0 : 1)
      );
      used.delete(player.name);
    }

    // Missing a bench PG/SG/SF/PF/C slot is allowed for thin rosters, but it is
    // a real cost. A secondary-position player filling the slot is much better
    // than forcing a low-OVR primary-position specialist.
    search(
      posIdx + 1,
      score - BENCH_LINEUP_HOLE_PENALTY,
      holes + 1,
      primaryHits,
      secondaryUses
    );
  };

  search(0, 0, 0, 0, 0);
  return best;
}

function benchLineupAssignmentScore(benchPlayers = []) {
  const details = getBenchCoverageDetails(benchPlayers);
  return (
    details.score -
    details.holes * 8 -
    details.secondaryUses * 0.35 +
    details.primaryHits * 0.15
  );
}

function rotationSelectionScore(valid, candidate) {
  if (!candidate) return -Infinity;

  const baseScore = scoreMinutes(valid, candidate.minutesObj);
  const benchScore = benchLineupAssignmentScore(candidate.bench || []);

  return baseScore + benchScore * BENCH_LINEUP_ASSIGNMENT_WEIGHT;
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
  let weighted = 0;
  let activeCount = 0;
  let benchQuality = 0;

  for (const p of valid) {
    const m = Math.max(0, Number(minutesObj?.[p.name] || 0));
    if (m <= 0) continue;

    activeCount += 1;
    const overall = Number(p.overall ?? 75);
    const off = Number(p.offRating ?? overall);
    const def = Number(p.defRating ?? overall);
    const pen = localFatiguePenaltyForTie(m, p.stamina ?? 75);
    weighted += (m / 240) * ((overall * 0.5 + off * 0.25 + def * 0.25) * pen);

    // Tiny tie-breaker only. Position balance is handled by computeTeamRatings()
    // now, using split primary/secondary allocation. Keeping another position
    // model here would risk reintroducing the old Royce/Coffey style bias.
    if (m <= BENCH_MAX_MINUTES) {
      benchQuality += (overall * 0.002) + (playablePositions(p).size * 0.001);
    }
  }

  return weighted + benchQuality + activeCount * 0.0001;
}

function scoreMinutes(valid, minutesObj) {
  const diag = activeSmartRotationBreakdownRow;
  const start = smartNow();
  try {
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
  } finally {
    incSmartMetric(diag, "scoreMinutesCalls");
    addSmartMetric(diag, "scoreMinutesMs", smartNow() - start);
  }
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
    selectionScore: rotationSelectionScore(valid, { bench: benchPlayers, minutesObj }),
  };
}

function optimizeSeededRotation(valid, seeded) {
  const diag = activeSmartRotationBreakdownRow;
  const optimizeStart = smartNow();
  incSmartMetric(diag, "optimizeSeededRotationCalls");
  const starters = seeded.starters;
  const benchPlayers = seeded.bench;
  const rotation = seeded.rotation;
  const starterNames = new Set(starters.map((p) => p.name));
  const minByName = { ...seeded.minByName };
  const minutesObj = { ...seeded.minutesObj };

  let used = Object.values(minutesObj).reduce((sum, value) => sum + Number(value || 0), 0);
  let remain = Math.max(0, 240 - used);

  const addBestMinuteChunk = (relaxed = false) => {
    let best = null;
    let bestAmount = 0;
    let bestScore = -Infinity;

    for (const p of rotation) {
      const cap = getMinuteCap(p, starterNames, relaxed);
      const current = Number(minutesObj[p.name] || 0);
      if (current >= cap) continue;

      const amount = Math.min(remain, MINUTE_OPTIMIZER_STEP, cap - current);
      if (amount <= 0) continue;

      minutesObj[p.name] = current + amount;
      const score = scoreMinutes(valid, minutesObj);
      minutesObj[p.name] = current;

      if (score > bestScore) {
        bestScore = score;
        best = p;
        bestAmount = amount;
      }
    }

    if (!best || bestAmount <= 0) return false;

    minutesObj[best.name] = Number(minutesObj[best.name] || 0) + bestAmount;
    remain -= bestAmount;
    return true;
  };

  while (remain > 0) {
    if (!addBestMinuteChunk(false)) break;
  }

  // Safety valve for unusual rosters where normal caps cannot reach 240.
  while (remain > 0) {
    if (!addBestMinuteChunk(true)) break;
  }

  let currentScore = scoreMinutes(valid, minutesObj);
  let improved = true;
  let passes = 0;

  while (improved && passes < 3) {
    improved = false;
    passes++;

    let bestMove = null;
    let bestScore = currentScore;

    for (const from of rotation) {
      if ((minutesObj[from.name] || 0) <= (minByName[from.name] || 0)) continue;

      for (const to of rotation) {
        if (from.name === to.name) continue;
        if ((minutesObj[to.name] || 0) >= getMinuteCap(to, starterNames, false)) continue;

        const movable = Math.min(
          MINUTE_OPTIMIZER_STEP,
          Number(minutesObj[from.name] || 0) - Number(minByName[from.name] || 0),
          getMinuteCap(to, starterNames, false) - Number(minutesObj[to.name] || 0)
        );
        if (movable <= 0) continue;

        minutesObj[from.name] -= movable;
        minutesObj[to.name] += movable;

        const testScore = scoreMinutes(valid, minutesObj);

        minutesObj[from.name] += movable;
        minutesObj[to.name] -= movable;

        if (testScore > bestScore + 1e-9) {
          bestScore = testScore;
          bestMove = { from, to, amount: movable };
        }
      }
    }

    if (bestMove) {
      minutesObj[bestMove.from.name] -= bestMove.amount;
      minutesObj[bestMove.to.name] += bestMove.amount;
      currentScore = bestScore;
      improved = true;
    }
  }

  const optimizedResult = {
    starters,
    bench: benchPlayers,
    rotation,
    minutesObj,
    score: currentScore,
    selectionScore: rotationSelectionScore(valid, { bench: benchPlayers, minutesObj }),
  };
  addSmartMetric(diag, "optimizeSeededRotationMs", smartNow() - optimizeStart);
  return optimizedResult;
}


function displayedRatings(valid, minutesObj) {
  const diag = activeSmartRotationBreakdownRow;
  const start = smartNow();
  try {
    const ratings = computeTeamRatings({ players: valid }, minutesObj);
    return {
      overall: Number(ratings?.overall || 0),
      off: Number(ratings?.off || 0),
      def: Number(ratings?.def || 0),
      exactOverall: Number(ratings?.exactOverall ?? ratings?.overall ?? 0),
      exactOff: Number(ratings?.exactOff ?? ratings?.off ?? 0),
      exactDef: Number(ratings?.exactDef ?? ratings?.def ?? 0),
    };
  } finally {
    incSmartMetric(diag, "displayedRatingsCalls");
    addSmartMetric(diag, "displayedRatingsMs", smartNow() - start);
  }
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

function coversAllPlayablePositions(incoming, outgoing) {
  const incomingPositions = playablePositions(incoming);
  const outgoingPositions = playablePositions(outgoing);

  if (!incomingPositions.size || !outgoingPositions.size) return false;

  for (const pos of outgoingPositions) {
    if (!incomingPositions.has(pos)) return false;
  }

  return true;
}

function acceptsSameRoleUpgrade(currentRatings, testRatings) {
  return (
    ratingOverall(testRatings) >= ratingOverall(currentRatings) - SAME_ROLE_UPGRADE_OVR_TOLERANCE &&
    ratingSideSum(testRatings) >= ratingSideSum(currentRatings) - SAME_ROLE_UPGRADE_SIDE_TOLERANCE
  );
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
  while (changed && passes < 2) {
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

        const outgoingMinutes = Number(minutesObj[outgoing.name] || 0);
        if (outgoingMinutes <= 0) continue;

        const testMinutes = { ...minutesObj };
        testMinutes[incoming.name] = outgoingMinutes;
        testMinutes[outgoing.name] = 0;

        const testRatings = displayedRatings(valid, testMinutes);
        const samePrimaryUpgrade = isSamePrimaryStrictUpgrade(incoming, outgoing);
        const sameRoleUpgrade = coversAllPlayablePositions(incoming, outgoing);
        const acceptedByRatings = sameRoleUpgrade
          ? acceptsSameRoleUpgrade(currentRatings, testRatings)
          : samePrimaryUpgrade
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
  while (changed && passes < 4) {
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
        const sameRoleUpgrade = coversAllPlayablePositions(higher, lower);
        const acceptedByRatings = sameRoleUpgrade
          ? acceptsSameRoleUpgrade(currentRatings, testRatings)
          : samePrimaryUpgrade
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
    selectionScore: rotationSelectionScore(valid, { bench, minutesObj }),
  };
}


function compareBenchUnitCandidates(a, b) {
  const ovrDiff = playerOverall(b) - playerOverall(a);
  if (ovrDiff !== 0) return ovrDiff;

  const qualityDiff = benchPlayerQuality(b) - benchPlayerQuality(a);
  if (Math.abs(qualityDiff) > 1e-9) return qualityDiff;

  const aFlex = playablePositions(a).size;
  const bFlex = playablePositions(b).size;
  if (aFlex !== bFlex) return bFlex - aFlex;

  return String(a?.name || "").localeCompare(String(b?.name || ""));
}

function benchAssignmentValue(player, pos) {
  const credit = assignmentCreditForPosition(player, pos);
  if (credit <= 0) return -Infinity;

  // Primary-position labels are a tie-breaker, not a trump card. A PF/C or C/PF
  // should be able to cover the bench 5 without forcing a worse pure center into
  // the rotation.
  const primaryBonus = player.pos === pos ? 0.20 : 0;
  return benchPlayerQuality(player) * credit + primaryBonus;
}

function scoreBenchUnitAssignment(mapping) {
  const selectedNames = new Set();
  let assignmentTotal = 0;
  let primaryHits = 0;
  let secondaryUses = 0;

  for (const pos of POSITIONS) {
    const player = mapping[pos];
    if (!player) return -Infinity;

    selectedNames.add(player.name);
    assignmentTotal += benchAssignmentValue(player, pos);
    if (player.pos === pos) primaryHits += 1;
    else secondaryUses += 1;
  }

  const selectedPlayers = Object.values(mapping).filter(
    (player, idx, arr) => player && arr.findIndex((p) => p?.name === player.name) === idx
  );
  const overallSum = selectedPlayers.reduce((sum, player) => sum + playerOverall(player), 0);
  const qualitySum = selectedPlayers.reduce((sum, player) => sum + benchPlayerQuality(player), 0);

  return (
    overallSum * 100_000 +
    qualitySum * 1_000 +
    assignmentTotal * 250 +
    primaryHits * 25 -
    secondaryUses * 6 -
    Math.max(0, POSITIONS.length - selectedNames.size) * 1_000_000
  );
}

function scoreBenchCandidateCombo(combo = []) {
  const uniqueCombo = uniquePlayers(combo);
  const coverage = getBenchCoverageDetails(uniqueCombo);
  const overallSum = uniqueCombo.reduce((sum, player) => sum + playerOverall(player), 0);
  const qualitySum = uniqueCombo.reduce((sum, player) => sum + benchPlayerQuality(player), 0);
  const bestOvr = Math.max(...uniqueCombo.map((player) => playerOverall(player)), 0);
  const worstOvr = uniqueCombo.length
    ? Math.min(...uniqueCombo.map((player) => playerOverall(player)))
    : 0;

  return (
    overallSum * 100_000 +
    qualitySum * 1_000 +
    coverage.score * 500 +
    bestOvr * 60 +
    worstOvr * 30 -
    coverage.holes * 230_000 -
    coverage.secondaryUses * 300 +
    coverage.primaryHits * 75
  );
}

function buildBenchComboPool(pool = []) {
  const byName = new Map();
  const add = (player) => {
    if (player?.name && !byName.has(player.name)) byName.set(player.name, player);
  };

  pool.slice().sort(compareBenchUnitCandidates).slice(0, BENCH_COMBO_POOL_LIMIT).forEach(add);

  for (const pos of POSITIONS) {
    pool
      .filter((player) => isEligibleForPosition(player, pos))
      .sort((a, b) => {
        const scoreDiff = benchAssignmentValue(b, pos) - benchAssignmentValue(a, pos);
        if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;
        return compareBenchUnitCandidates(a, b);
      })
      .slice(0, 3)
      .forEach(add);
  }

  return [...byName.values()].sort(compareBenchUnitCandidates).slice(0, BENCH_COMBO_POOL_LIMIT);
}

function chooseBenchUnit(valid, starters, benchNeeded) {
  if (benchNeeded <= 0) return [];

  const starterNames = new Set((starters || []).map((p) => p.name));
  const pool = buildBenchPool(valid, starterNames)
    .filter((p) => !starterNames.has(p.name))
    .sort(compareBenchUnitCandidates);

  if (benchNeeded < POSITIONS.length || pool.length <= benchNeeded) {
    return pool.slice(0, benchNeeded).sort(compareBenchUnitCandidates);
  }

  const comboPool = buildBenchComboPool(pool);
  if (comboPool.length < benchNeeded) {
    return pool.slice(0, benchNeeded).sort(compareBenchUnitCandidates);
  }

  let bestCombo = null;
  let bestScore = -Infinity;
  const path = [];

  const search = (startIdx) => {
    if (path.length === benchNeeded) {
      const score = scoreBenchCandidateCombo(path);
      if (score > bestScore) {
        bestScore = score;
        bestCombo = path.slice();
      }
      return;
    }

    const remainingNeeded = benchNeeded - path.length;
    for (let idx = startIdx; idx <= comboPool.length - remainingNeeded; idx += 1) {
      path.push(comboPool[idx]);
      search(idx + 1);
      path.pop();
    }
  };

  search(0);

  const bench = bestCombo?.length
    ? bestCombo.slice().sort(compareBenchUnitCandidates)
    : pool.slice(0, benchNeeded).sort(compareBenchUnitCandidates);

  if (bench.length >= benchNeeded) return bench.slice(0, benchNeeded);

  const picked = new Set(bench.map((p) => p.name));
  return [
    ...bench,
    ...pool.filter((player) => !picked.has(player.name)).slice(0, benchNeeded - bench.length),
  ].sort(compareBenchUnitCandidates);
}


function comboKey(players = []) {
  return uniquePlayers(players)
    .map((player) => player?.name || "")
    .filter(Boolean)
    .sort()
    .join("||");
}

function buildBenchActualSearchPool(valid, starters) {
  const starterNames = new Set((starters || []).map((p) => p.name));
  const remaining = (valid || [])
    .filter((p) => p?.name && !starterNames.has(p.name))
    .sort(compareBenchUnitCandidates);

  // Normal NBA rosters are usually 14-15 players, meaning 9-10 non-starters.
  // In that normal case we can evaluate every possible 5-man bench group. That
  // is the key fix: the sorter no longer has to guess that a new C/PF belongs in
  // the rotation just because his label helps coverage.
  if (remaining.length <= BENCH_ACTUAL_SEARCH_POOL_LIMIT) return remaining;

  const byName = new Map();
  const add = (player) => {
    if (player?.name && !byName.has(player.name)) byName.set(player.name, player);
  };

  remaining.slice(0, 8).forEach(add);

  for (const pos of POSITIONS) {
    remaining
      .filter((player) => isEligibleForPosition(player, pos))
      .sort((a, b) => {
        const scoreDiff = benchAssignmentValue(b, pos) - benchAssignmentValue(a, pos);
        if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;
        return compareBenchUnitCandidates(a, b);
      })
      .slice(0, 4)
      .forEach(add);
  }

  return [...byName.values()]
    .sort(compareBenchUnitCandidates)
    .slice(0, BENCH_ACTUAL_SEARCH_POOL_LIMIT);
}

function buildQuickFilledMinutes(valid, seeded) {
  const starterNames = new Set((seeded?.starters || []).map((p) => p.name));
  const minutesObj = { ...(seeded?.minutesObj || {}) };
  const rotation = uniquePlayers(seeded?.rotation || []);
  let used = Object.values(minutesObj).reduce((sum, value) => sum + Number(value || 0), 0);
  let remain = Math.max(0, 240 - used);

  // Cheap one-pass fill used only to rank candidate bench groups before running
  // the expensive minute optimizer on the finalists. This gives stars and strong
  // bench players realistic extra minutes, so the candidate ranking is based on
  // the same team-rating formula instead of a position-label heuristic.
  const priority = rotation.slice().sort((a, b) => {
    const valueDiff = playerValue(b) - playerValue(a);
    if (Math.abs(valueDiff) > 1e-9) return valueDiff;
    return compareBenchUnitCandidates(a, b);
  });

  for (const player of priority) {
    if (remain <= 0) break;
    const cap = getMinuteCap(player, starterNames, false);
    const current = Number(minutesObj[player.name] || 0);
    const add = Math.min(remain, Math.max(0, cap - current));
    if (add <= 0) continue;
    minutesObj[player.name] = current + add;
    remain -= add;
  }

  for (const player of priority) {
    if (remain <= 0) break;
    const current = Number(minutesObj[player.name] || 0);
    const add = Math.min(remain, Math.max(0, HARD_MAX_MINUTES - current));
    if (add <= 0) continue;
    minutesObj[player.name] = current + add;
    remain -= add;
  }

  return minutesObj;
}

function quickBenchCandidateScore(valid, starters, benchPlayers, seedBuilder = seedRotation) {
  const seeded = seedBuilder(valid, starters, benchPlayers);
  const quickMinutes = buildQuickFilledMinutes(valid, seeded);
  return scoreMinutes(valid, quickMinutes);
}

function getBenchUnitFinalistsByActualRating(valid, starters, benchNeeded, seedBuilder = seedRotation) {
  const diag = activeSmartRotationBreakdownRow;
  if (benchNeeded <= 0) return [[]];

  const pool = measureSmart(diag, "benchActualSearchPoolMs", () => buildBenchActualSearchPool(valid, starters));
  if (pool.length <= benchNeeded) return [pool.slice(0, benchNeeded)];

  const scored = [];
  const seen = new Set();

  const addCandidate = (players, source = "search", forced = false) => {
    const combo = uniquePlayers(players);
    if (combo.length !== benchNeeded) return;
    const key = comboKey(combo);
    if (!key || seen.has(key)) return;
    seen.add(key);

    scored.push({
      bench: combo.slice().sort(compareBenchUnitCandidates),
      score: quickBenchCandidateScore(valid, starters, combo, seedBuilder),
      heuristicScore: scoreBenchCandidateCombo(combo),
      source,
      forced,
    });
  };

  const fillWithBest = (locked = []) => {
    const lockedNames = new Set(uniquePlayers(locked).map((p) => p.name));
    return uniquePlayers([
      ...locked,
      ...pool.filter((player) => !lockedNames.has(player.name)),
    ]).slice(0, benchNeeded);
  };

  let heuristicBench = [];
  measureSmart(diag, "benchForcedCandidatesMs", () => {
    heuristicBench = chooseBenchUnit(valid, starters, benchNeeded);
    const topQualityBench = pool.slice(0, benchNeeded);
    addCandidate(heuristicBench, "heuristic", true);
    addCandidate(topQualityBench, "top-quality", true);
  });

  measureSmart(diag, "benchAnchorCandidatesMs", () => {
    for (const pos of POSITIONS) {
      const bestAtPos = pool
        .filter((player) => isEligibleForPosition(player, pos))
        .sort((a, b) => {
          const diff = benchAssignmentValue(b, pos) - benchAssignmentValue(a, pos);
          if (Math.abs(diff) > 1e-9) return diff;
          return compareBenchUnitCandidates(a, b);
        })[0];
      if (bestAtPos) addCandidate(fillWithBest([bestAtPos]), `anchor-${pos}`);
    }
  });

  measureSmart(diag, "benchSwapCandidatesMs", () => {
    const baseNames = new Set((heuristicBench || []).map((p) => p.name));
    const outsiders = pool.filter((player) => !baseNames.has(player.name)).slice(0, 6);
    for (const incoming of outsiders) {
      for (const outgoing of heuristicBench || []) {
        addCandidate(
          [...heuristicBench.filter((player) => player.name !== outgoing.name), incoming],
          "swap"
        );
      }
    }
  });

  measureSmart(diag, "benchCandidateSortMs", () => scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.heuristicScore - a.heuristicScore ||
      comboKey(a.bench).localeCompare(comboKey(b.bench))
  ));

  const finalists = [];
  const finalistKeys = new Set();
  const addFinalist = (row) => {
    if (!row) return;
    const key = comboKey(row.bench);
    if (!key || finalistKeys.has(key)) return;
    finalistKeys.add(key);
    finalists.push(row);
  };

  scored.filter((row) => row.forced).forEach(addFinalist);
  scored.forEach((row) => {
    if (finalists.length < BENCH_FINALIST_LIMIT) addFinalist(row);
  });

  incSmartMetric(diag, "benchCandidatesScored", scored.length);
  incSmartMetric(diag, "benchFinalists", finalists.length);

  return finalists.slice(0, BENCH_FINALIST_LIMIT).map((row) => row.bench);
}


function buildOptimizedRotationFromBench(valid, starters, benchPlayers, seedBuilder = seedRotation) {
  return optimizeSeededRotation(valid, seedBuilder(valid, starters, benchPlayers));
}

function buildBestOptimizedRotation(valid, starters, benchNeeded, seedBuilder = seedRotation) {
  const diag = activeSmartRotationBreakdownRow;
  const finalists = measureSmart(diag, "getBenchUnitFinalistsMs", () => getBenchUnitFinalistsByActualRating(valid, starters, benchNeeded, seedBuilder));
  let best = null;
  let bestScore = -Infinity;

  for (const benchPlayers of finalists) {
    let candidate = measureSmart(diag, "buildOptimizedRotationFromBenchMs", () => buildOptimizedRotationFromBench(valid, starters, benchPlayers, seedBuilder));
    candidate = measureSmart(diag, "applyBenchRealismPassMs", () => applyBenchRealismPass(valid, candidate));
    const candidateScore = measureSmart(diag, "finalCandidateScoreMs", () => scoreMinutes(valid, candidate?.minutesObj || {}));

    if (
      !best ||
      candidateScore > bestScore + 1e-9 ||
      (Math.abs(candidateScore - bestScore) <= 1e-9 &&
        benchLineupAssignmentScore(candidate?.bench || []) > benchLineupAssignmentScore(best?.bench || []))
    ) {
      best = candidate;
      bestScore = candidateScore;
    }
  }

  return best;
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
    selectionScore: rotationSelectionScore(valid, { bench: benchPlayers, minutesObj }),
  };
}

function buildOptimizedFullTeamRotation(teamPlayers) {
  const valid = (teamPlayers || []).filter(
    (p) => p && p.name && Number.isFinite(Number(p.overall))
  );

  if (valid.length === 0) return null;

  const starters = chooseStarters(valid);
  const benchNeeded = Math.max(0, Math.min(ROTATION_SIZE, valid.length) - starters.length);
  let best = buildBestOptimizedRotation(valid, starters, benchNeeded, seedFullTeamRotation);

  // Tiny safety fallback for unusual offseason/test rosters. Normal 14-15 man
  // rosters go through the actual-rating bench search above.
  if (!best || (best.bench || []).length < benchNeeded) {
    const starterNames = new Set(starters.map((p) => p.name));
    const fallbackBench = buildBenchPool(valid, starterNames)
      .slice()
      .sort(compareBenchUnitCandidates)
      .slice(0, benchNeeded)
      .sort(comparePlayers);
    best = buildOptimizedRotationFromBench(valid, starters, fallbackBench, seedFullTeamRotation);
    best = applyBenchRealismPass(valid, best);
  }

  return { valid, ...best };
}

export function buildFullTeamRating(teamPlayers) {
  const valid = (teamPlayers || []).filter(
    (p) => p && p.name && Number.isFinite(Number(p.overall))
  );
  const cacheKey = `${GAMEPLAN_VERSION}:ftr:${getRatingRosterSignature(valid)}`;
  const cached = getLimitedCache(fullTeamRatingCache, cacheKey);
  if (cached) return { ...cached, minutes: { ...(cached.minutes || {}) } };

  const built = buildOptimizedFullTeamRotation(valid);

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
  const result = {
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

  return touchLimitedCache(fullTeamRatingCache, cacheKey, result);
}

// Core smart rotation builder without low-end exclusion retries.
function buildSmartRotationCore(valid) {
  const diag = activeSmartRotationBreakdownRow;
  if (valid.length === 0) return { sorted: [], obj: {} };

  const starters = measureSmart(diag, "chooseStartersMs", () => chooseStarters(valid));
  const starterNames = new Set(starters.map((p) => p.name));
  const benchNeeded = Math.max(0, Math.min(ROTATION_SIZE, valid.length) - starters.length);
  let best = measureSmart(diag, "buildBestOptimizedRotationMs", () => buildBestOptimizedRotation(valid, starters, benchNeeded, seedRotation));

  if (!best || (best.bench || []).length < benchNeeded) {
    measureSmart(diag, "smartCoreFallbackMs", () => {
      const benchFallback = buildBenchPool(valid, starterNames)
        .slice()
        .sort(compareBenchUnitCandidates)
        .slice(0, benchNeeded)
        .sort(comparePlayers);

      best = buildOptimizedRotationFromBench(valid, starters, benchFallback, seedRotation);
      best = applyBenchRealismPass(valid, best);
    });
  }

  const starterIds = new Set(best.starters.map((p) => p.name));
  const rotationIds = new Set(best.rotation.map((p) => p.name));

  const bench = measureSmart(diag, "smartCoreBenchSortMs", () => best.bench
    .filter((p) => !starterIds.has(p.name))
    .sort((a, b) => {
      const minDiff = (best.minutesObj[b.name] || 0) - (best.minutesObj[a.name] || 0);
      if (minDiff !== 0) return minDiff;
      return comparePlayers(a, b);
    }));

  const others = measureSmart(diag, "smartCoreOthersSortMs", () => valid
    .filter((p) => !rotationIds.has(p.name))
    .sort(comparePlayers));

  const sorted = [...best.starters, ...bench, ...others];

  const obj = makeZeroMinutes(valid);
  for (const p of best.rotation) {
    obj[p.name] = Number(best.minutesObj[p.name] || 0);
  }

  return { sorted, obj };
}


function getActiveRotationNames(minutesObj = {}) {
  return new Set(
    Object.entries(minutesObj || {})
      .filter(([, minutes]) => Number(minutes || 0) > 0)
      .map(([name]) => name)
  );
}

function buildSmartRotationUncached(valid) {
  const diag = activeSmartRotationBreakdownRow;
  if (valid.length === 0) return { sorted: [], obj: {} };

  let best = measureSmart(diag, "uncachedInitialCoreMs", () => buildSmartRotationCore(valid));
  let bestScore = measureSmart(diag, "uncachedInitialScoreMs", () => scoreMinutes(valid, best.obj || {}));

  const ranked = measureSmart(diag, "uncachedRankPlayersMs", () => [...valid].sort(comparePlayers));
  const rankByName = new Map(ranked.map((player, idx) => [player.name, idx]));
  const activeNames = getActiveRotationNames(best.obj);

  // If a low-end player sneaks into the 10-man group because his position label
  // looks convenient, test the roster again without that one player in the
  // active-choice pool. This is not trade-specific: it is the auto-sort proving
  // that optional depth only plays when it actually helps the best lineup.
  const zeroPlayers = valid.filter((player) => player?.name && !activeNames.has(player.name));
  const bestZeroPlayer = zeroPlayers.sort(comparePlayers)[0] || null;
  const bestZeroRank = bestZeroPlayer ? rankByName.get(bestZeroPlayer.name) ?? Infinity : Infinity;
  const bestZeroValue = bestZeroPlayer ? playerValue(bestZeroPlayer) : -Infinity;

  const exclusionCandidates = bestZeroPlayer && Number.isFinite(bestZeroRank)
    ? valid
        .filter((player) => {
          if (!player?.name || !activeNames.has(player.name)) return false;
          const rank = rankByName.get(player.name) ?? 0;
          // Only retry when the first pass is playing a clearly lower-ranked
          // player while a better-rated option is sitting at 0 minutes.
          return (
            rank > bestZeroRank &&
            rank >= ROTATION_SIZE &&
            bestZeroValue - playerValue(player) >= 1.25
          );
        })
        .sort((a, b) => (rankByName.get(b.name) ?? 0) - (rankByName.get(a.name) ?? 0))
        .slice(0, 1)
    : [];

  measureSmart(diag, "exclusionRetryTotalMs", () => {
    for (const excluded of exclusionCandidates) {
      const reducedValid = valid.filter((player) => player.name !== excluded.name);
      if (reducedValid.length < Math.min(ROTATION_SIZE, valid.length) - 1) continue;

      const reduced = buildSmartRotationCore(reducedValid);
      const candidateObj = makeZeroMinutes(valid);
      for (const [name, minutes] of Object.entries(reduced.obj || {})) {
        candidateObj[name] = Number(minutes || 0);
      }
      candidateObj[excluded.name] = 0;

      const candidateScore = scoreMinutes(valid, candidateObj);
      if (candidateScore > bestScore + 1e-9) {
        const reducedNames = new Set((reduced.sorted || []).map((player) => player.name));
        const excludedAndOthers = valid
          .filter((player) => !reducedNames.has(player.name))
          .sort(comparePlayers);
        best = {
          sorted: [...(reduced.sorted || []), ...excludedAndOthers],
          obj: candidateObj,
        };
        bestScore = candidateScore;
      }
    }
  });

  return best;
}

// FULL smart rotation builder - returns BOTH sorted players and minutes obj
export function buildSmartRotation(teamPlayers) {
  const diagRow = createSmartRotationBreakdownRow(teamPlayers);
  const previousDiagRow = activeSmartRotationBreakdownRow;
  const totalStart = smartNow();
  activeSmartRotationBreakdownRow = diagRow;

  try {
    const valid = measureSmart(diagRow, "validFilterMs", () => (teamPlayers || []).filter(
      (p) => p && p.name && Number.isFinite(Number(p.overall))
    ));

    if (valid.length === 0) return { sorted: [], obj: {} };

    const cacheKey = measureSmart(diagRow, "smartCacheKeyMs", () => `${GAMEPLAN_VERSION}:smart:${getRatingRosterSignature(valid)}`);
    const cached = measureSmart(diagRow, "smartCacheLookupMs", () => getLimitedCache(smartRotationCache, cacheKey));
    if (cached) {
      if (diagRow) diagRow.cacheHit = true;
      const inflated = measureSmart(diagRow, "smartCacheInflateMs", () => inflateSmartRotationResult(valid, cached));
      if (diagRow) {
        diagRow.activeCount = Object.values(inflated?.obj || {}).filter((m) => Number(m || 0) > 0).length;
      }
      return inflated;
    }

    if (diagRow) diagRow.cacheHit = false;
    const result = measureSmart(diagRow, "buildSmartRotationUncachedMs", () => buildSmartRotationUncached(valid));
    measureSmart(diagRow, "smartCacheStoreMs", () => touchLimitedCache(smartRotationCache, cacheKey, cacheSmartRotationResult(valid, result)));
    if (diagRow) {
      diagRow.activeCount = Object.values(result?.obj || {}).filter((m) => Number(m || 0) > 0).length;
    }
    return result;
  } finally {
    if (diagRow) {
      diagRow.totalMs = round4(smartNow() - totalStart);
      addSmartMetric(diagRow, "buildSmartRotationTotalMs", diagRow.totalMs);
      finalizeSmartRotationBreakdownRow(diagRow);
    }
    activeSmartRotationBreakdownRow = previousDiagRow;
  }
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
  const cacheKey = `${GAMEPLAN_VERSION}:pot:${getRatingRosterSignature(valid)}`;
  const cached = getLimitedCache(potentialRatingCache, cacheKey);
  if (cached) return { ...cached, windows: { ...(cached.windows || {}) } };

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

  // Scaled to be comparable to normal team OVR. A light top-end curve keeps
  // elite young cores clearly separated without letting the top of the league
  // spike too sharply compared with the normal team-OVR curve. This is a fixed
  // formula curve, not a league-relative hard cap or rubber-band target.
  const scaledPot = POT_SCALE_FLOOR_VALUE +
    (adjustedRawPot - POT_SCALE_BASE) * POT_SCALE_MULTIPLIER;
  const topCurvedPot = scaledPot <= POT_TOP_CURVE_START
    ? scaledPot
    : POT_TOP_CURVE_START +
      (scaledPot - POT_TOP_CURVE_START) * POT_TOP_CURVE_MULTIPLIER;
  const exactPot = Math.min(99, topCurvedPot);

  const result = {
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

  return touchLimitedCache(potentialRatingCache, cacheKey, result);
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