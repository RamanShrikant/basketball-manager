import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateTradeDeadlineReadiness,closeOnlineTradeDeadlineRequest} from '../onlineTradeDeadline.js';
import {firstBlockedOnlineCheckpoint,isOnlineTradeDeadlineClosed,planOnlineSimToDate} from '../../frontend/src/online/onlineSimulationCheckpoints.mjs';

const LOBBY='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HOST='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUEST='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const game=date=>({date,id:`game-${date}`,home:'Boston Celtics',away:'Miami Heat'});
function snapshot(){return {seasonStartYear:2026,onlineSchedule:{phase:'regular-season',seasonYear:2026,byDate:{
  '2027-02-03':[game('2027-02-03')], '2027-02-05':[game('2027-02-05')],
  '2027-02-22':[game('2027-02-22')], '2027-04-01':[game('2027-04-01')]
}},onlineResults:{['game-2027-02-03']:{id:'game-2027-02-03',date:'2027-02-03',homeScore:101,awayScore:98}}};}
function closed(s,rev=10){s.onlineCheckpoints={trade_deadline:{status:'closed',date:'2027-02-04',seasonYear:2026,revision:rev,closedBy:HOST}};return s;}

test('checkpoint is closed only by an exact season/date/revision marker',()=>{
 const s=snapshot();
 assert.equal(firstBlockedOnlineCheckpoint(s,'2027-02-05')?.kind,'trade_deadline');
 assert.deepEqual(evaluateTradeDeadlineReadiness(s),{date:'2027-02-04',nextGameDate:'2027-02-05'});
 closed(s);
 assert.equal(isOnlineTradeDeadlineClosed(s,'2027-02-04'),true);
 assert.equal(firstBlockedOnlineCheckpoint(s,'2027-02-05'),null);
 assert.deepEqual(planOnlineSimToDate(s,'2027-02-06').days,['2027-02-05']);
 assert.equal(firstBlockedOnlineCheckpoint(s,'2027-02-22')?.kind,'all_star');
 s.onlineCheckpoints.trade_deadline.date='2028-02-04';
 assert.equal(firstBlockedOnlineCheckpoint(s,'2027-02-05')?.kind,'trade_deadline');
 s.onlineCheckpoints.trade_deadline.date='2027-02-04';
 s.onlineSchedule.seasonYear=2027;
 assert.equal(firstBlockedOnlineCheckpoint(s,'2027-02-05')?.kind,'trade_deadline');
 s.onlineCheckpoints.trade_deadline.seasonYear=2027;
 s.onlineCheckpoints.trade_deadline.revision=0;
 assert.equal(isOnlineTradeDeadlineClosed(s,'2027-02-04'),false);
});

test('host cannot bypass earlier games, partial game dates or already-finalized deadline',()=>{
 const s=snapshot();
 delete s.onlineResults['game-2027-02-03'];
 assert.throws(()=>evaluateTradeDeadlineReadiness(s),/not the next required/);
 s.onlineResults['game-2027-02-03']={homeScore:101,awayScore:98};
 s.onlineSchedule.byDate['2027-02-05'].push({...game('2027-02-05'),id:'second'});
 s.onlineResults['game-2027-02-05']={homeScore:110,awayScore:103};
 assert.throws(()=>evaluateTradeDeadlineReadiness(s),/partial/);
 s.onlineResults={};s.onlineSchedule.byDate={};
 assert.throws(()=>evaluateTradeDeadlineReadiness(s),/no remaining/);
 assert.throws(()=>evaluateTradeDeadlineReadiness(closed(snapshot())),/not the next required/);
});

