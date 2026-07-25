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

const freeAgency = read("public/python/free_agency_logic.py");
const teamRoster = read("public/python/team_roster_logic.py");
const cpuTrade = read("public/python/cpu_cpu_trade_logic.py");
check("python.free_agency.max15", /REGULAR_SEASON_MAX_ROSTER\s*=\s*15/.test(freeAgency), "CPU roster repair restores teams to the 15-player simulation maximum.");
check("python.team_roster.max15", /STANDARD_ROSTER_MAX\s*=\s*15/.test(teamRoster), "Season-start roster logic keeps the 15-player simulation maximum.");
check("python.cpu_trade.temp16", /STANDARD_ROSTER_MAX\s*=\s*16/.test(cpuTrade), "CPU trade generation starts from the temporary 16-player ceiling.");
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
