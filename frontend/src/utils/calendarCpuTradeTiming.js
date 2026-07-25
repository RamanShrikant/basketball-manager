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
} = {}) {
  const current = cleanDate(currentDate);
  const pending = cleanDate(firstPendingDate);
  const deadline = cleanDate(tradeDeadlineDate);

  if (!current || !deadline) {
    return { shouldRun: false, reason: "missing_date_context" };
  }
  if (!pending) {
    return { shouldRun: false, reason: "season_already_complete" };
  }
  if (current < pending) {
    return { shouldRun: false, reason: "historical_date_already_simulated" };
  }
  if (!isCpuTradeWindowOpenDate(current, deadline)) {
    return { shouldRun: false, reason: "trade_deadline_locked" };
  }
  return { shouldRun: true, reason: "active_trade_window" };
}
