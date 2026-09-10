// Read-only display resolution. Never feed projected trade ratings back into saves.
const idOf = (p) => String(p?.id ?? p?.playerId ?? "");
const nameOf = (p) => String(p?.name ?? p?.playerName ?? (typeof p?.player === "string" ? p.player : "")).trim().toLowerCase();
const present = (v) => v !== undefined && v !== null && v !== "" && v !== "-";

export function normalizePlayerDisplay(player) {
  if (!player || typeof player !== "object") return null;
  const p = { ...player };
  for (const [key, aliases] of Object.entries({ name: ["playerName"], pos: ["position"], position: ["pos"], overall: ["ovr"], potential: ["pot"], height: ["heightInches", "height_inches"] })) {
    if (!present(p[key])) p[key] = aliases.map((alias) => player[alias]).find(present) ?? p[key];
  }
  return p;
}

export function createPlayerResolver(leagueData = {}) {
  const teams = Array.isArray(leagueData?.teams) ? leagueData.teams : Object.values(leagueData?.conferences || {}).flat();
  const entries = [];
  const add = (pool, teamName, live = true) => {
    for (const player of Array.isArray(pool) ? pool : []) {
      if (player && typeof player === "object") entries.push({ player, teamName, live });
    }
  };
  for (const team of teams) {
    for (const key of ["players", "twoWayPlayers", "stashPlayers", "pendingRookieSignings"]) add(team?.[key], team?.name || team?.teamName);
  }
  add(leagueData?.freeAgents, "Free Agent");
  add(leagueData?.retiredPlayers, null);
  // Pending rows may be all that remains after a free agent chooses an offer.
  for (const key of ["pendingUserDecisions", "pendingRfaMatchDecisions"]) {
    add((leagueData?.freeAgencyState?.[key] || []).map((row) => row?.player).filter(Boolean), "Free Agent", false);
  }
  const byId = new Map();
  const byName = new Map();
  for (const entry of entries) {
    const id = idOf(entry.player), name = nameOf(entry.player);
    if (id) { if (!byId.has(id)) byId.set(id, []); byId.get(id).push(entry); }
    if (name) { if (!byName.has(name)) byName.set(name, []); byName.get(name).push(entry); }
  }
  return (reference) => {
    if (!reference) return null;
    const ref = typeof reference === "object" ? reference : { id: reference };
    const embedded = ref.player && typeof ref.player === "object" ? ref.player : ref;
    const playerId = embedded === ref
      ? ref.playerId ?? ref.id
      : embedded.id ?? embedded.playerId ?? ref.playerId;
    const seed = { ...embedded, id: playerId, name: embedded.name ?? ref.playerName ?? ref.name };
    const id = idOf(seed), name = nameOf(seed);
    let matches = id ? byId.get(id) || [] : [];
    if (!matches.length && name) {
      const named = (byName.get(name) || []).filter((entry) => !id || !idOf(entry.player) || idOf(entry.player) === id);
      const ids = new Set(named.map((entry) => idOf(entry.player)).filter(Boolean));
      if (ids.size <= 1) matches = named;
    }
    const current = matches[0];
    if (!current) return normalizePlayerDisplay(seed);
    const result = normalizePlayerDisplay(current.player);
    // Fill missing bio/history only. Empty live history and explicit null contracts
    // are authoritative; transaction snapshots cannot overwrite current state.
    for (const fallback of [...matches.slice(1).map((entry) => entry.player), seed]) {
      for (const key of ["name", "pos", "position", "height", "heightInches", "height_inches", "headshot", "history", "careerStats", "seasonHistory", "awards", "accolades"]) {
        if (result[key] === undefined && fallback[key] !== undefined) result[key] = fallback[key];
      }
    }
    if (current.teamName) result.teamName = current.teamName;
    return normalizePlayerDisplay(result);
  };
}

export function getCanonicalPlayer(leagueData, reference) {
  return createPlayerResolver(leagueData)(reference);
}

export function formatPlayerHeight(value) {
  if (value === null || value === undefined || value === "") return "—";
  const inches = Number(value);
  return Number.isFinite(inches) && inches >= 48 && inches <= 100
    ? Math.floor(inches / 12) + "'" + Math.round(inches % 12) + '"'
    : String(value);
}
