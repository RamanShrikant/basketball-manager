// src/utils/leagueFinancials.js
// Central league economy helpers for salary-cap inflation.
// Existing signed contracts should remain fixed. These helpers only set the
// financial rules used for future offers, rookie deals, cap holds, exceptions,
// and UI displays.

export const LEAGUE_FINANCIALS_VERSION = "2026-06-14_league_inflation_v1";
export const DEFAULT_ANNUAL_INFLATION_RATE = 0.065;
export const DEFAULT_BASE_SEASON_YEAR = 2026;

export const DEFAULT_BASE_FINANCIAL_RULES = Object.freeze({
  salaryCap: 154_647_000,
  luxuryTaxLine: 187_895_000,
  firstApron: 195_945_000,
  secondApron: 207_824_000,
  hardCap: 207_824_000,

  minimumSalary: 1_200_000,
  minimumException: 1_500_000,
  veteranMinimum: 1_500_000,
  twoWaySalary: 580_000,

  maxSalary: 54_000_000,
  roomException: 8_781_000,
  nonTaxpayerMLE: 14_104_000,
  midLevelException: 14_104_000,
  taxpayerMLE: 5_685_000,

  rookiePick1Salary: 11_800_000,
  rookieFirstRoundDecline: 315_000,
  rookieFirstRoundFloor: 2_400_000,
  rookieSecondRoundBase: 2_250_000,
  rookieSecondRoundDecline: 28_000,
  rookieSecondRoundFloor: 1_250_000,
});

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function roundMoney(value, nearest = 1_000) {
  const base = Math.max(1, Number(nearest) || 1);
  return Math.round((Number(value) || 0) / base) * base;
}

function validSeasonYear(value, fallback = DEFAULT_BASE_SEASON_YEAR) {
  const y = Number(value);
  if (Number.isFinite(y) && y >= 2020 && y <= 2100) return Math.round(y);
  return fallback;
}

export function getLeagueSeasonYear(leagueData = {}) {
  return validSeasonYear(
    leagueData?.seasonYear ?? leagueData?.currentSeasonYear ?? leagueData?.seasonStartYear,
    DEFAULT_BASE_SEASON_YEAR
  );
}

export function getCurrentFinancialSeasonYear(leagueData = {}) {
  const financials = leagueData?.financials || {};
  return validSeasonYear(
    leagueData?.currentFinancialSeasonYear ??
      financials?.currentSeasonYear ??
      financials?.currentFinancialSeasonYear ??
      financials?.appliedThroughSeasonYear ??
      financials?.appliedInflationThroughSeason ??
      getLeagueSeasonYear(leagueData),
    getLeagueSeasonYear(leagueData)
  );
}

