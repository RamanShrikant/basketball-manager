import { getLeagueFinancialRules, getRookieSalaryForPick } from "./leagueFinancials.js";

const TWO_WAY_TYPES = new Set(["two_way", "two-way"]);
const STASH_TYPES = new Set(["stash", "stashed", "draft_stash", "g_league_stash", "overseas_stash"]);

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getContractType(player) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  return String(
    player?.contractType ||
      player?.rosterStatus ||
      contract?.type ||
      "standard"
  ).toLowerCase();
}

function getOperatingSeasonYear(leagueData) {
  const seasonYear = safeNumber(
    leagueData?.seasonYear ??
      leagueData?.currentSeasonYear ??
      leagueData?.seasonStartYear,
    2025
  );
  return seasonYear + 1;
}

function getDevelopmentStartYear(player, fallbackYear) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const twoWayMeta = player?.twoWayMeta && typeof player.twoWayMeta === "object" ? player.twoWayMeta : {};
  const stashMeta = player?.stashMeta && typeof player.stashMeta === "object" ? player.stashMeta : {};

  return safeNumber(
    twoWayMeta?.currentTwoWaySeasonYear ??
      twoWayMeta?.assignedSeasonYear ??
      stashMeta?.returnEligibleSeasonYear ??
      stashMeta?.stashSeasonYear ??
      contract?.startYear,
    fallbackYear
  );
}

function normalizeDevelopmentPlayer(player, type, operatingSeasonYear) {
  if (!player || typeof player !== "object") return player;

  const startYear = getDevelopmentStartYear(player, operatingSeasonYear);
  const isTwoWay = TWO_WAY_TYPES.has(type);
  const oldTwoWayMeta = player?.twoWayMeta && typeof player.twoWayMeta === "object"
    ? player.twoWayMeta
    : {};
  const twoWayYearsUsed = Math.max(
    1,
    Math.min(3, safeNumber(oldTwoWayMeta?.twoWayYearsUsed ?? player?.twoWayYearsUsed, 1))
  );
  const nextTwoWayMeta = isTwoWay
    ? {
        ...oldTwoWayMeta,
        currentTwoWaySeasonYear: safeNumber(
          oldTwoWayMeta?.currentTwoWaySeasonYear ?? startYear,
          startYear
        ),
        twoWayYearsUsed,
        maxTwoWayYears: 3,
      }
    : null;

  const nextContract = {
    ...(player?.contract && typeof player.contract === "object" ? player.contract : {}),
    type: isTwoWay ? "two_way" : "stash",
    startYear,
    salaryByYear: [],
    option: null,
    countsAgainstStandardRoster: false,
    countsAgainstSalaryCap: false,
  };

  const oldContract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const contractChanged =
    String(oldContract?.type || "").toLowerCase() !== nextContract.type ||
    safeNumber(oldContract?.startYear, startYear) !== startYear ||
    !Array.isArray(oldContract?.salaryByYear) ||
    oldContract.salaryByYear.length !== 0 ||
    oldContract?.option != null ||
    oldContract?.countsAgainstStandardRoster !== false ||
    oldContract?.countsAgainstSalaryCap !== false;

  const expectedContractType = isTwoWay ? "two_way" : "stash";
  const expectedRosterStatus = isTwoWay ? "two_way" : "stashed";
  const expectedAssignment = isTwoWay ? "g_league" : "stash";

  const metadataChanged =
    String(player?.contractType || "").toLowerCase() !== expectedContractType ||
    String(player?.rosterStatus || "").toLowerCase() !== expectedRosterStatus ||
    String(player?.assignmentStatus || "").toLowerCase() !== expectedAssignment ||
    Boolean(player?.isTwoWay) !== isTwoWay ||
    Boolean(player?.isStash) !== !isTwoWay ||
    (isTwoWay && safeNumber(oldTwoWayMeta?.maxTwoWayYears, 0) !== 3) ||
    (isTwoWay && safeNumber(oldTwoWayMeta?.twoWayYearsUsed, twoWayYearsUsed) !== twoWayYearsUsed);

  if (!contractChanged && !metadataChanged) return player;

  return {
    ...player,
    contract: nextContract,
    contractType: expectedContractType,
    rosterStatus: expectedRosterStatus,
    assignmentStatus: expectedAssignment,
    isTwoWay,
    isStash: !isTwoWay,
    ...(isTwoWay
      ? {
          twoWayMeta: nextTwoWayMeta,
          twoWayYearsUsed,
          maxTwoWayYears: 3,
        }
      : {}),
  };
}

function isLegacyTinyTwoWayPromotion(player, leagueData, operatingSeasonYear) {
  if (!player || typeof player !== "object") return false;

  const type = getContractType(player);
  if (type !== "standard") return false;

  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract?.salaryByYear)
    ? contract.salaryByYear.map((value) => safeNumber(value, 0))
    : [];
  if (!salaries.length || salaries.some((salary) => salary <= 0)) return false;

  const sourceText = [
    contract?.source,
    player?.meta?.rookieSigningDecision,
    player?.meta?.acquiredVia,
    player?.twoWayMeta?.source,
    player?.previousContract?.type,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!sourceText.includes("two_way") && !sourceText.includes("two-way")) return false;

  const rules = getLeagueFinancialRules(leagueData || {}, operatingSeasonYear);
  const twoWayReference = Math.max(1, safeNumber(rules?.twoWaySalary, 580_000));
  const tinyThreshold = Math.max(1_000_000, Math.round(twoWayReference * 1.5));

  return salaries.every((salary) => salary <= tinyThreshold);
}

