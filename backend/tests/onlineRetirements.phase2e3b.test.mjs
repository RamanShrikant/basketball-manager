import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {originalRetirementRun,retirementTransaction,onlineRetirementRequest} from '../onlineRetirements.js';
const HOST='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GUEST='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOBBY='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ID='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const player=(id,age=26,overall=77)=>({id,name:`Name ${id}`,age,overall,potential:85,team:'Fake',pos:'SG',contract:{salaryByYear:[3000000]}});
function fixture(flat=false){
 const names=Array.from({length:30},(_,i)=>`Team ${i+1}`);
 const teams=names.map((name,i)=>({name,players:[{...player(`standard-${i}`,i===2?46:25,75),team:name}],twoWayPlayers:[],pendingRookieSignings:[],stashPlayers:[]}));
 const s={seasonYear:2026,freeAgents:[{...player('fa-old',50,65),team:'Free Agent'}],
  retiredPlayersHistory:[],onlinePlayerStats:{},onlinePostseason:{phase:'postseasonComplete',seasonYear:2026,champion:'Team 1'}};
 if(flat)s.teams=teams;else s.conferences={East:teams.slice(0,15),West:teams.slice(15)};
 return s;
}
const res=()=>({statusCode:200,set(){return this;},status(n){this.statusCode=n;return this;},json(x){this.body=x;return this;}});
async function mockNetwork(state,fn,{host=HOST,actor=HOST,revision=7,member=true,events=[],rpcOk=true}={}){
 const original=globalThis.fetch,oldU=process.env.SUPABASE_URL,oldK=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://mock.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='server-secret';const writes=[];
 globalThis.fetch=async(url,opts={})=>{
  const body=(x,status=200)=>new Response(JSON.stringify(x),{status});
  if(url.includes('/auth/v1/user'))return body({id:actor});
  if(url.includes('/bm_online_lobbies'))return body([{host_id:host,status:'started'}]);
  if(url.includes('/bm_online_lobby_members'))return body(member?[{user_id:actor}]:[]);
  if(url.includes('/bm_online_franchise_events'))return body(events);
  if(url.includes('/bm_online_franchise_runtime'))return body([{state,revision}]);
  if(url.includes('/rpc/')){writes.push(JSON.parse(opts.body));return body(rpcOk?{ok:true,revision:revision+1}:{ok:false},rpcOk?200:409);}
  throw Error(`Unknown URL: ${url}`);
 };
 try{return await fn(writes);}finally{globalThis.fetch=original;
  if(oldU===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldU;
  if(oldK===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldK;}
}
const req=(mode,body={})=>({get:()=>`Bearer ${'x'.repeat(48)}`,body:{lobbyId:LOBBY,expectedRevision:7,...(mode==='run'?{requestId:ID}:{}),...body}});
test('original Python retirement engine supports canonical conference shape without modifying original league',()=>{
 const state=fixture(),snapshot=JSON.stringify(state);
 const preview=originalRetirementRun(state,{mode:'preview',seasonYear:2027});
 assert.equal(preview.preview.length,31);
 const result=originalRetirementRun(state,{mode:'commit',seasonYear:2027});
 const tx=retirementTransaction(state,result,2027);
 assert.equal(JSON.stringify(state),snapshot);
 assert.ok(tx.teamRemovals.some(r=>r.id==='standard-2'));
 assert.ok(tx.freeRemovals.includes('fa-old'));
 assert.equal(result.retiredPlayers.length,tx.teamRemovals.length+tx.freeRemovals.length);
 assert.equal(result.leagueData.conferences.East[2].players.length,0);
});
test('original Python retirement engine supports flat 30-team shape through adapter',()=>{
 const state=fixture(true);state.teams[5].players[0].id=55;const before=JSON.stringify(state);
 const result=originalRetirementRun(state,{mode:'commit',seasonYear:2027});
 const tx=retirementTransaction(state,result,2027);
 assert.equal(JSON.stringify(state),before);
 assert.ok(tx.teamRemovals.some(x=>x.teamName==='Team 3'));
 assert.equal(result.leagueData.teams.length,30);
 assert.ok(!Object.hasOwn(result.leagueData,'conferences'));
});
test('retirement transaction rejects rewritten veteran contract, unrelated metadata, and history mismatch',()=>{
 const state=fixture(),result=originalRetirementRun(state,{mode:'commit',seasonYear:2027});
 const modified=structuredClone(result);modified.leagueData.conferences.East[0].players[0].contract.salaryByYear[0]=100;
 assert.throws(()=>retirementTransaction(state,modified,2027),/changed unrelated|non-retired/);
 const bad=structuredClone(result);bad.retiredPlayers[0].id='injected-id';
 assert.throws(()=>retirementTransaction(state,bad,2027),/history|removed player IDs/);
 const moved=structuredClone(result);moved.leagueData.freeAgents.push({...player('extra-ghost')});
 assert.throws(()=>retirementTransaction(state,moved,2027),/free-agent/);
});
test('preview is available to a member without committing any roster changes',async()=>{
 await mockNetwork(fixture(),async(writes)=>{
  const r=res();await onlineRetirementRequest(req('preview'),r,'preview');
  assert.equal(r.statusCode,200);assert.ok(r.body.total>=30);
  assert.equal(writes.length,0);
 });
});
test('only host can finalize retirements; SQL receives minimal player-removal payload',async()=>{
 await mockNetwork(fixture(),async(writes)=>{
  const r=res();await onlineRetirementRequest(req('run'),r,'run');
  assert.equal(r.statusCode,200);assert.equal(writes.length,1);
  const payload=writes[0];assert.equal(payload.p_season_year,2027);
  assert.ok(Array.isArray(payload.p_team_removals));
  assert.ok(!Object.hasOwn(payload,'p_league'));
  assert.ok(payload.p_retired.some(x=>x.id==='fa-old'));
 });
 await mockNetwork(fixture(),async(writes)=>{
  const r=res();await onlineRetirementRequest(req('run'),r,'run');
  assert.equal(r.statusCode,403);assert.equal(writes.length,0);
 },{host:GUEST});
});
test('stale revisions, absent Finals, drawn lottery, and non-member all fail closed',async()=>{
 for(const [state,options] of [
   [fixture(),{revision:8}],
   [{...fixture(),onlinePostseason:{phase:'playoffs',seasonYear:2026}},{}],
   [{...fixture(),onlineDraftLottery:{stage:'orderDrawn'}},{}],
   [fixture(),{member:false}]]){
  await mockNetwork(state,async(writes)=>{
   const r=res();await onlineRetirementRequest(req('run'),r,'run');
   assert.ok([403,409].includes(r.statusCode));assert.equal(writes.length,0);
  },options);
 }
});
test('identical replay succeeds; reused request ID by different actor or action is rejected',async()=>{
 const crypto=await import('node:crypto');
 const h=crypto.createHash('sha256').update(JSON.stringify({action:'online_player_retirements',lobbyId:LOBBY,expectedRevision:7})).digest('hex');
 const event={actor_id:HOST,action_type:'online_player_retirements',revision:8,details:{inputHash:h}};
 await mockNetwork(fixture(),async(writes)=>{
  const r=res();await onlineRetirementRequest(req('run'),r,'run');assert.equal(r.body.replayed,true);assert.equal(writes.length,0);
 },{events:[event]});
 await mockNetwork(fixture(),async(writes)=>{
  const r=res();await onlineRetirementRequest(req('run'),r,'run');assert.equal(r.statusCode,409);assert.equal(writes.length,0);
 },{events:[{...event,actor_id:GUEST}]});
});
test('failed commit cannot report a successful retirement',async()=>{
 await mockNetwork(fixture(),async(writes)=>{
  const r=res();await onlineRetirementRequest(req('run'),r,'run');
  assert.equal(r.statusCode,409);assert.equal(writes.length,1);
 },{rpcOk:false});
});
test('SQL applies only removals, blocks premature lottery and protects online stage',()=>{
 const sql=readFileSync(new URL('../../supabase/bm_online_retirements_phase2e3b.sql',import.meta.url),'utf8');
 for(const fragment of ['for update','retiredPlayersHistory','onlineDraftLottery','bm.online_retirement_write',
   'service_role','p_expected_revision','v_previous.details','p_team_removals','p_free_removals',
   'bm_online_retirement_runtime_guard_phase2e3b','Player retirements must complete before'])
   assert.ok(sql.includes(fragment),fragment);
 assert.ok(!sql.includes('to authenticated;'));
});
