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
const teamHub = read("src/pages/TeamHub.jsx");
const teamHubCss = read("src/components/TeamHub.module.css");
const trades = read("src/pages/Trades.jsx");
const contractExtensions = read("src/pages/ContractExtensions.jsx");
const salaryTable = read("src/pages/SalaryTable.jsx");

check("polish.trade_finder_run_token", finder.includes("offerSearchRunIdRef") && finder.includes("isCurrentSearch"), "Trade Finder guards async callbacks/results with a search-generation token.");
check("polish.trade_finder_immediate_stop", finder.includes('invalidateOfferSearch({ markStopped: true, message: "Search stopped." })') && finder.includes("setIsSearchingOffers(false)"), "Stop invalidates the active run and immediately releases the searching UI.");
check("polish.trade_finder_stale_progress_guard", finder.includes("if (!isCurrentSearch()) return;"), "Progress callbacks ignore stale/aborted runs.");
check("polish.trade_finder_clears_old_results", finder.includes("setPythonOffers([]);") && finder.indexOf("setPythonOffers([]);") < finder.indexOf('setOfferSearchProgress("Starting Trade Finder search...")'), "A new search clears stale offer cards before worker results arrive.");
check("polish.worker_abort_settles_promise", engine.includes("terminating a Web Worker does not settle the Promise") && engine.includes("finish(partial)"), "Worker abort resolves the chunk promise instead of stranding Promise.all after terminate().");
check("polish.worker_partial_offer_transport", worker.includes('offer: offer || null') && engine.includes("if (message.offer) partial.offers.push(message.offer)"), "Completed worker-team offers are retained as safe partial results during cancellation.");
check("polish.worker_abort_no_serial_restart", engine.includes("if (isCancelled(signal))") && engine.includes("usedWorkerPool = true"), "A deliberate abort cannot accidentally restart the expensive search in serial fallback mode.");
check("polish.trade_finder_no_cpu_lean_copy", !evaluatorCache.includes("CPU-Lean Offer"), "Trade Finder no longer exposes the CPU-Lean label.");
check("polish.trade_finder_no_visible_quality_or_value", !finder.includes('offer.quality === "Comfort Offer" ? "Comfort Offer" : "Accepted Offer"') && !finder.includes('• Value ${Number(offer.offerValue') && !finder.includes('Value {selectedValue.toFixed(1)}'), "Trade Finder offer cards and package header hide internal offer-quality/value numbers.");
check("polish.trade_finder_no_visible_gap_or_comfort", !finder.includes("Finder gap") && !finder.includes("CPU comfort") && !finder.includes("comfort margin ${Number(offer.comfortMargin"), "Trade Finder hides internal gap/comfort diagnostics from players.");
check("polish.trade_finder_neutral_search_copy", finder.includes("One legal offer max per CPU team") && finder.includes("CPU teams are building one legal offer each") && finder.includes("No CPU team found a legal offer for this package."), "Trade Finder search/status copy uses neutral player-facing language.");
check("polish.roster_position_toggle", rosterView.includes("togglePositionGrouping") && rosterView.includes("Group roster by position") && rosterView.includes("Position"), "Roster View exposes a minimal position-grouping toggle in the roster status strip.");
check("polish.roster_position_order", rosterView.includes('const positionOrder = ["PG", "SG", "SF", "PF", "C"]') && rosterView.includes('key: "pos", direction: "asc"'), "Position grouping follows PG -> SG -> SF -> PF -> C.");
check("polish.roster_position_ovr_tiebreak", rosterView.includes("const overallDiff = Number(b.overall || 0) - Number(a.overall || 0)"), "Players within each position are ordered by OVR descending.");
check("polish.trade_finder_live_record_source", finder.includes('import { buildRecordMap } from "../utils/teamIntel_v1.js"') && finder.includes("buildTradeFinderStandingMap"), "Trade Finder derives live records from the same stored schedule/result layer used by Team Intel.");
check("polish.trade_finder_team_record_standing", finder.includes("tradeFinderStandingLabel(standingByTeam.get") && finder.includes("ordinalStanding"), "Trade Finder team headers and offer cards show a subtle W-L plus conference standing line.");
check("polish.trade_finder_external_pick_context", finder.includes("tradeFinderPickStandingLabel") && finder.includes('if (!originName || sameTeamName(originName, ownerName)) return "";'), "Picks from another franchise show that original team's record/standing without duplicating context for own picks.");
check("polish.trade_finder_pick_context_both_lanes", finder.includes("standingByTeam={standingByTeam}") && finder.includes("function OfferAssetLine({ item, team, leagueData, standingByTeam"), "External-pick standing context is available in both package rows and CPU offer rows.");
check("polish.team_hub_bottom_scrollbar", teamHub.includes('type="range"') && teamHub.includes('className={styles.bottomScrollbar}') && teamHubCss.includes(".bottomScrollbar::-webkit-slider-thumb"), "Team Hub has an always-visible orange bottom scrollbar independent of OS scrollbar auto-hide.");
check("polish.team_hub_scrollbar_sync", teamHub.includes("scrollbarState") && teamHub.includes("handleScrollbarChange") && teamHub.includes("row.scrollWidth - row.clientWidth"), "Team Hub scrollbar mirrors and controls the real horizontal carousel position.");
check("polish.team_hub_scrollbar_wheel", teamHub.includes("handleCarouselWheel") && teamHub.includes("onWheel={handleCarouselWheel}") && teamHub.includes("row.scrollLeft + horizontalDelta"), "Team Hub carousel and orange rail accept mouse-wheel/touchpad horizontal movement without removing arrow navigation.");
check("polish.team_hub_arrow_navigation_preserved", teamHub.includes("onClick={() => moveTileFocus(-1)}") && teamHub.includes("onClick={() => moveTileFocus(1)}"), "Team Hub left/right arrow buttons remain functional alongside manual scrolling.");
check("polish.trade_desk_clean_empty_state", trades.includes("No live activity right now") && !trades.includes('label: "Market Watch"') && !trades.includes('tag: "Waiting"') && !trades.includes('tag: "Feed"'), "Trade Desk removes Market Watch/Waiting/Feed placeholder chrome and uses one clean empty state.");
check("polish.trade_desk_no_transaction_wire_ui", trades.includes('item.label === "Transaction Wire" ? "Completed Deal" : item.label') && !trades.includes('<div className="rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-neutral-400">\n                            {item.tag}'), "Trade Desk maps Transaction Wire to Completed Deal and removes the tag pill from live cards.");
check("polish.trade_page_mockup_layout", trades.includes("Team Context") && trades.includes("League Rumor Board") && trades.includes("Find matches and trade ideas around the league."), "Trade page uses the compact two-panel GM dashboard layout from the approved mockup direction.");
check("polish.trade_page_contract_alerts", trades.includes("is expiring after this season.") && trades.includes("is extension eligible soon."), "Team Context keeps contract alerts short and literal: expiring and extension-eligible players only.");
check("polish.trade_page_position_depth_target", trades.includes("POSITION_TARGETS") && trades.includes("{row.count}/{row.target}") && trades.includes("target: 2"), "Team Context shows a simple 2-player target for PG, SG, SF, PF and C.");
check("polish.trade_page_position_primary_only", trades.includes("primaryPositionOf") && trades.includes("raw.split(/[\\/|,]/)[0]"), "Position depth counts only each standard-roster player's primary listed position.");
check("polish.trade_page_position_shortage_colors", trades.includes('row.count === 0') && trades.includes('text-red-300') && trades.includes('row.count === 1') && trades.includes('text-orange-300'), "Position depth renders 0/2 in red and 1/2 in orange while 2/2+ stays neutral.");
check("polish.trade_page_no_duplicate_builder", !trades.includes("Open Trade Builder"), "Trade page removes the duplicate Open Trade Builder action from the rumor-board side.");
check("polish.trade_page_pick_depth", trades.includes("buildPickDepth") && trades.includes("Pick Depth") && trades.includes("Unprotected 1sts") && trades.includes("Protected 1sts") && trades.includes("Unprotected 2nds") && trades.includes("Protected 2nds") && trades.includes("Swap Rights"), "Team Context adds a compact Pick Depth row with firsts, seconds, and swap-right counts.");
check("polish.trade_page_no_duplicate_front_office_button", !trades.includes('navigate("/front-office")'), "Trade page does not add a duplicate Front Office back button because the shell already provides one.");
check("polish.trade_page_pick_labels_fit", trades.includes('whitespace-nowrap text-[8px]') && trades.includes('tracking-[0.055em]'), "Pick Depth labels are deliberately compact enough to render fully without ellipsis truncation.");
check("polish.trade_page_compact_context_spacing", trades.includes('px-4 py-2.5 text-sm font-bold') && trades.includes('my-4 h-px') && trades.includes('className="mt-4"'), "Trade Team Context uses tightened alert and section spacing.");
check("polish.trade_page_preseason_header", trades.includes('Preseason • ${standing.conference}') && trades.includes('${record} • ${standing.conference} • ${rank}'), "Trade header shows Preseason before games and separates record, conference, and ordinal standing once games exist.");
check("polish.trade_page_live_record_header", trades.includes("buildTradePageStandingMap") && trades.includes("selectedStandingLabel") && trades.includes("ordinalStanding"), "Trade page header shows the selected team's live W-L record and conference standing when available.");
check("polish.contract_extensions_orange_scrollbar", contractExtensions.includes("contract-extension-orange-scrollbar") && contractExtensions.includes("scrollbar-color: #f97316 #171717") && contractExtensions.includes("linear-gradient(180deg, #fb923c, #ea580c)"), "Contract Extensions player list uses the same polished orange scrollbar language.");
check("polish.contract_extensions_player_portrait", contractExtensions.includes('layoutPage="contract-extensions"') && contractExtensions.includes("RuntimePlayerPortrait") && contractExtensions.includes("extensionSourcePlayer"), "Contract Extension list pills render the live player portrait inside each pill.");
check("polish.contract_extensions_rating_ring", contractExtensions.includes("PlayerRatingRing") && contractExtensions.includes("overall={row.overall}") && contractExtensions.includes("potential={row.potential}"), "Contract Extension list pills show an OVR/POT rating ring instead of text metadata.");
check("polish.contract_extensions_no_age_position_meta", !contractExtensions.includes('{row.position || "—"} · Age {row.age} · {row.overall} OVR · {row.potential} POT'), "Contract Extension pills remove the old position/age/OVR/POT text line.");
check("polish.contract_extensions_manual_responsive_tuning", contractExtensions.includes("CONTRACT_EXTENSION_PLAYER_PILL_TUNING") && contractExtensions.includes("laptopMaxWidth: 1440") && contractExtensions.includes("playerPillTuning.headshot.x") && contractExtensions.includes("playerPillTuning.ring.x"), "Contract Extension portrait/ring sizing and x/y offsets have explicit desktop + laptop manual tuning controls.");
check("polish.salary_table_rating_ring", salaryTable.includes("PlayerRatingRing") && salaryTable.includes('layoutPage="salary-table"') && salaryTable.includes("renderSalaryPlayerIdentity"), "Salary Table player cells combine portrait, OVR/POT ring, and name in one compact identity cell.");
check("polish.salary_table_no_ovr_column", !salaryTable.includes('<th className="text-center px-3 py-2">OVR</th>') && !salaryTable.includes('<td className="text-center px-3 py-3 font-semibold text-orange-300">{p.overall}</td>'), "Salary Table removes the standalone OVR column because OVR/POT now lives in the rating ring.");
check("polish.salary_table_no_headshot_circle", !salaryTable.includes('rounded-full border bg-white/5') && salaryTable.includes('className="h-full w-full"'), "Salary Table removes the circular border shell around player headshots.");
check("polish.salary_table_manual_responsive_tuning", salaryTable.includes("SALARY_TABLE_PLAYER_VISUAL_TUNING") && salaryTable.includes("laptopMaxWidth: 1440") && salaryTable.includes("salaryPlayerTuning.headshot.x") && salaryTable.includes("salaryPlayerTuning.ring.x") && salaryTable.includes("min-w-[920px]"), "Salary Table has explicit desktop/laptop portrait and rating-ring tuning while retaining compact horizontal-scroll fallback.");

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
