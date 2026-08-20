import {
  REGULAR_SEASON_MAX_STANDARD_PLAYERS,
  REGULAR_SEASON_MAX_TWO_WAY_PLAYERS,
  countStandardRosterPlayers,
  countTwoWayRosterPlayers,
  isStandardRosterPlayer,
} from "./rosterRules.js";

const HIGH_VALUE_FREE_AGENT_OVR = 72;

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function intNumber(value, fallback = 0) {
  return Math.trunc(finiteNumber(value, fallback));
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, intNumber(value, min)));
}

function normalizeTeamName(value) {
  return String(value || "").trim();
}

function getSeasonKey(leagueData = {}) {
  return intNumber(
    leagueData?.seasonYear ??
      leagueData?.currentSeasonYear ??
      leagueData?.seasonStartYear,
    0
  );
}

function hashString(value = "") {
  let hash = 2166136261;
  const source = String(value || "");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function financialFingerprint(leagueData = {}) {
  const payload = {
    seasonYear: getSeasonKey(leagueData),
    salaryCap: leagueData?.salaryCap ?? null,
    luxuryTax: leagueData?.luxuryTax ?? null,
    firstApron: leagueData?.firstApron ?? null,
    secondApron: leagueData?.secondApron ?? null,
    financials: leagueData?.financials ?? null,
    leagueFinancials: leagueData?.leagueFinancials ?? null,
  };
  try {
    return hashString(JSON.stringify(payload));
  } catch {
    return "financials-unhashable";
  }
}

export function getCpuRosterRepairFreeAgentFingerprint(leagueData = {}) {
  const freeAgents = Array.isArray(leagueData?.freeAgents) ? leagueData.freeAgents : [];
  try {
    return `${freeAgents.length}|${hashString(JSON.stringify(freeAgents))}|${financialFingerprint(leagueData)}`;
  } catch {
    return `${freeAgents.length}|unhashable|${financialFingerprint(leagueData)}`;
  }
}

export function buildCpuRosterRepairFastPathBaseline(leagueData = {}) {
  return {
    seasonKey: getSeasonKey(leagueData),
    freeAgentFingerprint: getCpuRosterRepairFreeAgentFingerprint(leagueData),
  };
}

function getConferenceTeams(leagueData = {}) {
  const conferences = leagueData?.conferences;
  if (!conferences || typeof conferences !== "object") return [];
  return ["East", "West"].flatMap((conference) =>
    (Array.isArray(conferences?.[conference]) ? conferences[conference] : [])
      .filter((team) => team && typeof team === "object")
      .map((team) => ({ conference, team }))
  );
}

function playerIdentity(player = {}) {
  return String(
    player?.id ??
      player?.playerId ??
      player?.name ??
      player?.player ??
      ""
  ).trim();
}

function hasDuplicatePlayers(rows = []) {
  const seen = new Set();
  for (const player of Array.isArray(rows) ? rows : []) {
    const key = playerIdentity(player);
    if (!key || seen.has(key)) return true;
    seen.add(key);
  }
  return false;
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

function isCanonicalTwoWayPlayer(player = {}) {
  if (!player || typeof player !== "object") return false;
  if (player?.isTwoWay !== true || player?.isStash === true) return false;
  if (!player?.contractType || !player?.rosterStatus) return false;
  const type = rosterContractType(player);
  return type.includes("two_way") || String(player?.rosterStatus || "").toLowerCase().includes("two_way");
}

function isCanonicalStashPlayer(player = {}) {
  if (!player || typeof player !== "object") return false;
  if (player?.isStash !== true || player?.isTwoWay === true) return false;
  if (!player?.contractType || !player?.rosterStatus) return false;
  const type = rosterContractType(player);
  return type.includes("stash") || String(player?.rosterStatus || "").toLowerCase().includes("stash");
}

function isCanonicalRosterBuckets(team = {}) {
  const standard = Array.isArray(team?.players) ? team.players : [];
  const twoWay = Array.isArray(team?.twoWayPlayers) ? team.twoWayPlayers : [];
  const stash = Array.isArray(team?.stashPlayers) ? team.stashPlayers : [];

  if (standard.length !== countStandardRosterPlayers(team)) return false;
  if (!standard.every((player) => isStandardRosterPlayer(player))) return false;
  if (!twoWay.every(isCanonicalTwoWayPlayer)) return false;
  if (!stash.every(isCanonicalStashPlayer)) return false;
  if (hasDuplicatePlayers(standard) || hasDuplicatePlayers(twoWay) || hasDuplicatePlayers(stash)) return false;
  return true;
}

function hasHighValueFreeAgents(leagueData = {}) {
  return (Array.isArray(leagueData?.freeAgents) ? leagueData.freeAgents : []).some(
    (player) => intNumber(player?.overall, 0) >= HIGH_VALUE_FREE_AGENT_OVR
  );
}

function resolveTargetTeams(leagueData = {}, targetTeamNames = []) {
  const requested = [...new Set((Array.isArray(targetTeamNames) ? targetTeamNames : [])
    .map(normalizeTeamName)
    .filter(Boolean))];
  const live = new Map(
    getConferenceTeams(leagueData).map(({ conference, team }) => [normalizeTeamName(team?.name), { conference, team }])
  );
  const resolved = requested.map((name) => live.get(name)).filter(Boolean);
  return { requested, resolved };
}

function allCpuRostersAlreadyLegal({ leagueData, userTeamName, minPlayers }) {
  const user = normalizeTeamName(userTeamName);
  const minTarget = Math.max(0, intNumber(minPlayers, 14));
  const teams = getConferenceTeams(leagueData);
  if (!teams.length) return false;

  for (const { team } of teams) {
    const teamName = normalizeTeamName(team?.name);
    if (!teamName || (user && teamName === user)) continue;
    if (!isCanonicalRosterBuckets(team)) return false;

    const standardCount = countStandardRosterPlayers(team);
    const twoWayCount = countTwoWayRosterPlayers(team);
    if (standardCount < minTarget) return false;
    if (standardCount > REGULAR_SEASON_MAX_STANDARD_PLAYERS) return false;
    if (twoWayCount > REGULAR_SEASON_MAX_TWO_WAY_PLAYERS) return false;
  }

  return true;
}

export function canUseTargetedCpuRosterRepairFastPath({
  leagueData,
  userTeamName = null,
  minPlayers = 14,
  targetTeamNames = [],
  baseline = null,
} = {}) {
  if (!leagueData || typeof leagueData !== "object") return { ok: false, reason: "missing_league" };
  if (!baseline || typeof baseline !== "object") return { ok: false, reason: "missing_baseline" };

  const seasonKey = getSeasonKey(leagueData);
  if (!seasonKey || Number(baseline?.seasonKey || 0) !== seasonKey) {
    return { ok: false, reason: "season_changed" };
  }

  const { requested, resolved } = resolveTargetTeams(leagueData, targetTeamNames);
  if (!requested.length || resolved.length !== requested.length) {
    return { ok: false, reason: "target_scope_invalid" };
  }

  const user = normalizeTeamName(userTeamName);
  if (user && requested.includes(user)) {
    return { ok: false, reason: "user_team_targeted" };
  }

  const currentFreeAgentFingerprint = getCpuRosterRepairFreeAgentFingerprint(leagueData);
  if (currentFreeAgentFingerprint !== baseline?.freeAgentFingerprint) {
    return { ok: false, reason: "free_agent_state_changed" };
  }

  if (hasHighValueFreeAgents(leagueData)) {
    return { ok: false, reason: "high_value_free_agent_present" };
  }

  if (!allCpuRostersAlreadyLegal({ leagueData, userTeamName, minPlayers })) {
    return { ok: false, reason: "roster_repair_possible" };
  }

  return {
    ok: true,
    reason: "proven_no_roster_or_free_agent_work",
    seasonKey,
    targetTeamNames: requested,
  };
}

function calculateBirdLevel(seasonsTowardBird = 0) {
  const seasons = clampInt(seasonsTowardBird, 0, 3);
  if (seasons >= 3) return "bird";
  if (seasons === 2) return "early_bird";
  if (seasons === 1) return "non_bird";
  return "none";
}

function normalizeBirdLevel(raw, seasonsTowardBird = 0) {
  const level = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/ /g, "_");
  const aliases = {
    bird: "bird",
    full_bird: "bird",
    fullbird: "bird",
    bird_rights: "bird",
    early_bird: "early_bird",
    earlybird: "early_bird",
    non_bird: "non_bird",
    nonbird: "non_bird",
    none: "none",
    no_rights: "none",
    "": "",
  };
  const mapped = aliases[level] ?? level;
  if (["bird", "early_bird", "non_bird", "none"].includes(mapped)) return mapped;
  return calculateBirdLevel(seasonsTowardBird);
}

function getNormalizedPlayerRights(player = {}) {
  const raw = player?.rights && typeof player.rights === "object" ? player.rights : {};
  if (Boolean(player?.rightsRenounced)) {
    return {
      heldByTeam: null,
      seasonsTowardBird: 0,
      birdLevel: "none",
      rookieScale: Boolean(raw?.rookieScale),
      restrictedFreeAgent: false,
    };
  }

  const seasons = clampInt(raw?.seasonsTowardBird, 0, 3);
  return {
    heldByTeam: raw?.heldByTeam ?? null,
    seasonsTowardBird: seasons,
    birdLevel: normalizeBirdLevel(raw?.birdLevel, seasons),
    rookieScale: Boolean(raw?.rookieScale),
    restrictedFreeAgent: Boolean(raw?.restrictedFreeAgent),
  };
}

function normalizePlayerRightsForRoster(player = {}, teamName = "") {
  const next = { ...player };
  if (teamName && next?.rightsRenounced) delete next.rightsRenounced;

  const rights = getNormalizedPlayerRights(next);
  let seasons = rights.seasonsTowardBird;
  if (seasons <= 0) {
    const yearsWithTeam = intNumber(next?.meta?.yearsWithCurrentTeam, 1);
    seasons = Math.max(1, Math.min(3, yearsWithTeam));
  }

  next.rights = {
    heldByTeam: teamName,
    seasonsTowardBird: seasons,
    birdLevel: calculateBirdLevel(seasons),
    rookieScale: rights.rookieScale,
    restrictedFreeAgent: rights.restrictedFreeAgent,
  };
  return next;
}

function normalizeTargetTeamRights(team = {}) {
  const teamName = normalizeTeamName(team?.name);
  return {
    ...team,
    players: (Array.isArray(team?.players) ? team.players : []).map((player) =>
      normalizePlayerRightsForRoster(player, teamName)
    ),
    twoWayPlayers: (Array.isArray(team?.twoWayPlayers) ? team.twoWayPlayers : []).map((player) =>
      normalizePlayerRightsForRoster(player, teamName)
    ),
  };
}

export function applyTargetedCpuRosterRepairFastPath({
  leagueData,
  targetTeamNames = [],
  minPlayers = 14,
} = {}) {
  const targetSet = new Set(
    (Array.isArray(targetTeamNames) ? targetTeamNames : [])
      .map(normalizeTeamName)
      .filter(Boolean)
  );

  const conferences = leagueData?.conferences || {};
  const nextConferences = { ...conferences };
  for (const conference of ["East", "West"]) {
    const rows = Array.isArray(conferences?.[conference]) ? conferences[conference] : [];
    nextConferences[conference] = rows.map((team) =>
      targetSet.has(normalizeTeamName(team?.name))
        ? normalizeTargetTeamRights(team)
        : team
    );
  }

  const nextLeagueData = {
    ...leagueData,
    conferences: nextConferences,
    minRosterSize: intNumber(minPlayers, 14),
  };

  return {
    ok: true,
    leagueData: nextLeagueData,
    signings: [],
    highValueSignings: [],
    cleanupSignings: [],
    unsignedHighValueFreeAgents: [],
    droppedPlayers: [],
    twoWayAssignments: [],
    failedTeams: [],
    overMaxTeams: [],
    overTwoWayTeams: [],
    minPlayers: intNumber(minPlayers, 14),
    maxPlayers: REGULAR_SEASON_MAX_STANDARD_PLAYERS,
    twoWayMax: REGULAR_SEASON_MAX_TWO_WAY_PLAYERS,
    progressionShapeAudit: {
      ok: true,
      skipped: true,
      stage: "regular_season_roster_repair",
      reason: "rating_shape_lock_disabled_outside_player_progression",
    },
    ratingFreezeAudit: {
      ok: true,
      skipped: true,
      reason: "fast_noop_no_rating_mutation",
    },
    repairMode: "targeted_post_trade_fast_noop",
    targetedTeamNames: [...targetSet],
    affectedTeamNames: [...targetSet],
    highValueSweepRan: false,
    targetedFallbackRequired: false,
    targetedFallbackUsed: false,
    fastNoopBypass: true,
  };
}
