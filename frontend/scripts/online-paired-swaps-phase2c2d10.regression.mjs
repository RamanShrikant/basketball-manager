import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeDraftPicks,applyDraftPickOwnershipToOrder,finalizeResolvedDraftOrderAssets,
  auditDraftPickIntegrity,isSwapDraftPickAsset
} from '../src/utils/draftPicks.js';
import {parseOnlineSwapToken,makeOnlineSwapToken,parseOnlineTradePickToken,canOnlineCreateSwapPair} from '../src/online/onlinePickSwapCommands.mjs';
import {inspectPendingOnlineTradeOffer} from '../src/online/onlineTradeOfferSafety.mjs';

const a='Miami Heat',b='Toronto Raptors',c='Milwaukee Bucks';
const teams=[a,b,c];
const source={id:'a-2029',assetType:'pick',type:'pick',year:2029,round:1,originalTeam:a,ownerTeam:a,status:'active',protections:'Unprotected'};
const other={...source,id:'b-2029',originalTeam:b,ownerTeam:b};
const unrelated={...source,id:'c-2029',originalTeam:c,ownerTeam:c};
const league=(draftPicks,players=true)=>({seasonYear:2026,teams:teams.map(name=>({name,players:players?[{id:`player-${name}`}]:[]})),draftPicks});
const base=league([source,other,unrelated]);
const offer={status:'pending',proposer_team:a,recipient_team:b,
  proposer_player_ids:[`player-${a}`],recipient_player_ids:[`player-${b}`],
  proposer_pick_ids:[makeOnlineSwapToken(source.id,'best')],recipient_pick_ids:[other.id]};
assert.deepEqual(parseOnlineSwapToken('a-2029~swap:best'),{id:'a-2029',direction:'best'});
assert.deepEqual(parseOnlineTradePickToken('a-2029~swap:worst'),{id:'a-2029',topN:null,swapDirection:'worst'});
assert.deepEqual(parseOnlineTradePickToken('a-2029~protect:10'),{id:'a-2029',topN:10,swapDirection:null});
assert.equal(makeOnlineSwapToken('a-2029','worst'),'a-2029~swap:worst');
for (const bad of ['','~swap:best','a~swap:both','a~swap:best~swap:worst','a~swap:best~protect:10',null]) {
  assert.equal(parseOnlineSwapToken(bad),null,'Reject malformed token '+bad);
}
assert.equal(canOnlineCreateSwapPair(source,other,base.draftPicks),true);
assert.equal(inspectPendingOnlineTradeOffer(offer,base).current,true);
const reject=(patch,items=base.draftPicks)=>{
  const res=inspectPendingOnlineTradeOffer({...offer,...patch},league(items));
  assert.equal(res.current,false,res.reason);
};
reject({proposer_pick_ids:['a-2029~swap:best','a-2029']});
reject({proposer_pick_ids:['a-2029~swap:bad']});
reject({recipient_pick_ids:['b-2029~swap:best']});
reject({recipient_pick_ids:['b-2029~protect:10']});
reject({},[{...source,ownerTeam:c},other,unrelated]);
reject({},[{...source,protections:'Top 10 Protected'},other,unrelated]);
reject({},[source,{...other,year:2030},unrelated]);
reject({},[source,other,{...other,id:'duplicate-lineage'},unrelated]);
reject({},[source,other,{...other,id:'another',assetType:'swap',protections:'Swap Best',swapWithTeam:a},unrelated]);
reject({},[source,source,other,unrelated]);
assert.equal(canOnlineCreateSwapPair({...source,ownedSlots:{start:1,end:10}},other,base.draftPicks),false);
assert.equal(canOnlineCreateSwapPair({...source,round:2},other,base.draftPicks),false);
assert.equal(canOnlineCreateSwapPair({...source,year:2033},{...other,year:2033},base.draftPicks),false);

