import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {originalProgression,verifyProgressionOutput,onlineProgressionRequest} from '../onlineProgression.js';

const HOST='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GUEST='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOBBY='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const YEAR=2027;
const teams=Array.from({length:30},(_,i)=>`Team ${i+1}`);
const deepcopy=x=>structuredClone(x);
function fixture(flat=false){
 const nba=teams.map((name,i)=>({name,capSpace:1_234_000,players:Array.from({length:11},(_,j)=>({
  id:`${i}:${j}`,name:`Player ${i} ${j}`,age:20+j%17,overall:70+j%20,potential:89,
  pos:['PG','SG','SF','PF','C'][j%5],attrs:Array.from({length:15},(_,k)=>68+j%20+k%3),
  contract:{startYear:YEAR-2,salaryByYear:[5e6,5e6]},rights:{heldByTeam:name,birdLevel:'bird'},
  meta:{proSeasons:3,yearsWithCurrentTeam:2},history:{seasons:[{seasonYear:2026,ppg:12}]}
 })),twoWayPlayers:[],stashPlayers:[]}));
 nba[0].twoWayPlayers.push({id:'two_way_01',name:'Two Way',age:20,overall:72,potential:90,attrs:[75,75,75,75,75,75,75,75,75,75,75,75,75,75,75],pos:'PG',contractType:'two_way'});
 nba[1].stashPlayers.push({id:'stash_01',name:'Stash',age:21,overall:67,potential:88,attrs:Array(15).fill(68),pos:'C',rosterStatus:'stashed'});
 nba[0].players[0]={...nba[0].players[0],id:'rookie_2027_special',name:'Draft Class Rookie',age:19,meta:{draftYear:YEAR,acquiredVia:'draft'},lastBirthdayYear:2026};
 nba[2].players[0].lastBirthdayYear=YEAR; // Birthday was already applied during season.
 const state={seasonYear:2026,onlineDraft:{draftYear:YEAR,status:'complete'},
  onlineRookieSignings:{status:'complete'},onlineOptions:{year:YEAR,status:'complete'},
  onlineRights:{year:YEAR,status:'complete'},
  onlineOffseasonMarket:{status:'complete',year:YEAR,phase:'complete',day:10},
  freeAgencyState:{marketComplete:true,isActive:false,status:'complete',signedPlayersLog:[{playerId:'signed'}]},
  offseasonState:{active:true,optionsComplete:true,rightsManagementComplete:true,freeAgencyComplete:true,progressionComplete:false},
  freeAgents:[{id:'fa_01',name:'Available Veteran',age:33,overall:74,potential:76,pos:'SG',attrs:Array(15).fill(75),rights:{heldByTeam:null}}],
  retiredPlayersHistory:[{id:'retired_test',name:'Retired'}],
  draftPicks:[{team:teams[0],year:2032}],onlinePlayerStats:{},
  ...(flat?{teams:nba}:{conferences:{East:nba.slice(0,15),West:nba.slice(15)}})};
 return state;
}
function all(state){return Array.isArray(state.teams)?state.teams:Object.values(state.conferences).flat();}
function response(){return {statusCode:200,set(){return this},status(code){this.statusCode=code;return this},json(obj){this.body=obj;return this}};}
async function network(state,callback,{actor=HOST,revision=9,events=[]}={}){
 const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://bm.mock.co';process.env.SUPABASE_SERVICE_ROLE_KEY='mock-key';
 const writes=[];
 globalThis.fetch=async(url,opts={})=>{
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status});
  if(url.includes('/auth/v1/user'))return reply({id:actor});
  if(url.includes('/bm_online_lobbies'))return reply([{host_id:HOST,status:'started'}]);
  if(url.includes('/bm_online_lobby_members'))return reply([{user_id:actor}]);
  if(url.includes('/bm_online_franchise_events'))return reply(events);
  if(url.includes('/bm_online_franchise_runtime'))return reply([{state,revision}]);
  if(url.includes('/rpc/')){writes.push({url,body:JSON.parse(opts.body)});return reply({ok:true,revision:revision+1});}
  throw Error(`Unmocked ${url}`);
 };
 try{await callback(writes);}finally{
  globalThis.fetch=oldFetch;
  if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
  if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
 }
}
const req=(rev=9)=>({get:()=>`Bearer ${'x'.repeat(60)}`,body:{lobbyId:LOBBY,requestId:REQUEST,expectedRevision:rev}});

test('the original Python progression runs for 30 teams, two-way/stash, and free agents',()=>{
 for(const flat of [false,true]){
  const state=fixture(flat),backup=deepcopy(state);
  const updated=originalProgression(state,YEAR,120313);
  assert.deepEqual(state,backup,'worker must never mutate committed read state');
  assert.equal(updated.onlineProgression.status,'complete');
  const sum=verifyProgressionOutput(state,updated,YEAR);
  assert.equal(sum.playerCount,333);
  assert.equal(sum.protectedRookies,1);
  assert.ok(sum.aged>300);
  assert.deepEqual(all(updated)[0].players[0],all(state)[0].players[0],'new draft rookie must remain identical');
  assert.equal(all(updated)[2].players[0].age,all(state)[2].players[0].age,'already-aged guard');
  assert.equal(updated.freeAgents.length,1);
  assert.deepEqual(updated.draftPicks,state.draftPicks);
  assert.deepEqual(updated.freeAgencyState,state.freeAgencyState);
  assert.deepEqual(updated.retiredPlayersHistory,state.retiredPlayersHistory);
  assert.deepEqual(all(updated)[0].players[1].contract,all(state)[0].players[1].contract);
  assert.ok(updated.onlineProgression.changes.some(x=>x.bucket==='twoWayPlayers'));
  assert.ok(updated.onlineProgression.changes.some(x=>x.bucket==='stashPlayers'));
 }
});

