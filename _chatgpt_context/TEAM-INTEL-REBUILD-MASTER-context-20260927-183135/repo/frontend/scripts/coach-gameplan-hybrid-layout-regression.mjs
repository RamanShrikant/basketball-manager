import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = fs.readFileSync(path.join(root, "src/pages/CoachGameplan.jsx"), "utf8");

const checks = [];
const check = (condition, id, detail) =>
  checks.push({ status: condition ? "PASS" : "FAIL", id, detail });

check(
  source.includes("activeTeamLogo") &&
  source.includes("{selectedTeam.name} Coach Gameplan"),
  "gameplan.roster_style_header",
  "Coach Gameplan uses team-logo identity with the roster-style title."
);

check(
  source.includes("Minutes Assigned") &&
  source.includes("minutesAssignedPercent"),
  "gameplan.minutes_summary",
  "Minutes Assigned / Remaining summary lives in the selected-player header."
);

check(
  !source.includes('POT: <span className="text-orange-400">{potRatings.pot}</span>') &&
  !source.includes('<span className="text-white">Team Overall:</span>'),
  "gameplan.rating_strip_removed",
  "POT/FTR/Team Overall strip is removed from the visible rotation surface."
);

check(
  source.includes("players.slice(0, 5).map") &&
  source.includes("players.slice(5).map"),
  "gameplan.sections",
  "Starters and bench are rendered as explicit sections."
);

check(
  source.includes("{i + 1}</td>"),
  "gameplan.bench_numbers",
  "Bench rows display rotation numbers 6, 7, 8, 9, 10... ."
);

check(
  (source.match(/>POS<\/th>/g) || []).length === 1 &&
  (source.match(/>PLAYER<\/th>/g) || []).length === 1 &&
  (source.match(/>OVR<\/th>/g) || []).length === 1 &&
  (source.match(/>MINUTES<\/th>/g) || []).length === 1,
  "gameplan.no_bench_headers",
  "Column headers appear once only; bench does not repeat them."
);

check(
  source.includes("handleSquareClick(p)") &&
  source.includes("handleMinuteChange(p.name, e.target.value)") &&
  source.includes("handleAutoRebuild") &&
  source.includes("handleSave"),
  "gameplan.logic_preserved",
  "Swap, minutes, auto-rebuild and save interactions remain wired."
);

check(
  source.includes('title="Previous Team"') &&
  source.includes('title="Next Team"'),
  "gameplan.team_switch_preserved",
  "Previous/next team switching remains present."
);

console.table(checks);

const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Coach Gameplan hybrid-layout regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Coach Gameplan hybrid-layout regression passed: ${checks.length}/${checks.length} checks.`);
