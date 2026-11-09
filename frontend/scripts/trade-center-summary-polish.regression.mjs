/** UI-only Trade Center summary polish regression. No game imports/writes. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const jsx = readFileSync(resolve(here, '../src/pages/Trades.jsx'), 'utf8');
const css = readFileSync(resolve(here, '../src/pages/Trades.css'), 'utf8');
const config = readFileSync(resolve(here, '../src/config/tradeCenterOverviewLayout.js'), 'utf8');
const sourceBlocks = [
  jsx.slice(jsx.indexOf('className="bm-tco-summary bm-tco-summary--cap'), jsx.indexOf('{openOverview.cap && <div id="bm-tco-cap-list"')),
  jsx.slice(jsx.indexOf('className="bm-tco-summary bm-tco-summary--expiring'), jsx.indexOf('{openOverview.expiring && <div id="bm-tco-expiring-list"')),
];
for (const [i, block] of sourceBlocks.entries()) {
  assert.ok(block.includes('bm-tco-summary-pattern'), `Panel ${i}: checkered layer missing`);
  assert.ok(block.includes('bm-tco-summary-logo'), `Panel ${i}: watermark missing`);
  assert.ok(block.includes('teamLogoOf(selectedTeam)'), `Panel ${i}: must use controlled team logo`);
  assert.ok(block.includes('aria-hidden="true"'), `Panel ${i}: watermark must be decorative`);
  assert.ok(block.includes('bm-tco-summary-icon') && block.includes('bm-tco-summary-copy'), `Panel ${i}: summary content missing`);
  assert.ok(block.includes('bm-tco-summary-primary') && block.includes('bm-tco-summary-secondary'), `Panel ${i}: values missing`);
  assert.ok(block.includes('bm-tco-chevron'), `Panel ${i}: existing arrow missing`);
}
assert.ok(jsx.includes('aria-expanded={openOverview.cap}') && jsx.includes('aria-expanded={openOverview.expiring}'), 'Expanders must retain accessibility/behavior');
assert.ok(jsx.includes('cap: !prev.cap') && jsx.includes('expiring: !prev.expiring'), 'Both original toggles must remain');
assert.ok(jsx.includes('teamLogo={teamLogoOf(selectedTeam)} section="cap"') && jsx.includes('teamLogo={teamLogoOf(selectedTeam)} section="expiring"'), 'Existing player row logos must remain');
assert.ok(jsx.includes("navigate('/salary-table')") && jsx.includes("navigate('/contract-extensions')"), 'Footer links must remain');
assert.ok(css.includes('.bm-tco-summary-pattern') && css.includes('.bm-tco-summary-logo img'), 'Summary background CSS missing');
assert.ok(css.includes('var(--bm-tco-summary-logo-opacity') && css.includes('var(--bm-tco-summary-logo-tune'), 'Summary logo tuning variables missing');
assert.ok(css.includes('.bm-tco-scroll::-webkit-scrollbar-thumb'), 'Orange internal scrollbar must remain');
assert.ok(css.includes('overflow-y: hidden !important'), 'Page scroll lock must remain');
assert.equal((config.match(/summaryLogo:\s*\{/g) || []).length, 2, 'Independent summary logo controls required');
assert.ok(config.includes("'--bm-tco-summary-logo-opacity'") && config.includes("'--bm-tco-summary-logo-tune'"), 'Summary logo manual controls must be exported');
assert.ok(config.includes('logo: {') && config.includes('headshot: {') && config.includes('maxHeight:'), 'Existing row/manual controls must be preserved');
console.log('PASS: both header polishes, live team logos, and independent visual tuning');
console.log('PASS: expand/collapse, footer links, player cards and scroll-lock preserved');
