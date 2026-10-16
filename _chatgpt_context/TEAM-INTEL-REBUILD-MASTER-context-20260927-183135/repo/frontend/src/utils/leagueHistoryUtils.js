import {
  LEAGUE_HISTORY_AWARD_META,
  LEAGUE_HISTORY_AWARD_ORDER,
  LEAGUE_HISTORY_SEED_THROUGH_SEASON_YEAR,
  LEAGUE_HISTORY_SEED_VERSION,
  REAL_NBA_AWARD_HISTORY_SEED,
  REAL_NBA_CHAMPIONS_SEED,
} from "../data/leagueHistorySeed.js";

export { LEAGUE_HISTORY_AWARD_META, LEAGUE_HISTORY_AWARD_ORDER };

const EMPTY_AWARDS = Object.fromEntries(LEAGUE_HISTORY_AWARD_ORDER.map((key) => [key, []]));

function seasonLabelFromEndYear(endYear) {
  const y = Number(endYear);
  if (!Number.isFinite(y)) return "Season";
  return `${y - 1}-${String(y).slice(-2)}`;
}

function validSeasonYear(value) {
  const y = Number(value);
  return Number.isFinite(y) && y >= 1900 && y <= 2200 ? Math.trunc(y) : null;
}

function stripDiacritics(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeHistoryName(text) {
  return stripDiacritics(text)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slug(text) {
  return normalizeHistoryName(text).replace(/\s+/g, "_");
}

const TEAM_NAME_ALIASES = {
  "la clippers": "los angeles clippers",
  "san diego clippers": "los angeles clippers",
  "buffalo braves": "los angeles clippers",
  "new jersey nets": "brooklyn nets",
  "new orleans hornets": "new orleans pelicans",
  "new orleans oklahoma city hornets": "new orleans pelicans",
  "charlotte bobcats": "charlotte hornets",
  "seattle supersonics": "oklahoma city thunder",
  "washington bullets": "washington wizards",
  "baltimore bullets": "washington wizards",
  "chicago zephyrs": "washington wizards",
  "chicago packers": "washington wizards",
  "minneapolis lakers": "los angeles lakers",
  "st louis hawks": "atlanta hawks",
  "milwaukee hawks": "atlanta hawks",
  "fort wayne pistons": "detroit pistons",
  "ft wayne pistons": "detroit pistons",
  "syracuse nationals": "philadelphia 76ers",
  "philadelphia warriors": "golden state warriors",
  "san francisco warriors": "golden state warriors",
  "rochester royals": "sacramento kings",
  "cincinnati royals": "sacramento kings",
  "kansas city kings": "sacramento kings",
  "vancouver grizzlies": "memphis grizzlies",
};

function aliasHistoryTeamName(name) {
  const normalized = normalizeHistoryName(name);
  return TEAM_NAME_ALIASES[normalized] || normalized;
}


function winnerName(row = {}) {
  return (
    row.player ||
    row.playerName ||
    row.name ||
    row.winner ||
    row.fullName ||
    row?.finals_mvp?.player ||
    ""
  );
}

function winnerTeam(row = {}) {
  return row.team || row.teamName || row.winnerTeam || row.playerTeam || row?.finals_mvp?.team || "";
}

function normalizeAwardRow(row = {}, keyFallback = "") {
  const key = row.key || row.awardKey || keyFallback;
  const meta = LEAGUE_HISTORY_AWARD_META[key];
  if (!meta) return null;

  const seasonYear =
    validSeasonYear(row.seasonYear) ??
    validSeasonYear(row.season) ??
    validSeasonYear(row.year) ??
    null;
  const player = winnerName(row);
  if (!seasonYear || !player) return null;

  const team = winnerTeam(row);
  return {
    id: row.id || `${row.source || "history"}_${key}_${seasonYear}_${slug(player)}_${slug(team)}`,
    seasonYear,
    seasonLabel: row.seasonLabel || seasonLabelFromEndYear(seasonYear),
    key,
    awardKey: key,
    label: row.label || meta.label,
    shortLabel: row.shortLabel || row.short || meta.shortLabel,
    player,
    playerName: player,
    team,
    statsSummary: row.statsSummary || row.summary || row.notes || "",
    source: row.source || "sim",
    sourceLabel: row.sourceLabel || (row.source === "real_nba_seed" ? "Real NBA" : "Sim"),
  };
}

function normalizeChampionRow(row = {}) {
  const seasonYear =
    validSeasonYear(row.seasonYear) ??
    validSeasonYear(row.season) ??
    validSeasonYear(row.year) ??
    null;
  const championTeam =
    row.championTeam ||
    row.champion_team ||
    row.champion ||
    row.team ||
    row.winnerTeam ||
    "";
  if (!seasonYear || !championTeam) return null;

  const finalsMvpObj = row.finals_mvp || row.finalsMvpObj || null;
  const finalsMvp = row.finalsMvp || row.finals_mvp_player || finalsMvpObj?.player || finalsMvpObj?.name || null;
  const finalsMvpTeam = row.finalsMvpTeam || row.finals_mvp_team || finalsMvpObj?.team || championTeam || null;

  return {
    id: row.id || `${row.source || "history"}_champion_${seasonYear}_${slug(championTeam)}`,
    seasonYear,
    seasonLabel: row.seasonLabel || seasonLabelFromEndYear(seasonYear),
    championTeam,
    runnerUp: row.runnerUp || row.runner_up || row.opponent || "",
    series: row.series || row.result || "",
    finalsMvp: finalsMvp || null,
    finalsMvpTeam: finalsMvp ? finalsMvpTeam : null,
    source: row.source || "sim",
    sourceLabel: row.sourceLabel || (row.source === "real_nba_seed" ? "Real NBA" : "Sim"),
  };
}

function sortAwardRows(rows = []) {
  return [...rows].sort(
    (a, b) =>
      Number(b.seasonYear || 0) - Number(a.seasonYear || 0) ||
      String(a.player || "").localeCompare(String(b.player || ""))
  );
}

function sortChampionRows(rows = []) {
  return [...rows].sort((a, b) => Number(b.seasonYear || 0) - Number(a.seasonYear || 0));
}

function dedupeAwards(seedRows = [], existingRows = [], key) {
  const normalizedExisting = existingRows
    .map((row) => normalizeAwardRow(row, key))
    .filter(Boolean);

  // A simulated result for a season replaces the real-life seed for that same
  // season. This lets a 2025-26 save show the real winner before completion,
  // then cleanly switch to the user's simulated winner once awards are final.
  const simulatedSeasonYears = new Set(
    normalizedExisting
      .filter((row) => row.source !== "real_nba_seed")
      .map((row) => Number(row.seasonYear))
  );

  const map = new Map();
  for (const row of seedRows) {
    const normalized = normalizeAwardRow(row, key);
    if (!normalized || simulatedSeasonYears.has(Number(normalized.seasonYear))) continue;
    const dedupeKey = `${normalized.key}|${normalized.seasonYear}|${normalizeHistoryName(normalized.player)}|${normalizeHistoryName(normalized.team)}`;
    map.set(dedupeKey, normalized);
  }

  for (const normalized of normalizedExisting) {
    const dedupeKey = `${normalized.key}|${normalized.seasonYear}|${normalizeHistoryName(normalized.player)}|${normalizeHistoryName(normalized.team)}`;
    map.set(dedupeKey, normalized);
  }

  return sortAwardRows([...map.values()]);
}

function dedupeChampions(seedRows = [], existingRows = []) {
  const map = new Map();
  for (const row of [...seedRows, ...existingRows]) {
    const normalized = normalizeChampionRow(row);
    if (!normalized) continue;
    map.set(String(normalized.seasonYear), normalized);
  }
  return sortChampionRows([...map.values()]);
}

export function mergeLeagueHistory(existingHistory = {}) {
  const awards = { ...EMPTY_AWARDS };

  for (const key of LEAGUE_HISTORY_AWARD_ORDER) {
    const existingRows = Array.isArray(existingHistory?.awards?.[key]) ? existingHistory.awards[key] : [];
    awards[key] = dedupeAwards(REAL_NBA_AWARD_HISTORY_SEED[key] || [], existingRows, key);
  }

  const existingChampionRows = Array.isArray(existingHistory?.champions) ? existingHistory.champions : [];

  return {
    ...(existingHistory && typeof existingHistory === "object" ? existingHistory : {}),
    schemaVersion: 1,
    seedVersion: LEAGUE_HISTORY_SEED_VERSION,
    seedThroughSeasonYear: LEAGUE_HISTORY_SEED_THROUGH_SEASON_YEAR,
    awards,
    champions: dedupeChampions(REAL_NBA_CHAMPIONS_SEED, existingChampionRows),
  };
}

export function ensureLeagueHistory(leagueData) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;
  return {
    ...leagueData,
    leagueHistory: mergeLeagueHistory(leagueData.leagueHistory || {}),
  };
}

export function getMergedLeagueHistory(leagueData) {
  return mergeLeagueHistory(leagueData?.leagueHistory || {});
}

function coerceWinnerForAward(rawWinner = {}, key, seasonYear) {
  const meta = LEAGUE_HISTORY_AWARD_META[key];
  const player = winnerName(rawWinner);
  if (!meta || !player) return null;

  const team = winnerTeam(rawWinner);
  const statsSummary = rawWinner.statsSummary || rawWinner.summary || "";
  return normalizeAwardRow(
    {
      id: `sim_${key}_${seasonYear}_${slug(player)}_${slug(team)}`,
      seasonYear,
      key,
      label: meta.label,
      shortLabel: meta.shortLabel,
      player,
      team,
      statsSummary,
      source: "sim",
      sourceLabel: "Sim",
    },
    key
  );
}

export function appendRegularSeasonAwardsToLeagueHistory(leagueData, awards, completedSeasonYear) {
  if (!leagueData || !awards) return leagueData;
  const seasonYear = validSeasonYear(completedSeasonYear) ?? validSeasonYear(awards?.season) ?? null;
  if (!seasonYear) return ensureLeagueHistory(leagueData);

  const base = ensureLeagueHistory(leagueData);
  const nextHistory = mergeLeagueHistory(base.leagueHistory || {});
  let changed = false;

  for (const key of LEAGUE_HISTORY_AWARD_ORDER) {
    const winner = coerceWinnerForAward(awards[key], key, seasonYear);
    if (!winner) continue;
    const withoutSameSeason = (nextHistory.awards[key] || []).filter((row) => Number(row.seasonYear) !== seasonYear);
    nextHistory.awards[key] = sortAwardRows([...withoutSameSeason, winner]);
    changed = true;
  }

  if (!changed) return base;
  return {
    ...base,
    leagueHistory: mergeLeagueHistory(nextHistory),
  };
}

export function appendChampionToLeagueHistory(leagueData, payload = {}) {
  if (!leagueData || !payload) return leagueData;
  const row = normalizeChampionRow({ ...payload, source: "sim", sourceLabel: "Sim" });
  if (!row) return ensureLeagueHistory(leagueData);

  const base = ensureLeagueHistory(leagueData);
  const nextHistory = mergeLeagueHistory(base.leagueHistory || {});
  nextHistory.champions = sortChampionRows([
    ...(nextHistory.champions || []).filter((item) => Number(item.seasonYear) !== Number(row.seasonYear)),
    row,
  ]);

  return {
    ...base,
    leagueHistory: mergeLeagueHistory(nextHistory),
  };
}

export function createPlayerLookup(leagueData = {}) {
  const players = [];
  const teams = Array.isArray(leagueData?.teams)
    ? leagueData.teams
    : Object.values(leagueData?.conferences || {}).flat();

  for (const team of teams) {
    for (const player of team?.players || []) {
      if (player?.name) players.push({ ...player, teamName: team?.name || player?.team });
    }
  }
  for (const player of leagueData?.freeAgents || []) {
    if (player?.name) players.push(player);
  }

  const map = new Map();
  for (const player of players) {
    map.set(normalizeHistoryName(player.name), player);
  }
  return map;
}

export function createTeamLogoLookup(leagueData = {}) {
  const teams = Array.isArray(leagueData?.teams)
    ? leagueData.teams
    : Object.values(leagueData?.conferences || {}).flat();
  const map = new Map();
  for (const team of teams) {
    if (!team?.name) continue;
    const logo = team.logo || team.teamLogo || team.newTeamLogo || team.logoUrl || team.image || team.img || "";
    const normalizedName = normalizeHistoryName(team.name);
    map.set(normalizedName, logo);
    map.set(aliasHistoryTeamName(team.name), logo);
  }
  return map;
}

export function findPlayerByHistoryName(playerMap, name) {
  return playerMap?.get?.(normalizeHistoryName(name)) || null;
}

export function findTeamLogoByHistoryName(teamLogoMap, name) {
  const normalized = normalizeHistoryName(name);
  return teamLogoMap?.get?.(normalized) || teamLogoMap?.get?.(aliasHistoryTeamName(name)) || "";
}
