import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  applyDraftPickOwnershipToOrder,
  auditDraftPickIntegrity,
  buildTradeMachineSwapAssets,
  finalizeResolvedDraftOrderAssets,
  getDraftPickConflictKey,
  isSwapDraftPickAsset,
  normalizeDraftPicks,
  removeDirectPickRowsConsumedBySwap,
  resolveDraftPickOwner,
  transferResolvedDraftPickOwnershipAsset,
} from '../src/utils/draftPicks.js';

const checks = [];
const check = (name, fn) => {
  try {
    fn();
    checks.push({ name, status: 'PASS' });
  } catch (error) {
    checks.push({ name, status: 'FAIL', error: error?.message || String(error) });
  }
};

const teams = [
  'Milwaukee Bucks', 'Detroit Pistons', 'Minnesota Timberwolves', 'Utah Jazz',
  'Los Angeles Clippers', 'Miami Heat', 'Toronto Raptors', 'Denver Nuggets',
  'Oklahoma City Thunder',
];
const baseLeague = (draftPicks = []) => ({
  seasonYear: 2027,
  conferences: { East: teams.map((name) => ({ name, players: [] })), West: [] },
  draftPicks,
});

function directPick(id, year, round, originalTeam, ownerTeam, extra = {}) {
  return {
    id, assetType: 'pick', type: 'pick', year, round, originalTeam, ownerTeam,
    protections: 'Unprotected', displayProtection: 'Unprotected', status: 'active', ...extra,
  };
}

check('default roster draft ledger passes integrity audit', () => {
  const league = JSON.parse(fs.readFileSync(new URL('../public/defaults/default_roster.json', import.meta.url), 'utf8'));
  const audit = auditDraftPickIntegrity(league);
  assert.equal(audit.ok, true, JSON.stringify(audit.errors?.slice(0, 5)));
});

check('new MIA/TOR swap consumes direct pick rows', () => {
  const mia = directPick('mia33', 2033, 1, 'Miami Heat', 'Milwaukee Bucks');
  const tor = directPick('tor33', 2033, 1, 'Toronto Raptors', 'Los Angeles Clippers');
  const league = baseLeague([mia, tor]);
  const stamp = { fromTeam: 'Milwaukee Bucks', toTeam: 'Los Angeles Clippers', completedAt: '2032-07-01T00:00:00.000Z' };
  const swapAssets = buildTradeMachineSwapAssets({
    sourcePick: mia,
    swapPick: tor,
    fromTeamName: 'Milwaukee Bucks',
    toTeamName: 'Los Angeles Clippers',
    direction: 'best',
    tradeStamp: stamp,
  });
  const rows = [
    ...removeDirectPickRowsConsumedBySwap(league.draftPicks, mia, tor, league),
    ...swapAssets,
  ];
  const next = { ...league, draftPicks: rows };
  const normalized = normalizeDraftPicks(rows, teams);
  assert.equal(normalized.filter((row) => !isSwapDraftPickAsset(row) && ['Miami Heat', 'Toronto Raptors'].includes(row.originalTeam)).length, 0);
  assert.equal(normalized.filter(isSwapDraftPickAsset).length, 2);
  assert.equal(auditDraftPickIntegrity(next).ok, true);
});

check('audit rejects direct pick plus active swap duplicate', () => {
  const mia = directPick('mia33', 2033, 1, 'Miami Heat', 'Milwaukee Bucks');
  const tor = directPick('tor33', 2033, 1, 'Toronto Raptors', 'Los Angeles Clippers');
  const swapAssets = buildTradeMachineSwapAssets({
    sourcePick: mia, swapPick: tor,
    fromTeamName: 'Milwaukee Bucks', toTeamName: 'Los Angeles Clippers', direction: 'best', tradeStamp: {},
  });
  const corrupt = baseLeague([mia, tor, ...swapAssets]);
  const audit = auditDraftPickIntegrity(corrupt);
  assert.equal(audit.ok, false);
  assert.ok(audit.errors.some((row) => row.code === 'DIRECT_PICK_AND_ACTIVE_SWAP_CONFLICT'));
});

check('protected pick resolves to original team when protection hits', () => {
  const league = baseLeague([
    directPick('den28-retain', 2028, 1, 'Denver Nuggets', 'Denver Nuggets', {
      protections: 'Top 5 Protected', displayProtection: 'Top 5 Protected (Owns 1-5)', ownedSlots: { start: 1, end: 5 },
    }),
    directPick('den28-convey', 2028, 1, 'Denver Nuggets', 'Oklahoma City Thunder', {
      protections: 'Top 5 Protected', displayProtection: 'Top 5 Protected (Owns 6-30)', ownedSlots: { start: 6, end: 30 },
    }),
  ]);
  const result = resolveDraftPickOwner({ leagueData: league, year: 2028, round: 1, originalTeam: 'Denver Nuggets', pickNumber: 3 });
  assert.equal(result.ownerTeam, 'Denver Nuggets');
});

