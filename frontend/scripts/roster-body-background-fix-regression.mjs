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
  css.includes("/* ROSTER_BODY_BACKGROUND_FIX */"),
  "roster.body_fix_marker",
  "Route-level background fix is installed."
);

check(
  css.includes(":global(body.rv-roster-bg)") &&
    css.includes(":global(body.rv-roster-bg #root)"),
  "roster.body_and_root_targeted",
  "Roster route body and root both receive the page background."
);

check(
  css.includes('url("../assets/basketball-pattern.svg")'),
  "roster.body_uses_pattern",
  "Roster route fallback background uses the same basketball pattern."
);

check(
  css.includes("scrollbar-color: #f97316"),
  "roster.scrollbar_preserved",
  "Existing orange roster scrollbar styling remains present."
);

console.table(checks);

const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Roster body-background regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`Roster body-background regression passed: ${checks.length}/${checks.length} checks.`);
