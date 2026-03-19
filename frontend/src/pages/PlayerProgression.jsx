import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { computePlayerProgression } from "../api/simEnginePy";

const DELTAS_KEY = "bm_progression_deltas_v1";
const PROG_META_KEY = "bm_progression_meta_v1";
const LEAGUE_KEY = "leagueData";
  const META_KEY = "bm_league_meta_v1";
  const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";

// If a run gets stuck INFLIGHT (worker failed / page refresh), clear after this long
const INFLIGHT_STALE_MS = 15000;

function clamp(n, lo = 0, hi = 99) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function resolvePortrait(p) {
  return (
    p?.portrait ||
    p?.headshot ||
    p?.photo ||
    p?.image ||
    p?.img ||
    p?.face ||
    p?.playerImage ||
    null
  );
}

const playerKey = (name, team) => `${name}__${team}`;

function resolveTeamLogo(teamObj) {
  return (
    teamObj?.logo ||
    teamObj?.logoUrl ||
    teamObj?.logoURL ||
    teamObj?.teamLogo ||
    teamObj?.image ||
    teamObj?.img ||
    teamObj?.icon ||
    null
  );
}

function loadStatsByKeyFromStorage() {
  const keysToTry = [
    "bm_player_stats_v1",
    "bm_season_player_stats_v1",
    "playerStatsByKey",
    "statsByKey",
  ];

  const stores = [localStorage, sessionStorage];

  for (const store of stores) {
    for (const k of keysToTry) {
      try {
        const raw = store.getItem(k);
        if (!raw) continue;

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") continue;

        const someKey = Object.keys(parsed)[0];
        if (someKey && someKey.includes("__")) {
          return parsed;
        }

        const rows = Array.isArray(parsed) ? parsed : Object.values(parsed);

        const statsByKey = {};
        for (const r of rows) {
          const name = r?.player ?? r?.name ?? r?.playerName;
          const team = r?.team ?? r?.teamName;
          if (!name || !team) continue;
          statsByKey[`${name}__${team}`] = r;
        }

        if (Object.keys(statsByKey).length > 0) {
          try {
            localStorage.setItem("bm_player_stats_v1", JSON.stringify(statsByKey));
          } catch {}
          return statsByKey;
        }
      } catch {}
    }
  }

  return {};
}

function buildProgressionDeltas(beforeLeague, afterLeague) {
  const teamsA = getAllTeamsFromLeague(beforeLeague);
  const teamsB = getAllTeamsFromLeague(afterLeague);

  const mapPlayers = (teams) => {
    const m = {};
    for (const t of teams || []) {
      const teamName = t?.name || "";
      for (const p of t?.players || []) {
        if (!p?.name || !teamName) continue;
        m[`${p.name}__${teamName}`] = p;
      }
    }
    return m;
  };

  const A = mapPlayers(teamsA);
  const B = mapPlayers(teamsB);

  const deltas = {};

  for (const key of Object.keys(B)) {
    const p0 = A[key];
    const p1 = B[key];
    if (!p0 || !p1) continue;

    const d = {};

    const scalarKeys = ["age", "overall", "offRating", "defRating", "stamina", "potential"];
    for (const k of scalarKeys) {
      const v0 = Number(p0?.[k] ?? 0);
      const v1 = Number(p1?.[k] ?? 0);
      const diff = v1 - v0;
      if (diff) d[k] = diff;
    }

    const attrs0 = Array.isArray(p0?.attrs) ? p0.attrs : [];
    const attrs1 = Array.isArray(p1?.attrs) ? p1.attrs : [];
    const maxLen = Math.max(attrs0.length, attrs1.length);

    for (let i = 0; i < maxLen; i++) {
      const v0 = Number(attrs0[i] ?? 0);
      const v1 = Number(attrs1[i] ?? 0);
      const diff = v1 - v0;
      if (diff) d[`attr${i}`] = diff;
    }

if (Object.keys(d).length) {
  deltas[key] = d;
}

  }

  return deltas;
}

