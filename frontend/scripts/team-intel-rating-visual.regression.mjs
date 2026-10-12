import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { LEAGUE_INTEL_LAYOUT, leagueIntelRingStrokeWidth, leagueIntelTuningVars } from "../src/config/leagueIntelLayout.js";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jsx = readFileSync(resolve(frontend, "src/pages/Intel_v1.jsx"), "utf8");
const css = readFileSync(resolve(frontend, "src/styles/BMLeagueIntel.css"), "utf8");

// Same shared component as Roster View; no second OVR/POT model or new logic.
assert.match(jsx, /import PlayerRatingRing from "\.\.\/components\/PlayerRatingRing\.jsx"/);
assert.match(jsx, /overall=\{rating\}/);
assert.match(jsx, /potential=\{potential\}/);
assert.match(jsx, /strokeWidth=\{leagueIntelRingStrokeWidth\(section\)\}/);
assert.doesNotMatch(jsx, /function OverallRing\([^]*?conic-gradient/);

// No starter age and no portrait boxes on scouting or expiring cards.
assert.doesNotMatch(jsx, /<span>Age \{formatAge\(p\.age\)\}<\/span>/);
assert.match(css, /\.bm-il-mini-player \.bm-il-portrait--mini,/);
assert.match(css, /\.bm-il-expiring \.bm-il-portrait--mini,/);
assert.match(css, /border: var\(--bm-il-headshot-border-width, 0px\) solid/);

// All manual controls independent, responsive, and default to no portrait box.
for (const section of ["starters", "scoutingRows", "teamNeeds", "expiringDeals", "fullRoster"]) {
  const settings = LEAGUE_INTEL_LAYOUT[section];
  assert.equal(settings.headshot.borderWidth, 0);
  assert.equal(settings.card.borderWidth, 1);
  const vars = leagueIntelTuningVars(section);
  assert.equal(vars["--bm-il-headshot-border-width"], "0px");
  assert.equal(vars["--bm-il-card-border-width"], "1px");
  assert.match(vars["--bm-il-rating-tune"], /^translate\(/);
  assert.ok(leagueIntelRingStrokeWidth(section) >= 0);
}
const strokeBefore = leagueIntelRingStrokeWidth("starters");
const otherStroke = leagueIntelRingStrokeWidth("scoutingRows");
const old = { ...LEAGUE_INTEL_LAYOUT.starters.ring };
try {
  LEAGUE_INTEL_LAYOUT.starters.ring.strokeWidth = 12;
  assert.equal(leagueIntelRingStrokeWidth("starters"), 12);
  assert.equal(leagueIntelRingStrokeWidth("scoutingRows"), otherStroke);
  const name = leagueIntelTuningVars("starters")["--bm-il-name-tune"];
  LEAGUE_INTEL_LAYOUT.starters.ring.x = 12;
  assert.notEqual(leagueIntelTuningVars("starters")["--bm-il-rating-tune"], "translate(0cqw, 0cqw) scale(1)");
  assert.equal(leagueIntelTuningVars("starters")["--bm-il-name-tune"], name);
} finally {
  Object.assign(LEAGUE_INTEL_LAYOUT.starters.ring, old);
}
assert.equal(leagueIntelRingStrokeWidth("starters"), strokeBefore);
assert.equal(LEAGUE_INTEL_LAYOUT.starters.divider.borderWidth, 1);
assert.equal(LEAGUE_INTEL_LAYOUT.teamNeeds.pickLogo.opacity, .36);

// Test the actual pure pick-origin matching logic, not just source regexes.
const start = jsx.indexOf("function pickOriginLogo(");
const end = jsx.indexOf("\nfunction Portrait(", start);
assert.ok(start !== -1 && end > start);
const body = jsx.slice(start, end).replace("function pickOriginLogo", "function pickOriginLogo");
const norm = (x) => String(x ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const pickOriginLogo = new Function("norm", `${body}; return pickOriginLogo;`)(norm);
const league = { draftPicks: [{ id: "bos-27", originalTeam: "Boston Celtics", ownerTeam: "Brooklyn Nets" }] };
const teams = [{ name: "Boston Celtics", logo: "boston.png" }, { name: "Brooklyn Nets", logo: "brooklyn.png" }];
assert.equal(pickOriginLogo({ id: "bos-27", name: "2027 1st · Boston Celtics" }, league, teams), "boston.png");
assert.equal(pickOriginLogo({ name: "2028 1st · Brooklyn Nets" }, league, teams), "brooklyn.png");
assert.equal(pickOriginLogo({ name: "Unknown pick" }, league, teams), "");
assert.match(jsx, /playerNeeds\.length \? playerNeeds\.map/);
assert.match(jsx, /portraitTeamName=\{userTeamName\}/);
assert.match(jsx, /section="teamNeedsPlayers"/);
assert.match(jsx, /<span className="bm-il-need-pick-mark"/);

console.log("PASS League Intel ring & asset visuals: POT, border controls, origin-logo safety, no gameplay edits");
