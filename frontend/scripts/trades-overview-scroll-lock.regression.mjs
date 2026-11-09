/** Trade Center scroll-lock regression: UI/CSS only, no league mutation. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const here = dirname(fileURLToPath(import.meta.url));
const jsx = readFileSync(resolve(here, '../src/pages/Trades.jsx'), 'utf8');
const css = readFileSync(resolve(here, '../src/pages/Trades.css'), 'utf8');
const require = createRequire(import.meta.url);
const postcss = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/postcss');
const ast = postcss.parse(css);
const rules = [];
ast.walkRules((rule) => rules.push({selector: rule.selector, decl: Object.fromEntries(rule.nodes.filter(n => n.type === 'decl').map(n => [n.prop, `${n.value}${n.important ? ' !important' : ''}`]))}));
const hasRule = (selector, property, pattern) => rules.some(r => r.selector.includes(selector) && pattern.test(r.decl[property] || ''));
assert.ok(hasRule('html[data-bm-route="trades"]', 'overflow-y', /^hidden !important$/), 'document overflow must be locked on this route');
assert.ok(hasRule('.bm-trade-center-viewport .trade-center-panel:first-child > div:first-child', 'overflow-y', /^hidden !important$/), 'must override old index.css !important outer panel scrolling');
assert.ok(hasRule('.bm-tco-scroll', 'overflow-y', /^auto$/), 'internal contract list must remain scrollable');
assert.ok(hasRule('.bm-tco-scroll', 'overscroll-behavior-y', /^contain$/), 'wheel/trackpad scrolling must not chain outward');
assert.ok(hasRule('.bm-tco-scroll', 'max-height', /--bm-tco-available-height/), 'must bound internal scroll to actual available viewport space');
assert.ok(hasRule('.bm-tco-chevron', 'border', /^0$/), 'no circular outline around chevrons');
assert.ok(hasRule('.bm-tco-scroll', 'scrollbar-color', /#f97316/), 'orange Firefox/Chromium scrollbar');
assert.ok(css.includes('.bm-tco-scroll::-webkit-scrollbar-thumb') && css.includes('background: #f97316'), 'orange WebKit scrollbar');
for (const token of ['tradeOverviewPairRef','tradeOverviewLeftPanelRef','getBoundingClientRect()','--bm-tco-available-height','aria-expanded={openOverview.cap}','aria-expanded={openOverview.expiring}', 'className="bm-tco-scroll"']) {
  assert.ok(jsx.includes(token), `Missing viewport/expander behavior: ${token}`);
}
assert.ok(!jsx.includes('setLeagueData('), 'scroll logic must not change league state');
console.log('PASS: no Trade Center page/left-panel scroll, orange nested contract lists only');
console.log('PASS: borderless arrows, bounded responsive scroll area, game handlers preserved');