function deepUnpair(x) {
  if (!x) return x;

  // Map -> Object
  if (x instanceof Map) {
    const obj = Object.fromEntries(x);
    for (const k of Object.keys(obj)) obj[k] = deepUnpair(obj[k]);
    return obj;
  }

  // Array of [k,v] pairs -> Object
  if (Array.isArray(x) && x.length && Array.isArray(x[0]) && x[0].length === 2) {
    const obj = Object.fromEntries(x.map(([k, v]) => [k, deepUnpair(v)]));
    return obj;
  }

  // Normal array -> recurse items
  if (Array.isArray(x)) return x.map(deepUnpair);

  // Plain object -> recurse props
  if (typeof x === "object") {
    const out = { ...x };
    for (const k of Object.keys(out)) out[k] = deepUnpair(out[k]);
    return out;
  }

  return x;
}

function normalizeDeltasFromPython(league, pythonDeltas) {
  const unpaired = deepUnpair(pythonDeltas);
  if (!unpaired || typeof unpaired !== "object") return {};

  const keys = Object.keys(unpaired);
  const firstKey = keys[0] || "";

  // If Python already returns byKey ("Name__Team"), keep it.
  if (firstKey.includes("__")) return unpaired;

  // Otherwise assume byName, convert to byKey using current league rosters.
  const out = {};
  const teams = getAllTeamsFromLeague(league);

  for (const t of teams || []) {
    const teamName = t?.name || "";
    for (const p of t?.players || []) {
      const name = p?.name;
      if (!name || !teamName) continue;

      const byName = unpaired?.[name];
      if (byName && typeof byName === "object") {
        out[`${name}__${teamName}`] = byName;
      }
    }
  }

  return out;
}



function snapshotLeague(obj) {
  try {
    if (typeof structuredClone === "function") return structuredClone(obj);
  } catch {}
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
}
function getSeasonYearFromMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    const meta = raw ? JSON.parse(raw) : null;
    const y = Number(meta?.seasonYear);
    return Number.isFinite(y) ? y : null;
  } catch {
    return null;
  }
}

function inferSeasonYear(leagueData) {
  const metaYear = getSeasonYearFromMeta();
  if (metaYear != null) return metaYear;

  const y1 = Number(leagueData?.seasonYear);
  if (Number.isFinite(y1)) return y1;

  const y2 = Number(leagueData?.seasonStartYear);
  if (Number.isFinite(y2)) return y2;

  const today = new Date();
  return today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
}


function stampAgingGuards(league, seasonYear) {
  if (!league) return league;
  const teams = getAllTeamsFromLeague(league);
  for (const t of teams) {
    for (const p of t?.players || []) {
      if (!p || typeof p !== "object") continue;
      if (!Number.isFinite(Number(p.lastBirthdayYear))) {
        p.lastBirthdayYear = seasonYear;
      }
    }
  }
  return league;
}

function readJsonSafe(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}
// -------------------------
// LeagueEditor parity helpers (v19)
// Paste above PlayerProgression component
// -------------------------

const T3 = 0, MID = 1, CLOSE = 2, FT = 3, BH = 4, PAS = 5, SPD = 6, ATH = 7;
const PERD = 8, INTD = 9, BLK = 10, STL = 11, REB = 12, OIQ = 13, DIQ = 14;

const clampRange = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

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
    const bonus = num90 - 2;
    overall = Math.min(99, overall + bonus);
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

