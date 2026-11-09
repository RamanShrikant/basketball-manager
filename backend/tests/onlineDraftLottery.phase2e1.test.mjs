import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildAuthoritativeLotteryRecords,validateOriginalLotteryResult} from '../onlineDraftLotteryCore.mjs';
import {runOriginalDraftLottery,drawOnlineDraftLotteryRequest} from '../onlineDraftLottery.js';
const HOST='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GUEST='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOBBY='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const baseline=(year=2026)=>{
 const conf={};const snapshot=[];const teams=[];
 for(const name of ['East','West']){
   const seeds=Array.from({length:15},(_,i)=>`${name} ${i+1}`);
   const game78={played:true,home:seeds[6],away:seeds[7],winner:seeds[6],loser:seeds[7]};
   conf[name]={playIn:{g78:game78,g910:{played:true,home:seeds[8],away:seeds[9],winner:seeds[8],loser:seeds[9]},
     gFinal:{played:true,home:seeds[7],away:seeds[8],winner:seeds[8],loser:seeds[7]},seed7:seeds[6],seed8:seeds[8]}};
   seeds.forEach((name,i)=>{
     teams.push({name,conference:name.split(' ')[0],players:[]});
     snapshot.push({teamName:name,conference:name.split(' ')[0],wins:62-i*2,losses:20+i*2,
       pointDifferential:120-i*10,conferenceSeed:i<10?i+1:null,leagueRank:1+i*2+(name.startsWith('East')?0:1)});
   });
 }
 return {teams,onlineSchedule:{phase:'postseason',seasonYear:year},
  onlinePostseason:{seasonYear:year,phase:'postseasonComplete',champion:'East 1',
    regularSeasonSnapshot:snapshot,seedOrder:Object.fromEntries(['East','West'].map(c=>[c,Array.from({length:10},(_,i)=>`${c} ${i+1}`)])),conf}};
};
const respond=()=>({statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this;},status(c){this.statusCode=c;return this;},json(d){this.data=d;return this;}});
const request=(body={lobbyId:LOBBY,requestId:REQUEST,expectedRevision:7})=>({body,get:()=>`Bearer ${'x'.repeat(40)}`});
const mock=(state,{actor=HOST,revision=7,event=null}={})=>{
 const calls={rpc:0};
 const fn=async(url,opts={})=>{
  if(url.includes('/auth/v1/user'))return new Response(JSON.stringify({id:actor}));
  if(url.includes('/bm_online_lobbies'))return new Response(JSON.stringify([{host_id:HOST,status:'started'}]));
  if(url.includes('/bm_online_lobby_members'))return new Response(JSON.stringify([{user_id:actor}]));
  if(url.includes('/bm_online_franchise_events'))return new Response(JSON.stringify(event?[event]:[]));
  if(url.includes('/bm_online_franchise_runtime'))return new Response(JSON.stringify([{revision,state}]));
  if(url.includes('/rpc/bm_online_draw_draft_lottery')){
    calls.rpc++;calls.payload=JSON.parse(opts.body);
    return new Response(JSON.stringify({ok:true,revision:revision+1}));
  }
  throw Error(`Unexpected request ${url}`);
 };
 return {fn,calls};
};
async function withMock(callback){
 const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://mock.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='example-service-secret';
 try{return await callback();}finally{globalThis.fetch=oldFetch;
   if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
   if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
 }
}

