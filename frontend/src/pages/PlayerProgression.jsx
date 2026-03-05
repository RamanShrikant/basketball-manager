import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { computePlayerProgression } from "../api/simEnginePy";

const DELTAS_KEY = "bm_progression_deltas_v1";
const PROG_META_KEY = "bm_progression_meta_v1";
const LEAGUE_KEY = "leagueData";
  const META_KEY = "bm_league_meta_v1";

// If a run gets stuck INFLIGHT (worker failed / page refresh), clear after this long
const INFLIGHT_STALE_MS = 15000;

function clamp(n, lo = 0, hi = 99) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function resolvePortrait(p) {
  return (
    p?.portrait ||
    p?.headshot ||
    p?.photo ||
    p?.image ||
    p?.img ||
    p?.face ||
    p?.playerImage ||
    null
  );
}

const playerKey = (name, team) => `${name}__${team}`;

function resolveTeamLogo(teamObj) {
  return (
    teamObj?.logo ||
    teamObj?.logoUrl ||
    teamObj?.logoURL ||
    teamObj?.teamLogo ||
    teamObj?.image ||
    teamObj?.img ||
    teamObj?.icon ||
    null
  );
}

function loadStatsByKeyFromStorage() {
  const keysToTry = [
    "bm_player_stats_v1",
    "bm_season_player_stats_v1",
    "playerStatsByKey",
    "statsByKey",
  ];

  const stores = [localStorage, sessionStorage];

  for (const store of stores) {
    for (const k of keysToTry) {
      try {
        const raw = store.getItem(k);
        if (!raw) continue;

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") continue;

        const someKey = Object.keys(parsed)[0];
        if (someKey && someKey.includes("__")) {
          return parsed;
        }

        const rows = Array.isArray(parsed) ? parsed : Object.values(parsed);

        const statsByKey = {};
        for (const r of rows) {
          const name = r?.player ?? r?.name ?? r?.playerName;
          const team = r?.team ?? r?.teamName;
          if (!name || !team) continue;
          statsByKey[`${name}__${team}`] = r;
        }

        if (Object.keys(statsByKey).length > 0) {
          try {
            localStorage.setItem("bm_player_stats_v1", JSON.stringify(statsByKey));
          } catch {}
          return statsByKey;
        }
      } catch {}
    }
  }

  return {};
}

function buildProgressionDeltas(beforeLeague, afterLeague) {
  const teamsA = getAllTeamsFromLeague(beforeLeague);
  const teamsB = getAllTeamsFromLeague(afterLeague);

  const mapPlayers = (teams) => {
    const m = {};
    for (const t of teams || []) {
      const teamName = t?.name || "";
      for (const p of t?.players || []) {
        if (!p?.name || !teamName) continue;
        m[`${p.name}__${teamName}`] = p;
      }
    }
    return m;
  };

  const A = mapPlayers(teamsA);
  const B = mapPlayers(teamsB);

  const deltas = {};

  for (const key of Object.keys(B)) {
    const p0 = A[key];
    const p1 = B[key];
    if (!p0 || !p1) continue;

    const d = {};

    const scalarKeys = ["age", "overall", "offRating", "defRating", "stamina", "potential"];
    for (const k of scalarKeys) {
      const v0 = Number(p0?.[k] ?? 0);
      const v1 = Number(p1?.[k] ?? 0);
      const diff = v1 - v0;
      if (diff) d[k] = diff;
    }

    const attrs0 = Array.isArray(p0?.attrs) ? p0.attrs : [];
    const attrs1 = Array.isArray(p1?.attrs) ? p1.attrs : [];
    const maxLen = Math.max(attrs0.length, attrs1.length);

    for (let i = 0; i < maxLen; i++) {
      const v0 = Number(attrs0[i] ?? 0);
      const v1 = Number(attrs1[i] ?? 0);
      const diff = v1 - v0;
      if (diff) d[`attr${i}`] = diff;
    }

if (Object.keys(d).length) {
  deltas[key] = d;
}

  }

  return deltas;
}

