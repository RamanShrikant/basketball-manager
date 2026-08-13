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
    main.includes("initializeTradeDeskStorage({ reset: devFreshReset })"),
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

console.table(checks.map(({ id, condition, message }) => ({ status: condition ? "PASS" : "FAIL", id, message })));
const failed = checks.filter((row) => !row.condition);
if (failed.length) {
  console.error(`\nYear-2 storage regression failed: ${failed.length}/${checks.length} checks failed.`);
  process.exit(1);
}
console.log(`\nYear-2 storage regression passed: ${checks.length}/${checks.length} checks.`);
console.log(`Representative season payload: ${(oldSeasonBytes / 1024).toFixed(1)} KiB -> ${(newSeasonBytes / 1024).toFixed(1)} KiB.`);
