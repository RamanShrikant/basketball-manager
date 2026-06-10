import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { computePlayerProgression } from "../api/simEnginePy";
import styles from "./PlayerProgression.module.css";

const DELTAS_KEY = "bm_progression_deltas_v1";
const PROG_META_KEY = "bm_progression_meta_v1";
const LEAGUE_KEY = "leagueData";
const META_KEY = "bm_league_meta_v1";
const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";

// If a run gets stuck INFLIGHT (worker failed / page refresh), clear after this long
const INFLIGHT_STALE_MS = 75000;


// -----------------------------------------------------------------------------
// TEMP DEBUG HARNESS - remove after we isolate the progression bug.
// This does not change progression formulas. It only logs state/storage flow.
// -----------------------------------------------------------------------------
const PP_DEBUG = true;
const PP_STORAGE_KEYS = [
  LEAGUE_KEY,
  DELTAS_KEY,
  PROG_META_KEY,
  META_KEY,
  OFFSEASON_STATE_KEY,
  "selectedTeam",
  "bm_player_stats_v1",
  "bm_season_player_stats_v1",
  "playerStatsByKey",
  "statsByKey",
];

function ppByteSize(str) {
  try {
    return new Blob([String(str || "")]).size;
  } catch {
    return String(str || "").length * 2;
  }
}

function ppSafeJson(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return { __parseError: String(err), __rawStart: String(raw || "").slice(0, 180) };
  }
}

function ppFindPlayer(league, playerName) {
  const teams = getAllTeamsFromLeague(league);
  for (const t of teams || []) {
    const teamName = t?.name || "";
    for (const p of getProgressionPlayersFromTeam(t)) {
      if (p?.name === playerName) {
        return {
          name: p?.name,
          team: teamName,
          age: p?.age,
          overall: p?.overall,
          offRating: p?.offRating,
          defRating: p?.defRating,
          stamina: p?.stamina,
          potential: p?.potential,
          attrs0_3pt: p?.attrs?.[0],
          attrs1_mid: p?.attrs?.[1],
          attrs2_close: p?.attrs?.[2],
          attrs7_ath: p?.attrs?.[7],
        };
      }
    }
  }
  return null;
}

function ppLeagueMini(league) {
  const teams = getAllTeamsFromLeague(league);
  let playerCount = 0;
  for (const t of teams || []) playerCount += Array.isArray(t?.players) ? t.players.length : 0;

  let sig = null;
  try {
    sig = leagueProgressionSignature(league);
  } catch (err) {
    sig = `signature-error: ${String(err)}`;
  }

  return {
    exists: !!league,
    seasonYear: league?.seasonYear,
    currentSeasonYear: league?.currentSeasonYear,
    seasonStartYear: league?.seasonStartYear,
    teamCount: teams?.length || 0,
    playerCount,
    signature: sig,
    firstTeam: teams?.[0]?.name || null,
    paolo: ppFindPlayer(league, "Paolo Banchero"),
    lauri: ppFindPlayer(league, "Lauri Markkanen"),
    derrick: ppFindPlayer(league, "Derrick White"),
    anfernee: ppFindPlayer(league, "Anfernee Simons"),
  };
}

function ppKeyInfo(key) {
  const raw = localStorage.getItem(key);
  const parsed = ppSafeJson(raw);

  const info = {
    key,
    exists: raw != null,
    chars: raw ? raw.length : 0,
    kb: raw ? Number((ppByteSize(raw) / 1024).toFixed(1)) : 0,
    parseOk: raw ? !parsed?.__parseError : null,
  };

  if (key === LEAGUE_KEY) {
    info.league = ppLeagueMini(parsed);
  }

  if (key === DELTAS_KEY) {
    info.deltaCount = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.keys(parsed).length
      : 0;
    info.sampleKeys = parsed && typeof parsed === "object"
      ? Object.keys(parsed).slice(0, 8)
      : [];
    info.paoloDelta = parsed?.["Paolo Banchero__Orlando Magic"] || parsed?.["Paolo Banchero"] || null;
    info.lauriDelta = parsed?.["Lauri Markkanen__Utah Jazz"] || parsed?.["Lauri Markkanen"] || null;
  }

  if (key === PROG_META_KEY || key === META_KEY || key === OFFSEASON_STATE_KEY || key === "selectedTeam") {
    info.value = parsed;
  }

  return info;
}

function ppAllStorageSizes() {
  const rows = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const raw = localStorage.getItem(key);
      rows.push({
        key,
        chars: raw ? raw.length : 0,
        kb: raw ? Number((ppByteSize(raw) / 1024).toFixed(1)) : 0,
      });
    }
  } catch (err) {
    rows.push({ key: "__error", chars: 0, kb: 0, error: String(err) });
  }
  return rows.sort((a, b) => b.kb - a.kb);
}

function ppDump(label, contextLeague = null, extra = {}) {
  if (!PP_DEBUG) return null;

  const storageKeys = PP_STORAGE_KEYS.map(ppKeyInfo);
  const storageSizes = ppAllStorageSizes().slice(0, 25);
  const storageLeague = readJsonSafe(LEAGUE_KEY, null);
  const savedDeltas = readJsonSafe(DELTAS_KEY, {});
  const progMeta = readJsonSafe(PROG_META_KEY, null);
  const meta = readJsonSafe(META_KEY, null);
  const offseason = readJsonSafe(OFFSEASON_STATE_KEY, null);

  const contextSig = (() => {
    try { return leagueProgressionSignature(contextLeague); } catch { return null; }
  })();
  const storageSig = (() => {
    try { return leagueProgressionSignature(storageLeague); } catch { return null; }
  })();

  const dump = {
    label,
    timestamp: new Date().toISOString(),
    location: window.location?.pathname,
    extra,
    contextVsStorageSameSignature: contextSig && storageSig ? contextSig === storageSig : null,
    contextLeague: ppLeagueMini(contextLeague),
    storageLeague: ppLeagueMini(storageLeague),
    savedDeltaCount: savedDeltas && typeof savedDeltas === "object" ? Object.keys(savedDeltas).length : 0,
    progMeta,
    meta,
    offseason,
    storageKeys,
    largestLocalStorageKeys: storageSizes,
  };

  console.groupCollapsed(`%c[PPDBG:DUMP] ${label}`, "color:#f97316;font-weight:bold");
  console.log(dump);
  try { console.table(storageKeys.map(({ key, exists, kb, parseOk, deltaCount }) => ({ key, exists, kb, parseOk, deltaCount }))); } catch {}
  try { console.table(storageSizes.slice(0, 12)); } catch {}
  console.groupEnd();

  return dump;
}



// -----------------------------------------------------------------------------
// EXTREME AGE DEBUG - console only. No gameplay logic changes.
// -----------------------------------------------------------------------------
const PP_AGE_DEBUG_TRACKED_NAMES = [
  "Paolo Banchero",
  "Franz Wagner",
  "Desmond Bane",
  "Jalen Suggs",
  "Anthony Black",
  "Tristan Da Silva",
  "Goga Bitadze",
  "Bam Adebayo",
  "Norman Powell",
  "Tyler Herro",
  "Derrick White",
  "Anfernee Simons",
];

function ppPlayerStableKey(player = {}, teamName = "") {
  if (player?.id !== undefined && player?.id !== null && player?.id !== "") {
    return `id:${player.id}`;
  }
  return `name:${player?.name || ""}__team:${teamName || ""}`;
}

function ppBuildPlayerAgeMap(league) {
  const map = new Map();
  const teams = getAllTeamsFromLeague(league);

  for (const team of teams || []) {
    const teamName = team?.name || "";
    for (const player of getProgressionPlayersFromTeam(team)) {
      const key = ppPlayerStableKey(player, teamName);
      map.set(key, {
        key,
        id: player?.id ?? null,
        name: player?.name || "",
        team: teamName,
        age: Number(player?.age),
        rawAge: player?.age,
        overall: player?.overall,
        potential: player?.potential,
        lastBirthdayYear: player?.lastBirthdayYear,
        lastAgedSeasonYear: player?.lastAgedSeasonYear,
        contractStartYear: player?.contract?.startYear ?? null,
        contractYears: Array.isArray(player?.contract?.salaryByYear)
          ? player.contract.salaryByYear.length
          : 0,
      });
    }
  }

  return map;
}

function ppGetAgeRows(league, trackedNames = PP_AGE_DEBUG_TRACKED_NAMES) {
  const wanted = new Set((trackedNames || []).map((name) => String(name || "").toLowerCase()));
  const rows = [];
  const teams = getAllTeamsFromLeague(league);

  for (const team of teams || []) {
    const teamName = team?.name || "";
    for (const player of getProgressionPlayersFromTeam(team)) {
      if (wanted.size && !wanted.has(String(player?.name || "").toLowerCase())) continue;
      rows.push({
        name: player?.name,
        team: teamName,
        age: player?.age,
        ovr: player?.overall,
        pot: player?.potential,
        lastBirthdayYear: player?.lastBirthdayYear,
        lastAgedSeasonYear: player?.lastAgedSeasonYear,
        contractStartYear: player?.contract?.startYear ?? null,
        contractYears: Array.isArray(player?.contract?.salaryByYear)
          ? player.contract.salaryByYear.length
          : 0,
      });
    }
  }

  return rows.sort((a, b) => String(a.team).localeCompare(String(b.team)) || String(a.name).localeCompare(String(b.name)));
}

function ppAgeGuardSummary(league, seasonYear) {
  const map = ppBuildPlayerAgeMap(league);
  const rows = Array.from(map.values());

  const bucket = {
    total: rows.length,
    missingLastBirthdayYear: 0,
    birthdayBelowSeason: 0,
    birthdayEqualsSeason: 0,
    birthdayAboveSeason: 0,
    missingLastAgedSeasonYear: 0,
    agedEqualsSeason: 0,
    agedBelowSeason: 0,
    agedAboveSeason: 0,
  };

  for (const row of rows) {
    const lb = Number(row.lastBirthdayYear);
    const la = Number(row.lastAgedSeasonYear);

    if (!Number.isFinite(lb)) bucket.missingLastBirthdayYear += 1;
    else if (lb < seasonYear) bucket.birthdayBelowSeason += 1;
    else if (lb === seasonYear) bucket.birthdayEqualsSeason += 1;
    else bucket.birthdayAboveSeason += 1;

    if (!Number.isFinite(la)) bucket.missingLastAgedSeasonYear += 1;
    else if (la < seasonYear) bucket.agedBelowSeason += 1;
    else if (la === seasonYear) bucket.agedEqualsSeason += 1;
    else bucket.agedAboveSeason += 1;
  }

  return bucket;
}

function ppLogAgeGuards(label, league, seasonYear, extra = {}) {
  const summary = ppAgeGuardSummary(league, Number(seasonYear || 0));
  console.groupCollapsed(`%c[AGEDBG:GUARDS] ${label}`, "color:#a855f7;font-weight:bold");
  console.log({ label, seasonYear, summary, extra });
  try { console.table(ppGetAgeRows(league)); } catch {}
  console.groupEnd();
  return summary;
}

function ppAgeAudit(beforeLeague, afterLeague, label, extra = {}) {
  const beforeMap = ppBuildPlayerAgeMap(beforeLeague);
  const afterMap = ppBuildPlayerAgeMap(afterLeague);

  const rows = [];
  const missing = [];

  for (const [key, before] of beforeMap.entries()) {
    const after = afterMap.get(key);

    if (!after) {
      missing.push(before);
      continue;
    }

    const beforeAge = Number(before.age);
    const afterAge = Number(after.age);
    const ageDiff =
      Number.isFinite(beforeAge) && Number.isFinite(afterAge)
        ? afterAge - beforeAge
        : null;

    rows.push({
      key,
      name: before.name,
      beforeTeam: before.team,
      afterTeam: after.team,
      beforeAge,
      afterAge,
      ageDiff,
      beforeOvr: before.overall,
      afterOvr: after.overall,
      ovrDiff: Number(after.overall || 0) - Number(before.overall || 0),
      beforePot: before.potential,
      afterPot: after.potential,
      beforeLastBirthdayYear: before.lastBirthdayYear,
      afterLastBirthdayYear: after.lastBirthdayYear,
      beforeLastAgedSeasonYear: before.lastAgedSeasonYear,
      afterLastAgedSeasonYear: after.lastAgedSeasonYear,
    });
  }

  const summary = {
    label,
    comparedPlayers: rows.length,
    missingPlayers: missing.length,
    agedExactlyPlusOne: rows.filter((r) => r.ageDiff === 1).length,
    unchangedAge: rows.filter((r) => r.ageDiff === 0).length,
    agedMoreThanOne: rows.filter((r) => Number(r.ageDiff) > 1).length,
    ageWentDown: rows.filter((r) => Number(r.ageDiff) < 0).length,
    invalidAgeDiff: rows.filter((r) => r.ageDiff === null).length,
    trackedRows: rows.filter((r) => PP_AGE_DEBUG_TRACKED_NAMES.includes(r.name)),
    suspiciousUnchangedExamples: rows
      .filter((r) => r.ageDiff === 0)
      .slice(0, 25),
    plusOneExamples: rows
      .filter((r) => r.ageDiff === 1)
      .slice(0, 12),
    missingExamples: missing.slice(0, 12),
    extra,
  };

  const bad =
    summary.comparedPlayers > 0 &&
    summary.agedExactlyPlusOne < Math.max(5, Math.floor(summary.comparedPlayers * 0.50));

  const style = bad
    ? "color:#ef4444;font-weight:bold"
    : "color:#22c55e;font-weight:bold";

  console.groupCollapsed(`%c[AGEDBG:AUDIT] ${label}`, style);
  console.log(summary);
  try { console.table(summary.trackedRows); } catch {}
  if (bad) {
    console.error("[AGEDBG:AGING_SUSPECT] Most players did not age +1 in this comparison.", summary);
    try { console.table(summary.suspiciousUnchangedExamples); } catch {}
  } else {
    try { console.table(summary.plusOneExamples); } catch {}
  }
  console.groupEnd();

  return summary;
}

