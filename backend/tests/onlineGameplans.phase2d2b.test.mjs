import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateOnlineManualGameplan,makeOnlineManualGameplan,selectOnlineGameplan} from '../onlineGameplanCore.js';
import {buildOnlineGameBatch} from '../onlineSimulationCore.js';

const makeTeam=n=>({name:`Fixture ${n}`,players:Array.from({length:12},(_,j)=>({name:`P${n}-${j}`,id:`${n}-${j}`,overall:90-j,age:26,pos:['PG','SG','SF','PF','C'][j%5],offRating:85,defRating:86,potential:90,attrs:Array(22).fill(75)}))});
const teams=Array.from({length:30},(_,i)=>makeTeam(i));
const state=()=>({teams:structuredClone(teams),onlineSchedule:{phase:'regular-season',byDate:{'2026-10-21':[{id:'g1',date:'2026-10-21',home:'Fixture 0',away:'Fixture 1'}]}}});
function plan(team){
  const order=team.players.map(p=>p.name);
  const minutes=Object.fromEntries(order.map((name,i)=>[name,i<5?38:i<10?10:0]));
  return makeOnlineManualGameplan(team,order,minutes);
}

test('GM can save an exact legal 240-minute manual lineup, original single-player metadata retained',()=>{
 const team=makeTeam(0),p=plan(team);
 assert.deepEqual(validateOnlineManualGameplan(team,p,'2026-10-21'),{valid:true,reason:null});
 assert.equal(p.version,20);assert.equal(p.manualLocked,true);assert.equal(p.source,'coach_gameplan');
 assert.equal(Object.values(p.minutes).reduce((a,b)=>a+b,0),240);
});
test('manual rotation actually feeds the original sim, without changing input state',()=>{
 const s=state(),p=plan(s.teams[0]);s.onlineGameplans={'Fixture 0':p};
 const old=structuredClone(s),batch=buildOnlineGameBatch(s);
 assert.deepEqual(s,old);
 assert.deepEqual(batch.inputs[0].home.minutes,p.minutes);
 assert.equal(batch.inputs[0].away.minutes['P1-0']>0,true);
});
test('cross-team gameplans never affect the unrelated GM',()=>{
 const s=state(),p=plan(s.teams[2]);s.onlineGameplans={'Fixture 2':p};
 const b=buildOnlineGameBatch(s);
 assert.equal(b.inputs[0].home.minutes['P0-0']>=0,true);
 assert.notEqual(b.inputs[0].home.name,'Fixture 2');
});
test('roster signings, releases, trades, and duplicate names invalidate manual plans safely',()=>{
 const s=state();s.onlineGameplans={'Fixture 0':plan(s.teams[0])};
 s.teams[0].players[0].name='New Signing';
 assert.equal(validateOnlineManualGameplan(s.teams[0],s.onlineGameplans['Fixture 0']).valid,false);
 assert.equal(selectOnlineGameplan(s,s.teams[0],'2026-10-21').source,'auto');
 s.teams[0].players[1].name=s.teams[0].players[2].name;
 assert.equal(validateOnlineManualGameplan(s.teams[0],s.onlineGameplans['Fixture 0']).valid,false);
});
test('same-name replacement with a different stable player ID never inherits old manual minutes',()=>{
 const s=state();s.onlineGameplans={'Fixture 0':plan(s.teams[0])};
 s.teams[0].players[0].id='new-player-id';
 assert.equal(validateOnlineManualGameplan(s.teams[0],s.onlineGameplans['Fixture 0']).valid,false);
 assert.equal(selectOnlineGameplan(s,s.teams[0],'2026-10-21').source,'auto');
});
test('injury disables manual lineup for that date, recovery restores it without overwriting the saved plan',()=>{
 const s=state();s.onlineGameplans={'Fixture 0':plan(s.teams[0])};
 s.teams[0].players[0].injury={active:true,returnDate:'2026-11-05'};
 const original=structuredClone(s.onlineGameplans['Fixture 0']);
 const auto=selectOnlineGameplan(s,s.teams[0],'2026-10-21');
 assert.equal(auto.source,'auto');assert.equal(auto.minutes['P0-0'],0);
 assert.equal(Object.values(auto.minutes).reduce((a,b)=>a+b,0),240);
 assert.equal(selectOnlineGameplan(s,s.teams[0],'2026-11-05').source,'manual');
 assert.deepEqual(s.onlineGameplans['Fixture 0'],original);
});
test('malformed manual minutes cannot influence simulated minutes',()=>{
 const s=state(),p=plan(s.teams[0]);s.onlineGameplans={'Fixture 0':p};
 for(const bad of [47.5,-1,90,'48',null]){
   p.minutes['P0-0']=bad;
   assert.equal(selectOnlineGameplan(s,s.teams[0],'2026-10-21').source,'auto');
 }
 p.minutes['P0-0']=38;p.order[0]=p.order[1];
 assert.equal(selectOnlineGameplan(s,s.teams[0],'2026-10-21').source,'auto');
});
test('no manual plan uses original single-player smart rotation',()=>{
 const s=state();const selection=selectOnlineGameplan(s,s.teams[0],'2026-10-21');
 assert.equal(selection.source,'auto');assert.equal(Object.values(selection.minutes).reduce((a,b)=>a+b,0),240);
});
test('SQL grants only authenticated users, locks shared revision and checks roster ownership, minutes, injuries, idempotency',()=>{
 const sql=readFileSync(new URL('../../supabase/bm_online_coach_gameplans_phase2d2b.sql',import.meta.url),'utf8');
 for(const item of ['auth.uid()','for update','v_revision<>p_expected_revision','m.user_id=v_actor','v_total<>240','v_idx<=5','injury','request_id=p_request','onlineGameplans','bm_online_franchise_events','to authenticated'])
  assert.ok(sql.includes(item),`missing ${item}`);
 assert.ok(sql.includes('from public,anon'));
 assert.ok(!sql.includes('to service_role;'));
});
test('online gameplan frontend does not write single-player localStorage or mount GameContext',()=>{
 const jsx=readFileSync(new URL('../../frontend/src/online/OnlineCoachGameplanPreview.jsx',import.meta.url),'utf8');
 assert.ok(jsx.includes('saveOnlineCoachGameplan'));
 assert.ok(jsx.includes('Only its manager may edit'));
 assert.ok(!jsx.includes('localStorage.setItem('));
 assert.ok(!jsx.includes('from "../context/GameContext"'));
});
