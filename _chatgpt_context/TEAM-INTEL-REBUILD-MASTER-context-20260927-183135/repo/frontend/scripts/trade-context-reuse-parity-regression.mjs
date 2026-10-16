import assert from 'node:assert/strict';

class StorageShim {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
  setItem(key, value) { this.map.set(String(key), String(value)); }
  removeItem(key) { this.map.delete(String(key)); }
  clear() { this.map.clear(); }
}

globalThis.localStorage = new StorageShim();
globalThis.sessionStorage = new StorageShim();

const rules = await import('../src/utils/userTradeRules.js');
const { getOffseasonTradeContext } = await import('../src/utils/offseasonTradeContext.js');

function pick({ year, owner, original = owner, round = 1, protection = 'Unprotected' }) {
  return {
    id: `${year}-${round}-${owner}-${original}`,
    year,
    round,
    ownerTeam: owner,
    originalTeam: original,
    protection,
    protections: protection,
    displayProtection: protection,
    status: 'active',
    type: 'pick',
    assetType: 'pick',
  };
}

function player(name, salary) {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    overall: 80,
    potential: 82,
    age: 26,
    contract: { startYear: 2027, salaryByYear: [salary, salary] },
  };
}

function leagueFixture() {
  const alpha = [player('Alpha One', 90_000_000), player('Alpha Two', 25_000_000)];
  const beta = [player('Beta One', 90_000_000), player('Beta Two', 25_000_000)];
  const draftPicks = [];
  for (const year of [2027, 2028, 2029, 2030, 2031, 2032, 2033]) {
    draftPicks.push(pick({ year, owner: 'Alpha' }));
    draftPicks.push(pick({ year, owner: 'Beta' }));
  }
  return {
    seasonStartYear: 2026,
    currentSeasonYear: 2026,
    seasonYear: 2026,
    contractSeasonYear: 2027,
    teams: [
      { name: 'Alpha', players: alpha },
      { name: 'Beta', players: beta },
    ],
    draftPicks,
    settings: { tradeRules: {} },
    financials: {
      baseSeasonYear: 2027,
      currentSeasonYear: 2027,
      annualInflationRate: 0,
      baseRules: {
        salaryCap: 140_000_000,
        luxuryTaxLine: 170_000_000,
        minimumTeamSalary: 120_000_000,
        firstApron: 178_000_000,
        secondApron: 189_000_000,
        hardCap: 189_000_000,
      },
    },
  };
}

function resetStorage() {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('bm_league_clock_v1', JSON.stringify({
    date: '2027-02-03',
    seasonYear: 2026,
    phase: 'regularSeason',
  }));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function compareCase(name, implicitFn, explicitFn) {
  resetStorage();
  const a = leagueFixture();
  const implicit = normalize(implicitFn(a));

  resetStorage();
  const b = leagueFixture();
  const context = getOffseasonTradeContext(b);
  const explicit = normalize(explicitFn(b, context));

  assert.deepEqual(explicit, implicit, `${name} changed when explicit context was reused`);
  console.log(`PASS ${name}`);
}

compareCase(
  'current date parity',
  (league) => rules.getUserTradeCurrentDate(league),
  (league, context) => rules.getUserTradeCurrentDate(league, context),
);

compareCase(
  'deadline status parity',
  (league) => rules.getUserTradeDeadlineStatus(league),
  (league, context) => rules.getUserTradeDeadlineStatus(league, context),
);

compareCase(
  'player salary parity',
  (league) => rules.getUserTradePlayerSalary(league.teams[0].players[1], league),
  (league, context) => rules.getUserTradePlayerSalary(league.teams[0].players[1], league, context),
);

compareCase(
  'side salary parity',
  (league) => rules.getUserTradeSideSalary([{ type: 'player', player: league.teams[0].players[1] }], league),
  (league, context) => rules.getUserTradeSideSalary([{ type: 'player', player: league.teams[0].players[1] }], league, context),
);

compareCase(
  'player eligibility parity',
  (league) => rules.getUserTradePlayerEligibility({ leagueData: league, teamName: 'Alpha', player: league.teams[0].players[1] }),
  (league, context) => rules.getUserTradePlayerEligibility({ leagueData: league, teamName: 'Alpha', player: league.teams[0].players[1], context }),
);

compareCase(
  'pick eligibility parity',
  (league) => rules.getUserTradePickEligibility({
    leagueData: league,
    teamName: 'Alpha',
    pick: league.draftPicks.find((row) => row.ownerTeam === 'Alpha' && row.year === 2029),
    outgoingItems: [],
    incomingItems: [],
  }),
  (league, context) => rules.getUserTradePickEligibility({
    leagueData: league,
    teamName: 'Alpha',
    pick: league.draftPicks.find((row) => row.ownerTeam === 'Alpha' && row.year === 2029),
    outgoingItems: [],
    incomingItems: [],
    context,
  }),
);

compareCase(
  'asset package parity',
  (league) => rules.validateUserTradeAssetPackage({
    leagueData: league,
    teamName: 'Alpha',
    outgoingItems: [{ type: 'player', player: league.teams[0].players[1] }],
    incomingItems: [],
  }),
  (league, context) => rules.validateUserTradeAssetPackage({
    leagueData: league,
    teamName: 'Alpha',
    outgoingItems: [{ type: 'player', player: league.teams[0].players[1] }],
    incomingItems: [],
    context,
  }),
);

compareCase(
  'financial legality parity',
  (league) => rules.evaluateUserTradeFinancialLegality({
    leagueData: league,
    team: league.teams[0],
    outgoingItems: [{ type: 'player', player: league.teams[0].players[1] }],
    incomingItems: [{ type: 'player', player: league.teams[1].players[1] }],
  }),
  (league, context) => rules.evaluateUserTradeFinancialLegality({
    leagueData: league,
    team: league.teams[0],
    outgoingItems: [{ type: 'player', player: league.teams[0].players[1] }],
    incomingItems: [{ type: 'player', player: league.teams[1].players[1] }],
    context,
  }),
);

compareCase(
  'full user trade validation parity',
  (league) => rules.validateUserTradeRules({
    leagueData: league,
    userTeam: league.teams[0],
    cpuTeam: league.teams[1],
    userTeamName: 'Alpha',
    cpuTeamName: 'Beta',
    userItems: [{ type: 'player', player: league.teams[0].players[1] }],
    cpuItems: [{ type: 'player', player: league.teams[1].players[1] }],
    includeDeadline: true,
    includeFinancial: true,
  }),
  (league, context) => rules.validateUserTradeRules({
    leagueData: league,
    userTeam: league.teams[0],
    cpuTeam: league.teams[1],
    userTeamName: 'Alpha',
    cpuTeamName: 'Beta',
    userItems: [{ type: 'player', player: league.teams[0].players[1] }],
    cpuItems: [{ type: 'player', player: league.teams[1].players[1] }],
    includeDeadline: true,
    includeFinancial: true,
    context,
  }),
);

console.log('9/9 explicit-context parity checks passed.');
