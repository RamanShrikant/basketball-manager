import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const rows = [];

function read(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) throw new Error(`Missing required file: ${relativePath}`);
  return fs.readFileSync(fullPath, "utf8");
}

function check(id, ok, message, details = "") {
  rows.push({ id, status: ok ? "PASS" : "FAIL", message, details });
}

function includes(relativePath, text, message) {
  const content = read(relativePath);
  check(`${relativePath}:${text}`, content.includes(text), message || `Expected ${relativePath} to contain ${text}`);
}

function excludes(relativePath, text, message) {
  const content = read(relativePath);
  check(`${relativePath}:not:${text}`, !content.includes(text), message || `Expected ${relativePath} not to contain ${text}`);
}

const rosterRulesPath = path.join(root, "src/utils/rosterRules.js");
const rosterRules = await import(`${pathToFileURL(rosterRulesPath).href}?check=${Date.now()}`);
const calendarTimingPath = path.join(root, "src/utils/calendarCpuTradeTiming.js");
const calendarTiming = await import(`${pathToFileURL(calendarTimingPath).href}?check=${Date.now()}`);
const reverseCoveragePath = path.join(root, "src/utils/reverseTradeFinderCoverage.js");
const reverseCoverage = await import(`${pathToFileURL(reverseCoveragePath).href}?check=${Date.now()}`);
const cpuTradeTelemetryPath = path.join(root, "src/utils/cpuTradeTelemetry.js");
const cpuTradeTelemetry = await import(`${pathToFileURL(cpuTradeTelemetryPath).href}?check=${Date.now()}`);
const cpuTradeSaveQueuePath = path.join(root, "src/utils/cpuTradeSaveQueue.js");
const cpuTradeSaveQueue = await import(`${pathToFileURL(cpuTradeSaveQueuePath).href}?check=${Date.now()}`);
const leagueStoragePath = path.join(root, "src/utils/leagueStorage.js");
const leagueStorage = await import(`${pathToFileURL(leagueStoragePath).href}?check=${Date.now()}`);
const cpuTradeValidationProtocolPath = path.join(root, "src/utils/cpuTradeValidationProtocol.js");
const cpuTradeValidationProtocol = await import(`${pathToFileURL(cpuTradeValidationProtocolPath).href}?check=${Date.now()}`);
const cpuTradeEnginePath = path.join(root, "src/api/cpuTradeEngine.js");
const cpuTradeEngine = await import(`${pathToFileURL(cpuTradeEnginePath).href}?check=${Date.now()}`);
const cpuRosterRepairPatchPath = path.join(root, "src/utils/cpuRosterRepairPatch.js");
const cpuRosterRepairPatch = await import(`${pathToFileURL(cpuRosterRepairPatchPath).href}?check=${Date.now()}`);
const cpuTradeContinuousMarketPath = path.join(root, "src/utils/cpuTradeContinuousMarket.js");
const cpuTradeContinuousMarket = await import(`${pathToFileURL(cpuTradeContinuousMarketPath).href}?check=${Date.now()}`);
const {
  REGULAR_SEASON_MIN_STANDARD_PLAYERS,
  REGULAR_SEASON_MAX_STANDARD_PLAYERS,
  TRADE_TEMPORARY_STANDARD_ROSTER_MAX,
  REGULAR_SEASON_MAX_TWO_WAY_PLAYERS,
  evaluateTeamSimulationRoster,
  evaluateTradeRosterProjection,
} = rosterRules;

check("rules.standard_min", REGULAR_SEASON_MIN_STANDARD_PLAYERS === 14, "Standard simulation minimum remains 14.");
check("rules.standard_max", REGULAR_SEASON_MAX_STANDARD_PLAYERS === 15, "Standard simulation maximum remains 15.");
check("rules.trade_temporary_max", TRADE_TEMPORARY_STANDARD_ROSTER_MAX === 16, "Temporary trade ceiling starts at 16.");
check("rules.two_way_max", REGULAR_SEASON_MAX_TWO_WAY_PLAYERS === 3, "Two-way maximum remains 3.");

