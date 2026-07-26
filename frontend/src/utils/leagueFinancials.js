// src/utils/leagueFinancials.js
import { getFinancialSeasonYear, getSeasonStartYear } from "./seasonContext.js";
// Central league economy helpers for salary-cap inflation.
// Existing signed contracts should remain fixed. These helpers only set the
// financial rules used for future offers, rookie deals, cap holds, exceptions,
// and UI displays.

export const LEAGUE_FINANCIALS_VERSION = "2026-06-14_league_inflation_v1";
export const DEFAULT_ANNUAL_INFLATION_RATE = 0.065;
export const DEFAULT_BASE_SEASON_YEAR = 2026;


export const OFFICIAL_2026_27_FINANCIAL_RULES = Object.freeze({
  salaryCap: 164_961_000,
  luxuryTaxLine: 200_428_000,
  minimumTeamSalary: 148_465_000,
  firstApron: 209_015_000,
  secondApron: 221_686_000,
  hardCap: 221_686_000,

  minimumSalary: 1_200_000,
  minimumException: 1_500_000,
  veteranMinimum: 1_500_000,
  twoWaySalary: 580_000,

  maxSalary: 57_800_000,
  roomException: 9_366_000,
  roomMidLevel: 9_366_000,
  nonTaxpayerMLE: 15_044_000,
  nonTaxpayerMidLevel: 15_044_000,
  midLevelException: 15_044_000,
  taxpayerMLE: 6_064_000,
  taxpayerMidLevel: 6_064_000,

  rookiePick1Salary: 12_500_000,
  rookieFirstRoundDecline: 335_000,
  rookieFirstRoundFloor: 2_550_000,
  rookieSecondRoundBase: 2_300_000,
  rookieSecondRoundDecline: 30_000,
  rookieSecondRoundFloor: 1_300_000,
});

