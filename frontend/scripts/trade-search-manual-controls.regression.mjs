import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRADE_SEARCH_LAYOUT, tradeSearchTuningVars } from '../src/config/tradeSearchLayout.js';

const jsx = readFileSync(new URL('../src/pages/Trades.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/pages/Trades.css', import.meta.url), 'utf8');

const layers = [
  'headshot', 'name', 'position', 'age', 'contractYears',
  'contractValue', 'averageSalary', 'teamLogo',
];
for (const layer of layers) {
  assert.deepEqual(
    Object.keys(TRADE_SEARCH_LAYOUT[layer]).sort(),
    (layer === 'teamLogo' ? ['x', 'y', 'scale', 'opacity'] : ['x', 'y', 'scale']).sort(),
    `Independent X/Y/Scale ${layer} settings are missing`
  );
}
assert.equal(TRADE_SEARCH_LAYOUT.headshot.y, 6, 'Keep the already-installed 6px portrait drop');
assert.equal(TRADE_SEARCH_LAYOUT.teamLogo.opacity, .10, 'Keep logo at the current opacity');
for (const key of ['name','position','age','contractYears','contractValue','averageSalary']) {
  assert.deepEqual(TRADE_SEARCH_LAYOUT[key], {x:0,y:0,scale:1}, `${key} default must be visually neutral`);
}
assert.equal(Object.hasOwn(TRADE_SEARCH_LAYOUT, 'ring'), false, 'OVR/POT ring must stay locked');
assert.equal(Object.hasOwn(TRADE_SEARCH_LAYOUT, 'rating'), false, 'Rating must stay locked');

const baselineVars = tradeSearchTuningVars();
assert.equal(baselineVars['--bm-trade-search-headshot-tune'], 'translate(0px, 6px) scale(1)');
assert.equal(baselineVars['--bm-trade-search-logo-opacity'], .10);
assert.equal(baselineVars['--bm-trade-search-name-tune'], 'translate(0px, 0px) scale(1)');
assert.equal(Object.keys(baselineVars).length, 9, 'Expected eight independent transforms and one logo opacity');

// Test transforms: each setting only changes its own CSS variable, nothing else.
TRADE_SEARCH_LAYOUT.headshot.x = -8;
TRADE_SEARCH_LAYOUT.headshot.y = 10;
TRADE_SEARCH_LAYOUT.headshot.scale = 1.3;
const moved = tradeSearchTuningVars();
assert.equal(moved['--bm-trade-search-headshot-tune'], 'translate(-8px, 10px) scale(1.3)');
for (const key of Object.keys(baselineVars).filter((k) => k !== '--bm-trade-search-headshot-tune')) {
  assert.equal(moved[key], baselineVars[key], `Moving headshot must not touch ${key}`);
}
TRADE_SEARCH_LAYOUT.headshot.x = 0;
TRADE_SEARCH_LAYOUT.headshot.y = 6;
TRADE_SEARCH_LAYOUT.headshot.scale = 1;
TRADE_SEARCH_LAYOUT.teamLogo.opacity = 5;
assert.equal(tradeSearchTuningVars()['--bm-trade-search-logo-opacity'], 1);
TRADE_SEARCH_LAYOUT.teamLogo.opacity = -2;
assert.equal(tradeSearchTuningVars()['--bm-trade-search-logo-opacity'], 0);
TRADE_SEARCH_LAYOUT.teamLogo.opacity = .10;

for (const className of [
  'trade-search-meta-position', 'trade-search-meta-age',
  'trade-search-meta-contract-years', 'trade-search-meta-contract-value',
  'trade-search-player-name', 'trade-search-contract-average',
  'trade-search-headshot', 'trade-search-team-logo-bg',
]) {
  assert.ok(jsx.includes(className), `Missing JSX class ${className}`);
  assert.ok(css.includes(`.${className}`), `Missing CSS class ${className}`);
}
assert.match(jsx, /style=\{tradeSearchTuningVars\(\)\}/);
assert.match(jsx, /<PlayerRatingRing overall=\{overall\} potential=\{potential\} size=\{48\} strokeWidth=\{7\}/);
assert.match(jsx, /setSearchPlayerCard\(result\)/);
assert.match(css, /height:\s*56px/);
assert.match(css, /min-height:\s*56px/);
assert.match(css, /transform: var\(--bm-trade-search-headshot-tune, translateY\(6px\)\)/);
assert.match(css, /opacity: var\(--bm-trade-search-logo-opacity, \.10\)/);
assert.doesNotMatch(css, /--bm-trade-search-ring-tune|--bm-trade-search-rating-tune/, 'Rating cannot be tuned');
console.log('Trades Search independent manual controls: PASS');