function buildBaseRulesFromLeague(leagueData = {}) {
  const top = leagueData || {};
  const financials = top.financials || {};
  const existingBase = financials.baseRules && typeof financials.baseRules === "object"
    ? financials.baseRules
    : {};

  return {
    ...DEFAULT_BASE_FINANCIAL_RULES,
    ...existingBase,

    salaryCap: safeNumber(existingBase.salaryCap ?? top.salaryCap ?? top.capLimit, DEFAULT_BASE_FINANCIAL_RULES.salaryCap),
    luxuryTaxLine: safeNumber(existingBase.luxuryTaxLine ?? top.luxuryTaxLine ?? top.taxLine, DEFAULT_BASE_FINANCIAL_RULES.luxuryTaxLine),
    firstApron: safeNumber(existingBase.firstApron ?? top.firstApron ?? top.apron1, DEFAULT_BASE_FINANCIAL_RULES.firstApron),
    secondApron: safeNumber(existingBase.secondApron ?? top.secondApron ?? top.apron2, DEFAULT_BASE_FINANCIAL_RULES.secondApron),
    hardCap: safeNumber(existingBase.hardCap ?? top.hardCap ?? top.hardCapLimit ?? top.secondApron ?? top.apron2, DEFAULT_BASE_FINANCIAL_RULES.hardCap),

    minimumSalary: safeNumber(existingBase.minimumSalary ?? top.minimumSalary ?? top.minSalary, DEFAULT_BASE_FINANCIAL_RULES.minimumSalary),
    minimumException: safeNumber(existingBase.minimumException ?? top.minimumException, DEFAULT_BASE_FINANCIAL_RULES.minimumException),
    veteranMinimum: safeNumber(existingBase.veteranMinimum ?? top.veteranMinimum ?? top.minimumException, DEFAULT_BASE_FINANCIAL_RULES.veteranMinimum),
    twoWaySalary: safeNumber(existingBase.twoWaySalary ?? top.twoWaySalary, DEFAULT_BASE_FINANCIAL_RULES.twoWaySalary),

    maxSalary: safeNumber(existingBase.maxSalary ?? top.maxSalary ?? top.maxContract ?? top.maxContractAmount, DEFAULT_BASE_FINANCIAL_RULES.maxSalary),
    roomException: safeNumber(existingBase.roomException ?? top.roomException ?? top.roomExceptionAmount, DEFAULT_BASE_FINANCIAL_RULES.roomException),
    nonTaxpayerMLE: safeNumber(existingBase.nonTaxpayerMLE ?? top.nonTaxpayerMLE ?? top.nonTaxpayerMidLevelException ?? top.midLevelException, DEFAULT_BASE_FINANCIAL_RULES.nonTaxpayerMLE),
    midLevelException: safeNumber(existingBase.midLevelException ?? top.midLevelException ?? top.nonTaxpayerMLE ?? top.nonTaxpayerMidLevelException, DEFAULT_BASE_FINANCIAL_RULES.midLevelException),
    taxpayerMLE: safeNumber(existingBase.taxpayerMLE ?? top.taxpayerMLE ?? top.taxpayerMidLevelException, DEFAULT_BASE_FINANCIAL_RULES.taxpayerMLE),

    rookiePick1Salary: safeNumber(existingBase.rookiePick1Salary, DEFAULT_BASE_FINANCIAL_RULES.rookiePick1Salary),
    rookieFirstRoundDecline: safeNumber(existingBase.rookieFirstRoundDecline, DEFAULT_BASE_FINANCIAL_RULES.rookieFirstRoundDecline),
    rookieFirstRoundFloor: safeNumber(existingBase.rookieFirstRoundFloor, DEFAULT_BASE_FINANCIAL_RULES.rookieFirstRoundFloor),
    rookieSecondRoundBase: safeNumber(existingBase.rookieSecondRoundBase, DEFAULT_BASE_FINANCIAL_RULES.rookieSecondRoundBase),
    rookieSecondRoundDecline: safeNumber(existingBase.rookieSecondRoundDecline, DEFAULT_BASE_FINANCIAL_RULES.rookieSecondRoundDecline),
    rookieSecondRoundFloor: safeNumber(existingBase.rookieSecondRoundFloor, DEFAULT_BASE_FINANCIAL_RULES.rookieSecondRoundFloor),
  };
}

function calculateInflationIndex(baseSeasonYear, seasonYear, annualRate) {
  const years = Math.max(0, validSeasonYear(seasonYear) - validSeasonYear(baseSeasonYear));
  return Math.pow(1 + safeNumber(annualRate, DEFAULT_ANNUAL_INFLATION_RATE), years);
}

export function getLeagueFinancialRules(leagueData = {}, seasonYear = null) {
  const financials = leagueData?.financials || {};
  const baseSeasonYear = validSeasonYear(financials.baseSeasonYear ?? getLeagueSeasonYear(leagueData));
  const currentYear = validSeasonYear(seasonYear ?? getCurrentFinancialSeasonYear(leagueData), baseSeasonYear);
  const annualInflationRate = safeNumber(financials.annualInflationRate, DEFAULT_ANNUAL_INFLATION_RATE);
  const baseRules = buildBaseRulesFromLeague(leagueData);
  const inflationIndex = calculateInflationIndex(baseSeasonYear, currentYear, annualInflationRate);

  const scaled = (key, nearest = 1_000) => roundMoney(safeNumber(baseRules[key], DEFAULT_BASE_FINANCIAL_RULES[key]) * inflationIndex, nearest);

  const rules = {
    version: LEAGUE_FINANCIALS_VERSION,
    baseSeasonYear,
    seasonYear: currentYear,
    currentFinancialSeasonYear: currentYear,
    annualInflationRate,
    inflationIndex,

    salaryCap: scaled("salaryCap"),
    luxuryTaxLine: scaled("luxuryTaxLine"),
    firstApron: scaled("firstApron"),
    secondApron: scaled("secondApron"),
    hardCap: scaled("hardCap"),

    minimumSalary: scaled("minimumSalary"),
    minimumException: scaled("minimumException"),
    veteranMinimum: scaled("veteranMinimum"),
    twoWaySalary: scaled("twoWaySalary"),

    maxSalary: scaled("maxSalary"),
    maxContract: scaled("maxSalary"),
    maxContractAmount: scaled("maxSalary"),
    roomException: scaled("roomException"),
    roomExceptionAmount: scaled("roomException"),
    nonTaxpayerMLE: scaled("nonTaxpayerMLE"),
    nonTaxpayerMidLevelException: scaled("nonTaxpayerMLE"),
    midLevelException: scaled("nonTaxpayerMLE"),
    taxpayerMLE: scaled("taxpayerMLE"),
    taxpayerMidLevelException: scaled("taxpayerMLE"),
  };

  rules.capLimit = rules.salaryCap;
  rules.taxLine = rules.luxuryTaxLine;
  rules.apron1 = rules.firstApron;
  rules.apron2 = rules.secondApron;
  rules.hardCapLimit = rules.hardCap;

  return rules;
}

