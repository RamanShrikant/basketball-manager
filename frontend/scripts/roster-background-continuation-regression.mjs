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
  css.includes("/* ROSTER_BACKGROUND_CONTINUATION */"),
  "roster.background_marker",
  "Background-continuation override is installed."
);

check(
  css.includes('url("../assets/basketball-pattern.svg")'),
  "roster.pattern_background",
  "Unused roster area explicitly uses the Roster View pattern."
);

check(
  css.includes(".tablePanel table") &&
    css.includes("background: rgba(12, 12, 12, 0.96) !important;"),
  "roster.table_surface_preserved",
  "Actual table keeps its dark surface."
);

check(
  css.includes("scrollbar-color: #f97316") &&
    css.includes("linear-gradient(90deg, #ea580c, #fb923c) !important"),
  "roster.orange_scrollbars",
  "Orange roster scrollbars remain explicitly enabled."
);

check(
  css.includes("padding-bottom: 0 !important;"),
  "roster.no_bottom_padding",
  "Desktop roster page no longer reserves extra bottom padding."
);

console.table(checks);

const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Roster background-continuation regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`Roster background-continuation regression passed: ${checks.length}/${checks.length} checks.`);
