// src/api/teamRatings.js
// Team rating formula used by Coach Gameplan and rotation optimization.

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const round4 = (x) => Math.round(Number(x || 0) * 10000) / 10000;

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
const TR_SECONDARY_POS_CREDIT = 0.95;
const POSITIONS = ["PG", "SG", "SF", "PF", "C"];

const fatigueThreshold = (sta) => 0.359 * (sta ?? 75) + 2.46;
const fatiguePenalty = (mins, sta) => {
  const over = Math.max(0, (mins || 0) - fatigueThreshold(sta));
  return Math.max(TR_FATIGUE_FLOOR, 1 - TR_FATIGUE_K * over);
};

const posMinTemplate = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
const POSITION_INDEX = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 };
const positionOptionsCache = new WeakMap();

function buildPositionOptions(player) {
  const primaryPos = player?.pos && POSITION_INDEX[player.pos] !== undefined ? player.pos : "SG";
  const secondaryPos =
    player?.secondaryPos &&
    player.secondaryPos !== primaryPos &&
    POSITION_INDEX[player.secondaryPos] !== undefined
      ? player.secondaryPos
      : null;

  if (player && typeof player === "object") {
    const cacheKey = `${player.pos || ""}|${player.secondaryPos || ""}`;
    const cached = positionOptionsCache.get(player);
    if (cached?.key === cacheKey) return cached;

    const options = {
      key: cacheKey,
      primaryPos,
      primaryIndex: POSITION_INDEX[primaryPos],
      secondaryPos,
      secondaryIndex: secondaryPos ? POSITION_INDEX[secondaryPos] : -1,
    };
    positionOptionsCache.set(player, options);
    return options;
  }

  return {
    key: "",
    primaryPos,
    primaryIndex: POSITION_INDEX[primaryPos],
    secondaryPos,
    secondaryIndex: secondaryPos ? POSITION_INDEX[secondaryPos] : -1,
  };
}

function transferCandidateAmounts(posMin, fromIndex, toIndex, maxAmount) {
  const max = Math.max(0, Number(maxAmount || 0));
  if (max <= 0) return [];

  const values = new Set();
  const add = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    values.add(Math.min(max, Math.max(0, n)));
  };

  // Breakpoints around 48 are enough because coveragePenaltyPts() is piecewise
  // linear. This avoids one-minute flow solving inside every rating call.
  [max, 1, 4, 8, 12, 16, 24].forEach(add);

  const fromNow = Number(posMin[fromIndex] || 0);
  const toNow = Number(posMin[toIndex] || 0);

  add(fromNow - TR_POS_TARGET);
  add(fromNow - (TR_POS_TARGET + 1));
  add(fromNow - (TR_POS_TARGET - 1));

  add((TR_POS_TARGET - toNow) / TR_SECONDARY_POS_CREDIT);
  add(((TR_POS_TARGET + 1) - toNow) / TR_SECONDARY_POS_CREDIT);
  add(((TR_POS_TARGET - 1) - toNow) / TR_SECONDARY_POS_CREDIT);

  return [...values]
    .filter((value) => value > 1e-7 && value <= max + 1e-7)
    .sort((a, b) => a - b);
}

function coveragePenaltyValues(posMin) {
  let coverageError = 0;
  let worstOver = 0;

  for (let i = 0; i < 5; i += 1) {
    const minutes = Number(posMin[i] || 0);
    coverageError += Math.abs(minutes - TR_POS_TARGET);
    worstOver = Math.max(worstOver, minutes - TR_POS_TARGET);
  }

  const covPen = (coverageError / 240) * TR_COV_ALPHA;
  const overPen = (worstOver / 192) * TR_OVERPOS_MAXPT;
  return covPen + overPen;
}

const legacyPositionOptionsCache = new WeakMap();

