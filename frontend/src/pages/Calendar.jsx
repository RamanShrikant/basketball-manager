
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";
import { simulateOneGame } from "@/api/simEnginePy";
import { computeSeasonAwards } from "@/api/simEnginePy";
import { queueSim } from "@/api/simQueue";
import LZString from "lz-string";
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


/* -------------------------------------------------------------------------- */
/*                              SIMULATION WRAPPER                             */
/* -------------------------------------------------------------------------- */
async function simOneSafe(game, leagueData, teams) {
  const p = (async () => {
// inside simOneSafe
    if (window.__debugSimLogs) {
      window.__lastGame = game;
      console.log("⏳ simOneSafe starting:", game.home, "vs", game.away);
    }

    const homeTeamObj = teams.find(
      (t) => slugifyId(t.name) === game.homeId
    );
    const awayTeamObj = teams.find(
      (t) => slugifyId(t.name) === game.awayId
    );

    if (!homeTeamObj || !awayTeamObj) {
      throw new Error(
        `Team lookup failed: ${game.homeId} / ${game.awayId}`
      );
    }

    // -------------------------------
    // 🔥 SANITIZE SECONDARY POSITIONS
    // -------------------------------
    for (const p of homeTeamObj.players) {
      if (!p.secondaryPos || p.secondaryPos.trim() === "") {
        p.secondaryPos = null;
      }
    }
    for (const p of awayTeamObj.players) {
      if (!p.secondaryPos || p.secondaryPos.trim() === "") {
        p.secondaryPos = null;
      }
    }
    // -------------------------------

homeTeamObj.minutes = JSON.parse(
  localStorage.getItem(`gameplan_${homeTeamObj.name}`) || "{}"
);

awayTeamObj.minutes = JSON.parse(
  localStorage.getItem(`gameplan_${awayTeamObj.name}`) || "{}"
);



    return await simulateOneGame({
      homeTeam: homeTeamObj,
      awayTeam: awayTeamObj,
      leagueData,
    });
  })();

  // timeout promise
return p;

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
      c % 2 === 0 ? [...single, ...mirrored] : [...single, ...mirrored].reverse();
    for (const rd of pack) rounds.push(rd.map((g) => ({ ...g })));
  }

  for (let i = 0; i < remainingPerTeam; i++) {
    const base = i % 2 === 0 ? single : mirrored;
    rounds.push(base[i % base.length].map((g) => ({ ...g })));
  }

  const days = rangeDays(startDate, endDate);
  const D = days.length;
  const byDate = {};

  const teamGames = Object.fromEntries(
    canonicalIds.map((id) => [id, 0])
  );

