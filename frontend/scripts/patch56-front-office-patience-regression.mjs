import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  TRADE_PATIENCE_SUBMIT_MIN,
  TRADE_PATIENCE_DAILY_RECOVERY,
  applyRejectedTradePatienceDrop,
  getTeamTradePatience,
  getTradePatienceBlockedTeams,
  resetTeamTradePatience,
} from '../src/utils/userTradePatience.js';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const propose = read('src/pages/ProposeTrade.jsx');
const finder = read('src/pages/TradeFinder.jsx');
const patience = read('src/utils/userTradePatience.js');

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (err) {
    checks.push({ name, ok: false, err });
    console.error(`FAIL ${name}`);
    console.error(err?.stack || err);
    process.exitCode = 1;
  }
}

check('patience constants match requested tuning', () => {
  assert.equal(TRADE_PATIENCE_SUBMIT_MIN, 24);
  assert.equal(TRADE_PATIENCE_DAILY_RECOVERY, 3);
  assert.match(patience, /TRADE_PATIENCE_MAX\s*=\s*100/);
  assert.match(patience, /TRADE_PATIENCE_MIN\s*=\s*0/);
});

check('patience defaults to 100 and is negotiable', () => {
  const status = getTeamTradePatience({ leagueData: { seasonYear: 2027 }, userTeamName: 'Brooklyn Nets', cpuTeamName: 'Atlanta Hawks', currentDate: '2027-01-01' });
  assert.equal(status.value, 100);
  assert.equal(status.canNegotiate, true);
});

check('submit threshold is exactly 24', () => {
  const leagueData = {
    seasonYear: 2027,
    userTradePatience: {
      userTeamName: 'Brooklyn Nets',
      byTeamName: { 'atlanta hawks': { teamName: 'Atlanta Hawks', value: 24, lastUpdatedDayKey: 20819 } },
    },
  };
  assert.equal(getTeamTradePatience({ leagueData, userTeamName: 'Brooklyn Nets', cpuTeamName: 'Atlanta Hawks', currentDate: '2027-01-01' }).canNegotiate, true);
  leagueData.userTradePatience.byTeamName['atlanta hawks'].value = 23;
  assert.equal(getTeamTradePatience({ leagueData, userTeamName: 'Brooklyn Nets', cpuTeamName: 'Atlanta Hawks', currentDate: '2027-01-01' }).canNegotiate, false);
});

check('patience recovers exactly three points per day', () => {
  const leagueData = {
    seasonYear: 2027,
    userTradePatience: {
      userTeamName: 'Brooklyn Nets',
      byTeamName: { 'atlanta hawks': { teamName: 'Atlanta Hawks', value: 12, lastUpdatedDayKey: 20819 } },
    },
  };
  assert.equal(getTeamTradePatience({ leagueData, userTeamName: 'Brooklyn Nets', cpuTeamName: 'Atlanta Hawks', currentDate: '2027-01-02' }).value, 15);
  assert.equal(getTeamTradePatience({ leagueData, userTeamName: 'Brooklyn Nets', cpuTeamName: 'Atlanta Hawks', currentDate: '2027-01-05' }).value, 24);
});

check('declined legal offer drops patience and larger shortfall drops more', () => {
  const base = { seasonYear: 2027 };
  const close = applyRejectedTradePatienceDrop({ leagueData: base, userTeamName: 'Brooklyn Nets', cpuTeamName: 'Atlanta Hawks', currentDate: '2027-01-01', decisionMargin: -0.1 });
  const bad = applyRejectedTradePatienceDrop({ leagueData: base, userTeamName: 'Brooklyn Nets', cpuTeamName: 'Atlanta Hawks', currentDate: '2027-01-01', decisionMargin: -5 });
  assert.ok(close.drop >= 4);
  assert.ok(bad.drop > close.drop);
  assert.equal(close.before, 100);
  assert.equal(close.after, 100 - close.drop);
});

check('patience never drops below zero', () => {
  let leagueData = { seasonYear: 2027 };
  for (let i = 0; i < 10; i += 1) {
    leagueData = applyRejectedTradePatienceDrop({ leagueData, userTeamName: 'Brooklyn Nets', cpuTeamName: 'Atlanta Hawks', currentDate: '2027-01-01', decisionMargin: -999 }).leagueData;
  }
  assert.equal(getTeamTradePatience({ leagueData, userTeamName: 'Brooklyn Nets', cpuTeamName: 'Atlanta Hawks', currentDate: '2027-01-01' }).value, 0);
});

