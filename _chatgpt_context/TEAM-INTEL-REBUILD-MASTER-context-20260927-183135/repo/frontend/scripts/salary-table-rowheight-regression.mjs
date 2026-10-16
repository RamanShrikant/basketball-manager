import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const salaryPath = path.resolve(here, '../src/pages/SalaryTable.jsx');
const source = fs.readFileSync(salaryPath, 'utf8');

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

const rowHeightRefs = source.match(/height:\s*`\$\{salaryManualTuning\.rowHeight\}px`/g) || [];
const zeroPadRefs = source.match(/paddingTop:\s*0,\s*paddingBottom:\s*0/g) || [];

check(
  'identity uses manual row height',
  /renderSalaryPlayerIdentity[\s\S]*?height:\s*`\$\{salaryManualTuning\.rowHeight\}px`/.test(source),
  'Player identity wrapper should have explicit manual row height.'
);
check(
  'both tables still set tr row height',
  (source.match(/height:\s*`\$\{salaryManualTuning\.rowHeight\}px`/g) || []).length >= 10,
  `Found ${rowHeightRefs.length} row-height references.`
);
check(
  'player cells remove vertical padding',
  zeroPadRefs.length >= 8,
  `Found ${zeroPadRefs.length} zero-vertical-padding cell styles.`
);
check(
  'identity cells permit visual overflow',
  (source.match(/align-middle overflow-visible/g) || []).length >= 2,
  'Both selected-team and all-team identity cells should allow large portraits/rings to remain visible.'
);
check(
  'legacy player-cell py-2 removed',
  !/className="px-4 py-2"[\s\S]{0,120}renderSalaryPlayerIdentity/.test(source),
  'Vertical cell padding would impose a hidden minimum row height.'
);
check(
  'legacy player pos py-3 removed',
  !/className="text-center px-3 py-3 text-white\/85"/.test(source),
  'Position cells should not force rows taller than the manual value.'
);

let failed = 0;
for (const c of checks) {
  const label = c.ok ? 'PASS' : 'FAIL';
  console.log(`${label}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (!c.ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
if (failed) process.exit(1);