// Build the exact new server-row schema, validate against the ORIGINAL single-
// player ledger and lottery order resolver. This is model parity, not a live SQL test.
let outcomes=0;
for(const direction of ['best','worst'])for(let first=1;first<=30;first++)for(let second=1;second<=30;second++){
  if(first===second)continue;
  const bestOwner=direction==='best'?b:a;
  const worstOwner=direction==='best'?a:b;
  const common={assetType:'swap',type:'swap',year:2029,round:1,originalTeam:a,swapWithTeam:b,
    status:'active',logicType:'trade_machine_swap',realLifeDetails:{source:'Trade Machine',tradeGenerated:true,
      swapParticipants:[a,b],swapOwnerParticipants:[a,b]},tradeHistory:[{action:'swap_right'}]};
  const swapBest={...common,id:'ons:123:best',ownerTeam:bestOwner,owner:bestOwner,
    currentOwnerTeamName:bestOwner,protections:'Swap Best',protection:'Swap Best',displayProtection:'Swap Best'};
  const swapWorst={...common,id:'ons:123:worst',ownerTeam:worstOwner,owner:worstOwner,
    currentOwnerTeamName:worstOwner,protections:'Swap Worst',protection:'Swap Worst',displayProtection:'Swap Worst'};
  const swapped=league([unrelated,swapBest,swapWorst]);
  if(first===1&&second===2) {
    assert.equal(swapped.draftPicks.some(p=>p.id===source.id||p.id===other.id),false);
    assert.equal(swapped.draftPicks.filter(isSwapDraftPickAsset).length,2);
    assert.equal(auditDraftPickIntegrity(swapped).ok,true,JSON.stringify(auditDraftPickIntegrity(swapped).errors));
  }
  const order=[
    {pick:first,round:1,originalTeamName:a,currentOwnerTeamName:a,teamName:a},
    {pick:second,round:1,originalTeamName:b,currentOwnerTeamName:b,teamName:b},
    {pick:31,round:1,originalTeamName:c,currentOwnerTeamName:c,teamName:c},
  ];
  const applied=applyDraftPickOwnershipToOrder(order,{leagueData:swapped,seasonYear:2029});
  const sorted=[...applied].filter(x=>x.originalTeamName===a||x.originalTeamName===b);
  assert.equal(sorted.find(x=>x.pick===Math.min(first,second)).currentOwnerTeamName,bestOwner);
  assert.equal(sorted.find(x=>x.pick===Math.max(first,second)).currentOwnerTeamName,worstOwner);
  assert.equal(applied.find(x=>x.originalTeamName===c).currentOwnerTeamName,c);
  // Repeated ownership resolution is idempotent; finalize once in a scenario.
  if(first===2&&second===20){
    const finalized=finalizeResolvedDraftOrderAssets(swapped,applied,2029);
    assert.ok(finalized.draftPicks.filter(isSwapDraftPickAsset).every(x=>x.status==='resolved'));
    const rebuilt=applyDraftPickOwnershipToOrder(applied,{leagueData:finalized,seasonYear:2029});
    for(const row of applied)assert.equal(rebuilt.find(x=>x.pick===row.pick).currentOwnerTeamName,row.currentOwnerTeamName);
  }
  outcomes++;
}
assert.equal(outcomes,1740);
const sql=fs.readFileSync(new URL('../../supabase/bm_online_paired_swaps_phase2c2d10.sql',import.meta.url),'utf8');
for(const phrase of [
  'bm_online_prepare_human_pick_trade_base_2c2d9','bm_online_prepare_human_pick_trade(',
  "p_ids_a[1] !~ '^.+~swap:(best|worst)$'",'v_orig_a=v_orig_b',
  "v_year not between 2027 and 2032",'v_first_count<>1',
  'v_best_row,v_worst_row','v_id_a,v_id_b','v_swap_count=0',
  "'logicType','trade_machine_swap'",'swapParticipants',
  'revoke all on function public.bm_online_prepare_human_pick_trade(']) {
    assert.ok(sql.includes(phrase),'SQL safeguard missing: '+phrase);
}
assert.equal(/grant execute on function public\.bm_online_prepare_human_pick_trade\(/.test(sql),false);
const ui=fs.readFileSync(new URL('../src/online/OnlineHumanTradeRoom.jsx',import.meta.url),'utf8');
assert.ok(ui.includes('bm-online-swap-direction'));
assert.ok(ui.includes('other GM receives the better pick'));
assert.ok(!/localStorage\.|setLeagueData\(/.test(ui));
console.log('PASS online paired first-round swaps: token/security guards, stale offers, 1740 original-draft-resolver outcomes, finalization, source isolation');
