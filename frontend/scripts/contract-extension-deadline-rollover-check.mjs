import assert from 'node:assert/strict';
import {
  getSeasonCalendarConfig,
  withNormalizedSeasonContext,
  withOffseasonSeasonContext,
} from '../src/utils/seasonContext.js';

function assertCalendar(label, league, expected) {
  const cfg = getSeasonCalendarConfig(league);
  assert.equal(cfg.rookieExtensionDeadlineDate, expected.rookie, `${label}: rookie deadline`);
  assert.equal(cfg.contractExtensionDeadlineDate, expected.rookie, `${label}: legacy rookie alias`);
  assert.equal(cfg.extensionDeadlineDate, expected.rookie, `${label}: extension alias`);
  assert.equal(cfg.veteranExtensionDeadlineDate, expected.veteran, `${label}: veteran deadline`);
  assert.equal(cfg.veteranContractExtensionDeadlineDate, expected.veteran, `${label}: veteran alias`);
  return cfg;
}

const y1 = withNormalizedSeasonContext({
  seasonStartYear: 2026,
  seasonYear: 2026,
  currentSeasonYear: 2026,
  displaySeasonYear: 2027,
  calendar: {},
});
assertCalendar('Y1 defaults', y1, { rookie: '2026-10-20', veteran: '2027-03-31' });

const y2Stale = withNormalizedSeasonContext({
  seasonStartYear: 2027,
  seasonYear: 2027,
  currentSeasonYear: 2027,
  displaySeasonYear: 2028,
  calendar: {
    regularSeasonStart: '2027-10-01',
    regularSeasonGameStart: '2027-10-21',
    regularSeasonEnd: '2028-04-12',
    rookieExtensionDeadlineDate: '2026-10-20',
    contractExtensionDeadlineDate: '2026-10-20',
    extensionDeadlineDate: '2026-10-20',
    veteranExtensionDeadlineDate: '2027-03-31',
    veteranContractExtensionDeadlineDate: '2027-03-31',
  },
});
assertCalendar('Y2 stale save self-heal', y2Stale, { rookie: '2027-10-20', veteran: '2028-03-31' });

const y2 = withOffseasonSeasonContext(y1, 2027);
assertCalendar('Y2 offseason advance', y2, { rookie: '2027-10-20', veteran: '2028-03-31' });

const y3 = withOffseasonSeasonContext(y2, 2028);
assertCalendar('Y3 offseason advance', y3, { rookie: '2028-10-20', veteran: '2029-03-31' });

console.log('PASS contract-extension deadline rollover checks');
