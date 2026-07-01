const PLAYER_MOOD_EVENT_BUS_KEY = "bm_player_mood_event_bus_v1";
const OFFSEASON_MOOD_BASELINE_KEY = "bm_offseason_mood_baseline_v1";
const RETIREMENT_RESULTS_KEY = "bm_retirement_results_v1";
const DRAFT_STATE_KEY = "bm_draft_state_v1";

function safeJSON(raw, fallback = null) {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeName(value = "") {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clamp(value, min, max) {
  const n = Number(value || 0);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : 0));
}

function round1(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

function hasLocalStorage() {
  try {
    return typeof localStorage !== "undefined" && !!localStorage;
  } catch {
    return false;
  }
}

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function getTeamName(team = {}) {
  return team?.name || team?.teamName || "";
}

function findTeamByName(leagueData, teamName = "") {
  const target = normalizeName(teamName);
  if (!target) return null;
  return getAllTeamsFromLeague(leagueData).find((team) => normalizeName(getTeamName(team)) === target) || null;
}

function getTeamPlayers(team = {}, includeRookieBuckets = true) {
  const groups = [team.players || []];
  if (includeRookieBuckets) {
    groups.push(team.twoWayPlayers || []);
    groups.push(team.stashPlayers || []);
    groups.push(team.pendingRookieSignings || []);
  }
  return groups.flatMap((group) => (Array.isArray(group) ? group : [])).filter(Boolean);
}

function getFreeAgents(leagueData = {}) {
  return Array.isArray(leagueData?.freeAgents) ? leagueData.freeAgents.filter(Boolean) : [];
}

function getPlayerName(player = {}) {
  return player?.name || player?.playerName || player?.player || "Unknown Player";
}

function getPlayerKey(player = {}) {
  const id = player?.id ?? player?.playerId ?? player?.uuid ?? player?.prospectId ?? null;
  if (id !== null && id !== undefined && String(id) !== "") return `id:${id}`;
  return `name:${getPlayerName(player)}`;
}

function getOverall(player = {}) {
  return Number(player?.overall ?? player?.ovr ?? player?.rating ?? 0) || 0;
}

function getPotential(player = {}) {
  return Number(player?.potential ?? player?.pot ?? getOverall(player)) || getOverall(player);
}

function getAge(player = {}) {
  return Number(player?.age ?? 27) || 27;
}

function getYearsWithTeam(player = {}) {
  const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
  return Number(meta.yearsWithCurrentTeam ?? player.yearsWithCurrentTeam ?? 0) || 0;
}

function getDraftPickNumber(pick = {}) {
  return Number(pick?.pick ?? pick?.draftPick ?? pick?.overallPick ?? pick?.selection ?? 0) || 0;
}

function getDraftRound(pick = {}) {
  const explicit = Number(pick?.round ?? pick?.draftRound ?? 0) || 0;
  if (explicit) return explicit;
  const pickNo = getDraftPickNumber(pick);
  if (!pickNo) return 0;
  return pickNo <= 30 ? 1 : 2;
}

function getDraftTeamName(pick = {}) {
  return pick?.teamName || pick?.currentOwnerTeamName || pick?.draftedByTeamName || pick?.originalTeamName || "";
}

function getFullProspectSnapshot(pick = {}) {
  return pick?.prospectSnapshot || pick?.prospect || pick?.fullProspect || pick?.draftProspect || pick?.originalProspect || {};
}

function normalizeDraftedPick(pick = {}, leaguePlayer = {}) {
  const prospect = getFullProspectSnapshot(pick);
  return {
    ...prospect,
    ...leaguePlayer,
    ...pick,
    name: pick.playerName || pick.name || leaguePlayer.name || leaguePlayer.playerName || prospect.name || prospect.playerName || "Drafted Player",
    playerName: pick.playerName || pick.name || leaguePlayer.name || leaguePlayer.playerName || prospect.name || prospect.playerName || "Drafted Player",
    pos: pick.pos || pick.position || leaguePlayer.pos || leaguePlayer.position || prospect.pos || prospect.position || "",
    secondaryPos: pick.secondaryPos || leaguePlayer.secondaryPos || prospect.secondaryPos || "",
    overall: pick.overall ?? pick.ovr ?? leaguePlayer.overall ?? leaguePlayer.ovr ?? prospect.overall ?? prospect.ovr ?? 0,
    potential: pick.potential ?? pick.pot ?? leaguePlayer.potential ?? leaguePlayer.pot ?? prospect.potential ?? prospect.pot ?? 0,
    age: pick.age ?? leaguePlayer.age ?? prospect.age ?? 19,
    teamName: getDraftTeamName(pick),
    pick: getDraftPickNumber(pick),
    round: getDraftRound(pick),
    meta: {
      ...(prospect.meta || {}),
      ...(leaguePlayer.meta || {}),
      ...(pick.meta || {}),
    },
  };
}

function playerMatchesPick(player = {}, pick = {}) {
  const pickIds = [pick.id, pick.playerId, pick.prospectId, pick.draftId, pick.originalProspectId]
    .map((value) => String(value || ""))
    .filter(Boolean);
  const playerIds = [player.id, player.playerId, player.prospectId, player.draftId, player.originalProspectId]
    .map((value) => String(value || ""))
    .filter(Boolean);

  if (pickIds.length && playerIds.some((id) => pickIds.includes(id))) return true;

  const pickName = normalizeName(pick.playerName || pick.name);
  const playerName = normalizeName(player.name || player.playerName);
  return Boolean(pickName && playerName && pickName === playerName);
}

function findLeaguePlayerForPick(leagueData, teamName, pick = {}) {
  const team = findTeamByName(leagueData, teamName);
  if (!team) return null;
  return getTeamPlayers(team, true).find((player) => playerMatchesPick(player, pick)) || null;
}

function splitPositions(player = {}) {
  const values = [
    player.pos,
    player.position,
    player.primaryPosition,
    player.secondaryPos,
    player.secondaryPosition,
  ];

  return values
    .flatMap((value) => String(value || "").toUpperCase().split(/[\/,-]/g))
    .map((value) => value.trim())
    .filter(Boolean);
}

function positionGroup(pos = "") {
  const value = String(pos || "").toUpperCase().trim();
  if (["PG", "SG"].includes(value)) return "guard";
  if (["SG", "SF"].includes(value)) return "wing";
  if (["SF", "PF"].includes(value)) return "forward";
  if (["PF", "C"].includes(value)) return "big";
  return value ? value.toLowerCase() : "unknown";
}

function positionsOverlap(a = {}, b = {}) {
  const aPositions = splitPositions(a);
  const bPositions = splitPositions(b);
  if (!aPositions.length || !bPositions.length) return false;

  const bSet = new Set(bPositions);
  if (aPositions.some((pos) => bSet.has(pos))) return true;

  const aGroups = new Set(aPositions.map(positionGroup));
  return bPositions.some((pos) => aGroups.has(positionGroup(pos)));
}

function getSeasonYearFromLeague(leagueData = {}, fallback = 2026) {
  const y = Number(leagueData?.seasonYear || leagueData?.currentSeasonYear || leagueData?.seasonStartYear || fallback);
  return Number.isFinite(y) && y >= 2020 && y <= 2100 ? y : fallback;
}

function isCurrentDraftRookie(player = {}, seasonYear) {
  const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
  const draftYear = Number(meta.draftYear ?? player.draftYear ?? player.draftClassYear ?? player.draftedYear ?? 0);
  return Number.isFinite(draftYear) && Number(draftYear) === Number(seasonYear);
}

function isMeaningfulFirstRounder(rookie = {}) {
  const pickNo = getDraftPickNumber(rookie);
  const round = getDraftRound(rookie);
  const overall = getOverall(rookie);
  const potential = getPotential(rookie);

  if (round !== 1 && pickNo > 30) return false;
  if (pickNo > 0 && pickNo <= 14) return true;
  return overall >= 72 || potential >= 78 || (pickNo > 0 && pickNo <= 24);
}

function shouldFeelThreatened(existing = {}, rookie = {}, seasonYear) {
  if (!existing || !rookie) return false;
  if (playerMatchesPick(existing, rookie)) return false;
  if (isCurrentDraftRookie(existing, seasonYear)) return false;
  if (!positionsOverlap(existing, rookie)) return false;

  const existingOverall = getOverall(existing);
  const existingPotential = getPotential(existing);
  const existingAge = getAge(existing);
  const rookieOverall = getOverall(rookie);
  const rookiePotential = getPotential(rookie);

  // Franchise-level players should not panic over a rookie at their position.
  if (existingOverall >= 86) return false;

  if (existingOverall >= 78 && rookiePotential >= 78) return true;
  if (existingOverall >= 74 && rookieOverall >= 72 && rookiePotential >= existingPotential - 1) return true;
  if (existingAge >= 31 && existingOverall >= 73 && rookiePotential >= 78) return true;
  if (existingAge <= 25 && existingOverall >= 72 && rookiePotential >= existingPotential + 2) return true;

  return false;
}

function threatImpact(existing = {}, rookie = {}) {
  const existingOverall = getOverall(existing);
  const existingAge = getAge(existing);
  const rookiePick = getDraftPickNumber(rookie);
  const rookiePotential = getPotential(rookie);

  let impact = -3.5;
  if (existingOverall >= 80) impact -= 1.5;
  if (existingOverall >= 83) impact -= 1.0;
  if (existingAge >= 31) impact -= 1.0;
  if (rookiePick > 0 && rookiePick <= 10) impact -= 1.5;
  if (rookiePotential >= 84) impact -= 1.0;

  return round1(Math.max(-8.5, impact));
}

function makeEventId(parts = []) {
  return parts.map((part) => normalizeName(part)).filter(Boolean).join(":");
}

function eventDateForOffseason(seasonYear, fallbackMonthDay = "06-27") {
  const y = Number(seasonYear || 0);
  if (Number.isFinite(y) && y >= 2020) return `${y}-${fallbackMonthDay}`;
  return "2026-06-27";
}

function makeMoodEvent({
  id,
  player,
  category,
  impact,
  text,
  detail,
  seasonYear,
  source = "offseason_mood_events",
  decayPctPerWeek = 5,
  dateMonthDay = "06-27",
}) {
  const roundedImpact = round1(impact);
  return {
    id,
    playerKey: getPlayerKey(player),
    playerName: getPlayerName(player),
    category,
    impact: roundedImpact,
    baseImpact: roundedImpact,
    text: cleanText(text),
    detail: cleanText(detail),
    type: "offseason_event",
    duration: decayPctPerWeek > 0 ? "temporary" : "long_term",
    modifierType: decayPctPerWeek > 0 ? "temporary" : "permanent",
    date: eventDateForOffseason(seasonYear, dateMonthDay),
    source,
    decayPctPerWeek: decayPctPerWeek > 0 ? decayPctPerWeek : undefined,
    decayMode: decayPctPerWeek > 0 ? "percent_of_original" : undefined,
    hideWhenExpired: decayPctPerWeek > 0 ? true : false,
  };
}

function appendMoodEvents(events = []) {
  if (!hasLocalStorage() || !Array.isArray(events) || !events.length) {
    return { added: 0, total: 0 };
  }

  const existing = safeJSON(localStorage.getItem(PLAYER_MOOD_EVENT_BUS_KEY), []);
  const byId = new Map();

  for (const row of Array.isArray(existing) ? existing : []) {
    const id = String(row?.id || "").trim();
    if (id) byId.set(id, row);
  }

  let added = 0;
  for (const row of events) {
    const id = String(row?.id || "").trim();
    if (!id) continue;
    if (!byId.has(id)) added += 1;
    byId.set(id, row);
  }

  const next = [...byId.values()].slice(-700);
  localStorage.setItem(PLAYER_MOOD_EVENT_BUS_KEY, JSON.stringify(next));
  return { added, total: next.length };
}

function normalizeContract(contract = null) {
  if (!contract || typeof contract !== "object") return null;
  const salaryByYear = Array.isArray(contract.salaryByYear) ? contract.salaryByYear.map((v) => Number(v || 0)) : [];
  return {
    startYear: Number(contract.startYear || 0) || 0,
    salaryByYear,
    type: contract.type || contract.contractType || "",
    option: contract.option || null,
  };
}

function contractSignature(contract = null) {
  const c = normalizeContract(contract);
  if (!c) return "none";
  return `${c.startYear}|${c.salaryByYear.join(",")}|${c.type}|${JSON.stringify(c.option || null)}`;
}

function contractAav(contract = null) {
  const c = normalizeContract(contract);
  if (!c || !c.salaryByYear.length) return 0;
  return c.salaryByYear.reduce((sum, v) => sum + Number(v || 0), 0) / c.salaryByYear.length;
}

function contractYears(contract = null) {
  const c = normalizeContract(contract);
  return c?.salaryByYear?.length || 0;
}

function readRecord(team = {}) {
  let wins = Number(team.wins ?? team.w ?? team.record?.wins ?? team.teamRecord?.wins ?? 0) || 0;
  let losses = Number(team.losses ?? team.l ?? team.record?.losses ?? team.teamRecord?.losses ?? 0) || 0;
  const games = wins + losses;
  return { wins, losses, games, winPct: games > 0 ? wins / games : null };
}

function teamStrength(team = {}) {
  const ranked = getTeamPlayers(team, false)
    .map((player) => ({ overall: getOverall(player), potential: getPotential(player) }))
    .sort((a, b) => b.overall - a.overall || b.potential - a.potential);
  if (!ranked.length) return 0;
  const top1 = ranked[0]?.overall || 0;
  const top3 = ranked.slice(0, 3).reduce((sum, row) => sum + row.overall, 0) / Math.max(1, Math.min(3, ranked.length));
  const top8 = ranked.slice(0, 8).reduce((sum, row) => sum + row.overall, 0) / Math.max(1, Math.min(8, ranked.length));
  return round1(top1 * 0.25 + top3 * 0.35 + top8 * 0.40);
}

function buildPlayerSnapshot(player = {}, teamName = "") {
  const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
  return {
    key: getPlayerKey(player),
    id: player.id ?? player.playerId ?? null,
    name: getPlayerName(player),
    playerName: getPlayerName(player),
    teamName,
    pos: player.pos || player.position || "",
    secondaryPos: player.secondaryPos || player.secondaryPosition || "",
    age: getAge(player),
    overall: getOverall(player),
    potential: getPotential(player),
    yearsWithCurrentTeam: getYearsWithTeam(player),
    draftYear: Number(meta.draftYear ?? player.draftYear ?? player.draftClassYear ?? 0) || 0,
    contract: normalizeContract(player.contract),
    contractSignature: contractSignature(player.contract),
    sourcePlayer: {
      ...player,
      teamName,
      name: getPlayerName(player),
      playerName: getPlayerName(player),
    },
  };
}

function buildLeagueSnapshot(leagueData = {}, seasonYear = 2026) {
  const teams = getAllTeamsFromLeague(leagueData).map((team) => {
    const teamName = getTeamName(team);
    const record = readRecord(team);
    return {
      teamName,
      record,
      strength: teamStrength(team),
      players: getTeamPlayers(team, false).map((player) => buildPlayerSnapshot(player, teamName)),
    };
  });

  return {
    seasonYear: Number(seasonYear || getSeasonYearFromLeague(leagueData)),
    capturedAt: Date.now(),
    teams,
  };
}

function mapSnapshotsByTeam(snapshot = {}) {
  const map = new Map();
  for (const team of snapshot?.teams || []) {
    if (team?.teamName) map.set(normalizeName(team.teamName), team);
  }
  return map;
}

function mapSnapshotsByPlayer(snapshot = {}) {
  const map = new Map();
  for (const team of snapshot?.teams || []) {
    for (const player of team?.players || []) {
      if (player?.key) map.set(player.key, player);
    }
  }
  return map;
}

function findSnapshotTeam(snapshot = {}, teamName = "") {
  return mapSnapshotsByTeam(snapshot).get(normalizeName(teamName)) || null;
}

function playerIsOnTeam(playerKey, teamSnapshot = {}) {
  return Boolean((teamSnapshot?.players || []).some((player) => player.key === playerKey));
}

function findCurrentPlayerByKey(leagueData = {}, playerKey = "") {
  for (const team of getAllTeamsFromLeague(leagueData)) {
    const teamName = getTeamName(team);
    for (const player of getTeamPlayers(team, false)) {
      if (getPlayerKey(player) === playerKey) return { player, team, teamName };
    }
  }
  for (const player of getFreeAgents(leagueData)) {
    if (getPlayerKey(player) === playerKey) return { player, team: null, teamName: "Free Agents" };
  }
  return null;
}

function incomingPlayersForTeam(baseTeam = {}, finalTeam = {}) {
  const baseKeys = new Set((baseTeam?.players || []).map((p) => p.key));
  return (finalTeam?.players || []).filter((player) => !baseKeys.has(player.key));
}

function stayedPlayersForTeam(baseTeam = {}, finalTeam = {}) {
  const baseKeys = new Set((baseTeam?.players || []).map((p) => p.key));
  return (finalTeam?.players || []).filter((player) => baseKeys.has(player.key));
}

export function captureOffseasonMoodBaseline(leagueData, options = {}) {
  if (!leagueData || !hasLocalStorage()) return null;

  const seasonYear = Number(options.seasonYear || getSeasonYearFromLeague(leagueData));
  const existing = safeJSON(localStorage.getItem(OFFSEASON_MOOD_BASELINE_KEY), null);

  if (!options.force && existing?.seasonYear === seasonYear && Array.isArray(existing?.teams) && existing.teams.length) {
    return existing;
  }

  const snapshot = buildLeagueSnapshot(leagueData, seasonYear);
  localStorage.setItem(OFFSEASON_MOOD_BASELINE_KEY, JSON.stringify(snapshot));
  return snapshot;
}

export function readOffseasonMoodBaseline(seasonYear = null) {
  if (!hasLocalStorage()) return null;
  const snapshot = safeJSON(localStorage.getItem(OFFSEASON_MOOD_BASELINE_KEY), null);
  if (!snapshot || typeof snapshot !== "object") return null;
  if (seasonYear && Number(snapshot.seasonYear) !== Number(seasonYear)) return null;
  return snapshot;
}

function getDraftedPicksFromState(draftState = {}) {
  return Array.isArray(draftState?.draftedPicks) ? draftState.draftedPicks : [];
}

function getYoungCorePlayers(team = {}, seasonYear) {
  return getTeamPlayers(team, false)
    .filter((player) => !isCurrentDraftRookie(player, seasonYear))
    .filter((player) => getAge(player) <= 25 && (getOverall(player) >= 76 || getPotential(player) >= 80));
}

function buildDraftMoodEvents(leagueData, draftState, options = {}) {
  if (!leagueData || !draftState?.completed) return [];

  const seasonYear = Number(options.seasonYear || draftState.seasonYear || getSeasonYearFromLeague(leagueData));
  const events = [];

  for (const pick of getDraftedPicksFromState(draftState)) {
    const teamName = getDraftTeamName(pick);
    if (!teamName) continue;

    const team = findTeamByName(leagueData, teamName);
    if (!team) continue;

    const leaguePlayer = findLeaguePlayerForPick(leagueData, teamName, pick) || {};
    const rookie = normalizeDraftedPick(pick, leaguePlayer);
    if (!isMeaningfulFirstRounder(rookie)) continue;

    const rookieName = getPlayerName(rookie);
    const rookiePick = getDraftPickNumber(rookie);
    const rookiePos = splitPositions(rookie).join("/") || "his position";
    const threatTargets = [];

    for (const existing of getTeamPlayers(team, false)) {
      if (!shouldFeelThreatened(existing, rookie, seasonYear)) continue;
      threatTargets.push(existing);

      const existingAge = getAge(existing);
      const category = existingAge >= 31 ? "Replacement Plan" : "Draft Pressure";
      const text = existingAge >= 31
        ? "The front office drafted a possible long-term replacement at his position."
        : "A first-round rookie at his position created real role pressure.";

      events.push(makeMoodEvent({
        id: makeEventId(["offseason", seasonYear, "draft_threat", teamName, getPlayerKey(existing), getPlayerKey(rookie)]),
        player: existing,
        category,
        impact: threatImpact(existing, rookie),
        text,
        detail: `${teamName} drafted ${rookieName}${rookiePick ? ` at #${rookiePick}` : ""} (${rookiePos}, OVR ${getOverall(rookie)}, POT ${getPotential(rookie)}).`,
        seasonYear,
        source: options.source || "offseason_draft",
        decayPctPerWeek: 5,
        dateMonthDay: "06-27",
      }));
    }

    const threatenedKeys = new Set(threatTargets.map(getPlayerKey));
    const youngCore = getYoungCorePlayers(team, seasonYear).filter((player) => !threatenedKeys.has(getPlayerKey(player)));
    const hasYoungCoreSupport = youngCore.length > 0;
    const youngCoreImpact = rookiePick > 0 && rookiePick <= 10 ? 4.5 : getPotential(rookie) >= 83 ? 4 : 3;

    for (const player of youngCore.slice(0, 6)) {
      events.push(makeMoodEvent({
        id: makeEventId(["offseason", seasonYear, "young_core", teamName, getPlayerKey(player), getPlayerKey(rookie)]),
        player,
        category: "Young Core",
        impact: youngCoreImpact,
        text: "The team added another young piece, making the project feel more real.",
        detail: `${teamName} drafted ${rookieName}${rookiePick ? ` at #${rookiePick}` : ""}, giving the young core another high-upside teammate.`,
        seasonYear,
        source: options.source || "offseason_draft",
        decayPctPerWeek: 4,
        dateMonthDay: "06-27",
      }));
    }

    if (hasYoungCoreSupport && (leaguePlayer?.name || leaguePlayer?.playerName || pick?.playerName || pick?.name)) {
      events.push(makeMoodEvent({
        id: makeEventId(["offseason", seasonYear, "rookie_lands_young_core", teamName, getPlayerKey(rookie)]),
        player: rookie,
        category: "Young Core",
        impact: 3.5,
        text: "He was drafted into a young core that already has real pieces.",
        detail: `${rookieName} joins ${youngCore.slice(0, 3).map(getPlayerName).join(", ")}.`,
        seasonYear,
        source: options.source || "offseason_draft",
        decayPctPerWeek: 4,
        dateMonthDay: "06-27",
      }));
    }

    // Stars and established core players usually are not threatened by rookies,
    // but they can appreciate the front office adding a real asset.
    if ((rookiePick > 0 && rookiePick <= 10) || getOverall(rookie) >= 76 || getPotential(rookie) >= 84) {
      for (const player of getTeamPlayers(team, false)) {
        if (threatenedKeys.has(getPlayerKey(player))) continue;
        if (isCurrentDraftRookie(player, seasonYear)) continue;
        const overall = getOverall(player);
        const age = getAge(player);
        if (overall < 83 || age < 25) continue;

        events.push(makeMoodEvent({
          id: makeEventId(["offseason", seasonYear, "front_office_added_help", teamName, getPlayerKey(player), getPlayerKey(rookie)]),
          player,
          category: "Front Office",
          impact: 2.5,
          text: "The front office added meaningful young help this offseason.",
          detail: `${teamName} used a premium pick on ${rookieName}${rookiePick ? ` at #${rookiePick}` : ""}.`,
          seasonYear,
          source: options.source || "offseason_draft",
          decayPctPerWeek: 3,
          dateMonthDay: "06-27",
        }));
      }
    }
  }

  return events;
}

export function recordCompletedDraftMoodEvents(leagueData, draftState, options = {}) {
  const events = buildDraftMoodEvents(leagueData, draftState, options);
  const result = appendMoodEvents(events);
  if (events.length) {
    console.log("[offseasonMoodEvents] Draft mood events recorded", {
      generated: events.length,
      added: result.added,
      total: result.total,
    });
  }

  return { ...result, events };
}

function readStoredDraftState(seasonYear) {
  if (!hasLocalStorage()) return null;
  const draftState = safeJSON(localStorage.getItem(DRAFT_STATE_KEY), null);
  if (!draftState || typeof draftState !== "object") return null;
  if (Number(draftState.seasonYear || 0) !== Number(seasonYear)) return null;
  return draftState;
}

function buildRetirementMoodEventsFromRows(leagueData, retirementResult, options = {}) {
  const seasonYear = Number(options.seasonYear || retirementResult?.seasonYear || getSeasonYearFromLeague(leagueData));
  const retiredRows = Array.isArray(retirementResult?.retiredPlayers) ? retirementResult.retiredPlayers : [];
  const events = [];

  for (const retired of retiredRows) {
    const retiredTeamName = retired?.retiredFromTeam || retired?.currentTeam || retired?.teamName || retired?.team || retired?.lastKnownTeam || "";
    if (!retiredTeamName) continue;

    const retiredPlayer = {
      ...retired,
      name: retired.name || retired.playerName || "Retired Player",
      playerName: retired.playerName || retired.name || "Retired Player",
      overall: retired.overall ?? retired.ovr ?? 0,
      teamName: retiredTeamName,
    };
    const retiredOverall = getOverall(retiredPlayer);
    const retiredAge = getAge(retiredPlayer);
    if (retiredOverall < 74 && retiredAge < 35) continue;

    const team = findTeamByName(leagueData, retiredTeamName);
    if (!team) continue;

    const baseImpact = retiredOverall >= 84 ? -5.5 : retiredOverall >= 78 ? -3.8 : -2.5;
    const category = retiredOverall >= 84 ? "Leadership Void" : "Locker Room Loss";

    for (const player of getTeamPlayers(team, false)) {
      if (getPlayerKey(player) === getPlayerKey(retiredPlayer)) continue;
      if (isCurrentDraftRookie(player, seasonYear)) continue;

      const overall = getOverall(player);
      const age = getAge(player);
      const years = getYearsWithTeam(player);
      if (overall < 75 && age < 24 && years < 2) continue;

      const impact = baseImpact - (years >= 3 ? 0.8 : 0) - (overall >= 84 ? 0.7 : 0);
      events.push(makeMoodEvent({
        id: makeEventId(["offseason", seasonYear, "teammate_retired", retiredTeamName, getPlayerKey(player), getPlayerKey(retiredPlayer)]),
        player,
        category,
        impact: Math.max(-7.5, impact),
        text: "A longtime teammate leaving the locker room changed the team's emotional balance.",
        detail: `${retiredPlayer.playerName || retiredPlayer.name} retired from ${retiredTeamName}${retiredOverall ? ` at OVR ${retiredOverall}` : ""}.`,
        seasonYear,
        source: options.source || "offseason_retirements",
        decayPctPerWeek: 4,
        dateMonthDay: "06-20",
      }));
    }
  }

  return events;
}

export function recordRetirementMoodEvents(leagueData, retirementResult, options = {}) {
  const events = buildRetirementMoodEventsFromRows(leagueData, retirementResult, options);
  const result = appendMoodEvents(events);
  if (events.length) {
    console.log("[offseasonMoodEvents] Retirement mood events recorded", {
      generated: events.length,
      added: result.added,
      total: result.total,
    });
  }
  return { ...result, events };
}

function buildExtensionMoodEvents(finalLeague, baseline, options = {}) {
  const seasonYear = Number(options.seasonYear || getSeasonYearFromLeague(finalLeague));
  const baseByPlayer = mapSnapshotsByPlayer(baseline);
  const events = [];

  for (const team of getAllTeamsFromLeague(finalLeague)) {
    const teamName = getTeamName(team);
    for (const player of getTeamPlayers(team, false)) {
      const key = getPlayerKey(player);
      const base = baseByPlayer.get(key);
      if (!base) continue;
      if (normalizeName(base.teamName) !== normalizeName(teamName)) continue;

      const currentSig = contractSignature(player.contract);
      const baseSig = base.contractSignature || "none";
      if (!player.contract || currentSig === baseSig) continue;

      const years = contractYears(player.contract);
      const aav = contractAav(player.contract);
      const overall = getOverall(player);
      const age = getAge(player);
      if (years < 3 || overall < 82) continue;
      if (aav < 30_000_000 && !(overall >= 88 && aav >= 24_000_000)) continue;

      const impact = aav >= 45_000_000 ? 10 : aav >= 37_000_000 ? 8 : 6;
      events.push(makeMoodEvent({
        id: makeEventId(["offseason", seasonYear, "max_extension_loyalty", teamName, key, currentSig]),
        player,
        category: "Extension Trust",
        impact,
        text: "A major extension reinforced his belief that the franchise values him.",
        detail: `${teamName} committed to ${getPlayerName(player)} on a ${years}-year deal averaging about $${Math.round(aav / 1_000_000)}M per year.`,
        seasonYear,
        source: options.source || "offseason_contracts",
        // This is a long-lasting offseason emotion, not a forever modifier.
        // Ongoing contract security is already handled by the live mood engine.
        decayPctPerWeek: 1,
        dateMonthDay: "07-01",
      }));

      // Young max/near-max players also get a smaller long-term stability bump.
      if (age <= 27) {
        events.push(makeMoodEvent({
          id: makeEventId(["offseason", seasonYear, "extension_stability", teamName, key, currentSig]),
          player,
          category: "Future Security",
          impact: 3.5,
          text: "Long-term security gives him more patience with the team-building plan.",
          detail: "The contract gives him stability instead of making every slow stretch feel urgent.",
          seasonYear,
          source: options.source || "offseason_contracts",
          // Let the extension excitement cool down slowly while the contract
          // itself continues to provide live security through player_mood_logic.py.
          decayPctPerWeek: 1.5,
          dateMonthDay: "07-01",
        }));
      }
    }
  }

  return events;
}

function buildRosterMovementMoodEvents(finalLeague, baseline, options = {}) {
  const seasonYear = Number(options.seasonYear || getSeasonYearFromLeague(finalLeague));
  const finalSnapshot = buildLeagueSnapshot(finalLeague, seasonYear);
  const baseByTeam = mapSnapshotsByTeam(baseline);
  const finalByTeam = mapSnapshotsByTeam(finalSnapshot);
  const finalByPlayer = mapSnapshotsByPlayer(finalSnapshot);
  const events = [];

  for (const [teamKey, baseTeam] of baseByTeam.entries()) {
    const finalTeam = finalByTeam.get(teamKey);
    if (!finalTeam) continue;

    const teamName = finalTeam.teamName || baseTeam.teamName;
    const incoming = incomingPlayersForTeam(baseTeam, finalTeam);
    const stayed = stayedPlayersForTeam(baseTeam, finalTeam);
    const bestIncoming = incoming
      .filter((player) => !isCurrentDraftRookie(player.sourcePlayer || player, seasonYear))
      .sort((a, b) => b.overall - a.overall)[0] || null;
    const bestIncomingOverall = Number(bestIncoming?.overall || 0);
    const teamImproved = Number(finalTeam.strength || 0) >= Number(baseTeam.strength || 0) + 1.2 || bestIncomingOverall >= 80;

    // Star teammate left / veteran frustration.
    const departedStars = (baseTeam.players || [])
      .filter((basePlayer) => basePlayer.overall >= 82)
      .filter((basePlayer) => !playerIsOnTeam(basePlayer.key, finalTeam))
      .filter((basePlayer) => {
        const current = finalByPlayer.get(basePlayer.key);
        return !current || normalizeName(current.teamName) !== teamKey;
      })
      .slice(0, 2);

    for (const departed of departedStars) {
      const replacementOffset = bestIncomingOverall >= departed.overall - 1 ? 0.40 : bestIncomingOverall >= departed.overall - 4 ? 0.20 : 0;
      const rawImpact = -(3.5 + Math.max(0, departed.overall - 82) * 0.7) * (1 - replacementOffset);
      if (Math.abs(rawImpact) < 2.5) continue;

      for (const player of stayed) {
        if (player.key === departed.key) continue;
        if (player.overall < 79 && player.age < 25) continue;
        if (isCurrentDraftRookie(player.sourcePlayer || player, seasonYear)) continue;

        events.push(makeMoodEvent({
          id: makeEventId(["offseason", seasonYear, "star_teammate_left", teamName, player.key, departed.key]),
          player: player.sourcePlayer || player,
          category: "Teammate Loss",
          impact: clamp(rawImpact - (player.overall >= 84 ? 0.8 : 0), -9.5, -2.5),
          text: "A major teammate leaving created concern about the team's direction.",
          detail: `${departed.name} is no longer with ${teamName}${bestIncoming ? `; the biggest incoming piece is ${bestIncoming.name} at OVR ${bestIncoming.overall}.` : "."}`,
          seasonYear,
          source: options.source || "offseason_roster_movement",
          decayPctPerWeek: 4,
          dateMonthDay: "07-08",
        }));
      }
    }

    // Win-now help boost.
    const winNowAdditions = incoming
      .filter((player) => player.overall >= 80 && player.age >= 24)
      .filter((player) => !isCurrentDraftRookie(player.sourcePlayer || player, seasonYear))
      .sort((a, b) => b.overall - a.overall)
      .slice(0, 2);

    for (const addition of winNowAdditions) {
      const impact = addition.overall >= 87 ? 7.5 : addition.overall >= 84 ? 6 : 4.5;
      for (const player of stayed) {
        if (player.key === addition.key) continue;
        if (player.overall < 80 && player.age < 27) continue;
        if (isCurrentDraftRookie(player.sourcePlayer || player, seasonYear)) continue;

        events.push(makeMoodEvent({
          id: makeEventId(["offseason", seasonYear, "win_now_help", teamName, player.key, addition.key]),
          player: player.sourcePlayer || player,
          category: "Win-Now Help",
          impact,
          text: "The front office added win-now help around him.",
          detail: `${teamName} added ${addition.name} (OVR ${addition.overall}), making the roster feel more serious.`,
          seasonYear,
          source: options.source || "offseason_roster_movement",
          decayPctPerWeek: 3,
          dateMonthDay: "07-09",
        }));
      }
    }

    // Failed offseason / patience drop after bad season.
    const priorWinPct = baseTeam.record?.winPct;
    const hadBadSeason = priorWinPct !== null && priorWinPct !== undefined && priorWinPct < 0.400 && Number(baseTeam.record?.games || 0) >= 20;
    const premiumDraftHelp = incoming.some((player) => isCurrentDraftRookie(player.sourcePlayer || player, seasonYear) && (player.overall >= 74 || player.potential >= 82));

    if (hadBadSeason && !teamImproved && !premiumDraftHelp) {
      for (const player of stayed) {
        if (player.overall < 78) continue;
        if (isCurrentDraftRookie(player.sourcePlayer || player, seasonYear)) continue;

        const patienceImpact = -(
          3.5 +
          (player.overall >= 84 ? 1.5 : 0) +
          (player.yearsWithCurrentTeam >= 2 ? 1.5 : 0) +
          (Number(baseTeam.record?.losses || 0) >= 50 ? 1.0 : 0)
        );

        events.push(makeMoodEvent({
          id: makeEventId(["offseason", seasonYear, "failed_to_improve", teamName, player.key]),
          player: player.sourcePlayer || player,
          category: "Front Office Patience",
          impact: clamp(patienceImpact, -8.5, -3.0),
          text: "Another offseason passed without enough help.",
          detail: `${teamName} finished ${baseTeam.record?.wins || 0}-${baseTeam.record?.losses || 0} and did not add a clear rotation-level answer.`,
          seasonYear,
          source: options.source || "offseason_roster_movement",
          decayPctPerWeek: 2,
          dateMonthDay: "09-01",
        }));
      }
    }
  }

  return events;
}

function readRetirementResultForSeason(seasonYear) {
  if (!hasLocalStorage()) return null;
  const result = safeJSON(localStorage.getItem(RETIREMENT_RESULTS_KEY), null);
  if (!result || typeof result !== "object") return null;
  if (Number(result.seasonYear || 0) !== Number(seasonYear)) return null;
  return result;
}

export function recordFullOffseasonMoodEvents(finalLeagueData, options = {}) {
  if (!finalLeagueData || !hasLocalStorage()) return { added: 0, total: 0, events: [] };

  const seasonYear = Number(options.seasonYear || getSeasonYearFromLeague(finalLeagueData));
  const baseline = options.baseline || readOffseasonMoodBaseline(seasonYear) || captureOffseasonMoodBaseline(finalLeagueData, { seasonYear });
  const events = [];

  // Safety net: if the user reaches season advance without visiting Draft.jsx after this patch,
  // still write the draft mood events from the saved draft state. Stable IDs prevent duplicates.
  const draftState = readStoredDraftState(seasonYear);
  if (draftState?.completed) {
    events.push(...buildDraftMoodEvents(finalLeagueData, draftState, {
      seasonYear,
      source: options.source || "offseason_final_review",
    }));
  }

  if (baseline?.teams?.length) {
    events.push(...buildExtensionMoodEvents(finalLeagueData, baseline, options));
    events.push(...buildRosterMovementMoodEvents(finalLeagueData, baseline, options));
  }

  const retirementResult = readRetirementResultForSeason(seasonYear);
  if (retirementResult?.retiredPlayers?.length) {
    events.push(...buildRetirementMoodEventsFromRows(finalLeagueData, retirementResult, {
      ...options,
      source: options.source || "offseason_final_review_retirements",
    }));
  }

  const result = appendMoodEvents(events);
  if (events.length) {
    console.log("[offseasonMoodEvents] Full offseason mood events recorded", {
      generated: events.length,
      added: result.added,
      total: result.total,
    });
  }

  return { ...result, events };
}

export { PLAYER_MOOD_EVENT_BUS_KEY, OFFSEASON_MOOD_BASELINE_KEY };