function ppPersistenceAudit(expectedLeague, savedLeague, label, extra = {}) {
  const expectedMap = ppBuildPlayerAgeMap(expectedLeague);
  const savedMap = ppBuildPlayerAgeMap(savedLeague);

  const mismatches = [];
  let matched = 0;

  for (const [key, expected] of expectedMap.entries()) {
    const saved = savedMap.get(key);
    if (!saved) {
      mismatches.push({
        key,
        name: expected.name,
        team: expected.team,
        issue: "missing_in_saved_league",
        expectedAge: expected.age,
        savedAge: null,
        expectedOvr: expected.overall,
        savedOvr: null,
      });
      continue;
    }

    matched += 1;

    if (
      Number(expected.age) !== Number(saved.age) ||
      Number(expected.overall || 0) !== Number(saved.overall || 0) ||
      Number(expected.potential || 0) !== Number(saved.potential || 0)
    ) {
      mismatches.push({
        key,
        name: expected.name,
        expectedTeam: expected.team,
        savedTeam: saved.team,
        issue: "value_mismatch",
        expectedAge: expected.age,
        savedAge: saved.age,
        ageDiffSavedMinusExpected: Number(saved.age) - Number(expected.age),
        expectedOvr: expected.overall,
        savedOvr: saved.overall,
        expectedPot: expected.potential,
        savedPot: saved.potential,
        expectedLastBirthdayYear: expected.lastBirthdayYear,
        savedLastBirthdayYear: saved.lastBirthdayYear,
      });
    }
  }

  const summary = {
    label,
    matched,
    expectedPlayers: expectedMap.size,
    savedPlayers: savedMap.size,
    mismatchCount: mismatches.length,
    mismatchExamples: mismatches.slice(0, 25),
    trackedExpected: ppGetAgeRows(expectedLeague),
    trackedSaved: ppGetAgeRows(savedLeague),
    extra,
  };

  console.groupCollapsed(
    `%c[AGEDBG:PERSISTENCE] ${label}`,
    mismatches.length ? "color:#ef4444;font-weight:bold" : "color:#22c55e;font-weight:bold"
  );
  console.log(summary);
  try { console.table(summary.trackedExpected); } catch {}
  try { console.table(summary.trackedSaved); } catch {}
  if (mismatches.length) {
    console.error("[AGEDBG:PERSISTENCE_MISMATCH] saved leagueData does not match expected updatedLeague", summary);
    try { console.table(mismatches.slice(0, 25)); } catch {}
  }
  console.groupEnd();

  return summary;
}

function ppDeltaAgeSummary(deltas = {}, label = "delta-age-summary", extra = {}) {
  const entries = Object.entries(deltas || {});
  const rows = entries.map(([key, delta]) => ({
    key,
    ageDelta: Number(delta?.age || 0),
    overallDelta: Number(delta?.overall || 0),
    offDelta: Number(delta?.offRating || 0),
    defDelta: Number(delta?.defRating || 0),
    staminaDelta: Number(delta?.stamina || 0),
    potentialDelta: Number(delta?.potential || 0),
  }));

  const summary = {
    label,
    totalDeltaRows: rows.length,
    rowsWithAgeDelta: rows.filter((r) => r.ageDelta !== 0).length,
    agePlusOneRows: rows.filter((r) => r.ageDelta === 1).length,
    ageZeroRows: rows.filter((r) => r.ageDelta === 0).length,
    ageOtherRows: rows.filter((r) => r.ageDelta !== 0 && r.ageDelta !== 1).length,
    trackedRows: rows.filter((r) => PP_AGE_DEBUG_TRACKED_NAMES.some((name) => r.key.includes(name))),
    ageExamples: rows.filter((r) => r.ageDelta !== 0).slice(0, 20),
    noAgeExamples: rows.filter((r) => r.ageDelta === 0).slice(0, 20),
    extra,
  };

  console.groupCollapsed(`%c[AGEDBG:DELTAS] ${label}`, "color:#38bdf8;font-weight:bold");
  console.log(summary);
  try { console.table(summary.trackedRows); } catch {}
  try { console.table(summary.ageExamples); } catch {}
  console.groupEnd();

  return summary;
}

function ppTrySetItem(key, value, label) {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const kb = Number((ppByteSize(raw) / 1024).toFixed(1));

  console.log(`[PPDBG:WRITE_ATTEMPT] ${label || key}`, { key, kb, chars: raw.length });

  try {
    localStorage.setItem(key, raw);
    console.log(`[PPDBG:WRITE_OK] ${label || key}`, ppKeyInfo(key));
    return true;
  } catch (err) {
    console.error(`[PPDBG:WRITE_FAIL] ${label || key}`, {
      key,
      kb,
      chars: raw.length,
      error: String(err),
      largestLocalStorageKeys: ppAllStorageSizes().slice(0, 15),
    });
    return false;
  }
}

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

function progressionPlayerKey(player = {}) {
  return String(player?.id || player?.name || "");
}

function isTwoWayRosterPlayer(player = {}) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const type = String(player?.contractType || player?.rosterStatus || contract?.type || "").toLowerCase();
  return type === "two_way" || type === "two-way" || player?.assignmentStatus === "g_league";
}

function stripProgressionBucketMarker(player = {}) {
  if (!player || typeof player !== "object") return player;
  const next = { ...player };
  delete next.__progressionRosterBucket;
  return next;
}

function getProgressionPlayersFromTeam(team, includeTwoWay = true) {
  const standardPlayers = Array.isArray(team?.players) ? team.players : [];
  if (!includeTwoWay) return standardPlayers;

  const twoWayPlayers = Array.isArray(team?.twoWayPlayers) ? team.twoWayPlayers : [];
  const stashPlayers = Array.isArray(team?.stashPlayers) ? team.stashPlayers : [];

  const seen = new Set(standardPlayers.map(progressionPlayerKey));
  const merged = [...standardPlayers];

  for (const player of twoWayPlayers) {
    const key = progressionPlayerKey(player);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(player);
  }

  for (const player of stashPlayers) {
    const key = progressionPlayerKey(player);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(player);
  }

  return merged;
}

