import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(dir, '../src/pages/Trades.css'), 'utf8');
const jsx = readFileSync(resolve(dir, '../src/pages/Trades.jsx'), 'utf8');
const manual = readFileSync(resolve(dir, '../src/config/tradeCenterOverviewLayout.js'), 'utf8');
const marker = 'TRADE CENTER: PORTRAIT / RING SPACING AND PAGE-MATCHED PILL TEXTURE';
assert.ok(css.includes(marker), 'CSS correction missing');
const latest = css.slice(css.lastIndexOf(marker));
for (const token of [
  'background-size: 340px 340px, cover',
  'background-blend-mode: soft-light, normal',
  'overflow: visible',
  '[data-bm-portrait-envelope="height-fit"]',
  '.bm-tco-player-row > .bm-tco-portrait',
  '.bm-tco-player-row > .bm-tco-player-text',
  '.bm-tco-player-row > .bm-tco-ring',
  'position: absolute',
  'margin: 0 76px 0 109px',
  'right: 9px',
]) assert.ok(latest.includes(token), `Missing layout rule: ${token}`);
assert.ok(jsx.includes('bm-tco-row-team-logo'), 'Previous Team Intel-style portrait row expected');
assert.ok(jsx.includes('teamLogo={teamLogoOf(selectedTeam)} section="cap"'));
assert.ok(jsx.includes('teamLogo={teamLogoOf(selectedTeam)} section="expiring"'));
assert.ok(jsx.includes('useState({ cap: true, expiring: true })'));
assert.ok(manual.includes('tradeCenterOverviewVars'), 'Manual config not found');
for (const control of ['headshot', 'ring', 'name', 'age', 'option', 'logo']) {
  assert.ok(new RegExp(`\\b${control}:`).test(manual), `Manual tuning control ${control} missing`);
}
console.log('PASS: compact page-style background, unclipped portrait lane, isolated far-right ring');
console.log('PASS: both panels open; existing manual config and contract row data retained');
