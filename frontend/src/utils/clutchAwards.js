import LZString from "lz-string";

export const CLUTCH_STATS_KEY = "bm_clutch_stats_v1";
export const CLUTCH_MARGIN_MAX = 5;
export const CLUTCH_AWARD_VERSION = "cpoty_v2_2026_07_21";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parsePair(value) {
  if (value && typeof value === "object") {
    return { m: num(value.m ?? value.made), a: num(value.a ?? value.attempts) };
  }
  const parts = String(value || "0-0").split(/[\/-]/).map(Number);
  return { m: num(parts[0]), a: num(parts[1]) };
}

function emptyTotals() {
  return { gp: 0, min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 };
}

export function createEmptyClutchStats(seasonYear = null) {
  return {
    version: CLUTCH_AWARD_VERSION,
    seasonYear: Number(seasonYear || 0) || null,
    processedGameIds: [],
    teams: {},
    players: {},
    updatedAt: Date.now(),
  };
}

export function loadClutchStats(seasonYear = null) {
  try {
    const raw = localStorage.getItem(CLUTCH_STATS_KEY);
    if (!raw) return createEmptyClutchStats(seasonYear);
    const json = raw.startsWith("lz:") ? LZString.decompressFromUTF16(raw.slice(3)) : (LZString.decompressFromUTF16(raw) || raw);
    const parsed = JSON.parse(json);
    if (seasonYear && parsed?.seasonYear && Number(parsed.seasonYear) !== Number(seasonYear)) return createEmptyClutchStats(seasonYear);
    return { ...createEmptyClutchStats(seasonYear), ...parsed };
  } catch {
    return createEmptyClutchStats(seasonYear);
  }
}

export function saveClutchStats(stats) {
  try {
    const next = { ...stats, version: CLUTCH_AWARD_VERSION, updatedAt: Date.now() };
    localStorage.setItem(CLUTCH_STATS_KEY, `lz:${LZString.compressToUTF16(JSON.stringify(next))}`);
    return next;
  } catch (error) {
    console.warn("[CPOTY] failed saving clutch aggregate", error);
    return stats;
  }
}

function ensureTeam(stats, teamName) {
  if (!teamName) return null;
  stats.teams[teamName] ||= { team: teamName, clutchGames: 0, clutchWins: 0, clutchLosses: 0 };
  return stats.teams[teamName];
}

function ensurePlayer(stats, playerName, teamName) {
  if (!playerName) return null;
  stats.players[playerName] ||= {
    player: playerName,
    latestTeam: teamName || "",
    teamNames: [],
    total: emptyTotals(),
    clutch: emptyTotals(),
    nonClutch: emptyTotals(),
    clutchWins: 0,
    clutchLosses: 0,
  };
  const row = stats.players[playerName];
  if (teamName) {
    row.latestTeam = teamName;
    if (!row.teamNames.includes(teamName)) row.teamNames.push(teamName);
  }
  return row;
}

function addBoxRow(totals, row) {
  totals.gp += 1;
  totals.min += num(row?.min);
  totals.pts += num(row?.pts);
  totals.reb += num(row?.reb);
  totals.ast += num(row?.ast);
  totals.stl += num(row?.stl);
  totals.blk += num(row?.blk);
  totals.tov += num(row?.to ?? row?.tov ?? row?.turnovers);
  const fg = parsePair(row?.fg);
  const tp = parsePair(row?.["3p"]);
  const ft = parsePair(row?.ft);
  totals.fgm += fg.m; totals.fga += fg.a;
  totals.tpm += tp.m; totals.tpa += tp.a;
  totals.ftm += ft.m; totals.fta += ft.a;
}

export function applyGameToClutchStats(statsInput, slim, game, seasonYear = null) {
  if (!slim?.box || !game?.id) return statsInput || createEmptyClutchStats(seasonYear);
  const stats = statsInput || createEmptyClutchStats(seasonYear);
  stats.seasonYear = Number(stats.seasonYear || seasonYear || 0) || null;
  stats.processedGameIds ||= [];
  if (stats.processedGameIds.includes(game.id)) return stats;

  const homeScore = num(slim?.totals?.home ?? slim?.winner?.home);
  const awayScore = num(slim?.totals?.away ?? slim?.winner?.away);
  const margin = Math.abs(homeScore - awayScore);
  const isClutch = margin <= CLUTCH_MARGIN_MAX && homeScore !== awayScore;
  const winningTeam = homeScore > awayScore ? game.home : game.away;

  if (isClutch) {
    for (const teamName of [game.home, game.away]) {
      const team = ensureTeam(stats, teamName);
      if (!team) continue;
      team.clutchGames += 1;
      if (teamName === winningTeam) team.clutchWins += 1;
      else team.clutchLosses += 1;
    }
  }

  const updateSide = (side, teamName) => {
    for (const boxRow of slim?.box?.[side] || []) {
      if (!boxRow?.player) continue;
      const player = ensurePlayer(stats, boxRow.player, teamName);
      addBoxRow(player.total, boxRow);
      addBoxRow(isClutch ? player.clutch : player.nonClutch, boxRow);
      if (isClutch) {
        if (teamName === winningTeam) player.clutchWins += 1;
        else player.clutchLosses += 1;
      }
    }
  };

  updateSide("home", game.home);
  updateSide("away", game.away);
  stats.processedGameIds.push(game.id);
  return stats;
}

