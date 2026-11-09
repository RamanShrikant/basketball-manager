import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {cpuTradeFinderRequest,cpuFinderTestHelpers} from '../onlineCpuTrades.js';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const userId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const lobbyId='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const ply=(id,ovr,salary=10000000)=>({id,name:`Player ${id}`,overall:ovr,potential:ovr,age:27,
  contract:{startYear:2026,salaryByYear:[salary]}});
const state={seasonYear:2026,teams:[
 {name:'Boston Celtics',players:[ply('a1',99),ply('a2',78),ply('a3',80)]},
 {name:'Miami Heat',players:[ply('b1',84),ply('b2',72)]},
 {name:'Chicago Bulls',players:[ply('c1',87),ply('c2',80),ply('c3',75)]},
 {name:'LA Lakers',players:[ply('d1',95),ply('d2',78),ply('d3',80)]}
]};
const oldFetch=global.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-private-key';
const body=(ids=['a1'],rev=1,targetTeam='')=>({lobbyId,expectedRevision:rev,sendingIds:ids,targetTeam});
function mock({revision=1,members=[{user_id:userId,team_name:'Boston Celtics'}],league=state}={}){
  const visited=[];
  global.fetch=async (url,opts={})=>{
    const path=new URL(url).pathname;visited.push(path);
    let data;
    if(path==='/auth/v1/user')data={id:userId};
    else if(path.endsWith('/bm_online_lobbies'))data=[{status:'started'}];
    else if(path.endsWith('/bm_online_lobby_members'))data=members;
    else if(path.endsWith('/bm_online_franchise_runtime'))data=[{revision,state:league}];
    else throw Error('unexpected request '+path);
    return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
  };return visited;
}
async function submit(payload=body(),token='valid.jwt.bearer_token_1234567890'){
  let status=200,value;
  const req={body:payload,get:()=>token?`Bearer ${token}`:''};
  const res={set(){return this;},status(code){status=code;return this;},json(data){value=data;return this;}};
  await cpuTradeFinderRequest(req,res);return {status,value};
}
after(()=>{global.fetch=oldFetch;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
  if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;});
test('request validation rejects duplicate IDs and arbitrary teams',()=>{
  assert.throws(()=>cpuFinderTestHelpers.parseFinderBody(body(['a1','a1'])),/unique/);
  assert.throws(()=>cpuFinderTestHelpers.parseFinderBody(body(['bad id'])),/unique/);
  assert.throws(()=>cpuFinderTestHelpers.parseFinderBody(body(['a1'],0)),/Invalid/);
  assert.throws(()=>cpuFinderTestHelpers.parseFinderBody({...body(),targetTeam:'x'.repeat(91)}),/Invalid/);
});
test('finder excludes ineligible roster assets and duplicate player identity',()=>{
  const team={name:'T',players:[ply('a',80),{...ply('b',90),isTwoWay:true},ply('a',80),ply('d',85,0)]};
  assert.deepEqual(cpuFinderTestHelpers.finderRoster(team,2026).players.map(p=>p.id),[]);
});
test('finder response never exposes raw player objects or CPU model proposals',()=>{
  const raw={offers:[{teamName:'Miami Heat',decision:'accept',accepted:true,score:12,
    offer:[{type:'player',player:{...ply('b1',91),secret:'hidden'}}]}]};
  const teams=new Map([['Miami Heat',state.teams[1]]]);
  const list=cpuFinderTestHelpers.mapFinderOffers(raw,['a1'],teams,2026);
  assert.equal(list.length,1);assert.deepEqual(list[0].receivingIds,['b1']);
  assert.equal(JSON.stringify(list).includes('secret'),false);
});
test('finds against authoritative league without a mutation RPC',async()=>{
  const fixture={...state,teams:[{...state.teams[0],players:[state.teams[0].players[0]]},...state.teams.slice(1)]};
  const visited=mock({league:fixture});const result=await submit();
  assert.equal(result.status,200,JSON.stringify(result));
  assert.equal(result.value.ok,true);assert.equal(result.value.teamsChecked,3);
  assert.ok(Array.isArray(result.value.offers));
  assert.ok(result.value.offers.length>0,'Real Python Finder should produce an accepted offer in this known fixture');
  assert.ok(!visited.some(p=>p.includes('/rpc/')));
  assert.ok(result.value.offers.every(o=>o.teamName!=='Boston Celtics'));
});
test('never evaluates human-owned target as a CPU team',async()=>{
  mock({members:[{user_id:userId,team_name:'Boston Celtics'},{user_id:'other',team_name:'Miami Heat'}]});
  const result=await submit(body(['a1'],1,'Miami Heat'));
  assert.equal(result.status,403);
});
test('requires login, started membership, valid revision and authorized roster asset',async()=>{
  mock();assert.equal((await submit(body(), '')).status,401);
  mock();assert.equal((await submit(body(['a1'],2))).status,409);
  mock();assert.equal((await submit(body(['b1']))).status,409);
  mock({members:[]});assert.equal((await submit()).status,403);
});
test('single-player Python trade model remains byte identical',()=>{
  for(const name of ['trade_negotiation_logic.py','trade_team_ai.py','trade_value_model.py']){
    const original=readFileSync(new URL(`../../frontend/public/python/${name}`,import.meta.url));
    const copy=readFileSync(new URL(`../cpu_trade_python/${name}`,import.meta.url));
    assert.equal(createHash('sha256').update(original).digest('hex'),createHash('sha256').update(copy).digest('hex'));
  }
});