function response(){return {statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this;},status(code){this.statusCode=code;return this;},json(data){this.data=data;return this;}};}
async function withMock(behavior,fn){
 const prevFetch=globalThis.fetch,prevUrl=process.env.SUPABASE_URL,prevKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='fake-service-key';
 const commits=[];
 globalThis.fetch=async (url,opts={})=>{
  if(url.includes('/auth/v1/user'))return new Response(JSON.stringify({id:HOST}));
  if(url.includes('/bm_online_lobbies'))return new Response(JSON.stringify([{host_id:behavior.guest?'dddddddd-dddd-4ddd-8ddd-dddddddddddd':HOST,status:'started'}]));
  if(url.includes('/bm_online_lobby_members'))return new Response(JSON.stringify([{user_id:HOST}]));
  if(url.includes('/bm_online_franchise_events'))return new Response(JSON.stringify(behavior.event||[]));
  if(url.includes('/bm_online_franchise_runtime'))return new Response(JSON.stringify([{revision:behavior.revision??9,state:behavior.state??snapshot()}]));
  if(url.includes('/rpc/bm_online_close_trade_deadline_phase2d2d')){
   commits.push(JSON.parse(opts.body));return new Response(JSON.stringify({ok:true,revision:10,offers_closed:2}));
  }
  throw Error(`Unexpected request ${url}`);
 };
 try{return await fn(commits);}finally{
  globalThis.fetch=prevFetch;
  if(prevUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=prevUrl;
  if(prevKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=prevKey;
 }
}
const req=(revision=9)=>({body:{lobbyId:LOBBY,requestId:REQUEST,expectedRevision:revision},get:()=>`Bearer ${'x'.repeat(40)}`});

test('host-only endpoint derives date, submits no state or client-supplied actor, and commits once',async()=>{
 await withMock({},async commits=>{
  const res=response();await closeOnlineTradeDeadlineRequest(req(),res);
  assert.equal(res.statusCode,200);assert.deepEqual({...res.data},{ok:true,date:'2027-02-04',revision:10,offersClosed:2,replayed:false});
  assert.equal(commits.length,1);
  assert.deepEqual(commits[0],{p_lobby:LOBBY,p_actor:HOST,p_request:REQUEST,p_expected_revision:9,p_date:'2027-02-04'});
  assert.equal(res.headers['Cache-Control'],'no-store');
 });
});
test('guest, stale revision and early deadline never reach privileged RPC',async()=>{
 for(const behavior of [{guest:true},{revision:10},{state:{...snapshot(),onlineResults:{}}}]){
  await withMock(behavior,async commits=>{
   const res=response();await closeOnlineTradeDeadlineRequest(req(),res);
   assert.ok([403,409].includes(res.statusCode));assert.equal(commits.length,0);
  });
 }
});
test('confirmed retry returns event replay even when league revision has advanced',async()=>{
 await withMock({revision:40,state:closed(snapshot()),event:[{actor_id:HOST,action_type:'trade_deadline_closed',revision:10,details:{date:'2027-02-04',offers_closed:2}}]},async commits=>{
  const res=response();await closeOnlineTradeDeadlineRequest(req(),res);
  assert.equal(res.statusCode,200);assert.equal(res.data.replayed,true);assert.equal(commits.length,0);
 });
});
test('request-ID reuse by another action is rejected without committing',async()=>{
 await withMock({event:[{actor_id:HOST,action_type:'human_trade_accepted',revision:10,details:{}}]},async commits=>{
  const res=response();await closeOnlineTradeDeadlineRequest(req(),res);
  assert.equal(res.statusCode,409);assert.equal(commits.length,0);
 });
});
test('injected actor/date, malformed UUID and extra fields are rejected',async()=>{
 await withMock({},async commits=>{
  for(const body of [{...req().body,actorId:HOST},{...req().body,date:'2027-01-01'},
    {...req().body,lobbyId:'not-a-uuid'},{...req().body,expectedRevision:'9'}]){
    const res=response();await closeOnlineTradeDeadlineRequest({body,get:req().get},res);
    assert.equal(res.statusCode,400);
  }
  assert.equal(commits.length,0);
 });
});
test('SQL checkpoint migration includes privileged RPC and independent event, offer and result guards',()=>{
 const sql=readFileSync(new URL('../../supabase/bm_online_trade_deadline_phase2d2d.sql',import.meta.url),'utf8');
 for(const phrase of ['bm_online_close_trade_deadline_phase2d2d','for update','host_id','bm_online_lobby_members',
  "status='cancelled'",'trade_deadline_closed','offers_closed',
  'bm_online_trade_offer_deadline_guard','bm_online_trade_event_deadline_guard','bm_online_deadline_runtime_guard',
  "new.action_type in ('human_trade_accepted','cpu_trade_accepted')",'Cannot simulate past an unresolved Online trade deadline',
  'revoke all on function public.bm_online_close_trade_deadline_phase2d2d','to service_role'])assert.ok(sql.includes(phrase),phrase);
 assert.equal(/grant execute on function public\.bm_online_close_trade_deadline_phase2d2d\([^;]*to authenticated/i.test(sql),false);
});

test('trusted Python simulator includes byte-identical original single-player engine dependencies',()=>{
 const files=['game_sim','assists','blocks','bm_scoring','efficiency','rebounds','shooting_model','steals'];
 for(const name of files){
   const original=readFileSync(new URL(`../../frontend/public/python/${name}.py`,import.meta.url));
   const trusted=readFileSync(new URL(`../online_sim_python/${name}.py`,import.meta.url));
   assert.deepEqual(trusted,original,`${name}.py differs from the original engine`);
 }
});
