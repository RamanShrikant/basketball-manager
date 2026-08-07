// Pure calendar/CPU-trade timing helpers. Keeping these rules outside Calendar
// makes the resume/deadline behavior regression-testable without rendering React.

function cleanDate(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isCpuTradeWindowOpenDate(currentDate, tradeDeadlineDate) {
  const current = cleanDate(currentDate);
  const deadline = cleanDate(tradeDeadlineDate);
  return Boolean(current && deadline && current < deadline);
}

export function dateHasPendingSimulationGame(games = [], resultsById = {}) {
  return (Array.isArray(games) ? games : []).some((game) => {
    if (!game?.id) return false;
    const result = resultsById?.[game.id];
    const hasStoredScore = Boolean(
      result &&
        (result?.totals || result?.winner || result?.score) &&
        Number.isFinite(Number(result?.totals?.home ?? result?.winner?.home ?? result?.score?.home)) &&
        Number.isFinite(Number(result?.totals?.away ?? result?.winner?.away ?? result?.score?.away))
    );
    return !game.played && !hasStoredScore;
  });
}

export function findFirstPendingSimulationDate(scheduleByDate = {}, resultsById = {}) {
  return Object.keys(scheduleByDate || {})
    .sort()
    .find((date) => dateHasPendingSimulationGame(scheduleByDate?.[date], resultsById)) || null;
}

export function getCpuTradeSimulationDateDecision({
  currentDate,
  firstPendingDate = null,
  tradeDeadlineDate,
  preseasonTradeStartDate = null,
  allowPreseasonTrades = false,
} = {}) {
  const current = cleanDate(currentDate);
  const pending = cleanDate(firstPendingDate);
  const deadline = cleanDate(tradeDeadlineDate);
  const preseasonStart = cleanDate(preseasonTradeStartDate);

  if (!current || !deadline) {
    return { shouldRun: false, reason: "missing_date_context" };
  }
  if (!pending) {
    return { shouldRun: false, reason: "season_already_complete" };
  }
  if (!isCpuTradeWindowOpenDate(current, deadline)) {
    return { shouldRun: false, reason: "trade_deadline_locked" };
  }
  if (current < pending) {
    if (allowPreseasonTrades && preseasonStart && current >= preseasonStart) {
      return { shouldRun: true, reason: "preseason_trade_window" };
    }
    return { shouldRun: false, reason: "historical_date_already_simulated" };
  }
  return { shouldRun: true, reason: "active_trade_window" };
}


function dateDiffDays(a, b) {
  const left = cleanDate(a);
  const right = cleanDate(b);
  if (!left || !right) return 999;
  const leftMs = Date.parse(`${left}T00:00:00`);
  const rightMs = Date.parse(`${right}T00:00:00`);
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return 999;
  return Math.round((rightMs - leftMs) / 86400000);
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nextPlannedCpuTradeDay(bankState = {}) {
  const cursor = Math.max(0, Math.trunc(finiteNumber(bankState?.planCursor, 0)));
  const plan = Array.isArray(bankState?.executionPlanDays) ? bankState.executionPlanDays : [];
  const day = plan[cursor];
  return Number.isFinite(Number(day)) ? Math.trunc(Number(day)) : null;
}

export function getCpuTradeCalendarPacingDecision({
  bankState = null,
  currentDate = "",
  dayIndex = 0,
  tradeDeadlineDate = "",
  lastCpuTradePassDayIndex = null,
  basicDecision = null,
} = {}) {
  if (!basicDecision?.shouldRun) {
    return { shouldRun: false, reason: basicDecision?.reason || "basic_decision_blocked" };
  }

  const day = Math.max(0, Math.trunc(finiteNumber(dayIndex, 0)));
  const daysToDeadline = dateDiffDays(currentDate, tradeDeadlineDate);
  const lastDay = Number.isFinite(Number(lastCpuTradePassDayIndex))
    ? Math.trunc(Number(lastCpuTradePassDayIndex))
    : null;
  const gap = lastDay === null ? Infinity : day - lastDay;
  const bankSize = Array.isArray(bankState?.candidates) ? bankState.candidates.length : 0;
  const completed = Math.max(0, Math.trunc(finiteNumber(bankState?.completedTrades, 0)));
  const target = Math.max(0, Math.trunc(finiteNumber(bankState?.targetTrades, 0)));
  const minimum = Math.max(0, Math.trunc(finiteNumber(bankState?.minimumTrades, target ? target - 3 : 0)));
  const nextPlan = nextPlannedCpuTradeDay(bankState || {});
  const duePlan = nextPlan !== null && day >= nextPlan;
  const emptyBank = bankSize <= 0;

  // No bank state yet: allow the first pass so the normal old foundation can initialize.
  if (!bankState || typeof bankState !== "object") {
    return { shouldRun: true, reason: "initialize_cpu_trade_bank" };
  }

  // Keep final deadline behavior alive, but do not run multiple heavy passes every
  // single date within one sim batch.
  if (daysToDeadline <= 2) {
    if (gap >= 1 || duePlan || completed < minimum) {
      return { shouldRun: true, reason: "deadline_final_market" };
    }
    return { shouldRun: false, reason: "deadline_same_batch_cooldown" };
  }

  // If the scheduled execution day is due and inventory exists, run the old trade execution path.
  if (duePlan && bankSize > 0) {
    const executionCadence = daysToDeadline <= 14 ? 2 : daysToDeadline <= 45 ? 4 : 5;
    if (gap >= executionCadence) return { shouldRun: true, reason: "planned_trade_due" };
    return { shouldRun: false, reason: "planned_trade_batch_cooldown" };
  }

  // Let preseason/early season set up the market, but keep it on a sparse cadence.
  const normalCadence = daysToDeadline <= 21 ? 4 : daysToDeadline <= 60 ? 7 : 9;
  const lowInventory = bankSize < (daysToDeadline <= 28 ? 8 : 5);
  const behindMinimum = completed < minimum && daysToDeadline <= 45;
  const activeTarget = target > 0 && completed < target;

  if ((lowInventory || behindMinimum || emptyBank) && activeTarget) {
    if (gap >= normalCadence) return { shouldRun: true, reason: behindMinimum ? "minimum_cadence_recovery" : "inventory_cadence_fill" };
    return { shouldRun: false, reason: "inventory_cadence_cooldown" };
  }

  return { shouldRun: false, reason: "calendar_market_not_due" };
}
