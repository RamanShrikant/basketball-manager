import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateExtensionWindow,validateExtensionDelta,runOriginalExtensions,onlineExtensionsRequest} from '../onlineExtensions.js';
import {firstBlockedOnlineCheckpoint,isOnlineVeteranExtensionClosed,planOnlineSimToDate} from '../../frontend/src/online/onlineSimulationCheckpoints.mjs';
const LOBBY='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HOST='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQ='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NAME='Boston Celtics';
function player(id,team,rookie=false){return {id,name:rookie?'Rookie Star':`${team} Veteran ${id}`,
  age:rookie?23:29,overall:rookie?87:82,potential:rookie?92:82,pos:'SF',
  contract:rookie?{startYear:2023,salaryByYear:[8000000,9000000,10000000,11000000],option:null}:
    {startYear:2024,salaryByYear:[18000000,19000000,20000000],option:null},
  rights:rookie?{rookieScale:true,heldByTeam:team}:{},
  meta:rookie?{draftRound:1,draftYear:2023,proSeasons:3,yearsWithCurrentTeam:3}:
    {proSeasons:8,yearsWithCurrentTeam:2},history:{transactions:[]}};}
function fixture(next='2026-10-10'){
  const names=Array.from({length:30},(_,i)=>i===0?NAME:i===1?'New York Knicks':`CPU Team ${i}`);
  const teams=names.map((name,i)=>({name,players:[player(`${i}-vet`,name),...(i===0?[player('rookie-star',name,true)]:[])]}));
  return {seasonYear:2026,seasonStartYear:2026,displaySeasonYear:2027,contractSeasonYear:2026,
    currentFinancialSeasonYear:2026,salaryCap:154647000,maxSalary:54000000,firstApron:195945000,
    calendar:{regularSeasonGameStart:'2026-10-21',veteranExtensionDeadlineDate:'2027-03-31'},
    teams,onlineSchedule:{phase:'regular-season',seasonYear:2026,byDate:{[next]:[{id:`g-${next}`,date:next,home:NAME,away:'New York Knicks'}]}},
    onlineResults:{},onlineAllStars:next>'2027-02-21'?{season:'2026-2027',cutoff_date:'2027-02-21',east:{starters:[1,2,3,4,5],reserves:[1,2,3,4,5,6,7]},west:{starters:[1,2,3,4,5],reserves:[1,2,3,4,5,6,7]}}:null,onlineCheckpoints:next>'2027-02-21'?{
      trade_deadline:{status:'closed',date:'2027-02-04',seasonYear:2026,revision:4},
      all_star:{status:'selected',date:'2027-02-21',seasonYear:2026,revision:5}}
      :{trade_deadline:{status:'closed',date:'2027-02-04',seasonYear:2026,revision:4}}};
}
function reply(){return {statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;}};}
const req=(mode='offer',rev=8)=>({get:()=>`Bearer ${'x'.repeat(40)}`,body:{lobbyId:LOBBY,expectedRevision:rev,...(mode==='preview'?{}:{requestId:REQ}),
  ...(mode==='offer'?{playerId:'rookie-star',offer:{years:5,firstYearSalary:30000000,annualRaisePct:8,optionType:'none'}}:{})}});