includes("src/main.jsx", "installBasketballManagerDiagnostics();", "Diagnostics install during app boot.");
includes("src/main.jsx", "<DiagnosticsBridge />", "Live league/team context is connected to diagnostics.");
includes("src/pages/TradeFinder.jsx", "validateTradeFinderOfferDetailed", "Trade Finder uses detailed load validation.");
includes("src/pages/TradeFinder.jsx", "recordTradeFinderSearchSnapshot", "Trade Finder records search regression diagnostics.");
includes("src/pages/TradeFinder.jsx", "recordTradeFinderLoadAttempt", "Every Load Offer attempt records its exact validation result.");
excludes("src/pages/TradeFinder.jsx", "selectedProjected < REGULAR_SEASON_MIN_STANDARD_PLAYERS", "Trade Finder no longer blocks asymmetric packages solely for falling below 14.");
excludes("src/utils/tradeExecution.js", 'staleCode: "roster_minimum"', "CPU trades no longer reject solely for dropping below 14.");
includes("src/utils/tradeExecution.js", "requiresRosterRepairBeforeSimulation", "Trade validation marks temporary roster repair requirements.");
includes("src/pages/Calendar.jsx", "postTradeRepair", "Calendar repairs CPU rosters immediately after CPU trades.");
includes("src/pages/Calendar.jsx", "{ targetTeamNames: directlyTradedTeamNames }", "Post-trade roster repair scopes the fast path to the two traded teams.");
includes("src/api/simEnginePy.js", "targetedFallbackRequired", "Targeted roster repair automatically falls back to the legacy full-league repair when required.");
includes("src/api/simEnginePy.js", "returnPatchOnly: true", "Targeted roster repair requests a compact changed-team patch instead of a full league response.");
includes("src/api/simEnginePy.js", "applyCpuRosterRepairLeaguePatch", "The compact roster-repair response is merged back into the live league deterministically.");
includes("src/utils/cpuTradeDiagnostics.js", "targetedRepairRuns", "CPU-trade reports count targeted post-trade repairs.");
includes("src/utils/cpuTradeDiagnostics.js", "targetedFallbackRuns", "CPU-trade reports expose any automatic full-repair fallbacks.");
includes("src/utils/leagueStorage.js", "saveCpuTradeBankStateOverlay", "CPU bank-only persistence has a dedicated IndexedDB sidecar write path.");
includes("src/utils/leagueStorage.js", "mergeCpuTradeBankOverlayIntoLeague", "League loading restores a newer compatible CPU bank sidecar.");
includes("src/utils/leagueStorage.js", "store.delete(CPU_TRADE_BANK_OVERLAY_KEY)", "Every full league save atomically clears an older CPU bank sidecar.");
includes("src/utils/cpuTradeSaveQueue.js", 'saveMode === "bank_overlay"', "CPU trade save queue selects lightweight bank sidecars for bank-only state.");
includes("src/utils/cpuTradeDiagnostics.js", "Lightweight bank persistence", "CPU trade report verifies that bank-only requests used lightweight persistence.");
includes("src/pages/Calendar.jsx", "recordPreSimulationDiagnostics", "Calendar records pre-simulation diagnostics.");
includes("src/pages/Calendar.jsx", "recordCpuTradeRepairDiagnostics", "Calendar records post-trade CPU repair diagnostics.");
includes("src/pages/Calendar.jsx", "getCpuTradeSimulationDateDecision", "Calendar gates CPU trade work by pending simulation date and deadline status.");
includes("src/pages/Calendar.jsx", "recordSimulationPerformanceDiagnostics", "Calendar records simulation and CPU-trade timing diagnostics.");
excludes("src/pages/Calendar.jsx", "runForegroundCpuTradeBankGeneration", "Calendar no longer blocks simulation on foreground trade-bank replenishment.");
includes("src/pages/Calendar.jsx", "syncTradeDeskFeedHistoryWithTelemetry(nextLeagueData", "Calendar canonicalizes and measures Trade Desk history synchronization.");
includes("src/pages/Calendar.jsx", "simLockRef.current", "Calendar uses a synchronous simulation run lock to block duplicate SimToDate/full-season runs.");
includes("src/utils/bmDiagnostics.js", "cpuTradeReport(options = {})", "Diagnostics expose the full CPU-trade demon report command.");
includes("src/utils/bmDiagnostics.js", "cpuTradeSaveBaseline", "Diagnostics can save a pre-optimization CPU-trade baseline.");
includes("src/utils/bmDiagnostics.js", "cpuTradeCompare", "Diagnostics can compare the current run against the saved baseline.");
includes("src/utils/bmDiagnostics.js", "simSpeedMicroprofile(options = {})", "Diagnostics expose one no-season sim-speed microprofile command.");
includes("src/utils/bmDiagnostics.js", "cpuTradeValidationMicroprofile(options = {})", "Diagnostics expose one generated-package exact-validation microprofile command.");
includes("src/utils/simSpeedMicroDiagnostics.js", "runCpuTradeValidationMicroDiagnostics", "Validation microprofile generates real candidates and exact-validates them without simulating a season.");
includes("src/utils/simSpeedMicroDiagnostics.js", "validateCpuTradeCandidateOnLeague", "Validation microprofile calls the production exact evaluator.");
includes("src/utils/simSpeedMicroDiagnostics.js", "activeSaveWritten: false", "Validation microprofile explicitly records that no active save is written.");
includes("src/utils/simSpeedMicroDiagnostics.js", "validationReadOnly: true", "Validation microprofile is read-only.");
includes("src/utils/simSpeedMicroDiagnostics.js", "fixtureUnchanged", "Validation microprofile verifies its cloned league fixture remains unchanged.");
includes("src/utils/simSpeedMicroDiagnostics.js", "decisionParity", "Validation microprofile compares cold and warm decision hashes.");
includes("src/utils/simSpeedMicroDiagnostics.js", "runExactRepeatProfile", "Validation microprofile measures repeated same-state exact evaluations.");
includes("src/utils/simSpeedMicroDiagnostics.js", "runCpuTradePackageBenchmarks", "Microprofile replays captured exact-validation packages without changing trade decisions.");
includes("src/utils/simSpeedMicroDiagnostics.js", "getCpuCpuTradeCandidates", "Microprofile measures the production CPU trade generator.");
includes("src/utils/simSpeedMicroDiagnostics.js", "repairCpuTeamsToMinRoster(fixtureOne", "Microprofile runs roster repair only on JSON-cloned league data.");
includes("src/utils/simSpeedMicroDiagnostics.js", "STORAGE_DB_PREFIX", "Storage microprofile uses a separate temporary IndexedDB database.");
includes("src/utils/simSpeedMicroDiagnostics.js", "activeSaveWritten: false", "Microprofile explicitly records that the active save is never written.");
includes("src/utils/simSpeedMicroDiagnostics.js", "seasonSimulationRun: false", "Microprofile explicitly records that no season simulation is run.");
includes("src/utils/simSpeedMicroDiagnostics.js", "configureCpuTradeTrace(previousTraceConfig)", "Microprofile restores the user's prior deep-trace configuration.");
includes("src/pages/Calendar.jsx", "ensureCpuTradeDiagnosticsSession", "Calendar automatically captures the pre-trade diagnostic baseline.");
includes("src/pages/Calendar.jsx", 'recordCpuTradeTiming("recordBuildMs"', "Calendar measures full schedule record-map construction.");
includes("src/pages/Calendar.jsx", 'recordCpuTradeTiming("rosterRepairMs"', "Calendar measures post-trade roster repair.");
includes("src/api/cpuTradeEngine.js", 'recordCpuTradeTiming("workerGenerationMs"', "CPU trade worker round-trip time is measured.");
includes("src/api/cpuTradeEngine.js", "cancelCpuTradeWorkerGeneration", "CPU trade worker exposes explicit cancellation for stale generation work.");
includes("src/api/cpuTradeEngine.js", 'replaceWorkerSlot(slot.index, "request_timeout")', "Timed-out CPU trade requests replace only their affected generation worker.");
excludes("src/pages/Calendar.jsx", "foreground_superseded_background", "Continuous market generation never cancels background work to launch an emergency duplicate.");
includes("src/api/cpuTradeEngine.js", "MAX_GENERATION_WORKERS = 4", "V5B uses up to four persistent Pyodide generation workers on high-core desktops while scaling down on smaller systems.");
includes("src/api/cpuTradeEngine.js", "compactCpuTradeHistoryForWorker", "CPU trade generation sends only the exact history fields consumed by Python.");
includes("src/api/cpuTradeEngine.js", "tradeHistory.slice(-CPU_TRADE_HISTORY_LIMIT)", "CPU trade history compaction preserves the original 120-row tail window before stripping unused fields.");
includes("src/api/cpuTradeEngine.js", "getCpuCpuTradeCandidateBatch", "V5B exposes ordered parallel generation for independent exact-seed passes.");
includes("src/api/cpuTradeEngine.js", "Promise.all(rowPromises)", "Each generation request is converted to an ordered fulfilled/error row so one failed worker cannot erase successful sibling results.");
includes("src/api/cpuTradeEngine.js", 'cancelCpuTradeWorkerGeneration(reason = "superseded", requestId = null)', "Generation cancellation can target only the obsolete background request.");
excludes("src/pages/Calendar.jsx", "startCpuCpuTradeCandidateBatch", "Calendar no longer launches speculative future-nonce generation batches.");
includes("src/utils/cpuTradeContinuousMarket.js", "decideContinuousMarketGeneration", "Continuous market generation is governed by one pure bounded policy.");
excludes("src/pages/Calendar.jsx", "trimCpuTradeGenerationResponse", "No speculative oversized foreground response path remains.");
excludes("src/pages/Calendar.jsx", "parallel_foreground_pass_fallback", "There is no parallel foreground fallback path left to stall December or January simulation.");
includes("src/utils/cpuTradeDiagnostics.js", "parallelGenerationPassesUsed", "Diagnostics report V5B parallel generation use and fallback coverage.");
includes("src/pages/Calendar.jsx", "enqueueCpuTradeLeagueSave", "CPU trade state uses the serialized latest-only IndexedDB save queue.");
includes("src/pages/Calendar.jsx", "await flushCpuTradeLeagueSaves()", "Calendar flushes queued CPU trade state before releasing simulation completion.");
includes("public/python/contract_extension_logic.py", "preview_contract_extensions", "Contract-extension eligibility is implemented in Python.");
includes("public/python/contract_extension_acceptance.py", "evaluate_extension_offer", "Player extension acceptance has a dedicated Python module.");
includes("public/python/cpu_contract_extensions.py", "build_cpu_extension_offer", "CPU extension offers have a dedicated Python module.");
includes("public/python/contract_extension_logic.py", '"salaryByYear": original_salaries + extension_salaries', "Accepted extensions append to the canonical salary array.");
includes("public/python/contract_extension_logic.py", '"contract_extension"', "Player and league history record accepted extensions.");
includes("public/python/contract_extension_logic.py", '"Future Security"', "Accepted extensions write persistent locker-room mood events.");
includes("public/workers/simWorkerV2.js", '"contract_extension_logic.py"', "The simulation worker loads the integrated extension engine.");
includes("public/workers/simWorkerV2.js", 'msg.type === "contract-extension-action"', "The worker exposes a dedicated extension action channel.");
includes("src/api/simEnginePy.js", "previewContractExtensions", "Frontend API exposes extension eligibility preview.");
includes("src/api/simEnginePy.js", "submitContractExtensionOffer", "Frontend API exposes user extension negotiations.");
includes("src/api/simEnginePy.js", "processCpuContractExtensions", "Frontend API exposes CPU extension processing.");
includes("src/pages/ContractExtensions.jsx", "Offer Extension", "Contract Extensions page includes a complete negotiation action.");
includes("src/pages/SalaryTable.jsx", "extensionMeta: contract?.extensionMeta", "Salary Table preserves extension metadata internally while displaying extension years like normal contract years.");
excludes("src/pages/SalaryTable.jsx", "text-violet-300", "Salary Table no longer colors extension years differently from normal salary years.");
includes("src/utils/seasonContext.js", "contractExtensionDeadlineDate", "Season calendar exposes a contract-extension deadline.");
includes("src/pages/Calendar.jsx", "shouldPauseForContractExtensionDeadline", "Calendar simulation pauses at the extension deadline.");
includes("src/pages/TeamHub.jsx", 'path: "/contract-extensions"', "Team Hub links the Contract Extensions front-office page.");
includes("public/workers/simWorkerV2.js", "if (initPromise) return initPromise;", "Simulation worker uses a single shared Pyodide initialization promise.");
includes("public/workers/simWorkerV2.js", "const loadedPyodide = await loadPyodide", "Pyodide is assigned only after the one shared initialization completes.");
includes("src/utils/cpuTradeBank.js", "buildSameStateValidationCacheScope", "CPU trade validation reuse is scoped to identical package-relevant state.");
includes("src/utils/cpuTradeBank.js", "sameStatePeriodicCacheHits", "CPU trade diagnostics distinguish periodic same-state validation reuse.");
includes("src/utils/cpuTradeBank.js", "objectIdentityToken(draftPicks)", "Same-state validation cache invalidates when draft-pick ownership storage changes.");
includes("src/utils/cpuTradeBank.js", "recordsFingerprint(context?.recordsByTeam || {})", "Same-state validation cache invalidates when standings records change.");
includes("src/utils/cpuTradeBank.js", "cachedAdmissionRejections", "CPU trade admission preserves rejected-package cache telemetry.");
includes("src/utils/tradeExecution.js", "recordsByTeam = null", "CPU trade exact validation accepts a read-only live standings snapshot.");
includes("src/utils/tradeExecution.js", "Object.defineProperty(wrapped, \"__cpuTradeRecords\"", "CPU trade validation attaches live records only to a non-enumerable ephemeral evaluation wrapper.");
includes("src/utils/tradeExecution.js", "typeof recordsByTeam !== \"object\"", "An explicit empty opening-night standings snapshot still bypasses repeated ResultsV3 scans.");
includes("src/utils/tradeExecution.js", "cpuTradeEvaluationRecordWrappers", "Repeated validations reuse the same ephemeral records wrapper instead of copying league state each time.");
includes("src/utils/cpuTradeBank.js", "recordsByTeam: context?.recordsByTeam || null", "Admission, periodic checks, dry runs, and final execution receive the existing live records snapshot.");
includes("src/utils/cpuTradeBank.js", "recordSnapshotValidationCalls", "Diagnostics count exact validations using the prebuilt live record snapshot.");
includes("src/utils/tradeTeamImpact.js", "const cpuRecords = leagueData?.__cpuTradeRecords", "Team-impact rankings use the attached CPU-trade record snapshot without changing ranking formulas.");
includes("src/utils/tradeTeamImpact.js", "const cpuTradeImpactCache = new Map()", "CPU-to-CPU exact impact results use a bounded dedicated cache instead of changing evaluation formulas.");
includes("src/utils/tradeTeamImpact.js", "makeCpuTradeImpactCacheKey", "CPU impact cache keys are built from semantic trade and league context.");
includes("src/utils/tradeTeamImpact.js", "cpuTradeDraftContextSignature", "CPU impact cache invalidates when draft-pick ownership or protection context changes.");
includes("src/utils/tradeTeamImpact.js", "cpuTradeContractContextSignature", "CPU impact cache invalidates when contract or payroll context changes.");
includes("src/utils/tradeTeamImpact.js", "cpuTradeFinancialContextSignature", "CPU impact cache invalidates when season or financial-rule context changes.");
includes("src/utils/tradeTeamImpact.js", "cpuTradeImpactLeagueContextSignature", "CPU impact cache builds the expensive semantic league signature once per immutable validation snapshot.");
includes("src/utils/tradeTeamImpact.js", "__cpuTradeImpactCacheHit", "CPU impact cache hits are explicitly observable for diagnostics.");
includes("src/utils/simSpeedMicroDiagnostics.js", "resetCpuTradeImpactCache()", "Validation microprofile begins from a cold CPU impact cache before measuring warm reuse.");
includes("src/utils/cpuTradeDiagnostics.js", "getCpuTradeImpactCacheStats", "CPU-trade season diagnostics expose exact impact cache hits, misses, and size.");
includes("src/utils/cpuTradeDiagnostics.js", "cpuImpactCacheHits", "CPU-trade summary reports exact impact cache reuse for controlled season comparisons.");
includes("src/utils/tradePickValue.js", "const cpuRecords = leagueData?.__cpuTradeRecords", "Draft-pick rankings use the same attached CPU-trade record snapshot.");
includes("src/utils/cpuTradeDiagnostics.js", "recordSnapshotValidationCalls", "The CPU-trade report exposes live-record snapshot validation coverage.");
includes("src/pages/Calendar.jsx", "prewarmCpuTradeValidationPool", "Calendar prewarms the persistent CPU-trade exact-validation worker pool.");
includes("src/pages/Calendar.jsx", "await addGeneratedCpuTradeCandidates", "Calendar waits for deterministic ordered parallel admission validation.");
includes("src/api/cpuTradeValidationPool.js", 'type: "sync-snapshot"', "Validation workers reuse a persistent trade-relevant league snapshot.");
includes("src/api/cpuTradeValidationPool.js", "CPU_TRADE_VALIDATION_POOL_PARITY_MISMATCH", "Parallel validation falls back when serial-worker parity fails.");
includes("src/workers/cpuTradeValidationWorker.js", "validateCpuTradeCandidateOnLeague", "Validation workers call the original exact evaluator rather than a rewritten formula.");
includes("src/utils/cpuTradeBank.js", "validateCpuTradeCandidatesParallel", "CPU trade admission can exact-validate candidate batches in parallel.");
includes("src/utils/cpuTradeBank.js", "admission_serial_fallback", "CPU trade admission preserves the V4 serial fallback path.");
includes("src/utils/cpuTradeBank.js", "executeCpuTradeCandidateOnLeague", "Final trade execution still runs the original exact evaluator on the live main-thread league.");
includes("src/utils/cpuTradeDiagnostics.js", "parallelValidationWallMs", "CPU-trade diagnostics expose parallel validation wall time.");
includes("src/pages/Calendar.jsx", "w: 0,", "Calendar's prebuilt CPU-trade records include evaluator-compatible wins.");
includes("src/pages/Calendar.jsx", "pf: 0,", "Calendar's prebuilt CPU-trade records include evaluator-compatible point differential inputs.");
includes("src/pages/Calendar.jsx", "result?.totals?.home ?? result?.winner?.home", "Snapshot validation preserves the exact historical ResultsV3 score-read path.");
includes("src/pages/Calendar.jsx", "home.wins += 1", "Existing generator-facing wins/losses aliases remain intact.");
includes("src/pages/Calendar.jsx", "startSimulationGameOrderEvent", "Calendar records scheduled date and execution sequence without changing simulation order.");
includes("src/pages/Calendar.jsx", "gameOrderDateInversions", "Calendar detects any scheduled-date inversion during simulation.");
includes("src/utils/bmDiagnostics.js", "simHistory()", "Diagnostics preserve recent pre/post-checkpoint simulation runs for order investigation.");
includes("src/utils/cpuTradeBank.js", 'recordCpuTradeTiming("exactValidationMs"', "CPU trade exact validation time is measured.");
includes("src/utils/cpuTradeDiagnostics.js", "runCpuTradePackageBenchmarks", "Diagnostics include repeatable package-level validation benchmarks.");
includes("src/utils/cpuTradeDiagnostics.js", "staleStoredFeedTransactions", "Diagnostics audit stale completed-trade feed entries.");
includes("src/utils/cpuTradeDiagnostics.js", "postDeadlineTradeCount", "Diagnostics audit post-deadline CPU trades.");
includes("src/utils/cpuTradeDiagnostics.js", "changedPlayers", "Diagnostics audit regular-season rating drift.");
excludes("src/pages/Calendar.jsx", 'recordCpuTradeTiming("foregroundGenerationMs"', "Calendar performs no blocking foreground generation work.");
includes("src/utils/cpuTradeTelemetry.js", "MAX_TRACE_ROWS = 4000", "Deep CPU-trade diagnostics use a capped in-memory trace.");
includes("src/utils/cpuTradeTelemetry.js", "installCpuTradeTraceConsoleApi", "Deep CPU-trade diagnostics expose one console export API.");
includes("src/api/cpuTradeEngine.js", 'recordCpuTradeTrace("generation", "launched"', "Generation diagnostics record launch reason, nonce, payload, and worker-pool state.");
includes("src/api/cpuTradeEngine.js", "...(traceEnabled ? { diagnosticsTraceEnabled: true } : {})", "Generation worker diagnostics are opt-in so the normal V5B worker message stays unchanged.");
includes("public/workers/cpuTradeSeasonWorker.js", "Boolean(msg.diagnosticsTraceEnabled)", "The generation worker forwards the diagnostics flag into Python timing collection.");
includes("src/api/cpuTradeValidationPool.js", "queueAndInboundTransferMs", "Exact-validation diagnostics separate queue/inbound transfer from worker compute.");
includes("src/utils/cpuTradeBank.js", 'recordCpuTradeTrace("bank", "admission_completed"', "Bank diagnostics record inventory and admission outcomes.");
includes("src/pages/Calendar.jsx", 'recordCpuTradeTrace("repair", "post_trade_repair_completed"', "Post-trade diagnostics record roster counts and mandatory repair completion.");
includes("src/utils/cpuTradeSaveQueue.js", 'recordCpuTradeTrace("storage", "save_enqueued"', "Save diagnostics record queue depth, payload estimate, and write timing.");
includes("src/pages/Calendar.jsx", "startCpuTradeMainThreadMonitor", "Sim To Date can record long tasks and event-loop delay without console spam.");
includes("src/pages/Calendar.jsx", "shouldDisableCpuTradesForDiagnostics", "The no-CPU-trades floor control is explicit and diagnostics-only.");
includes("src/pages/Calendar.jsx", 'recordCpuTradeTiming("feedHistorySyncMs"', "Calendar measures canonical Trade Desk feed synchronization.");
includes("src/utils/bmDiagnostics.js", "cpuTradeSummary()", "Diagnostics preserve the compact reliability report alongside the demon report.");
includes("src/utils/cpuTradeTelemetry.js", "candidateSnapshot = safeClone(candidate)", "Package replay captures immutable candidate and league snapshots.");
includes("src/pages/Calendar.jsx", "if (!firstPendingTradeDate || d < firstPendingTradeDate)", "Resumed Sim To Date skips completed games after preserving deadline and All-Star checkpoints.");
includes("src/pages/Calendar.jsx", "if (!firstPendingTradeDate || date < firstPendingTradeDate)", "Resumed full-season simulation skips completed games after preserving checkpoints.");
includes("src/utils/tradeFinderPackageBuilder.js", 'candidateOrder = "strongest"', "Standard Trade Finder keeps its existing strongest-first ordering by default.");
includes("src/utils/reverseTradeFinderOfferEngine.js", 'candidateOrder: "reverse_nearest"', "Reverse Finder requests nearest-value candidate ordering instead of strongest-first truncation.");
includes("src/utils/reverseTradeFinderOfferEngine.js", "REVERSE_RESCUE_EXACT_EVALS", "Reverse Finder has a second exact-check rescue pass.");
includes("src/pages/TradeFinder.jsx", "engineDiagnostics: result?.diagnostics", "Trade Finder preserves Reverse Finder stage diagnostics.");
excludes("src/utils/reverseTradeFinderOfferEngine.js", "REVERSE_MAX_COMFORT_MARGIN", "Reverse Finder no longer discards accepted offers solely because the CPU likes them by more than eight points.");

