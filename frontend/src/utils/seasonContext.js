// src/utils/seasonContext.js
// Central season-year interpretation helpers.
//
// Basketball Manager stores several related but different years:
// - seasonStartYear: the regular season opening year (2026 for 2026-27)
// - displaySeasonYear: the season ending / awards year (2027 for 2026-27)
// - contractSeasonYear: the salaryByYear slot that is currently active
// - financialSeasonYear: the NBA cap/apron rule year
// - draftYear: the draft attached to the completed season
//
// Existing saves historically inferred the current salary year as season + 1.
// These helpers preserve that legacy fallback unless a save/import explicitly
// supplies payroll fields or clearly identifies the new 2026-27 data shape.

export const FIRST_PLAYABLE_SEASON_YEAR = 2025;

export function validSeasonYear(value, fallback = null) {
  const year = Number(value);
  if (Number.isFinite(year) && year >= 2020 && year <= 2100) return Math.trunc(year);
  return fallback;
}

export function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function getFinancials(leagueData = {}) {
  return leagueData?.financials && typeof leagueData.financials === "object" ? leagueData.financials : {};
}

function pushYear(list, value) {
  const year = validSeasonYear(value, null);
  if (year && !list.includes(year)) list.push(year);
}

function getLeagueLabel(leagueData = {}) {
  return [
    leagueData?.leagueName,
    leagueData?.name,
    leagueData?.title,
    leagueData?.fileName,
    leagueData?.metadata?.name,
    leagueData?.meta?.name,
  ]
    .filter(Boolean)
    .join(" ");
}

function getLabelEndYear(leagueData = {}) {
  const label = getLeagueLabel(leagueData);
  const fullRange = label.match(/(?:^|\D)(20\d{2})\s*[\/-]\s*(20\d{2})(?:\D|$)/);
  if (fullRange) return validSeasonYear(fullRange[2], null);

  const shortRange = label.match(/(?:^|\D)(\d{2})\s*[\/-]\s*(\d{2})(?:\D|$)/);
  if (shortRange) return validSeasonYear(2000 + Number(shortRange[2]), null);

  return null;
}

export function getSeasonStartYear(leagueData = {}) {
  return (
    validSeasonYear(leagueData?.seasonStartYear, null) ??
    validSeasonYear(leagueData?.seasonYear, null) ??
    validSeasonYear(leagueData?.currentSeasonYear, null) ??
    FIRST_PLAYABLE_SEASON_YEAR
  );
}

export function getDisplaySeasonYear(leagueData = {}) {
  const seasonStartYear = getSeasonStartYear(leagueData);
  return (
    validSeasonYear(leagueData?.displaySeasonYear, null) ??
    validSeasonYear(leagueData?.awardsSeasonYear, null) ??
    validSeasonYear(leagueData?.seasonEndYear, null) ??
    getLabelEndYear(leagueData) ??
    seasonStartYear + 1
  );
}

export function getFinancialSeasonYear(leagueData = {}) {
  const seasonStartYear = getSeasonStartYear(leagueData);
  const financials = getFinancials(leagueData);
  return (
    validSeasonYear(leagueData?.currentFinancialSeasonYear, null) ??
    validSeasonYear(leagueData?.financialSeasonYear, null) ??
    validSeasonYear(financials?.currentFinancialSeasonYear, null) ??
    validSeasonYear(financials?.currentSeasonYear, null) ??
    validSeasonYear(financials?.appliedThroughSeasonYear, null) ??
    validSeasonYear(financials?.appliedInflationThroughSeason, null) ??
    validSeasonYear(financials?.baseSeasonYear, null) ??
    seasonStartYear + 1
  );
}

