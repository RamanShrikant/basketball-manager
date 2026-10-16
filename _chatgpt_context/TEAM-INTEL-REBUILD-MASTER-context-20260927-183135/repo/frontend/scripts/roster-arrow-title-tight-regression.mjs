import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const css = fs.readFileSync(path.join(root, "src/pages/RosterView.module.css"), "utf8");

const checks = [];
const check = (condition, id, detail) => checks.push({ status: condition ? "PASS" : "FAIL", id, detail });

check(css.includes("/* ROSTER_ARROW_TITLE_TIGHT */"), "roster.arrow_marker", "Arrow-title alignment override is installed.");
check(css.includes("grid-template-columns: 32px max-content minmax(0, 1fr) !important;"), "roster.header_grid", "Header gives the title cluster only the width it needs.");
check(css.includes("width: max-content !important;"), "roster.title_cluster_width", "Title cluster hugs its contents.");
check(css.includes("justify-self: start !important;"), "roster.arrow_stays_with_title", "Title/arrow cluster stays anchored immediately after the left arrow.");
check(css.includes("justify-self: end !important;"), "roster.counts_stay_right", "Roster contract counters remain right-aligned.");

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Roster arrow-title tight regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Roster arrow-title tight regression passed: ${checks.length}/${checks.length} checks.`);
