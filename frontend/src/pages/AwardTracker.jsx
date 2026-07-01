import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import LZString from "lz-string";
import PageFade from "../components/PageFade";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";

const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_";
const PLAYER_STATS_KEY = "bm_player_stats_v1";
const SCHED_KEY = "bm_schedule_v3";
const META_KEY = "bm_league_meta_v1";

const TRACKER_MIN_GAME_SHARE = 0.8;
const TRACKER_LIMIT = 10;
const FIRST_PLAYABLE_SEASON_YEAR = 2025;

const resultV3Key = (gameId) => `${RESULT_V3_PREFIX}${gameId}`;

const TAB_META = {
  mvp: {
    title: "MVP Ladder",
    short: "MVP",
    description: "Top 10 most valuable players based on current season impact.",
  },
  dpoy: {
    title: "DPOY Ladder",
    short: "DPOY",
    description: "Top 10 defenders based on steals, blocks, defense, and wins.",
  },
  sixth_man: {
    title: "6MOY Ladder",
    short: "6MOY",
    description: "Top 10 bench players based on role and production.",
  },
  mip: {
    title: "MIP Ladder",
    short: "MIP",
    description: "Top 10 season-to-season breakout players using saved player-card history.",
  },
  roty: {
    title: "ROTY Ladder",
    short: "ROTY",
    description: "Top 10 rookies based on production, minutes, defense, and team wins.",
  },
};

