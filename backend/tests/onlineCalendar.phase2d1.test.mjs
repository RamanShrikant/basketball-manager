import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compactSchedule,initializeOnlineCalendarRequest} from '../onlineCalendar.js';
import {generateFullSeasonSchedule} from '../onlineSeasonSchedule.js';
const names=['Boston Celtics','Brooklyn Nets','New York Knicks','Philadelphia 76ers','Toronto Raptors','Chicago Bulls','Cleveland Cavaliers','Detroit Pistons','Indiana Pacers','Milwaukee Bucks','Atlanta Hawks','Charlotte Hornets','Miami Heat','Orlando Magic','Washington Wizards','Denver Nuggets','Minnesota Timberwolves','Oklahoma City Thunder','Portland Trail Blazers','Utah Jazz','Golden State Warriors','Los Angeles Clippers','Los Angeles Lakers','Phoenix Suns','Sacramento Kings','Dallas Mavericks','Houston Rockets','Memphis Grizzlies','New Orleans Pelicans','San Antonio Spurs'];
const teams=names.map(name=>({name}));
const uuid1='11111111-1111-4111-8111-111111111111';
const uuid2='22222222-2222-4222-8222-222222222222';
const uuid3='33333333-3333-4333-8333-333333333333';
const contextFile=new URL('../../frontend/src/pages/Calendar.jsx',import.meta.url);
const source=fs.readFileSync(contextFile,'utf8').replace(/^\uFEFF/,'');
const copy=fs.readFileSync(new URL('../onlineSeasonSchedule.js',import.meta.url),'utf8');
test('calendar algorithm extracted verbatim from single-player source',()=>{
  const lines=source.split('\n').map(x=>x.replace(/\r$/,''));const copied=lines.slice(1267,1806).join('\n');
  assert.ok(copy.includes(copied.trimEnd()));
});
test('same NBA 82-game schedule: 1230 games, unique IDs, 30 teams, no double-bookings',()=>{
  const built=compactSchedule({teams,seasonStartYear:2026});
  const seen=new Set(),each=new Map(names.map(n=>[n,0]));let total=0;
  for(const [date,rows] of Object.entries(built.byDate)){
    const busy=new Set();
    for(const row of rows){
      assert.equal(row.date,date);assert.ok(!seen.has(row.id));seen.add(row.id);
      for(const t of [row.home,row.away]){assert.ok(each.has(t));assert.ok(!busy.has(t));busy.add(t);each.set(t,each.get(t)+1);}
      total++;
    }
  }
  assert.equal(total,1230);assert.equal(seen.size,1230);
  assert.ok([...each.values()].every(x=>x===82));
  const again=compactSchedule({teams,seasonStartYear:2026});assert.deepEqual(again.byDate,built.byDate);
});
test('fail closed with invalid roster and unsupported season',()=>{
  assert.throws(()=>compactSchedule({teams:teams.slice(1),seasonStartYear:2026}),/30-team/);
  assert.throws(()=>compactSchedule({teams:teams.slice(0,29).concat(teams[0]),seasonStartYear:2026}),/30-team/);
  assert.throws(()=>compactSchedule({teams,seasonStartYear:2100}),/Unsupported/);
});
test('host-only service: denies guests before generating or updating',async()=>{
  const oldFetch=globalThis.fetch;
  process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test_key';
  let calledRpc=false;
  globalThis.fetch=async(url)=>{
    if(url.includes('/auth/v1/user'))return new Response(JSON.stringify({id:uuid2}),{status:200});
    if(url.includes('/bm_online_lobbies'))return new Response(JSON.stringify([{id:uuid1,host_id:uuid3,status:'started'}]),{status:200});
    if(url.includes('/rpc/'))calledRpc=true;
    throw Error('Guest access reached an unsafe boundary');
  };
  let response={code:200,status(n){this.code=n;return this},set(){return this},json(value){this.data=value;return this}};
  try{await initializeOnlineCalendarRequest({body:{lobbyId:uuid1,requestId:uuid3,expectedRevision:1},get:()=>`Bearer ${'x'.repeat(30)}`},response);
    assert.equal(response.code,403);assert.equal(calledRpc,false);
  }finally{globalThis.fetch=oldFetch;}
});
test('stale requests and existing schedule cannot overwrite an online universe',async()=>{
  const oldFetch=globalThis.fetch;
  process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test_key';
  let state={teams,seasonStartYear:2026};let revision=3,calledRpc=false;
  globalThis.fetch=async(url)=>{
    if(url.includes('/auth/v1/user'))return new Response(JSON.stringify({id:uuid2}),{status:200});
    if(url.includes('/bm_online_lobbies'))return new Response(JSON.stringify([{id:uuid1,host_id:uuid2,status:'started'}]),{status:200});
    if(url.includes('/bm_online_franchise_runtime'))return new Response(JSON.stringify([{revision,state}]),{status:200});
    if(url.includes('/rpc/'))calledRpc=true;
    throw Error('Unexpected endpoint '+url);
  };
  const request={body:{lobbyId:uuid1,requestId:uuid3,expectedRevision:2},get:()=>`Bearer ${'x'.repeat(30)}`};
  const reply=()=>({code:200,status(n){this.code=n;return this},set(){return this},json(v){this.data=v;return this}});
  try{
    let r=reply();await initializeOnlineCalendarRequest(request,r);assert.equal(r.code,409);assert.equal(calledRpc,false);
    state={...state,onlineSchedule:{byDate:{}}};revision=2;r=reply();await initializeOnlineCalendarRequest(request,r);assert.equal(r.code,409);assert.equal(calledRpc,false);
  }finally{globalThis.fetch=oldFetch;}
});
test('SQL locks league state and only trusts service role; no single-player changes',()=>{
 const sql=fs.readFileSync(new URL('../../supabase/bm_online_calendar_phase2d1.sql',import.meta.url),'utf8');
 for(const pattern of ['for update','v_rev<>p_expected_revision','v_host is distinct from p_actor','count(*)<>82','grant execute','service_role','bm_online_franchise_events','onlineSchedule'])assert.ok(sql.toLowerCase().includes(pattern.toLowerCase()),pattern);
 assert.ok(!/grant execute[^;]+to authenticated/i.test(sql));
});
test('trusted host flow sends only server-generated, immutable 1,230-game schedule to private RPC',async()=>{
 const oldFetch=globalThis.fetch;
 process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test_key';
 const host='44444444-4444-4444-8444-444444444444';let committed=null;
 globalThis.fetch=async(url,options={})=>{
  if(url.includes('/auth/v1/user'))return new Response(JSON.stringify({id:host}),{status:200});
  if(url.includes('/bm_online_lobbies'))return new Response(JSON.stringify([{id:uuid1,host_id:host,status:'started'}]),{status:200});
  if(url.includes('/bm_online_franchise_runtime'))return new Response(JSON.stringify([{revision:7,state:{teams,seasonStartYear:2026}}]),{status:200});
  if(url.includes('/rpc/bm_online_initialize_calendar_phase2d1')){
   committed=JSON.parse(options.body);
   return new Response(JSON.stringify({ok:true,revision:8}),{status:200});
  }
  throw Error(`Unexpected fetch ${url}`);
 };
 const req={body:{lobbyId:uuid1,requestId:uuid3,expectedRevision:7},get:()=>`Bearer ${'y'.repeat(30)}`};
 const response={code:200,status(n){this.code=n;return this},set(){return this},json(value){this.data=value;return this}};
 try{
  await initializeOnlineCalendarRequest(req,response);
  assert.equal(response.code,200);assert.equal(response.data.ok,true);
  assert.equal(response.data.gameCount,1230);
  assert.equal(committed.p_actor,host);
  assert.equal(committed.p_expected_revision,7);
  assert.equal(committed.p_season_year,2026);
  const rows=Object.values(committed.p_by_date).flat();assert.equal(rows.length,1230);
  assert.ok(rows.every(g=>Object.keys(g).sort().join(',')==='away,date,home,id'));
 }finally{globalThis.fetch=oldFetch;}
});
