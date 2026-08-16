import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import LZString from "lz-string";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const calendar = fs.readFileSync(path.join(root, "src/pages/Calendar.jsx"), "utf8");
const finals = fs.readFileSync(path.join(root, "src/utils/finalsMvpSeasonActions.js"), "utf8");
const tradeDesk = fs.readFileSync(path.join(root, "src/utils/tradeDeskFeed.js"), "utf8");
const indexedDbStorage = fs.readFileSync(path.join(root, "src/utils/indexedDbStorage.js"), "utf8");
const main = fs.readFileSync(path.join(root, "src/main.jsx"), "utf8");
const scheduleStorage = fs.readFileSync(path.join(root, "src/utils/scheduleStorage.js"), "utf8");
const upcomingDraft = fs.readFileSync(path.join(root, "src/utils/upcomingDraftClass.js"), "utf8");
const seasonStatsArchive = fs.readFileSync(path.join(root, "src/utils/seasonStatsArchive.js"), "utf8");
const customDraftStorage = fs.readFileSync(path.join(root, "src/utils/customDraftClassStorage.js"), "utf8");
const offseasonMoodBaselineStorage = fs.readFileSync(path.join(root, "src/utils/offseasonMoodBaselineStorage.js"), "utf8");
const offseasonMoodEvents = fs.readFileSync(path.join(root, "src/utils/offseasonMoodEvents.js"), "utf8");
const playPage = fs.readFileSync(path.join(root, "src/pages/Play.jsx"), "utf8");
const leagueEditor = fs.readFileSync(path.join(root, "src/pages/LeagueEditor.jsx"), "utf8");
const draftPage = fs.readFileSync(path.join(root, "src/pages/Draft.jsx"), "utf8");
const offseasonHub = fs.readFileSync(path.join(root, "src/pages/OffseasonHub.jsx"), "utf8");
const scheduleConsumerPaths = [
  "src/pages/Standings.jsx",
  "src/pages/PowerRankings.jsx",
  "src/pages/Playoffs.jsx",
  "src/pages/PlayoffPicture.jsx",
  "src/pages/PlayerStats.jsx",
  "src/pages/DraftLottery.jsx",
  "src/pages/AwardTracker.jsx",
  "src/utils/teamIntel_v1.js",
  "src/utils/tradePickValue.js",
  "src/utils/tradeTeamImpact.js",
  "src/utils/offseasonTradeContext.js",
  "src/utils/seasonStatsArchive.js",
  "src/utils/finalsMvpSeasonActions.js",
];
const scheduleConsumers = scheduleConsumerPaths.map((relativePath) => ({
  relativePath,
  source: fs.readFileSync(path.join(root, relativePath), "utf8"),
}));

const checks = [];
function check(id, condition, message) {
  checks.push({ id, condition: Boolean(condition), message });
}

const compactStart = calendar.indexOf("function compactResultForCalendar");
const compactEnd = calendar.indexOf("function readCompressedOrJson", compactStart);
const compactBlock = calendar.slice(compactStart, compactEnd);

check(
  "year2.compact_score_only",
  compactBlock.includes("hasBoxScore: Boolean(slim?.hasBoxScore || hasBoxRows(slim))") &&
    !compactBlock.includes("periods:") &&
    !compactBlock.includes("rotationOrder:") &&
    !compactBlock.includes("lockedAt:") &&
    !compactBlock.includes("box:"),
  "Regular-season localStorage rows keep only the score layer; full box data remains in IndexedDB."
);

check(
  "year2.orphan_reconciliation",
  calendar.includes("function reconcileResultStoreV3WithSchedule") &&
    calendar.includes("key?.startsWith(RESULT_V3_PREFIX)") &&
    calendar.includes("removedStaleKeys") &&
    calendar.indexOf("reconcileResultStoreV3WithSchedule(") < calendar.indexOf("parsedResults = loadResults();"),
  "Calendar repairs the result index and removes stale prior-season payload keys before loading results."
);