function loadResultsIndexV3() {
  try {
    const raw = localStorage.getItem(RESULT_V3_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadOneResultV3(gameId) {
  try {
    const stored = localStorage.getItem(resultV3Key(gameId));
    if (!stored) return null;

    const decompressed = LZString.decompressFromUTF16(stored);
    const json = decompressed || stored;
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function loadAllResultsV3() {
  const ids = loadResultsIndexV3();
  const out = {};

  for (const id of ids) {
    const r = loadOneResultV3(id);
    if (r) out[String(id)] = r;
  }

  return out;
}

function loadMaybeCompressedJSON(key, fallback = {}) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;

    if (raw.startsWith("lz:")) {
      const compressed = raw.slice(3);
      const decompressed = LZString.decompressFromUTF16(compressed);
      return decompressed ? JSON.parse(decompressed) : fallback;
    }

    const decompressed = LZString.decompressFromUTF16(raw);
    if (decompressed) {
      return JSON.parse(decompressed);
    }

    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[AwardTracker] Failed to load ${key}:`, err);
    return fallback;
  }
}

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function statsKey(player, team) {
  return `${player}__${team}`;
}

function toInt(value, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function getTrackerSeasonYear(leagueData) {
  const leagueCandidates = [];
  const metaCandidates = [];

  const pushYear = (bucket, value) => {
    const y = Number(value);
    if (Number.isFinite(y) && y >= 2020 && y <= 2100) {
      bucket.push(Math.trunc(y));
    }
  };

  pushYear(leagueCandidates, leagueData?.seasonYear);
  pushYear(leagueCandidates, leagueData?.currentSeasonYear);
  pushYear(leagueCandidates, leagueData?.seasonStartYear);

  if (leagueCandidates.length) return Math.max(...leagueCandidates);

  if (getAllTeamsFromLeague(leagueData).length > 0) {
    return FIRST_PLAYABLE_SEASON_YEAR;
  }

  try {
    const raw = localStorage.getItem(META_KEY);
    const meta = raw ? JSON.parse(raw) : {};
    pushYear(metaCandidates, meta?.seasonYear);
    pushYear(metaCandidates, meta?.currentSeasonYear);
    pushYear(metaCandidates, meta?.seasonStartYear);
  } catch {}

  if (metaCandidates.length) return Math.max(...metaCandidates);

  return FIRST_PLAYABLE_SEASON_YEAR;
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function boolish(value) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return false;
  if (typeof value === "number") return value !== 0;
  return ["true", "yes", "y", "1", "rookie"].includes(String(value).trim().toLowerCase());
}

function isRookieCandidate(player, seasonYear) {
  const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};

  const explicitYears = [
    player?.draftYear,
    player?.rookieYear,
    player?.rookieSeason,
    player?.rookieSeasonYear,
    meta?.draftYear,
    meta?.rookieYear,
    meta?.rookieSeason,
    meta?.rookieSeasonYear,
    contract?.draftYear,
    contract?.rookieYear,
    contract?.rookieSeason,
    contract?.rookieSeasonYear,
  ]
    .map((value) => toInt(value, null))
    .filter((value) => value !== null);

  if (explicitYears.length) {
    return explicitYears.some((year) => Number(year) === Number(seasonYear));
  }

  const explicitFlags = [
    player?.isRookie,
    player?.rookie,
    player?.rookieEligible,
    player?.rotyEligible,
    meta?.isRookie,
    meta?.rookie,
    meta?.rookieEligible,
    meta?.rotyEligible,
    contract?.rookieEligible,
  ];

  if (explicitFlags.some((value) => boolish(value))) {
    return true;
  }

  const sourceText = [
    player?.contractType,
    player?.rosterStatus,
    contract?.type,
    contract?.source,
    meta?.acquiredVia,
    meta?.rookieSigningDecision,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");

  if (sourceText.includes("rookie")) {
    const startYear = toInt(contract?.startYear ?? meta?.draftYear ?? player?.draftYear, null);
    return startYear === null || Number(startYear) === Number(seasonYear);
  }

  const proSeasons = firstPresent(
    player?.proSeasons,
    player?.seasonsPro,
    player?.yearsPro,
    player?.yearsOfExperience,
    player?.yoe,
    meta?.proSeasons,
    meta?.seasonsPro,
    meta?.yearsPro,
    meta?.yearsOfExperience,
    meta?.yoe
  );

  const proSeasonsInt = toInt(proSeasons, null);
  if (proSeasonsInt !== null) {
    return proSeasonsInt <= 1;
  }

  return false;
}

function hasExplicitRookieYearData(player) {
  const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};

  return [
    player?.draftYear,
    player?.rookieYear,
    player?.rookieSeason,
    player?.rookieSeasonYear,
    meta?.draftYear,
    meta?.rookieYear,
    meta?.rookieSeason,
    meta?.rookieSeasonYear,
    contract?.draftYear,
    contract?.rookieYear,
    contract?.rookieSeason,
    contract?.rookieSeasonYear,
  ].some((value) => toInt(value, null) !== null);
}

function isYoungRotyFallback(player) {
  const age = toInt(player?.age, null);
  return age !== null && age <= 22;
}

function dateStringBelongsToTrackerSeason(dateString, seasonYear) {
  const match = String(dateString || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return false;

  const month = Number(match[2]);
  const day = Number(match[3]);
  const sortable = Number(`${match[1]}${match[2]}${match[3]}`);
  const start = Number(`${seasonYear}1021`);
  const end = Number(`${seasonYear + 1}0412`);

  if (!Number.isFinite(sortable)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  return sortable >= start && sortable <= end;
}

function resultIdBelongsToTrackerSeason(resultId, seasonYear) {
  return dateStringBelongsToTrackerSeason(resultId, seasonYear);
}

function fmt1(x) {
  return Number.isFinite(Number(x)) ? Number(Number(x).toFixed(1)) : 0;
}

function perGame(total, gp) {
  return gp > 0 ? total / gp : 0;
}

function ppg(p) {
  return perGame(Number(p.pts || 0), Number(p.gp || 0));
}

function apg(p) {
  return perGame(Number(p.ast || 0), Number(p.gp || 0));
}

function rpg(p) {
  return perGame(Number(p.reb || 0), Number(p.gp || 0));
}

function spg(p) {
  return perGame(Number(p.stl || 0), Number(p.gp || 0));
}

function bpg(p) {
  return perGame(Number(p.blk || 0), Number(p.gp || 0));
}

function mpg(p) {
  return perGame(Number(p.min || 0), Number(p.gp || 0));
}

function benchGames(p) {
  const gp = Number(p.gp || 0);
  const starts = Number(p.started || 0);
  const explicitBench = Number(p.sixth || 0);
  if (p._hasRoleData || starts > 0 || explicitBench > 0) {
    return Math.max(0, gp - starts);
  }
  return Math.max(0, explicitBench);
}

function requiredTrackerGames(teamGames) {
  const games = Number(teamGames || 0);
  if (games <= 0) return 1;
  return Math.max(1, Math.ceil(games * TRACKER_MIN_GAME_SHARE));
}

function hasTrackerGames(p) {
  const teamGames = Number(p._team_games || p.gp || 0);
  return Number(p.gp || 0) >= requiredTrackerGames(teamGames);
}

function norm(v, vmax) {
  if (vmax <= 0) return 0;
  return Math.max(0, Math.min(1, v / vmax));
}

function normDefHi(v, lo, hi) {
  if (hi <= lo) return 0;
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
}

function normWins(wins) {
  const floor = 0.30;
  return floor + (1 - floor) * norm(Number(wins || 0), 82);
}

function buildCtx(players) {
  if (!players.length) {
    return {
      ppg: 1,
      apg: 1,
      rpg: 1,
      spg: 1,
      bpg: 1,
      wins: 82,
      def_lo: 0,
      def_hi: 100,
    };
  }

  return {
    ppg: Math.max(...players.map((p) => ppg(p)), 1),
    apg: Math.max(...players.map((p) => apg(p)), 1),
    rpg: Math.max(...players.map((p) => rpg(p)), 1),
    spg: Math.max(...players.map((p) => spg(p)), 1),
    bpg: Math.max(...players.map((p) => bpg(p)), 1),
    wins: 82,
    def_lo: Math.min(...players.map((p) => Number(p.def_rating ?? 0))),
    def_hi: Math.max(...players.map((p) => Number(p.def_rating ?? 0))),
  };
}

function impactMvp(p, c) {
  return (
    0.28 * normWins(p._team_wins) +
    0.27 * norm(ppg(p), c.ppg) +
    0.11 * norm(apg(p), c.apg) +
    0.11 * norm(rpg(p), c.rpg) +
    0.09 * norm(spg(p), c.spg) +
    0.09 * norm(bpg(p), c.bpg) +
    0.05 * normDefHi(Number(p.def_rating ?? 0), c.def_lo, c.def_hi)
  );
}

function impactDpoy(p, c) {
  return (
    0.325 * norm(spg(p), c.spg) +
    0.325 * norm(bpg(p), c.bpg) +
    0.25 * normDefHi(Number(p.def_rating ?? 0), c.def_lo, c.def_hi) +
    0.10 * normWins(p._team_wins)
  );
}

function impact6Moy(p, c) {
  return (
    0.15 * normWins(p._team_wins) +
    0.30 * norm(ppg(p), c.ppg) +
    0.15 * norm(apg(p), c.apg) +
    0.15 * norm(rpg(p), c.rpg) +
    0.10 * norm(spg(p), c.spg) +
    0.10 * norm(bpg(p), c.bpg) +
    0.05 * normDefHi(Number(p.def_rating ?? 0), c.def_lo, c.def_hi)
  );
}

function impactRoty(p, c, maxMpg) {
  return (
    0.08 * normWins(p._team_wins) +
    0.34 * norm(ppg(p), c.ppg) +
    0.14 * norm(apg(p), c.apg) +
    0.14 * norm(rpg(p), c.rpg) +
    0.07 * norm(spg(p), c.spg) +
    0.07 * norm(bpg(p), c.bpg) +
    0.12 * norm(mpg(p), maxMpg) +
    0.04 * normDefHi(Number(p.def_rating ?? 0), c.def_lo, c.def_hi)
  );
}

function prevMipStat(prev, key) {
  if (!prev) return 0;

  const aliases = {
    ppg: ["ppg", "pts", "PTS"],
    rpg: ["rpg", "reb", "REB"],
    apg: ["apg", "ast", "AST"],
    spg: ["spg", "stl", "STL"],
    bpg: ["bpg", "blk", "BLK"],
    fgPct: ["fgPct", "fg_pct", "FG", "fg"],
  }[key] || [key];

  for (const alias of aliases) {
    if (prev?.[alias] !== undefined && prev?.[alias] !== null && prev?.[alias] !== "") {
      const n = Number(prev[alias]);
      return Number.isFinite(n) ? n : 0;
    }
  }

  return 0;
}

function mipProdFromValues(ppgVal, rpgVal, apgVal, spgVal, bpgVal) {
  return (
    Number(ppgVal || 0) +
    0.55 * Number(rpgVal || 0) +
    0.65 * Number(apgVal || 0) +
    1.35 * Number(spgVal || 0) +
    1.35 * Number(bpgVal || 0)
  );
}

function currentFgPct(p) {
  const fga = Number(p.fga || 0);
  if (!fga) return 0;
  return (Number(p.fgm || 0) / fga) * 100;
}

function isMipEligible(p, seasonYear) {
  if (isRookieCandidate(p, seasonYear)) return false;

  const prev = p.mipPrev || p.mip_prev || p.previousSeasonStats;
  if (!prev) return false;

  const prevGames = Number(prev.games ?? prev.gp ?? 0);
  if (prevGames < 25) return false;
  if (mpg(p) < 14) return false;

  const prevPpg = prevMipStat(prev, "ppg");
  const prevProd = mipProdFromValues(
    prevPpg,
    prevMipStat(prev, "rpg"),
    prevMipStat(prev, "apg"),
    prevMipStat(prev, "spg"),
    prevMipStat(prev, "bpg")
  );
  const currProd = mipProdFromValues(ppg(p), rpg(p), apg(p), spg(p), bpg(p));

  if (prevPpg >= 24 && prevProd >= 32) return false;
  return (currProd - prevProd) >= 0.75 || (ppg(p) - prevPpg) >= 0.75;
}

function impactMip(p) {
  const prev = p.mipPrev || p.mip_prev || p.previousSeasonStats || {};

  const prevPpg = prevMipStat(prev, "ppg");
  const prevRpg = prevMipStat(prev, "rpg");
  const prevApg = prevMipStat(prev, "apg");
  const prevSpg = prevMipStat(prev, "spg");
  const prevBpg = prevMipStat(prev, "bpg");
  const prevFg = prevMipStat(prev, "fgPct");

  const currProd = mipProdFromValues(ppg(p), rpg(p), apg(p), spg(p), bpg(p));
  const prevProd = mipProdFromValues(prevPpg, prevRpg, prevApg, prevSpg, prevBpg);
  const prodDelta = currProd - prevProd;
  const relativeGain = prodDelta / Math.max(prevProd, 5);
  const fgDelta = prevFg > 0 ? currentFgPct(p) - prevFg : 0;

  let score =
    3.25 * Math.max(0, relativeGain) +
    0.88 * Math.max(0, ppg(p) - prevPpg) +
    0.42 * Math.max(0, rpg(p) - prevRpg) +
    0.48 * Math.max(0, apg(p) - prevApg) +
    1.10 * Math.max(0, spg(p) - prevSpg) +
    1.10 * Math.max(0, bpg(p) - prevBpg) +
    0.18 * Math.max(0, fgDelta) +
    0.35 * norm(mpg(p), 36) +
    0.18 * normWins(p._team_wins);

  if (prevProd < 6) score *= 0.78;
  if (prevPpg >= 18) score *= 0.88;

  return score;
}

function isSixthManEligible(p) {
  const starts = Number(p.started || 0);
  return mpg(p) >= 14 && benchGames(p) > starts;
}

function buildTeamsWithWinsForAwards(allTeams, scheduleByDate, resultsById) {
  const wins = {};
  const gamesPlayed = {};

  const bumpWin = (teamName) => {
    if (!teamName) return;
    wins[teamName] = (wins[teamName] || 0) + 1;
  };

  const bumpGame = (teamName) => {
    if (!teamName) return;
    gamesPlayed[teamName] = (gamesPlayed[teamName] || 0) + 1;
  };

  for (const games of Object.values(scheduleByDate || {})) {
    for (const g of games || []) {
      if (!g?.played) continue;

      const r = resultsById?.[g.id];
      if (!r?.totals) continue;

      bumpGame(g.home);
      bumpGame(g.away);

      const homePts = Number(r.totals.home ?? 0);
      const awayPts = Number(r.totals.away ?? 0);

      if (homePts === awayPts) continue;

      if (homePts > awayPts) bumpWin(g.home);
      else bumpWin(g.away);
    }
  }

  return (allTeams || []).map((t) => ({
    team: t?.name || t?.team,
    wins: wins[t?.name || t?.team] || 0,
    games: gamesPlayed[t?.name || t?.team] || 0,
  }));
}

function combineTrackerSeasonRows(rows) {
  const clean = (rows || []).filter((row) => row && row.rowType !== "total");
  const games = clean.reduce((sum, row) => sum + Number(row.games ?? row.gp ?? 0), 0);
  const safeGames = games || 1;

  const weighted = (key) =>
    clean.reduce((sum, row) => sum + Number(row[key] || 0) * Number(row.games ?? row.gp ?? 0), 0) / safeGames;

  const latest = [...clean].reverse().find(Boolean) || {};

  return {
    seasonYear: latest.seasonYear,
    teamName: clean.length > 1 ? "Total" : latest.teamName,
    teamLogo: clean.length > 1 ? "" : latest.teamLogo,
    rowType: clean.length > 1 ? "total" : latest.rowType || "team",
    games,
    ppg: weighted("ppg"),
    rpg: weighted("rpg"),
    apg: weighted("apg"),
    spg: weighted("spg"),
    bpg: weighted("bpg"),
    fgPct: weighted("fgPct"),
    threePct: weighted("threePct"),
    ftPct: weighted("ftPct"),
  };
}

function getPreviousTrackerSeasonFromHistory(player, currentDisplaySeasonYear = null) {
  const seasons = Array.isArray(player?.history?.seasons) ? player.history.seasons : [];
  const grouped = new Map();

  for (const row of seasons) {
    if (!row || row.rowType === "total") continue;

    const seasonYear = Number(row.seasonYear || 0);
    if (!seasonYear) continue;
    if (currentDisplaySeasonYear && seasonYear >= Number(currentDisplaySeasonYear)) continue;

    if (!grouped.has(seasonYear)) grouped.set(seasonYear, []);
    grouped.get(seasonYear).push(row);
  }

  if (!grouped.size) return null;

  const latestYear = Math.max(...Array.from(grouped.keys()).map(Number));
  return combineTrackerSeasonRows(grouped.get(latestYear) || []);
}

function buildRosterInfoIndex(leagueData, currentDisplaySeasonYear = null) {
  const teams = getAllTeamsFromLeague(leagueData);
  const idx = {};

  for (const team of teams) {
    const teamName = team?.name || team?.team;
    const teamLogo =
      team?.logo ||
      team?.teamLogo ||
      team?.logoUrl ||
      team?.image ||
      team?.img ||
      team?.newTeamLogo ||
      null;

    for (const p of team.players || []) {
      const playerName = p?.name || p?.player;
      if (!playerName || !teamName) continue;

      const meta = p?.meta && typeof p.meta === "object" ? p.meta : {};
      const contract = p?.contract && typeof p.contract === "object" ? p.contract : {};

      idx[statsKey(playerName, teamName)] = {
        headshot:
          p?.portrait ||
          p?.image ||
          p?.photo ||
          p?.headshot ||
          p?.img ||
          p?.face ||
          null,
        overall:
          p?.overall ??
          p?.ovr ??
          p?.rating ??
          p?.overall_rating ??
          null,
        potential:
          p?.potential ??
          p?.pot ??
          p?.potential_rating ??
          null,
        pos: p?.pos || p?.position || "",
        secondaryPos: p?.secondaryPos || p?.secondary_pos || "",
        age: p?.age ?? null,
        teamLogo,
        def_rating:
          p?.def_rating ??
          p?.defRating ??
          p?.defensive_rating ??
          p?.defensiveRating ??
          p?.drtg ??
          p?.defrtg ??
          0,
        contract,
        meta,
        mipPrev: getPreviousTrackerSeasonFromHistory(p, currentDisplaySeasonYear),
        contractType: p?.contractType ?? contract?.type ?? null,
        rosterStatus: p?.rosterStatus ?? null,
        draftYear: firstPresent(p?.draftYear, meta?.draftYear, contract?.draftYear),
        rookieYear: firstPresent(p?.rookieYear, meta?.rookieYear, contract?.rookieYear),
        rookieSeason: firstPresent(p?.rookieSeason, meta?.rookieSeason, contract?.rookieSeason),
        rookieSeasonYear: firstPresent(p?.rookieSeasonYear, meta?.rookieSeasonYear, contract?.rookieSeasonYear),
        isRookie: firstPresent(p?.isRookie, meta?.isRookie, contract?.isRookie),
        rookie: firstPresent(p?.rookie, meta?.rookie, contract?.rookie),
        rookieEligible: firstPresent(p?.rookieEligible, meta?.rookieEligible, contract?.rookieEligible),
        rotyEligible: firstPresent(p?.rotyEligible, meta?.rotyEligible, contract?.rotyEligible),
        proSeasons: firstPresent(p?.proSeasons, meta?.proSeasons),
        seasonsPro: firstPresent(p?.seasonsPro, meta?.seasonsPro),
        yearsPro: firstPresent(p?.yearsPro, meta?.yearsPro),
        yearsOfExperience: firstPresent(p?.yearsOfExperience, meta?.yearsOfExperience),
        yoe: firstPresent(p?.yoe, meta?.yoe),
      };
    }
  }

  return idx;
}

function buildDisplayRow(p) {
  const prev = p.mipPrev || p.mip_prev || p.previousSeasonStats || null;
  const prevPpg = prevMipStat(prev, "ppg");

  const bench = benchGames(p);

  return {
    ...p,
    bench,
    sixth: bench,
    ppg: fmt1(ppg(p)),
    apg: fmt1(apg(p)),
    rpg: fmt1(rpg(p)),
    spg: fmt1(spg(p)),
    bpg: fmt1(bpg(p)),
    mpg: fmt1(mpg(p)),
    mipPrevPpg: fmt1(prevPpg),
    mipDeltaPpg: fmt1(ppg(p) - prevPpg),
    impact: fmt1((p._score || 0) * 100),
  };
}

function getColumnsForTab(tab) {
  if (tab === "dpoy") {
    return [
      { key: "team", label: "Team" },
      { key: "name", label: "Name" },
      { key: "OVR", label: "OVR" },
      { key: "GP", label: "GP" },
      { key: "REB", label: "REB" },
      { key: "STL", label: "STL" },
      { key: "BLK", label: "BLK" },
      { key: "DRTG", label: "DEF" },
      { key: "Impact", label: "Impact" },
    ];
  }

  if (tab === "sixth_man") {
    return [
      { key: "team", label: "Team" },
      { key: "name", label: "Name" },
      { key: "OVR", label: "OVR" },
      { key: "GP", label: "GP" },
      { key: "PTS", label: "PTS" },
      { key: "REB", label: "REB" },
      { key: "AST", label: "AST" },
      { key: "Starts", label: "Starts" },
      { key: "Sixth", label: "Bench" },
      { key: "Impact", label: "Impact" },
    ];
  }

  if (tab === "mip") {
    return [
      { key: "team", label: "Team" },
      { key: "name", label: "Name" },
      { key: "OVR", label: "OVR" },
      { key: "GP", label: "GP" },
      { key: "PTS", label: "PTS" },
      { key: "PrevPTS", label: "Prev" },
      { key: "DeltaPTS", label: "ΔPTS" },
      { key: "REB", label: "REB" },
      { key: "AST", label: "AST" },
      { key: "Impact", label: "Impact" },
    ];
  }

  if (tab === "roty") {
    return [
      { key: "team", label: "Team" },
      { key: "name", label: "Name" },
      { key: "OVR", label: "OVR" },
      { key: "GP", label: "GP" },
      { key: "PTS", label: "PTS" },
      { key: "REB", label: "REB" },
      { key: "AST", label: "AST" },
      { key: "MPG", label: "MPG" },
      { key: "Impact", label: "Impact" },
    ];
  }

  return [
    { key: "team", label: "Team" },
    { key: "name", label: "Name" },
    { key: "OVR", label: "OVR" },
    { key: "GP", label: "GP" },
    { key: "PTS", label: "PTS" },
    { key: "REB", label: "REB" },
    { key: "AST", label: "AST" },
    { key: "STL", label: "STL" },
    { key: "BLK", label: "BLK" },
    { key: "Impact", label: "Impact" },
  ];
}

export default function AwardTracker() {
  const navigate = useNavigate();
  const { leagueData, selectedTeam } = useGame();

  const [currentTab, setCurrentTab] = useState("mvp");
  const [selectedPlayerKey, setSelectedPlayerKey] = useState(null);
  const [statsMap, setStatsMap] = useState(() =>
    loadMaybeCompressedJSON(PLAYER_STATS_KEY, {})
  );

  const trackerSeasonYear = useMemo(() => getTrackerSeasonYear(leagueData), [leagueData]);

  useEffect(() => {
    const refreshStats = () => {
      setStatsMap(loadMaybeCompressedJSON(PLAYER_STATS_KEY, {}));
    };

    refreshStats();

    const intervalId = window.setInterval(refreshStats, 2000);

    window.addEventListener("focus", refreshStats);
    document.addEventListener("visibilitychange", refreshStats);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshStats);
      document.removeEventListener("visibilitychange", refreshStats);
    };
  }, []);

  const seasonLabel = useMemo(() => {
    const y = Number(trackerSeasonYear);
    return `${y}-${y + 1}`;
  }, [trackerSeasonYear]);

  const scheduleByDate = useMemo(() => {
    try {
      const raw = localStorage.getItem(SCHED_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, []);

  const resultsById = useMemo(() => loadAllResultsV3(), []);
  const currentSeasonStatsMap = useMemo(() => {
    const hasStats = statsMap && Object.keys(statsMap).length > 0;
    if (!hasStats) return {};

    const resultIds = Object.keys(resultsById || {});
    const hasCurrentSeasonResults = resultIds.some((id) =>
      resultIdBelongsToTrackerSeason(id, trackerSeasonYear)
    );

    return hasCurrentSeasonResults ? statsMap : {};
  }, [statsMap, resultsById, trackerSeasonYear]);

  const allTeams = useMemo(() => getAllTeamsFromLeague(leagueData), [leagueData]);
  const rosterInfoIndex = useMemo(() => buildRosterInfoIndex(leagueData, trackerSeasonYear + 1), [leagueData, trackerSeasonYear]);

  const teamAwardRows = useMemo(() => {
    return buildTeamsWithWinsForAwards(allTeams, scheduleByDate, resultsById);
  }, [allTeams, scheduleByDate, resultsById]);

  const teamWinsMap = useMemo(() => {
    const map = {};
    for (const t of teamAwardRows) {
      map[t.team] = Number(t.wins || 0);
    }
    return map;
  }, [teamAwardRows]);

  const teamGamesMap = useMemo(() => {
    const map = {};
    for (const t of teamAwardRows) {
      map[t.team] = Number(t.games || 0);
    }

    for (const row of Object.values(currentSeasonStatsMap || {})) {
      const teamName = row?.team;
      if (!teamName) continue;
      map[teamName] = Math.max(Number(map[teamName] || 0), Number(row.gp || 0));
    }

    return map;
  }, [teamAwardRows, currentSeasonStatsMap]);

  const playerPool = useMemo(() => {
    const out = [];

    for (const team of allTeams) {
      const teamName = team?.name || team?.team;
      if (!teamName) continue;

      for (const p of team.players || []) {
        const playerName = p?.name || p?.player;
        if (!playerName) continue;

        const key = statsKey(playerName, teamName);
        const s = currentSeasonStatsMap[key];
        const info = rosterInfoIndex[key] || {};

        if (!s || Number(s.gp || 0) <= 0) continue;

        out.push({
          player: playerName,
          team: teamName,
          gp: Number(s.gp || 0),
          min: Number(s.min || 0),
          pts: Number(s.pts || 0),
          reb: Number(s.reb || 0),
          ast: Number(s.ast || 0),
          stl: Number(s.stl || 0),
          blk: Number(s.blk || 0),
          started: Number(s.started || 0),
          sixth: Number(s.sixth || 0),
          _hasRoleData: Object.prototype.hasOwnProperty.call(s, "started") || Object.prototype.hasOwnProperty.call(s, "sixth"),
          def_rating: Number(info.def_rating ?? 0),
          overall: info.overall ?? null,
          potential: info.potential ?? null,
          headshot: info.headshot || null,
          teamLogo: info.teamLogo || null,
          mipPrev: info.mipPrev || null,
          pos: info.pos || "",
          secondaryPos: info.secondaryPos || "",
          age: info.age ?? null,
          contract: info.contract || null,
          meta: info.meta || {},
          contractType: info.contractType,
          rosterStatus: info.rosterStatus,
          draftYear: info.draftYear,
          rookieYear: info.rookieYear,
          rookieSeason: info.rookieSeason,
          rookieSeasonYear: info.rookieSeasonYear,
          isRookie: info.isRookie,
          rookie: info.rookie,
          rookieEligible: info.rookieEligible,
          rotyEligible: info.rotyEligible,
          proSeasons: info.proSeasons,
          seasonsPro: info.seasonsPro,
          yearsPro: info.yearsPro,
          yearsOfExperience: info.yearsOfExperience,
          yoe: info.yoe,
          _team_wins: Number(teamWinsMap[teamName] || 0),
          _team_games: Number(teamGamesMap[teamName] || 0),
        });
      }
    }

    return out;
  }, [allTeams, currentSeasonStatsMap, rosterInfoIndex, teamWinsMap, teamGamesMap]);

  const eligiblePool = useMemo(() => {
    return playerPool.filter((p) => hasTrackerGames(p));
  }, [playerPool]);

  const mvpTop10 = useMemo(() => {
    const ctx = buildCtx(eligiblePool);

    return eligiblePool
      .map((p) => buildDisplayRow({ ...p, _score: impactMvp(p, ctx) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, TRACKER_LIMIT);
  }, [eligiblePool]);

  const dpoyTop10 = useMemo(() => {
    const ctx = buildCtx(eligiblePool);

    return eligiblePool
      .map((p) => buildDisplayRow({ ...p, _score: impactDpoy(p, ctx) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, TRACKER_LIMIT);
  }, [eligiblePool]);

  const sixthPool = useMemo(() => {
    return eligiblePool.filter((p) => isSixthManEligible(p));
  }, [eligiblePool]);

  const sixthTop10 = useMemo(() => {
    const base = sixthPool.length ? sixthPool : [];
    const ctx = buildCtx(base.length ? base : eligiblePool);

    return base
      .map((p) => buildDisplayRow({ ...p, _score: impact6Moy(p, ctx) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, TRACKER_LIMIT);
  }, [sixthPool, eligiblePool]);

  const rookiePool = useMemo(() => {
    const strict = eligiblePool.filter((p) => isRookieCandidate(p, trackerSeasonYear));
    const hasDraftYearData = eligiblePool.some((p) => hasExplicitRookieYearData(p));
    if (strict.length || hasDraftYearData) return strict;
    return eligiblePool.filter((p) => isYoungRotyFallback(p));
  }, [eligiblePool, trackerSeasonYear]);

  const rotyTop10 = useMemo(() => {
    const base = rookiePool.length ? rookiePool : [];
    const ctx = buildCtx(base.length ? base : eligiblePool);
    const maxRotyMpg = Math.max(...base.map((p) => mpg(p)), 1);

    return base
      .map((p) => buildDisplayRow({ ...p, _score: impactRoty(p, ctx, maxRotyMpg) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, TRACKER_LIMIT);
  }, [rookiePool, eligiblePool]);

  const mipTop10 = useMemo(() => {
    const base = eligiblePool.filter((p) => isMipEligible(p, trackerSeasonYear));

    return base
      .map((p) => buildDisplayRow({ ...p, _score: impactMip(p) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, TRACKER_LIMIT);
  }, [eligiblePool, trackerSeasonYear]);

  const activeRows = useMemo(() => {
    if (currentTab === "dpoy") return dpoyTop10;
    if (currentTab === "sixth_man") return sixthTop10;
    if (currentTab === "mip") return mipTop10;
    if (currentTab === "roty") return rotyTop10;
    return mvpTop10;
  }, [currentTab, mvpTop10, dpoyTop10, sixthTop10, mipTop10, rotyTop10]);

  useEffect(() => {
    if (!activeRows.length) {
      setSelectedPlayerKey(null);
      return;
    }

    setSelectedPlayerKey((prev) => {
      const exists = activeRows.some((p) => statsKey(p.player, p.team) === prev);
      return exists ? prev : statsKey(activeRows[0].player, activeRows[0].team);
    });
  }, [activeRows, currentTab]);

  const cardPlayer = useMemo(() => {
    if (!activeRows.length) return null;
    return (
      activeRows.find((p) => statsKey(p.player, p.team) === selectedPlayerKey) ||
      activeRows[0]
    );
  }, [activeRows, selectedPlayerKey]);

  const fillPercent = Math.min((cardPlayer?.overall || 0) / 99, 1);
  const circleCircumference = 2 * Math.PI * 50;
  const strokeOffset = circleCircumference * (1 - fillPercent);

  const columns = getColumnsForTab(currentTab);
  const meta = TAB_META[currentTab];

  if (!leagueData || !selectedTeam) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bmCourtPage text-white">
        <p className="mb-3 text-lg">No team selected or league missing.</p>
        <button
          onClick={() => navigate("/team-selector")}
          className="rounded-lg bg-orange-600 px-6 py-3 font-semibold hover:bg-orange-500"
        >
          Back to Team Select
        </button>
      </div>
    );
  }

  return (
    <PageFade>
    <div className="min-h-screen bmCourtPage text-white flex flex-col items-center py-10">
      <div className="w-full max-w-5xl flex items-center justify-between mb-6 select-none">
        <div className="w-24" />
        <h1 className="text-3xl md:text-4xl font-extrabold text-orange-500 text-center">
          Award Tracker
        </h1>
        <div className="w-24" />
      </div>

      <div className="w-full max-w-5xl flex items-center justify-end gap-2 mb-3">
        {[
          { k: "mvp", label: "MVP" },
          { k: "dpoy", label: "DPOY" },
          { k: "sixth_man", label: "6MOY" },
          { k: "mip", label: "MIP" },
          { k: "roty", label: "ROTY" },
        ].map((tab) => (
          <button
            key={tab.k}
            onClick={() => setCurrentTab(tab.k)}
            className={`px-3 py-1 rounded-md text-sm font-semibold ${
              currentTab === tab.k
                ? "bg-orange-600 text-white"
                : "bg-neutral-800 text-gray-300 hover:bg-neutral-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {cardPlayer && (
        <div className="relative w-full flex justify-center">
          <div className="relative bmSolidPanel w-full max-w-5xl px-8 pt-8 pb-3 rounded-t-xl shadow-lg">
            <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-white opacity-60"></div>

            <div className="flex items-end justify-between relative">
              <div className="flex items-end gap-6">
                <div className="relative -mb-[9px]">
                  {cardPlayer.headshot ? (
                    <img
                      src={cardPlayer.headshot}
                      alt={cardPlayer.player}
                      className="h-[175px] w-auto object-contain"
                    />
                  ) : (
                    <div className="flex h-[175px] w-[130px] items-center justify-center text-sm text-neutral-500">
                      No image
                    </div>
                  )}
                </div>

                <div className="flex flex-col justify-end mb-3">
                  <div className="text-sm font-semibold uppercase tracking-wide text-orange-400">
                    {meta.title}
                  </div>

                  <h2 className="text-[44px] font-bold leading-tight">
                    {cardPlayer.player}
                  </h2>

                  <p className="text-gray-400 text-[24px] mt-1">
                    {cardPlayer.pos}
                    {cardPlayer.secondaryPos ? ` / ${cardPlayer.secondaryPos}` : ""}
                    {cardPlayer.age != null ? ` • Age ${cardPlayer.age}` : ""}
                  </p>

                  <div className="mt-2 flex items-center gap-2 text-sm text-neutral-300">
                    {cardPlayer.teamLogo ? (
                      <img
                        src={cardPlayer.teamLogo}
                        alt={cardPlayer.team}
                        className="h-6 w-6 object-contain"
                      />
                    ) : null}
                    <span>{cardPlayer.team}</span>
                    <span>•</span>
                    <span>{cardPlayer._team_wins} wins</span>
                    <span>•</span>
                    <span>#{activeRows.findIndex((p) => p.player === cardPlayer.player && p.team === cardPlayer.team) + 1}</span>
                  </div>
                </div>
              </div>

              <div className="relative flex flex-col items-center justify-center mr-4 mb-2">
                <svg width="110" height="110" viewBox="0 0 120 120">
                  <defs>
                    <linearGradient id="ovrGradientTracker" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#FFA500" />
                      <stop offset="100%" stopColor="#FFD54F" />
                    </linearGradient>
                  </defs>

                  <circle
                    cx="60"
                    cy="60"
                    r="50"
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth="8"
                    fill="none"
                  />
                  <circle
                    cx="60"
                    cy="60"
                    r="50"
                    stroke="url(#ovrGradientTracker)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    fill="none"
                    strokeDasharray={circleCircumference}
                    strokeDashoffset={strokeOffset}
                    transform="rotate(-90 60 60)"
                  />
                </svg>

                <div className="absolute flex flex-col items-center justify-center text-center">
                  <p className="text-sm text-gray-300 tracking-wide mb-1">OVR</p>
                  <p className="text-[47px] font-extrabold text-orange-400 leading-none mt-[-11px]">
                    {cardPlayer.overall ?? "--"}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-[-2px]">
                    POT <span className="text-orange-400 font-semibold">{cardPlayer.potential ?? "--"}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="w-full flex justify-center mt-[-1px]">
        <div className="w-full max-w-5xl overflow-x-auto no-scrollbar bmTablePanel">
          <table className="w-full border-collapse text-center text-[17px] font-medium">
            <thead className="bg-neutral-800 text-gray-300 text-[16px] font-semibold">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`py-3 px-3 min-w-[90px] ${
                      col.key === "name"
                        ? "min-w-[180px] text-left pl-4"
                        : col.key === "team"
                        ? "min-w-[70px]"
                        : "text-center"
                    }`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {activeRows.map((p) => {
                const rowKey = statsKey(p.player, p.team);
                const isSelected = (cardPlayer ? statsKey(cardPlayer.player, cardPlayer.team) : "") === rowKey;

                return (
                  <tr
                    key={rowKey}
                    onClick={() => setSelectedPlayerKey(rowKey)}
                    className={`cursor-pointer transition ${
                      isSelected ? "bg-orange-600 text-white" : "hover:bg-neutral-800"
                    }`}
                  >
                    {columns.map((col) => {
                      if (col.key === "team") {
                        return (
                          <td key={col.key} className="py-2 px-2">
                            {p.teamLogo ? (
                              <img
                                src={p.teamLogo}
                                alt={p.team}
                                className="inline-block h-[36px] w-[36px] object-contain"
                                title={p.team}
                              />
                            ) : (
                              <span className="text-xs text-neutral-400">-</span>
                            )}
                          </td>
                        );
                      }

                      if (col.key === "name") {
                        return (
                          <td key={col.key} className="py-2 px-3 text-left pl-4">
                            {p.player}
                          </td>
                        );
                      }

                      if (col.key === "OVR") {
                        return <td key={col.key}>{p.overall ?? "--"}</td>;
                      }

                      if (col.key === "GP") {
                        return <td key={col.key}>{p.gp}</td>;
                      }

                      if (col.key === "PTS") {
                        return <td key={col.key}>{p.ppg}</td>;
                      }

                      if (col.key === "PrevPTS") {
                        return <td key={col.key}>{p.mipPrevPpg}</td>;
                      }

                      if (col.key === "DeltaPTS") {
                        const delta = Number(p.mipDeltaPpg || 0);
                        return <td key={col.key}>{`${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`}</td>;
                      }

                      if (col.key === "REB") {
                        return <td key={col.key}>{p.rpg}</td>;
                      }

                      if (col.key === "AST") {
                        return <td key={col.key}>{p.apg}</td>;
                      }

                      if (col.key === "STL") {
                        return <td key={col.key}>{p.spg}</td>;
                      }

                      if (col.key === "BLK") {
                        return <td key={col.key}>{p.bpg}</td>;
                      }

                      if (col.key === "DRTG") {
                        return <td key={col.key}>{fmt1(p.def_rating)}</td>;
                      }

                      if (col.key === "MPG") {
                        return <td key={col.key}>{p.mpg}</td>;
                      }

                      if (col.key === "Impact") {
                        return <td key={col.key}>{p.impact}</td>;
                      }

                      if (col.key === "Starts") {
                        return <td key={col.key}>{p.started}</td>;
                      }

                      if (col.key === "Sixth") {
                        return <td key={col.key}>{p.bench ?? p.sixth}</td>;
                      }

                      return <td key={col.key}>-</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {activeRows.length === 0 && (
            <div className="bg-neutral-800 text-neutral-400 text-center py-8">
              No player stats loaded yet.
            </div>
          )}
        </div>
      </div>

      <div className="w-full max-w-5xl mt-4 text-sm text-neutral-400">
        {meta.description} Live for {seasonLabel}. Tracker requires players to have appeared in at least 80% of their team’s games so far.
      </div>

      <button
        onClick={() => navigate("/team-hub")}
        className="mt-10 px-8 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
      >
        Back to Team Hub
      </button>
    </div>
  
    </PageFade>
  );
}