check('protected pick conveys when resolved outside protected range', () => {
  const league = baseLeague([
    directPick('den28-retain', 2028, 1, 'Denver Nuggets', 'Denver Nuggets', {
      protections: 'Top 5 Protected', displayProtection: 'Top 5 Protected (Owns 1-5)', ownedSlots: { start: 1, end: 5 },
    }),
    directPick('den28-convey', 2028, 1, 'Denver Nuggets', 'Oklahoma City Thunder', {
      protections: 'Top 5 Protected', displayProtection: 'Top 5 Protected (Owns 6-30)', ownedSlots: { start: 6, end: 30 },
    }),
  ]);
  const result = resolveDraftPickOwner({ leagueData: league, year: 2028, round: 1, originalTeam: 'Denver Nuggets', pickNumber: 8 });
  assert.equal(result.ownerTeam, 'Oklahoma City Thunder');
});


check('protected pick finalization keeps the conveyed owner after exact resolution', () => {
  const league = baseLeague([
    directPick('den28-retain', 2028, 1, 'Denver Nuggets', 'Denver Nuggets', {
      protections: 'Top 5 Protected', displayProtection: 'Top 5 Protected (Owns 1-5)', ownedSlots: { start: 1, end: 5 },
      realLifeDetails: { ownedSlots: { start: 1, end: 5 }, marker: 'retain' },
    }),
    directPick('den28-convey', 2028, 1, 'Denver Nuggets', 'Oklahoma City Thunder', {
      protections: 'Top 5 Protected', displayProtection: 'Top 5 Protected (Owns 6-30)', ownedSlots: { start: 6, end: 30 },
      realLifeDetails: { ownedSlots: { start: 6, end: 30 }, marker: 'convey' },
    }),
  ]);
  const natural = [{ pick: 8, round: 1, teamName: 'Denver Nuggets', originalTeamName: 'Denver Nuggets', currentOwnerTeamName: 'Denver Nuggets' }];
  const resolved = applyDraftPickOwnershipToOrder(natural, { leagueData: league, seasonYear: 2028 });
  assert.equal(resolved[0]?.currentOwnerTeamName, 'Oklahoma City Thunder');
  const finalized = finalizeResolvedDraftOrderAssets(league, resolved, 2028);
  const rebuilt = applyDraftPickOwnershipToOrder(resolved, { leagueData: finalized, seasonYear: 2028 });
  assert.equal(rebuilt[0]?.currentOwnerTeamName, 'Oklahoma City Thunder');
  const exact = finalized.draftPicks.find((row) => Number(row?.resolvedPickNumber || 0) === 8);
  assert.equal(exact?.ownedSlots, null);
  assert.equal(exact?.realLifeDetails?.ownedSlots, undefined);
});

check('protected pick finalization keeps the original owner when protection hits', () => {
  const league = baseLeague([
    directPick('den28-retain', 2028, 1, 'Denver Nuggets', 'Denver Nuggets', {
      protections: 'Top 5 Protected', displayProtection: 'Top 5 Protected (Owns 1-5)', ownedSlots: { start: 1, end: 5 },
    }),
    directPick('den28-convey', 2028, 1, 'Denver Nuggets', 'Oklahoma City Thunder', {
      protections: 'Top 5 Protected', displayProtection: 'Top 5 Protected (Owns 6-30)', ownedSlots: { start: 6, end: 30 },
    }),
  ]);
  const natural = [{ pick: 3, round: 1, teamName: 'Denver Nuggets', originalTeamName: 'Denver Nuggets', currentOwnerTeamName: 'Denver Nuggets' }];
  const resolved = applyDraftPickOwnershipToOrder(natural, { leagueData: league, seasonYear: 2028 });
  assert.equal(resolved[0]?.currentOwnerTeamName, 'Denver Nuggets');
  const finalized = finalizeResolvedDraftOrderAssets(league, resolved, 2028);
  const rebuilt = applyDraftPickOwnershipToOrder(resolved, { leagueData: finalized, seasonYear: 2028 });
  assert.equal(rebuilt[0]?.currentOwnerTeamName, 'Denver Nuggets');
});

