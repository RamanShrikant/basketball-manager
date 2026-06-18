// src/pages/Playoffs.jsx
// FMVP/boxscore surgical patch v5_2_RENDERLOOPFIX - 2026-05-13
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import LZString from "lz-string";
import { simulateOneGame, computeFinalsMvp } from "@/api/simEnginePy"; // ✅ PATCH (Finals MVP)
import { queueSim } from "@/api/simQueue";
import { ensureGameplansForLeague } from "../utils/ensureGameplans";
import styles from "./Playoffs.module.css";
import FinalsMvpReveal from "../components/FinalsMvpReveal";
import { finalizeFinalsMvpAndGoOffseason } from "../utils/finalsMvpSeasonActions";
import { saveLeagueDataInBackground } from "../utils/leagueStorage.js";

/* ---------------- utils ---------------- */
function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}
function readSavedGameplan(teamName) {
  try {
    const raw = localStorage.getItem(`gameplan_${teamName}`);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function readFlatMinutesFromGameplan(teamName) {
  const saved = readSavedGameplan(teamName);
  if (!saved) return {};

  if (
    saved.minutes &&
    typeof saved.minutes === "object" &&
    !Array.isArray(saved.minutes)
  ) {
    return { ...saved.minutes };
  }

  // backward compatibility with old flat format
  return { ...saved };
}

/* -----------------------------
   ✅ SURGICAL PATCH:
   - Regular-season standings MUST read Calendar's V3 per-game results
   - Playoff results can remain in v2 blob (this file's existing behavior)
   ----------------------------- */

// Regular season results (V3 per-game)
const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_";
const resultV3Key = (gameId) => `${RESULT_V3_PREFIX}${gameId}`;

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
    if (r) out[id] = r;
  }
  return out;
}
function clearAllResultsV3() {
  try {
    const ids = loadResultsIndexV3();
    for (const id of ids) localStorage.removeItem(resultV3Key(id));
    localStorage.removeItem(RESULT_V3_INDEX_KEY);
  } catch {}
}

// Playoff results (keep existing v2 blob behavior)
const RESULT_KEY = "bm_results_v2"; // (used here for playoff games PO_/PI_)
const SCHED_KEY = "bm_schedule_v3";
const POSTSEASON_KEY = "bm_postseason_v2";
const CHAMP_KEY = "bm_champ_v1";
const FINALS_MVP_KEY = "bm_finals_mvp_v1"; // ✅ PATCH (Finals MVP)
const FINALS_MVP_SEEN_KEY = "bm_finals_mvp_seen_v1";


function safeReadSmallJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function getFinalsDisplaySeasonYear(leagueData, fallbackYear = 2026) {
  const validYear = (value) => {
    const y = Number(value);
    return Number.isFinite(y) && y >= 2020 && y <= 2100 ? y : null;
  };

  const meta = safeReadSmallJSON("bm_league_meta_v1", {}) || {};
  const savedLeague = safeReadSmallJSON("leagueData", null);
  const snapshot = leagueData && typeof leagueData === "object" ? leagueData : savedLeague || {};

  // Calendar stores bm_league_meta_v1.seasonYear as the START year of the NBA season.
  // Finals MVP should show the title/offseason year, so 2025-26 => 2026,
  // 2026-27 => 2027, etc. Do not use seasonHistory here because Playoffs writes
  // the current season into seasonHistory before FMVP renders, which was pushing
  // the first title year from 2026 to 2027.
  const metaStartYear = validYear(meta?.seasonYear ?? meta?.seasonStartYear);
  if (metaStartYear !== null) return metaStartYear + 1;

  return (
    validYear(fallbackYear) ??
    validYear(snapshot?.seasonYear) ??
    validYear(snapshot?.currentSeasonYear) ??
    validYear(snapshot?.seasonStartYear) ??
    validYear(meta?.currentSeasonYear) ??
    2026
  );
}

function readFinalsMvpSeenFor(fmvpSeasonYear, championTeam) {
  try {
    const saved = JSON.parse(localStorage.getItem(FINALS_MVP_SEEN_KEY) || "null");
    return (
      !!saved?.seen &&
      Number(saved?.seasonYear) === Number(fmvpSeasonYear) &&
      saved?.championTeam === championTeam
    );
  } catch {
    return false;
  }
}

function saveFinalsMvpSeenFor(fmvpSeasonYear, championTeam) {
  if (!fmvpSeasonYear || !championTeam) return;

  try {
    localStorage.setItem(
      FINALS_MVP_SEEN_KEY,
      JSON.stringify({ seasonYear: fmvpSeasonYear, championTeam, seen: true })
    );
  } catch {}
}

function safeReadCompressedJSON(key, fallback = null) {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return fallback;

    const decompressed = LZString.decompressFromUTF16(stored);
    const json = decompressed || stored;
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function safeSetCompressedJSON(key, value, fallbackCleaner = null) {
  const json = JSON.stringify(value);
  const compressed = LZString.compressToUTF16(json);

  try {
    localStorage.setItem(key, compressed);
    return true;
  } catch (err) {
    console.warn(`[Playoffs] Failed to save ${key}. Trying storage cleanup fallback.`, err);

    try {
      if (typeof fallbackCleaner === "function") fallbackCleaner();
      localStorage.removeItem(key);
      localStorage.setItem(key, compressed);
      return true;
    } catch (fallbackErr) {
      console.error(`[Playoffs] Could not save ${key} even after cleanup.`, fallbackErr);
      return false;
    }
  }
}

function cleanupOldSeasonStorageForPostseasonSave() {
  // Once the playoff bracket exists, regular-season game blobs and schedule are
  // no longer needed for bracket progress. Clearing them prevents season-two
  // localStorage quota crashes.
  try {
    clearAllResultsV3();
    localStorage.removeItem(SCHED_KEY);
  } catch {}
}

function loadPostseasonState() {
  return safeReadCompressedJSON(POSTSEASON_KEY, null);
}

function savePostseasonState(postseasonState) {
  return safeSetCompressedJSON(
    POSTSEASON_KEY,
    postseasonState,
    cleanupOldSeasonStorageForPostseasonSave
  );
}

function safeSetSmallJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn(`[Playoffs] Failed to save ${key}.`, err);
    try {
      cleanupOldSeasonStorageForPostseasonSave();
      localStorage.removeItem(key);
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }
}

function loadPlayoffResults() {
  try {
    const stored = localStorage.getItem(RESULT_KEY);
    if (!stored) return {};
    const decompressed = LZString.decompressFromUTF16(stored);
    if (decompressed) return JSON.parse(decompressed);
    return JSON.parse(stored);
  } catch {
    return {};
  }
}
function savePlayoffResults(results) {
  safeSetCompressedJSON(RESULT_KEY, results, cleanupOldSeasonStorageForPostseasonSave);
}

function loadSchedule() {
  try {
    return JSON.parse(localStorage.getItem(SCHED_KEY) || "{}");
  } catch {
    return {};
  }
}
function scoreToObj(score) {
  if (!score) return null;
  if (score instanceof Map) return Object.fromEntries(score);
  if (
    Array.isArray(score) &&
    score.length &&
    Array.isArray(score[0]) &&
    score[0].length === 2
  ) {
    return Object.fromEntries(score);
  }
  return score; // already a plain object
}

/* ---- slimResult: same structure as Calendar ---- */
function slimResult(full) {
  if (!full) return null;

  const scoreObj = scoreToObj(full.score) || {};

  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const pickNum = (...vals) => {
    for (const v of vals) {
      const n = toNum(v);
      if (n != null) return n;
    }
    return 0;
  };

  const homeScore = pickNum(
    scoreObj.home,
    scoreObj.Home,
    scoreObj.h,
    scoreObj.H,
    full.homeScore,
    full.home_score,
    full.totals?.home,
    full.totals?.h
  );

  const awayScore = pickNum(
    scoreObj.away,
    scoreObj.Away,
    scoreObj.a,
    scoreObj.A,
    full.awayScore,
    full.away_score,
    full.totals?.away,
    full.totals?.a
  );

  const rawHomeBox = full.box_home || full.boxHome || full.home_box || [];
  const rawAwayBox = full.box_away || full.boxAway || full.away_box || [];

  const makePair = (m, a) => `${m || 0}-${a || 0}`;

  function extractMA(obj, keysM, keysA, stringKeys = []) {
    let m, a;

    for (const k of keysM) {
      if (obj[k] != null) {
        m = Number(obj[k]) || 0;
        break;
      }
    }
    for (const k of keysA) {
      if (obj[k] != null) {
        a = Number(obj[k]) || 0;
        break;
      }
    }

    if ((m == null || a == null) && stringKeys.length) {
      for (const sk of stringKeys) {
        const raw = obj[sk];
        if (!raw) continue;
        const str = String(raw).trim();
        const parts = str.split(/[\/-]/).map((x) => parseInt(x.trim(), 10) || 0);
        if (parts.length >= 2) {
          if (m == null) m = parts[0];
          if (a == null) a = parts[1];
          break;
        }
      }
    }

    return { m: m || 0, a: a || 0 };
  }

  const convertBox = (arr) =>
    (arr || []).map((p) => {
      const obj = p instanceof Map ? Object.fromEntries(p) : p;

      const fg = extractMA(obj, ["fgm", "fg_m"], ["fga", "fg_a"], ["fg"]);
      const tp = extractMA(
        obj,
        ["tpm", "tp_m", "fg3m", "three_m"],
        ["tpa", "tp_a", "fg3a", "three_a"],
        ["3p", "tp", "three"]
      );
      const ft = extractMA(obj, ["ftm", "ft_m"], ["fta", "ft_a"], ["ft"]);

      return {
        player: obj.player ?? obj.player_name ?? obj.name ?? "Unknown",
        min: obj.min ?? obj.minutes ?? 0,
        pts: obj.pts ?? obj.points ?? 0,
        reb: obj.reb ?? obj.rebounds ?? 0,
        ast: obj.ast ?? obj.assists ?? 0,
        stl: obj.stl ?? obj.steals ?? 0,
        blk: obj.blk ?? obj.blocks ?? 0,
        fg: makePair(fg.m, fg.a),
        "3p": makePair(tp.m, tp.a),
        ft: makePair(ft.m, ft.a),
        to: obj.to ?? obj.turnovers ?? 0,
        pf: obj.pf ?? obj.fouls ?? 0,
      };
    });

  const side =
    homeScore > awayScore ? "home" : awayScore > homeScore ? "away" : "tie";

  return {
    winner: {
      score: `${homeScore}-${awayScore}`,
      home: homeScore,
      away: awayScore,
      ot: full.ot ?? 0,
      side,
    },
    totals: { home: homeScore, away: awayScore },
    box: { home: convertBox(rawHomeBox), away: convertBox(rawAwayBox) },
  };
}

function seriesWinnerTeam(s) {
  if (!s?.complete) return null;
  return (s.winsHigh ?? 0) > (s.winsLow ?? 0) ? s.highSeedTeam : s.lowSeedTeam;
}

function setHighLowBySeed(confKey, a, b, seedNumOf) {
  if (!a || !b) return { high: a || null, low: b || null, highNum: null, lowNum: null };

  const sa = seedNumOf(confKey, a) ?? 99;
  const sb = seedNumOf(confKey, b) ?? 99;

  if (sa <= sb) return { high: a, low: b, highNum: sa, lowNum: sb };
  return { high: b, low: a, highNum: sb, lowNum: sa };
}


function getWinPctFromStanding(row) {
  const wins = Number(row?.wins || 0);
  const losses = Number(row?.losses || 0);
  const games = wins + losses;
  if (!games) return 0;
  return wins / games;
}

function buildRegularSeasonSnapshot({ standings, seeds }) {
  const rows = Object.values(standings || {}).filter((row) => row?.team);

  const leagueSorted = [...rows].sort((a, b) => {
    const winDiff = getWinPctFromStanding(b) - getWinPctFromStanding(a);
    if (winDiff !== 0) return winDiff;
    const diffDiff = Number(b?.diff || 0) - Number(a?.diff || 0);
    if (diffDiff !== 0) return diffDiff;
    return String(a.team || "").localeCompare(String(b.team || ""));
  });

  const leagueRankByTeam = {};
  leagueSorted.forEach((row, idx) => {
    leagueRankByTeam[row.team] = idx + 1;
  });

  const seedByTeam = {};
  for (const [confKey, teamNames] of Object.entries(seeds || {})) {
    (teamNames || []).forEach((teamName, idx) => {
      seedByTeam[teamName] = {
        conference: confKey,
        conferenceSeed: idx + 1,
      };
    });
  }

  return rows.map((row) => {
    const seedInfo = seedByTeam[row.team] || {};
    const wins = Number(row?.wins || 0);
    const losses = Number(row?.losses || 0);
    const gp = wins + losses;
    const conferenceSeed = Number(seedInfo.conferenceSeed || 0) || null;

    return {
      teamName: row.team,
      conference: row.conf || seedInfo.conference || null,
      wins,
      losses,
      gamesPlayed: gp,
      winPct: gp ? Number((wins / gp).toFixed(3)) : 0,
      pointDifferential: Number(row?.diff || 0),
      pointsFor: Number(row?.pf || 0),
      pointsAgainst: Number(row?.pa || 0),
      conferenceWins: Number(row?.confWins || 0),
      conferenceLosses: Number(row?.confLosses || 0),
      conferenceSeed,
      leagueRank: leagueRankByTeam[row.team] || null,
      topSixSeed: Boolean(conferenceSeed && conferenceSeed <= 6),
      madePlayIn: Boolean(conferenceSeed && conferenceSeed >= 7 && conferenceSeed <= 10),
    };
  });
}

function playoffLossLabel(round) {
  if (round >= 4) return "finals";
  if (round === 3) return "conference_finals";
  if (round === 2) return "second_round";
  if (round === 1) return "first_round";
  return "missed_playoffs";
}

