import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

class MemoryStorage {
  constructor(entries = {}) { this.map = new Map(Object.entries(entries)); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
  setItem(key, value) { this.map.set(String(key), String(value)); }
  removeItem(key) { this.map.delete(String(key)); }
  clear() { this.map.clear(); }
}

const {
  captureLeagueLocalStorage,
  captureLeagueSessionStorage,
  clearLeagueLocalStorage,
  clearLeagueSessionStorage,
  restoreLeagueLocalStorage,
  restoreLeagueSessionStorage,
  isLeagueScopedPersistenceKey,
  isGlobalPersistenceKey,
} = await import("../src/storage/saveStorageRegistry.js");

const storage = new MemoryStorage({
  bm_sfx_master_volume_v1: "0.7",
  bm_active_league_save_id_v1: "save_a",
  bm_calendar_cursor_v1_2026: "2027-03-01",
  bm_results_index_v3: "[\"g1\"]",
  bm_result_v3_g1: "A_RESULT",
  gameplan_Brooklyn_Nets: "A_GAMEPLAN",
  selectedTeam: '"Brooklyn Nets"',
});

assert.equal(isLeagueScopedPersistenceKey("bm_calendar_cursor_v1_2026"), true);
assert.equal(isLeagueScopedPersistenceKey("bm_result_v3_anything"), true);
assert.equal(isLeagueScopedPersistenceKey("gameplan_Brooklyn Nets"), true);
assert.equal(isGlobalPersistenceKey("bm_sfx_master_volume_v1"), true);
assert.equal(isGlobalPersistenceKey("bm_active_league_save_id_v1"), true);

const a = captureLeagueLocalStorage(storage);
assert.equal(a.bm_calendar_cursor_v1_2026, "2027-03-01");
assert.equal(a.bm_result_v3_g1, "A_RESULT");
assert.equal(a.gameplan_Brooklyn_Nets, "A_GAMEPLAN");
assert.equal(a.bm_sfx_master_volume_v1, undefined);
assert.equal(a.bm_active_league_save_id_v1, undefined);

storage.setItem("bm_calendar_cursor_v1_2026", "2027-01-01");
storage.setItem("bm_result_v3_g1", "B_RESULT");
storage.setItem("gameplan_Brooklyn_Nets", "B_GAMEPLAN");
const b = captureLeagueLocalStorage(storage);

restoreLeagueLocalStorage(a, storage);
assert.equal(storage.getItem("bm_calendar_cursor_v1_2026"), "2027-03-01");
assert.equal(storage.getItem("bm_result_v3_g1"), "A_RESULT");
assert.equal(storage.getItem("gameplan_Brooklyn_Nets"), "A_GAMEPLAN");
assert.equal(storage.getItem("bm_sfx_master_volume_v1"), "0.7");
assert.equal(storage.getItem("bm_active_league_save_id_v1"), "save_a");

restoreLeagueLocalStorage(b, storage);
assert.equal(storage.getItem("bm_calendar_cursor_v1_2026"), "2027-01-01");
assert.equal(storage.getItem("bm_result_v3_g1"), "B_RESULT");
assert.equal(storage.getItem("gameplan_Brooklyn_Nets"), "B_GAMEPLAN");
assert.equal(storage.getItem("bm_sfx_master_volume_v1"), "0.7");

clearLeagueLocalStorage(storage);
assert.equal(storage.getItem("bm_calendar_cursor_v1_2026"), null);
assert.equal(storage.getItem("bm_result_v3_g1"), null);
assert.equal(storage.getItem("bm_sfx_master_volume_v1"), "0.7");

const session = new MemoryStorage({
  bm_contract_extension_deadline_context_v1: "A_EXTENSION_CONTEXT",
  bm_dismissed_offer_status_ids_v1: "[1,2]",
  bm_dev_boot_id_v1: "GLOBAL_DEV_BOOT",
});
const sessionA = captureLeagueSessionStorage(session);
assert.equal(sessionA.bm_contract_extension_deadline_context_v1, "A_EXTENSION_CONTEXT");
assert.equal(sessionA.bm_dismissed_offer_status_ids_v1, "[1,2]");
assert.equal(sessionA.bm_dev_boot_id_v1, undefined);
session.setItem("bm_contract_extension_deadline_context_v1", "B_EXTENSION_CONTEXT");
restoreLeagueSessionStorage(sessionA, session);
assert.equal(session.getItem("bm_contract_extension_deadline_context_v1"), "A_EXTENSION_CONTEXT");
clearLeagueSessionStorage(session);
assert.equal(session.getItem("bm_contract_extension_deadline_context_v1"), null);
assert.equal(session.getItem("bm_dev_boot_id_v1"), "GLOBAL_DEV_BOOT");
console.log("PASS save_v2.local_and_session_storage_universe_isolation");


const fiveUniverseStorage = new MemoryStorage({
  bm_sfx_master_volume_v1: "0.55",
  bm_active_league_save_id_v1: "save_a",
});
const universeSnapshots = {};
for (const [id, date, team] of [
  ["A", "2027-03-01", "Toronto Raptors"],
  ["B", "2027-01-01", "Charlotte Hornets"],
  ["C", "2028-05-20", "San Antonio Spurs"],
  ["D", "2029-06-24", "Brooklyn Nets"],
  ["E", "2030-07-08", "Miami Heat"],
]) {
  clearLeagueLocalStorage(fiveUniverseStorage);
  fiveUniverseStorage.setItem(`bm_calendar_cursor_v1_${id}`, date);
  fiveUniverseStorage.setItem(`bm_result_v3_${id}_game`, `${id}_RESULT`);
  fiveUniverseStorage.setItem(`gameplan_${team}`, `${id}_GAMEPLAN`);
  fiveUniverseStorage.setItem("selectedTeam", JSON.stringify(team));
  universeSnapshots[id] = captureLeagueLocalStorage(fiveUniverseStorage);
}
for (const [id, date, team] of [
  ["D", "2029-06-24", "Brooklyn Nets"],
  ["B", "2027-01-01", "Charlotte Hornets"],
  ["E", "2030-07-08", "Miami Heat"],
  ["C", "2028-05-20", "San Antonio Spurs"],
  ["A", "2027-03-01", "Toronto Raptors"],
]) {
  restoreLeagueLocalStorage(universeSnapshots[id], fiveUniverseStorage);
  assert.equal(fiveUniverseStorage.getItem(`bm_calendar_cursor_v1_${id}`), date);
  assert.equal(fiveUniverseStorage.getItem(`bm_result_v3_${id}_game`), `${id}_RESULT`);
  assert.equal(fiveUniverseStorage.getItem(`gameplan_${team}`), `${id}_GAMEPLAN`);
  assert.equal(JSON.parse(fiveUniverseStorage.getItem("selectedTeam")), team);
  for (const other of ["A", "B", "C", "D", "E"].filter((value) => value !== id)) {
    assert.equal(fiveUniverseStorage.getItem(`bm_result_v3_${other}_game`), null);
  }
  assert.equal(fiveUniverseStorage.getItem("bm_sfx_master_volume_v1"), "0.55");
  assert.equal(fiveUniverseStorage.getItem("bm_active_league_save_id_v1"), "save_a");
}
console.log("PASS save_v2.five_universe_round_trip_isolation");

const saves = read("src/storage/leagueSaves.js");
assert.match(saves, /CURRENT_LEAGUE_SAVE_SCHEMA_VERSION\s*=\s*2/);
assert.match(saves, /snapshot:\s*\{[\s\S]*runtime:/);
assert.match(saves, /checkpointActiveLeagueSave/);
assert.match(saves, /flushLeagueSaveSlotWrites/);
assert.match(saves, /restoreLeagueRuntime/);
assert.match(saves, /getResumeRouteForLeagueSave/);
assert.match(saves, /runtime:\s*clone\(hasRuntimeArgument \? runtime : previousSnapshot\.runtime/);
console.log("PASS save_v2.slot_schema_and_serialized_checkpoints");

const manager = read("src/storage/saveManager.js");
for (const required of [
  "flushCpuTradeLeagueSaves",
  "flushLeagueDataWrites",
  "flushScheduleStorageWrites",
  "flushSeasonStatsArchiveStorageWrites",
  "flushOffseasonMoodBaselineStorageWrites",
  "flushTradeDeskStorageWrites",
  "flushCustomDraftClassStorageWrites",
  "flushUpcomingDraftClassStorageWrites",
  "exportBasketballManagerRuntimeSnapshot",
  "replaceBasketballManagerRuntimeSnapshot",
  "clearLeagueLocalStorage",
  "clearLeagueSessionStorage",
  "restoreLeagueLocalStorage",
  "restoreLeagueSessionStorage",
]) {
  assert.match(manager, new RegExp(required));
}
assert.match(manager, /saveLeagueData\(leagueData/);
console.log("PASS save_v2.runtime_flush_capture_restore");

const leagueStorage = read("src/utils/leagueStorage.js");
assert.match(leagueStorage, /export async function flushLeagueDataWrites/);
assert.match(leagueStorage, /reconcileNewerCpuTradeBankOverlayBeforeFullSave/);
assert.match(leagueStorage, /cpuTradeOverlayRequest/);
assert.match(leagueStorage, /beginTrackedLeagueDataWrite\(\)/);
console.log("PASS save_v2.pending_league_and_cpu_sidecars_are_flushed");

const idb = read("src/utils/indexedDbStorage.js");
assert.match(idb, /exportBasketballManagerRuntimeSnapshot/);
assert.match(idb, /replaceBasketballManagerRuntimeSnapshot/);
assert.match(idb, /readAllRowsFromStore\(db, BOX_SCORE_STORE\)/);
assert.match(idb, /readAllRowsFromStore\(db, APP_DATA_STORE\)/);
assert.match(idb, /store\.clear\(\)/);
console.log("PASS save_v2.indexeddb_boxscores_and_appdata_isolation");

const play = read("src/pages/Play.jsx");
assert.match(play, /checkpointActiveLeagueSave/);
assert.match(play, /clearActiveLeagueRuntime\(\{ resetCaches: true \}\)/);
assert.match(play, /window\.location\.assign\(resumeRoute/);
assert.match(play, /Play\.beforeSaveSwitch/);
assert.match(play, /Play\.exportSave/);
console.log("PASS save_v2.play_switch_new_export_flows");

const editor = read("src/pages/LeagueEditor.jsx");
assert.match(editor, /clearActiveLeagueRuntime\(\{ resetCaches: true \}\)/);
assert.match(editor, /clearActiveLeagueSaveId\(\)/);
assert.match(editor, /r\.onload = async \(x\) =>/);
console.log("PASS save_v2.league_editor_uses_authoritative_runtime_reset");

const sidebar = read("src/components/TeamHubSidebar.jsx");
assert.match(sidebar, /checkpointActiveLeagueSave/);
assert.match(sidebar, /setExitError/);
assert.match(sidebar, /clearActiveLeagueSaveId\(\)/);
assert.doesNotMatch(sidebar, /finally\s*\{[\s\S]{0,260}navigate\("\/league-editor"\)/);
console.log("PASS save_v2.save_exit_is_failure_safe");

const playoff = read("src/pages/PlayoffPicture.jsx");
assert.match(playoff, /grid-cols-\[220px_minmax\(0,1fr\)_220px\]/);
assert.match(playoff, /grid h-full min-h-\[520px\]/);
assert.match(playoff, /flex h-full min-h-\[520px\] flex-col/);
console.log("PASS ui.playoff_picture_center_and_height_use");

const rosterCss = read("src/pages/RosterView.module.css");
assert.match(rosterCss, /\.twoWayActionButton\{border:1px solid/);
assert.match(rosterCss, /\.upgradeActionButton\{border:1px solid/);
console.log("PASS ui.roster_contract_action_buttons");

console.log("Multi-save V2 + UI regression passed: 11/11 groups.");
