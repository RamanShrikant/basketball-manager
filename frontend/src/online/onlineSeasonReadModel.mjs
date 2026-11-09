// Phase 2B.5: pure, read-only ONLINE season projection.
// Never fall back to single-player schedule/results/postseason keys.
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validDate = text => /^\d{4}-\d{2}-\d{2}$/.test(String(text)) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`));
const score = value => Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : null;

export function readOnlineGames(leagueData) {
  const byDate = leagueData?.onlineSchedule?.byDate;
  if (!plainObject(byDate)) return [];
  const results = plainObject(leagueData?.onlineResults) ? leagueData.onlineResults : {};
  const games = [];
  for (const [date, rows] of Object.entries(byDate)) {
    if (!validDate(date) || !Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!plainObject(row)) continue;
      const home = typeof row.home === 'string' ? row.home.trim() : '';
      const away = typeof row.away === 'string' ? row.away.trim() : '';
      if (!home || !away || home === away) continue;
      const id = row.id === undefined || row.id === null ? '' : String(row.id);
      const result = id && own(results, id) && plainObject(results[id]) ? results[id] : null;
      const homeScore = result ? score(result.homeScore ?? result.score?.home) : null;
      const awayScore = result ? score(result.awayScore ?? result.score?.away) : null;
      games.push({ id, date, home, away, homeScore, awayScore, played: homeScore !== null && awayScore !== null });
    }
  }
  return games.sort((a,b) => a.date.localeCompare(b.date) || a.home.localeCompare(b.home) || a.away.localeCompare(b.away));
}

export function readOnlineBracket(leagueData) {
  const bracket = leagueData?.onlinePostseason;
  if (!plainObject(bracket)) return null;
  if (plainObject(bracket.conferences)) return bracket;
  // Original single-player Playoffs.jsx stores conferences in `conf`.
  // Provide a read-only view adapter; do not duplicate divergent brackets.
  return plainObject(bracket.conf) ? {...bracket,conferences:bracket.conf} : null;
}

export function readOnlineSeasonYear(leagueData) {
  const raw = leagueData?.seasonYear ?? leagueData?.seasonStartYear ?? leagueData?.startYear ?? leagueData?.season;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 2000 && value <= 2100 ? value : null;
}

export function formatGameDate(date) {
  if (!validDate(date)) return date || 'Unknown date';
  const parsed = new Date(`${date}T12:00:00Z`);
  return parsed.toLocaleDateString('en-US', { timeZone:'UTC',month:'short',day:'numeric',year:'numeric' });
}
