import React, { useEffect, useMemo, useRef, useState } from "react";
import { ensureGameplansForLeague } from "../utils/ensureGameplans";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";
import {
  simulateOneGame,
  computeSeasonAwards,
  computeAllStars,
  repairCpuTeamsToMinRoster,
} from "@/api/simEnginePy";import { queueSim } from "@/api/simQueue";
import LZString from "lz-string";
import { createPortal } from "react-dom";
import AllStars from "./AllStars";
import {
  saveBoxScoreToDB,
  loadBoxScoreFromDB,
  deleteBoxScoreFromDB,
  clearBoxScoresFromDB,
} from "../utils/indexedDbStorage";

window.LZString = LZString;





/* -------------------------------------------------------------------------- */
/*                                ID UTILITIES                                */
/* -------------------------------------------------------------------------- */
function slugifyId(v) {
  if (!v) return "";
  return String(v)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
window.__slug = slugifyId;
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

function buildRoleMapFromMinutes(minutesObj, orderedNames = null) {
  const names = Array.isArray(orderedNames) && orderedNames.length
    ? orderedNames.filter((name) => Number(minutesObj?.[name] || 0) > 0)
    : Object.entries(minutesObj || {})
        .filter(([, m]) => Number(m) > 0)
        .map(([name]) => name);

  const role = {};

  for (let i = 0; i < names.length; i++) {
    const nm = names[i];
    if (i < 5) role[nm] = "starter";
    else role[nm] = "bench";
  }

  if (names.length > 5) {
    role[names[5]] = "sixth_man";
  }

  return role;
}

function loadTeamRoleMap(teamName) {
  const saved = readSavedGameplan(teamName);
  if (!saved) return {};

  const minutesObj =
    saved.minutes &&
    typeof saved.minutes === "object" &&
    !Array.isArray(saved.minutes)
      ? saved.minutes
      : saved;

  const orderedNames = Array.isArray(saved.order) ? saved.order : null;

  return buildRoleMapFromMinutes(minutesObj, orderedNames);
}

function getTeamPlayerCount(team) {
  return Array.isArray(team?.players)
    ? team.players.filter((p) => p && (p.name || p.player)).length
    : 0;
}

function getSimulationBlockMessageForGame(game, teams) {
  const homeTeam = teams.find((t) => slugifyId(t.name) === game?.homeId);
  const awayTeam = teams.find((t) => slugifyId(t.name) === game?.awayId);

  if (!homeTeam || !awayTeam) {
    return `Team lookup failed: ${game?.homeId} / ${game?.awayId}`;
  }

  const homeCount = getTeamPlayerCount(homeTeam);
  const awayCount = getTeamPlayerCount(awayTeam);

  if (homeCount < 14) {
    return `${homeTeam.name} doesn't have enough players. Minimum 14 required to simulate games.`;
  }

  if (awayCount < 14) {
    return `${awayTeam.name} doesn't have enough players. Minimum 14 required to simulate games.`;
  }

  return "";
}

function getSimulationBlockMessageThroughDate(scheduleByDate, teams, endDate = null) {
  const dates = Object.keys(scheduleByDate || {}).sort(
    (a, b) => new Date(a) - new Date(b)
  );

  for (const d of dates) {
    if (endDate && d > endDate) break;

    for (const game of scheduleByDate?.[d] || []) {
      if (!game || game.played) continue;

      const msg = getSimulationBlockMessageForGame(game, teams);
      if (msg) return msg;
    }
  }

  return "";
}
/* -------------------------------------------------------------------------- */
/*                              SIMULATION WRAPPER                             */
/* -------------------------------------------------------------------------- */
async function simOneSafe(game, leagueData, teams) {
  if (window.__debugSimLogs) {
    window.__lastGame = game;
    console.log("⏳ simOneSafe starting:", game.home, "vs", game.away);
  }

const homeSource = teams.find((t) => slugifyId(t.name) === game.homeId);
const awaySource = teams.find((t) => slugifyId(t.name) === game.awayId);

if (!homeSource || !awaySource) {
  throw new Error(`Team lookup failed: ${game.homeId} / ${game.awayId}`);
}

const simBlockMessage = getSimulationBlockMessageForGame(game, teams);
if (simBlockMessage) {
  throw new Error(simBlockMessage);
}

  ensureGameplansForLeague(leagueData);

  const homeTeamObj = structuredClone(homeSource);
  const awayTeamObj = structuredClone(awaySource);

  for (const p of homeTeamObj.players || []) {
    if (!p.secondaryPos || String(p.secondaryPos).trim() === "") {
      p.secondaryPos = null;
    }
  }

  for (const p of awayTeamObj.players || []) {
    if (!p.secondaryPos || String(p.secondaryPos).trim() === "") {
      p.secondaryPos = null;
    }
  }

  homeTeamObj.minutes = readFlatMinutesFromGameplan(homeTeamObj.name);
  awayTeamObj.minutes = readFlatMinutesFromGameplan(awayTeamObj.name);

  if (window.__debugSimLogs) {
    console.log("[simOneSafe] home minutes keys =", Object.keys(homeTeamObj.minutes || {}));
    console.log("[simOneSafe] away minutes keys =", Object.keys(awayTeamObj.minutes || {}));
  }

  return await simulateOneGame({
    homeTeam: homeTeamObj,
    awayTeam: awayTeamObj,
    leagueData,
  });
}
// ---------------------------------------------------------------------------
// Helper: run ONE game with retries, using simOneSafe + queueSim
// ---------------------------------------------------------------------------
async function runGameWithRetries(game, leagueData, teams, maxRetries = 3) {
  let lastFull = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(
      `[RetrySim] Game ${game.id} (${game.away} @ ${game.home}) attempt`,
      attempt,
      "of",
      maxRetries
    );

    lastFull = await simOneSafe(game, leagueData, teams);

    if (isBadFullResult(lastFull)) {
  window.__lastBad = {
    id: game.id,
    attempt,
    gotNull: lastFull === null,
    type: lastFull === null ? "null" : typeof lastFull,
    keys: lastFull && typeof lastFull === "object" ? Object.keys(lastFull) : null,
    score: lastFull?.score ?? null,
    boxKeys: lastFull && typeof lastFull === "object"
      ? ["box_home","box_away","boxHome","boxAway","home_box","away_box"].filter(k => k in lastFull)
      : null,
    raw: lastFull,
  };
  console.log("[RetrySim] __lastBad saved to window.__lastBad");
}


    // good result?
    if (!isBadFullResult(lastFull)) {
      console.log("[RetrySim] Success for game", game.id, "on attempt", attempt);
      return lastFull;
    }

    console.warn(
      "[RetrySim] BAD result for game",
      game.id,
      "on attempt",
      attempt,
      lastFull
    );
  }

  console.error(
    "[RetrySim] Permanent failure after",
    maxRetries,
    "attempts for game",
    game.id,
    lastFull
  );

  // keep a global list for debugging
  window.__failedGames = window.__failedGames || [];
  window.__failedGames.push({ id: game.id, game, lastFull });

  return null; // caller will decide what to do
}




/* -------------------------------------------------------------------------- */
/*                                 DATE UTILS                                 */
/* -------------------------------------------------------------------------- */
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const rangeDays = (start, end) => {
  const out = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    out.push(new Date(d));
  }
  return out;
};
const monthKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/* -------------------------------------------------------------------------- */
/*                                TEAM HELPERS                                */
/* -------------------------------------------------------------------------- */
function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;

  if (leagueData.conferences) {
    return Object.values(leagueData.conferences).flat();
  }

  return [];
}

