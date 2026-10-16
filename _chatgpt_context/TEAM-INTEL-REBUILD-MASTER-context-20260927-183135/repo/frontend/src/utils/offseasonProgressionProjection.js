// Deterministic next-season player forecast used only by offseason trade evaluation.
// It does not mutate the saved league or reveal the real progression roll.

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round4 = (value) => Math.round(Number(value || 0) * 10000) / 10000;
const projectionCache = new Map();
const MAX_PROJECTION_CACHE = 3000;

const POS_PARAMS = {
  PG: { weights: [0.11,0.05,0.03,0.05,0.17,0.17,0.10,0.07,0.10,0.02,0.01,0.07,0.05,0.01,0.01], prim: [5,6,1,7], alpha: 0.25 },
  SG: { weights: [0.15,0.08,0.05,0.05,0.12,0.07,0.11,0.07,0.11,0.03,0.02,0.08,0.06,0.01,0.01], prim: [1,5,7], alpha: 0.28 },
  SF: { weights: [0.12,0.09,0.07,0.04,0.08,0.07,0.10,0.10,0.10,0.06,0.04,0.08,0.05,0.01,0.01], prim: [1,8,9], alpha: 0.22 },
  PF: { weights: [0.07,0.07,0.12,0.03,0.05,0.05,0.08,0.12,0.07,0.13,0.08,0.08,0.05,0.01,0.01], prim: [3,10,8], alpha: 0.24 },
  C:  { weights: [0.04,0.06,0.17,0.03,0.02,0.04,0.07,0.12,0.05,0.16,0.13,0.06,0.08,0.01,0.01], prim: [3,10,11,13], alpha: 0.30 },
};

const OFF_ATTRS = [0,1,2,3,4,5,6,7,13];
const DEF_ATTRS = [6,7,8,9,10,11,12,14];
const DECLINE_PRIORITY = [7,6,8,9,10,11,12,4,5,2,1,0,13,14,3];
const GROWTH_PRIORITY_BY_POS = {
  PG: [4,5,0,6,8,1,2,7,11,13,14,3,12,9,10],
  SG: [0,4,1,6,8,2,5,7,11,13,14,3,12,9,10],
  SF: [0,1,2,7,8,6,4,5,11,12,13,14,9,10,3],
  PF: [2,7,9,12,0,1,8,10,6,11,13,14,5,4,3],
  C:  [2,9,10,12,7,6,14,13,11,1,0,5,4,8,3],
};

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizedPos(value) {
  const pos = String(value || "SF").toUpperCase();
  return POS_PARAMS[pos] ? pos : "SF";
}

function padAttrs(attrs = []) {
  const rows = Array.isArray(attrs) ? attrs.slice(0, 15) : [];
  while (rows.length < 15) rows.push(75);
  return rows.map((value) => Math.round(clamp(toNum(value, 75), 25, 99)));
}

const RATING_MIN_OVERALL = 54;
const RATING_MAX_OVERALL = 99;
const OVERALL_SIGMOID_SLOPE = 0.135;
const OVERALL_SIGMOID_MIDPOINT = 77.4;

function sigmoid(value) {
  return 1 / (1 + Math.exp(-OVERALL_SIGMOID_SLOPE * (value - OVERALL_SIGMOID_MIDPOINT)));
}

export function calculateProjectedOverallFromAttrs(attrs = [], position = "SF") {
  const pos = normalizedPos(position);
  const config = POS_PARAMS[pos];
  const values = padAttrs(attrs);
  const weighted = config.weights.reduce((sum, weight, index) => sum + weight * values[index], 0);
  const peak = Math.max(...config.prim.map((oneBased) => values[oneBased - 1]));
  const blended = config.alpha * peak + (1 - config.alpha) * weighted;
  let overall = Math.round(clamp(RATING_MIN_OVERALL + (RATING_MAX_OVERALL - RATING_MIN_OVERALL) * sigmoid(blended), RATING_MIN_OVERALL, RATING_MAX_OVERALL));
  const eliteAttrs = values.filter((value) => value >= 90).length;
  if (eliteAttrs >= 3) overall = Math.min(RATING_MAX_OVERALL, overall + eliteAttrs - 2);
  return overall;
}

