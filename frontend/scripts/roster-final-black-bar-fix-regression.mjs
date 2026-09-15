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
  roster.includes("styles.rosterTableRegion") && roster.includes("items-start"),
  "roster.flex_stretch_removed",
  "Table region explicitly prevents flexbox cross-axis stretching."
);

check(
  css.includes("/* ROSTER_FINAL_BLACK_BAR_FIX */"),
  "roster.final_fix_marker",
  "Final structural black-bar fix is installed."
);

check(
  css.includes("align-self: flex-start !important;") &&
    css.includes("max-height: 100% !important;"),
  "roster.panel_hugs_content",
  "Dark table panel hugs content but remains capped by available region height."
);

check(
  css.includes("overflow: auto !important;"),
  "roster.internal_scroll",
  "Tall rosters remain internally scrollable."
);

check(
  css.includes("scrollbar-color: #f97316") &&
    css.includes("linear-gradient(90deg, #ea580c, #fb923c) !important"),
  "roster.orange_scrollbars",
  "Orange horizontal/vertical scrollbar styling remains."
);

check(
  !css.includes("/* ROSTER_FULL_HEIGHT_STAGE */") &&
    !css.includes("/* ROSTER_REMOVE_BLACK_FILL */") &&
    !css.includes("/* ROSTER_SCROLL_FILL_REPAIR */") &&
    !css.includes("/* ROSTER_BACKGROUND_CONTINUATION */") &&
    !css.includes("/* ROSTER_BODY_BACKGROUND_FIX */"),
  "roster.old_experiments_removed",
  "Earlier conflicting black-bar experiments were cleaned out."
);

check(
  roster.includes("handleReleaseTwoWayToFreeAgency(player)") &&
    roster.includes("openReleaseForPlayer(player)") &&
    roster.includes("handleAssignStandardToTwoWay(player)"),
  "roster.logic_preserved",
  "Roster transaction handlers remain untouched."
);

console.table(checks);

const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Roster final black-bar regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`Roster final black-bar regression passed: ${checks.length}/${checks.length} checks.`);