const {
  findFirstPendingSimulationDate,
  getCpuTradeSimulationDateDecision,
  isCpuTradeWindowOpenDate,
} = calendarTiming;
const { prioritizeReverseCandidateRows, buildReverseRescueQueue } = reverseCoverage;
const {
  compactCpuTradeValidationResult,
  cpuTradeValidationParityMatches,
  mergeIndexedCpuTradeValidationResults,
  partitionIndexedCpuTradeCandidates,
} = cpuTradeValidationProtocol;

const validationPartitions = partitionIndexedCpuTradeCandidates(["a", "b", "c", "d", "e"], 3);
check(
  "cpu_trade_parallel.partition_order",
  JSON.stringify(validationPartitions) === JSON.stringify([
    [{ index: 0, candidate: "a" }, { index: 3, candidate: "d" }],
    [{ index: 1, candidate: "b" }, { index: 4, candidate: "e" }],
    [{ index: 2, candidate: "c" }],
  ]),
  "Parallel exact validation partitions work while retaining original candidate indexes.",
  JSON.stringify(validationPartitions)
);

const mergedValidationRows = mergeIndexedCpuTradeValidationResults(
  [
    { workerIndex: 0, results: [{ index: 0, result: { ok: true, evaluation: { score: 1 } }, durationMs: 2 }, { index: 3, result: { ok: false, staleCode: "x" }, durationMs: 3 }] },
    { workerIndex: 1, results: [{ index: 1, result: { ok: true, evaluation: { score: 2 } }, durationMs: 4 }, { index: 4, result: { ok: true, evaluation: { score: 5 } }, durationMs: 5 }] },
    { workerIndex: 2, results: [{ index: 2, result: { ok: true, evaluation: { score: 3 } }, durationMs: 6 }] },
  ],
  5
);
check(
  "cpu_trade_parallel.merge_order",
  mergedValidationRows.map((row) => row.result?.evaluation?.score || row.result?.staleCode).join("|") === "1|2|3|x|5",
  "Parallel exact-validation results are restored to the original serial candidate order.",
  JSON.stringify(mergedValidationRows)
);

