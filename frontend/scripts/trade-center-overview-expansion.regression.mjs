/** Read-only contract / option / expansion UI checks; does not run the game. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { tradeCenterContractSnapshot, tradeCenterContractOption, tradeCenterExtensionStatus } from '../src/utils/tradeCenterOverviewDetails.js';
import { TRADE_CENTER_OVERVIEW_LAYOUT, tradeCenterOverviewVars } from '../src/config/tradeCenterOverviewLayout.js';
const here = dirname(fileURLToPath(import.meta.url));
const jsx = readFileSync(resolve(here, '../src/pages/Trades.jsx'), 'utf8');
const css = readFileSync(resolve(here, '../src/pages/Trades.css'), 'utf8');
const snapshot = Object.freeze({ id: 20, name: 'Test', age: 24, contract: { startYear: 2026, salaryByYear: [2500000, 3000000, 4000000], option: { type: 'player', yearIndices: [2], picked: null } } });
const before = JSON.stringify(snapshot);
const full = tradeCenterContractSnapshot(snapshot, 2027);
assert.equal(full.yearsLeft, 2);
assert.equal(full.currentSalary, 3000000);
assert.equal(full.remainingTotal, 7000000);
assert.equal(full.option?.short, 'PO');
assert.equal(full.option?.year, 2028);
assert.equal(JSON.stringify(snapshot), before, 'Must never mutate player');
assert.equal(tradeCenterContractOption({ contract: { startYear: 2026, option: { type: 'team', yearIndex: 1, picked: null } } }, 2026)?.label, 'Team option');
assert.equal(tradeCenterContractOption({ contract: { startYear: 2026, option: { type: 'player', yearIndices: [2], picked: true } } }, 2026), null);
assert.equal(tradeCenterContractOption({ contract: { startYear: 2026, option: { type: 'player', yearIndices: [1], picked: null } } }, 2030), null);
const oldSave = tradeCenterContractSnapshot({ yearsLeft: 3, salary: 6000000 }, 2026);
assert.equal(oldSave.yearsLeft, 3);
assert.equal(oldSave.remainingTotal, null, 'Do not invent future contract value');
assert.equal(oldSave.currentSalary, 6000000);
const rollover = tradeCenterContractSnapshot({ contract: { startYear: 2026, salaryByYear: [5000000] } }, 2027);
assert.equal(rollover.yearsLeft, 1);
assert.equal(rollover.currentSalary, 5000000);
assert.equal(tradeCenterExtensionStatus(null, snapshot).code, 'unknown');
const preview = { players: [{ playerId: 20, playerName: 'Test', eligible: true }] };
assert.equal(tradeCenterExtensionStatus(preview, snapshot).label, 'Open to talks');
assert.equal(tradeCenterExtensionStatus({ players: [{ playerName: 'Test', playerRefusesExtension: true }] }, snapshot).label, 'Not interested');
assert.equal(tradeCenterExtensionStatus({ players: [{ playerName: 'Different', eligible: true }] }, snapshot).label, 'Interest not assessed');
for (const key of ['cap','expiring']) {
  assert.ok(TRADE_CENTER_OVERVIEW_LAYOUT[key].maxHeight >= 90);
  const vars = tradeCenterOverviewVars(key);
  assert.ok(vars['--bm-tco-headshot-tune'].includes('scale(1)'));
  assert.ok(vars['--bm-tco-max-height'].endsWith('px'));
}
for (const key of ['headshot','name','age','salary','years','option']) assert.ok(TRADE_CENTER_OVERVIEW_LAYOUT.cap[key]);
for (const key of ['headshot','name','age','ring','money','interest','option']) assert.ok(TRADE_CENTER_OVERVIEW_LAYOUT.expiring[key]);
for (const text of [
  'setOpenOverview((prev) => ({ ...prev, cap: !prev.cap }))',
  'setOpenOverview((prev) => ({ ...prev, expiring: !prev.expiring }))',
  'aria-expanded={openOverview.cap}',
  'aria-expanded={openOverview.expiring}',
  'previewContractExtensions(leagueData, selectedTeam.name, getUserTradeCurrentDate(leagueData))',
  'Open Salary Table', 'Open Contract Extensions',
  'className="bm-tco-scroll"',
  'onClick={() => !tradeWindowLocked && navigate("/propose-trade")}',
  'onClick={() => !tradeWindowLocked && navigate("/trade-finder")}',
  'League Rumor Board', 'trade-search-player-row'
]) assert.ok(jsx.includes(text), `Missing expected behavior: ${text}`);
assert.ok(!jsx.includes('setLeagueData('), 'Trades page must not mutate league state');
for (const name of ['.bm-tco-connected', '.bm-tco-scroll', '.bm-tco-player-row', '.bm-tco-chevron']) assert.ok(css.includes(name));
// Verify JSX parses using the TypeScript JSX parser bundled with Node's tooling.
const require = createRequire(import.meta.url);
let ts;
for (const candidate of ['/usr/local/slides_js/node_modules/typescript', '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript']) {
  try { ts = require(candidate); break; } catch { /* local user repo may lack TypeScript */ }
}
if (ts) {
  const parsed = ts.transpileModule(jsx, { fileName:'Trades.jsx', reportDiagnostics:true, compilerOptions: { allowJs:true, jsx:ts.JsxEmit.ReactJSX, target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.ESNext } });
  assert.equal(parsed.diagnostics.length,0,`JSX error: ${parsed.diagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('; ')}`);
}
console.log('PASS: live saved contracts / options / incomplete data / extension status / manual controls / expandable UI');
console.log('PASS: Trade Center interactions, Player Search and Rumor Board retained');
