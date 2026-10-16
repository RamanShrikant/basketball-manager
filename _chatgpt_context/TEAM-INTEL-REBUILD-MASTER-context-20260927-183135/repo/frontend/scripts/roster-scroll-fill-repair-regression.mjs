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
  css.includes("/* ROSTER_SCROLL_FILL_REPAIR */"),
  "roster.repair_marker",
  "Final roster scroll/fill repair block is installed."
);

check(
  !css.includes("/* ROSTER_FULL_HEIGHT_STAGE */") &&
    !css.includes("/* ROSTER_REMOVE_BLACK_FILL */"),
  "roster.conflicting_experiments_removed",
  "Conflicting height/fill experiments were removed."
);

check(
  css.includes("overflow: auto !important;"),
  "roster.internal_scroll_restored",
  "Roster scroller uses internal scrolling again."
);

check(
  css.includes("scrollbar-color: #f97316") &&
    css.includes("linear-gradient(90deg, #ea580c, #fb923c)"),
  "roster.orange_scrollbars_restored",
  "Orange vertical/horizontal roster scrollbars are explicitly restored."
);

check(
  css.includes(".tablePanel {") &&
    css.includes("background: transparent !important;"),
  "roster.black_filler_removed",
  "Unused table-panel fill is transparent."
);

check(
  css.includes(".tablePanel table {") &&
    css.includes("background: rgba(12, 12, 12, 0.96) !important;"),
  "roster.actual_table_dark",
  "Actual roster table keeps the intended dark background."
);

console.table(checks);

const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Roster scroll/fill repair regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`Roster scroll/fill repair regression passed: ${checks.length}/${checks.length} checks.`);