function buildPlayoffResultMap(post) {
  const resultByTeam = {};

  const ensure = (teamName) => {
    if (!teamName) return null;
    if (!resultByTeam[teamName]) {
      resultByTeam[teamName] = {
        madePlayoffs: false,
        madePlayIn: false,
        playoffResult: "missed_playoffs",
        playoffRoundReached: 0,
        champion: false,
        finals: false,
        conferenceFinals: false,
      };
    }
    return resultByTeam[teamName];
  };

  const markPlayIn = (teamName) => {
    const row = ensure(teamName);
    if (!row) return;
    row.madePlayIn = true;
    if (!row.madePlayoffs) row.playoffResult = "play_in";
  };

  const markRound = (teamName, round) => {
    const row = ensure(teamName);
    if (!row) return;
    row.madePlayoffs = true;
    row.playoffRoundReached = Math.max(Number(row.playoffRoundReached || 0), round);
    if (round >= 3) row.conferenceFinals = true;
    if (round >= 4) row.finals = true;
    row.playoffResult = playoffLossLabel(round);
  };

  const markSeries = (series, round) => {
    if (!series) return;
    const teams = [series.highSeedTeam, series.lowSeedTeam].filter(Boolean);
    for (const teamName of teams) markRound(teamName, round);

    if (!series.complete || teams.length < 2) return;

    const highWon = Number(series.winsHigh || 0) > Number(series.winsLow || 0);
    const winner = highWon ? series.highSeedTeam : series.lowSeedTeam;
    const loser = highWon ? series.lowSeedTeam : series.highSeedTeam;

    if (winner) markRound(winner, round + 1);
    if (loser) {
      const loserRow = ensure(loser);
      loserRow.playoffResult = playoffLossLabel(round);
      loserRow.playoffRoundReached = Math.max(Number(loserRow.playoffRoundReached || 0), round);
      if (round >= 3) loserRow.conferenceFinals = true;
      if (round >= 4) loserRow.finals = true;
    }
  };

  for (const [confKey, conf] of Object.entries(post?.conf || {})) {
    const pi = conf?.playIn;
    if (pi) {
      markPlayIn(pi?.g78?.home);
      markPlayIn(pi?.g78?.away);
      markPlayIn(pi?.g910?.home);
      markPlayIn(pi?.g910?.away);
      markPlayIn(pi?.gFinal?.home);
      markPlayIn(pi?.gFinal?.away);
    }

    const r1 = conf?.rounds?.r1 || {};
    markSeries(r1.s1v8, 1);
    markSeries(r1.s4v5, 1);
    markSeries(r1.s3v6, 1);
    markSeries(r1.s2v7, 1);

    const r2 = conf?.rounds?.r2 || {};
    markSeries(r2.top, 2);
    markSeries(r2.bot, 2);

    markSeries(conf?.rounds?.r3?.confFinals, 3);
  }

  markSeries(post?.finals, 4);

  const champion = seriesWinnerTeam(post?.finals);
  if (champion) {
    const row = ensure(champion);
    row.madePlayoffs = true;
    row.champion = true;
    row.finals = true;
    row.conferenceFinals = true;
    row.playoffRoundReached = 5;
    row.playoffResult = "champion";
  }

  return resultByTeam;
}

function buildSeasonHistoryEntry({ seasonYear, teams, regularSeasonSnapshot, post }) {
  const regularRows = Array.isArray(regularSeasonSnapshot) ? regularSeasonSnapshot : [];
  const regularByTeam = {};
  for (const row of regularRows) {
    if (row?.teamName) regularByTeam[row.teamName] = row;
  }

  const playoffByTeam = buildPlayoffResultMap(post);

  const teamRows = (teams || []).map((team) => {
    const teamName = team?.name || "Unknown Team";
    const regular = regularByTeam[teamName] || {
      teamName,
      conference: team?.conference || team?.conf || null,
      wins: Number(team?.wins || 0),
      losses: Number(team?.losses || 0),
      gamesPlayed: Number(team?.wins || 0) + Number(team?.losses || 0),
      winPct: 0,
      conferenceSeed: null,
      leagueRank: null,
      topSixSeed: false,
      madePlayIn: false,
    };

    const playoff = playoffByTeam[teamName] || {
      madePlayoffs: false,
      madePlayIn: Boolean(regular.madePlayIn),
      playoffResult: Boolean(regular.madePlayIn) ? "play_in" : "missed_playoffs",
      playoffRoundReached: 0,
      champion: false,
      finals: false,
      conferenceFinals: false,
    };

    return {
      ...regular,
      madePlayIn: Boolean(regular.madePlayIn || playoff.madePlayIn),
      madePlayoffs: Boolean(playoff.madePlayoffs),
      playoffResult: playoff.playoffResult,
      playoffRoundReached: Number(playoff.playoffRoundReached || 0),
      champion: Boolean(playoff.champion),
      finals: Boolean(playoff.finals),
      conferenceFinals: Boolean(playoff.conferenceFinals),
    };
  });

  return {
    seasonYear,
    createdAt: new Date().toISOString(),
    champion: seriesWinnerTeam(post?.finals),
    teams: teamRows,
  };
}

function upsertSeasonHistoryEntry(leagueData, entry) {
  if (!leagueData || !entry?.seasonYear) return leagueData;

  const next = { ...leagueData };
  const existing = Array.isArray(next.seasonHistory) ? next.seasonHistory : [];
  const filtered = existing.filter((row) => Number(row?.seasonYear) !== Number(entry.seasonYear));

  next.seasonHistory = [...filtered, entry]
    .sort((a, b) => Number(a?.seasonYear || 0) - Number(b?.seasonYear || 0))
    .slice(-10);

  return next;
}

/* ------------ standings + tiebreak helpers ------------ */
function computeStandings({ teams, scheduleByDate, resultsById, confOf }) {
  const base = {};
  for (const t of teams) {
    base[t.name] = {
      team: t.name,
      conf: confOf(t.name),
      wins: 0,
      losses: 0,
      pf: 0,
      pa: 0,
      diff: 0,
      confWins: 0,
      confLosses: 0,
      h2h: {}, // opponent -> {w,l}
    };
  }

  for (const games of Object.values(scheduleByDate || {})) {
    for (const g of games || []) {
      // ✅ PATCH: standings must be regular-season only (ignore any postseason IDs if they ever appear)
      if (typeof g?.id === "string" && (g.id.startsWith("PO_") || g.id.startsWith("PI_"))) continue;

      if (!g?.played) continue;
      const r = resultsById?.[g.id];
      if (!r?.totals) continue;

      const home = g.home;
      const away = g.away;
      if (!base[home] || !base[away]) continue;

      const hs = r.totals.home ?? 0;
      const as = r.totals.away ?? 0;

      base[home].pf += hs;
      base[home].pa += as;
      base[away].pf += as;
      base[away].pa += hs;

      const homeWon = hs > as;
      const awayWon = as > hs;

      if (homeWon) {
        base[home].wins++;
        base[away].losses++;
      } else if (awayWon) {
        base[away].wins++;
        base[home].losses++;
      }

      const homeConf = base[home].conf;
      const awayConf = base[away].conf;
      if (homeConf && awayConf && homeConf === awayConf) {
        if (homeWon) {
          base[home].confWins++;
          base[away].confLosses++;
        } else if (awayWon) {
          base[away].confWins++;
          base[home].confLosses++;
        }
      }

      base[home].h2h[away] = base[home].h2h[away] || { w: 0, l: 0 };
      base[away].h2h[home] = base[away].h2h[home] || { w: 0, l: 0 };
      if (homeWon) {
        base[home].h2h[away].w++;
        base[away].h2h[home].l++;
      } else if (awayWon) {
        base[away].h2h[home].w++;
        base[home].h2h[away].l++;
      }
    }
  }

  for (const k of Object.keys(base)) {
    base[k].diff = base[k].pf - base[k].pa;
    const gp = base[k].wins + base[k].losses;
    base[k].winPct = gp ? base[k].wins / gp : 0;

    const cgp = base[k].confWins + base[k].confLosses;
    base[k].confPct = cgp ? base[k].confWins / cgp : 0;
  }

  return base;
}

function sortWithTiebreak(teamNames, standings) {
  const arr = [...teamNames];

  arr.sort((A, B) => {
    const a = standings[A],
      b = standings[B];
    if (!a || !b) return (A || "").localeCompare(B || "");

    if (b.winPct !== a.winPct) return b.winPct - a.winPct;

    const h2hA = a.h2h?.[B];
    const h2hB = b.h2h?.[A];
    if (h2hA && h2hB) {
      const gp = h2hA.w + h2hA.l;
      if (gp > 0) {
        const aPct = h2hA.w / gp;
        const bPct = h2hB.w / gp;
        if (bPct !== aPct) return bPct - aPct;
      }
    }

    if (b.confPct !== a.confPct) return b.confPct - a.confPct;
    if (b.diff !== a.diff) return b.diff - a.diff;

    return (A || "").localeCompare(B || "");
  });

  return arr;
}

/* ------------ sim helpers ------------ */
async function simOneSafe({ homeName, awayName, leagueData, teamsByName }) {
  const homeTeamObj = teamsByName[homeName];
  const awayTeamObj = teamsByName[awayName];

  if (!homeTeamObj || !awayTeamObj) {
    throw new Error(`Team lookup failed: ${homeName} / ${awayName}`);
  }

  ensureGameplansForLeague(leagueData);

  const home = structuredClone(homeTeamObj);
  const away = structuredClone(awayTeamObj);

  for (const p of home.players || []) {
    if (!p.secondaryPos || String(p.secondaryPos).trim() === "") {
      p.secondaryPos = null;
    }
  }

  for (const p of away.players || []) {
    if (!p.secondaryPos || String(p.secondaryPos).trim() === "") {
      p.secondaryPos = null;
    }
  }

  home.minutes = readFlatMinutesFromGameplan(home.name);
  away.minutes = readFlatMinutesFromGameplan(away.name);

  if (window.__debugSimLogs) {
    console.log("[Playoffs simOneSafe] home minutes keys =", Object.keys(home.minutes || {}));
    console.log("[Playoffs simOneSafe] away minutes keys =", Object.keys(away.minutes || {}));
  }

  const full = await queueSim(() =>
    simulateOneGame({ homeTeam: home, awayTeam: away, leagueData })
  );

  return full;
}

/* =============== UI bits =============== */
const Logo = ({ src, size = 34, title = "" }) => {
  if (!src) {
    return (
      <div
        className="bg-neutral-700 rounded flex items-center justify-center"
        style={{ width: size, height: size }}
        title={title}
      />
    );
  }
  return (
    <img
      src={src}
      alt={title}
      title={title}
      style={{ width: size, height: size, objectFit: "contain", display: "block" }}
    />
  );
};

function homeOrderForBestOf7HigherSeedHome() {
  // 2-2-1-1-1 (higher seed home in G1,2,5,7)
  return ["H", "H", "A", "A", "H", "A", "H"];
}
function parseMadeAtt(v) {
  // supports "9-17" or "9/17" or already numbers
  if (v == null) return { m: 0, a: 0 };

  if (typeof v === "string") {
    const s = v.trim();
    const parts = s.split(/[\/-]/).map((x) => parseInt(x.trim(), 10));
    if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      return { m: parts[0], a: parts[1] };
    }
    return { m: 0, a: 0 };
  }

  // if someone ever stores as {m,a}
  if (typeof v === "object") {
    const m = Number(v.m ?? v.made ?? 0) || 0;
    const a = Number(v.a ?? v.att ?? v.attempts ?? 0) || 0;
    return { m, a };
  }

  return { m: 0, a: 0 };
}

// ✅ PATCH (Finals MVP): Build Finals-only aggregated player stat dicts from saved finals boxscores
function buildFinalsAggregatePlayers(post, resultsById) {
  if (!post?.finals?.gameIds?.length) return [];

  const agg = {}; // key = player__team

  const parseMA = (val) => {
    // expects "M-A" (like "9-18")
    if (!val) return { m: 0, a: 0 };
    const s = String(val).trim();
    const parts = s.split("-").map((x) => Number(x));
    if (parts.length !== 2) return { m: 0, a: 0 };
    return { m: Number.isFinite(parts[0]) ? parts[0] : 0, a: Number.isFinite(parts[1]) ? parts[1] : 0 };
  };

  const addRow = (teamName, row) => {
    if (!row?.player) return;

    const key = `${row.player}__${teamName}`;
    if (!agg[key]) {
      agg[key] = {
        player: row.player,
        team: teamName,
        gp: 0,
        min: 0,
        pts: 0,
        reb: 0,
        ast: 0,
        stl: 0,
        blk: 0,
        to: 0,

        // ✅ REQUIRED for awards.py FG% / 3P%
        fgm: 0,
        fga: 0,
        tpm: 0,
        tpa: 0,
        ftm: 0,
        fta: 0,
      };
    }

    const a = agg[key];
    a.gp += 1;
    a.min += Number(row.min || 0);
    a.pts += Number(row.pts || 0);
    a.reb += Number(row.reb || 0);
    a.ast += Number(row.ast || 0);
    a.stl += Number(row.stl || 0);
    a.blk += Number(row.blk || 0);
    a.to += Number(row.to || 0);

    // row.fg and row["3p"] are strings like "M-A"
    const fg = parseMA(row.fg);
    const tp = parseMA(row["3p"]);
    const ft = parseMA(row.ft);

    a.fgm += fg.m;
    a.fga += fg.a;
    a.tpm += tp.m;
    a.tpa += tp.a;
    a.ftm += ft.m;
    a.fta += ft.a;
  };

  const order = homeOrderForBestOf7HigherSeedHome();
  const high = post.finals.highSeedTeam;
  const low = post.finals.lowSeedTeam;

  for (let i = 0; i < post.finals.gameIds.length; i++) {
    const gid = post.finals.gameIds[i];
    const r = resultsById?.[gid];
    if (!r?.box) continue;

    const isHighHome = order[i] === "H";
    const homeTeam = isHighHome ? high : low;
    const awayTeam = isHighHome ? low : high;

    for (const row of r.box?.home || []) addRow(homeTeam, row);
    for (const row of r.box?.away || []) addRow(awayTeam, row);
  }

  return Object.values(agg);
}