function ageExpectedDelta(age) {
  if (age <= 18) return 0.22;
  if (age === 19) return 0.20;
  if (age === 20) return 0.16;
  if (age === 21) return 0.10;
  if (age === 22) return 0.04;
  if (age === 23) return 0.00;
  if (age === 24) return -0.05;
  if (age === 25 || age === 26) return -0.08;
  if (age === 27) return -0.04;
  if (age === 28) return -0.02;
  if (age === 29) return -0.05;
  if (age === 30) return -0.16;
  if (age === 31) return -0.50;
  if (age === 32) return -0.86;
  if (age === 33) return -1.18;
  if (age === 34) return -1.42;
  if (age === 35) return -1.78;
  if (age === 36) return -2.12;
  if (age === 37) return -2.48;
  if (age === 38) return -2.84;
  if (age === 39) return -3.18;
  return -3.50;
}

function potentialGapEffect(age, overall, potential) {
  const gap = Math.max(0, potential - overall);
  if (age <= 21) return clamp(gap / 30, 0, 0.30);
  if (age <= 24) return clamp(gap / 42, 0, 0.16);
  if (age <= 26) return clamp(gap / 60, 0, 0.06);
  if (age <= 28) return clamp(gap / 80, 0, 0.02);
  return 0;
}

function starPipelineBonus(age, overall, potential) {
  const gap = Math.max(0, potential - overall);
  if (gap <= 0) return 0;
  if (age <= 22 && overall >= 78 && overall <= 86 && potential >= 96 && gap >= 12) return clamp(0.06 + gap * 0.018, 0, 0.30);
  if (age <= 23 && overall >= 82 && overall <= 86 && potential >= 95 && gap >= 10) return clamp(0.02 + gap * 0.008, 0, 0.12);
  if (age <= 25 && overall >= 86 && overall <= 90 && potential >= 95 && gap >= 6) return clamp(0.05 + gap * 0.022, 0, 0.24);
  if (age <= 27 && overall >= 88 && overall <= 91 && potential >= 94 && gap >= 5) return clamp(0.03 + gap * 0.014, 0, 0.14);
  return 0;
}

function eliteAgingPressure(age, overall) {
  if (age < 30) return 0;
  let pressure = 0;
  if (age === 30) {
    if (overall >= 98) pressure += 0.38;
    else if (overall >= 96) pressure += 0.26;
    else if (overall >= 94) pressure += 0.14;
    return pressure;
  }
  if (overall >= 98) pressure += 0.84;
  else if (overall >= 97) pressure += 0.68;
  else if (overall >= 95) pressure += 0.54;
  else if (overall >= 92) pressure += 0.40;
  else if (overall >= 90) pressure += 0.25;
  else if (age >= 33 && overall >= 88) pressure += 0.15;
  else if (age >= 35 && overall >= 85) pressure += 0.10;
  if (age === 31 && overall >= 92) pressure += 0.12;
  if (age >= 32) pressure += 0.12;
  if (age >= 33) pressure += 0.18;
  if (age >= 34) pressure += 0.16;
  if (age >= 35) pressure += 0.18;
  if (age >= 36) pressure += 0.20;
  return pressure;
}

function highOverallResistance(age, overall, positive, potential) {
  if (positive <= 0) return positive;
  const gap = Math.max(0, potential - overall);
  const highUpside = age <= 27 && potential >= 92 && gap >= 3;
  let multiplier = 1;
  if (overall >= 97) multiplier = age <= 24 ? 0.34 : 0.25;
  else if (overall >= 95) multiplier = age <= 24 ? 0.50 : 0.36;
  else if (overall >= 92) multiplier = highUpside ? 0.70 : age <= 24 ? 0.64 : 0.50;
  else if (overall >= 90) multiplier = highUpside ? 0.80 : age <= 24 ? 0.72 : 0.60;
  else if (overall >= 87) multiplier = highUpside ? 0.92 : 0.80;
  else if (overall >= 84) multiplier = highUpside ? 0.96 : 0.90;
  return positive * multiplier;
}

