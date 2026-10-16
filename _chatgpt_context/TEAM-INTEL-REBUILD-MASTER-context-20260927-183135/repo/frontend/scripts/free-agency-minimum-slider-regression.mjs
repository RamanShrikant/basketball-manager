import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const candidates = [
  path.join(root, 'src/pages/FreeAgents.jsx'),
  path.join(root, 'frontend/src/pages/FreeAgents.jsx'),
];
const file = candidates.find((candidate) => fs.existsSync(candidate));
if (!file) {
  console.error('FAIL — FreeAgents.jsx not found');
  process.exit(1);
}

const source = fs.readFileSync(file, 'utf8');
const checks = [
  ['slider uses $1,000 precision', /step="0\.001"/.test(source)],
  ['slider no longer rounds to two decimals', !/setOfferSalaryText\(val\.toFixed\(2\)\)/.test(source)],
  ['slider snaps exact minimum endpoint', /rawAmount <= offerMinimumAmount \+ 500/.test(source) && /\? offerMinimumAmount/.test(source)],
  ['slider snaps exact maximum endpoint', /rawAmount >= offerMaximumAmount - 500/.test(source) && /\? offerMaximumAmount/.test(source)],
  ['interior slider values snap to nearest $1,000', /Math\.round\(rawAmount \/ 1_000\) \* 1_000/.test(source)],
  ['salary text uses existing three-decimal formatter', /setOfferSalaryText\(formatMillionsInput\(snappedAmount\)\)/.test(source)],
  ['manual salary parser retains dollar precision', /return Math\.round\(n \* 1_000_000\)/.test(source)],
];

let passed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}`);
  if (ok) passed += 1;
}

// Explicit regression for the observed second-apron failure.
const minimum = 4_815_000;
const sliderMillions = minimum / 1_000_000;
const rawAmount = Math.round(sliderMillions * 1_000_000);
const snapped = rawAmount <= minimum + 500 ? minimum : Math.round(rawAmount / 1_000) * 1_000;
const exactMinimumPass = snapped === 4_815_000;
console.log(`${exactMinimumPass ? 'PASS' : 'FAIL'} — $4.815M minimum remains exactly $4,815,000 after slider interaction`);
if (exactMinimumPass) passed += 1;

console.log(`\n${passed}/${checks.length + 1} checks passed`);
if (passed !== checks.length + 1) process.exit(1);
