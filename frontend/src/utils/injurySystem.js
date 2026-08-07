import {
  GAMEPLAN_VERSION,
  buildSmartRotation,
  getRosterSignatureForGameplan,
} from "./ensureGameplans.js";
import { addIsoDays, formatLeagueDate, normalizeIsoDate } from "./leagueClock.js";

export const DEFAULT_INJURY_SETTINGS = Object.freeze({
  enabled: true,
  userAlerts: true,
  maxActivePerTeam: 4,
  rateMultiplier: 1,
});

export const INJURY_RATE_PER_10000_PLAYER_MINUTES = 6.2;

function clampNumber(value, min, max, fallback = min) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

export function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

export function normalizeInjurySettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  return {
    ...DEFAULT_INJURY_SETTINGS,
    ...source,
    enabled: source.enabled !== false,
    userAlerts: source.userAlerts !== false,
    maxActivePerTeam: Math.round(clampNumber(source.maxActivePerTeam, 1, 4, DEFAULT_INJURY_SETTINGS.maxActivePerTeam)),
    rateMultiplier: clampNumber(source.rateMultiplier, 0, 2, DEFAULT_INJURY_SETTINGS.rateMultiplier),
  };
}

export function ensureInjurySettings(leagueData) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;
  const normalized = normalizeInjurySettings(leagueData?.settings?.injuries);
  return {
    ...leagueData,
    settings: {
      ...(leagueData.settings || {}),
      injuries: normalized,
    },
  };
}

function getPlayerName(player = {}) {
  return String(player?.name || player?.player || "").trim();
}

function samePlayer(a = {}, b = {}) {
  const aId = a?.id ?? a?.playerId;
  const bId = b?.id ?? b?.playerId;
  if (aId !== undefined && aId !== null && aId !== "" && bId !== undefined && bId !== null && bId !== "") {
    return String(aId) === String(bId);
  }
  const aName = getPlayerName(a);
  const bName = getPlayerName(b);
  return Boolean(aName && bName && aName === bName);
}

function findPlayer(team, playerNameOrRow) {
  const players = Array.isArray(team?.players) ? team.players : [];
  if (!playerNameOrRow) return null;
  if (typeof playerNameOrRow === "object") {
    return players.find((player) => samePlayer(player, playerNameOrRow)) || null;
  }
  const target = String(playerNameOrRow || "").trim();
  return players.find((player) => getPlayerName(player) === target) || null;
}

export function getInjuryReturnDate(player = {}) {
  return normalizeIsoDate(player?.injury?.returnDate || player?.injuredUntil || player?.returnDate);
}

export function isPlayerInjured(player = {}, currentDate = null) {
  const injury = player?.injury;
  if (!injury || typeof injury !== "object") return false;
  if (injury.active === false) return false;

  const returnDate = getInjuryReturnDate(player);
  const asOf = normalizeIsoDate(currentDate);
  if (!returnDate || !asOf) return Boolean(injury.active !== false);

  // Players return before games on the listed return date.
  return returnDate > asOf;
}

export function getActiveInjuryCount(team = {}, currentDate = null) {
  return (team?.players || []).reduce((total, player) => total + (isPlayerInjured(player, currentDate) ? 1 : 0), 0);
}

export function getInjuryChanceForMinutes(minutesPlayed, rateMultiplier = 1) {
  const safeMinutes = Math.min(48, Math.max(0, Number(minutesPlayed) || 0));
  const base = 1 - Math.exp(-(INJURY_RATE_PER_10000_PLAYER_MINUTES * safeMinutes) / 10000);
  return Math.max(0, Math.min(1, base * clampNumber(rateMultiplier, 0, 2, 1)));
}

function randomInt(min, max, rng = Math.random) {
  const low = Math.ceil(Number(min));
  const high = Math.floor(Number(max));
  return low + Math.floor(rng() * (high - low + 1));
}

