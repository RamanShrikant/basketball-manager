import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAGUE_INTEL_LAYOUT, leagueIntelTuningVars, leagueIntelRingStrokeWidth } from '../src/config/leagueIntelLayout.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(resolve(root, 'src/pages/Intel_v1.jsx'), 'utf8');
const css = readFileSync(resolve(root, 'src/styles/BMLeagueIntel.css'), 'utf8');
const clone = o => JSON.parse(JSON.stringify(o));
const before = clone(LEAGUE_INTEL_LAYOUT);

// The user hand-tuned this exact scouting preset; Team Needs players must start
// at the same values, yet preserve their own independent set of controls.
for (const layer of ['headshot', 'name', 'ring', 'ringText', 'ringLabel', 'ringValue', 'ringPot', 'card', 'position', 'age']) {
  assert.deepEqual(LEAGUE_INTEL_LAYOUT.teamNeedsPlayers[layer], LEAGUE_INTEL_LAYOUT.scoutingRows[layer], layer);
  assert.notStrictEqual(LEAGUE_INTEL_LAYOUT.teamNeedsPlayers[layer], LEAGUE_INTEL_LAYOUT.scoutingRows[layer], `${layer} must be independently editable`);
}
// Existing values from the user's supplied config stay intact.
assert.deepEqual(LEAGUE_INTEL_LAYOUT.starters.headshot, {x:15,y:-2.6,scale:1,borderWidth:0});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.starters.name, {x:45,y:0,scale:1});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.starters.ring, {x:15,y:-35,scale:.7,strokeWidth:8});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.teamNeeds.headshot, {x:0,y:0,scale:1.7,borderWidth:0});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.teamNeeds.name, {x:30,y:0,scale:1});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.teamNeeds.ring, {x:30,y:0,scale:1,strokeWidth:7});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.teamNeeds.pickLogo, {x:0,y:0,scale:1,opacity:.36});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.teamNeeds.position, {x:30,y:0,scale:1});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.teamNeeds.age, {x:30,y:0,scale:1});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.scoutingRows.ringText, {x:0,y:0,scale:.8});

// One implementation is used in BOTH panels, not two CSS layouts drifting apart.
assert.match(page, /function MiniPlayer\(/);
assert.match(page, /section = "scoutingRows"/);
assert.match(page, /style=\{leagueIntelTuningVars\(section\)\}/);
assert.match(page, /section=\{section\}/);
assert.match(page, /section="teamNeedsPlayers"/);
assert.match(page, /portraitTeamName=\{userTeamName\}/);
assert.match(page, /needsPlayer\s+panelTitle="Team Needs: Players"/);
assert.match(page, /onInspect=\{\(\) => inspect\("Team Needs: Players", "needs", need\)\}/);
assert.match(page, /title="TEAM NEEDS: PICKS"/);
assert.match(page, /style=\{leagueIntelTuningVars\("teamNeeds"\)\}/);
assert.match(page, /pickOriginLogo\(need, displayLeague, liveTeams\)/);
assert.match(css, /\.bm-il-need-player-mirror \.bm-il-mini-text small/);
assert.match(css, /line-height:\s*1\.45/);

const original = leagueIntelTuningVars('scoutingRows');
const pickBefore = leagueIntelTuningVars('teamNeeds');
const mirrorBefore = leagueIntelTuningVars('teamNeedsPlayers');
try {
  LEAGUE_INTEL_LAYOUT.teamNeedsPlayers.headshot.x = 91;
  LEAGUE_INTEL_LAYOUT.teamNeedsPlayers.ring.strokeWidth = 11;
  assert.notEqual(leagueIntelTuningVars('teamNeedsPlayers')['--bm-il-headshot-tune'], mirrorBefore['--bm-il-headshot-tune']);
  assert.equal(leagueIntelRingStrokeWidth('teamNeedsPlayers'), 11);
  assert.deepEqual(leagueIntelTuningVars('scoutingRows'), original);
  assert.deepEqual(leagueIntelTuningVars('teamNeeds'), pickBefore);
} finally {
  Object.assign(LEAGUE_INTEL_LAYOUT.teamNeedsPlayers, clone(before.teamNeedsPlayers));
}
assert.deepEqual(LEAGUE_INTEL_LAYOUT, before, 'test itself must not change saved tune values');
console.log('PASS League Intel Team Needs player rows mirror scouting component, metadata fit, 2 picks unchanged, independent user tuning');
