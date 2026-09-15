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

check(
  css.includes("/* ROSTER_REMOVE_BLACK_FILL */"),
  "roster.cleanup_marker",
  "Black-fill cleanup override is installed."
);

check(
  css.includes("flex: 0 0 auto !important;") &&
    css.includes("height: auto !important;"),
  "roster.no_forced_table_fill",
  "Roster table/scroller no longer fills unused vertical space."
);

check(
  !roster.includes("bmTableScroller h-full w-full max-w-7xl"),
  "roster.h_full_removed",
  "Forced h-full class is removed from the roster scroller."
);

check(
  roster.includes("handleReleaseTwoWayToFreeAgency(player)") &&
    roster.includes("openReleaseForPlayer(player)") &&
    roster.includes("handleAssignStandardToTwoWay(player)"),
  "roster.logic_preserved",
  "Existing roster transaction logic remains untouched."
);

console.table(checks);

const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Roster black-fill cleanup regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`Roster black-fill cleanup regression passed: ${checks.length}/${checks.length} checks.`);
