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
includes("src/pages/Calendar.jsx", "recordPreSimulationDiagnostics", "Calendar records pre-simulation diagnostics.");
includes("src/pages/Calendar.jsx", "recordCpuTradeRepairDiagnostics", "Calendar records post-trade CPU repair diagnostics.");
includes("src/pages/Calendar.jsx", "getCpuTradeSimulationDateDecision", "Calendar gates CPU trade work by pending simulation date and deadline status.");
includes("src/pages/Calendar.jsx", "recordSimulationPerformanceDiagnostics", "Calendar records simulation and CPU-trade timing diagnostics.");
includes("src/pages/Calendar.jsx", "runForegroundCpuTradeBankGeneration", "Calendar has foreground CPU-trade bank replenishment for empty/behind target seasons.");
includes("src/pages/Calendar.jsx", "syncTradeDeskFeedWithLeagueHistory(nextLeagueData)", "Calendar canonicalizes Trade Desk transactions against official trade history.");
includes("src/pages/Calendar.jsx", "simLockRef.current", "Calendar uses a synchronous simulation run lock to block duplicate SimToDate/full-season runs.");
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

const freeAgency = read("public/python/free_agency_logic.py");
const teamRoster = read("public/python/team_roster_logic.py");
const cpuTrade = read("public/python/cpu_cpu_trade_logic.py");
const cpuTradeBank = read("src/utils/cpuTradeBank.js");
const tradeDeskFeed = read("src/utils/tradeDeskFeed.js");
check("cpu_trade_bank.version7", cpuTradeBank.includes("CPU_TRADE_BANK_VERSION = 7"), "CPU trade bank schema resets stale v7 inventory after the deadline target-catchup hotfix.");
check("cpu_trade_bank.fuller_runway", cpuTradeBank.includes("daysToDeadline <= 7 && bankSize < remainingTarget") && cpuTradeBank.includes("remainingTarget + 12"), "CPU trade bank keeps a fuller late-season runway so target slots do not starve at the deadline.");
check("cpu_trade_bank.runway_status", cpuTradeBank.includes("getCpuTradeBankRunwayStatus") && cpuTradeBank.includes("foregroundRecommended"), "CPU trade bank exposes runway/foreground inventory pressure signals.");
check("calendar.cpu_trade_burst_execution", read("src/pages/Calendar.jsx").includes("getCpuTradeExecutionBurstLimit") && read("src/pages/Calendar.jsx").includes("cpuTradeBurstDepth"), "Calendar can consume multiple due CPU trade slots on one date when the bank is behind pace.");
check("trade_desk.sync_history", tradeDeskFeed.includes("syncTradeDeskFeedWithLeagueHistory") && tradeDeskFeed.includes("mergeTradeDeskFeedWithLeague"), "Trade Desk feed can purge non-canonical transaction rows.");
check("python.free_agency.max15", /REGULAR_SEASON_MAX_ROSTER\s*=\s*15/.test(freeAgency), "CPU roster repair restores teams to the 15-player simulation maximum.");
check("python.free_agency.rating_freeze_snapshot", freeAgency.includes("REGULAR_SEASON_RATING_FREEZE_FIELDS") && freeAgency.includes("build_regular_season_rating_freeze_snapshot"), "Regular-season CPU roster repair snapshots existing player ratings before cleanup.");
check("python.free_agency.rating_freeze_restore", freeAgency.includes("restore_regular_season_rating_freeze_snapshot") && freeAgency.includes("ratingFreezeAudit"), "Regular-season CPU roster repair restores any rating drift before saving.");
check("python.free_agency.no_regular_season_shape_lock", !freeAgency.includes("from progression import apply_final_league_shape_lock") && !freeAgency.includes("pre_simulation_final_shape_lock"), "Regular-season CPU roster repair no longer invokes the offseason progression shape lock.");
check("python.team_roster.max15", /STANDARD_ROSTER_MAX\s*=\s*15/.test(teamRoster), "Season-start roster logic keeps the 15-player simulation maximum.");
check("python.cpu_trade.temp16", /STANDARD_ROSTER_MAX\s*=\s*16/.test(cpuTrade), "CPU trade generation starts from the temporary 16-player ceiling.");
check("python.cpu_trade.max_candidates_120", /MAX_CANDIDATES_PER_DAY\s*=\s*120/.test(cpuTrade), "CPU trade generator can return larger replenishment batches when the bank is starving.");
check("python.cpu_trade.reliability_mode", cpuTrade.includes("reliability_mode") && cpuTrade.includes("inventoryPressure"), "CPU trade generator uses inventory pressure to broaden candidate exploration.");
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
