import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LEAGUE_INTEL_LAYOUT,
  leagueIntelTuningVars,
  fitIntelStarterNameScale,
} from "../src/config/leagueIntelLayout.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jsx = readFileSync(resolve(root, "src/pages/Intel_v1.jsx"), "utf8");
const css = readFileSync(resolve(root, "src/styles/BMLeagueIntel.css"), "utf8");

// Preserve EXACT user-provided values, including the new scouting numbers.
assert.deepEqual(LEAGUE_INTEL_LAYOUT.starters.headshot, {x:15, y:-2.6, scale:1, borderWidth:0});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.starters.name, {x:45, y:0, scale:1});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.starters.ring, {x:15, y:-35, scale:.7, strokeWidth:8});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.scoutingRows.headshot, {x:20, y:10, scale:1.7, borderWidth:0});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.scoutingRows.name, {x:40, y:0, scale:1});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.scoutingRows.ring, {x:25, y:-5, scale:1.1, strokeWidth:7});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.scoutingRows.position, {x:40, y:0, scale:1});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.scoutingRows.age, {x:40, y:0, scale:1});
for (const section of ["starters", "scoutingRows", "teamNeeds", "expiringDeals", "fullRoster"]) {
  const value = LEAGUE_INTEL_LAYOUT[section];
  for (const layer of ["ringText", "ringLabel", "ringValue", "ringPot"]) {
    assert.deepEqual(value[layer], layer === "ringText" && section === "scoutingRows" ? {x:0, y:0, scale:.8} : {x:0, y:0, scale:1});
  }
  const vars = leagueIntelTuningVars(section);
  for (const variable of ["--bm-il-ring-text-tune", "--bm-il-ring-label-tune", "--bm-il-ring-value-tune", "--bm-il-ring-pot-tune"]) {
    assert.match(vars[variable], /^translate\(.+cqw, .+cqw\) scale\((?:0\.8|1)\)$/);
  }
}

// The inner text moves independently; neither orange ring nor name/headshot moves.
const original = { ...LEAGUE_INTEL_LAYOUT.scoutingRows.ringText };
try {
  const before = leagueIntelTuningVars("scoutingRows");
  LEAGUE_INTEL_LAYOUT.scoutingRows.ringText.x = 7;
  LEAGUE_INTEL_LAYOUT.scoutingRows.ringText.y = -3;
  LEAGUE_INTEL_LAYOUT.scoutingRows.ringText.scale = .85;
  const after = leagueIntelTuningVars("scoutingRows");
  assert.notEqual(after["--bm-il-ring-text-tune"], before["--bm-il-ring-text-tune"]);
  for (const unaffected of ["--bm-il-rating-tune", "--bm-il-headshot-tune", "--bm-il-name-tune", "--bm-il-ring-value-tune"]) {
    assert.equal(after[unaffected], before[unaffected]);
  }
} finally {
  Object.assign(LEAGUE_INTEL_LAYOUT.scoutingRows.ringText, original);
}

// Auto-fit behavior: long names shrink; ordinary names don't, narrow laptop
// cards shrink more; the user's configured 45px X remains the centre baseline.
assert.equal(fitIntelStarterNameScale(185, 100, 1), 1);
assert.ok(fitIntelStarterNameScale(150, 225, 1) < .7);
assert.ok(fitIntelStarterNameScale(110, 225, 1) < fitIntelStarterNameScale(150, 225, 1));
assert.ok(fitIntelStarterNameScale(150, 225, 1.2) < fitIntelStarterNameScale(150, 225, 1));
assert.equal(leagueIntelTuningVars("starters")["--bm-il-starter-name-shift"], "translate(0cqw, 0cqw)");
const oldNameX = LEAGUE_INTEL_LAYOUT.starters.name.x;
try {
  LEAGUE_INTEL_LAYOUT.starters.name.x = 55;
  assert.notEqual(leagueIntelTuningVars("starters")["--bm-il-starter-name-shift"], "translate(0cqw, 0cqw)");
} finally {
  LEAGUE_INTEL_LAYOUT.starters.name.x = oldNameX;
}

assert.match(jsx, /function StarterName\(\{ name \}\)/);
assert.match(jsx, /new ResizeObserver\(fit\)/);
assert.match(jsx, /<StarterName name=\{p\.name\} \/>/);
assert.match(css, /\.bm-il-starter-foot\s*\{\s*align-items:\s*center/);
assert.match(css, /--bm-il-starter-name-final-scale/);
assert.match(jsx, /--bm-il-starter-name-fit-scale/);
assert.match(css, /\.bm-il-rating-ring \.bm-il-rating-component > div > span:nth-child\(3\)/);
assert.match(css, /--bm-il-ring-value-tune/);
// No shared files changed: this regression depends only on Intel-specific files.
console.log("PASS League Intel inner OVR/POT text manual controls + auto-fitting centred starter names");
