const STAT_WEIGHTS = {
  pts: 1.0,
  ast: 0.7,
  reb: 0.55,
  stl: 1.75,
  blk: 1.75,
};

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positive(value) {
  return Math.max(0, num(value, 0));
}

function clamp(value, min = 0, max = 1) {
  const n = num(value, 0);
  return Math.max(min, Math.min(max, n));
}

export function mipPrevGames(prev = {}) {
  return Math.trunc(num(prev?.games ?? prev?.gp, 0));
}

export function mipPrevStat(prev = {}, key) {
  const aliases = {
    pts: ["ppg", "pts", "PTS"],
    ppg: ["ppg", "pts", "PTS"],
    reb: ["rpg", "reb", "REB"],
    rpg: ["rpg", "reb", "REB"],
    ast: ["apg", "ast", "AST"],
    apg: ["apg", "ast", "AST"],
    stl: ["spg", "stl", "STL"],
    spg: ["spg", "stl", "STL"],
    blk: ["bpg", "blk", "BLK"],
    bpg: ["bpg", "blk", "BLK"],
    mpg: ["mpg", "minutes", "min", "MIN"],
    teamNet: ["teamNet", "team_net", "netRating", "net", "pointDiff", "diff"],
    teamWins: ["teamWins", "wins", "team_wins"],
    teamGames: ["teamGames", "team_games", "games", "gp"],
    teamWinPct: ["teamWinPct", "team_win_pct", "winPct", "pct"],
  }[key] || [key];

  for (const alias of aliases) {
    if (prev?.[alias] !== undefined && prev?.[alias] !== null && prev?.[alias] !== "") {
      return num(prev[alias], 0);
    }
  }
  return 0;
}

export function mipPrevMpg(prev = {}) {
  const raw = mipPrevStat(prev, "mpg");
  const games = Math.max(mipPrevGames(prev), 1);
  return raw > 60 ? raw / games : raw;
}

function perGame(row, totalKey, perGameKey = null) {
  if (perGameKey && row?.[perGameKey] !== undefined) return num(row[perGameKey], 0);
  const gp = Math.max(num(row?.gp, 0), 1);
  return num(row?.[totalKey], 0) / gp;
}

function currentStat(row, key) {
  const aliases = {
    pts: ["_ppg", "ppg"],
    reb: ["_rpg", "rpg"],
    ast: ["_apg", "apg"],
    stl: ["_spg", "spg"],
    blk: ["_bpg", "bpg"],
  }[key] || [];

  for (const alias of aliases) {
    if (row?.[alias] !== undefined && row?.[alias] !== null && row?.[alias] !== "") {
      return num(row[alias], 0);
    }
  }

  return perGame(row, key);
}

function currentPer36(row, key) {
  const minutes = num(row?.min, 0);
  if (minutes <= 0) return currentStat(row, key);
  return (36 * num(row?.[key], 0)) / minutes;
}

function prevPer36(prev, key) {
  const prevMpg = mipPrevMpg(prev);
  if (prevMpg <= 0) return mipPrevStat(prev, key);
  return (36 * mipPrevStat(prev, key)) / prevMpg;
}

export function mipRawStatDeltaScore(row, prev = {}) {
  return (
    STAT_WEIGHTS.pts * positive(currentStat(row, "pts") - mipPrevStat(prev, "pts")) +
    STAT_WEIGHTS.ast * positive(currentStat(row, "ast") - mipPrevStat(prev, "ast")) +
    STAT_WEIGHTS.reb * positive(currentStat(row, "reb") - mipPrevStat(prev, "reb")) +
    STAT_WEIGHTS.stl * positive(currentStat(row, "stl") - mipPrevStat(prev, "stl")) +
    STAT_WEIGHTS.blk * positive(currentStat(row, "blk") - mipPrevStat(prev, "blk"))
  );
}