const parityFixture = {
  ok: true,
  candidate: {
    fromTeamName: "Alpha",
    toTeamName: "Beta",
    fromItems: [{ type: "player", teamName: "Alpha", player: { id: "p1", name: "One", overall: 99 } }],
    toItems: [{ type: "pick", teamName: "Beta", pick: { id: "pick1", year: 2028, round: 1, ownerTeam: "Beta", originalTeam: "Beta" } }],
  },
  fromTeamView: { accepted: true, decision: "accept", score: 4, message: "yes", reasons: ["one"] },
  toTeamView: { accepted: true, decision: "accept", score: 5, message: "yes", reasons: ["two"] },
  evaluation: { accepted: true, decision: "accept", score: 9, reasons: ["one", "two"] },
  requiresRosterRepairBeforeSimulation: false,
};
const compactParityFixture = compactCpuTradeValidationResult(parityFixture);
check(
  "cpu_trade_parallel.parity_projection",
  cpuTradeValidationParityMatches(parityFixture, compactParityFixture),
  "Worker result compaction preserves every field that controls CPU-trade admission decisions.",
  JSON.stringify(compactParityFixture)
);

const scheduleTimingFixture = {
  "2026-10-21": [{ id: "G1", played: true }],
  "2027-02-03": [{ id: "G2", played: false }],
  "2027-02-06": [{ id: "G3", played: false }],
  "2027-04-08": [{ id: "G4", played: false }],
};
const storedTimingResults = {
  G2: { totals: { home: 108, away: 101 } },
};
const firstPendingDate = findFirstPendingSimulationDate(scheduleTimingFixture, storedTimingResults);
check("calendar.first_pending_date", firstPendingDate === "2027-02-06", "Calendar finds the first truly unsimulated date instead of restarting trade work at opening night.", firstPendingDate);
check("calendar.active_window", isCpuTradeWindowOpenDate("2027-02-04", "2027-02-05"), "CPU trade window remains open strictly before the deadline.");
check("calendar.deadline_locked", !isCpuTradeWindowOpenDate("2027-02-05", "2027-02-05"), "CPU trade processing is locked on and after the deadline date.");
check(
  "calendar.historical_resume_skip",
  getCpuTradeSimulationDateDecision({ currentDate: "2027-01-15", firstPendingDate, tradeDeadlineDate: "2027-02-05" }).reason === "historical_date_already_simulated",
  "Resumed simulation skips CPU trade processing on dates whose games are already complete."
);
check(
  "calendar.post_deadline_resume_skip",
  getCpuTradeSimulationDateDecision({ currentDate: firstPendingDate, firstPendingDate, tradeDeadlineDate: "2027-02-05" }).reason === "trade_deadline_locked",
  "A late-season resume performs zero CPU trade passes once the first pending date is after the deadline."
);
check(
  "calendar.live_pending_date_runs",
  getCpuTradeSimulationDateDecision({ currentDate: "2027-01-15", firstPendingDate: "2027-01-15", tradeDeadlineDate: "2027-02-05" }).shouldRun === true,
  "CPU trade processing still runs for a genuinely pending pre-deadline simulation date."
);

const reverseCandidates = [
  [{ id: "star" }, { id: "filler-a" }, { id: "filler-b" }],
  [{ id: "mid" }],
  [{ id: "cheap" }],
  [{ id: "pair-a" }, { id: "pair-b" }],
  [{ id: "mid" }],
];
const candidateKey = (items) => items.map((item) => item.id).join("+");
const heuristicMap = new Map([
  ["star+filler-a+filler-b", 0.1],
  ["mid", 2],
  ["cheap", 1],
  ["pair-a+pair-b", 0.2],
]);
const prioritizedReverse = prioritizeReverseCandidateRows({
  candidates: reverseCandidates,
  maxCandidates: 3,
  packageKeyOf: candidateKey,
  heuristicOf: (items) => heuristicMap.get(candidateKey(items)) ?? 99,
});
check(
  "reverse.single_asset_coverage",
  candidateKey(prioritizedReverse[0]) === "cheap" && candidateKey(prioritizedReverse[1]) === "mid",
  "Reverse candidate caps preserve simple one-asset asking prices before multi-asset standard-finder shells.",
  JSON.stringify(prioritizedReverse)
);
check(
  "reverse.candidate_deduplication",
  new Set(prioritizedReverse.map(candidateKey)).size === prioritizedReverse.length,
  "Reverse candidate prioritization removes duplicate package identities."
);
const rescueQueue = buildReverseRescueQueue({
  candidates: prioritizedReverse.concat([[{ id: "rescue" }], [{ id: "rescue" }]]),
  checkedKeys: new Set(["cheap", "mid"]),
  maxCandidates: 2,
  packageKeyOf: candidateKey,
});
check(
  "reverse.rescue_queue",
  rescueQueue.length === 2 && candidateKey(rescueQueue[0]) === "star+filler-a+filler-b" && candidateKey(rescueQueue[1]) === "rescue",
  "Reverse rescue exact checks skip already-tested and duplicate packages while retaining additional legal candidates.",
  JSON.stringify(rescueQueue)
);

cpuTradeTelemetry.resetCpuTradeTelemetry({ sessionKey: "regression-test", note: "test" });
cpuTradeTelemetry.recordCpuTradeTiming("exactValidationMs", 4.25, { phase: "test" });
cpuTradeTelemetry.recordCpuTradeTiming("exactValidationMs", 5.75, { phase: "test" });
const telemetrySnapshot = cpuTradeTelemetry.getCpuTradeTelemetrySnapshot();
check(
  "cpu_trade_diag.telemetry_timing",
  telemetrySnapshot?.metrics?.exactValidationMs?.count === 2 && telemetrySnapshot?.metrics?.exactValidationMs?.totalMs === 10,
  "CPU trade telemetry accumulates exact-validation counts and timing without mutating trade logic.",
  JSON.stringify(telemetrySnapshot?.metrics?.exactValidationMs || {})
);