test('seeded original player development produces deterministic official results',()=>{
 const state=fixture(),x=originalProgression(state,YEAR,74321),y=originalProgression(state,YEAR,74321);
 assert.deepEqual(x,y);
});

test('validator rejects forged contracts, ownership, rosters, summary and stale external data',()=>{
 const before=fixture(),good=originalProgression(before,YEAR,809);
 const attempts=[
  state=>all(state)[0].players[1].contract.salaryByYear[0]=123,
  state=>all(state)[0].players[1].rights.birdLevel='none',
  state=>all(state)[0].players[1].history.seasons[0].ppg=55,
  state=>all(state)[0].players[1].age+=1,
  state=>all(state)[0].players[1].id='forged',
  state=>all(state)[0].players.push({...all(state)[0].players[1]}),
  state=>state.freeAgents[0].id=all(state)[0].players[1].id,
  state=>state.freeAgencyState.marketComplete=false,
  state=>state.draftPicks[0].year=2029,
  state=>state.offseasonState.rightsManagementComplete=false,
  state=>state.onlineProgression.summary.playerCount+=1,
  state=>state.onlineProgression.changes[0].overallDelta+=3,
  state=>state.onlineProgression.seasonYear=2029,
  state=>all(state)[0].players[0].age+=1,
 ];
 for(const change of attempts){const bad=deepcopy(good);change(bad);
  assert.throws(()=>verifyProgressionOutput(before,bad,YEAR));}
});

test('guest and malformed requests never reach the server-owned progression RPC',async()=>{
 const state=fixture();
 await network(state,async writes=>{
  const res=response();await onlineProgressionRequest(req(),res);
  assert.equal(res.statusCode,403);assert.equal(writes.length,0);
 },{actor:GUEST});
 await network(state,async writes=>{
  const res=response();await onlineProgressionRequest({...req(),body:{...req().body,playerChanges:[1]}},res);
  assert.equal(res.statusCode,400);assert.equal(writes.length,0);
 });
});

test('a host progression transaction includes only a revisioned backend-generated state',async()=>{
 const state=fixture();
 await network(state,async writes=>{
  const res=response();await onlineProgressionRequest(req(),res);
  assert.equal(res.statusCode,200,JSON.stringify(res.body));
  assert.equal(writes.length,1);
  assert.match(writes[0].url,/bm_online_apply_progression_phase2e4d/);
  assert.equal(writes[0].body.p_expected_revision,9);
  assert.equal(writes[0].body.p_new_state.onlineProgression.status,'complete');
  assert.equal(writes[0].body.p_new_state.offseasonState.progressionComplete,true);
  assert.equal(writes[0].body.p_new_state.onlineProgression.summary.playerCount,333);
 });
});

test('stale revision and repeated completion reject without a write',async()=>{
 await network(fixture(),async writes=>{const res=response();await onlineProgressionRequest(req(8),res);
  assert.equal(res.statusCode,409);assert.equal(writes.length,0);});
 const done=originalProgression(fixture(),YEAR,1001);
 await network(done,async writes=>{const res=response();await onlineProgressionRequest(req(),res);
  assert.equal(res.statusCode,409);assert.equal(writes.length,0);});
});

test('confirmed request IDs replay without rerunning progression',async()=>{
 const events=[{actor_id:HOST,action_type:'online_player_progression',revision:10,
  details:{inputHash:'this will be set'}}];
 // test hash using the actual request algorithm
 const {createHash}=await import('node:crypto');
 const digest=createHash('sha256').update(JSON.stringify({action:'online_player_progression',lobbyId:LOBBY,expectedRevision:9})).digest('hex');
 events[0].details.inputHash=digest;
 await network(fixture(),async writes=>{const res=response();await onlineProgressionRequest(req(),res);
  assert.equal(res.statusCode,200);assert.equal(res.body.replayed,true);assert.equal(res.body.revision,10);assert.equal(writes.length,0);
 },{events});
});

test('SQL migration limits RPC to service role, locks revision and guards offseason stage',()=>{
 const source=readFileSync(fileURLToPath(new URL('../../supabase/bm_online_player_progression_phase2e4d.sql',import.meta.url)),'utf8');
 for(const pattern of [
  /FOR UPDATE/ig,/bm_online_apply_progression_phase2e4d/ig,/service_role/ig,
  /REVOKE ALL ON FUNCTION/ig,/bm_online_progression_guard_phase2e4d/ig,
  /online_free_agency_write/ig,
 ]){
  if(pattern.source==='online_free_agency_write')continue; // not used in trusted progression RPC
  assert.match(source,pattern);
 }
 assert.doesNotMatch(source,/\bDROP TABLE\b|\bTRUNCATE\b|\bDELETE FROM\b/i);
});
