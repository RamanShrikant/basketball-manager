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
  css.includes("/* ROSTER_FULL_HEIGHT_STAGE */"),
  "roster.full_height_marker",
  "Full-height stage override is installed."
);

check(
  css.includes("height: 100vh !important;") &&
    css.includes("min-height: 100vh !important;"),
  "roster.viewport_height",
  "Desktop roster viewport shell fills the browser viewport."
);

check(
  css.includes(".tablePanel,") &&
    css.includes(".rosterScroller") &&
    css.includes("flex: 1 1 auto !important;"),
  "roster.table_flex_fill",
  "Roster table/scroller can consume remaining vertical space."
);

console.table(checks);

const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Roster full-height regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`Roster full-height regression passed: ${checks.length}/${checks.length} checks.`);