function deepUnpair(x) {
  if (!x) return x;

  // Map -> Object
  if (x instanceof Map) {
    const obj = Object.fromEntries(x);
    for (const k of Object.keys(obj)) obj[k] = deepUnpair(obj[k]);
    return obj;
  }

  // Array of [k,v] pairs -> Object
  if (Array.isArray(x) && x.length && Array.isArray(x[0]) && x[0].length === 2) {
    const obj = Object.fromEntries(x.map(([k, v]) => [k, deepUnpair(v)]));
    return obj;
  }

  // Normal array -> recurse items
  if (Array.isArray(x)) return x.map(deepUnpair);

  // Plain object -> recurse props
  if (typeof x === "object") {
    const out = { ...x };
    for (const k of Object.keys(out)) out[k] = deepUnpair(out[k]);
    return out;
  }

  return x;
}

function normalizeDeltasFromPython(league, pythonDeltas) {
  const unpaired = deepUnpair(pythonDeltas);
  if (!unpaired || typeof unpaired !== "object") return {};

  const keys = Object.keys(unpaired);
  const firstKey = keys[0] || "";

  // If Python already returns byKey ("Name__Team"), keep it.
  if (firstKey.includes("__")) return unpaired;

  // Otherwise assume byName, convert to byKey using current league rosters.
  const out = {};
  const teams = getAllTeamsFromLeague(league);

  for (const t of teams || []) {
    const teamName = t?.name || "";
    for (const p of t?.players || []) {
      const name = p?.name;
      if (!name || !teamName) continue;

      const byName = unpaired?.[name];
      if (byName && typeof byName === "object") {
        out[`${name}__${teamName}`] = byName;
      }
    }
  }

  return out;
}



function snapshotLeague(obj) {
  try {
    if (typeof structuredClone === "function") return structuredClone(obj);
  } catch {}
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
}
function getSeasonYearFromMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    const meta = raw ? JSON.parse(raw) : null;
    const y = Number(meta?.seasonYear);
    return Number.isFinite(y) ? y : null;
  } catch {
    return null;
  }
}

function inferSeasonYear(leagueData) {
  const metaYear = getSeasonYearFromMeta();
  if (metaYear != null) return metaYear;

  const y1 = Number(leagueData?.seasonYear);
  if (Number.isFinite(y1)) return y1;

  const y2 = Number(leagueData?.seasonStartYear);
  if (Number.isFinite(y2)) return y2;

  const today = new Date();
  return today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
}


function stampAgingGuards(league, seasonYear) {
  if (!league) return league;
  const teams = getAllTeamsFromLeague(league);
  for (const t of teams) {
    for (const p of t?.players || []) {
      if (!p || typeof p !== "object") continue;
      if (!Number.isFinite(Number(p.lastBirthdayYear))) {
        p.lastBirthdayYear = seasonYear;
      }
    }
  }
  return league;
}

