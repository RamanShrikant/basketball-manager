import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {cpuTradeRequest,cpuTradeTestHelpers} from '../onlineCpuTrades.js';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const userId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const lobbyId='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const requestId='cccccccc-cccc-4ccc-cccc-cccccccccccc';
const from='Boston Celtics',to='Miami Heat';
const pickPlayer=(id,overall)=>({id,name:`Player ${id}`,overall,potential:overall,age:27,
  contract:{startYear:2026,salaryByYear:[10000000]}});
const source={name:from,players:[pickPlayer('a1',96),pickPlayer('a2',75),pickPlayer('a3',80)]};
const cpu={name:to,players:[pickPlayer('b1',65),pickPlayer('b2',98),pickPlayer('b3',81)]};
const state={teams:[source,cpu],seasonYear:2026};
const originalFetch=global.fetch;
const originalEnv={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY};
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-server-secret-do-not-use';
const request=(ids=['a1','b1'],revision=1,reqId=requestId)=>({
  lobbyId,requestId:reqId,expectedRevision:revision,targetTeam:to,sendingIds:[ids[0]],receivingIds:[ids[1]]
});
function installMock({stateRevision=1,people=[{user_id:userId,team_name:from}],history=[],commit=true}={}){
  let commits=0; const requests=[];
  global.fetch=async (url,opts={})=>{
    const path=new URL(url).pathname;
    requests.push({path,opts});
    let status=200,payload;
    if(path==='/auth/v1/user')payload={id:userId};
    else if(path.endsWith('/bm_online_lobbies'))payload=[{status:'started'}];
    else if(path.endsWith('/bm_online_lobby_members'))payload=people;
    else if(path.endsWith('/bm_online_franchise_events'))payload=history;
    else if(path.endsWith('/bm_online_franchise_runtime'))payload=[{revision:stateRevision,state}];
    else if(path.endsWith('/rpc/bm_online_commit_cpu_player_trade')){
      commits++;
      payload=commit?{ok:true,revision:stateRevision+1,replayed:false}:{message:'League revision changed'};
      if(!commit)status=400;
    }else{throw Error('Unexpected mock route '+path);}
    return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}});
  };
  return {get commits(){return commits},requests};
}
async function submit(body=request(),token='valid.jwt.bearer_token_1234567890'){
  let status=200,value;
  const req={body,get:()=>`Bearer ${token}`};
  const res={set(){return this;},status(n){status=n;return this;},json(v){value=v;return this;}};
  await cpuTradeRequest(req,res);
  return {status,value};
}
after(()=>{global.fetch=originalFetch;for(const [k,v] of Object.entries(originalEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
test('input rejects invalid identifiers, duplicate IDs, invalid revision',()=>{
  assert.throws(()=>cpuTradeTestHelpers.parseBody({...request(),sendingIds:['a1','a1']}),/unique/);
  assert.throws(()=>cpuTradeTestHelpers.parseBody({...request(),receivingIds:['a1']}),/both sides/);
  assert.throws(()=>cpuTradeTestHelpers.parseBody({...request(),expectedRevision:0}),/revision/);
  assert.throws(()=>cpuTradeTestHelpers.parseBody({...request(),targetTeam:'x'.repeat(91)}),/CPU team/);
});
test('CPU evaluator original sources were copied byte-for-byte',()=>{
  const modules=['trade_team_ai.py','trade_negotiation_logic.py','trade_value_model.py'];
  for(const m of modules){
    const original=readFileSync(new URL(`../../frontend/public/python/${m}`,import.meta.url));
    const copy=readFileSync(new URL(`../cpu_trade_python/${m}`,import.meta.url));
    assert.equal(createHash('sha256').update(copy).digest('hex'),createHash('sha256').update(original).digest('hex'));
  }
});
test('server verifies human and CPU teams, then accepts only after real Python evaluation',async()=>{
  const mock=installMock();
  const r=await submit();
  assert.equal(r.status,200,JSON.stringify(r));
  assert.equal(r.value.committed,true);
  assert.equal(r.value.decision,'accept');
  assert.equal(mock.commits,1);
  assert.ok(mock.requests.find(x=>x.path.includes('rpc/bm_online_commit_cpu_player_trade')));
});
test('CPU rejects weak offers without calling commit RPC',async()=>{
  const mock=installMock();
  const r=await submit(request(['a2','b2'],1,'dddddddd-dddd-4ddd-dddd-dddddddddddd'));
  assert.equal(r.status,200,JSON.stringify(r));
  assert.equal(r.value.committed,false);
  assert.equal(r.value.decision,'reject');
  assert.equal(mock.commits,0);
});
test('CPU counters marginal offers without moving assets',async()=>{
  const mock=installMock();
  const r=await submit(request(['a3','b3'],1,'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee'));
  assert.equal(r.status,200,JSON.stringify(r));
  assert.equal(r.value.committed,false);
  assert.equal(r.value.decision,'counter');
  assert.equal(mock.commits,0);
});
test('stale league revision fails before CPU evaluation or commit',async()=>{
  const mock=installMock({stateRevision:2});
  const r=await submit(request(['a1','b1'],1,'ffffffff-ffff-4fff-ffff-ffffffffffff'));
  assert.equal(r.status,409);assert.equal(mock.commits,0);
});
test('human-controlled CPU partner fails closed',async()=>{
  const mock=installMock({people:[{user_id:userId,team_name:from},{user_id:'z',team_name:to}]});
  const r=await submit(request(['a1','b1'],1,'11111111-1111-4111-8111-111111111111'));
  assert.equal(r.status,403);assert.equal(mock.commits,0);
});
test('exact accepted request replays without re-evaluation',async()=>{
  const mock=installMock({stateRevision:3,history:[{actor_id:userId,action_type:'cpu_trade_accepted',revision:3,
    details:{from_team:from,to_team:to,sending:['a1'],receiving:['b1']}}]});
  const r=await submit(request(['a1','b1'],1,'22222222-2222-4222-8222-222222222222'));
  assert.equal(r.status,200);assert.equal(r.value.replayed,true);assert.equal(mock.commits,0);
});
test('same request ID cannot be replayed for different assets',async()=>{
  const mock=installMock({history:[{actor_id:userId,action_type:'cpu_trade_accepted',revision:2,
    details:{from_team:from,to_team:to,sending:['a2'],receiving:['b2']}}]});
  const r=await submit(request(['a1','b1'],1,'33333333-3333-4333-8333-333333333333'));
  assert.equal(r.status,409);assert.equal(mock.commits,0);
});
test('SQL rejection remains authoritative after CPU accepted',async()=>{
  const mock=installMock({commit:false});
  const r=await submit(request(['a1','b1'],1,'44444444-4444-4444-8444-444444444444'));
  assert.equal(r.status,409);assert.equal(mock.commits,1);assert.equal(r.value.ok,false);
});
test('backend rejects a missing bearer token',async()=>{
  installMock();const r=await submit(request(), '');assert.equal(r.status,401);
});
