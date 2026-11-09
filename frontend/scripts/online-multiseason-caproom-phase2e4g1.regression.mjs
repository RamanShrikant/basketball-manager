// Phase 2E.4-G1: offline-only safeguards. No backend, browser or database started.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {onlineCapRoomSeasonReady} from '../src/online/onlineCapRoomSeasonGate.mjs';
import {getLeagueFinancialRules} from '../src/utils/leagueFinancials.js';
import {getPlayerMinimumSalary,getPlayerMaximumSalary} from '../src/utils/freeAgencyContractRules.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const sql=fs.readFileSync(path.join(root,'supabase/bm_online_multiseason_caproom_phase2e4g1.sql'),'utf8');
const ui=fs.readFileSync(path.join(root,'frontend/src/online/OnlineFreeAgencyPreview.jsx'),'utf8');
let passed=0;
function test(label,cb){cb();passed++;console.log(`PASS ${label}`);}
const state=(year=2028)=>({
  seasonYear:year,seasonStartYear:year,currentFinancialSeasonYear:year+1,
  onlineSeasonHistory:[{seasonYear:2026,champion:'X'},{seasonYear:2027,champion:'Y'}],
  onlineSchedule:{seasonYear:year,phase:'regular-season',cursor:`${year}-11-12`},
  onlineSeasonRollover:{status:'complete',fromYear:year-1,toYear:year},
  financials:{baseSeasonYear:2027,currentFinancialSeasonYear:year+1,
    annualInflationRate:0.065,baseRules:{salaryCap:164961000,firstApron:209015000,secondApron:221686000,hardCap:221686000}}
});

test('2026 opening season maintains legacy preview eligibility',()=>{
  assert.equal(onlineCapRoomSeasonReady({seasonYear:2026}),true);
});
test('2027-28 remains eligible after the first verified rollover',()=>{
  const s=state(2027);s.onlineSeasonHistory=[{seasonYear:2026}];
  assert.equal(onlineCapRoomSeasonReady(s),true);
});
test('2028-29 eligible after two completed championships',()=>{
  assert.equal(onlineCapRoomSeasonReady(state(2028)),true);
});
test('2029-30 and subsequent years stay locked',()=>{
  for(const y of [2029,2030,2050]) assert.equal(onlineCapRoomSeasonReady(state(y)),false);
});
test('missing or inconsistent 2028 rollover history is rejected',()=>{
  const s=state();s.onlineSeasonHistory=[{seasonYear:2026}];
  assert.equal(onlineCapRoomSeasonReady(s),false);
  s.onlineSeasonHistory='bogus';assert.equal(onlineCapRoomSeasonReady(s),false);
});
test('stale schedule and fake rollover status are rejected',()=>{
  for(const mutation of [s=>s.onlineSchedule.seasonYear=2027,
    s=>s.onlineSchedule.phase='offseason',s=>s.onlineSeasonRollover.toYear=2027,
    s=>s.onlineSeasonRollover.status='pending',s=>s.seasonStartYear=2027,
    s=>s.seasonYear=2027]){
    const s=state();mutation(s);assert.equal(onlineCapRoomSeasonReady(s),false);
  }
});
test('offseason and in-progress markets cannot use regular-season signing preview',()=>{
  for(const change of [s=>s.offseasonState={active:true},s=>s.onlineOffseasonMarket={status:'active'}]){
    const s=state();change(s);assert.equal(onlineCapRoomSeasonReady(s),false);
  }
});
test('financial year, baseline and inflation mismatches are rejected',()=>{
  for(const change of [s=>s.currentFinancialSeasonYear=2028,
    s=>s.financials.currentFinancialSeasonYear=2028,
    s=>s.financials.baseSeasonYear=2030,
    s=>s.financials.baseRules.salaryCap=0,
    s=>s.financials.baseRules.salaryCap=900000000,
    s=>s.financials.annualInflationRate='invalid',
    s=>s.financials.annualInflationRate=5]){
      const s=state();change(s);assert.equal(onlineCapRoomSeasonReady(s),false);
    }
});
test('2028 payroll cap and player minimums use original inflation-aware financial engine',()=>{
  const s=state();
  const rules=getLeagueFinancialRules(s,2029);
  const cap=Math.round(164961000*Math.pow(1.065,2)/1000)*1000;
  assert.equal(rules.salaryCap,cap);
  assert.equal(getPlayerMinimumSalary(s,{proSeasons:0}).amount,Math.round(1300000*cap/164961000/1000)*1000);
  assert.equal(getPlayerMaximumSalary(s,{proSeasons:8}).amount,Math.round(cap*.30/1000)*1000);
});
test('migration is an explicit 4-function guarded transaction, no table mutations',()=>{
  assert.match(sql,/^BEGIN;\s*DO \$g1_guard\$/m);
  assert.match(sql,/COMMIT;\s*$/);
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION public\./gi)||[]).length,4);
  assert.equal((sql.match(/G1 source or security mismatch/g)||[]).length,4);
  assert.doesNotMatch(sql,/\b(?:DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM)\b/i);
});
test('contracts, transactions and dead-cap protections remain in the SQL',()=>{
  for(const marker of ['for update','Request ID was reused for another operation',
    'v_dead_season<>v_year','Cannot calculate team dead cap safely',
    'Cap-room-only signing cannot exceed the salary cap',
    'v_revision <> p_expected_revision',
    'An active contract requires a later rights or waiver workflow',
    'Restricted free agents need a later offer-sheet workflow',
    'bm_online_release_standard_player',
    'service_role']) assert.ok(sql.includes(marker),marker);
  assert.equal((sql.match(/REVOKE ALL ON FUNCTION public\.bm_online_/gi)||[]).length,4);
});
test('2026 and 2027 SQL branches preserved and 2028-29 bounded',()=>{
  for(const marker of ['IF v_year = 2026 THEN RETURN 164961000','v_year NOT IN (2027,2028)',
    "v_year not in (2026,2027,2028)",
    'v_payroll_year <> v_year+1',
    'Third-season rollover archive is missing',
    'v_year>=2027 then perform public.bm_online_f2_cap_room_ceiling'])
    assert.ok(sql.includes(marker),marker);
  assert.equal((sql.match(/v_year not in \(2026,2027,2028\)/g)||[]).length,3);
});
test('UI uses a verified season gate and does not silently fall back to first-year cap',()=>{
  assert.match(ui,/import \{onlineCapRoomSeasonReady\}/);
  assert.match(ui,/capRoomReady=onlineCapRoomSeasonReady\(leagueData\)/);
  assert.match(ui,/capRoomLeagueRules=activeSeason===2026\?ONLINE_CURRENT_CAP_RULES:\(leagueData\|\|\{\}\)/);
});
console.log(`${passed}/${passed} G1 targeted checks passed (static and pure-function tests only)`);
