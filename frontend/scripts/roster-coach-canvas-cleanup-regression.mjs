import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const rosterCss = fs.readFileSync(path.join(root, "src/pages/RosterView.module.css"), "utf8");
const rosterJsx = fs.readFileSync(path.join(root, "src/pages/RosterView.jsx"), "utf8");
const coach = fs.readFileSync(path.join(root, "src/pages/CoachGameplan.jsx"), "utf8");
const shellCss = fs.readFileSync(path.join(root, "src/components/PersistentGameShell.module.css"), "utf8");

const checks = [];
const check = (condition, id, detail) => checks.push({ status: condition ? "PASS" : "FAIL", id, detail });

check(
  rosterCss.includes("/* ROSTER_LAYOUT_FINAL_CLEANUP */"),
  "cleanup.roster_final_block",
  "Roster View has one final authoritative layout block."
);
check(
  !rosterCss.includes("/* ROSTER_FINAL_BLACK_BAR_FIX */") &&
  !rosterCss.includes("/* ROSTER_PAGEFADE_BACKGROUND_FIX */") &&
  !rosterCss.includes("/* ROSTER_SCROLLBAR_TO_BOTTOM */") &&
  !rosterCss.includes("/* ROSTER_SCROLLBAR_VIEWPORT_BOTTOM */"),
  "cleanup.old_roster_experiments_removed",
  "Conflicting roster layout/background experiments are gone."
);
check(
  rosterCss.includes("/* ROSTER_VISUAL_POLISH_V4 */") &&
  rosterCss.includes("/* ROSTER_ARROW_TITLE_TIGHT */"),
  "cleanup.good_roster_polish_preserved",
  "Successful roster button/meta polish and title-arrow alignment remain."
);
check(
  rosterCss.includes("height: 100dvh !important;") &&
  rosterCss.includes("scrollbar-color: #f97316"),
  "cleanup.roster_scroll_layout",
  "Roster keeps a full viewport scroller and orange scrollbar styling."
);
check(
  shellCss.includes("/* PERSISTENT_GAME_CANVAS_CLEANUP */") &&
  shellCss.includes('body[data-bm-route="roster-view"]') &&
  shellCss.includes('body[data-bm-route="coach-gameplan"]'),
  "cleanup.shell_route_canvas",
  "Persistent shell supplies the BM court canvas under both affected routes."
);
check(
  shellCss.includes('body[data-bm-route="coach-gameplan"] .bm-page-fade') &&
  shellCss.includes("background: transparent !important;"),
  "cleanup.pagefade_transparent",
  "Route PageFade no longer paints a separate black/white slab over the shell canvas."
);
check(
  !coach.includes("px-5 py-2 pb-16") && coach.includes("px-5 py-2"),
  "cleanup.coach_padding",
  "Coach Gameplan obsolete bottom padding remains removed."
);
check(
  rosterJsx.includes("handleAssignStandardToTwoWay") &&
  rosterJsx.includes("openReleaseForPlayer") &&
  coach.includes("handleMinuteChange") &&
  coach.includes("handleAutoRebuild") &&
  coach.includes("handleSave"),
  "cleanup.logic_preserved",
  "Roster and Coach gameplay/action handlers remain present."
);

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Roster + Coach canvas cleanup regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Roster + Coach canvas cleanup regression passed: ${checks.length}/${checks.length} checks.`);