test('extension checkpoint is season/date/revision bound and unlocks exactly once',()=>{
  const s=fixture('2027-04-01');
  assert.equal(firstBlockedOnlineCheckpoint(s,'2027-04-01')?.kind,'extension_deadline');
  assert.deepEqual(evaluateExtensionWindow(s,{closing:true}).date,'2027-03-31');
  s.onlineCheckpoints.veteran_extension={status:'closed',date:'2027-03-31',seasonYear:2026,revision:9};
  s.contractExtensionState={closedTypes:['veteran']};
  assert.equal(isOnlineVeteranExtensionClosed(s,'2027-03-31'),true);
  assert.equal(firstBlockedOnlineCheckpoint(s,'2027-04-01'),null);
  assert.deepEqual(planOnlineSimToDate(s,'2027-04-01').days,['2027-04-01']);
  s.onlineCheckpoints.veteran_extension.seasonYear=2027;
  assert.equal(isOnlineVeteranExtensionClosed(s,'2027-03-31'),false);
  assert.equal(firstBlockedOnlineCheckpoint(s,'2027-04-01')?.kind,'extension_deadline');
});
test('invalid date, partial days, skipped checkpoints, late close and prior close fail closed',()=>{
  const s=fixture('2027-03-30');
  assert.throws(()=>evaluateExtensionWindow(s,{closing:true}),/Finish all games/);
  const late=fixture('2027-04-01');delete late.onlineCheckpoints.trade_deadline;
  assert.throws(()=>evaluateExtensionWindow(late,{closing:true}),/earlier/i);
  const partial=fixture('2027-04-01');partial.onlineSchedule.byDate['2027-04-01'].push({id:'b',date:'2027-04-01',home:'CPU Team 2',away:'CPU Team 3'});
  partial.onlineResults['g-2027-04-01']={id:'g-2027-04-01',date:'2027-04-01',homeScore:100,awayScore:99};
  assert.throws(()=>evaluateExtensionWindow(partial,{closing:true}),/Partial/);
  const closed=fixture('2027-04-01');closed.contractExtensionState={closedTypes:['veteran']};
  assert.throws(()=>evaluateExtensionWindow(closed),/closed/);
});
test('runs unchanged single-player Python for eligibility, player ask and offers without mutating input',async()=>{
  const s=fixture();const original=structuredClone(s);
  const preview=await runOriginalExtensions({action:'preview',leagueData:s,teamName:NAME,currentDate:'2026-10-10'});
  assert.equal(preview.ok,true,JSON.stringify(preview));
  assert.equal(preview.summary.eligibleCount,2);
  const rookie=preview.players.find(p=>p.playerId==='rookie-star');
  assert.equal(rookie.eligible,true);
  assert.ok(rookie.askPackages.length>=1);
  const offer=await runOriginalExtensions({action:'offer',leagueData:s,teamName:NAME,currentDate:'2026-10-10',playerId:'rookie-star',
    offer:{askPackageId:rookie.askPackages[0].askPackageId}});
  assert.equal(offer.ok,true,JSON.stringify(offer));
  assert.equal(offer.accepted,true);
  assert.equal(validateExtensionDelta(s,offer.leagueData,{mode:'offer',teamName:NAME,playerId:'rookie-star'}).changed,1);
  assert.ok(offer.leagueData.teams[0].players[1].contract.salaryByYear.length>4);
  assert.deepEqual(s,original,'Original authoritative input must remain immutable');
});
test('CPU deadline processes original Python engine but never touches controlled human teams',async()=>{
  const s=fixture('2027-04-01');const original=structuredClone(s);
  const result=await runOriginalExtensions({action:'close',leagueData:s,currentDate:'2027-03-31',humanTeams:[NAME,'CPU Team 2']});
  assert.equal(result.ok,true,JSON.stringify(result).slice(0,700));
  assert.equal(result.leagueData.contractExtensionState.closedTypes.includes('veteran'),true);
  assert.deepEqual(result.leagueData.teams[0].players,original.teams[0].players);
  assert.deepEqual(result.leagueData.teams[2].players,original.teams[2].players);
  assert.equal(validateExtensionDelta(s,result.leagueData,{mode:'close',humanTeams:[NAME,'CPU Team 2']}).changed>=0,true);
  assert.deepEqual(s,original);
});
test('rejects unauthorized roster, salary prefix, ratings, transfers and human CPU mutations',()=>{
  const s=fixture();
  for(const edit of [
    t=>{t.onlineResults={unrelated:{score:200}};},
    t=>{t.teams[1].players[0].contract.salaryByYear.push(20000000);},
    t=>{t.teams[0].players[1].overall=100;},
    t=>{t.teams[0].players[1].contract.salaryByYear[0]=1;},
    t=>{t.teams[0].players.splice(0,1);}
  ]){
    const t=structuredClone(s);edit(t);
    assert.throws(()=>validateExtensionDelta(s,t,{mode:'offer',teamName:NAME,playerId:'rookie-star'}));
  }
  const close=structuredClone(s);close.teams[0].players[0].contract.salaryByYear.push(21000000);
  close.contractExtensionState={closedTypes:['veteran']};
  assert.throws(()=>validateExtensionDelta(s,close,{mode:'close',humanTeams:[NAME]}),/human/);
});

