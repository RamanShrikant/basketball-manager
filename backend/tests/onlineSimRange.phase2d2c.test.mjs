import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {firstBlockedOnlineCheckpoint,isOnlineISODate,pendingOnlineGameDays,planOnlineSimToDate} from '../../frontend/src/online/onlineSimulationCheckpoints.mjs';
import {simulateOnlineDayRequest} from '../onlineSimulation.js';
const dates=['2026-10-21','2026-10-22','2027-02-03','2027-02-05'];
const g=date=>({date,id:`game-${date}`,home:'Boston Celtics',away:'Miami Heat'});
const state=()=>({seasonStartYear:2026,onlineSchedule:{phase:'regular-season',byDate:Object.fromEntries(dates.map(date=>[date,[g(date)]]))},onlineResults:{}});
test('strict dates reject invalid leap/month and injection cases',()=>{
 for(const bad of ['2026-02-30','2026-13-01','2026-2-01',null,'2027-02-05\u0000','1900-01-01'])assert.equal(isOnlineISODate(bad),false);
 assert.equal(isOnlineISODate('2028-02-29'),true);
});
test('host may plan many game dates, never skips unsupported trade deadline',()=>{
 const s=state();const p=planOnlineSimToDate(s,'2027-03-01',{maxDays:12});
 assert.deepEqual(p.days,dates.slice(0,3));
 assert.equal(p.blocked?.kind,'trade_deadline');
 assert.equal(p.blocked?.date,'2027-02-04');
 assert.equal(firstBlockedOnlineCheckpoint(s,'2027-02-05')?.kind,'trade_deadline');
});
test('range is capped, supports arbitrary target on a no-game date, and picks only unfinished days',()=>{
 const s=state();assert.deepEqual(planOnlineSimToDate(s,'2026-10-23').days,dates.slice(0,2));
 assert.deepEqual(planOnlineSimToDate(s,'2026-10-22',{maxDays:1}),{days:['2026-10-21'],blocked:null,more:true});
 s.onlineResults[g(dates[0]).id]={homeScore:100,awayScore:90};
 assert.deepEqual(pendingOnlineGameDays(s).map(r=>r.date),dates.slice(1));
 assert.deepEqual(planOnlineSimToDate(s,'2026-10-22').days,['2026-10-22']);
});
test('partial game days fail closed, regardless of target or game count',()=>{
 const s=state();s.onlineSchedule.byDate['2026-10-21'].push({id:'another',date:'2026-10-21',home:'LAL',away:'NYK'});
 s.onlineResults[g('2026-10-21').id]={homeScore:100,awayScore:90};
 assert.equal(planOnlineSimToDate(s,'2026-11-01').blocked.kind,'partial_day');
 assert.deepEqual(planOnlineSimToDate(s,'2026-11-01').days,[]);
});
test('no schedule, wrong phase, missing pending games fail closed',()=>{
 assert.deepEqual(pendingOnlineGameDays({}),[]);
 assert.deepEqual(planOnlineSimToDate({},'2027-01-01').days,[]);
 assert.throws(()=>planOnlineSimToDate(state(),'2027-02-30'),/valid/);
 assert.throws(()=>planOnlineSimToDate(state(),'2027-01-01',{maxDays:100}),/limit/);
});
test('shared server endpoint enforces checkpoint before the Python worker or SQL commit',async()=>{
 const uuid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', host='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const s=state();s.onlineResults=Object.fromEntries(dates.slice(0,3).map(date=>[g(date).id,{homeScore:110,awayScore:95}]));
 // 30 teams with 5 healthy players each to make the next game day eligible.
 s.teams=Array.from({length:30},(_,i)=>({name:i===0?'Boston Celtics':i===1?'Miami Heat':`Team ${i}`,players:Array.from({length:12},(_,j)=>({id:`p${i}-${j}`,name:`Player ${i}-${j}`,pos:['PG','SG','SF','PF','C'][j%5],overall:88-j,offRating:85-j,defRating:85-j,potential:90-j,age:26,attrs:Array(22).fill(75)}))}));
 const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test-key';
 let committed=false;
 globalThis.fetch=async url=>{
  if(url.includes('/auth/v1/user'))return new Response(JSON.stringify({id:host}));
  if(url.includes('/bm_online_lobbies'))return new Response(JSON.stringify([{host_id:host,status:'started'}]));
  if(url.includes('/bm_online_lobby_members'))return new Response(JSON.stringify([{user_id:host}]));
  if(url.includes('/bm_online_franchise_events'))return new Response('[]');
  if(url.includes('/bm_online_franchise_runtime'))return new Response(JSON.stringify([{state:s,revision:8}]));
  if(url.includes('/rpc/')){committed=true;throw Error('Must not write');}
  throw Error('Unexpected '+url);
 };
 const res={statusCode:200,set(){return this;},status(v){this.statusCode=v;return this;},json(obj){this.data=obj;return this;}};
 try {
  await simulateOnlineDayRequest({body:{lobbyId:uuid,requestId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',expectedRevision:8},get:()=>`Bearer ${'z'.repeat(40)}`},res);
  assert.equal(res.statusCode,409);assert.match(res.data.error,/Trade deadline/);assert.equal(committed,false);
 }finally{
  globalThis.fetch=oldFetch;
  if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
  if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
 }
});
test('client batch uses one authenticated day at a time, keeps request IDs for unknown HTTP outcomes, stops on revision changes',()=>{
 const src=readFileSync(new URL('../../frontend/src/online/OnlineSimulationBatchPanel.jsx',import.meta.url),'utf8');
 for(const token of ['pendingId(lobbyId,date)','forgetId(lobbyId,date)','readOnlineRuntime(lobbyId)','onAccepted?.()','stopRef.current','lastRevision','result.date!==date'])assert.ok(src.includes(token),token);
 assert.equal(src.includes('localStorage.setItem('),false);
});
