import { getAllTeamsFromLeague, getDraftYear, getSeasonStartYear } from "./seasonContext.js";
import {
  deleteAppDataByPrefixFromDB,
  deleteAppDataFromDB,
  loadAppDataEntriesByPrefixFromDB,
  saveAppDataToDB,
} from "./indexedDbStorage.js";
import {
  readCustomDraftClassForYear,
  readDefaultCustomDraftClass,
} from "./customDraftClassStorage.js";

export const UPCOMING_DRAFT_CLASS_PREFIX = "bm_upcoming_draft_class_";
export const DRAFT_STARTED_PREFIX = "bm_draft_started_";

const UPCOMING_DRAFT_CLASS_SCHEMA_VERSION = 2;

const DRAFT_STATE_KEY = "bm_draft_state_v1";
const CUSTOM_DRAFT_CLASS_MODE_KEY = "bm_draft_class_mode_v1";
const CUSTOM_DRAFT_CLASS_MODE_BY_YEAR_KEY = "bm_draft_class_mode_by_year_v1";

const upcomingDraftClassCache = new Map();
let upcomingDraftStorageInitialized = false;
let upcomingDraftWriteChain = Promise.resolve();
let upcomingDraftLastPersistError = null;

function queueUpcomingDraftPersistence(operation) {
  upcomingDraftWriteChain = upcomingDraftWriteChain
    .catch(() => {})
    .then(operation)
    .catch((error) => {
      upcomingDraftLastPersistError = error;
      console.warn("[UpcomingDraft] IndexedDB persistence failed", error);
      return false;
    });
  return upcomingDraftWriteChain;
}

function readLegacyUpcomingDraftRows() {
  const rows = [];
  if (typeof localStorage === "undefined") return rows;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !key.startsWith(UPCOMING_DRAFT_CLASS_PREFIX)) continue;
    const value = safeJSON(localStorage.getItem(key), null);
    if (value && typeof value === "object") rows.push({ key, value });
  }
  return rows;
}

export async function flushUpcomingDraftClassStorageWrites() {
  await upcomingDraftWriteChain.catch(() => {});
}

export async function initializeUpcomingDraftClassStorage({ reset = false } = {}) {
  if (upcomingDraftStorageInitialized && !reset) return getUpcomingDraftClassStorageReport();

  if (reset) {
    upcomingDraftClassCache.clear();
    if (typeof localStorage !== "undefined") {
      const keys = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith(UPCOMING_DRAFT_CLASS_PREFIX)) keys.push(key);
      }
      for (const key of keys) localStorage.removeItem(key);
    }
    try {
      await deleteAppDataByPrefixFromDB(UPCOMING_DRAFT_CLASS_PREFIX);
    } catch (error) {
      console.warn("[UpcomingDraft] reset could not clear IndexedDB previews", error);
    }
    upcomingDraftStorageInitialized = true;
    return getUpcomingDraftClassStorageReport();
  }

  try {
    const dbRows = await loadAppDataEntriesByPrefixFromDB(UPCOMING_DRAFT_CLASS_PREFIX);
    for (const row of dbRows || []) {
      if (row?.key && row?.value && typeof row.value === "object") {
        upcomingDraftClassCache.set(String(row.key), row.value);
      }
    }
  } catch (error) {
    console.warn("[UpcomingDraft] IndexedDB bootstrap read failed", error);
  }

  // One-time migration. Legacy localStorage wins because it is the newest value
  // produced by the pre-migration code. Remove each key only after its DB save.
  for (const row of readLegacyUpcomingDraftRows()) {
    upcomingDraftClassCache.set(row.key, row.value);
    try {
      await saveAppDataToDB(row.key, row.value);
      localStorage.removeItem(row.key);
      upcomingDraftLastPersistError = null;
    } catch (error) {
      upcomingDraftLastPersistError = error;
      console.warn("[UpcomingDraft] legacy preview migration failed; keeping localStorage copy", row.key, error);
    }
  }

  upcomingDraftStorageInitialized = true;
  return getUpcomingDraftClassStorageReport();
}