test('frozen standings: 30 teams, correct playoff/Play-In outcomes and two 7/8 losers',()=>{
 const {records,draftYear}=buildAuthoritativeLotteryRecords(baseline());
 assert.equal(draftYear,2027);assert.equal(records.length,30);
 assert.equal(records.filter(r=>r.madePlayoffs).length,16);
 assert.equal(records.filter(r=>r.madePlayIn).length,8);
 assert.equal(records.filter(r=>r.lostSevenEightGame).length,2);
 assert.equal(records.find(r=>r.teamName==='East 8').lostSevenEightGame,true);
 assert.equal(records.find(r=>r.teamName==='East 9').madePlayoffs,true);
 assert.equal(records.find(r=>r.teamName==='East 7').madePlayoffs,true);
});
test('lottery input strictly rejects incomplete Finals, changed year, duplicated teams, and stale draws',()=>{
 for(const change of [
 s=>{s.onlinePostseason.phase='playoffs';},
 s=>{s.onlinePostseason.champion=null;},
 s=>{s.onlineSchedule.seasonYear=2025;},
 s=>{s.onlineDraftLottery={};},
 s=>{s.onlinePostseason.regularSeasonSnapshot[0].wins=90;},
 s=>{s.onlinePostseason.regularSeasonSnapshot[1].teamName='East 1';},
 s=>{s.onlinePostseason.regularSeasonSnapshot[1].leagueRank=1;},
 s=>{s.onlinePostseason.conf.West.playIn.g78.played=false;},
 s=>{s.onlinePostseason.conf.West.playIn.seed7='Unknown';},
 s=>{s.onlinePostseason.regularSeasonSnapshot.pop();},
 ]){const state=baseline();change(state);assert.throws(()=>buildAuthoritativeLotteryRecords(state));}
});
test('unchanged original Python 2027+ 3-2-1 draw produces all 60 draft slots, no duplicates',()=>{
 const source=baseline(),before=JSON.stringify(source);
 const lot=runOriginalDraftLottery(source,'test-seed-321');
 assert.equal(JSON.stringify(source),before);
 assert.equal(lot.system,'three_two_one');assert.equal(lot.draftYear,2027);
 assert.equal(lot.rightsSettlement,'pending');assert.equal(lot.result.lotteryTeams.length,16);
 for(const round of [lot.result.firstRoundOrder,lot.result.secondRoundOrder])assert.equal(new Set(round.map(p=>p.teamName)).size,30);
 assert.equal(lot.result.fullDraftOrder.length,60);
 const again=runOriginalDraftLottery(source,'test-seed-321');
 assert.deepEqual(lot,again,'server seed makes original lottery deterministic');
});
test('unchanged original Python 2026 legacy draw gives 14 lottery teams and full order',()=>{
 const lot=runOriginalDraftLottery(baseline(2025),'test-seed-legacy');
 assert.equal(lot.system,'legacy_14');assert.equal(lot.draftYear,2026);
 assert.equal(lot.result.lotteryTeams.length,14);assert.equal(lot.result.fullDraftOrder.length,60);
});
test('reject mutated Python output with invalid pick owner, duplicate, wrong season or missing round',()=>{
 const source=baseline(),lot=runOriginalDraftLottery(source,'validation-seed');
 const {records,draftYear}=buildAuthoritativeLotteryRecords(source);
 for(const mutate of [
 l=>{l.firstRoundOrder[0].originalTeamName='wrong';},
 l=>{l.firstRoundOrder[0].teamName=l.firstRoundOrder[1].teamName;},
 l=>{l.secondRoundOrder.pop();},
 l=>{l.fullDraftOrder[0].pick=99;},
 l=>{l.seasonYear=2026;},
 l=>{l.meta.system='legacy_14';}
 ]){const mutated=structuredClone(lot.result);mutate(mutated);
   assert.throws(()=>validateOriginalLotteryResult(mutated,records,draftYear));}
});
test('trusted host commits one draw with no browser-provided lottery outcomes',async()=>withMock(async()=>{
 const m=mock(baseline()),old=globalThis.fetch;globalThis.fetch=m.fn;
 try{const res=respond();await drawOnlineDraftLotteryRequest(request(),res);
 assert.equal(res.statusCode,200);assert.equal(res.data.ok,true);assert.equal(m.calls.rpc,1);
 assert.equal(m.calls.payload.p_lottery.rightsSettlement,'pending');
 assert.equal(m.calls.payload.p_lottery.result.fullDraftOrder.length,60);
 }finally{globalThis.fetch=old;}
}));
test('guest and stale revisions cannot draw; replay returns previous revision without new draw',async()=>withMock(async()=>{
 for(const args of [{actor:GUEST},{revision:8}]){
  const m=mock(baseline(),args),old=globalThis.fetch;globalThis.fetch=m.fn;
  try{const res=respond();await drawOnlineDraftLotteryRequest(request(),res);
    assert.equal(res.data.ok,false);assert.equal(m.calls.rpc,0);}
  finally{globalThis.fetch=old;}
 }
 const m=mock(baseline(),{event:{actor_id:HOST,action_type:'draft_lottery_drawn',revision:19,details:{draftYear:2027}}}),old=globalThis.fetch;globalThis.fetch=m.fn;
 try{const res=respond();await drawOnlineDraftLotteryRequest(request(),res);
 assert.equal(res.data.replayed,true);assert.equal(res.data.revision,19);assert.equal(m.calls.rpc,0);}
 finally{globalThis.fetch=old;}
}));
test('reject extraneous browser payload fields, stolen request replay and incomplete postseason',async()=>withMock(async()=>{
 for(const [body,event,state] of [
 [{...request().body,forcedSeed:'attacker'},null,baseline()],
 [request().body,{actor_id:GUEST,action_type:'draft_lottery_drawn'},baseline()],
 [request().body,null,{...baseline(),onlineDraftLottery:{}}],
 ]){
  const m=mock(state,{event}),old=globalThis.fetch;globalThis.fetch=m.fn;
  try{const res=respond();await drawOnlineDraftLotteryRequest(request(body),res);
     assert.equal(res.data.ok,false);assert.equal(m.calls.rpc,0);}
  finally{globalThis.fetch=old;}
 }
}));
test('database migration is service-role-only and validates locked final postseason and draft order',()=>{
 const sql=readFileSync(new URL('../../supabase/bm_online_draft_lottery_phase2e1.sql',import.meta.url),'utf8');
 for(const rule of ['for update','postseasonComplete','draft_lottery_drawn','originalTeamName',
  'currentOwnerTeamName','firstRoundOrder','secondRoundOrder','service_role','v_rev<>p_expected_revision'])
  assert.ok(sql.includes(rule),`Missing database rule ${rule}`);
});
