import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {buildOnlineGameBatch,nextOnlineSimulationDay,integrateOnlineSimulation,normalizeSimulatedResult} from '../onlineSimulationCore.js';
import {simulatePythonBatch,simulateOnlineDayRequest} from '../onlineSimulation.js';
const uuids={lobby:'11111111-1111-4111-8111-111111111111',host:'22222222-2222-4222-8222-222222222222',guest:'33333333-3333-4333-8333-333333333333',request:'44444444-4444-4444-8444-444444444444'};
const player=(team,i)=>({id:`${team}-${i}`,name:`${team} Player ${i}`,pos:['PG','SG','SF','PF','C'][i%5],overall:88-i,offRating:85-i,defRating:84-i,potential:90-i,age:26,attrs:Array.from({length:22},()=>75)});
const team=i=>({name:`Fixture Team ${i}`,players:Array.from({length:12},(_,j)=>player(`T${i}`,j))});
const teams=Array.from({length:30},(_,i)=>team(i));
const fixture=(date='2026-10-21',count=2)=>({seasonStartYear:2026,teams:structuredClone(teams),onlineSchedule:{source:'singleplayer-calendar-v2',phase:'regular-season',byDate:{[date]:Array.from({length:count},(_,i)=>({id:`g_${date}_${i}`,date,home:teams[i*2].name,away:teams[i*2+1].name})), '2026-10-22':[{id:'g_second_day',date:'2026-10-22',home:teams[4].name,away:teams[5].name}]}}});
const reply=()=>({statusCode:200,set(){return this;},status(code){this.statusCode=code;return this;},json(value){this.data=value;return this;}});
const request=(actor=uuids.host,body={lobbyId:uuids.lobby,requestId:uuids.request,expectedRevision:4})=>({body,get:()=>`Bearer ${'z'.repeat(50)}`,actor});
function withFetch(state,{revision=4,actor=uuids.host,event=null,onCommit=()=>({ok:true,revision:5})}={}){
 const captured={rpc:0,queries:[]};
 const fetchMock=async(url,options={})=>{
   captured.queries.push(url);
   if(url.includes('/auth/v1/user'))return new Response(JSON.stringify({id:actor}),{status:200});
   if(url.includes('/bm_online_lobbies'))return new Response(JSON.stringify([{host_id:uuids.host,status:'started'}]),{status:200});
   if(url.includes('/bm_online_lobby_members'))return new Response(JSON.stringify([{user_id:actor}]),{status:200});
   if(url.includes('/bm_online_franchise_events'))return new Response(JSON.stringify(event?[event]:[]),{status:200});
   if(url.includes('/bm_online_franchise_runtime'))return new Response(JSON.stringify([{state,revision}]),{status:200});
   if(url.includes('/rpc/bm_online_simulate_day_phase2d2')){captured.rpc++;captured.payload=JSON.parse(options.body);return new Response(JSON.stringify(onCommit()),{status:200});}
   throw Error('Unexpected network call '+url);
 };
 return {captured,fetchMock};
}
const python=process.env.BM_PYTHON_BIN||(process.platform==='win32'?'python':'python3');
const pythonReady=spawnSync(python,['--version'],{encoding:'utf8'}).status===0;

