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

function pick({ year, owner = 'Alpha', original = 'Alpha', round = 1, protection = 'Unprotected', assetType = 'pick', id = null, swapWithTeam = '' }) {
  return {
    id: id || `${assetType}-${year}-${round}-${original}-${owner}-${swapWithTeam}`,
    assetType,
    type: assetType,
    year,
    round,
    originalTeam: original,
    ownerTeam: owner,
    protections: protection,
    displayProtection: protection,
    status: 'active',
    swapWithTeam,
  };
}

function player(name, salary = 10_000_000, extra = {}) {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    contract: { startYear: 2027, salaryByYear: [salary, salary] },
    ...extra,
  };
}

function itemForPlayer(row) {
  return { type: 'player', player: row };
}

function baseLeague(overrides = {}) {
  const alphaPlayers = [player('Alpha One', 125_000_000), player('Alpha Two', 120_000_000)];
  const betaPlayers = [player('Beta One', 125_000_000), player('Beta Two', 120_000_000)];
  const draftPicks = [];
  for (const year of [2027, 2028, 2029, 2030, 2031, 2032, 2033]) {
    draftPicks.push(pick({ year, owner: 'Alpha', original: 'Alpha' }));
    draftPicks.push(pick({ year, owner: 'Beta', original: 'Beta' }));
  }
  return {
    seasonStartYear: 2026,
    currentSeasonYear: 2026,
    seasonYear: 2026,
    contractSeasonYear: 2027,
    teams: [
      { name: 'Alpha', players: alphaPlayers },
      { name: 'Beta', players: betaPlayers },
    ],
    draftPicks,
    settings: { tradeRules: {} },
    ...overrides,
  };
}

function financialLeague({
  alphaSalaries = [80_000_000, 20_000_000],
  betaSalaries = [80_000_000, 20_000_000],
  settings = {},
} = {}) {
  const league = baseLeague({
    financials: {
      baseSeasonYear: 2027,
      currentSeasonYear: 2027,
      annualInflationRate: 0,
      baseRules: {
        salaryCap: 100_000_000,
        luxuryTaxLine: 110_000_000,
        minimumTeamSalary: 90_000_000,
        firstApron: 120_000_000,
        secondApron: 140_000_000,
        hardCap: 150_000_000,
      },
    },
    settings: { tradeRules: settings },
  });
  league.teams[0].players = alphaSalaries.map((salary, index) => player(`Alpha Salary ${index + 1}`, salary));
  league.teams[1].players = betaSalaries.map((salary, index) => player(`Beta Salary ${index + 1}`, salary));
  return league;
}

function first(league, teamName, year) {
  return league.draftPicks.find(row => row.ownerTeam === teamName && row.year === year && row.round === 1);
}

function findPlayer(league, teamName, name) {
  return league.teams.find(team => team.name === teamName)?.players.find(row => row.name === name);
}

