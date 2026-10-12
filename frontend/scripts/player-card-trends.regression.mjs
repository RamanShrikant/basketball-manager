/**
 * Player Card Trends read-only UI regression. Run from frontend/:
 * node scripts/player-card-trends.regression.mjs
 *
 * This tests shipped source and shared calculation helpers without requiring a
 * save, any browser storage, or an installed JSX runtime in the test process.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(here, '../src/components/PlayerCardModal.jsx'), 'utf8');
const tests = [];
const test = (name, fn) => {fn();tests.push(name);};
function bodyOfFunction(name) {
  const begin = source.indexOf(`function ${name}(`);
  assert.ok(begin >= 0, `Missing function ${name}`);
  const firstBrace = source.indexOf('{', begin);
  let depth=0;
  for(let i=firstBrace;i<source.length;i++) {
    if(source[i]==='{')depth++;
    if(source[i]==='}'&&--depth===0)return source.slice(begin,i+1);
  }
  throw new Error(`Unclosed ${name}`);
}
const globals = {Math, Number, safeNumber: (x, fallback=0)=>Number.isFinite(Number(x))?Number(x):fallback};
const scale = vm.runInNewContext(`${bodyOfFunction('trendScaleMaximum')}\ntrendScaleMaximum`,globals);

test('individual category ranges are independent and include their maximum',()=>{
  const points=scale(25.4), rebounds=scale(4.4), assists=scale(7.1);
  assert.equal(points,30);
  assert.equal(rebounds,5);
  assert.equal(assists,8);
  assert.ok(points>assists&&assists>rebounds);
});
test('no division-by-zero for empty/zero-only chart histories',()=>{
  assert.ok(scale(0)>0);
  assert.ok(scale(NaN)>0);
});
test('high-volume seasons remain on data-based scale',()=>{
  assert.ok(scale(43.2)>=43.2);
  assert.ok(scale(43.2)<60);
});
test('three separate SVG categories, not one combined values maximum',()=>{
  assert.match(source,/TREND_SERIES\.map\(\(series\) => \{/);
  assert.match(source,/const yMax = trendScaleMaximum\(Math\.max\(\.\.\.rows\.map/);
  assert.doesNotMatch(source,/const allValues = rows\.flatMap/);
});
test('interactive colored per-season readouts respond to hover, click, and keyboard',()=>{
  for(const pattern of [/onPointerEnter=/,/onFocus=/,/onClick=/,/onKeyDown=/,/aria-label=\{`\$\{formatSeasonLabel\(row\?\.seasonYear\)\}/,/fill=\{series\.color\}/,/selectedRow && <g pointerEvents="none">/]) {
    assert.match(source,pattern);
  }
});
test('contract header distinguishes two-way, normal, missing and incomplete schedules',()=>{
  const header=source.slice(source.indexOf('className="pc29-meta"'),source.indexOf('className="pc29-rating"'));
  assert.match(header,/isTwoWayDevelopmentContract/);
  assert.match(header,/contractYears > 0 && contractTotalRemaining > 0/);
  assert.match(header,/formatMillions\(contractTotalRemaining\)/);
  assert.match(header,/Contract details unavailable/);
  assert.match(header,/Free Agent/);
});
test('ambient amber and orange blur decoration removed',()=>{
  assert.doesNotMatch(source,/bg-amber-400\/10 blur-3xl/);
  assert.doesNotMatch(source,/bg-orange-500\/20 blur-3xl/);
  assert.match(source,/pc29-hero/);
});
test('other tabs, stats tables and salary option calculations still present',()=>{
  for(const pattern of [/key: "overview"/,/key: "attributes"/,/key: "contract"/,/key: "trends"/,/key: "career"/,/key: "accolades"/,/getContractOptionInfo\(/,/Season by Season/,/salaryByYear\.length \? salaryByYear\.map/])assert.match(source,pattern);
});

console.log(`PASS Player Card Trends: ${tests.length} checks`);
for(const name of tests)console.log(`  ✓ ${name}`);