/* -------------------------------------------------------------------------- */
/*                                TEAM LOGO UI                                */
/* -------------------------------------------------------------------------- */
const Logo = ({ team, size = 36 }) => {
  const src =
    team.logo ||
    team.teamLogo ||
    team.newTeamLogo ||
    team.image ||
    team.logoUrl;

  if (src) {
    return (
      <img
        src={src}
        alt={team.name}
        style={{
          width: size,
          height: size,
          objectFit: "contain",
          display: "block",
        }}
      />
    );
  }

  const initials = (team.name || "?")
    .split(" ")
    .map((w) => w[0]?.toUpperCase())
    .join("")
    .slice(0, 3);

  return (
    <div
      className="flex items-center justify-center rounded bg-neutral-700 text-white"
      style={{ width: size, height: size }}
    >
      <span className="text-sm font-bold">{initials}</span>
    </div>
  );
};
const MiniStandingsPanel = ({
  title,
  rows,
  selectedTeamName,
  hidden,
  onToggle,
  collapsedLabel,
  side,
  awardsEnabled = false,
  showAwards = false,
  onToggleAwards,
  awardTab = "mvp",
  awardRows = [],
  onPrevAward,
  onNextAward,
}) => {
  const sideClass = side === "left" ? "left-2" : "right-2";

  if (hidden) {
    return (
      <div className={`fixed top-32 ${sideClass} z-40`}>
        <button
          onClick={onToggle}
          className="rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-3 text-sm font-semibold shadow-xl hover:bg-neutral-700"
        >
          {collapsedLabel}
        </button>
      </div>
    );
  }

  return (
    <div className={`group fixed top-28 ${sideClass} z-40 w-52`}>
      <div className="overflow-hidden rounded-xl border-2 border-white/60 bg-neutral-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-700 bg-neutral-800 px-3 py-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-gray-200">
              {showAwards ? "Awards" : title}
            </h3>

            {showAwards && (
              <div className="flex items-center gap-1 rounded bg-neutral-900/80 px-1 py-0.5">
                <button
                  onClick={onPrevAward}
                  className="px-1 text-xs text-gray-300 hover:text-orange-400"
                  title="Previous ladder"
                >
                  ◄
                </button>

                <span className="text-[11px] font-bold text-orange-400">
                  {MINI_AWARD_LABELS[awardTab] || "MVP"}
                </span>

                <button
                  onClick={onNextAward}
                  className="px-1 text-xs text-gray-300 hover:text-orange-400"
                  title="Next ladder"
                >
                  ►
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            {awardsEnabled && (
              <button
                onClick={onToggleAwards}
                className="rounded bg-neutral-700 px-2 py-1 text-xs hover:bg-neutral-600"
              >
                {showAwards ? "Standings" : "Awards"}
              </button>
            )}

            <button
              onClick={onToggle}
              className="rounded bg-neutral-700 px-2 py-1 text-xs hover:bg-neutral-600"
            >
              Hide
            </button>
          </div>
        </div>

        {!showAwards ? (
          <div className="standings-scrollbar max-h-[74vh] overflow-y-auto pr-1">
            {rows.map((row, index) => (
              <div
                key={row.team}
                title={row.team}
                className={`flex items-center gap-2 border-b border-neutral-800 px-3 py-2 last:border-b-0 ${
                  selectedTeamName === row.team
                    ? "bg-orange-600/20"
                    : "hover:bg-neutral-800/70"
                }`}
              >
                <span className="w-4 text-xs text-gray-400">{index + 1}</span>
                <Logo team={{ name: row.team, logo: row.logo }} size={32} />

                <div className="flex items-center gap-1 text-sm font-semibold">
                  <span className="text-green-400">{row.w}</span>
                  <span className="text-gray-500">-</span>
                  <span className="text-red-400">{row.l}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="standings-scrollbar max-h-[74vh] overflow-y-auto pr-1">
            {!awardRows.length ? (
              <div className="px-3 py-4 text-sm text-neutral-400">
                No ladder data yet.
              </div>
            ) : (
              awardRows.map((row, index) => (
                <div
                  key={`${awardTab}_${row.player}_${row.team}`}
                  className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2 last:border-b-0 hover:bg-neutral-800/70"
                  title={`${index + 1}. ${row.player}`}
                >
                  <span className="w-4 shrink-0 text-xs text-gray-400">
                    {index + 1}
                  </span>

                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-neutral-700 bg-neutral-950">
                    {row.headshot ? (
                      <img
                        src={row.headshot}
                        alt={row.player}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full" />
                    )}
                  </div>

                  <div className="shrink-0">
                    <Logo
                      team={{ name: row.team, logo: row.teamLogo }}
                      size={18}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-gray-200">
                      {row.player}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};


/* -------------------------------------------------------------------------- */
/*                        ROUND-ROBIN + SCHEDULE ENGINE                       */
/* -------------------------------------------------------------------------- */
function singleRoundRobinRounds(teamIds) {
  const ids = [...teamIds];
  if (ids.length % 2 === 1) ids.push("__BYE__");

  const n = ids.length;
  const rounds = [];
  let arr = ids.slice();

  for (let r = 0; r < n - 1; r++) {
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== "__BYE__" && b !== "__BYE__") {
        games.push(
          r % 2 === 0 ? { home: a, away: b } : { home: b, away: a }
        );
      }
    }

    rounds.push(games);
    arr = [arr[0], arr[n - 1]].concat(arr.slice(1, n - 1));
  }

  return rounds;
}

function generateFullSeasonSchedule(teams, startDate, endDate) {
  const canonicalIds = teams.map((t) => slugifyId(t.name));
  const N = canonicalIds.length;
  if (N < 2) return { byDate: {}, list: [] };

  const byCanon = {};
  teams.forEach((t) => {
    const cid = slugifyId(t.name);
    byCanon[cid] = {
      id: cid,
      name: t.name,
      logo:
        t.logo ||
        t.teamLogo ||
        t.logoUrl ||
        t.image ||
        t.img ||
        t.newTeamLogo ||
        "",
    };
  });

  const target = 82;

  const single = singleRoundRobinRounds(canonicalIds);
  const mirrored = single.map((rd) =>
    rd.map((g) => ({ home: g.away, away: g.home }))
  );

  const perTeamPerDouble = 2 * (N - 1);
  const baseCycles = Math.floor(target / perTeamPerDouble);
  const remainingPerTeam = target - baseCycles * perTeamPerDouble;

  const rounds = [];

  for (let c = 0; c < baseCycles; c++) {
    const pack =
      c % 2 === 0
        ? [...single, ...mirrored]
        : [...single, ...mirrored].reverse();

    for (const rd of pack) {
      rounds.push(rd.map((g) => ({ ...g })));
    }
  }

  for (let i = 0; i < remainingPerTeam; i++) {
    const base = i % 2 === 0 ? single : mirrored;
    rounds.push(base[i % base.length].map((g) => ({ ...g })));
  }

  const days = rangeDays(startDate, endDate);
  const byDate = {};

  for (const d of days) {
    byDate[fmt(d)] = [];
  }

  const allStarBreak = new Set([
    fmt(new Date(endDate.getFullYear(), 1, 13)),
    fmt(new Date(endDate.getFullYear(), 1, 14)),
    fmt(new Date(endDate.getFullYear(), 1, 15)),
  ]);

  const playableDays = days.filter((d) => !allStarBreak.has(fmt(d)));

  const roundCount = rounds.length;
  const lastPlayableIndex = playableDays.length - 1;
  const lastRoundIndex = Math.max(1, roundCount - 1);

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex++) {
    const daySlot = Math.floor(
      (roundIndex * lastPlayableIndex) / lastRoundIndex
    );

    const dateStr = fmt(playableDays[daySlot]);
    const roundGames = rounds[roundIndex];

    roundGames.forEach((g, gameIndex) => {
      byDate[dateStr].push({
        id: `${dateStr}_${g.home}_vs_${g.away}_${roundIndex}_${gameIndex}`,
        date: dateStr,
        homeId: g.home,
        awayId: g.away,
        home: byCanon[g.home].name,
        away: byCanon[g.away].name,
        homeLogo: byCanon[g.home].logo,
        awayLogo: byCanon[g.away].logo,
        homeTeamObj: byCanon[g.home],
        awayTeamObj: byCanon[g.away],
        played: false,
      });
    });
  }

  return { byDate, list: Object.values(byDate).flat() };
}
/* -------------------------------------------------------------------------- */
/*                         SLIM RESULT (SAVED TO STORAGE)                     */
/* -------------------------------------------------------------------------- */
function slimResult(full) {
  if (!full) return null;

  const homeScore = full.score?.home ?? 0;
  const awayScore = full.score?.away ?? 0;

  const rawHomeBox =
    full.box_home ||
    full.boxHome ||
    full.home_box ||
    [];
  const rawAwayBox =
    full.box_away ||
    full.boxAway ||
    full.away_box ||
    [];

  const makePair = (m, a) => `${m || 0}-${a || 0}`;

  // 🔥 helper to pull makes/attempts from a variety of shapes
  function extractMA(obj, keysM, keysA, stringKeys = []) {
    let m, a;

    // numeric-style keys
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

    // string-style key like "11-22" or "11/22"
    if ((m == null || a == null) && stringKeys.length) {
      for (const sk of stringKeys) {
        const raw = obj[sk];
        if (!raw) continue;
        const str = String(raw).trim();
        if (!str) continue;

        const parts = str.split(/[\/-]/).map((x) => parseInt(x.trim(), 10) || 0);
        if (parts.length >= 2) {
          if (m == null) m = parts[0];
          if (a == null) a = parts[1];
          break;
        }
      }
    }

    return {
      m: m || 0,
      a: a || 0,
    };
  }

  const convertBox = (arr) =>
    (arr || []).map((p) => {
      const obj = p instanceof Map ? Object.fromEntries(p) : p;

      // 🔥 FG
      const fg = extractMA(
        obj,
        ["fgm", "fg_m"],
        ["fga", "fg_a"],
        ["fg"]
      );

      // 🔥 3P
      const tp = extractMA(
        obj,
        ["tpm", "tp_m", "fg3m", "three_m"],
        ["tpa", "tp_a", "fg3a", "three_a"],
        ["3p", "tp", "three"]
      );

      // 🔥 FT
      const ft = extractMA(
        obj,
        ["ftm", "ft_m"],
        ["fta", "ft_a"],
        ["ft"]
      );

      const fgStr = makePair(fg.m, fg.a);
      const threeStr = makePair(tp.m, tp.a);
      const ftStr = makePair(ft.m, ft.a);

      return {
        player: obj.player ?? obj.player_name ?? obj.name ?? "Unknown",
        min: obj.min ?? obj.minutes ?? 0,
        pts: obj.pts ?? obj.points ?? 0,
        reb: obj.reb ?? obj.rebounds ?? 0,
        ast: obj.ast ?? obj.assists ?? 0,
        stl: obj.stl ?? obj.steals ?? 0,
        blk: obj.blk ?? obj.blocks ?? 0,
        fg: fgStr,
        "3p": threeStr,
        ft: ftStr,
        to: obj.to ?? obj.turnovers ?? 0,
        pf: obj.pf ?? obj.fouls ?? 0,
      };
    });

const side =
    homeScore > awayScore ? "home" :
    awayScore > homeScore ? "away" :
    "tie";


  const boxHome = convertBox(rawHomeBox);
  const boxAway = convertBox(rawAwayBox);

  if ((boxHome.length === 0 || boxAway.length === 0) && (homeScore || awayScore)) {
    console.warn("⚠ slimResult: empty box with non-zero score", {
      homeScore,
      awayScore,
      rawHomeBox,
      rawAwayBox,
    });
  }

  return {
    winner: {
      score: `${homeScore}-${awayScore}`,
      home: homeScore,
      away: awayScore,
      ot: full.ot ?? 0,
      side,
    },
    totals: {
      home: homeScore,
      away: awayScore,
    },
    box: {
      home: boxHome,
      away: boxAway,
    },
  };
}




/* -------------------------------------------------------------------------- */
/*                  BAD RESULT / GHOST GAME DETECTION HELPERS                 */
/* -------------------------------------------------------------------------- */

// works on the *full* Python result from simEnginePy
function pairsToObj(x) {
  if (!x) return x;
  if (x instanceof Map) return Object.fromEntries(x);
  if (Array.isArray(x) && x.length && Array.isArray(x[0]) && x[0].length === 2) {
    return Object.fromEntries(x);
  }
  return x;
}

function isBadFullResult(full) {
  if (!full) return true;
  if (full.error) return true;

  const score = pairsToObj(full.score);
  if (!score) return true;

  const home = Number(score.home ?? score.Home ?? 0) || 0;
  const away = Number(score.away ?? score.Away ?? 0) || 0;

  const homeBox =
    full.box_home ||
    full.boxHome ||
    full.home_box ||
    (full.box && (full.box.home || full.box.Home)) ||
    [];

  const awayBox =
    full.box_away ||
    full.boxAway ||
    full.away_box ||
    (full.box && (full.box.away || full.box.Away)) ||
    [];

  const noBox = (!homeBox || homeBox.length === 0) && (!awayBox || awayBox.length === 0);

  // “ghost” signature
  return home === 0 && away === 0 && noBox;
}


// works on the *slim* results object and schedule
function cleanupGhostGames(sched, results) {
  const badIds = Object.entries(results)
    .filter(([id, r]) => {
      if (!r) return true;
      if (r.error) return true;

      const totals = r.totals || {};
      const box = r.box || {};
      const zeroTotals =
        (totals.home ?? 0) === 0 &&
        (totals.away ?? 0) === 0 &&
        box &&
        (!box.home || box.home.length === 0) &&
        (!box.away || box.away.length === 0);

      return zeroTotals;
    })
    .map(([id]) => id);

  if (!badIds.length) {
    console.log("[Calendar] cleanupGhostGames: no ghosts to clean");
    return;
  }

  console.warn(
    "[Calendar] cleanupGhostGames: removing",
    badIds.length,
    "ghost result(s)",
    badIds
  );

  for (const badId of badIds) {
    delete results[badId];
    deleteOneResultV3(badId);


    for (const games of Object.values(sched)) {
      const g = games.find((gg) => gg.id === badId);
      if (g) {
        g.played = false;
        break;
      }
    }
  }
}
function normalizeAwards(raw) {
  if (!raw) return null;

  // Python gives us an array of [key, value] pairs
  if (!Array.isArray(raw)) return raw; // already a plain object

  const outer = Object.fromEntries(raw);

  const asObj = (x) => {
    if (!x) return null;
    if (Array.isArray(x)) return Object.fromEntries(x);
    return x;
  };

  return {
    season: outer.season,
    mvp: asObj(outer.mvp),
    dpoy: asObj(outer.dpoy),
    roty: asObj(outer.roty),
    sixth_man: asObj(outer.sixth_man),
  };
}

// ------------------------------------------------------------
// AWARDS: derive team wins from schedule + saved results
// (because leagueData does NOT store wins)
// ------------------------------------------------------------
function buildTeamsWithWinsForAwards(allTeams, scheduleByDate, resultsById) {
  const wins = {};

  const bump = (teamName) => {
    if (!teamName) return;
    wins[teamName] = (wins[teamName] || 0) + 1;
  };

  for (const games of Object.values(scheduleByDate || {})) {
    for (const g of games || []) {
      if (!g?.played) continue;

      const r = resultsById?.[g.id];
      if (!r?.totals) continue;

      const homePts = Number(r.totals.home ?? 0);
      const awayPts = Number(r.totals.away ?? 0);

      // ignore ties
      if (homePts === awayPts) continue;

      if (homePts > awayPts) bump(g.home);
      else bump(g.away);
    }
  }

  // Return a list that awards.py can consume:
  // awards.py expects each item to have { team, wins }
  return (allTeams || []).map((t) => ({
    team: t?.name,     // IMPORTANT: must match playerStats.team (your schedule uses team names)
    wins: wins[t?.name] || 0,
  }));
}
const MINI_AWARD_TABS = ["mvp", "dpoy", "sixth_man"];
const MINI_AWARD_LABELS = {
  mvp: "MVP",
  dpoy: "DPOY",
  sixth_man: "6MOY",
};

const MINI_AWARD_LIMIT = 10;
const MINI_AWARD_MIN_GAMES = 10;

function awardStatsKey(player, team) {
  return `${player}__${team}`;
}

function miniPerGame(total, gp) {
  const games = Number(gp || 0);
  return games > 0 ? Number(total || 0) / games : 0;
}

function miniPpg(p) {
  return miniPerGame(p.pts, p.gp);
}

function miniApg(p) {
  return miniPerGame(p.ast, p.gp);
}

function miniRpg(p) {
  return miniPerGame(p.reb, p.gp);
}

function miniSpg(p) {
  return miniPerGame(p.stl, p.gp);
}

function miniBpg(p) {
  return miniPerGame(p.blk, p.gp);
}

function miniMpg(p) {
  return miniPerGame(p.min, p.gp);
}

function miniNorm(v, vmax) {
  if (vmax <= 0) return 0;
  return Math.max(0, Math.min(1, v / vmax));
}

function miniNormDef(v, lo, hi) {
  if (hi <= lo) return 0;
  return Math.max(0, Math.min(1, (hi - v) / (hi - lo)));
}

function buildMiniAwardContext(players) {
  if (!players.length) {
    return {
      ppg: 1,
      apg: 1,
      rpg: 1,
      spg: 1,
      bpg: 1,
      wins: 82,
      defLo: 90,
      defHi: 120,
    };
  }

  return {
    ppg: Math.max(...players.map((p) => miniPpg(p)), 1),
    apg: Math.max(...players.map((p) => miniApg(p)), 1),
    rpg: Math.max(...players.map((p) => miniRpg(p)), 1),
    spg: Math.max(...players.map((p) => miniSpg(p)), 1),
    bpg: Math.max(...players.map((p) => miniBpg(p)), 1),
    wins: Math.max(...players.map((p) => Number(p._team_wins || 0)), 1),
    defLo: Math.min(...players.map((p) => Number(p.def_rating ?? 110))),
    defHi: Math.max(...players.map((p) => Number(p.def_rating ?? 110))),
  };
}

function calcMiniMvpScore(p, c) {
  return (
    0.30 * miniNorm(miniPpg(p), c.ppg) +
    0.15 * miniNorm(miniApg(p), c.apg) +
    0.15 * miniNorm(miniRpg(p), c.rpg) +
    0.20 * miniNorm(Number(p._team_wins || 0), c.wins) +
    0.075 * miniNorm(miniSpg(p), c.spg) +
    0.075 * miniNorm(miniBpg(p), c.bpg) +
    0.05 * miniNormDef(Number(p.def_rating ?? c.defHi), c.defLo, c.defHi)
  );
}

function calcMiniDpoyScore(p, c) {
  return (
    0.35 * miniNorm(miniSpg(p), c.spg) +
    0.35 * miniNorm(miniBpg(p), c.bpg) +
    0.20 * miniNormDef(Number(p.def_rating ?? c.defHi), c.defLo, c.defHi) +
    0.10 * miniNorm(Number(p._team_wins || 0), c.wins)
  );
}

function calcMiniSixthManScore(p, c) {
  return (
    0.35 * miniNorm(miniPpg(p), c.ppg) +
    0.20 * miniNorm(miniApg(p), c.apg) +
    0.20 * miniNorm(miniRpg(p), c.rpg) +
    0.10 * miniNorm(miniSpg(p), c.spg) +
    0.10 * miniNorm(miniBpg(p), c.bpg) +
    0.05 * miniNormDef(Number(p.def_rating ?? c.defHi), c.defLo, c.defHi)
  );
}

function isMiniSixthManEligible(p) {
  const gp = Number(p.gp || 0);
  const starts = Number(p.started || 0);
  const sixth = Number(p.sixth || 0);

  return (
    gp >= MINI_AWARD_MIN_GAMES &&
    miniMpg(p) >= 14 &&
    starts <= Math.floor(0.2 * gp) &&
    sixth >= Math.max(5, Math.floor(0.25 * gp))
  );
}

function buildMiniRosterInfoIndex(allTeams) {
  const map = {};

  for (const t of allTeams || []) {
    const teamName = t?.name || t?.team;
    if (!teamName) continue;

    const teamLogo =
      t.logo ||
      t.teamLogo ||
      t.newTeamLogo ||
      t.logoUrl ||
      t.image ||
      t.img ||
      null;

    for (const pl of t?.players || []) {
      const playerName = pl?.name || pl?.player;
      if (!playerName) continue;

      map[awardStatsKey(playerName, teamName)] = {
        headshot:
          pl?.portrait ||
          pl?.image ||
          pl?.photo ||
          pl?.headshot ||
          pl?.img ||
          pl?.face ||
          null,
        teamLogo,
        def_rating:
          pl?.def_rating ??
          pl?.defRating ??
          pl?.defensive_rating ??
          pl?.defensiveRating ??
          pl?.drtg ??
          pl?.defrtg ??
          110,
      };
    }
  }

  return map;
}

function toMiniAwardRow(p, score) {
  return {
    player: p.player,
    team: p.team,
    headshot: p.headshot || null,
    teamLogo: p.teamLogo || null,
    _score: score,
  };
}

function buildMiniAwardLadders(allTeams, statsMap, scheduleByDate, resultsById) {
  const rosterInfoIndex = buildMiniRosterInfoIndex(allTeams);

  const teamWinsRows = buildTeamsWithWinsForAwards(
    allTeams,
    scheduleByDate,
    resultsById
  );

  const teamWinsMap = {};
  for (const t of teamWinsRows) {
    teamWinsMap[t.team] = Number(t.wins || 0);
  }

  const playerPool = [];

  for (const t of allTeams || []) {
    const teamName = t?.name || t?.team;
    if (!teamName) continue;

    for (const pl of t?.players || []) {
      const playerName = pl?.name || pl?.player;
      if (!playerName) continue;

      const key = awardStatsKey(playerName, teamName);
      const s = statsMap?.[key];
      if (!s || Number(s.gp || 0) <= 0) continue;

      const info = rosterInfoIndex[key] || {};

      playerPool.push({
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
        def_rating: Number(info.def_rating ?? 110),
        headshot: info.headshot || null,
        teamLogo: info.teamLogo || null,
        _team_wins: Number(teamWinsMap[teamName] || 0),
      });
    }
  }

  if (!playerPool.length) {
    return {
      mvp: [],
      dpoy: [],
      sixth_man: [],
    };
  }

  const eligiblePool = playerPool.filter(
    (p) => Number(p.gp || 0) >= MINI_AWARD_MIN_GAMES
  );

  const basePool = eligiblePool.length ? eligiblePool : playerPool;
  const baseCtx = buildMiniAwardContext(basePool);

  const mvp = basePool
    .map((p) => toMiniAwardRow(p, calcMiniMvpScore(p, baseCtx)))
    .sort((a, b) => b._score - a._score)
    .slice(0, MINI_AWARD_LIMIT);

  const dpoy = basePool
    .map((p) => toMiniAwardRow(p, calcMiniDpoyScore(p, baseCtx)))
    .sort((a, b) => b._score - a._score)
    .slice(0, MINI_AWARD_LIMIT);

  const strictSixthPool = basePool.filter((p) => isMiniSixthManEligible(p));
  const fallbackSixthPool = basePool.filter(
    (p) =>
      miniMpg(p) >= 14 &&
      Number(p.started || 0) <= Math.floor(0.4 * Number(p.gp || 0))
  );

  const sixthPool = strictSixthPool.length ? strictSixthPool : fallbackSixthPool;
  const sixthCtx = buildMiniAwardContext(sixthPool.length ? sixthPool : basePool);

  const sixth_man = (sixthPool.length ? sixthPool : [])
    .map((p) => toMiniAwardRow(p, calcMiniSixthManScore(p, sixthCtx)))
    .sort((a, b) => b._score - a._score)
    .slice(0, MINI_AWARD_LIMIT);

  return {
    mvp,
    dpoy,
    sixth_man,
  };
}
// ------------------------------------------------------------
// AWARDS: attach def_rating to player season stat objects
// by looking it up from leagueData rosters
// ------------------------------------------------------------
function buildDefRatingLookupFromLeague(allTeams) {
  const map = {}; // key: "Player Name__Team Name" -> def_rating

  for (const t of (allTeams || [])) {
    const teamName = t?.name || t?.team;
    if (!teamName) continue;

    for (const pl of (t.players || [])) {
      const playerName = pl?.player || pl?.name;
      if (!playerName) continue;

      // try common keys (add more if your roster uses a different name)
      const def =
        pl.def_rating ??
        pl.defRating ??
        pl.defensive_rating ??
        pl.defensiveRating ??
        pl.drtg ??
        pl.defrtg;

      if (def != null && Number.isFinite(Number(def))) {
        map[`${playerName}__${teamName}`] = Number(def);
      }
    }
  }

  return map;
}


/* -------------------------------------------------------------------------- */
/*                           MAIN CALENDAR COMPONENT                          */
/* -------------------------------------------------------------------------- */
export default function Calendar() {
  
  const navigate = useNavigate();
  const { leagueData, setLeagueData, selectedTeam, setSelectedTeam } = useGame();
  console.log("🔥 Calendar leagueData =", leagueData);
  window.__leagueData = leagueData;



  /* -------------------------------- Season Window ------------------------------- */
  const META_KEY = "bm_league_meta_v1";
  const today = new Date();
  let storedSeasonYear = null;
  try {
    const metaRaw = localStorage.getItem(META_KEY);
    const meta = metaRaw ? JSON.parse(metaRaw) : null;
    const y = meta?.seasonYear;
    if (Number.isFinite(Number(y))) storedSeasonYear = Number(y);
  } catch {}

  const seasonYear =
    storedSeasonYear != null
      ? storedSeasonYear
      : (today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1);

  const seasonStart = useMemo(
    () => new Date(seasonYear, 9, 21),
    [seasonYear]
  );
  const seasonEnd = useMemo(
    () => new Date(seasonYear + 1, 3, 12),
    [seasonYear]
  );

  const allDays = useMemo(
    () => rangeDays(seasonStart, seasonEnd),
    [seasonStart, seasonEnd]
  );

  /* --------------------------------- TEAM LIST --------------------------------- */
const teams = useMemo(() => {
  if (!leagueData) return [];

  const arr = getAllTeamsFromLeague(leagueData);
  console.log("🔥 DEBUG Calendar loaded teams:", arr);
  window.__debugTeams = arr;

  return arr.map((t) => ({
    ...t,
    id: slugifyId(t.name),
  }));
}, [leagueData]);
const selectedTeamPlayerCount = useMemo(() => {
  return getTeamPlayerCount(selectedTeam);
}, [selectedTeam]);

const selectedTeamCanSim = selectedTeamPlayerCount >= 14;


  /* ---------------------------- Team Switch Controls ---------------------------- */
  const allTeamsSorted = useMemo(
    () => [...teams].sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [teams]
  );

  const currentIndex = useMemo(() => {
    return selectedTeam
      ? allTeamsSorted.findIndex((t) => t.name === selectedTeam.name)
      : -1;
  }, [selectedTeam, allTeamsSorted]);

  const handleTeamSwitch = (dir) => {
    if (!allTeamsSorted.length || currentIndex < 0) return;

    const i =
      dir === "next"
        ? (currentIndex + 1) % allTeamsSorted.length
        : (currentIndex - 1 + allTeamsSorted.length) %
          allTeamsSorted.length;

    setSelectedTeam(allTeamsSorted[i]);
  };

  useEffect(() => {
    if (selectedTeam)
      localStorage.setItem("selectedTeam", JSON.stringify(selectedTeam));
  }, [selectedTeam]);

  /* ----------------------------- LOCAL STORAGE KEYS ----------------------------- */
  const SCHED_KEY = "bm_schedule_v3";
  const RESULT_KEY = "bm_results_v2";
  const PLAYER_STATS_KEY = "bm_player_stats_v1";
  // ===============================
  // FAST RESULTS STORE (per-game)
  // ===============================
const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_"; // each game stored as bm_result_v3_<gameId>
const RESULT_V2_BLOB_KEY = "bm_results_v2"; // legacy blob (for migration)

const resultV3Key = (gameId) => `${RESULT_V3_PREFIX}${gameId}`;

function isQuotaError(err) {
  return (
    err?.name === "QuotaExceededError" ||
    String(err?.message || "").toLowerCase().includes("quota")
  );
}

function hasBoxRows(slim) {
  return !!(
    slim?.box &&
    ((Array.isArray(slim.box.home) && slim.box.home.length > 0) ||
      (Array.isArray(slim.box.away) && slim.box.away.length > 0))
  );
}

function compactResultForCalendar(slim) {
  if (!slim) return null;

  return {
    winner: slim.winner || null,
    totals: slim.totals || {
      home: Number(slim?.winner?.home || 0),
      away: Number(slim?.winner?.away || 0),
    },
    box: {
      home: [],
      away: [],
    },
    hasBoxScore: hasBoxRows(slim),
  };
}

function readCompressedOrJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;

    if (raw.startsWith("lz:")) {
      const decompressed = LZString.decompressFromUTF16(raw.slice(3));
      return decompressed ? JSON.parse(decompressed) : fallback;
    }

    try {
      return JSON.parse(raw);
    } catch {}

    const decompressed = LZString.decompressFromUTF16(raw);
    return decompressed ? JSON.parse(decompressed) : fallback;
  } catch {
    return fallback;
  }
}

function writeCompressedJson(key, value) {
  const json = JSON.stringify(value || {});
  const compressed = "lz:" + LZString.compressToUTF16(json);
  localStorage.setItem(key, compressed);
}

function removeLegacyResultsBlob() {
  try {
    localStorage.removeItem(RESULT_V2_BLOB_KEY);
  } catch {}
}

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

function saveResultsIndexV3(ids) {
  try {
    localStorage.setItem(RESULT_V3_INDEX_KEY, JSON.stringify(ids));
  } catch (e) {
    if (isQuotaError(e)) removeLegacyResultsBlob();
    console.warn("[ResultsV3] failed saving index", e);
  }
}

function loadOneResultV3(gameId) {
  try {
    const stored = localStorage.getItem(resultV3Key(gameId));
    if (!stored) return null;

    const decompressed = LZString.decompressFromUTF16(stored);
    const json = decompressed || stored;
    const parsed = JSON.parse(json);

    // Old saves may still have full box scores in localStorage.
    // Move them to IndexedDB, then shrink localStorage to score-only.
    if (hasBoxRows(parsed)) {
      const compact = compactResultForCalendar(parsed);

      saveBoxScoreToDB(gameId, parsed)
        .then(() => {
          try {
            localStorage.setItem(
              resultV3Key(gameId),
              LZString.compressToUTF16(JSON.stringify(compact))
            );
          } catch (e) {
            console.warn("[ResultsV3] failed compacting migrated result", gameId, e);
          }
        })
        .catch((e) => console.warn("[IndexedDB] failed migrating box score", gameId, e));

      return compact;
    }

    return parsed;
  } catch {
    return null;
  }
}

function saveOneResultV3(gameId, slim, game = null, seasonYearValue = null) {
  if (!gameId || !slim) return;

  if (hasBoxRows(slim)) {
    saveBoxScoreToDB(gameId, slim, {
      seasonYear: seasonYearValue,
      home: game?.home,
      away: game?.away,
    }).catch((e) => console.warn("[IndexedDB] failed saving box score", gameId, e));
  }

  try {
    const compact = compactResultForCalendar(slim);
    const json = JSON.stringify(compact);
    const compressed = LZString.compressToUTF16(json);
    localStorage.setItem(resultV3Key(gameId), compressed);

    const ids = loadResultsIndexV3();
    if (!ids.includes(gameId)) {
      ids.push(gameId);
      saveResultsIndexV3(ids);
    }
  } catch (e) {
    console.error("[ResultsV3] failed saving compact game", gameId, e);
    if (isQuotaError(e)) removeLegacyResultsBlob();
  }
}

function deleteOneResultV3(gameId) {
  try {
    localStorage.removeItem(resultV3Key(gameId));
    deleteBoxScoreFromDB(gameId).catch(() => {});
    const ids = loadResultsIndexV3().filter((id) => id !== gameId);
    saveResultsIndexV3(ids);
  } catch {}
}

function clearAllResultsV3() {
  try {
    const ids = loadResultsIndexV3();
    for (const id of ids) localStorage.removeItem(resultV3Key(id));
    localStorage.removeItem(RESULT_V3_INDEX_KEY);
    clearBoxScoresFromDB().catch(() => {});
  } catch {}
}

function migrateResultsV2BlobToV3IfNeeded() {
  try {
    const blob = localStorage.getItem(RESULT_V2_BLOB_KEY);
    if (!blob) return;

    const existing = loadResultsIndexV3();
    if (existing.length > 0) {
      removeLegacyResultsBlob();
      return;
    }

    const decompressed = LZString.decompressFromUTF16(blob);
    const json = decompressed || blob;
    const obj = JSON.parse(json) || {};
    const ids = Object.keys(obj);

    for (const id of ids) {
      const slim = obj[id];
      if (!slim) continue;

      if (hasBoxRows(slim)) {
        saveBoxScoreToDB(id, slim).catch((e) =>
          console.warn("[IndexedDB] failed migrating v2 box score", id, e)
        );
      }

      const compact = compactResultForCalendar(slim);
      localStorage.setItem(
        resultV3Key(id),
        LZString.compressToUTF16(JSON.stringify(compact))
      );
    }

    saveResultsIndexV3(ids);
    removeLegacyResultsBlob();

    console.log("[ResultsV3] migrated", ids.length, "games from v2 blob into compact localStorage + IndexedDB boxes");
  } catch (e) {
    console.warn("[ResultsV3] migration failed", e);
  }
}

function loadAllResultsV3() {
  const ids = loadResultsIndexV3();
  const out = {};

  for (const id of ids) {
    const r = loadOneResultV3(id);
    if (r) out[id] = compactResultForCalendar(r);
  }

  return out;
}

function loadResults() {
  migrateResultsV2BlobToV3IfNeeded();
  return loadAllResultsV3();
}

function loadPlayerStats() {
  return readCompressedOrJson(PLAYER_STATS_KEY, {});
}

function savePlayerStats(stats) {
  try {
    writeCompressedJson(PLAYER_STATS_KEY, stats || {});
  } catch (e) {
    console.warn("[Calendar] compressed player stats save failed", e);

    if (isQuotaError(e)) removeLegacyResultsBlob();

    try {
      writeCompressedJson(PLAYER_STATS_KEY, stats || {});
    } catch (err) {
      console.error("[Calendar] player stats save failed after retry", err);
    }
  }
}


function parsePair(s) {
  const [m, a] = String(s || "0-0").split("-").map(Number);
  return { m: m || 0, a: a || 0 };
}
// ------------------------------------------------------------
// SIXTH MAN ROLE HELPERS (starter vs sixth vs bench)
// ------------------------------------------------------------

// Mutates slim.box rows by adding row.role = "starter" | "sixth_man" | "bench"
function annotateSlimWithRoles(slim, homeRoleMap, awayRoleMap) {
  if (!slim || !slim.box) return slim;

  const apply = (side, roleMap) => {
    const rows = slim.box?.[side] || [];
    for (const row of rows) {
      const nm = row?.player;
      row.role = (nm && roleMap && roleMap[nm]) ? roleMap[nm] : "bench";
    }
  };

  apply("home", homeRoleMap);
  apply("away", awayRoleMap);

  return slim;
}


// slim = result from slimResult(full)
function applyGameToPlayerStats(stats, slim, game) {
  if (!slim?.box) return stats;

  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const updateSide = (side, teamName) => {
    const rows = slim.box[side] || [];

// Determine starters + ONE sixth man (either from role tag, or 6th-highest minutes fallback)
const sortedByMin = [...rows].sort((a, b) => toNum(b.min) - toNum(a.min));
const starters = new Set(sortedByMin.slice(0, 5).map((r) => r.player));
const sixthManByMinutes = sortedByMin[5]?.player || null;

    for (const row of rows) {
      const key = `${row.player}__${teamName}`;
      const cur = stats[key] || {
        player: row.player,
        team: teamName,
        gp: 0,
        min: 0,
        pts: 0,
        reb: 0,
        ast: 0,
        stl: 0,
        blk: 0,
        fgm: 0,
        fga: 0,
        tpm: 0,
        tpa: 0,
        ftm: 0,
        fta: 0,
        // 🔥 role tracking
        started: 0,
        sixth: 0,
      };

      cur.gp += 1;
      cur.min += toNum(row.min);
      cur.pts += toNum(row.pts);
      cur.reb += toNum(row.reb);
      cur.ast += toNum(row.ast);
      cur.stl += toNum(row.stl);
      cur.blk += toNum(row.blk);

      const { m: fgm, a: fga } = parsePair(row.fg);
      const { m: tpm, a: tpa } = parsePair(row["3p"]);
      const { m: ftm, a: fta } = parsePair(row.ft);

      cur.fgm += fgm;
      cur.fga += fga;
      cur.tpm += tpm;
      cur.tpa += tpa;
      cur.ftm += ftm;
      cur.fta += fta;

      // 🔥 starter vs bench counts
// 🔥 role tracking (only ONE sixth man, not the whole bench)
const role = row.role; // may exist if you annotated slim with roles
if (role === "starter") cur.started += 1;
else if (role === "sixth_man") cur.sixth += 1;
else {
  // if role isn't present (older saved results), fall back to minutes heuristic
  if (starters.has(row.player)) cur.started += 1;
  else if (sixthManByMinutes && row.player === sixthManByMinutes) cur.sixth += 1;
}

      stats[key] = cur;
    }
  };

  updateSide("home", game.home);
  updateSide("away", game.away);
  return stats;
}

// 🔥 Rebuild player stats from existing schedule + results
  function recomputePlayerSeasonStatsFromResults(schedule, results) {
    let stats = {};

    for (const games of Object.values(schedule || {})) {
      for (const g of games || []) {
        const slim = results?.[g.id];
        if (!slim) continue;
        stats = applyGameToPlayerStats(stats, slim, g);
      }
    }

    savePlayerStats(stats);
    console.log(
      "[Calendar] recomputed player stats from existing results:",
      Object.keys(stats).length,
      "players"
    );
    return stats;
  }

  

  const [scheduleByDate, setScheduleByDate] = useState({});
  const [resultsById, setResultsById] = useState({});
  // expose for debugging
window.__sched = scheduleByDate;
window.__results = resultsById;
window.__teams = teams;
window.__results = resultsById;




  const saveSchedule = (obj) => {
    setScheduleByDate(obj);
    try {
      localStorage.setItem(SCHED_KEY, JSON.stringify(obj));
    } catch (e) {
      console.warn("[Calendar] schedule save failed", e);
      if (isQuotaError(e)) removeLegacyResultsBlob();
    }
  };


function saveResults(results) {
  const compactResults = {};

  try {
    const ids = Object.keys(results || {});
    for (const id of ids) {
      const slim = results[id];
      if (!slim) continue;
      compactResults[id] = compactResultForCalendar(slim);
      saveOneResultV3(id, slim, null, seasonYear);
    }
    saveResultsIndexV3(ids);
  } catch (e) {
    console.error("[ResultsV3] bulk save failed", e);
  }

  setResultsById(compactResults);
}














  /* -------------------------------------------------------------------------- */
  /*                          Schedule + Results Loader                         */
  /* -------------------------------------------------------------------------- */
  /* -------------------------------------------------------------------------- */
  /*                          Schedule + Results Loader                         */
  /* -------------------------------------------------------------------------- */
useEffect(() => {
  if (!teams || teams.length < 2) return;

  const wantStart = fmt(seasonStart);
  const wantEnd = fmt(seasonEnd);
  const canonicalIds = teams.map((t) => slugifyId(t.name));
  const target = 82;

  const isScheduleValid = (obj) => {
    try {
      if (!obj || !Object.keys(obj).length) return false;

      const keys = Object.keys(obj).sort();
      if (keys[0] !== wantStart || keys[keys.length - 1] !== wantEnd) return false;

      const cnt = Object.fromEntries(canonicalIds.map((id) => [id, 0]));
      for (const games of Object.values(obj)) {
        for (const g of games) {
          if (!g.homeId || !g.awayId) return false;
          if (!cnt.hasOwnProperty(g.homeId)) return false;
          if (!cnt.hasOwnProperty(g.awayId)) return false;

          cnt[g.homeId]++;
          cnt[g.awayId]++;
        }
      }

      return canonicalIds.every((id) => cnt[id] === target);
    } catch {
      return false;
    }
  };

  // ----- load from storage -----
  let parsedSched = {};
  let parsedResults = {};
  let parsedPlayerStats = loadPlayerStats();

  try {
    parsedSched = JSON.parse(localStorage.getItem(SCHED_KEY)) || {};
  } catch {
    parsedSched = {};
  }

  parsedResults = loadResults();

  const hasValidResults = Object.values(parsedResults).some(
    (r) => r?.totals?.home != null && r?.totals?.away != null
  );

  const hasPlayerStats = parsedPlayerStats && Object.keys(parsedPlayerStats).length > 0;
  const hasRoleFields =
    parsedPlayerStats &&
    Object.values(parsedPlayerStats).some((p) => p && (("started" in p) || ("sixth" in p)));

  const scheduleValid = isScheduleValid(parsedSched);

  // ✅ IMPORTANT: if schedule is missing/invalid, regenerate it EVEN IF results exist
  if (!scheduleValid) {
    const { byDate } = generateFullSeasonSchedule(teams, seasonStart, seasonEnd);

    // if we already have results, mark those games as played in the regenerated schedule
    const rebuilt = {};
    for (const [d, games] of Object.entries(byDate)) {
      rebuilt[d] = (games || []).map((g) =>
        parsedResults && parsedResults[g.id] ? { ...g, played: true } : g
      );
    }

    saveSchedule(rebuilt);          // writes storage + sets state
    setResultsById(parsedResults);  // keep results if they exist

    if (hasValidResults && (!hasPlayerStats || !hasRoleFields)) {
      const rebuiltStats = recomputePlayerSeasonStatsFromResults(rebuilt, parsedResults);
      console.log("[Calendar] auto-rebuilt player stats (role-aware); players =", Object.keys(rebuiltStats).length);
    }

    return;
  }

  // ----- normal path: reuse stored schedule -----
  setScheduleByDate(parsedSched);
  setResultsById(parsedResults);

  if (hasValidResults && (!hasPlayerStats || !hasRoleFields)) {
    const rebuiltStats = recomputePlayerSeasonStatsFromResults(parsedSched, parsedResults);
    console.log("[Calendar] auto-rebuilt player stats (role-aware); players =", Object.keys(rebuiltStats).length);
  }
}, [teams, seasonStart, seasonEnd]);




  /* -------------------------------------------------------------------------- */
  /*                                My Team Games                               */
  /* -------------------------------------------------------------------------- */
  const myGames = useMemo(() => {
    if (!selectedTeam) return {};

    const myId = slugifyId(selectedTeam.name);
    const map = {};

    for (const [d, games] of Object.entries(scheduleByDate)) {
      const matches = games.filter(
        (g) => g.homeId === myId || g.awayId === myId
      );

      if (matches.length === 1) map[d] = matches[0];
      else if (matches.length > 1) map[d] = matches[matches.length - 1];
    }

    return map;
  }, [scheduleByDate, selectedTeam]);

  /* -------------------------------------------------------------------------- */
  /*                                 Focused Date                               */
  /* -------------------------------------------------------------------------- */
  const [focusedDate, setFocusedDate] = useState(null);
  const monthRefs = useRef({});

  useEffect(() => {
    const firstGameDate = Object.keys(myGames).sort()[0];
    setFocusedDate(firstGameDate || fmt(seasonStart));
  }, [myGames, seasonStart]);

  /* -------------------------------------------------------------------------- */
  /*                              Month & Visible Days                           */
  /* -------------------------------------------------------------------------- */
  const [month, setMonth] = useState(() => monthKey(seasonStart));

  const months = useMemo(
    () => Array.from(new Set(allDays.map(monthKey))),
    [allDays]
  );

const scrollToMonth = (monthStr) => {
  setMonth(monthStr);

  requestAnimationFrame(() => {
    const el = monthRefs.current[monthStr];
    if (el) {
      el.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  });
};

const buildVisibleDaysForMonth = (monthStr) => {
  const [y, m] = monthStr.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);

  const isSeasonStartMonth =
    y === seasonStart.getFullYear() &&
    m - 1 === seasonStart.getMonth();

  if (isSeasonStartMonth) {
    const compactStart = addDays(seasonStart, -seasonStart.getDay());
    const compactDays = rangeDays(compactStart, last);
    const padded = [...compactDays];

    while (padded.length % 7 !== 0) padded.push(null);
    return padded;
  }

  const days = rangeDays(first, last);
  const pad = first.getDay();

  const padded = Array(pad).fill(null).concat(days);
  while (padded.length % 7 !== 0) padded.push(null);
  return padded;
};

const visibleDaysByMonth = useMemo(() => {
  const out = {};
  for (const monthStr of months) {
    out[monthStr] = buildVisibleDaysForMonth(monthStr);
  }
  return out;
}, [months, seasonStart]);

  /* -------------------------------------------------------------------------- */
  /*                                 Action Modals                               */
  /* -------------------------------------------------------------------------- */
const [boxModal, setBoxModal] = useState(null);
const [actionModal, setActionModal] = useState(null);
const [simErrorModal, setSimErrorModal] = useState(null);
const [simLock, setSimLock] = useState(false);

const [allStarPromptOpen, setAllStarPromptOpen] = useState(false);
const [allStarOpen, setAllStarOpen] = useState(false);
const [allStarData, setAllStarData] = useState(null);

const ALL_STAR_DATE = fmt(new Date(seasonYear + 1, 1, 13));
const allStarHandledRef = useRef(false);

// ✅ stop control
const stopRef = useRef(false);
const [stopRequested, setStopRequested] = useState(false);
const [showWestStandings, setShowWestStandings] = useState(true);
const [showEastStandings, setShowEastStandings] = useState(true);
const [showAwardsPanel, setShowAwardsPanel] = useState(false);
const [miniAwardTab, setMiniAwardTab] = useState("mvp");
const CALENDAR_SCALE = 0.97;

const openSimError = (message, title = "Cannot simulate") => {
  setSimErrorModal({ title, message });
};

const requestStop = () => {
  if (!simLock) return;
  stopRef.current = true;
  setStopRequested(true);
  console.log("[Sim] stop requested");
};

const openAllStarTeams = async () => {
  try {
    const stats = loadPlayerStats();

    console.log("[AllStars DEBUG] stats count =", Object.keys(stats || {}).length);
    console.log("[AllStars DEBUG] first 5 stats =", Object.values(stats || {}).slice(0, 5));
    console.log("[AllStars DEBUG] conferences =", leagueData?.conferences);

    const payload = {
      season: `${seasonYear}-${seasonYear + 1}`,
      cutoff_date: ALL_STAR_DATE,
      min_games: 12,
      playerStats: stats,
      leagueData,
      scheduleByDate,
      resultsById,
    };

    console.log("[AllStars DEBUG] payload =", payload);

    const result = await computeAllStars(payload);
    console.log("[AllStars] result =", result);

    setAllStarData(result);
    setAllStarOpen(true);
    setAllStarPromptOpen(false);
    allStarHandledRef.current = true;
  } catch (err) {
    console.error("[AllStars] Failed to compute all stars:", err);
  }
};
async function openBoxScoreForGame(game) {
  if (!game?.id) return;

  try {
    const dbResult = await loadBoxScoreFromDB(game.id);
    const fallback = resultsById?.[game.id];
    const result = dbResult || fallback;

    setActionModal(null);
    setBoxModal({ game, result });
  } catch (e) {
    console.warn("[Calendar] failed loading box score from IndexedDB", e);
    const fallback = resultsById?.[game.id];
    setActionModal(null);
    setBoxModal({ game, result: fallback });
  }
}

function buildTeamsFromLeagueForSim(league) {
  return getAllTeamsFromLeague(league).map((t) => ({
    ...t,
    id: slugifyId(t.name),
  }));
}

async function repairCpuRostersBeforeSimulation({
  leagueData,
  selectedTeam,
  setLeagueData,
}) {
  const repairRes = await repairCpuTeamsToMinRoster(
    leagueData,
    selectedTeam?.name || null,
    14,
    0
  );

  console.log("[CPU Repair] raw result =", repairRes);
  console.log("[CPU Repair] signings =", repairRes?.signings || []);
  console.log("[CPU Repair] failedTeams =", repairRes?.failedTeams || []);

  const repairedLeagueData = repairRes?.leagueData || leagueData;
  const repairedTeams = buildTeamsFromLeagueForSim(repairedLeagueData);

  const magic = repairedTeams.find((t) => t.name === "Orlando Magic");
  console.log("[CPU Repair] Orlando count after repair =", getTeamPlayerCount(magic));

  if (repairRes?.leagueData && typeof setLeagueData === "function") {
    setLeagueData(repairedLeagueData);
  }

  try {
    localStorage.setItem("leagueData", JSON.stringify(repairedLeagueData));
  } catch {}
  if (repairRes?.signings?.length) {
  const touchedTeams = Array.from(
    new Set(
      repairRes.signings
        .map((s) => s.teamName || s.team)
        .filter(Boolean)
    )
  );

  for (const teamName of touchedTeams) {
    try {
      localStorage.removeItem(`gameplan_${teamName}`);
    } catch {}
  }

  ensureGameplansForLeague(repairedLeagueData);
}

  return {
    repairRes,
    repairedLeagueData,
    repairedTeams,
  };
}
/* -------------------------------------------------------------------------- */
/*                           SIMULATION HANDLERS                               */
/* -------------------------------------------------------------------------- */
const handleSimOnlyGame = async (dateStr, game) => {
  const {
    repairRes,
    repairedLeagueData,
    repairedTeams,
  } = await repairCpuRostersBeforeSimulation({
    leagueData,
    selectedTeam,
    setLeagueData,
  });

  const userTeamLive = repairedTeams.find((t) => t.name === selectedTeam?.name);
  const userCount = getTeamPlayerCount(userTeamLive);

  if (userCount < 14) {
    openSimError(
      `${selectedTeam.name} doesn't have enough players. Minimum 14 required to simulate games.`,
      "Roster issue"
    );
    return;
  }

  const simBlockMessage = getSimulationBlockMessageForGame(game, repairedTeams);
  if (simBlockMessage) {
    openSimError(simBlockMessage, "Simulation blocked");
    return;
  }

  if (repairRes?.signings?.length) {
    console.log("[CPU Roster Repair] auto-signings before single game:", repairRes.signings);
  }

  const upd = { ...scheduleByDate };
  const newResults = { ...resultsById };

  let full;
  try {
    full = await runGameWithRetries(game, repairedLeagueData, repairedTeams);
  } catch (err) {
    openSimError(
      err?.message || "This team doesn't have enough players.",
      "Simulation blocked"
    );
    return;
  }

  if (!full) {
    console.error("[SimOnly] Could not get a valid result for game", game.id);
    return;
  }

  const result = slimResult(full);
  const homeRoles = loadTeamRoleMap(game.home);
  const awayRoles = loadTeamRoleMap(game.away);
  annotateSlimWithRoles(result, homeRoles, awayRoles);

  upd[dateStr] = upd[dateStr].map((g) =>
    g.id === game.id ? { ...g, played: true } : g
  );

  newResults[game.id] = result;
  let playerStats = loadPlayerStats();
  playerStats = applyGameToPlayerStats(playerStats, result, game);
  savePlayerStats(playerStats);

  saveSchedule(upd);
  saveOneResultV3(game.id, result, game, seasonYear);
  setResultsById((prev) => ({ ...prev, [game.id]: result }));

  setActionModal(null);
  setBoxModal({ game, result });
};

const handleSimToDate = async (dateStr) => {
  // start from whatever is already in storage
  let playerStats = loadPlayerStats();

  if (simLock) return;
    const {
    repairRes,
    repairedLeagueData,
    repairedTeams,
  } = await repairCpuRostersBeforeSimulation({
    leagueData,
    selectedTeam,
    setLeagueData,
  });

  const userTeamLive = repairedTeams.find((t) => t.name === selectedTeam?.name);
  const userCount = getTeamPlayerCount(userTeamLive);

if (userCount < 14) {
  openSimError(
    `${selectedTeam.name} doesn't have enough players. Minimum 14 required to simulate games.`,
    "Roster issue"
  );
  return;
}

const simBlockMessage = getSimulationBlockMessageThroughDate(
  scheduleByDate,
  repairedTeams,
  dateStr
);
if (simBlockMessage) {
  openSimError(simBlockMessage, "Simulation blocked");
  return;
}

setActionModal(null);
setBoxModal(null);

  // ✅ reset stop state at the start of THIS run
  stopRef.current = false;
  setStopRequested(false);

  setSimLock(true);
  console.log("▶ SimToDate ENTER:", dateStr);

  let upd = structuredClone(scheduleByDate);
  let newResults = structuredClone(resultsById);

  const sorted = Object.keys(upd).sort((a, b) => new Date(a) - new Date(b));

  const staticLeagueData = repairedLeagueData;
  const staticTeams = repairedTeams;

  try {
for (const d of sorted) {
  // ✅ allow stop between dates
  if (stopRef.current) break;

  if (d > dateStr) break;

  if (d === ALL_STAR_DATE && !allStarHandledRef.current) {
    savePlayerStats(playerStats);
    cleanupGhostGames(upd, newResults);
    saveSchedule(upd);
    saveResults(newResults);

    setScheduleByDate(structuredClone(upd));
    setResultsById(structuredClone(newResults));
    setAllStarPromptOpen(true);
    return;
  }

  const dayGames = upd[d];
  if (!Array.isArray(dayGames)) continue;

      for (let i = 0; i < dayGames.length; i++) {
        // ✅ allow stop between games
        if (stopRef.current) break;

        const g = dayGames[i];
        if (!g || g.played) continue;

        try {
          const full = await runGameWithRetries(g, staticLeagueData, staticTeams);

          // ✅ if user clicked stop while this game was running, bail after it finishes
          if (stopRef.current) break;

          // still failed → skip, leave unplayed
          if (!full) continue;

          const slim = slimResult(full);

const homeRoles = loadTeamRoleMap(g.home);
const awayRoles = loadTeamRoleMap(g.away);
          annotateSlimWithRoles(slim, homeRoles, awayRoles);

          newResults[g.id] = slim;
          saveOneResultV3(g.id, slim, g, seasonYear);

          dayGames[i] = { ...g, played: true };

          // 🔥 update player stats
          playerStats = applyGameToPlayerStats(playerStats, slim, g);

          // ✅ LIVE UI UPDATE (optional but makes it feel instant)
          setResultsById((prev) => ({ ...prev, [g.id]: slim }));
          setScheduleByDate((prev) => ({ ...prev, [d]: dayGames.slice() }));
        } catch (err) {
          console.error("[SimToDate] ERROR for game", g.id, err);
          // keep unplayed on error
        }

        // yield to browser
        await new Promise((res) => setTimeout(res, 0));
      }

      upd[d] = dayGames;
    }

    // final saves (even if stopped, we save progress)
    savePlayerStats(playerStats);
    cleanupGhostGames(upd, newResults);
    saveSchedule(upd);
    saveResults(newResults);

    setScheduleByDate(structuredClone(upd));
    setResultsById(structuredClone(newResults));
  } finally {
    setActionModal(null);
    setSimLock(false);
    console.log("◀ SimToDate EXIT:", dateStr);
  }
};




function sanitizeTeam(team) {
  if (!team) return null;

  const clean = structuredClone(team);

  // remove React garbage
  delete clean._reactInternals;
  for (const key of Object.keys(clean)) {
    if (key.startsWith("__react")) delete clean[key];
  }

  // remove anything unserializable
  for (const p of clean.players || []) {
    delete p._reactInternals;
    for (const key of Object.keys(p)) {
      if (key.startsWith("__react")) delete p[key];
    }
  }

  // load minutes
clean.minutes = readFlatMinutesFromGameplan(team.name);

  // defaults for missing attrs
  clean.strategy = clean.strategy || {};
  clean.team_ratings =
    clean.team_ratings && typeof clean.team_ratings === "object"
      ? clean.team_ratings
      : { offense: 50, defense: 50 };

  return clean;
}

async function simulateBatch(games) {
  // games = [ { id, home, away }, ... ] (clean objects)
  const results = [];

  // Run each game through queueSim + simulateOneGame
  for (const g of games) {
    const full = await queueSim(() =>
      simulateOneGame({
        homeTeam: g.home,
        awayTeam: g.away
      })
    );

    results.push(full);
  }

  return results;
}

const handleSimSeason = async () => {
  // block if already running
  if (simLock) {
    console.log("FULL SEASON blocked: simLock already true");
    return;
  }
    const {
    repairRes,
    repairedLeagueData,
    repairedTeams,
  } = await repairCpuRostersBeforeSimulation({
    leagueData,
    selectedTeam,
    setLeagueData,
  });

  const userTeamLive = repairedTeams.find((t) => t.name === selectedTeam?.name);
  const userCount = getTeamPlayerCount(userTeamLive);
if (userCount < 14) {
  openSimError(
    `${selectedTeam.name} doesn't have enough players. Minimum 14 required to simulate games.`,
    "Roster issue"
  );
  return;
}

const simBlockMessage = getSimulationBlockMessageThroughDate(
  scheduleByDate,
  repairedTeams
);
if (simBlockMessage) {
  openSimError(simBlockMessage, "Simulation blocked");
  return;
}

setActionModal(null);
setBoxModal(null);

  // ✅ reset stop state at the start of a run
  stopRef.current = false;
  setStopRequested(false);

  // start with current stats
  let playerStats = loadPlayerStats();



  setSimLock(true);
  console.log("🔥 FULL SEASON START");

  let upd = structuredClone(scheduleByDate);
  let results = structuredClone(resultsById);

  const staticLeagueData = repairedLeagueData;
  const staticTeams = repairedTeams;

  const dates = Object.keys(upd).sort();
  let gamesSimmed = 0;
  let lastDateProcessed = null;

// ✅ track if user stopped
let stopped = false;
let pausedForAllStar = false;

  try {
for (let di = 0; di < dates.length; di++) {
  if (stopRef.current) { stopped = true; break; }

  const date = dates[di];
  lastDateProcessed = date;

  if (date === ALL_STAR_DATE && !allStarHandledRef.current) {
    pausedForAllStar = true;
    break;
  }

  const dayGames = upd[date];
  if (!Array.isArray(dayGames)) {
    console.error("FULL SEASON FATAL: dayGames is not an array for", date, dayGames);
    break;
  }

      console.log(
        "📅 Processing date",
        di + 1,
        "of",
        dates.length,
        date,
        "games:",
        dayGames.length
      );

      for (let i = 0; i < dayGames.length; i++) {
        if (stopRef.current) { stopped = true; break; }

        const g = dayGames[i];
        if (!g) {
          console.error("FULL SEASON FATAL: missing game object at", date, "index", i);
          stopped = true;
          break;
        }
        if (g.played) continue;

        try {
          const full = await runGameWithRetries(g, staticLeagueData, staticTeams);
          if (!full) continue;

          if (stopRef.current) { stopped = true; break; }

          const slim = slimResult(full);

const homeRoles = loadTeamRoleMap(g.home);
const awayRoles = loadTeamRoleMap(g.away);
          annotateSlimWithRoles(slim, homeRoles, awayRoles);

          results[g.id] = slim;
          saveOneResultV3(g.id, slim, g, seasonYear);

          dayGames[i] = { ...g, played: true };
          gamesSimmed++;

          playerStats = applyGameToPlayerStats(playerStats, slim, g);

          // ✅ LIVE UI UPDATE (so W/L shows immediately, not in batches)
          setResultsById((prev) => ({ ...prev, [g.id]: slim }));
          setScheduleByDate((prev) => ({ ...prev, [date]: dayGames.slice() }));

          // yield to browser so it paints
          await new Promise((res) => setTimeout(res, 0));
        } catch (err) {
          console.error("FULL SEASON ERROR for game", g.id, err);
        }
      }

      upd[date] = dayGames;

      if (stopped) break;

      // optional: occasionally persist schedule + stats (not required for UI)
      if (gamesSimmed % 50 === 0) {
        saveSchedule(structuredClone(upd));
        savePlayerStats(playerStats);
      }
    }
  } catch (err) {
    console.error(
      "FULL SEASON FATAL outer error:",
      err,
      "lastDateProcessed:",
      lastDateProcessed
    );
  } finally {
    // persist what we have so far
    saveSchedule(upd);
    saveResults(results);
    savePlayerStats(playerStats);

setActionModal(null);
setSimLock(false);

if (pausedForAllStar) {
  setScheduleByDate(structuredClone(upd));
  setResultsById(structuredClone(results));
  setAllStarPromptOpen(true);
  return;
}

// ✅ If stopped, do NOT compute awards or navigate away
if (stopped) {
  console.log("🛑 FULL SEASON STOPPED by user at gamesSimmed:", gamesSimmed);
  return;
}

    // 🔥 compute awards from final playerStats
    try {
      // build def_rating lookup from rosters (staticTeams)
const defMap = {};
for (const t of staticTeams || []) {
  const teamName = t?.name || t?.team;
  for (const pl of t?.players || []) {
    const playerName = pl?.name || pl?.player;

    const def =
      pl?.def_rating ??
      pl?.defRating ??
      pl?.defensive_rating ??
      pl?.defensiveRating ??
      pl?.drtg ??
      pl?.defrtg;

    if (playerName && teamName && def != null && Number.isFinite(Number(def))) {
      defMap[`${playerName}__${teamName}`] = Number(def);
    }
  }
}

// build playersArray WITH def_rating attached (awards.py reads this)
const playersArray = Object.values(playerStats || {}).map((p) => {
  const key = `${p.player}__${p.team}`;
  const def = defMap[key];
  return {
    ...p,
    def_rating: Number.isFinite(Number(def)) ? Number(def) : 110,
  };
});

console.log("[Calendar] computing awards for", playersArray.length, "players");
console.log(
  "[Calendar] def_rating attached:",
  playersArray.filter(p => p.def_rating != null).length,
  "out of",
  playersArray.length
);

      console.log("[Calendar] computing awards for", playersArray.length, "players");

const teamsWithWins = buildTeamsWithWinsForAwards(staticTeams, upd, results);

console.log("[Calendar] awards teamsWithWins sample:", teamsWithWins.slice(0, 5));
console.log(
  "[Calendar] awards wins nonzero teams:",
  teamsWithWins.filter(t => (t.wins || 0) > 0).length,
  "out of",
  teamsWithWins.length
);

const awardsRaw = await computeSeasonAwards(playersArray, {
  seasonYear,
  gamesSimmed,
  teams: teamsWithWins, // ✅ THIS is what makes _team_wins non-zero
});


      const deepUnpair = (x) => {
        if (Array.isArray(x) && x.length && Array.isArray(x[0]) && x[0].length === 2) {
          return Object.fromEntries(x.map(([k, v]) => [k, deepUnpair(v)]));
        }
        if (Array.isArray(x)) return x.map(deepUnpair);
        return x;
      };

      const awards = deepUnpair(awardsRaw) || {};
      localStorage.setItem("bm_awards_latest", JSON.stringify(awards));
      localStorage.setItem("bm_awards_v1", JSON.stringify(awards));
    } catch (e) {
      console.error("[Calendar] awards computation failed:", e);
    }

    navigate("/awards");

    console.log(
      "🏁 FULL SEASON EXIT, total gamesSimmed:",
      gamesSimmed,
      "last date processed:",
      lastDateProcessed
    );
  }
};







const handleResetSeason = () => {
  if (!window.confirm("Reset season? ALL results + schedule will be wiped.")) return;

  // ✅ wipe all schedule/result/playoffs versions (so future key bumps don't break reset)
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k) continue;

if (
  k.startsWith("bm_schedule_") ||
  k.startsWith("bm_results_") ||
  k.startsWith("bm_postseason_") ||
  k.startsWith("bm_champ_") ||
  k.startsWith("bm_result_v3_") ||     // ✅ NEW
  k === "bm_results_index_v3"          // ✅ NEW
) {
  localStorage.removeItem(k);
}

  }

  clearBoxScoresFromDB().catch(() => {});

  // keep your player stats wipe
  localStorage.removeItem(PLAYER_STATS_KEY);
  allStarHandledRef.current = false;
setAllStarPromptOpen(false);
setAllStarOpen(false);
setAllStarData(null);
setShowAwardsPanel(false);
setMiniAwardTab("mvp");

  const { byDate } = generateFullSeasonSchedule(teams, seasonStart, seasonEnd);

  saveSchedule(byDate);
  saveResults({});

  const firstGameDate = Object.keys(byDate).sort()[0];
  setFocusedDate(firstGameDate);
};




/* -------------------------------------------------------------------------- */
/*                                    UI                                      */
/* -------------------------------------------------------------------------- */
if (!leagueData) {
  return <div className="text-white p-6">Loading league...</div>;
}
if (!selectedTeam) {
  return (
    <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center justify-center">
      <p>No team selected.</p>
      <button
        className="mt-4 px-4 py-2 bg-orange-600 rounded"
        onClick={() => navigate("/team-selector")}
      >
        Pick a Team
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                      HEADER (Season / Record / Standings)                  */
/* -------------------------------------------------------------------------- */
const confByTeam = useMemo(() => {
  const map = {};
  const confs = leagueData?.conferences || {};
  for (const [conf, arr] of Object.entries(confs)) {
    for (const t of arr || []) {
      if (t?.name) map[t.name] = conf;
    }
  }
  return map;
}, [leagueData]);

const teamAgg = useMemo(() => {
  const totals = {};
  const ensure = (teamName) => {
    if (!totals[teamName]) {
      totals[teamName] = { team: teamName, w: 0, l: 0, gp: 0, pf: 0, pa: 0 };
    }
    return totals[teamName];
  };

  for (const games of Object.values(scheduleByDate || {})) {
    for (const g of games || []) {
      if (!g?.played) continue;
      const r = resultsById?.[g.id];
      if (!r?.totals) continue;

      const homeName = g.home;
      const awayName = g.away;

      const homePts = Number(r.totals.home ?? 0);
      const awayPts = Number(r.totals.away ?? 0);

      const homeRow = ensure(homeName);
      const awayRow = ensure(awayName);

      homeRow.gp += 1;
      awayRow.gp += 1;

      homeRow.pf += homePts;
      homeRow.pa += awayPts;

      awayRow.pf += awayPts;
      awayRow.pa += homePts;

      if (homePts > awayPts) {
        homeRow.w += 1;
        awayRow.l += 1;
      } else if (awayPts > homePts) {
        awayRow.w += 1;
        homeRow.l += 1;
      }
    }
  }

  return totals;
}, [scheduleByDate, resultsById]);

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const headerInfo = useMemo(() => {
  const seasonLabel = `${seasonYear}-${seasonYear + 1}`;

  const myName = selectedTeam?.name;
  const myConf = confByTeam?.[myName] || "";

  const myRow = teamAgg?.[myName] || { w: 0, l: 0, gp: 0, pf: 0, pa: 0 };
  const w = myRow.w || 0;
  const l = myRow.l || 0;

  // standings in conference (pct desc, then diff desc)
  const confTeams = Object.keys(confByTeam || {}).filter((t) => confByTeam[t] === myConf);
  const rows = confTeams.map((t) => {
    const r = teamAgg?.[t] || { w: 0, l: 0, gp: 0, pf: 0, pa: 0 };
    const gp = (r.w || 0) + (r.l || 0);
    const pct = gp > 0 ? (r.w / gp) : 0;
    const diff = (r.pf || 0) - (r.pa || 0);
    return { team: t, w: r.w || 0, l: r.l || 0, pct, diff };
  });

  rows.sort((a, b) => b.pct - a.pct || b.diff - a.diff);
  const confRank = myName ? (rows.findIndex((x) => x.team === myName) + 1) : 0;

  // Off/Def ranks in league (Off: PF/G desc, Def: PA/G asc)
  const leagueTeams = Object.keys(confByTeam || {});
  const offRows = leagueTeams.map((t) => {
    const r = teamAgg?.[t] || { pf: 0, pa: 0, gp: 0, w: 0, l: 0 };
    const gp = r.gp || ((r.w || 0) + (r.l || 0)) || 0;
    const pfpg = gp > 0 ? (r.pf / gp) : 0;
    return { team: t, val: pfpg };
  }).sort((a, b) => b.val - a.val);

  const defRows = leagueTeams.map((t) => {
    const r = teamAgg?.[t] || { pf: 0, pa: 0, gp: 0, w: 0, l: 0 };
    const gp = r.gp || ((r.w || 0) + (r.l || 0)) || 0;
    const papg = gp > 0 ? (r.pa / gp) : 0;
    return { team: t, val: papg };
  }).sort((a, b) => a.val - b.val);

  const offRank = myName ? (offRows.findIndex((x) => x.team === myName) + 1) : 0;
  const defRank = myName ? (defRows.findIndex((x) => x.team === myName) + 1) : 0;

  return {
    seasonLabel,
    w,
    l,
    conf: myConf,
    confRank,
    offRank,
    defRank,
  };
}, [seasonYear, selectedTeam, confByTeam, teamAgg]);

const conferenceStandings = useMemo(() => {
  const rows = teams.map((t) => {
    const agg = teamAgg?.[t.name] || { w: 0, l: 0, pf: 0, pa: 0 };
    const gp = (agg.w || 0) + (agg.l || 0);

    return {
      team: t.name,
      conf: String(confByTeam?.[t.name] || ""),
      logo:
        t.logo ||
        t.teamLogo ||
        t.newTeamLogo ||
        t.logoUrl ||
        t.image ||
        t.img ||
        "",
      w: agg.w || 0,
      l: agg.l || 0,
      pct: gp > 0 ? agg.w / gp : 0,
      diff: (agg.pf || 0) - (agg.pa || 0),
    };
  });

  const sorter = (a, b) =>
    b.pct - a.pct || b.diff - a.diff || a.team.localeCompare(b.team);

  return {
    west: rows
      .filter((row) => row.conf.toLowerCase() === "west")
      .sort(sorter),
    east: rows
      .filter((row) => row.conf.toLowerCase() === "east")
      .sort(sorter),
  };
}, [teams, teamAgg, confByTeam]);

const livePlayerStats = useMemo(() => {
  return loadPlayerStats();
}, [scheduleByDate, resultsById]);

const miniAwardLadders = useMemo(() => {
  return buildMiniAwardLadders(
    teams,
    livePlayerStats,
    scheduleByDate,
    resultsById
  );
}, [teams, livePlayerStats, scheduleByDate, resultsById]);

const cycleMiniAwardTab = (dir) => {
  setMiniAwardTab((prev) => {
    const i = MINI_AWARD_TABS.indexOf(prev);
    if (i === -1) return "mvp";

    if (dir === "next") {
      return MINI_AWARD_TABS[(i + 1) % MINI_AWARD_TABS.length];
    }

    return MINI_AWARD_TABS[
      (i - 1 + MINI_AWARD_TABS.length) % MINI_AWARD_TABS.length
    ];
  });
};

/* -------------------------------------------------------------------------- */
/*                               CALENDAR GRID                                */
/* -------------------------------------------------------------------------- */
const actionModalBlockMessage = actionModal
  ? getSimulationBlockMessageForGame(actionModal.game, teams)
  : "";
return (
  <div
    className="relative h-screen overflow-hidden text-white py-2"
    style={{
      background: `
        repeating-linear-gradient(45deg, rgba(255,255,255,0.045) 0 1px, transparent 1px 28px),
        repeating-linear-gradient(-45deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 22px),
        radial-gradient(circle at 50% 30%, #2b2b2b 0%, #0d0d0d 80%)
      `,
    }}
  >
    <div
      className="pointer-events-none absolute -inset-[120px] z-0"
      style={{
        backgroundImage: `
          conic-gradient(from 210deg at 18% 22%,
            rgba(255,255,255,0.16) 0deg,
            rgba(255,255,255,0.08) 14deg,
            rgba(255,255,255,0.00) 36deg 360deg),
          conic-gradient(from 30deg at 82% 78%,
            rgba(255,255,255,0.14) 0deg,
            rgba(255,255,255,0.07) 16deg,
            rgba(255,255,255,0.00) 38deg 360deg)
        `,
        backgroundRepeat: "no-repeat, no-repeat",
        backgroundSize: "760px 760px, 700px 700px",
        backgroundPosition: "left -120px top -80px, right -90px bottom -60px",
        filter: "blur(20px)",
        opacity: 0.26,
      }}
    />



<style>
  {`
    @keyframes calendarBgDrift {
      0% { transform: translate(0, 0) rotate(0deg); }
      50% { transform: translate(-100px, -60px) rotate(1deg); }
      100% { transform: translate(0, 0) rotate(0deg); }
    }

    .orange-scrollbar {
      scrollbar-width: auto;
      scrollbar-color: #f97316 #171717;
    }

    .orange-scrollbar::-webkit-scrollbar {
      width: 16px;
      height: 16px;
    }

    .orange-scrollbar::-webkit-scrollbar-track {
      background: #171717;
      border-radius: 8px;
    }

    .orange-scrollbar::-webkit-scrollbar-thumb {
      background: #f97316;
      border-radius: 6px;
      border: 2px solid #171717;
    }

    .orange-scrollbar::-webkit-scrollbar-thumb:hover {
      background: #ea580c;
    }

    .standings-scrollbar {
      scrollbar-width: none;
    }

    .group:hover .standings-scrollbar {
      scrollbar-width: auto;
      scrollbar-color: #f97316 #171717;
    }

    .standings-scrollbar::-webkit-scrollbar {
      width: 0px;
      height: 0px;
    }

    .group:hover .standings-scrollbar::-webkit-scrollbar {
      width: 16px;
      height: 16px;
    }

    .group:hover .standings-scrollbar::-webkit-scrollbar-track {
      background: #171717;
      border-radius: 8px;
    }

    .group:hover .standings-scrollbar::-webkit-scrollbar-thumb {
      background: #f97316;
      border-radius: 6px;
      border: 2px solid #171717;
    }

    .group:hover .standings-scrollbar::-webkit-scrollbar-thumb:hover {
      background: #ea580c;
    }
  `}
</style>
    <MiniStandingsPanel
      title="West"
      rows={conferenceStandings.west}
      selectedTeamName={selectedTeam.name}
      hidden={!showWestStandings}
      onToggle={() => setShowWestStandings((v) => !v)}
      collapsedLabel="Show West"
      side="left"
    />

<MiniStandingsPanel
  title="East"
  rows={conferenceStandings.east}
  selectedTeamName={selectedTeam.name}
  hidden={!showEastStandings}
  onToggle={() => setShowEastStandings((v) => !v)}
  collapsedLabel="Show East"
  side="right"
  awardsEnabled={true}
  showAwards={showAwardsPanel}
  onToggleAwards={() => setShowAwardsPanel((v) => !v)}
  awardTab={miniAwardTab}
  awardRows={miniAwardLadders[miniAwardTab] || []}
  onPrevAward={() => cycleMiniAwardTab("prev")}
  onNextAward={() => cycleMiniAwardTab("next")}
/>

<div
  className="relative z-10 max-w-6xl mx-auto px-4 h-full flex flex-col"
  style={{
    zoom: CALENDAR_SCALE,
    transformOrigin: "top center",
  }}
>
        {/* HEADER */}
        {/* HEADER */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          {/* left: team switch + logo + name */}
          <div className="flex items-center gap-4">
            <button
              className="text-2xl hover:text-orange-400"
              onClick={() => handleTeamSwitch("prev")}
            >
              ◄
            </button>
            <button
              className="text-2xl hover:text-orange-400"
              onClick={() => handleTeamSwitch("next")}
            >
              ►
            </button>

            <div className="flex items-center gap-3">
              <Logo team={selectedTeam} size={72} />
              <h1 className="text-2xl font-bold text-orange-500">
                {selectedTeam.name}
              </h1>
            </div>
          </div>

          {/* right: controls */}
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-2 bg-neutral-700 rounded"
              onClick={() => navigate("/team-hub")}
            >
              Team Hub
            </button>
            {simLock && (
  <>
    <button
      className="px-3 py-2 bg-neutral-600 rounded opacity-80 cursor-not-allowed"
      disabled
      title="Simulation in progress"
    >
      Simulating…
    </button>

    <button
      className={`px-3 py-2 rounded ${stopRequested ? "bg-yellow-900 opacity-70 cursor-not-allowed" : "bg-yellow-600"}`}
      disabled={stopRequested}
      onClick={requestStop}
      title="Stop simulation"
    >
      {stopRequested ? "Stopping…" : "Stop"}
    </button>
  </>
)}

<button
  className="px-3 py-2 bg-red-700 rounded"
  onClick={handleResetSeason}
>
  Reset Season
</button>


            

                        {/* Month navigation */}
            <button
              className="px-3 py-2 bg-neutral-700 rounded"
              onClick={() => {
                const i = months.indexOf(month);
                if (i > 0) scrollToMonth(months[i - 1]);
              }}
            >
              ‹ Prev
            </button>
            <select
              value={month}
              onChange={(e) => scrollToMonth(e.target.value)}
              className="px-3 py-2 bg-neutral-800 rounded"
            >
              {months.map((m) => {
                const [y, mm] = m.split("-").map(Number);
                const dt = new Date(y, mm - 1, 1);
                return (
                  <option key={m} value={m}>
                    {dt.toLocaleString("default", {
                      month: "long",
                      year: "numeric",
                    })}
                  </option>
                );
              })}
            </select>
            <button
              className="px-3 py-2 bg-neutral-700 rounded"
              onClick={() => {
                const i = months.indexOf(month);
                if (i < months.length - 1) scrollToMonth(months[i + 1]);
              }}
            >
              Next ›
            </button>
          </div>
        </div>

        {/* BANNER */}
        <div className="mb-4 px-4 py-2 bg-neutral-800 rounded-xl border-2 border-white">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-semibold text-gray-200">
              Season {headerInfo.seasonLabel}
            </span>

            <span className="text-gray-400">•</span>

            <span className="text-gray-200">
              Record{" "}
              <span className="font-bold text-green-400">{headerInfo.w}</span>
              <span className="text-gray-300">-</span>
              <span className="font-bold text-red-400">{headerInfo.l}</span>
            </span>

            <span className="text-gray-400">•</span>

            <span className="text-gray-200">
              {headerInfo.confRank ? `${ordinal(headerInfo.confRank)} in ${headerInfo.conf}` : `— in ${headerInfo.conf || "—"}`}
            </span>

            <span className="text-gray-400">•</span>

            <span className="text-gray-200">
              Off Rank {headerInfo.offRank ? `#${headerInfo.offRank}` : "—"}
            </span>

            <span className="text-gray-400">•</span>

            <span className="text-gray-200">
              Def Rank {headerInfo.defRank ? `#${headerInfo.defRank}` : "—"}
            </span>
          </div>
        </div>

        {/* SCROLLABLE CALENDAR AREA */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-2 orange-scrollbar">
          <div className="space-y-6 pb-6">
            {months.map((monthStr) => {
              const monthDays = visibleDaysByMonth[monthStr] || [];
              const [y, m] = monthStr.split("-").map(Number);
              const monthDate = new Date(y, m - 1, 1);
              const isSelectedMonth = month === monthStr;

              return (
                <div
                  key={monthStr}
                  ref={(el) => {
                    monthRefs.current[monthStr] = el;
                  }}
className={`rounded-xl border-2 p-3 transition-colors duration-200 ${
  isSelectedMonth
    ? "border-orange-500 ring-1 ring-orange-500/60"
    : "border-white/70 hover:border-orange-500"
}`}
                >
                  <div className="mb-3">
                    <h2
                      className={`text-xl font-bold ${
                        isSelectedMonth ? "text-orange-400" : "text-gray-200"
                      }`}
                    >
                      {monthDate.toLocaleString("default", {
                        month: "long",
                        year: "numeric",
                      })}
                    </h2>
                  </div>

                  <div className="grid grid-cols-7 text-center text-gray-400 mb-2">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => (
                      <div key={w}>{w}</div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {monthDays.map((d, idx) => {
                      if (!d) {
                        return (
                          <div
                            key={"pad-" + monthStr + "-" + idx}
                            className="h-28 bg-neutral-800/40 rounded border border-neutral-800"
                          />
                        );
                      }

                      const dateStr = fmt(d);
                      const game = myGames[dateStr];
                      const result = game ? resultsById[game.id] : null;

                      const finalScore =
                        game && game.played && result
                          ? `${result.totals?.home}-${result.totals?.away}`
                          : null;

                      const iAmHome =
                        game && game.homeId === slugifyId(selectedTeam.name);

                      const winnerSide = result?.winner?.side || null;

                      const outcome =
                        game && game.played && winnerSide && winnerSide !== "tie"
                          ? winnerSide === (iAmHome ? "home" : "away")
                            ? "W"
                            : "L"
                          : null;

                      return (
                        <div
                          key={monthStr + "-" + dateStr}
                          className={`relative h-28 p-2 rounded border cursor-pointer overflow-visible ${
                            game
                              ? iAmHome
                                ? "border-blue-400"
                                : "border-red-400"
                              : "border-neutral-700"
                          } bg-neutral-850 hover:bg-neutral-700`}
                          onClick={() => {
                            setFocusedDate(dateStr);
                            setMonth(monthStr);
                            if (game) setActionModal({ dateStr, game });
                          }}
                        >
                          <div className="text-xs text-gray-400">{d.getDate()}</div>

                          {game && (
                            <div className="mt-2 flex items-center gap-2 overflow-visible">
                              <div className="shrink-0">
                                <Logo
                                  team={{
                                    name: iAmHome ? game.away : game.home,
                                    logo: iAmHome ? game.awayLogo : game.homeLogo,
                                  }}
                                  size={26}
                                />
                              </div>

                              <span className="text-sm">
                                {iAmHome ? game.away : game.home}
                              </span>
                            </div>
                          )}

                          {game && game.played && outcome && (
                            <div
                              className={`absolute bottom-2 left-2 text-[11px] font-bold px-2 py-1 rounded ${
                                outcome === "W" ? "bg-green-700" : "bg-red-700"
                              }`}
                            >
                              {outcome}
                            </div>
                          )}

                          {game && game.played && finalScore && (
                            <div className="absolute bottom-2 right-2 text-[11px] bg-green-700 px-2 py-1 rounded">
                              Final {finalScore}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
                  </div>

{/* ---------------------------- ACTION MODAL ---------------------------- */}
{actionModal &&
  createPortal(
    <div
      className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4"
      onClick={() => setActionModal(null)}
    >
      <div
        className="w-full max-w-[500px] rounded-xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-bold text-white">
          {actionModal.game.away} @ {actionModal.game.home}
        </h2>

        {!actionModal.game.played ? (
          <div className="flex flex-col gap-2">
            <button
              className="px-4 py-2 bg-neutral-700 rounded hover:bg-neutral-600"
              onClick={() =>
                handleSimOnlyGame(actionModal.dateStr, actionModal.game)
              }
            >
              Simulate this game
            </button>

<button
  className={`px-4 py-2 rounded transition ${
    selectedTeamCanSim
      ? "bg-orange-600 hover:bg-orange-500"
      : "bg-orange-600 hover:bg-orange-500 ring-1 ring-orange-300/30"
  }`}
  onClick={() => handleSimToDate(actionModal.dateStr)}
  title={
    !selectedTeamCanSim
      ? `${selectedTeam.name} doesn't have enough players. Minimum 5 required to simulate games.`
      : ""
  }
>
  Simulate to this date
</button>

<button
  className={`px-4 py-2 rounded transition ${
    selectedTeamCanSim
      ? "bg-blue-600 hover:bg-blue-500"
      : "bg-blue-600 hover:bg-blue-500 ring-1 ring-blue-300/30"
  }`}
  onClick={handleSimSeason}
  title={
    !selectedTeamCanSim
      ? `${selectedTeam.name} doesn't have enough players. Minimum 5 required to simulate games.`
      : ""
  }
>
  Simulate full season
</button>

            <button
              className="px-4 py-2 bg-neutral-700 rounded hover:bg-neutral-600"
              onClick={() => setActionModal(null)}
            >
              Close
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <button
              className="px-4 py-2 bg-neutral-700 rounded hover:bg-neutral-600"
              onClick={() => openBoxScoreForGame(actionModal.game)}
            >
              View Box Score
            </button>

            <button
              className="px-4 py-2 bg-neutral-700 rounded hover:bg-neutral-600"
              onClick={() => setActionModal(null)}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )}

{/* ---------------------------- SIM ERROR MODAL ---------------------------- */}
{simErrorModal &&
  createPortal(
    <div
      className="fixed inset-0 z-[205] bg-black/75 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={() => setSimErrorModal(null)}
    >
      <div
        className="w-full max-w-[460px] rounded-2xl border border-orange-500/40 bg-neutral-900 shadow-[0_0_30px_rgba(0,0,0,0.55)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-orange-500/20 bg-gradient-to-r from-orange-600/20 to-red-500/10 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-orange-400/40 bg-orange-500/15 text-xl">
              !
            </div>

            <div>
              <h3 className="text-lg font-bold text-white">
                {simErrorModal.title || "Cannot simulate"}
              </h3>
              <p className="text-sm text-orange-200/80">
                Fix the roster issue before continuing
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="rounded-xl border border-neutral-700 bg-neutral-850 px-4 py-3 text-sm leading-6 text-neutral-200">
            {simErrorModal.message}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              className="px-4 py-2 rounded-lg bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
              onClick={() => setSimErrorModal(null)}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )}

{/* ---------------------------- BOX SCORE MODAL ---------------------------- */}
{boxModal &&
  createPortal(
    <div
      className="fixed inset-0 z-[210] bg-black/70 flex items-center justify-center p-4"
      onClick={() => setBoxModal(null)}
    >
      <div
        className="w-full max-w-[880px] max-h-[90vh] overflow-auto rounded-xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex justify-between">
          <h3 className="text-xl font-bold">
            {boxModal.game.away} @ {boxModal.game.home} •{" "}
            {boxModal.result?.winner?.score}
            {boxModal.result?.winner?.ot ? " (OT)" : ""}
          </h3>

          <button
            className="px-2 py-1 bg-neutral-700 rounded hover:bg-neutral-600"
            onClick={() => setBoxModal(null)}
          >
            Close
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {["away", "home"].map((side) => {
            const name =
              side === "away" ? boxModal.game.away : boxModal.game.home;
            const rows = boxModal.result.box?.[side] || [];

            return (
              <div key={side} className="bg-neutral-800 p-3 rounded-lg">
                <h4 className="font-bold mb-2">{name}</h4>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b border-neutral-700">
                      <th className="py-1">Player</th>
                      <th>MIN</th>
                      <th>PTS</th>
                      <th>REB</th>
                      <th>AST</th>
                      <th>STL</th>
                      <th>BLK</th>
                      <th>FG</th>
                      <th>3P</th>
                      <th>FT</th>
                      <th>TO</th>
                      <th>PF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p, i) => (
                      <tr key={i} className="border-b border-neutral-800">
                        <td className="py-1">{p.player}</td>
                        <td>{p.min}</td>
                        <td>{p.pts}</td>
                        <td>{p.reb}</td>
                        <td>{p.ast}</td>
                        <td>{p.stl}</td>
                        <td>{p.blk}</td>
                        <td>{p.fg}</td>
                        <td>{p["3p"]}</td>
                        <td>{p.ft}</td>
                        <td>{p.to}</td>
                        <td>{p.pf}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  )}
{allStarPromptOpen && (
  <div className="fixed inset-0 z-[235] flex items-center justify-center bg-black/75 p-4">
    <div className="w-full max-w-xl rounded-2xl border border-white/15 bg-neutral-900 p-6 text-white shadow-2xl">
      <h2 className="text-2xl font-bold text-orange-400">All-Star Weekend</h2>

      <p className="mt-3 text-sm text-neutral-300">
        It is now All-Star Weekend. Would you like to pause and view the
        All-Star teams?
      </p>

      <div className="mt-6 flex justify-end gap-3">
        <button
          className="rounded-lg bg-neutral-700 px-4 py-2 font-semibold text-white hover:bg-neutral-600"
          onClick={() => {
            allStarHandledRef.current = true;
            setAllStarPromptOpen(false);
          }}
        >
          Not Now
        </button>

        <button
          className="rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white hover:bg-orange-500"
          onClick={openAllStarTeams}
        >
          View All-Stars
        </button>
      </div>
    </div>
  </div>
)}

<AllStars
  open={allStarOpen}
  data={allStarData}
  onClose={() => setAllStarOpen(false)}
/>
    </div>
  );
}