function buildLegacyPositionOptions(player) {
  if (player && typeof player === "object") {
    const cacheKey = `${player.pos || ""}|${player.secondaryPos || ""}`;
    const cached = legacyPositionOptionsCache.get(player);
    if (cached?.key === cacheKey) return cached.options;

    const options = [];
    const primary = player.pos && posMinTemplate[player.pos] !== undefined ? player.pos : null;
    const secondary =
      player.secondaryPos &&
      player.secondaryPos !== primary &&
      posMinTemplate[player.secondaryPos] !== undefined
        ? player.secondaryPos
        : null;

    if (primary) options.push({ pos: primary, credit: 1.0, isPrimary: true });
    if (secondary) options.push({ pos: secondary, credit: TR_SECONDARY_POS_CREDIT, isPrimary: false });
    if (!options.length) options.push({ pos: "SG", credit: 1.0, isPrimary: true });

    legacyPositionOptionsCache.set(player, { key: cacheKey, options });
    return options;
  }

  const options = [];
  const primary = player.pos && posMinTemplate[player.pos] !== undefined ? player.pos : null;
  const secondary =
    player.secondaryPos &&
    player.secondaryPos !== primary &&
    posMinTemplate[player.secondaryPos] !== undefined
      ? player.secondaryPos
      : null;

  if (primary) options.push({ pos: primary, credit: 1.0, isPrimary: true });
  if (secondary) options.push({ pos: secondary, credit: TR_SECONDARY_POS_CREDIT, isPrimary: false });
  if (!options.length) options.push({ pos: "SG", credit: 1.0, isPrimary: true });
  return options;
}

function transferLegacyCandidateAmounts(posMin, fromOption, toOption, maxAmount) {
  const max = Math.max(0, Number(maxAmount || 0));
  if (max <= 0) return [];

  const values = new Set();
  const add = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    values.add(Math.min(max, Math.max(0, n)));
  };

  [max, 1, 4, 8, 12, 16, 24].forEach(add);

  const fromCredit = Number(fromOption?.credit || 1);
  const toCredit = Number(toOption?.credit || 1);
  const fromNow = Number(posMin?.[fromOption.pos] || 0);
  const toNow = Number(posMin?.[toOption.pos] || 0);

  if (fromCredit > 0) {
    add((fromNow - TR_POS_TARGET) / fromCredit);
    add((fromNow - (TR_POS_TARGET + 1)) / fromCredit);
    add((fromNow - (TR_POS_TARGET - 1)) / fromCredit);
  }

  if (toCredit > 0) {
    add((TR_POS_TARGET - toNow) / toCredit);
    add(((TR_POS_TARGET + 1) - toNow) / toCredit);
    add(((TR_POS_TARGET - 1) - toNow) / toCredit);
  }

  return [...values]
    .filter((value) => value > 1e-7 && value <= max + 1e-7)
    .sort((a, b) => a - b);
}

function applyLegacyAllocationMove(allocation, posMin, fromOption, toOption, amount) {
  const from = fromOption?.pos || "";
  const to = toOption?.pos || "";
  const m = Number(amount || 0);
  if (!from || !to || from === to || m <= 0) return;

  allocation[from] = Number(allocation[from] || 0) - m;
  if (Math.abs(allocation[from]) < 1e-7) allocation[from] = 0;
  allocation[to] = Number(allocation[to] || 0) + m;
  posMin[from] -= m * Number(fromOption.credit || 1);
  posMin[to] += m * Number(toOption.credit || 1);
}

