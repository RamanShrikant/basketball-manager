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

function pick(year, owner = 'Alpha', original = owner, extra = {}) {
  return {
    id: `${year}-${original}-${owner}-${extra.assetType || 'pick'}`,
    assetType: extra.assetType || 'pick',
    type: extra.assetType || 'pick',
    year,
    round: 1,
    originalTeam: original,
    ownerTeam: owner,
    status: 'active',
    protections: extra.protections || 'Unprotected',
    displayProtection: extra.displayProtection || extra.protections || 'Unprotected',
    swapWithTeam: extra.swapWithTeam || '',
    ...extra,
  };
}

function league({ offseason = false, draftLocked = false } = {}) {
  const draftPicks = [];
  for (let year = 2027; year <= 2035; year += 1) {
    draftPicks.push(pick(year, 'Alpha'));
    draftPicks.push(pick(year, 'Beta'));
  }
  return {
    seasonStartYear: offseason ? 2026 : 2026,
    currentSeasonYear: offseason ? 2027 : 2026,
    seasonYear: offseason ? 2027 : 2026,
    teams: [{ name: 'Alpha', players: [] }, { name: 'Beta', players: [] }],
    draftPicks,
    settings: { tradeRules: {} },
    ...(offseason ? {
      __offseasonTradeContext: {
        version: 3,
        seasonYear: 2027,
        targetSeasonYear: 2028,
        inOffseason: true,
        draftOrderLocked: draftLocked,
        draftComplete: false,
        stage: draftLocked ? 'post_lottery_pre_draft' : 'pre_lottery',
      },
    } : {}),
  };
}

const checks = [];
function check(name, fn) {
  try { localStorage.clear(); sessionStorage.clear(); fn(); checks.push({ name, status: 'PASS' }); }
  catch (error) { checks.push({ name, status: 'FAIL', error: error?.message || String(error) }); }
}

check('regular-season seven-draft horizon allows 2033', () => {
  const l = league();
  const p = l.draftPicks.find((row) => row.ownerTeam === 'Alpha' && row.year === 2033);
  const result = rules.getUserTradePickEligibility({ leagueData: l, teamName: 'Alpha', pick: p, item: { type: 'pick', pick: p }, outgoingItems: [], incomingItems: [] });
  assert.notEqual(result.code, 'seven_year_rule');
});

check('regular-season seven-draft horizon blocks 2034', () => {
  const l = league();
  const p = l.draftPicks.find((row) => row.ownerTeam === 'Alpha' && row.year === 2034);
  const result = rules.getUserTradePickEligibility({ leagueData: l, teamName: 'Alpha', pick: p, item: { type: 'pick', pick: p }, outgoingItems: [], incomingItems: [] });
  assert.equal(result.code, 'seven_year_rule');
});

check('post-lottery current exact draft pick is not treated as a stale future first', () => {
  const l = league({ offseason: true, draftLocked: true });
  const p = pick(2027, 'Alpha', 'Alpha', { assetType: 'resolved', pickNumber: 2, resolvedPickNumber: 2, protections: 'Resolved', displayProtection: 'Resolved' });
  const result = rules.getUserTradePickEligibility({ leagueData: l, teamName: 'Alpha', pick: p, item: { type: 'pick', pick: p }, outgoingItems: [], incomingItems: [] });
  assert.equal(result.ok, true, result.reason);
});

check('post-lottery horizon rolls forward and allows 2034', () => {
  const l = league({ offseason: true, draftLocked: true });
  const p = l.draftPicks.find((row) => row.ownerTeam === 'Alpha' && row.year === 2034);
  const result = rules.getUserTradePickEligibility({ leagueData: l, teamName: 'Alpha', pick: p, item: { type: 'pick', pick: p }, outgoingItems: [], incomingItems: [] });
  assert.notEqual(result.code, 'seven_year_rule');
});

check('post-lottery horizon blocks 2035', () => {
  const l = league({ offseason: true, draftLocked: true });
  const p = l.draftPicks.find((row) => row.ownerTeam === 'Alpha' && row.year === 2035);
  const result = rules.getUserTradePickEligibility({ leagueData: l, teamName: 'Alpha', pick: p, item: { type: 'pick', pick: p }, outgoingItems: [], incomingItems: [] });
  assert.equal(result.code, 'seven_year_rule');
});

check('Stepien still blocks consecutive future firsts', () => {
  const l = league();
  const p2027 = l.draftPicks.find((row) => row.ownerTeam === 'Alpha' && row.year === 2027);
  const p2028 = l.draftPicks.find((row) => row.ownerTeam === 'Alpha' && row.year === 2028);
  const result = rules.getUserTradePickEligibility({
    leagueData: l,
    teamName: 'Alpha',
    pick: p2028,
    item: { type: 'pick', pick: p2028, tradeRule: { action: 'full' } },
    outgoingItems: [{ type: 'pick', pick: p2027, tradeRule: { action: 'full' } }],
    incomingItems: [],
  });
  assert.equal(result.code, 'stepien_rule');
});

console.table(checks);
const failures = checks.filter((row) => row.status !== 'PASS');
if (failures.length) {
  console.error(`${failures.length}/${checks.length} draft-pick league-rule checks failed.`);
  process.exit(1);
}
console.log(`${checks.length}/${checks.length} draft-pick league-rule checks passed.`);
