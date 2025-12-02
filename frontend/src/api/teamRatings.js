// src/api/teamRatings.js
// Extracted cleanly from your old simEngine.js (NO logic changes)

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

const TR_GAIN = 1.30;
const TR_STAR_REF = 84.0;
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

    if (p.pos) posMin[p.pos] += m;
    if (p.secondaryPos) posMin[p.secondaryPos] += m * 0.20;

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

  const wavg = effList.reduce(
    (acc, e) => acc + (e.p.minutes / 240) * e.eff, 
    0
  );

  return { wavg, effList };
}

function starBoost(effList, starExp) {
  if (!effList.length) return 0;

  const top2 = [...effList].sort((a, b) => b.eff - a.eff).slice(0, 2);
  let pull = 0;

  for (const { p } of top2) {
    const base = p.overall ?? p.offRating ?? p.defRating ?? 75;
    const gap = Math.max(0, base - TR_STAR_REF);
    if (gap <= 0) continue;

    const share = Math.max(0, p.minutes / 240) ** TR_STAR_SHARE_EXP;
    pull += (gap ** starExp) * share;
  }

  return (pull ** TR_STAR_OUT_EXP);
}

function coveragePenaltyPts(posMin) {
  const POS = ["PG", "SG", "SF", "PF", "C"];
  const target = 48;

  const coverageError = POS.reduce(
    (sum, pos) => sum + Math.abs((posMin[pos] || 0) - target),
    0
  );

  const covPen = (coverageError / 240) * TR_COV_ALPHA;

  const worstOver = Math.max(
    0,
    Math.max(...POS.map(pos => (posMin[pos] || 0) - target))
  );

  const overPen = (worstOver / 192) * TR_OVERPOS_MAXPT;

  return covPen + overPen;
}

const scaleRange = (raw) =>
  clamp((raw - 75) * TR_GAIN + 75, 25, 99);

export function computeTeamRatings(team, minsObj) {
  const { roster, posMin, total } = minutesWeighted(team, minsObj);

  if (!total) {
    return { overall: 0, off: 0, def: 0, rosterOut: roster };
  }

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
    rosterOut: roster,
  };
}
