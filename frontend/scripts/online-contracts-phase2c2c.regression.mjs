// Run from repository root: node frontend/scripts/online-contracts-phase2c2c.regression.mjs
// Static authority checks and real single-player salary-calculator fixtures.
// Live deployment, RPC permission and two-account conflict testing are separate gates.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {buildLegalFreeAgentSalarySchedule,getPlayerMinimumSalary,getPlayerMaximumSalary} from '../src/utils/freeAgencyContractRules.js';
const root=resolve(import.meta.dirname,'..','..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const sql=read('supabase/bm_online_multiyear_contracts_phase2c2c.sql');
const ui=read('frontend/src/online/OnlineFreeAgencyPreview.jsx');
const client=read('frontend/src/online/onlineRuntimeClient.js');
const requirePatterns=(name,src,parts)=>parts.forEach(p=>assert.match(src,p,`${name} missing ${p}`));
const isolatedRules={seasonStartYear:2026,currentFinancialSeasonYear:2027,financials:{baseSeasonYear:2027,baseRules:{salaryCap:164_961_000}}};
assert.deepEqual(buildLegalFreeAgentSalarySchedule(10_000_000,4,0.05),[10_000_000,10_500_000,11_000_000,11_500_000]);
assert.deepEqual(buildLegalFreeAgentSalarySchedule(1_300_000,2,0.05),[1_300_000,1_365_000]);
assert.equal(getPlayerMinimumSalary(isolatedRules,{age:19,proSeasons:0}).amount,1_300_000);
assert.equal(getPlayerMaximumSalary(isolatedRules,{age:19,proSeasons:0}).amount,41_240_000);
assert.equal(getPlayerMinimumSalary(isolatedRules,{age:35,proSeasons:11}).amount,3_300_000);
assert.equal(getPlayerMaximumSalary(isolatedRules,{age:35,proSeasons:11}).amount,57_736_000);
requirePatterns('server SQL',sql,[
  /create or replace function public\.bm_online_sign_cap_room_contract\(/i,
  /auth\.uid\(\)/i,/security definer set search_path = ''/i,
  /from public\.bm_online_franchise_runtime r where r\.lobby_id=p_lobby for update/i,
  /bm_online_lobby_members/i,/v_status <> 'started'/i,/v_revision <> p_expected_revision/i,
  /action_type <> 'sign_cap_room_contract'/i,/is distinct from p_years/i,/is distinct from p_option_type/i,
  /p_years < 1 or p_years > 4/i,/p_years=1 and p_option_type<>'none'/i,
  /v_salary_floor/i,/v_salary_ceiling/i,/v_service_years/i,
  /v_payroll\+p_first_year_salary>v_cap/i,/deadCapByTeam/i,
  /0\.05 \* v_year_index/i,/\/1000\)\*1000/i,
  /'yearIndices',jsonb_build_array\(p_years-1\)/i,
  /'salaryByYear',v_salary_by_year/i,
  /insert into public\.bm_online_franchise_events/i,
  /grant execute on function public\.bm_online_sign_cap_room_contract/i,
]);
requirePatterns('online client',client,[
  /signOnlineCapRoomContract/i,/bm_online_sign_cap_room_contract/i,
  /p_expected_revision:positiveRevision\(expectedRevision\)/i,
  /p_years:years,p_option_type:optionType/i,
]);
requirePatterns('online view',ui,[
  /signOnlineCapRoomContract/i,/buildLegalFreeAgentSalarySchedule/i,
  /getPlayerMinimumSalary\(capRoomLeagueRules,target\)/i,
  /getPlayerMaximumSalary\(capRoomLeagueRules,target\)/i,
  /activeSeason===2026\?ONLINE_CURRENT_CAP_RULES:\(leagueData\|\|\{\}\)/i,
  /\[1,2,3,4,\.\.\.\(isBirdOffer\?\[5\]:\[\]\)\]/i,/onChange=\{e=>changeOption/i,
  /optionType/i,
  /expectedRevision:attempt.revision/i,/await onAccepted\(\)/i,
]);
assert.doesNotMatch(sql,/update\s+public\.bm_singleplayer/i);
assert.doesNotMatch(ui,/localStorage\.|sessionStorage\.|setLeagueData\(|saveLeagueData\(/);
assert.doesNotMatch(ui, /(?:import|<)GameProvider\b/);
assert.doesNotMatch(client,/from ['"]\.\.\/context\/GameContext/i);
console.log('PASS: contract salary schedules/minimums/maximums, revisioned server RPC, guarded options and Online isolation');
console.log('NOTE: SQL execution and two-account concurrency still require manual live verification.');
