const teams = [
  {
    id: "storm",
    name: "Seaside Storm",
    city: "Seaside",
    abbreviation: "SEA",
    coach: "Clara Hughes",
    playStyle: "Up-tempo pace with pressure defense",
    playerIds: ["p1", "p2", "p3", "p4", "p5"],
  },
  {
    id: "tigers",
    name: "Metro Tigers",
    city: "Metro City",
    abbreviation: "MET",
    coach: "Derrick Lang",
    playStyle: "Deliberate half-court offense",
    playerIds: ["p6", "p7", "p8", "p9", "p10"],
  },
  {
    id: "guards",
    name: "Capital Guardians",
    city: "Capital City",
    abbreviation: "CAP",
    coach: "Nia Patel",
    playStyle: "Switch-heavy defense with balanced scoring",
    playerIds: ["p11", "p12", "p13", "p14", "p15"],
  },
];

const players = [
  {
    id: "p1",
    name: "Jordan Miles",
    position: "PG",
    overall: 88,
    salary: 21.4,
    contractYears: 3,
    teamId: "storm",
  },
  {
    id: "p2",
    name: "Kendrick Holloway",
    position: "SG",
    overall: 84,
    salary: 17.2,
    contractYears: 2,
    teamId: "storm",
  },
  {
    id: "p3",
    name: "Isaiah Reed",
    position: "SF",
    overall: 82,
    salary: 16.8,
    contractYears: 4,
    teamId: "storm",
  },
  {
    id: "p4",
    name: "Malik Collins",
    position: "PF",
    overall: 86,
    salary: 20.1,
    contractYears: 2,
    teamId: "storm",
  },
  {
    id: "p5",
    name: "Noah Ibanez",
    position: "C",
    overall: 90,
    salary: 24.7,
    contractYears: 5,
    teamId: "storm",
  },
  {
    id: "p6",
    name: "Riley Thornton",
    position: "PG",
    overall: 80,
    salary: 14.3,
    contractYears: 1,
    teamId: "tigers",
  },
  {
    id: "p7",
    name: "Zion Delgado",
    position: "SG",
    overall: 83,
    salary: 18.9,
    contractYears: 4,
    teamId: "tigers",
  },
  {
    id: "p8",
    name: "Omar Jarrett",
    position: "SF",
    overall: 85,
    salary: 22.5,
    contractYears: 3,
    teamId: "tigers",
  },
  {
    id: "p9",
    name: "Luka Barea",
    position: "PF",
    overall: 81,
    salary: 16.4,
    contractYears: 2,
    teamId: "tigers",
  },
  {
    id: "p10",
    name: "Felix Danvers",
    position: "C",
    overall: 87,
    salary: 23.1,
    contractYears: 3,
    teamId: "tigers",
  },
  {
    id: "p11",
    name: "Miles Everett",
    position: "PG",
    overall: 86,
    salary: 19.6,
    contractYears: 4,
    teamId: "guards",
  },
  {
    id: "p12",
    name: "Logan Price",
    position: "SG",
    overall: 89,
    salary: 25.8,
    contractYears: 2,
    teamId: "guards",
  },
  {
    id: "p13",
    name: "Harper Stokes",
    position: "SF",
    overall: 84,
    salary: 18.1,
    contractYears: 3,
    teamId: "guards",
  },
  {
    id: "p14",
    name: "Darius Knox",
    position: "PF",
    overall: 85,
    salary: 19.9,
    contractYears: 4,
    teamId: "guards",
  },
  {
    id: "p15",
    name: "Jonas Richter",
    position: "C",
    overall: 88,
    salary: 22.7,
    contractYears: 1,
    teamId: "guards",
  },
];

let nextPlayerId = players.length + 1;

const clone = (value) => JSON.parse(JSON.stringify(value));

const getTeamById = (teamId) => teams.find((team) => team.id === teamId);
const getPlayerById = (playerId) => players.find((player) => player.id === playerId);

const detachPlayerFromTeam = (playerId, teamId) => {
  if (!teamId) return;
  const team = getTeamById(teamId);
  if (!team) return;
  team.playerIds = team.playerIds.filter((id) => id !== playerId);
};

const attachPlayerToTeam = (playerId, teamId) => {
  if (!teamId) return;
  const team = getTeamById(teamId);
  if (!team) throw new Error(`Unknown team '${teamId}'`);
  if (!team.playerIds.includes(playerId)) {
    team.playerIds.push(playerId);
  }
};

const calculateTeamRating = (playerIds) => {
  const roster = playerIds
    .map((playerId) => getPlayerById(playerId))
    .filter(Boolean);
  if (!roster.length) {
    return 0;
  }
  const total = roster.reduce((sum, player) => sum + (player.overall || 0), 0);
  return Math.round((total / roster.length) * 10) / 10;
};

const asTeamSnapshot = (team) => {
  const roster = team.playerIds
    .map((playerId) => getPlayerById(playerId))
    .filter(Boolean)
    .map(clone);
  return {
    ...clone(team),
    players: roster,
    rating: calculateTeamRating(team.playerIds),
  };
};

export const listTeams = () => teams.map((team) => asTeamSnapshot(team));

export const findTeam = (teamId) => {
  const team = getTeamById(teamId);
  return team ? asTeamSnapshot(team) : null;
};

export const listPlayers = () => players.map((player) => clone(player));

