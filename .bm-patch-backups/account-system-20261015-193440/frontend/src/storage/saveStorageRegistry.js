// Central classification for browser persistence.
//
// Rule: basketball-manager runtime keys default to SAVE-SCOPED unless they are
// explicitly listed as global preferences/dev tooling below. This keeps new
// gameplay systems isolated between league saves instead of silently leaking
// into every universe.

export const ACTIVE_SAVE_KEY = "bm_active_league_save_id_v1";

const GLOBAL_EXACT_KEYS = new Set([
  ACTIVE_SAVE_KEY,
  "bm_sfx_enabled_v1",
  "bm_sfx_master_volume_v1",
  "bm_tf_worker_pool_size",
  "bm_perf_debug_v1",
  "bm_trade_debug_v1",
  "bm_trade_finder_debug_v1",
  "bm_diagnostics_auto_v1",
  "bm_multi_year_speed_diag_v1",
  "bm_cpu_trade_bank_test_config_v1",
  "bm_cpu_trade_deep_trace_v1",
  "bm_cpu_trade_diagnostic_baseline_v1",
  "bm_dev_boot_id_v1",
  "bm_dev_fresh_calendar_boot_v1",
  "bm_dev_fresh_calendar_consumed_v1",
  "bm_dev_lottery_system_v1",
  "showLetters",
  "BM_SIM_SPEED_MICROPROFILE_V1",
]);

const GLOBAL_PREFIXES = [
  "bm_face_dna_lab_",
  "bm_face_library_",
  "bm_face_player_dna_",
  "bm_portrait_dressing_fit_",
  "bm_realistic_face_library_presets_",
  "bm_progression_shape_audit_",
  "bm_trade_finder_baseline_v1:",
];

const LEAGUE_EXACT_KEYS = new Set([
  "selectedTeam",
  "leagueData",
  "leagueDataIndexedDbPointer",
  "leagueDataLastSavedAt",
  "leagueDataStorageMode",
]);

const LEAGUE_PREFIXES = [
  "bm_",
  "gameplan_",
  "coach_gameplan_",
];

export function isGlobalPersistenceKey(key = "") {
  const clean = String(key || "");
  return GLOBAL_EXACT_KEYS.has(clean) || GLOBAL_PREFIXES.some((prefix) => clean.startsWith(prefix));
}

export function isLeagueScopedPersistenceKey(key = "") {
  const clean = String(key || "");
  if (!clean || isGlobalPersistenceKey(clean)) return false;
  if (LEAGUE_EXACT_KEYS.has(clean)) return true;
  if (LEAGUE_PREFIXES.some((prefix) => clean.startsWith(prefix))) return true;
  // This origin belongs to the game. Unknown persistence defaults to save-scoped
  // so a new feature cannot silently leak between leagues just because someone
  // forgot to add its key to this registry. Truly global preferences must opt out.
  return true;
}

export function captureLeagueLocalStorage(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  const entries = {};
  if (!storage) return entries;

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!isLeagueScopedPersistenceKey(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) entries[key] = value;
  }

  return entries;
}

export function clearLeagueLocalStorage(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  if (!storage) return [];
  const removed = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (isLeagueScopedPersistenceKey(key)) removed.push(key);
  }

  for (const key of removed) storage.removeItem(key);
  return removed;
}

export function restoreLeagueLocalStorage(entries = {}, storage = typeof localStorage !== "undefined" ? localStorage : null) {
  if (!storage) return 0;
  clearLeagueLocalStorage(storage);

  let restored = 0;
  for (const [key, value] of Object.entries(entries || {})) {
    if (!isLeagueScopedPersistenceKey(key)) continue;
    if (value === undefined || value === null) continue;
    storage.setItem(key, String(value));
    restored += 1;
  }
  return restored;
}

export function captureLeagueSessionStorage(storage = typeof sessionStorage !== "undefined" ? sessionStorage : null) {
  return captureLeagueLocalStorage(storage);
}

export function clearLeagueSessionStorage(storage = typeof sessionStorage !== "undefined" ? sessionStorage : null) {
  return clearLeagueLocalStorage(storage);
}

export function restoreLeagueSessionStorage(entries = {}, storage = typeof sessionStorage !== "undefined" ? sessionStorage : null) {
  return restoreLeagueLocalStorage(entries, storage);
}

export function getSaveStorageRegistryReport() {
  return {
    policy: "unknown game persistence defaults to league scoped; globals explicitly opt out",
    globalExactKeys: [...GLOBAL_EXACT_KEYS].sort(),
    globalPrefixes: [...GLOBAL_PREFIXES],
    leagueExactKeys: [...LEAGUE_EXACT_KEYS].sort(),
    leaguePrefixes: [...LEAGUE_PREFIXES],
  };
}
