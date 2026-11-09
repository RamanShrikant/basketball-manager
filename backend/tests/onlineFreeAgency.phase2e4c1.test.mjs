import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runOriginalFreeAgency,verifyMarketOutput,freeAgencyStage,validateMarketRequest,onlineFreeAgencyRequest} from '../onlineFreeAgency.js';
const HOST='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GUEST='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOBBY='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const names=Array.from({length:30},(_,i)=>`NBA Team ${i+1}`);
const humans=names.slice(0,2);
function league(flat=true){
 const teams=names.map((name,i)=>({name,players:Array.from({length:12},(_,j)=>({id:`p${i}_${j}`,name:`Starter ${i} ${j}`,pos:'PG',age:26,overall:77,potential:81,contract:{startYear:2027,salaryByYear:[8_000_000,8_400_000]}})),twoWayPlayers:[],stashPlayers:[]}));
 const state={seasonYear:2026,seasonStartYear:2026,onlineDraft:{draftYear:2027,status:'complete'},
  onlineRookieSignings:{status:'complete'},onlineOptions:{year:2027,status:'complete'},
  onlineRights:{year:2027,status:'complete'},
  offseasonState:{active:true,optionsComplete:true,rightsManagementComplete:true,freeAgencyComplete:false},
  freeAgents:[{id:'free1',name:'Free Wing',pos:'SG',overall:78,potential:82,age:26,rights:{heldByTeam:null,birdLevel:'none',restrictedFreeAgent:false}},
   {id:'bird1',name:'Bird Veteran',pos:'PF',overall:85,potential:85,age:29,rights:{heldByTeam:names[0],birdLevel:'bird',seasonsTowardBird:4,restrictedFreeAgent:false},previousContract:{startYear:2026,salaryByYear:[12_000_000]}},
   {id:'rfa1',name:'RFA Prospect',pos:'C',overall:80,potential:89,age:24,rights:{heldByTeam:names[1],birdLevel:'bird',seasonsTowardBird:3,restrictedFreeAgent:true},qualifyingOffer:{teamName:names[1],amount:8_000_000,seasonYear:2027,status:'extended'}}]};
 if(flat)state.teams=teams;else state.conferences={East:teams.slice(0,15),West:teams.slice(15)};
 return state;
}
const response=()=>({statusCode:200,set(){return this},status(v){this.statusCode=v;return this},json(x){this.body=x;return this}});
const request=(mode,extra={})=>({get:()=>`Bearer ${'x'.repeat(64)}`,body:{lobbyId:LOBBY,requestId:REQUEST,expectedRevision:8,...extra}});
async function mockNetwork(state,fn,{actor=HOST,host=HOST,revision=8,events=[],rpcOk=true}={}){
 const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://bm.mock.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test-key-private';
 const writes=[];
 globalThis.fetch=async(url,opts={})=>{
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
  if(url.includes('/auth/v1/user'))return json({id:actor});
  if(url.includes('/bm_online_lobbies'))return json([{host_id:host,status:'started'}]);
  if(url.includes('/bm_online_lobby_members'))return json([{user_id:HOST,team_name:names[0]},{user_id:GUEST,team_name:names[1]}]);
  if(url.includes('/bm_online_franchise_events'))return json(events);
  if(url.includes('/bm_online_franchise_runtime'))return json([{state,revision}]);
  if(url.includes('/rpc/')){writes.push({url,body:JSON.parse(opts.body)});return json(rpcOk?{ok:true,revision:revision+1}:{ok:false},rpcOk?200:409);}
  throw Error(`Unexpected URL: ${url}`);
 };
 try{await fn(writes);}finally{
  globalThis.fetch=oldFetch;
  if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
  if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
 }
}

const stage=()=>{
 const s=league();
 const opened=runOriginalFreeAgency(s,{mode:'open',year:2027,humanTeams:humans});
 verifyMarketOutput(s,opened,{mode:'open',year:2027,humanTeams:humans});
 s.freeAgencyState=opened.market;s.onlineOffseasonMarket={status:'active',year:2027,phase:'offers',day:1};
 return s;
};

