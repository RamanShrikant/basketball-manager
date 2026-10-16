import LZString from "lz-string";

// Canonical regular-season standings and seeding helpers.
// Every live standings/postseason consumer should use this module so tied teams
// cannot be ordered differently on Standings, Calendar, Trade Center/Finder,
// Playoff Picture, and Playoffs.

const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_";

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeParseMaybeCompressed(raw, fallback = null) {
  if (!raw) return fallback;
  try {
    if (String(raw).startsWith("lz:")) {
      const decompressed = LZString.decompressFromUTF16(String(raw).slice(3));
      return decompressed ? JSON.parse(decompressed) : fallback;
    }
  } catch {}
  try {
    return JSON.parse(raw);
  } catch {}
  try {
    const decompressed = LZString.decompressFromUTF16(raw);
    return decompressed ? JSON.parse(decompressed) : fallback;
  } catch {
    return fallback;
  }
}

function safeLocalStorageGet(key) {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function loadRegularSeasonResultsV3FromStorage() {
  const ids = safeParseMaybeCompressed(safeLocalStorageGet(RESULT_V3_INDEX_KEY), []) || [];
  const out = {};
  for (const id of Array.isArray(ids) ? ids : []) {
    const gameId = String(id);
    const result = safeParseMaybeCompressed(safeLocalStorageGet(`${RESULT_V3_PREFIX}${gameId}`), null);
    if (result) out[gameId] = result;
  }
  return out;
}

export function normalizeStandingsTeamName(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function normalizeStandingsConference(value = "") {
  const raw = String(value || "").trim();
  const lower = raw.toLowerCase();
  if (lower.includes("east")) return "East";
  if (lower.includes("west")) return "West";
  return raw;
}

function teamNameOf(team = {}) {
  return String(team?.name || team?.teamName || team?.team || "").trim();
}

function defaultConferenceOf(team = {}) {
  return normalizeStandingsConference(team?.conference || team?.conf || team?.divisionConference || "");
}

function allTeamsFromLeague(leagueData = {}) {
  if (Array.isArray(leagueData?.teams)) return leagueData.teams.filter(Boolean);
  return Object.entries(leagueData?.conferences || {}).flatMap(([conference, teams]) =>
    (Array.isArray(teams) ? teams : []).filter(Boolean).map((team) => ({
      ...team,
      conference: team?.conference || team?.conf || conference,
    }))
  );
}

export function buildConferenceLookup(leagueData = {}, teams = []) {
  const lookup = new Map();
  if (leagueData?.conferences && typeof leagueData.conferences === "object") {
    for (const [conference, rows] of Object.entries(leagueData.conferences)) {
      for (const team of Array.isArray(rows) ? rows : []) {
        const name = teamNameOf(team);
        if (name) lookup.set(normalizeStandingsTeamName(name), normalizeStandingsConference(conference));
      }
    }
  }
  for (const team of Array.isArray(teams) ? teams : []) {
    const name = teamNameOf(team);
    if (!name) continue;
    const key = normalizeStandingsTeamName(name);
    if (!lookup.has(key)) lookup.set(key, defaultConferenceOf(team));
  }
  return lookup;
}

function ensureStandingRow(rows, teamName, conf = "") {
  if (!teamName) return null;
  const key = String(teamName);
  if (!rows[key]) {
    rows[key] = {
      team: key,
      conf: normalizeStandingsConference(conf),
      wins: 0,
      losses: 0,
      w: 0,
      l: 0,
      pf: 0,
      pa: 0,
      diff: 0,
      confWins: 0,
      confLosses: 0,
      confPct: 0,
      winPct: 0,
      pct: 0,
      h2h: {},
    };
  } else if (!rows[key].conf && conf) {
    rows[key].conf = normalizeStandingsConference(conf);
  }
  return rows[key];
}

function finalizeStandingRows(rows = {}) {
  for (const row of Object.values(rows)) {
    row.wins = finite(row.wins ?? row.w, 0);
    row.losses = finite(row.losses ?? row.l, 0);
    row.w = row.wins;
    row.l = row.losses;
    row.pf = finite(row.pf, 0);
    row.pa = finite(row.pa, 0);
    row.diff = finite(row.diff, row.pf - row.pa);
    const gp = row.wins + row.losses;
    row.games = gp;
    row.gamesPlayed = gp;
    row.gp = gp;
    row.winPct = gp > 0 ? row.wins / gp : 0;
    row.pct = row.winPct;
    row.confWins = finite(row.confWins ?? row.conferenceWins, 0);
    row.confLosses = finite(row.confLosses ?? row.conferenceLosses, 0);
    const confGames = row.confWins + row.confLosses;
    row.confPct = confGames > 0 ? row.confWins / confGames : 0;
  }
  return rows;
}

export function computeCanonicalStandings({
  teams = [],
  scheduleByDate = {},
  resultsById = {},
  confOf = null,
} = {}) {
  const rows = {};

  for (const team of Array.isArray(teams) ? teams : []) {
    const name = teamNameOf(team);
    if (!name) continue;
    ensureStandingRow(
      rows,
      name,
      typeof confOf === "function" ? (confOf(name) || defaultConferenceOf(team)) : defaultConferenceOf(team)
    );
  }

  for (const games of Object.values(scheduleByDate || {})) {
    for (const game of Array.isArray(games) ? games : []) {
      const gameId = game?.id;
      if (gameId == null) continue;
      const idText = String(gameId);
      if (idText.startsWith("PO_") || idText.startsWith("PI_")) continue;

      const result = resultsById?.[gameId] || resultsById?.[idText];
      if (!result?.totals) continue;

      const homeName = game?.home;
      const awayName = game?.away;
      const home = ensureStandingRow(rows, homeName, game?.confHome || (typeof confOf === "function" ? confOf(homeName) : ""));
      const away = ensureStandingRow(rows, awayName, game?.confAway || (typeof confOf === "function" ? confOf(awayName) : ""));
      if (!home || !away) continue;

      const homePts = finite(result?.totals?.home, 0);
      const awayPts = finite(result?.totals?.away, 0);
      if (homePts === awayPts) continue;

      const homeWon = homePts > awayPts;
      home.pf += homePts;
      home.pa += awayPts;
      away.pf += awayPts;
      away.pa += homePts;

      if (homeWon) {
        home.wins += 1;
        away.losses += 1;
      } else {
        away.wins += 1;
        home.losses += 1;
      }

      if (home.conf && away.conf && home.conf === away.conf) {
        if (homeWon) {
          home.confWins += 1;
          away.confLosses += 1;
        } else {
          away.confWins += 1;
          home.confLosses += 1;
        }
      }

      home.h2h[awayName] ||= { w: 0, l: 0 };
      away.h2h[homeName] ||= { w: 0, l: 0 };
      if (homeWon) {
        home.h2h[awayName].w += 1;
        away.h2h[homeName].l += 1;
      } else {
        away.h2h[homeName].w += 1;
        home.h2h[awayName].l += 1;
      }
    }
  }

  return finalizeStandingRows(rows);
}

function rowTeamName(row = {}) {
  return String(row?.team || row?.teamName || row?.name || row?.team_name || "").trim();
}

export function computeCanonicalStandingsFromRows(rows = [], { leagueData = null, teams = [] } = {}) {
  const conferenceLookup = buildConferenceLookup(leagueData || {}, teams.length ? teams : allTeamsFromLeague(leagueData || {}));
  const out = {};

  for (const [index, raw] of (Array.isArray(rows) ? rows : []).entries()) {
    const team = rowTeamName(raw) || `Team ${index + 1}`;
    const wins = finite(raw?.wins ?? raw?.w ?? raw?.record?.wins ?? raw?.teamRecord?.wins ?? raw?.standings?.wins, 0);
    const losses = finite(raw?.losses ?? raw?.l ?? raw?.record?.losses ?? raw?.teamRecord?.losses ?? raw?.standings?.losses, 0);
    const pointsFor = finite(raw?.pointsFor ?? raw?.pf ?? raw?.stats?.pointsFor ?? raw?.stats?.PTS, 0);
    const pointsAgainst = finite(raw?.pointsAgainst ?? raw?.pa ?? raw?.stats?.pointsAgainst ?? raw?.stats?.PA, 0);
    const diff = finite(raw?.pointDifferential ?? raw?.diff ?? raw?.netRating, pointsFor - pointsAgainst);
    const conf = normalizeStandingsConference(
      raw?.conference || raw?.conf || conferenceLookup.get(normalizeStandingsTeamName(team)) || ""
    );
    const row = ensureStandingRow(out, team, conf);
    row.wins = wins;
    row.losses = losses;
    row.w = wins;
    row.l = losses;
    row.pf = pointsFor;
    row.pa = pointsAgainst;
    row.diff = diff;
    row.confWins = finite(raw?.conferenceWins ?? raw?.confWins, 0);
    row.confLosses = finite(raw?.conferenceLosses ?? raw?.confLosses, 0);
    row.h2h = raw?.h2h && typeof raw.h2h === "object" ? raw.h2h : {};
  }

  return finalizeStandingRows(out);
}

export function getCanonicalStandingRow(standings = {}, teamName = "") {
  const direct = standings?.[teamName];
  if (direct) return direct;
  const target = normalizeStandingsTeamName(teamName);
  if (!target) return null;
  for (const row of Object.values(standings || {})) {
    if (normalizeStandingsTeamName(row?.team) === target) return row;
  }
  return null;
}

export function compareCanonicalTeams(teamA, teamB, standings = {}) {
  const A = String(teamA || "");
  const B = String(teamB || "");
  const a = getCanonicalStandingRow(standings, A);
  const b = getCanonicalStandingRow(standings, B);
  if (!a || !b) return A.localeCompare(B);

  if (b.winPct !== a.winPct) return b.winPct - a.winPct;

  const h2hA = a.h2h?.[B] || a.h2h?.[b.team];
  const h2hB = b.h2h?.[A] || b.h2h?.[a.team];
  if (h2hA && h2hB) {
    const gamesA = finite(h2hA.w, 0) + finite(h2hA.l, 0);
    const gamesB = finite(h2hB.w, 0) + finite(h2hB.l, 0);
    if (gamesA > 0 && gamesB > 0) {
      const aPct = finite(h2hA.w, 0) / gamesA;
      const bPct = finite(h2hB.w, 0) / gamesB;
      if (bPct !== aPct) return bPct - aPct;
    }
  }

  if (b.confPct !== a.confPct) return b.confPct - a.confPct;
  if (b.diff !== a.diff) return b.diff - a.diff;
  return String(a.team || A).localeCompare(String(b.team || B));
}

export function sortCanonicalTeamNames(teamNames = [], standings = {}) {
  return [...(Array.isArray(teamNames) ? teamNames : [])]
    .sort((a, b) => compareCanonicalTeams(a, b, standings));
}

export function sortCanonicalStandingRows(rows = [], standings = {}) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) =>
    compareCanonicalTeams(rowTeamName(a), rowTeamName(b), standings)
  );
}

