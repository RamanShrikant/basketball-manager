import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const pageFade = fs.readFileSync(path.join(root, "src/components/PageFade.css"), "utf8");
const shell = fs.readFileSync(path.join(root, "src/components/PersistentGameShell.module.css"), "utf8");
const roster = fs.readFileSync(path.join(root, "src/pages/RosterView.module.css"), "utf8");
const coach = fs.readFileSync(path.join(root, "src/pages/CoachGameplan.jsx"), "utf8");

const checks = [];
const check = (condition, id, detail) =>
  checks.push({ status: condition ? "PASS" : "FAIL", id, detail });

check(
  pageFade.includes("/* ROSTER_COACH_VIEWPORT_CHAIN_FIX */"),
  "viewport.pagefade_marker",
  "Route-specific PageFade viewport block is installed."
);

check(
  pageFade.includes('body[data-bm-route="roster-view"] .bm-page-fade') &&
  pageFade.includes('body[data-bm-route="coach-gameplan"] .bm-page-fade') &&
  pageFade.includes("height: 100dvh !important;"),
  "viewport.pagefade_full_height",
  "Both PageFade wrappers have a definite full viewport height."
);

check(
  pageFade.includes('url("../assets/basketball-pattern.svg")'),
  "viewport.pagefade_painted",
  "PageFade itself paints the BM court background instead of exposing a strip."
);

check(
  shell.includes("/* ROSTER_COACH_SHELL_VIEWPORT_FIX */") &&
  shell.includes("height: 100dvh !important;"),
  "viewport.shell_height",
  "Persistent content column is a definite viewport-height box."
);

check(
  roster.includes("/* ROSTER_PARENT_HEIGHT_CHAIN */") &&
  roster.includes("height: 100% !important;"),
  "viewport.roster_inherits_height",
  "Roster View inherits the exact parent height."
);

check(
  coach.includes('className="h-full min-h-0 bmCourtPage text-white flex flex-col items-center overflow-hidden px-5 py-2"'),
  "viewport.coach_inherits_height",
  "Coach Gameplan fills its definite parent rather than creating another viewport box."
);

check(
  coach.includes("handleMinuteChange") &&
  coach.includes("handleAutoRebuild") &&
  coach.includes("handleSave"),
  "viewport.coach_logic_preserved",
  "Coach rotation/minutes/save logic remains intact."
);

check(
  roster.includes("scrollbar-color: #f97316"),
  "viewport.roster_scrollbar_preserved",
  "Roster orange scrollbar styling remains intact."
);

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Roster + Coach viewport-chain regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Roster + Coach viewport-chain regression passed: ${checks.length}/${checks.length} checks.`);
