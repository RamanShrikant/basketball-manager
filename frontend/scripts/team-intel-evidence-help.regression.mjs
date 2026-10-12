import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { explainIntelEvidence } from "../src/utils/teamIntelEvidenceExplanation.js";
import { LEAGUE_INTEL_LAYOUT, leagueIntelTuningVars } from "../src/config/leagueIntelLayout.js";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jsx = readFileSync(resolve(frontend, "src/pages/Intel_v1.jsx"), "utf8");
const css = readFileSync(resolve(frontend, "src/styles/BMLeagueIntel.css"), "utf8");
const get = (kind, data = {}) => explainIntelEvidence({ row: { name: "Test Player", evidence: { kind, label: data.label || "" }, ...data }, section: "targets", scoutedTeamName: "Philadelphia 76ers" });
for (const kind of ["cpu_hard_core", "cpu_outgoing_board", "cpu_market_watch", "cpu_mutual_scan", "user_cpu_accepted_framework", "cpu_bank_at_generation", "trade_desk_report", "cpu_valuation_only", "cpu_preference", "roster_analysis"]) {
  const item = get(kind, { sourceTeam: "Lakers" });
  assert.ok(item.heading.length >= 8 && item.heading.length < 60, `heading for ${kind}`);
  assert.ok(item.summary.length >= 90 && item.summary.length < 470, `readability for ${kind}`);
  assert.ok(item.confidence.length >= 10 && item.confidence.length < 100, `source strength for ${kind}`);
  assert.doesNotMatch(item.summary, /[_]|\.py|cpu_cpu_trade_logic|trade_value_model/i, `no code in ${kind}`);
}
assert.match(get("cpu_outgoing_board").summary, /not .*agreed/i);
assert.match(get("cpu_market_watch", { sourceTeam: "Lakers" }).summary, /does not establish an active pursuit/i);
assert.match(get("cpu_hard_core").summary, /not make him untradeable/i);
assert.match(get("cpu_mutual_scan", { evidence: { kind: "cpu_mutual_scan", label: "PROJECTED OFFSEASON" } }).summary, /projected offseason/);
assert.match(get("cpu_valuation_only").summary, /does not mean .* requested/i);
assert.match(explainIntelEvidence({ section: "expiring", row: { name: "Player" } }).summary, /expiring-contract/);
assert.match(jsx, /import \{ playSound, SOUND_KEYS \} from "\.\.\/audio\/soundManager\.js"/);
assert.match(jsx, /playSound\(SOUND_KEYS\.SIDEBAR_NAVIGATION\)/);
assert.match(jsx, /playSound\(SOUND_KEYS\.UI_BACK_CANCEL\)/);
assert.match(jsx, /explainIntelEvidence\(\{ row, section, scoutedTeamName: team\.name \}\)/);
assert.match(jsx, /<span className="bm-il-evidence-help" aria-hidden="true">\?<\/span>/);
assert.doesNotMatch(jsx, /"BANK" : row\.evidence\?\.kind/);
assert.match(css, /\.bm-il-mini-player \.bm-il-evidence-help/);
assert.match(css, /\.bm-il-need-pick-mark img \{\s*transform: var\(--bm-il-pick-logo-tune/);
const pick = LEAGUE_INTEL_LAYOUT.teamNeeds.pickLogo;
for (const key of ["x", "y", "scale", "opacity"]) assert.ok(Number.isFinite(pick[key]), `pickLogo.${key}`);
const base = leagueIntelTuningVars("teamNeeds");
assert.match(base["--bm-il-pick-logo-tune"], /translate\(/);
assert.equal(base["--bm-il-pick-logo-opacity"], .36);
const other = leagueIntelTuningVars("starters")["--bm-il-rating-tune"];
try {
  pick.x = 10; pick.y = -4; pick.scale = 1.15; pick.opacity = .52;
  const updated = leagueIntelTuningVars("teamNeeds");
  assert.notEqual(updated["--bm-il-pick-logo-tune"], base["--bm-il-pick-logo-tune"]);
  assert.equal(updated["--bm-il-pick-logo-opacity"], .52);
  assert.equal(leagueIntelTuningVars("starters")["--bm-il-rating-tune"], other);
} finally { pick.x = 0; pick.y = 0; pick.scale = 1; pick.opacity = .36; }
for (const section of ["starters", "scoutingRows", "teamNeeds", "expiringDeals", "fullRoster"]) {
  const config = LEAGUE_INTEL_LAYOUT[section];
  for (const type of ["headshot", "name", "ring"]) {
    for (const key of ["x", "y", "scale"]) assert.ok(Number.isFinite(config[type][key]), `${section}.${type}.${key}`);
  }
  assert.ok(config.headshot.borderWidth >= 0);
  assert.ok(config.card.borderWidth >= 0);
}
assert.ok(LEAGUE_INTEL_LAYOUT.starters.divider.borderWidth >= 0);
console.log("PASS League Intel evidence ? help, existing sounds, accurate provenance, controls and pick logo tuning");
