import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const css = fs.readFileSync(path.join(root, "src/pages/RosterView.module.css"), "utf8");

const checks = [];
const check = (condition, id, detail) =>
  checks.push({ status: condition ? "PASS" : "FAIL", id, detail });

check(
  css.includes("/* ROSTER_SCROLLBAR_VIEWPORT_BOTTOM */"),
  "roster.final_bottom_marker",
  "Viewport-bottom scrollbar block is installed."
);

check(
  css.includes("height: 100vh !important;") &&
    css.includes("min-height: 100vh !important;"),
  "roster.definite_viewport_height",
  "Roster View has a definite desktop viewport height."
);

check(
  css.includes(".rosterTableRegion") &&
    css.includes("flex: 1 1 auto !important;") &&
    css.includes("align-items: stretch !important;"),
  "roster.region_fills_remaining_height",
  "Table region consumes remaining vertical space."
);

check(
  css.includes("height: 100% !important;") &&
    css.includes("max-height: none !important;"),
  "roster.scroller_reaches_bottom",
  "Scroller stretches to the bottom of the available table region."
);

check(
  css.includes("background: transparent !important;") &&
    css.includes(".tablePanel table") &&
    css.includes("background: rgba(12, 12, 12, 0.96) !important;"),
  "roster.pattern_and_table_surfaces",
  "Unused scroller area is transparent while the actual table remains dark."
);

check(
  css.includes("scrollbar-color: #f97316") &&
    css.includes("height: 12px !important;"),
  "roster.orange_scrollbars",
  "Orange horizontal/vertical scrollbar styling remains."
);

console.table(checks);

const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Roster viewport-bottom regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`Roster viewport-bottom regression passed: ${checks.length}/${checks.length} checks.`);
