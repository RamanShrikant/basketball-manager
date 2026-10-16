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

check(css.includes("/* ROSTER_VISUAL_POLISH_V4 */"), "v4.block", "V4 override block installed.");
check(css.includes("background: #dc2626 !important;"), "v4.release_red", "Release Player is solid red.");
check(css.includes("background: #3f3f3f !important;"), "v4.gameplan_grey", "Coach Gameplan is solid grey.");
check(css.includes(".selectedPlayerMeta strong") && css.includes("color: #ffffff !important;"), "v4.meta_white", "Selected-player position/age are white.");
check(css.includes(".rosterScroller") && css.includes("flex: 1 1 auto !important;"), "v4.scroller_fill", "Roster scroller is allowed to expand.");
check(
  roster.includes("handleReleaseTwoWayToFreeAgency(player)") &&
    roster.includes("openReleaseForPlayer(player)") &&
    roster.includes("handleAssignStandardToTwoWay(player)"),
  "v4.logic_preserved",
  "Existing release/two-way handlers remain untouched."
);

console.table(checks);

const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Roster Visual Polish V4 regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`Roster Visual Polish V4 regression passed: ${checks.length}/${checks.length} checks.`);