function lowOverallYoungDampener(age, overall, potential, expected) {
  if (expected <= 0 || age > 25 || overall >= 84) return expected;
  const gap = Math.max(0, potential - overall);
  let multiplier = overall < 70 ? 0.18 : overall < 74 ? 0.22 : overall < 77 ? 0.28 : overall < 80 ? 0.36 : overall < 83 ? 0.46 : 0.56;
  if (potential >= 96 && gap >= 14) multiplier = Math.max(multiplier, 0.68);
  else if (potential >= 94 && gap >= 12) multiplier = Math.max(multiplier, 0.56);
  else if (potential >= 92 && gap >= 11) multiplier = Math.max(multiplier, 0.46);
  return expected * multiplier;
}

function expectedOverallDelta(player = {}) {
  const age = Math.round(toNum(player.age, 25));
  const overall = Math.round(toNum(player.overall ?? player.ovr, 70));
  const potential = Math.max(overall, Math.round(toNum(player.potential ?? player.pot, overall)));
  let expected = ageExpectedDelta(age) + potentialGapEffect(age, overall, potential) + starPipelineBonus(age, overall, potential) - eliteAgingPressure(age, overall);
  expected = highOverallResistance(age, overall, expected, potential);
  expected = lowOverallYoungDampener(age, overall, potential, expected);

  // The real progression engine is stochastic. The trade forecast is the stable,
  // conservative median expectation: older players round decline away from zero,
  // while young players need a meaningful positive expectation to receive +1.
  if (expected <= -0.35) return Math.max(-5, Math.floor(expected));
  if (expected >= 0.55) return Math.min(3, Math.ceil(expected));
  return 0;
}

function moveAttrsTowardOverall(attrsIn, pos, targetOverall, direction) {
  const attrs = padAttrs(attrsIn);
  const priorities = direction < 0 ? DECLINE_PRIORITY : (GROWTH_PRIORITY_BY_POS[normalizedPos(pos)] || GROWTH_PRIORITY_BY_POS.SF);
  let current = calculateProjectedOverallFromAttrs(attrs, pos);
  let steps = 0;
  const maxSteps = 90;

  while (((direction < 0 && current > targetOverall) || (direction > 0 && current < targetOverall)) && steps < maxSteps) {
    let moved = false;
    for (const index of priorities) {
      const before = attrs[index];
      const next = clamp(before + direction, 25, 99);
      if (next === before) continue;
      attrs[index] = next;
      const test = calculateProjectedOverallFromAttrs(attrs, pos);
      const closer = Math.abs(test - targetOverall) <= Math.abs(current - targetOverall);
      const noOvershoot = direction < 0 ? test >= targetOverall : test <= targetOverall;
      if (closer && noOvershoot) {
        current = test;
        moved = true;
        steps += 1;
        if (current === targetOverall) break;
      } else {
        attrs[index] = before;
      }
    }
    if (!moved) break;
  }

  return attrs;
}

function avgDelta(indices, before, after) {
  if (!indices.length) return 0;
  return indices.reduce((sum, index) => sum + (toNum(after[index], 75) - toNum(before[index], 75)), 0) / indices.length;
}

function projectedPotential(age, currentOverall, projectedOverall, currentPotential) {
  if (age + 1 >= 29) return projectedOverall;
  const gap = Math.max(0, currentPotential - currentOverall);
  const ageCap = age + 1 <= 21 ? 99 : age + 1 <= 24 ? 97 : age + 1 <= 26 ? 94 : 91;
  let next = currentPotential;
  if (projectedOverall > currentOverall && gap >= 5) next += projectedOverall - currentOverall >= 2 ? 1 : 0;
  if (projectedOverall < currentOverall && gap <= 5) next -= 1;
  return Math.round(clamp(next, projectedOverall, Math.max(projectedOverall, ageCap)));
}

function staminaFromAgeAth(age, athleticism) {
  const a = clamp(toNum(age, 25), 18, 45);
  const ath = clamp(toNum(athleticism, 75), 25, 99);
  let ageFactor;
  if (a <= 27) ageFactor = 1;
  else if (a <= 34) ageFactor = 0.95 - (0.15 * (a - 28)) / 6;
  else ageFactor = 0.8 - (0.45 * (a - 35)) / 10;
  ageFactor = clamp(ageFactor, 0.35, 1);
  const raw = ageFactor * 99 * 0.575 + ath * 0.425;
  const norm = (raw - 40) / 59;
  return Math.round(clamp(40 + norm * 59, 40, 99));
}