function getTeamNameForProgression(team = {}) {
  return team?.name || team?.teamName || "";
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
      for (const p of getProgressionPlayersFromTeam(t)) {
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
    for (const p of getProgressionPlayersFromTeam(t)) {
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


function isCurrentDraftClassRookie(player = {}, seasonYear = null) {
  const resolvedSeasonYear = Number(seasonYear || 0);
  if (!Number.isFinite(resolvedSeasonYear) || resolvedSeasonYear <= 0) return false;

  const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
  const draftYear = Number(
    meta?.draftYear ??
      player?.draftYear ??
      player?.draftClassYear ??
      player?.draftedYear ??
      0
  );

  if (!Number.isFinite(draftYear) || draftYear !== resolvedSeasonYear) return false;

  const acquiredVia = String(meta?.acquiredVia || player?.acquiredVia || "").toLowerCase();
  const playerId = String(player?.id || "").toLowerCase();

  return (
    acquiredVia.includes("draft") ||
    playerId.startsWith(`rookie_${resolvedSeasonYear}_`) ||
    Boolean(player?.rights?.rookieScale) ||
    Boolean(player?.rookieSigningPending)
  );
}

function makeCurrentDraftRookieMap(beforeLeague, seasonYear) {
  const byTeam = new Map();

  for (const team of getAllTeamsFromLeague(beforeLeague) || []) {
    const teamName = getTeamNameForProgression(team);
    if (!teamName) continue;

    const teamMap = {
      players: new Map(),
      twoWayPlayers: new Map(),
      stashPlayers: new Map(),
      any: new Map(),
    };

    for (const player of team.players || []) {
      if (!isCurrentDraftClassRookie(player, seasonYear)) continue;
      const key = progressionPlayerKey(player);
      if (!key) continue;
      const cleanPlayer = snapshotLeague(player);
      teamMap.players.set(key, cleanPlayer);
      teamMap.any.set(key, cleanPlayer);
    }

    for (const player of team.twoWayPlayers || []) {
      if (!isCurrentDraftClassRookie(player, seasonYear)) continue;
      const key = progressionPlayerKey(player);
      if (!key) continue;
      const cleanPlayer = snapshotLeague(player);
      teamMap.twoWayPlayers.set(key, cleanPlayer);
      teamMap.any.set(key, cleanPlayer);
    }

    for (const player of team.stashPlayers || []) {
      if (!isCurrentDraftClassRookie(player, seasonYear)) continue;
      const key = progressionPlayerKey(player);
      if (!key) continue;
      const cleanPlayer = snapshotLeague(player);
      teamMap.stashPlayers.set(key, cleanPlayer);
      teamMap.any.set(key, cleanPlayer);
    }

    if (teamMap.any.size) byTeam.set(teamName, teamMap);
  }

  return byTeam;
}

function restoreCurrentDraftClassRookiesAfterProgression(updatedLeague, beforeLeague, seasonYear) {
  if (!updatedLeague || !beforeLeague) return updatedLeague;

  const rookieMapByTeam = makeCurrentDraftRookieMap(beforeLeague, seasonYear);
  if (!rookieMapByTeam.size) return updatedLeague;

  const league = snapshotLeague(updatedLeague);

  for (const team of getAllTeamsFromLeague(league) || []) {
    const teamName = getTeamNameForProgression(team);
    const rookieMaps = rookieMapByTeam.get(teamName);
    if (!rookieMaps) continue;

    const restoreBucket = (players = [], bucketName = "players") => {
      const restored = [];
      const seen = new Set();
      const bucketMap = rookieMaps[bucketName] || new Map();

      for (const player of players || []) {
        const key = progressionPlayerKey(player);
        const replacement = key ? bucketMap.get(key) || rookieMaps.any.get(key) : null;
        const nextPlayer = replacement ? snapshotLeague(replacement) : player;
        const nextKey = progressionPlayerKey(nextPlayer);
        if (nextKey && seen.has(nextKey)) continue;
        if (nextKey) seen.add(nextKey);
        restored.push(nextPlayer);
      }

      for (const [key, rookie] of bucketMap.entries()) {
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        restored.push(snapshotLeague(rookie));
      }

      return restored;
    };

    team.players = restoreBucket(Array.isArray(team.players) ? team.players : [], "players");
    team.twoWayPlayers = restoreBucket(Array.isArray(team.twoWayPlayers) ? team.twoWayPlayers : [], "twoWayPlayers");
    team.stashPlayers = restoreBucket(Array.isArray(team.stashPlayers) ? team.stashPlayers : [], "stashPlayers");
  }

  return league;
}

function prepareLeagueForProgressionWorker(league, seasonYear = null) {
  const cloned = snapshotLeague(league);
  const teams = getAllTeamsFromLeague(cloned);

  for (const team of teams || []) {
    if (!Array.isArray(team.players)) team.players = [];
    if (!Array.isArray(team.twoWayPlayers)) team.twoWayPlayers = [];
    if (!Array.isArray(team.stashPlayers)) team.stashPlayers = [];

    // Brand-new draft picks should not receive a progression roll before
    // they have played their first NBA season. Remove them from the worker
    // payload, then restore the exact original objects before saving.
    team.players = team.players.filter((player) => !isCurrentDraftClassRookie(player, seasonYear));
    team.twoWayPlayers = team.twoWayPlayers.filter((player) => !isCurrentDraftClassRookie(player, seasonYear));
    team.stashPlayers = team.stashPlayers.filter((player) => !isCurrentDraftClassRookie(player, seasonYear));

    const existing = new Set(team.players.map(progressionPlayerKey));

    for (const player of team.twoWayPlayers) {
      const key = progressionPlayerKey(player);
      if (key && existing.has(key)) continue;
      if (key) existing.add(key);
      team.players.push({
        ...player,
        __progressionRosterBucket: "twoWayPlayers",
        contractType: player?.contractType || "two_way",
        rosterStatus: player?.rosterStatus || "two_way",
        assignmentStatus: player?.assignmentStatus || "g_league",
      });
    }

    for (const player of team.stashPlayers) {
      const key = progressionPlayerKey(player);
      if (key && existing.has(key)) continue;
      if (key) existing.add(key);
      team.players.push({
        ...player,
        __progressionRosterBucket: "stashPlayers",
        contractType: player?.contractType || "stash",
        rosterStatus: player?.rosterStatus || "stashed",
        assignmentStatus: player?.assignmentStatus || "stash",
      });
    }
  }

  return cloned;
}

function restoreTwoWayBucketsAfterProgression(workerLeague, fallbackLeague) {
  const league = snapshotLeague(workerLeague);
  const fallbackTeams = getAllTeamsFromLeague(fallbackLeague);
  const fallbackByName = new Map();

  for (const team of fallbackTeams || []) {
    const teamName = getTeamNameForProgression(team);
    if (teamName) fallbackByName.set(teamName, team);
  }

  for (const team of getAllTeamsFromLeague(league) || []) {
    const teamName = getTeamNameForProgression(team);
    const fallbackTeam = fallbackByName.get(teamName);
    const originalTwoWayIds = new Set((fallbackTeam?.twoWayPlayers || []).map(progressionPlayerKey));
    const originalStashIds = new Set((fallbackTeam?.stashPlayers || []).map(progressionPlayerKey));

    const standardPlayers = [];
    const twoWayPlayers = [];
    const stashPlayers = [];
    const seenStandard = new Set();
    const seenTwoWay = new Set();
    const seenStash = new Set();

    for (const rawPlayer of team.players || []) {
      const player = stripProgressionBucketMarker(rawPlayer);
      const key = progressionPlayerKey(player);
      const belongsStash =
        rawPlayer?.__progressionRosterBucket === "stashPlayers" ||
        originalStashIds.has(key) ||
        player?.contractType === "stash" ||
        player?.rosterStatus === "stashed";

      if (belongsStash) {
        player.contractType = player.contractType || "stash";
        player.rosterStatus = player.rosterStatus || "stashed";
        player.assignmentStatus = player.assignmentStatus || "stash";
        if (!seenStash.has(key)) {
          seenStash.add(key);
          stashPlayers.push(player);
        }
        continue;
      }

      const belongsTwoWay =
        rawPlayer?.__progressionRosterBucket === "twoWayPlayers" ||
        originalTwoWayIds.has(key) ||
        isTwoWayRosterPlayer(player);

      if (belongsTwoWay) {
        player.contractType = player.contractType || "two_way";
        player.rosterStatus = player.rosterStatus || "two_way";
        player.assignmentStatus = player.assignmentStatus || "g_league";
        if (!seenTwoWay.has(key)) {
          seenTwoWay.add(key);
          twoWayPlayers.push(player);
        }
        continue;
      }

      if (!seenStandard.has(key)) {
        seenStandard.add(key);
        standardPlayers.push(player);
      }
    }

    for (const rawPlayer of team.twoWayPlayers || []) {
      const player = stripProgressionBucketMarker(rawPlayer);
      const key = progressionPlayerKey(player);
      if (!seenTwoWay.has(key)) {
        seenTwoWay.add(key);
        twoWayPlayers.push(player);
      }
    }

    for (const rawPlayer of team.stashPlayers || []) {
      const player = stripProgressionBucketMarker(rawPlayer);
      const key = progressionPlayerKey(player);
      if (!seenStash.has(key)) {
        seenStash.add(key);
        stashPlayers.push(player);
      }
    }

    team.players = standardPlayers;
    team.twoWayPlayers = twoWayPlayers;
    team.stashPlayers = stashPlayers;
  }

  return league;
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
  const candidates = [];

  const pushYear = (value) => {
    const y = Number(value);
    if (Number.isFinite(y) && y >= 2020 && y <= 2100) {
      candidates.push(y);
    }
  };

  const meta = readJsonSafe(META_KEY, null);
  const offseasonState = readJsonSafe(OFFSEASON_STATE_KEY, null);

  pushYear(meta?.seasonYear);
  pushYear(meta?.currentSeasonYear);
  pushYear(meta?.seasonStartYear);
  pushYear(offseasonState?.seasonYear);
  pushYear(leagueData?.seasonYear);
  pushYear(leagueData?.currentSeasonYear);
  pushYear(leagueData?.seasonStartYear);

  if (candidates.length) {
    return Math.max(...candidates);
  }

  const today = new Date();
  return today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
}

function stampAgingGuards(league, seasonYear) {
  if (!league) return league;
  const teams = getAllTeamsFromLeague(league);
  for (const t of teams) {
    for (const p of getProgressionPlayersFromTeam(t)) {
      if (!p || typeof p !== "object") continue;
      if (!Number.isFinite(Number(p.lastBirthdayYear))) {
        p.lastBirthdayYear = seasonYear;
      }
    }
  }
  return league;
}

function stampCareerSeasonCounters(league, seasonYear) {
  if (!league) return league;

  const resolvedSeasonYear = Number(seasonYear || 0);
  if (!Number.isFinite(resolvedSeasonYear) || resolvedSeasonYear <= 0) return league;

  const teams = getAllTeamsFromLeague(league);

  for (const team of teams || []) {
    const teamName = getTeamNameForProgression(team);

    for (const player of getProgressionPlayersFromTeam(team)) {
      if (!player || typeof player !== "object") continue;

      const meta = player.meta && typeof player.meta === "object" ? { ...player.meta } : {};
      const rights = player.rights && typeof player.rights === "object" ? { ...player.rights } : {};

      const alreadyCounted =
        Number(meta.lastProSeasonCountedYear) === resolvedSeasonYear ||
        Number(player.lastProSeasonCountedYear) === resolvedSeasonYear;

      if (alreadyCounted) continue;

      const draftYear = Number(meta.draftYear ?? player.draftYear ?? 0);
      const currentProSeasons = Math.max(
        0,
        Number(meta.proSeasons ?? player.proSeasons ?? 0) || 0
      );

      const isBrandNewDraftRookie =
        Number.isFinite(draftYear) &&
        draftYear === resolvedSeasonYear &&
        currentProSeasons <= 0 &&
        String(meta.acquiredVia || player.acquiredVia || "").toLowerCase().includes("draft");

      // Draft picks created in this same offseason have not played an NBA season yet.
      // They should progress visually if the page includes them, but they should not
      // gain a pro-season/RFA counter until the next completed season.
      if (isBrandNewDraftRookie) {
        meta.lastProSeasonCountedYear = resolvedSeasonYear;
        player.lastProSeasonCountedYear = resolvedSeasonYear;
        player.meta = meta;
        player.rights = rights;
        continue;
      }

      const nextProSeasons = currentProSeasons + 1;
      meta.proSeasons = nextProSeasons;
      player.proSeasons = nextProSeasons;
      meta.lastProSeasonCountedYear = resolvedSeasonYear;
      player.lastProSeasonCountedYear = resolvedSeasonYear;

      const contractStartYear = Number(player.contract?.startYear ?? 0);
      const currentYearsWithTeam = Math.max(
        0,
        Number(meta.yearsWithCurrentTeam ?? player.yearsWithCurrentTeam ?? 0) || 0
      );

      const likelyNewToTeamThisOffseason =
        contractStartYear === resolvedSeasonYear &&
        currentYearsWithTeam <= 0 &&
        !(Number.isFinite(draftYear) && draftYear > 0 && draftYear < resolvedSeasonYear);

      if (!likelyNewToTeamThisOffseason) {
        const nextYearsWithTeam = currentYearsWithTeam + 1;
        meta.yearsWithCurrentTeam = nextYearsWithTeam;
        player.yearsWithCurrentTeam = nextYearsWithTeam;

        const currentBirdSeasons = Math.max(
          0,
          Number(rights.seasonsTowardBird ?? 0) || 0
        );
        const nextBirdSeasons = Math.max(currentBirdSeasons + 1, nextYearsWithTeam);
        rights.seasonsTowardBird = nextBirdSeasons;

        if (teamName && !rights.heldByTeam) {
          rights.heldByTeam = teamName;
        }

        if (!rights.birdLevel || rights.birdLevel === "none" || rights.birdLevel === "non_bird" || rights.birdLevel === "early_bird" || rights.birdLevel === "bird") {
          if (nextBirdSeasons >= 3) rights.birdLevel = "bird";
          else if (nextBirdSeasons >= 2) rights.birdLevel = "early_bird";
          else if (nextBirdSeasons >= 1) rights.birdLevel = "non_bird";
        }
      }

      player.meta = meta;
      player.rights = rights;
    }
  }

  return league;
}


function compactProgressionStoryContext(story) {
  if (!story || typeof story !== "object") return null;

  return {
    eventType: story.eventType || "",
    headline: story.headline || "",
    subtitle: story.subtitle || story.contractLine || "",
    playerName: story.playerName || "",
    teamName: story.teamName || story.teamDisplayName || "",
    day: story.day ?? null,
    contractLine: story.contractLine || "",
    totalValue: story.totalValue || 0,
    years: story.years || 0,
    aav: story.aav || 0,
    spendingType: story.spendingType || "",
    exceptionType: story.exceptionType || "",
    payrollZone: story.payrollZone || "",
    teamDirection: story.teamDirection || "",
    needScore: story.needScore ?? null,
    positionBucket: story.positionBucket || "",
    rfaMatched: Boolean(story.rfaMatched),
    originalOfferTeamName: story.originalOfferTeamName || "",
    rightsTeamName: story.rightsTeamName || "",
  };
}

function compactProgressionOffer(offer = {}) {
  if (!offer || typeof offer !== "object") return offer;

  return {
    offerId: offer.offerId || null,
    playerId: offer.playerId ?? null,
    playerName: offer.playerName || "",
    playerKey: offer.playerKey || "",
    teamName: offer.teamName || "",
    source: offer.source || "",
    status: offer.status || "",
    submittedDay: offer.submittedDay ?? offer.day ?? null,
    day: offer.day ?? offer.submittedDay ?? null,
    contract: offer.contract || null,
    salaryByYear: Array.isArray(offer.salaryByYear) ? offer.salaryByYear : undefined,
    years: offer.years || offer.contract?.salaryByYear?.length || 0,
    totalValue: offer.totalValue || 0,
    aav: offer.aav || 0,
    currentYearSalary:
      offer.currentYearSalary ||
      offer.contract?.salaryByYear?.[0] ||
      offer.salaryByYear?.[0] ||
      0,
    playerViewScore: offer.playerViewScore || 0,
    spendingType: offer.spendingType || "",
    exceptionType: offer.exceptionType || "",
    payrollZone: offer.payrollZone || "",
    teamDirection: offer.teamDirection || "",
    needScore: offer.needScore ?? offer.rosterNeed?.needScore ?? null,
    positionBucket: offer.positionBucket || offer.rosterNeed?.position || "",
    rfaOfferSheet: Boolean(offer.rfaOfferSheet),
    rfaMatched: Boolean(offer.rfaMatched),
    rightsTeamName: offer.rightsTeamName || "",
    originalOfferTeamName: offer.originalOfferTeamName || "",
    matchedOriginalTeamName: offer.matchedOriginalTeamName || "",
  };
}

function compactProgressionSigning(row = {}, emergency = false) {
  if (!row || typeof row !== "object") return row;

  return {
    day: row.day ?? null,
    playerId: row.playerId ?? null,
    playerName: row.playerName || "",
    playerKey: row.playerKey || "",
    teamName: row.teamName || row.signedWith || "",
    signedWith: row.signedWith || row.teamName || "",
    contract: row.contract || row.signedContract || null,
    totalValue: row.totalValue || row.signedTotalValue || 0,
    aav: row.aav || 0,
    years: row.years || row.signedYears || row.contract?.salaryByYear?.length || 0,
    spendingType: row.spendingType || "",
    exceptionType: row.exceptionType || "",
    payrollZone: row.payrollZone || "",
    rfaMatched: Boolean(row.rfaMatched),
    originalOfferTeamName: row.originalOfferTeamName || "",
    matchedOriginalTeamName: row.matchedOriginalTeamName || "",
    declinedRightsTeamName: row.declinedRightsTeamName || "",
    exceptionUsage: row.exceptionUsage
      ? {
          type: row.exceptionUsage.type || "",
          amountUsed: row.exceptionUsage.amountUsed || 0,
        }
      : null,
    userOfferOutcomes: Array.isArray(row.userOfferOutcomes)
      ? row.userOfferOutcomes.slice(0, emergency ? 4 : 8).map((outcome) => ({
          id: outcome.id || "",
          day: outcome.day ?? null,
          playerId: outcome.playerId ?? null,
          playerName: outcome.playerName || "",
          playerKey: outcome.playerKey || "",
          userTeamName: outcome.userTeamName || "",
          status: outcome.status || "",
          offerStatus: outcome.offerStatus || "",
          signedWith: outcome.signedWith || "",
          signedContract: outcome.signedContract || null,
          signedTotalValue: outcome.signedTotalValue || 0,
          signedYears: outcome.signedYears || 0,
          userOfferTotalValue: outcome.userOfferTotalValue || 0,
          userOfferYears: outcome.userOfferYears || 0,
          rfaMatched: Boolean(outcome.rfaMatched),
          originalOfferTeamName: outcome.originalOfferTeamName || "",
        }))
      : [],
    allOffers: Array.isArray(row.allOffers)
      ? row.allOffers.slice(0, emergency ? 3 : 5).map(compactProgressionOffer)
      : [],
    storyContext: compactProgressionStoryContext(row.storyContext),
  };
}

function compactProgressionActionLogEntry(entry = {}, emergency = false) {
  if (!entry || typeof entry !== "object") return entry;

  return {
    day: entry.day ?? entry.dayResolved ?? null,
    dayResolved: entry.dayResolved ?? entry.day ?? null,
    type: entry.type || entry.eventType || "",
    title: entry.title || entry.headline || "",
    summary: entry.summary || entry.message || "",
    stateSummary: entry.stateSummary
      ? {
          currentDay: entry.stateSummary.currentDay ?? null,
          maxDays: entry.stateSummary.maxDays ?? null,
          freeAgentCount: entry.stateSummary.freeAgentCount ?? null,
          activeOfferCount: entry.stateSummary.activeOfferCount ?? null,
          signedCount: entry.stateSummary.signedCount ?? null,
          generatedOfferCount: entry.stateSummary.generatedOfferCount ?? null,
        }
      : null,
    signings: Array.isArray(entry.signings)
      ? entry.signings.slice(0, emergency ? 40 : 120).map((row) => compactProgressionSigning(row, emergency))
      : [],
    generatedOffers: Array.isArray(entry.generatedOffers)
      ? entry.generatedOffers.slice(0, emergency ? 80 : 180).map(compactProgressionOffer)
      : [],
    userOfferOutcomes: Array.isArray(entry.userOfferOutcomes)
      ? entry.userOfferOutcomes.slice(0, emergency ? 20 : 60).map((row) => ({
          id: row.id || "",
          day: row.day ?? null,
          playerId: row.playerId ?? null,
          playerName: row.playerName || "",
          playerKey: row.playerKey || "",
          userTeamName: row.userTeamName || "",
          status: row.status || "",
          offerStatus: row.offerStatus || "",
          signedWith: row.signedWith || "",
          signedTotalValue: row.signedTotalValue || 0,
          signedYears: row.signedYears || 0,
          rfaMatched: Boolean(row.rfaMatched),
          originalOfferTeamName: row.originalOfferTeamName || "",
        }))
      : [],
    rightsRenounceLog: Array.isArray(entry.rightsRenounceLog)
      ? entry.rightsRenounceLog.slice(0, emergency ? 20 : 60)
      : [],
    blockedCapHoldRenounceLog: Array.isArray(entry.blockedCapHoldRenounceLog)
      ? entry.blockedCapHoldRenounceLog.slice(0, emergency ? 20 : 60)
      : [],
  };
}

function compactFreeAgencyStateForProgressionStorage(state, emergency = false) {
  if (!state || typeof state !== "object") return state;

  return {
    ...state,
    // These active-market structures are not needed once progression is running.
    offersByPlayer: {},
    latestResults: null,
    pendingUserDecisions: [],
    pendingRfaMatchDecisions: [],
    pendingUserTeamSnapshot: null,
    teamNeedProfiles: emergency ? {} : state.teamNeedProfiles || {},
    signedPlayersLog: Array.isArray(state.signedPlayersLog)
      ? state.signedPlayersLog
          .slice(-1 * (emergency ? 80 : 220))
          .map((row) => compactProgressionSigning(row, emergency))
      : [],
    offerHistory: Array.isArray(state.offerHistory)
      ? state.offerHistory
          .slice(-1 * (emergency ? 40 : 120))
          .map(compactProgressionOffer)
      : [],
    fullActionLog: Array.isArray(state.fullActionLog)
      ? state.fullActionLog
          .slice(-1 * (emergency ? 6 : 12))
          .map((entry) => compactProgressionActionLogEntry(entry, emergency))
      : [],
    rightsRenounceLog: Array.isArray(state.rightsRenounceLog)
      ? state.rightsRenounceLog.slice(-1 * (emergency ? 40 : 120))
      : [],
    blockedCapHoldRenounceLog: Array.isArray(state.blockedCapHoldRenounceLog)
      ? state.blockedCapHoldRenounceLog.slice(-1 * (emergency ? 40 : 120))
      : [],
    dailyLog: Array.isArray(state.dailyLog)
      ? state.dailyLog.slice(-1 * (emergency ? 5 : 12))
      : [],
    userOfferOutcomeLog: Array.isArray(state.userOfferOutcomeLog)
      ? state.userOfferOutcomeLog.slice(-1 * (emergency ? 40 : 120)).map((row) => ({
          ...row,
          storyContext: compactProgressionStoryContext(row.storyContext),
        }))
      : [],
  };
}

function compactLeagueDataForProgressionStorage(league, emergency = false) {
  if (!league || typeof league !== "object") return league;

  return {
    ...league,
    freeAgencyState: compactFreeAgencyStateForProgressionStorage(league.freeAgencyState, emergency),
  };
}

function getProgressionAgeCompletionAudit(league, seasonYear) {
  const teams = getAllTeamsFromLeague(league);
  const rows = [];

  for (const team of teams || []) {
    const teamName = team?.name || "";
    for (const player of getProgressionPlayersFromTeam(team)) {
      const lastBirthdayYear = Number(player?.lastBirthdayYear);
      rows.push({
        name: player?.name || "",
        team: teamName,
        age: player?.age,
        lastBirthdayYear: Number.isFinite(lastBirthdayYear) ? lastBirthdayYear : null,
        stale:
          !Number.isFinite(lastBirthdayYear) ||
          lastBirthdayYear < Number(seasonYear || 0),
      });
    }
  }

  const staleRows = rows.filter((row) => row.stale);

  return {
    seasonYear: Number(seasonYear || 0),
    totalPlayers: rows.length,
    staleCount: staleRows.length,
    staleExamples: staleRows.slice(0, 12),
    ok:
      rows.length > 0 &&
      staleRows.length <= Math.max(2, Math.floor(rows.length * 0.01)),
  };
}

function isProgressionLeagueValidForSeason(league, seasonYear) {
  return getProgressionAgeCompletionAudit(league, seasonYear).ok;
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

function leagueProgressionSignature(league) {
  const teams = getAllTeamsFromLeague(league);

  let count = 0;
  let ageSum = 0;
  let overallSum = 0;
  let offSum = 0;
  let defSum = 0;
  let staminaSum = 0;
  let potentialSum = 0;

  for (const t of teams || []) {
    for (const p of getProgressionPlayersFromTeam(t)) {
      count += 1;
      ageSum += Number(p?.age || 0);
      overallSum += Number(p?.overall || 0);
      offSum += Number(p?.offRating || 0);
      defSum += Number(p?.defRating || 0);
      staminaSum += Number(p?.stamina || 0);
      potentialSum += Number(p?.potential || 0);
    }
  }

  return `${count}|${ageSum}|${overallSum}|${offSum}|${defSum}|${staminaSum}|${potentialSum}`;
}

// -------------------------
// LeagueEditor parity helpers (v19)
// Paste above PlayerProgression component
// -------------------------

const T3 = 0, MID = 1, CLOSE = 2, FT = 3, BH = 4, PAS = 5, SPD = 6, ATH = 7;
const PERD = 8, INTD = 9, BLK = 10, STL = 11, REB = 12, OIQ = 13, DIQ = 14;

const clampRange = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function bankersRound(n) {
  const f = Math.floor(n);
  const diff = n - f;
  if (Math.abs(diff - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(n);
}

function v19Jitter(name = "", attrs = []) {
  let sA = 0;
  for (let i = 0; i < attrs.length; i++) sA += (i + 1) * (attrs[i] ?? 0);
  let sN = 0;
  for (let i = 0; i < name.length; i++) sN += name.charCodeAt(i);
  const seed = (sA + 0.13 * sN) * 12.9898;
  const raw = Math.sin(seed) * 43758.5453;
  const frac = raw - Math.floor(raw);
  return (frac - 0.5) * 0.7;
}

const sigmoid = (x) => 1 / (1 + Math.exp(-0.12 * (x - 77)));

const posParams = {
  PG: {
    weights: [0.11, 0.05, 0.03, 0.05, 0.17, 0.17, 0.10, 0.07, 0.10, 0.02, 0.01, 0.07, 0.05, 0.01, 0.01],
    prim: [5, 6, 1, 7],
    alpha: 0.25,
  },
  SG: {
    weights: [0.15, 0.08, 0.05, 0.05, 0.12, 0.07, 0.11, 0.07, 0.11, 0.03, 0.02, 0.08, 0.06, 0.01, 0.01],
    prim: [1, 5, 7],
    alpha: 0.28,
  },
  SF: {
    weights: [0.12, 0.09, 0.07, 0.04, 0.08, 0.07, 0.10, 0.10, 0.10, 0.06, 0.04, 0.08, 0.05, 0.01, 0.01],
    prim: [1, 8, 9],
    alpha: 0.22,
  },
  PF: {
    weights: [0.07, 0.07, 0.12, 0.03, 0.05, 0.05, 0.08, 0.12, 0.07, 0.13, 0.08, 0.08, 0.05, 0.01, 0.01],
    prim: [3, 10, 8],
    alpha: 0.24,
  },
  C: {
    weights: [0.04, 0.06, 0.17, 0.03, 0.02, 0.04, 0.07, 0.12, 0.05, 0.16, 0.13, 0.06, 0.08, 0.01, 0.01],
    prim: [3, 10, 11, 13],
    alpha: 0.30,
  },
};

function padAttrs(attrs) {
  const a = Array.isArray(attrs) ? attrs.slice(0, 15) : [];
  while (a.length < 15) a.push(75);
  return a.map((v) => Number(v) || 75);
}

function calcOverallFromAttrs(attrs, pos) {
  const p = posParams[pos] || posParams.SF;
  const a = padAttrs(attrs);

  const W = p.weights.reduce((s, w, i) => s + w * (a[i] || 75), 0);
  const prim = p.prim.map((i) => i - 1);
  const Peak = Math.max(...prim.map((i) => a[i] || 75));
  const B = p.alpha * Peak + (1 - p.alpha) * W;

  let overall = 60 + 39 * sigmoid(B);
  overall = Math.round(Math.min(99, Math.max(60, overall)));

  const num90 = a.filter((x) => x >= 90).length;
  if (num90 >= 3) {
    const bonus = num90 - 2;
    overall = Math.min(99, overall + bonus);
  }
  return overall;
}

function calcStaminaFromAgeAth(age, athleticism) {
  const a = clampRange(Number(age) || 25, 18, 45);
  const ath = clampRange(Number(athleticism) || 75, 25, 99);

  let ageFactor;
  if (a <= 27) ageFactor = 1.0;
  else if (a <= 34) ageFactor = 0.95 - (0.15 * (a - 28)) / 6;
  else ageFactor = 0.8 - (0.45 * (a - 35)) / 10;

  ageFactor = clampRange(ageFactor, 0.35, 1.0);

  const raw = ageFactor * 99 * 0.575 + ath * 0.425;
  const norm = (raw - 40) / (99 - 40);
  return Math.round(clampRange(40 + norm * 59, 40, 99));
}

const OFF_WEIGHTS_POSZ = {
  PG: { [T3]: 0.18, [MID]: 0.18, [CLOSE]: 0.18, [BH]: 0.20, [PAS]: 0.20, [SPD]: 0.04, [ATH]: 0.02, [OIQ]: 0.00 },
  SG: { [T3]: 0.18, [MID]: 0.18, [CLOSE]: 0.18, [BH]: 0.14, [PAS]: 0.14, [SPD]: 0.06, [ATH]: 0.06, [OIQ]: 0.02 },
  SF: { [T3]: 0.18, [MID]: 0.18, [CLOSE]: 0.18, [BH]: 0.10, [PAS]: 0.10, [SPD]: 0.08, [ATH]: 0.10, [OIQ]: 0.08 },
  PF: { [T3]: 0.18, [MID]: 0.18, [CLOSE]: 0.18, [BH]: 0.10, [PAS]: 0.12, [SPD]: 0.08, [ATH]: 0.08, [OIQ]: 0.08 },
  C:  { [T3]: 0.18, [MID]: 0.18, [CLOSE]: 0.18, [BH]: 0.04, [PAS]: 0.10, [SPD]: 0.06, [ATH]: 0.16, [OIQ]: 0.10 },
};

const threePenaltyMult = (pos) => ({ PG: 1.1, SG: 1.0, SF: 0.75, PF: 0.8, C: 0.3 }[pos] || 1);
const closePenaltyMult = (pos) => ({ PG: 0.3, SG: 0.45, SF: 0.7, PF: 0.85, C: 1.1 }[pos] || 1);

function buildRatingBaselinesFromLeague(leagueData) {
  const POS = ["PG", "SG", "SF", "PF", "C"];
  const offIdx = [T3, MID, CLOSE, BH, PAS, SPD, ATH, OIQ];
  const defIdx = [PERD, STL, INTD, BLK, SPD, ATH];

  const teams = getAllTeamsFromLeague(leagueData);
  const allPlayers = [];
  for (const t of teams || []) {
    for (const p of getProgressionPlayersFromTeam(t)) {
      const pos = POS.includes(p?.pos) ? p.pos : "SF";
      allPlayers.push({ pos, attrs: padAttrs(p?.attrs) });
    }
  }

  const posBuckets = Object.fromEntries(
    POS.map((p) => [p, Object.fromEntries([...offIdx, ...defIdx].map((k) => [k, []]))])
  );
  const absBuckets = Object.fromEntries(offIdx.map((k) => [k, []]));

  for (const pl of allPlayers) {
    for (const k of [...offIdx, ...defIdx]) posBuckets[pl.pos][k].push(pl.attrs[k]);
    for (const k of offIdx) absBuckets[k].push(pl.attrs[k]);
  }

  const sampleStd = (arr) => {
    const n = arr.length;
    if (n < 2) return 1.0;
    const m = arr.reduce((s, v) => s + v, 0) / n;
    const v = arr.reduce((s, v2) => s + (v2 - m) * (v2 - m), 0) / (n - 1);
    return Math.max(1.0, Math.sqrt(v));
  };

  const posMean = {}, posStd = {};
  for (const p of POS) {
    posMean[p] = {};
    posStd[p] = {};
    for (const k of [...offIdx, ...defIdx]) {
      const arr = posBuckets[p][k];
      posMean[p][k] = arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 75;
      posStd[p][k] = arr.length ? sampleStd(arr) : 1.0;
    }
  }

  const absMean = {}, absStd = {};
  for (const k of offIdx) {
    const arr = absBuckets[k];
    absMean[k] = arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 75;
    absStd[k] = arr.length ? sampleStd(arr) : 1.0;
  }

  const safe = (v) => (v && v > 1e-6 ? v : 1.0);
  const zPos = (attrs, pos, k) => (attrs[k] - (posMean[pos]?.[k] ?? 75)) / safe(posStd[pos]?.[k]);
  const zAbs = (attrs, k) => (attrs[k] - (absMean[k] ?? 75)) / safe(absStd[k]);
  const zToRating = (z) => clampRange(75 + 12 * z, 50, 99);

  const pfBridgedWeights = (() => {
    const pf = OFF_WEIGHTS_POSZ.PF, sf = OFF_WEIGHTS_POSZ.SF;
    const keys = new Set([...Object.keys(pf), ...Object.keys(sf)].map(Number));
    const out = {};
    for (const k of keys) out[k] = 0.7 * (pf[k] || 0) + 0.3 * (sf[k] || 0);
    return out;
  })();

  const ABS_MIX = { PF: 0.7, SF: 0.2, PG: 0.1, SG: 0.1, C: 0.1 };

  const previewOff = (attrs, pos) => {
    const p = POS.includes(pos) ? pos : "SF";
    const w = p === "PF" ? pfBridgedWeights : (OFF_WEIGHTS_POSZ[p] || OFF_WEIGHTS_POSZ.SF);
    const mix = ABS_MIX[p] ?? 0.1;

    let zPosSum = 0, zAbsSum = 0;
    for (const [kStr, wt] of Object.entries(w)) {
      const k = Number(kStr);
      zPosSum += wt * zPos(attrs, p, k);
      zAbsSum += wt * zAbs(attrs, k);
    }

    let off = zToRating((1 - mix) * zPosSum + mix * zAbsSum);

    const t3Gap = Math.max(0, 50 - (attrs[T3] || 0) - 2);
    const cGap = Math.max(0, 60 - (attrs[CLOSE] || 0) - 2);
    off -= Math.min(6, 0.07 * threePenaltyMult(p) * t3Gap);
    off -= Math.min(6, 0.07 * closePenaltyMult(p) * cGap);

    return clampRange(off, 50, 99);
  };

  const previewDef = (attrs, pos) => {
    const p = POS.includes(pos) ? pos : "SF";

    const DW = ({
      PG: { [PERD]: 0.58, [STL]: 0.32, [SPD]: 0.06, [ATH]: 0.04 },
      SG: { [PERD]: 0.46, [STL]: 0.26, [INTD]: 0.12, [BLK]: 0.08, [SPD]: 0.04, [ATH]: 0.04 },
      SF: { [PERD]: 0.28, [STL]: 0.18, [INTD]: 0.28, [BLK]: 0.18, [ATH]: 0.05, [SPD]: 0.03 },
      PF: { [INTD]: 0.45, [BLK]: 0.35, [PERD]: 0.08, [STL]: 0.08, [ATH]: 0.04 },
      C:  { [INTD]: 0.52, [BLK]: 0.40, [ATH]: 0.06, [PERD]: 0.01, [STL]: 0.01 },
    })[p] || {};

    let zsum = 0;
    for (const [kStr, wt] of Object.entries(DW)) zsum += wt * zPos(attrs, p, Number(kStr));
    let def = zToRating(zsum);

    const ath = attrs[ATH] ?? 75;
    let absPen = Math.max(0, 78 - ath) * 0.08;
    let relPen = Math.max(0, (posMean[p]?.[ATH] ?? 75) - ath) * 0.05;

    if (p === "SF") {
      absPen *= 0.8;
      relPen *= 0.8;
      def += 2.5;

      const perd = attrs[PERD] ?? 75;
      const intd = attrs[INTD] ?? 75;
      const hi = Math.max(perd, intd);
      const lo = Math.min(perd, intd);

      if (perd >= 88 && intd >= 88) def += Math.min(1.0, (Math.min(perd, intd) - 88) * 0.05);

      let tier = 0;
      if (perd >= 90 || intd >= 90) tier += 0.5;
      if (perd >= 85 && intd >= 85) tier += 0.5;
      if (hi >= 93 && lo >= 84) tier += 0.5;
      if (hi >= 94 && lo >= 90) tier += 0.5;
      def += Math.min(2.0, tier);
    }

    def -= Math.min(4, absPen + relPen);

    const cap = p === "C" ? 99 : p === "PF" ? 98 : 96;
    return clampRange(def, 50, cap);
  };

  let sumOV = 0, sumOFF = 0, sumDEF = 0, n = 0;
  for (const pl of allPlayers) {
    sumOV += calcOverallFromAttrs(pl.attrs, pl.pos);
    sumOFF += previewOff(pl.attrs, pl.pos);
    sumDEF += previewDef(pl.attrs, pl.pos);
    n += 1;
  }

  const ovMean = n ? sumOV / n : 75;
  const offMean = n ? sumOFF / n : 75;
  const defMean = n ? sumDEF / n : 75;

  const offShift = clampRange(ovMean - offMean, -1.5, 1.5);
  const defShift = clampRange(ovMean - defMean, -1.5, 1.5);

  return { posMean, posStd, absMean, absStd, offShift, defShift };
}

function calcOffDefV19(attrsIn, posIn, name = "", height = 78, baselines) {
  const attrs = padAttrs(attrsIn);
  const POS = ["PG", "SG", "SF", "PF", "C"];
  const p = POS.includes(posIn) ? posIn : "SF";

  const { posMean, posStd, absMean, absStd, offShift, defShift } = baselines;

  const safe = (v) => (v && v > 1e-6 ? v : 1.0);
  const zPos = (k) => (attrs[k] - (posMean[p]?.[k] ?? 75)) / safe(posStd[p]?.[k]);
  const zAbs = (k) => (attrs[k] - (absMean[k] ?? 75)) / safe(absStd[k]);
  const zToRating = (z) => clampRange(75 + 12 * z, 50, 99);

  const ABS_MIX = { PF: 0.7, SF: 0.2, PG: 0.1, SG: 0.1, C: 0.1 };

  const wBase =
    p === "PF"
      ? (() => {
          const pf = OFF_WEIGHTS_POSZ.PF, sf = OFF_WEIGHTS_POSZ.SF;
          const keys = new Set([...Object.keys(pf), ...Object.keys(sf)].map(Number));
          const out = {};
          for (const k of keys) out[k] = 0.7 * (pf[k] || 0) + 0.3 * (sf[k] || 0);
          return out;
        })()
      : (OFF_WEIGHTS_POSZ[p] || OFF_WEIGHTS_POSZ.SF);

  let zPosSum = 0, zAbsSum = 0;
  for (const [kStr, wt] of Object.entries(wBase)) {
    const k = Number(kStr);
    zPosSum += wt * zPos(k);
    zAbsSum += wt * zAbs(k);
  }

  const mix = ABS_MIX[p] ?? 0.1;
  let off = zToRating((1 - mix) * zPosSum + mix * zAbsSum);

  const t3Gap = Math.max(0, 50 - (attrs[T3] || 0) - 2);
  const cGap = Math.max(0, 60 - (attrs[CLOSE] || 0) - 2);
  off -= Math.min(6, 0.07 * threePenaltyMult(p) * t3Gap);
  off -= Math.min(6, 0.07 * closePenaltyMult(p) * cGap);

  const DW = ({
    PG: { [PERD]: 0.58, [STL]: 0.32, [SPD]: 0.06, [ATH]: 0.04 },
    SG: { [PERD]: 0.46, [STL]: 0.26, [INTD]: 0.12, [BLK]: 0.08, [SPD]: 0.04, [ATH]: 0.04 },
    SF: { [PERD]: 0.28, [STL]: 0.18, [INTD]: 0.28, [BLK]: 0.18, [ATH]: 0.05, [SPD]: 0.03 },
    PF: { [INTD]: 0.45, [BLK]: 0.35, [PERD]: 0.08, [STL]: 0.08, [ATH]: 0.04 },
    C:  { [INTD]: 0.52, [BLK]: 0.40, [ATH]: 0.06, [PERD]: 0.01, [STL]: 0.01 },
  })[p] || {};

  let zsumD = 0;
  for (const [kStr, wt] of Object.entries(DW)) zsumD += wt * zPos(Number(kStr));
  let def = zToRating(zsumD);

  const ath = attrs[ATH] ?? 75;
  let absPen = Math.max(0, 78 - ath) * 0.08;
  let relPen = Math.max(0, (posMean[p]?.[ATH] ?? 75) - ath) * 0.05;

  if (p === "SF") {
    absPen *= 0.8;
    relPen *= 0.8;
    def += 2.5;

    const perd = attrs[PERD] ?? 75;
    const intd = attrs[INTD] ?? 75;
    const hi = Math.max(perd, intd);
    const lo = Math.min(perd, intd);

    if (perd >= 88 && intd >= 88) def += Math.min(1.0, (Math.min(perd, intd) - 88) * 0.05);

    let tier = 0;
    if (perd >= 90 || intd >= 90) tier += 0.5;
    if (perd >= 85 && intd >= 85) tier += 0.5;
    if (hi >= 93 && lo >= 84) tier += 0.5;
    if (hi >= 94 && lo >= 90) tier += 0.5;
    def += Math.min(2.0, tier);
  }

  def -= Math.min(4, absPen + relPen);

  const j = v19Jitter(name, attrs);
  off = clampRange(off + offShift + j, 50, 99);

  const defCap = p === "C" ? 99 : p === "PF" ? 98 : 96;
  def = clampRange(def + defShift + 0.7 * j, 50, defCap);

  return { off: bankersRound(off), def: bankersRound(def) };
}

// Optional but recommended: keep SCO and STA consistent with editor
function explodeJS(value, power) {
  return (value / 100) ** power;
}

function closePenaltyJS(close) {
  if (close >= 70) return 0;
  return ((70 - close) / 30) ** 2.3;
}

function calcScoringRating(pos, three, mid, close) {
  if (pos === "PG" || pos === "SG") {
    const three_term = explodeJS(three, 7) * 1.2;
    const mid_term = explodeJS(mid, 7) * 1.55;
    const close_term = explodeJS(close, 6) * 1.1;

    const base = 0.38 * (three / 100) + 0.40 * (mid / 100) + 0.22 * (close / 100);
    const penalty = closePenaltyJS(close) * 1.7;

    const raw = base + three_term + mid_term + close_term - penalty;
    return raw * 14.75 + 43.5;
  }

  if (pos === "SF") {
    const three_term = explodeJS(three, 7) * 1.05;
    const mid_term = explodeJS(mid, 7) * 1.4;
    const close_term = explodeJS(close, 7) * 1.5;

    const base = 0.32 * (three / 100) + 0.35 * (mid / 100) + 0.33 * (close / 100);
    const penalty = closePenaltyJS(close) * 1.2;

    const raw = base + three_term + mid_term + close_term - penalty;
    return raw * 14.75 + 43.5;
  }

  if (pos === "PF" || pos === "C") {
    const close_term = explodeJS(close, 8) * 1.95;
    const mid_term = explodeJS(mid, 6) * 1.3;
    const three_term = explodeJS(three, 5) * 0.6;

    const base = 0.58 * (close / 100) + 0.27 * (mid / 100) + 0.15 * (three / 100);
    const penalty = closePenaltyJS(close) * 2.0;

    const raw = base + close_term + mid_term + three_term - penalty;
    return raw * 14.75 + 43.5;
  }

  return 50;
}

function recomputeDerivedRatingsInLeague(leagueData) {
  const baselines = buildRatingBaselinesFromLeague(leagueData);
  const teams = getAllTeamsFromLeague(leagueData);

  for (const t of teams || []) {
    for (const p of getProgressionPlayersFromTeam(t)) {
      const pos = ["PG", "SG", "SF", "PF", "C"].includes(p?.pos) ? p.pos : "SF";
      const name = p?.name || p?.player || "";
      const attrs = padAttrs(p?.attrs);

      p.attrs = attrs;

      p.overall = calcOverallFromAttrs(attrs, pos);

      const { off, def } = calcOffDefV19(attrs, pos, name, p?.height ?? 78, baselines);
      p.offRating = off;
      p.defRating = def;

      p.stamina = calcStaminaFromAgeAth(p?.age ?? 25, attrs[ATH]);
      const sco = calcScoringRating(pos, attrs[T3], attrs[MID], attrs[CLOSE]);
      p.scoringRating = Number.isFinite(sco)
        ? clampRange(Math.round(sco), 0, 99)
        : (p.scoringRating ?? 50);
    }
  }

  return leagueData;
}

export default function PlayerProgression() {
  const { leagueData, setLeagueData, selectedTeam, setSelectedTeam } = useGame();
  const navigate = useNavigate();
  const hasHydratedSavedProgressionRef = useRef(false);
  const selectedTeamNameRef = useRef(selectedTeam?.name || null);

  useEffect(() => {
    selectedTeamNameRef.current = selectedTeam?.name || null;
  }, [selectedTeam?.name]);

  function getPreferredSelectedTeamName() {
    if (selectedTeamNameRef.current) return selectedTeamNameRef.current;

    try {
      const saved = localStorage.getItem("selectedTeam");
      const parsed = saved ? JSON.parse(saved) : null;
      return parsed?.name || null;
    } catch {
      return null;
    }
  }

  function hydrateProgressedLeagueIntoState(updatedLeague, savedDeltas = readJsonSafe(DELTAS_KEY, {}), label = "") {
    if (!updatedLeague) return;

    console.log("[PlayerProgression] hydrating progressed league into React state", {
      label,
      savedDeltaCount:
        savedDeltas && typeof savedDeltas === "object"
          ? Object.keys(savedDeltas).length
          : 0,
    });

    ppDump(`HYDRATE_BEFORE_SET_STATE_${label}`, updatedLeague, { label });
    ppPersistenceAudit(updatedLeague, readJsonSafe(LEAGUE_KEY, null), `HYDRATE_EXPECTED_vs_STORAGE_${label}`, { label });

    setDeltas(savedDeltas || {});
    setLeagueData(updatedLeague);

    const preferredTeamName = getPreferredSelectedTeamName();
    const teamsLocal = getAllTeamsFromLeague(updatedLeague);
    const updatedTeam = teamsLocal.find((t) => t?.name === preferredTeamName);

    if (updatedTeam) {
      setSelectedTeam(updatedTeam);
      try {
        localStorage.setItem("selectedTeam", JSON.stringify(updatedTeam));
      } catch {}
    }

    setTimeout(() => {
      ppDump(`POST_HYDRATE_TIMEOUT_${label}`, updatedLeague, { label });
    }, 0);
  }

  function handleReturnToOffseasonHub() {
    const resolvedSeasonYear = inferSeasonYear(leagueData);

    const savedDeltas = readJsonSafe(DELTAS_KEY, {});
    const savedDeltaCount =
      savedDeltas && typeof savedDeltas === "object"
        ? Object.keys(savedDeltas).length
        : 0;

    // IMPORTANT:
    // Do not re-save the full leagueData here. Progression already committed leagueData
    // during the run. Re-saving the full league on the Back button can exceed the
    // browser localStorage quota and block the offseason hub from unlocking Step 5.
    try {
      const existingMeta = readJsonSafe(META_KEY, {}) || {};
      localStorage.setItem(
        META_KEY,
        JSON.stringify({
          ...existingMeta,
          seasonYear: resolvedSeasonYear,
          currentSeasonYear: resolvedSeasonYear,
          seasonStartYear: resolvedSeasonYear,
        })
      );
    } catch (err) {
      console.error("[PlayerProgression] failed to save league meta on return", err);
    }

    const savedLeagueForReturn = readJsonSafe(LEAGUE_KEY, null);
    const returnAgeAudit = getProgressionAgeCompletionAudit(savedLeagueForReturn, resolvedSeasonYear);
    const returnProgressionValid = savedDeltaCount > 0 && returnAgeAudit.ok;

    try {
      if (returnProgressionValid) {
        const existingProgMeta = readJsonSafe(PROG_META_KEY, {}) || {};
        localStorage.setItem(
          PROG_META_KEY,
          JSON.stringify({
            ...existingProgMeta,
            appliedForSeasonYear: resolvedSeasonYear,
            ts: Date.now(),
            deltaCount: savedDeltaCount,
            seasonYear: resolvedSeasonYear,
            deltasSaved: true,
            stage: "DONE",
          })
        );
      } else {
        console.error("[PlayerProgression] refusing to mark progression done on return because saved leagueData failed validation.", {
          resolvedSeasonYear,
          savedDeltaCount,
          returnAgeAudit,
        });
      }
    } catch (err) {
      console.error("[PlayerProgression] failed to save progression meta on return", err);
    }

    try {
      const existingOffseason = readJsonSafe(OFFSEASON_STATE_KEY, {}) || {};
      localStorage.setItem(
        OFFSEASON_STATE_KEY,
        JSON.stringify({
          ...existingOffseason,
          active: true,
          seasonYear: resolvedSeasonYear,
          progressionComplete: returnProgressionValid,
        })
      );
    } catch (err) {
      console.error("[PlayerProgression] failed to save offseason completion on return", err);
    }

    if (!returnProgressionValid) {
      console.warn("[PlayerProgression] returning to offseason without valid saved progression", {
        resolvedSeasonYear,
        savedDeltaCount,
        returnAgeAudit,
      });
    }

    ppDump("RETURN_TO_OFFSEASON_PRE_NAV", leagueData, {
      resolvedSeasonYear,
      savedDeltaCount,
    });
    ppPersistenceAudit(leagueData, readJsonSafe(LEAGUE_KEY, null), "RETURN_TO_OFFSEASON_CONTEXT_vs_STORAGE", {
      resolvedSeasonYear,
      savedDeltaCount,
    });
    ppLogAgeGuards("RETURN_TO_OFFSEASON_CONTEXT_GUARDS", leagueData, resolvedSeasonYear);
    ppLogAgeGuards("RETURN_TO_OFFSEASON_STORAGE_GUARDS", readJsonSafe(LEAGUE_KEY, null), resolvedSeasonYear);

    navigate("/offseason");
  }

  useEffect(() => {
    console.log("[PPDBG] MOUNT PlayerProgression");
    return () => console.log("[PPDBG] UNMOUNT PlayerProgression");
  }, []);

  console.count("[PPDBG] component render");

  const [showLetters, setShowLetters] = useState(localStorage.getItem("showLetters") === "true");
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [hasDefaultedTeamFilter, setHasDefaultedTeamFilter] = useState(false);
  const [featuredKey, setFeaturedKey] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: "overall", direction: "desc" });
  const [deltas, setDeltas] = useState(() => readJsonSafe(DELTAS_KEY, {}));


  useEffect(() => {
    if (!PP_DEBUG) return;

    window.BM_PP_DEBUG = {
      dump: (label = "manual") => ppDump(label, leagueData, { currentDeltasInReact: Object.keys(deltas || {}).length }),
      copyDump: (label = "manual-copy") => {
        const data = ppDump(label, leagueData, { currentDeltasInReact: Object.keys(deltas || {}).length });
        try {
          copy(JSON.stringify(data, null, 2));
          console.log("[PPDBG] copied debug dump to clipboard");
        } catch (err) {
          console.warn("[PPDBG] copy failed. Expand object above instead.", err);
        }
        return data;
      },
      keys: () => {
        const rows = ppAllStorageSizes();
        console.table(rows);
        return rows;
      },
      progressionKeys: () => {
        const rows = PP_STORAGE_KEYS.map(ppKeyInfo);
        console.table(rows.map(({ key, exists, kb, parseOk, deltaCount }) => ({ key, exists, kb, parseOk, deltaCount })));
        return rows;
      },
      player: (name) => ({
        context: ppFindPlayer(leagueData, name),
        storage: ppFindPlayer(readJsonSafe(LEAGUE_KEY, null), name),
        deltasByName: deltas?.[name] || null,
      }),
      ageAudit: (label = "manual-age-audit") => {
        const storageLeague = readJsonSafe(LEAGUE_KEY, null);
        return ppAgeAudit(storageLeague, leagueData, label, {
          note: "Compares saved localStorage leagueData to current React leagueData.",
        });
      },
      persistenceAudit: (label = "manual-persistence-audit") => {
        const storageLeague = readJsonSafe(LEAGUE_KEY, null);
        return ppPersistenceAudit(leagueData, storageLeague, label, {
          note: "Checks whether current React leagueData is exactly saved in localStorage.",
        });
      },
      guards: (label = "manual-guards") => {
        const seasonYear = inferSeasonYear(leagueData);
        return {
          context: ppLogAgeGuards(`${label}-context`, leagueData, seasonYear),
          storage: ppLogAgeGuards(`${label}-storage`, readJsonSafe(LEAGUE_KEY, null), seasonYear),
        };
      },
      deltasAge: (label = "manual-deltas-age") => ppDeltaAgeSummary(deltas, label),
      trackedAges: () => {
        const storageLeague = readJsonSafe(LEAGUE_KEY, null);
        const rows = {
          context: ppGetAgeRows(leagueData),
          storage: ppGetAgeRows(storageLeague),
        };
        console.table(rows.context);
        console.table(rows.storage);
        return rows;
      },
      clearProgressionOnly: () => {
        localStorage.removeItem(PROG_META_KEY);
        localStorage.removeItem(DELTAS_KEY);
        console.warn("[PPDBG] cleared only progression meta + deltas. leagueData was not cleared.");
        return ppDump("after-clearProgressionOnly", leagueData);
      },
    };

    console.warn("[PPDBG] window.BM_PP_DEBUG ready. Use BM_PP_DEBUG.copyDump() after the first-click test.");
    ppDump("WINDOW_DEBUG_READY", leagueData, { currentDeltasInReact: Object.keys(deltas || {}).length });
  }, [leagueData, deltas]);

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

  const positionOrder = ["PG", "SG", "SF", "PF", "C"];

  const handleSort = (key) => {
    let direction = "desc";

    if (sortConfig.key === key && sortConfig.direction === "desc") {
      direction = "asc";
    } else if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "default";
    }

    setSortConfig({ key, direction });
  };

  useEffect(() => {
    console.log("[PPDBG] selectedTeam loader effect", { selectedTeam: selectedTeam?.name || null });
    if (!selectedTeam) {
      const saved = localStorage.getItem("selectedTeam");
      if (saved) setSelectedTeam(JSON.parse(saved));
    }
  }, [selectedTeam, setSelectedTeam]);

  // Apply progression ONCE per season using Python
  useEffect(() => {
    if (!leagueData) return;

    const runId = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    ppDump("EFFECT_START", leagueData);
    console.groupCollapsed(`[PPDBG] useEffect ENTER runId=${runId}`);
    console.count("[PPDBG] useEffect fired");

    let cancelled = false;
    let inflightInterval = null;

    const findPlayerAnyTeam = (league, playerName) => {
      const teams = getAllTeamsFromLeague(league);

      for (const t of teams || []) {
        const teamName = t?.name || "";

        for (const p of getProgressionPlayersFromTeam(t)) {
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

    const rawLeagueMeta = localStorage.getItem(META_KEY);
    const rawProgMeta = localStorage.getItem(PROG_META_KEY);
    const seasonYear = inferSeasonYear(leagueData);

    console.log("[PPDBG] raw metas", {
      runId,
      rawLeagueMeta,
      rawProgMeta,
    });

    ppDump("EFFECT_AFTER_RAW_META", leagueData, { runId, rawLeagueMeta, rawProgMeta });

    console.log("[PPDBG] BEFORE (leagueData) peek", {
      runId,
      leagueData_seasonYear: leagueData?.seasonYear,
      leagueData_seasonStartYear: leagueData?.seasonStartYear,
      metaSeasonYear: getSeasonYearFromMeta(),
      inferredSeasonYear: seasonYear,
      derrick: findPlayerAnyTeam(leagueData, "Derrick White"),
      anfernee: findPlayerAnyTeam(leagueData, "Anfernee Simons"),
    });

    let progMeta = readJsonSafe(PROG_META_KEY, null);

    console.log("[PlayerProgression] seasonYear =", seasonYear);
    console.log("[PlayerProgression] leagueData.seasonYear =", leagueData?.seasonYear);
    console.log("[PlayerProgression] leagueData.seasonStartYear =", leagueData?.seasonStartYear);
    console.log("[PlayerProgression] progMeta =", progMeta);

    if (progMeta?.appliedForSeasonYear === "INFLIGHT") {
      const ageMs = Date.now() - Number(progMeta?.ts || 0);

      if (ageMs <= INFLIGHT_STALE_MS) {
        ppDump("BRANCH_INFLIGHT_ATTACH", leagueData, { runId, seasonYear, ageMs });
        console.log("[PlayerProgression] INFLIGHT detected, attaching instead of rerunning", {
          runId,
          seasonYear,
          ageMs,
        });

        inflightInterval = setInterval(() => {
          if (cancelled) return;

          const m = readJsonSafe(PROG_META_KEY, null);
          const done = m?.appliedForSeasonYear === seasonYear;

          if (done) {
            try {
              const updatedLeague = readJsonSafe(LEAGUE_KEY, null);
              const savedDeltas = readJsonSafe(DELTAS_KEY, {});
              const savedAgeAudit = getProgressionAgeCompletionAudit(updatedLeague, seasonYear);

              if (updatedLeague && savedAgeAudit.ok) {
                hydrateProgressedLeagueIntoState(updatedLeague, savedDeltas || {}, "inflight-attached-done");
              } else {
                console.error("[PlayerProgression] Inflight run finished with invalid saved ages. Clearing bad progression cache.", {
                  runId,
                  seasonYear,
                  savedAgeAudit,
                });
                try {
                  localStorage.removeItem(PROG_META_KEY);
                  localStorage.removeItem(DELTAS_KEY);
                } catch {}
                setTimeout(() => window.location.reload(), 0);
              }
            } finally {
              clearInterval(inflightInterval);
              inflightInterval = null;
            }
          }
        }, 200);

        console.groupEnd();

        return () => {
          cancelled = true;
          if (inflightInterval) clearInterval(inflightInterval);
        };
      }

      console.warn("[PlayerProgression] stale INFLIGHT detected, clearing meta so progression can rerun.", {
        runId,
        ageMs,
      });

      try {
        localStorage.removeItem(PROG_META_KEY);
      } catch {}

      progMeta = null;
    }

    // If already applied this season, only trust the lock if deltas exist AND saved leagueData proves players aged for this season.
    if (progMeta?.appliedForSeasonYear === seasonYear) {
      const savedDeltas = readJsonSafe(DELTAS_KEY, {});
      const savedDeltaCount =
        savedDeltas && typeof savedDeltas === "object"
          ? Object.keys(savedDeltas).length
          : 0;
      const savedLeague = readJsonSafe(LEAGUE_KEY, null);
      const savedAgeAudit = getProgressionAgeCompletionAudit(savedLeague, seasonYear);
      const canTrustSavedProgression =
        savedDeltaCount > 0 &&
        progMeta?.deltasSaved !== false &&
        savedAgeAudit.ok;

      if (canTrustSavedProgression) {
        ppDump("BRANCH_ALREADY_APPLIED", leagueData, { runId, seasonYear, savedDeltaCount, progMeta, savedAgeAudit });
        console.log("[PlayerProgression] Already applied this season. Loading saved deltas and saved league.", {
          seasonYear,
          savedDeltaCount,
          progMeta,
          savedAgeAudit,
        });

        setDeltas(savedDeltas);

        if (!hasHydratedSavedProgressionRef.current) {
          hasHydratedSavedProgressionRef.current = true;

          if (savedLeague) {
            const currentSig = leagueProgressionSignature(leagueData);
            const savedSig = leagueProgressionSignature(savedLeague);

            console.log("[PlayerProgression] hydration check", {
              seasonYear,
              currentSig,
              savedSig,
              shouldHydrate: currentSig !== savedSig,
            });

            if (currentSig !== savedSig) {
              hydrateProgressedLeagueIntoState(savedLeague, savedDeltas, "already-applied-hydration");
            }
          } else {
            console.warn("[PlayerProgression] Deltas exist but saved leagueData was missing.");
          }
        }

        console.groupEnd();
        return;
      }

      console.warn("[PlayerProgression] Bad progression lock found. Clearing so progression can run.", {
        seasonYear,
        progMeta,
        savedDeltaCount,
        savedAgeAudit,
      });

      try {
        localStorage.removeItem(PROG_META_KEY);
        localStorage.removeItem(DELTAS_KEY);
      } catch {}

      progMeta = null;
    }

    const statsByKeyPreview = loadStatsByKeyFromStorage();
    const hasStats = statsByKeyPreview && Object.keys(statsByKeyPreview).length > 0;

    if (!hasStats) {
      console.warn("[PlayerProgression] No stats found. Running progression without stats.");
    }

    try {
      ppDump("BRANCH_RUN_NEW_BEFORE_INFLIGHT", leagueData, { runId, seasonYear, hasStats });
      console.log("[PPDBG] setting INFLIGHT", {
        runId,
        seasonYear,
      });

      localStorage.setItem(
        PROG_META_KEY,
        JSON.stringify({
          appliedForSeasonYear: "INFLIGHT",
          ts: Date.now(),
          seasonYear,
          runId,
        })
      );
    } catch {}

    (async () => {
      try {
        const beforeSnapshot = snapshotLeague(leagueData);

        ppDump("ASYNC_BEFORE_SNAPSHOT_CREATED", beforeSnapshot, { runId, seasonYear });
        ppLogAgeGuards("BEFORE_SNAPSHOT_GUARDS", beforeSnapshot, seasonYear);
        console.groupCollapsed("%c[AGEDBG:TRACKED_BEFORE_COMPUTE]", "color:#a855f7;font-weight:bold");
        try { console.table(ppGetAgeRows(beforeSnapshot)); } catch {}
        console.groupEnd();

        const leagueForProg = prepareLeagueForProgressionWorker(leagueData, seasonYear);
        leagueForProg.seasonYear = seasonYear;
        leagueForProg.currentSeasonYear = seasonYear;
        leagueForProg.seasonStartYear = seasonYear;

        ppDump("ASYNC_LEAGUE_FOR_PROG_READY", leagueForProg, { runId, seasonYear });
        ppLogAgeGuards("LEAGUE_FOR_PROG_GUARDS", leagueForProg, seasonYear);

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

        const shouldUpdateReactState = !cancelled;

        if (cancelled) {
          console.warn("[PlayerProgression] Owner effect was cleaned up before worker returned. Still committing storage so attached run can finish.", {
            runId,
            seasonYear,
          });
        }

        console.log("[DEBUG] raw deltas from Python:", JSON.stringify(msg?.deltas ?? msg?.payload?.deltas));

        // Support both shapes:
        // 1) msg = { league, deltas, version }
        // 2) msg = { type, requestId, payload: { league, deltas, version } }
        const res = msg?.league ? msg : msg?.payload;

        ppDump("WORKER_RETURNED_BEFORE_PARSE", leagueData, { runId, seasonYear });
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

        let updatedLeague = restoreTwoWayBucketsAfterProgression(res.league, beforeSnapshot);

        updatedLeague.seasonYear = seasonYear;
        updatedLeague.currentSeasonYear = seasonYear;
        updatedLeague.seasonStartYear = seasonYear;

        ppDump("PYTHON_RAW_UPDATED_LEAGUE_BEFORE_STAMP", updatedLeague, { runId, seasonYear });
        ppAgeAudit(beforeSnapshot, updatedLeague, "BEFORE_vs_PYTHON_RAW_UPDATED_LEAGUE", {
          runId,
          seasonYear,
          checkpoint: "immediately after worker return, before stampAgingGuards and recomputeDerivedRatingsInLeague",
        });
        ppLogAgeGuards("PYTHON_RAW_UPDATED_LEAGUE_GUARDS", updatedLeague, seasonYear);

        updatedLeague = stampAgingGuards(updatedLeague, seasonYear);

        ppDump("AFTER_STAMP_AGING_GUARDS", updatedLeague, { runId, seasonYear });
        ppAgeAudit(beforeSnapshot, updatedLeague, "BEFORE_vs_AFTER_STAMP_AGING_GUARDS", {
          runId,
          seasonYear,
          checkpoint: "after stampAgingGuards",
        });
        ppLogAgeGuards("AFTER_STAMP_AGING_GUARDS", updatedLeague, seasonYear);

        updatedLeague = stampCareerSeasonCounters(updatedLeague, seasonYear);

        // FORCE LeagueEditor formulas as the source of truth for derived ratings
        updatedLeague = recomputeDerivedRatingsInLeague(updatedLeague);

        // Current-year draft picks have not played a season yet, so keep their
        // draft-night ratings/age/counters exactly unchanged this offseason.
        updatedLeague = restoreCurrentDraftClassRookiesAfterProgression(updatedLeague, beforeSnapshot, seasonYear);

        ppDump("AFTER_RECOMPUTE_DERIVED_RATINGS", updatedLeague, { runId, seasonYear });
        ppAgeAudit(beforeSnapshot, updatedLeague, "BEFORE_vs_FINAL_UPDATED_LEAGUE_AFTER_RECOMPUTE", {
          runId,
          seasonYear,
          checkpoint: "final updatedLeague before deltas are built and before save",
        });
        ppLogAgeGuards("FINAL_UPDATED_LEAGUE_GUARDS", updatedLeague, seasonYear);

        // Build deltas from final values so the UI matches exactly
        const newDeltas = buildProgressionDeltas(beforeSnapshot, updatedLeague);
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
          source: res?.deltas && Object.keys(res.deltas || {}).length > 0 ? "python" : "js_fallback",
          derrickKey,
          anferneeKey,
          derrickDelta: derrickKey ? newDeltas?.[derrickKey] : null,
          anferneeDelta: anferneeKey ? newDeltas?.[anferneeKey] : null,
        });

        const deltaCount = Object.keys(newDeltas || {}).length;
        const ageDeltaDebugSummary = ppDeltaAgeSummary(newDeltas, "NEW_DELTAS_AFTER_BUILD", {
          runId,
          seasonYear,
          deltaCount,
        });
        console.log("[PlayerProgression] deltas count:", deltaCount);
        console.log("[AGEDBG:AGE_DELTA_CHECKPOINT]", {
          runId,
          seasonYear,
          deltaCount,
          ageDeltaDebugSummary,
        });

        if (deltaCount === 0) {
          throw new Error(`[PlayerProgression] deltaCount = 0 for seasonYear = ${seasonYear}. Refusing to lock season.`);
        }

        ppDump("BEFORE_COMMITS", leagueData, { runId, seasonYear, deltaCount });
        console.log("[PPDBG] preparing progression commits", {
          runId,
          seasonYear,
          deltaCount,
        });

        const metaNow = readJsonSafe(PROG_META_KEY, null);
        const stillOwner =
          metaNow?.appliedForSeasonYear === "INFLIGHT" &&
          metaNow?.seasonYear === seasonYear &&
          metaNow?.runId === runId;

        if (!stillOwner) {
          console.warn("[PlayerProgression] Not owner anymore - skipping commits", {
            runId,
            seasonYear,
            metaNow,
          });

          console.groupEnd();
          return;
        }

        // Free heavy season stat keys before saving leagueData so localStorage quota does not block the commit.
        const statKeysToClearBeforeSave = [
          "bm_player_stats_v1",
          "bm_season_player_stats_v1",
          "playerStatsByKey",
          "statsByKey",
        ];

        for (const store of [localStorage, sessionStorage]) {
          for (const k of statKeysToClearBeforeSave) {
            try {
              store.removeItem(k);
            } catch {}
          }
        }

        console.log("[PlayerProgression] cleared season stat keys before saving league:", statKeysToClearBeforeSave);

        let leagueForSave = compactLeagueDataForProgressionStorage(updatedLeague, false);
        let didSaveLeague = false;
        let didSaveDeltas = false;

        try {
          console.log("[PPDBG] writing DELTAS_KEY", {
            runId,
            seasonYear,
            deltaCount: Object.keys(newDeltas || {}).length,
          });

          didSaveDeltas = ppTrySetItem(DELTAS_KEY, newDeltas, "progression-deltas");

          console.log("[PPDBG] writing LEAGUE_KEY", {
            runId,
            seasonYear,
            compactedForProgressionSave: true,
          });

          didSaveLeague = ppTrySetItem(LEAGUE_KEY, leagueForSave, "progressed-leagueData");

          if (!didSaveLeague) {
            console.warn("[PlayerProgression] Normal compact progression save failed. Retrying emergency compact save.", {
              runId,
              seasonYear,
            });
            leagueForSave = compactLeagueDataForProgressionStorage(updatedLeague, true);
            didSaveLeague = ppTrySetItem(LEAGUE_KEY, leagueForSave, "progressed-leagueData-emergency-compact");
          }

          const savedLeagueImmediately = readJsonSafe(LEAGUE_KEY, null);
          const savedDeltasImmediately = readJsonSafe(DELTAS_KEY, {});
          const savedAgeAudit = getProgressionAgeCompletionAudit(savedLeagueImmediately, seasonYear);

          ppDump("AFTER_WRITING_LEAGUE_AND_DELTAS", leagueForSave, {
            runId,
            seasonYear,
            deltaCount,
            didSaveDeltas,
            didSaveLeague,
            savedAgeAudit,
          });
          ppPersistenceAudit(leagueForSave, savedLeagueImmediately, "UPDATED_LEAGUE_vs_LOCALSTORAGE_IMMEDIATELY_AFTER_SAVE", {
            runId,
            seasonYear,
            didSaveDeltas,
            didSaveLeague,
            savedAgeAudit,
          });
          ppAgeAudit(beforeSnapshot, savedLeagueImmediately, "BEFORE_vs_SAVED_LOCALSTORAGE_AFTER_SAVE", {
            runId,
            seasonYear,
            didSaveLeague,
            savedAgeAudit,
          });
          ppLogAgeGuards("SAVED_LOCALSTORAGE_AFTER_SAVE_GUARDS", savedLeagueImmediately, seasonYear);
          ppDeltaAgeSummary(savedDeltasImmediately, "SAVED_DELTAS_IMMEDIATELY_AFTER_SAVE", {
            runId,
            seasonYear,
            didSaveDeltas,
          });

          if (!didSaveLeague || !didSaveDeltas) {
            throw new Error(`[PlayerProgression] Refusing to mark progression complete because storage save failed. didSaveLeague=${didSaveLeague}, didSaveDeltas=${didSaveDeltas}`);
          }

          if (!savedAgeAudit.ok) {
            throw new Error(`[PlayerProgression] Refusing to mark progression complete because saved leagueData failed age validation for ${seasonYear}. staleCount=${savedAgeAudit.staleCount}`);
          }

          console.log("[PPDBG] saved progression league + deltas", {
            runId,
            seasonYear,
            didSaveLeague,
            didSaveDeltas,
            savedAgeAudit,
            savedDeltaCount: Object.keys(readJsonSafe(DELTAS_KEY, {}) || {}).length,
          });
        } catch (e) {
          console.error("[PlayerProgression] Failed to save progression league/deltas. Not locking season.", e);

          try {
            localStorage.setItem(
              PROG_META_KEY,
              JSON.stringify({
                appliedForSeasonYear: "ERROR",
                ts: Date.now(),
                seasonYear,
                runId,
                error: String(e),
              })
            );
          } catch {}

          throw e;
        }

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

        // Mark progression DONE before touching React league state.
        // This prevents the leagueData state update from immediately retriggering this effect
        // while the lock still says INFLIGHT.
        localStorage.setItem(
          PROG_META_KEY,
          JSON.stringify({
            appliedForSeasonYear: seasonYear,
            ts: Date.now(),
            deltaCount,
            seasonYear,
            deltasSaved: true,
            stage: "DONE",
          })
        );

        const existingOffseason = readJsonSafe(OFFSEASON_STATE_KEY, {}) || {};

        localStorage.setItem(
          OFFSEASON_STATE_KEY,
          JSON.stringify({
            ...existingOffseason,
            active: true,
            seasonYear,
            progressionComplete: true,
          })
        );

        ppDump("AFTER_MARKING_PROGRESSION_DONE_AND_OFFSEASON_COMPLETE", leagueForSave, {
          runId,
          seasonYear,
          deltaCount,
          progMeta: readJsonSafe(PROG_META_KEY, null),
          offseasonState: readJsonSafe(OFFSEASON_STATE_KEY, null),
        });
        ppPersistenceAudit(leagueForSave, readJsonSafe(LEAGUE_KEY, null), "UPDATED_LEAGUE_vs_STORAGE_AFTER_DONE_MARKERS", {
          runId,
          seasonYear,
          deltaCount,
        });

        if (shouldUpdateReactState) {
          ppDump("BEFORE_REACT_HYDRATE_OWNER", leagueData, { runId, seasonYear, deltaCount });
          hydrateProgressedLeagueIntoState(leagueForSave, newDeltas, "owner-run-complete");
        } else {
          console.log("[PlayerProgression] Skipped React state update because owner effect was cleaned up. Attached run will load saved results.", {
            runId,
            seasonYear,
          });
        }

        ppDump("DONE_FINAL", leagueForSave, { runId, seasonYear, deltaCount, shouldUpdateReactState });
        console.log("[PPDBG] DONE", {
          runId,
          seasonYear,
          savedProgMeta: readJsonSafe(PROG_META_KEY, null),
          savedDeltaCount: Object.keys(readJsonSafe(DELTAS_KEY, {}) || {}).length,
        });

        console.groupEnd();
      } catch (err) {
        console.error("[PlayerProgression] Python progression failed:", err);

        try {
          localStorage.setItem(
            PROG_META_KEY,
            JSON.stringify({
              appliedForSeasonYear: "ERROR",
              ts: Date.now(),
              seasonYear,
              runId,
              error: String(err),
            })
          );
        } catch {}

        console.log("[PPDBG] ERROR end", {
          runId,
          err: String(err),
        });

        console.groupEnd();
      }
    })();

    return () => {
      cancelled = true;

      if (inflightInterval) {
        clearInterval(inflightInterval);
      }
    };
  }, [leagueData, setLeagueData, setSelectedTeam]);

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
      for (const p of getProgressionPlayersFromTeam(t)) {
        rows.push({ ...p, team: teamName, __key: playerKey(p?.name, teamName) });
      }
    }
    return rows;
  }, [teams]);

  const teamOptions = useMemo(() => {
    const names = Array.from(new Set((teams || []).map((t) => t?.name).filter(Boolean))).sort();
    return ["ALL", ...names];
  }, [teams]);

  useEffect(() => {
    if (hasDefaultedTeamFilter) return;
    const selectedTeamName = selectedTeam?.name;
    if (!selectedTeamName) return;
    if (!teamOptions.includes(selectedTeamName)) return;

    setTeamFilter(selectedTeamName);
    setFeaturedKey(null);
    setSortConfig({ key: "overall", direction: "desc" });
    setHasDefaultedTeamFilter(true);
  }, [hasDefaultedTeamFilter, selectedTeam?.name, teamOptions]);

  const rows = useMemo(() => {
    if (teamFilter === "ALL") return allRows;
    return allRows.filter((r) => r.team === teamFilter);
  }, [allRows, teamFilter]);

  const sortedRows = useMemo(() => {
    if (!sortConfig.key || sortConfig.direction === "default") return rows;

    const out = [...rows];

    out.sort((a, b) => {
      const key = sortConfig.key;

      if (key === "name") {
        return sortConfig.direction === "asc"
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      }

      if (key === "team") {
        return sortConfig.direction === "asc"
          ? (a.team || "").localeCompare(b.team || "")
          : (b.team || "").localeCompare(a.team || "");
      }

      if (key === "pos") {
        const aIdx = positionOrder.indexOf(a.pos);
        const bIdx = positionOrder.indexOf(b.pos);
        const diff = (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
        return sortConfig.direction === "asc" ? diff : -diff;
      }

      if (["age", "overall", "offRating", "defRating", "stamina", "potential"].includes(key)) {
        const av = Number(a[key] || 0);
        const bv = Number(b[key] || 0);
        return sortConfig.direction === "asc" ? av - bv : bv - av;
      }

      if (key.startsWith("attr")) {
        const idx = parseInt(key.replace("attr", ""), 10);
        const av = Number(a.attrs?.[idx] ?? 0);
        const bv = Number(b.attrs?.[idx] ?? 0);
        return sortConfig.direction === "asc" ? av - bv : bv - av;
      }

      return 0;
    });

    return out;
  }, [rows, sortConfig]);

  useEffect(() => {
    if (!featuredKey && sortedRows.length) setFeaturedKey(sortedRows[0].__key);
  }, [sortedRows, featuredKey]);

  const featured = useMemo(() => {
    if (!sortedRows.length) return null;
    return sortedRows.find((r) => r.__key === featuredKey) || sortedRows[0];
  }, [sortedRows, featuredKey]);

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
      <div className={`${styles.progressionPage} min-h-screen text-white flex items-center justify-center`}>
        Loading progression...
      </div>
    );
  }

  return (
    <div className={`${styles.progressionPage} min-h-screen text-white py-10`}>
      <style>{`
        .bm-orange-scroll {
          scrollbar-width: thin;
          scrollbar-color: #f97316 #171717;
        }

        .bm-orange-scroll::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }

        .bm-orange-scroll::-webkit-scrollbar-track {
          background: #171717;
          border-radius: 9999px;
        }

        .bm-orange-scroll::-webkit-scrollbar-thumb {
          background: linear-gradient(to bottom, #f97316, #c2410c);
          border-radius: 9999px;
          border: 2px solid #171717;
        }

        .bm-orange-scroll::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(to bottom, #fb923c, #ea580c);
        }
      `}</style>

      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-4xl font-extrabold text-orange-500">Player Progression</h1>
          <div className="flex items-center gap-3">
            <select
              value={teamFilter}
              onChange={(e) => {
                setTeamFilter(e.target.value);
                setFeaturedKey(null);
                setSortConfig({ key: "overall", direction: "desc" });
                setHasDefaultedTeamFilter(true);
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
              onClick={handleReturnToOffseasonHub}
              className="px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
            >
              Back to Offseason Hub
            </button>
          </div>
        </div>

        {featured && (
          <div className={`${styles.featurePanel} relative bg-neutral-800/95 backdrop-blur-md border border-neutral-700 rounded-xl shadow-lg px-8 pt-7 pb-4 mb-6`}>
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
        <div className={`${styles.tablePanel} bm-orange-scroll max-h-[610px] overflow-auto rounded-xl border border-neutral-700 bg-neutral-900`}>
          <div className="min-w-[1300px] max-w-max mx-auto">
            <table className="w-full border-collapse text-center">
              <thead className="sticky top-0 z-20 bg-neutral-800 text-gray-300 text-[16px] font-semibold">
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
                      } cursor-pointer select-none`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSort(col.key);
                      }}
                    >
                      {col.label}
                      {sortConfig.key === col.key && (
                        <span className="ml-1 text-orange-400">
                          {sortConfig.direction === "asc"
                            ? "▲"
                            : sortConfig.direction === "desc"
                            ? "▼"
                            : ""}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="text-[17px] font-medium">
                {sortedRows.map((p, idx) => {
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