export function rebuildClutchStatsFromGames({ games = [], boxScoresById = {}, seasonYear = null }) {
  let stats = createEmptyClutchStats(seasonYear);
  for (const game of games || []) {
    const slim = boxScoresById?.[game?.id];
    if (!slim?.box) continue;
    stats = applyGameToClutchStats(stats, slim, game, seasonYear);
  }
  return stats;
}

function perGame(total, gp) { return gp > 0 ? num(total) / gp : 0; }
function per36(total, minutes) { return minutes > 0 ? num(total) * 36 / minutes : 0; }
function trueShooting(totals) {
  const denom = 2 * (num(totals?.fga) + 0.44 * num(totals?.fta));
  return denom > 0 ? num(totals?.pts) / denom : 0;
}
function impactTotal(t) { return num(t?.pts) + 0.75 * num(t?.reb) + 0.90 * num(t?.ast) + 1.60 * num(t?.stl) + 1.60 * num(t?.blk) - num(t?.tov); }

function percentileFactory(values) {
  const sorted = [...values].map(num).sort((a,b)=>a-b);
  return (value) => {
    if (sorted.length <= 1) return 1;
    const v = num(value);
    let below = 0; let equal = 0;
    for (const row of sorted) {
      if (row < v) below += 1;
      else if (row === v) equal += 1;
    }
    return Math.max(0, Math.min(1, (below + Math.max(0, equal - 1) / 2) / (sorted.length - 1)));
  };
}

function getRosterMeta(leagueData) {
  const teams = Array.isArray(leagueData?.teams) ? leagueData.teams : Object.values(leagueData?.conferences || {}).flat();
  const byPlayer = {};
  const teamLogos = {};
  for (const team of teams || []) {
    const teamName = team?.name || team?.team;
    const logo = team?.logo || team?.teamLogo || team?.newTeamLogo || team?.logoUrl || team?.image || team?.img || "";
    if (teamName) teamLogos[teamName] = logo;
    for (const p of team?.players || []) {
      const name = p?.name || p?.player;
      if (!name) continue;
      byPlayer[name] = {
        team: teamName,
        overall: p?.overall ?? p?.ovr ?? null,
        potential: p?.potential ?? p?.pot ?? null,
        pos: p?.pos || p?.position || "",
        age: p?.age ?? null,
        headshot: p?.portrait || p?.image || p?.photo || p?.headshot || p?.img || p?.face || "",
        teamLogo: logo,
      };
    }
  }
  return { byPlayer, teamLogos };
}

