import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const css = fs.readFileSync(path.join(root, "src/components/PageFade.css"), "utf8");

const checks = [];
const check = (condition, id, detail) =>
  checks.push({ status: condition ? "PASS" : "FAIL", id, detail });

check(
  css.includes("/* ROSTER_COACH_ROOT_FALLBACK_FIX */"),
  "fallback.marker",
  "Root-fallback route fix is installed."
);

check(
  css.includes('body[data-bm-route="coach-gameplan"] #root'),
  "fallback.coach_root",
  "Coach Gameplan root fallback is explicitly painted."
);

check(
  css.includes('body[data-bm-route="roster-view"] #root'),
  "fallback.roster_root",
  "Roster View root fallback is explicitly painted."
);

check(
  css.includes("min-height: 100dvh !important;"),
  "fallback.full_viewport",
  "Route root fallback covers the full dynamic viewport."
);

check(
  css.includes('url("../assets/basketball-pattern.svg")'),
  "fallback.pattern",
  "Fallback uses the BM court pattern."
);

check(
  css.includes('body[data-bm-route="coach-gameplan"] .bm-page-fade') &&
  css.includes("background-color: transparent !important;"),
  "fallback.pagefade_transparent",
  "PageFade no longer paints a conflicting flat canvas on these routes."
);

console.table(checks);

const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Roster + Coach root-fallback regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`Roster + Coach root-fallback regression passed: ${checks.length}/${checks.length} checks.`);
