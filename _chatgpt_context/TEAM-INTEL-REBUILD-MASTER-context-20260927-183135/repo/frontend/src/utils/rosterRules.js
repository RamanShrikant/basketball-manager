// Central roster rules shared by trades, Trade Finder, diagnostics, and simulation.
// Regular-season game readiness is 14-15 standard contracts. Trades may
// temporarily reach 16 standard contracts, or one more than the team already
// carries when an old/temporary save is already at 16+.
export const ROSTER_RULES_VERSION = "2026-07-24_asymmetric_trade_roster_v2";
export const REGULAR_SEASON_MIN_STANDARD_PLAYERS = 14;
export const REGULAR_SEASON_MAX_STANDARD_PLAYERS = 15;
export const TRADE_TEMPORARY_STANDARD_ROSTER_MAX = 16;
export const REGULAR_SEASON_MAX_TWO_WAY_PLAYERS = 3;

export function isPlayerTradeItem(item) {
  return Boolean(item?.type === "player" && item.player);
}

export function countTradePlayers(items = []) {
  return (Array.isArray(items) ? items : []).filter(isPlayerTradeItem).length;
}

function rosterContractType(player = {}) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  return String(
    player?.contractType ||
      player?.rosterStatus ||
      contract?.type ||
      contract?.contractType ||
      "standard"
  ).toLowerCase().replace(/-/g, "_");
}

export function isStandardRosterPlayer(player = {}) {
  if (!player || !(player.name || player.player || player.id || player.playerId)) return false;
  if (player?.isTwoWay || player?.isStash) return false;
  const type = rosterContractType(player);
  return !(
    type.includes("two_way") ||
    type.includes("stash") ||
    type.includes("draft_rights") ||
    type.includes("unsigned_rookie") ||
    type.includes("rookie_pending")
  );
}

export function countStandardRosterPlayers(team = {}) {
  return (Array.isArray(team?.players) ? team.players : []).filter(isStandardRosterPlayer).length;
}

export function countTwoWayRosterPlayers(team = {}) {
  return (Array.isArray(team?.twoWayPlayers) ? team.twoWayPlayers : []).filter(
    (player) => player && (player.name || player.player || player.id || player.playerId)
  ).length;
}

export function projectStandardRosterCount(team, outgoingItems = [], incomingItems = []) {
  const current = countStandardRosterPlayers(team);
  const outgoingPlayers = countTradePlayers(outgoingItems);
  const incomingPlayers = countTradePlayers(incomingItems);
  return {
    current,
    outgoingPlayers,
    incomingPlayers,
    projected: current - outgoingPlayers + incomingPlayers,
  };
}

export function getAllowedTradeRosterMax(team = {}) {
  const current = countStandardRosterPlayers(team);

  // The normal temporary transaction ceiling is 16. A team already carrying
  // 16+ standard players may still complete a deal that adds at most one net
  // standard contract, then it must repair the roster before simulating.
  return Math.max(TRADE_TEMPORARY_STANDARD_ROSTER_MAX, current + 1);
}

export function evaluateTradeRosterProjection({
  team,
  outgoingItems = [],
  incomingItems = [],
  inOffseason = false,
} = {}) {
  const teamName = team?.name || team?.teamName || "Unknown Team";
  const counts = projectStandardRosterCount(team, outgoingItems, incomingItems);
  const allowedMax = getAllowedTradeRosterMax(team);
  const belowMinimumBy = Math.max(
    0,
    REGULAR_SEASON_MIN_STANDARD_PLAYERS - counts.projected
  );
  const aboveSimulationMaximumBy = Math.max(
    0,
    counts.projected - REGULAR_SEASON_MAX_STANDARD_PLAYERS
  );
  const overTradeMaximumBy = Math.max(0, counts.projected - allowedMax);

  // Unequal player counts are legal. A team may temporarily finish below 14 or
  // above 15, but it must repair before the next game. Only exceeding the
  // transaction ceiling blocks the trade itself.
  const ok = Boolean(inOffseason || overTradeMaximumBy === 0);
  const requiresRepairBeforeSimulation = Boolean(
    !inOffseason && (belowMinimumBy > 0 || aboveSimulationMaximumBy > 0)
  );

  return {
    ok,
    teamName,
    inOffseason: Boolean(inOffseason),
    counts,
    allowedMax,
    belowMinimumBy,
    aboveSimulationMaximumBy,
    overTradeMaximumBy,
    requiresRepairBeforeSimulation,
    reason: ok
      ? ""
      : `Trade blocked: ${teamName} would have ${counts.projected} standard players after this trade. The temporary trade limit is ${allowedMax} (16, or one more than the team already carries).`,
  };
}

export function evaluateTeamSimulationRoster(team = {}) {
  const teamName = team?.name || team?.teamName || "Unknown Team";
  const standardCount = countStandardRosterPlayers(team);
  const twoWayCount = countTwoWayRosterPlayers(team);
  const pendingRookieCount = Array.isArray(team?.pendingRookieSignings)
    ? team.pendingRookieSignings.filter(Boolean).length
    : 0;
  const issues = [];

  if (pendingRookieCount > 0) {
    issues.push({
      code: "pending_rookies",
      count: pendingRookieCount,
      message: `Pending rookie signings: ${pendingRookieCount} unresolved — resolve rookie signings first.`,
    });
  }

  if (standardCount < REGULAR_SEASON_MIN_STANDARD_PLAYERS) {
    const amount = REGULAR_SEASON_MIN_STANDARD_PLAYERS - standardCount;
    issues.push({
      code: "standard_roster_below_minimum",
      count: standardCount,
      amount,
      message: `Standard roster: ${standardCount} / ${REGULAR_SEASON_MIN_STANDARD_PLAYERS} minimum — sign ${amount} standard player${amount === 1 ? "" : "s"}.`,
    });
  }

  if (standardCount > REGULAR_SEASON_MAX_STANDARD_PLAYERS) {
    const amount = standardCount - REGULAR_SEASON_MAX_STANDARD_PLAYERS;
    issues.push({
      code: "standard_roster_above_maximum",
      count: standardCount,
      amount,
      message: `Standard roster: ${standardCount} / ${REGULAR_SEASON_MAX_STANDARD_PLAYERS} maximum — remove ${amount} standard player${amount === 1 ? "" : "s"}.`,
    });
  }

  if (twoWayCount > REGULAR_SEASON_MAX_TWO_WAY_PLAYERS) {
    const amount = twoWayCount - REGULAR_SEASON_MAX_TWO_WAY_PLAYERS;
    issues.push({
      code: "two_way_above_maximum",
      count: twoWayCount,
      amount,
      message: `Two-way roster: ${twoWayCount} / ${REGULAR_SEASON_MAX_TWO_WAY_PLAYERS} maximum — remove ${amount} two-way player${amount === 1 ? "" : "s"}.`,
    });
  }

  return {
    ok: issues.length === 0,
    teamName,
    standardCount,
    twoWayCount,
    pendingRookieCount,
    rules: {
      standardMin: REGULAR_SEASON_MIN_STANDARD_PLAYERS,
      standardMax: REGULAR_SEASON_MAX_STANDARD_PLAYERS,
      temporaryTradeMax: TRADE_TEMPORARY_STANDARD_ROSTER_MAX,
      twoWayMax: REGULAR_SEASON_MAX_TWO_WAY_PLAYERS,
    },
    issues,
    message: issues.length
      ? `${teamName} must fix the roster before simulating games. ${issues
          .map((issue) => issue.message)
          .join(" ")}`
      : "",
  };
}
