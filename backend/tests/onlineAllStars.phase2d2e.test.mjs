import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateAllStarReadiness,prepareAllStarInput,runOriginalAllStarSelector,
  validateAllStarOutput,selectOnlineAllStarsRequest} from '../onlineAllStars.js';
import {firstBlockedOnlineCheckpoint,isOnlineAllStarSelected,planOnlineSimToDate} from '../../frontend/src/online/onlineSimulationCheckpoints.mjs';

const LOBBY='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HOST='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUEST='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const game=date=>({date,id:`g-${date}`,home:'East 0',away:'West 0'});
function fixture(){
 const east=Array.from({length:15},(_,i)=>({name:`East ${i}`,conference:'East',players:Array.from({length:15},(_,j)=>({name:`East ${i} Player ${j}`}))}));
 const west=Array.from({length:15},(_,i)=>({name:`West ${i}`,conference:'West',players:Array.from({length:15},(_,j)=>({name:`West ${i} Player ${j}`}))}));
 const stats={};
 for(const team of [...east,...west])for(let i=0;i<15;i++){
   const p=team.players[i];stats[`${p.name}__${team.name}`]={player:p.name,team:team.name,gp:40,
     pts:Math.round((i+10)*40),reb:200+i*5,ast:160+i*4,stl:30+i,blk:20+i,
     fgm:240+i,fga:480+i*2,tpm:80+i, tpa:210+i*2,ftm:90+i,fta:110+i,started:40,sixth:0};
 }
 return {seasonStartYear:2026,teams:[...east,...west],conferences:{East:east,West:west},
   onlinePlayerStats:stats,onlineSchedule:{phase:'regular-season',seasonYear:2026,byDate:{
     '2027-02-19':[game('2027-02-19')],'2027-02-22':[game('2027-02-22')],
     '2027-04-01':[game('2027-04-01')]}},
   onlineResults:{['g-2027-02-19']:{id:'g-2027-02-19',date:'2027-02-19',homeScore:110,awayScore:99}},
   onlineCheckpoints:{trade_deadline:{status:'closed',date:'2027-02-04',seasonYear:2026,revision:8}}};
}
function reply(){return {statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this;},status(v){this.statusCode=v;return this;},json(v){this.data=v;return this;}};}
const req=(revision=9)=>({body:{lobbyId:LOBBY,requestId:REQUEST,expectedRevision:revision},get:()=>`Bearer ${'x'.repeat(40)}`});
function selected(state){
 state.onlineCheckpoints.all_star={status:'selected',date:'2027-02-21',seasonYear:2026,revision:10};
 state.onlineAllStars={season:'2026-2027',cutoff_date:'2027-02-21',east:{starters:[1,2,3,4,5],reserves:[1,2,3,4,5,6,7]},west:{starters:[1,2,3,4,5],reserves:[1,2,3,4,5,6,7]}};
 return state;
}

test('only exact date, season, revision and recorded All-Star teams clear the checkpoint',()=>{
 const state=fixture();
 assert.equal(firstBlockedOnlineCheckpoint(state,'2027-02-22')?.kind,'all_star');
 assert.deepEqual(evaluateAllStarReadiness(state),{date:'2027-02-21',seasonYear:2026});
 selected(state);
 assert.equal(isOnlineAllStarSelected(state,'2027-02-21'),true);
 assert.equal(firstBlockedOnlineCheckpoint(state,'2027-02-22'),null);
 assert.deepEqual(planOnlineSimToDate(state,'2027-02-22').days,['2027-02-22']);
 state.onlineCheckpoints.all_star.seasonYear=2027;
 assert.equal(isOnlineAllStarSelected(state,'2027-02-21'),false);
 assert.equal(firstBlockedOnlineCheckpoint(state,'2027-02-22')?.kind,'all_star');
 state.onlineCheckpoints.all_star.seasonYear=2026;
 state.onlineCheckpoints.all_star.revision=0;
 assert.equal(isOnlineAllStarSelected(state,'2027-02-21'),false);
 state.onlineCheckpoints.all_star.revision=10;
 state.onlineAllStars.cutoff_date='2027-02-20';
 assert.equal(isOnlineAllStarSelected(state,'2027-02-21'),false);
});

test('cannot skip preceding games, partial days, prior checkpoints or previously selected teams',()=>{
 const s=fixture();delete s.onlineResults['g-2027-02-19'];
 assert.throws(()=>evaluateAllStarReadiness(s),/not the next/);
 s.onlineResults={'g-2027-02-19':{id:'g-2027-02-19',date:'2027-02-19',homeScore:110,awayScore:99}};
 s.onlineSchedule.byDate['2027-02-22'].push({...game('2027-02-22'),id:'g-extra'});
 s.onlineResults['g-2027-02-22']={date:'2027-02-22',homeScore:111,awayScore:112};
 assert.throws(()=>evaluateAllStarReadiness(s),/partial/);
 assert.throws(()=>evaluateAllStarReadiness(selected(fixture())),/not the next|already/);
 const missingTrade=fixture();delete missingTrade.onlineCheckpoints.trade_deadline;
 assert.throws(()=>evaluateAllStarReadiness(missingTrade),/not the next/);
});

test('runs the byte-identical original single-player Python selector with 24 valid All-Stars',async()=>{
 const state=fixture(),before=JSON.stringify(state);
 const input=prepareAllStarInput(state,'2027-02-21');
 assert.equal(input.playerStats['East 0 Player 0__East 0'].gp,40);
 const result=validateAllStarOutput(input,await runOriginalAllStarSelector(input));
 assert.equal(result.east.starters.length,5);assert.equal(result.east.reserves.length,7);
 assert.equal(result.west.starters.length,5);assert.equal(result.west.reserves.length,7);
 assert.equal(result.season,'2026-2027');
 assert.equal(JSON.stringify(state),before,'selection may not mutate the fetched snapshot');
 const bad=structuredClone(result);bad.west.starters[0]=bad.east.starters[0];
 assert.throws(()=>validateAllStarOutput(input,bad),/ineligible|invalid|duplicate/);
 const removed=structuredClone(result);removed.east.starters.pop();
 assert.throws(()=>validateAllStarOutput(input,removed),/incomplete/);
});

