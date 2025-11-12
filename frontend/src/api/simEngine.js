// frontend/src/api/simEngine.js
/* eslint-disable no-plusplus */

// ------------------------ small utils ------------------------
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const rand = Math.random;
const gauss = (mu = 0, sigma = 1) => {
  // Box–Muller
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return mu + sigma * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
};
const poisson = (lambda) => {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  while (p > L) { k++; p *= rand(); }
  return Math.max(0, k - 1);
};
const binom = (n, p) => {
  n = Math.max(0, Math.floor(n));
  p = clamp(p, 0, 1);
  let k = 0;
  for (let i = 0; i < n; i++) if (rand() < p) k++;
  return k;
};

// ------------------------ minutes helpers ------------------------
function buildSmartRotation(teamPlayers = []) {
  const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
  const valid = teamPlayers.filter(p => p && p.name && Number.isFinite(p.overall));
  if (!valid.length) return { players: [], minutes: {} };

  const score = (p) => (p.overall || 0) + ((p.stamina || 70) - 70) * 0.15;

  const used = new Set();
  const chosen = [];

  // pick best by position
  for (const pos of POSITIONS) {
    const pool = valid
      .filter(p => !used.has(p.name) && (p.pos === pos || p.secondaryPos === pos))
      .sort((a, b) => score(b) - score(a));
    if (pool.length) { chosen.push(pool[0]); used.add(pool[0].name); }
  }
  // fill up to ~10
  for (const p of [...valid].sort((a, b) => score(b) - score(a))) {
    if (chosen.length >= Math.min(10, valid.length)) break;
    if (!used.has(p.name)) { chosen.push(p); used.add(p.name); }
  }

  // baseline minutes
  const mins = {};
  for (const p of chosen) mins[p.name] = 12;
  let remain = 240 - 12 * chosen.length;
  let i = 0;
  while (remain > 0 && chosen.length > 0) {
    mins[chosen[i % chosen.length].name] += 1;
    i++; remain--;
  }
  return {
    players: chosen,
    minutes: mins
  };
}