const traceDefaultConfig = cpuTradeTelemetry.getCpuTradeTraceConfig();
check(
  "cpu_trade_trace.default_off",
  traceDefaultConfig.enabled === false && cpuTradeTelemetry.shouldDisableCpuTradesForDiagnostics() === false,
  "Deep tracing and the no-CPU-trades control remain disabled by default.",
  JSON.stringify(traceDefaultConfig)
);

cpuTradeTelemetry.resetCpuTradeDeepTrace({ label: "regression-trace", noCpuTrades: true });
for (let index = 0; index < 4005; index += 1) {
  cpuTradeTelemetry.recordCpuTradeTrace("regression", "row", { index });
}
const cappedTrace = cpuTradeTelemetry.getCpuTradeDeepTraceSnapshot({ fixture: true });
check(
  "cpu_trade_trace.capped",
  cappedTrace.rowCount === 4000 && cappedTrace.droppedRows === 6 && cappedTrace.events[0]?.sequence === 7,
  "Deep tracing caps memory at 4,000 rows while retaining monotonic sequence numbers.",
  JSON.stringify({ rowCount: cappedTrace.rowCount, droppedRows: cappedTrace.droppedRows, firstSequence: cappedTrace.events[0]?.sequence })
);
check(
  "cpu_trade_trace.no_trades_opt_in",
  cpuTradeTelemetry.shouldDisableCpuTradesForDiagnostics() === true,
  "The game-simulation floor control activates only through an explicit deep-trace option."
);
const exportedTrace = cpuTradeTelemetry.exportCpuTradeDeepTrace({ download: false, context: { fixture: "regression" } });
check(
  "cpu_trade_trace.export",
  exportedTrace?.trace?.context?.fixture === "regression" && exportedTrace?.trace?.events?.length === 4000 && !exportedTrace?.telemetry?.deepTrace,
  "One export command returns the capped trace once together with the existing CPU-trade telemetry snapshot."
);
cpuTradeTelemetry.stopCpuTradeDeepTrace();
check(
  "cpu_trade_trace.stop_restores_default",
  cpuTradeTelemetry.getCpuTradeTraceConfig().enabled === false && cpuTradeTelemetry.shouldDisableCpuTradesForDiagnostics() === false,
  "Stopping diagnostics restores normal CPU-trade behavior."
);
cpuTradeTelemetry.resetCpuTradeTelemetry({ sessionKey: "regression-test", note: "post-trace-test" });

const historyCompactionFixture = Array.from({ length: 140 }, (_, index) => ({
  id: `history_${index}`,
  source: index % 7 === 0 ? "cpu_cpu_trade" : "user_trade",
  cpuCpuTrade: index % 7 === 0,
  userTeamName: `User ${index}`,
  cpuTeamName: `CPU ${index}`,
  fromTeamName: `From ${index}`,
  toTeamName: `To ${index}`,
  date: `2027-01-${String((index % 20) + 1).padStart(2, "0")}`,
  currentDate: `2027-01-${String((index % 20) + 1).padStart(2, "0")}`,
  movedPlayers: [{
    name: `Player ${index}`,
    fromTeam: `From ${index}`,
    toTeam: `To ${index}`,
    fullPlayerSnapshot: { biography: "x".repeat(2000) },
  }],
  evaluationSummary: { reasons: ["x".repeat(4000)] },
  teamPackages: [{ presentation: "x".repeat(4000) }],
}));
const compactHistoryFixture = cpuTradeEngine.compactCpuTradeHistoryForWorker(historyCompactionFixture);
check(
  "cpu_trade_history.tail_window",
  compactHistoryFixture.length === 120 &&
    compactHistoryFixture[0]?.fromTeamName === "From 20" &&
    compactHistoryFixture.at(-1)?.fromTeamName === "From 139",
  "CPU trade history compaction keeps the exact last 120 records in their original order."
);
const compactHistoryKeys = Object.keys(compactHistoryFixture[0] || {}).sort();
check(
  "cpu_trade_history.field_contract",
  JSON.stringify(compactHistoryKeys) === JSON.stringify([
    "cpuCpuTrade",
    "cpuTeamName",
    "currentDate",
    "date",
    "fromTeamName",
    "movedPlayers",
    "source",
    "toTeamName",
    "userTeamName",
  ].sort()) &&
    Object.keys(compactHistoryFixture[0]?.movedPlayers?.[0] || {}).sort().join(",") === "name,toTeam",
  "Worker history contains every Python-consumed field and excludes unused presentation/evaluation snapshots.",
  JSON.stringify(compactHistoryKeys)
);
const fullHistoryFixtureBytes = Buffer.byteLength(JSON.stringify(historyCompactionFixture.slice(-120)));
const compactHistoryFixtureBytes = Buffer.byteLength(JSON.stringify(compactHistoryFixture));
check(
  "cpu_trade_history.payload_reduction",
  compactHistoryFixtureBytes < fullHistoryFixtureBytes * 0.1,
  "History compaction removes at least 90% of the oversized regression fixture payload.",
  JSON.stringify({ fullHistoryFixtureBytes, compactHistoryFixtureBytes })
);

const benchmarkCandidateFixture = {
  fromTeamName: "Alpha",
  toTeamName: "Beta",
  fromItems: [{ type: "player", player: { id: "p1", name: "One" } }],
  toItems: [{ type: "player", player: { id: "p2", name: "Two" } }],
};
const benchmarkLeagueFixture = {
  teams: [
    { name: "Alpha", players: [{ id: "p1", name: "One" }] },
    { name: "Beta", players: [{ id: "p2", name: "Two" }] },
  ],
};
cpuTradeTelemetry.recordCpuTradeValidation({
  phase: "regression_snapshot",
  signature: "snapshot_fixture",
  candidate: benchmarkCandidateFixture,
  leagueData: benchmarkLeagueFixture,
  context: { currentDate: "2027-01-01" },
  result: {
    ok: true,
    fromTeamView: { accepted: true, score: 2, threshold: 1 },
    toTeamView: { accepted: true, score: 3, threshold: 1 },
  },
  durationMs: 1,
});
benchmarkCandidateFixture.fromItems[0].player.name = "Mutated Candidate";
benchmarkLeagueFixture.teams[0].players[0].name = "Mutated League";
const benchmarkSnapshot = cpuTradeTelemetry.getCpuTradeBenchmarkSamples()[0];
check(
  "cpu_trade_diag.immutable_package_snapshot",
  benchmarkSnapshot?.candidate?.fromItems?.[0]?.player?.name === "One" &&
    benchmarkSnapshot?.leagueData?.teams?.[0]?.players?.[0]?.name === "One",
  "Package benchmarks preserve exact immutable candidate and league inputs for before/after replay.",
  JSON.stringify(benchmarkSnapshot || {})
);
cpuTradeTelemetry.resetCpuTradeTelemetry({ sessionKey: "", note: "regression-cleanup" });

const queuedSaveVersions = [];
const latestOnlyQueue = cpuTradeSaveQueue.createLatestOnlySaveQueue({
  save: async (leagueData) => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    queuedSaveVersions.push(leagueData.version);
    return leagueData;
  },
  now: () => Date.now(),
});
const queuedPromises = [
  latestOnlyQueue.enqueue({ leagueData: { version: 1 } }),
  latestOnlyQueue.enqueue({ leagueData: { version: 2 } }),
  latestOnlyQueue.enqueue({ leagueData: { version: 3 } }),
];
await latestOnlyQueue.flush();
await Promise.all(queuedPromises);
check(
  "cpu_trade_storage.latest_only_queue",
  queuedSaveVersions.length === 1 && queuedSaveVersions[0] === 3,
  "Rapid CPU trade saves collapse to one latest-state IndexedDB write.",
  JSON.stringify({ queuedSaveVersions, state: latestOnlyQueue.getState() })
);