export function mipPer36DeltaScore(row, prev = {}) {
  return (
    STAT_WEIGHTS.pts * positive(currentPer36(row, "pts") - prevPer36(prev, "pts")) +
    STAT_WEIGHTS.ast * positive(currentPer36(row, "ast") - prevPer36(prev, "ast")) +
    STAT_WEIGHTS.reb * positive(currentPer36(row, "reb") - prevPer36(prev, "reb")) +
    STAT_WEIGHTS.stl * positive(currentPer36(row, "stl") - prevPer36(prev, "stl")) +
    STAT_WEIGHTS.blk * positive(currentPer36(row, "blk") - prevPer36(prev, "blk"))
  );
}

function firstPrevNumber(prev = {}, aliases = []) {
  for (const alias of aliases) {
    if (prev?.[alias] !== undefined && prev?.[alias] !== null && prev?.[alias] !== "") {
      return num(prev[alias], null);
    }
  }
  return null;
}

function teamEfficiencyBonus(row, prev = {}) {
  const currentNet = num(row?._team_net_per_game ?? row?._teamNet ?? row?.teamNet, null);
  const previousNet = firstPrevNumber(prev, ["teamNet", "team_net", "netRating", "net", "pointDiff", "diff"]);
  if (!Number.isFinite(currentNet) || !Number.isFinite(previousNet)) return 0;
  return clamp((currentNet - previousNet) / 8, 0, 1) * 0.9;
}

function teamWinsBonus(row, prev = {}) {
  const currentGames = Math.max(num(row?._team_games ?? row?.teamGames, 0), 1);
  const currentWinPct = num(row?._team_win_pct, null);
  const currentPct = Number.isFinite(currentWinPct)
    ? currentWinPct
    : num(row?._team_wins, 0) / currentGames;

  let previousPct = firstPrevNumber(prev, ["teamWinPct", "team_win_pct", "winPct", "pct"]);
  if (!Number.isFinite(previousPct)) {
    const prevWins = firstPrevNumber(prev, ["teamWins", "wins", "team_wins"]);
    const prevGames = firstPrevNumber(prev, ["teamGames", "team_games"]);
    if (Number.isFinite(prevWins) && Number.isFinite(prevGames) && prevGames > 0) previousPct = prevWins / prevGames;
  }
  if (!Number.isFinite(previousPct)) return 0;
  return clamp((currentPct - previousPct) / 0.3, 0, 1) * 0.35;
}

export function scoreMipImprovement(row, prev = row?.mipPrev || row?.mip_prev || row?.previousSeasonStats || {}) {
  const rawDeltaScore = mipRawStatDeltaScore(row, prev);
  const per36DeltaScore = mipPer36DeltaScore(row, prev);
  return (
    rawDeltaScore +
    0.22 * per36DeltaScore +
    teamEfficiencyBonus(row, prev) +
    teamWinsBonus(row, prev)
  );
}

export function isMipImprovementEligible(row, prev = row?.mipPrev || row?.mip_prev || row?.previousSeasonStats || {}, { isRookie = false } = {}) {
  if (isRookie) return false;
  if (!prev || typeof prev !== "object") return false;
  if (num(row?.gp, 0) < 65) return false;
  if (mipPrevGames(prev) < 30) return false;
  if (perGame(row, "min") < 18) return false;
  const prevActivity =
    mipPrevStat(prev, "pts") +
    0.55 * mipPrevStat(prev, "reb") +
    0.7 * mipPrevStat(prev, "ast") +
    1.75 * mipPrevStat(prev, "stl") +
    1.75 * mipPrevStat(prev, "blk");
  if (mipPrevMpg(prev) <= 0.01 && prevActivity <= 0.25) return false;

  const rawDeltaScore = mipRawStatDeltaScore(row, prev);
  const per36DeltaScore = mipPer36DeltaScore(row, prev);
  const ppgDelta = currentStat(row, "pts") - mipPrevStat(prev, "pts");
  return rawDeltaScore >= 1.2 || ppgDelta >= 1.0 || per36DeltaScore >= 1.8;
}
