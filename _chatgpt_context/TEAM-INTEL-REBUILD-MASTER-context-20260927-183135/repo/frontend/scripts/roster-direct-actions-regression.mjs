import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const roster = fs.readFileSync(path.join(root, "src/pages/RosterView.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/pages/RosterView.module.css"), "utf8");

const checks = [];
const check = (condition, id, detail) =>
  checks.push({ status: condition ? "PASS" : "FAIL", id, detail });

check(!roster.includes("styles.positionToggle"), "roster.position_button_removed", "Position header button is gone.");
check(!css.includes("border-bottom:1px solid rgba(249,115,22,.14)"), "roster.header_orange_line_removed", "Orange divider under the header is gone.");
check(roster.includes('className="py-1.5 px-3 font-bold">{p.pos}</td>') && roster.includes('className="py-1.5 px-3 font-bold">{p.age}</td>'), "roster.pos_age_bold", "Every row renders POS and AGE bold.");
check(roster.includes("<strong>Age {player?.age ?? \"-\"}</strong>"), "roster.hero_age_bold", "Selected-player age is bold.");
check(!roster.includes("playerActionOpen") && !roster.includes("actionTargetPlayer") && !roster.includes("openPlayerActions"), "roster.player_actions_removed", "Player Actions modal/state/trigger are removed.");
check(!roster.includes("Double click for player actions"), "roster.double_click_removed", "Old double-click Player Actions affordance is removed.");
check(roster.includes("handleAssignStandardToTwoWay(player)") && roster.includes("selectedTwoWayBlockReason"), "roster.two_way_eligibility_preserved", "Assign Two-Way reuses existing eligibility logic and only appears when applicable.");
check(roster.includes("handleUpgradeTwoWayToStandard(player)"), "roster.two_way_upgrade_preserved", "Existing two-way-to-standard action remains available.");
check(roster.includes("handleReleaseTwoWayToFreeAgency(player)") && roster.includes("openReleaseForPlayer(player)"), "roster.release_paths_preserved", "Two-way and standard release paths both remain.");
check(roster.includes("canManageCurrentRoster && !isAllView && !player?.isStash"), "roster.management_guard", "Transaction buttons are guarded to the controlled roster and exclude stash rows.");
check(roster.includes("setReleaseModalOpen(true)") && roster.includes("handleReleaseToFreeAgency"), "roster.standard_release_confirmation", "Standard release still uses the existing confirmation/dead-cap path.");
check(roster.includes("Player Card") && roster.includes("Coach Gameplan"), "roster.primary_actions_preserved", "Player Card and Coach Gameplan remain inline.");
check(css.includes(".twoWayActionButton") && css.includes(".upgradeActionButton") && css.includes(".releasePlayerButton"), "roster.action_styles", "Inline transaction buttons have dedicated compact styles.");
check(roster.includes("getTwoWayAssignmentBlockReason(player, activeRosterTeam)"), "roster.edge_case_guard", "Existing two-way roster-limit/eligibility guard remains the source of truth.");

console.table(checks);

const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Roster direct-actions regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Roster direct-actions regression passed: ${checks.length}/${checks.length} checks.`);