export function projectPlayerForNextSeason(player = {}, { skipProgression = false, seasonYear = 0 } = {}) {
  if (!player || typeof player !== "object") return player;
  const cacheKey = `${progressionProjectionSignature(player)}|${skipProgression ? 1 : 0}|${seasonYear || 0}`;
  const cached = projectionCache.get(cacheKey);
  if (cached) return { ...player, ...cached, attrs: Array.isArray(cached.attrs) ? [...cached.attrs] : cached.attrs };
  const currentAge = Math.round(toNum(player.age, 25));
  const currentOverall = Math.round(toNum(player.overall ?? player.ovr, 70));
  const currentPotential = Math.max(currentOverall, Math.round(toNum(player.potential ?? player.pot, currentOverall)));
  const pos = normalizedPos(player.pos || player.position);
  const beforeAttrs = padAttrs(player.attrs || player.attributes);
  const delta = skipProgression ? 0 : expectedOverallDelta(player);
  const projectedOverallTarget = Math.round(clamp(currentOverall + delta, RATING_MIN_OVERALL, RATING_MAX_OVERALL));
  const projectedAge = skipProgression ? currentAge : currentAge + 1;
  const projectedAttrs = delta === 0 ? beforeAttrs : moveAttrsTowardOverall(beforeAttrs, pos, projectedOverallTarget, Math.sign(delta));
  const projectedOverall = projectedOverallTarget;
  const offAttrDelta = avgDelta(OFF_ATTRS, beforeAttrs, projectedAttrs);
  const defAttrDelta = avgDelta(DEF_ATTRS, beforeAttrs, projectedAttrs);
  const projectedOff = Math.round(clamp(toNum(player.offRating ?? player.off, currentOverall) + delta * 0.65 + offAttrDelta * 0.35, 25, 99));
  const projectedDef = Math.round(clamp(toNum(player.defRating ?? player.def, currentOverall) + delta * 0.65 + defAttrDelta * 0.35, 25, 99));
  const projectedStamina = staminaFromAgeAth(projectedAge, projectedAttrs[7]);
  const nextPotential = skipProgression
    ? currentPotential
    : projectedPotential(currentAge, currentOverall, projectedOverall, currentPotential);

  const projection = {
    attrs: projectedAttrs,
    overall: projectedOverall,
    ovr: projectedOverall,
    potential: nextPotential,
    pot: nextPotential,
    age: projectedAge,
    offRating: projectedOff,
    defRating: projectedDef,
    stamina: projectedStamina,
    __offseasonProjectionSeasonYear: seasonYear || null,
    __offseasonProjectedNextSeason: !skipProgression,
    __offseasonCurrentAge: currentAge,
    __offseasonCurrentOverall: currentOverall,
    __offseasonCurrentPotential: currentPotential,
    __offseasonCurrentOffRating: toNum(player.offRating ?? player.off, currentOverall),
    __offseasonCurrentDefRating: toNum(player.defRating ?? player.def, currentOverall),
    __offseasonExpectedOverallDelta: projectedOverall - currentOverall,
    __offseasonProjectionSummary: `${currentOverall} OVR / age ${currentAge} → ${projectedOverall} OVR / age ${projectedAge}`,
  };
  if (projectionCache.size >= MAX_PROJECTION_CACHE) projectionCache.clear();
  projectionCache.set(cacheKey, projection);
  return { ...player, ...projection, attrs: [...projectedAttrs] };
}

export function progressionProjectionSignature(player = {}) {
  return [
    player?.id || player?.playerId || player?.name || player?.player || "",
    player?.age || 0,
    player?.overall ?? player?.ovr ?? 0,
    player?.potential ?? player?.pot ?? 0,
    Array.isArray(player?.attrs) ? player.attrs.join(",") : "",
  ].join("|");
}

export function describeOffseasonProjection(player = {}) {
  if (!player?.__offseasonProjectedNextSeason) return "";
  return player.__offseasonProjectionSummary || `${player.__offseasonCurrentOverall} OVR → ${player.overall} OVR`;
}
