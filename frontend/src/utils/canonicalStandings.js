// Canonical regular-season standings and seeding helpers.
// Every live standings/postseason consumer should use this module so tied teams
// cannot be ordered differently on Standings, Playoff Picture, and Playoffs.

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function teamNameOf(team = {}) {
  return String(team?.name || team?.teamName || "").trim();
}

function defaultConferenceOf(team = {}) {
  return team?.conference || team?.conf || "";
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
    rows[name] = {
      team: name,
      conf: typeof confOf === "function" ? (confOf(name) || defaultConferenceOf(team)) : defaultConferenceOf(team),
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
      const home = rows[homeName];
      const away = rows[awayName];
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

  for (const row of Object.values(rows)) {
    row.w = row.wins;
    row.l = row.losses;
    row.diff = row.pf - row.pa;
    const gp = row.wins + row.losses;
    row.winPct = gp > 0 ? row.wins / gp : 0;
    row.pct = row.winPct;
    const confGames = row.confWins + row.confLosses;
    row.confPct = confGames > 0 ? row.confWins / confGames : 0;
  }

  return rows;
}

export function compareCanonicalTeams(teamA, teamB, standings = {}) {
  const A = String(teamA || "");
  const B = String(teamB || "");
  const a = standings?.[A];
  const b = standings?.[B];
  if (!a || !b) return A.localeCompare(B);

  if (b.winPct !== a.winPct) return b.winPct - a.winPct;

  const h2hA = a.h2h?.[B];
  const h2hB = b.h2h?.[A];
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
  return A.localeCompare(B);
}

export function sortCanonicalTeamNames(teamNames = [], standings = {}) {
  return [...(Array.isArray(teamNames) ? teamNames : [])]
    .sort((a, b) => compareCanonicalTeams(a, b, standings));
}