function placeGame(game, dayIndex) {
  const dateStr = fmt(days[dayIndex]);

  // ensure no team already plays this day
  const todaysGames = byDate[dateStr] || [];
  if (todaysGames.some(g =>
    g.homeId === game.home ||
    g.awayId === game.home ||
    g.homeId === game.away ||
    g.awayId === game.away
  )) {
    return false; // can't play here
  }

  // team game caps
  if (teamGames[game.home] >= target) return false;
  if (teamGames[game.away] >= target) return false;

  const idx = todaysGames.length;
  byDate[dateStr] = [...todaysGames, {
    id: `${dateStr}_${game.home}_vs_${game.away}_${idx}`,
    date: dateStr,
    homeId: game.home,
    awayId: game.away,
    home: byCanon[game.home].name,
    away: byCanon[game.away].name,
    homeLogo: byCanon[game.home].logo,
    awayLogo: byCanon[game.away].logo,
    homeTeamObj: byCanon[game.home],
    awayTeamObj: byCanon[game.away],
    played: false
  }];

  teamGames[game.home]++;
  teamGames[game.away]++;
  return true;
}


  let dayPointer = 0;

  for (const rd of rounds) {
    for (const g of rd) {
      while (!placeGame(g, dayPointer)) {
        dayPointer = (dayPointer + 1) % D;
      }
      dayPointer = (dayPointer + 1) % D;
    }
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


/* -------------------------------------------------------------------------- */
/*                           MAIN CALENDAR COMPONENT                          */
/* -------------------------------------------------------------------------- */
export default function Calendar() {
  
  const navigate = useNavigate();
  const { leagueData, selectedTeam, setSelectedTeam } = useGame();
  console.log("🔥 Calendar leagueData =", leagueData);
  window.__leagueData = leagueData;



  /* -------------------------------- Season Window ------------------------------- */
  const today = new Date();
  const seasonYear =
    today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;

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
    console.warn("[ResultsV3] failed saving index", e);
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

function saveOneResultV3(gameId, slim) {
  try {
    const json = JSON.stringify(slim);
    const compressed = LZString.compressToUTF16(json);
    localStorage.setItem(resultV3Key(gameId), compressed);

    // update index (small + fast)
    const ids = loadResultsIndexV3();
    if (!ids.includes(gameId)) {
      ids.push(gameId);
      saveResultsIndexV3(ids);
    }
  } catch (e) {
    console.error("[ResultsV3] failed saving game", gameId, e);
  }
}

function deleteOneResultV3(gameId) {
  try {
    localStorage.removeItem(resultV3Key(gameId));
    const ids = loadResultsIndexV3().filter((id) => id !== gameId);
    saveResultsIndexV3(ids);
  } catch {}
}

function clearAllResultsV3() {
  try {
    const ids = loadResultsIndexV3();
    for (const id of ids) localStorage.removeItem(resultV3Key(id));
    localStorage.removeItem(RESULT_V3_INDEX_KEY);
  } catch {}
}

// One-time migration: bm_results_v2 blob -> per-game v3
function migrateResultsV2BlobToV3IfNeeded() {
  try {
    const blob = localStorage.getItem(RESULT_V2_BLOB_KEY);
    if (!blob) return;

    // If v3 already exists, don’t re-migrate.
    const existing = loadResultsIndexV3();
    if (existing.length > 0) return;

    const decompressed = LZString.decompressFromUTF16(blob);
    const json = decompressed || blob;
    const obj = JSON.parse(json) || {};
    const ids = Object.keys(obj);

    for (const id of ids) {
      // store exactly what you already saved (includes box scores)
      const slim = obj[id];
      if (slim) {
        const c = LZString.compressToUTF16(JSON.stringify(slim));
        localStorage.setItem(resultV3Key(id), c);
      }
    }

    saveResultsIndexV3(ids);

    // optional: remove old blob to free space + avoid confusion
    // localStorage.removeItem(RESULT_V2_BLOB_KEY);

    console.log("[ResultsV3] migrated", ids.length, "games from v2 blob");
  } catch (e) {
    console.warn("[ResultsV3] migration failed", e);
  }
}

// Load ALL results (used on startup). Still includes EVERY box score.
function loadAllResultsV3() {
  const ids = loadResultsIndexV3();
  const out = {};
  for (const id of ids) {
    const r = loadOneResultV3(id);
    if (r) out[id] = r;
  }
  return out;
}


function loadResults() {
  // migrate old blob once (keeps all saved box scores)
  migrateResultsV2BlobToV3IfNeeded();
  return loadAllResultsV3();
}


  function loadPlayerStats() {
    try {
      return JSON.parse(localStorage.getItem(PLAYER_STATS_KEY)) || {};
    } catch {
      return {};
    }
  }

  function savePlayerStats(stats) {
    localStorage.setItem(PLAYER_STATS_KEY, JSON.stringify(stats));
  }


function parsePair(s) {
  const [m, a] = String(s || "0-0").split("-").map(Number);
  return { m: m || 0, a: a || 0 };
}
// ------------------------------------------------------------
// SIXTH MAN ROLE HELPERS (starter vs sixth vs bench)
// ------------------------------------------------------------
function loadTeamMinutes(teamName) {
  try {
    return JSON.parse(localStorage.getItem(`gameplan_${teamName}`) || "{}");
  } catch {
    return {};
  }
}

// Uses OBJECT KEY ORDER (your saved gameplan preserves rotation order)
// first 5 keys => starters, 6th key => sixth_man, rest => bench
function buildRoleMapFromMinutes(minutesObj) {
  const entries = Object.entries(minutesObj || {}).filter(
    ([, m]) => Number(m) > 0
  );

  const names = entries.map(([name]) => name); // preserves order
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
    localStorage.setItem(SCHED_KEY, JSON.stringify(obj));
  };


function saveResults(results) {
  // keep React state in sync
  setResultsById(results);

  // bulk write (slower than per-game, but fine for end-of-sim / rebuild cases)
  try {
    const ids = Object.keys(results || {});
    for (const id of ids) {
      const slim = results[id];
      if (slim) {
        localStorage.setItem(resultV3Key(id), LZString.compressToUTF16(JSON.stringify(slim)));
      }
    }
    saveResultsIndexV3(ids);
  } catch (e) {
    console.error("[ResultsV3] bulk save failed", e);
  }
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

  const visibleDays = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const last = new Date(y, m, 0);
    const days = rangeDays(first, last);
    const pad = first.getDay();

    const padded = Array(pad).fill(null).concat(days);
    while (padded.length % 7 !== 0) padded.push(null);
    return padded;
  }, [month]);

  /* -------------------------------------------------------------------------- */
  /*                                 Action Modals                               */
  /* -------------------------------------------------------------------------- */
const [boxModal, setBoxModal] = useState(null);
const [actionModal, setActionModal] = useState(null);
const [simLock, setSimLock] = useState(false);

// ✅ stop control (ADD THIS)
const stopRef = useRef(false);
const [stopRequested, setStopRequested] = useState(false);

const requestStop = () => {
  if (!simLock) return;
  stopRef.current = true;
  setStopRequested(true);
  console.log("[Sim] stop requested");
};


/* -------------------------------------------------------------------------- */
/*                           SIMULATION HANDLERS                               */
/* -------------------------------------------------------------------------- */
const handleSimOnlyGame = async (dateStr, game) => {
  const upd = { ...scheduleByDate };
  const newResults = { ...resultsById };

  const full = await runGameWithRetries(game, leagueData, teams);

  if (!full) {
    // still bad after retries → leave game unplayed so user can try again later
    console.error("[SimOnly] Could not get a valid result for game", game.id);
    return;
  }

  const result = slimResult(full);
  const homeRoles = buildRoleMapFromMinutes(loadTeamMinutes(game.home));
  const awayRoles = buildRoleMapFromMinutes(loadTeamMinutes(game.away));
  annotateSlimWithRoles(result, homeRoles, awayRoles);


  upd[dateStr] = upd[dateStr].map((g) =>
    g.id === game.id ? { ...g, played: true } : g
  
  );
  

  newResults[game.id] = result;
  let playerStats = loadPlayerStats();
playerStats = applyGameToPlayerStats(playerStats, result, game);
savePlayerStats(playerStats);


saveSchedule(upd);

// ✅ save this one game to per-game storage
saveOneResultV3(game.id, result);

// ✅ keep UI state in sync instantly
setResultsById((prev) => ({ ...prev, [game.id]: result }));

setActionModal(null);
setBoxModal({ game, result });


};

const handleSimToDate = async (dateStr) => {
  // start from whatever is already in storage
  let playerStats = loadPlayerStats();

  if (simLock) return;

  // ✅ reset stop state at the start of THIS run
  stopRef.current = false;
  setStopRequested(false);

  setSimLock(true);
  console.log("▶ SimToDate ENTER:", dateStr);

  let upd = structuredClone(scheduleByDate);
  let newResults = structuredClone(resultsById);

  const sorted = Object.keys(upd).sort((a, b) => new Date(a) - new Date(b));

  const staticLeagueData = leagueData;
  const staticTeams = teams;

  try {
    for (const d of sorted) {
      // ✅ allow stop between dates
      if (stopRef.current) break;

      if (d > dateStr) break;

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

          const homeRoles = buildRoleMapFromMinutes(loadTeamMinutes(g.home));
          const awayRoles = buildRoleMapFromMinutes(loadTeamMinutes(g.away));
          annotateSlimWithRoles(slim, homeRoles, awayRoles);

          newResults[g.id] = slim;
          saveOneResultV3(g.id, slim);

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
  const key = `gameplan_${team.name}`;
  try {
    clean.minutes = JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    clean.minutes = {};
  }

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

  // ✅ reset stop state at the start of a run
  stopRef.current = false;
  setStopRequested(false);

  // start with current stats
  let playerStats = loadPlayerStats();

  try {
    console.log("Clearing old results before full season sim");
    clearAllResultsV3();
    try { localStorage.removeItem(RESULT_V2_BLOB_KEY); } catch {}
  } catch (e) {
    console.warn("Could not clear old results", e);
  }

  setSimLock(true);
  console.log("🔥 FULL SEASON START");

  let upd = structuredClone(scheduleByDate);
  let results = structuredClone(resultsById);

  const staticLeagueData = leagueData;
  const staticTeams = teams;

  const dates = Object.keys(upd).sort();
  let gamesSimmed = 0;
  let lastDateProcessed = null;

  // ✅ track if user stopped
  let stopped = false;

  try {
    for (let di = 0; di < dates.length; di++) {
      if (stopRef.current) { stopped = true; break; }

      const date = dates[di];
      lastDateProcessed = date;

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

          const homeRoles = buildRoleMapFromMinutes(loadTeamMinutes(g.home));
          const awayRoles = buildRoleMapFromMinutes(loadTeamMinutes(g.away));
          annotateSlimWithRoles(slim, homeRoles, awayRoles);

          results[g.id] = slim;
          saveOneResultV3(g.id, slim);

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

    // ✅ If stopped, do NOT compute awards or navigate away
    if (stopped) {
      console.log("🛑 FULL SEASON STOPPED by user at gamesSimmed:", gamesSimmed);
      return;
    }

    // 🔥 compute awards from final playerStats
    try {
      const playersArray = Object.values(playerStats || {});
      console.log("[Calendar] computing awards for", playersArray.length, "players");

      const awardsRaw = await computeSeasonAwards(playersArray, {
        seasonYear,
        gamesSimmed,
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

  // keep your player stats wipe
  localStorage.removeItem(PLAYER_STATS_KEY);

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

const bannerText = (() => {
  if (!focusedDate) return "";
  const g = myGames[focusedDate];
  if (g) {
    const isHome = g.homeId === slugifyId(selectedTeam.name);
    return `GAME DAY: ${isHome ? g.away : selectedTeam.name} @ ${
      isHome ? selectedTeam.name : g.home
    }`;
  }
  return focusedDate;
})();

/* -------------------------------------------------------------------------- */
/*                               CALENDAR GRID                                */
/* -------------------------------------------------------------------------- */

  return (
    <div className="min-h-screen bg-neutral-900 text-white py-8">
      <div className="max-w-6xl mx-auto px-4">
        {/* HEADER */}
        <div className="flex items-center justify-between mb-4">
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
              <Logo team={selectedTeam} size={40} />
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
                if (i > 0) setMonth(months[i - 1]);
              }}
            >
              ‹ Prev
            </button>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
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
                if (i < months.length - 1) setMonth(months[i + 1]);
              }}
            >
              Next ›
            </button>
          </div>
        </div>

        {/* BANNER */}
        {focusedDate && (
          <div className="mb-4 px-4 py-2 bg-neutral-800 rounded border border-neutral-700">
            {bannerText}
          </div>
        )}

        {/* WEEKDAYS */}
        <div className="grid grid-cols-7 text-center text-gray-400 mb-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>

        {/* MAIN CALENDAR */}
        <div className="grid grid-cols-7 gap-1">
          {visibleDays.map((d, idx) => {
            if (!d) {
              return (
                <div
                  key={"pad-" + idx}
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
                key={dateStr}
                className={`relative h-28 p-2 rounded border cursor-pointer overflow-visible ${
                  game
                    ? iAmHome
                      ? "border-blue-400"
                      : "border-red-400"
                    : "border-neutral-700"
                } bg-neutral-850 hover:bg-neutral-700`}
                onClick={() => {
                  setFocusedDate(dateStr);
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

                {/* W / L badge for selected team */}
                {game && game.played && outcome && (
                  <div
                    className={`absolute bottom-2 left-2 text-[11px] font-bold px-2 py-1 rounded ${
                      outcome === "W" ? "bg-green-700" : "bg-red-700"
                    }`}
                  >
                    {outcome}
                  </div>
                )}

                {/* Final score badge (bottom-right) */}
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

      {/* ---------------------------- ACTION MODAL ---------------------------- */}
      {actionModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
          <div className="bg-neutral-900 border border-neutral-700 rounded p-5 w-[500px]">
            <h2 className="text-lg font-bold mb-3">
              {actionModal.game.away} @ {actionModal.game.home}
            </h2>

            {!actionModal.game.played ? (
              <div className="flex flex-col gap-2">
                <button
                  className="px-4 py-2 bg-neutral-700 rounded"
                  onClick={() =>
                    handleSimOnlyGame(actionModal.dateStr, actionModal.game)
                  }
                >
                  Simulate this game
                </button>
                <button
                  className="px-4 py-2 bg-orange-600 rounded"
                  onClick={() => handleSimToDate(actionModal.dateStr)}
                >
                  Simulate to this date
                </button>
                <button
                  className="px-4 py-2 bg-blue-600 rounded"
                  onClick={handleSimSeason}
                >
                  Simulate full season
                </button>
                <button
                  className="px-4 py-2 bg-neutral-700 rounded"
                  onClick={() => setActionModal(null)}
                >
                  Close
                </button>
              </div>
            ) : (
              <button
                className="px-4 py-2 bg-neutral-700 rounded"
                onClick={() => {
                  const r = resultsById[actionModal.game.id];
                  setActionModal(null);
                  setBoxModal({ game: actionModal.game, result: r });
                }}
              >
                View Box Score
              </button>
            )}
          </div>
        </div>
      )}

      {/* ---------------------------- BOX SCORE MODAL ---------------------------- */}
      {boxModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-[880px] max-h-[90vh] overflow-auto p-5">
            <div className="flex justify-between mb-4">
              <h3 className="text-xl font-bold">
                {boxModal.game.away} @ {boxModal.game.home} •{" "}
                {boxModal.result?.winner?.score}
                {boxModal.result?.winner?.ot ? " (OT)" : ""}
              </h3>
              <button
                className="px-2 py-1 bg-neutral-700 rounded"
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
                        <tr className="border-b border-neutral-700">
                          <th className="py-1">Player</th>
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
                            <td>{r.player}</td>
                            <td>{r.min}</td>
                            <td>{r.pts}</td>
                            <td>{r.reb}</td>
                            <td>{r.ast}</td>
                            <td>{r.stl}</td>
                            <td>{r.blk}</td>
                            <td>{r.fg}</td>
                            <td>{r["3p"]}</td>
                            <td>{r.ft}</td>
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


