export const NBA_DIVISIONS = {
  Atlantic: ["Boston Celtics", "Brooklyn Nets", "New York Knicks", "Philadelphia 76ers", "Toronto Raptors"],
  Central: ["Chicago Bulls", "Cleveland Cavaliers", "Detroit Pistons", "Indiana Pacers", "Milwaukee Bucks"],
  Southeast: ["Atlanta Hawks", "Charlotte Hornets", "Miami Heat", "Orlando Magic", "Washington Wizards"],
  Northwest: ["Denver Nuggets", "Minnesota Timberwolves", "Oklahoma City Thunder", "Portland Trail Blazers", "Utah Jazz"],
  Pacific: ["Golden State Warriors", "Los Angeles Clippers", "Los Angeles Lakers", "Phoenix Suns", "Sacramento Kings"],
  Southwest: ["Dallas Mavericks", "Houston Rockets", "Memphis Grizzlies", "New Orleans Pelicans", "San Antonio Spurs"],
};

export const EAST_DIVISIONS = ["Atlantic", "Central", "Southeast"];
export const WEST_DIVISIONS = ["Northwest", "Pacific", "Southwest"];
export const DIVISION_NAMES = [...EAST_DIVISIONS, ...WEST_DIVISIONS];

export const TEAM_TO_DIVISION = Object.fromEntries(
  Object.entries(NBA_DIVISIONS).flatMap(([division, teams]) => teams.map((team) => [team, division]))
);

export function getDivisionConference(division = "") {
  if (EAST_DIVISIONS.includes(division)) return "East";
  if (WEST_DIVISIONS.includes(division)) return "West";
  return "";
}

export function normalizeTeamNameForDivision(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const NORMALIZED_TEAM_TO_DIVISION = Object.fromEntries(
  Object.entries(TEAM_TO_DIVISION).map(([team, division]) => [normalizeTeamNameForDivision(team), division])
);

export function getDefaultDivisionForTeam(teamName = "", conference = "") {
  const exact = TEAM_TO_DIVISION[String(teamName || "").trim()];
  if (exact) return exact;

  const normalized = NORMALIZED_TEAM_TO_DIVISION[normalizeTeamNameForDivision(teamName)];
  if (normalized) return normalized;

  const fallback = String(conference || "").toLowerCase() === "west" ? WEST_DIVISIONS : EAST_DIVISIONS;
  return fallback[0];
}

export function resolveTeamDivision(team = {}, conference = "") {
  const raw = team?.division || team?.div || team?.nbaDivision || team?.teamDivision || "";
  if (DIVISION_NAMES.includes(raw)) return raw;
  return getDefaultDivisionForTeam(team?.name || team?.team || team?.teamName || "", conference || team?.conference || team?.conf || "");
}

export function normalizeTeamDivision(team = {}, conference = "") {
  const division = resolveTeamDivision(team, conference);
  return {
    ...team,
    division,
    conference: conference || team?.conference || team?.conf || getDivisionConference(division),
  };
}

export function normalizeLeagueDivisions(leagueData = {}) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;
  const out = { ...leagueData };

  if (out.conferences && typeof out.conferences === "object") {
    out.conferences = {
      ...out.conferences,
      East: (out.conferences.East || []).map((team) => normalizeTeamDivision(team, "East")),
      West: (out.conferences.West || []).map((team) => normalizeTeamDivision(team, "West")),
    };
  }

  if (Array.isArray(out.teams)) {
    out.teams = out.teams.map((team) => normalizeTeamDivision(team, team?.conference || team?.conf || ""));
  }

  return out;
}

export function getTeamDivisionMap(leagueData = {}) {
  const map = {};
  const conferences = leagueData?.conferences || {};
  for (const [conference, teams] of Object.entries(conferences)) {
    for (const team of teams || []) {
      const name = team?.name || team?.team || team?.teamName;
      if (!name) continue;
      map[name] = resolveTeamDivision(team, conference);
    }
  }
  if (Array.isArray(leagueData?.teams)) {
    for (const team of leagueData.teams) {
      const name = team?.name || team?.team || team?.teamName;
      if (!name) continue;
      map[name] = resolveTeamDivision(team, team?.conference || team?.conf || "");
    }
  }
  return map;
}

export function groupTeamsByDivision(teams = [], leagueData = {}) {
  const teamDivisionMap = getTeamDivisionMap(leagueData);
  const out = Object.fromEntries(DIVISION_NAMES.map((division) => [division, []]));
  for (const team of teams || []) {
    const name = team?.name || team?.team || team?.teamName;
    const division = teamDivisionMap[name] || resolveTeamDivision(team, team?.conf || team?.conference || "");
    if (!out[division]) out[division] = [];
    out[division].push({ ...team, division });
  }
  return out;
}
