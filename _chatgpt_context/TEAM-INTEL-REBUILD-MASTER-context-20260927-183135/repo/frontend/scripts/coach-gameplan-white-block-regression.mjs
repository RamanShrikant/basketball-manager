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
  source.includes('className="h-screen min-h-0 bmCourtPage text-white flex flex-col items-center overflow-hidden px-5 py-2"'),
  "coach_gameplan.root_wrapper",
  "Coach Gameplan keeps the full-height root wrapper without obsolete bottom padding."
);

check(
  !source.includes('px-5 py-2 pb-16'),
  "coach_gameplan.pb16_removed",
  "The old 64px bottom padding is gone."
);

check(
  source.includes("handleMinuteChange") &&
    source.includes("handleAutoRebuild") &&
    source.includes("handleSave"),
  "coach_gameplan.logic_preserved",
  "Rotation, minute editing, auto rebuild, and save handlers remain present."
);

console.table(checks);

const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Coach Gameplan white-block regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`Coach Gameplan white-block regression passed: ${checks.length}/${checks.length} checks.`);