function chooseBestPositionAssignmentsLegacy(roster) {
  const active = (roster || []).filter((p) => p && p.minutes > 0);
  const posMin = { ...posMinTemplate };
  const assignedByName = {};
  const assignedCreditsByName = {};
  const allocationsByName = {};

  if (!active.length) {
    return { posMin, assignedByName, assignedCreditsByName, allocationsByName };
  }

  const primaryByName = {};
  const secondaryByName = {};

  for (const player of active) {
    const options = buildLegacyPositionOptions(player);
    const primary = options.find((option) => option.isPrimary) || options[0];
    const secondary = options.find((option) => !option.isPrimary) || null;
    primaryByName[player.name] = primary;
    secondaryByName[player.name] = secondary;
    allocationsByName[player.name] = { [primary.pos]: Number(player.minutes || 0) };
    posMin[primary.pos] += Number(player.minutes || 0) * Number(primary.credit || 1);
  }

  let currentPenalty = coveragePenaltyPts(posMin);
  let improved = true;
  let passes = 0;

  while (improved && passes < 20) {
    improved = false;
    passes += 1;
    let bestMove = null;

    for (const player of active) {
      const primary = primaryByName[player.name];
      const secondary = secondaryByName[player.name];
      if (!primary || !secondary) continue;

      const allocation = allocationsByName[player.name] || {};
      const movable = Number(allocation[primary.pos] || 0);
      if (movable <= 1e-7) continue;

      for (const amount of transferLegacyCandidateAmounts(posMin, primary, secondary, movable)) {
        const primaryBefore = Number(posMin[primary.pos] || 0);
        const secondaryBefore = Number(posMin[secondary.pos] || 0);
        posMin[primary.pos] = primaryBefore - amount * Number(primary.credit || 1);
        posMin[secondary.pos] = secondaryBefore + amount * Number(secondary.credit || 1);
        const testPenalty = coveragePenaltyPts(posMin);
        posMin[primary.pos] = primaryBefore;
        posMin[secondary.pos] = secondaryBefore;

        const penaltyGain = currentPenalty - testPenalty;
        if (!bestMove || penaltyGain > bestMove.penaltyGain + 1e-10) {
          bestMove = { player, primary, secondary, amount, penaltyGain, testPenalty };
        }
      }
    }

    if (bestMove && bestMove.penaltyGain > 1e-6) {
      applyLegacyAllocationMove(
        allocationsByName[bestMove.player.name],
        posMin,
        bestMove.primary,
        bestMove.secondary,
        bestMove.amount
      );
      currentPenalty = bestMove.testPenalty;
      improved = true;
    }
  }

  for (const player of active) {
    const allocation = allocationsByName[player.name] || {};
    const primary = primaryByName[player.name];
    const secondary = secondaryByName[player.name];
    const primaryMinutes = Number(allocation[primary?.pos] || 0);
    const secondaryMinutes = secondary ? Number(allocation[secondary.pos] || 0) : 0;
    const effectiveCreditTotal =
      primaryMinutes * Number(primary?.credit || 1) +
      secondaryMinutes * Number(secondary?.credit || 0);

    assignedByName[player.name] = secondary && secondaryMinutes > primaryMinutes
      ? secondary.pos
      : (primary?.pos || player.pos || "SG");
    assignedCreditsByName[player.name] = player.minutes > 0
      ? effectiveCreditTotal / player.minutes
      : 1.0;
  }

  return { posMin, assignedByName, assignedCreditsByName, allocationsByName };
}

function chooseBestPositionAssignments(roster) {
  const active = [];
  const seenNames = new Set();
  let needsLegacyPath = false;
  for (const player of roster || []) {
    if (!player || player.minutes <= 0) continue;
    active.push(player);
    if (POSITION_INDEX[player.pos] === undefined || seenNames.has(player.name)) {
      needsLegacyPath = true;
    }
    seenNames.add(player.name);
  }

  if (needsLegacyPath) {
    return chooseBestPositionAssignmentsLegacy(roster);
  }

  const posValues = [0, 0, 0, 0, 0];
  const assignedByName = {};
  const assignedCreditsByName = {};
  const allocationsByName = {};

  if (!active.length) {
    return {
      posMin: { ...posMinTemplate },
      assignedByName,
      assignedCreditsByName,
      allocationsByName,
    };
  }

  const optionRows = new Array(active.length);
  const primaryMinutes = new Array(active.length);
  const secondaryMinutes = new Array(active.length).fill(0);

  for (let i = 0; i < active.length; i += 1) {
    const player = active[i];
    const options = buildPositionOptions(player);
    const minutes = Number(player.minutes || 0);
    optionRows[i] = options;
    primaryMinutes[i] = minutes;
    posValues[options.primaryIndex] += minutes;
  }

  let currentPenalty = coveragePenaltyValues(posValues);
  let improved = true;
  let passes = 0;

  // Fast split-position allocator. Start with every player at his primary spot,
  // then move only the amount of minutes that improves the team's positional
  // coverage. Candidate order and tie behavior intentionally match the original.
  while (improved && passes < 20) {
    improved = false;
    passes += 1;

    let bestPlayerIndex = -1;
    let bestAmount = 0;
    let bestPenaltyGain = 0;
    let bestTestPenalty = currentPenalty;

    for (let i = 0; i < active.length; i += 1) {
      const options = optionRows[i];
      if (options.secondaryIndex < 0) continue;

      const movable = Number(primaryMinutes[i] || 0);
      if (movable <= 1e-7) continue;

      const primaryBefore = Number(posValues[options.primaryIndex] || 0);
      const secondaryBefore = Number(posValues[options.secondaryIndex] || 0);

      for (const amount of transferCandidateAmounts(
        posValues,
        options.primaryIndex,
        options.secondaryIndex,
        movable
      )) {
        posValues[options.primaryIndex] = primaryBefore - amount;
        posValues[options.secondaryIndex] =
          secondaryBefore + amount * TR_SECONDARY_POS_CREDIT;

        const testPenalty = coveragePenaltyValues(posValues);

        posValues[options.primaryIndex] = primaryBefore;
        posValues[options.secondaryIndex] = secondaryBefore;

        const penaltyGain = currentPenalty - testPenalty;
        if (bestPlayerIndex < 0 || penaltyGain > bestPenaltyGain + 1e-10) {
          bestPlayerIndex = i;
          bestAmount = amount;
          bestPenaltyGain = penaltyGain;
          bestTestPenalty = testPenalty;
        }
      }
    }

    if (bestPlayerIndex >= 0 && bestPenaltyGain > 1e-6) {
      const options = optionRows[bestPlayerIndex];
      primaryMinutes[bestPlayerIndex] -= bestAmount;
      if (Math.abs(primaryMinutes[bestPlayerIndex]) < 1e-7) {
        primaryMinutes[bestPlayerIndex] = 0;
      }
      secondaryMinutes[bestPlayerIndex] += bestAmount;
      posValues[options.primaryIndex] -= bestAmount;
      posValues[options.secondaryIndex] += bestAmount * TR_SECONDARY_POS_CREDIT;
      currentPenalty = bestTestPenalty;
      improved = true;
    }
  }

  for (let i = 0; i < active.length; i += 1) {
    const player = active[i];
    const options = optionRows[i];
    const primaryMins = Number(primaryMinutes[i] || 0);
    const secondaryMins = Number(secondaryMinutes[i] || 0);
    const allocation = { [options.primaryPos]: primaryMins };
    if (options.secondaryPos && secondaryMins > 0) {
      allocation[options.secondaryPos] = secondaryMins;
    }
    allocationsByName[player.name] = allocation;

    assignedByName[player.name] =
      options.secondaryPos && secondaryMins > primaryMins
        ? options.secondaryPos
        : options.primaryPos;
    assignedCreditsByName[player.name] = player.minutes > 0
      ? (primaryMins + secondaryMins * TR_SECONDARY_POS_CREDIT) / player.minutes
      : 1.0;
  }

  return {
    posMin: {
      PG: posValues[0],
      SG: posValues[1],
      SF: posValues[2],
      PF: posValues[3],
      C: posValues[4],
    },
    assignedByName,
    assignedCreditsByName,
    allocationsByName,
  };
}