export async function getUpcomingDraftClassStorageReport() {
  let dbRows = [];
  let indexedDbReadable = false;
  try {
    dbRows = await loadAppDataEntriesByPrefixFromDB(UPCOMING_DRAFT_CLASS_PREFIX);
    indexedDbReadable = true;
  } catch {}

  const legacyKeys = [];
  if (typeof localStorage !== "undefined") {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(UPCOMING_DRAFT_CLASS_PREFIX)) legacyKeys.push(key);
    }
  }

  return {
    initialized: upcomingDraftStorageInitialized,
    storage: "indexedDB",
    cachedYears: upcomingDraftClassCache.size,
    indexedDbYears: dbRows.length,
    indexedDbReadable,
    legacyLocalStorageKeys: legacyKeys,
    lastPersistError: upcomingDraftLastPersistError
      ? String(upcomingDraftLastPersistError?.message || upcomingDraftLastPersistError)
      : null,
  };
}

export function safeJSON(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function getUpcomingDraftYearForPhase(
  leagueData = {},
  { isOffseasonMode = false } = {}
) {
  const currentDraftYear = Number(getDraftYear(leagueData) || 0);
  const nextRegularSeasonDraftYear = Number(getSeasonStartYear(leagueData) || 0) + 1;

  // During the offseason, the active draft belongs to the season that just ended.
  // Once the next regular season begins, scouting must immediately roll forward
  // to the following draft class even if leagueData.currentDraftYear still points
  // at the draft that was just completed.
  if (isOffseasonMode) {
    return currentDraftYear || nextRegularSeasonDraftYear || 2026;
  }

  return Math.max(currentDraftYear || 0, nextRegularSeasonDraftYear || 0) || 2026;
}

export function getRowsFromDraftClassPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.draftClass)) return payload.draftClass;
  if (Array.isArray(payload?.availableProspects)) return payload.availableProspects;
  if (Array.isArray(payload?.prospects)) return payload.prospects;
  if (Array.isArray(payload?.players)) return payload.players;
  return [];
}

function safeRankValue(value, fallback = 999) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function compareProspectBoardOrder(a = {}, b = {}) {
  return (
    safeRankValue(a.draftProjection ?? a.trueRank ?? a.rank, 999) -
      safeRankValue(b.draftProjection ?? b.trueRank ?? b.rank, 999) ||
    safeRankValue(a.trueRank ?? a.rank ?? a.draftProjection, 999) -
      safeRankValue(b.trueRank ?? b.rank ?? b.draftProjection, 999) ||
    safeRankValue(b.potential ?? b.pot ?? b.potential_rating, -1) -
      safeRankValue(a.potential ?? a.pot ?? a.potential_rating, -1) ||
    safeRankValue(b.overall ?? b.ovr ?? b.rating, -1) -
      safeRankValue(a.overall ?? a.ovr ?? a.rating, -1) ||
    String(a.name || a.playerName || "").localeCompare(String(b.name || b.playerName || "")) ||
    safeRankValue(a.__draftBoardOriginalIndex, 9999) - safeRankValue(b.__draftBoardOriginalIndex, 9999)
  );
}

export function normalizeDraftClassRanks(rows = []) {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row, index) => ({ ...row, __draftBoardOriginalIndex: index }))
    .sort(compareProspectBoardOrder)
    .map((row, index) => {
      const { __draftBoardOriginalIndex, ...cleanRow } = row;
      const rank = index + 1;
      return {
        ...cleanRow,
        draftProjection: rank,
        rank,
        boardRank: rank,
      };
    });
}

export function normalizeDraftClassRows(payload, seasonYear) {
  const resolvedYear = Number(seasonYear || 2026);
  const rows = getRowsFromDraftClassPayload(payload).map((row, index) => {
    const projection = Number(row?.draftProjection || row?.trueRank || row?.rank || index + 1);
    const trueRank = Number(row?.trueRank || row?.draftProjection || row?.rank || index + 1);
    const name = row?.name || row?.playerName || `Prospect ${index + 1}`;
    const primaryPos = row?.pos || row?.position || "-";
    const secondaryPos = [
      row?.secondaryPos,
      row?.secondaryPosition,
      row?.secondPos,
      row?.secondary_pos,
    ].find((value) => value && String(value).trim() && String(value).trim() !== primaryPos) || "";

    return {
      ...row,
      id: row?.id || row?.playerId || row?.prospectId || `upcoming_${resolvedYear}_${String(index + 1).padStart(3, "0")}`,
      name,
      playerName: row?.playerName || name,
      seasonYear: Number(row?.seasonYear || row?.draftClassYear || resolvedYear),
      draftClassYear: Number(row?.draftClassYear || row?.seasonYear || resolvedYear),
      draftProjection: Number.isFinite(projection) ? projection : index + 1,
      trueRank: Number.isFinite(trueRank) ? trueRank : index + 1,
      overall: Number(row?.overall ?? row?.ovr ?? row?.rating ?? 0) || 0,
      potential: Number(row?.potential ?? row?.pot ?? row?.potential_rating ?? 0) || 0,
      pos: primaryPos,
      position: row?.position || row?.pos || "-",
      secondaryPos,
      secondaryPosition: secondaryPos,
      archetype: row?.archetype || row?.type || "Prospect",
      tier: row?.tier || "Draft Prospect",
    };
  });

  return normalizeDraftClassRanks(rows);
}

