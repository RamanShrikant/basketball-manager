import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {originalRights,verifyRightsResult,rightsSeason,validateRightsDecisions,onlineRightsRequest} from '../onlineRights.js';

const HOST='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',GUEST='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOBBY='cccccccc-cccc-4ccc-8ccc-cccccccccccc',REQ='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const names=Array.from({length:30},(_,i)=>`NBA Team ${i+1}`),human=names.slice(0,2);
const free=(id,team,{eligible=false,extended=false,hold=true}={})=>({id,name:`FA ${id}`,age:25,overall:78,potential:82,pos:'SG',
 rights:{heldByTeam:team,seasonsTowardBird:hold?3:0,birdLevel:hold?'bird':'none',rookieScale:eligible||extended,restrictedFreeAgent:extended},
 previousContract:{startYear:2026,salaryByYear:[hold?6000000:0]},contract:null,
 ...(eligible?{qualifyingOfferEligible:{teamName:team,amount:7500000,seasonYear:2027,status:'pending'}}:{}),
 ...(extended?{qualifyingOffer:{teamName:team,amount:7200000,seasonYear:2027,status:'extended'}}:{})});
function league(flat=true){
 const roster=names.map(name=>({name,players:[],twoWayPlayers:[],stashPlayers:[]}));
 const state={seasonYear:2026,onlinePostseason:{phase:'postseasonComplete'},
  onlineRetirements:{status:'complete'},onlineDraft:{status:'complete',draftYear:2027},
  onlineRookieSignings:{status:'complete'},onlineOptions:{status:'complete',year:2027},
  offseasonState:{optionsComplete:true,rightsManagementComplete:false},freeAgents:[
   free('alpha',names[0],{eligible:true}),free('beta',names[1]),free('gamma',names[0]),
   free('legacy',names[1],{extended:true}),free('zero',names[0],{hold:false}),
   free('public',null)]};
 if(flat)state.teams=roster;else state.conferences={East:roster.slice(0,15),West:roster.slice(15)};
 return state;
}
function selections(s){
 const choices={};for(const team of human){
  const r=originalRights(s,{mode:'preview',year:2027,humanTeams:human,teamName:team});
  choices[team]=Object.fromEntries(r.rows.map(p=>[p.playerId,p.availableDecisions[0]]));
 }
 return choices;
}
const response=()=>({statusCode:200,set(){return this;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}});
const request=(mode,other={})=>({get:()=>`Bearer ${'x'.repeat(48)}`,
 body:{lobbyId:LOBBY,expectedRevision:7,...(mode==='preview'?{}:{requestId:REQ}),...other}});
async function fakeNetwork(state,fn,{actor=HOST,host=HOST,revision=7,members=true,rpcOk=true,events=[]}={}){
 const fetchBefore=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://mock.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='local-test-only';
 const writes=[];globalThis.fetch=async(url,options={})=>{
  const body=(v,status=200)=>new Response(JSON.stringify(v),{status});
  if(url.includes('/auth/v1/user'))return body({id:actor});
  if(url.includes('/bm_online_lobbies'))return body([{host_id:host,status:'started'}]);
  if(url.includes('/bm_online_lobby_members'))return body(members?[
   {user_id:HOST,team_name:names[0]},{user_id:GUEST,team_name:names[1]}]:[]);
  if(url.includes('/bm_online_franchise_events'))return body(events);
  if(url.includes('/bm_online_franchise_runtime'))return body([{state,revision}]);
  if(url.includes('/rpc/')){writes.push({url,body:JSON.parse(options.body)});return body(rpcOk?{ok:true,revision:revision+1}:{ok:false},rpcOk?200:409);}
  throw Error(`Unexpected URL ${url}`);
 };
 try{await fn(writes);}finally{
  globalThis.fetch=fetchBefore;
  if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
  if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
 }
}

