import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), process.cwd().endsWith('frontend') ? '.' : 'frontend');
const files = {
  finder: fs.readFileSync(path.join(root, 'src/pages/TradeFinder.jsx'), 'utf8'),
  propose: fs.readFileSync(path.join(root, 'src/pages/ProposeTrade.jsx'), 'utf8'),
  execution: fs.readFileSync(path.join(root, 'src/utils/tradeExecution.js'), 'utf8'),
  rules: fs.readFileSync(path.join(root, 'src/utils/userTradeRules.js'), 'utf8'),
  eligibility: fs.readFileSync(path.join(root, 'src/utils/tradeRosterEligibility.js'), 'utf8'),
};

const checks = [];
const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });
for (const [name, src] of Object.entries(files)) {
  if (name === 'eligibility') continue;
  check(`${name} uses offseason target season`, src.includes('targetSeasonYear'));
}
check('finder removed prior-season one-year salary remap', !files.finder.includes('salaries.length === 1 && startYear === payrollSeasonYear - 1'));
check('propose removed prior-season one-year salary remap', !files.propose.includes('salaries.length === 1 && startYear === payrollSeasonYear - 1'));
check('execution salary returns zero outside contract range', /function getSalaryForPayrollYear[\s\S]*?if \(idx >= 0 && idx < salaries\.length\)[\s\S]*?return 0;/.test(files.execution));
check('offseason eligibility requires upcoming guaranteed salary', files.eligibility.includes('GUARANTEED_NEXT_SEASON') && files.eligibility.includes('EXPIRING_CONTRACT'));
check('pending player option is blocked', files.eligibility.includes('PENDING_PLAYER_OPTION'));
check('pending team option is blocked', files.eligibility.includes('PENDING_TEAM_OPTION'));

console.table(checks.map((row) => ({ check: row.name, result: row.ok ? 'PASS' : 'FAIL' })));
const failed = checks.filter((row) => !row.ok);
if (failed.length) {
  console.error(`offseason-trade-salary-regression: ${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(1);
}
console.log(`offseason-trade-salary-regression: ${checks.length}/${checks.length} PASS`);
