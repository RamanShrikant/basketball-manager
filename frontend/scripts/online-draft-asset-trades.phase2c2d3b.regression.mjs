// The online draft-pick trade gateway must retain source-level boundaries.
// These checks do NOT replace SQL execution or a two-account transactional test.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const sql=read('supabase/bm_online_human_pick_trades_phase2c2d3b.sql');
const ui=read('frontend/src/online/OnlineHumanTradeRoom.jsx');
const rights=read('frontend/src/online/onlineExistingPickRights.mjs');
const client=read('frontend/src/online/onlineRuntimeClient.js');
const originalPick=read('frontend/src/utils/draftPicks.js');
const originalRules=read('frontend/src/utils/userTradeRules.js');
for(const rule of ['isActiveDraftPickAsset','isProtectedDraftPickAsset','isDraftPickEncumberedByActiveSwap','normalizeDraftPicks']) {
  assert.match(originalPick,new RegExp(`(export function ${rule}\\(|${rule}\\()`),`Single-player ${rule} not found`);
  assert((ui+'\n'+rights).includes(rule),`Online pick preview or its imported eligibility policy must reuse ${rule}`);
}
for(const rule of ['findStepienViolations','getUserTradePickEligibility','MAX_FUTURE_DRAFT_YEARS']) {
  assert(originalRules.includes(rule),`Missing single-player pick rule ${rule}`);
}
for(const feature of [
  /alter table public\.bm_online_trade_offers/,
  /bm_online_prepare_human_pick_trade\(/,
  /bm_online_prepare_human_asset_trade\(/,
  /bm_online_prepare_human_player_trade\(/,
  /bm_online_offer_human_asset_trade\(/,
  /bm_online_respond_human_trade\(/,
  /v_revision<>p_expected_revision/,
  /from public\.bm_online_franchise_runtime\s+where lobby_id=p_lobby for update/,
  /bm_online_franchise_events/,
  /v_offer\.proposer_pick_ids/,
  /v_offer\.recipient_pick_ids/,
  /Draft pick no longer exists uniquely/,
  /GM does not currently own the requested draft pick/,
  /Draft pick has ambiguous ownership slices/,
  /Draft pick is encumbered by an active swap right/,
  /Stepien consecutive-first-round violation/,
  /Furthest future unprotected first is locked/,
  /v_year not between 2027 and 2033/,
  /v_record:=jsonb_set\(v_record,'\{movedPicks\}'/,
  /jsonb_set\(p_state,'\{draftPicks\}',v_next,false\)/,
  /revoke all on function public\.bm_online_prepare_human_pick_trade/,
  /grant execute on function public\.bm_online_offer_human_asset_trade/,
]) assert.match(sql,feature,`SQL missing ${feature}`);
assert.match(client,/bm_online_offer_human_asset_trade/);
assert.match(client,/proposer_pick_ids,recipient_pick_ids/);
assert.match(ui,/PickSelection/);
assert.match(ui,/classifyOnlineExistingPickRight/,'UI must invoke shared online pick-right eligibility');
assert.match(rights,/if\(!isActiveDraftPickAsset\(row\)/,'Eligibility must reject inactive draft rights');
assert.match(rights,/isDraftPickEncumberedByActiveSwap\(row,rows,leagueData\)/,'Eligibility must reject swap-encumbered rights');
assert.match(ui,/await offerOnlineHumanAssetTrade/);
assert.match(ui,/sendingPickIds:sendingPicks,receivingPickIds:receivingPicks/);
assert.doesNotMatch(ui,/\b(?:localStorage|sessionStorage|indexedDB)\s*[.\[]/);
assert.doesNotMatch(ui,/setLeagueData\(|saveLeagueData\(|executeAcceptedTradeOnLeague\(/);
assert.doesNotMatch(sql,/update\s+public\.bm_singleplayer/i);
console.log('PASS: online asset-trade gateway, original draft-rule provenance, UI and state isolation');
console.log('PENDING: PostgreSQL SQL execution, protected/swap picks, pick-only offers, CPU approval, live GM conflicts');