function minutesWeighted(team, minsObj) {
  const roster = [];
  let total = 0;

  (team.players || []).forEach(p => {
    const m = Math.max(0, +(minsObj?.[p.name] || 0));
    if (m <= 0) return;

    total += m;

    const primaryPos = p.pos || "SG";
    const secondaryPos = p.secondaryPos || null;

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

  const assignment = chooseBestPositionAssignments(roster);
  const rosterOut = roster.map((p) => ({
    ...p,
    assignedPosition: assignment.assignedByName[p.name] || p.pos,
    positionCredit: assignment.assignedCreditsByName[p.name] ?? 1.0,
  }));

  return { roster: rosterOut, posMin: assignment.posMin, total };
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

  let first = null;
  let second = null;
  for (const entry of effList) {
    if (!first || entry.eff > first.eff) {
      second = first;
      first = entry;
    } else if (!second || entry.eff > second.eff) {
      second = entry;
    }
  }

  let pull = 0;

  for (const { p } of [first, second].filter(Boolean)) {
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
  let coverageError = 0;
  let worstOver = 0;

  for (const pos of POSITIONS) {
    const minutes = Number(posMin[pos] || 0);
    coverageError += Math.abs(minutes - TR_POS_TARGET);
    worstOver = Math.max(worstOver, minutes - TR_POS_TARGET);
  }

  const covPen = (coverageError / 240) * TR_COV_ALPHA;
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
    return {
      overall: 0,
      off: 0,
      def: 0,
      exactOverall: 0,
      exactOff: 0,
      exactDef: 0,
      rosterOut: roster,
    };
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

  const exactOverall = round4(scaleRange(rawOvr, "overall"));
  const exactOff = round4(scaleRange(rawOff, "side"));
  const exactDef = round4(scaleRange(rawDef, "side"));

  return {
    // Whole-number values are for UI display.
    overall: Math.round(exactOverall),
    off: Math.round(exactOff),
    def: Math.round(exactDef),

    // Exact values are for internal logic, optimization, and any future sim use.
    exactOverall,
    exactOff,
    exactDef,
    rosterOut: roster,
  };
}
