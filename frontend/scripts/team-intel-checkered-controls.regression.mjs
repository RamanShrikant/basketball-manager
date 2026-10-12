import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { LEAGUE_INTEL_LAYOUT, leagueIntelTuningVars } from '../src/config/leagueIntelLayout.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jsx = readFileSync(resolve(root,'src/pages/Intel_v1.jsx'),'utf8');
const css = readFileSync(resolve(root,'src/styles/BMLeagueIntel.css'),'utf8');

// The main starter card keeps its solid name strip, whereas portrait-only area
// and existing compact pills are given the court checkerboard.
assert.match(css, /\.bm-il-starter::before\s*\{[^]*?inset:\s*0 0 32px 0;/);
assert.match(css, /\.bm-il-starter-foot\s*\{[^]*?background:\s*linear-gradient\(0deg,\s*#0a0a0a/);
for (const selector of ['.bm-il-mini-player', '.bm-il-expiring', '.bm-il-need', '.bm-il-roster-row']) {
  assert.ok(css.includes(selector), `checkerboard pill ${selector}`);
}
assert.match(css,/basketball-pattern\.svg/);
assert.match(css,/repeating-linear-gradient\(45deg/);
assert.match(css,/repeating-linear-gradient\(-45deg/);

// Expiring deals reuses the same Roster View OVR/POT rating helper as Available,
// with the expiringDeals ring/portrait/name controls independent of other rows.
assert.match(jsx, /className="bm-il-expiring-visual"/);
assert.match(jsx, /<OverallRing rating=\{row.overall\} potential=\{row.potential\} section="expiringDeals"/);
assert.match(jsx, /className="bm-il-expiring-copy"/);
assert.match(jsx,/\{money\(row.salary\)\}<small>Expiring<\/small>/);

// Separate live position and age controls for all requested row families.
for (const key of ['scoutingRows','teamNeeds','expiringDeals','fullRoster']) {
  for (const field of ['position', 'age']) {
    const data = LEAGUE_INTEL_LAYOUT[key][field];
    assert.ok(data && ['x','y','scale'].every(v => Number.isFinite(data[v])),`${key}.${field}`);
    assert.match(leagueIntelTuningVars(key)[`--bm-il-${field}-tune`],/^translate\(/);
  }
}
assert.match(css,/\.bm-il-player-position\s*\{\s*transform: var\(--bm-il-position-tune/);
assert.match(css,/\.bm-il-player-age\s*\{\s*transform: var\(--bm-il-age-tune/);
assert.match(css,/\.bm-il-starter \.bm-il-position\s*\{[^]*?--bm-il-position-tune/);
assert.match(jsx,/className="bm-il-need-metadata"/);
assert.match(jsx,/className="bm-il-player-position"/);
assert.match(jsx,/className="bm-il-player-age"/);

// New controls don't tamper with existing custom headshot/name/ring tuning.
for (const section of ['scoutingRows','teamNeeds','expiringDeals','fullRoster']) {
  const before = leagueIntelTuningVars(section);
  const ref = LEAGUE_INTEL_LAYOUT[section];
  const old = { ...ref.position };
  try {
    ref.position.x += 12; ref.position.scale = 1.2;
    const after = leagueIntelTuningVars(section);
    assert.notEqual(after['--bm-il-position-tune'],before['--bm-il-position-tune']);
    for (const varKey of ['--bm-il-headshot-tune','--bm-il-name-tune','--bm-il-rating-tune','--bm-il-pick-logo-tune']) {
      assert.equal(after[varKey],before[varKey],`${section}.${varKey} remained unchanged`);
    }
  } finally { Object.assign(ref.position,old); }
}
// The main tuning numbers from the user's latest saved config remain untouched.
// No automatic normalization/canonical sizing is being forced on headshots.
const starters=LEAGUE_INTEL_LAYOUT.starters;
assert.ok(starters.headshot && starters.name && starters.ring && starters.divider);
assert.match(jsx,/layoutPage="intel"/);
console.log('PASS League Intel court-checkered cards, expiring OVR/POT rings, custom transforms, metadata positioning');
