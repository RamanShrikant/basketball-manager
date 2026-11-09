import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {seedOnlinePostseason,nextOnlinePlayInGame,buildOnlinePlayInBatch,applyOnlinePlayInResult,integrateOnlinePlayInGame} from '../onlinePostseasonCore.mjs';
import {initializeOnlinePostseasonRequest,simulateNextOnlinePlayInRequest} from '../onlinePostseason.js';
import {simulatePythonBatch} from '../onlineSimulation.js';

const HOST='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GUEST='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOBBY='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const python=process.env.BM_PYTHON_BIN||(process.platform==='win32'?'python':'python3');
const pythonReady=spawnSync(python,['--version'],{encoding:'utf8'}).status===0;
const player=(team,i)=>({id:`${team}-${i}`,name:`${team} Player ${i}`,pos:['PG','SG','SF','PF','C'][i%5],overall:88-i,offRating:85-i,defRating:84-i,potential:90-i,age:26,attrs:Array.from({length:22},()=>75)});
const fixture=()=>{
 const east=Array.from({length:15},(_,i)=>({name:`East ${i}`,conference:'East',players:Array.from({length:12},(_,j)=>player(`E${i}`,j))}));
 const west=Array.from({length:15},(_,i)=>({name:`West ${i}`,conference:'West',players:Array.from({length:12},(_,j)=>player(`W${i}`,j))}));
 const teams=[...east,...west],byDate={},onlineResults={};
 for(let day=0;day<82;day++){
   const date=new Date(Date.UTC(2026,9,21+day*2)).toISOString().slice(0,10);
   byDate[date]=[];
   for(let i=0;i<15;i++){
     const id=`game-${day}-${i}`;
     const home=teams[(i*2+day)%30].name,away=teams[(i*2+1+day)%30].name;
     // Rotate labels together to preserve 15 distinct matchups per date.
     const g={id,date,home,away};byDate[date].push(g);
     const homeScore=101+i,awayScore=98-i;
     onlineResults[id]={id,date,home,away,homeScore,awayScore,totals:{home:homeScore,away:awayScore}};
   }
 }
 return {seasonStartYear:2026,teams,conferences:{East:east,West:west},onlineResults,
   onlineSchedule:{phase:'regular-season',seasonYear:2026,byDate},
   onlineCheckpoints:{trade_deadline:{status:'closed',date:'2027-02-04',seasonYear:2026,revision:4},
     all_star:{status:'selected',date:'2027-02-21',seasonYear:2026,revision:5},
     veteran_extension:{status:'closed',date:'2027-03-31',seasonYear:2026,revision:6}},
   onlineAllStars:{season:'2026-2027',cutoff_date:'2027-02-21',east:{starters:[1,2,3,4,5],reserves:[1,2,3,4,5,6,7]},west:{starters:[1,2,3,4,5],reserves:[1,2,3,4,5,6,7]}},
   contractExtensionState:{closedTypes:['veteran']}};
};
const statePost=()=>{const state=fixture();state.onlinePostseason=seedOnlinePostseason(state);
 state.onlineSchedule.phase='postseason';state.onlinePostseasonResults={};state.onlinePostseasonStats={};return state;};
