// Pure canonical standings functions extracted verbatim from frontend/src/utils/canonicalStandings.js.
// No local storage access, no single-player code changed.
function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