test('original NBA engine opens 10-day market, generates CPU offers for CPU teams only, preserves source league',()=>{
 for(const flat of [true,false]){
  const s=league(flat),before=structuredClone(s);
  assert.equal(freeAgencyStage(s),2027);
  const o=runOriginalFreeAgency(s,{mode:'open',year:2027,humanTeams:humans});
  verifyMarketOutput(s,o,{mode:'open',year:2027,humanTeams:humans});
  assert.equal(o.market.currentDay,1);assert.equal(o.market.maxDays,10);
  const offers=Object.values(o.market.offersByPlayer).flat();
  assert.ok(offers.length>=1);
  assert.ok(offers.every(x=>x.source==='cpu'&&!humans.includes(x.teamName)));
  assert.deepEqual(s,before,'Opening market did not mutate original franchise');
 }
});
test('original offer engine accepts authenticated GM cap-room and Bird-right multiyear offers without signing players',()=>{
 const s=stage(),before=structuredClone(s);
 const o=runOriginalFreeAgency(s,{mode:'offer',year:2027,humanTeams:humans,teamName:names[0],playerId:'free1',salary:8_000_000,years:3,optionType:'team'});
 verifyMarketOutput(s,o,{mode:'offer',year:2027,team:names[0],playerId:'free1',humanTeams:humans});
 assert.equal(o.submittedOffer.contract.salaryByYear.length,3);
 assert.equal(o.submittedOffer.contract.option.type,'team');
 assert.deepEqual(s,before);
 const own=runOriginalFreeAgency(s,{mode:'offer',year:2027,humanTeams:humans,teamName:names[0],playerId:'bird1',salary:16_000_000,years:5,optionType:'player'});
 verifyMarketOutput(s,own,{mode:'offer',year:2027,team:names[0],playerId:'bird1',humanTeams:humans});
 assert.equal(own.submittedOffer.contract.salaryByYear.length,5);
 assert.equal(own.submittedOffer.contract.salaryByYear[1],17_280_000);
 assert.deepEqual(s,before);
});
test('restricted free agent outside bid routes through original QO/Bird evaluation, not an immediate signing',()=>{
 const s=stage();
 const out=runOriginalFreeAgency(s,{mode:'offer',year:2027,humanTeams:humans,teamName:names[0],playerId:'rfa1',salary:13_000_000,years:3,optionType:'none'});
 verifyMarketOutput(s,out,{mode:'offer',year:2027,humanTeams:humans,team:names[0],playerId:'rfa1'});
 assert.equal(out.submittedOffer.birdRights?.restrictedFreeAgent,true);
 assert.equal(out.submittedOffer.birdRights?.heldByTeam,names[1]);
 assert.equal(s.teams[0].players.length,12);
});
test('invalid salary, player, option and team cannot become legal GM bids',()=>{
 const s=stage(),params={mode:'offer',year:2027,humanTeams:humans,teamName:names[0],playerId:'free1',salary:8_000_000,years:3,optionType:'none'};
 for(const bad of [{playerId:'missing'}, {teamName:names[3]}, {salary:100001},{salary:140_000_000},
  {years:6},{years:1,optionType:'team'},{optionType:'invented'}]){
  assert.throws(()=>runOriginalFreeAgency(s,{...params,...bad}),/engine|Invalid|Original|legal|available|salary|Offer|team|Unknown/i);
 }
 assert.throws(()=>validateMarketRequest('offer',{lobbyId:LOBBY,expectedRevision:8,requestId:REQUEST,playerId:'free1',salary:1234567,years:2,optionType:'none'}));
});
test('forged market state, changed cap usage, foreign bids and third-party offer mutations rejected',()=>{
 const s=stage(),out=runOriginalFreeAgency(s,{mode:'offer',year:2027,humanTeams:humans,teamName:names[0],playerId:'free1',salary:8_000_000,years:3,optionType:'none'});
 for(const mutate of [x=>x.market.currentDay++,x=>x.market.exceptionUsageByTeam.fake={roomException:1000},
  x=>x.submittedOffer.teamName=names[1],x=>x.market.offersByPlayer['id:free1'][0].playerId='forged']){
  const v=structuredClone(out);mutate(v);
  assert.throws(()=>verifyMarketOutput(s,v,{mode:'offer',year:2027,humanTeams:humans,team:names[0],playerId:'free1'}));
 }
});
test('only the host can open; guest can submit an offer only for their assigned team',async()=>{
 const s=league();
 await mockNetwork(s,async(writes)=>{
  const res=response();await onlineFreeAgencyRequest(request('open'),res,'open');
  assert.equal(res.statusCode,403);assert.equal(writes.length,0);
 },{actor:GUEST});
 await mockNetwork(s,async(writes)=>{
  const res=response();await onlineFreeAgencyRequest(request('open'),res,'open');
  assert.equal(res.statusCode,200);assert.equal(writes.length,1);
  assert.match(writes[0].url,/bm_online_open_market_phase2e4c/);
  assert.equal(writes[0].body.p_market.isActive,true);
 },{actor:HOST});
 const opened=stage();
 await mockNetwork(opened,async(writes)=>{
  const res=response();await onlineFreeAgencyRequest(request('offer',{playerId:'free1',salary:8_000_000,years:3,optionType:'none'}),res,'offer');
  assert.equal(res.statusCode,200);assert.equal(writes.length,1);
  assert.equal(writes[0].body.p_offer.teamName,names[1]);
  assert.equal('p_teams' in writes[0].body,false);
 },{actor:GUEST});
});
test('stale revision, replay, reused request ID and failed DB commit are handled safely',async()=>{
 const s=stage(),body=request('offer',{playerId:'free1',salary:8_000_000,years:3,optionType:'none'});
 await mockNetwork(s,async(writes)=>{
  const res=response();await onlineFreeAgencyRequest(body,res,'offer');
  assert.equal(res.statusCode,409);assert.equal(writes.length,0);
 },{revision:9});
 const hash='a'.repeat(64);
 await mockNetwork(s,async(writes)=>{
  const res=response();await onlineFreeAgencyRequest(body,res,'offer');
  assert.equal(res.statusCode,409);assert.equal(writes.length,0);
 },{events:[{actor_id:GUEST,action_type:'online_market_offer',revision:9,details:{inputHash:hash}}]});
 await mockNetwork(s,async(writes)=>{
  const res=response();await onlineFreeAgencyRequest(body,res,'offer');
  assert.equal(res.statusCode,409);assert.equal(writes.length,1);
 },{rpcOk:false});
});
test('private SQL locks the league row and protects the market from legacy writes',()=>{
 const sql=readFileSync(new URL('../../supabase/bm_online_offseason_market_offers_phase2e4c1.sql',import.meta.url),'utf8');
 for(const required of ['FOR UPDATE','SECURITY DEFINER','service_role','online_market_guard_phase2e4c',
  'bm_online_open_market_phase2e4c','bm_online_submit_market_offer_phase2e4c',
  'rightsManagementComplete','p_expected_revision','p_input_hash',"'online_market_offer'",'bm.online_free_agency_write']){
  assert.ok(sql.includes(required),`Missing critical database boundary: ${required}`);
 }
});