let passed = 0;
function test(name, fn) {
  try {
    localStorage.clear();
    sessionStorage.clear();
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test('all ten rules default to enabled', () => {
  const settings = rules.getUserTradeRuleSettings(baseLeague());
  assert.equal(Object.keys(settings).length, 10);
  assert.equal(Object.values(settings).every(Boolean), true);
});

test('deadline toggle off overrides a stored lock', () => {
  localStorage.setItem('bm_trade_deadline_status_v1', JSON.stringify({ locked: true, deadlineDate: '2027-02-04' }));
  const league = baseLeague({ settings: { tradeRules: { tradeDeadline: false } } });
  assert.equal(rules.getUserTradeDeadlineStatus(league).locked, false);
});

test('deadline lock is recovered from the league clock when storage status is missing', () => {
  localStorage.setItem('bm_league_clock_v1', JSON.stringify({ date: '2027-02-05', seasonYear: 2026, phase: 'regularSeason' }));
  const result = rules.getUserTradeDeadlineStatus(baseLeague());
  assert.equal(result.locked, true);
  assert.equal(result.deadlineDate, '2027-02-04');
});

test('salary matching blocks an over-cap mismatch when enabled', () => {
  const league = financialLeague({
    alphaSalaries: [105_000_000, 5_000_000],
    betaSalaries: [80_000_000, 30_000_000],
    settings: { firstApron: false, secondApron: false, hardCapApronCeiling: false },
  });
  const result = rules.evaluateUserTradeFinancialLegality({
    leagueData: league,
    team: league.teams[0],
    outgoingItems: [itemForPlayer(league.teams[0].players[1])],
    incomingItems: [itemForPlayer(league.teams[1].players[1])],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'salary_matching');
});

test('salary matching toggle off skips only the salary matching formula', () => {
  const league = financialLeague({
    alphaSalaries: [105_000_000, 5_000_000],
    betaSalaries: [80_000_000, 30_000_000],
    settings: { salaryMatching: false, firstApron: false, secondApron: false, hardCapApronCeiling: false },
  });
  const result = rules.evaluateUserTradeFinancialLegality({
    leagueData: league,
    team: league.teams[0],
    outgoingItems: [itemForPlayer(league.teams[0].players[1])],
    incomingItems: [itemForPlayer(league.teams[1].players[1])],
  });
  assert.equal(result.ok, true);
});

test('first apron independently blocks receiving more salary', () => {
  const league = financialLeague({
    alphaSalaries: [110_000_000, 15_000_000],
    betaSalaries: [104_000_000, 16_000_000],
    settings: { salaryMatching: false, secondApron: false, hardCapApronCeiling: false },
  });
  const result = rules.evaluateUserTradeFinancialLegality({
    leagueData: league,
    team: league.teams[0],
    outgoingItems: [itemForPlayer(league.teams[0].players[1])],
    incomingItems: [itemForPlayer(league.teams[1].players[1])],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'first_apron_salary');
});

test('second apron independently blocks receiving more salary', () => {
  const league = financialLeague({
    alphaSalaries: [130_000_000, 15_000_000],
    betaSalaries: [124_000_000, 16_000_000],
    settings: { salaryMatching: false, firstApron: false, hardCapApronCeiling: false },
  });
  const result = rules.evaluateUserTradeFinancialLegality({
    leagueData: league,
    team: league.teams[0],
    outgoingItems: [itemForPlayer(league.teams[0].players[1])],
    incomingItems: [itemForPlayer(league.teams[1].players[1])],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'second_apron_salary');
});

test('second apron blocks aggregating two players for one larger player', () => {
  const league = financialLeague({
    alphaSalaries: [125_000_000, 10_000_000, 10_000_000],
    betaSalaries: [125_000_000, 15_000_000],
    settings: { salaryMatching: false, firstApron: false, hardCapApronCeiling: false },
  });
  const result = rules.evaluateUserTradeFinancialLegality({
    leagueData: league,
    team: league.teams[0],
    outgoingItems: [itemForPlayer(league.teams[0].players[1]), itemForPlayer(league.teams[0].players[2])],
    incomingItems: [itemForPlayer(league.teams[1].players[1])],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'second_apron_aggregation');
});

test('hard cap independently blocks a trade that crosses the ceiling', () => {
  const league = financialLeague({
    alphaSalaries: [135_000_000, 10_000_000],
    betaSalaries: [120_000_000, 20_000_000],
    settings: { salaryMatching: false, firstApron: false, secondApron: false },
  });
  const result = rules.evaluateUserTradeFinancialLegality({
    leagueData: league,
    team: league.teams[0],
    outgoingItems: [itemForPlayer(league.teams[0].players[1])],
    incomingItems: [itemForPlayer(league.teams[1].players[1])],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'hard_cap');
});

test('recently acquired player is locked for 30 days with exact date', () => {
  localStorage.setItem('bm_league_clock_v1', JSON.stringify({ date: '2027-01-20', seasonYear: 2026 }));
  const league = baseLeague();
  const target = league.teams[0].players[0];
  target.tradeRestrictions = { acquiredDate: '2027-01-05', acquiredTradeEligibleDate: '2027-02-04' };
  const result = rules.getUserTradePlayerEligibility({ leagueData: league, teamName: 'Alpha', player: target });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'recently_acquired');
  assert.equal(result.eligibleDate, '2027-02-04');
});

test('recently acquired toggle off makes the player selectable', () => {
  localStorage.setItem('bm_league_clock_v1', JSON.stringify({ date: '2027-01-20', seasonYear: 2026 }));
  const league = baseLeague({ settings: { tradeRules: { recentlyAcquired: false } } });
  const target = league.teams[0].players[0];
  target.tradeRestrictions = { acquiredDate: '2027-01-05', acquiredTradeEligibleDate: '2027-02-04' };
  assert.equal(rules.getUserTradePlayerEligibility({ leagueData: league, teamName: 'Alpha', player: target }).ok, true);
});

test('embedded user-trade clock keeps worker validation date-aware', () => {
  const league = baseLeague({ __userTradeRules: { currentDate: '2027-01-20' } });
  const target = league.teams[0].players[0];
  target.tradeRestrictions = { acquiredDate: '2027-01-05', acquiredTradeEligibleDate: '2027-02-04' };
  const result = rules.getUserTradePlayerEligibility({ leagueData: league, teamName: 'Alpha', player: target });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'recently_acquired');
});

test('recently signed free agent is locked until December 15', () => {
  localStorage.setItem('bm_league_clock_v1', JSON.stringify({ date: '2027-11-20', seasonYear: 2027 }));
  const league = baseLeague({ seasonStartYear: 2027, currentSeasonYear: 2027, seasonYear: 2027, contractSeasonYear: 2027 });
  const target = league.teams[0].players[0];
  target.tradeRestrictions = { freeAgentSignedDate: '2027-07-04', freeAgentTradeEligibleDate: '2027-12-15' };
  const result = rules.getUserTradePlayerEligibility({ leagueData: league, teamName: 'Alpha', player: target });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'recently_signed');
  assert.equal(result.eligibleDate, '2027-12-15');
});

test('recently signed free agent unlocks on eligibility date', () => {
  localStorage.setItem('bm_league_clock_v1', JSON.stringify({ date: '2027-12-15', seasonYear: 2027 }));
  const league = baseLeague({ seasonStartYear: 2027, currentSeasonYear: 2027, seasonYear: 2027, contractSeasonYear: 2027 });
  const target = league.teams[0].players[0];
  target.tradeRestrictions = { freeAgentSignedDate: '2027-07-04', freeAgentTradeEligibleDate: '2027-12-15' };
  assert.equal(rules.getUserTradePlayerEligibility({ leagueData: league, teamName: 'Alpha', player: target }).ok, true);
});

test('recently signed toggle off makes the free agent selectable', () => {
  localStorage.setItem('bm_league_clock_v1', JSON.stringify({ date: '2027-11-20', seasonYear: 2027 }));
  const league = baseLeague({ settings: { tradeRules: { recentlySigned: false } } });
  const target = league.teams[0].players[0];
  target.tradeRestrictions = { freeAgentSignedDate: '2027-07-04', freeAgentTradeEligibleDate: '2027-12-15' };
  assert.equal(rules.getUserTradePlayerEligibility({ leagueData: league, teamName: 'Alpha', player: target }).ok, true);
});

test('newly drafted rookie is locked until July 30', () => {
  localStorage.setItem('bm_league_clock_v1', JSON.stringify({ date: '2027-07-10', seasonYear: 2027 }));
  const league = baseLeague({ seasonStartYear: 2027, currentSeasonYear: 2027, seasonYear: 2027, contractSeasonYear: 2027 });
  const target = league.teams[0].players[0];
  target.tradeRestrictions = { rookieSignedDate: '2027-06-30', rookieTradeEligibleDate: '2027-07-30' };
  const result = rules.getUserTradePlayerEligibility({ leagueData: league, teamName: 'Alpha', player: target });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'newly_drafted_rookie');
  assert.equal(result.eligibleDate, '2027-07-30');
});

test('newly drafted rookie toggle off makes the rookie selectable', () => {
  localStorage.setItem('bm_league_clock_v1', JSON.stringify({ date: '2027-07-10', seasonYear: 2027 }));
  const league = baseLeague({ settings: { tradeRules: { newlyDraftedRookie: false } } });
  const target = league.teams[0].players[0];
  target.tradeRestrictions = { rookieSignedDate: '2027-06-30', rookieTradeEligibleDate: '2027-07-30' };
  assert.equal(rules.getUserTradePlayerEligibility({ leagueData: league, teamName: 'Alpha', player: target }).ok, true);
});

test('recently extended player reads signed date from contract extension metadata', () => {
  localStorage.setItem('bm_league_clock_v1', JSON.stringify({ date: '2027-07-30', seasonYear: 2027 }));
  const league = baseLeague({ seasonStartYear: 2027, currentSeasonYear: 2027, seasonYear: 2027, contractSeasonYear: 2027 });
  const target = league.teams[0].players[0];
  target.contract = { ...target.contract, extensionMeta: { signedDate: '2027-01-31' } };
  const result = rules.getUserTradePlayerEligibility({ leagueData: league, teamName: 'Alpha', player: target });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'recently_extended');
  assert.equal(result.eligibleDate, '2027-07-31');
});

test('recently extended toggle off makes the extended player selectable', () => {
  localStorage.setItem('bm_league_clock_v1', JSON.stringify({ date: '2027-07-30', seasonYear: 2027 }));
  const league = baseLeague({ settings: { tradeRules: { recentlyExtended: false } } });
  const target = league.teams[0].players[0];
  target.contract = { ...target.contract, extensionMeta: { signedDate: '2027-01-31' } };
  assert.equal(rules.getUserTradePlayerEligibility({ leagueData: league, teamName: 'Alpha', player: target }).ok, true);
});

test('Stepien dynamically locks the second consecutive outgoing first', () => {
  const league = baseLeague();
  const outgoing = [{ type: 'pick', pick: first(league, 'Alpha', 2027), tradeRule: { action: 'full' } }];
  const result = rules.getUserTradePickEligibility({
    leagueData: league,
    teamName: 'Alpha',
    pick: first(league, 'Alpha', 2028),
    item: { type: 'pick', pick: first(league, 'Alpha', 2028), tradeRule: { action: 'full' } },
    outgoingItems: outgoing,
    incomingItems: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'stepien_rule');
  assert.deepEqual(result.violationYears, [2027, 2028]);
});

test('Stepien toggle off restores otherwise locked consecutive future firsts', () => {
  const league = baseLeague({ settings: { tradeRules: { stepienRule: false } } });
  const outgoing = [{ type: 'pick', pick: first(league, 'Alpha', 2027), tradeRule: { action: 'full' } }];
  const result = rules.getUserTradePickEligibility({
    leagueData: league,
    teamName: 'Alpha',
    pick: first(league, 'Alpha', 2028),
    item: { type: 'pick', pick: first(league, 'Alpha', 2028), tradeRule: { action: 'full' } },
    outgoingItems: outgoing,
    incomingItems: [],
  });
  assert.equal(result.ok, true);
});

test('an incoming unprotected first can satisfy Stepien', () => {
  const league = baseLeague();
  const outgoing = [
    { type: 'pick', pick: first(league, 'Alpha', 2027), tradeRule: { action: 'full' } },
    { type: 'pick', pick: first(league, 'Alpha', 2028), tradeRule: { action: 'full' } },
  ];
  const incoming = [{ type: 'pick', pick: first(league, 'Beta', 2027), tradeRule: { action: 'full' } }];
  const result = rules.validateUserTradeAssetPackage({ leagueData: league, teamName: 'Alpha', outgoingItems: outgoing, incomingItems: incoming });
  assert.equal(result.ok, true);
});

test('an incoming protected first does not satisfy Stepien', () => {
  const league = baseLeague();
  const protectedPick = { ...first(league, 'Beta', 2027), protections: 'Top 10 Protected', displayProtection: 'Top 10 Protected' };
  const outgoing = [
    { type: 'pick', pick: first(league, 'Alpha', 2027), tradeRule: { action: 'full' } },
    { type: 'pick', pick: first(league, 'Alpha', 2028), tradeRule: { action: 'full' } },
  ];
  const incoming = [{ type: 'pick', pick: protectedPick, tradeRule: { action: 'protected' }, protection: 'Top 10 Protected' }];
  const result = rules.validateUserTradeAssetPackage({ leagueData: league, teamName: 'Alpha', outgoingItems: outgoing, incomingItems: incoming });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'stepien_rule');
});

test('a swap asset counts as a guaranteed first in its draft', () => {
  const league = baseLeague();
  league.draftPicks = league.draftPicks.filter(row => !(row.ownerTeam === 'Alpha' && row.year === 2028));
  league.draftPicks.push(pick({ year: 2028, owner: 'Alpha', original: 'Alpha', assetType: 'swap', swapWithTeam: 'Beta', protection: 'Swap right' }));
  const helper = rules.__userTradeRuleTestHelpers;
  const violations = helper.findStepienViolations({ leagueData: league, teamName: 'Alpha', outgoingItems: [{ type: 'pick', pick: first(league, 'Alpha', 2027) }], incomingItems: [] });
  assert.equal(violations.some(row => row.year1 === 2027 && row.year2 === 2028), false);
});

test('resolved current draft picks are excluded from Stepien after lottery', () => {
  const league = baseLeague({
    seasonYear: 2027,
    currentSeasonYear: 2027,
    seasonStartYear: 2026,
    __offseasonTradeContext: {
      version: 2,
      seasonYear: 2027,
      inOffseason: true,
      draftOrderLocked: true,
      draftComplete: false,
      stage: 'draft',
    },
  });
  const result = rules.getUserTradePickEligibility({
    leagueData: league,
    teamName: 'Alpha',
    pick: first(league, 'Alpha', 2027),
    item: { type: 'pick', pick: first(league, 'Alpha', 2027), tradeRule: { action: 'full' } },
    outgoingItems: [],
    incomingItems: [],
  });
  assert.equal(result.ok, true);
});

test('second-apron rule locks the furthest fully unprotected future first', () => {
  const league = baseLeague();
  const result = rules.getUserTradePickEligibility({
    leagueData: league,
    teamName: 'Alpha',
    pick: first(league, 'Alpha', 2033),
    item: { type: 'pick', pick: first(league, 'Alpha', 2033), tradeRule: { action: 'full' } },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'second_apron_furthest_first');
});

test('protecting the furthest second-apron first removes that specific lock', () => {
  const league = baseLeague();
  const target = first(league, 'Alpha', 2033);
  const result = rules.getUserTradePickEligibility({
    leagueData: league,
    teamName: 'Alpha',
    pick: target,
    item: { type: 'pick', pick: target, tradeRule: { action: 'protected' }, protection: 'Top 1 Protected' },
  });
  assert.notEqual(result.code, 'second_apron_furthest_first');
});

test('turning second-apron toggle off restores the furthest first', () => {
  const league = baseLeague({ settings: { tradeRules: { secondApron: false } } });
  const result = rules.getUserTradePickEligibility({
    leagueData: league,
    teamName: 'Alpha',
    pick: first(league, 'Alpha', 2033),
    item: { type: 'pick', pick: first(league, 'Alpha', 2033), tradeRule: { action: 'full' } },
  });
  assert.equal(result.ok, true);
});

test('user trade acquisition stamping stores a 30-day eligibility date', () => {
  localStorage.setItem('bm_league_clock_v1', JSON.stringify({ date: '2027-01-05', seasonYear: 2026 }));
  const league = baseLeague();
  const moved = league.teams[0].players.shift();
  league.teams[1].players.push(moved);
  const next = rules.stampUserTradeAcquisitionRestrictions({
    leagueData: league,
    movedPlayers: [{ name: moved.name, fromTeam: 'Alpha', toTeam: 'Beta' }],
    currentDate: '2027-01-05',
  });
  const stamped = findPlayer(next, 'Beta', moved.name);
  const entry = rules.__userTradeRuleTestHelpers.getUserTradeRestrictionLedger(next)[`id:${stamped.id}`];
  assert.equal(entry.acquiredDate, '2027-01-05');
  assert.equal(entry.acquiredTradeEligibleDate, '2027-02-04');
  assert.equal(stamped.tradeRestrictions, undefined);
});

test('offseason free-agent stamping stores December 15 eligibility', () => {
  const before = baseLeague({
    seasonYear: 2027,
    currentSeasonYear: 2027,
    __offseasonTradeContext: { version: 2, seasonYear: 2027, inOffseason: true, stage: 'freeAgency' },
  });
  const after = structuredClone(before);
  after.teams[0].players.push(player('New Free Agent', 5_000_000));
  const next = rules.stampFreeAgentSigningRestrictions({ beforeLeague: before, afterLeague: after, signedDate: '2027-07-03' });
  const stamped = findPlayer(next, 'Alpha', 'New Free Agent');
  const entry = rules.__userTradeRuleTestHelpers.getUserTradeRestrictionLedger(next)[`id:${stamped.id}`];
  assert.equal(entry.freeAgentSignedDate, '2027-07-03');
  assert.equal(entry.freeAgentTradeEligibleDate, '2027-12-15');
  assert.equal(stamped.tradeRestrictions, undefined);
});

test('in-season free-agent stamping stores a 30-day eligibility date', () => {
  const before = baseLeague();
  const after = structuredClone(before);
  after.teams[0].players.push(player('In Season Free Agent', 5_000_000));
  const next = rules.stampFreeAgentSigningRestrictions({ beforeLeague: before, afterLeague: after, signedDate: '2027-01-10' });
  const stamped = findPlayer(next, 'Alpha', 'In Season Free Agent');
  const entry = rules.__userTradeRuleTestHelpers.getUserTradeRestrictionLedger(next)[`id:${stamped.id}`];
  assert.equal(entry.freeAgentTradeEligibleDate, '2027-02-09');
});

test('rookie stamping stores June 30 signing and July 30 eligibility', () => {
  const before = baseLeague();
  const after = structuredClone(before);
  after.teams[0].players.push(player('New Rookie', 4_000_000, { draftYear: 2027 }));
  const next = rules.stampRookieSigningRestrictions({ beforeLeague: before, afterLeague: after, draftYear: 2027 });
  const stamped = findPlayer(next, 'Alpha', 'New Rookie');
  const entry = rules.__userTradeRuleTestHelpers.getUserTradeRestrictionLedger(next)[`id:${stamped.id}`];
  assert.equal(entry.rookieSignedDate, '2027-06-30');
  assert.equal(entry.rookieTradeEligibleDate, '2027-07-30');
});

test('final user-trade validation checks assets on both teams', () => {
  localStorage.setItem('bm_league_clock_v1', JSON.stringify({ date: '2027-01-20', seasonYear: 2026 }));
  const league = baseLeague({
    settings: { tradeRules: { salaryMatching: false, firstApron: false, secondApron: false, hardCapApronCeiling: false, stepienRule: false } },
  });
  const lockedCpuPlayer = league.teams[1].players[0];
  lockedCpuPlayer.tradeRestrictions = { acquiredDate: '2027-01-10', acquiredTradeEligibleDate: '2027-02-09' };
  const result = rules.validateUserTradeRules({
    leagueData: league,
    userTeam: league.teams[0],
    cpuTeam: league.teams[1],
    userItems: [itemForPlayer(league.teams[0].players[0])],
    cpuItems: [itemForPlayer(lockedCpuPlayer)],
    includeDeadline: false,
    includeFinancial: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'recently_acquired');
});

console.log(`\n${passed}/${passed} user-trade rule checks passed.`);
