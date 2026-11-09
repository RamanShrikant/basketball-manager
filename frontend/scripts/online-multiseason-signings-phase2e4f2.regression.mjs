// Phase 2E.4-F2 read-only source / financial-rule regression.
// No SQL execution, browser, server, or network use.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {getLeagueFinancialRules} from '../src/utils/leagueFinancials.js';
import {getPlayerMinimumSalary,getPlayerMaximumSalary} from '../src/utils/freeAgencyContractRules.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const sql=fs.readFileSync(path.join(root,'supabase/bm_online_multiseason_signings_releases_phase2e4f2.sql'),'utf8');
const ui=fs.readFileSync(path.join(root,'frontend/src/online/OnlineFreeAgencyPreview.jsx'),'utf8');
const check=(name,fn)=>{fn();console.log(`PASS ${name}`)};
check('migration starts and ends as one transaction',()=>{
  assert.match(sql,/^BEGIN;\s*DO \$f2_guard\$/m);
  assert.match(sql,/COMMIT;\s*$/);
  assert.doesNotMatch(sql,/\b(?:drop\s+table|truncate\s+table|delete\s+from)\b/i);
});
check('exact 3 legacy RPCs retained and protected',()=>{
  for(const name of ['bm_online_sign_cap_room_free_agent','bm_online_sign_cap_room_contract','bm_online_release_standard_player']){
    assert.match(sql,new RegExp(`create or replace function public\\.${name}\\(`,'i'));
    assert.match(sql,new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`));
    assert.match(sql,new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(`));
  }
  assert.equal((sql.match(/create or replace function public\.bm_online_sign_cap_room_/gi)||[]).length,2);
});
check('original 2026 financial and dead cap checks carried over',()=>{
  assert.match(sql,/IF v_year = 2026 THEN RETURN 164961000/);
  assert.match(sql,/Cannot calculate team dead cap safely/);
  assert.match(sql,/v_dead_season<>v_year/);
  assert.match(sql,/Request ID was reused for another operation/);
  assert.match(sql,/v_revision <> p_expected_revision/);
});
check('2027 requires actual rollover and verified financial inputs',()=>{
  for(const marker of ['onlineSeasonRollover,toYear','onlineSchedule,phase','currentFinancialSeasonYear',"v_year <> 2027",'Missing immutable financial base rules','Malformed post-rollover cap inputs'])
    assert.ok(sql.includes(marker),marker);
  assert.equal((sql.match(/bm_online_f2_cap_room_ceiling\(v_state\)/g)||[]).length,3);
  assert.ok(sql.includes('COALESCE((v_financials->>\'annualInflationRate\') ~'));
});
check('post-rollover salary preview uses stored league finances',()=>{
  assert.match(ui,/capRoomReady=onlineCapRoomSeasonReady\(leagueData\)/);
  assert.match(ui,/capRoomLeagueRules=activeSeason===2026\?ONLINE_CURRENT_CAP_RULES/);
  assert.match(ui,/capRoomReady&&rosterCount<maxRosterSize/);
  assert.match(ui,/getPlayerMinimumSalary\(capRoomLeagueRules,target\)/);
  assert.match(ui,/getPlayerMaximumSalary\(capRoomLeagueRules,target\)/);
});
check('inflation-aware salary limits match original free-agency formulas',()=>{
  const state={seasonYear:2027,seasonStartYear:2027,currentFinancialSeasonYear:2028,
    financials:{baseSeasonYear:2027,currentFinancialSeasonYear:2028,annualInflationRate:0.065,
      baseRules:{salaryCap:164961000}}};
  const rules=getLeagueFinancialRules(state,2028);
  assert.equal(rules.salaryCap,Math.round(164961000*1.065/1000)*1000);
  assert.equal(getPlayerMinimumSalary(state,{proSeasons:0}).amount,Math.round(1300000*rules.salaryCap/164961000/1000)*1000);
  assert.equal(getPlayerMaximumSalary(state,{proSeasons:9}).amount,Math.round(rules.salaryCap*0.30/1000)*1000);
});
console.log('6/6 F2 source and financial-rule checks passed (not a live SQL test).');