async function mocked(behavior,cb){
  const prevFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-role';
  const commits=[];
  globalThis.fetch=async(url,opts={})=>{
    if(url.includes('/auth/v1/user'))return new Response(JSON.stringify({id:HOST}));
    if(url.includes('/bm_online_lobbies'))return new Response(JSON.stringify([{host_id:behavior.guest?'dddddddd-dddd-4ddd-8ddd-dddddddddddd':HOST,status:'started'}]));
    if(url.includes('/bm_online_lobby_members')){
      if(url.includes('user_id=eq.'))return new Response(JSON.stringify([{user_id:HOST,team_name:NAME}]));
      return new Response(JSON.stringify([{team_name:NAME},{team_name:'CPU Team 2'}]));
    }
    if(url.includes('/bm_online_franchise_events'))return new Response(JSON.stringify(behavior.event||[]));
    if(url.includes('/bm_online_franchise_runtime'))return new Response(JSON.stringify([{revision:behavior.revision??8,state:behavior.state??fixture(behavior.close?'2027-04-01':'2026-10-10')} ]));
    if(url.includes('/rpc/bm_online_commit_extension_phase2d2f')){
      commits.push(JSON.parse(opts.body));return new Response(JSON.stringify(behavior.sqlResponse||{ok:true,revision:9}));
    }
    throw Error(`Unexpected fetch: ${url}`);
  };
  try{await cb(commits);}finally{
    globalThis.fetch=prevFetch;
    if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
    if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
  }
}
test('trusted offer endpoint authorizes GM, uses original Python and commits only locked result',async()=>{
  let offer;
  await mocked({},async commits=>{
    const preview=reply();await onlineExtensionsRequest(req('preview'),preview,'preview');
    assert.equal(preview.statusCode,200,JSON.stringify(preview.body));
    offer={askPackageId:preview.body.players.find(p=>p.playerId==='rookie-star').askPackages[0].askPackageId};
    const r=req();r.body.offer=offer;
    const result=reply();await onlineExtensionsRequest(r,result,'offer');
    assert.equal(result.statusCode,200,JSON.stringify(result.body));
    assert.equal(result.body.accepted,true);
    assert.equal(commits.length,1);
    assert.deepEqual(Object.keys(commits[0]).sort(),['p_lobby','p_actor','p_request','p_expected_revision','p_action','p_date','p_player_id','p_offer','p_updated_state'].sort());
    assert.equal(commits[0].p_updated_state.teams[0].players[1].contract.salaryByYear.length>4,true);
  });
});
test('only host can close CPU window and no CPU changes to human rosters',async()=>{
  await mocked({close:true},async commits=>{
    const res=reply();await onlineExtensionsRequest(req('close'),res,'close');
    assert.equal(res.statusCode,200,JSON.stringify(res.body));
    assert.equal(commits.length,1);
    assert.equal(commits[0].p_action,'close');
    assert.deepEqual(commits[0].p_updated_state.teams[0].players,fixture('2027-04-01').teams[0].players);
  });
  await mocked({guest:true,close:true},async commits=>{
    const res=reply();await onlineExtensionsRequest(req('close'),res,'close');
    assert.equal(res.statusCode,403);assert.equal(commits.length,0);
  });
});
test('stale revisions, invented rosters, ambiguous IDs, invalid requests and failed SQL never commit',async()=>{
  await mocked({revision:9},async commits=>{
    const res=reply();await onlineExtensionsRequest(req('preview'),res,'preview');
    assert.equal(res.statusCode,409);assert.equal(commits.length,0);
  });
  await mocked({},async commits=>{
    for(const changes of [{actor:HOST},{playerId:'other-team-player'}, {offer:{askPackageId:'<script>'}},{requestId:'bad'}]){
      const res=reply();await onlineExtensionsRequest({...req(),body:{...req().body,...changes}},res,'offer');
      assert.ok([400,409].includes(res.statusCode));
    }
    assert.equal(commits.length,0);
  });
  await mocked({event:[{actor_id:HOST,action_type:'contract_extension_offered',revision:9,
    details:{player_id:'rookie-star',offer:req().body.offer,date:'2026-10-10'}}],revision:20},async commits=>{
    const res=reply();await onlineExtensionsRequest(req(),res,'offer');
    assert.equal(res.statusCode,200);assert.equal(res.body.replayed,true);assert.equal(commits.length,0);
  });
});
test('SQL is private and independently blocks legacy simulation after unresolved extension deadline',()=>{
  const sql=readFileSync(new URL('../../supabase/bm_online_veteran_extensions_phase2d2f.sql',import.meta.url),'utf8');
  for(const phrase of ['bm_online_commit_extension_phase2d2f','for update',
    'veteran_extensions_closed','contract_extension_offered','bm_online_lobby_members',
    'v_allowed_player_keys','veteran_extension','onlineResults','v_results_new','revoke all on function public.bm_online_commit_extension_phase2d2f','to service_role'])
    assert.ok(sql.includes(phrase),phrase);
  assert.equal(/grant execute on function public\.bm_online_commit_extension_phase2d2f\([^;]*to authenticated/i.test(sql),false);
});
test('all copied Python extension sources are exactly unchanged from finished single-player',()=>{
  for(const file of ['contract_extension_logic.py','contract_extension_acceptance.py','cpu_contract_extensions.py','league_financials.py','free_agency_logic.py','player_mood_logic.py','deflated_trade_scale.py'])
    assert.deepEqual(readFileSync(new URL(`../../frontend/public/python/${file}`,import.meta.url)),readFileSync(new URL(`../online_extension_python/${file}`,import.meta.url)));
});
