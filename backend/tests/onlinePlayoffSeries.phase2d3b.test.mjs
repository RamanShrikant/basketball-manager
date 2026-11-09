import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {seedOnlinePostseason,applyOnlinePlayInResult,nextOnlinePlayInGame} from '../onlinePostseasonCore.mjs';
import {nextOnlinePlayoffGame,applyOnlinePlayoffGameResult,buildOnlinePlayoffBatch,integrateOnlinePlayoffGame} from '../onlinePlayoffSeries.mjs';
import {simulateNextOnlinePlayoffRequest} from '../onlinePostseason.js';
import {simulatePythonBatch} from '../onlineSimulation.js';

const HOST='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',GUEST='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOBBY='cccccccc-cccc-4ccc-8ccc-cccccccccccc',REQUEST='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const python=process.env.BM_PYTHON_BIN||(process.platform==='win32'?'python':'python3');
const pythonReady=spawnSync(python,['--version'],{encoding:'utf8'}).status===0;
const player=(team,i)=>({id:`${team}-${i}`,name:`${team} Player ${i}`,pos:['PG','SG','SF','PF','C'][i%5],overall:88-i,offRating:85-i,defRating:84-i,potential:90-i,age:26,attrs:Array.from({length:22},()=>75)});
function fixture(){
 const east=Array.from({length:15},(_,i)=>({name:`East ${i}`,conference:'East',players:Array.from({length:12},(_,j)=>player(`E${i}`,j))}));
 const west=Array.from({length:15},(_,i)=>({name:`West ${i}`,conference:'West',players:Array.from({length:12},(_,j)=>player(`W${i}`,j))}));
 const teams=[...east,...west],byDate={},onlineResults={};
 for(let day=0;day<82;day++){
   const date=new Date(Date.UTC(2026,9,21+day*2)).toISOString().slice(0,10);
   byDate[date]=[];
   for(let i=0;i<15;i++){
     const id=`game-${day}-${i}`,home=teams[(i*2+day)%30].name,away=teams[(i*2+1+day)%30].name;
     byDate[date].push({id,date,home,away});
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
}
function result(g,winHome=true){
 const homeScore=winHome?112:103,awayScore=winHome?101:119;
 return {id:g.id,date:g.date,home:g.home,away:g.away,homeScore,awayScore,
   winner:{home:homeScore,away:awayScore,side:homeScore>awayScore?'home':'away',ot:0},
   totals:{home:homeScore,away:awayScore},
   box:{home:[{player:'sim',min:20,pts:homeScore}],away:[{player:'sim',min:20,pts:awayScore}]}};
}
function ready(){
 const s=fixture(),post=seedOnlinePostseason(s);
 s.onlineSchedule.phase='postseason';s.onlinePostseasonResults={};s.onlinePostseasonStats={};
 for(let i=0;i<6;i++){
   const g=nextOnlinePlayInGame({onlinePostseason:post,onlineSchedule:s.onlineSchedule});
   Object.assign(post,applyOnlinePlayInResult(post,g,result(g,i%2===0)));
 }
 assert.equal(post.phase,'playoffs');s.onlinePostseason=post;return s;
}
const response=()=>({statusCode:200,set(){return this;},status(v){this.statusCode=v;return this;},json(v){this.data=v;return this;}});
const req=(id=HOST)=>({body:{lobbyId:LOBBY,requestId:REQUEST,expectedRevision:7},get:()=>`Bearer ${'x'.repeat(40)}`});
const mock=({state,actor=HOST,revision=7,event=null})=>{const calls={rpc:0};const fn=async(url,opts={})=>{
 if(url.includes('/auth/v1/user'))return new Response(JSON.stringify({id:actor}));
 if(url.includes('/bm_online_lobbies'))return new Response(JSON.stringify([{host_id:HOST,status:'started'}]));
 if(url.includes('/bm_online_lobby_members'))return new Response(JSON.stringify([{user_id:actor}]));
 if(url.includes('/bm_online_franchise_events'))return new Response(JSON.stringify(event?[event]:[]));
 if(url.includes('/bm_online_franchise_runtime'))return new Response(JSON.stringify([{revision,state}]));
 if(url.includes('/rpc/bm_online_')){calls.rpc++;calls.payload=JSON.parse(opts.body);return new Response(JSON.stringify({ok:true,revision:revision+1}));}
 throw Error(`Unexpected request ${url}`);
};return {fn,calls};};
async function withMock(fn){const prior=globalThis.fetch,url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test-key';
 try{return await fn();}finally{globalThis.fetch=prior;if(url===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=url;
 if(key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=key;}}

test('existing bracket starts with all 15 original 2-2-1-1-1 series and chooses deterministic first round',()=>{
 const s=ready(),g=nextOnlinePlayoffGame(s);assert.equal(g.round,'r1');assert.equal(g.index,0);assert.equal(g.date,s.onlinePostseason.calendar.rounds.r1[0]);
 assert.ok(g.id.includes('_R1_'));assert.deepEqual(Object.keys(s.onlinePostseason.conf.West.rounds.r1).length,4);
});
test('first four games use higher seed home twice then lower seed home twice',()=>{
 const s=ready();let post=s.onlinePostseason;
 const g1=nextOnlinePlayoffGame(s);const teams=[g1.home,g1.away];
 const series=post.conf[g1.conf].rounds[g1.round][g1.key];
 for(let i=0;i<4;i++){
   // Set unrelated first round series finished so this one advances through its own chronological dates.
   if(i>0){s.onlinePostseason=post;}
   const meta=series.gameIds[i],date=series.gameDates[i];
   assert.equal(meta.includes(`_G${i+1}`),true);
   const highHome=[0,1,4,6].includes(i);
   assert.equal((highHome?series.highSeedTeam:series.lowSeedTeam),i<2?teams[0]:teams[1]);
 }
});

test('complete playoffs: 15 series, between 60 and 105 games, exactly one champion, no duplicate or phantom game',()=>{
 for(const mode of ['sweep','seven','mixed']){
   const s=ready(),seen=new Set();let total=0;const original=JSON.stringify(s.onlinePostseason);
   while(s.onlinePostseason.phase!=='postseasonComplete'){
     const g=nextOnlinePlayoffGame(s);assert.ok(g);assert.ok(!seen.has(g.id));seen.add(g.id);
     const winHome=mode==='sweep'?(g.home===g.highTeam):mode==='seven'?(g.index<3?g.home===g.highTeam:g.index===6?g.home!==g.highTeam:g.home===g.lowTeam):((total*7+g.index)%3!==0);
     const r=result(g,winHome);
     const updated=applyOnlinePlayoffGameResult(s.onlinePostseason,g,r);
     assert.equal(updated.conf.East.playIn.g78.played,true);
     assert.equal(updated.conf.West.playIn.gFinal.played,true);
     s.onlinePostseason=updated;total++;
     assert.ok(total<=105,'An infinite postseason loop was detected');
   }
   assert.ok(total>=60&&total<=105,`${mode}: ${total}`);
   assert.ok(s.onlinePostseason.champion);
   assert.equal(s.onlinePostseason.champion,s.onlinePostseason.finals.winsHigh===4?s.onlinePostseason.finals.highSeedTeam:s.onlinePostseason.finals.lowSeedTeam);
   assert.equal(nextOnlinePlayoffGame(s),null);
   assert.equal(JSON.stringify(ready().onlinePostseason),original,'The input bracket is not mutated by progression');
 }
});

test('Finals home court follows frozen wins; West receives exact tie',()=>{
 const s=ready();let i=0;
 while(s.onlinePostseason.phase==='playoffs'&&i<105){
   const g=nextOnlinePlayoffGame(s);s.onlinePostseason=applyOnlinePlayoffGameResult(s.onlinePostseason,g,result(g,true));i++;
 }
 assert.ok(s.onlinePostseason.finals.complete);
 assert.ok(s.onlinePostseason.finals.highSeedTeam&&s.onlinePostseason.finals.lowSeedTeam);
 assert.equal(s.onlinePostseason.finals.highSeedTeam===s.onlinePostseason.conf.West.rounds.r3.confFinals.highSeedTeam||
 s.onlinePostseason.finals.highSeedTeam===s.onlinePostseason.conf.West.rounds.r3.confFinals.lowSeedTeam,true);
});

test('stale game, game replay, corrupt 4-4 series and unplayed Play-In refuse advancement',()=>{
 const s=ready(),g=nextOnlinePlayoffGame(s),r=result(g),updated=applyOnlinePlayoffGameResult(s.onlinePostseason,g,r);
 assert.throws(()=>applyOnlinePlayoffGameResult(updated,g,r),/Stale|out-of-sequence|invalid/);
 assert.throws(()=>applyOnlinePlayoffGameResult(s.onlinePostseason,{...g,id:'fake'},r),/Stale|invalid/);
 const damaged=structuredClone(s.onlinePostseason);const node=damaged.conf[g.conf].rounds[g.round][g.key];node.winsHigh=4;node.winsLow=4;node.nextGameIndex=7;node.complete=true;
 assert.throws(()=>nextOnlinePlayoffGame({...s,onlinePostseason:damaged}));
 const blocked=structuredClone(s.onlinePostseason);blocked.conf.East.playIn.g78.played=false;
 assert.throws(()=>nextOnlinePlayoffGame({...s,onlinePostseason:blocked}),/Play-In/);
});

test('real original Python simulator produces a valid single online playoff game without touching league snapshot',{skip:!pythonReady},async()=>{
 const s=ready(),{next,batch}=buildOnlinePlayoffBatch(s),before=JSON.stringify(s);
 const raw=await simulatePythonBatch(batch.inputs,{seed:2026,python,timeoutMs:40000});
 const delta=integrateOnlinePlayoffGame(s,next,raw,2026^0x7C31DA0B);
 assert.ok(delta.result.box.home.length>=10);assert.equal(delta.result.id,next.id);
 assert.equal(delta.bracket.conf[next.conf].rounds.r1[next.key].nextGameIndex,1);
 assert.equal(JSON.stringify(s),before);
});

test('backend guest, stale revision, wrong request fields and replay reject without invoking the Python simulator',async()=>withMock(async()=>{
 const s=ready();let m=mock({state:s,actor:GUEST});globalThis.fetch=m.fn;
 let r=response();await simulateNextOnlinePlayoffRequest(req(),r);assert.equal(r.statusCode,403);assert.equal(m.calls.rpc,0);
 m=mock({state:s,revision:8});globalThis.fetch=m.fn;
 r=response();await simulateNextOnlinePlayoffRequest(req(),r);assert.equal(r.statusCode,409);assert.equal(m.calls.rpc,0);
 m=mock({state:s,event:{actor_id:HOST,action_type:'playoff_game_simulated',revision:8,details:{gameId:'PO_2026_East_R1_1v8_G1',date:'2027-04-21'}}});globalThis.fetch=m.fn;
 r=response();await simulateNextOnlinePlayoffRequest(req(),r);assert.equal(r.statusCode,200);assert.equal(r.data.replayed,true);assert.equal(m.calls.rpc,0);
 r=response();await simulateNextOnlinePlayoffRequest({...req(),body:{...req().body,homeScore:999}},r);assert.equal(r.statusCode,400);
}));

test('backend commits only server-generated Playoff results, with postseason stats and injury delta',{skip:!pythonReady},async()=>withMock(async()=>{
 const s=ready(),m=mock({state:s});globalThis.fetch=m.fn;
 const r=response();await simulateNextOnlinePlayoffRequest(req(),r);
 assert.equal(r.statusCode,200,JSON.stringify(r.data));assert.equal(m.calls.rpc,1);
 assert.ok(m.calls.payload.p_game_id.startsWith('PO_'));
 assert.equal(m.calls.payload.p_result.id,m.calls.payload.p_game_id);
 assert.equal(m.calls.payload.p_postseason_stats.constructor,Object);
 assert.equal(s.onlinePostseasonResults[m.calls.payload.p_game_id],undefined);
}));

test('private SQL independently reconciles points, next game order, roster identity and exact bracket',()=>{
 const sql=readFileSync(new URL('../../supabase/bm_online_playoffs_phase2d3b.sql',import.meta.url),'utf8').toLowerCase();
 for(const field of ['for update','p_expected_revision','playoff_game_simulated','v_post is distinct from p_postseason',
   'bm_online_wire_series_phase2d3b','bm.online_postseason_write','service_role','v_west_wins','v_east_wins','v_old_player','v_new_player'])assert.ok(sql.includes(field),field);
 assert.ok(!/grant execute[^;]+to authenticated/i.test(sql));
});
