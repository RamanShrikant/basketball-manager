import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const results = [];
const check = (id, condition, message) => results.push({ status: condition ? "PASS" : "FAIL", id, message });

const finder = read("src/pages/TradeFinder.jsx");
const engine = read("src/utils/tradeFinderOfferEngine.js");
const worker = read("src/workers/tradeFinderTeamWorker.js");
const awards = read("src/pages/Awards.jsx");
const allNba = read("src/pages/AllNbaTeams.jsx");
const headshot = read("src/config/headshotLayout.js");
const playerCard = read("src/components/PlayerCardModal.jsx");
const retirements = read("src/pages/PlayerRetirements.jsx");
const evaluatorCache = read("src/utils/tradeFinderEvaluatorCache.js");
const rosterView = read("src/pages/RosterView.jsx");

check("polish.trade_finder_run_token", finder.includes("offerSearchRunIdRef") && finder.includes("isCurrentSearch"), "Trade Finder guards async callbacks/results with a search-generation token.");
check("polish.trade_finder_immediate_stop", finder.includes('invalidateOfferSearch({ markStopped: true, message: "Search stopped." })') && finder.includes("setIsSearchingOffers(false)"), "Stop invalidates the active run and immediately releases the searching UI.");
check("polish.trade_finder_stale_progress_guard", finder.includes("if (!isCurrentSearch()) return;"), "Progress callbacks ignore stale/aborted runs.");
check("polish.trade_finder_clears_old_results", finder.includes("setPythonOffers([]);") && finder.indexOf("setPythonOffers([]);") < finder.indexOf('setOfferSearchProgress("Starting Trade Finder search...")'), "A new search clears stale offer cards before worker results arrive.");
check("polish.worker_abort_settles_promise", engine.includes("terminating a Web Worker does not settle the Promise") && engine.includes("finish(partial)"), "Worker abort resolves the chunk promise instead of stranding Promise.all after terminate().");
check("polish.worker_partial_offer_transport", worker.includes('offer: offer || null') && engine.includes("if (message.offer) partial.offers.push(message.offer)"), "Completed worker-team offers are retained as safe partial results during cancellation.");
check("polish.worker_abort_no_serial_restart", engine.includes("if (isCancelled(signal))") && engine.includes("usedWorkerPool = true"), "A deliberate abort cannot accidentally restart the expensive search in serial fallback mode.");
check("polish.trade_finder_no_cpu_lean_copy", !evaluatorCache.includes("CPU-Lean Offer") && evaluatorCache.includes('"Accepted Offer"') && finder.includes('offer.quality === "Comfort Offer" ? "Comfort Offer" : "Accepted Offer"'), "Trade Finder keeps internal CPU valuation private and uses neutral offer copy.");
check("polish.roster_position_toggle", rosterView.includes("togglePositionGrouping") && rosterView.includes("Group roster by position") && rosterView.includes("Position"), "Roster View exposes a minimal position-grouping toggle in the roster status strip.");
check("polish.roster_position_order", rosterView.includes('const positionOrder = ["PG", "SG", "SF", "PF", "C"]') && rosterView.includes('key: "pos", direction: "asc"'), "Position grouping follows PG -> SG -> SF -> PF -> C.");
check("polish.roster_position_ovr_tiebreak", rosterView.includes("const overallDiff = Number(b.overall || 0) - Number(a.overall || 0)"), "Players within each position are ordered by OVR descending.");

check("polish.individual_awards_runtime_portrait", awards.includes("PlayerPortraitFrame") && awards.includes('layoutPage="individual-awards"'), "Individual award winners route through the dynamic dressed-portrait renderer.");
check("polish.individual_awards_full_player_identity", awards.includes("portraitFamilyId") || awards.includes("Preserve the full player identity"), "Award portrait lookup preserves generated-rookie identity metadata instead of flattening to a URL.");
check("polish.all_nba_tuning", allNba.includes('"all-nba"') && allNba.includes("layoutPage={portraitLayoutPage}"), "All-NBA uses its own explicit headshot tuning lane.");
check("polish.all_rookie_tuning", allNba.includes('"all-rookie"'), "All-Rookie uses its own explicit headshot tuning lane.");
check("polish.all_defensive_tuning", allNba.includes('"all-defensive"'), "All-Defensive uses its own explicit headshot tuning lane.");
for (const key of ["individual-awards", "all-nba", "all-rookie", "all-defensive"]) {
  check(`polish.headshot_config_${key}`, headshot.includes(`"${key}"`), `${key} is manually configurable in headshotLayout.js.`);
}

const jerseyManifest = JSON.parse(read("public/assets/jerseys/v1/jerseys_manifest.json"));
const rookieManifest = JSON.parse(read("public/assets/rookie_faces/rookie_faces_manifest.json"));
const fits = JSON.parse(read("public/assets/portrait_studio/fits/portrait_fits.json"));
const templateIds = jerseyManifest.map((row) => row.templateId || row.id).filter(Boolean);
const missing = rookieManifest.flatMap((face) => templateIds.filter((template) => !fits?.fitByFace?.[face.id]?.jerseys?.[template]).map((template) => `${face.id}:${template}`));
check("polish.generated_rookie_fit_coverage", missing.length === 0, `All 44 generated rookie identities have explicit fits for all 30 jerseys (missing ${missing.length}).`);
check("polish.generated_rookie_fit_matrix", rookieManifest.length * templateIds.length === 1320, `Expected 1,320 generated-rookie/team fit combinations (found ${rookieManifest.length * templateIds.length}).`);

check("polish.player_card_league_history", playerCard.includes("getMergedLeagueHistory") && playerCard.includes("collectPersistentLeagueHistoryAccolades"), "Player Card recovers durable awards/championship context from league history.");
check("polish.player_card_championship_recovery", playerCard.includes('type: "champion"') && playerCard.includes('label: "NBA Champion"'), "Player Card reconstructs championship rings from season-team history plus champion history.");
check("polish.player_card_finals_mvp_recovery", playerCard.includes('type: "finals_mvp"') && playerCard.includes('label: "Finals MVP"'), "Player Card can recover historical Finals MVP from champion records.");
check("polish.retirement_history_merge", retirements.includes("mergePlayerHistory") && retirements.includes("mergeHistoryRows"), "Retirement card hydration merges compact and full career history instead of selecting only one stale copy.");
check("polish.retirement_accolade_merge", retirements.includes("accolades: mergeHistoryRows"), "Retirement hydration preserves accolades from both current retirement result and durable player history.");

const failed = results.filter((row) => row.status === "FAIL");
console.table(results);
if (failed.length) {
  console.error(`\nRuntime polish regression FAILED: ${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(1);
}
console.log(`\nRuntime polish regression passed: ${results.length}/${results.length} checks.`);