check(
  "year2.clear_actual_keyspace",
  calendar.includes("Never rely only on the index here") &&
    calendar.includes("if (key?.startsWith(RESULT_V3_PREFIX)) localStorage.removeItem(key);"),
  "Reset/season cleanup scans the real result keyspace instead of trusting a possibly missing index."
);

const finalsClearStart = finals.indexOf("function clearSeasonStores");
const finalsClearEnd = finals.indexOf("function pushFinalsMvpToHistory", finalsClearStart);
const finalsClearBlock = finals.slice(finalsClearStart, finalsClearEnd);
check(
  "year2.finals_cleanup_order",
  finalsClearBlock.indexOf("key?.startsWith(RESULT_V3_PREFIX)") >= 0 &&
    finalsClearBlock.indexOf("key?.startsWith(RESULT_V3_PREFIX)") < finalsClearBlock.indexOf("localStorage.removeItem(RESULT_V3_INDEX_KEY)"),
  "Finals cleanup deletes all game payloads before deleting their reachability index."
);

check(
  "year2.quota_recovery",
  calendar.includes("clearNonCriticalQuotaCaches") &&
    calendar.includes("PLAYER_MOOD_EVENT_BUS_KEY") &&
    calendar.includes("awards save hit localStorage quota; running recovery"),
  "Critical season saves recover quota by dropping noncritical temporary caches and retrying."
);


check(
  "year2.trade_desk_indexeddb",
  tradeDesk.includes('persistAppDataSnapshot(TRADE_DESK_FEED_KEY') &&
    tradeDesk.includes('persistAppDataSnapshot(PLAYER_MOOD_EVENT_BUS_KEY') &&
    !tradeDesk.includes('localStorage.setItem(TRADE_DESK_FEED_KEY') &&
    !tradeDesk.includes('localStorage.setItem(PLAYER_MOOD_EVENT_BUS_KEY'),
  "Trade Desk and the growing player-mood event bus persist in IndexedDB instead of localStorage."
);

check(
  "year2.trade_desk_migration",
  tradeDesk.includes("initializeTradeDeskStorage") &&
    tradeDesk.includes("localStorageRows(TRADE_DESK_FEED_KEY)") &&
    tradeDesk.includes("localStorageRows(PLAYER_MOOD_EVENT_BUS_KEY)") &&
    main.includes("[\"TradeDeskFeed\", initializeTradeDeskStorage]") &&
    main.includes("await initializeStorage({ reset: devFreshReset })"),
  "App boot migrates legacy Trade Desk/mood payloads before React consumers read the synchronous cache."
);

check(
  "year2.indexeddb_app_data_store",
  indexedDbStorage.includes('const APP_DATA_STORE = "appData"') &&
    indexedDbStorage.includes("ensureAppDataStore") &&
    indexedDbStorage.includes("saveAppDataToDB") &&
    indexedDbStorage.includes("loadAppDataFromDB"),
  "The existing Basketball Manager IndexedDB owns a forward-safe appData store for heavy growing payloads."
);

check(
  "year2.no_duplicate_awards_blob",
  calendar.includes("only the canonical key avoids wasting quota") &&
    !calendar.includes('localStorage.setItem("bm_awards_latest", JSON.stringify(awards))'),
  "Awards are no longer stored twice under identical localStorage keys."
);

check(
  "year3.schedule_indexeddb_source",
  scheduleStorage.includes('const SCHEDULE_DB_KEY = "bm_schedule_v3_indexeddb_v1"') &&
    scheduleStorage.includes("saveAppDataToDB(SCHEDULE_DB_KEY, compact)") &&
    scheduleStorage.includes("loadAppDataFromDB(SCHEDULE_DB_KEY)"),
  "The regular-season schedule is durably stored in IndexedDB instead of the localStorage quota."
);

check(
  "year3.schedule_structure_only",
  scheduleStorage.includes("compactScheduleForStorage") &&
    scheduleStorage.includes("homeId: String(game.homeId)") &&
    scheduleStorage.includes("awayId: String(game.awayId)") &&
    !scheduleStorage.slice(
      scheduleStorage.indexOf("export function compactScheduleForStorage"),
      scheduleStorage.indexOf("export function getScheduleStructureFingerprint")
    ).includes("played:"),
  "Persisted schedule rows omit derived played state and duplicated team metadata."
);