export function normalizeLeagueFinancialAliases(leagueData = {}, rules = null) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;
  const resolvedRules = rules || getLeagueFinancialRules(leagueData);
  return {
    ...leagueData,
    currentFinancialSeasonYear: resolvedRules.seasonYear,

    salaryCap: resolvedRules.salaryCap,
    capLimit: resolvedRules.salaryCap,
    luxuryTaxLine: resolvedRules.luxuryTaxLine,
    taxLine: resolvedRules.luxuryTaxLine,
    firstApron: resolvedRules.firstApron,
    apron1: resolvedRules.firstApron,
    secondApron: resolvedRules.secondApron,
    apron2: resolvedRules.secondApron,
    hardCap: resolvedRules.hardCap,
    hardCapLimit: resolvedRules.hardCap,

    minimumSalary: resolvedRules.minimumSalary,
    minimumException: resolvedRules.minimumException,
    veteranMinimum: resolvedRules.veteranMinimum,
    twoWaySalary: resolvedRules.twoWaySalary,
    maxSalary: resolvedRules.maxSalary,
    maxContract: resolvedRules.maxSalary,
    maxContractAmount: resolvedRules.maxSalary,

    roomException: resolvedRules.roomException,
    roomExceptionAmount: resolvedRules.roomException,
    midLevelException: resolvedRules.midLevelException,
    nonTaxpayerMLE: resolvedRules.nonTaxpayerMLE,
    nonTaxpayerMidLevelException: resolvedRules.nonTaxpayerMidLevelException,
    taxpayerMLE: resolvedRules.taxpayerMLE,
    taxpayerMidLevelException: resolvedRules.taxpayerMLE,
  };
}

export function ensureLeagueFinancials(leagueData = {}, options = {}) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;

  const existing = leagueData.financials && typeof leagueData.financials === "object"
    ? leagueData.financials
    : {};

  const baseSeasonYear = validSeasonYear(
    existing.baseSeasonYear ?? options.baseSeasonYear ?? getLeagueSeasonYear(leagueData),
    DEFAULT_BASE_SEASON_YEAR
  );
  const currentFinancialSeasonYear = validSeasonYear(
    existing.currentSeasonYear ??
      existing.currentFinancialSeasonYear ??
      leagueData.currentFinancialSeasonYear ??
      existing.appliedThroughSeasonYear ??
      existing.appliedInflationThroughSeason ??
      options.currentFinancialSeasonYear ??
      getLeagueSeasonYear(leagueData),
    baseSeasonYear
  );
  const annualInflationRate = safeNumber(existing.annualInflationRate, DEFAULT_ANNUAL_INFLATION_RATE);
  const baseRules = buildBaseRulesFromLeague({ ...leagueData, financials: { ...existing, baseRules: existing.baseRules } });

  const next = {
    ...leagueData,
    financials: {
      version: LEAGUE_FINANCIALS_VERSION,
      ...existing,
      baseSeasonYear,
      annualInflationRate,
      baseRules,
      currentSeasonYear: currentFinancialSeasonYear,
      currentFinancialSeasonYear,
      appliedThroughSeasonYear: validSeasonYear(
        existing.appliedThroughSeasonYear ?? existing.appliedInflationThroughSeason ?? currentFinancialSeasonYear,
        currentFinancialSeasonYear
      ),
      history: existing.history && typeof existing.history === "object" ? existing.history : {},
    },
  };

  const rules = getLeagueFinancialRules(next, currentFinancialSeasonYear);
  const historyKey = String(currentFinancialSeasonYear);
  next.financials.history = {
    ...next.financials.history,
    [historyKey]: {
      ...(next.financials.history?.[historyKey] || {}),
      seasonYear: currentFinancialSeasonYear,
      inflationIndex: rules.inflationIndex,
      salaryCap: rules.salaryCap,
      luxuryTaxLine: rules.luxuryTaxLine,
      firstApron: rules.firstApron,
      secondApron: rules.secondApron,
      minimumSalary: rules.minimumSalary,
      minimumException: rules.minimumException,
      maxSalary: rules.maxSalary,
      midLevelException: rules.midLevelException,
      taxpayerMLE: rules.taxpayerMLE,
      roomException: rules.roomException,
      twoWaySalary: rules.twoWaySalary,
    },
  };

  return normalizeLeagueFinancialAliases(next, rules);
}

