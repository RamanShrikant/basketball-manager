import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {normalizeDraftPicks,resolveDraftPickOwner,auditDraftPickIntegrity,validateCustomPickProtection} from '../src/utils/draftPicks.js';
import {parseOnlineProtectionToken,makeOnlineProtectionToken,canOnlineAddPickProtection} from '../src/online/onlineCustomPickProtections.mjs';
import {inspectPendingOnlineTradeOffer} from '../src/online/onlineTradeOfferSafety.mjs';
const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const sql=readFileSync(path.join(base,'supabase/bm_online_custom_protection_phase2c2d9.sql'),'utf8');
const ui=readFileSync(path.join(base,'frontend/src/online/OnlineHumanTradeRoom.jsx'),'utf8');
const names=['Atlanta Hawks','Boston Celtics','Chicago Bulls'];
const baseLeague={teams:names.map(name=>({name,players:[]})),seasonYear:2026};
const basic={id:'pick-a',year:2029,round:1,originalTeam:names[0],ownerTeam:names[0],assetType:'pick',status:'active',protections:'Unprotected'};
const normalized=normalizeDraftPicks([basic],names)[0];
assert.equal(canOnlineAddPickProtection(normalized,[normalized]),true);
assert.equal(makeOnlineProtectionToken(basic.id,10),'pick-a~protect:10');
assert.deepEqual(parseOnlineProtectionToken('pick-a~protect:10'),{id:'pick-a',topN:10});
assert.deepEqual(parseOnlineProtectionToken('pick-a'),{id:'pick-a',topN:null});
for (const bad of ['',null,'pick-a~protect:0','pick-a~protect:30','pick-a~protect:1~protect:2','pick-a~protect:xx','pick-a~protect:03']) {
  assert.equal(parseOnlineProtectionToken(bad),null,'Bad command must fail closed: '+bad);
}
assert.equal(makeOnlineProtectionToken('pick-a',30),null);
assert.equal(makeOnlineProtectionToken('pick-a',null),'pick-a');
assert.equal(makeOnlineProtectionToken('a'.repeat(111),10),null);
const protectedPeer={...normalized,id:'second-right',ownerTeam:names[1],ownedSlots:{start:11,end:30},protections:'Top 10 Protected'};
assert.equal(canOnlineAddPickProtection(normalized,[normalized,protectedPeer]),false,'Cannot re-split partial lineage');
assert.equal(canOnlineAddPickProtection({...normalized,round:2},[]),false);
assert.equal(canOnlineAddPickProtection({...normalized,protections:'Top 14 Protected'},[normalized]),false);
for (const n of [1,3,5,10,14,20,29]) {
  const source={...normalized};
  const validation=validateCustomPickProtection(source,1,n);
  assert.equal(validation.ok,true,`Original engine must allow Top-${n}`);
  const rows=normalizeDraftPicks([
    {...source,id:`retained-${n}`,ownerTeam:names[0],protection:validation.baseProtectionLabel,protections:validation.baseProtectionLabel,ownedSlots:validation.retainedRange,ownedRange:validation.retainedRange,logicType:'trade_machine_protected_split'},
    {...source,id:`conveyed-${n}`,ownerTeam:names[1],protection:validation.baseProtectionLabel,protections:validation.baseProtectionLabel,ownedSlots:validation.conveyedRange,ownedRange:validation.conveyedRange,logicType:'trade_machine_protected_split'},
  ],names);
  const league={...baseLeague,draftPicks:rows};
  assert.equal(auditDraftPickIntegrity(league).ok,true,`Top-${n} may not duplicate slot ownership`);
  for(let slot=1;slot<=30;slot++) {
    assert.equal(resolveDraftPickOwner({leagueData:league,year:2029,round:1,originalTeam:names[0],pickNumber:slot}).ownerTeam,
      slot<=n?names[0]:names[1],`Top-${n} slot ${slot}`);
  }
}
const offer={status:'pending',proposer_team:names[0],recipient_team:names[1],
  proposer_player_ids:['player-a'],recipient_player_ids:['player-b'],
  proposer_pick_ids:['pick-a~protect:10'],recipient_pick_ids:[]};
const league={...baseLeague,teams:[{name:names[0],players:[{id:'player-a'}]},{name:names[1],players:[{id:'player-b'}]},{name:names[2],players:[]}],draftPicks:[basic]};
assert.equal(inspectPendingOnlineTradeOffer(offer,league).current,true);
assert.equal(inspectPendingOnlineTradeOffer({...offer,proposer_pick_ids:['pick-a','pick-a~protect:10']},league).current,false);
assert.equal(inspectPendingOnlineTradeOffer({...offer,proposer_pick_ids:['pick-a~protect:30']},league).current,false);
assert.equal(inspectPendingOnlineTradeOffer(offer,{...league,draftPicks:[{...basic,ownerTeam:names[2]}]}).current,false);
assert.equal(inspectPendingOnlineTradeOffer(offer,{...league,draftPicks:[{...basic,protections:'Top 14 Protected'}]}).current,false);
for (const fragment of ['v_base_ids_a','v_base_ids_b','count(distinct x)','v_top_n not between 1 and 29','v_peer_active<>1','v_generated_id_ret','v_generated_id_con',"'protected_split'",'v_retained_range','v_conveyed_range','for v_swap in','v_before_first','v_after_first','revoke all on function']) {
  assert.ok(sql.includes(fragment),`SQL must preserve ${fragment}`);
}
assert.ok(sql.includes("v_next:=v_next||jsonb_build_array(v_retained,v_conveyed)"),'SQL must replace a full pick with exactly two rights');
assert.ok(!/grant execute on function public\.bm_online_prepare_human_pick_trade/.test(sql),'Internal function cannot be public');
assert.ok(ui.includes('bmOnlinePickProtectionSelect'));
assert.ok(!/localStorage\.|setLeagueData\(/.test(ui),'Online trade UI may not write single-player saves');
console.log('PASS online Top-N protections: token validation, 210 draft-slot outcomes, duplicate/stale protection checks, SQL and online-only integration');
