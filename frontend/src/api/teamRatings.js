// src/api/teamRatings.js
// Team rating formula used by Coach Gameplan and rotation optimization.

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

const TR_GAIN_OVR = 1.48;
const TR_GAIN_SIDE = 1.15;
const TR_SCALE_CENTER_RAW_OVR = 84;
const TR_SCALE_CENTER_OUT_OVR = 81;
const TR_SCALE_CENTER_RAW_SIDE = 84;
const TR_SCALE_CENTER_OUT_SIDE = 82;
const TR_STAR_MULT_OVR = 1.0;
const TR_STAR_MULT_OFF = 0.95;
const TR_STAR_MULT_DEF = 0.75;
const TR_STAR_REF = 84.0;
const TR_STAR_EXP_OVR = 1.22;
const TR_STAR_EXP_OFF = 1.20;
const TR_STAR_EXP_DEF = 1.20;
const TR_STAR_SHARE_EXP = 0.45;
const TR_STAR_OUT_EXP = 0.85;
const TR_COV_ALPHA = 9.0;
const TR_OVERPOS_MAXPT = 3.0;
const TR_EMPTY_MIN_PTS = 35.0;
const TR_FATIGUE_FLOOR = 0.68;
const TR_FATIGUE_K = 0.010;
const TR_POS_TARGET = 48;
const TR_SECONDARY_POS_CREDIT = 0.55;
const POSITIONS = ["PG", "SG", "SF", "PF", "C"];

const fatigueThreshold = (sta) => 0.359 * (sta ?? 75) + 2.46;
const fatiguePenalty = (mins, sta) => {
  const over = Math.max(0, (mins || 0) - fatigueThreshold(sta));
  return Math.max(TR_FATIGUE_FLOOR, 1 - TR_FATIGUE_K * over);
};

function applySecondaryFlexCredits(roster, posMin) {
  // Primary position minutes are the real minutes. Secondary position credit is
  // only a flexibility helper: it can fill a shortage, but it can never create
  // extra overage. This prevents PG/SG players from being punished compared to
  // pure PG players when SG is already over the 48-minute target.
  for (const p of roster) {
    const secondary = p.secondaryPos;
    if (!secondary || secondary === p.pos || posMin[secondary] === undefined) {
      continue;
    }

    const shortage = Math.max(0, TR_POS_TARGET - (posMin[secondary] || 0));
    if (shortage <= 0) continue;

    const flexCredit = Math.min(p.minutes * TR_SECONDARY_POS_CREDIT, shortage);
    posMin[secondary] += flexCredit;
  }
}

function minutesWeighted(team, minsObj) {
  const posMin = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
  const roster = [];
  let total = 0;

  (team.players || []).forEach(p => {
    const m = Math.max(0, +(minsObj?.[p.name] || 0));
    if (m <= 0) return;

    total += m;

    const primaryPos = p.pos || "SG";
    const secondaryPos = p.secondaryPos || null;

    if (primaryPos && posMin[primaryPos] !== undefined) {
      posMin[primaryPos] += m;
    }

    roster.push({
      name: p.name,
      minutes: m,
      stamina: p.stamina ?? 75,
      overall: p.overall ?? 75,
      offRating: p.offRating ?? 75,
      defRating: p.defRating ?? 75,
      pos: primaryPos,
      secondaryPos,
      attrs: Array.isArray(p.attrs) ? p.attrs : null
    });
  });

  applySecondaryFlexCredits(roster, posMin);

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

function starBoost(effList, starExp, key = "overall") {
  if (!effList.length) return 0;

  const top2 = [...effList].sort((a, b) => b.eff - a.eff).slice(0, 2);
  let pull = 0;

  for (const { p } of top2) {
    const base =
      key === "offRating"
        ? Number(p.offRating ?? p.overall ?? 75)
        : key === "defRating"
        ? Number(p.defRating ?? p.overall ?? 75)
        : Number(p.overall ?? 75);

    const gap = Math.max(0, base - TR_STAR_REF);
    if (gap <= 0) continue;

    const share = Math.max(0, p.minutes / 240) ** TR_STAR_SHARE_EXP;
    pull += (gap ** starExp) * share;
  }

  return pull ** TR_STAR_OUT_EXP;
}

function coveragePenaltyPts(posMin) {
  const coverageError = POSITIONS.reduce(
    (sum, pos) => sum + Math.abs((posMin[pos] || 0) - TR_POS_TARGET),
    0
  );

  const covPen = (coverageError / 240) * TR_COV_ALPHA;

  const worstOver = Math.max(
    0,
    Math.max(...POSITIONS.map(pos => (posMin[pos] || 0) - TR_POS_TARGET))
  );

  const overPen = (worstOver / 192) * TR_OVERPOS_MAXPT;

  return covPen + overPen;
}

const scaleRange = (raw, kind = "overall") => {
  const gain = kind === "overall" ? TR_GAIN_OVR : TR_GAIN_SIDE;
  const centerRaw = kind === "overall" ? TR_SCALE_CENTER_RAW_OVR : TR_SCALE_CENTER_RAW_SIDE;
  const centerOut = kind === "overall" ? TR_SCALE_CENTER_OUT_OVR : TR_SCALE_CENTER_OUT_SIDE;

  return clamp((raw - centerRaw) * gain + centerOut, 25, 99);
};

export function computeTeamRatings(team, minsObj) {
  const { roster, posMin, total } = minutesWeighted(team, minsObj);

  if (!total) {
    return { overall: 0, off: 0, def: 0, rosterOut: roster };
  }

  const { wavg: baseOvr, effList: effOvr } = aggWithFatigue(roster, "overall");
  const { wavg: baseOff, effList: effOff } = aggWithFatigue(roster, "offRating");
  const { wavg: baseDef, effList: effDef } = aggWithFatigue(roster, "defRating");

  const sOvr = starBoost(effOvr, TR_STAR_EXP_OVR, "overall") * TR_STAR_MULT_OVR;
  const sOff = starBoost(effOff, TR_STAR_EXP_OFF, "offRating") * TR_STAR_MULT_OFF;
  const sDef = starBoost(effDef, TR_STAR_EXP_DEF, "defRating") * TR_STAR_MULT_DEF;

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
    overall: Math.round(scaleRange(rawOvr, "overall")),
    off: Math.round(scaleRange(rawOff, "side")),
    def: Math.round(scaleRange(rawDef, "side")),
    rosterOut: roster,
  };
}