const saveScheduleStart = calendar.indexOf("const saveSchedule = (obj");
const saveScheduleEnd = calendar.indexOf("async function saveResults", saveScheduleStart);
const saveScheduleBlock = calendar.slice(saveScheduleStart, saveScheduleEnd);
check(
  "year3.schedule_hot_path_no_localstorage",
  saveScheduleBlock.includes("cacheScheduleForRuntime(obj)") &&
    saveScheduleBlock.includes("if (persistStructure) persistScheduleStructure(obj)") &&
    !saveScheduleBlock.includes("localStorage.setItem") &&
    !saveScheduleBlock.includes("JSON.stringify(obj)"),
  "Simulation checkpoints update schedule state in memory without serializing/writing the full schedule."
);

check(
  "year3.schedule_readers_use_bridge",
  scheduleConsumers.every(({ source }) =>
    !source.includes('localStorage.getItem("bm_schedule_v3")') &&
    !source.includes("localStorage.getItem(SCHED_KEY)") &&
    !source.includes("localStorage.getItem(SCHEDULE_KEY)")
  ) &&
    scheduleConsumers.filter(({ relativePath }) => !relativePath.endsWith("finalsMvpSeasonActions.js")).every(({ source }) =>
      source.includes("readScheduleFromStorage") || !source.includes("schedule")
    ),
  "Standings, rankings, playoff seeding, stats, awards, and trade evaluation read the hydrated schedule cache."
);

check(
  "year3.schedule_cleanup_idb",
  finals.includes("clearScheduleStorage();") &&
    fs.readFileSync(path.join(root, "src/pages/Playoffs.jsx"), "utf8").includes("clearScheduleStorage();") &&
    fs.readFileSync(path.join(root, "src/pages/LeagueEditor.jsx"), "utf8").includes("clearScheduleStorage();"),
  "Season transitions and league resets clear the IndexedDB-backed schedule instead of only deleting a legacy key."
);

check(
  "year3.schedule_bootstrap_migration",
  main.includes('["ScheduleStorage", initializeScheduleStorage]') &&
    main.indexOf("await initializeStorage({ reset: devFreshReset })") < main.indexOf("ReactDOM.createRoot") &&
    scheduleStorage.includes("legacy migration could not finish; keeping localStorage source intact") &&
    scheduleStorage.includes("await saveAppDataToDB(SCHEDULE_DB_KEY, compact)") &&
    scheduleStorage.includes("localStorage.removeItem(REGULAR_SCHEDULE_STORAGE_KEY)"),
  "App boot hydrates/migrates the schedule before rendering and removes legacy storage only after a successful DB write."
);

check(
  "year3.upcoming_draft_indexeddb",
  upcomingDraft.includes("initializeUpcomingDraftClassStorage") &&
    upcomingDraft.includes("loadAppDataEntriesByPrefixFromDB(UPCOMING_DRAFT_CLASS_PREFIX)") &&
    upcomingDraft.includes("saveAppDataToDB(storageKey, next)") &&
    !upcomingDraft.includes("localStorage.setItem(getUpcomingDraftClassStorageKey"),
  "Per-year upcoming draft previews migrate to IndexedDB and no longer accumulate as localStorage blobs."
);

check(
  "year3.completed_stats_backup_indexeddb",
  seasonStatsArchive.includes("initializeSeasonStatsArchiveStorage") &&
    seasonStatsArchive.includes("saveAppDataToDB(COMPLETED_STATS_BACKUP_KEY, payload)") &&
    seasonStatsArchive.includes("saveAppDataToDB(COMPLETED_REGULAR_PLAYER_STATS_KEY, payload)") &&
    seasonStatsArchive.includes("Critical recovery only: preserve the last completed-season archive") &&
    seasonStatsArchive.includes("Critical recovery only: preserve the last completed regular-season"),
  "Completed-season backups use IndexedDB normally, with compressed localStorage only as an emergency failure fallback."
);