export const createPlayer = ({
  name,
  position,
  overall,
  salary,
  contractYears,
  teamId,
}) => {
  const id = `p${nextPlayerId++}`;
  const player = {
    id,
    name: name?.trim() || "New Player",
    position: position?.toUpperCase() || "PG",
    overall: Number.isFinite(overall) ? Number(overall) : 75,
    salary: Number.isFinite(salary) ? Number(salary) : 8.5,
    contractYears: Number.isFinite(contractYears) ? Number(contractYears) : 2,
    teamId: teamId || null,
  };

  players.push(player);
  if (player.teamId) {
    attachPlayerToTeam(player.id, player.teamId);
  }

  return clone(player);
};

export const updatePlayer = (playerId, updates = {}) => {
  const player = getPlayerById(playerId);
  if (!player) {
    throw new Error(`Player '${playerId}' not found`);
  }

  const { teamId: nextTeamId, ...rest } = updates;
  if (Object.prototype.hasOwnProperty.call(updates, "teamId")) {
    if (player.teamId !== nextTeamId) {
      detachPlayerFromTeam(player.id, player.teamId);
      if (nextTeamId) {
        attachPlayerToTeam(player.id, nextTeamId);
      }
      player.teamId = nextTeamId || null;
    }
  }

  if (rest.name !== undefined) {
    player.name = String(rest.name).trim() || player.name;
  }
  if (rest.position !== undefined) {
    player.position = String(rest.position).toUpperCase() || player.position;
  }
  if (rest.overall !== undefined) {
    const value = Number(rest.overall);
    if (!Number.isNaN(value)) {
      player.overall = value;
    }
  }
  if (rest.salary !== undefined) {
    const value = Number(rest.salary);
    if (!Number.isNaN(value)) {
      player.salary = value;
    }
  }
  if (rest.contractYears !== undefined) {
    const value = Number(rest.contractYears);
    if (!Number.isNaN(value)) {
      player.contractYears = value;
    }
  }

  return clone(player);
};

export const evaluateTrade = ({
  teamAId,
  teamBId,
  teamAPlayerIds = [],
  teamBPlayerIds = [],
}) => {
  const teamA = getTeamById(teamAId);
  const teamB = getTeamById(teamBId);
  if (!teamA || !teamB) {
    throw new Error("Both teams must exist to simulate a trade.");
  }

  const invalidFromA = teamAPlayerIds.filter((id) => !teamA.playerIds.includes(id));
  const invalidFromB = teamBPlayerIds.filter((id) => !teamB.playerIds.includes(id));
  if (invalidFromA.length || invalidFromB.length) {
    const errors = [];
    if (invalidFromA.length) {
      errors.push(`Players ${invalidFromA.join(", ")} do not belong to team ${teamAId}.`);
    }
    if (invalidFromB.length) {
      errors.push(`Players ${invalidFromB.join(", ")} do not belong to team ${teamBId}.`);
    }
    throw new Error(errors.join(" "));
  }

  const newTeamAIds = teamA.playerIds
    .filter((id) => !teamAPlayerIds.includes(id))
    .concat(teamBPlayerIds);
  const newTeamBIds = teamB.playerIds
    .filter((id) => !teamBPlayerIds.includes(id))
    .concat(teamAPlayerIds);

  const teamABefore = asTeamSnapshot(teamA);
  const teamBBefore = asTeamSnapshot(teamB);

  const teamAAfter = {
    ...clone(teamABefore),
    players: newTeamAIds.map((playerId) => clone(getPlayerById(playerId))).filter(Boolean),
    rating: calculateTeamRating(newTeamAIds),
  };
  const teamBAfter = {
    ...clone(teamBBefore),
    players: newTeamBIds.map((playerId) => clone(getPlayerById(playerId))).filter(Boolean),
    rating: calculateTeamRating(newTeamBIds),
  };

  return {
    teamA: {
      before: teamABefore,
      after: teamAAfter,
      ratingDelta: Math.round((teamAAfter.rating - teamABefore.rating) * 10) / 10,
    },
    teamB: {
      before: teamBBefore,
      after: teamBAfter,
      ratingDelta: Math.round((teamBAfter.rating - teamBBefore.rating) * 10) / 10,
    },
  };
};

export const simulateGame = ({ homeTeamId, awayTeamId }) => {
  const homeTeam = getTeamById(homeTeamId);
  const awayTeam = getTeamById(awayTeamId);
  if (!homeTeam || !awayTeam) {
    throw new Error("Both teams must be provided to simulate a game.");
  }
  if (homeTeamId === awayTeamId) {
    throw new Error("Please choose two different teams.");
  }

  const home = asTeamSnapshot(homeTeam);
  const away = asTeamSnapshot(awayTeam);

  const ratingDiff = home.rating - away.rating;
  const homeEdge = 3;
  const randomSwing = () => Math.floor(Math.random() * 12) - 6;

  const homeScore = 100 + Math.round((ratingDiff + homeEdge) * 1.2) + randomSwing();
  const awayScore = 100 - Math.round((ratingDiff + homeEdge) * 0.8) + randomSwing();

  const finalHome = Math.max(homeScore, 80);
  const finalAway = Math.max(awayScore, 80);

  const winner =
    finalHome === finalAway ? "Overtime Needed" : finalHome > finalAway ? home.name : away.name;

  return {
    homeTeam: {
      ...home,
      score: finalHome,
    },
    awayTeam: {
      ...away,
      score: finalAway,
    },
    winner,
  };
};

export const ensureTeamExists = (teamId) => {
  if (!teamId) return null;
  const team = getTeamById(teamId);
  if (!team) {
    throw new Error(`Team '${teamId}' was not found.`);
  }
  return clone(team);
};

export const ensurePlayerExists = (playerId) => {
  const player = getPlayerById(playerId);
  if (!player) {
    throw new Error(`Player '${playerId}' was not found.`);
  }
  return clone(player);
};