test('next date is chronological, never repeats a completed game',()=>{
 const state=fixture();assert.equal(nextOnlineSimulationDay(state).date,'2026-10-21');
 state.onlineResults=Object.fromEntries(state.onlineSchedule.byDate['2026-10-21'].map(g=>[g.id,{homeScore:100,awayScore:94}]));
 assert.equal(nextOnlineSimulationDay(state).date,'2026-10-22');
 state.onlineResults['g_second_day']={homeScore:101,awayScore:99};
 assert.throws(()=>nextOnlineSimulationDay(state),/completed/);
});
test('partial dates, invalid teams and duplicate games are blocked before Python or SQL',()=>{
 const state=fixture();state.onlineResults={[state.onlineSchedule.byDate['2026-10-21'][0].id]:{homeScore:100,awayScore:90}};
 assert.throws(()=>nextOnlineSimulationDay(state),/partially completed/);
 const missing=fixture();missing.teams[0].players.length=4;
 assert.throws(()=>buildOnlineGameBatch(missing),/fewer than five/);
 const double=fixture();double.onlineSchedule.byDate['2026-10-21'][1].home=teams[0].name;
 assert.throws(()=>nextOnlineSimulationDay(double),/two games/);
 const duplicates=fixture();duplicates.teams[0].players[0].name=duplicates.teams[0].players[1].name;
 assert.throws(()=>buildOnlineGameBatch(duplicates),/Duplicate/);
});
test('server reuses single-player smart rotation, respects injuries, does not mutate input',()=>{
 const state=fixture();const original=structuredClone(state);
 state.teams[0].players[0].injury={active:true,returnDate:'2026-11-05'};
 const b=buildOnlineGameBatch(state);assert.deepEqual(state.teams[1],original.teams[1]);
 const home=b.inputs[0].home;
 assert.equal(home.minutes[home.players[0].name],0);
 assert.equal(Object.values(home.minutes).reduce((a,v)=>a+v,0),240);
 assert.equal(b.snapshot.teams[0].players[0].injury.active,true);
});
test('original Python game engine runs real games and produces persistent box scores', {skip:!pythonReady}, async()=>{
 const b=buildOnlineGameBatch(fixture());
 const output=await simulatePythonBatch(b.inputs,{python,seed:2026,timeoutMs:40000});
 const integrated=integrateOnlineSimulation(b,output,0);
 assert.equal(Object.keys(integrated.results).length,2);
 assert.ok(integrated.results[b.games[0].id].homeScore!==integrated.results[b.games[0].id].awayScore);
 assert.ok(integrated.results[b.games[0].id].box.home.length>=10);
 assert.ok(Object.keys(integrated.stats).length>=18);
 assert.equal(integrated.gameCount,2);
 assert.ok(integrated.rosters.length===30);
 assert.equal(integrated.stats[`${b.inputs[0].home.players[0].name}__${b.games[0].home}`]?.gp??0,integrated.stats[`${b.inputs[0].home.players[0].name}__${b.games[0].home}`]?.gp??0);
});
test('invalid engine scores, tied finals, missing boxes and mismatched periods fail closed',()=>{
 const g=fixture().onlineSchedule.byDate['2026-10-21'][0];
 const raw={score:{home:101,away:100},box_home:[{player:'A',min:30}],box_away:[{player:'B',min:30}],quarters_home:[25,25,25,26],quarters_away:[25,25,25,25]};
 assert.equal(normalizeSimulatedResult(g,raw,g.date).homeScore,101);
 assert.throws(()=>normalizeSimulatedResult(g,{...raw,score:{home:100,away:100}},g.date),/impossible/);
 assert.throws(()=>normalizeSimulatedResult(g,{...raw,quarters_home:[25,25,25,25]},g.date),/quarter totals/);
 assert.throws(()=>normalizeSimulatedResult(g,{...raw,box_home:[]},g.date),/missing player box/);
});
test('guest is refused before accessing runtime or simulator',async()=>{
 const old=globalThis.fetch;process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test_key';
 const {fetchMock,captured}=withFetch(fixture(),{actor:uuids.guest});globalThis.fetch=fetchMock;
 try{const response=reply();await simulateOnlineDayRequest(request(uuids.guest),response);assert.equal(response.statusCode,403);
   assert.equal(captured.rpc,0);assert.ok(!captured.queries.some(x=>x.includes('franchise_runtime')));
 }finally{globalThis.fetch=old;}
});
test('stale revisions, forbidden input fields and existing request ids do not resimulate',async()=>{
 const old=globalThis.fetch;process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test_key';
 const {fetchMock,captured}=withFetch(fixture(),{revision:8});globalThis.fetch=fetchMock;
 try{
  let r=reply();await simulateOnlineDayRequest(request(),r);assert.equal(r.statusCode,409);assert.equal(captured.rpc,0);
  r=reply();await simulateOnlineDayRequest(request(uuids.host,{...request().body,results:{fake:true}}),r);assert.equal(r.statusCode,400);
 }finally{globalThis.fetch=old;}
});
test('idempotent replay returns prior revision and never starts another Python worker',async()=>{
 const old=globalThis.fetch;process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test_key';
 const {fetchMock,captured}=withFetch(fixture(),{event:{actor_id:uuids.host,revision:5,action_type:'regular_season_day_simulated',details:{date:'2026-10-21',games:2}}});
 globalThis.fetch=fetchMock;
 try{const r=reply();await simulateOnlineDayRequest(request(),r);assert.equal(r.statusCode,200);assert.equal(r.data.replayed,true);assert.equal(r.data.revision,5);assert.equal(captured.rpc,0);}finally{globalThis.fetch=old;}
});
test('injury and smart-rotation source mirrors are unchanged apart from server-local import paths',()=>{
 const root=new URL('../../frontend/src/',import.meta.url),local=new URL('../onlineSimShared/',import.meta.url);
 for(const [source,copy] of [['api/teamRatings.js','teamRatings.mjs'],['utils/leagueClock.js','leagueClock.mjs']])
   assert.equal(fs.readFileSync(new URL(source,root),'utf8'),fs.readFileSync(new URL(copy,local),'utf8'));
 assert.equal(fs.readFileSync(new URL('utils/ensureGameplans.js',root),'utf8').replace('"../api/teamRatings"','"./teamRatings.mjs"'),fs.readFileSync(new URL('ensureGameplans.mjs',local),'utf8'));
 assert.equal(fs.readFileSync(new URL('utils/injurySystem.js',root),'utf8').replace('"./ensureGameplans.js"','"./ensureGameplans.mjs"').replace('"./leagueClock.js"','"./leagueClock.mjs"'),fs.readFileSync(new URL('injurySystem.mjs',local),'utf8'));
});
test('private SQL requires host and revision, locks runtime, cannot overwrite player identity',()=>{
 const sql=fs.readFileSync(new URL('../../supabase/bm_online_simulate_day_phase2d2.sql',import.meta.url),'utf8').toLowerCase();
 for(const clause of ['for update','v_rev<>p_expected_revision','v_host is distinct from p_actor','v_first_unplayed<>p_date','v_existing ? v_game_id','v_old_player - \'injury\'','regular_season_day_simulated','service_role'])assert.ok(sql.includes(clause),clause);
 assert.ok(!/grant execute[^;]+to authenticated/i.test(sql));
});
test('trusted host commits a real simulated next-day batch, not browser scores', {skip:!pythonReady}, async()=>{
  const old=globalThis.fetch;
  process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test_key';
  const {fetchMock,captured}=withFetch(fixture(),{onCommit:()=>({ok:true,revision:5})});
  globalThis.fetch=fetchMock;
  try{
    const response=reply();await simulateOnlineDayRequest(request(),response);
    assert.equal(response.statusCode,200,JSON.stringify(response.data));
    assert.equal(response.data.ok,true);assert.equal(response.data.games,2);
    assert.equal(captured.rpc,1);
    assert.equal(captured.payload.p_actor,uuids.host);
    assert.equal(captured.payload.p_expected_revision,4);
    assert.equal(captured.payload.p_date,'2026-10-21');
    assert.equal(Object.keys(captured.payload.p_results).length,2);
    assert.equal(captured.payload.p_results['g_2026-10-21_0'].box.home.length,12);
    assert.equal(captured.payload.p_rosters.length,30);
    assert.ok(Object.keys(captured.payload.p_stats).length>=18);
  }finally{globalThis.fetch=old;}
});
