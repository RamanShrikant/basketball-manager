import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runOriginalFreeAgency,onlineFreeAgencyRequest,verifyMarketOutput} from '../onlineFreeAgency.js';
import {validateResolutionRequest,verifyMarketStep} from '../onlineMarketSettlement.js';
const HOST='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',GUEST='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOBBY='cccccccc-cccc-4ccc-8ccc-cccccccccccc',REQUEST='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const names=Array.from({length:30},(_,i)=>`NBA Team ${i+1}`),humans=names.slice(0,2);
const year=2027;
function league(flat=true){
 const teams=names.map((name,i)=>({name,players:Array.from({length:12},(_,j)=>({id:`p${i}_${j}`,name:`Starter ${i} ${j}`,pos:'PG',age:26,overall:77,potential:81,contract:{startYear:2027,salaryByYear:[8_000_000,8_400_000]}})),twoWayPlayers:[],stashPlayers:[]}));
 const s={seasonYear:2026,seasonStartYear:2026,onlineDraft:{draftYear:year,status:'complete'},onlineRookieSignings:{status:'complete'},
  onlineOptions:{year,status:'complete'},onlineRights:{year,status:'complete'},
  offseasonState:{active:true,optionsComplete:true,rightsManagementComplete:true,freeAgencyComplete:false},
  freeAgents:[{id:'free1',name:'Free Wing',pos:'SG',overall:78,potential:82,age:26,
    rights:{heldByTeam:null,birdLevel:'none',restrictedFreeAgent:false}},
   {id:'rfa1',name:'RFA Prospect',pos:'C',overall:80,potential:89,age:24,
    rights:{heldByTeam:names[1],birdLevel:'bird',seasonsTowardBird:3,restrictedFreeAgent:true},
    qualifyingOffer:{teamName:names[1],amount:8_000_000,seasonYear:2027,status:'extended'}}]};
 if(flat)s.teams=teams;else s.conferences={East:teams.slice(0,15),West:teams.slice(15)};
 const result=runOriginalFreeAgency(s,{mode:'open',year,humanTeams:humans});
 s.freeAgencyState=result.market;s.onlineOffseasonMarket={status:'active',year,phase:'offers',day:1};return s;
}
function step(s,mode,extra={}){
 const result=runOriginalFreeAgency(s,{mode,year,humanTeams:humans,...extra});
 const validation=verifyMarketStep(s,result,{mode,humans,actorTeam:extra.teamName||names[0]});
 return {result,validation,state:result.state};
}
test('original NBA resolver pauses HUMAN RFA matching instead of CPU auto matching, both roster layouts',()=>{
 for(const flat of [true,false]){
  const s=league(flat),before=structuredClone(s);
  const {state,validation}=step(s,'resolve');
  assert.equal(state.onlineOffseasonMarket.phase,'decisions');
  assert.equal(state.freeAgencyState.pendingRfaMatchDecisions.length,1);
  assert.equal(state.freeAgencyState.pendingRfaMatchDecisions[0].rightsTeamName,names[1]);
  assert.equal(state.freeAgencyState.pendingRfaMatchDecisions[0].playerId,'rfa1');
  assert.equal(validation.newSignings,0);
  assert.deepEqual(s,before,'original server league snapshot must remain unchanged');
 }
});
test('guest RFA GM chooses Decline, outside club signs once, then host starts day 2',()=>{
 let state=step(league(),'resolve').state;
 const {state:declined,validation}=step(state,'decision',{teamName:names[1],kind:'rfa',choice:'decline',playerKey:'id:rfa1'});
 assert.equal(validation.newSignings,1);
 assert.equal(declined.freeAgencyState.pendingRfaMatchDecisions.length,0);
 assert.equal(declined.onlineOffseasonMarket.phase,'needs_next');
 assert.ok(!declined.freeAgents.some(p=>p.id==='rfa1'));
 state=step(declined,'next').state;
 assert.equal(state.onlineOffseasonMarket.phase,'offers');assert.equal(state.freeAgencyState.currentDay,2);
 const o=runOriginalFreeAgency(state,{mode:'offer',year,humanTeams:humans,teamName:names[0],playerId:'free1',salary:8_000_000,years:2,optionType:'none'});
 verifyMarketOutput(state,o,{mode:'offer',year,team:names[0],playerId:'free1',humanTeams:humans});
 assert.equal(o.submittedOffer.submittedDay,2,'day 2 remains open for GM bidding');
});
test('GM signing pause is tagged with ACTUAL offer team, never the synthetic sentinel',()=>{
 const s=league();
 s.freeAgencyState=runOriginalFreeAgency(s,{mode:'offer',year,humanTeams:humans,teamName:names[0],playerId:'free1',salary:28_000_000,years:4,optionType:'none'}).market;
 const r=step(s,'resolve');
 assert.equal(r.state.freeAgencyState.pendingUserDecisions.length,1);
 assert.equal(r.state.freeAgencyState.pendingUserDecisions[0].teamName,names[0]);
 assert.throws(()=>step(r.state,'decision',{teamName:names[1],kind:'signing',choice:'accept',playerKey:'id:free1'}),/Only the GM/);
 const declined=step(r.state,'decision',{teamName:names[0],kind:'signing',choice:'decline',playerKey:'id:free1'});
 assert.equal(declined.state.freeAgencyState.pendingUserDecisions.length,0);
 assert.ok(declined.state.freeAgencyState.pendingRfaMatchDecisions.some(x=>x.rightsTeamName===names[1]));
});
test('duplicate and invalid action requests rejected before invoking Python',()=>{
 const base={lobbyId:LOBBY,requestId:REQUEST,expectedRevision:8};
 for(const mode of ['resolve','next'])assert.deepEqual(validateResolutionRequest(mode,base),base);
 for(const bad of [{kind:'rfa',playerKey:'id:free1',choice:'accept'},
  {kind:'signing',playerKey:'id:free1',choice:'match'},
  {kind:'signing',playerKey:'../free1',choice:'decline'}])
  assert.throws(()=>validateResolutionRequest('decision',{...base,...bad}));
});
test('validator rejects forged status, unrelated edits, duplicate signings and foreign roster movements',()=>{
 const s=league(),r=runOriginalFreeAgency(s,{mode:'resolve',year,humanTeams:humans});
 for(const mutate of [
  x=>x.state.onlineOffseasonMarket.day=7,
  x=>x.state.onlineOffseasonMarket.status='complete',
  x=>x.state.teams[0].players[0].contract.salaryByYear[0]=1,
  x=>x.state.teams[0].players[0].id='forged',
  x=>x.state.onlineOptions.status='not_done',
  x=>x.state.teams[0].players.push({...x.state.teams[0].players[0]}),
  x=>x.state.freeAgents.push({...x.state.freeAgents[0]}),
  x=>x.state.freeAgencyState.pendingRfaMatchDecisions[0].rightsTeamName=names[5],
 ]){
  const forged=structuredClone(r);mutate(forged);
  assert.throws(()=>verifyMarketStep(s,forged,{mode:'resolve',humans,actorTeam:names[0]}));
 }
});
const response=()=>({statusCode:200,set(){return this},status(v){this.statusCode=v;return this},json(x){this.body=x;return this}});
async function network(state,run,{actor=HOST,revision=8,events=[]}={}){
 const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://bm.mock.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test-key';const writes=[];
 globalThis.fetch=async(url,opts={})=>{
  const reply=(data,code=200)=>new Response(JSON.stringify(data),{status:code});
  if(url.includes('/auth/v1/user'))return reply({id:actor});
  if(url.includes('/bm_online_lobbies'))return reply([{host_id:HOST,status:'started'}]);
  if(url.includes('/bm_online_lobby_members'))return reply([{user_id:HOST,team_name:names[0]},{user_id:GUEST,team_name:names[1]}]);
  if(url.includes('/bm_online_franchise_events'))return reply(events);
  if(url.includes('/bm_online_franchise_runtime'))return reply([{state,revision}]);
  if(url.includes('/rpc/')){writes.push({url,body:JSON.parse(opts.body)});return reply({ok:true,revision:revision+1});}
  throw Error('Unexpected URL: '+url);
 };
 try{await run(writes);}finally{globalThis.fetch=oldFetch;
  if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
  if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;}
}
test('host can resolve but guest cannot; guest can submit own RFA decision only',async()=>{
 const s=league(),req={get:()=>`Bearer ${'x'.repeat(64)}`,body:{lobbyId:LOBBY,requestId:REQUEST,expectedRevision:8}};
 await network(s,async(writes)=>{const r=response();await onlineFreeAgencyRequest(req,r,'resolve');assert.equal(r.statusCode,403);assert.equal(writes.length,0);},{actor:GUEST});
 await network(s,async(writes)=>{const r=response();await onlineFreeAgencyRequest(req,r,'resolve');assert.equal(r.statusCode,200);assert.match(writes[0].url,/bm_online_market_step_phase2e4c2/);},{actor:HOST});
 const pending=step(s,'resolve').state;
 await network(pending,async(writes)=>{
  const r=response();await onlineFreeAgencyRequest({...req,body:{...req.body,kind:'rfa',choice:'decline',playerKey:'id:rfa1'}},r,'decision');
  assert.equal(r.statusCode,200);assert.equal(writes[0].body.p_mode,'decision');
  assert.equal(writes[0].body.p_kind,'rfa');assert.equal(writes[0].body.p_new_state.onlineOffseasonMarket.phase,'needs_next');
 },{actor:GUEST});
});

