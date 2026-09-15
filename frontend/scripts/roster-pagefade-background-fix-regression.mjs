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
  css.includes("/* ROSTER_PAGEFADE_BACKGROUND_FIX */"),
  "roster.pagefade_marker",
  "Route-specific PageFade background fix is installed."
);

check(
  css.includes(":global(body.rv-roster-bg .bm-page-fade)"),
  "roster.pagefade_target",
  "Roster route explicitly targets the global PageFade wrapper."
);

check(
  css.includes('url("../assets/basketball-pattern.svg")'),
  "roster.pagefade_pattern",
  "PageFade receives the same roster basketball pattern."
);

check(
  css.includes("scrollbar-color: #f97316"),
  "roster.scrollbars_preserved",
  "Existing orange roster scrollbar styling remains present."
);

console.table(checks);

const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Roster PageFade background regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`Roster PageFade background regression passed: ${checks.length}/${checks.length} checks.`);
