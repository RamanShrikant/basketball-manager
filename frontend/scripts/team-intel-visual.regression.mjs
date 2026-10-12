import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { LEAGUE_INTEL_LAYOUT, leagueIntelTuningVars } from "../src/config/leagueIntelLayout.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jsx = readFileSync(resolve(root, "src/pages/Intel_v1.jsx"), "utf8");
const css = readFileSync(resolve(root, "src/styles/BMLeagueIntel.css"), "utf8");

// No gameplay, trade evaluator, saved league or existing global portrait tuning modified.
assert.match(jsx, /import \{ LEAGUE_INTEL_LAYOUT, leagueIntelTuningVars, leagueIntelRingStrokeWidth, fitIntelStarterNameScale \} from "\.\.\/config\/leagueIntelLayout\.js"/);
assert.doesNotMatch(jsx, /\bbm-il-hero-stats\b|\bbm-il-hero-tags\b|SCOUT CONF RANK/);
assert.match(jsx, /bm-il-hero-essentials/);
assert.match(jsx, /import PlayerRatingRing from "\.\.\/components\/PlayerRatingRing\.jsx"/);
assert.match(jsx, /potential=\{p\.potential\}/);
assert.match(jsx, /potential=\{row\.potential\}/);
assert.doesNotMatch(jsx, /<span>Age \{formatAge\(p\.age\)\}<\/span>/);
assert.match(jsx, /pickOriginLogo\(need, displayLeague, liveTeams\)/);
assert.match(jsx, /section="teamNeedsPlayers"/);
assert.match(jsx, /needsPlayer/);
assert.match(jsx, /portraitTeamName=\{userTeamName\}/);
assert.match(jsx, /className="bm-il-need-pick-mark"/);
assert.match(jsx, /\{lifecycle\.inOffseason \? `\$\{lifecycle\.payrollYear\} Payroll` : "Payroll"\}/);
assert.match(jsx, /data-intel-starter=\{slot\.pos\} style=\{leagueIntelTuningVars\("starters"\)\}/);
assert.match(jsx, /style=\{leagueIntelTuningVars\(section\)\}/);
assert.match(jsx, /title="TEAM NEEDS: PLAYERS"/);
assert.match(jsx, /title="TEAM NEEDS: PICKS"/);
assert.doesNotMatch(jsx, /title="EXPIRING DEALS"/);
assert.match(jsx, /className="bm-il-roster-row" style=\{leagueIntelTuningVars\("fullRoster"\)\}/);
assert.match(css, /\.bm-il-team-logo \{\s*background:\s*transparent/);
assert.match(css, /\.bm-il-position \{\s*background:\s*transparent/);
assert.match(css, /\.bm-il-starter-foot \{\s*border-top:\s*1px/);
assert.match(css, /Roster View OVR\/POT RINGS/i);
assert.match(css, /--bm-il-headshot-border-width/i);
assert.match(css, /--bm-il-divider-border-width/i);
assert.match(css, /container-type:\s*inline-size/);

const sections = ["starters", "scoutingRows", "teamNeeds", "expiringDeals", "fullRoster"];
for (const key of sections) {
  assert.deepEqual(Object.keys(LEAGUE_INTEL_LAYOUT[key]).slice(0, 2), ["headshot", "name"]);
  for (const layer of ["headshot", "name"]) {
    assert.deepEqual(Object.keys(LEAGUE_INTEL_LAYOUT[key][layer]).slice(0, 3), ["x", "y", "scale"]);
  }
  assert.equal(LEAGUE_INTEL_LAYOUT[key].headshot.borderWidth, 0);
  assert.equal(LEAGUE_INTEL_LAYOUT[key].card.borderWidth, 1);
  assert.ok(Number(LEAGUE_INTEL_LAYOUT[key].ring.strokeWidth) > 0);
  const vars = leagueIntelTuningVars(key);
  assert.match(vars["--bm-il-headshot-tune"], /^translate\([\d.-]+cqw, [\d.-]+cqw\) scale\([\d.]+\)$/);
  assert.match(vars["--bm-il-name-tune"], /^translate\([\d.-]+cqw, [\d.-]+cqw\) scale\([\d.]+\)$/);
}

// Changing names has no effect on headshots; changing a different row family
// has no effect on starter tuning. This is the manual-tuning independence check.
const originalHeadshot = { ...LEAGUE_INTEL_LAYOUT.starters.headshot };
const originalScoutingHeadshot = leagueIntelTuningVars("scoutingRows")["--bm-il-headshot-tune"];
const originalName = { ...LEAGUE_INTEL_LAYOUT.starters.name };
const initial = leagueIntelTuningVars("starters");
try {
  LEAGUE_INTEL_LAYOUT.starters.headshot.x = 22;
  LEAGUE_INTEL_LAYOUT.starters.headshot.y = -11;
  LEAGUE_INTEL_LAYOUT.starters.headshot.scale = 1.15;
  const changeHeadshot = leagueIntelTuningVars("starters");
  assert.notEqual(initial["--bm-il-headshot-tune"], changeHeadshot["--bm-il-headshot-tune"]);
  assert.equal(initial["--bm-il-name-tune"], changeHeadshot["--bm-il-name-tune"]);
  LEAGUE_INTEL_LAYOUT.starters.name.x = -15;
  const changeName = leagueIntelTuningVars("starters");
  assert.notEqual(initial["--bm-il-name-tune"], changeName["--bm-il-name-tune"]);
  assert.equal(changeHeadshot["--bm-il-headshot-tune"], changeName["--bm-il-headshot-tune"]);
  assert.equal(leagueIntelTuningVars("scoutingRows")["--bm-il-headshot-tune"], originalScoutingHeadshot);
} finally {
  Object.assign(LEAGUE_INTEL_LAYOUT.starters.headshot, originalHeadshot);
  Object.assign(LEAGUE_INTEL_LAYOUT.starters.name, originalName);
}

console.log("PASS League Intel: Roster View OVR/POT rings, portraits, pick marks, responsive controls");
