import { getLeagueFinancialRules } from "./leagueFinancials.js";
import { getFinancialSeasonYear, getSeasonStartYear } from "./seasonContext.js";

export const STANDARD_FREE_AGENT_RAISE_PCT = 0.05;
export const BIRD_FREE_AGENT_RAISE_PCT = 0.08;
export const OFFICIAL_2026_27_SALARY_CAP = 164_961_000;

const PLAYER_MINIMUM_BASE_SCALE = Object.freeze({
  rookie: 1_300_000,
  one: 1_900_000,
  two: 2_200_000,
  threeToFive: 2_500_000,
  sixToNine: 2_900_000,
  tenPlus: 3_300_000,
});

function numberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value, nearest = 1_000) {
  const base = Math.max(1, Number(nearest) || 1);
  return Math.round((Number(value) || 0) / base) * base;
}

function normalizeBirdLevel(raw, seasonsTowardBird = 0) {
  const level = String(raw || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_")
    .replaceAll(" ", "_");

  if (["bird", "full_bird", "fullbird", "bird_rights"].includes(level)) return "bird";
  if (["early_bird", "earlybird"].includes(level)) return "early_bird";
  if (["non_bird", "nonbird"].includes(level)) return "non_bird";

  const seasons = Math.max(0, Math.round(numberOr(seasonsTowardBird, 0)));
  if (seasons >= 3) return "bird";
  if (seasons === 2) return "early_bird";
  if (seasons === 1) return "non_bird";
  return "none";
}

export function getSalaryRuleServiceYears(player = {}, leagueData = {}) {
  const directKeys = [
    "proSeasons",
    "seasonsPro",
    "yearsPro",
    "yearsOfExperience",
    "yoe",
    "serviceYears",
  ];

  for (const source of [player, player?.meta || {}]) {
    for (const key of directKeys) {
      if (source?.[key] !== undefined && source?.[key] !== null && source?.[key] !== "") {
        return Math.max(0, Math.round(numberOr(source[key], 0)));
      }
    }
  }

  for (const source of [player, player?.meta || {}, player?.draft || {}]) {
    for (const key of ["draftYear", "yearDrafted", "draftedYear", "year"]) {
      const draftYear = Math.round(numberOr(source?.[key], 0));
      if (draftYear >= 2000 && draftYear <= 2100) {
        const seasonStartYear = Math.round(numberOr(getSeasonStartYear(leagueData), draftYear));
        return Math.max(0, seasonStartYear - draftYear);
      }
    }
  }

  return Math.max(0, Math.min(25, Math.round(numberOr(player?.age, 19)) - 19));
}

export function getPlayerMaximumSalary(leagueData = {}, player = {}) {
  const financialRules = getLeagueFinancialRules(leagueData, getFinancialSeasonYear(leagueData));
  const salaryCap = numberOr(financialRules?.salaryCap, OFFICIAL_2026_27_SALARY_CAP);
  const serviceYears = getSalaryRuleServiceYears(player, leagueData);
  const percent = serviceYears >= 10 ? 0.35 : serviceYears >= 7 ? 0.30 : 0.25;

  return {
    amount: roundMoney(salaryCap * percent),
    percent,
    serviceYears,
  };
}

export function getPlayerMinimumSalary(leagueData = {}, player = {}) {
  const financialRules = getLeagueFinancialRules(leagueData, getFinancialSeasonYear(leagueData));
  const salaryCap = numberOr(financialRules?.salaryCap, OFFICIAL_2026_27_SALARY_CAP);
  const serviceYears = getSalaryRuleServiceYears(player, leagueData);

  let baseAmount = PLAYER_MINIMUM_BASE_SCALE.rookie;
  if (serviceYears >= 10) baseAmount = PLAYER_MINIMUM_BASE_SCALE.tenPlus;
  else if (serviceYears >= 6) baseAmount = PLAYER_MINIMUM_BASE_SCALE.sixToNine;
  else if (serviceYears >= 3) baseAmount = PLAYER_MINIMUM_BASE_SCALE.threeToFive;
  else if (serviceYears >= 2) baseAmount = PLAYER_MINIMUM_BASE_SCALE.two;
  else if (serviceYears >= 1) baseAmount = PLAYER_MINIMUM_BASE_SCALE.one;

  return {
    amount: roundMoney(baseAmount * Math.max(0.1, salaryCap / OFFICIAL_2026_27_SALARY_CAP)),
    serviceYears,
  };
}

function getLastContractSalary(player = {}) {
  for (const contract of [player?.previousContract, player?.contract]) {
    const salaries = Array.isArray(contract?.salaryByYear) ? contract.salaryByYear : [];
    if (salaries.length) return Math.max(0, numberOr(salaries[salaries.length - 1], 0));
  }
  return Math.max(0, numberOr(player?.marketValue?.expectedYear1Salary, 0));
}

function getRights(player = {}) {
  const rights = player?.rights && typeof player.rights === "object" ? player.rights : {};
  return {
    heldByTeam: rights.heldByTeam || null,
    birdLevel: normalizeBirdLevel(rights.birdLevel, rights.seasonsTowardBird),
    seasonsTowardBird: Math.max(0, Math.round(numberOr(rights.seasonsTowardBird, 0))),
    restrictedFreeAgent: Boolean(rights.restrictedFreeAgent),
  };
}

function getPathLimits(path) {
  if (path === "bird") return { label: "Full Bird", minYears: 1, maxYears: 5, maxRaisePct: 0.08 };
  if (path === "early_bird") return { label: "Early Bird", minYears: 2, maxYears: 4, maxRaisePct: 0.08 };
  if (path === "non_bird") return { label: "Non-Bird", minYears: 1, maxYears: 4, maxRaisePct: 0.05 };
  if (path === "room_exception") return { label: "Room MLE", minYears: 1, maxYears: 3, maxRaisePct: 0.05 };
  if (path === "taxpayer_mle") return { label: "Taxpayer MLE", minYears: 1, maxYears: 2, maxRaisePct: 0.05 };
  if (path === "non_taxpayer_mle") return { label: "Non-Taxpayer MLE", minYears: 1, maxYears: 4, maxRaisePct: 0.05 };
  if (path === "minimum") return { label: "Minimum", minYears: 1, maxYears: 2, maxRaisePct: 0.05 };
  return { label: "Cap Space", minYears: 1, maxYears: 4, maxRaisePct: 0.05 };
}

export function getFreeAgentContractRules({
  leagueData = {},
  player = {},
  teamName = "",
  dashboard = null,
  year1Salary = null,
} = {}) {
  const financialRules = getLeagueFinancialRules(leagueData, getFinancialSeasonYear(leagueData));
  const minimumInfo = getPlayerMinimumSalary(leagueData, player);
  const maximumInfo = getPlayerMaximumSalary(leagueData, player);
  const playerMinimumSalary = minimumInfo.amount;
  const playerMaximumSalary = maximumInfo.amount;
  const rights = getRights(player);
  const ownRights = Boolean(teamName && rights.heldByTeam === teamName && rights.birdLevel !== "none");
  const enteredSalary = Math.max(
    0,
    numberOr(
      year1Salary,
      player?.marketValue?.contractExpectedYear1Salary ||
        player?.marketValue?.expectedYear1Salary ||
        playerMinimumSalary
    )
  );

  const previousSalary = getLastContractSalary(player);
  const qualifyingOffer = numberOr(player?.qualifyingOffer?.amount, 0);

  let rightsCeiling = 0;
  if (ownRights) {
    if (rights.birdLevel === "bird") {
      rightsCeiling = playerMaximumSalary;
    } else if (rights.birdLevel === "early_bird") {
      rightsCeiling = Math.min(
        playerMaximumSalary,
        Math.max(
          playerMinimumSalary,
          previousSalary * 1.75,
          numberOr(financialRules?.nonTaxpayerMLE, 0) * 1.05
        )
      );
    } else if (rights.birdLevel === "non_bird") {
      rightsCeiling = Math.min(
        playerMaximumSalary,
        Math.max(
          playerMinimumSalary,
          playerMinimumSalary * 1.20,
          previousSalary * 1.20,
          qualifyingOffer
        )
      );
    }
  }

  // The offer builder should show the true player salary universe, not only the
  // team's currently-affordable path. Submit/evaluation still enforces cap room,
  // apron, exception, and rights limits and returns the same “over by $X” style
  // errors when the team cannot actually make the offer.
  let previewPath = "cap_space";
  if (ownRights && rights.birdLevel === "bird") {
    previewPath = "bird";
  } else if (ownRights && rights.birdLevel === "early_bird" && enteredSalary <= rightsCeiling) {
    previewPath = "early_bird";
  } else if (ownRights && rights.birdLevel === "non_bird" && enteredSalary <= rightsCeiling) {
    previewPath = "non_bird";
  } else if (enteredSalary <= playerMinimumSalary) {
    previewPath = "minimum";
  }

  const previewLimits = getPathLimits(previewPath);
  const maxYears = ownRights && rights.birdLevel === "bird" ? 5 : 4;
  const minYears = 1;
  const allowedYears = [];
  for (let year = minYears; year <= maxYears; year += 1) allowedYears.push(year);

  const payrollZone = String(dashboard?.payrollZone || "");
  const rawCapRoom = numberOr(
    dashboard?.rawCapRoomWithoutHolds ?? dashboard?.basicCapRoom ?? dashboard?.capSpace ?? dashboard?.capRoom,
    0
  );
  const practicalCapRoom = numberOr(dashboard?.practicalCapRoom, 0);
  const capHoldTotal = numberOr(dashboard?.capHoldTotal ?? dashboard?.capHolds, 0);

  return {
    path: previewPath,
    ...previewLimits,
    minYears,
    maxYears,
    allowedYears,
    minFirstYearSalary: playerMinimumSalary,
    maxFirstYearSalary: playerMaximumSalary,
    playerMinimumSalary,
    playerMaximumSalary,
    rightsCeiling: roundMoney(Math.max(0, rightsCeiling)),
    currentPathCeiling: previewPath === "minimum" ? playerMinimumSalary : roundMoney(Math.max(0, rightsCeiling || playerMaximumSalary)),
    maxSalaryPercent: maximumInfo.percent,
    serviceYears: maximumInfo.serviceYears,
    ownRights,
    rights,
    payrollZone,
    rawCapRoomWithoutHolds: rawCapRoom,
    practicalCapRoom,
    capHoldTotal,
    salaryUniverseMode: true,
    hasLegalSalaryRange: playerMaximumSalary >= playerMinimumSalary,
  };
}

export function buildLegalFreeAgentSalarySchedule(year1Salary, years, raisePct) {
  const firstYear = Math.max(0, numberOr(year1Salary, 0));
  const safeYears = Math.max(1, Math.min(5, Math.round(numberOr(years, 1))));
  const safeRaise = Math.max(0, Math.min(BIRD_FREE_AGENT_RAISE_PCT, numberOr(raisePct, 0)));

  return Array.from({ length: safeYears }, (_, index) =>
    roundMoney(firstYear * (1 + safeRaise * index))
  );
}
