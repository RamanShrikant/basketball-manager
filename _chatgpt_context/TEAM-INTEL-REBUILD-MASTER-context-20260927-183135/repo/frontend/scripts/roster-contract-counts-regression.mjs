import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const roster = fs.readFileSync(path.join(root, "src/pages/RosterView.jsx"), "utf8");

const checks = [];
const check = (condition, id, detail) =>
  checks.push({ status: condition ? "PASS" : "FAIL", id, detail });

check(roster.includes("Standard contracts") && roster.includes("{standardRosterCount}/{regularSeasonStandardRosterLimit}"), "roster.standard_count", "Standard contract count still uses existing live values.");
check(roster.includes("Two-way contracts") && roster.includes("{twoWayRosterCount}/3"), "roster.two_way_count", "Two-way contract count still uses existing live values.");
check(roster.includes("Stashes") && roster.includes("{stashRosterCount}"), "roster.stash_count", "Stash count still uses existing live values.");
check(roster.includes("bg-neutral-950/90") && roster.includes("text-orange-500"), "roster.compact_status_style", "Compact dark/orange status panel is present.");
check(roster.includes("onClick={togglePositionGrouping}"), "roster.position_control_preserved", "Existing Position control remains.");
check(!roster.includes("You can carry extra players for now, but before simulating"), "roster.long_warning_removed", "Old full-width explanatory warning is removed.");

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");

if (failed.length) {
  console.error(`Roster contract-count regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`Roster contract-count regression passed: ${checks.length}/${checks.length} checks.`);
