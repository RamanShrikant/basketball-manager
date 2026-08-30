import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.cwd(), process.cwd().endsWith('frontend') ? '.' : 'frontend');
const draftFile = path.join(root, 'src/pages/Draft.jsx');
const tradeFile = path.join(root, 'src/utils/tradeExecution.js');
const draftPicksUrl = pathToFileURL(path.join(root, 'src/utils/draftPicks.js')).href;
const { applyDraftPickOwnershipToOrder, transferResolvedDraftPickOwnershipAsset } = await import(draftPicksUrl);

const draftSrc = fs.readFileSync(draftFile, 'utf8');
const tradeSrc = fs.readFileSync(tradeFile, 'utf8');
const checks = [];
const check = (name, ok, details='') => checks.push({ name, ok: Boolean(ok), details });

check('trade.saved_signature_invalidated', tradeSrc.includes('draftOrderSignature: null'));
check('trade.league_signature_invalidated', tradeSrc.includes('delete nextLeague.draftState.draftOrderSignature'));
check('draft.live_state_rebases_canonical_ownership', draftSrc.includes('draft_pick_ownership_v7_live_sync'));
check('draft.live_state_persists_rebased_order', draftSrc.includes('saveDraftState(nextState)'));

const league = {
  seasonYear: 2027,
  conferences: { East: [{ name: 'Los Angeles Clippers', players: [] }, { name: 'Sacramento Kings', players: [] }] },
  draftPicks: [{
    id: 'SAC_2027_R1', year: 2027, round: 1, assetType: 'pick', status: 'active',
    originalTeam: 'Sacramento Kings', ownerTeam: 'Sacramento Kings',
  }],
};
const liveStateOrder = [{
  pick: 1, round: 1, teamName: 'Sacramento Kings', currentOwnerTeamName: 'Sacramento Kings',
  originalTeamName: 'Sacramento Kings', originalPickTeamName: 'Sacramento Kings',
}];
const transfer = transferResolvedDraftPickOwnershipAsset(league, {
  year: 2027, round: 1, originalTeam: 'Sacramento Kings', pickNumber: 1,
  fromTeam: 'Sacramento Kings', toTeam: 'Los Angeles Clippers',
});
check('canonical_transfer_succeeds', transfer.ok, JSON.stringify(transfer));
const nextLeague = { ...league, draftPicks: transfer.draftPicks };
const rebased = applyDraftPickOwnershipToOrder(liveStateOrder, { leagueData: nextLeague, seasonYear: 2027 });
const owner = rebased?.[0]?.currentOwnerTeamName || rebased?.[0]?.teamName || '';
check('live_order_rebases_pick_1_to_clippers', owner === 'Los Angeles Clippers', owner);
check('live_order_keeps_pick_number', Number(rebased?.[0]?.pick) === 1);

console.table(checks.map(c => ({ check: c.name, result: c.ok ? 'PASS' : 'FAIL', details: c.details })));
const failed = checks.filter(c => !c.ok);
if (failed.length) {
  console.error(`draft-live-ownership-sync-regression: ${checks.length-failed.length}/${checks.length} PASS`);
  process.exit(1);
}
console.log(`draft-live-ownership-sync-regression: ${checks.length}/${checks.length} PASS`);