export function getDraftYear(leagueData = {}) {
  const seasonStartYear = getSeasonStartYear(leagueData);
  const draftPicks = Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks : [];
  const pickYears = draftPicks
    .map((pick) => validSeasonYear(pick?.year ?? pick?.seasonYear ?? pick?.draftYear, null))
    .filter(Boolean);
  const minFuturePickYear = pickYears
    .filter((year) => year >= seasonStartYear)
    .reduce((min, year) => Math.min(min, year), Number.POSITIVE_INFINITY);

  return (
    validSeasonYear(leagueData?.draftYear, null) ??
    validSeasonYear(leagueData?.currentDraftYear, null) ??
    validSeasonYear(leagueData?.draftState?.seasonYear, null) ??
    (Number.isFinite(minFuturePickYear) ? minFuturePickYear : null) ??
    seasonStartYear + 1
  );
}

function getRosterContractStartYearMode(leagueData = {}) {
  const counts = new Map();
  let total = 0;

  for (const team of getAllTeamsFromLeague(leagueData)) {
    for (const player of team?.players || []) {
      const year = validSeasonYear(player?.contract?.startYear, null);
      const salaries = Array.isArray(player?.contract?.salaryByYear) ? player.contract.salaryByYear : [];
      if (!year || !salaries.length) continue;
      total += 1;
      counts.set(year, (counts.get(year) || 0) + 1);
    }
  }

  if (!total) return null;
  let bestYear = null;
  let bestCount = 0;
  for (const [year, count] of counts.entries()) {
    if (count > bestCount) {
      bestYear = year;
      bestCount = count;
    }
  }

  return bestCount / total >= 0.55 ? bestYear : null;
}

function looksLikeSeasonStartContractFile(leagueData = {}, seasonStartYear = getSeasonStartYear(leagueData)) {
  const mode = getRosterContractStartYearMode(leagueData);
  if (mode !== seasonStartYear) return false;

  const financialYear = getFinancialSeasonYear(leagueData);
  const displayYear = getDisplaySeasonYear(leagueData);
  const draftYear = getDraftYear(leagueData);

  return (
    financialYear === seasonStartYear + 1 ||
    displayYear === seasonStartYear + 1 ||
    draftYear === seasonStartYear + 1
  );
}

export function getContractSeasonYear(leagueData = {}) {
  const seasonStartYear = getSeasonStartYear(leagueData);

  const explicit =
    validSeasonYear(leagueData?.contractSeasonYear, null) ??
    validSeasonYear(leagueData?.payrollSeasonYear, null) ??
    validSeasonYear(leagueData?.currentPayrollSeasonYear, null) ??
    validSeasonYear(leagueData?.salarySeasonYear, null) ??
    validSeasonYear(leagueData?.currentSalarySeasonYear, null);

  if (explicit) return explicit;
  if (looksLikeSeasonStartContractFile(leagueData, seasonStartYear)) return seasonStartYear;

  // Legacy behavior: older saves/screens treated the active salary slot as the
  // season-ending year. Do not change those saves unless they opt into explicit
  // payroll fields during import/normalization.
  return seasonStartYear + 1;
}

function parseDateString(value) {
  if (!value) return null;
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}


function thirdSundayOfFebruary(year) {
  const d = new Date(year, 1, 1);
  const offset = (7 - d.getDay()) % 7;
  return fmtDate(year, 1, 1 + offset + 14);
}

function addDaysToDateString(dateStr, delta) {
  const parts = String(dateStr || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + delta);
  return fmtDate(d.getFullYear(), d.getMonth(), d.getDate());
}