function buildStandardRookieContract(leagueData, player, startYear) {
  const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
  const round = safeNumber(meta?.draftRound ?? player?.draftRound, 0);
  const pick = Math.max(1, safeNumber(meta?.draftPick ?? player?.draftPick, 60));
  const rules = getLeagueFinancialRules(leagueData || {}, startYear);

  if (round === 1) {
    const firstSalary = getRookieSalaryForPick(leagueData || {}, 1, pick, startYear);
    return {
      type: "standard",
      startYear,
      salaryByYear: [
        firstSalary,
        Math.round(firstSalary * 1.05),
        Math.round(firstSalary * 1.1),
        Math.round(firstSalary * 1.22),
      ],
      option: {
        type: "team",
        yearIndices: [2, 3],
        picked: null,
      },
      source: "legacy_two_way_standard_salary_repair",
      countsAgainstStandardRoster: true,
      countsAgainstSalaryCap: true,
    };
  }

  if (round === 2) {
    const firstSalary = getRookieSalaryForPick(leagueData || {}, 2, pick, startYear);
    return {
      type: "standard",
      startYear,
      salaryByYear: [firstSalary, Math.round(firstSalary * 1.08)],
      option: null,
      source: "legacy_two_way_standard_salary_repair",
      countsAgainstStandardRoster: true,
      countsAgainstSalaryCap: true,
    };
  }

  const minimum = safeNumber(
    rules?.minimumException || rules?.veteranMinimum || rules?.minimumSalary,
    1_500_000
  );
  return {
    type: "standard",
    startYear,
    salaryByYear: [minimum],
    option: null,
    source: "legacy_two_way_standard_salary_repair",
    countsAgainstStandardRoster: true,
    countsAgainstSalaryCap: true,
  };
}

function repairLegacyPromotedPlayer(player, leagueData, operatingSeasonYear) {
  if (!isLegacyTinyTwoWayPromotion(player, leagueData, operatingSeasonYear)) return player;

  const oldContract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const startYear = safeNumber(oldContract?.startYear, operatingSeasonYear);
  const repairedContract = buildStandardRookieContract(leagueData, player, startYear);

  return {
    ...player,
    contract: repairedContract,
    contractType: "standard",
    rosterStatus: "standard",
    assignmentStatus: "nba",
    isTwoWay: false,
    isStash: false,
    previousDevelopmentContract: {
      ...oldContract,
      salaryByYear: Array.isArray(oldContract?.salaryByYear)
        ? [...oldContract.salaryByYear]
        : [],
    },
    meta: {
      ...(player?.meta && typeof player.meta === "object" ? player.meta : {}),
      developmentContractSalaryRepaired: true,
      developmentContractSalaryRepairSeasonYear: operatingSeasonYear,
    },
  };
}

function normalizeTeam(team, leagueData, operatingSeasonYear) {
  if (!team || typeof team !== "object") return team;

  let changed = false;

  const players = (Array.isArray(team?.players) ? team.players : []).map((player) => {
    const repaired = repairLegacyPromotedPlayer(player, leagueData, operatingSeasonYear);
    if (repaired !== player) changed = true;
    return repaired;
  });

  const twoWayPlayers = (Array.isArray(team?.twoWayPlayers) ? team.twoWayPlayers : []).map((player) => {
    const normalized = normalizeDevelopmentPlayer(player, "two_way", operatingSeasonYear);
    if (normalized !== player) changed = true;
    return normalized;
  });

  const stashPlayers = (Array.isArray(team?.stashPlayers) ? team.stashPlayers : []).map((player) => {
    const normalized = normalizeDevelopmentPlayer(player, "stash", operatingSeasonYear);
    if (normalized !== player) changed = true;
    return normalized;
  });

  if (!changed) return team;
  return {
    ...team,
    players,
    twoWayPlayers,
    stashPlayers,
  };
}

export function normalizeDevelopmentContracts(leagueData) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;

  const operatingSeasonYear = getOperatingSeasonYear(leagueData);
  let changed = false;

  if (Array.isArray(leagueData?.teams)) {
    const teams = leagueData.teams.map((team) => {
      const normalized = normalizeTeam(team, leagueData, operatingSeasonYear);
      if (normalized !== team) changed = true;
      return normalized;
    });
    return changed ? { ...leagueData, teams } : leagueData;
  }

  const conferences = leagueData?.conferences;
  if (!conferences || typeof conferences !== "object") return leagueData;

  const nextConferences = {};
  for (const [conferenceName, teams] of Object.entries(conferences)) {
    nextConferences[conferenceName] = (Array.isArray(teams) ? teams : []).map((team) => {
      const normalized = normalizeTeam(team, leagueData, operatingSeasonYear);
      if (normalized !== team) changed = true;
      return normalized;
    });
  }

  return changed ? { ...leagueData, conferences: nextConferences } : leagueData;
}