test('full synthetic market reaches completion with legitimate CPU-only emergency minimum roster fillers',()=>{
 let s=league();
 for(let i=0;i<20;i++){
  const phase=s.onlineOffseasonMarket.phase;
  if(phase==='complete')break;
  let result;
  if(phase==='decisions'){
   const row=s.freeAgencyState.pendingRfaMatchDecisions[0]||s.freeAgencyState.pendingUserDecisions[0];
   if(!row)throw Error('Missing expected GM decision');
   result=step(s,'decision',{teamName:row.rightsTeamName||row.teamName,kind:row.rightsTeamName?'rfa':'signing',choice:'decline',playerKey:row.playerKey});
  }else result=step(s,phase==='offers'?'resolve':'next');
  s=result.state;
 }
 assert.equal(s.onlineOffseasonMarket.status,'complete');
 assert.equal(s.freeAgencyState.marketComplete,true);
 assert.equal(s.offseasonState.freeAgencyComplete,true);
 assert.ok(s.teams.every(t=>(t.players||[]).length>=12));
});

test('SQL enforces row locks, role validation, bid continuation, and market invariants',()=>{
 const sql=readFileSync(new URL('../../supabase/bm_online_offseason_market_resolution_phase2e4c2.sql',import.meta.url),'utf8');
 for(const token of ['FOR UPDATE','SECURITY DEFINER','service_role','p_expected_revision','p_input_hash',
  'p_choice','rightsTeamName','offeringTeamName','Duplicate roster player ID','Market attempted to rewrite unrelated franchise data',
  'NOT BETWEEN 1 AND 10','bm_online_submit_market_offer_phase2e4c'])assert.ok(sql.includes(token),token);
 assert.ok(!sql.includes('GRANT EXECUTE ON FUNCTION public.bm_online_market_step_phase2e4c2')||sql.includes('TO service_role'));
});
test('human GM accepts an original-engine signing and the player joins exactly one shared roster',()=>{
 const s=league();
 s.freeAgents=s.freeAgents.filter(p=>p.id==='free1');
 s.freeAgencyState=runOriginalFreeAgency(s,{mode:'offer',year,humanTeams:humans,teamName:names[0],playerId:'free1',salary:28_000_000,years:3,optionType:'none'}).market;
 const resolved=step(s,'resolve').state;
 assert.equal(resolved.onlineOffseasonMarket.phase,'decisions');
 const accepted=step(resolved,'decision',{teamName:names[0],kind:'signing',choice:'accept',playerKey:'id:free1'});
 assert.equal(accepted.validation.newSignings,1);
 assert.equal(accepted.state.teams[0].players.filter(p=>p.id==='free1').length,1);
 assert.equal(accepted.state.freeAgents.some(p=>p.id==='free1'),false);
 assert.ok(Array.isArray(accepted.state.teams[0].players.find(p=>p.id==='free1').contract.salaryByYear));
});
test('RFA incumbent human GM matches offer sheet and retains the player once',()=>{
 const s=league();
 const resolved=step(s,'resolve').state;
 const matched=step(resolved,'decision',{teamName:names[1],kind:'rfa',choice:'match',playerKey:'id:rfa1'});
 assert.equal(matched.validation.newSignings,1);
 assert.equal(matched.state.teams[1].players.filter(p=>p.id==='rfa1').length,1);
 assert.equal(matched.state.freeAgents.some(p=>p.id==='rfa1'),false);
});
