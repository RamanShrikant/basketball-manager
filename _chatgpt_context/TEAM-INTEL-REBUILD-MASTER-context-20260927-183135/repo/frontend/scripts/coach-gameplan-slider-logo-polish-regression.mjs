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
  source.includes('className="pointer-events-none absolute left-3 top-2 h-[126px] w-[126px] object-contain opacity-[0.12] select-none"'),
  "gameplan.team_logo_watermark",
  "Selected-player hero includes the faded team-logo watermark."
);

check(
  source.includes('className={`w-[150px] accent-white ${injured ? "cursor-not-allowed opacity-45" : ""}`}') &&
  !source.includes('className={`w-[150px] accent-orange-500 ${injured ? "cursor-not-allowed opacity-45" : ""}`}'),
  "gameplan.white_sliders",
  "Minutes sliders are styled back to white."
);

check(
  source.includes("handleMinuteChange(p.name, e.target.value)") &&
  source.includes("handleSave") &&
  source.includes("handleAutoRebuild"),
  "gameplan.logic_unchanged",
  "Minute handling, save, and auto-rebuild logic remain present."
);

console.table(checks);

const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Coach Gameplan slider/logo polish regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Coach Gameplan slider/logo polish regression passed: ${checks.length}/${checks.length} checks.`);