export function rollInjuryDurationDays(rng = Math.random) {
  const r = rng();
  if (r < 0.20) return randomInt(1, 3, rng);
  if (r < 0.57) return randomInt(4, 10, rng);
  if (r < 0.80) return randomInt(11, 21, rng);
  if (r < 0.92) return randomInt(22, 45, rng);
  if (r < 0.97) return randomInt(46, 90, rng);
  if (r < 0.99) return randomInt(91, 180, rng);
  return randomInt(181, 365, rng);
}

function buildInjuryEvent({ type, team, player, currentDate, days = 0, returnDate = null }) {
  return {
    id: `inj_${type}_${String(team?.name || "team").replace(/\s+/g, "_")}_${String(getPlayerName(player)).replace(/\s+/g, "_")}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    teamName: team?.name || "",
    playerName: getPlayerName(player),
    date: normalizeIsoDate(currentDate) || String(currentDate || ""),
    days: Number(days || 0),
    returnDate: normalizeIsoDate(returnDate),
  };
}

export function formatInjuryReturnLabel(player = {}, currentDate = null) {
  if (!player?.injury) return "";
  const returnDate = getInjuryReturnDate(player);
  if (!returnDate) return "Return date TBD";

  const asOf = normalizeIsoDate(currentDate);
  if (asOf && returnDate <= asOf) return "Available today";
  if (asOf && returnDate === addIsoDays(asOf, 1)) return "Returns tomorrow";
  return `Returns ${formatLeagueDate(returnDate).replace(/,? \d{4}$/i, "")}`;
}

export function formatInjuryEventLine(event = {}) {
  if (event.type === "return") {
    return `${event.playerName} has returned for ${event.teamName}.`;
  }
  if (event.type === "clear") {
    return `${event.playerName} was cleared for ${event.teamName}.`;
  }
  return `${event.playerName} is injured for ${event.days} day${Number(event.days) === 1 ? "" : "s"}. Return: ${formatLeagueDate(event.returnDate)}.`;
}

function activeGameplanFromStorage(teamName) {
  try {
    const raw = localStorage.getItem(`gameplan_${teamName}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveGameplanPayload(teamName, payload) {
  if (!teamName || typeof localStorage === "undefined") return false;
  localStorage.setItem(`gameplan_${teamName}`, JSON.stringify(payload));
  return true;
}

function sortPlayersByValue(players = []) {
  return [...players].sort((a, b) => {
    const av = Number(a?.overall ?? 0) + Number(a?.offRating ?? a?.overall ?? 0) * 0.08 + Number(a?.defRating ?? a?.overall ?? 0) * 0.08;
    const bv = Number(b?.overall ?? 0) + Number(b?.offRating ?? b?.overall ?? 0) * 0.08 + Number(b?.defRating ?? b?.overall ?? 0) * 0.08;
    if (bv !== av) return bv - av;
    return getPlayerName(a).localeCompare(getPlayerName(b));
  });
}

export function buildAvailabilityGameplanPayload(team, currentDate = null, options = {}) {
  const teamPlayers = Array.isArray(team?.players) ? team.players : [];
  const healthyPlayers = teamPlayers.filter((player) => !isPlayerInjured(player, currentDate));
  const injuredPlayers = teamPlayers.filter((player) => isPlayerInjured(player, currentDate));
  const built = buildSmartRotation(healthyPlayers);
  const healthySortedNames = new Set((built.sorted || []).map((player) => getPlayerName(player)).filter(Boolean));
  const healthyRemainder = healthyPlayers.filter((player) => !healthySortedNames.has(getPlayerName(player)));
  const orderedPlayers = [
    ...(built.sorted || []),
    ...sortPlayersByValue(healthyRemainder),
    ...sortPlayersByValue(injuredPlayers),
  ];

  const minutes = {};
  for (const player of teamPlayers) {
    const name = getPlayerName(player);
    if (!name) continue;
    minutes[name] = isPlayerInjured(player, currentDate) ? 0 : Number(built.obj?.[name] || 0);
  }

  return {
    version: GAMEPLAN_VERSION,
    teamName: team?.name || "",
    rosterSignature: getRosterSignatureForGameplan(teamPlayers),
    order: orderedPlayers.map((player) => getPlayerName(player)).filter(Boolean),
    minutes,
    manualLocked: false,
    userEdited: false,
    source: options.source || "injury_auto_rotation",
    injuryAware: true,
    injuryDate: normalizeIsoDate(currentDate),
    updatedAt: Date.now(),
  };
}

export function rebuildTeamGameplanForAvailability(team, currentDate = null, options = {}) {
  if (!team?.name) return false;
  const payload = buildAvailabilityGameplanPayload(team, currentDate, options);
  return saveGameplanPayload(team.name, payload);
}

export function forceInjuredPlayersToZero(minutes = {}, team = {}, currentDate = null) {
  const next = { ...(minutes || {}) };
  for (const player of team?.players || []) {
    const name = getPlayerName(player);
    if (!name) continue;
    if (isPlayerInjured(player, currentDate)) next[name] = 0;
    else if (!(name in next)) next[name] = 0;
  }
  return next;
}

export function readInjurySafeGameplanMinutes(team, currentDate = null) {
  const saved = activeGameplanFromStorage(team?.name);
  const rawMinutes = saved?.minutes && typeof saved.minutes === "object" && !Array.isArray(saved.minutes)
    ? saved.minutes
    : saved && typeof saved === "object"
      ? saved
      : {};
  return forceInjuredPlayersToZero(rawMinutes, team, currentDate);
}

export function ensureTeamGameplanInjurySafe(team, currentDate = null) {
  if (!team?.name) return false;
  const saved = activeGameplanFromStorage(team.name);
  const order = Array.isArray(saved?.order) ? saved.order : [];
  const minutes = saved?.minutes && typeof saved.minutes === "object" && !Array.isArray(saved.minutes)
    ? saved.minutes
    : saved && typeof saved === "object"
      ? saved
      : {};

  const starterNames = new Set(order.slice(0, 5));
  let unsafe = false;
  for (const player of team?.players || []) {
    const name = getPlayerName(player);
    if (!name) continue;
    if (isPlayerInjured(player, currentDate) && (Number(minutes?.[name] || 0) > 0 || starterNames.has(name))) {
      unsafe = true;
      break;
    }
  }

  if (!unsafe) return false;
  return rebuildTeamGameplanForAvailability(team, currentDate, { source: "injury_safety_rebuild" });
}

export function recoverPlayersForDate(leagueData, currentDate, options = {}) {
  const date = normalizeIsoDate(currentDate);
  if (!leagueData || !date) return { leagueData, events: [], touchedTeamNames: [] };

  const events = [];
  const touched = new Set();
  for (const team of getAllTeamsFromLeague(leagueData)) {
    let teamTouched = false;
    for (const player of team?.players || []) {
      const returnDate = getInjuryReturnDate(player);
      if (!player?.injury || !returnDate || returnDate > date) continue;
      player.injury = null;
      teamTouched = true;
      events.push(buildInjuryEvent({ type: "return", team, player, currentDate: date, returnDate: date }));
    }
    if (teamTouched) {
      touched.add(team.name);
      if (options.rebuildGameplans !== false) {
        rebuildTeamGameplanForAvailability(team, date, { source: "injury_return_rebuild" });
      }
    }
  }

  return { leagueData, events, touchedTeamNames: [...touched] };
}

function getBoxRowsForSide(result, side) {
  const box = result?.box || {};
  const direct = box?.[side];
  if (Array.isArray(direct)) return direct;
  const fullKeys = side === "home"
    ? ["box_home", "boxHome", "home_box"]
    : ["box_away", "boxAway", "away_box"];
  for (const key of fullKeys) {
    if (Array.isArray(result?.[key])) return result[key];
  }
  return [];
}

function rollTeamInjuries({ team, rows, currentDate, settings, rng }) {
  const date = normalizeIsoDate(currentDate);
  if (!team || !date) return { events: [], touched: false };

  let activeCount = getActiveInjuryCount(team, date);
  const maxActive = Math.max(1, Math.min(4, Number(settings.maxActivePerTeam || 4)));
  if (activeCount >= maxActive) return { events: [], touched: false };

  const events = [];
  const sortedRows = [...(rows || [])].filter((row) => Number(row?.min ?? row?.minutes ?? 0) > 0);
  for (const row of sortedRows) {
    if (activeCount >= maxActive) break;
    const playerName = row?.player || row?.name;
    const player = findPlayer(team, playerName);
    if (!player || isPlayerInjured(player, date)) continue;

    const minutes = Number(row?.min ?? row?.minutes ?? 0) || 0;
    const chance = getInjuryChanceForMinutes(minutes, settings.rateMultiplier);
    if (rng() >= chance) continue;

    const days = rollInjuryDurationDays(rng);
    const returnDate = addIsoDays(date, days) || date;
    player.injury = {
      active: true,
      startDate: date,
      returnDate,
      days,
      source: "post_game_minutes_roll",
    };
    activeCount += 1;
    events.push(buildInjuryEvent({ type: "injury", team, player, currentDate: date, days, returnDate }));
  }

  if (events.length) {
    rebuildTeamGameplanForAvailability(team, date, { source: "injury_event_rebuild" });
  }

  return { events, touched: events.length > 0 };
}

export function processGameInjuries({ leagueData, game, result, currentDate, rng = Math.random } = {}) {
  const date = normalizeIsoDate(currentDate);
  if (!leagueData || !date || !game) return { leagueData, events: [], touchedTeamNames: [] };
  const settings = normalizeInjurySettings(leagueData?.settings?.injuries);
  if (!settings.enabled || settings.rateMultiplier <= 0) return { leagueData, events: [], touchedTeamNames: [] };

  const teams = getAllTeamsFromLeague(leagueData);
  const homeTeam = teams.find((team) => team?.name === game.home || team?.name === game.homeName);
  const awayTeam = teams.find((team) => team?.name === game.away || team?.name === game.awayName);

  const events = [];
  const touched = new Set();

  const home = rollTeamInjuries({
    team: homeTeam,
    rows: getBoxRowsForSide(result, "home"),
    currentDate: date,
    settings,
    rng,
  });
  events.push(...home.events);
  if (home.touched && homeTeam?.name) touched.add(homeTeam.name);

  const away = rollTeamInjuries({
    team: awayTeam,
    rows: getBoxRowsForSide(result, "away"),
    currentDate: date,
    settings,
    rng,
  });
  events.push(...away.events);
  if (away.touched && awayTeam?.name) touched.add(awayTeam.name);

  return { leagueData, events, touchedTeamNames: [...touched] };
}

export function clearAllInjuries(leagueData, currentDate = null, options = {}) {
  if (!leagueData) return { leagueData, events: [], touchedTeamNames: [] };
  const date = normalizeIsoDate(currentDate) || normalizeIsoDate(new Date().toISOString().slice(0, 10));
  const events = [];
  const touched = new Set();

  for (const team of getAllTeamsFromLeague(leagueData)) {
    let teamTouched = false;
    for (const player of team?.players || []) {
      if (!player?.injury) continue;
      events.push(buildInjuryEvent({ type: "clear", team, player, currentDate: date, returnDate: date }));
      player.injury = null;
      teamTouched = true;
    }
    if (teamTouched) {
      touched.add(team.name);
      if (options.rebuildGameplans !== false) {
        rebuildTeamGameplanForAvailability(team, date, { source: "injury_disabled_clear_rebuild" });
      }
    }
  }

  if (leagueData.settings && typeof leagueData.settings === "object") {
    leagueData.settings.injuries = {
      ...normalizeInjurySettings(leagueData.settings.injuries),
      enabled: false,
    };
  } else {
    leagueData.settings = { injuries: { ...DEFAULT_INJURY_SETTINGS, enabled: false } };
  }

  return { leagueData, events, touchedTeamNames: [...touched] };
}