const overlayLeagueFixture = {
  seasonYear: 2026,
  teams: [
    { name: "Alpha", players: [{ id: "a1" }] },
    { name: "Beta", players: [{ id: "b1" }] },
  ],
  marker: "full",
  cpuTradeBankState: {
    version: 7,
    seasonYear: 2026,
    seed: "storage-parity",
    completedTrades: 9,
    candidates: [{ id: "candidate-1" }],
  },
};
const overlayRecord = leagueStorage.buildCpuTradeBankOverlayRecord(overlayLeagueFixture, 200);
const baseLeagueFixture = {
  ...overlayLeagueFixture,
  cpuTradeBankState: { ...overlayLeagueFixture.cpuTradeBankState, completedTrades: 8, candidates: [] },
};
const overlayMerge = leagueStorage.mergeCpuTradeBankOverlayIntoLeague(
  baseLeagueFixture,
  { updatedAt: 100 },
  overlayRecord
);
check(
  "cpu_trade_storage.overlay_newer_merge",
  overlayMerge.applied === true &&
    overlayMerge.leagueData.marker === "full" &&
    overlayMerge.leagueData.cpuTradeBankState.completedTrades === 9 &&
    overlayMerge.leagueData.cpuTradeBankState.candidates[0].id === "candidate-1",
  "A newer compatible sidecar restores only CPU bank state over the full league snapshot.",
  JSON.stringify(overlayMerge)
);
const staleOverlayMerge = leagueStorage.mergeCpuTradeBankOverlayIntoLeague(
  baseLeagueFixture,
  { updatedAt: 300 },
  overlayRecord
);
check(
  "cpu_trade_storage.overlay_stale_ignored",
  staleOverlayMerge.applied === false &&
    staleOverlayMerge.reason === "overlay_older_than_full_save" &&
    staleOverlayMerge.leagueData.cpuTradeBankState.completedTrades === 8,
  "A sidecar older than the full save cannot overwrite newer league state.",
  JSON.stringify(staleOverlayMerge)
);
const wrongSeasonOverlay = { ...overlayRecord, seasonYear: 2027 };
const wrongSeasonMerge = leagueStorage.mergeCpuTradeBankOverlayIntoLeague(
  baseLeagueFixture,
  { updatedAt: 100 },
  wrongSeasonOverlay
);
check(
  "cpu_trade_storage.overlay_season_guard",
  wrongSeasonMerge.applied === false && wrongSeasonMerge.reason === "season_mismatch",
  "CPU bank sidecars cannot cross season boundaries.",
  JSON.stringify(wrongSeasonMerge)
);

const strongestModeWrites = [];
const strongestModeQueue = cpuTradeSaveQueue.createLatestOnlySaveQueue({
  save: async (leagueData, batch) => {
    strongestModeWrites.push({ version: leagueData.version, saveMode: batch.saveMode, reason: batch.reason });
    return leagueData;
  },
  now: () => Date.now(),
});
const strongestModePromises = [
  strongestModeQueue.enqueue({ leagueData: { version: 1 }, reason: "trade_or_roster_change" }),
  strongestModeQueue.enqueue({ leagueData: { version: 2 }, reason: "bank_state_only" }),
];
await strongestModeQueue.flush();
await Promise.all(strongestModePromises);
check(
  "cpu_trade_storage.full_save_strength_preserved",
  strongestModeWrites.length === 1 &&
    strongestModeWrites[0].version === 2 &&
    strongestModeWrites[0].saveMode === "full_league" &&
    strongestModeWrites[0].reason === "trade_or_roster_change",
  "A later bank-only snapshot cannot downgrade a covered roster/trade request to a sidecar-only write.",
  JSON.stringify(strongestModeWrites)
);

const overlayModeWrites = [];
const overlayModeQueue = cpuTradeSaveQueue.createLatestOnlySaveQueue({
  save: async (leagueData, batch) => {
    overlayModeWrites.push({ version: leagueData.version, saveMode: batch.saveMode });
    return leagueData;
  },
  now: () => Date.now(),
});
const overlayModePromises = [
  overlayModeQueue.enqueue({ leagueData: { version: 1 }, reason: "bank_state_only" }),
  overlayModeQueue.enqueue({ leagueData: { version: 2 }, reason: "bank_state_only" }),
  overlayModeQueue.enqueue({ leagueData: { version: 3 }, reason: "bank_state_only" }),
];
await overlayModeQueue.flush();
await Promise.all(overlayModePromises);
check(
  "cpu_trade_storage.bank_only_sidecar_mode",
  overlayModeWrites.length === 1 &&
    overlayModeWrites[0].version === 3 &&
    overlayModeWrites[0].saveMode === "bank_overlay",
  "Rapid bank-only changes collapse to one latest CPU bank sidecar write.",
  JSON.stringify(overlayModeWrites)
);

async function runInFlightSaveModeCase(firstReason, secondReason) {
  const writes = [];
  let releaseFirstWrite;
  const firstWriteGate = new Promise((resolve) => { releaseFirstWrite = resolve; });
  let writeCount = 0;
  const queue = cpuTradeSaveQueue.createLatestOnlySaveQueue({
    save: async (leagueData, batch) => {
      writes.push({ version: leagueData.version, saveMode: batch.saveMode, reason: batch.reason });
      writeCount += 1;
      if (writeCount === 1) await firstWriteGate;
      return leagueData;
    },
    now: () => Date.now(),
  });
  const first = queue.enqueue({ leagueData: { version: 1 }, reason: firstReason });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = queue.enqueue({ leagueData: { version: 2 }, reason: secondReason });
  releaseFirstWrite();
  await queue.flush();
  await Promise.all([first, second]);
  return writes;
}

const fullThenOverlayWrites = await runInFlightSaveModeCase(
  "trade_or_roster_change",
  "bank_state_only"
);
check(
  "cpu_trade_storage.inflight_full_then_overlay",
  fullThenOverlayWrites.length === 2 &&
    fullThenOverlayWrites[0].saveMode === "full_league" &&
    fullThenOverlayWrites[1].saveMode === "bank_overlay" &&
    fullThenOverlayWrites[1].version === 2,
  "A newer bank sidecar safely follows an in-flight full league save.",
  JSON.stringify(fullThenOverlayWrites)
);

const overlayThenFullWrites = await runInFlightSaveModeCase(
  "bank_state_only",
  "trade_or_roster_change"
);
check(
  "cpu_trade_storage.inflight_overlay_then_full",
  overlayThenFullWrites.length === 2 &&
    overlayThenFullWrites[0].saveMode === "bank_overlay" &&
    overlayThenFullWrites[1].saveMode === "full_league" &&
    overlayThenFullWrites[1].version === 2,
  "A newer full league save safely supersedes and clears an older in-flight bank sidecar.",
  JSON.stringify(overlayThenFullWrites)
);

const validationProtocol = read("src/utils/cpuTradeValidationProtocol.js");
const cpuTradeDiagnosticsSource = read("src/utils/cpuTradeDiagnostics.js");
check(
  "cpu_trade_validation_protocol.compacts_threshold",
  validationProtocol.includes("threshold: finiteNumber(view?.teamImpact?.threshold ?? view?.threshold, 0)"),
  "Parallel CPU validation results preserve exact team thresholds for parity checks."
);
check(
  "cpu_trade_validation_protocol.parity_includes_threshold",
  validationProtocol.includes("cpuTradeValidationParityProjection") &&
    validationProtocol.includes("fromTeamView: compact.fromTeamView") &&
    validationProtocol.includes("toTeamView: compact.toTeamView"),
  "Worker/main-thread parity compares compact team views that now include scores and thresholds."
);
check(
  "cpu_trade_diagnostics.replay_records_snapshot",
  cpuTradeDiagnosticsSource.includes("recordsByTeam:") &&
    cpuTradeDiagnosticsSource.includes("sample?.context?.recordsByTeam"),
  "Evaluator replay reuses the exact standings snapshot from the original validation."
);

const {
  CPU_TRADE_CONTINUOUS_MAX_TARGET,
  CPU_TRADE_CONTINUOUS_MIN_TARGET,
  decideContinuousMarketGeneration,
  getContinuousMarketBudgets,
  getContinuousMarketMinimumTrades,
} = cpuTradeContinuousMarket;