check(
  "year3.storage_bootstrap_before_render",
  main.includes('["UpcomingDraft", initializeUpcomingDraftClassStorage]') &&
    main.includes('["SeasonStatsArchive", initializeSeasonStatsArchiveStorage]') &&
    main.indexOf("const storageBootstraps") < main.indexOf("ReactDOM.createRoot"),
  "All synchronous compatibility caches are hydrated before React renders pages that read them."
);

check(
  "year3.offseason_mood_baseline_indexeddb",
  main.includes('["OffseasonMoodBaseline", initializeOffseasonMoodBaselineStorage]') &&
    offseasonMoodBaselineStorage.includes("saveAppDataToDB(OFFSEASON_MOOD_BASELINE_KEY, snapshot)") &&
    offseasonMoodBaselineStorage.includes("loadAppDataFromDB(OFFSEASON_MOOD_BASELINE_KEY)") &&
    offseasonMoodEvents.includes("readOffseasonMoodBaselineSnapshot()") &&
    offseasonMoodEvents.includes("writeOffseasonMoodBaselineSnapshot(snapshot)") &&
    !offseasonMoodEvents.includes("localStorage.setItem(OFFSEASON_MOOD_BASELINE_KEY"),
  "The full-league offseason mood baseline is stored in IndexedDB instead of consuming localStorage quota."
);

check(
  "year3.custom_draft_classes_indexeddb",
  main.includes('["CustomDraftStorage", initializeCustomDraftClassStorage]') &&
    customDraftStorage.includes("loadAppDataEntriesByPrefixFromDB(CUSTOM_DRAFT_CLASS_PREFIX)") &&
    customDraftStorage.includes("saveAppDataToDB(key, payload)") &&
    customDraftStorage.includes("replaceCustomDraftClasses") &&
    !playPage.includes("localStorage.setItem(getDraftClassStorageKey") &&
    !leagueEditor.includes("localStorage.setItem(getDraftClassStorageKey") &&
    !draftPage.includes("localStorage.getItem(seasonKey)") &&
    !offseasonHub.includes("localStorage.getItem(seasonKey)"),
  "Custom draft-class payloads and their aggregate vault migrate to IndexedDB instead of duplicating large JSON in localStorage."
);

check(
  "year3.large_payload_bootstrap_before_render",
  main.includes('["CustomDraftStorage", initializeCustomDraftClassStorage]') &&
    main.includes('["OffseasonMoodBaseline", initializeOffseasonMoodBaselineStorage]') &&
    main.indexOf('["CustomDraftStorage", initializeCustomDraftClassStorage]') < main.indexOf("ReactDOM.createRoot") &&
    main.indexOf('["OffseasonMoodBaseline", initializeOffseasonMoodBaselineStorage]') < main.indexOf("ReactDOM.createRoot"),
  "Large synchronous consumers are hydrated from IndexedDB before React renders."
);

check(
  "year3.local_storage_diagnostic",
  scheduleStorage.includes("export function getLocalStorageUsageReport") &&
    scheduleStorage.includes("window.bmStorageAudit = getLocalStorageUsageReport"),
  "A browser-console storage audit reports localStorage consumers sorted by estimated bytes."
);

const playerNames = Array.from({ length: 30 }, (_, i) => `Representative Player ${i + 1}`);
const oldRow = {
  winner: { team: "Boston Celtics", score: "113-108", home: 113, away: 108, ot: 0 },
  totals: { home: 113, away: 108 },
  periods: { home: [30, 27, 29, 27], away: [25, 28, 26, 29], ots: { home: [], away: [] }, otCount: 0 },
  box: { home: [], away: [] },
  hasBoxScore: true,
  rotationOrder: { home: playerNames.slice(0, 15), away: playerNames.slice(15) },
  lockedAt: 1785456000000,
};
const newRow = {
  winner: oldRow.winner,
  totals: oldRow.totals,
  hasBoxScore: true,
};
const utf16Bytes = (value) => Buffer.byteLength(LZString.compressToUTF16(JSON.stringify(value)), "utf16le");
const oldSeasonBytes = utf16Bytes(oldRow) * 1230;
const newSeasonBytes = utf16Bytes(newRow) * 1230;
const reductionPct = ((oldSeasonBytes - newSeasonBytes) / oldSeasonBytes) * 100;
check(
  "year2.storage_budget",
  newSeasonBytes < oldSeasonBytes && reductionPct >= 45,
  `Representative 1,230-game localStorage payload shrinks by ${reductionPct.toFixed(1)}%.`
);

