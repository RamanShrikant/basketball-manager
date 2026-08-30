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
const postDraftPreOptions = { ...preDraft, stage: 'post_draft', draftComplete: true };
const afterOptions = { ...postDraftPreOptions, optionsComplete: true };

const najiStyleExpiring = {
  name: 'Expiring Veteran',
  contract: { startYear: 2026, salaryByYear: [9_000_000], option: null },
};
const grayson = {
  name: 'Player Option Veteran',
  contract: {
    startYear: 2026,
    salaryByYear: [18_125_000, 19_375_000],
    option: { type: 'player', yearIndices: [1], picked: null },
  },
};
const kon = {
  name: 'Team Option Rookie',
  contract: {
    startYear: 2026,
    salaryByYear: [10_516_560, 11_017_560, 13_937_214],
    option: { type: 'team', yearIndices: [1, 2], picked: null },
  },
};
const development = {
  name: 'Two Way Player',
  isTwoWay: true,
  contract: { startYear: 2026, salaryByYear: [600_000] },
};
const unsigned = {
  name: 'Unsigned Rookie',
  rookieSigningPending: true,
  contract: null,
};

check('expiring roster player is tradeable before draft', () => {
  const result = getTradePlayerEligibility(najiStyleExpiring, { tradeContext: preDraft });
  assert.equal(result.eligible, true);
  assert.equal(result.code, 'PRE_DRAFT_ROSTER_CONTRACT');
  assert.equal(result.salary, 9_000_000);
});

check('expiring roster player is tradeable during live draft', () => {
  assert.equal(getTradePlayerEligibility(najiStyleExpiring, { tradeContext: liveDraft }).eligible, true);
});

check('unresolved player option is tradeable before draft', () => {
  const result = getTradePlayerEligibility(grayson, { tradeContext: preDraft });
  assert.equal(result.eligible, true);
  assert.equal(result.code, 'PRE_DRAFT_ROSTER_CONTRACT');
  assert.equal(result.unresolvedOptionTransfers, true);
});

check('unresolved team option is tradeable before draft', () => {
  const result = getTradePlayerEligibility(kon, { tradeContext: preDraft });
  assert.equal(result.eligible, true);
  assert.equal(result.code, 'PRE_DRAFT_ROSTER_CONTRACT');
  assert.equal(result.unresolvedOptionTransfers, true);
});

check('same simple rule remains active until normal options processing', () => {
  assert.equal(getTradePlayerEligibility(najiStyleExpiring, { tradeContext: postDraftPreOptions }).eligible, true);
});

check('after options processing an expired contract is no longer tradeable', () => {
  const result = getTradePlayerEligibility(najiStyleExpiring, { tradeContext: afterOptions });
  assert.equal(result.eligible, false);
  assert.equal(result.code, 'EXPIRING_CONTRACT');
});

check('after options processing an unresolved future team option uses normal option rules', () => {
  const result = getTradePlayerEligibility(kon, { tradeContext: afterOptions });
  assert.equal(result.eligible, false);
  assert.equal(result.code, 'PENDING_TEAM_OPTION');
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
  const result = getTradePlayerEligibility(najiStyleExpiring, { inOffseason: false });
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
