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
  css.includes("/* ROSTER_SCROLLBAR_TO_BOTTOM */"),
  "roster.scrollbar_bottom_marker",
  "Scrollbar-bottom override is installed."
);

check(
  css.includes("align-items: stretch !important;"),
  "roster.region_stretches",
  "Roster scroll region stretches through the remaining vertical space."
);

check(
  css.includes("height: 100% !important;") &&
    css.includes("max-height: 100% !important;"),
  "roster.scroller_full_height",
  "Roster scroller reaches the bottom of its available panel."
);

check(
  css.includes("background: transparent !important;"),
  "roster.no_black_fill",
  "The full-height scroller remains transparent rather than a black slab."
);

check(
  css.includes(".tablePanel table") &&
    css.includes("background: rgba(12, 12, 12, 0.96) !important;"),
  "roster.table_stays_dark",
  "Actual roster table stays dark."
);

check(
  css.includes("scrollbar-color: #f97316") &&
    css.includes("height: 12px !important;"),
  "roster.orange_scrollbar_preserved",
  "Orange horizontal scrollbar styling remains."
);

console.table(checks);

const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Roster scrollbar-bottom regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`Roster scrollbar-bottom regression passed: ${checks.length}/${checks.length} checks.`);