export function getCanonicalConferenceRankMap(standings = {}) {
  const out = new Map();
  const byConf = new Map();

  for (const row of Object.values(standings || {})) {
    const conf = normalizeStandingsConference(row?.conf || row?.conference || "");
    if (!conf) continue;
    if (!byConf.has(conf)) byConf.set(conf, []);
    byConf.get(conf).push(row.team);
  }

  for (const [conference, names] of byConf.entries()) {
    const sorted = sortCanonicalTeamNames(names, standings);
    sorted.forEach((name, index) => {
      out.set(normalizeStandingsTeamName(name), {
        rank: index + 1,
        conference,
        team: name,
        total: sorted.length,
      });
    });
  }

  return out;
}

export function buildCanonicalStandingLabelMap({
  leagueData = null,
  teams = [],
  recordsByTeam = {},
  scheduleByDate = {},
  resultsById = {},
} = {}) {
  const conferenceLookup = buildConferenceLookup(leagueData || {}, teams);
  let standings = computeCanonicalStandings({
    teams,
    scheduleByDate,
    resultsById,
    confOf: (teamName) => conferenceLookup.get(normalizeStandingsTeamName(teamName)) || "",
  });

  const playedGames = Object.values(standings || {}).reduce((sum, row) => sum + finite(row?.wins, 0) + finite(row?.losses, 0), 0);
  if (playedGames <= 0 && recordsByTeam && typeof recordsByTeam === "object") {
    standings = computeCanonicalStandingsFromRows(
      teams.map((team) => {
        const name = teamNameOf(team);
        const record = recordsByTeam?.[name] || recordsByTeam?.[normalizeStandingsTeamName(name)] || {};
        const w = finite(record?.wins ?? record?.w ?? team?.wins ?? team?.record?.wins ?? team?.seasonRecord?.wins ?? team?.stats?.wins, 0);
        const l = finite(record?.losses ?? record?.l ?? team?.losses ?? team?.record?.losses ?? team?.seasonRecord?.losses ?? team?.stats?.losses, 0);
        const pf = finite(record?.pointsFor ?? record?.pf, 0);
        const pa = finite(record?.pointsAgainst ?? record?.pa, 0);
        return {
          teamName: name,
          conference: conferenceLookup.get(normalizeStandingsTeamName(name)) || defaultConferenceOf(team),
          wins: w,
          losses: l,
          pointsFor: pf,
          pointsAgainst: pa,
          pointDifferential: finite(record?.pointDifferential ?? record?.diff, pf - pa),
        };
      }),
      { leagueData, teams }
    );
  }

  const ranks = getCanonicalConferenceRankMap(standings);
  const conferenceHasGames = new Map();
  for (const row of Object.values(standings || {})) {
    const conf = normalizeStandingsConference(row?.conf || row?.conference || "");
    if (!conf) continue;
    conferenceHasGames.set(conf, Boolean(conferenceHasGames.get(conf)) || finite(row?.games ?? row?.gamesPlayed ?? row?.gp, 0) > 0);
  }
  const map = new Map();
  for (const team of Array.isArray(teams) ? teams : []) {
    const name = teamNameOf(team);
    if (!name) continue;
    const row = getCanonicalStandingRow(standings, name) || {};
    const rank = ranks.get(normalizeStandingsTeamName(name));
    map.set(normalizeStandingsTeamName(name), {
      name,
      conference: rank?.conference || row.conf || defaultConferenceOf(team),
      wins: finite(row.wins ?? row.w, 0),
      losses: finite(row.losses ?? row.l, 0),
      games: finite(row.games ?? row.gamesPlayed ?? row.gp, finite(row.wins ?? row.w, 0) + finite(row.losses ?? row.l, 0)),
      winPct: row.winPct ?? row.pct ?? null,
      pointDiff: finite(row.diff ?? row.pointDifferential, 0),
      rank: rank?.conference && conferenceHasGames.get(rank.conference) ? rank.rank : null,
      rankTotal: rank?.conference && conferenceHasGames.get(rank.conference) ? rank.total : null,
    });
  }
  return map;
}