export function applyLeagueInflationForOffseason(leagueData = {}, targetSeasonYear = null) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;

  const ensured = ensureLeagueFinancials(leagueData);
  const targetYear = validSeasonYear(targetSeasonYear ?? getLeagueSeasonYear(ensured) + 1);
  const financials = ensured.financials || {};
  const alreadyApplied = validSeasonYear(
    financials.appliedThroughSeasonYear ?? financials.appliedInflationThroughSeason ?? financials.currentSeasonYear,
    getLeagueSeasonYear(ensured)
  );

  if (alreadyApplied >= targetYear) {
    return normalizeLeagueFinancialAliases(ensured, getLeagueFinancialRules(ensured, targetYear));
  }

  const next = {
    ...ensured,
    currentFinancialSeasonYear: targetYear,
    financials: {
      ...financials,
      version: LEAGUE_FINANCIALS_VERSION,
      currentSeasonYear: targetYear,
      currentFinancialSeasonYear: targetYear,
      appliedThroughSeasonYear: targetYear,
      appliedInflationThroughSeason: targetYear,
      lastAppliedAt: new Date().toISOString(),
    },
  };

  const rules = getLeagueFinancialRules(next, targetYear);
  next.financials.history = {
    ...(financials.history || {}),
    [String(targetYear)]: {
      seasonYear: targetYear,
      inflationIndex: rules.inflationIndex,
      salaryCap: rules.salaryCap,
      luxuryTaxLine: rules.luxuryTaxLine,
      firstApron: rules.firstApron,
      secondApron: rules.secondApron,
      hardCap: rules.hardCap,
      minimumSalary: rules.minimumSalary,
      minimumException: rules.minimumException,
      veteranMinimum: rules.veteranMinimum,
      maxSalary: rules.maxSalary,
      midLevelException: rules.midLevelException,
      taxpayerMLE: rules.taxpayerMLE,
      roomException: rules.roomException,
      twoWaySalary: rules.twoWaySalary,
      appliedAt: next.financials.lastAppliedAt,
    },
  };

  return normalizeLeagueFinancialAliases(next, rules);
}

export function getRookieSalaryForPick(leagueData = {}, roundNum = 1, pickNum = 1, seasonYear = null) {
  const ensured = ensureLeagueFinancials(leagueData || {});
  const rules = getLeagueFinancialRules(ensured, seasonYear ?? getCurrentFinancialSeasonYear(ensured));
  const baseRules = ensured.financials?.baseRules || DEFAULT_BASE_FINANCIAL_RULES;
  const inflationIndex = Number(rules.inflationIndex || 1);
  const roundNumber = Number(roundNum || 1);
  const pickNumber = Math.max(1, Number(pickNum || 1));

  let baseSalary;
  if (roundNumber === 1) {
    baseSalary = Math.max(
      Number(baseRules.rookieFirstRoundFloor || DEFAULT_BASE_FINANCIAL_RULES.rookieFirstRoundFloor),
      Number(baseRules.rookiePick1Salary || DEFAULT_BASE_FINANCIAL_RULES.rookiePick1Salary) -
        (pickNumber - 1) * Number(baseRules.rookieFirstRoundDecline || DEFAULT_BASE_FINANCIAL_RULES.rookieFirstRoundDecline)
    );
  } else {
    const pickInRound = Math.max(1, pickNumber - 30);
    baseSalary = Math.max(
      Number(baseRules.rookieSecondRoundFloor || DEFAULT_BASE_FINANCIAL_RULES.rookieSecondRoundFloor),
      Number(baseRules.rookieSecondRoundBase || DEFAULT_BASE_FINANCIAL_RULES.rookieSecondRoundBase) -
        (pickInRound - 1) * Number(baseRules.rookieSecondRoundDecline || DEFAULT_BASE_FINANCIAL_RULES.rookieSecondRoundDecline)
    );
  }

  return roundMoney(baseSalary * inflationIndex, 1_000);
}

export function salaryToCapPercent(salary, leagueData = {}, seasonYear = null) {
  const rules = getLeagueFinancialRules(leagueData || {}, seasonYear);
  if (!rules.salaryCap) return 0;
  return Number(salary || 0) / Number(rules.salaryCap || 1);
}