function readJsonSafe(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export default function PlayerProgression() {
  useEffect(() => {
  console.log("[PPDBG] MOUNT PlayerProgression");
  return () => console.log("[PPDBG] UNMOUNT PlayerProgression");
}, []);
  console.count("[PPDBG] component render");
  const { leagueData, setLeagueData, selectedTeam, setSelectedTeam } = useGame();
  const navigate = useNavigate();

  const [showLetters, setShowLetters] = useState(localStorage.getItem("showLetters") === "true");
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [featuredKey, setFeaturedKey] = useState(null);

  const [deltas, setDeltas] = useState(() => readJsonSafe(DELTAS_KEY, {}));

  const attrColumns = [
    { key: "attr0", label: "3PT", index: 0 },
    { key: "attr1", label: "MID", index: 1 },
    { key: "attr2", label: "CLOSE", index: 2 },
    { key: "attr3", label: "FT", index: 3 },
    { key: "attr4", label: "BALL", index: 4 },
    { key: "attr5", label: "PASS", index: 5 },
    { key: "attr8", label: "PER D", index: 8 },
    { key: "attr9", label: "INS D", index: 9 },
    { key: "attr10", label: "BLK", index: 10 },
    { key: "attr11", label: "STL", index: 11 },
    { key: "attr12", label: "REB", index: 12 },
    { key: "attr7", label: "ATH", index: 7 },
    { key: "attr13", label: "OIQ", index: 13 },
    { key: "attr14", label: "DIQ", index: 14 },
  ];

  const toLetter = (num) => {
    const n = Number(num) || 0;
    if (n >= 94) return "A+";
    if (n >= 87) return "A";
    if (n >= 80) return "A-";
    if (n >= 77) return "B+";
    if (n >= 73) return "B";
    if (n >= 70) return "B-";
    if (n >= 67) return "C+";
    if (n >= 63) return "C";
    if (n >= 60) return "C-";
    if (n >= 57) return "D+";
    if (n >= 53) return "D";
    if (n >= 50) return "D-";
    return "F";
  };

  const handleCellDoubleClick = () => {
    const next = !showLetters;
    setShowLetters(next);
    localStorage.setItem("showLetters", String(next));
  };

  useEffect(() => {
    console.log("[PPDBG] selectedTeam loader effect", { selectedTeam: selectedTeam?.name || null });
    if (!selectedTeam) {
      const saved = localStorage.getItem("selectedTeam");
      if (saved) setSelectedTeam(JSON.parse(saved));
    }
  }, [selectedTeam, setSelectedTeam]);

  // ✅ Apply progression ONCE per season using Python
  useEffect(() => {
    if (!leagueData) return;
    // =====================
// [PPDBG] Block A - Effect entry + BEFORE snapshot context
// =====================
const runId = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
console.groupCollapsed(`[PPDBG] useEffect ENTER runId=${runId}`);
console.count("[PPDBG] useEffect fired");

// Grab raw meta strings too (so we see exact stored values, not parsed guesses)
const rawLeagueMeta = localStorage.getItem(META_KEY);
const rawProgMeta = localStorage.getItem(PROG_META_KEY);

console.log("[PPDBG] raw metas", { runId, rawLeagueMeta, rawProgMeta });

const findPlayerAnyTeam = (league, playerName) => {
  const teams = getAllTeamsFromLeague(league);
  for (const t of teams || []) {
    const teamName = t?.name || "";
    for (const p of t?.players || []) {
      if (p?.name === playerName) {
        return {
          team: teamName,
          overall: p?.overall,
          age: p?.age,
          attr0_3pt: p?.attrs?.[0],
          attr1_mid: p?.attrs?.[1],
          attr2_close: p?.attrs?.[2],
        };
      }
    }
  }
  return null;
};

console.log("[PPDBG] BEFORE (leagueData) peek", {
  runId,
  leagueData_seasonYear: leagueData?.seasonYear,
  leagueData_seasonStartYear: leagueData?.seasonStartYear,
  metaSeasonYear: getSeasonYearFromMeta(),
  inferredSeasonYear: inferSeasonYear(leagueData),
  derrick: findPlayerAnyTeam(leagueData, "Derrick White"),
  anfernee: findPlayerAnyTeam(leagueData, "Anfernee Simons"),
});
    // --- [PERM FIX] run identity + cleanup guards ---
let cancelled = false;
let inflightInterval = null;
    const seasonYear = inferSeasonYear(leagueData);
    
    

    // Read meta
    let progMeta = readJsonSafe(PROG_META_KEY, null);
    console.log("[PlayerProgression] seasonYear =", seasonYear);
console.log("[PlayerProgression] leagueData.seasonYear =", leagueData?.seasonYear);
console.log("[PlayerProgression] leagueData.seasonStartYear =", leagueData?.seasonStartYear);
console.log("[PlayerProgression] progMeta =", progMeta);



// --- [PERM FIX] If another progression is already running, do NOT start a second one.
// Instead, attach to it and load results once it finishes.
if (progMeta?.appliedForSeasonYear === "INFLIGHT") {
  const ageMs = Date.now() - Number(progMeta?.ts || 0);

  // fresh inflight - attach
  if (ageMs <= INFLIGHT_STALE_MS) {
    console.log("[PlayerProgression] INFLIGHT detected, attaching instead of rerunning", { runId, seasonYear, ageMs });

    inflightInterval = setInterval(() => {
      if (cancelled) return;

      const m = readJsonSafe(PROG_META_KEY, null);
      const done = m?.appliedForSeasonYear === seasonYear;

      if (done) {
        try {
          const updatedLeague = readJsonSafe(LEAGUE_KEY, null);
          const savedDeltas = readJsonSafe(DELTAS_KEY, {});

          if (updatedLeague) {
            setDeltas(savedDeltas || {});
            setLeagueData(updatedLeague);

            const teamsLocal = getAllTeamsFromLeague(updatedLeague);
            const updatedTeam = teamsLocal.find((t) => t?.name === selectedTeam?.name);
            if (updatedTeam) setSelectedTeam(updatedTeam);
          }
        } finally {
          clearInterval(inflightInterval);
          inflightInterval = null;
        }
      }
    }, 200);

    // IMPORTANT - we are done here, do not start progression
    return () => {
      cancelled = true;
      if (inflightInterval) clearInterval(inflightInterval);
    };
  }

  // stale inflight - clear and allow rerun
  console.warn("[PlayerProgression] stale INFLIGHT detected, clearing meta so progression can rerun.", { runId, ageMs });
  try {
    localStorage.removeItem(PROG_META_KEY);
  } catch {}
  progMeta = null;
} 




 // ✅ If already applied this season, skip (never rerun aging)
if (progMeta?.appliedForSeasonYear === seasonYear) return;


    const statsByKeyPreview = loadStatsByKeyFromStorage();
    const hasStats = statsByKeyPreview && Object.keys(statsByKeyPreview).length > 0;

    if (!hasStats) {
      console.warn("[PlayerProgression] No stats found. Running progression without stats.");
    }

    // mark inflight
    try {
      console.log("[PPDBG] setting INFLIGHT", { runId, seasonYear });
      localStorage.setItem(
        PROG_META_KEY,
        JSON.stringify({ appliedForSeasonYear: "INFLIGHT", ts: Date.now(), seasonYear, runId })
      );
    } catch {}

    (async () => {
      try {
        const beforeSnapshot = snapshotLeague(leagueData);

        const leagueForProg = snapshotLeague(leagueData);
        leagueForProg.seasonYear = seasonYear;
        leagueForProg.seasonStartYear = seasonYear;

        console.log("[PlayerProgression] computePlayerProgression POST", {
          seasonYear,
          hasLeague: !!leagueForProg,
          hasStats,
        });
console.log("[PPDBG] calling computePlayerProgression", {
  runId,
  seasonYear,
  hasStats,
  statsKeyCount: Object.keys(statsByKeyPreview || {}).length,
});
const msg = await computePlayerProgression(leagueForProg, statsByKeyPreview, {
  seed: seasonYear,
  seasonYear,
});

  console.log("[DEBUG] raw deltas from Python:", JSON.stringify(msg?.deltas ?? msg?.payload?.deltas));

// ✅ Support both shapes:
// 1) msg = { league, deltas, version }
// 2) msg = { type, requestId, payload: { league, deltas, version } }
const res = msg?.league ? msg : msg?.payload;
console.log("[PPDBG] worker response", {
  runId,
  msgKeys: Object.keys(msg || {}),
  resKeys: Object.keys(res || {}),
  version: res?.version,
  hasLeague: !!res?.league,
  hasDeltas: !!res?.deltas,
  resDeltaCount: res?.deltas ? Object.keys(res.deltas).length : 0,
});

console.log("[PlayerProgression] computePlayerProgression msg keys:", Object.keys(msg || {}));
console.log("[PlayerProgression] computePlayerProgression res keys:", Object.keys(res || {}));
console.log("[PlayerProgression] res.version:", res?.version);

if (!res || !res.league) {
  throw new Error("[PlayerProgression] Progression returned no league. Check worker response shape.");
}

let updatedLeague = res.league;


        if (!Number.isFinite(Number(updatedLeague?.seasonYear))) updatedLeague.seasonYear = seasonYear;
        if (!Number.isFinite(Number(updatedLeague?.seasonStartYear))) updatedLeague.seasonStartYear = seasonYear;

        updatedLeague = stampAgingGuards(updatedLeague, seasonYear);

let newDeltas = {};
if (res?.deltas && typeof res.deltas === "object" && Object.keys(res.deltas).length > 0) {
  newDeltas = normalizeDeltasFromPython(updatedLeague, res.deltas);
} else {
  newDeltas = buildProgressionDeltas(beforeSnapshot, updatedLeague);
}
const derrickAfter = findPlayerAnyTeam(updatedLeague, "Derrick White");
const anferneeAfter = findPlayerAnyTeam(updatedLeague, "Anfernee Simons");

const derrickKey = derrickAfter?.team ? `Derrick White__${derrickAfter.team}` : null;
const anferneeKey = anferneeAfter?.team ? `Anfernee Simons__${anferneeAfter.team}` : null;

console.log("[PPDBG] AFTER (updatedLeague) peek", {
  runId,
  derrickAfter,
  anferneeAfter,
});

console.log("[PPDBG] deltas built", {
  runId,
  deltaCount: Object.keys(newDeltas || {}).length,
  source: (res?.deltas && Object.keys(res.deltas || {}).length > 0) ? "python" : "js_fallback",
  derrickKey,
  anferneeKey,
  derrickDelta: derrickKey ? newDeltas?.[derrickKey] : null,
  anferneeDelta: anferneeKey ? newDeltas?.[anferneeKey] : null,
});


const deltaCount = Object.keys(newDeltas || {}).length;
console.log("[PlayerProgression] deltas count:", deltaCount);

// ✅ If no deltas, something is wrong. Do NOT save/lock.
if (deltaCount === 0) {
  throw new Error(`[PlayerProgression] deltaCount = 0 for seasonYear = ${seasonYear}. Refusing to lock season.`);
}
console.log("[PPDBG] writing LEAGUE_KEY", { runId, seasonYear });
// --- [PERM FIX] Only the owner runId is allowed to commit writes ---
const metaNow = readJsonSafe(PROG_META_KEY, null);
const stillOwner =
  metaNow?.appliedForSeasonYear === "INFLIGHT" &&
  metaNow?.seasonYear === seasonYear &&
  metaNow?.runId === runId;

if (!stillOwner) {
  console.warn("[PlayerProgression] Not owner anymore - skipping commits", { runId, seasonYear, metaNow });
  return;
}
localStorage.setItem(LEAGUE_KEY, JSON.stringify(updatedLeague));



// ✅ EARLY LOCK: if we crash after this point, never rerun progression for this season
try {
  localStorage.setItem(
    PROG_META_KEY,
    JSON.stringify({
      appliedForSeasonYear: seasonYear,
      ts: Date.now(),
      deltaCount,
      seasonYear,
      deltasSaved: false,
      stage: "EARLY_LOCK",
    })
  );
  console.log("[PPDBG] DONE", {
  runId,
  seasonYear,
  savedProgMeta: readJsonSafe(PROG_META_KEY, null),
  savedDeltaCount: Object.keys(readJsonSafe(DELTAS_KEY, {}) || {}).length,
});
console.groupEnd();
} catch {}

let deltaSaveOk = true;
try {
  console.log("[PPDBG] writing DELTAS_KEY", { runId, seasonYear, deltaCount: Object.keys(newDeltas || {}).length });
  localStorage.setItem(DELTAS_KEY, JSON.stringify(newDeltas));
} catch (e) {
  deltaSaveOk = false;
  console.error("[PlayerProgression] Failed to save deltas. Continuing anyway.", e);

  // keep the key valid so your UI does not crash
  try {
    localStorage.setItem(DELTAS_KEY, JSON.stringify({}));
  } catch {}
}

        // ✅ FIX 4: clear season stats AFTER progression succeeds (so next season starts fresh)
if (deltaCount > 0) {
  const statKeysToClear = [
    "bm_player_stats_v1",
    "bm_season_player_stats_v1",
    "playerStatsByKey",
    "statsByKey",
  ];

  for (const store of [localStorage, sessionStorage]) {
    for (const k of statKeysToClear) {
      try {
        store.removeItem(k);
      } catch {}
    }
  }

  console.log("[PlayerProgression] cleared season stat keys:", statKeysToClear);
}


        setDeltas(newDeltas);
        setLeagueData(updatedLeague);

        const teamsLocal = getAllTeamsFromLeague(updatedLeague);
        const updatedTeam = teamsLocal.find((t) => t?.name === selectedTeam?.name);
        if (updatedTeam) setSelectedTeam(updatedTeam);

        // ✅ only lock season if we actually produced deltas
  localStorage.setItem(
  PROG_META_KEY,
  JSON.stringify({
    appliedForSeasonYear: seasonYear,
    ts: Date.now(),
    deltaCount,
    seasonYear,
    deltasSaved: deltaSaveOk,
  })
);

      } catch (err) {
        console.error("[PlayerProgression] Python progression failed:", err);
        // ✅ do NOT lock season on error
        try {
          localStorage.setItem(
            PROG_META_KEY,
            JSON.stringify({ appliedForSeasonYear: "ERROR", ts: Date.now(), error: String(err) })
          );
        } catch {}
        console.log("[PPDBG] ERROR end", { runId, err: String(err) });
        console.groupEnd();
      }
    })();
    return () => {
  cancelled = true;
  if (inflightInterval) clearInterval(inflightInterval);
};
  }, [leagueData, selectedTeam, setLeagueData, setSelectedTeam]);

  const teams = useMemo(() => getAllTeamsFromLeague(leagueData), [leagueData]);

  const teamLogoByName = useMemo(() => {
    const map = {};
    for (const t of teams || []) {
      const name = t?.name;
      if (!name) continue;
      const logo = resolveTeamLogo(t);
      if (logo) map[name] = logo;
    }
    return map;
  }, [teams]);

  const allRows = useMemo(() => {
    const rows = [];
    for (const t of teams || []) {
      const teamName = t?.name || "Team";
      for (const p of t.players || []) {
        rows.push({ ...p, team: teamName, __key: playerKey(p?.name, teamName) });
      }
    }
    return rows;
  }, [teams]);

  const teamOptions = useMemo(() => {
    const names = Array.from(new Set((teams || []).map((t) => t?.name).filter(Boolean))).sort();
    return ["ALL", ...names];
  }, [teams]);

  const rows = useMemo(() => {
    if (teamFilter === "ALL") return allRows;
    return allRows.filter((r) => r.team === teamFilter);
  }, [allRows, teamFilter]);

  useEffect(() => {
    if (!featuredKey && rows.length) setFeaturedKey(rows[0].__key);
  }, [rows, featuredKey]);

  const featured = useMemo(() => {
    if (!rows.length) return null;
    return rows.find((r) => r.__key === featuredKey) || rows[0];
  }, [rows, featuredKey]);

  const deltaFor = (row, key) => {
    const byKey = deltas?.[row.__key];
    if (byKey && typeof byKey === "object") return Number(byKey?.[key] ?? 0) || 0;

    const byName = deltas?.[row.name];
    if (byName && typeof byName === "object") return Number(byName?.[key] ?? 0) || 0;

    return 0;
  };

  const DeltaBadge = ({ d }) => {
    if (!d) return null;
    const up = d > 0;
    return (
      <span className="ml-2 inline-flex items-center gap-1">
        <span className={up ? "text-green-400 font-extrabold" : "text-red-400 font-extrabold"}>
          {up ? "▲" : "▼"}
        </span>
        <span className="text-yellow-300 font-extrabold">{up ? `+${d}` : `${d}`}</span>
      </span>
    );
  };

  const portraitSrc = resolvePortrait(featured);
  const featuredTeamLogo = featured?.team ? teamLogoByName?.[featured.team] : null;

  const fillPercent = Math.min((featured?.overall || 0) / 99, 1);
  const circleCircumference = 2 * Math.PI * 50;
  const strokeOffset = circleCircumference * (1 - fillPercent);

  if (!leagueData) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex items-center justify-center">
        Loading progression...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-900 text-white py-10">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-4xl font-extrabold text-orange-500">Player Progression</h1>
          <div className="flex items-center gap-3">
            <select
              value={teamFilter}
              onChange={(e) => {
                setTeamFilter(e.target.value);
                setFeaturedKey(null);
              }}
              className="px-3 py-2 bg-neutral-800 rounded border border-neutral-700"
            >
              {teamOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              onClick={() => navigate("/calendar")}
              className="px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
            >
              Return to Calendar
            </button>
          </div>
        </div>

        {featured && (
          <div className="relative bg-neutral-800 rounded-xl shadow-lg px-8 pt-7 pb-4 mb-6">
            <div className="absolute left-0 right-0 bottom-0 h-[2px] bg-white opacity-20" />

            <div className="flex items-end justify-between gap-6">
              <div className="flex items-end gap-6">
                <div className="relative -mb-[8px]">
                  {portraitSrc ? (
                    <img src={portraitSrc} alt={featured.name} className="h-[170px] w-auto object-contain" />
                  ) : (
                    <div className="h-[170px] w-[120px] bg-neutral-700 rounded-lg flex items-center justify-center text-neutral-300">
                      No Photo
                    </div>
                  )}
                </div>

                <div className="mb-2">
                  <h2 className="text-[42px] font-bold leading-tight">{featured.name}</h2>
                  <p className="text-gray-400 text-[22px] mt-1 flex items-center gap-2">
                    {featured.pos} •{" "}
                    {featuredTeamLogo ? (
                      <img
                        src={featuredTeamLogo}
                        alt={featured.team}
                        className="h-[22px] w-[22px] object-contain inline-block"
                        draggable={false}
                      />
                    ) : (
                      <span className="inline-block w-[22px]" />
                    )}{" "}
                    • Age {featured.age}
                  </p>
                </div>
              </div>

              <div className="relative flex items-center justify-center mr-2 mb-2">
                <svg width="105" height="105" viewBox="0 0 120 120">
                  <defs>
                    <linearGradient id="ovrGradientProg" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#FFA500" />
                      <stop offset="100%" stopColor="#FFD54F" />
                    </linearGradient>
                  </defs>
                  <circle cx="60" cy="60" r="50" stroke="rgba(255,255,255,0.08)" strokeWidth="8" fill="none" />
                  <circle
                    cx="60"
                    cy="60"
                    r="50"
                    stroke="url(#ovrGradientProg)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    fill="none"
                    strokeDasharray={circleCircumference}
                    strokeDashoffset={strokeOffset}
                    transform="rotate(-90 60 60)"
                  />
                </svg>

                <div className="absolute text-center">
                  <p className="text-sm text-gray-300">OVR</p>
                  <p className="text-[44px] font-extrabold text-orange-400 leading-none mt-[-6px]">
                    {featured.overall}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    POT <span className="text-orange-400 font-semibold">{featured.potential}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <div className="min-w-[1300px] max-w-max mx-auto">
            <table className="w-full border-collapse text-center">
              <thead className="bg-neutral-800 text-gray-300 text-[16px] font-semibold">
                <tr>
                  {[
                    { key: "name", label: "Name" },
                    { key: "team", label: "TEAM" },
                    { key: "pos", label: "POS" },
                    { key: "age", label: "AGE" },
                    { key: "overall", label: "OVR" },
                    { key: "offRating", label: "OFF" },
                    { key: "defRating", label: "DEF" },
                    { key: "stamina", label: "STAM" },
                    { key: "potential", label: "POT" },
                    ...attrColumns,
                  ].map((col) => (
                    <th
                      key={col.key}
                      className={`py-3 px-3 min-w-[95px] ${
                        col.key === "name" ? "min-w-[200px] text-left pl-4" : "text-center"
                      }`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="text-[17px] font-medium">
                {rows.map((p, idx) => {
                  const active = p.__key === featured?.__key;
                  const logo = teamLogoByName?.[p.team] || null;

                  return (
                    <tr
                      key={`${p.__key}-${idx}`}
                      className={`transition cursor-pointer ${active ? "bg-orange-600/25" : "hover:bg-neutral-800"}`}
                      onClick={() => setFeaturedKey(p.__key)}
                    >
                      <td className="py-2 px-3 whitespace-nowrap text-left pl-4 font-semibold">{p.name}</td>

                      <td className="py-2 px-3">
                        {logo ? (
                          <img
                            src={logo}
                            alt={p.team}
                            className="h-[22px] w-[22px] object-contain mx-auto"
                            draggable={false}
                          />
                        ) : (
                          <span className="text-neutral-500">-</span>
                        )}
                      </td>

                      <td className="py-2 px-3">{p.pos}</td>

                      <td className="py-2 px-3">
                        <span>{p.age}</span>
                        <DeltaBadge d={deltaFor(p, "age")} />
                      </td>

                      {["overall", "offRating", "defRating", "stamina"].map((k) => (
                        <td key={k} className="py-2 px-3" onDoubleClick={handleCellDoubleClick}>
                          <span>{showLetters ? toLetter(p[k]) : p[k]}</span>
                          <DeltaBadge d={deltaFor(p, k)} />
                        </td>
                      ))}

                      <td className="py-2 px-3" onDoubleClick={handleCellDoubleClick}>
                        {showLetters ? toLetter(p.potential) : p.potential}
                      </td>

                      {attrColumns.map((a) => {
                        const val = p.attrs?.[a.index] ?? 0;
                        const d = deltaFor(p, a.key);
                        return (
                          <td key={a.key} className="py-2 px-3" onDoubleClick={handleCellDoubleClick}>
                            <span>{showLetters ? toLetter(val) : val}</span>
                            <DeltaBadge d={d} />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="text-xs text-neutral-400 mt-3">
              ▲/▼ shows change from last season. Double-click any rating cell to toggle numbers/letters.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
