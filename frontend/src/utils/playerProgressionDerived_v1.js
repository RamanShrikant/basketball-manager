// playerProgressionDerived_v1.js
// Shared LeagueEditor-v19-parity derived rating helpers for progression flows.
// Keep PlayerProgression and OffseasonHub on the same formula LeagueEditor uses
// for Start Y1 / export: OVR, OFF, DEF, STA, and hidden SCO are outputs from attrs.

const T3 = 0, MID = 1, CLOSE = 2, FT = 3, BH = 4, PAS = 5, SPD = 6, ATH = 7;
const PERD = 8, INTD = 9, BLK = 10, STL = 11, REB = 12, OIQ = 13, DIQ = 14;

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const clampRange = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function getAllTeamsFromLeagueData(leagueData) {
  if (!leagueData || typeof leagueData !== "object") return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences && typeof leagueData.conferences === "object") {
    return Object.values(leagueData.conferences).flat().filter(Boolean);
  }
  return [];
}

function stripProgressionBucketMarkerLocal(player = {}) {
  if (!player || typeof player !== "object") return player;
  const { __bmProgressionBucket, ...rest } = player;
  return rest;
}

function getProgressionPlayersFromTeamLocal(team, includeTwoWay = true) {
  if (!team || typeof team !== "object") return [];

  // Important: return the actual player object references from the league.
  // This helper is used to recompute and save derived ratings in-place.
  // Earlier patch versions cloned these objects while adding bucket markers,
  // which meant OffseasonHub could calculate derived ratings on temporary
  // copies instead of the saved league players.
  const rows = [];
  const seen = new Set();

  const pushBucket = (bucketName) => {
    const bucket = Array.isArray(team?.[bucketName]) ? team[bucketName] : [];
    for (const player of bucket) {
      if (!player || typeof player !== "object") continue;
      const key = String(player?.id || player?.playerId || player?.pid || player?.name || rows.length);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(player);
    }
  };

  pushBucket("players");

  if (includeTwoWay) {
    pushBucket("twoWayPlayers");
    pushBucket("stashPlayers");
  }

  return rows;
}

function getProgressionPlayerRowsFromLeagueLocal(leagueData, includeFreeAgents = true) {
  const rows = [];

  for (const team of getAllTeamsFromLeagueData(leagueData)) {
    const teamName = team?.name || team?.teamName || team?.team || "Unknown Team";
    for (const player of getProgressionPlayersFromTeamLocal(team, true)) {
      rows.push({ player, team, teamName });
    }
  }

  if (includeFreeAgents && Array.isArray(leagueData?.freeAgents)) {
    for (const player of leagueData.freeAgents) {
      if (!player || typeof player !== "object") continue;
      rows.push({ player, team: null, teamName: "Free Agents" });
    }
  }

  return rows;
}