function buildRatingBaselinesFromLeague(leagueData) {
  const POS = ["PG", "SG", "SF", "PF", "C"];
  const offIdx = [T3, MID, CLOSE, BH, PAS, SPD, ATH, OIQ];
  const defIdx = [PERD, STL, INTD, BLK, SPD, ATH];

  const teams = getAllTeamsFromLeague(leagueData);
  const allPlayers = [];
  for (const t of teams || []) {
    for (const p of t?.players || []) {
      const pos = POS.includes(p?.pos) ? p.pos : "SF";
      allPlayers.push({ pos, attrs: padAttrs(p?.attrs) });
    }
  }

  const posBuckets = Object.fromEntries(
    POS.map((p) => [p, Object.fromEntries([...offIdx, ...defIdx].map((k) => [k, []]))])
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
  for (const p of POS) {
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
    const p = POS.includes(pos) ? pos : "SF";
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
    const p = POS.includes(pos) ? pos : "SF";

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
  const POS = ["PG", "SG", "SF", "PF", "C"];
  const p = POS.includes(posIn) ? posIn : "SF";

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

// Optional but recommended: keep SCO and STA consistent with editor
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

function recomputeDerivedRatingsInLeague(leagueData) {
  const baselines = buildRatingBaselinesFromLeague(leagueData);
  const teams = getAllTeamsFromLeague(leagueData);

  for (const t of teams || []) {
    for (const p of t?.players || []) {
      const pos = ["PG", "SG", "SF", "PF", "C"].includes(p?.pos) ? p.pos : "SF";
      const name = p?.name || p?.player || "";
      const attrs = padAttrs(p?.attrs);

      p.attrs = attrs;

      p.overall = calcOverallFromAttrs(attrs, pos);

      const { off, def } = calcOffDefV19(attrs, pos, name, p?.height ?? 78, baselines);
      p.offRating = off;
      p.defRating = def;

      p.stamina = calcStaminaFromAgeAth(p?.age ?? 25, attrs[ATH]);

      const sco = calcScoringRating(pos, attrs[T3], attrs[MID], attrs[CLOSE]);
      p.scoringRating = Number.isFinite(sco) ? sco : (p.scoringRating ?? 50);
    }
  }

  return leagueData;
}
export default function PlayerProgression() {
  function handleReturnToCalendar() {
  try {
    localStorage.setItem(
      OFFSEASON_STATE_KEY,
      JSON.stringify({
        active: false,
        seasonYear: Number(
          leagueData?.seasonYear ||
          leagueData?.currentSeasonYear ||
          leagueData?.seasonStartYear ||
          2026
        ),
        retirementsComplete: false,
        optionsComplete: false,
        freeAgencyComplete: false,
        progressionComplete: false,
      })
    );
  } catch (err) {
    console.error("[PlayerProgression] failed to reset offseason state", err);
  }

  navigate("/calendar");
}
  useEffect(() => {
  console.log("[PPDBG] MOUNT PlayerProgression");
  return () => console.log("[PPDBG] UNMOUNT PlayerProgression");
}, []);
  console.count("[PPDBG] component render");
  const { leagueData, setLeagueData, selectedTeam, setSelectedTeam } = useGame();
  const navigate = useNavigate();

  const [showLetters, setShowLetters] = useState(localStorage.getItem("showLetters") === "true");
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [featuredKey, setFeaturedKey] = useState(null);

  const [deltas, setDeltas] = useState(() => readJsonSafe(DELTAS_KEY, {}));

  const attrColumns = [
    { key: "attr0", label: "3PT", index: 0 },
    { key: "attr1", label: "MID", index: 1 },
    { key: "attr2", label: "CLOSE", index: 2 },
    { key: "attr3", label: "FT", index: 3 },
    { key: "attr4", label: "BALL", index: 4 },
    { key: "attr5", label: "PASS", index: 5 },
    { key: "attr8", label: "PER D", index: 8 },
    { key: "attr9", label: "INS D", index: 9 },
    { key: "attr10", label: "BLK", index: 10 },
    { key: "attr11", label: "STL", index: 11 },
    { key: "attr12", label: "REB", index: 12 },
    { key: "attr7", label: "ATH", index: 7 },
    { key: "attr13", label: "OIQ", index: 13 },
    { key: "attr14", label: "DIQ", index: 14 },
  ];

  const toLetter = (num) => {
    const n = Number(num) || 0;
    if (n >= 94) return "A+";
    if (n >= 87) return "A";
    if (n >= 80) return "A-";
    if (n >= 77) return "B+";
    if (n >= 73) return "B";
    if (n >= 70) return "B-";
    if (n >= 67) return "C+";
    if (n >= 63) return "C";
    if (n >= 60) return "C-";
    if (n >= 57) return "D+";
    if (n >= 53) return "D";
    if (n >= 50) return "D-";
    return "F";
  };

  const handleCellDoubleClick = () => {
    const next = !showLetters;
    setShowLetters(next);
    localStorage.setItem("showLetters", String(next));
  };

  useEffect(() => {
    console.log("[PPDBG] selectedTeam loader effect", { selectedTeam: selectedTeam?.name || null });
    if (!selectedTeam) {
      const saved = localStorage.getItem("selectedTeam");
      if (saved) setSelectedTeam(JSON.parse(saved));
    }
  }, [selectedTeam, setSelectedTeam]);

  // ✅ Apply progression ONCE per season using Python
  useEffect(() => {
    if (!leagueData) return;
    // =====================
// [PPDBG] Block A - Effect entry + BEFORE snapshot context
// =====================
const runId = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
console.groupCollapsed(`[PPDBG] useEffect ENTER runId=${runId}`);
console.count("[PPDBG] useEffect fired");

// Grab raw meta strings too (so we see exact stored values, not parsed guesses)
const rawLeagueMeta = localStorage.getItem(META_KEY);
const rawProgMeta = localStorage.getItem(PROG_META_KEY);

console.log("[PPDBG] raw metas", { runId, rawLeagueMeta, rawProgMeta });

const findPlayerAnyTeam = (league, playerName) => {
  const teams = getAllTeamsFromLeague(league);
  for (const t of teams || []) {
    const teamName = t?.name || "";
    for (const p of t?.players || []) {
      if (p?.name === playerName) {
        return {
          team: teamName,
          overall: p?.overall,
          age: p?.age,
          attr0_3pt: p?.attrs?.[0],
          attr1_mid: p?.attrs?.[1],
          attr2_close: p?.attrs?.[2],
        };
      }
    }
  }
  return null;
};

console.log("[PPDBG] BEFORE (leagueData) peek", {
  runId,
  leagueData_seasonYear: leagueData?.seasonYear,
  leagueData_seasonStartYear: leagueData?.seasonStartYear,
  metaSeasonYear: getSeasonYearFromMeta(),
  inferredSeasonYear: inferSeasonYear(leagueData),
  derrick: findPlayerAnyTeam(leagueData, "Derrick White"),
  anfernee: findPlayerAnyTeam(leagueData, "Anfernee Simons"),
});
    // --- [PERM FIX] run identity + cleanup guards ---
let cancelled = false;
let inflightInterval = null;
    const seasonYear = inferSeasonYear(leagueData);
    
    

    // Read meta
    let progMeta = readJsonSafe(PROG_META_KEY, null);
    console.log("[PlayerProgression] seasonYear =", seasonYear);
console.log("[PlayerProgression] leagueData.seasonYear =", leagueData?.seasonYear);
console.log("[PlayerProgression] leagueData.seasonStartYear =", leagueData?.seasonStartYear);
console.log("[PlayerProgression] progMeta =", progMeta);



// --- [PERM FIX] If another progression is already running, do NOT start a second one.
// Instead, attach to it and load results once it finishes.
if (progMeta?.appliedForSeasonYear === "INFLIGHT") {
  const ageMs = Date.now() - Number(progMeta?.ts || 0);

  // fresh inflight - attach
  if (ageMs <= INFLIGHT_STALE_MS) {
    console.log("[PlayerProgression] INFLIGHT detected, attaching instead of rerunning", { runId, seasonYear, ageMs });

    inflightInterval = setInterval(() => {
      if (cancelled) return;

      const m = readJsonSafe(PROG_META_KEY, null);
      const done = m?.appliedForSeasonYear === seasonYear;

      if (done) {
        try {
          const updatedLeague = readJsonSafe(LEAGUE_KEY, null);
          const savedDeltas = readJsonSafe(DELTAS_KEY, {});

          if (updatedLeague) {
            setDeltas(savedDeltas || {});
            setLeagueData(updatedLeague);

            const teamsLocal = getAllTeamsFromLeague(updatedLeague);
            const updatedTeam = teamsLocal.find((t) => t?.name === selectedTeam?.name);
            if (updatedTeam) setSelectedTeam(updatedTeam);
          }
        } finally {
          clearInterval(inflightInterval);
          inflightInterval = null;
        }
      }
    }, 200);

    // IMPORTANT - we are done here, do not start progression
    return () => {
      cancelled = true;
      if (inflightInterval) clearInterval(inflightInterval);
    };
  }

  // stale inflight - clear and allow rerun
  console.warn("[PlayerProgression] stale INFLIGHT detected, clearing meta so progression can rerun.", { runId, ageMs });
  try {
    localStorage.removeItem(PROG_META_KEY);
  } catch {}
  progMeta = null;
} 




 // ✅ If already applied this season, skip (never rerun aging)
if (progMeta?.appliedForSeasonYear === seasonYear) return;


    const statsByKeyPreview = loadStatsByKeyFromStorage();
    const hasStats = statsByKeyPreview && Object.keys(statsByKeyPreview).length > 0;

    if (!hasStats) {
      console.warn("[PlayerProgression] No stats found. Running progression without stats.");
    }

    // mark inflight
    try {
      console.log("[PPDBG] setting INFLIGHT", { runId, seasonYear });
      localStorage.setItem(
        PROG_META_KEY,
        JSON.stringify({ appliedForSeasonYear: "INFLIGHT", ts: Date.now(), seasonYear, runId })
      );
    } catch {}

    (async () => {
      try {
        const beforeSnapshot = snapshotLeague(leagueData);

        const leagueForProg = snapshotLeague(leagueData);
        leagueForProg.seasonYear = seasonYear;
        leagueForProg.seasonStartYear = seasonYear;

        console.log("[PlayerProgression] computePlayerProgression POST", {
          seasonYear,
          hasLeague: !!leagueForProg,
          hasStats,
        });
console.log("[PPDBG] calling computePlayerProgression", {
  runId,
  seasonYear,
  hasStats,
  statsKeyCount: Object.keys(statsByKeyPreview || {}).length,
});
const msg = await computePlayerProgression(leagueForProg, statsByKeyPreview, {
  seed: seasonYear,
  seasonYear,
});

  console.log("[DEBUG] raw deltas from Python:", JSON.stringify(msg?.deltas ?? msg?.payload?.deltas));

// ✅ Support both shapes:
// 1) msg = { league, deltas, version }
// 2) msg = { type, requestId, payload: { league, deltas, version } }
const res = msg?.league ? msg : msg?.payload;
console.log("[PPDBG] worker response", {
  runId,
  msgKeys: Object.keys(msg || {}),
  resKeys: Object.keys(res || {}),
  version: res?.version,
  hasLeague: !!res?.league,
  hasDeltas: !!res?.deltas,
  resDeltaCount: res?.deltas ? Object.keys(res.deltas).length : 0,
});

console.log("[PlayerProgression] computePlayerProgression msg keys:", Object.keys(msg || {}));
console.log("[PlayerProgression] computePlayerProgression res keys:", Object.keys(res || {}));
console.log("[PlayerProgression] res.version:", res?.version);

if (!res || !res.league) {
  throw new Error("[PlayerProgression] Progression returned no league. Check worker response shape.");
}

let updatedLeague = res.league;


        if (!Number.isFinite(Number(updatedLeague?.seasonYear))) updatedLeague.seasonYear = seasonYear;
        if (!Number.isFinite(Number(updatedLeague?.seasonStartYear))) updatedLeague.seasonStartYear = seasonYear;

        updatedLeague = stampAgingGuards(updatedLeague, seasonYear);

// ✅ FORCE LeagueEditor formulas as the source of truth for derived ratings
updatedLeague = recomputeDerivedRatingsInLeague(updatedLeague);

// ✅ Build deltas from final values so the UI matches exactly
const newDeltas = buildProgressionDeltas(beforeSnapshot, updatedLeague);
const derrickAfter = findPlayerAnyTeam(updatedLeague, "Derrick White");
const anferneeAfter = findPlayerAnyTeam(updatedLeague, "Anfernee Simons");

const derrickKey = derrickAfter?.team ? `Derrick White__${derrickAfter.team}` : null;
const anferneeKey = anferneeAfter?.team ? `Anfernee Simons__${anferneeAfter.team}` : null;

console.log("[PPDBG] AFTER (updatedLeague) peek", {
  runId,
  derrickAfter,
  anferneeAfter,
});

console.log("[PPDBG] deltas built", {
  runId,
  deltaCount: Object.keys(newDeltas || {}).length,
  source: (res?.deltas && Object.keys(res.deltas || {}).length > 0) ? "python" : "js_fallback",
  derrickKey,
  anferneeKey,
  derrickDelta: derrickKey ? newDeltas?.[derrickKey] : null,
  anferneeDelta: anferneeKey ? newDeltas?.[anferneeKey] : null,
});


const deltaCount = Object.keys(newDeltas || {}).length;
console.log("[PlayerProgression] deltas count:", deltaCount);

// ✅ If no deltas, something is wrong. Do NOT save/lock.
if (deltaCount === 0) {
  throw new Error(`[PlayerProgression] deltaCount = 0 for seasonYear = ${seasonYear}. Refusing to lock season.`);
}
console.log("[PPDBG] writing LEAGUE_KEY", { runId, seasonYear });
// --- [PERM FIX] Only the owner runId is allowed to commit writes ---
const metaNow = readJsonSafe(PROG_META_KEY, null);
const stillOwner =
  metaNow?.appliedForSeasonYear === "INFLIGHT" &&
  metaNow?.seasonYear === seasonYear &&
  metaNow?.runId === runId;

if (!stillOwner) {
  console.warn("[PlayerProgression] Not owner anymore - skipping commits", { runId, seasonYear, metaNow });
  return;
}
localStorage.setItem(LEAGUE_KEY, JSON.stringify(updatedLeague));



// ✅ EARLY LOCK: if we crash after this point, never rerun progression for this season
try {
  localStorage.setItem(
    PROG_META_KEY,
    JSON.stringify({
      appliedForSeasonYear: seasonYear,
      ts: Date.now(),
      deltaCount,
      seasonYear,
      deltasSaved: false,
      stage: "EARLY_LOCK",
    })
  );
  console.log("[PPDBG] DONE", {
  runId,
  seasonYear,
  savedProgMeta: readJsonSafe(PROG_META_KEY, null),
  savedDeltaCount: Object.keys(readJsonSafe(DELTAS_KEY, {}) || {}).length,
});
console.groupEnd();
} catch {}

let deltaSaveOk = true;
try {
  console.log("[PPDBG] writing DELTAS_KEY", { runId, seasonYear, deltaCount: Object.keys(newDeltas || {}).length });
  localStorage.setItem(DELTAS_KEY, JSON.stringify(newDeltas));
} catch (e) {
  deltaSaveOk = false;
  console.error("[PlayerProgression] Failed to save deltas. Continuing anyway.", e);

  // keep the key valid so your UI does not crash
  try {
    localStorage.setItem(DELTAS_KEY, JSON.stringify({}));
  } catch {}
}

        // ✅ FIX 4: clear season stats AFTER progression succeeds (so next season starts fresh)
if (deltaCount > 0) {
  const statKeysToClear = [
    "bm_player_stats_v1",
    "bm_season_player_stats_v1",
    "playerStatsByKey",
    "statsByKey",
  ];

  for (const store of [localStorage, sessionStorage]) {
    for (const k of statKeysToClear) {
      try {
        store.removeItem(k);
      } catch {}
    }
  }

  console.log("[PlayerProgression] cleared season stat keys:", statKeysToClear);
}


        setDeltas(newDeltas);
        setLeagueData(updatedLeague);

        const teamsLocal = getAllTeamsFromLeague(updatedLeague);
        const updatedTeam = teamsLocal.find((t) => t?.name === selectedTeam?.name);
        if (updatedTeam) setSelectedTeam(updatedTeam);

        // ✅ only lock season if we actually produced deltas
  localStorage.setItem(
  PROG_META_KEY,
  JSON.stringify({
    appliedForSeasonYear: seasonYear,
    ts: Date.now(),
    deltaCount,
    seasonYear,
    deltasSaved: deltaSaveOk,
  })
);

      } catch (err) {
        console.error("[PlayerProgression] Python progression failed:", err);
        // ✅ do NOT lock season on error
        try {
          localStorage.setItem(
            PROG_META_KEY,
            JSON.stringify({ appliedForSeasonYear: "ERROR", ts: Date.now(), error: String(err) })
          );
        } catch {}
        console.log("[PPDBG] ERROR end", { runId, err: String(err) });
        console.groupEnd();
      }
    })();
    return () => {
  cancelled = true;
  if (inflightInterval) clearInterval(inflightInterval);
};
  }, [leagueData, selectedTeam, setLeagueData, setSelectedTeam]);

  const teams = useMemo(() => getAllTeamsFromLeague(leagueData), [leagueData]);

  const teamLogoByName = useMemo(() => {
    const map = {};
    for (const t of teams || []) {
      const name = t?.name;
      if (!name) continue;
      const logo = resolveTeamLogo(t);
      if (logo) map[name] = logo;
    }
    return map;
  }, [teams]);

  const allRows = useMemo(() => {
    const rows = [];
    for (const t of teams || []) {
      const teamName = t?.name || "Team";
      for (const p of t.players || []) {
        rows.push({ ...p, team: teamName, __key: playerKey(p?.name, teamName) });
      }
    }
    return rows;
  }, [teams]);

  const teamOptions = useMemo(() => {
    const names = Array.from(new Set((teams || []).map((t) => t?.name).filter(Boolean))).sort();
    return ["ALL", ...names];
  }, [teams]);

  const rows = useMemo(() => {
    if (teamFilter === "ALL") return allRows;
    return allRows.filter((r) => r.team === teamFilter);
  }, [allRows, teamFilter]);

  useEffect(() => {
    if (!featuredKey && rows.length) setFeaturedKey(rows[0].__key);
  }, [rows, featuredKey]);

  const featured = useMemo(() => {
    if (!rows.length) return null;
    return rows.find((r) => r.__key === featuredKey) || rows[0];
  }, [rows, featuredKey]);

  const deltaFor = (row, key) => {
    const byKey = deltas?.[row.__key];
    if (byKey && typeof byKey === "object") return Number(byKey?.[key] ?? 0) || 0;

    const byName = deltas?.[row.name];
    if (byName && typeof byName === "object") return Number(byName?.[key] ?? 0) || 0;

    return 0;
  };

  const DeltaBadge = ({ d }) => {
    if (!d) return null;
    const up = d > 0;
    return (
      <span className="ml-2 inline-flex items-center gap-1">
        <span className={up ? "text-green-400 font-extrabold" : "text-red-400 font-extrabold"}>
          {up ? "▲" : "▼"}
        </span>
        <span className="text-yellow-300 font-extrabold">{up ? `+${d}` : `${d}`}</span>
      </span>
    );
  };

  const portraitSrc = resolvePortrait(featured);
  const featuredTeamLogo = featured?.team ? teamLogoByName?.[featured.team] : null;

  const fillPercent = Math.min((featured?.overall || 0) / 99, 1);
  const circleCircumference = 2 * Math.PI * 50;
  const strokeOffset = circleCircumference * (1 - fillPercent);

  if (!leagueData) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex items-center justify-center">
        Loading progression...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-900 text-white py-10">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-4xl font-extrabold text-orange-500">Player Progression</h1>
          <div className="flex items-center gap-3">
            <select
              value={teamFilter}
              onChange={(e) => {
                setTeamFilter(e.target.value);
                setFeaturedKey(null);
              }}
              className="px-3 py-2 bg-neutral-800 rounded border border-neutral-700"
            >
              {teamOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
              <button
                onClick={handleReturnToCalendar}
                className="px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
              >
                Return to Calendar
              </button>
          </div>
        </div>

        {featured && (
          <div className="relative bg-neutral-800 rounded-xl shadow-lg px-8 pt-7 pb-4 mb-6">
            <div className="absolute left-0 right-0 bottom-0 h-[2px] bg-white opacity-20" />

            <div className="flex items-end justify-between gap-6">
              <div className="flex items-end gap-6">
                <div className="relative -mb-[8px]">
                  {portraitSrc ? (
                    <img src={portraitSrc} alt={featured.name} className="h-[170px] w-auto object-contain" />
                  ) : (
                    <div className="h-[170px] w-[120px] bg-neutral-700 rounded-lg flex items-center justify-center text-neutral-300">
                      No Photo
                    </div>
                  )}
                </div>

                <div className="mb-2">
                  <h2 className="text-[42px] font-bold leading-tight">{featured.name}</h2>
                  <p className="text-gray-400 text-[22px] mt-1 flex items-center gap-2">
                    {featured.pos} •{" "}
                    {featuredTeamLogo ? (
                      <img
                        src={featuredTeamLogo}
                        alt={featured.team}
                        className="h-[22px] w-[22px] object-contain inline-block"
                        draggable={false}
                      />
                    ) : (
                      <span className="inline-block w-[22px]" />
                    )}{" "}
                    • Age {featured.age}
                  </p>
                </div>
              </div>

              <div className="relative flex items-center justify-center mr-2 mb-2">
                <svg width="105" height="105" viewBox="0 0 120 120">
                  <defs>
                    <linearGradient id="ovrGradientProg" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#FFA500" />
                      <stop offset="100%" stopColor="#FFD54F" />
                    </linearGradient>
                  </defs>
                  <circle cx="60" cy="60" r="50" stroke="rgba(255,255,255,0.08)" strokeWidth="8" fill="none" />
                  <circle
                    cx="60"
                    cy="60"
                    r="50"
                    stroke="url(#ovrGradientProg)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    fill="none"
                    strokeDasharray={circleCircumference}
                    strokeDashoffset={strokeOffset}
                    transform="rotate(-90 60 60)"
                  />
                </svg>

                <div className="absolute text-center">
                  <p className="text-sm text-gray-300">OVR</p>
                  <p className="text-[44px] font-extrabold text-orange-400 leading-none mt-[-6px]">
                    {featured.overall}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    POT <span className="text-orange-400 font-semibold">{featured.potential}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <div className="min-w-[1300px] max-w-max mx-auto">
            <table className="w-full border-collapse text-center">
              <thead className="bg-neutral-800 text-gray-300 text-[16px] font-semibold">
                <tr>
                  {[
                    { key: "name", label: "Name" },
                    { key: "team", label: "TEAM" },
                    { key: "pos", label: "POS" },
                    { key: "age", label: "AGE" },
                    { key: "overall", label: "OVR" },
                    { key: "offRating", label: "OFF" },
                    { key: "defRating", label: "DEF" },
                    { key: "stamina", label: "STAM" },
                    { key: "potential", label: "POT" },
                    ...attrColumns,
                  ].map((col) => (
                    <th
                      key={col.key}
                      className={`py-3 px-3 min-w-[95px] ${
                        col.key === "name" ? "min-w-[200px] text-left pl-4" : "text-center"
                      }`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="text-[17px] font-medium">
                {rows.map((p, idx) => {
                  const active = p.__key === featured?.__key;
                  const logo = teamLogoByName?.[p.team] || null;

                  return (
                    <tr
                      key={`${p.__key}-${idx}`}
                      className={`transition cursor-pointer ${active ? "bg-orange-600/25" : "hover:bg-neutral-800"}`}
                      onClick={() => setFeaturedKey(p.__key)}
                    >
                      <td className="py-2 px-3 whitespace-nowrap text-left pl-4 font-semibold">{p.name}</td>

                      <td className="py-2 px-3">
                        {logo ? (
                          <img
                            src={logo}
                            alt={p.team}
                            className="h-[22px] w-[22px] object-contain mx-auto"
                            draggable={false}
                          />
                        ) : (
                          <span className="text-neutral-500">-</span>
                        )}
                      </td>

                      <td className="py-2 px-3">{p.pos}</td>

                      <td className="py-2 px-3">
                        <span>{p.age}</span>
                        <DeltaBadge d={deltaFor(p, "age")} />
                      </td>

                      {["overall", "offRating", "defRating", "stamina"].map((k) => (
                        <td key={k} className="py-2 px-3" onDoubleClick={handleCellDoubleClick}>
                          <span>{showLetters ? toLetter(p[k]) : p[k]}</span>
                          <DeltaBadge d={deltaFor(p, k)} />
                        </td>
                      ))}

                      <td className="py-2 px-3" onDoubleClick={handleCellDoubleClick}>
                        {showLetters ? toLetter(p.potential) : p.potential}
                      </td>

                      {attrColumns.map((a) => {
                        const val = p.attrs?.[a.index] ?? 0;
                        const d = deltaFor(p, a.key);
                        return (
                          <td key={a.key} className="py-2 px-3" onDoubleClick={handleCellDoubleClick}>
                            <span>{showLetters ? toLetter(val) : val}</span>
                            <DeltaBadge d={d} />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="text-xs text-neutral-400 mt-3">
              ▲/▼ shows change from last season. Double-click any rating cell to toggle numbers/letters.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