check(
  "cpu_trade_continuous.target_range",
  CPU_TRADE_CONTINUOUS_MIN_TARGET === 22 && CPU_TRADE_CONTINUOUS_MAX_TARGET === 30,
  "Continuous CPU-trade seasons stay inside the requested 22-30 range."
);
check(
  "cpu_trade_continuous.minimum_floor",
  getContinuousMarketMinimumTrades(27) === 24 &&
    getContinuousMarketMinimumTrades(22) === 22 &&
    getContinuousMarketMinimumTrades(30) === 27,
  "A seeded desired target has a three-trade tolerance instead of exact-count forcing."
);
const continuousBudgets = getContinuousMarketBudgets(27);
check(
  "cpu_trade_continuous.hard_budgets",
  continuousBudgets.maximumGenerationPasses === 20 &&
    continuousBudgets.maximumExactEvaluations === 756,
  "The 27-trade benchmark has fixed generation and exact-validation ceilings."
);
const continuousCoverageDecision = decideContinuousMarketGeneration({
  dayIndex: 40,
  daysToDeadline: 70,
  seed: "regression-seed",
  generationNonce: 3,
  lastGenerationDayIndex: 30,
  generationPasses: 5,
  exactEvaluations: 120,
  ...continuousBudgets,
  runway: {
    remainingDesired: 20,
    remainingMinimum: 17,
    bankSize: 1,
    reserveDeficit: 4,
    dueSoon: true,
    lateOptionalInventoryLocked: false,
  },
});
check(
  "cpu_trade_continuous.coverage_generation",
  continuousCoverageDecision.shouldGenerate === true &&
    continuousCoverageDecision.reason === "continuous_inventory_coverage" &&
    continuousCoverageDecision.exactEvaluationLimit <= 36 &&
    continuousCoverageDecision.requestedCandidates <= 72,
  "Organic inventory deficits launch one bounded nonblocking background pass."
);
const continuousCooldownDecision = decideContinuousMarketGeneration({
  dayIndex: 32,
  daysToDeadline: 70,
  seed: "regression-seed",
  generationNonce: 3,
  lastGenerationDayIndex: 30,
  generationPasses: 5,
  exactEvaluations: 120,
  ...continuousBudgets,
  runway: {
    remainingDesired: 20,
    remainingMinimum: 17,
    bankSize: 1,
    reserveDeficit: 4,
    dueSoon: false,
    lateOptionalInventoryLocked: false,
  },
});
check(
  "cpu_trade_continuous.cooldown",
  continuousCooldownDecision.shouldGenerate === false &&
    continuousCooldownDecision.reason === "continuous_cooldown",
  "A thin bank does not trigger generation every simulated day."
);
const continuousMinimumSecuredDecision = decideContinuousMarketGeneration({
  dayIndex: 95,
  daysToDeadline: 15,
  seed: "regression-seed",
  generationNonce: 12,
  lastGenerationDayIndex: 90,
  generationPasses: 14,
  exactEvaluations: 400,
  ...continuousBudgets,
  runway: {
    remainingDesired: 3,
    remainingMinimum: 0,
    bankSize: 0,
    reserveDeficit: 3,
    dueSoon: true,
    lateOptionalInventoryLocked: true,
  },
});
check(
  "cpu_trade_continuous.minimum_secured_stop",
  continuousMinimumSecuredDecision.shouldGenerate === false &&
    continuousMinimumSecuredDecision.reason === "minimum_secured_late_market",
  "Late January does not force optional trades after the seeded minimum is secured."
);
const continuousBudgetStopDecision = decideContinuousMarketGeneration({
  dayIndex: 70,
  daysToDeadline: 35,
  seed: "regression-seed",
  generationNonce: 20,
  lastGenerationDayIndex: 60,
  generationPasses: continuousBudgets.maximumGenerationPasses,
  exactEvaluations: 300,
  ...continuousBudgets,
  runway: {
    remainingDesired: 8,
    remainingMinimum: 4,
    bankSize: 0,
    reserveDeficit: 4,
    dueSoon: true,
    lateOptionalInventoryLocked: false,
  },
});
check(
  "cpu_trade_continuous.pass_budget_stop",
  continuousBudgetStopDecision.shouldGenerate === false &&
    continuousBudgetStopDecision.reason === "generation_pass_budget_exhausted",
  "Generation cannot exceed its hard season pass budget even near the deadline."
);

const freeAgency = read("public/python/free_agency_logic.py");
const teamRoster = read("public/python/team_roster_logic.py");
const cpuTrade = read("public/python/cpu_cpu_trade_logic.py");
const cpuTradeBank = read("src/utils/cpuTradeBank.js");
const tradeDeskFeed = read("src/utils/tradeDeskFeed.js");
check("cpu_trade_bank.version12", cpuTradeBank.includes("CPU_TRADE_BANK_VERSION = 12"), "CPU trade bank schema matches the current bounded continuous-market persistence version.");
check("cpu_trade_bank.bounded_runway", cpuTradeBank.includes("upcomingSlots + 1") && cpuTradeBank.includes("lateOptionalInventoryLocked"), "CPU trade inventory covers upcoming organic slots without trying to stock every remaining target trade.");
check("cpu_trade_bank.runway_status", cpuTradeBank.includes("getCpuTradeBankRunwayStatus") && cpuTradeBank.includes("foregroundRecommended"), "CPU trade bank exposes runway/foreground inventory pressure signals.");
check("calendar.single_organic_execution", !read("src/pages/Calendar.jsx").includes("getCpuTradeExecutionBurstLimit") && !read("src/pages/Calendar.jsx").includes("countCpuTradeSlotsDueToday"), "Calendar executes at most one organic CPU trade slot per simulated date.");
check("trade_desk.sync_history", tradeDeskFeed.includes("syncTradeDeskFeedWithLeagueHistory") && tradeDeskFeed.includes("mergeTradeDeskFeedWithLeague"), "Trade Desk feed can purge non-canonical transaction rows.");
check("python.free_agency.max15", /REGULAR_SEASON_MAX_ROSTER\s*=\s*15/.test(freeAgency), "CPU roster repair restores teams to the 15-player simulation maximum.");
check("python.free_agency.rating_freeze_snapshot", freeAgency.includes("REGULAR_SEASON_RATING_FREEZE_FIELDS") && freeAgency.includes("build_regular_season_rating_freeze_snapshot"), "Regular-season CPU roster repair snapshots existing player ratings before cleanup.");
check("python.free_agency.rating_freeze_restore", freeAgency.includes("restore_regular_season_rating_freeze_snapshot") && freeAgency.includes("ratingFreezeAudit"), "Regular-season CPU roster repair restores any rating drift before saving.");
check("python.free_agency.targeted_scope", freeAgency.includes("normalize_cpu_repair_team_scope") && freeAgency.includes("iter_cpu_repair_scope_teams"), "Post-trade repair has a deterministic two-team scope helper.");
check("python.free_agency.global_76_rule_preserved", freeAgency.includes("sign_high_value_free_agents_before_simulation") && freeAgency.includes("has_high_value_free_agents"), "The global 76+ free-agent placement rule remains active in targeted repair.");
check("python.free_agency.compact_patch", freeAgency.includes("build_cpu_roster_repair_league_patch") && freeAgency.includes('result["leaguePatch"]'), "Targeted repair returns only changed teams and mutated free-agency ledgers.");
check("python.free_agency.unrelated_illegal_fallback", freeAgency.includes("unrelated_team_requires_full_repair") && freeAgency.includes("targetedFallbackRequired"), "Unexpected unrelated roster violations request the full legacy fallback.");
check("python.free_agency.full_path_copy_preserved", freeAgency.includes("updated = league_data if targeted_mode else copy.deepcopy(league_data)"), "The legacy full repair keeps its original deep-copy semantics while the isolated targeted worker avoids a redundant copy.");
check("python.free_agency.no_regular_season_shape_lock", !freeAgency.includes("from progression import apply_final_league_shape_lock") && !freeAgency.includes("pre_simulation_final_shape_lock"), "Regular-season CPU roster repair no longer invokes the offseason progression shape lock.");
check("python.team_roster.max15", /STANDARD_ROSTER_MAX\s*=\s*15/.test(teamRoster), "Season-start roster logic keeps the 15-player simulation maximum.");
check("python.cpu_trade.temp16", /STANDARD_ROSTER_MAX\s*=\s*16/.test(cpuTrade), "CPU trade generation starts from the temporary 16-player ceiling.");
check("python.cpu_trade.max_candidates_120", /MAX_CANDIDATES_PER_DAY\s*=\s*120/.test(cpuTrade), "CPU trade generator can return larger replenishment batches when the bank is starving.");
check("python.cpu_trade.reliability_mode", cpuTrade.includes("reliability_mode") && cpuTrade.includes("inventoryPressure"), "CPU trade generator uses inventory pressure to broaden candidate exploration.");
check("python.cpu_trade.per_generation_memoization", cpuTrade.includes("_reset_generation_cache(league, current_date)") && cpuTrade.includes("_GENERATION_CACHE"), "CPU trade generation memoizes deterministic calculations only within the active payload.");
check(
  "python.cpu_trade.one_more_than_current",
  cpuTrade.includes("seller_allowed_max = max(STANDARD_ROSTER_MAX, seller_roster_count + 1)") &&
    cpuTrade.includes("buyer_allowed_max = max(STANDARD_ROSTER_MAX, buyer_roster_count + 1)"),
  "CPU trade generation permits 16 players or one more than the team's current standard roster."
);
check(
  "python.cpu_trade.no_minimum_block",
  !/STANDARD_ROSTER_MIN\s*<=\s*seller_projected_count/.test(cpuTrade) &&
    !/STANDARD_ROSTER_MIN\s*<=\s*buyer_projected_count/.test(cpuTrade),
  "CPU trade candidate generation allows a team to fall below 14 and relies on pre-simulation repair."
);

