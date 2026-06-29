// src/utils/tradeDeskFeed.js
// Real Trade Desk feed storage/helpers for CPU-to-CPU rumors, negotiations, completed trades,
// and the Trade History Log.

export const TRADE_DESK_FEED_KEY = "bm_trade_desk_feed_v1";
const MAX_FEED_ROWS = 90;

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeJson(raw, fallback = null) {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function norm(value = "") {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function nowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return String(Date.now());
  }
}

function getCurrentSeasonYear(leagueData = {}) {
  return Number(
    leagueData?.seasonYear ||
      leagueData?.currentSeasonYear ||
      leagueData?.seasonStartYear ||
      0
  );
}

function uniqueIdForEntry(entry = {}) {
  const base = [
    entry.type || "feed",
    entry.date || entry.currentDate || "",
    entry.day || entry.dayIndex || "",
    entry.label || "",
    entry.tag || "",
    entry.headline || "",
    safeArray(entry.teamNames).join("|"),
    safeArray(entry.playerNames).join("|"),
  ].join("::");

  let hash = 0;
  for (let i = 0; i < base.length; i += 1) {
    hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
  }

  return `${norm(entry.type || "feed") || "feed"}_${hash.toString(36)}`;
}

function formatPickFromObject(pick = {}) {
  const year = pick.year || pick.season || pick.seasonYear || "Future";
  const round = Number(pick.round || pick.rnd || 1);
  const original = pick.originalTeam || pick.originalTeamName || pick.original || pick.team || pick.fromTeam || pick.owner || "Own";
  const suffix = round === 1 ? "1st" : round === 2 ? "2nd" : `R${round}`;
  const pickNumber = Number(pick.pickNumber || pick.overallPick || pick.resolvedPickNumber || pick.draftPickNumber || 0);
  const pickText = pickNumber ? ` #${pickNumber}` : "";
  return `${year} ${suffix}${pickText} - ${original}`;
}

function normalizeAsset(asset = {}, fallbackTeamName = "") {
  if (typeof asset === "string") {
    const label = cleanText(asset);
    return label ? { type: "asset", label, teamName: fallbackTeamName } : null;
  }

  if (!asset || typeof asset !== "object") return null;

  const type = cleanText(asset.type || asset.assetType || (asset.player || asset.playerName ? "player" : asset.pick || asset.year ? "pick" : "asset")).toLowerCase();

  if (type === "player") {
    const player = asset.player && typeof asset.player === "object" ? asset.player : asset;
    const label = cleanText(asset.label || asset.playerName || player.name || player.player || "Unknown Player");
    return {
      ...asset,
      type: "player",
      label,
      playerName: cleanText(asset.playerName || player.name || player.player || label),
      pos: cleanText(asset.pos || player.pos || player.position || ""),
      age: Number.isFinite(Number(asset.age ?? player.age)) ? Number(asset.age ?? player.age) : undefined,
      overall: Number.isFinite(Number(asset.overall ?? player.overall ?? player.ovr)) ? Number(asset.overall ?? player.overall ?? player.ovr) : undefined,
      potential: Number.isFinite(Number(asset.potential ?? player.potential ?? player.pot)) ? Number(asset.potential ?? player.potential ?? player.pot) : undefined,
      salary: Number.isFinite(Number(asset.salary ?? player.salary ?? player.currentSalary)) ? Number(asset.salary ?? player.salary ?? player.currentSalary) : undefined,
      teamName: cleanText(asset.teamName || player.teamName || player.currentTeam || fallbackTeamName),
    };
  }

  if (type === "pick" || type === "resolved") {
    const pick = asset.pick && typeof asset.pick === "object" ? asset.pick : asset;
    const label = cleanText(asset.label || asset.displayLabel || formatPickFromObject(pick));
    const protection = cleanText(asset.protection || pick.displayProtection || pick.protections || pick.protection || "Unprotected");
    return {
      ...asset,
      type: "pick",
      label,
      displayLabel: label,
      protection,
      year: pick.year || pick.season || pick.seasonYear,
      round: pick.round || pick.rnd,
      originalTeam: cleanText(pick.originalTeam || pick.originalTeamName || pick.original || pick.team || ""),
      teamName: cleanText(asset.teamName || pick.ownerTeam || pick.currentOwnerTeamName || pick.owner || fallbackTeamName),
    };
  }

  const label = cleanText(asset.label || asset.name || asset.title || "Asset");
  return { ...asset, type: "asset", label, teamName: cleanText(asset.teamName || fallbackTeamName) };
}

function normalizeAssetList(assets = [], fallbackTeamName = "") {
  return safeArray(assets).map((asset) => normalizeAsset(asset, fallbackTeamName)).filter(Boolean);
}

function assetsFromSummary(summary = {}, fallbackTeamName = "") {
  if (!summary || typeof summary !== "object") return [];
  const players = safeArray(summary.players).map((label) => ({ type: "player", label: cleanText(label), playerName: cleanText(label), teamName: fallbackTeamName }));
  const picks = safeArray(summary.picks).map((label) => ({ type: "pick", label: cleanText(label), displayLabel: cleanText(label), teamName: fallbackTeamName }));
  return [...players, ...picks].filter((asset) => asset.label);
}

function summarizeAssets(assets = []) {
  const clean = normalizeAssetList(assets).map((asset) => cleanText(asset.label)).filter(Boolean);
  if (!clean.length) return "salary and roster pieces";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean[0]}, ${clean[1]}, and ${clean.length - 2} more`;
}

function summarizePlayers(players = []) {
  const clean = safeArray(players).map(cleanText).filter(Boolean);
  if (!clean.length) return "salary and roster pieces";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean[0]}, ${clean[1]}, and ${clean.length - 2} more`;
}

