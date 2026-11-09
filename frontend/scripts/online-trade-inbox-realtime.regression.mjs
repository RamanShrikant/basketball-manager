import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectPendingOnlineTradeOffer as check} from '../src/online/onlineTradeOfferSafety.mjs';
const repo=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const read=path=>readFileSync(resolve(repo,path),'utf8');
const team=(name,ids)=>({name,players:ids.map(id=>({id,name:id}))});
const league={teams:[team('Phoenix',['a','b']),team('Toronto',['c','d']),team('Utah',['e'])],
  draftPicks:[{id:'p1',year:2028,round:1,ownerTeam:'Phoenix',status:'active'},
    {id:'p2',year:2029,round:2,ownerTeam:'Toronto',status:'active'}]};
const offer={id:'offer1',status:'pending',proposer_team:'Phoenix',recipient_team:'Toronto',
  proposer_player_ids:['a'],recipient_player_ids:['c'],proposer_pick_ids:['p1'],recipient_pick_ids:['p2']};
const clone=o=>structuredClone(o);
assert.deepEqual(check(offer,league),{current:true,reason:''});
assert.equal(check({...offer,status:'accepted'},{}).current,true,'resolved offer is historical not stale');
assert.equal(check({...offer,recipient_team:'Phoenix'},league).current,false);
assert.equal(check({...offer,proposer_player_ids:['a','a']},league).current,false);
assert.equal(check({...offer,proposer_player_ids:[]},league).current,false);
assert.equal(check({...offer,proposer_player_ids:['c']},league).current,false);
assert.equal(check({...offer,recipient_player_ids:['e']},league).current,false);
assert.equal(check({...offer,proposer_pick_ids:['p2']},league).current,false);
assert.equal(check({...offer,proposer_pick_ids:['p1','p1']},league).current,false);
assert.equal(check({...offer,proposer_pick_ids:['gone']},league).current,false);
const duplicatedPlayer=clone(league);duplicatedPlayer.teams[2].players.push({id:'a'});
assert.equal(check(offer,duplicatedPlayer).current,false,'global duplicate player ID must be detected');
const duplicatedPick=clone(league);duplicatedPick.draftPicks.push({...duplicatedPick.draftPicks[0]});
assert.equal(check(offer,duplicatedPick).current,false,'duplicate draft asset ID must be detected');
const stalePick=clone(league);stalePick.draftPicks[0].status='resolved';
assert.equal(check(offer,stalePick).current,false);
const aliases=clone(league);aliases.draftPicks[0].owner='Toronto';
assert.equal(check(offer,aliases).current,false,'owner aliases may not disagree');
const noPick=clone(league);delete noPick.draftPicks;
assert.equal(check(offer,noPick).current,false,'missing draft ledger is fail closed');
const conf={conferences:{East:[team('Phoenix',['a']),team('Toronto',['c'])]},draftPicks:[]};
assert.equal(check({...offer,proposer_pick_ids:[],recipient_pick_ids:[]},conf).current,true,'conference shape is supported');

const room=read('frontend/src/online/OnlineHumanTradeRoom.jsx');
const client=read('frontend/src/online/onlineRuntimeClient.js');
const sql=read('supabase/bm_online_trade_inbox_realtime_phase2c2d5.sql');
assert(room.includes('subscribeOnlineTradeOffers(lobbyId'));
assert(room.includes('setInterval(()=>{if(live)void refresh()'), 'polling fallback remains');
assert(room.includes("window.addEventListener('online',recover)"));
assert(room.includes("document.addEventListener('visibilitychange',recover)"));
assert(room.includes('generation!==refreshGeneration.current'),'out of order fetch must be suppressed');
assert(room.includes('unsubscribe();window.removeEventListener'), 'cleanup removes online and realtime listeners');
assert(room.includes('offerChecks.get(o.id)?.current'));
assert(room.includes('disabled={busy||tradeClosed||!offerChecks.get(o.id)?.current}'), 'deadline lock must also disable stale offer acceptance');
assert(room.includes('await respondOnlineHumanTrade'), 'server remains the trade authority');
assert(client.includes("table:'bm_online_trade_offers'"));
assert(client.includes('supabase.removeChannel(channel)'));
assert(sql.includes('alter publication supabase_realtime add table public.bm_online_trade_offers'));
assert(sql.includes("policyname='bm_online_trade_offers_member_read'"));
assert(sql.includes('relrowsecurity'));
assert(!/grant\s+(insert|update|delete)\s+on\s+public\.bm_online_trade_offers\s+to\s+authenticated/i.test(sql));
for (const source of [room,read('frontend/src/online/onlineTradeOfferSafety.mjs')]) {
  assert.doesNotMatch(source,/\b(?:localStorage|sessionStorage|indexedDB)\s*[.\[]/);
  assert.doesNotMatch(source,/\bsaveLeagueData\s*\(/);
}
console.log('PASS: current/stale offer checks, duplicate ID ownership, draft ownership, subscription, polling recovery, safe SQL publication, no single-player mutations');
