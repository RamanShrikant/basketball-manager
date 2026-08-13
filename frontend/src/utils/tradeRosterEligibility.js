import {
  getOffseasonTradeContext,
  isOffseasonTradeProjectionPlayer,
} from "./offseasonTradeContext.js";

function normalized(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getOptionYearIndices(option = {}) {
  if (!option || typeof option !== "object") return [];
  const raw = Array.isArray(option.yearIndices)
    ? option.yearIndices
    : option.yearIndex !== undefined && option.yearIndex !== null
      ? [option.yearIndex]
      : [];
  return raw.map(Number).filter((value) => Number.isFinite(value) && value >= 0);
}

function getOptionDecision(option = {}, yearIndex) {
  const picked = option?.picked;
  if (picked && typeof picked === "object" && !Array.isArray(picked)) {
    if (Object.prototype.hasOwnProperty.call(picked, String(yearIndex))) return picked[String(yearIndex)];
    if (Object.prototype.hasOwnProperty.call(picked, "default")) return picked.default;
    return null;
  }
  return picked ?? null;
}

function isPendingUnsignedRookie(player = {}) {
  const tokens = [
    player?.rosterStatus,
    player?.assignmentStatus,
    player?.status,
    player?.contractType,
    player?.meta?.rookieSigningDecision,
    player?.meta?.rookieSigningPending,
  ].map(normalized);

  return Boolean(
    player?.rookieSigningPending ||
      player?.pendingRookieSigning ||
      tokens.some((token) => token === "rookie_pending" || token === "unsigned_rookie" || token.includes("rookie_pending"))
  );
}

export function isDevelopmentRosterPlayer(player = {}) {
  if (!player || typeof player !== "object") return false;

  if (player.isTwoWay || player.isStash || player.twoWay || player.stash) return true;

  const contract = player.contract && typeof player.contract === "object" ? player.contract : {};
  const meta = player.meta && typeof player.meta === "object" ? player.meta : {};
  const development = player.development && typeof player.development === "object" ? player.development : {};

  const statusTokens = [
    player.contractType,
    player.rosterStatus,
    player.assignmentStatus,
    player.status,
    contract.type,
    contract.contractType,
    contract.rosterStatus,
    meta.contractType,
    meta.rosterStatus,
    meta.assignmentStatus,
    meta.rookieSigningDecision,
    development.status,
    development.assignment,
  ].map(normalized);

  return statusTokens.some((token) =>
    token === "two_way" ||
    token.includes("two_way") ||
    token === "stash" ||
    token === "stashed" ||
    token.includes("draft_stash") ||
    token.includes("overseas_stash")
  );
}

export function isStandardTradeEligiblePlayer(player = {}) {
  return Boolean(player && typeof player === "object" && !isDevelopmentRosterPlayer(player));
}

export function getOffseasonGuaranteedContractStatus(player = {}, { leagueData = {}, tradeContext = null } = {}) {
  const context = getOffseasonTradeContext(leagueData, tradeContext);
  if (!context.inOffseason) return { eligible: isStandardTradeEligiblePlayer(player), code: "REGULAR_SEASON" };

  if (!player || typeof player !== "object") {
    return { eligible: false, code: "INVALID_PLAYER", reason: "Player data is unavailable." };
  }
  if (isDevelopmentRosterPlayer(player)) {
    return { eligible: false, code: "DEVELOPMENT_ROSTER", reason: "Two-way and stashed players cannot be traded." };
  }
  if (isOffseasonTradeProjectionPlayer(player)) {
    return { eligible: false, code: "PROJECTED_ONLY", reason: "This player is projected to return but is not under a guaranteed contract." };
  }
  if (isPendingUnsignedRookie(player)) {
    return { eligible: false, code: "UNSIGNED_ROOKIE", reason: "The rookie must sign his contract before he can be traded." };
  }
  if (player?.retired || normalized(player?.status) === "retired") {
    return { eligible: false, code: "RETIRED", reason: "Retired players cannot be traded." };
  }

  const contract = player?.contract && typeof player.contract === "object" ? player.contract : null;
  const salaries = Array.isArray(contract?.salaryByYear)
    ? contract.salaryByYear.map((value) => Math.max(0, toNum(value, 0)))
    : [];
  const startYear = Number(contract?.startYear);
  const targetSeasonYear = Number(context.targetSeasonYear || context.seasonYear + 1);

  if (!contract || !salaries.length || !Number.isFinite(startYear)) {
    return { eligible: false, code: "NO_GUARANTEED_CONTRACT", reason: "No guaranteed contract is recorded for next season." };
  }

  const targetIndex = targetSeasonYear - startYear;
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= salaries.length || salaries[targetIndex] <= 0) {
    return { eligible: false, code: "EXPIRING_CONTRACT", reason: "The player's contract does not include guaranteed salary for next season." };
  }

  const option = contract?.option && typeof contract.option === "object" ? contract.option : null;
  if (option && getOptionYearIndices(option).includes(targetIndex)) {
    const decision = getOptionDecision(option, targetIndex);
    if (decision === false) {
      return { eligible: false, code: "DECLINED_OPTION", reason: "The option was declined and the player is not under contract." };
    }
    if (decision !== true) {
      const optionType = normalized(option?.type);
      return {
        eligible: false,
        code: optionType === "player" ? "PENDING_PLAYER_OPTION" : "PENDING_TEAM_OPTION",
        reason: `${optionType === "player" ? "Player" : "Team"} option must be resolved before this player can be traded.`,
      };
    }
  }

  return {
    eligible: true,
    code: "GUARANTEED_NEXT_SEASON",
    targetSeasonYear,
    salary: salaries[targetIndex],
  };
}

export function getTradePlayerEligibility(player = {}, options = {}) {
  const { leagueData = {}, tradeContext = null, inOffseason = null } = options || {};

  // CPU trade validation already has an authoritative phase from the Calendar
  // simulation loop. Respect an explicit regular-season phase instead of
  // re-inferring it from stale offseason/draft browser storage. This prevents
  // Year-2+ regular-season candidates from being rejected by offseason-only
  // guaranteed-contract and unresolved-option rules.
  if (inOffseason === false) {
    return isStandardTradeEligiblePlayer(player)
      ? { eligible: true, code: "STANDARD_ROSTER" }
      : { eligible: false, code: "DEVELOPMENT_ROSTER", reason: "Only standard-roster players can be traded." };
  }

  const context = getOffseasonTradeContext(leagueData, tradeContext);
  if (!context.inOffseason) {
    return isStandardTradeEligiblePlayer(player)
      ? { eligible: true, code: "STANDARD_ROSTER" }
      : { eligible: false, code: "DEVELOPMENT_ROSTER", reason: "Only standard-roster players can be traded." };
  }
  return getOffseasonGuaranteedContractStatus(player, { leagueData, tradeContext: context });
}

export function filterStandardTradePlayers(players = []) {
  return (Array.isArray(players) ? players : []).filter(isStandardTradeEligiblePlayer);
}

export function filterTradeEligiblePlayers(players = [], options = {}) {
  return (Array.isArray(players) ? players : []).filter((player) => getTradePlayerEligibility(player, options).eligible);
}

export function sanitizeTradeItems(items = [], options = {}) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (item?.type !== "player") return true;
    return getTradePlayerEligibility(item.player, options).eligible;
  });
}

export function findIneligibleTradePlayer(items = [], options = {}) {
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.type !== "player") continue;
    const eligibility = getTradePlayerEligibility(item.player, options);
    if (!eligibility.eligible) return { item, eligibility };
  }
  return null;
}