const cpuTradeGeneratorSource = read("public/python/cpu_cpu_trade_logic.py");
check(
  "python.cpu_trade.norm_cache",
  cpuTradeGeneratorSource.includes("_NORM_CACHE: Dict[str, str] = {}") &&
    cpuTradeGeneratorSource.includes("cached = _NORM_CACHE.get(text)"),
  "CPU trade generation memoizes exact normalized identifiers instead of recalculating them."
);
check(
  "python.cpu_trade.norm_cache_resets_per_payload",
  cpuTradeGeneratorSource.includes("global _GENERATION_CACHE, _NORM_CACHE") &&
    cpuTradeGeneratorSource.includes("_NORM_CACHE = {}"),
  "Normalized identifier memoization resets for every exact generation payload."
);
check(
  "python.cpu_trade.item_memoization",
  cpuTradeGeneratorSource.includes('"playerItem": {}') &&
    cpuTradeGeneratorSource.includes('"pickItem": {}') &&
    cpuTradeGeneratorSource.includes('cache = _GENERATION_CACHE.get("playerItem")') &&
    cpuTradeGeneratorSource.includes('cache = _GENERATION_CACHE.get("pickItem")'),
  "Exact player and pick item dictionaries are reused within one generation payload."
);
check(
  "python.cpu_trade.player_scalar_memoization",
  cpuTradeGeneratorSource.includes('"playerOvr": {}') &&
    cpuTradeGeneratorSource.includes('"playerPot": {}') &&
    cpuTradeGeneratorSource.includes('"playerAge": {}'),
  "Repeated player overall, potential, and age reads are memoized per payload."
);
check(
  "python.cpu_trade.pick_scalar_memoization",
  cpuTradeGeneratorSource.includes('"pickRound": {}') &&
    cpuTradeGeneratorSource.includes('"pickIdentity": {}'),
  "Repeated pick round and identity calculations are memoized per payload."
);
check(
  "python.cpu_trade.generator_order_and_limits_unchanged",
  cpuTradeGeneratorSource.includes("combo_seen = set()") &&
    cpuTradeGeneratorSource.includes("rng.shuffle(combos)") &&
    cpuTradeGeneratorSource.includes("MAX_CANDIDATES_PER_DAY = 120") &&
    cpuTradeGeneratorSource.includes("MAX_ASSETS_PER_SIDE = 5") &&
    cpuTradeGeneratorSource.includes("MAX_PLAYER_ASSETS_PER_SIDE = 3") &&
    cpuTradeGeneratorSource.includes("MAX_PICK_ASSETS_PER_SIDE = 4"),
  "Candidate combination order, deduplication, and package-size limits remain unchanged."
);


const repairTargetNames = cpuRosterRepairPatch.normalizeCpuRosterRepairTargetNames([
  " Team A ",
  "Team B",
  "Team A",
  "",
  null,
]);
check(
  "roster_repair_patch.target_name_normalization",
  JSON.stringify(repairTargetNames) === JSON.stringify(["Team A", "Team B"]),
  "Targeted roster-repair team names are trimmed, deduplicated, and kept in first-seen order."
);

const repairPatchBase = {
  marker: "preserved",
  conferences: {
    East: [
      { name: "Team A", players: [{ id: "a0" }], untouched: "east-a" },
      { name: "Team C", players: [{ id: "c0" }], untouched: "east-c" },
    ],
    West: [{ name: "Team B", players: [{ id: "b0" }], untouched: "west-b" }],
  },
  freeAgents: [{ id: "old-fa" }],
  freeAgencyState: { currentDay: 40 },
};
const replacementA = { name: "Team A", players: [{ id: "a1" }], untouched: "east-a" };
const replacementB = { name: "Team B", players: [{ id: "b1" }], untouched: "west-b" };
const repairPatchMerged = cpuRosterRepairPatch.applyCpuRosterRepairLeaguePatch(
  repairPatchBase,
  {
    version: 1,
    teamPatches: [
      { conference: "East", teamName: "Team A", team: replacementA },
      { conference: "West", teamName: "Team B", team: replacementB },
    ],
    topLevel: {
      freeAgents: [{ id: "new-fa" }],
      freeAgencyState: { currentDay: 41 },
      minRosterSize: 14,
    },
  }
);
check(
  "roster_repair_patch.changed_teams_merge",
  repairPatchMerged.conferences.East[0] === replacementA &&
    repairPatchMerged.conferences.West[0] === replacementB,
  "Compact roster-repair patches replace exactly the named teams."
);
check(
  "roster_repair_patch.untouched_team_identity",
  repairPatchMerged.conferences.East[1] === repairPatchBase.conferences.East[1],
  "Unrelated team objects remain untouched by a compact roster-repair merge."
);
check(
  "roster_repair_patch.top_level_merge",
  repairPatchMerged.marker === "preserved" &&
    repairPatchMerged.freeAgents[0].id === "new-fa" &&
    repairPatchMerged.freeAgencyState.currentDay === 41 &&
    repairPatchMerged.minRosterSize === 14,
  "Compact roster-repair patches replace only the returned top-level ledgers and preserve unrelated league fields."
);
check(
  "roster_repair_patch.input_immutable",
  repairPatchBase.conferences.East[0].players[0].id === "a0" &&
    repairPatchBase.freeAgents[0].id === "old-fa",
  "Applying a compact roster-repair patch does not mutate the caller's original league object."
);

function makeItems(count, prefix) {
  return Array.from({ length: count }, (_, index) => ({
    type: "player",
    player: { id: `${prefix}_${index}`, name: `${prefix} ${index}`, contractType: "standard" },
  }));
}

function makeTeam(name, standardCount, twoWayCount = 0) {
  return {
    name,
    players: makeItems(standardCount, `${name}_std`).map((item) => item.player),
    twoWayPlayers: makeItems(twoWayCount, `${name}_tw`).map((item) => ({
      ...item.player,
      contractType: "two_way",
      rosterStatus: "two_way",
    })),
  };
}

const regressionCases = [
  { id: "1_for_3_balanced", a: 14, b: 16, aOut: 1, bOut: 3, expectedA: 16, expectedB: 14, expectedOk: true, repairA: true, repairB: false },
  { id: "1_for_3_both_repair", a: 14, b: 15, aOut: 1, bOut: 3, expectedA: 16, expectedB: 13, expectedOk: true, repairA: true, repairB: true },
  { id: "3_for_1_reverse", a: 16, b: 14, aOut: 3, bOut: 1, expectedA: 14, expectedB: 16, expectedOk: true, repairA: false, repairB: true },
  { id: "15_cannot_jump_to_17", a: 15, b: 15, aOut: 1, bOut: 3, expectedA: 17, expectedB: 13, expectedOk: false, repairA: true, repairB: true },
  { id: "16_can_add_one", a: 16, b: 15, aOut: 1, bOut: 2, expectedA: 17, expectedB: 14, expectedOk: true, repairA: true, repairB: false },
  { id: "16_cannot_add_two", a: 16, b: 15, aOut: 1, bOut: 3, expectedA: 18, expectedB: 13, expectedOk: false, repairA: true, repairB: true },
  { id: "17_can_add_one", a: 17, b: 15, aOut: 1, bOut: 2, expectedA: 18, expectedB: 14, expectedOk: true, repairA: true, repairB: false },
];

for (const testCase of regressionCases) {
  const teamA = makeTeam("Team A", testCase.a);
  const teamB = makeTeam("Team B", testCase.b);
  const aItems = makeItems(testCase.aOut, "a_out");
  const bItems = makeItems(testCase.bOut, "b_out");
  const aProjection = evaluateTradeRosterProjection({ team: teamA, outgoingItems: aItems, incomingItems: bItems });
  const bProjection = evaluateTradeRosterProjection({ team: teamB, outgoingItems: bItems, incomingItems: aItems });
  const actualOk = aProjection.ok && bProjection.ok;
  const passed =
    aProjection.counts.projected === testCase.expectedA &&
    bProjection.counts.projected === testCase.expectedB &&
    actualOk === testCase.expectedOk &&
    aProjection.requiresRepairBeforeSimulation === testCase.repairA &&
    bProjection.requiresRepairBeforeSimulation === testCase.repairB;
  check(
    `regression.${testCase.id}`,
    passed,
    `${testCase.id}: ${testCase.a}→${aProjection.counts.projected} (limit ${aProjection.allowedMax}), ${testCase.b}→${bProjection.counts.projected} (limit ${bProjection.allowedMax}), legal=${actualOk}.`,
    JSON.stringify({ testCase, aProjection, bProjection })
  );
}

const fifteenPlusTwoWays = makeTeam("Two Way Test", 15, 3);
check(
  "regression.two_way_excluded",
  evaluateTeamSimulationRoster(fifteenPlusTwoWays).ok,
  "15 standard contracts plus three two-way contracts is simulation-legal."
);
const sixteenStandard = makeTeam("Temporary Trade Test", 16, 0);
check(
  "regression.sixteen_requires_repair",
  !evaluateTeamSimulationRoster(sixteenStandard).ok,
  "A temporary 16-player standard roster must be repaired before simulation."
);

console.table(rows.map(({ id, status, message }) => ({ status, id, message })));
const failures = rows.filter((row) => row.status === "FAIL");
if (failures.length) {
  console.error(`\nBM regression check failed: ${failures.length}/${rows.length} checks failed.`);
  for (const failure of failures) console.error(`- ${failure.id}: ${failure.message}`, failure.details || "");
  process.exit(1);
}

console.log(`\nBM regression check passed: ${rows.length}/${rows.length} checks passed.`);