function loadMinutesForTeam(team) {
  const key = `gameplan_${team.name}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return buildSmartRotation(team.players).minutes;
}

// ------------------------ team rating (Python parity) ------------------------
const TR_GAIN = 1.30;
const TR_STAR_REF = 84.0;
const TR_STAR_SCALE = 1.00;
const TR_STAR_EXP_OVR = 1.22;
const TR_STAR_EXP_OFF = 1.20;
const TR_STAR_EXP_DEF = 1.20;
const TR_STAR_SHARE_EXP = 0.45;
const TR_STAR_OUT_EXP = 0.85;
const TR_COV_ALPHA = 15.0;
const TR_OVERPOS_MAXPT = 6.0;
const TR_EMPTY_MIN_PTS = 35.0;
const TR_FATIGUE_FLOOR = 0.68;
const TR_FATIGUE_K = 0.010;

const fatigueThreshold = (sta) => 0.359 * (sta ?? 75) + 2.46;
const fatiguePenalty = (mins, sta) => {
  const over = Math.max(0, (mins || 0) - fatigueThreshold(sta));
  return Math.max(TR_FATIGUE_FLOOR, 1 - TR_FATIGUE_K * over);
};

function minutesWeighted(team, minsObj) {
  const posMin = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
  const roster = [];
  let total = 0;

  (team.players || []).forEach(p => {
    const m = Math.max(0, +(minsObj?.[p.name] || 0));
    if (m <= 0) return;
    total += m;
    if (p.pos && posMin[p.pos] != null) posMin[p.pos] += m;
    if (p.secondaryPos && posMin[p.secondaryPos] != null) posMin[p.secondaryPos] += m * 0.20;
    roster.push({
      name: p.name,
      minutes: m,
      stamina: p.stamina ?? 75,
      overall: p.overall ?? 75,
      offRating: p.offRating ?? 75,
      defRating: p.defRating ?? 75,
      pos: p.pos || "SG",
      secondaryPos: p.secondaryPos || null,
      attrs: Array.isArray(p.attrs) ? p.attrs : null
    });
  });

  return { roster, posMin, total };
}

function aggWithFatigue(roster, key) {
  if (!roster.length) return { wavg: 0, effList: [] };
  const effList = roster.map(p => {
    const pen = fatiguePenalty(p.minutes, p.stamina);
    return { eff: (p[key] ?? 75) * pen, p };
  });
  const wavg = effList.reduce((a, e) => a + (e.p.minutes / 240) * e.eff, 0);
  return { wavg, effList };
}

function starBoost(effList, starExp, ref = TR_STAR_REF) {
  if (!effList.length) return 0;
  const top2 = [...effList].sort((a, b) => b.eff - a.eff).slice(0, 2);
  let pull = 0;
  for (const { p } of top2) {
    const base = p.overall ?? p.offRating ?? p.defRating ?? 75;
    const gap = Math.max(0, base - ref);
    if (gap <= 0) continue;
    const share = Math.max(0, p.minutes / 240) ** TR_STAR_SHARE_EXP;
    pull += (gap ** starExp) * share;
  }
  return TR_STAR_SCALE * (pull ** TR_STAR_OUT_EXP);
}

function coveragePenaltyPts(posMin) {
  const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
  const target = 48;
  const coverageError = POSITIONS.reduce((s, pos) => s + Math.abs((posMin[pos] || 0) - target), 0);
  const covPen = (coverageError / 240) * TR_COV_ALPHA;
  const worstOver = Math.max(0, Math.max(...POSITIONS.map(pos => (posMin[pos] || 0) - target)));
  const overPen = (worstOver / 192) * TR_OVERPOS_MAXPT;
  return covPen + overPen;
}

const scaleRange = (raw) => clamp((raw - 75) * TR_GAIN + 75, 25, 99);

function computeTeamRatings(team, minsObj) {
  const { roster, posMin, total } = minutesWeighted(team, minsObj);
  if (!total) return { overall: 0, off: 0, def: 0, rosterOut: roster };

  const { wavg: baseOvr, effList: effOvr } = aggWithFatigue(roster, "overall");
  const { wavg: baseOff, effList: effOff } = aggWithFatigue(roster, "offRating");
  const { wavg: baseDef, effList: effDef } = aggWithFatigue(roster, "defRating");

  const sOvr = starBoost(effOvr, TR_STAR_EXP_OVR);
  const sOff = starBoost(effOff, TR_STAR_EXP_OFF);
  const sDef = starBoost(effDef, TR_STAR_EXP_DEF);

  const cov = coveragePenaltyPts(posMin);

  let emptyPen = 0;
  if (total < 240) {
    const emptyFrac = (240 - total) / 240;
    emptyPen = TR_EMPTY_MIN_PTS * (emptyFrac ** 0.85);
  }

  const rawOff = baseOff + sOff - cov - emptyPen;
  const rawDef = baseDef + sDef - cov - emptyPen;
  const rawOvr = baseOvr + sOvr - cov - emptyPen;

  return {
    overall: Math.round(scaleRange(rawOvr)),
    off: Math.round(scaleRange(rawOff)),
    def: Math.round(scaleRange(rawDef)),
    rosterOut: roster
  };
}

// ------------------------ league means for attributes ------------------------
function leaguePlayers(leagueData) {
  return Object.values(leagueData.conferences || {}).flat().flatMap(t => t.players || []);
}
function leagueAttrMeans(leagueData) {
  const ps = leaguePlayers(leagueData);
  let sums = { three: 0, pass: 0, reb: 0, stl: 0, blk: 0, offiq: 0, defiq: 0, overall: 0 }, cnt = 0;
  for (const p of ps) {
    const a = Array.isArray(p.attrs) ? p.attrs : new Array(15).fill(70);
    sums.three += a[2]; sums.pass += a[5]; sums.reb += a[12]; sums.stl += a[11]; sums.blk += a[10];
    sums.offiq += a[13]; sums.defiq += a[14]; sums.overall += (p.overall ?? 75); cnt++;
  }
  const div = (x) => (cnt ? x / cnt : 75);
  return {
    three: div(sums.three), pass: div(sums.pass), reb: div(sums.reb), stl: div(sums.stl),
    blk: div(sums.blk), offiq: div(sums.offiq), defiq: div(sums.defiq), overall: div(sums.overall)
  };
}

// ------------------------ scoreboard model (Python parity) ------------------------
const OFF_MEAN = 80.0, DEF_MEAN = 80.0;
const BASE_O = 112.7272727273;
const OFF_COEF = 17.0 / 33.0;  // ≈0.515
const DEF_COEF = 16.0 / 33.0;  // ≈0.485
const DEF_BIAS = 1.0;

const PACE_A = 0.0042, PACE_D = 0.0032;
const PACE_CLAMP = [0.92, 1.08];

const sigmaMarginForDelta = (d) => Math.max(7.0, Math.min(13.0, 13.0 - 0.25 * Math.abs(d)));
const sigmaTotalForDelta = (d) => Math.max(10.0, Math.min(16.0, 16.0 - 0.10 * Math.abs(d)));
const MARG_PER_OVR = 0.8416 * 7.0 / 24.0; // ≈0.2455

const expectedPointsFor = (off, oppDef) =>
  BASE_O + OFF_COEF * (off - OFF_MEAN) - DEF_COEF * (oppDef - DEF_MEAN) + DEF_BIAS;

const paceMultiplier = (offA, defA, offB, defB) => {
  const tempo = PACE_A * ((offA - OFF_MEAN) + (offB - OFF_MEAN))
              - PACE_D * ((defA - DEF_MEAN) + (defB - DEF_MEAN));
  return clamp(1 + tempo, PACE_CLAMP[0], PACE_CLAMP[1]);
};

// ------------------------ box score generator ------------------------
function sampleMultinomial(total, weights) {
  const out = new Array(weights.length).fill(0);
  const s = weights.reduce((a, b) => a + b, 0);
  if (s <= 0) { for (let i = 0; i < total; i++) out[Math.floor(rand() * weights.length)]++; return out; }
  const cum = []; let acc = 0;
  for (const w of weights) { acc += w; cum.push(acc); }
  for (let k = 0; k < total; k++) {
    const r = rand() * s;
    const j = cum.findIndex(t => r <= t);
    out[j < 0 ? weights.length - 1 : j] += 1;
  }
  return out;
}

function buildBox({ team, minsObj, teamPoints, teamRatings, leagueData, numOT }) {
  const full = [...(team.players || [])];
  const active = full
    .map(p => ({ ...p, minutes: Math.max(0, +(minsObj[p.name] || 0)) }))
    .filter(p => p.minutes > 0);
  const benchZero = full.filter(p => (+(minsObj[p.name] || 0)) <= 0);

  // minute reconciliation (48 + 5/OT cap; team total = 240 + 25*OT)
  const gameTarget = 240 + 25 * Math.max(0, numOT || 0);
  const maxPer = 48 + 5 * Math.max(0, numOT || 0);
  if (active.length) {
    const tweaked = active.map(p => {
      const base = Math.round(p.minutes);
      const delta = gauss(0, p.minutes < 18 ? 1.1 : 0.9);
      return clamp(Math.round(base + delta), 1, maxPer);
    });
    let cur = tweaked.reduce((a, b) => a + b, 0);
    const starW = active.map(p => (Math.max(1, p.offRating || 75) ** 1.15) * Math.max(1, p.minutes));
    const up = [...starW.keys()].sort((i, j) => starW[j] - starW[i]);
    const dn = [...up].reverse();
    let guard = 0;
    while (cur !== gameTarget && guard < 2000) {
      if (cur < gameTarget) {
        for (const i of up) { if (tweaked[i] < maxPer) { tweaked[i]++; cur++; if (cur === gameTarget) break; } }
      } else {
        for (const i of dn) { if (tweaked[i] > 1) { tweaked[i]--; cur--; if (cur === gameTarget) break; } }
      }
      guard++;
    }
    active.forEach((p, i) => { p.minutes = tweaked[i]; });
  } else {
    return full.map(p => ({
      player: p.name, min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0,
      fg: "0/0", "3p": "0/0", ft: "0/0", to: 0, pf: 0
    }));
  }

  active.forEach(p => { if (!Array.isArray(p.attrs)) p.attrs = new Array(15).fill(70); });
  const L = leagueAttrMeans(leagueData);

  const totMin = active.reduce((a, p) => a + p.minutes, 0) || 1;
  const wmean = (idx) => active.reduce((a, p) => a + p.attrs[idx] * p.minutes, 0) / totMin;
  const tm = {
    three: wmean(2), pass: wmean(5), reb: wmean(12), stl: wmean(11), blk: wmean(10),
    offiq: wmean(13), defiq: wmean(14),
    overall: active.reduce((a, p) => a + (p.overall || 75) * p.minutes, 0) / totMin
  };
  const bigShare = active.reduce((a, p) => a + (/(PF|C)/.test(p.pos) ? p.minutes : 0), 0) / totMin;
  const leagueBigShare = 0.40;
  const rel = (x, m) => (x - m) / 10.0;

  const off = teamRatings.off || 75;
  const paceAdj = clamp(1 + (off - 75) * 0.002 + gauss(0, 0.02), 0.95, 1.05);
  const fgaMult = clamp(1 + 0.04 * rel(tm.overall, L.overall)
    + 0.02 * rel(tm.three, L.three) + gauss(0, 0.045), 0.88, 1.12);
  const threeMult = clamp(1 + 0.22 * rel(tm.three, L.three)
    - 0.04 * (bigShare - leagueBigShare) + gauss(0, 0.06), 0.75, 1.35);
  const driveProp = (-0.50 * rel(tm.three, L.three)
    + 0.25 * rel(tm.offiq, L.offiq) + 0.15 * rel(tm.overall, L.overall));
  const ftaMult = clamp(1 + 0.20 * driveProp + gauss(0, 0.07), 0.75, 1.35);
  const toMult = clamp(1 + 0.25 * rel(L.offiq, tm.offiq)
    + 0.10 * rel(L.overall, tm.overall) + gauss(0, 0.07), 0.75, 1.40);
  const pfMult = clamp(1 + 0.22 * rel(L.defiq, tm.defiq)
    + 0.12 * (bigShare - leagueBigShare) + gauss(0, 0.06), 0.75, 1.40);
  const rebMult = clamp(1 + 0.25 * rel(tm.reb, L.reb)
    + 0.10 * (bigShare - leagueBigShare) + gauss(0, 0.05), 0.85, 1.25);
  const astMult = clamp(1 + 0.25 * rel(tm.pass, L.pass)
    + 0.08 * rel(tm.offiq, L.offiq) + gauss(0, 0.06), 0.80, 1.25);
  const stlMult = clamp(1 + 0.25 * rel(tm.stl, L.stl) + gauss(0, 0.08), 0.70, 1.40);
  const blkMult = clamp(1 + 0.28 * rel(tm.blk, L.blk)
    + 0.12 * (bigShare - leagueBigShare) + gauss(0, 0.08), 0.70, 1.50);

  const BASE = {
    REB: 44.1, AST: 26.5, STL: 8.2, BLK: 4.9,
    FGA: 89.2, "3PA": 37.6, FTA: 21.7, TO: 14.3, PF: 20.8
  };
  let teamFGA = Math.round(BASE.FGA * paceAdj * fgaMult);
  let team3PA = Math.round(BASE["3PA"] * threeMult);
  team3PA = clamp(team3PA, Math.floor(teamFGA * 0.20), Math.floor(teamFGA * 0.52));
  teamFGA = Math.max(teamFGA, team3PA + 5);

  // usage → FGA
  const teamOffMean = active.reduce((a, p) => a + (p.offRating || 75) * p.minutes, 0) / (totMin || 1);
  let baseW = active.map(p => {
    const relStar = 1 + 0.015 * ((p.offRating || 75) - teamOffMean);
    return (Math.max(1, p.offRating || 75) ** 1.2) * Math.max(1, p.minutes) * Math.max(0.5, relStar);
  });
  const prelimP = baseW.map(w => w / (baseW.reduce((a, b) => a + b, 0) || 1));
  const prelimTop = [...prelimP.keys()].sort((i, j) => prelimP[j] - prelimP[i]).slice(0, 3);
  prelimTop.forEach((i, rank) => {
    if (rand() < [0.14, 0.09, 0.06][rank]) baseW[i] *= (1.5 + rand() * 0.7);
    else if (rand() < 0.08) baseW[i] *= (0.5 + rand() * 0.25);
  });
  baseW = baseW.map((w, i) => w * Math.exp(gauss(0, active[i].minutes < 18 ? 0.35 : 0.18)));
  const pUsage = baseW.map(w => w / (baseW.reduce((a, b) => a + b, 0) || 1));
  const fga = sampleMultinomial(teamFGA, pUsage);

  // 3PA targets & balancing
  const LOW_3PT_HARD_CAP = 50;
  const posBasePer36 = (pos) => /PG/.test(pos) ? 7.5 : /SG/.test(pos) ? 7.0 : /SF/.test(pos) ? 6.2 : /PF/.test(pos) ? 4.2 : 2.2;
  const per36_3pa_target = (p) => {
    if ((p.attrs?.[2] ?? 70) < LOW_3PT_HARD_CAP) return 0;
    const three = p.attrs[2], offiq = p.attrs[13];
    const base = posBasePer36(p.pos || "");
    const bump = 0.18 * (three - L.three) + 0.06 * (offiq - L.offiq);
    return clamp(base + bump, 1.2, 11.8);
  };
  const target3 = active.map(p => {
    const mu36 = per36_3pa_target(p);
    const vol = Math.exp(gauss(0, p.minutes < 22 ? 0.22 : 0.14));
    return mu36 * vol * (p.minutes / 36);
  });

  let threeAtt = active.map((p, i) => {
    if ((p.attrs?.[2] ?? 70) < LOW_3PT_HARD_CAP) return 0;
    const three = p.attrs[2], offIQ = p.attrs[13];
    let share = 0.26 + 0.003 * (three - L.three) + 0.0010 * (offIQ - L.offiq);
    if (/(PF|C)/.test(p.pos || "") && three >= 88) share += 0.06;
    if (three < 65) share = clamp(share, 0.10, 0.22);
    else if (three < 80) share = clamp(share, 0.12, 0.35);
    else share = clamp(share, 0.14, 0.55);
    let att = 0;
    for (let k = 0; k < fga[i]; k++) if (rand() < share) att++;
    const blend = clamp(0.35 + rand() * 0.30, 0.35, 0.65);
    att = Math.round(blend * att + (1 - blend) * target3[i] + (rand() * 2 - 1));
    return clamp(att, 0, fga[i]);
  });
  // force to team 3PA
  let need = team3PA - threeAtt.reduce((a, b) => a + b, 0);
  const eligible = [...active.keys()].filter(j => active[j].attrs[2] >= LOW_3PT_HARD_CAP);
  const per36Gap = (j) => per36_3pa_target(active[j]) - (threeAtt[j] / Math.max(1, active[j].minutes)) * 36;
  if (need !== 0 && eligible.length) {
    const order = eligible.sort((j, k) => per36Gap(k) - per36Gap(j) * (need > 0 ? 1 : -1));
    for (const j of order) {
      if (need === 0) break;
      const room = need > 0 ? (fga[j] - threeAtt[j]) : threeAtt[j];
      if (room <= 0) continue;
      const delta = Math.min(Math.abs(need), Math.max(1, Math.floor(room / 2)));
      threeAtt[j] += need > 0 ? delta : -delta;
      need += need > 0 ? -delta : +delta;
    }
  }
  threeAtt = threeAtt.map((a, i) => (active[i].attrs[2] < LOW_3PT_HARD_CAP ? 0 : a));
  const twoAtt = active.map((_, i) => Math.max(0, fga[i] - threeAtt[i]));
  twoAtt.forEach((v, i) => { if (v < (fga[i] >= 6 ? 1 : 0) && threeAtt[i] >= 1) { twoAtt[i]++; threeAtt[i]--; } });

  // FT allocation (pairs + singles), with per-minute caps
  const top3 = [...pUsage.keys()].sort((i, j) => pUsage[j] - pUsage[i]).slice(0, 3);
  const starBoostArr = pUsage.map((_, i) => (top3.includes(i) ? 1.15 : 0.95));
  const ftWeights = active.map((p, i) => {
    const offIQ = p.attrs[13], ftSkill = p.attrs[3];
    const share3 = fga[i] > 0 ? threeAtt[i] / fga[i] : 0;
    const drive = 1 - share3;
    const orFac = ((p.offRating || 75) / 75) ** 0.7;
    const ftFac = (Math.max(50, ftSkill) / 75) ** 0.6;
    let w = pUsage[i] * drive * (0.9 + 0.004 * (offIQ - L.offiq))
      * starBoostArr[i] * orFac * ftFac;
    if (p.minutes < 15) w *= (0.7 + rand() * 0.7);
    return Math.max(0.0001, w) ** 0.85;
  });

  const pairs = sampleMultinomial(Math.max(0, Math.floor((21.7 * (1)) / 2)), ftWeights); // base; will scale later
  let fta = pairs.map(c => 2 * c);
  const teamFTA = Math.round(21.7 * (1) * clamp(1 + 0.20 * (-0.50 * ((tm.three - L.three) / 10) + 0.25 * ((tm.offiq - L.offiq) / 10) + 0.15 * ((tm.overall - L.overall) / 10)) + gauss(0, 0.07), 0.75, 1.35));
  let leftoverSingles = teamFTA - fta.reduce((a, b) => a + b, 0);
  if (leftoverSingles > 0) {
    const order = [...active.keys()].sort((j, k) =>
      (ftWeights[k] - ftWeights[j]) || (pUsage[k] - pUsage[j]));
    for (const j of order) { if (!leftoverSingles) break; fta[j]++; leftoverSingles--; }
  }

  const perMinCap = active.map((p, i) => {
    let cap = Math.round((p.minutes / 36) * (4.5 + 0.03 * ((p.offRating || 75) - 75)));
    if (top3.includes(i)) cap += 1;
    cap += [0, 0, 1][Math.floor(rand() * 3)];
    return Math.max(0, cap);
  });
  let overflow = 0;
  for (let i = 0; i < fta.length; i++) {
    if (fta[i] > perMinCap[i]) { overflow += fta[i] - perMinCap[i]; fta[i] = perMinCap[i]; }
  }
  if (overflow > 0) {
    const order = [...active.keys()].sort((j, k) =>
      (ftWeights[k] - ftWeights[j]) || ((perMinCap[k] - fta[k]) - (perMinCap[j] - fta[j])));
    for (const j of order) {
      if (!overflow) break;
      const room = Math.max(0, perMinCap[j] - fta[j]);
      const add = Math.min(room, overflow);
      if (add > 0) { fta[j] += add; overflow -= add; }
    }
  }

  // shooting percentages + luck/form
  const pctTwoFor = (p) => {
    const mid = p.attrs[1], offIQ = p.attrs[13];
    const base = /C/.test(p.pos) ? 0.59 : /PF/.test(p.pos) ? 0.55 : /SF/.test(p.pos) ? 0.53 : /SG/.test(p.pos) ? 0.52 : 0.51;
    const pct = base + 0.0020 * (mid - 67) + 0.0015 * (offIQ - L.offiq);
    return clamp(pct, base - 0.08, base + 0.09);
  };
  const pctThreeFor = (p) => clamp(0.35 + 0.0060 * (p.attrs[2] - L.three)
    + 0.0012 * (p.attrs[13] - L.offiq), 0.28, 0.48);
  const pctFTFor = (p) => clamp(0.80 + 0.0035 * ((p.attrs[3] ?? 70) - 70), 0.74, 0.97);

  const form = active.map((p, i) => clamp(gauss(1.0, top3.includes(i) ? 0.12 : 0.08), 0.85, 1.20));
  const luck2 = form.map(f => clamp(gauss(f, 0.05), 0.90, 1.15));
  const luck3 = form.map(f => clamp(gauss(f, 0.07), 0.88, 1.18));
  const luckFT = active.map(() => clamp(gauss(1.0, 0.02), 0.96, 1.06));

  let twoMade = active.map((p, i) => binom(twoAtt[i], clamp(pctTwoFor(p) * luck2[i], 0.25, 0.75)));
  let threeMade = active.map((p, i) => binom(threeAtt[i], clamp(pctThreeFor(p) * luck3[i], 0.20, 0.70)));
  let ftMade = active.map((p, i) => binom(fta[i], clamp(pctFTFor(p) * luckFT[i], 0.70, 0.99)));

  // peripherals
  const minFactor = (p) => (p.minutes / 36) ** 0.90;
  const rebW = active.map((p) => Math.max(0.1, (p.attrs[12] || 70) / 80) * minFactor(p));
  const madeFG = active.map((_, i) => twoMade[i] + threeMade[i]);
  const totalMadeFG = madeFG.reduce((a, b) => a + b, 0) || 1;
  const posBonus = active.map(p => (/PG/.test(p.pos) ? 1.25 : /SG/.test(p.pos) ? 1.10 : /SF/.test(p.pos) ? 1.00 : /PF/.test(p.pos) ? 0.85 : 0.70));
  const creationScore = active.map((p, i) =>
    0.90 * (p.attrs[5] || 70) + 0.60 * (p.attrs[13] || 70) + 0.25 * ((p.offRating || 75) - tm.overall) + 20 * pUsage[i]
  );
  const creators = [...creationScore.keys()].sort((i, j) => creationScore[j] - creationScore[i]).slice(0, 3);
  const astW = active.map((p, i) => {
    let w = ((Math.max(1, p.attrs[5] || 70) / 75) ** 1.25) * (0.55 + 1.25 * pUsage[i])
      * (1 + 0.25 * (madeFG[i] / totalMadeFG)) * ((Math.max(55, p.attrs[13] || 70) / 75) ** 0.90)
      * posBonus[i] * minFactor(p);
    const vol = creators[0] === i ? 0.30 : creators.slice(0, 2).includes(i) ? 0.24 : 0.18;
    w *= Math.exp(gauss(0, vol));
    return Math.max(0.05, w);
  });
  const stlW = active.map((p) => Math.max(0.1, (p.attrs[11] || 70) / 85) * minFactor(p));
  const blkW = active.map((p) => Math.max(0.1, (p.attrs[10] || 70) / 85) * minFactor(p));

  const apportion = (total, weights, rnd = [0.78, 1.22], floor0 = true) => {
    const s = weights.reduce((a, b) => a + b, 0) || 1;
    const vals = weights.map(w => Math.round(total * (w / s) * (rnd[0] + rand() * (rnd[1] - rnd[0]))));
    const sum = () => vals.reduce((a, b) => a + b, 0);
    let guard = 0;
    while (sum() !== total && guard++ < 400) {
      const d = total - sum();
      if (d > 0) {
        const i = weights.indexOf(Math.max(...weights));
        vals[i]++;
      } else {
        let i = vals.indexOf(Math.max(...vals));
        if (vals[i] > (floor0 ? 0 : 1)) vals[i]--;
        else {
          const j = vals.findIndex(v => v > (floor0 ? 0 : 1));
          if (j === -1) break;
          vals[j]--;
        }
      }
    }
    return vals;
  };

  const teamREB = Math.round(44.1 * paceAdj * rebMult);
  const teamAST = Math.round(26.5 * paceAdj * astMult);
  const teamSTL = Math.round(8.2 * stlMult);
  const teamBLK = Math.round(4.9 * blkMult);

  const rebs = apportion(teamREB, rebW);
  const asts = apportion(teamAST, astW, [0.70, 1.35]);
  const stls = apportion(teamSTL, stlW);
  const blks = apportion(teamBLK, blkW);

  // turnovers (Poisson, capped, reconciled to team total)
  const teamTO = Math.round(14.3 * toMult);
  const touches = active.map((_, i) => fga[i] + 0.44 * fta[i] + 0.30 * asts[i]);
  const lam = active.map((p, i) => {
    const offIQ = p.attrs[13] || 70, overall = p.overall || 75, pos = p.pos || "";
    const guardFac = /(G)/.test(pos) ? 1.15 : 0.90;
    const iqPen = 1 + Math.max(0, L.offiq - offIQ) * (/(G)/.test(pos) ? 0.015 : 0.008);
    const ovPen = 1 + Math.max(0, L.overall - overall) * 0.008;
    return clamp(guardFac * iqPen * ovPen * (touches[i] / 8.0), 0.05, 5.0);
  });
  let tos = lam.map(poisson);
  const capsTo = active.map((_, i) => Math.min(Math.ceil(0.40 * touches[i]), 8 + (top3.includes(i) ? 3 : 0)));
  let over = 0;
  tos = tos.map((v, i) => { if (v > capsTo[i]) { over += v - capsTo[i]; return capsTo[i]; } return v; });
  if (over > 0) {
    const order = [...active.keys()].sort((j, k) => lam[k] - lam[j]);
    for (const j of order) {
      if (!over) break;
      const room = Math.max(0, capsTo[j] - tos[j]);
      const add = Math.min(room, over);
      if (add > 0) { tos[j] += add; over -= add; }
    }
  }
  let diffTo = teamTO - tos.reduce((a, b) => a + b, 0);
  const ordUp = [...active.keys()].sort((j, k) => lam[k] - lam[j]);
  const ordDn = [...active.keys()].sort((j, k) => tos[k] - tos[j]);
  let guardTO = 0;
  while (diffTo !== 0 && guardTO++ < 300) {
    if (diffTo > 0) { tos[ordUp[0]]++; diffTo--; } else {
      for (const i of ordDn) { if (tos[i] > 0) { tos[i]--; diffTo++; break; } }
    }
  }

  // personal fouls (cap 6) → team total
  const teamPF = Math.round(20.8 * pfMult);
  const pfLam = active.map(p => {
    const defIQ = p.attrs[14] || 70; const big = /(PF|C)/.test(p.pos || "");
    const posFac = big ? 1.20 : 0.90;
    const iqPen = 1 + Math.max(0, L.defiq - defIQ) * (big ? 0.020 : 0.010);
    return clamp(posFac * iqPen * (p.minutes / 36) * 2.8, 0.05, 4.5);
  });
  let pfs = pfLam.map(poisson).map(x => Math.min(6, x));
  let diffPF = teamPF - pfs.reduce((a, b) => a + b, 0);
  const ordPFUp = [...active.keys()].sort((j, k) => pfLam[k] - pfLam[j]);
  const ordPFDn = [...active.keys()].sort((j, k) => pfs[k] - pfs[j]);
  let guardPF = 0;
  while (diffPF !== 0 && guardPF++ < 400) {
    if (diffPF > 0) {
      for (const i of ordPFUp) { if (pfs[i] < 6) { pfs[i]++; diffPF--; break; } }
    } else {
      for (const i of ordPFDn) { if (pfs[i] > 0) { pfs[i]--; diffPF++; break; } }
    }
  }

  // force team points to match scoreboard target (prefer FG tweaks)
  const totalPts = (tw, th, ft) => 2 * tw.reduce((a, b) => a + b, 0)
    + 3 * th.reduce((a, b) => a + b, 0) + ft.reduce((a, b) => a + b, 0);
  let P0 = totalPts(twoMade, threeMade, ftMade) || 1;
  const target = Math.round(teamPoints);
  if (P0 !== target) {
    const f = clamp(target / P0, 0.85, 1.15);
    twoMade = twoMade.map((m, i) => clamp(Math.round(m * f), 0, twoAtt[i]));
    threeMade = threeMade.map((m, i) => clamp(Math.round(m * f), 0, threeAtt[i]));
    ftMade = ftMade.map((m, i) => clamp(Math.round(m * (0.85 * f + 0.15)), 0, fta[i]));

    const bumpUp = () => {
      for (const i of [...top3, ...active.keys()].filter((v, i, a) => a.indexOf(v) === i)) {
        if (threeMade[i] < threeAtt[i]) { threeMade[i]++; return 3; }
      }
      for (const i of [...top3, ...active.keys()]) {
        if (twoMade[i] < twoAtt[i]) { twoMade[i]++; return 2; }
      }
      for (const i of [...top3, ...active.keys()]) {
        if (ftMade[i] < Math.floor(0.9 * fta[i])) { ftMade[i]++; return 1; }
      }
      return 0;
    };
    const bumpDown = () => {
      for (let i = active.length - 1; i >= 0; i--) if (twoMade[i] > 0) { twoMade[i]--; return 2; }
      for (let i = active.length - 1; i >= 0; i--) if (threeMade[i] > 0) { threeMade[i]--; return 3; }
      for (let i = active.length - 1; i >= 0; i--) if (ftMade[i] > Math.floor(0.6 * fta[i])) { ftMade[i]--; return 1; }
      return 0;
    };

    let guard = 0;
    while (totalPts(twoMade, threeMade, ftMade) !== target && guard++ < 450) {
      const cur = totalPts(twoMade, threeMade, ftMade);
      if (cur < target) { if (!bumpUp()) break; } else { if (!bumpDown()) break; }
    }
  }

  const rows = active.map((p, i) => {
    const fgm = twoMade[i] + threeMade[i];
    const fgaI = twoAtt[i] + threeAtt[i];
    const pts = 2 * twoMade[i] + 3 * threeMade[i] + ftMade[i];
    return {
      player: p.name, min: Math.round(p.minutes), pts,
      reb: rebs[i], ast: asts[i], stl: stls[i], blk: blks[i],
      fg: `${fgm}/${fgaI}`, "3p": `${threeMade[i]}/${threeAtt[i]}`, ft: `${ftMade[i]}/${fta[i]}`,
      to: tos[i], pf: pfs[i]
    };
  });

  benchZero.forEach(p => rows.push({
    player: p.name, min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0,
    fg: "0/0", "3p": "0/0", ft: "0/0", to: 0, pf: 0
  }));

  return rows;
}

// ------------------------ public: simulate one game ------------------------
export function simulateOneGame({ leagueData, homeTeamName, awayTeamName }) {
  if (!leagueData) throw new Error("leagueData required");
  const allTeams = Object.values(leagueData.conferences || {}).flat();
  const H = allTeams.find(t => t.name === homeTeamName);
  const A = allTeams.find(t => t.name === awayTeamName);
  if (!H || !A) throw new Error("Team not found.");

  const minutesH = loadMinutesForTeam(H);
  const minutesA = loadMinutesForTeam(A);

  // ratings used for scoreboard and boxscore shaping
  const rateH = computeTeamRatings(H, minutesH);
  const rateA = computeTeamRatings(A, minutesA);

  // OVERALL → margin; OFF/DEF (+pace) → totals
  const dOvr = rateH.overall - rateA.overall;
  const sigM = sigmaMarginForDelta(dOvr);
  const sigT = sigmaTotalForDelta(dOvr);
  const marginMean = MARG_PER_OVR * dOvr;

  const baseHome = expectedPointsFor(rateH.off, rateA.def);
  const baseAway = expectedPointsFor(rateA.off, rateH.def);
  const pace = paceMultiplier(rateH.off, rateH.def, rateA.off, rateA.def);
  const muHome = baseHome * pace;
  const muAway = baseAway * pace;
  const totalMean = muHome + muAway;

  const sampledTotal = gauss(totalMean, sigT);
  const sampledMargin = gauss(marginMean, sigM);
  let hs = Math.round((sampledTotal + sampledMargin) / 2);
  let as = Math.round(sampledTotal - hs);
  hs = clamp(hs, 85, 155);
  as = clamp(as, 85, 155);

  // quarter split + unlimited OT (aggregate OT points)
  const qsplit = (total) => {
    const w = [rand() * 0.06 + 0.22, rand() * 0.06 + 0.22, rand() * 0.06 + 0.22, rand() * 0.06 + 0.22];
    const sc = total / w.reduce((a, b) => a + b, 0);
    const pts = w.map(x => Math.floor(x * sc));
    pts[3] += total - pts.reduce((a, b) => a + b, 0);
    return pts;
  };
  const hQ = qsplit(hs), aQ = qsplit(as);
  let otHome = 0, otAway = 0, otCount = 0;
  while (hQ.slice(0, 4).reduce((a, b) => a + b, 0) + otHome ===
         aQ.slice(0, 4).reduce((a, b) => a + b, 0) + otAway) {
    const hOT = Math.floor(gauss(12, 3));
    const aOT = Math.floor(gauss(12, 3));
    otHome += clamp(hOT, 6, 22);
    otAway += clamp(aOT, 6, 22);
    otCount++;
  }
  const finalHome = hQ.reduce((a, b) => a + b, 0) + otHome;
  const finalAway = aQ.reduce((a, b) => a + b, 0) + otAway;

  const homeBox = buildBox({ team: H, minsObj: { ...minutesH }, teamPoints: finalHome, teamRatings: rateH, leagueData, numOT: otCount });
  const awayBox = buildBox({ team: A, minsObj: { ...minutesA }, teamPoints: finalAway, teamRatings: rateA, leagueData, numOT: otCount });

  const winnerSide = finalHome > finalAway ? "home" : "away";
  const winnerScore = winnerSide === "home" ? `${finalHome}-${finalAway}` : `${finalAway}-${finalHome}`;

  return {
    periods: {
      home: hQ.slice(0, 4),
      away: aQ.slice(0, 4),
      otCount,
      otBreakdown: { home: otHome || undefined, away: otAway || undefined }
    },
    totals: { home: finalHome, away: finalAway },
    winner: { side: winnerSide, score: winnerScore, ot: otCount > 0 },
    box: { home: homeBox, away: awayBox },
    ratings: { home: rateH, away: rateA }
  };
}