function summarizePicks(picks = []) {
  const clean = safeArray(picks).map(cleanText).filter(Boolean);
  if (!clean.length) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean[0]}, ${clean[1]}, and ${clean.length - 2} more picks`;
}

function assetsLine(players = [], picks = []) {
  const playerLine = summarizePlayers(players);
  const pickLine = summarizePicks(picks);
  return pickLine ? `${playerLine}, plus ${pickLine}` : playerLine;
}

function reasonForTeam(row = {}, teamName = "", fallback = "") {
  const reasonMap = row.reasoning && typeof row.reasoning === "object" ? row.reasoning : {};
  const direct = reasonMap[teamName] || reasonMap[norm(teamName)] || "";
  if (direct) return cleanText(direct);

  const side = safeArray(row.teamPackages).find((pkg) => norm(pkg?.teamName) === norm(teamName));
  if (side?.reason) return cleanText(side.reason);

  if (fallback) return cleanText(fallback);
  return `${teamName} accepted the package because the incoming value fit its roster direction and trade rules.`;
}

function buildTeamPackagesFromTradeRecord(row = {}) {
  const fromTeam = cleanText(row.fromTeamName || row.userTeamName || "");
  const toTeam = cleanText(row.toTeamName || row.cpuTeamName || "");
  if (!fromTeam || !toTeam) return [];

  if (Array.isArray(row.teamPackages) && row.teamPackages.length) {
    return row.teamPackages
      .map((side) => ({
        teamName: cleanText(side?.teamName),
        received: normalizeAssetList(side?.received, side?.teamName),
        sent: normalizeAssetList(side?.sent, side?.teamName),
        reason: cleanText(side?.reason || reasonForTeam(row, side?.teamName || "")),
      }))
      .filter((side) => side.teamName);
  }

  const fromSent = normalizeAssetList(row.fromSentAssets || row.userSentAssets, fromTeam);
  const toSent = normalizeAssetList(row.toSentAssets || row.cpuSentAssets, toTeam);
  const fallbackFromSent = fromSent.length ? fromSent : assetsFromSummary(row.userSent, fromTeam);
  const fallbackToSent = toSent.length ? toSent : assetsFromSummary(row.cpuSent, toTeam);

  return [
    {
      teamName: fromTeam,
      received: fallbackToSent,
      sent: fallbackFromSent,
      reason: reasonForTeam(row, fromTeam),
    },
    {
      teamName: toTeam,
      received: fallbackFromSent,
      sent: fallbackToSent,
      reason: reasonForTeam(row, toTeam),
    },
  ];
}

function buildTradeHeadline(row = {}, teamPackages = []) {
  const fromTeam = cleanText(row.fromTeamName || row.userTeamName || "");
  const toTeam = cleanText(row.toTeamName || row.cpuTeamName || "");
  if (row.headline) return cleanText(row.headline);

  const toSide = teamPackages.find((side) => norm(side.teamName) === norm(toTeam));
  const fromSide = teamPackages.find((side) => norm(side.teamName) === norm(fromTeam));
  if (fromTeam && toTeam && toSide && fromSide) {
    return `${toTeam} acquired ${summarizeAssets(toSide.received)} from ${fromTeam} for ${summarizeAssets(fromSide.received)}.`;
  }

  if (fromTeam && toTeam) return `${fromTeam} and ${toTeam} completed a trade.`;
  return "A completed trade was added to the league history.";
}

export function normalizeTradeDeskEntry(entry = {}) {
  if (!entry || typeof entry !== "object") return null;

  const type = cleanText(entry.type || entry.kind || "rumor").toLowerCase();
  const label = cleanText(entry.label || entry.title || (type === "transaction" ? "Transaction Wire" : "League Intel"));
  const headline = cleanText(entry.headline || entry.message || entry.text || "");
  if (!headline) return null;

  const tag = cleanText(entry.tag || type || "Feed");
  const date = cleanText(entry.date || entry.currentDate || "");
  const createdAt = cleanText(entry.createdAt || entry.timestamp || "") || nowIso();
  const dayValue = Number(entry.day ?? entry.dayIndex ?? entry.currentDay ?? 0);
  const day = Number.isFinite(dayValue) && dayValue > 0 ? dayValue : null;

  const teamNames = safeArray(entry.teamNames || entry.teams)
    .map(cleanText)
    .filter(Boolean);
  const playerNames = safeArray(entry.playerNames || entry.players)
    .map(cleanText)
    .filter(Boolean);

  const teamPackages = safeArray(entry.teamPackages)
    .map((side) => ({
      teamName: cleanText(side?.teamName),
      received: normalizeAssetList(side?.received, side?.teamName),
      sent: normalizeAssetList(side?.sent, side?.teamName),
      reason: cleanText(side?.reason || ""),
    }))
    .filter((side) => side.teamName);

  return {
    ...entry,
    id: cleanText(entry.id || "") || uniqueIdForEntry({ ...entry, type, label, headline, tag, date, teamNames, playerNames }),
    type,
    label,
    headline,
    tag,
    date,
    day,
    createdAt,
    teamNames,
    playerNames,
    teamPackages,
    priority: Number.isFinite(Number(entry.priority)) ? Number(entry.priority) : type === "transaction" ? 100 : type === "negotiation" ? 65 : 40,
    source: cleanText(entry.source || "cpu_trade_desk"),
  };
}

export function readTradeDeskFeed() {
  if (typeof localStorage === "undefined") return [];
  const rows = safeJson(localStorage.getItem(TRADE_DESK_FEED_KEY), []);
  return safeArray(rows)
    .map(normalizeTradeDeskEntry)
    .filter(Boolean)
    .sort(sortTradeDeskEntries);
}

export function writeTradeDeskFeed(entries = []) {
  const clean = safeArray(entries)
    .map(normalizeTradeDeskEntry)
    .filter(Boolean)
    .sort(sortTradeDeskEntries)
    .slice(0, MAX_FEED_ROWS);

  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(TRADE_DESK_FEED_KEY, JSON.stringify(clean));
    } catch (error) {
      console.warn("[TradeDeskFeed] failed to save feed", error);
    }
  }

  return clean;
}

export function appendTradeDeskEntries(entries = []) {
  const incoming = safeArray(entries)
    .map(normalizeTradeDeskEntry)
    .filter(Boolean);

  if (!incoming.length) return readTradeDeskFeed();

  const byId = new Map();
  for (const row of [...readTradeDeskFeed(), ...incoming]) {
    if (!row?.id) continue;
    byId.set(row.id, { ...(byId.get(row.id) || {}), ...row });
  }

  return writeTradeDeskFeed([...byId.values()]);
}

export const PLAYER_MOOD_EVENT_BUS_KEY = "bm_player_mood_event_bus_v1";
const MAX_PLAYER_MOOD_EVENT_ROWS = 1600;

function moodPlayerKeyFromName(playerName = "") {
  const clean = cleanText(playerName);
  return clean ? `name:${clean}` : "";
}

function uniquePlayerNamesFromTradeEntry(entry = {}) {
  const names = new Set();

  for (const name of safeArray(entry.playerNames || entry.players)) {
    const clean = cleanText(name);
    if (clean) names.add(clean);
  }

  for (const side of safeArray(entry.teamPackages)) {
    for (const asset of [...safeArray(side?.received), ...safeArray(side?.sent)]) {
      const normalized = normalizeAsset(asset, side?.teamName || "");
      if (normalized?.type === "player") {
        const name = cleanText(normalized.playerName || normalized.label);
        if (name) names.add(name);
      }
    }
  }

  return [...names];
}

function moodEventProfileForTradeDeskEntry(entry = {}) {
  const type = cleanText(entry.type || "").toLowerCase();
  const tag = cleanText(entry.tag || "").toLowerCase();
  const label = cleanText(entry.label || "").toLowerCase();
  const source = cleanText(entry.source || "").toLowerCase();
  const text = `${type} ${tag} ${label} ${source}`.trim();

  if (
    type === "transaction" ||
    tag.includes("completed") ||
    tag.includes("deal") ||
    label.includes("transaction") ||
    source.includes("trade_history")
  ) {
    return {
      category: "Trade Completed",
      baseImpact: -4,
      decayPctPerWeek: 5,
      text: "He was directly involved in a completed trade.",
      duration: "temporary",
      type: "trade_completed",
    };
  }

  if (
    type === "negotiation" ||
    tag.includes("stalled") ||
    label.includes("stalled") ||
    source.includes("rejected")
  ) {
    return {
      category: "Trade Talks",
      baseImpact: -5,
      decayPctPerWeek: 5,
      text: "His name came up in trade talks that did not get completed.",
      duration: "temporary",
      type: "trade_talks",
    };
  }

  if (text.includes("rumor") || text.includes("intel") || text.includes("checked")) {
    return {
      category: "Trade Rumors",
      baseImpact: -6,
      decayPctPerWeek: 5,
      text: "His name came up in league trade chatter.",
      duration: "temporary",
      type: "trade_rumor",
    };
  }

  return {
    category: "Trade Desk",
    baseImpact: -3,
    decayPctPerWeek: 5,
    text: "Trade desk activity added uncertainty around his situation.",
    duration: "temporary",
    type: "trade_desk_context",
  };
}

function moodEventDateForTradeDeskEntry(entry = {}, fallbackDate = "") {
  const value = cleanText(entry.date || entry.currentDate || fallbackDate || "");
  if (value) return value.slice(0, 10);
  return nowIso().slice(0, 10);
}

export function buildPlayerMoodEventsFromTradeDeskEntries(entries = [], options = {}) {
  const out = [];
  const fallbackDate = cleanText(options.currentDate || options.date || "");

  for (const rawEntry of safeArray(entries)) {
    const entry = normalizeTradeDeskEntry(rawEntry);
    if (!entry?.id) continue;

    const playerNames = uniquePlayerNamesFromTradeEntry(entry);
    if (!playerNames.length) continue;

    const profile = moodEventProfileForTradeDeskEntry(entry);
    const eventDate = moodEventDateForTradeDeskEntry(entry, fallbackDate);

    for (const name of playerNames) {
      const cleanName = cleanText(name);
      if (!cleanName) continue;

      out.push({
        id: `trade_desk_${entry.id}_${norm(cleanName)}`,
        playerName: cleanName,
        playerKey: moodPlayerKeyFromName(cleanName),
        category: profile.category,
        impact: profile.baseImpact,
        baseImpact: profile.baseImpact,
        modifierType: "temporary",
        decayMode: "percent_of_original",
        decayPctPerWeek: profile.decayPctPerWeek || 5,
        text: profile.text,
        detail: entry.headline || "",
        type: profile.type,
        duration: profile.duration,
        date: eventDate,
        source: "trade_desk_event_bus",
        tradeDeskEntryId: entry.id,
        hideWhenExpired: true,
      });
    }
  }

  return out;
}

export function readPlayerMoodEventBus() {
  if (typeof localStorage === "undefined") return [];
  return safeArray(safeJson(localStorage.getItem(PLAYER_MOOD_EVENT_BUS_KEY), []));
}

export function writePlayerMoodEventBus(events = []) {
  const byId = new Map();

  for (const event of safeArray(events)) {
    const id = cleanText(event?.id || "");
    if (!id) continue;
    byId.set(id, {
      ...event,
      id,
    });
  }

  const clean = [...byId.values()]
    .sort((a, b) => {
      const dateA = Date.parse(a.createdAt || a.date || "") || 0;
      const dateB = Date.parse(b.createdAt || b.date || "") || 0;
      if (dateA !== dateB) return dateB - dateA;
      return String(b.id || "").localeCompare(String(a.id || ""));
    })
    .slice(0, MAX_PLAYER_MOOD_EVENT_ROWS);

  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(PLAYER_MOOD_EVENT_BUS_KEY, JSON.stringify(clean));
    } catch (error) {
      console.warn("[TradeDeskFeed] failed to save player mood event bus", error);
    }
  }

  return clean;
}

export function appendPlayerMoodEvents(events = []) {
  const incoming = safeArray(events).filter((event) => event && typeof event === "object");
  if (!incoming.length) return readPlayerMoodEventBus();

  return writePlayerMoodEventBus([...readPlayerMoodEventBus(), ...incoming]);
}

export function appendTradeDeskMoodEventsFromEntries(entries = [], options = {}) {
  const events = buildPlayerMoodEventsFromTradeDeskEntries(entries, options);
  return appendPlayerMoodEvents(events);
}

function moodNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseMoodPair(value = "0-0") {
  const [m, a] = String(value || "0-0").split("-").map(Number);
  return { m: m || 0, a: a || 0 };
}

function moodNormPart(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function rosterStrengthForMood(team = {}) {
  const players = safeArray(team?.players);
  if (!players.length) return 65;

  const ranked = [...players].sort(
    (a, b) => moodNum(b?.overall ?? b?.ovr, 0) - moodNum(a?.overall ?? a?.ovr, 0)
  );

  const avg = (rows, getter) =>
    rows.length ? rows.reduce((sum, row) => sum + getter(row), 0) / rows.length : 0;

  const top1 = moodNum(ranked[0]?.overall ?? ranked[0]?.ovr, 70);
  const top3 = avg(ranked.slice(0, 3), (p) => moodNum(p?.overall ?? p?.ovr, 0));
  const top8 = avg(ranked.slice(0, 8), (p) => moodNum(p?.overall ?? p?.ovr, 0));
  const potTop5 = avg(ranked.slice(0, 5), (p) =>
    moodNum(p?.potential ?? p?.pot, moodNum(p?.overall ?? p?.ovr, 0))
  );

  return Number((top1 * 0.27 + top3 * 0.33 + top8 * 0.32 + potTop5 * 0.08).toFixed(2));
}

function findMoodTeam(allTeams = [], teamName = "") {
  const target = norm(teamName);
  return safeArray(allTeams).find((team) => norm(team?.name || team?.teamName || team?.team || "") === target) || null;
}

function rosterPlayersForMoodTeam(team = {}) {
  return [
    ...safeArray(team?.players),
    ...safeArray(team?.twoWayPlayers),
  ].filter((player) => player && (player.name || player.player || player.playerName));
}

function moodPlayerName(player = {}) {
  return cleanText(player?.name || player?.player || player?.playerName || "");
}

function findMoodRosterPlayer(allTeams = [], teamName = "", playerName = "") {
  const team = findMoodTeam(allTeams, teamName);
  const target = norm(playerName);
  return rosterPlayersForMoodTeam(team).find((player) => norm(moodPlayerName(player)) === target) || null;
}

function moodPlayerOverall(player = {}) {
  return moodNum(player?.overall ?? player?.ovr ?? player?.rating, 72);
}

function moodPlayerPotential(player = {}) {
  const overall = moodPlayerOverall(player);
  return moodNum(player?.potential ?? player?.pot ?? player?.potential_rating, overall);
}

function moodPlayerTierFromOverall(overall = 72) {
  if (overall >= 92) return "superstar";
  if (overall >= 86) return "star";
  if (overall >= 81) return "core";
  if (overall >= 77) return "starter";
  if (overall >= 72) return "rotation";
  return "depth";
}

function teamQualityContextForMood(allTeams = [], teamName = "") {
  const ranked = safeArray(allTeams)
    .map((team) => ({
      team,
      name: team?.name || team?.teamName || team?.team || "",
      strength: rosterStrengthForMood(team),
    }))
    .filter((row) => row.name)
    .sort((a, b) => b.strength - a.strength);

  const target = norm(teamName);
  const idx = ranked.findIndex((row) => norm(row.name) === target);
  const rank = idx >= 0 ? idx + 1 : Math.ceil(Math.max(1, ranked.length) / 2);
  const teamRow = idx >= 0 ? ranked[idx] : null;
  const strength = teamRow?.strength ?? 78;
  const total = Math.max(1, ranked.length || 30);

  let tier = "balanced";
  let expectedWins = 41;
  if (rank <= 3 || strength >= 86.5) {
    tier = "title_favorite";
    expectedWins = 57;
  } else if (rank <= 6 || strength >= 84.2) {
    tier = "contender";
    expectedWins = 52;
  } else if (rank <= 12 || strength >= 81.3) {
    tier = "playoff_team";
    expectedWins = 46;
  } else if (rank <= 20 || strength >= 78.4) {
    tier = "play_in";
    expectedWins = 39;
  } else if (rank <= 25 || strength >= 75.5) {
    tier = "retooling";
    expectedWins = 34;
  } else {
    tier = "rebuilding";
    expectedWins = 26;
  }

  return {
    team: teamRow?.team || null,
    teamName,
    rank,
    total,
    strength,
    tier,
    expectedWins,
    isBadTeam: expectedWins <= 34 || rank >= Math.ceil(total * 0.68),
    isGoodTeam: expectedWins >= 46 || rank <= Math.ceil(total * 0.40),
    isEliteTeam: expectedWins >= 52 || rank <= Math.ceil(total * 0.20),
  };
}

function moodEventForPlayer({
  id,
  playerName,
  teamName,
  category,
  impact,
  text,
  detail = "",
  type,
  date,
  source = "calendar_game_context_event_bus",
  gameId = "",
  opponentName = "",
}) {
  const cleanName = cleanText(playerName);
  const cleanImpact = Number(Number(impact || 0).toFixed(1));
  if (!cleanName || !cleanImpact) return null;

  return {
    id,
    playerName: cleanName,
    playerKey: moodPlayerKeyFromName(cleanName),
    category,
    modifierType: "temporary",
    impact: cleanImpact,
    baseImpact: cleanImpact,
    decayMode: "percent_of_original",
    decayPctPerWeek: 5,
    text: cleanText(text),
    detail: cleanText(detail),
    type,
    duration: "temporary",
    date,
    source,
    gameId,
    teamName,
    opponentName,
    hideWhenExpired: true,
  };
}

function playerStatsPerGameForMood(statsMap = {}, playerName = "", teamName = "") {
  const row = statsMap?.[`${playerName}__${teamName}`] || {};
  const gp = moodNum(row?.gp, 0);
  if (gp <= 0) return null;

  return {
    gp,
    min: moodNum(row?.min, 0) / gp,
    pts: moodNum(row?.pts, 0) / gp,
    reb: moodNum(row?.reb, 0) / gp,
    ast: moodNum(row?.ast, 0) / gp,
    stl: moodNum(row?.stl, 0) / gp,
    blk: moodNum(row?.blk, 0) / gp,
    to: moodNum(row?.to ?? row?.turnovers, 0) / gp,
  };
}

function fallbackExpectedStatsForMood(player = {}, minutes = 0) {
  const overall = moodPlayerOverall(player);
  const potential = moodPlayerPotential(player);
  const minuteScale = Math.max(0.45, Math.min(1.25, moodNum(minutes, 0) / 30));

  let pts = 6;
  let reb = 3;
  let ast = 1.5;

  if (overall >= 92) {
    pts = 27;
    reb = 7;
    ast = 5.5;
  } else if (overall >= 88) {
    pts = 23;
    reb = 6;
    ast = 4.5;
  } else if (overall >= 84) {
    pts = 18;
    reb = 5.5;
    ast = 3.5;
  } else if (overall >= 80) {
    pts = 14;
    reb = 4.5;
    ast = 3;
  } else if (overall >= 76) {
    pts = 10;
    reb = 3.5;
    ast = 2.2;
  } else if (overall >= 72) {
    pts = 7;
    reb = 2.7;
    ast = 1.6;
  }

  if (potential - overall >= 6 && overall <= 78) pts += 1.5;

  return {
    gp: 0,
    min: moodNum(minutes, 0) || 18,
    pts: pts * minuteScale,
    reb: reb * minuteScale,
    ast: ast * minuteScale,
    stl: 0.8 * minuteScale,
    blk: 0.6 * minuteScale,
    to: 1.5 * minuteScale,
  };
}

function moodGameScore({ pts = 0, reb = 0, ast = 0, stl = 0, blk = 0, turnovers = 0 }) {
  return (
    moodNum(pts, 0) +
    moodNum(reb, 0) * 1.15 +
    moodNum(ast, 0) * 1.35 +
    moodNum(stl, 0) * 2.2 +
    moodNum(blk, 0) * 2.0 -
    moodNum(turnovers, 0) * 1.25
  );
}

function outcomeForMoodGame(game = {}, result = {}) {
  const homeScore = moodNum(result?.totals?.home ?? result?.winner?.home, 0);
  const awayScore = moodNum(result?.totals?.away ?? result?.winner?.away, 0);
  if (!homeScore && !awayScore) return null;
  if (homeScore === awayScore) return null;

  return {
    winner: homeScore > awayScore ? game.home : game.away,
    loser: homeScore > awayScore ? game.away : game.home,
    margin: Math.abs(homeScore - awayScore),
  };
}

function getTeamStreakThroughDateForMood(scheduleByDate = {}, resultsById = {}, teamName = "", throughDate = "") {
  const dates = Object.keys(scheduleByDate || {}).sort();
  const rows = [];

  for (const date of dates) {
    if (throughDate && date > throughDate) break;

    for (const game of scheduleByDate?.[date] || []) {
      if (!game?.id) continue;
      if (game.home !== teamName && game.away !== teamName) continue;

      const result = resultsById?.[game.id];
      if (!result) continue;

      const outcome = outcomeForMoodGame(game, result);
      if (!outcome) continue;

      rows.push({
        date,
        gameId: game.id,
        outcome: outcome.winner === teamName ? "W" : "L",
        margin: outcome.margin,
      });
    }
  }

  if (!rows.length) return { type: null, length: 0, date: throughDate };

  const latest = rows[rows.length - 1];
  let length = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i].outcome !== latest.outcome) break;
    length += 1;
  }

  return {
    type: latest.outcome === "W" ? "win" : "loss",
    length,
    date: latest.date,
    gameId: latest.gameId,
  };
}

function buildTeamResultMoodEvents({ slim, game, currentDate, allTeams = [], seasonYear }) {
  const homeScore = moodNum(slim?.totals?.home ?? slim?.winner?.home, 0);
  const awayScore = moodNum(slim?.totals?.away ?? slim?.winner?.away, 0);

  const sides = [
    {
      teamName: game.home,
      opponentName: game.away,
      won: homeScore > awayScore,
      margin: homeScore - awayScore,
    },
    {
      teamName: game.away,
      opponentName: game.home,
      won: awayScore > homeScore,
      margin: awayScore - homeScore,
    },
  ];

  const events = [];

  for (const ctx of sides) {
    const team = findMoodTeam(allTeams, ctx.teamName);
    if (!team) continue;

    const quality = teamQualityContextForMood(allTeams, ctx.teamName);
    const marginAbs = Math.abs(moodNum(ctx.margin, 0));

    let teamImpact = 0;
    let text = "";

    if (ctx.won) {
      const upsetBoost = quality.isBadTeam ? 1.1 : quality.isEliteTeam ? -0.35 : 0.25;
      const marginBoost = Math.min(1.9, marginAbs * 0.07);
      teamImpact = Math.max(0.6, Math.min(4.6, 1.15 + upsetBoost + marginBoost));
      text = marginAbs >= 18 ? "Big win lifted the room." : quality.isBadTeam ? "A needed win boosted morale." : "Win helped the room.";
    } else if (ctx.margin < 0) {
      const contenderPenalty = quality.isEliteTeam ? 0.95 : quality.isGoodTeam ? 0.45 : 0;
      const rebuildingRelief = quality.isBadTeam ? -0.45 : 0;
      const marginPenalty = Math.min(2.5, marginAbs * 0.075);
      teamImpact = -Math.max(0.4, Math.min(5.2, 0.95 + marginPenalty + contenderPenalty + rebuildingRelief));
      text = marginAbs >= 18 ? "Blowout loss hurt morale." : quality.isBadTeam ? "Loss stung less with lower expectations." : "Loss hurt morale.";
    }

    if (!teamImpact) continue;

    for (const player of rosterPlayersForMoodTeam(team)) {
      const name = moodPlayerName(player);
      if (!name) continue;

      const overall = moodPlayerOverall(player);
      const tier = moodPlayerTierFromOverall(overall);
      let playerScale = 1;

      if (ctx.won) {
        if (overall >= 88 && quality.isEliteTeam) playerScale = 0.72;
        else if (overall <= 75) playerScale = 1.16;
        else if (overall <= 79 && quality.isBadTeam) playerScale = 1.25;
      } else {
        if (overall >= 86 && quality.isBadTeam) playerScale = 1.35;
        else if (overall >= 86 && quality.isEliteTeam) playerScale = 1.18;
        else if (overall <= 75 && quality.isBadTeam) playerScale = 0.72;
        else if (tier === "depth") playerScale = 0.82;
      }

      const impact = Math.max(-6.8, Math.min(5.5, teamImpact * playerScale));
      const event = moodEventForPlayer({
        id: `team_result_recent_${seasonYear || "season"}_${moodNormPart(ctx.teamName)}_${moodNormPart(name)}`,
        playerName: name,
        teamName: ctx.teamName,
        category: ctx.won ? "Team Win" : "Team Loss",
        impact,
        text,
        detail: `${ctx.won ? "Won" : "Lost"} by ${marginAbs} vs ${ctx.opponentName}.`,
        type: ctx.won ? "team_win_recent" : "team_loss_recent",
        date: currentDate,
        gameId: game.id,
        opponentName: ctx.opponentName,
      });

      if (event) events.push(event);
    }
  }

  return events;
}

function buildTeamStreakMoodEvents({ game, currentDate, allTeams = [], scheduleByDate = {}, resultsById = {}, seasonYear }) {
  const events = [];
  const teamNames = [game.home, game.away].filter(Boolean);

  for (const teamName of teamNames) {
    const streak = getTeamStreakThroughDateForMood(scheduleByDate, resultsById, teamName, currentDate);
    if (!streak.type || streak.length < 4) continue;

    const team = findMoodTeam(allTeams, teamName);
    if (!team) continue;

    const quality = teamQualityContextForMood(allTeams, teamName);
    const isWin = streak.type === "win";

    let baseImpact = 0;
    let text = "";

    if (isWin) {
      const badTeamBoost = quality.isBadTeam ? 1.25 : quality.isEliteTeam ? 0.85 : 1;
      baseImpact = Math.min(10.5, (1.7 + streak.length * 0.72) * badTeamBoost);
      text = `${streak.length}-game win streak.`;
    } else {
      const elitePenalty = quality.isEliteTeam ? 1.28 : quality.isGoodTeam ? 1.13 : 1;
      const badTeamRelief = quality.isBadTeam ? 0.82 : 1;
      baseImpact = -Math.min(13.5, (1.9 + streak.length * 0.95) * elitePenalty * badTeamRelief);
      text = `${streak.length}-game losing streak.`;
    }

    for (const player of rosterPlayersForMoodTeam(team)) {
      const name = moodPlayerName(player);
      if (!name) continue;

      const overall = moodPlayerOverall(player);
      let playerScale = 1;

      if (isWin) {
        if (overall <= 77 && quality.isBadTeam) playerScale = 1.18;
        else if (overall >= 88 && quality.isEliteTeam) playerScale = 0.82;
      } else {
        if (overall >= 86 && quality.isBadTeam) playerScale = 1.35;
        else if (overall <= 75 && quality.isBadTeam) playerScale = 0.72;
      }

      const impact = Math.max(-15, Math.min(12, baseImpact * playerScale));
      const event = moodEventForPlayer({
        id: `team_streak_${streak.type}_${seasonYear || "season"}_${moodNormPart(teamName)}_${moodNormPart(name)}`,
        playerName: name,
        teamName,
        category: isWin ? "Win Streak" : "Loss Streak",
        impact,
        text,
        detail: isWin ? "Momentum is building." : "Team form is dragging morale down.",
        type: isWin ? "team_win_streak" : "team_loss_streak",
        date: streak.date || currentDate,
        gameId: streak.gameId || game.id,
      });

      if (event) events.push(event);
    }
  }

  return events;
}

function buildPerformanceMoodEvents({ slim, game, currentDate, allTeams = [], playerStatsBefore = {} }) {
  const homeScore = moodNum(slim?.totals?.home ?? slim?.winner?.home, 0);
  const awayScore = moodNum(slim?.totals?.away ?? slim?.winner?.away, 0);
  const sides = [
    {
      side: "home",
      teamName: game.home,
      opponentName: game.away,
      won: homeScore > awayScore,
      margin: homeScore - awayScore,
    },
    {
      side: "away",
      teamName: game.away,
      opponentName: game.home,
      won: awayScore > homeScore,
      margin: awayScore - homeScore,
    },
  ];

  const events = [];

  for (const ctx of sides) {
    const rows = safeArray(slim?.box?.[ctx.side]);
    const teamQuality = teamQualityContextForMood(allTeams, ctx.teamName);

    for (const row of rows) {
      const playerName = cleanText(row?.player);
      if (!playerName) continue;

      const minutes = moodNum(row?.min, 0);
      if (minutes < 10) continue;

      const rosterPlayer = findMoodRosterPlayer(allTeams, ctx.teamName, playerName) || {};
      const overall = moodPlayerOverall(rosterPlayer);
      const prior = playerStatsPerGameForMood(playerStatsBefore, playerName, ctx.teamName);
      const expected = prior && prior.gp >= 3 ? prior : fallbackExpectedStatsForMood(rosterPlayer, minutes);

      const pts = moodNum(row?.pts, 0);
      const reb = moodNum(row?.reb, 0);
      const ast = moodNum(row?.ast, 0);
      const stl = moodNum(row?.stl, 0);
      const blk = moodNum(row?.blk, 0);
      const turnovers = moodNum(row?.to, 0);
      const fg = parseMoodPair(row?.fg);
      const fgPct = fg.a > 0 ? fg.m / fg.a : null;

      const gameScore = moodGameScore({ pts, reb, ast, stl, blk, turnovers });
      const expectedScore = moodGameScore({
        pts: expected.pts,
        reb: expected.reb,
        ast: expected.ast,
        stl: expected.stl,
        blk: expected.blk,
        turnovers: expected.to,
      });
      const delta = gameScore - expectedScore;
      const detail = `${pts} PTS, ${reb} REB, ${ast} AST vs ${ctx.opponentName}.`;
      const isStar = overall >= 86;
      const isDepthOrRotation = overall <= 77;
      const positiveThreshold = isStar ? 11.5 : isDepthOrRotation ? 5.5 : 7.5;
      const negativeThreshold = isStar ? -9.5 : isDepthOrRotation ? -6.5 : -7.5;

      let positiveImpact = 0;
      let positiveText = "";

      if (delta >= positiveThreshold) {
        const lowerPlayerBoost = overall <= 75 ? 1.55 : overall <= 79 ? 1.28 : overall >= 88 ? 0.74 : 1;
        const badTeamWinBoost = ctx.won && teamQuality.isBadTeam ? 1.16 : 1;
        positiveImpact = Math.min(7.5, (1.0 + delta / 5.4) * lowerPlayerBoost * badTeamWinBoost);
        positiveText = isStar ? "Big game beat expectations." : "Great game boosted confidence.";
      } else if (
        ctx.won &&
        !isStar &&
        (pts >= Math.max(12, expected.pts + 5) || gameScore >= expectedScore + 5.5)
      ) {
        const lowerPlayerBoost = overall <= 75 ? 1.35 : 1.1;
        positiveImpact = Math.min(4.2, (1.1 + Math.max(0, delta) / 7) * lowerPlayerBoost);
        positiveText = "Strong game in a win boosted confidence.";
      }

      if (positiveImpact > 0) {
        const event = moodEventForPlayer({
          id: `game_perf_${game.id}_${moodNormPart(playerName)}_positive`,
          playerName,
          teamName: ctx.teamName,
          category: "Game Performance",
          impact: positiveImpact,
          text: positiveText,
          detail,
          type: "game_performance_positive",
          date: currentDate,
          source: "calendar_game_result_event_bus",
          gameId: game.id,
          opponentName: ctx.opponentName,
        });
        if (event) events.push({ ...event, _rankScore: Math.abs(positiveImpact) * 100 + delta });
      }

      let negativeImpact = 0;
      let negativeText = "";

      if (delta <= negativeThreshold) {
        const starBadTeamPenalty = isStar && teamQuality.isBadTeam && !ctx.won ? 1.32 : 1;
        const depthRelief = overall <= 75 ? 0.78 : 1;
        negativeImpact -= Math.min(6.5, (1.0 + Math.abs(delta) / 6.2) * starBadTeamPenalty * depthRelief);
        negativeText = isStar ? "Game fell below expectations." : "Quiet game caused a small dip.";
      }

      if (fg.a >= 10 && fgPct != null && fgPct <= 0.30 && pts <= Math.max(14, expected.pts - 2)) {
        negativeImpact -= isStar ? 1.9 : 1.2;
        negativeText = negativeText || "Rough shooting night caused frustration.";
      }

      if (turnovers >= 5 && minutes >= 18) {
        negativeImpact -= isStar ? 1.5 : 1.0;
        negativeText = negativeText || "Sloppy game caused frustration.";
      }

      if (!ctx.won && isStar && teamQuality.isBadTeam && gameScore <= expectedScore + 3) {
        negativeImpact -= 1.3;
        negativeText = negativeText || "Loss added pressure on a star.";
      }

      if (negativeImpact < 0) {
        const capped = Math.max(-7.5, negativeImpact);
        const event = moodEventForPlayer({
          id: `game_perf_${game.id}_${moodNormPart(playerName)}_negative`,
          playerName,
          teamName: ctx.teamName,
          category: "Game Performance",
          impact: capped,
          text: negativeText,
          detail: `${detail}${fg.a ? ` FG ${fg.m}-${fg.a}.` : ""}`,
          type: "game_performance_negative",
          date: currentDate,
          source: "calendar_game_result_event_bus",
          gameId: game.id,
          opponentName: ctx.opponentName,
        });
        if (event) events.push({ ...event, _rankScore: Math.abs(capped) * 100 + Math.abs(delta) });
      }
    }
  }

  return events
    .sort((a, b) => b._rankScore - a._rankScore)
    .slice(0, 8)
    .map(({ _rankScore, ...event }) => event);
}

export function buildRealisticGameMoodEvents({
  slim,
  game,
  currentDate,
  teams = [],
  scheduleByDate = {},
  resultsById = {},
  playerStatsBefore = {},
  seasonYear = "",
} = {}) {
  if (!slim?.box || !game?.id || !currentDate) return [];

  return [
    ...buildTeamResultMoodEvents({
      slim,
      game,
      currentDate,
      allTeams: teams,
      seasonYear,
    }),
    ...buildTeamStreakMoodEvents({
      game,
      currentDate,
      allTeams: teams,
      scheduleByDate,
      resultsById,
      seasonYear,
    }),
    ...buildPerformanceMoodEvents({
      slim,
      game,
      currentDate,
      allTeams: teams,
      playerStatsBefore,
    }),
  ];
}

export function sortTradeDeskEntries(a = {}, b = {}) {
  const dateA = Date.parse(a.createdAt || a.date || "") || 0;
  const dateB = Date.parse(b.createdAt || b.date || "") || 0;
  if (dateA !== dateB) return dateB - dateA;
  return Number(b.priority || 0) - Number(a.priority || 0);
}

export function buildTradeHistoryLogEntry(tradeRecord = {}) {
  if (!tradeRecord || typeof tradeRecord !== "object") return null;

  const fromTeam = cleanText(tradeRecord.fromTeamName || tradeRecord.userTeamName || "");
  const toTeam = cleanText(tradeRecord.toTeamName || tradeRecord.cpuTeamName || "");
  if (!fromTeam || !toTeam) return null;

  const teamPackages = buildTeamPackagesFromTradeRecord(tradeRecord);
  const headline = buildTradeHeadline(tradeRecord, teamPackages);
  const teamNames = [fromTeam, toTeam];
  const playerNames = teamPackages.flatMap((side) => side.received || [])
    .filter((asset) => asset?.type === "player")
    .map((asset) => asset.playerName || asset.label)
    .filter(Boolean);

  return normalizeTradeDeskEntry({
    id: `history_${tradeRecord.id || tradeRecord.tradeRecordId || `${fromTeam}_${toTeam}_${tradeRecord.completedAt || Date.now()}`}`,
    type: "transaction",
    label: tradeRecord.cpuCpuTrade || tradeRecord.source === "cpu_cpu_trade" ? "CPU Trade" : "Trade History",
    tag: tradeRecord.cpuCpuTrade || tradeRecord.source === "cpu_cpu_trade" ? "CPU Deal" : "Completed",
    headline,
    date: tradeRecord.date || tradeRecord.currentDate || "",
    day: tradeRecord.day || tradeRecord.dayIndex || tradeRecord.currentDay || null,
    createdAt: tradeRecord.completedAt || tradeRecord.createdAt || nowIso(),
    teamNames,
    playerNames,
    priority: 130,
    source: tradeRecord.source || "trade_history",
    tradeRecordId: tradeRecord.id || null,
    seasonYear: tradeRecord.seasonYear || null,
    cpuCpuTrade: Boolean(tradeRecord.cpuCpuTrade || tradeRecord.source === "cpu_cpu_trade"),
    teamPackages,
    reasoning: tradeRecord.reasoning || {},
  });
}

export function buildCompletedCpuTradeDeskEntry(tradeRecord = {}, currentDate = "") {
  const entry = buildTradeHistoryLogEntry({
    ...tradeRecord,
    date: currentDate || tradeRecord.date || tradeRecord.currentDate || "",
  });
  if (!entry) return null;

  return normalizeTradeDeskEntry({
    ...entry,
    id: entry.id || `history_${tradeRecord.id || Date.now()}`,
    label: tradeRecord.cpuCpuTrade || tradeRecord.source === "cpu_cpu_trade" ? "Transaction Wire" : "Trade History",
    tag: "Completed",
    priority: 120,
  });
}

export function buildRejectedCpuTradeDeskEntry({ candidate = {}, result = {}, currentDate = "" } = {}) {
  const fromTeam = cleanText(candidate.fromTeamName || candidate.sellerTeamName || "");
  const toTeam = cleanText(candidate.toTeamName || candidate.buyerTeamName || "");
  if (!fromTeam || !toTeam) return null;

  const targetNames = safeArray(candidate.fromItems)
    .filter((item) => item?.type === "player")
    .map((item) => cleanText(item?.player?.name || item?.player?.player))
    .filter(Boolean);

  const target = targetNames[0] || "a rotation piece";
  const reason = cleanText(result?.reason || "the value gap stayed too wide");

  return normalizeTradeDeskEntry({
    type: "negotiation",
    label: "Talks Stalled",
    tag: "Stalled",
    headline: `${toTeam} checked on ${target} from ${fromTeam}, but talks stalled because ${reason.toLowerCase()}.`,
    date: currentDate,
    createdAt: nowIso(),
    teamNames: [fromTeam, toTeam],
    playerNames: targetNames,
    priority: 58,
    source: "cpu_cpu_trade_rejected",
  });
}

export function buildTradeHistoryLogEntries(leagueData = {}) {
  const currentSeason = getCurrentSeasonYear(leagueData);

  return safeArray(leagueData?.tradeHistory)
    .filter((row) => {
      const rowSeason = Number(row?.seasonYear || currentSeason || 0);
      return !currentSeason || !rowSeason || rowSeason === currentSeason;
    })
    .map(buildTradeHistoryLogEntry)
    .filter(Boolean)
    .sort(sortTradeDeskEntries);
}

export function buildTradeHistoryDeskEntries(leagueData = {}) {
  return buildTradeHistoryLogEntries(leagueData).map((entry) =>
    normalizeTradeDeskEntry({
      ...entry,
      label: entry.cpuCpuTrade ? "Transaction Wire" : "Trade History",
      tag: entry.cpuCpuTrade ? "CPU Deal" : "Completed",
      priority: 120,
    })
  ).filter(Boolean);
}

export function mergeTradeDeskFeedWithLeague(feed = [], leagueData = {}) {
  const byId = new Map();
  for (const entry of [...safeArray(feed), ...buildTradeHistoryDeskEntries(leagueData)]) {
    const clean = normalizeTradeDeskEntry(entry);
    if (clean?.id) byId.set(clean.id, clean);
  }
  return [...byId.values()].sort(sortTradeDeskEntries);
}
