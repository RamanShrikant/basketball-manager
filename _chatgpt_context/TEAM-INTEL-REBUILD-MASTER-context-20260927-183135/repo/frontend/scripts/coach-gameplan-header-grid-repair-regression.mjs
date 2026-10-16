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
  source.includes('className="w-full table-fixed border-collapse text-left"'),
  "gameplan.table_grid_locked",
  "Rotation table uses a fixed grid so section labels cannot resize columns."
);

check(
  source.includes('relative w-[60px] py-2') &&
  source.includes('>STARTERS</span>'),
  "gameplan.starters_overlay",
  "STARTERS label is visual-only inside the fixed checkbox column."
);

check(
  source.includes('>BENCH</span>') &&
  source.includes('<td colSpan={4}></td>'),
  "gameplan.bench_overlay",
  "BENCH label preserves the same table geometry."
);

check(
  source.includes(">POS</td>") &&
  source.includes(">PLAYER</td>") &&
  source.includes(">OVR</td>") &&
  source.includes(">MINUTES</td>"),
  "gameplan.headers_preserved",
  "POS / PLAYER / OVR / MINUTES remain on the STARTERS bar."
);

check(
  source.includes('opacity-[0.12] select-none'),
  "gameplan.logo_preserved",
  "The faded team-logo hero treatment remains intact."
);

check(
  source.includes("handleMinuteChange(p.name, e.target.value)") &&
  source.includes("handleSave") &&
  source.includes("handleAutoRebuild"),
  "gameplan.logic_preserved",
  "Minute, save, and auto-rebuild logic remains wired."
);

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Coach Gameplan header-grid repair regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Coach Gameplan header-grid repair regression passed: ${checks.length}/${checks.length} checks.`);