check('accepted trade reset restores patience to 100', () => {
  const declined = applyRejectedTradePatienceDrop({ leagueData: { seasonYear: 2027 }, userTeamName: 'Brooklyn Nets', cpuTeamName: 'Atlanta Hawks', currentDate: '2027-01-01', decisionMargin: -20 });
  const reset = resetTeamTradePatience({ leagueData: declined.leagueData, userTeamName: 'Brooklyn Nets', cpuTeamName: 'Atlanta Hawks', currentDate: '2027-01-01' });
  assert.equal(getTeamTradePatience({ leagueData: reset.leagueData, userTeamName: 'Brooklyn Nets', cpuTeamName: 'Atlanta Hawks', currentDate: '2027-01-01' }).value, 100);
});

check('team switch ignores old patience and resets to full', () => {
  const leagueData = {
    seasonYear: 2027,
    userTradePatience: {
      userTeamName: 'Brooklyn Nets',
      byTeamName: { 'atlanta hawks': { teamName: 'Atlanta Hawks', value: 0, lastUpdatedDayKey: 20819 } },
    },
  };
  const status = getTeamTradePatience({ leagueData, userTeamName: 'Toronto Raptors', cpuTeamName: 'Atlanta Hawks', currentDate: '2027-01-01' });
  assert.equal(status.value, 100);
  assert.equal(status.canNegotiate, true);
});

check('Trade Finder blocked teams list excludes low-patience teams', () => {
  const leagueData = {
    seasonYear: 2027,
    userTradePatience: {
      userTeamName: 'Brooklyn Nets',
      byTeamName: {
        'atlanta hawks': { teamName: 'Atlanta Hawks', value: 23, lastUpdatedDayKey: 20819 },
        'boston celtics': { teamName: 'Boston Celtics', value: 24, lastUpdatedDayKey: 20819 },
      },
    },
  };
  const result = getTradePatienceBlockedTeams({ leagueData, userTeamName: 'Brooklyn Nets', teamNames: ['Brooklyn Nets', 'Atlanta Hawks', 'Boston Celtics'], currentDate: '2027-01-01' });
  assert.deepEqual(result.blocked.map((entry) => entry.teamName), ['Atlanta Hawks']);
  assert.deepEqual(result.eligible, ['Boston Celtics']);
});

check('Propose Trade visibly disables Submit Proposal for low patience', () => {
  assert.match(propose, /!cpuPatienceStatus\.canNegotiate/);
  assert.match(propose, /FrontOfficePatienceBar/);
  assert.match(propose, /Patience decreased/);
  assert.match(propose, /resetTeamTradePatience/);
});

check('Propose Trade does not reduce patience for illegal package paths', () => {
  const illegalIndex = propose.indexOf('if (!userRuleValidation.ok)');
  const dropIndex = propose.lastIndexOf('applyRejectedTradePatienceDrop');
  assert.ok(illegalIndex > 0 && dropIndex > illegalIndex, 'patience drop must happen after legal validation and CPU evaluation only');
});

check('Trade Finder excludes low-patience teams before expensive search', () => {
  const blockIndex = finder.indexOf('if (tradeFinderPatienceBlocked)');
  const searchIndex = finder.indexOf('setIsSearchingOffers(true)');
  const passIndex = finder.indexOf('teams: searchableTeams');
  assert.ok(blockIndex > 0 && blockIndex < searchIndex, 'blocked teams must stop before search begins');
  assert.ok(passIndex > 0, 'standard Finder must receive patience-filtered teams');
});

check('Reverse Trade Finder is blocked when target team lacks patience', () => {
  assert.match(finder, /reversePatienceBlocked/);
  assert.match(finder, /Patience Locked/);
  assert.match(finder, /not taking trade calls/);
});

check('Trade Finder browsing itself does not drain patience', () => {
  assert.doesNotMatch(finder, /applyRejectedTradePatienceDrop/);
});

if (process.exitCode) {
  console.error('\nPatch 56 front-office patience regression: FAIL');
  process.exit(process.exitCode);
}
console.log('\nPatch 56 front-office patience regression: PASS');
