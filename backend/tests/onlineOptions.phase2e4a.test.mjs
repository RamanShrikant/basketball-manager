import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateOptionChoices,readyForOptions,runOriginalOptions,verifyOriginalOptionChanges,onlineOptionsRequest} from '../onlineOptions.js';
const HOST='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GUEST='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOBBY='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ID='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const names=Array.from({length:30},(_,i)=>`NBA Team ${i+1}`);
const p=(id,name,optionType)=>({id,name,age:26,overall:78,potential:80,pos:'SF',team:names[0],
 contract:{startYear:2026,salaryByYear:[6000000,7000000],option:optionType?{type:optionType,yearIndices:[1]}:null}});
const empty=()=>({teamOptions:{},twoWay:{},stash:{}});
function fixture(flat=true){
 const roster=names.map(name=>({name,players:[],twoWayPlayers:[],stashPlayers:[],pendingRookieSignings:[]}));
 roster[0].players=[p('alpha','Alpha','team'),p('gamma','Gamma','player')];
 roster[1].players=[{...p('beta','Beta','team'),team:names[1]}];
 const state={seasonYear:2026,freeAgents:[],onlinePostseason:{phase:'postseasonComplete',seasonYear:2026,champion:names[0]},
  onlineRetirements:{status:'complete',seasonYear:2027},onlineDraft:{status:'complete',draftYear:2027},
  onlineDraftRights:{status:'settled',draftYear:2027},onlineRookieSignings:{status:'complete',draftYear:2027}};
 if(flat)state.teams=roster;else state.conferences={East:roster.slice(0,15),West:roster.slice(15)};
 return state;
}
const human=names.slice(0,2);
function getChoices(state){
 const choices={};
 for(const name of human){
  const preview=runOriginalOptions(state,{mode:'preview',year:2027,humanTeams:human,teamName:name});
  choices[name]={teamOptions:Object.fromEntries(preview.rows.teamOptions.map(r=>[String(r.playerId),true])),twoWay:{},stash:{}};
 }
 return choices;
}
const response=()=>({statusCode:200,set(){return this;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}});
const request=(mode,data={})=>({get:()=>`Bearer ${'x'.repeat(48)}`,body:{lobbyId:LOBBY,expectedRevision:7,...(mode!=='preview'?{requestId:ID}:{}),...data}});
async function mockNetwork(state,fn,{actor=HOST,host=HOST,member=true,revision=7,rpcOk=true,events=[]}={}){
 const previous=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://mock.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='local-test-key';
 const writes=[];
 globalThis.fetch=async(url,options={})=>{
  const body=(value,status=200)=>new Response(JSON.stringify(value),{status});
  if(url.includes('/auth/v1/user'))return body({id:actor});
  if(url.includes('/bm_online_lobbies'))return body([{host_id:host,status:'started'}]);
  if(url.includes('/bm_online_lobby_members'))return body(member?[
   {user_id:HOST,team_name:names[0]},{user_id:GUEST,team_name:names[1]}]:[]);
  if(url.includes('/bm_online_franchise_events'))return body(events);
  if(url.includes('/bm_online_franchise_runtime'))return body([{state,revision}]);
  if(url.includes('/rpc/')){writes.push({url,body:JSON.parse(options.body)});return body(rpcOk?{ok:true,revision:revision+1}:{ok:false},rpcOk?200:409);}
  throw Error(`Unexpected URL ${url}`);
 };
 try{await fn(writes);}finally{globalThis.fetch=previous;
  if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
  if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;}
}
test('original single-player engine recognizes team/player options for both online GMs, never mutates input',()=>{
 for(const flat of [true,false]){
  const state=fixture(flat),before=structuredClone(state);
  const preview=runOriginalOptions(state,{mode:'preview',year:2027,humanTeams:human,teamName:names[0]});
  assert.deepEqual(preview.rows.teamOptions.map(p=>p.playerId),['alpha']);
  assert.deepEqual(preview.rows.playerOptions.map(p=>p.playerId),['gamma']);
  assert.equal(runOriginalOptions(state,{mode:'preview',year:2027,humanTeams:human,teamName:names[1]}).rows.teamOptions[0].playerId,'beta');
  assert.deepEqual(state,before);
 }
});
test('the original engine honors two distinct GM team-option choices, while player options remain engine-owned',()=>{
 for(const flat of [true,false]){
  const state=fixture(flat),decisions=getChoices(state);
  decisions[names[0]].teamOptions.alpha=false;
  decisions[names[1]].teamOptions.beta=true;
  const result=runOriginalOptions(state,{mode:'finalize',year:2027,humanTeams:human,decisionsByTeam:decisions});
  const tx=verifyOriginalOptionChanges(state,result,2027);
  assert.equal(tx.summary.teamOptionDeclinedCount,1);
  const target=tx.teams.find(t=>t.name===names[0]);
  assert.ok(!target.players.some(p=>p.id==='alpha'));
  assert.ok(tx.freeAgents.some(p=>p.id==='alpha'));
  assert.ok(tx.teams.find(t=>t.name===names[1]).players.some(p=>p.id==='beta'));
  assert.equal(state.freeAgents.length,0);
 }
});
test('missing, unknown or duplicate human decisions are rejected by original engine',()=>{
 const state=fixture(),decisions=getChoices(state);
 const missing=structuredClone(decisions);delete missing[names[0]].teamOptions.alpha;
 assert.throws(()=>runOriginalOptions(state,{mode:'finalize',year:2027,humanTeams:human,decisionsByTeam:missing}),/Missing|ambiguous/);
 const extra=structuredClone(decisions);extra[names[0]].teamOptions.other=true;
 assert.throws(()=>runOriginalOptions(state,{mode:'finalize',year:2027,humanTeams:human,decisionsByTeam:extra}),/Missing|ambiguous/);
 const removed=structuredClone(decisions);delete removed[names[1]];
 assert.throws(()=>runOriginalOptions(state,{mode:'finalize',year:2027,humanTeams:human,decisionsByTeam:removed}),/Every human/);
});
test('option request validator rejects prototype tricks, invalid types and malformed development decisions',()=>{
 for(const choices of [{...empty(),teamOptions:{alpha:'true'}},{...empty(),twoWay:{alpha:'wrong'}},
   {...empty(),stash:{alpha:'wrong'}},{...empty(),teamOptions:{constructor:true}},
   {...empty(),unexpected:1}])assert.throws(()=>validateOptionChoices(choices));
 assert.doesNotThrow(()=>validateOptionChoices(getChoices(fixture())[names[0]]));
});
test('option-result invariant rejects injected players, cross-team transfers, history rewrites and duplicates',()=>{
 const state=fixture(),decisions=getChoices(state),result=runOriginalOptions(state,{mode:'finalize',year:2027,humanTeams:human,decisionsByTeam:decisions});
 const added=structuredClone(result);added.leagueData.teams[0].players.push(p('ghost','Ghost','team'));
 assert.throws(()=>verifyOriginalOptionChanges(state,added,2027),/transfer|created|unknown/);
 const cross=structuredClone(result);cross.leagueData.teams[1].players.push(structuredClone(cross.leagueData.teams[0].players[0]));
 assert.throws(()=>verifyOriginalOptionChanges(state,cross,2027),/cross-team/);
 const history=structuredClone(result);history.leagueData.onlineDraft.draftYear=2030;
 assert.throws(()=>verifyOriginalOptionChanges(state,history,2027),/unrelated/);
 const dup=structuredClone(result);dup.leagueData.freeAgents.push(dup.leagueData.freeAgents[0]||p('gamma','Gamma'));
 assert.throws(()=>verifyOriginalOptionChanges(state,dup,2027),/Duplicate|unknown|duplicated/);
});
test('options require full draft, rookie signings and retirement stage',()=>{
 const state=fixture();assert.equal(readyForOptions(state),2027);
 for(const key of ['onlineRookieSignings','onlineDraft','onlineRetirements']){
  const bad=structuredClone(state);delete bad[key];assert.throws(()=>readyForOptions(bad));
 }
 const done=structuredClone(state);done.onlineOptions={status:'complete',year:2027};assert.throws(()=>readyForOptions(done));
});
test('human GM preview returns own options and never modifies database',async()=>{
 await mockNetwork(fixture(),async(writes)=>{
  const r=response();await onlineOptionsRequest(request('preview'),r,'preview');
  assert.equal(r.statusCode,200);assert.deepEqual(r.body.rows.teamOptions.map(x=>x.playerId),['alpha']);
  assert.equal(writes.length,0);
 });
});
test('submission validates own choices and sends only choices to locked service-only SQL',async()=>{
 const state=fixture(),decisions=getChoices(state)[names[0]];
 await mockNetwork(state,async(writes)=>{
  const r=response();await onlineOptionsRequest(request('submit',{decisions}),r,'submit');
  assert.equal(r.statusCode,200);assert.equal(writes.length,1);
  assert.match(writes[0].url,/submit_options_phase2e4a/);
  assert.deepEqual(writes[0].body.p_decisions,decisions);
  assert.ok(!('p_teams' in writes[0].body));
 });
});
test('guest cannot finalize; complete submissions required for host finalization',async()=>{
 const state=fixture();
 await mockNetwork(state,async(writes)=>{
  const r=response();await onlineOptionsRequest(request('finalize'),r,'finalize');
  assert.equal(r.statusCode,403);assert.equal(writes.length,0);
 },{actor:GUEST});
 await mockNetwork(state,async(writes)=>{
  const r=response();await onlineOptionsRequest(request('finalize'),r,'finalize');
  assert.equal(r.statusCode,409);assert.equal(writes.length,0);
 });
});
test('host can finalize original-engine options with all GM decisions; no unrelated payload fields',async()=>{
 const state=fixture();state.onlineOptions={status:'collecting',year:2027,decisionsByTeam:getChoices(state)};
 await mockNetwork(state,async(writes)=>{
  const r=response();await onlineOptionsRequest(request('finalize'),r,'finalize');
  assert.equal(r.statusCode,200);assert.equal(writes.length,1);
  assert.match(writes[0].url,/finalize_options_phase2e4a/);
  assert.equal(writes[0].body.p_teams.length,30);
  assert.equal(writes[0].body.p_summary.seasonYear,2027);
  assert.ok(!('p_state' in writes[0].body));
 });
});
test('stale revision, invalid membership, failed RPC and premature rookie stage fail closed',async()=>{
 for(const [state,opt] of [[fixture(),{revision:8}],[fixture(),{member:false}],
  [{...fixture(),onlineRookieSignings:{status:'active'}},{}]]){
  await mockNetwork(state,async(writes)=>{
   const r=response();await onlineOptionsRequest(request('submit',{decisions:getChoices(fixture())[names[0]]}),r,'submit');
   assert.ok([403,409].includes(r.statusCode));assert.equal(writes.length,0);
  },opt);
 }
 await mockNetwork(fixture(),async(writes)=>{
  const r=response();await onlineOptionsRequest(request('submit',{decisions:getChoices(fixture())[names[0]]}),r,'submit');
  assert.equal(r.statusCode,409);assert.equal(writes.length,1);
 },{rpcOk:false});
});
test('identical request retry works but mismatched request action/actor is rejected',async()=>{
 const d=getChoices(fixture())[names[0]];
 const inputHash=createHash('sha256').update(JSON.stringify({action:'online_options_submit',team:names[0],decisions:d,year:null})).digest('hex');
 const event={actor_id:HOST,action_type:'online_options_submit',revision:8,details:{inputHash}};
 await mockNetwork(fixture(),async(writes)=>{
  const r=response();await onlineOptionsRequest(request('submit',{decisions:d}),r,'submit');
  assert.equal(r.body.replayed,true);assert.equal(writes.length,0);
 },{events:[event]});
 await mockNetwork(fixture(),async(writes)=>{
  const r=response();await onlineOptionsRequest(request('submit',{decisions:d}),r,'submit');
  assert.equal(r.statusCode,409);assert.equal(writes.length,0);
 },{events:[{...event,actor_id:GUEST}]});
});
test('SQL checks locked revision, member ownership, exact identities and service-role permissions',()=>{
 const sql=readFileSync(new URL('../../supabase/bm_online_options_phase2e4a.sql',import.meta.url),'utf8');
 for(const s of ['for update','p_expected_revision','onlineRookieSignings','decisionsByTeam',
  'bm.online_options_write','service_role','v_own_ids','p_free_agents','optionsComplete','bm_online_options_guard_phase2e4a'])
   assert.ok(sql.includes(s),s);
 assert.ok(!sql.includes('to authenticated;'));
});
