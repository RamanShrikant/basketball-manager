import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const finderPath = path.join(root, "src/pages/TradeFinder.jsx");
const enginePath = path.join(root, "src/utils/tradeFinderOfferEngine.js");
const finder = fs.readFileSync(finderPath, "utf8");
const engine = fs.readFileSync(enginePath, "utf8");

const checks = [];
const check = (name, ok, details = "") => checks.push({ name, ok: Boolean(ok), details });

check(
  "exact helper exists",
  finder.includes("function evaluateTradeFinderOfferWithBuilderExact") &&
    finder.includes("evaluateTradeTeamImpact({") &&
    finder.includes("buildOffseasonTradeEvaluationLeague(leagueData)")
);

check(
  "exact helper mirrors Submit Proposal role",
  /function evaluateTradeFinderOfferWithBuilderExact[\s\S]*?evaluateTradeTeamImpact\(\{[\s\S]*?userItems: selectedItems,[\s\S]*?cpuItems: offerItems,[\s\S]*?\}\);/.test(finder)
);

check(
  "pre-display validation has mandatory exact CPU gate",
  finder.includes("const exactAcceptance = evaluateTradeFinderOfferWithBuilderExact({") &&
    finder.includes('"cpu_exact_rejected"') &&
    finder.includes("if (!exactAcceptance.accepted)")
);

check(
  "successful validation records exact acceptance",
  finder.includes("exactCpuAcceptance: exactAcceptance.summary")
);

check(
  "generated offers are filtered through detailed validation before display",
  finder.includes("const loadValidation = validateTradeFinderOfferDetailed({") &&
    finder.includes("const loadableOffers = nextOffers.filter(") &&
    finder.includes("loadValidation?.ok === true")
);

check(
  "Load Offer revalidates exact acceptance fresh",
  /const loadOffer = \(offer\) => \{[\s\S]*?validateTradeFinderOfferDetailed\(\{[\s\S]*?if \(!validation\.ok\)/.test(finder)
);

check(
  "debug comparison now reuses exact builder helper",
  /function debugTradeFinderLoadOffer[\s\S]*?evaluateTradeFinderOfferWithBuilderExact\(\{/.test(finder)
);

const pickOnlyMatch = engine.match(/function findBestPickOnlyOfferForTeam\([\s\S]*?\n\}/);
const pickOnly = pickOnlyMatch?.[0] || "";
check(
  "pick-only search performs builder-exact confirmation",
  pickOnly.includes("mode: BUILDER_EXACT_MODE") &&
    pickOnly.includes("exactConfirmAttempts += 1")
);

check(
  "pick-only fast scan is candidate-only",
  pickOnly.includes("const candidate = evaluateCore(") &&
    pickOnly.includes("if (!candidate)") &&
    pickOnly.indexOf("mode: BUILDER_EXACT_MODE") < pickOnly.indexOf("isBetterFinalOffer(result")
);

check(
  "pick-only final engine label reflects exact confirmation",
  pickOnly.includes('engine: "v12_pick_only_builder_exact_confirm"')
);

check(
  "old pick-only direct fast-scan final assignment removed",
  !pickOnly.includes("const result = evaluateCore({ context, cpuTeam, items")
);

check(
  "diagnostics mention CPU acceptance filtering",
  finder.includes("CPU-acceptance validation")
);

console.table(checks.map((row) => ({
  status: row.ok ? "PASS" : "FAIL",
  check: row.name,
  details: row.details,
})));

const failed = checks.filter((row) => !row.ok);
if (failed.length) {
  console.error(`Trade Finder exact-parity regression: ${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(1);
}
console.log(`Trade Finder exact-parity regression: ${checks.length}/${checks.length} PASS`);
