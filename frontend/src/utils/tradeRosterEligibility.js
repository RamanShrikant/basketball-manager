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

function hasPositiveSalaryContract(player = {}) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : null;
  const salaries = Array.isArray(contract?.salaryByYear) ? contract.salaryByYear : [];
  return Boolean(contract && salaries.some((value) => Math.max(0, toNum(value, 0)) > 0));
}

function hasStandardSalarySignal(player = {}) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : null;
  const salaries = Array.isArray(contract?.salaryByYear) ? contract.salaryByYear : [];
  const maxSalary = salaries.reduce((max, value) => Math.max(max, toNum(value, 0)), 0);
  return maxSalary >= 1_500_000;
}

function hasExplicitStandardRosterSignal(player = {}) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
  const tokens = [
    player?.contractType,
    player?.rosterStatus,
    player?.assignmentStatus,
    player?.status,
    contract?.type,
    contract?.contractType,
    contract?.rosterStatus,
    meta?.contractType,
    meta?.rosterStatus,
    meta?.assignmentStatus,
  ].map(normalized);

  return tokens.some((token) =>
    token === "standard" ||
    token === "standard_contract" ||
    token === "nba_standard" ||
    token === "active_roster" ||
    token === "roster"
  );
}

export function isDevelopmentRosterPlayer(player = {}) {
  if (!player || typeof player !== "object") return false;

  // Patch 29: a player who is now on a real standard contract should not stay
  // permanently trade-hidden because old two-way/stash flags survived a free
  // agency signing or rookie conversion. Current explicit development markers
  // still win, but a positive standard-contract signal clears stale booleans.
  if ((player.isTwoWay || player.isStash || player.twoWay || player.stash) && hasPositiveSalaryContract(player) && (hasExplicitStandardRosterSignal(player) || hasStandardSalarySignal(player))) {
    return false;
  }

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
    return { eligible: false, code: "NO_GUARANTEED_CONTRACT", reason: "No active standard contract is recorded." };
  }

  // Draft-day trades occur before this game's Options phase and before the
  // Free Agency/new-contract state takes over. During that window a player's
  // CURRENT contract is the authoritative trade asset: an unresolved player
  // option, unresolved team option, or contract expiring at the upcoming
  // rollover can still be traded and the option/contract rights travel with
  // him. The previous implementation looked ahead to targetSeasonYear too
  // early, causing valid draft-day players to disappear from Propose Trade.
  //
  // Old embedded offseason contexts may predate `optionsComplete`, so the
  // Free Agency stages also count as post-options for backwards safety.
  const optionsResolved = Boolean(
    context?.optionsComplete ||
      context?.stage === "free_agency" ||
      context?.stage === "post_free_agency"
  );

  if (!optionsResolved) {
    // Draft/pre-options rule: if a standard-roster player still carries a real
    // contract on the roster, he is tradeable. Expiring contracts and
    // unresolved player/team options are intentionally allowed here; they are
    // resolved later in the normal Options/Free Agency flow. Do NOT require a
    // salary slot for the incoming season before the draft.
    const lastPositiveSalary = [...salaries].reverse().find((value) => value > 0) || 0;
    if (lastPositiveSalary <= 0) {
      return {
        eligible: false,
        code: "NO_ACTIVE_ROSTER_CONTRACT",
        reason: "No active standard contract is recorded for this roster player.",
      };
    }

    const option = contract?.option && typeof contract.option === "object" ? contract.option : null;
    const optionType = normalized(option?.type);
    const unresolvedOptionTransfers = Boolean(
      option &&
        (optionType === "player" || optionType === "team") &&
        getOptionDecision(option, getOptionYearIndices(option).slice(-1)[0]) == null
    );

    return {
      eligible: true,
      code: "PRE_DRAFT_ROSTER_CONTRACT",
      salary: lastPositiveSalary,
      unresolvedOptionTransfers,
    };
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
