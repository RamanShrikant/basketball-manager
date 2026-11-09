/** Pure UI-source regression; never simulates or modifies franchise data. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { TRADE_CENTER_OVERVIEW_LAYOUT, tradeCenterOverviewVars } from '../src/config/tradeCenterOverviewLayout.js';
const dir = dirname(fileURLToPath(import.meta.url));
const jsx = readFileSync(resolve(dir, '../src/pages/Trades.jsx'), 'utf8');
const css = readFileSync(resolve(dir, '../src/pages/Trades.css'), 'utf8');
assert.ok(jsx.includes('useState({ cap: true, expiring: true })'), 'Both expanders default open');
assert.ok(jsx.includes('setOpenOverview((prev) => ({ ...prev, cap: !prev.cap }))'));
assert.ok(jsx.includes('setOpenOverview((prev) => ({ ...prev, expiring: !prev.expiring }))'));
assert.ok(jsx.includes('teamLogo={teamLogoOf(selectedTeam)} section="cap"'));
assert.ok(jsx.includes('teamLogo={teamLogoOf(selectedTeam)} section="expiring"'));
const playerRow = jsx.slice(jsx.indexOf('function TradeOverviewPlayerRow('), jsx.indexOf('function getTradeCenterDeadCap('));
assert.ok(playerRow.includes('bm-tco-row-team-logo'), 'Low-opacity team logos in rows');
assert.equal((playerRow.match(/<div className="bm-tco-ring">/g) || []).length, 1, 'One OVR/POT ring for both cap and expiring');
assert.ok(playerRow.indexOf('bm-tco-player-text') < playerRow.indexOf('<div className="bm-tco-ring">'), 'Ring on right after text');
for (const word of ['tradeCenterContractSnapshot', 'tradeCenterExtensionStatus', 'bm-tco-option', 'bm-tco-money', 'bm-tco-player-finance']) assert.ok(playerRow.includes(word));
for (const word of ['TRADE CENTER: BLACK/CHECKERED EXPANDED PLAYER PILLS', 'basketball-pattern.svg', 'bm-tco-row-team-logo', '--bm-tco-card-radius', 'grid-template-columns: 68px minmax(0, 1fr) 60px', 'scrollbar-color: #f97316', 'overflow-y: hidden !important']) assert.ok(css.includes(word), `CSS regression: ${word}`);
for (const key of ['cap','expiring']) {
  const config = TRADE_CENTER_OVERVIEW_LAYOUT[key];
  for (const prop of ['maxHeight', 'headshot', 'name', 'age', 'ring', 'logo', 'card', 'option']) assert.ok(config[prop] !== undefined, `Missing ${key}.${prop}`);
  const vars = tradeCenterOverviewVars(key);
  assert.match(vars['--bm-tco-ring-tune'], /scale\(/);
  assert.match(vars['--bm-tco-logo-tune'], /scale\(/);
  assert.ok(vars['--bm-tco-logo-opacity'] >= 0 && vars['--bm-tco-logo-opacity'] <= 1);
  assert.match(vars['--bm-tco-card-radius'], /px$/);
}
assert.ok(!jsx.includes('setLeagueData('), 'No direct mutation of save data');
for (const token of ['Open Salary Table', 'Open Contract Extensions', 'League Rumor Board', 'trade-search-player-row', 'aria-expanded={openOverview.cap}', 'aria-expanded={openOverview.expiring}']) assert.ok(jsx.includes(token), `Missing existing feature ${token}`);
const require = createRequire(import.meta.url);
try {
  let ts;
  for (const modulePath of ['typescript', '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript']) {
    try { ts = require(modulePath); break; } catch { /* optional */ }
  }
  if (ts) {
    const ast = ts.createSourceFile('Trades.jsx', jsx, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    assert.equal(ast.parseDiagnostics.length, 0, ast.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('; '));
  }
} catch (error) { throw new Error(`JSX parse failed: ${error.message}`); }
console.log('PASS: Both panels default open; collapse/expand, footer links, trades/search preserved');
console.log('PASS: neutral patterned cards, logo controls, bottom portraits and right OVR/POT rings');
console.log('PASS: separate per-section manual tuning without touching contract calculations');
