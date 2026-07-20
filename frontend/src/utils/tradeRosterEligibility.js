function normalized(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
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

export function filterStandardTradePlayers(players = []) {
  return (Array.isArray(players) ? players : []).filter(isStandardTradeEligiblePlayer);
}

export function sanitizeTradeItems(items = []) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (item?.type !== "player") return true;
    return isStandardTradeEligiblePlayer(item.player);
  });
}
