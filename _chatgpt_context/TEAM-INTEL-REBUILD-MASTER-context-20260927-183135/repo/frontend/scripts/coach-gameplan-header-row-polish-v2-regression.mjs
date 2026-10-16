import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = fs.readFileSync(path.join(root, "src/pages/CoachGameplan.jsx"), "utf8");

const checks=[];
const check=(condition,id,detail)=>checks.push({status:condition?"PASS":"FAIL",id,detail});

check(
  source.includes('left: "-18px"') && source.includes('width: "190px"') && source.includes('opacity: 0.08'),
  "gameplan.roster_watermark",
  "Coach player hero uses the same watermark geometry as Roster View."
);
check(
  source.includes('>STARTERS</td>') && source.includes('>POS</td>') && source.includes('>PLAYER</td>') && source.includes('>OVR</td>') && source.includes('>MINUTES</td>'),
  "gameplan.starters_combined_header",
  "STARTERS and the four column labels share one table row."
);
check(
  !source.includes('rounded-full bg-orange-500 align-middle'),
  "gameplan.section_accent_removed",
  "No vertical orange section accent remains."
);
check(
  source.includes('>BENCH</td>') && (source.match(/>POS<\/td>/g)||[]).length===1,
  "gameplan.bench_no_headers",
  "Bench keeps a clean section bar without duplicate headers."
);
check(
  (source.match(/accent-white/g)||[]).length >= 2,
  "gameplan.white_sliders_preserved",
  "Both starter and bench minutes sliders remain white."
);
check(
  source.includes("handleMinuteChange(p.name, e.target.value)") && source.includes("handleAutoRebuild") && source.includes("handleSave"),
  "gameplan.logic_preserved",
  "Minute, auto-rebuild, and save logic remains wired."
);

console.table(checks);
const failed=checks.filter(r=>r.status==="FAIL");
if(failed.length){console.error(`Coach Gameplan header-row polish V2 regression failed: ${failed.length}/${checks.length} checks.`);process.exit(1);}
console.log(`Coach Gameplan header-row polish V2 regression passed: ${checks.length}/${checks.length} checks.`);