function fmtDate(year, monthIndex, day) {
  const d = new Date(year, monthIndex, day);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function getSeasonCalendarConfig(leagueData = {}) {
  const seasonStartYear = getSeasonStartYear(leagueData);
  const displaySeasonYear = getDisplaySeasonYear(leagueData);
  const source = leagueData?.calendar && typeof leagueData.calendar === "object" ? leagueData.calendar : {};
  const defaultAllStarDate = thirdSundayOfFebruary(displaySeasonYear);
  const defaultAllStarStart = addDaysToDateString(defaultAllStarDate, -5);
  const defaultAllStarEnd = addDaysToDateString(defaultAllStarDate, 3);

  return {
    // Calendar begins on October 1 so preseason/trade/intel dates are visible.
    regularSeasonStart:
      parseDateString(source.regularSeasonStart) ??
      parseDateString(source.calendarStartDate) ??
      fmtDate(seasonStartYear, 9, 1),
    // Actual regular-season games can still begin on the normal late-October window.
    regularSeasonGameStart:
      parseDateString(source.regularSeasonGameStart) ??
      fmtDate(seasonStartYear, 9, 21),
    // Basketball Manager uses one clear preseason deadline for both rookie and
    // veteran extension gameplay. The default is the day before opening night.
    contractExtensionDeadlineDate:
      parseDateString(source.contractExtensionDeadlineDate) ??
      parseDateString(source.extensionDeadlineDate) ??
      addDaysToDateString(
        parseDateString(source.regularSeasonGameStart) ?? fmtDate(seasonStartYear, 9, 21),
        -1
      ),
    regularSeasonEnd:
      parseDateString(source.regularSeasonEnd) ??
      parseDateString(source.seasonEndDate) ??
      fmtDate(displaySeasonYear, 3, 12),
    allStarStart:
      parseDateString(source.allStarStart) ??
      parseDateString(source.allStarBreakStart) ??
      defaultAllStarStart,
    allStarEnd:
      parseDateString(source.allStarEnd) ??
      parseDateString(source.allStarWeekendEnd) ??
      defaultAllStarEnd,
    allStarSelectionDate:
      parseDateString(source.allStarSelectionDate) ??
      parseDateString(source.allStarDate) ??
      defaultAllStarDate,
    tradeDeadlineDate:
      parseDateString(source.tradeDeadlineDate) ??
      parseDateString(source.tradeDeadline) ??
      fmtDate(displaySeasonYear, 1, 4),
    nbaCupFinalDate: parseDateString(source.nbaCupFinalDate) ?? null,
  };
}

export function getLeagueSeasonContext(leagueData = {}) {
  const seasonStartYear = getSeasonStartYear(leagueData);
  const displaySeasonYear = getDisplaySeasonYear(leagueData);
  const contractSeasonYear = getContractSeasonYear(leagueData);
  const financialSeasonYear = getFinancialSeasonYear(leagueData);
  const draftYear = getDraftYear(leagueData);

  return {
    seasonStartYear,
    seasonYear: seasonStartYear,
    currentSeasonYear: seasonStartYear,
    displaySeasonYear,
    seasonEndYear: displaySeasonYear,
    contractSeasonYear,
    payrollSeasonYear: contractSeasonYear,
    currentPayrollSeasonYear: contractSeasonYear,
    salarySeasonYear: contractSeasonYear,
    financialSeasonYear,
    currentFinancialSeasonYear: financialSeasonYear,
    draftYear,
    currentDraftYear: draftYear,
    calendar: getSeasonCalendarConfig(leagueData),
  };
}

export function withNormalizedSeasonContext(leagueData = {}) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;
  const context = getLeagueSeasonContext(leagueData);
  const financials = getFinancials(leagueData);

  return {
    ...leagueData,
    seasonYear: context.seasonYear,
    currentSeasonYear: context.currentSeasonYear,
    seasonStartYear: context.seasonStartYear,
    displaySeasonYear: context.displaySeasonYear,
    seasonEndYear: context.seasonEndYear,
    contractSeasonYear: context.contractSeasonYear,
    payrollSeasonYear: context.payrollSeasonYear,
    currentPayrollSeasonYear: context.currentPayrollSeasonYear,
    salarySeasonYear: context.salarySeasonYear,
    draftYear: context.draftYear,
    currentDraftYear: context.currentDraftYear,
    currentFinancialSeasonYear: context.currentFinancialSeasonYear,
    calendar: {
      ...(leagueData.calendar && typeof leagueData.calendar === "object" ? leagueData.calendar : {}),
      ...context.calendar,
    },
    financials: {
      ...financials,
      baseSeasonYear: validSeasonYear(financials.baseSeasonYear, null) ?? context.financialSeasonYear,
      currentSeasonYear: context.financialSeasonYear,
      currentFinancialSeasonYear: context.financialSeasonYear,
      appliedThroughSeasonYear:
        validSeasonYear(financials.appliedThroughSeasonYear, null) ??
        validSeasonYear(financials.appliedInflationThroughSeason, null) ??
        context.financialSeasonYear,
    },
  };
}