check('lottery finalization retires current-year swap and locks exact pick', () => {
  const min = directPick('min27', 2027, 1, 'Minnesota Timberwolves', 'Minnesota Timberwolves');
  const uta = directPick('uta27', 2027, 1, 'Utah Jazz', 'Utah Jazz');
  const swapAssets = buildTradeMachineSwapAssets({
    sourcePick: min, swapPick: uta,
    fromTeamName: 'Minnesota Timberwolves', toTeamName: 'Milwaukee Bucks', direction: 'best', tradeStamp: {},
  });
  const league = baseLeague(swapAssets);
  const natural = [
    { pick: 2, round: 1, teamName: 'Minnesota Timberwolves', originalTeamName: 'Minnesota Timberwolves', currentOwnerTeamName: 'Minnesota Timberwolves' },
    { pick: 20, round: 1, teamName: 'Utah Jazz', originalTeamName: 'Utah Jazz', currentOwnerTeamName: 'Utah Jazz' },
  ];
  const swapped = applyDraftPickOwnershipToOrder(natural, { leagueData: league, seasonYear: 2027 });
  const milPick = swapped.find((row) => row.currentOwnerTeamName === 'Milwaukee Bucks');
  assert.equal(Number(milPick?.pick), 2);

  const finalized = finalizeResolvedDraftOrderAssets(league, swapped, 2027);
  assert.ok(finalized.draftPicks.filter(isSwapDraftPickAsset).every((row) => row.status === 'resolved'));
  const exact = finalized.draftPicks.find((row) => !isSwapDraftPickAsset(row) && Number(row.resolvedPickNumber) === 2);
  assert.equal(exact?.ownerTeam, 'Milwaukee Bucks');
});

check('trading resolved #2 after swap resolution cannot be overwritten by stale swap', () => {
  const min = directPick('min27', 2027, 1, 'Minnesota Timberwolves', 'Minnesota Timberwolves');
  const uta = directPick('uta27', 2027, 1, 'Utah Jazz', 'Utah Jazz');
  const swapAssets = buildTradeMachineSwapAssets({
    sourcePick: min, swapPick: uta,
    fromTeamName: 'Minnesota Timberwolves', toTeamName: 'Milwaukee Bucks', direction: 'best', tradeStamp: {},
  });
  let league = baseLeague(swapAssets);
  const natural = [
    { pick: 2, round: 1, teamName: 'Minnesota Timberwolves', originalTeamName: 'Minnesota Timberwolves', currentOwnerTeamName: 'Minnesota Timberwolves' },
    { pick: 20, round: 1, teamName: 'Utah Jazz', originalTeamName: 'Utah Jazz', currentOwnerTeamName: 'Utah Jazz' },
  ];
  const swapped = applyDraftPickOwnershipToOrder(natural, { leagueData: league, seasonYear: 2027 });
  league = finalizeResolvedDraftOrderAssets(league, swapped, 2027);
  const transfer = transferResolvedDraftPickOwnershipAsset(league, {
    year: 2027, round: 1, originalTeam: 'Minnesota Timberwolves', pickNumber: 2,
    fromTeam: 'Milwaukee Bucks', toTeam: 'Detroit Pistons', tradeStamp: { action: 'test_resolved_trade' },
  });
  assert.equal(transfer.ok, true, transfer.reason);
  league = { ...league, draftPicks: transfer.draftPicks };
  const rebuilt = applyDraftPickOwnershipToOrder(swapped, { leagueData: league, seasonYear: 2027 });
  const numberTwo = rebuilt.find((row) => Number(row.pick) === 2);
  assert.equal(numberTwo?.currentOwnerTeamName, 'Detroit Pistons');
  assert.equal(auditDraftPickIntegrity(league).ok, true);
});

check('two different natural picks cannot occupy one resolved slot', () => {
  const league = baseLeague([
    directPick('a', 2027, 1, 'Minnesota Timberwolves', 'Milwaukee Bucks', { status: 'resolved', resolvedPickNumber: 2, pickNumber: 2, displayProtection: 'Resolved' }),
    directPick('b', 2027, 1, 'Utah Jazz', 'Detroit Pistons', { status: 'resolved', resolvedPickNumber: 2, pickNumber: 2, displayProtection: 'Resolved' }),
  ]);
  const audit = auditDraftPickIntegrity(league);
  assert.equal(audit.ok, false);
  assert.ok(audit.errors.some((row) => row.code === 'DUPLICATE_RESOLVED_DRAFT_SLOT'));
});

check('natural pick conflict keys stay stable across owner changes', () => {
  const league = baseLeague([]);
  const a = directPick('a', 2030, 1, 'Denver Nuggets', 'Denver Nuggets');
  const b = { ...a, id: 'b', ownerTeam: 'Oklahoma City Thunder' };
  assert.equal(getDraftPickConflictKey(a, league), getDraftPickConflictKey(b, league));
});

console.table(checks);
const failures = checks.filter((row) => row.status !== 'PASS');
if (failures.length) {
  console.error(`${failures.length}/${checks.length} draft asset integrity checks failed.`);
  process.exit(1);
}
console.log(`${checks.length}/${checks.length} draft asset integrity checks passed.`);
