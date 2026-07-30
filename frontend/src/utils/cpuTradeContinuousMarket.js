export const CPU_TRADE_CONTINUOUS_MIN_TARGET = 22;
export const CPU_TRADE_CONTINUOUS_MAX_TARGET = 30;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hashString(value = "") {
  let hash = 2166136261;
  const source = String(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getContinuousMarketMinimumTrades(targetTrades) {
  const target = clamp(
    Math.trunc(finiteNumber(targetTrades, 27)),
    CPU_TRADE_CONTINUOUS_MIN_TARGET,
    CPU_TRADE_CONTINUOUS_MAX_TARGET
  );
  return clamp(
    target - 3,
    CPU_TRADE_CONTINUOUS_MIN_TARGET,
    target
  );
}

export function getContinuousMarketBudgets(targetTrades) {
  const target = clamp(
    Math.trunc(finiteNumber(targetTrades, 27)),
    CPU_TRADE_CONTINUOUS_MIN_TARGET,
    CPU_TRADE_CONTINUOUS_MAX_TARGET
  );
  return {
    maximumGenerationPasses: clamp(Math.ceil(target * 0.72), 14, 22),
    maximumExactEvaluations: clamp(target * 28, 616, 840),
  };
}

export function getContinuousMarketCooldownDays({
  seed = "",
  generationNonce = 0,
  daysToDeadline = 999,
} = {}) {
  const nonce = Math.max(0, Math.trunc(finiteNumber(generationNonce, 0)));
  const daysLeft = finiteNumber(daysToDeadline, 999);
  const roll = hashString(`${seed}|continuous-market-gap:${nonce}`);
  const minimumGap = daysLeft <= 21 ? 2 : daysLeft <= 60 ? 3 : 4;
  const spread = daysLeft <= 21 ? 2 : 3;
  return minimumGap + (roll % spread);
}

export function decideContinuousMarketGeneration({
  dayIndex = 0,
  daysToDeadline = 999,
  seed = "",
  generationNonce = 0,
  lastGenerationDayIndex = null,
  generationPasses = 0,
  exactEvaluations = 0,
  maximumGenerationPasses = 20,
  maximumExactEvaluations = 594,
  runway = {},
  forceGeneration = false,
} = {}) {
  const day = Math.max(0, Math.trunc(finiteNumber(dayIndex, 0)));
  const daysLeft = finiteNumber(daysToDeadline, 999);
  const passes = Math.max(0, Math.trunc(finiteNumber(generationPasses, 0)));
  const exact = Math.max(0, Math.trunc(finiteNumber(exactEvaluations, 0)));
  const maxPasses = Math.max(0, Math.trunc(finiteNumber(maximumGenerationPasses, 0)));
  const maxExact = Math.max(0, Math.trunc(finiteNumber(maximumExactEvaluations, 0)));
  const generationPassBudgetRemaining = Math.max(0, maxPasses - passes);
  const exactEvaluationBudgetRemaining = Math.max(0, maxExact - exact);
  const remainingDesired = Math.max(0, finiteNumber(runway?.remainingDesired, 0));
  const remainingMinimum = Math.max(0, finiteNumber(runway?.remainingMinimum, 0));
  const bankSize = Math.max(0, finiteNumber(runway?.bankSize, 0));
  const reserveDeficit = Math.max(0, finiteNumber(runway?.reserveDeficit, 0));
  const lateOptionalInventoryLocked = Boolean(runway?.lateOptionalInventoryLocked);

  const cooldownDays = getContinuousMarketCooldownDays({
    seed,
    generationNonce,
    daysToDeadline: daysLeft,
  });
  const normalizedLastDay = Number.isFinite(Number(lastGenerationDayIndex))
    ? Math.trunc(Number(lastGenerationDayIndex))
    : null;
  const cooldownReady = normalizedLastDay === null || day - normalizedLastDay >= cooldownDays;
  const minimumFloorRecovery = remainingMinimum > 0 &&
    bankSize === 0 &&
    (Boolean(runway?.dueSoon) || daysLeft <= 14);
  const inventoryNeeded = reserveDeficit > 0 || minimumFloorRecovery;

  let shouldGenerate = false;
  let reason = "inventory_covered";
  if (remainingDesired <= 0) {
    reason = "desired_ceiling_complete";
  } else if (lateOptionalInventoryLocked) {
    reason = "minimum_secured_late_market";
  } else if (generationPassBudgetRemaining <= 0) {
    reason = "generation_pass_budget_exhausted";
  } else if (exactEvaluationBudgetRemaining <= 0) {
    reason = "exact_validation_budget_exhausted";
  } else if (forceGeneration) {
    shouldGenerate = true;
    reason = "forced";
  } else if (!inventoryNeeded) {
    reason = "inventory_covered";
  } else if (cooldownReady || minimumFloorRecovery) {
    shouldGenerate = true;
    reason = minimumFloorRecovery
      ? "minimum_floor_recovery"
      : "continuous_inventory_coverage";
  } else {
    reason = "continuous_cooldown";
  }

  const requestedExact = clamp(
    Math.max(
      24,
      reserveDeficit * 12,
      remainingMinimum > 0 && bankSize === 0 ? 36 : 0
    ),
    24,
    36
  );
  const exactEvaluationLimit = Math.min(requestedExact, exactEvaluationBudgetRemaining);
  const requestedCandidates = clamp(
    Math.max(36, exactEvaluationLimit * 2),
    36,
    daysLeft <= 28 ? 72 : 60
  );

  return {
    shouldGenerate,
    reason,
    cooldownDays,
    cooldownReady,
    lastGenerationDayIndex: normalizedLastDay,
    minimumFloorRecovery,
    inventoryNeeded,
    generationPassBudgetRemaining,
    exactEvaluationBudgetRemaining,
    requestedCandidates: shouldGenerate ? requestedCandidates : 0,
    exactEvaluationLimit: shouldGenerate ? exactEvaluationLimit : 0,
  };
}