/* ================== PAGE ================== */
export default function Playoffs() {
  function wireForward(cur, confKey) {
    const conf = cur.conf[confKey];
    if (!conf) return;

    const r1 = conf.rounds.r1;
    const r2 = conf.rounds.r2;
    const r3 = conf.rounds.r3;

    // R1 winners
    const w18 = seriesWinnerTeam(r1.s1v8);
    const w45 = seriesWinnerTeam(r1.s4v5);
    const w36 = seriesWinnerTeam(r1.s3v6);
    const w27 = seriesWinnerTeam(r1.s2v7);

    // Fill R2 Top (winner 1v8 vs winner 4v5)
    if (w18 && w45 && (!r2.top.highSeedTeam || !r2.top.lowSeedTeam)) {
      const { high, low, highNum, lowNum } = setHighLowBySeed(confKey, w18, w45, seedNumOf);
      r2.top.highSeedTeam = high;
      r2.top.lowSeedTeam = low;
      r2.top.highSeedNum = highNum;
      r2.top.lowSeedNum = lowNum;
    }

    // Fill R2 Bottom (winner 3v6 vs winner 2v7)
    if (w36 && w27 && (!r2.bot.highSeedTeam || !r2.bot.lowSeedTeam)) {
      const { high, low, highNum, lowNum } = setHighLowBySeed(confKey, w36, w27, seedNumOf);
      r2.bot.highSeedTeam = high;
      r2.bot.lowSeedTeam = low;
      r2.bot.highSeedNum = highNum;
      r2.bot.lowSeedNum = lowNum;
    }

    // R2 winners → Conference Finals
    const wR2T = seriesWinnerTeam(r2.top);
    const wR2B = seriesWinnerTeam(r2.bot);

    if (wR2T && wR2B && (!r3.confFinals.highSeedTeam || !r3.confFinals.lowSeedTeam)) {
      const { high, low, highNum, lowNum } = setHighLowBySeed(confKey, wR2T, wR2B, seedNumOf);
      r3.confFinals.highSeedTeam = high;
      r3.confFinals.lowSeedTeam = low;
      r3.confFinals.highSeedNum = highNum;
      r3.confFinals.lowSeedNum = lowNum;
    }

    // Conference champs → Finals
    const leftKey = cur.layout.left;
    const rightKey = cur.layout.right;

    const leftChamp = seriesWinnerTeam(cur.conf[leftKey]?.rounds?.r3?.confFinals);
    const rightChamp = seriesWinnerTeam(cur.conf[rightKey]?.rounds?.r3?.confFinals);

    if (leftChamp && rightChamp && (!cur.finals.highSeedTeam || !cur.finals.lowSeedTeam)) {
      // Use regular season winPct for Finals home-court
      const wl = standings[leftChamp]?.winPct ?? 0;
      const wr = standings[rightChamp]?.winPct ?? 0;

      if (wl >= wr) {
        cur.finals.highSeedTeam = leftChamp;
        cur.finals.lowSeedTeam = rightChamp;
      } else {
        cur.finals.highSeedTeam = rightChamp;
        cur.finals.lowSeedTeam = leftChamp;
      }
    }
  }

  const navigate = useNavigate();
  const { leagueData, setLeagueData, selectedTeam, setSelectedTeam } = useGame();

  const teams = useMemo(() => {
    const arr = getAllTeamsFromLeague(leagueData);
    return (arr || []).map((t) => ({ ...t }));
  }, [leagueData]);

  const teamLogo = useMemo(() => {
    const map = {};
    for (const t of teams) {
      map[t.name] = t.logo || t.teamLogo || t.logoUrl || t.image || t.img || t.newTeamLogo || "";
    }
    return map;
  }, [teams]);

  const teamsByName = useMemo(() => {
    const map = {};
    for (const t of teams) map[t.name] = t;
    return map;
  }, [teams]);

  const confKeys = useMemo(() => {
    const keys = Object.keys(leagueData?.conferences || {});
    if (keys.length) return keys;
    const fromTeams = new Set();
    for (const t of teams) {
      const c = t.conference || t.conf;
      if (c) fromTeams.add(c);
    }
    return [...fromTeams];
  }, [leagueData, teams]);

  const confOf = (teamName) => {
    const confs = leagueData?.conferences || {};
    for (const ck of Object.keys(confs)) {
      const list = confs[ck] || [];
      if (list.some((t) => t.name === teamName)) return ck;
    }
    const t = teamsByName[teamName];
    return t?.conference || t?.conf || null;
  };

  const scheduleByDate = useMemo(() => loadSchedule(), []);

  // ✅ SURGICAL PATCH: standings seeding reads V3 results (regular season)
  const resultsById = useMemo(() => loadAllResultsV3(), []);

  const standings = useMemo(() => {
    return computeStandings({ teams, scheduleByDate, resultsById, confOf });
  }, [teams, scheduleByDate, resultsById]);

  const seasonYear = useMemo(() => {
    const leagueYear = Number(
      leagueData?.seasonYear ||
        leagueData?.currentSeasonYear ||
        leagueData?.year ||
        0
    );

    if (Number.isFinite(leagueYear) && leagueYear > 0) return leagueYear;

    const y = window.__seasonYear;
    if (typeof y === "number") return y;

    return new Date().getFullYear();
  }, [leagueData]);

  const fmvpSeasonYear = useMemo(() => {
    return getFinalsDisplaySeasonYear(leagueData, seasonYear);
  }, [leagueData, seasonYear]);

  const seeds = useMemo(() => {
    const out = {};
    const confs = confKeys.length ? confKeys : ["West", "East"];

    for (const ck of confs) {
      const teamNames = Object.values(standings)
        .filter((x) => x.conf === ck)
        .map((x) => x.team);

      const sorted = sortWithTiebreak(teamNames, standings);
      out[ck] = sorted.slice(0, 10);
    }

    return out;
  }, [standings, confKeys]);

  const seedNumOf = (confKey, teamName) => {
    if (!teamName) return null;

    const savedSeedOrder = loadPostseasonState()?.seedOrder || {};
    const list = (seeds?.[confKey] || []).length
      ? seeds?.[confKey] || []
      : savedSeedOrder?.[confKey] || [];

    const idx = list.findIndex((t) => t === teamName);
    return idx >= 0 ? idx + 1 : null;
  };

  const [post, setPost] = useState(null);

  // ✅ playoff results stay v2 blob
  const [resultsLive, setResultsLive] = useState(() => loadPlayoffResults());

  const [modal, setModal] = useState(null);
  const [boxModal, setBoxModal] = useState(null);
  const [simLock, setSimLock] = useState(false);
  const [champModal, setChampModal] = useState(null);

  // ✅ PATCH: stop button support (calendar-style stop behavior)
  const stopRequestedRef = useRef(false);
  const [simStopping, setSimStopping] = useState(false);

  // ✅ PATCH (Finals MVP)
  const [fmvpLoading, setFmvpLoading] = useState(false);
  const [showFinalsMvpModal, setShowFinalsMvpModal] = useState(false);
  const [finalsMvpSeen, setFinalsMvpSeen] = useState(false);

  // v5.2 render-loop fix: do not re-hydrate/persist the same saved postseason every render.
  // The old effect called setPost + setLeagueData repeatedly after a completed playoff run,
  // which React reported as "Maximum update depth exceeded" when opening old box scores.
  const hydratedPostseasonSeasonRef = useRef(null);

  useEffect(() => {
    const championTeam = champModal?.team || finalsChampionName(post?.finals);

    if (!championTeam) {
      setFinalsMvpSeen(false);
      return;
    }

    setFinalsMvpSeen(readFinalsMvpSeenFor(fmvpSeasonYear, championTeam));
  }, [fmvpSeasonYear, champModal?.team, post?.finals?.complete]);

  const markFinalsMvpSeen = () => {
    const championTeam = champModal?.team || finalsChampionName(post?.finals);
    saveFinalsMvpSeenFor(fmvpSeasonYear, championTeam);
    setFinalsMvpSeen(true);
  };

  const openFinalsMvpModal = () => {
    markFinalsMvpSeen();
    setShowFinalsMvpModal(true);
  };

  const closeFinalsMvpModal = () => {
    markFinalsMvpSeen();
    setShowFinalsMvpModal(false);
  };

  const continueFromFinalsMvpModal = () => {
    markFinalsMvpSeen();

    let fmvpRaw = null;

    try {
      fmvpRaw = JSON.parse(localStorage.getItem(FINALS_MVP_KEY) || "null");
    } catch {
      fmvpRaw = null;
    }

    finalizeFinalsMvpAndGoOffseason({
      leagueData,
      fmvpRaw,
      selectedTeam,
      setLeagueData,
      setSelectedTeam,
      navigate,
    });
  };

  // ===== FAST RESULTS SAVE (debounced) =====
  const resultsRef = useRef(resultsLive);
  useEffect(() => {
    resultsRef.current = resultsLive;
  }, [resultsLive]);

  const resultsSaveTimerRef = useRef(null);
  const pendingResultsRef = useRef(null);

  function scheduleSaveResults(nextResults) {
    pendingResultsRef.current = nextResults;

    // already scheduled
    if (resultsSaveTimerRef.current) return;

    resultsSaveTimerRef.current = setTimeout(() => {
      resultsSaveTimerRef.current = null;
      if (pendingResultsRef.current) {
        savePlayoffResults(pendingResultsRef.current);
      }
    }, 250); // tweak: 150-400ms is usually good
  }

  function flushPendingResults() {
    if (resultsSaveTimerRef.current) {
      clearTimeout(resultsSaveTimerRef.current);
      resultsSaveTimerRef.current = null;
    }

    if (pendingResultsRef.current) {
      savePlayoffResults(pendingResultsRef.current);
      pendingResultsRef.current = null;
    }
  }

  function getPlayoffResult(gameId) {
    if (!gameId) return null;

    const live = resultsRef.current?.[gameId];
    if (live) return live;

    const stored = loadPlayoffResults();
    return stored?.[gameId] || null;
  }

  // (kept; not used here yet)
  const [simProgress, setSimProgress] = useState(null);
  const simDoneRef = useRef(0);

  // ===== Size knobs (tweak these) =====
  const LOGO_SZ = 60;
  const SEED_SZ = 30;
  const WIN_SZ = 32;
  const BOX_W = 265;
  const BOX_PAD = 12;
  const ROW_GAP = 10;
  const BOX_H = LOGO_SZ * 2 + ROW_GAP + BOX_PAD * 2;

  // ===== 2K full-screen scaling =====
  // ===== Layout knobs (match BracketSide2K) =====
  const BRACKET_GAP = 74; // must match BracketSide2K GAP
  const SIDE_W = (BOX_W + BRACKET_GAP) * 2 + BOX_W; // width of one conference bracket
  const FINALS_W = BOX_W; // finals should match series box width
  const BASE_W = SIDE_W * 2 + FINALS_W; // true content width
  const BASE_H = 980;

  const [uiScale, setUiScale] = useState(1);

  useLayoutEffect(() => {
    const recalc = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const PAD_X = 48; // px-6 left + right (24 + 24)
      const TOPBAR_H = 72;

      const usableW = vw - PAD_X;
      const usableH = vh - TOPBAR_H - 12; // tiny breathing room

      const s = Math.min(usableW / BASE_W, usableH / BASE_H);
      const clamped = Math.max(0.68, Math.min(1.0, s));

      setUiScale(clamped);
    };

    recalc();
    window.addEventListener("resize", recalc);
    return () => window.removeEventListener("resize", recalc);
  }, []);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(CHAMP_KEY) || "null");
      if (stored?.team) {
        const normalized = { ...stored, seasonYear: fmvpSeasonYear };
        if (Number(stored.seasonYear) !== Number(fmvpSeasonYear)) {
          safeSetSmallJSON(CHAMP_KEY, normalized);
        }
        setChampModal(normalized);
      }
    } catch {}
  }, [fmvpSeasonYear]);

  // ✅ PATCH (Finals MVP): compute once when finals complete + champModal exists
  useEffect(() => {
    if (!champModal?.team) return;
    if (!post?.finals?.complete) return;

    // v5.1 scope fix: this must live in the whole useEffect scope, not inside try/catch.
    const EXPECTED_AWARDS_PY_VERSION = "2026-05-13_fmvp_boxscores_v5_1_SCOPEFIX";

    try {
      const existing = JSON.parse(localStorage.getItem(FINALS_MVP_KEY) || "null");
      if (
        existing?.season === fmvpSeasonYear &&
        existing?.champion_team === champModal.team &&
        existing?.awards_py_version === EXPECTED_AWARDS_PY_VERSION
      ) {
        return;
      }
    } catch {}

    const run = async () => {
      try {
        setFmvpLoading(true);

        // Merge live + saved playoff results so FMVP can recompute correctly after refresh/back navigation.
        const allPlayoffResultsForFmvp = {
          ...loadPlayoffResults(),
          ...(resultsRef.current || {}),
        };

        const finalsPlayers = buildFinalsAggregatePlayers(post, allPlayoffResultsForFmvp);
        const payload = await computeFinalsMvp(finalsPlayers, {
          seasonYear: fmvpSeasonYear,
          championTeam: champModal.team,
        });

        // The Python award result may only return the score fields it used.
        // Re-attach the raw Finals aggregate so the UI can show MIN/TOV/FGA/3PA/FTA too.
        const winnerKey = `${payload?.finals_mvp?.player || ""}__${payload?.finals_mvp?.team || ""}`;
        const winnerAggregate = finalsPlayers.find(
          (row) => `${row.player}__${row.team}` === winnerKey
        );

        const enrichedPayload = {
          ...payload,
          season: fmvpSeasonYear,
          champion_team: champModal.team,
          awards_py_version: EXPECTED_AWARDS_PY_VERSION,
          finals_mvp: payload?.finals_mvp
            ? {
                ...winnerAggregate,
                ...payload.finals_mvp,
              }
            : payload?.finals_mvp,
        };

        safeSetSmallJSON(FINALS_MVP_KEY, enrichedPayload);
      } catch (e) {
        console.warn("[playoffs] Finals MVP compute failed", e);
        safeSetSmallJSON(FINALS_MVP_KEY, {
          season: fmvpSeasonYear,
          champion_team: champModal.team,
          finals_mvp: null,
          error: String(e?.message || e),
        });
      } finally {
        setFmvpLoading(false);
      }
    };

    run();
  }, [champModal, post, fmvpSeasonYear]);

  function finalsChampionName(series) {
    if (!series?.complete) return null;
    return (series.winsHigh ?? 0) > (series.winsLow ?? 0) ? series.highSeedTeam : series.lowSeedTeam;
  }

  function getLeagueDataForHistoryWrite() {
    // Full leagueData now lives in React context + IndexedDB. Do not read the
    // localStorage pointer as if it were the full league object.
    return leagueData || window.__leagueData || null;
  }

  function persistSeasonHistorySnapshot(next, { force = false } = {}) {
    if (!next?.seasonYear) return;

    const sourceLeague = getLeagueDataForHistoryWrite();
    if (!sourceLeague || typeof sourceLeague !== "object") return;

    const champ = finalsChampionName(next.finals);
    const history = Array.isArray(sourceLeague.seasonHistory) ? sourceLeague.seasonHistory : [];
    const hasCurrentSeasonHistory = history.some(
      (row) => Number(row?.seasonYear) === Number(next.seasonYear)
    );

    // Before the Finals are done, write the snapshot once so offseason preview/team
    // direction can use real standings instead of roster-only fallback. Once a
    // champion exists, force an update with the final playoff result.
    if (!force && !champ && hasCurrentSeasonHistory) return;

    const regularSeasonSnapshot =
      Array.isArray(next.regularSeasonSnapshot) && next.regularSeasonSnapshot.length
        ? next.regularSeasonSnapshot
        : buildRegularSeasonSnapshot({ standings, seeds });

    const historyEntry = {
      ...buildSeasonHistoryEntry({
        seasonYear: next.seasonYear,
        teams,
        regularSeasonSnapshot,
        post: next,
      }),
      status: champ ? "complete" : "in_progress",
    };

    const leagueWithHistory = upsertSeasonHistoryEntry(sourceLeague, historyEntry);
    if (!leagueWithHistory) return;

    if (typeof setLeagueData === "function") {
      setLeagueData(leagueWithHistory);
    }

    saveLeagueDataInBackground(leagueWithHistory);
  }

  function persistPost(next) {
    flushPendingResults();
    setPost(next);
    savePostseasonState(next);

    const champ = finalsChampionName(next.finals);
    persistSeasonHistorySnapshot(next, { force: Boolean(champ) });

    // ALWAYS show champion popup once finals completes (and store it)
    if (champ) {
      const payload = { seasonYear: fmvpSeasonYear, team: champ };
      safeSetSmallJSON(CHAMP_KEY, payload);
      setChampModal(payload);
    }
  }

  function buildInitialPostseason({ seasonYear, seeds, regularSeasonSnapshot = [] }) {
    const confs = Object.keys(seeds || {});
    const westKey =
      confs.find((k) => String(k).toLowerCase().includes("west")) || confs[0] || "West";
    const eastKey =
      confs.find((k) => String(k).toLowerCase().includes("east")) || confs[1] || "East";

    const mkSeries = (conf, round, label, highSeedTeam, lowSeedTeam, highSeedNum, lowSeedNum) => {
      const homeOrder = homeOrderForBestOf7HigherSeedHome();
      const gameIds = homeOrder.map((_, i) => `PO_${seasonYear}_${conf}_R${round}_${label}_G${i + 1}`);
      return {
        type: "series",
        conf,
        round,
        label,
        highSeedTeam,
        lowSeedTeam,
        highSeedNum,
        lowSeedNum,
        winsHigh: 0,
        winsLow: 0,
        gameIds,
        nextGameIndex: 0,
        complete: false,
      };
    };

    const mkPlayIn = (conf) => {
      const list = seeds[conf] || [];
      const s7 = list[6],
        s8 = list[7],
        s9 = list[8],
        s10 = list[9];
      return {
        conf,
        g78: { id: `PI_${seasonYear}_${conf}_7v8`, home: s7, away: s8, played: false, winner: null, loser: null },
        g910: { id: `PI_${seasonYear}_${conf}_9v10`, home: s9, away: s10, played: false, winner: null, loser: null },
        gFinal: { id: `PI_${seasonYear}_${conf}_8seed`, home: null, away: null, played: false, winner: null, loser: null },
        seed7: null,
        seed8: null,
      };
    };

    const mkConf = (conf) => {
      const list = seeds[conf] || [];
      const s1 = list[0],
        s2 = list[1],
        s3 = list[2],
        s4 = list[3],
        s5 = list[4],
        s6 = list[5];

      return {
        conf,
        playIn: mkPlayIn(conf),
        rounds: {
          r1: {
            s1v8: mkSeries(conf, 1, "1v8", s1, null, 1, 8),
            s4v5: mkSeries(conf, 1, "4v5", s4, s5, 4, 5),
            s3v6: mkSeries(conf, 1, "3v6", s3, s6, 3, 6),
            s2v7: mkSeries(conf, 1, "2v7", s2, null, 2, 7),
          },
          r2: {
            top: mkSeries(conf, 2, "R2_TOP", null, null, null, null),
            bot: mkSeries(conf, 2, "R2_BOT", null, null, null, null),
          },
          r3: {
            confFinals: mkSeries(conf, 3, "CONF_FINALS", null, null, null, null),
          },
        },
      };
    };

    return {
      seasonYear,
      seedOrder: seeds,
      regularSeasonSnapshot,
      layout: { left: westKey, right: eastKey },
      conf: {
        [westKey]: mkConf(westKey),
        [eastKey]: mkConf(eastKey),
      },
      finals: mkSeries("NBA", 4, "FINALS", null, null, null, null),
    };
  }

  useEffect(() => {
    if (!seasonYear) return;

    // Try loading an existing compressed or legacy postseason first.
    // This must happen before the seed check, because we may intentionally
    // clear regular-season results/schedule after the bracket is created.
    const loaded = loadPostseasonState();
    if (loaded?.seasonYear === seasonYear) {
      if (hydratedPostseasonSeasonRef.current !== seasonYear) {
        hydratedPostseasonSeasonRef.current = seasonYear;
        setPost(loaded);
        persistSeasonHistorySnapshot(loaded);
      }
      return;
    }

    // Need seeds to exist before building a brand-new bracket.
    const confs = Object.keys(seeds || {});
    const hasSeeds = confs.some((k) => (seeds?.[k] || []).length >= 8);
    if (!hasSeeds) return;

    // Build new postseason and freeze regular-season standings before any cleanup can wipe game results.
    const regularSeasonSnapshot = buildRegularSeasonSnapshot({ standings, seeds });
    const fresh = buildInitialPostseason({ seasonYear, seeds, regularSeasonSnapshot });
    persistPost(fresh);
  }, [seasonYear, seeds, standings]);

  function winnerFromSlim(slim) {
    if (!slim?.winner?.side || slim.winner.side === "tie") return null;
    return slim.winner.side;
  }
  function isBadSlimResult(slim) {
    if (!slim) return true;

    const side = slim?.winner?.side;
    const hs = Number(slim?.winner?.home ?? 0);
    const as = Number(slim?.winner?.away ?? 0);

    if (!side || side === "tie") return true;
    if (hs === 0 && as === 0) return true;

    return false;
  }

  async function simGameId(gameId, homeName, awayName) {
    // check state first (but don't trust bad cached 0-0/tie)
    const cached = resultsLive?.[gameId];
    if (cached && !isBadSlimResult(cached)) return cached;

    // also check localStorage (but don't trust bad cached 0-0/tie)
    const stored = loadPlayoffResults();
    const storedOne = stored?.[gameId];
    if (storedOne && !isBadSlimResult(storedOne)) return storedOne;

    const full = await simOneSafe({ homeName, awayName, leagueData, teamsByName });
    const slim = slimResult(full);

    // don't save bad results — force resim next time instead of getting stuck
    if (isBadSlimResult(slim)) return slim;

    const mergedResults = { ...(resultsRef.current || {}), [gameId]: slim };
    resultsRef.current = mergedResults;
    setResultsLive(mergedResults);
    scheduleSaveResults(mergedResults); // ✅ fast: save later, not every game

    return slim;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function safeSimGameId(gameId, homeName, awayName, { retries = 1, backoffMs = 75 } = {}) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const slim = await simGameId(gameId, homeName, awayName);

        // treat tie/0-0 as a failed attempt so we retry
        if (slim && !isBadSlimResult(slim)) return slim;

        throw new Error("bad sim result (tie/0-0/null)");
      } catch (err) {
        console.warn(`[playoffs] sim failed for ${gameId} attempt ${attempt + 1}/${retries + 1}`, err);
        if (attempt === retries) return null;
        await sleep(backoffMs * (attempt + 1));
      }
    }
    return null;
  }

  async function simPlayInGame(confKey, which) {
    if (simLock) return;
    setSimLock(true);

    try {
      const cur = structuredClone(post);
      await simPlayInGameInCur(cur, confKey, which);
      persistPost(cur);
    } finally {
      setSimLock(false);
    }
  }

  function getSeriesNode(cur, confKey, roundName, seriesKey) {
    if (!cur) return null;
    if (roundName === "finals") return cur.finals;

    const conf = cur.conf?.[confKey];
    return conf?.rounds?.[roundName]?.[seriesKey] || null;
  }

  function seriesGameMeta(series, idx) {
    const order = homeOrderForBestOf7HigherSeedHome();
    const isHighHome = order[idx] === "H";
    const home = isHighHome ? series.highSeedTeam : series.lowSeedTeam;
    const away = isHighHome ? series.lowSeedTeam : series.highSeedTeam;
    return { home, away };
  }

  async function simSeriesNextGame(confKey, roundName, seriesKey) {
    const cur = structuredClone(post);
    const series = getSeriesNode(cur, confKey, roundName, seriesKey);
    if (!series || series.complete) return;
    if (!series.highSeedTeam || !series.lowSeedTeam) return;

    const idx = series.nextGameIndex;
    if (idx >= series.gameIds.length) return;

    const gid = series.gameIds[idx];
    const { home, away } = seriesGameMeta(series, idx);

    const slim = await safeSimGameId(gid, home, away, { retries: 2 });
    const side = winnerFromSlim(slim);

    if (!side) {
      console.warn("[playoffs] No winner (tie/bad result). Not advancing game index.", gid, slim);
      return;
    }

    if (side === "home") {
      if (home === series.highSeedTeam) series.winsHigh++;
      else series.winsLow++;
    } else if (side === "away") {
      if (away === series.highSeedTeam) series.winsHigh++;
      else series.winsLow++;
    }

    series.nextGameIndex++;
    if (series.winsHigh >= 4 || series.winsLow >= 4) series.complete = true;

    // Advance conference bracket only for conference rounds
    if (roundName !== "finals") wireForward(cur, confKey);

    persistPost(cur);
  }

  async function simSeriesToCompletion(confKey, roundName, seriesKey) {
    if (simLock) return;
    setSimLock(true);

    try {
      const cur = structuredClone(post);
      const series = getSeriesNode(cur, confKey, roundName, seriesKey);
      if (!series) return;
      if (!series.highSeedTeam || !series.lowSeedTeam) return;

      while (!series.complete) {
        const idx = series.nextGameIndex;
        if (idx >= series.gameIds.length) break;

        const gid = series.gameIds[idx];
        const { home, away } = seriesGameMeta(series, idx);

        const slim = await safeSimGameId(gid, home, away, { retries: 2 });
        const side = winnerFromSlim(slim);

        if (!side) {
          console.warn("[playoffs] No winner (tie/bad result). Stopping series sim to avoid burning games.", gid, slim);
          break;
        }

        if (side === "home") {
          if (home === series.highSeedTeam) series.winsHigh++;
          else series.winsLow++;
        } else if (side === "away") {
          if (away === series.highSeedTeam) series.winsHigh++;
          else series.winsLow++;
        }

        series.nextGameIndex++;

        if (series.winsHigh >= 4 || series.winsLow >= 4) {
          series.complete = true;
          break;
        }

        await new Promise((r) => setTimeout(r, 0));
      }

      if (roundName !== "finals") wireForward(cur, confKey);
      persistPost(cur);
    } finally {
      setSimLock(false);
    }
  }

  async function simConferenceRound1(confKey) {
    const cur = structuredClone(post);
    const pi = cur.conf[confKey].playIn;

    // persist immediately so wiring updates survive refresh even if user closes tab mid-sim
    persistPost(cur);

    // ✅ Sim play-in games IN THE SAME cur object
    if (!pi.g78.played) {
      await simPlayInGameInCur(cur, confKey, "78");
      persistPost(structuredClone(cur));
    }
    if (!pi.g910.played) {
      await simPlayInGameInCur(cur, confKey, "910");
      persistPost(structuredClone(cur));
    }
    if (!pi.gFinal.played) {
      await simPlayInGameInCur(cur, confKey, "final");
      persistPost(structuredClone(cur));
    }

    // Now sim all R1 series to completion
    const keys = ["s1v8", "s4v5", "s3v6", "s2v7"];
    for (const sk of keys) {
      await simSeriesToCompletion(confKey, "r1", sk);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  async function simPlayoffsSoFar() {
    if (simLock) return;
    setSimLock(true);

    try {
      const cur = structuredClone(post);

      const left = cur.layout.left;
      const right = cur.layout.right;

      // 1) Play-ins for BOTH conferences
      for (const ck of [left, right]) {
        const pi = cur?.conf?.[ck]?.playIn;
        if (!pi) continue;

        if (!pi.g78.played) {
          await simPlayInGameInCur(cur, ck, "78");
          persistPost(structuredClone(cur));
        }
        if (!pi.g910.played) {
          await simPlayInGameInCur(cur, ck, "910");
          persistPost(structuredClone(cur));
        }
        if (!pi.gFinal.played) {
          await simPlayInGameInCur(cur, ck, "final");
          persistPost(structuredClone(cur));
        }
      }

      // 2) R1 + R2 + R3 (both conferences)
      for (const ck of [left, right]) {
        for (const sk of ["s1v8", "s4v5", "s3v6", "s2v7"]) {
          await simSeriesToCompletionInCur(cur, ck, "r1", sk, { flush: true });
        }
        for (const sk of ["top", "bot"]) {
          await simSeriesToCompletionInCur(cur, ck, "r2", sk, { flush: true });
        }
        await simSeriesToCompletionInCur(cur, ck, "r3", "confFinals", { flush: true });
      }

      // 3) Finals (only if matchup is wired)
      if (cur.finals?.highSeedTeam && cur.finals?.lowSeedTeam && !cur.finals?.complete) {
        await simSeriesToCompletionInCur(cur, "NBA", "finals", "FINALS", { flush: true });
      }

      persistPost(structuredClone(cur));
    } finally {
      setSimLock(false);
    }
  }

  function openBoxScore(gameId, homeName, awayName) {
    const r = getPlayoffResult(gameId);
    if (!r) return;
    setBoxModal({ gameId, homeName, awayName, result: r });
  }

  function startNewSeason() {
    // wipe season artifacts
    localStorage.removeItem(POSTSEASON_KEY);

    // ✅ keep playoffs results wipe (existing behavior)
    localStorage.removeItem(RESULT_KEY);

    // ✅ SURGICAL PATCH: also wipe regular-season V3 results (so seeding resets cleanly)
    clearAllResultsV3();

    localStorage.removeItem(SCHED_KEY);
    localStorage.removeItem(CHAMP_KEY);
    localStorage.removeItem(FINALS_MVP_KEY); // ✅ PATCH (Finals MVP)
    localStorage.removeItem(FINALS_MVP_SEEN_KEY);

    // bump year marker (if you use window.__seasonYear)
    try {
      window.__seasonYear = (seasonYear || new Date().getFullYear()) + 1;
    } catch {}

    hydratedPostseasonSeasonRef.current = null;

    setModal(null);
    setBoxModal(null);
    setChampModal(null);
    setPost(null);
    setResultsLive({});

    navigate("/calendar");
  }

  if (!leagueData) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex items-center justify-center">
        Loading playoffs...
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex items-center justify-center">
        Building bracket...
      </div>
    );
  }

  const left = post.layout.left;
  const right = post.layout.right;

  // =========================
  // ✅ PATCH HELPERS (gating + global sim buttons)
  // =========================
  const playInCompleteFor = (confKey, cur = post) => {
    const pi = cur?.conf?.[confKey]?.playIn;
    return !!pi?.g78?.played && !!pi?.g910?.played && !!pi?.gFinal?.played;
  };
  const allPlayInsComplete = playInCompleteFor(left) && playInCompleteFor(right);

  const seriesHasAnyResult = (series) => (series?.gameIds || []).some((gid) => !!getPlayoffResult(gid));

  const listAllSeriesRefs = (cur = post) => {
    const refs = [];
    const L = cur?.layout?.left;
    const R = cur?.layout?.right;

    const pushConf = (ck) => {
      if (!ck) return;
      refs.push({ confKey: ck, roundName: "r1", seriesKey: "s1v8" });
      refs.push({ confKey: ck, roundName: "r1", seriesKey: "s4v5" });
      refs.push({ confKey: ck, roundName: "r1", seriesKey: "s3v6" });
      refs.push({ confKey: ck, roundName: "r1", seriesKey: "s2v7" });

      refs.push({ confKey: ck, roundName: "r2", seriesKey: "top" });
      refs.push({ confKey: ck, roundName: "r2", seriesKey: "bot" });

      refs.push({ confKey: ck, roundName: "r3", seriesKey: "confFinals" });
    };

    pushConf(L);
    pushConf(R);
    refs.push({ confKey: "NBA", roundName: "finals", seriesKey: "FINALS" });
    return refs;
  };

  const seriesReadyForNextGame = (s) =>
    !!s &&
    !s.complete &&
    !!s.highSeedTeam &&
    !!s.lowSeedTeam &&
    (s.nextGameIndex ?? 0) < (s.gameIds?.length ?? 0);

  async function simPlayInGameInCur(cur, confKey, which) {
    const pi = cur.conf[confKey].playIn;
    const node = which === "78" ? pi.g78 : which === "910" ? pi.g910 : pi.gFinal;
    if (node.played) return;
    if (!node.home || !node.away) return;

    const slim = await safeSimGameId(node.id, node.home, node.away, { retries: 1 });
    if (!slim) return;

    const side = winnerFromSlim(slim);
    if (!side) return;

    const winner = side === "home" ? node.home : node.away;
    const loser = side === "home" ? node.away : node.home;

    node.played = true;
    node.winner = winner;
    node.loser = loser;

    if (which === "78") {
      pi.seed7 = winner;
      if (pi.g910.played) {
        pi.gFinal.home = loser;
        pi.gFinal.away = pi.g910.winner;
      }
    } else if (which === "910") {
      if (pi.g78.played) {
        pi.gFinal.home = pi.g78.loser;
        pi.gFinal.away = winner;
      }
    } else {
      pi.seed8 = winner;
      cur.conf[confKey].rounds.r1.s1v8.lowSeedTeam = pi.seed8;
      cur.conf[confKey].rounds.r1.s2v7.lowSeedTeam = pi.seed7;
    }

    wireForward(cur, confKey);
  }

  async function simAllPlayInsBothConferences() {
    if (simLock) return;
    setSimLock(true);

    try {
      const cur = structuredClone(post);

      for (const ck of [left, right]) {
        if (!ck) continue;

        try {
          const pi = cur.conf[ck].playIn;

          if (!pi.g78.played) {
            await simPlayInGameInCur(cur, ck, "78");
            persistPost(cur);
          }
          if (!pi.g910.played) {
            await simPlayInGameInCur(cur, ck, "910");
            persistPost(cur);
          }
          if (!pi.gFinal.played) {
            await simPlayInGameInCur(cur, ck, "final");
            persistPost(cur);
          }
        } catch (e) {
          console.warn(`[playoffs] play-in sim failed for conf=${ck}, continuing`, e);
        }
      }
    } finally {
      setSimLock(false);
    }
  }

  async function simNextGameInCur(cur, confKey, roundName, seriesKey) {
    const series = getSeriesNode(cur, confKey, roundName, seriesKey);
    if (!seriesReadyForNextGame(series)) return;

    const idx = series.nextGameIndex;
    const gid = series.gameIds[idx];
    const { home, away } = seriesGameMeta(series, idx);

    const slim = await safeSimGameId(gid, home, away, { retries: 2 });
    const side = winnerFromSlim(slim);

    if (!side) {
      console.warn("[playoffs] No winner (tie/bad result). Not advancing game index.", gid, slim);
      return;
    }

    if (side === "home") {
      if (home === series.highSeedTeam) series.winsHigh++;
      else series.winsLow++;
    } else if (side === "away") {
      if (away === series.highSeedTeam) series.winsHigh++;
      else series.winsLow++;
    }

    series.nextGameIndex++;
    if (series.winsHigh >= 4 || series.winsLow >= 4) series.complete = true;

    if (roundName !== "finals") wireForward(cur, confKey);
  }

  async function simSeriesToCompletionInCur(
    cur,
    confKey,
    roundName,
    seriesKey,
    { flush = false } = {}
  ) {
    const series = getSeriesNode(cur, confKey, roundName, seriesKey);
    if (!series || !series.highSeedTeam || !series.lowSeedTeam) return false;

    let didAdvance = false;

    while (!series.complete) {
      // ✅ PATCH: stop button support (stop after current game finishes)
      if (stopRequestedRef.current) break;

      const idx = series.nextGameIndex;
      if (idx >= series.gameIds.length) break;

      const gid = series.gameIds[idx];
      const { home, away } = seriesGameMeta(series, idx);

      const slim = await safeSimGameId(gid, home, away, { retries: 2 });
      const side = winnerFromSlim(slim);

      if (!side) {
        console.warn(
          "[playoffs] No winner (tie/bad result). Stopping series sim to avoid burning games.",
          gid,
          slim
        );
        break;
      }

      if (side === "home") {
        if (home === series.highSeedTeam) series.winsHigh++;
        else series.winsLow++;
      } else if (side === "away") {
        if (away === series.highSeedTeam) series.winsHigh++;
        else series.winsLow++;
      }

      series.nextGameIndex++;
      didAdvance = true;

      if (series.winsHigh >= 4 || series.winsLow >= 4) {
        series.complete = true;
        if (roundName !== "finals") wireForward(cur, confKey);
        if (flush) persistPost(structuredClone(cur));
        break;
      }

      if (roundName !== "finals") wireForward(cur, confKey);

      // ✅ live update the UI during long sims
      if (flush) persistPost(structuredClone(cur));

      await new Promise((r) => setTimeout(r, 0));
    }

    if (roundName !== "finals") wireForward(cur, confKey);
    return didAdvance;
  }

  const findActiveRound = (cur) => {
    const L = cur?.layout?.left;
    const R = cur?.layout?.right;

    const anyIn = (ck, roundName, keys) =>
      keys.some((k) => {
        const s = getSeriesNode(cur, ck, roundName, k);
        return s && !s.complete && s.highSeedTeam && s.lowSeedTeam;
      });

    const anyFinals = () => {
      const s = cur?.finals;
      return s && !s.complete && s.highSeedTeam && s.lowSeedTeam;
    };

    // after play-in complete, playoffs progress in order
    if (anyIn(L, "r1", ["s1v8", "s4v5", "s3v6", "s2v7"]) || anyIn(R, "r1", ["s1v8", "s4v5", "s3v6", "s2v7"])) return "r1";
    if (anyIn(L, "r2", ["top", "bot"]) || anyIn(R, "r2", ["top", "bot"])) return "r2";
    if (anyIn(L, "r3", ["confFinals"]) || anyIn(R, "r3", ["confFinals"])) return "r3";
    if (anyFinals()) return "finals";

    return null;
  };

  // ✅ PATCH: round button should advance: Play-In -> R1 -> R2 -> R3 -> Finals
  const findNextStage = (cur) => {
    const L = cur?.layout?.left;
    const R = cur?.layout?.right;

    const piIncomplete = (ck) => {
      const pi = cur?.conf?.[ck]?.playIn;
      if (!pi) return false;
      return !pi.g78?.played || !pi.g910?.played || !pi.gFinal?.played;
    };

    if (piIncomplete(L) || piIncomplete(R)) return "playin";

    return findActiveRound(cur); // r1/r2/r3/finals/null
  };

  async function simGlobalOneGameAllSeries() {
    if (simLock) return;
    if (!allPlayInsComplete) return;
    setSimLock(true);

    try {
      const cur = structuredClone(post);

      // ✅ snapshot eligible series at click time
      const eligible = listAllSeriesRefs(cur).filter((ref) =>
        seriesReadyForNextGame(getSeriesNode(cur, ref.confKey, ref.roundName, ref.seriesKey))
      );

      for (const ref of eligible) {
        await simNextGameInCur(cur, ref.confKey, ref.roundName, ref.seriesKey);
        await new Promise((r) => setTimeout(r, 0));
      }

      persistPost(cur);
    } finally {
      setSimLock(false);
    }
  }

  async function simGlobalCurrentRound() {
    if (simLock) return;
    if (!allPlayInsComplete) return;
    setSimLock(true);

    try {
      const cur = structuredClone(post);
      const round = findActiveRound(cur);
      if (!round) {
        persistPost(cur);
        return;
      }

      const confs = [cur.layout.left, cur.layout.right];

      if (round === "r1") {
        for (const ck of confs) {
          for (const sk of ["s1v8", "s4v5", "s3v6", "s2v7"]) {
            const s = getSeriesNode(cur, ck, "r1", sk);
            if (seriesReadyForNextGame(s)) await simSeriesToCompletionInCur(cur, ck, "r1", sk);
          }
        }
      } else if (round === "r2") {
        for (const ck of confs) {
          for (const sk of ["top", "bot"]) {
            const s = getSeriesNode(cur, ck, "r2", sk);
            if (seriesReadyForNextGame(s)) await simSeriesToCompletionInCur(cur, ck, "r2", sk);
          }
        }
      } else if (round === "r3") {
        for (const ck of confs) {
          const s = getSeriesNode(cur, ck, "r3", "confFinals");
          if (seriesReadyForNextGame(s)) await simSeriesToCompletionInCur(cur, ck, "r3", "confFinals");
        }
      } else if (round === "finals") {
        const s = cur.finals;
        if (seriesReadyForNextGame(s)) await simSeriesToCompletionInCur(cur, "NBA", "finals", "FINALS");
      }

      persistPost(cur);
    } finally {
      setSimLock(false);
    }
  }

  // ✅ PATCH: TOP "Simulate Round" (Play-In on first click, then next round each click)
  async function simTopNextRound() {
    if (simLock) return;
    if (post?.finals?.complete) return;

    setSimLock(true);
    stopRequestedRef.current = false;
    setSimStopping(false);

    try {
      const cur = structuredClone(post);
      const stage = findNextStage(cur);
      const confs = [cur.layout.left, cur.layout.right];

      if (!stage) {
        persistPost(cur);
        return;
      }

      if (stage === "playin") {
        for (const ck of confs) {
          if (stopRequestedRef.current) break;
          const pi = cur?.conf?.[ck]?.playIn;
          if (!pi) continue;

          if (!pi.g78.played && !stopRequestedRef.current) {
            await simPlayInGameInCur(cur, ck, "78");
            persistPost(structuredClone(cur));
          }
          if (!pi.g910.played && !stopRequestedRef.current) {
            await simPlayInGameInCur(cur, ck, "910");
            persistPost(structuredClone(cur));
          }
          if (!pi.gFinal.played && !stopRequestedRef.current) {
            await simPlayInGameInCur(cur, ck, "final");
            persistPost(structuredClone(cur));
          }
        }
        persistPost(structuredClone(cur));
        return;
      }

      if (stage === "r1") {
        for (const ck of confs) {
          for (const sk of ["s1v8", "s4v5", "s3v6", "s2v7"]) {
            if (stopRequestedRef.current) break;
            const s = getSeriesNode(cur, ck, "r1", sk);
            if (seriesReadyForNextGame(s)) {
              await simSeriesToCompletionInCur(cur, ck, "r1", sk, { flush: true });
            }
          }
        }
      } else if (stage === "r2") {
        for (const ck of confs) {
          for (const sk of ["top", "bot"]) {
            if (stopRequestedRef.current) break;
            const s = getSeriesNode(cur, ck, "r2", sk);
            if (seriesReadyForNextGame(s)) {
              await simSeriesToCompletionInCur(cur, ck, "r2", sk, { flush: true });
            }
          }
        }
      } else if (stage === "r3") {
        for (const ck of confs) {
          if (stopRequestedRef.current) break;
          const s = getSeriesNode(cur, ck, "r3", "confFinals");
          if (seriesReadyForNextGame(s)) {
            await simSeriesToCompletionInCur(cur, ck, "r3", "confFinals", { flush: true });
          }
        }
      } else if (stage === "finals") {
        const s = cur.finals;
        if (seriesReadyForNextGame(s) && !stopRequestedRef.current) {
          await simSeriesToCompletionInCur(cur, "NBA", "finals", "FINALS", { flush: true });
        }
      }

      persistPost(structuredClone(cur));
    } finally {
      setSimLock(false);
      stopRequestedRef.current = false;
      setSimStopping(false);
    }
  }

  // ✅ PATCH: TOP "Simulate Playoffs" (to champion, includes play-in if needed)
  async function simTopPlayoffsToChampion() {
    if (simLock) return;
    if (post?.finals?.complete) return;

    setSimLock(true);
    stopRequestedRef.current = false;
    setSimStopping(false);

    try {
      setModal(null);

      const cur = structuredClone(post);
      const confs = [cur.layout.left, cur.layout.right];

      let safety = 0;
      const MAX_LOOPS = 80;

      while (!cur.finals?.complete && safety < MAX_LOOPS && !stopRequestedRef.current) {
        safety++;

        const stage = findNextStage(cur);

        // 1) if play-in not complete, do play-in first
        if (stage === "playin") {
          for (const ck of confs) {
            if (stopRequestedRef.current) break;
            const pi = cur?.conf?.[ck]?.playIn;
            if (!pi) continue;

            if (!pi.g78.played && !stopRequestedRef.current) {
              await simPlayInGameInCur(cur, ck, "78");
              persistPost(structuredClone(cur));
            }
            if (!pi.g910.played && !stopRequestedRef.current) {
              await simPlayInGameInCur(cur, ck, "910");
              persistPost(structuredClone(cur));
            }
            if (!pi.gFinal.played && !stopRequestedRef.current) {
              await simPlayInGameInCur(cur, ck, "final");
              persistPost(structuredClone(cur));
            }
          }
          persistPost(structuredClone(cur));
          continue;
        }

        // 2) otherwise do the current active round
        const round = stage; // r1/r2/r3/finals/null
        if (!round) break;

        let progressed = false;

        if (round === "r1") {
          for (const ck of confs) {
            for (const sk of ["s1v8", "s4v5", "s3v6", "s2v7"]) {
              if (stopRequestedRef.current) break;
              const s = getSeriesNode(cur, ck, "r1", sk);
              if (seriesReadyForNextGame(s)) {
                const did = await simSeriesToCompletionInCur(cur, ck, "r1", sk, { flush: true });
                progressed = progressed || did;
              }
            }
          }
        } else if (round === "r2") {
          for (const ck of confs) {
            for (const sk of ["top", "bot"]) {
              if (stopRequestedRef.current) break;
              const s = getSeriesNode(cur, ck, "r2", sk);
              if (seriesReadyForNextGame(s)) {
                const did = await simSeriesToCompletionInCur(cur, ck, "r2", sk, { flush: true });
                progressed = progressed || did;
              }
            }
          }
        } else if (round === "r3") {
          for (const ck of confs) {
            if (stopRequestedRef.current) break;
            const s = getSeriesNode(cur, ck, "r3", "confFinals");
            if (seriesReadyForNextGame(s)) {
              const did = await simSeriesToCompletionInCur(cur, ck, "r3", "confFinals", { flush: true });
              progressed = progressed || did;
            }
          }
        } else if (round === "finals") {
          const s = cur.finals;
          if (seriesReadyForNextGame(s) && !stopRequestedRef.current) {
            const did = await simSeriesToCompletionInCur(cur, "NBA", "finals", "FINALS", { flush: true });
            progressed = progressed || did;
          }
        }

        if (!progressed) {
          console.warn("[playoffs] Global sim made no progress; stopping to avoid infinite loop.");
          break;
        }

        await new Promise((r) => setTimeout(r, 0));
      }

      persistPost(structuredClone(cur));
    } finally {
      setSimLock(false);
      stopRequestedRef.current = false;
      setSimStopping(false);
    }
  }

  // ✅ DEV PATCH: true instant playoff sim path.
  // Dev-only shortcut: bypasses the worker game sim and writes synthetic playoff results.
  async function simDevInstantPlayoffsToChampion() {
    if (simLock) return;
    if (post?.finals?.complete) return;

    setSimLock(true);
    stopRequestedRef.current = false;
    setSimStopping(false);

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    const playerNameOf = (player) => player?.name || player?.player || "Unknown";

    const playerOvrOf = (player) => {
      const n = Number(
        player?.ovr ??
          player?.overall ??
          player?.rating ??
          player?.overallRating ??
          72
      );
      return Number.isFinite(n) ? n : 72;
    };

    const getTeamRoster = (teamName) => {
      const roster = (teamsByName?.[teamName]?.players || [])
        .filter((player) => player && playerNameOf(player))
        .map((player) => ({ ...player }))
        .sort((a, b) => playerOvrOf(b) - playerOvrOf(a));

      if (roster.length) return roster;

      return [
        { name: `${teamName || "Team"} Player 1`, ovr: 78 },
        { name: `${teamName || "Team"} Player 2`, ovr: 76 },
        { name: `${teamName || "Team"} Player 3`, ovr: 74 },
        { name: `${teamName || "Team"} Player 4`, ovr: 72 },
        { name: `${teamName || "Team"} Player 5`, ovr: 70 },
      ];
    };

    const getTeamPower = (teamName) => {
      const roster = getTeamRoster(teamName).slice(0, 9);
      const weights = [1.35, 1.18, 1.05, 0.93, 0.82, 0.62, 0.52, 0.43, 0.35];

      let weighted = 0;
      let totalWeight = 0;

      for (let i = 0; i < roster.length; i++) {
        const weight = weights[i] || 0.3;
        weighted += playerOvrOf(roster[i]) * weight;
        totalWeight += weight;
      }

      return totalWeight > 0 ? weighted / totalWeight : 72;
    };

    const pickDevWinnerSide = (homeName, awayName) => {
      const homePower = getTeamPower(homeName) + 2.5;
      const awayPower = getTeamPower(awayName);
      const homeWinChance = clamp(0.5 + (homePower - awayPower) / 34, 0.18, 0.82);

      return Math.random() < homeWinChance ? "home" : "away";
    };

    const buildDevBox = (teamName, teamPoints, wonGame) => {
      const roster = getTeamRoster(teamName).slice(0, 9);
      const usageWeights = roster.map((player, index) => {
        const ovrBoost = Math.max(1, playerOvrOf(player) - 58);
        const roleBoost = index === 0 ? 1.55 : index === 1 ? 1.28 : index < 5 ? 1.0 : 0.56;
        return ovrBoost * roleBoost;
      });

      const totalUsage = usageWeights.reduce((sum, value) => sum + value, 0) || 1;
      let assignedPoints = 0;

      return roster.map((player, index) => {
        const isLast = index === roster.length - 1;
        const rawShare = usageWeights[index] / totalUsage;
        const jitter = 0.86 + Math.random() * 0.28;

        let pts = isLast
          ? Math.max(0, teamPoints - assignedPoints)
          : Math.max(0, Math.round(teamPoints * rawShare * jitter));

        if (index === 0 && wonGame) pts += Math.round(2 + Math.random() * 5);
        if (!isLast && assignedPoints + pts > teamPoints) pts = Math.max(0, teamPoints - assignedPoints);

        assignedPoints += pts;

        const minutes =
          index < 5
            ? Math.round(30 + Math.random() * 9)
            : Math.round(10 + Math.random() * 16);

        const fga = Math.max(1, Math.round(pts / (1.25 + Math.random() * 0.35)));
        const fgm = clamp(Math.round(fga * (0.41 + Math.random() * 0.15)), 0, fga);
        const tpa = Math.max(0, Math.round((index < 5 ? 2 : 0) + Math.random() * (index < 4 ? 6 : 4)));
        const tpm = clamp(Math.round(tpa * (0.28 + Math.random() * 0.18)), 0, tpa);
        const ftm = Math.max(0, Math.round(Math.random() * (index < 3 ? 6 : 3)));
        const fta = ftm + Math.round(Math.random() * 2);

        return {
          player: playerNameOf(player),
          min: minutes,
          pts,
          reb: Math.round(Math.random() * (index < 5 ? 9 : 5)),
          ast: Math.round(Math.random() * (index < 3 ? 9 : 4)),
          stl: Math.round(Math.random() * 3),
          blk: Math.round(Math.random() * (index < 5 ? 3 : 1)),
          fg: `${fgm}-${fga}`,
          "3p": `${tpm}-${tpa}`,
          ft: `${ftm}-${fta}`,
          to: Math.round(Math.random() * 4),
          pf: Math.round(Math.random() * 4),
        };
      });
    };

    const buildDevSlimResult = (homeName, awayName, forcedSide = null) => {
      const side = forcedSide || pickDevWinnerSide(homeName, awayName);
      const homePower = getTeamPower(homeName);
      const awayPower = getTeamPower(awayName);
      const baseScore = Math.round(102 + Math.random() * 23);
      const powerBump = Math.round(Math.max(homePower, awayPower) * 0.09);
      const winnerScore = baseScore + powerBump;
      const loserScore = Math.max(82, winnerScore - Math.round(3 + Math.random() * 16));

      const homeScore = side === "home" ? winnerScore : loserScore;
      const awayScore = side === "away" ? winnerScore : loserScore;

      return {
        winner: {
          score: `${homeScore}-${awayScore}`,
          home: homeScore,
          away: awayScore,
          ot: 0,
          side,
        },
        totals: {
          home: homeScore,
          away: awayScore,
        },
        box: {
          home: buildDevBox(homeName, homeScore, side === "home"),
          away: buildDevBox(awayName, awayScore, side === "away"),
        },
      };
    };

    const saveDevGameResult = (gameId, homeName, awayName) => {
      const cached = resultsRef.current?.[gameId] || loadPlayoffResults()?.[gameId];
      if (cached && !isBadSlimResult(cached)) return cached;

      const slim = buildDevSlimResult(homeName, awayName);

      resultsRef.current = {
        ...(resultsRef.current || {}),
        [gameId]: slim,
      };

      return slim;
    };

    const applyDevPlayInGame = (cur, confKey, which) => {
      const pi = cur.conf[confKey].playIn;
      const node = which === "78" ? pi.g78 : which === "910" ? pi.g910 : pi.gFinal;
      if (node.played) return false;
      if (!node.home || !node.away) return false;

      const slim = saveDevGameResult(node.id, node.home, node.away);
      const side = winnerFromSlim(slim);
      if (!side) return false;

      const winner = side === "home" ? node.home : node.away;
      const loser = side === "home" ? node.away : node.home;

      node.played = true;
      node.winner = winner;
      node.loser = loser;

      if (which === "78") {
        pi.seed7 = winner;
        if (pi.g910.played) {
          pi.gFinal.home = loser;
          pi.gFinal.away = pi.g910.winner;
        }
      } else if (which === "910") {
        if (pi.g78.played) {
          pi.gFinal.home = pi.g78.loser;
          pi.gFinal.away = winner;
        }
      } else {
        pi.seed8 = winner;
        cur.conf[confKey].rounds.r1.s1v8.lowSeedTeam = pi.seed8;
        cur.conf[confKey].rounds.r1.s2v7.lowSeedTeam = pi.seed7;
      }

      wireForward(cur, confKey);
      return true;
    };

    const applyDevSeriesGame = (cur, confKey, roundName, seriesKey) => {
      const series = getSeriesNode(cur, confKey, roundName, seriesKey);
      if (!seriesReadyForNextGame(series)) return false;

      const idx = series.nextGameIndex;
      const gid = series.gameIds[idx];
      const { home, away } = seriesGameMeta(series, idx);

      const slim = saveDevGameResult(gid, home, away);
      const side = winnerFromSlim(slim);
      if (!side) return false;

      if (side === "home") {
        if (home === series.highSeedTeam) series.winsHigh++;
        else series.winsLow++;
      } else if (side === "away") {
        if (away === series.highSeedTeam) series.winsHigh++;
        else series.winsLow++;
      }

      series.nextGameIndex++;

      if (series.winsHigh >= 4 || series.winsLow >= 4) {
        series.complete = true;
      }

      if (roundName !== "finals") wireForward(cur, confKey);
      return true;
    };

    const devSeriesToCompletion = (cur, confKey, roundName, seriesKey) => {
      const series = getSeriesNode(cur, confKey, roundName, seriesKey);
      if (!series || !series.highSeedTeam || !series.lowSeedTeam) return false;

      let didAdvance = false;

      while (!series.complete && !stopRequestedRef.current) {
        const advanced = applyDevSeriesGame(cur, confKey, roundName, seriesKey);
        if (!advanced) break;
        didAdvance = true;
      }

      if (roundName !== "finals") wireForward(cur, confKey);
      return didAdvance;
    };

    try {
      setModal(null);

      const cur = structuredClone(post);
      const confs = [cur.layout.left, cur.layout.right];

      let safety = 0;
      const MAX_LOOPS = 80;

      while (!cur.finals?.complete && safety < MAX_LOOPS && !stopRequestedRef.current) {
        safety += 1;

        const stage = findNextStage(cur);
        if (!stage) break;

        let progressed = false;

        if (stage === "playin") {
          for (const ck of confs) {
            if (stopRequestedRef.current) break;

            const pi = cur?.conf?.[ck]?.playIn;
            if (!pi) continue;

            if (!pi.g78.played && !stopRequestedRef.current) {
              progressed = applyDevPlayInGame(cur, ck, "78") || progressed;
            }

            if (!pi.g910.played && !stopRequestedRef.current) {
              progressed = applyDevPlayInGame(cur, ck, "910") || progressed;
            }

            if (!pi.gFinal.played && !stopRequestedRef.current) {
              progressed = applyDevPlayInGame(cur, ck, "final") || progressed;
            }
          }

          if (!progressed) {
            console.warn("[playoffs] Dev instant sim made no play-in progress; stopping.");
            break;
          }

          continue;
        }

        if (stage === "r1") {
          for (const ck of confs) {
            for (const sk of ["s1v8", "s4v5", "s3v6", "s2v7"]) {
              if (stopRequestedRef.current) break;
              progressed = devSeriesToCompletion(cur, ck, "r1", sk) || progressed;
            }
          }
        } else if (stage === "r2") {
          for (const ck of confs) {
            for (const sk of ["top", "bot"]) {
              if (stopRequestedRef.current) break;
              progressed = devSeriesToCompletion(cur, ck, "r2", sk) || progressed;
            }
          }
        } else if (stage === "r3") {
          for (const ck of confs) {
            if (stopRequestedRef.current) break;
            progressed = devSeriesToCompletion(cur, ck, "r3", "confFinals") || progressed;
          }
        } else if (stage === "finals") {
          progressed = devSeriesToCompletion(cur, "NBA", "finals", "FINALS") || progressed;
        }

        if (!progressed) {
          console.warn("[playoffs] Dev instant sim made no progress; stopping to avoid infinite loop.");
          break;
        }
      }

      const finalResults = resultsRef.current || {};
      setResultsLive(finalResults);
      scheduleSaveResults(finalResults);
      persistPost(structuredClone(cur));
    } finally {
      setSimLock(false);
      stopRequestedRef.current = false;
      setSimStopping(false);
    }
  }

  function openBoxScoreLine(gameId, homeName, awayName) {
    const r = getPlayoffResult(gameId);
    if (!r) return null;

    const hs = Number(r?.winner?.home ?? r?.totals?.home ?? 0);
    const as = Number(r?.winner?.away ?? r?.totals?.away ?? 0);

    const homeWon = hs > as;
    const awayWon = as > hs;

    return (
      <div className="flex items-center gap-2">
        <Logo src={teamLogo[awayName]} size={26} title={awayName} />
        <span className={`text-sm ${awayWon ? "font-extrabold text-white" : "text-neutral-300"}`}>
          {as || 0}
        </span>
        <span className="text-neutral-600 text-sm">-</span>
        <span className={`text-sm ${homeWon ? "font-extrabold text-white" : "text-neutral-300"}`}>
          {hs || 0}
        </span>
        <Logo src={teamLogo[homeName]} size={26} title={homeName} />
        {r?.winner?.ot ? <span className="text-xs text-neutral-400 ml-1">(OT)</span> : null}
      </div>
    );
  }

  // ================== 2K STYLE BRACKET UI ==================
  const WinsPill = ({ n }) => (
    <div
      className="bg-neutral-900/60 border border-neutral-600 rounded-md flex items-center justify-center font-extrabold text-neutral-100"
      style={{ width: WIN_SZ, height: WIN_SZ, fontSize: 12 }}
      title="Series wins"
    >
      {n ?? 0}
    </div>
  );

  const SeriesBox = ({
    topSeed,
    botSeed,
    topLogo,
    botLogo,
    topWins = 0,
    botWins = 0,
    onClick,
    disabled,
    mirror = false,
  }) => {
    const rowClass = `flex items-center justify-between ${mirror ? "flex-row-reverse" : ""}`;

    return (
      <button
        type="button"
        aria-disabled={disabled}
        tabIndex={0} // keep it focusable
        onClick={(e) => {
          // ✅ ALWAYS allow opening the modal (even while sim is running)
          onClick?.(e);
        }}
        className={`
bg-neutral-800/90 border border-white/30 rounded-lg
hover:bg-neutral-700
hover:border-orange-500
hover:shadow-[0_0_18px_rgba(249,115,22,0.55)]
transition-all duration-150
${disabled ? "opacity-60" : ""}
      `}
        style={{
          width: BOX_W,
          height: BOX_H,
          padding: BOX_PAD,
          cursor: "pointer",
        }}
      >
        <div className="flex flex-col" style={{ gap: ROW_GAP }}>
          <div className={rowClass}>
            <div className="flex items-center" style={{ gap: 10 }}>
              <div
                className="rounded-md bg-neutral-800 border border-neutral-600 flex items-center justify-center font-extrabold text-neutral-100"
                style={{ width: SEED_SZ, height: SEED_SZ, fontSize: 11 }}
              >
                {topSeed ?? ""}
              </div>
              <Logo src={topLogo} size={LOGO_SZ} title="" />
            </div>
            <WinsPill n={topWins} />
          </div>

          <div className={rowClass}>
            <div className="flex items-center" style={{ gap: 10 }}>
              <div
                className="rounded-md bg-neutral-800 border border-neutral-600 flex items-center justify-center font-extrabold text-neutral-100"
                style={{ width: SEED_SZ, height: SEED_SZ, fontSize: 11 }}
              >
                {botSeed ?? ""}
              </div>
              <Logo src={botLogo} size={LOGO_SZ} title="" />
            </div>
            <WinsPill n={botWins} />
          </div>
        </div>
      </button>
    );
  };

  const PlayInBox = ({ confKey, which, node, mirror = false }) => {
    if (!node) return null;

    const topTeam = node.home || null;
    const botTeam = node.away || null;

    const disabled = !topTeam || !botTeam;

    // Show 1/0 like the series wins pill (winner gets 1)
    let topWins = 0;
    let botWins = 0;
    if (node.played && node.winner) {
      topWins = node.winner === topTeam ? 1 : 0;
      botWins = node.winner === botTeam ? 1 : 0;
    }

    return (
      <SeriesBox
        topSeed={seedNumOf(confKey, topTeam)}
        botSeed={seedNumOf(confKey, botTeam)}
        topLogo={teamLogo[topTeam]}
        botLogo={teamLogo[botTeam]}
        topWins={topWins}
        botWins={botWins}
        mirror={mirror}
        disabled={disabled}
        onClick={() => setModal({ type: "playin", confKey, which })}
      />
    );
  };

  // Draws the little bracket “┐┘” connectors between columns (2K vibe)
  const Connector = ({ x, y1, y2, dir = "right" }) => {
    // dir: "right" (West) or "left" (East)
    const width = 22;
    const lineStyle = "bg-sky-500/60"; // 2K blue-ish
    const thickness = 2;

    // horizontal segment from series box to vertical spine
    const hx = dir === "right" ? x : x - width;
    return (
      <>
        {/* top horizontal */}
        <div
          className={lineStyle}
          style={{
            position: "absolute",
            left: hx,
            top: y1,
            width: width,
            height: thickness,
            borderRadius: 2,
          }}
        />
        {/* bottom horizontal */}
        <div
          className={lineStyle}
          style={{
            position: "absolute",
            left: hx,
            top: y2,
            width: width,
            height: thickness,
            borderRadius: 2,
          }}
        />
        {/* vertical spine */}
        <div
          className={lineStyle}
          style={{
            position: "absolute",
            left: dir === "right" ? x + width : x - width,
            top: y1,
            width: thickness,
            height: y2 - y1 + thickness,
            borderRadius: 2,
          }}
        />
      </>
    );
  };

  const BracketSide2K = ({ confKey, mirror = false }) => {
    const conf = post?.conf?.[confKey];
    if (!conf?.rounds?.r1 || !conf?.playIn) {
      return <div className="text-neutral-400 text-sm">Bracket not ready for {confKey}.</div>;
    }

    const r1 = conf.rounds.r1;
    const pi = conf.playIn;

    const r1Keys = ["s1v8", "s4v5", "s3v6", "s2v7"];

    const COL_W = BOX_W; // <-- uses your knob
    const GAP = BRACKET_GAP; // <-- tighten/loosen column spacing
    const STEP = COL_W + GAP;
    const SIDE_W = STEP * 2 + COL_W;

    // Columns
    const X1 = mirror ? STEP * 2 : 0;
    const X2 = STEP * 1;
    const X3 = mirror ? 0 : STEP * 2;

    const y0 = 18;
    const pairGap = 24; // gap between two matchups in the same half
    const blockGap = 60; // gap between top half and bottom half

    const Y_R1 = [
      y0,
      y0 + BOX_H + pairGap,
      y0 + (BOX_H + pairGap) * 2 + blockGap,
      y0 + (BOX_H + pairGap) * 3 + blockGap,
    ];

    const Y_R2 = [Math.round((Y_R1[0] + Y_R1[1]) / 2), Math.round((Y_R1[2] + Y_R1[3]) / 2)];
    const Y_R3 = [Math.round((Y_R2[0] + Y_R2[1]) / 2)];

    const boxMidY = (y) => y + BOX_H / 2;
    const dir = mirror ? "left" : "right";

    // ===== PLAY-IN (same exact sizing as SeriesBox) =====
    const PLAYIN_TOP = Y_R1[3] + BOX_H + 38;

    const PI_STEP = BOX_W + BRACKET_GAP;
    const PI_WRAP_W = BOX_W * 2 + BRACKET_GAP;
    const PI_Y = [0, BOX_H + pairGap];
    const PI_YF = Math.round((PI_Y[0] + PI_Y[1]) / 2);
    const PI_WRAP_H = PI_Y[1] + BOX_H;

    const PI_X1 = mirror ? PI_STEP : 0;
    const PI_X2 = mirror ? 0 : PI_STEP;

    const SIDE_H = PLAYIN_TOP + PI_WRAP_H + 40;

    return (
      <div className="relative" style={{ width: SIDE_W, height: SIDE_H }}>
        {/* ROUND 1 */}
        {r1Keys.map((k, idx) => {
          const s = r1[k];
          const top = s.highSeedTeam;
          const bot = s.lowSeedTeam;
          return (
            <div key={k} style={{ position: "absolute", left: X1, top: Y_R1[idx] }}>
              <SeriesBox
                topSeed={s.highSeedNum}
                botSeed={s.lowSeedNum}
                topLogo={teamLogo[top]}
                botLogo={teamLogo[bot]}
                topWins={s.winsHigh ?? 0}
                botWins={s.winsLow ?? 0}
                mirror={mirror}
                onClick={() => setModal({ type: "series", confKey, roundName: "r1", seriesKey: k })}
                disabled={!top || !bot}
              />
            </div>
          );
        })}

        {/* Connect R1 -> R2 */}
        <Connector x={mirror ? X1 : X1 + COL_W} y1={boxMidY(Y_R1[0])} y2={boxMidY(Y_R1[1])} dir={dir} />
        <Connector x={mirror ? X1 : X1 + COL_W} y1={boxMidY(Y_R1[2])} y2={boxMidY(Y_R1[3])} dir={dir} />

        {/* ROUND 2 */}
        <div style={{ position: "absolute", left: X2, top: Y_R2[0] }}>
          <SeriesBox
            topSeed={conf.rounds.r2.top.highSeedNum}
            botSeed={conf.rounds.r2.top.lowSeedNum}
            topLogo={teamLogo[conf.rounds.r2.top.highSeedTeam]}
            botLogo={teamLogo[conf.rounds.r2.top.lowSeedTeam]}
            topWins={conf.rounds.r2.top.winsHigh ?? 0}
            botWins={conf.rounds.r2.top.winsLow ?? 0}
            mirror={mirror}
            onClick={() => setModal({ type: "series", confKey, roundName: "r2", seriesKey: "top" })}
            disabled={!conf.rounds.r2.top.highSeedTeam || !conf.rounds.r2.top.lowSeedTeam}
          />
        </div>

        <div style={{ position: "absolute", left: X2, top: Y_R2[1] }}>
          <SeriesBox
            topSeed={conf.rounds.r2.bot.highSeedNum}
            botSeed={conf.rounds.r2.bot.lowSeedNum}
            topLogo={teamLogo[conf.rounds.r2.bot.highSeedTeam]}
            botLogo={teamLogo[conf.rounds.r2.bot.lowSeedTeam]}
            topWins={conf.rounds.r2.bot.winsHigh ?? 0}
            botWins={conf.rounds.r2.bot.winsLow ?? 0}
            mirror={mirror}
            onClick={() => setModal({ type: "series", confKey, roundName: "r2", seriesKey: "bot" })}
            disabled={!conf.rounds.r2.bot.highSeedTeam || !conf.rounds.r2.bot.lowSeedTeam}
          />
        </div>

        {/* Connect R2 -> R3 */}
        <Connector x={mirror ? X2 : X2 + COL_W} y1={boxMidY(Y_R2[0])} y2={boxMidY(Y_R2[1])} dir={dir} />

        {/* CONF FINALS */}
        <div style={{ position: "absolute", left: X3, top: Y_R3[0] }}>
          <SeriesBox
            topSeed={conf.rounds.r3.confFinals.highSeedNum}
            botSeed={conf.rounds.r3.confFinals.lowSeedNum}
            topLogo={teamLogo[conf.rounds.r3.confFinals.highSeedTeam]}
            botLogo={teamLogo[conf.rounds.r3.confFinals.lowSeedTeam]}
            topWins={conf.rounds.r3.confFinals.winsHigh ?? 0}
            botWins={conf.rounds.r3.confFinals.winsLow ?? 0}
            mirror={mirror}
            onClick={() => setModal({ type: "series", confKey, roundName: "r3", seriesKey: "confFinals" })}
            disabled={!conf.rounds.r3.confFinals.highSeedTeam || !conf.rounds.r3.confFinals.lowSeedTeam}
          />
        </div>

        {/* PLAY-IN */}
        <div style={{ position: "absolute", left: 0, right: 0, top: PLAYIN_TOP }}>
          <div className="text-[11px] text-neutral-400 mb-2">PLAY-IN</div>

          <div className="flex justify-center">
            <div className="relative" style={{ width: PI_WRAP_W, height: PI_WRAP_H }}>
              <div style={{ position: "absolute", left: PI_X1, top: PI_Y[0] }}>
                <PlayInBox confKey={confKey} which="78" node={pi.g78} mirror={mirror} />
              </div>

              <div style={{ position: "absolute", left: PI_X1, top: PI_Y[1] }}>
                <PlayInBox confKey={confKey} which="910" node={pi.g910} mirror={mirror} />
              </div>

              <Connector
                x={mirror ? PI_X1 : PI_X1 + BOX_W}
                y1={boxMidY(PI_Y[0])}
                y2={boxMidY(PI_Y[1])}
                dir={dir}
              />

              <div style={{ position: "absolute", left: PI_X2, top: PI_YF }}>
                <PlayInBox confKey={confKey} which="final" node={pi.gFinal} mirror={mirror} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const simsDisabled = !!post?.finals?.complete;

  return (
    <div className={`fixed inset-0 overflow-hidden ${styles.wrapper}`}>
      <style>{`
  .noScrollbar::-webkit-scrollbar { display: none; }
  .noScrollbar { -ms-overflow-style: none; scrollbar-width: none; }
  @keyframes bmPlayoffFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes bmPlayoffPanelRise {
    from { opacity: 0; transform: translateY(18px) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .bmPlayoffFadeIn { animation: bmPlayoffFadeIn 170ms ease-out both; }
  .bmPlayoffPanelRise { animation: bmPlayoffPanelRise 220ms ease-out both; }
`}</style>

      {/* top bar */}
      <div className="absolute left-0 right-0 top-0 h-[72px] px-8 flex items-center justify-between z-20">
        <div className="flex gap-2">

          {/* ✅ PATCH: TOP BUTTONS ONLY (Simulate Round + Simulate Playoffs) */}
          <button
            disabled={simLock || simsDisabled}
            onClick={async () => {
              await simTopNextRound();
            }}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded text-sm font-bold disabled:opacity-50"
          >
            Simulate Round
          </button>

          <button
            disabled={simLock || fmvpLoading || (simsDisabled && !champModal?.team)}
            onClick={async () => {
              if (simsDisabled) {
                continueFromFinalsMvpModal();
                return;
              }

              await simTopPlayoffsToChampion();
            }}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded text-sm font-bold disabled:opacity-50"
          >
            {simsDisabled ? "Continue to Offseason" : "Simulate Playoffs"}
          </button>

          <button
            disabled={simLock || fmvpLoading || simsDisabled}
            onClick={async () => {
              await simDevInstantPlayoffsToChampion();
            }}
            className="px-4 py-2 bg-purple-700 hover:bg-purple-600 rounded text-sm font-bold disabled:opacity-50"
            title="Dev shortcut: simulates the rest of playoffs with one final bracket save"
          >
            Dev Instant Playoffs
          </button>

          {/* ✅ PATCH: STOP BUTTON */}
          <button
            disabled={!simLock}
            onClick={() => {
              stopRequestedRef.current = true;
              setSimStopping(true);
            }}
            className="px-4 py-2 bg-neutral-900/70 hover:bg-neutral-800 rounded text-sm border border-neutral-700 disabled:opacity-50"
            title="Stops after the current game finishes"
          >
            {simStopping ? "Stopping..." : "Stop"}
          </button>

          {finalsMvpSeen && champModal?.team && (
            <button
              disabled={fmvpLoading}
              onClick={openFinalsMvpModal}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded text-sm font-bold border border-orange-500/40 text-orange-200 transition-all duration-200 hover:-translate-y-1 disabled:opacity-50"
            >
              Finals MVP
            </button>
          )}
        </div>

        <div className="absolute left-1/2 -translate-x-1/2 text-[28px] font-extrabold tracking-wide text-white/90 select-none">
          PLAYOFFS
        </div>

        <button
  onClick={() =>
    navigate("/team-hub", {
      state: {
        playoffMode: true,
        playoffReturnTo: "/playoffs",
      },
    })
  }
  className="w-[220px] px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded text-sm font-bold"
>
  Back to Team Hub
</button>
      </div>

      {/* stage (scaled) */}
      <div className="absolute inset-x-0 top-[72px] bottom-0 px-6 pb-[520px] flex items-start justify-center overflow-x-hidden overflow-y-auto noScrollbar">
        <div
          className="relative"
          style={{
            width: `${BASE_W}px`,
            height: `${BASE_H}px`,
            transform: `scale(${uiScale})`,
            transformOrigin: "top center",
          }}
        >
          {/* bracket layout */}
          <div className="flex items-start justify-between w-full h-full pt-6">
            {/* WEST */}
            <div>
              <div className="text-white/80 font-extrabold text-xl mb-3 select-none">{left}</div>
              <BracketSide2K confKey={left} mirror={false} />
            </div>

            {/* FINALS */}
            <div className="flex flex-col items-center mt-[110px]" style={{ width: BOX_W }}>
              <div className="text-white/80 font-extrabold text-xl mb-3 select-none">FINALS</div>

              <SeriesBox
                topSeed={null}
                botSeed={null}
                topLogo={teamLogo[post.finals.highSeedTeam]}
                botLogo={teamLogo[post.finals.lowSeedTeam]}
                topWins={post.finals.winsHigh ?? 0}
                botWins={post.finals.winsLow ?? 0}
                mirror={false}
                onClick={() => setModal({ type: "series", roundName: "finals" })}
                disabled={!post.finals.highSeedTeam || !post.finals.lowSeedTeam}
              />

              <div className="text-xs text-neutral-400 mt-2 text-center"></div>
            </div>

            {/* EAST */}
            <div>
              <div className="text-white/80 font-extrabold text-xl mb-3 select-none text-right">{right}</div>
              <BracketSide2K confKey={right} mirror={true} />
            </div>
          </div>
        </div>
      </div>

      {/* Series / Play-In Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-neutral-900 border border-neutral-700 rounded p-5 w-[560px]">
            <div className="flex items-center justify-between mb-3">
              <div className="font-bold">{modal.type === "series" ? "Series" : "Play-In"}</div>
              <button className="px-2 py-1 bg-neutral-800 rounded" onClick={() => setModal(null)}>
                Close
              </button>
            </div>

            {/* ✅ PATCH: NO SIM BUTTONS IN MODAL (view-only) */}
            {modal.type === "playin" && (
              <div className="flex flex-col gap-2">
                <div className="text-xs text-neutral-400">
                  {(() => {
                    const pi = post?.conf?.[modal.confKey]?.playIn;
                    if (!pi) return null;

                    const node =
                      modal.which === "78" ? pi.g78 : modal.which === "910" ? pi.g910 : pi.gFinal;

                    const savedResult = getPlayoffResult(node?.id);
                    const played = !!node?.played && !!savedResult;
                    if (!node?.id) return null;

                    return (
                      <div className="mt-2 border border-neutral-800 rounded-lg overflow-hidden">
                        <div className="px-3 py-2 bg-neutral-800 text-xs text-neutral-300">This Game</div>
                        <button
                          disabled={!played}
                          onClick={() => openBoxScore(node.id, node.home, node.away)}
                          className={`w-full px-3 py-2 flex items-center justify-between border-t border-neutral-800 ${
                            played ? "hover:bg-neutral-800" : "opacity-40 cursor-not-allowed"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <Logo src={teamLogo[node.away]} size={26} title={node.away} />
                            <span className="text-neutral-600 text-xs">vs</span>
                            <Logo src={teamLogo[node.home]} size={26} title={node.home} />
                          </div>
                          <div className="text-xs text-neutral-300">
                            {played ? openBoxScoreLine(node.id, node.home, node.away) : "—"}
                          </div>
                        </button>
                      </div>
                    );
                  })()}
                  Tip: Use the top bar “Simulate Round” to advance (Play-In → R1 → R2 → R3 → Finals).
                </div>
              </div>
            )}

            {modal.type === "series" &&
              (() => {
                const roundName = modal.roundName || "r1";

                const s =
                  roundName === "finals"
                    ? post.finals
                    : post.conf?.[modal.confKey]?.rounds?.[roundName]?.[modal.seriesKey];

                if (!s) {
                  return <div className="text-sm text-neutral-400">Series not found.</div>;
                }

                const hasAny = seriesHasAnyResult(s);

                const gameList = (s.gameIds || []).map((gid, idx) => {
                  const { home, away } = seriesGameMeta(s, idx);
                  const r = getPlayoffResult(gid);
                  const played = !!r;
                  const hs = Number(r?.winner?.home ?? r?.totals?.home ?? 0);
                  const as = Number(r?.winner?.away ?? r?.totals?.away ?? 0);
                  return { gid, idx, home, away, played, hs, as, ot: !!r?.winner?.ot };
                });

                return (
                  <div className="flex flex-col gap-2">
                    <div className="mt-2 border border-neutral-800 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-neutral-800 text-xs text-neutral-300">Box Scores</div>
                      <div className="max-h-[240px] overflow-auto">
                        {gameList.map((g) => {
                          const homeWon = g.played && g.hs > g.as;
                          const awayWon = g.played && g.as > g.hs;

                          return (
                            <button
                              key={g.gid}
                              disabled={!g.played}
                              onClick={() => openBoxScore(g.gid, g.home, g.away)}
                              className={`w-full px-3 py-2 flex items-center justify-between border-t border-neutral-800 ${
                                g.played ? "hover:bg-neutral-800" : "opacity-40 cursor-not-allowed"
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-xs text-neutral-400 w-[60px]">Game {g.idx + 1}</span>
                                <Logo src={teamLogo[g.away]} size={26} title={g.away} />
                                <span className={`text-sm ${awayWon ? "font-extrabold text-white" : "text-neutral-300"}`}>
                                  {g.played ? g.as : "—"}
                                </span>
                                <span className="text-neutral-600 text-sm">-</span>
                                <span className={`text-sm ${homeWon ? "font-extrabold text-white" : "text-neutral-300"}`}>
                                  {g.played ? g.hs : "—"}
                                </span>
                                <Logo src={teamLogo[g.home]} size={26} title={g.home} />
                                {g.played && g.ot ? <span className="text-xs text-neutral-400 ml-1">(OT)</span> : null}
                              </div>
                              <div className="text-xs text-neutral-500">{g.played ? "Open" : ""}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="text-xs text-neutral-400">
                      Played games are clickable. Unplayed games are disabled.
                      {!hasAny ? " (No games played yet.)" : ""}
                    </div>
                  </div>
                );
              })()}
          </div>
        </div>
      )}

      {/* ✅ PATCH: CHAMPIONS MODAL is OUTSIDE the series/play-in modal */}
      {champModal && !finalsMvpSeen && !showFinalsMvpModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] bmPlayoffFadeIn">
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-6 w-[520px] text-center bmPlayoffPanelRise">
            <div className="text-2xl font-extrabold text-white mb-2">CHAMPIONS</div>

            <div className="flex justify-center my-4">
              <Logo src={teamLogo[champModal.team]} size={96} title={champModal.team} />
            </div>

            <div className="text-lg font-bold text-white mb-1">{champModal.team}</div>
            <div className="text-sm text-neutral-400 mb-5">
              wins the {champModal.seasonYear} title.
            </div>

            {/* Finals MVP reveal opens as an in-page modal instead of leaving Playoffs */}
            <button
              className="w-full px-4 py-3 bg-orange-600 hover:bg-orange-500 rounded font-bold disabled:opacity-50 transition-all duration-200 hover:-translate-y-1"
              disabled={fmvpLoading}
              onClick={openFinalsMvpModal}
            >
              {fmvpLoading ? "Computing Finals MVP..." : "Reveal Finals MVP"}
            </button>


          </div>
        </div>
      )}



      {/* Finals MVP Reveal Modal */}
      {showFinalsMvpModal && (
        <div className="fixed inset-0 z-[80] bg-black/30 flex items-center justify-center p-4 bmPlayoffFadeIn">
          <FinalsMvpReveal
            leagueData={leagueData}
            fmvpRaw={(() => {
              try {
                return JSON.parse(localStorage.getItem(FINALS_MVP_KEY) || "null");
              } catch {
                return null;
              }
            })()}
            onContinue={continueFromFinalsMvpModal}
            continueLabel="Continue to Offseason"
            onBack={closeFinalsMvpModal}
            backLabel="Back"
            mode="modal"
          />
        </div>
      )}

      {/* Box Score Modal */}
      {boxModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-[880px] max-h-[90vh] overflow-auto p-5">
            <div className="flex justify-between mb-4 items-center">
              <div className="flex items-center gap-3">
                <Logo src={teamLogo[boxModal.awayName]} size={34} title="Away" />
                <span className="text-neutral-500 text-sm">Away</span>
                <span className="text-neutral-600">•</span>
                <Logo src={teamLogo[boxModal.homeName]} size={34} title="Home" />
                <span className="text-neutral-500 text-sm">Home</span>
                <span className="text-neutral-600">•</span>
                <span className="text-sm font-bold">
                  {boxModal.result?.winner?.score}
                  {boxModal.result?.winner?.ot ? " (OT)" : ""}
                </span>
              </div>

              <button className="px-2 py-1 bg-neutral-700 rounded" onClick={() => setBoxModal(null)}>
                Close
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { side: "away", label: "Away", logoTeam: boxModal.awayName },
                { side: "home", label: "Home", logoTeam: boxModal.homeName },
              ].map(({ side, label, logoTeam }) => {
                const rows = boxModal.result?.box?.[side] || [];
                return (
                  <div key={side} className="bg-neutral-800 p-3 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <Logo src={teamLogo[logoTeam]} size={26} title={label} />
                      <h4 className="font-bold">{label}</h4>
                    </div>

                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-neutral-700">
                          <th className="py-1 text-left">Player</th>
                          <th className="py-1">MIN</th>
                          <th className="py-1">PTS</th>
                          <th className="py-1">REB</th>
                          <th className="py-1">AST</th>
                          <th className="py-1">STL</th>
                          <th className="py-1">BLK</th>
                          <th className="py-1">FG</th>
                          <th className="py-1">3P</th>
                          <th className="py-1">FT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} className="border-b border-neutral-700">
                            <td className="text-left">{r.player}</td>
                            <td className="text-center">{r.min}</td>
                            <td className="text-center">{r.pts}</td>
                            <td className="text-center">{r.reb}</td>
                            <td className="text-center">{r.ast}</td>
                            <td className="text-center">{r.stl}</td>
                            <td className="text-center">{r.blk}</td>
                            <td className="text-center">{r.fg}</td>
                            <td className="text-center">{r["3p"]}</td>
                            <td className="text-center">{r.ft}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