export const DEFAULT_BASE_FINANCIAL_RULES = Object.freeze({
  salaryCap: 154_647_000,
  luxuryTaxLine: 187_895_000,
  minimumTeamSalary: 139_182_000,
  firstApron: 195_945_000,
  secondApron: 207_824_000,
  hardCap: 207_824_000,

  minimumSalary: 1_200_000,
  minimumException: 1_500_000,
  veteranMinimum: 1_500_000,
  twoWaySalary: 580_000,

  maxSalary: 54_000_000,
  roomException: 8_781_000,
  roomMidLevel: 8_781_000,
  nonTaxpayerMLE: 14_104_000,
  nonTaxpayerMidLevel: 14_104_000,
  midLevelException: 14_104_000,
  taxpayerMLE: 5_685_000,
  taxpayerMidLevel: 5_685_000,

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
  return validSeasonYear(getSeasonStartYear(leagueData), DEFAULT_BASE_SEASON_YEAR);
}

export function getCurrentFinancialSeasonYear(leagueData = {}) {
  return validSeasonYear(getFinancialSeasonYear(leagueData), getLeagueSeasonYear(leagueData) + 1);
}

function buildBaseRulesFromLeague(leagueData = {}) {
  const top = leagueData || {};
  const financials = top.financials || {};
  const existingBase = financials.baseRules && typeof financials.baseRules === "object"
    ? financials.baseRules
    : {};
  const baseSeasonYear = validSeasonYear(financials.baseSeasonYear ?? getCurrentFinancialSeasonYear(top), DEFAULT_BASE_SEASON_YEAR);
  const defaultBaseRules = Object.keys(existingBase).length === 0 && baseSeasonYear === 2027
    ? OFFICIAL_2026_27_FINANCIAL_RULES
    : DEFAULT_BASE_FINANCIAL_RULES;

  return {
    ...defaultBaseRules,
    ...existingBase,

    salaryCap: safeNumber(existingBase.salaryCap ?? top.salaryCap ?? top.capLimit, defaultBaseRules.salaryCap),
    luxuryTaxLine: safeNumber(existingBase.luxuryTaxLine ?? top.luxuryTaxLine ?? top.taxLine, defaultBaseRules.luxuryTaxLine),
    minimumTeamSalary: safeNumber(existingBase.minimumTeamSalary ?? top.minimumTeamSalary ?? top.salaryFloor ?? top.minimumTeamPayroll, defaultBaseRules.minimumTeamSalary),
    firstApron: safeNumber(existingBase.firstApron ?? top.firstApron ?? top.apron1, defaultBaseRules.firstApron),
    secondApron: safeNumber(existingBase.secondApron ?? top.secondApron ?? top.apron2, defaultBaseRules.secondApron),
    hardCap: safeNumber(existingBase.hardCap ?? top.hardCap ?? top.hardCapLimit ?? top.secondApron ?? top.apron2, defaultBaseRules.hardCap),

    minimumSalary: safeNumber(existingBase.minimumSalary ?? top.minimumSalary ?? top.minSalary, defaultBaseRules.minimumSalary),
    minimumException: safeNumber(existingBase.minimumException ?? top.minimumException, defaultBaseRules.minimumException),
    veteranMinimum: safeNumber(existingBase.veteranMinimum ?? top.veteranMinimum ?? top.minimumException, defaultBaseRules.veteranMinimum),
    twoWaySalary: safeNumber(existingBase.twoWaySalary ?? top.twoWaySalary, defaultBaseRules.twoWaySalary),

    maxSalary: safeNumber(existingBase.maxSalary ?? top.maxSalary ?? top.maxContract ?? top.maxContractAmount, defaultBaseRules.maxSalary),
    roomException: safeNumber(existingBase.roomException ?? existingBase.roomMidLevel ?? top.roomException ?? top.roomMidLevel ?? top.roomExceptionAmount, defaultBaseRules.roomException),
    roomMidLevel: safeNumber(existingBase.roomMidLevel ?? existingBase.roomException ?? top.roomMidLevel ?? top.roomException ?? top.roomExceptionAmount, defaultBaseRules.roomMidLevel ?? defaultBaseRules.roomException),
    nonTaxpayerMLE: safeNumber(existingBase.nonTaxpayerMLE ?? existingBase.nonTaxpayerMidLevel ?? top.nonTaxpayerMLE ?? top.nonTaxpayerMidLevel ?? top.nonTaxpayerMidLevelException ?? top.midLevelException, defaultBaseRules.nonTaxpayerMLE),
    nonTaxpayerMidLevel: safeNumber(existingBase.nonTaxpayerMidLevel ?? existingBase.nonTaxpayerMLE ?? top.nonTaxpayerMidLevel ?? top.nonTaxpayerMLE ?? top.nonTaxpayerMidLevelException ?? top.midLevelException, defaultBaseRules.nonTaxpayerMidLevel ?? defaultBaseRules.nonTaxpayerMLE),
    midLevelException: safeNumber(existingBase.midLevelException ?? top.midLevelException ?? existingBase.nonTaxpayerMLE ?? top.nonTaxpayerMLE ?? top.nonTaxpayerMidLevelException, defaultBaseRules.midLevelException),
    taxpayerMLE: safeNumber(existingBase.taxpayerMLE ?? existingBase.taxpayerMidLevel ?? top.taxpayerMLE ?? top.taxpayerMidLevel ?? top.taxpayerMidLevelException, defaultBaseRules.taxpayerMLE),
    taxpayerMidLevel: safeNumber(existingBase.taxpayerMidLevel ?? existingBase.taxpayerMLE ?? top.taxpayerMidLevel ?? top.taxpayerMLE ?? top.taxpayerMidLevelException, defaultBaseRules.taxpayerMidLevel ?? defaultBaseRules.taxpayerMLE),

    rookiePick1Salary: safeNumber(existingBase.rookiePick1Salary, defaultBaseRules.rookiePick1Salary),
    rookieFirstRoundDecline: safeNumber(existingBase.rookieFirstRoundDecline, defaultBaseRules.rookieFirstRoundDecline),
    rookieFirstRoundFloor: safeNumber(existingBase.rookieFirstRoundFloor, defaultBaseRules.rookieFirstRoundFloor),
    rookieSecondRoundBase: safeNumber(existingBase.rookieSecondRoundBase, defaultBaseRules.rookieSecondRoundBase),
    rookieSecondRoundDecline: safeNumber(existingBase.rookieSecondRoundDecline, defaultBaseRules.rookieSecondRoundDecline),
    rookieSecondRoundFloor: safeNumber(existingBase.rookieSecondRoundFloor, defaultBaseRules.rookieSecondRoundFloor),
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
    minimumTeamSalary: scaled("minimumTeamSalary"),
    salaryFloor: scaled("minimumTeamSalary"),
    minimumTeamPayroll: scaled("minimumTeamSalary"),
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
    roomMidLevel: scaled("roomMidLevel"),
    roomExceptionAmount: scaled("roomException"),
    nonTaxpayerMLE: scaled("nonTaxpayerMLE"),
    nonTaxpayerMidLevel: scaled("nonTaxpayerMidLevel"),
    nonTaxpayerMidLevelException: scaled("nonTaxpayerMLE"),
    midLevelException: scaled("nonTaxpayerMLE"),
    taxpayerMLE: scaled("taxpayerMLE"),
    taxpayerMidLevel: scaled("taxpayerMidLevel"),
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
    minimumTeamSalary: resolvedRules.minimumTeamSalary,
    salaryFloor: resolvedRules.minimumTeamSalary,
    minimumTeamPayroll: resolvedRules.minimumTeamSalary,
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
    roomMidLevel: resolvedRules.roomMidLevel,
    roomExceptionAmount: resolvedRules.roomException,
    midLevelException: resolvedRules.midLevelException,
    nonTaxpayerMLE: resolvedRules.nonTaxpayerMLE,
    nonTaxpayerMidLevel: resolvedRules.nonTaxpayerMidLevel,
    nonTaxpayerMidLevelException: resolvedRules.nonTaxpayerMidLevelException,
    taxpayerMLE: resolvedRules.taxpayerMLE,
    taxpayerMidLevel: resolvedRules.taxpayerMidLevel,
    taxpayerMidLevelException: resolvedRules.taxpayerMLE,
  };
}

export function ensureLeagueFinancials(leagueData = {}, options = {}) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;

  const existing = leagueData.financials && typeof leagueData.financials === "object"
    ? leagueData.financials
    : {};

  const baseSeasonYear = validSeasonYear(
    existing.baseSeasonYear ?? options.baseSeasonYear ?? getCurrentFinancialSeasonYear(leagueData),
    DEFAULT_BASE_SEASON_YEAR
  );
  const currentFinancialSeasonYear = validSeasonYear(
    existing.currentSeasonYear ??
      existing.currentFinancialSeasonYear ??
      leagueData.currentFinancialSeasonYear ??
      existing.appliedThroughSeasonYear ??
      existing.appliedInflationThroughSeason ??
      options.currentFinancialSeasonYear ??
      getCurrentFinancialSeasonYear(leagueData),
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
      minimumTeamSalary: rules.minimumTeamSalary,
      firstApron: rules.firstApron,
      secondApron: rules.secondApron,
      minimumSalary: rules.minimumSalary,
      minimumException: rules.minimumException,
      maxSalary: rules.maxSalary,
      midLevelException: rules.midLevelException,
      nonTaxpayerMLE: rules.nonTaxpayerMLE,
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
      minimumTeamSalary: rules.minimumTeamSalary,
      firstApron: rules.firstApron,
      secondApron: rules.secondApron,
      hardCap: rules.hardCap,
      minimumSalary: rules.minimumSalary,
      minimumException: rules.minimumException,
      veteranMinimum: rules.veteranMinimum,
      maxSalary: rules.maxSalary,
      midLevelException: rules.midLevelException,
      nonTaxpayerMLE: rules.nonTaxpayerMLE,
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