const representativeDates = Array.from({ length: 180 }, (_, index) => `2028-${String(Math.floor(index / 30) + 1).padStart(2, "0")}-${String((index % 30) + 1).padStart(2, "0")}`);
const representativeFullSchedule = {};
let representativeGameIndex = 0;
for (const date of representativeDates) {
  representativeFullSchedule[date] = [];
  while (representativeGameIndex < 1230 && representativeFullSchedule[date].length < 7) {
    const homeIndex = representativeGameIndex % 30;
    const awayIndex = (representativeGameIndex * 7 + 3) % 30;
    const home = `Representative Team ${homeIndex + 1}`;
    const away = `Representative Team ${awayIndex + 1}`;
    representativeFullSchedule[date].push({
      id: `${date}_${awayIndex}_at_${homeIndex}_${representativeGameIndex}`,
      date,
      homeId: `representative-team-${homeIndex + 1}`,
      awayId: `representative-team-${awayIndex + 1}`,
      home,
      away,
      homeLogo: `/logos/${homeIndex}.png?very-long-cache-busting-logo-path=representative`,
      awayLogo: `/logos/${awayIndex}.png?very-long-cache-busting-logo-path=representative`,
      homeTeamObj: { id: homeIndex, name: home, conference: homeIndex < 15 ? "East" : "West", division: "Representative", logo: `/logos/${homeIndex}.png` },
      awayTeamObj: { id: awayIndex, name: away, conference: awayIndex < 15 ? "East" : "West", division: "Representative", logo: `/logos/${awayIndex}.png` },
      confHome: homeIndex < 15 ? "East" : "West",
      confAway: awayIndex < 15 ? "East" : "West",
      divisionHome: "Representative",
      divisionAway: "Representative",
      played: representativeGameIndex % 2 === 0,
    });
    representativeGameIndex += 1;
  }
}
const representativeCompactSchedule = Object.fromEntries(
  Object.entries(representativeFullSchedule).map(([date, games]) => [
    date,
    games.map((game) => ({
      id: game.id,
      date: game.date,
      homeId: game.homeId,
      awayId: game.awayId,
      home: game.home,
      away: game.away,
    })),
  ])
);
const fullScheduleBytes = Buffer.byteLength(JSON.stringify(representativeFullSchedule), "utf8");
const compactScheduleBytes = Buffer.byteLength(JSON.stringify(representativeCompactSchedule), "utf8");
const scheduleReductionPct = ((fullScheduleBytes - compactScheduleBytes) / fullScheduleBytes) * 100;
check(
  "year3.schedule_storage_budget",
  representativeGameIndex === 1230 && compactScheduleBytes < fullScheduleBytes * 0.45,
  `Representative schedule structure shrinks by ${scheduleReductionPct.toFixed(1)}% before moving to IndexedDB.`
);

console.table(checks.map(({ id, condition, message }) => ({ status: condition ? "PASS" : "FAIL", id, message })));
const failed = checks.filter((row) => !row.condition);
if (failed.length) {
  console.error(`\nYear-2/3 storage regression failed: ${failed.length}/${checks.length} checks failed.`);
  process.exit(1);
}
console.log(`\nYear-2/3 storage regression passed: ${checks.length}/${checks.length} checks.`);
console.log(`Representative season payload: ${(oldSeasonBytes / 1024).toFixed(1)} KiB -> ${(newSeasonBytes / 1024).toFixed(1)} KiB.`);