function bankersRound(n) {
  const f = Math.floor(n);
  const diff = n - f;
  if (Math.abs(diff - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(n);
}

function v19Jitter(name = "", attrs = []) {
  let sA = 0;
  for (let i = 0; i < attrs.length; i++) sA += (i + 1) * (attrs[i] ?? 0);
  let sN = 0;
  for (let i = 0; i < name.length; i++) sN += name.charCodeAt(i);
  const seed = (sA + 0.13 * sN) * 12.9898;
  const raw = Math.sin(seed) * 43758.5453;
  const frac = raw - Math.floor(raw);
  return (frac - 0.5) * 0.7;
}

const sigmoid = (x) => 1 / (1 + Math.exp(-0.12 * (x - 77)));

const posParams = {
  PG: {
    weights: [0.11, 0.05, 0.03, 0.05, 0.17, 0.17, 0.10, 0.07, 0.10, 0.02, 0.01, 0.07, 0.05, 0.01, 0.01],
    prim: [5, 6, 1, 7],
    alpha: 0.25,
  },
  SG: {
    weights: [0.15, 0.08, 0.05, 0.05, 0.12, 0.07, 0.11, 0.07, 0.11, 0.03, 0.02, 0.08, 0.06, 0.01, 0.01],
    prim: [1, 5, 7],
    alpha: 0.28,
  },
  SF: {
    weights: [0.12, 0.09, 0.07, 0.04, 0.08, 0.07, 0.10, 0.10, 0.10, 0.06, 0.04, 0.08, 0.05, 0.01, 0.01],
    prim: [1, 8, 9],
    alpha: 0.22,
  },
  PF: {
    weights: [0.07, 0.07, 0.12, 0.03, 0.05, 0.05, 0.08, 0.12, 0.07, 0.13, 0.08, 0.08, 0.05, 0.01, 0.01],
    prim: [3, 10, 8],
    alpha: 0.24,
  },
  C: {
    weights: [0.04, 0.06, 0.17, 0.03, 0.02, 0.04, 0.07, 0.12, 0.05, 0.16, 0.13, 0.06, 0.08, 0.01, 0.01],
    prim: [3, 10, 11, 13],
    alpha: 0.30,
  },
};

function padAttrs(attrs) {
  const a = Array.isArray(attrs) ? attrs.slice(0, 15) : [];
  while (a.length < 15) a.push(75);
  return a.map((v) => Number(v) || 75);
}

function calcOverallFromAttrs(attrs, pos) {
  const p = posParams[pos] || posParams.SF;
  const a = padAttrs(attrs);

  const W = p.weights.reduce((s, w, i) => s + w * (a[i] || 75), 0);
  const prim = p.prim.map((i) => i - 1);
  const Peak = Math.max(...prim.map((i) => a[i] || 75));
  const B = p.alpha * Peak + (1 - p.alpha) * W;

  let overall = 60 + 39 * sigmoid(B);
  overall = Math.round(Math.min(99, Math.max(60, overall)));

  const num90 = a.filter((x) => x >= 90).length;
  if (num90 >= 3) {
    overall = Math.min(99, overall + (num90 - 2));
  }
  return overall;
}

function calcStaminaFromAgeAth(age, athleticism) {
  const a = clampRange(Number(age) || 25, 18, 45);
  const ath = clampRange(Number(athleticism) || 75, 25, 99);

  let ageFactor;
  if (a <= 27) ageFactor = 1.0;
  else if (a <= 34) ageFactor = 0.95 - (0.15 * (a - 28)) / 6;
  else ageFactor = 0.8 - (0.45 * (a - 35)) / 10;

  ageFactor = clampRange(ageFactor, 0.35, 1.0);

  const raw = ageFactor * 99 * 0.575 + ath * 0.425;
  const norm = (raw - 40) / (99 - 40);
  return Math.round(clampRange(40 + norm * 59, 40, 99));
}

const OFF_WEIGHTS_POSZ = {
  PG: { [T3]: 0.18, [MID]: 0.18, [CLOSE]: 0.18, [BH]: 0.20, [PAS]: 0.20, [SPD]: 0.04, [ATH]: 0.02, [OIQ]: 0.00 },
  SG: { [T3]: 0.18, [MID]: 0.18, [CLOSE]: 0.18, [BH]: 0.14, [PAS]: 0.14, [SPD]: 0.06, [ATH]: 0.06, [OIQ]: 0.02 },
  SF: { [T3]: 0.18, [MID]: 0.18, [CLOSE]: 0.18, [BH]: 0.10, [PAS]: 0.10, [SPD]: 0.08, [ATH]: 0.10, [OIQ]: 0.08 },
  PF: { [T3]: 0.18, [MID]: 0.18, [CLOSE]: 0.18, [BH]: 0.10, [PAS]: 0.12, [SPD]: 0.08, [ATH]: 0.08, [OIQ]: 0.08 },
  C:  { [T3]: 0.18, [MID]: 0.18, [CLOSE]: 0.18, [BH]: 0.04, [PAS]: 0.10, [SPD]: 0.06, [ATH]: 0.16, [OIQ]: 0.10 },
};

const threePenaltyMult = (pos) => ({ PG: 1.1, SG: 1.0, SF: 0.75, PF: 0.8, C: 0.3 }[pos] || 1);
const closePenaltyMult = (pos) => ({ PG: 0.3, SG: 0.45, SF: 0.7, PF: 0.85, C: 1.1 }[pos] || 1);

function calcOffenseDefenseFromAttrs(attrsIn, posIn) {
  const p = posParams[posIn] || posParams.SF;
  const attrs = padAttrs(attrsIn);
  const offensiveAttrs = [T3, MID, CLOSE, FT, BH, PAS, SPD, ATH, OIQ];
  const defensiveAttrs = [ATH, PERD, INTD, BLK, STL, REB, DIQ];

  const weightedAverage = (indices) => {
    let score = 0;
    let weight = 0;
    for (const i of indices) {
      const w = p.weights[i] || 0;
      score += w * attrs[i];
      weight += w;
    }
    return weight > 0 ? score / weight : 75;
  };

  const scale = (x) => Math.round(clampRange(60 + 39 * sigmoid(x), 60, 99));

  return {
    off: scale(weightedAverage(offensiveAttrs)),
    def: scale(weightedAverage(defensiveAttrs)),
  };
}

function buildRatingBaselinesFromLeague(leagueData) {
  const offIdx = [T3, MID, CLOSE, BH, PAS, SPD, ATH, OIQ];
  const defIdx = [PERD, STL, INTD, BLK, SPD, ATH];

  const allPlayers = [];
  for (const row of getProgressionPlayerRowsFromLeagueLocal(leagueData, true)) {
    const p = row.player;
    const pos = POSITIONS.includes(p?.pos) ? p.pos : "SF";
    allPlayers.push({ pos, attrs: padAttrs(p?.attrs) });
  }

  const posBuckets = Object.fromEntries(
    POSITIONS.map((p) => [p, Object.fromEntries([...offIdx, ...defIdx].map((k) => [k, []]))])
  );
  const absBuckets = Object.fromEntries(offIdx.map((k) => [k, []]));

  for (const pl of allPlayers) {
    for (const k of [...offIdx, ...defIdx]) posBuckets[pl.pos][k].push(pl.attrs[k]);
    for (const k of offIdx) absBuckets[k].push(pl.attrs[k]);
  }

  const sampleStd = (arr) => {
    const n = arr.length;
    if (n < 2) return 1.0;
    const m = arr.reduce((s, v) => s + v, 0) / n;
    const v = arr.reduce((s, v2) => s + (v2 - m) * (v2 - m), 0) / (n - 1);
    return Math.max(1.0, Math.sqrt(v));
  };

  const posMean = {}, posStd = {};
  for (const p of POSITIONS) {
    posMean[p] = {};
    posStd[p] = {};
    for (const k of [...offIdx, ...defIdx]) {
      const arr = posBuckets[p][k];
      posMean[p][k] = arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 75;
      posStd[p][k] = arr.length ? sampleStd(arr) : 1.0;
    }
  }

  const absMean = {}, absStd = {};
  for (const k of offIdx) {
    const arr = absBuckets[k];
    absMean[k] = arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 75;
    absStd[k] = arr.length ? sampleStd(arr) : 1.0;
  }

  const safe = (v) => (v && v > 1e-6 ? v : 1.0);
  const zPos = (attrs, pos, k) => (attrs[k] - (posMean[pos]?.[k] ?? 75)) / safe(posStd[pos]?.[k]);
  const zAbs = (attrs, k) => (attrs[k] - (absMean[k] ?? 75)) / safe(absStd[k]);
  const zToRating = (z) => clampRange(75 + 12 * z, 50, 99);

  const pfBridgedWeights = (() => {
    const pf = OFF_WEIGHTS_POSZ.PF, sf = OFF_WEIGHTS_POSZ.SF;
    const keys = new Set([...Object.keys(pf), ...Object.keys(sf)].map(Number));
    const out = {};
    for (const k of keys) out[k] = 0.7 * (pf[k] || 0) + 0.3 * (sf[k] || 0);
    return out;
  })();

  const ABS_MIX = { PF: 0.7, SF: 0.2, PG: 0.1, SG: 0.1, C: 0.1 };

  const previewOff = (attrs, pos) => {
    const p = POSITIONS.includes(pos) ? pos : "SF";
    const w = p === "PF" ? pfBridgedWeights : (OFF_WEIGHTS_POSZ[p] || OFF_WEIGHTS_POSZ.SF);
    const mix = ABS_MIX[p] ?? 0.1;

    let zPosSum = 0, zAbsSum = 0;
    for (const [kStr, wt] of Object.entries(w)) {
      const k = Number(kStr);
      zPosSum += wt * zPos(attrs, p, k);
      zAbsSum += wt * zAbs(attrs, k);
    }

    let off = zToRating((1 - mix) * zPosSum + mix * zAbsSum);

    const t3Gap = Math.max(0, 50 - (attrs[T3] || 0) - 2);
    const cGap = Math.max(0, 60 - (attrs[CLOSE] || 0) - 2);
    off -= Math.min(6, 0.07 * threePenaltyMult(p) * t3Gap);
    off -= Math.min(6, 0.07 * closePenaltyMult(p) * cGap);

    return clampRange(off, 50, 99);
  };

  const previewDef = (attrs, pos) => {
    const p = POSITIONS.includes(pos) ? pos : "SF";

    const DW = ({
      PG: { [PERD]: 0.58, [STL]: 0.32, [SPD]: 0.06, [ATH]: 0.04 },
      SG: { [PERD]: 0.46, [STL]: 0.26, [INTD]: 0.12, [BLK]: 0.08, [SPD]: 0.04, [ATH]: 0.04 },
      SF: { [PERD]: 0.28, [STL]: 0.18, [INTD]: 0.28, [BLK]: 0.18, [ATH]: 0.05, [SPD]: 0.03 },
      PF: { [INTD]: 0.45, [BLK]: 0.35, [PERD]: 0.08, [STL]: 0.08, [ATH]: 0.04 },
      C:  { [INTD]: 0.52, [BLK]: 0.40, [ATH]: 0.06, [PERD]: 0.01, [STL]: 0.01 },
    })[p] || {};

    let zsum = 0;
    for (const [kStr, wt] of Object.entries(DW)) zsum += wt * zPos(attrs, p, Number(kStr));
    let def = zToRating(zsum);

    const ath = attrs[ATH] ?? 75;
    let absPen = Math.max(0, 78 - ath) * 0.08;
    let relPen = Math.max(0, (posMean[p]?.[ATH] ?? 75) - ath) * 0.05;

    if (p === "SF") {
      absPen *= 0.8;
      relPen *= 0.8;
      def += 2.5;

      const perd = attrs[PERD] ?? 75;
      const intd = attrs[INTD] ?? 75;
      const hi = Math.max(perd, intd);
      const lo = Math.min(perd, intd);

      if (perd >= 88 && intd >= 88) def += Math.min(1.0, (Math.min(perd, intd) - 88) * 0.05);

      let tier = 0;
      if (perd >= 90 || intd >= 90) tier += 0.5;
      if (perd >= 85 && intd >= 85) tier += 0.5;
      if (hi >= 93 && lo >= 84) tier += 0.5;
      if (hi >= 94 && lo >= 90) tier += 0.5;
      def += Math.min(2.0, tier);
    }

    def -= Math.min(4, absPen + relPen);

    const cap = p === "C" ? 99 : p === "PF" ? 98 : 96;
    return clampRange(def, 50, cap);
  };

  let sumOV = 0, sumOFF = 0, sumDEF = 0, n = 0;
  for (const pl of allPlayers) {
    sumOV += calcOverallFromAttrs(pl.attrs, pl.pos);
    sumOFF += previewOff(pl.attrs, pl.pos);
    sumDEF += previewDef(pl.attrs, pl.pos);
    n += 1;
  }

  const ovMean = n ? sumOV / n : 75;
  const offMean = n ? sumOFF / n : 75;
  const defMean = n ? sumDEF / n : 75;

  const offShift = clampRange(ovMean - offMean, -1.5, 1.5);
  const defShift = clampRange(ovMean - defMean, -1.5, 1.5);

  return { posMean, posStd, absMean, absStd, offShift, defShift };
}

function calcOffDefV19(attrsIn, posIn, name = "", height = 78, baselines) {
  const attrs = padAttrs(attrsIn);
  const p = POSITIONS.includes(posIn) ? posIn : "SF";

  const { posMean, posStd, absMean, absStd, offShift, defShift } = baselines;

  const safe = (v) => (v && v > 1e-6 ? v : 1.0);
  const zPos = (k) => (attrs[k] - (posMean[p]?.[k] ?? 75)) / safe(posStd[p]?.[k]);
  const zAbs = (k) => (attrs[k] - (absMean[k] ?? 75)) / safe(absStd[k]);
  const zToRating = (z) => clampRange(75 + 12 * z, 50, 99);

  const ABS_MIX = { PF: 0.7, SF: 0.2, PG: 0.1, SG: 0.1, C: 0.1 };

  const wBase =
    p === "PF"
      ? (() => {
          const pf = OFF_WEIGHTS_POSZ.PF, sf = OFF_WEIGHTS_POSZ.SF;
          const keys = new Set([...Object.keys(pf), ...Object.keys(sf)].map(Number));
          const out = {};
          for (const k of keys) out[k] = 0.7 * (pf[k] || 0) + 0.3 * (sf[k] || 0);
          return out;
        })()
      : (OFF_WEIGHTS_POSZ[p] || OFF_WEIGHTS_POSZ.SF);

  let zPosSum = 0, zAbsSum = 0;
  for (const [kStr, wt] of Object.entries(wBase)) {
    const k = Number(kStr);
    zPosSum += wt * zPos(k);
    zAbsSum += wt * zAbs(k);
  }

  const mix = ABS_MIX[p] ?? 0.1;
  let off = zToRating((1 - mix) * zPosSum + mix * zAbsSum);

  const t3Gap = Math.max(0, 50 - (attrs[T3] || 0) - 2);
  const cGap = Math.max(0, 60 - (attrs[CLOSE] || 0) - 2);
  off -= Math.min(6, 0.07 * threePenaltyMult(p) * t3Gap);
  off -= Math.min(6, 0.07 * closePenaltyMult(p) * cGap);

  const DW = ({
    PG: { [PERD]: 0.58, [STL]: 0.32, [SPD]: 0.06, [ATH]: 0.04 },
    SG: { [PERD]: 0.46, [STL]: 0.26, [INTD]: 0.12, [BLK]: 0.08, [SPD]: 0.04, [ATH]: 0.04 },
    SF: { [PERD]: 0.28, [STL]: 0.18, [INTD]: 0.28, [BLK]: 0.18, [ATH]: 0.05, [SPD]: 0.03 },
    PF: { [INTD]: 0.45, [BLK]: 0.35, [PERD]: 0.08, [STL]: 0.08, [ATH]: 0.04 },
    C:  { [INTD]: 0.52, [BLK]: 0.40, [ATH]: 0.06, [PERD]: 0.01, [STL]: 0.01 },
  })[p] || {};

  let zsumD = 0;
  for (const [kStr, wt] of Object.entries(DW)) zsumD += wt * zPos(Number(kStr));
  let def = zToRating(zsumD);

  const ath = attrs[ATH] ?? 75;
  let absPen = Math.max(0, 78 - ath) * 0.08;
  let relPen = Math.max(0, (posMean[p]?.[ATH] ?? 75) - ath) * 0.05;

  if (p === "SF") {
    absPen *= 0.8;
    relPen *= 0.8;
    def += 2.5;

    const perd = attrs[PERD] ?? 75;
    const intd = attrs[INTD] ?? 75;
    const hi = Math.max(perd, intd);
    const lo = Math.min(perd, intd);

    if (perd >= 88 && intd >= 88) def += Math.min(1.0, (Math.min(perd, intd) - 88) * 0.05);

    let tier = 0;
    if (perd >= 90 || intd >= 90) tier += 0.5;
    if (perd >= 85 && intd >= 85) tier += 0.5;
    if (hi >= 93 && lo >= 84) tier += 0.5;
    if (hi >= 94 && lo >= 90) tier += 0.5;
    def += Math.min(2.0, tier);
  }

  def -= Math.min(4, absPen + relPen);

  const j = v19Jitter(name, attrs);
  off = clampRange(off + offShift + j, 50, 99);

  const defCap = p === "C" ? 99 : p === "PF" ? 98 : 96;
  def = clampRange(def + defShift + 0.7 * j, 50, defCap);

  return { off: bankersRound(off), def: bankersRound(def) };
}

function explodeJS(value, power) {
  return (value / 100) ** power;
}

function closePenaltyJS(close) {
  if (close >= 70) return 0;
  return ((70 - close) / 30) ** 2.3;
}

function calcScoringRating(pos, three, mid, close) {
  if (pos === "PG" || pos === "SG") {
    const three_term = explodeJS(three, 7) * 1.2;
    const mid_term = explodeJS(mid, 7) * 1.55;
    const close_term = explodeJS(close, 6) * 1.1;

    const base = 0.38 * (three / 100) + 0.40 * (mid / 100) + 0.22 * (close / 100);
    const penalty = closePenaltyJS(close) * 1.7;

    const raw = base + three_term + mid_term + close_term - penalty;
    return raw * 14.75 + 43.5;
  }

  if (pos === "SF") {
    const three_term = explodeJS(three, 7) * 1.05;
    const mid_term = explodeJS(mid, 7) * 1.4;
    const close_term = explodeJS(close, 7) * 1.5;

    const base = 0.32 * (three / 100) + 0.35 * (mid / 100) + 0.33 * (close / 100);
    const penalty = closePenaltyJS(close) * 1.2;

    const raw = base + three_term + mid_term + close_term - penalty;
    return raw * 14.75 + 43.5;
  }

  if (pos === "PF" || pos === "C") {
    const close_term = explodeJS(close, 8) * 1.95;
    const mid_term = explodeJS(mid, 6) * 1.3;
    const three_term = explodeJS(three, 5) * 0.6;

    const base = 0.58 * (close / 100) + 0.27 * (mid / 100) + 0.15 * (three / 100);
    const penalty = closePenaltyJS(close) * 2.0;

    const raw = base + close_term + mid_term + three_term - penalty;
    return raw * 14.75 + 43.5;
  }

  return 50;
}

export function recomputeDerivedRatingsInLeague(leagueData) {
  // Build baselines once from the post-progression league, matching LeagueEditor v19.
  // Then recalc every player's derived fields from attrs with that shared baseline.
  const baselines = buildRatingBaselinesFromLeague(leagueData);

  for (const row of getProgressionPlayerRowsFromLeagueLocal(leagueData, true)) {
    const p = row.player;
    const pos = POSITIONS.includes(p?.pos) ? p.pos : "SF";
    const attrs = padAttrs(p?.attrs);

    p.attrs = attrs;
    p.overall = calcOverallFromAttrs(attrs, pos);

    const { off, def } = calcOffDefV19(
      attrs,
      pos,
      p?.name || p?.player || "",
      Number(p?.height ?? 78),
      baselines
    );
    p.offRating = off;
    p.defRating = def;

    p.stamina = calcStaminaFromAgeAth(p?.age ?? 25, attrs[ATH]);
    const sco = calcScoringRating(pos, attrs[T3], attrs[MID], attrs[CLOSE]);
    p.scoringRating = Number.isFinite(sco)
      ? clampRange(sco, 0, 99)
      : (p.scoringRating ?? 50);
  }

  return leagueData;
}