export function computeClutchAwardResults(statsInput, leagueData, { final = false } = {}) {
  const stats = statsInput || createEmptyClutchStats();
  const { byPlayer, teamLogos } = getRosterMeta(leagueData);
  const candidates = [];

  for (const row of Object.values(stats.players || {})) {
    const clutchGp = num(row?.clutch?.gp);
    const totalGp = num(row?.total?.gp);
    const nonClutchGp = num(row?.nonClutch?.gp);
    const clutchMpg = perGame(row?.clutch?.min, clutchGp);
    const meta = byPlayer[row.player] || {};
    const currentTeam = meta.team || row.latestTeam || row.teamNames?.[row.teamNames.length - 1] || "";
    const relevantTeamGames = Math.max(clutchGp, ...((row.teamNames || [currentTeam]).map((team)=>num(stats?.teams?.[team]?.clutchGames))));
    const participation = relevantTeamGames > 0 ? Math.min(1, clutchGp / relevantTeamGames) : 0;

    const minTotalGames = final ? 65 : Math.max(1, Math.ceil(totalGp * 0.8));
    if (totalGp < minTotalGames || clutchGp < (final ? 10 : 3) || clutchMpg < 18 || participation < 0.5) continue;

    const clutchImpactPg = perGame(impactTotal(row.clutch), clutchGp);
    const clutchImpact36 = per36(impactTotal(row.clutch), row.clutch.min);
    const nonClutchImpact36 = per36(impactTotal(row.nonClutch), row.nonClutch.min);
    const clutchTs = trueShooting(row.clutch);
    const nonClutchTs = trueShooting(row.nonClutch);
    const clutchWins = num(row.clutchWins);
    const clutchLosses = num(row.clutchLosses);
    const clutchGames = clutchWins + clutchLosses || clutchGp;

    candidates.push({
      player: row.player,
      team: currentTeam,
      overall: meta.overall ?? null,
      potential: meta.potential ?? null,
      pos: meta.pos || "",
      age: meta.age ?? null,
      headshot: meta.headshot || "",
      teamLogo: meta.teamLogo || teamLogos[currentTeam] || "",
      gp: totalGp,
      clutch_gp: clutchGp,
      clutch_mpg: clutchMpg,
      clutch_wins: clutchWins,
      clutch_losses: clutchLosses,
      clutch_games: clutchGames,
      clutch_win_pct: clutchGames ? clutchWins / clutchGames : 0,
      adjusted_clutch_win_pct: (clutchWins + 5) / (clutchGames + 10),
      clutch_ppg: perGame(row.clutch.pts, clutchGp),
      clutch_rpg: perGame(row.clutch.reb, clutchGp),
      clutch_apg: perGame(row.clutch.ast, clutchGp),
      clutch_spg: perGame(row.clutch.stl, clutchGp),
      clutch_bpg: perGame(row.clutch.blk, clutchGp),
      clutch_impact_pg: clutchImpactPg,
      clutch_impact_per36: clutchImpact36,
      non_clutch_impact_per36: nonClutchImpact36,
      impact_lift: clutchImpact36 - nonClutchImpact36,
      clutch_ts_pct: clutchTs * 100,
      non_clutch_ts_pct: nonClutchTs * 100,
      ts_lift: (clutchTs - nonClutchTs) * 100,
      participation,
      relevant_team_clutch_games: relevantTeamGames,
    });
  }

  if (!candidates.length) return { clutch_player: null, clutch_player_race: [], clutch_award_version: CLUTCH_AWARD_VERSION };

  const pctRecord = percentileFactory(candidates.map((p)=>p.adjusted_clutch_win_pct));
  const pctWins = percentileFactory(candidates.map((p)=>p.clutch_wins));
  const pctImpact = percentileFactory(candidates.map((p)=>p.clutch_impact_pg));
  const pctTs = percentileFactory(candidates.map((p)=>p.clutch_ts_pct));

  const maxPositiveImpactLift = Math.max(...candidates.map((p)=>Math.max(0, num(p.impact_lift))), 0);
  const maxPositiveTsLift = Math.max(...candidates.map((p)=>Math.max(0, num(p.ts_lift))), 0);
  const positiveNorm = (value, maxValue) => maxValue > 0 ? Math.max(0, num(value)) / maxValue : 0;

  const ranked = candidates.map((p) => {
    const recordScore = pctRecord(p.adjusted_clutch_win_pct);
    const winsScore = pctWins(p.clutch_wins);
    const productionScore = 0.85 * pctImpact(p.clutch_impact_pg) + 0.15 * pctTs(p.clutch_ts_pct);
    const elevationScore =
      0.85 * positiveNorm(p.impact_lift, maxPositiveImpactLift) +
      0.15 * positiveNorm(p.ts_lift, maxPositiveTsLift);
    const volumeScore = 0.65 * Math.min(p.clutch_gp / 20, 1) + 0.35 * p.participation;
    const clutchScore = 100 * (
      0.35 * elevationScore +
      0.30 * recordScore +
      0.15 * productionScore +
      0.10 * winsScore +
      0.10 * volumeScore
    );
    return {
      ...p,
      positive_impact_lift: Math.max(0, num(p.impact_lift)),
      positive_ts_lift: Math.max(0, num(p.ts_lift)),
      record_score: recordScore * 100,
      wins_score: winsScore * 100,
      production_score: productionScore * 100,
      elevation_score: elevationScore * 100,
      volume_score: volumeScore * 100,
      clutch_score: clutchScore,
      _clutch: clutchScore,
    };
  }).sort((a,b)=>b.clutch_score-a.clutch_score || b.clutch_wins-a.clutch_wins || b.clutch_impact_pg-a.clutch_impact_pg);

  const winner = ranked.find((row) => num(row.impact_lift) >= 0) || ranked[0] || null;
  const orderedForDisplay = winner
    ? [winner, ...ranked.filter((row) => row !== winner)]
    : ranked;
  const raceLimit = final ? 5 : 10;

  return {
    clutch_player: winner,
    clutch_player_race: orderedForDisplay.slice(0, raceLimit),
    clutch_award_version: CLUTCH_AWARD_VERSION,
  };
}