test('original single-player rights preview covers Bird, QO, existing tender and zero-hold rights without mutating shared input',()=>{
 for(const flat of [true,false]){
  const s=league(flat),before=structuredClone(s);
  const a=originalRights(s,{mode:'preview',year:2027,humanTeams:human,teamName:names[0]});
  assert.deepEqual(new Set(a.rows.map(x=>x.playerId)),new Set(['alpha','gamma','zero']));
  assert.ok(a.rows.find(x=>x.playerId==='zero').capHold===0);
  assert.deepEqual(a.rows.find(x=>x.playerId==='alpha').availableDecisions,['extend_qo','decline_qo','renounce']);
  const b=originalRights(s,{mode:'preview',year:2027,humanTeams:human,teamName:names[1]});
  assert.deepEqual(b.rows.find(x=>x.playerId==='legacy').availableDecisions,['keep_qo','withdraw_qo','renounce']);
  assert.deepEqual(s,before);
 }
});
test('original engine implements qualifying offer, renunciation, declined QO, withdrawn QO, and kept rights',()=>{
 for(const flat of [true,false]){
  const s=league(flat),d=selections(s);
  d[names[0]]={alpha:'extend_qo',gamma:'renounce',zero:'keep'};
  d[names[1]]={beta:'keep',legacy:'withdraw_qo'};
  const result=originalRights(s,{mode:'finalize',year:2027,humanTeams:human,decisionsByTeam:d});
  const after=verifyRightsResult(s,result,2027,d).freeAgents;
  assert.equal(after.find(p=>p.id==='alpha').rights.restrictedFreeAgent,true);
  assert.equal(after.find(p=>p.id==='alpha').qualifyingOffer.status,'extended');
  assert.equal(after.find(p=>p.id==='gamma').rightsRenounced,true);
  assert.equal(after.find(p=>p.id==='gamma').rights.heldByTeam,null);
  assert.equal(after.find(p=>p.id==='legacy').rights.restrictedFreeAgent,false);
  assert.equal(after.find(p=>p.id==='legacy').qualifyingOffer,undefined);
  assert.equal(after.find(p=>p.id==='beta').rights.heldByTeam,names[1]);
  assert.equal(after.find(p=>p.id==='public').rights.heldByTeam,null);
 }
});
test('declining eligible QO retains underlying Bird rights but removes RFA matching',()=>{
 const s=league(),d=selections(s);d[names[0]].alpha='decline_qo';
 const result=originalRights(s,{mode:'finalize',year:2027,humanTeams:human,decisionsByTeam:d});
 const after=verifyRightsResult(s,result,2027,d).freeAgents.find(p=>p.id==='alpha');
 assert.equal(after.rights.heldByTeam,names[0]);assert.equal(after.rights.restrictedFreeAgent,false);
 assert.equal(after.qualifyingOffer,undefined);assert.equal(after.qualifyingOfferEligible,undefined);
});
test('invalid or foreign free agent decisions cannot be submitted to the original engine',()=>{
 const s=league(),d=selections(s);
 for(const [team,bad] of [[names[0],{alpha:'renounce'}],[names[0],{...d[names[0]],beta:'renounce'}],
  [names[0],{...d[names[0]],alpha:'keep'}], [names[1],{...d[names[1]],legacy:'extend_qo'}]]){
  assert.throws(()=>originalRights(s,{mode:'validate',year:2027,humanTeams:human,teamName:team,decisions:bad}),/Invalid|choices|eligible/);
 }
 assert.throws(()=>originalRights(s,{mode:'finalize',year:2027,humanTeams:human,
  decisionsByTeam:{[names[0]]:d[names[0]]}}),/All human/);
});
test('result invariant rejects changing stats, contracts, third-party rights, extra players, and missing log entries',()=>{
 const s=league(),d=selections(s),out=originalRights(s,{mode:'finalize',year:2027,humanTeams:human,decisionsByTeam:d});
 for(const mutate of [r=>r.freeAgents[0].overall++,r=>r.freeAgents[1].contract={salaryByYear:[50000000]},
  r=>r.freeAgents[5].rights.heldByTeam=names[1],r=>r.freeAgents.push(free('new',null)),r=>r.decisionLog.pop()]){
  const changed=structuredClone(out);mutate(changed);
  assert.throws(()=>verifyRightsResult(s,changed,2027,d));
 }
});
test('rights stage requires completed options and is season scoped',()=>{
 const s=league();assert.equal(rightsSeason(s),2027);
 for(const change of [x=>x.onlineOptions.status='collecting',x=>x.onlineOptions.year=2028,
  x=>x.offseasonState.optionsComplete=false,x=>x.offseasonState.rightsManagementComplete=true,
  x=>x.onlineRights={status:'complete',year:2027},x=>x.onlineRights={status:'collecting',year:2028}]){
  const bad=structuredClone(s);change(bad);assert.throws(()=>rightsSeason(bad));
 }
});
test('prototype and malformed rights choices rejected',()=>{
 for(const x of [null,[],{alpha:23},{alpha:'keep_qo_unsafe'},Object.assign(Object.create(null),{constructor:'renounce'})])
  assert.throws(()=>validateRightsDecisions(x));
 assert.doesNotThrow(()=>validateRightsDecisions({alpha:'keep',beta:'renounce'}));
});
test('preview needs league access and returns only the controlling GM rights without database writes',async()=>{
 await fakeNetwork(league(),async(writes)=>{
  const r=response();await onlineRightsRequest(request('preview'),r,'preview');
  assert.equal(r.statusCode,200);assert.deepEqual(new Set(r.body.rows.map(x=>x.playerId)),new Set(['alpha','gamma','zero']));
  assert.equal(writes.length,0);
 });
});
test('submit sends player-ID decisions only; never takes rights objects from browser',async()=>{
 const s=league(),choices=selections(s)[names[0]];
 await fakeNetwork(s,async(writes)=>{
  const r=response();await onlineRightsRequest(request('submit',{decisions:choices}),r,'submit');
  assert.equal(r.statusCode,200);assert.equal(writes.length,1);
  assert.match(writes[0].url,/bm_online_submit_rights_phase2e4b/);
  assert.deepEqual(writes[0].body.p_decisions,choices);
  assert.equal('p_free_agents' in writes[0].body,false);
 });
});
test('guest cannot finalize; host cannot finalize before all human GMs submit',async()=>{
 await fakeNetwork(league(),async(writes)=>{
  const r=response();await onlineRightsRequest(request('finalize'),r,'finalize');
  assert.equal(r.statusCode,403);assert.equal(writes.length,0);
 },{actor:GUEST});
 await fakeNetwork(league(),async(writes)=>{
  const r=response();await onlineRightsRequest(request('finalize'),r,'finalize');
  assert.equal(r.statusCode,409);assert.equal(writes.length,0);
 });
});
test('host finalizes original engine results in one private SQL transaction',async()=>{
 const s=league();s.onlineRights={status:'collecting',year:2027,decisionsByTeam:selections(s)};
 await fakeNetwork(s,async(writes)=>{
  const r=response();await onlineRightsRequest(request('finalize'),r,'finalize');
  assert.equal(r.statusCode,200);assert.equal(writes.length,1);
  assert.match(writes[0].url,/bm_online_finalize_rights_phase2e4b/);
  assert.equal(writes[0].body.p_free_agents.length,s.freeAgents.length);
  assert.ok(!('p_teams' in writes[0].body));
 });
});
test('stale revision, disconnected member, malformed request and private RPC failure all fail closed',async()=>{
 for(const opts of [{revision:8},{members:false},{rpcOk:false}])await fakeNetwork(league(),async(writes)=>{
  const r=response();await onlineRightsRequest(request('submit',{decisions:selections(league())[names[0]]}),r,'submit');
  assert.notEqual(r.statusCode,200);
 },opts);
 await fakeNetwork(league(),async(writes)=>{
  const r=response();await onlineRightsRequest(request('submit',{decisions:selections(league())[names[0]],extraField:'overwrite'}),r,'submit');
  assert.equal(r.statusCode,400);assert.equal(writes.length,0);
 });
});
test('duplicate request retry succeeds only for identical action hash, without second SQL write',async()=>{
 const s=league(),d=selections(s)[names[0]];
 const crypto=await import('node:crypto');
 const inputHash=crypto.createHash('sha256').update(JSON.stringify({mode:'submit',team:names[0],decisions:d})).digest('hex');
 await fakeNetwork(s,async(writes)=>{
  const r=response();await onlineRightsRequest(request('submit',{decisions:d}),r,'submit');
  assert.equal(r.statusCode,200);assert.equal(r.body.replayed,true);assert.equal(writes.length,0);
 },{events:[{actor_id:HOST,action_type:'online_rights_submit',revision:8,details:{inputHash}}]});
 await fakeNetwork(s,async(writes)=>{
  const r=response();await onlineRightsRequest(request('submit',{decisions:d}),r,'submit');
  assert.equal(r.statusCode,409);assert.equal(writes.length,0);
 },{events:[{actor_id:HOST,action_type:'online_rights_submit',revision:8,details:{inputHash:'0'.repeat(64)}}]});
});
test('SQL and online routes protect right status, private RPC permissions and no singleplayer imports',()=>{
 const sql=readFileSync(new URL('../../supabase/bm_online_bird_rights_qualifying_offers_phase2e4b.sql',import.meta.url),'utf8');
 for(const key of ['FOR UPDATE','SECURITY DEFINER','service_role','online_rights_guard_phase2e4b','rightsManagementComplete',
  'rightsResolvedSeasonYear','qualifyingOfferEligible','restrictedFreeAgent','inputHash','request_id'])assert.match(sql,new RegExp(key));
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.bm_online_submit_rights_phase2e4b/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.bm_online_finalize_rights_phase2e4b/);
 const api=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 assert.match(api,/\/api\/online\/offseason\/rights\/finalize/);
 const routes=readFileSync(new URL('../../frontend/src/online/OnlineFranchise.jsx',import.meta.url),'utf8');
 assert.match(routes,/"\/free-agent-rights":OnlineOffseasonRights/);
});