test('competing human bids remain independent; replacing own bid archives old offer without advancing day',()=>{
 const s=stage();
 const initialCount=(s.freeAgencyState.offersByPlayer['id:free1']||[]).length;
 const bidA=runOriginalFreeAgency(s,{mode:'offer',year:2027,humanTeams:humans,teamName:names[0],playerId:'free1',salary:8_000_000,years:3,optionType:'none'});
 verifyMarketOutput(s,bidA,{mode:'offer',year:2027,humanTeams:humans,team:names[0],playerId:'free1'});
 s.freeAgencyState=bidA.market;
 const bidB=runOriginalFreeAgency(s,{mode:'offer',year:2027,humanTeams:humans,teamName:names[1],playerId:'free1',salary:9_000_000,years:3,optionType:'none'});
 verifyMarketOutput(s,bidB,{mode:'offer',year:2027,humanTeams:humans,team:names[1],playerId:'free1'});
 assert.equal(bidB.market.offersByPlayer['id:free1'].length,initialCount+2);
 s.freeAgencyState=bidB.market;
 const replacement=runOriginalFreeAgency(s,{mode:'offer',year:2027,humanTeams:humans,teamName:names[0],playerId:'free1',salary:10_000_000,years:4,optionType:'player'});
 verifyMarketOutput(s,replacement,{mode:'offer',year:2027,humanTeams:humans,team:names[0],playerId:'free1'});
 const bids=replacement.market.offersByPlayer['id:free1'];
 assert.equal(bids.length,initialCount+2);
 assert.equal(bids.find(o=>o.teamName===names[1]).currentYearSalary,9_000_000);
 assert.equal(bids.find(o=>o.teamName===names[0]).currentYearSalary,10_000_000);
 assert.equal(replacement.market.offerHistory.length,1);
 assert.equal(replacement.market.offerHistory[0].status,'replaced');
 assert.equal(replacement.market.currentDay,1);
});