function fnv1a(value = "") {
  let hash = 0x811c9dc5;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function getDraftClassFingerprint(payload) {
  const rows = getRowsFromDraftClassPayload(payload);
  const signature = rows
    .map((row, index) => [
      row?.id || row?.playerId || row?.prospectId || index,
      row?.name || row?.playerName || "",
      row?.overall ?? row?.ovr ?? row?.rating ?? "",
      row?.potential ?? row?.pot ?? row?.potential_rating ?? "",
      row?.age ?? "",
      row?.draftProjection ?? row?.trueRank ?? row?.rank ?? index + 1,
    ].join("~"))
    .join("|");
  return `${rows.length}:${fnv1a(signature)}`;
}

function readDraftClassModeForYear(seasonYear, hasCustomClass = false) {
  const yearKey = String(Number(seasonYear || 2026));
  const modesByYear = safeJSON(localStorage.getItem(CUSTOM_DRAFT_CLASS_MODE_BY_YEAR_KEY), {}) || {};
  const explicitYearMode = modesByYear?.[yearKey];

  if (explicitYearMode === "custom" || explicitYearMode === "auto") {
    return explicitYearMode;
  }

  const legacyModeConfig = safeJSON(localStorage.getItem(CUSTOM_DRAFT_CLASS_MODE_KEY), {}) || {};
  if (legacyModeConfig.mode === "custom") return "custom";
  if (legacyModeConfig.mode === "auto") return "auto";

  return hasCustomClass ? "custom" : "auto";
}

export function readCustomDraftClassSetupForYear(seasonYear) {
  const resolvedYear = Number(seasonYear || 2026);
  const savedSeasonClass = readCustomDraftClassForYear(resolvedYear);
  const savedDefaultClass = readDefaultCustomDraftClass();
  const draftClassPayload = savedSeasonClass || savedDefaultClass || null;
  const rows = getRowsFromDraftClassPayload(draftClassPayload);
  const hasCustomClass = rows.length > 0;
  const mode = readDraftClassModeForYear(resolvedYear, hasCustomClass);

  if (mode !== "custom") {
    return { mode, hasCustomClass, draftClassPayload: null, fingerprint: "auto" };
  }

  if (!draftClassPayload || !hasCustomClass) {
    return { mode, hasCustomClass: false, draftClassPayload: null, fingerprint: "missing-custom" };
  }

  const classSeasonYear = Number(
    draftClassPayload?.seasonYear ||
      draftClassPayload?.draftClassYear ||
      rows?.[0]?.draftClassYear ||
      rows?.[0]?.seasonYear ||
      resolvedYear
  );

  if (classSeasonYear && classSeasonYear !== resolvedYear) {
    return { mode, hasCustomClass: false, draftClassPayload: null, fingerprint: "wrong-year-custom" };
  }

  const normalizedRows = normalizeDraftClassRows(draftClassPayload, resolvedYear);
  const normalizedPayload = {
    ...draftClassPayload,
    seasonYear: resolvedYear,
    draftClassYear: resolvedYear,
    draftClass: normalizedRows,
  };

  return {
    mode,
    hasCustomClass: true,
    draftClassPayload: normalizedPayload,
    fingerprint: getDraftClassFingerprint(normalizedRows),
  };
}


function slimUpcomingDraftProspect(row = {}, index = 0, seasonYear = 2026) {
  const name = row?.name || row?.playerName || `Prospect ${index + 1}`;
  const primaryPos = row?.pos || row?.position || "-";
  const secondaryPos = [
    row?.secondaryPos,
    row?.secondaryPosition,
    row?.secondPos,
    row?.secondary_pos,
  ].find((value) => value && String(value).trim() && String(value).trim() !== primaryPos) || "";
  return {
    id: row?.id || row?.playerId || row?.prospectId || `upcoming_${seasonYear}_${String(index + 1).padStart(3, "0")}`,
    name,
    playerName: row?.playerName || name,
    seasonYear: Number(row?.seasonYear || row?.draftClassYear || seasonYear),
    draftClassYear: Number(row?.draftClassYear || row?.seasonYear || seasonYear),
    draftProjection: Number(row?.draftProjection || row?.trueRank || row?.rank || index + 1),
    trueRank: Number(row?.trueRank || row?.draftProjection || row?.rank || index + 1),
    rank: Number(row?.rank || row?.draftProjection || row?.trueRank || index + 1),
    boardRank: Number(row?.boardRank || row?.rank || row?.draftProjection || index + 1),
    pos: primaryPos,
    position: row?.position || row?.pos || "-",
    secondaryPos,
    secondaryPosition: secondaryPos,
    age: Number(row?.age ?? row?.playerAge ?? 0) || 0,
    height: row?.height ?? null,
    weight: row?.weight ?? null,
    overall: Number(row?.overall ?? row?.ovr ?? row?.rating ?? 0) || 0,
    potential: Number(row?.potential ?? row?.pot ?? row?.potential_rating ?? 0) || 0,
    archetype: row?.archetype || row?.type || "Prospect",
    tier: row?.tier || "Draft Prospect",
    college: row?.college || row?.school || row?.university || row?.academy || "",
    school: row?.school || row?.college || row?.university || row?.academy || "",
    sourceType: row?.sourceType || row?.collegeBucket || row?.draftSource || "",
    nationality: row?.nationality || "",
    headshot: row?.headshot || row?.image || row?.img || row?.portrait || "",
    image: row?.image || row?.headshot || row?.img || row?.portrait || "",
    img: row?.img || row?.headshot || row?.image || row?.portrait || "",
    attrs: Array.isArray(row?.attrs) ? row.attrs.slice(0, 15) : Array.isArray(row?.attributes) ? row.attributes.slice(0, 15) : [],
    traits: row?.traits && typeof row.traits === "object"
      ? {
          nbaReady: Number(row.traits.nbaReady || 0),
          boomBust: Number(row.traits.boomBust || 0),
          workEthic: Number(row.traits.workEthic || 0),
          injuryRisk: Number(row.traits.injuryRisk || 0),
          starUpside: Number(row.traits.starUpside || 0),
        }
      : undefined,
    scouting: row?.scouting && typeof row.scouting === "object"
      ? {
          projectedRangeLow: row.scouting.projectedRangeLow,
          projectedRangeHigh: row.scouting.projectedRangeHigh,
          scoutedOverallRange: row.scouting.scoutedOverallRange,
          scoutedPotentialRange: row.scouting.scoutedPotentialRange,
        }
      : undefined,
  };
}

function buildStorableUpcomingDraftPreview(payload = {}, rows = []) {
  const seasonYear = Number(payload?.seasonYear || payload?.draftClassYear || 2026);
  return {
    schemaVersion: UPCOMING_DRAFT_CLASS_SCHEMA_VERSION,
    seasonYear,
    draftClassYear: seasonYear,
    sourceMode: payload?.sourceMode || "auto",
    sourceFingerprint: payload?.sourceFingerprint || "",
    classType: payload?.classType || payload?.classMeta?.classType || "auto",
    seed: payload?.seed || payload?.classMeta?.seed || null,
    seedMode: payload?.seedMode || payload?.classMeta?.seedMode || "fresh_random",
    classMeta: {
      seasonYear,
      previewGenerated: true,
      sourceMode: payload?.sourceMode || "auto",
      classType: payload?.classType || payload?.classMeta?.classType || "auto",
      seed: payload?.seed || payload?.classMeta?.seed || null,
      seedMode: payload?.seedMode || payload?.classMeta?.seedMode || "fresh_random",
    },
    draftClass: rows.map((row, index) => slimUpcomingDraftProspect(row, index, seasonYear)),
    savedAt: Date.now(),
    slimStorage: true,
  };
}

export function getUpcomingDraftClassStorageKey(seasonYear) {
  return `${UPCOMING_DRAFT_CLASS_PREFIX}${Number(seasonYear || 2026)}`;
}

export function readUpcomingDraftClassForYear(seasonYear) {
  const resolvedYear = Number(seasonYear || 2026);
  const storageKey = getUpcomingDraftClassStorageKey(resolvedYear);
  let saved = upcomingDraftClassCache.get(storageKey) || null;

  // Legacy compatibility before bootstrap or after a failed migration.
  if (!saved && typeof localStorage !== "undefined") {
    saved = safeJSON(localStorage.getItem(storageKey), null);
    if (saved) upcomingDraftClassCache.set(storageKey, saved);
  }

  if (!saved || Number(saved.seasonYear) !== resolvedYear) return null;

  // Auto-generated previews saved before schema v2 lost secondary positions while
  // being slimmed for localStorage. Force those old auto previews to regenerate;
  // custom classes are separately fingerprinted and normalized on read.
  if (
    String(saved?.sourceMode || "auto") === "auto" &&
    Number(saved?.schemaVersion || 0) < UPCOMING_DRAFT_CLASS_SCHEMA_VERSION
  ) {
    upcomingDraftClassCache.delete(storageKey);
    try {
      localStorage.removeItem(storageKey);
    } catch {}
    queueUpcomingDraftPersistence(() => deleteAppDataFromDB(storageKey));
    return null;
  }

  const rows = normalizeDraftClassRows(saved, resolvedYear);
  if (!rows.length) return null;

  return {
    ...saved,
    seasonYear: resolvedYear,
    draftClass: rows,
  };
}

export function saveUpcomingDraftClassForYear(payload) {
  const resolvedYear = Number(payload?.seasonYear || 2026);
  const rows = normalizeDraftClassRows(payload, resolvedYear);
  if (!rows.length) return null;

  const next = buildStorableUpcomingDraftPreview(
    {
      ...payload,
      seasonYear: resolvedYear,
      draftClassYear: resolvedYear,
    },
    rows
  );

  const storageKey = getUpcomingDraftClassStorageKey(resolvedYear);
  upcomingDraftClassCache.set(storageKey, next);
  queueUpcomingDraftPersistence(async () => {
    await saveAppDataToDB(storageKey, next);
    upcomingDraftLastPersistError = null;
    try {
      localStorage.removeItem(storageKey);
    } catch {}
    return true;
  });

  return next;
}

export function isUpcomingDraftPreviewCompatible(preview, sourceSetup) {
  if (!preview || !sourceSetup) return false;
  if (String(preview.sourceMode || "auto") !== String(sourceSetup.mode || "auto")) return false;

  if (sourceSetup.mode === "custom") {
    return Boolean(
      preview.sourceFingerprint &&
        sourceSetup.fingerprint &&
        preview.sourceFingerprint === sourceSetup.fingerprint
    );
  }

  return true;
}

export function buildPreviewDraftOrder(leagueData) {
  const teams = getAllTeamsFromLeague(leagueData).filter(Boolean);
  const teamNames = teams.map((team) => team?.name).filter(Boolean);
  const fallbackNames = teamNames.length ? teamNames : ["Preview Team"];

  return Array.from({ length: 60 }, (_, index) => {
    const pick = index + 1;
    const teamName = fallbackNames[index % fallbackNames.length];
    return {
      pick,
      round: pick <= 30 ? 1 : 2,
      pickInRound: pick <= 30 ? pick : pick - 30,
      teamName,
      currentOwnerTeamName: teamName,
      originalTeamName: teamName,
    };
  });
}

function slimDraftBaselinePlayer(player = {}) {
  if (!player || typeof player !== "object") return null;
  return {
    id: player.id || player.playerId || player.uuid || "",
    name: player.name || player.playerName || "",
    pos: player.pos || player.position || "SF",
    position: player.position || player.pos || "SF",
    attrs: Array.isArray(player.attrs)
      ? player.attrs.slice(0, 15)
      : Array.isArray(player.attributes)
      ? player.attributes.slice(0, 15)
      : [],
    overall: Number(player.overall ?? player.ovr ?? player.rating ?? 0) || 0,
    potential: Number(player.potential ?? player.pot ?? player.potential_rating ?? 0) || 0,
    age: Number(player.age ?? player.playerAge ?? 0) || 0,
  };
}

function slimDraftBaselineTeam(team = {}) {
  return {
    name: team?.name || team?.teamName || "",
    teamName: team?.teamName || team?.name || "",
    conference: team?.conference || "",
    division: team?.division || "",
    players: (Array.isArray(team?.players) ? team.players : [])
      .map(slimDraftBaselinePlayer)
      .filter(Boolean),
  };
}

// Upcoming Draft only needs a player-ratings baseline and any active draft blob.
// Passing full league saves with years of stats/history makes the browser spend
// noticeable time deep-cloning/sanitizing data before the worker even starts.
export function buildUpcomingDraftPreviewLeagueData(leagueData = {}) {
  const base = {
    leagueName: leagueData?.leagueName || "Basketball Manager",
    seasonYear: leagueData?.seasonYear,
    currentSeasonYear: leagueData?.currentSeasonYear,
    seasonStartYear: leagueData?.seasonStartYear,
    currentDraftYear: leagueData?.currentDraftYear,
    draftYear: leagueData?.draftYear,
    draftState: leagueData?.draftState && typeof leagueData.draftState === "object"
      ? {
          seasonYear: leagueData.draftState.seasonYear,
          classType: leagueData.draftState.classType,
          seedMode: leagueData.draftState.seedMode,
          classMeta: leagueData.draftState.classMeta,
          draftClass: Array.isArray(leagueData.draftState.draftClass)
            ? leagueData.draftState.draftClass
            : [],
          draft: leagueData.draftState.draft && typeof leagueData.draftState.draft === "object"
            ? {
                seasonYear: leagueData.draftState.draft.seasonYear,
                classMeta: leagueData.draftState.draft.classMeta,
                draftClass: Array.isArray(leagueData.draftState.draft.draftClass)
                  ? leagueData.draftState.draft.draftClass
                  : [],
                availableProspects: Array.isArray(leagueData.draftState.draft.availableProspects)
                  ? leagueData.draftState.draft.availableProspects
                  : [],
                draftOrder: Array.isArray(leagueData.draftState.draft.draftOrder)
                  ? leagueData.draftState.draft.draftOrder
                  : [],
                completed: Boolean(leagueData.draftState.draft.completed),
                currentPickIndex: Number(leagueData.draftState.draft.currentPickIndex || 0),
              }
            : undefined,
        }
      : {},
  };

  if (leagueData?.conferences && typeof leagueData.conferences === "object") {
    base.conferences = Object.fromEntries(
      Object.entries(leagueData.conferences).map(([conference, teams]) => [
        conference,
        (Array.isArray(teams) ? teams : []).map(slimDraftBaselineTeam),
      ])
    );
  } else if (Array.isArray(leagueData?.teams)) {
    base.teams = leagueData.teams.map(slimDraftBaselineTeam);
  }

  return base;
}

export function getDraftStartedStorageKey(seasonYear) {
  return `${DRAFT_STARTED_PREFIX}${Number(seasonYear || 2026)}`;
}

export function markDraftStartedForYear(seasonYear) {
  const resolvedYear = Number(seasonYear || 2026);
  localStorage.setItem(
    getDraftStartedStorageKey(resolvedYear),
    JSON.stringify({ seasonYear: resolvedYear, startedAt: Date.now() })
  );
}

export function isDraftStartedForYear(seasonYear, leagueData = null) {
  const resolvedYear = Number(seasonYear || 2026);
  const marker = safeJSON(localStorage.getItem(getDraftStartedStorageKey(resolvedYear)), null);
  if (Number(marker?.seasonYear) === resolvedYear) return true;

  const savedState = safeJSON(localStorage.getItem(DRAFT_STATE_KEY), null);
  if (Number(savedState?.seasonYear) === resolvedYear) {
    const draftedCount = Array.isArray(savedState?.draftedPicks) ? savedState.draftedPicks.length : 0;
    if (savedState?.completed || draftedCount > 0 || Number(savedState?.currentPickIndex || 0) > 0) {
      return true;
    }
  }

  const leagueDraftState = leagueData?.draftState?.draft;
  if (Number(leagueDraftState?.seasonYear) === resolvedYear) {
    const draftedCount = Array.isArray(leagueDraftState?.draftedPicks)
      ? leagueDraftState.draftedPicks.length
      : 0;
    if (leagueDraftState?.completed || draftedCount > 0 || Number(leagueDraftState?.currentPickIndex || 0) > 0) {
      return true;
    }
  }

  return false;
}