export function withOffseasonSeasonContext(leagueData = {}, offseasonSeasonYear = null) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;

  const previousStartYear = getSeasonStartYear(leagueData);
  const seasonYear = validSeasonYear(offseasonSeasonYear, null) ?? previousStartYear + 1;
  const displaySeasonYear = seasonYear + 1;
  const financialSeasonYear = displaySeasonYear;
  const existingCalendar = leagueData.calendar && typeof leagueData.calendar === "object" ? leagueData.calendar : {};
  const existingFinancials = getFinancials(leagueData);

  return withNormalizedSeasonContext({
    ...leagueData,
    seasonYear,
    currentSeasonYear: seasonYear,
    seasonStartYear: seasonYear,
    displaySeasonYear,
    seasonEndYear: displaySeasonYear,
    contractSeasonYear: seasonYear,
    payrollSeasonYear: seasonYear,
    currentPayrollSeasonYear: seasonYear,
    salarySeasonYear: seasonYear,
    currentSalarySeasonYear: seasonYear,
    draftYear: seasonYear,
    currentDraftYear: seasonYear,
    financialSeasonYear,
    currentFinancialSeasonYear: financialSeasonYear,
    calendar: {
      ...existingCalendar,
      regularSeasonStart: fmtDate(seasonYear, 9, 1),
      regularSeasonGameStart: fmtDate(seasonYear, 9, 21),
      regularSeasonEnd: fmtDate(displaySeasonYear, 3, 12),
      allStarStart: addDaysToDateString(thirdSundayOfFebruary(displaySeasonYear), -5),
      allStarEnd: addDaysToDateString(thirdSundayOfFebruary(displaySeasonYear), 3),
      allStarSelectionDate: thirdSundayOfFebruary(displaySeasonYear),
      tradeDeadlineDate: fmtDate(displaySeasonYear, 1, 4),
    },
    financials: {
      ...existingFinancials,
      currentSeasonYear: financialSeasonYear,
      currentFinancialSeasonYear: financialSeasonYear,
      appliedThroughSeasonYear:
        validSeasonYear(existingFinancials.appliedThroughSeasonYear, null) &&
        validSeasonYear(existingFinancials.appliedThroughSeasonYear, null) > financialSeasonYear
          ? validSeasonYear(existingFinancials.appliedThroughSeasonYear, null)
          : financialSeasonYear,
    },
  });
}

export function installSeasonContextAudit(getLeagueData) {
  if (typeof window === "undefined") return;
  window.BM_SEASON_CONTEXT_AUDIT = () => {
    const leagueData = typeof getLeagueData === "function" ? getLeagueData() : getLeagueData;
    const context = getLeagueSeasonContext(leagueData || {});
    const picks = Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks : [];
    const pickYears = picks
      .map((pick) => validSeasonYear(pick?.year ?? pick?.seasonYear ?? pick?.draftYear, null))
      .filter(Boolean);
    const contractStartCounts = {};
    let playersWithContracts = 0;
    for (const team of getAllTeamsFromLeague(leagueData)) {
      for (const player of team?.players || []) {
        const startYear = validSeasonYear(player?.contract?.startYear, null);
        if (!startYear) continue;
        playersWithContracts += 1;
        contractStartCounts[startYear] = (contractStartCounts[startYear] || 0) + 1;
      }
    }
    const report = {
      ...context,
      minPickYear: pickYears.length ? Math.min(...pickYears) : null,
      maxPickYear: pickYears.length ? Math.max(...pickYears) : null,
      draftPickAssets: picks.length,
      playersWithContracts,
      contractStartCounts,
    };
    console.table(report);
    return report;
  };
}