test('invalid rosters, missing conferences, insufficient stats and duplicate athlete names fail closed',()=>{
 for(const modify of [
   s=>{s.conferences={East:[],West:[]};for(const t of s.teams)delete t.conference;},
   s=>{s.teams[0].players[0].name=s.teams[1].players[0].name;},
   s=>{s.onlinePlayerStats={};},
   s=>{s.teams.splice(0,1);}
 ]){const s=fixture();modify(s);assert.throws(()=>prepareAllStarInput(s,'2027-02-21'));}
});
async function mocked(behavior,fn){
 const priorFetch=globalThis.fetch,priorUrl=process.env.SUPABASE_URL,priorKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='fake-secret';
 const commits=[];
 globalThis.fetch=async (url,opts={})=>{
   if(url.includes('/auth/v1/user'))return new Response(JSON.stringify({id:HOST}));
   if(url.includes('/bm_online_lobbies'))return new Response(JSON.stringify([{host_id:behavior.guest?'dddddddd-dddd-4ddd-8ddd-dddddddddddd':HOST,status:'started'}]));
   if(url.includes('/bm_online_lobby_members'))return new Response(JSON.stringify([{user_id:HOST}]));
   if(url.includes('/bm_online_franchise_events'))return new Response(JSON.stringify(behavior.event||[]));
   if(url.includes('/bm_online_franchise_runtime'))return new Response(JSON.stringify([{revision:behavior.revision??9,state:behavior.state??fixture()}]));
   if(url.includes('/rpc/bm_online_select_all_stars_phase2d2e')){
     commits.push(JSON.parse(opts.body));return new Response(JSON.stringify(behavior.sqlResponse||{ok:true,revision:10}));
   }
   throw Error(`Unexpected request: ${url}`);
 };
 try{return await fn(commits);}finally{
   globalThis.fetch=priorFetch;
   if(priorUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=priorUrl;
   if(priorKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=priorKey;
 }
}

test('trusted route authorizes host and commits original Python selections, never browser supplied teams',async()=>{
 await mocked({},async commits=>{
   const res=reply();await selectOnlineAllStarsRequest(req(),res);
   assert.equal(res.statusCode,200,JSON.stringify(res.data));assert.equal(commits.length,1);
   assert.deepEqual(Object.keys(commits[0]).sort(),['p_actor','p_all_stars','p_date','p_expected_revision','p_lobby','p_request'].sort());
   assert.equal(commits[0].p_all_stars.east.starters.length,5);
   assert.equal(commits[0].p_all_stars.west.reserves.length,7);
   assert.equal(res.data.date,'2027-02-21');
   assert.equal(res.headers['Cache-Control'],'no-store');
 });
});

test('guest, stale revision, invalid body, wrong checkpoint never commit selections',async()=>{
 for(const behavior of [{guest:true},{revision:10},{state:fixture()}]){
   if(behavior.state)delete behavior.state.onlineCheckpoints.trade_deadline;
   await mocked(behavior,async commits=>{
     const res=reply();await selectOnlineAllStarsRequest(req(),res);
     assert.ok([403,409].includes(res.statusCode),JSON.stringify(res.data));assert.equal(commits.length,0);
   });
 }
 await mocked({},async commits=>{
   for(const body of [{...req().body,allStars:{fake:true}},{...req().body,actor:HOST},{...req().body,requestId:'bad'},{...req().body,expectedRevision:'9'}]){
     const res=reply();await selectOnlineAllStarsRequest({...req(),body},res);
     assert.equal(res.statusCode,400);
   }
   assert.equal(commits.length,0);
 });
});

test('idempotent replay succeeds after newer revisions, but foreign request ID never passes',async()=>{
 for(const event of [
   {actor_id:HOST,action_type:'all_star_selected',revision:10,details:{date:'2027-02-21'}},
   {actor_id:HOST,action_type:'human_trade_accepted',revision:10,details:{}}
 ]){
   await mocked({revision:25,event:[event]},async commits=>{
     const res=reply();await selectOnlineAllStarsRequest(req(),res);
     assert.equal(res.statusCode,event.action_type==='all_star_selected'?200:409);
     assert.equal(commits.length,0);
   });
 }
});

test('migration creates private locked commit and independent older-simulator checkpoint guard',()=>{
 const sql=readFileSync(new URL('../../supabase/bm_online_all_stars_phase2d2e.sql',import.meta.url),'utf8');
 for(const phrase of ['bm_online_all_star_date_for_state','bm_online_select_all_stars_phase2d2e','for update',
   'host_id','bm_online_lobby_members','all_star_selected','request_id=p_request',
   'onlineAllStars','bm_online_all_star_runtime_guard','Cannot simulate past unresolved All-Star selection',
   'revoke all on function public.bm_online_select_all_stars_phase2d2e','to service_role'])
   assert.ok(sql.includes(phrase),phrase);
 assert.equal(/grant execute on function public\.bm_online_select_all_stars_phase2d2e\([^;]*to authenticated/i.test(sql),false);
});

test('original single-player All-Star Python logic is byte identical in trusted backend',()=>{
 assert.deepEqual(readFileSync(new URL('../../frontend/public/python/all_star_logic.py',import.meta.url)),
   readFileSync(new URL('../online_sim_python/all_star_logic.py',import.meta.url)));
});