const normalized=(game,high=true)=>{
 const homeScore=high?108:99,awayScore=high?99:110;
 return {id:game.id,date:game.date,home:game.home,away:game.away,homeScore,awayScore,
 winner:{home:homeScore,away:awayScore,side:homeScore>awayScore?'home':'away',score:`${homeScore}-${awayScore}`,ot:0},
 totals:{home:homeScore,away:awayScore},periods:{home:[27,27,27,homeScore-81],away:[24,24,24,awayScore-72],ots:{home:[],away:[]},otCount:0},
 box:{home:[{player:'fixture',min:30,pts:homeScore}],away:[{player:'fixture',min:30,pts:awayScore}]}};
};
const res=()=>({statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this;},status(code){this.statusCode=code;return this;},json(data){this.data=data;return this;}});
const req=(actor=HOST,body={lobbyId:LOBBY,requestId:REQUEST,expectedRevision:7})=>({body,get:()=>`Bearer ${'x'.repeat(40)}`,actor});
function mock(state,{actor=HOST,revision=7,event=null}={}){
 const calls={rpc:0,queries:[]};
 const fn=async(url,opts={})=>{
  calls.queries.push(url);
  if(url.includes('/auth/v1/user'))return new Response(JSON.stringify({id:actor}));
  if(url.includes('/bm_online_lobbies'))return new Response(JSON.stringify([{host_id:HOST,status:'started'}]));
  if(url.includes('/bm_online_lobby_members'))return new Response(JSON.stringify([{user_id:actor}]));
  if(url.includes('/bm_online_franchise_events'))return new Response(JSON.stringify(event?[event]:[]));
  if(url.includes('/bm_online_franchise_runtime'))return new Response(JSON.stringify([{revision,state}]));
  if(url.includes('/rpc/bm_online_')){
    calls.rpc++;calls.payload=JSON.parse(opts.body);
    return new Response(JSON.stringify({ok:true,revision:revision+1}));
  }
  throw Error(`Unexpected request ${url}`);
 };
 return {fn,calls};
}
async function withMock(fn){const prior=globalThis.fetch,url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test-key';
 try{return await fn();}finally{globalThis.fetch=prior;if(url===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=url;
 if(key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=key;}}

test('complete season creates one authoritative 20-team bracket, original 2-2-1-1-1 series, 6 play-ins',()=>{
 const source=fixture(),before=JSON.stringify(source);const bracket=seedOnlinePostseason(source);
 assert.equal(bracket.phase,'playIn');assert.equal(bracket.seasonYear,2026);
 assert.equal(bracket.seedOrder.East.length,10);assert.equal(bracket.seedOrder.West.length,10);
 assert.equal(bracket.conf.East.playIn.g78.home,bracket.seedOrder.East[6]);
 assert.equal(bracket.conf.West.playIn.g910.away,bracket.seedOrder.West[9]);
 assert.equal(bracket.conf.East.rounds.r1.s1v8.gameIds.length,7);
 assert.equal(bracket.conf.East.rounds.r1.s1v8.gameDates.length,7);
 assert.equal(bracket.finals.gameIds.length,7);
 assert.equal(JSON.stringify(source),before,'seeding may not mutate the shared league before commit');
});
test('seeding refuses partial, duplicate, extra, corrupted or unauthenticated season state',()=>{
 for(const modify of [
  s=>{delete s.onlineResults['game-0-0'];},
  s=>{s.onlineResults['extra']={};},
  s=>{s.onlineResults['game-0-0'].totals.home=900;},
  s=>{s.teams[0].name=s.teams[1].name;},
  s=>{s.onlinePostseason={};},
  s=>{delete s.onlineCheckpoints.veteran_extension;},
  s=>{s.onlineSchedule.phase='postseason';},
  s=>{s.onlineSchedule.byDate['2026-10-21'].push({...s.onlineSchedule.byDate['2026-10-21'][0],id:'extra'});}
 ]){const s=fixture();modify(s);assert.throws(()=>seedOnlinePostseason(s));}
});
test('every Play-In result advances exactly one matchup and freezes seed 7 and 8',()=>{
 const s=statePost();let bracket=s.onlinePostseason;
 const results=[];
 for(let i=0;i<6;i++){
   const g=nextOnlinePlayInGame({onlinePostseason:bracket,onlineSchedule:{phase:'postseason'}});
   assert.ok(g);results.push(g);
   const played=normalized(g,i%2===0);bracket=applyOnlinePlayInResult(bracket,g,played);
   assert.equal(bracket.conf[g.conf].playIn[g.key].winner,
     played.homeScore>played.awayScore?g.home:g.away);
 }
 assert.equal(bracket.phase,'playoffs');
 assert.throws(()=>nextOnlinePlayInGame({onlinePostseason:bracket,onlineSchedule:{phase:'postseason'}}),/not in the Play-In/);assert.equal(new Set(results.map(g=>g.id)).size,6);
 for(const conf of ['East','West']){
   const pi=bracket.conf[conf].playIn;
   assert.equal(bracket.conf[conf].rounds.r1.s1v8.lowSeedTeam,pi.seed8);
   assert.equal(bracket.conf[conf].rounds.r1.s2v7.lowSeedTeam,pi.seed7);
 }
});
test('out-of-order result and duplicate or stale bracket game cannot be accepted',()=>{
 const s=statePost(),first=nextOnlinePlayInGame(s);const result=normalized(first);
 assert.throws(()=>applyOnlinePlayInResult(s.onlinePostseason,{...first,id:'wrong'},result),/Stale|out-of-sequence/);
 const next=applyOnlinePlayInResult(s.onlinePostseason,first,result);
 assert.throws(()=>applyOnlinePlayInResult(next,first,result),/Stale|out-of-sequence/);
});
test('original single-player standings and bracket creation function bodies are copied without rule changes',()=>{
 const original=readFileSync(new URL('../../frontend/src/pages/Playoffs.jsx',import.meta.url),'utf8');
 const extracted=readFileSync(new URL('../onlinePostseasonOriginal.mjs',import.meta.url),'utf8');
 assert.ok(extracted.includes('const homeOrder = homeOrderForBestOf7HigherSeedHome();'));
 for(const mark of ['PI_${seasonYear}_${conf}_7v8','PI_${seasonYear}_${conf}_9v10','PI_${seasonYear}_${conf}_8seed']){
   assert.ok(original.includes(mark)&&extracted.includes(mark));
 }
 const canonical=readFileSync(new URL('../onlinePostseasonCanonical.mjs',import.meta.url),'utf8');
 for(const name of ['computeCanonicalStandings','compareCanonicalTeams','sortCanonicalTeamNames']){
   assert.ok(canonical.includes(`function ${name}`));
 }
});
test('host only, invalid body, stale revision and replay never seed through the database',async()=>withMock(async()=>{
 const s=fixture(),m=mock(s,{actor:GUEST});globalThis.fetch=m.fn;
 let r=res();await initializeOnlinePostseasonRequest(req(GUEST),r);assert.equal(r.statusCode,403);assert.equal(m.calls.rpc,0);
 r=res();await initializeOnlinePostseasonRequest(req(GUEST,{...req().body,postseason:{fake:true}}),r);assert.equal(r.statusCode,400);
 const old=mock(s,{revision:8});globalThis.fetch=old.fn;
 r=res();await initializeOnlinePostseasonRequest(req(HOST),r);assert.equal(r.statusCode,409);assert.equal(old.calls.rpc,0);
 const replay=mock(s,{event:{actor_id:HOST,action_type:'postseason_seeded',revision:8,details:{}}});globalThis.fetch=replay.fn;
 r=res();await initializeOnlinePostseasonRequest(req(HOST),r);assert.equal(r.statusCode,200);assert.equal(r.data.replayed,true);assert.equal(replay.calls.rpc,0);
}));
test('host commits seeds from source game results instead of accepting browser-supplied seeds',async()=>withMock(async()=>{
 const m=mock(fixture());globalThis.fetch=m.fn;
 const r=res();await initializeOnlinePostseasonRequest(req(HOST),r);
 assert.equal(r.statusCode,200,JSON.stringify(r.data));assert.equal(m.calls.rpc,1);
 assert.equal(m.calls.payload.p_postseason.seasonYear,2026);
 assert.equal(m.calls.payload.p_expected_revision,7);
}));
test('real original Python simulator computes the next Play-In game, stats are postseason-only',{skip:!pythonReady},async()=>{
 const s=statePost();const {next,batch}=buildOnlinePlayInBatch(s);
 assert.equal(next.id,batch.games[0].id);
 const raw=await simulatePythonBatch(batch.inputs,{seed:2026,python,timeoutMs:40000});
 const before=JSON.stringify(s),delta=integrateOnlinePlayInGame(s,next,raw,1234);
 assert.ok(delta.result.box.home.length>=10);
 assert.equal(delta.bracket.conf[next.conf].playIn[next.key].played,true);
 assert.ok(Object.keys(delta.stats).length>0);assert.equal(s.onlinePlayerStats,undefined);
 assert.equal(JSON.stringify(s),before,'postseason must never mutate fetched shared runtime before SQL commit');
});
test('guest and stale revision cannot simulate; a completed request replays without Python',{skip:!pythonReady},async()=>withMock(async()=>{
 const s=statePost(),m=mock(s,{actor:GUEST});globalThis.fetch=m.fn;
 let r=res();await simulateNextOnlinePlayInRequest(req(GUEST),r);assert.equal(r.statusCode,403);assert.equal(m.calls.rpc,0);
 const old=mock(s,{revision:8});globalThis.fetch=old.fn;
 r=res();await simulateNextOnlinePlayInRequest(req(),r);assert.equal(r.statusCode,409);assert.equal(old.calls.rpc,0);
 const replay=mock(s,{event:{actor_id:HOST,action_type:'play_in_game_simulated',revision:8,details:{gameId:'PI_2026_East_7v8'}}});globalThis.fetch=replay.fn;
 r=res();await simulateNextOnlinePlayInRequest(req(),r);assert.equal(r.statusCode,200);assert.equal(r.data.replayed,true);assert.equal(replay.calls.rpc,0);
}));
test('every combination of six Play-In winners yields six unique finals and exactly one seed-7/8 per conference',()=>{
  for(let mask=0;mask<64;mask++){
    let bracket=statePost().onlinePostseason;
    const played=new Set();
    for(let i=0;i<6;i++){
      const game=nextOnlinePlayInGame({onlinePostseason:bracket,onlineSchedule:{phase:'postseason'}});
      assert.ok(!played.has(game.id));played.add(game.id);
      bracket=applyOnlinePlayInResult(bracket,game,normalized(game,Boolean(mask&(1<<i))));
    }
    assert.equal(bracket.phase,'playoffs');assert.equal(played.size,6);
    for(const conf of ['East','West']){
      const pi=bracket.conf[conf].playIn;
      assert.notEqual(pi.seed7,pi.seed8);assert.ok(pi.seed7&&pi.seed8);
      assert.equal(pi.gFinal.home,pi.g78.loser);
      assert.equal(pi.gFinal.away,pi.g910.winner);
      assert.equal(bracket.conf[conf].rounds.r1.s1v8.lowSeedTeam,pi.seed8);
      assert.equal(bracket.conf[conf].rounds.r1.s2v7.lowSeedTeam,pi.seed7);
    }
  }
});

test('host simulation commits a genuine Python Play-In result without changing regular-season results',{skip:!pythonReady},async()=>withMock(async()=>{
  const s=statePost(),m=mock(s);globalThis.fetch=m.fn;
  const response=res();await simulateNextOnlinePlayInRequest(req(),response);
  assert.equal(response.statusCode,200,JSON.stringify(response.data));
  assert.equal(m.calls.rpc,1);
  assert.equal(m.calls.payload.p_result.id,m.calls.payload.p_game_id);
  assert.ok(m.calls.payload.p_result.box.home.length>=10);
  assert.equal(m.calls.payload.p_postseason.phase,'playIn');
  assert.equal(m.calls.payload.p_postseason_stats.constructor,Object);
  assert.equal(s.onlinePostseasonResults[m.calls.payload.p_game_id],undefined);
}));

test('the SQL is private, locks the league and independently validates advanced bracket result',()=>{
 const sql=readFileSync(new URL('../../supabase/bm_online_playin_phase2d3a.sql',import.meta.url),'utf8').toLowerCase();
 for(const clause of ['for update','p_expected_revision','v_host is distinct from p_actor','postseason_seeded',
  'play_in_game_simulated','v_post is distinct from p_postseason','bm_online_postseason_runtime_guard_phase2d3a','service_role'])
  assert.ok(sql.includes(clause),clause);
 assert.ok(!/grant execute[^;]+to authenticated/i.test(sql));
});
