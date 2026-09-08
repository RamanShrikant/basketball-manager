import assert from 'node:assert/strict';
import {
  getOffseasonGuaranteedContractStatus,
  getTradePlayerEligibility,
} from '../src/utils/tradeRosterEligibility.js';

const checks = [];
const check = (name, fn) => {
  try {
    fn();
    checks.push({ name, status: 'PASS' });
  } catch (error) {
    checks.push({ name, status: 'FAIL', error: error?.message || String(error) });
  }
};

const preDraft = {
  version: 3,
  seasonYear: 2027,
  targetSeasonYear: 2028,
  inOffseason: true,
  stage: 'post_lottery_pre_draft',
  optionsComplete: false,
};
const liveDraft = { ...preDraft, stage: 'live_draft' };
const afterOptions = { ...preDraft, stage: 'post_options', optionsComplete: true };

const expiring = {
  name: 'Expiring Veteran',
  contract: { startYear: 2027, salaryByYear: [33_000_000], option: null },
};
const guaranteed = {
  name: 'Guaranteed Veteran',
  contract: { startYear: 2027, salaryByYear: [18_000_000, 19_000_000], option: null },
};
const playerOptionPending = {
  name: 'Player Option Veteran',
  contract: {
    startYear: 2027,
    salaryByYear: [18_125_000, 19_375_000],
    option: { type: 'player', yearIndices: [1], picked: null },
  },
};
const teamOptionPending = {
  name: 'Team Option Rookie',
  contract: {
    startYear: 2027,
    salaryByYear: [10_516_560, 11_017_560, 13_937_214],
    option: { type: 'team', yearIndices: [1, 2], picked: null },
  },
};
const teamOptionPicked = {
  ...teamOptionPending,
  contract: {
    ...teamOptionPending.contract,
    option: { ...teamOptionPending.contract.option, picked: { 1: true, 2: null } },
  },
};
const development = {
  name: 'Two Way Player',
  isTwoWay: true,
  contract: { startYear: 2027, salaryByYear: [600_000, 650_000] },
};
const unsigned = {
  name: 'Unsigned Rookie',
  rookieSigningPending: true,
  contract: null,
};

check('expiring player is blocked before draft', () => {
  const result = getTradePlayerEligibility(expiring, { tradeContext: preDraft });
  assert.equal(result.eligible, false);
  assert.equal(result.code, 'EXPIRING_CONTRACT');
});

check('expiring player remains blocked during live draft', () => {
  assert.equal(getTradePlayerEligibility(expiring, { tradeContext: liveDraft }).eligible, false);
});

check('guaranteed upcoming salary is tradeable and uses upcoming salary', () => {
  const result = getTradePlayerEligibility(guaranteed, { tradeContext: preDraft });
  assert.equal(result.eligible, true);
  assert.equal(result.code, 'GUARANTEED_NEXT_SEASON');
  assert.equal(result.salary, 19_000_000);
});

check('pending player option is not guaranteed', () => {
  const result = getTradePlayerEligibility(playerOptionPending, { tradeContext: preDraft });
  assert.equal(result.eligible, false);
  assert.equal(result.code, 'PENDING_PLAYER_OPTION');
});

check('pending team option is not guaranteed', () => {
  const result = getTradePlayerEligibility(teamOptionPending, { tradeContext: preDraft });
  assert.equal(result.eligible, false);
  assert.equal(result.code, 'PENDING_TEAM_OPTION');
});

check('exercised upcoming option becomes tradeable', () => {
  const result = getTradePlayerEligibility(teamOptionPicked, { tradeContext: afterOptions });
  assert.equal(result.eligible, true);
  assert.equal(result.salary, 11_017_560);
});

check('two-way/development players remain blocked', () => {
  const result = getTradePlayerEligibility(development, { tradeContext: preDraft });
  assert.equal(result.eligible, false);
  assert.equal(result.code, 'DEVELOPMENT_ROSTER');
});

check('unsigned rookies remain blocked', () => {
  const result = getOffseasonGuaranteedContractStatus(unsigned, { tradeContext: preDraft });
  assert.equal(result.eligible, false);
  assert.equal(result.code, 'UNSIGNED_ROOKIE');
});

check('regular-season standard player eligibility is unchanged', () => {
  const result = getTradePlayerEligibility(expiring, { inOffseason: false });
  assert.equal(result.eligible, true);
  assert.equal(result.code, 'STANDARD_ROSTER');
});

console.table(checks);
const failures = checks.filter((row) => row.status !== 'PASS');
if (failures.length) {
  console.error(`${failures.length}/${checks.length} draft-day trade checks failed.`);
  process.exit(1);
}
console.log(`${checks.length}/${checks.length} draft-day trade checks passed.`);
