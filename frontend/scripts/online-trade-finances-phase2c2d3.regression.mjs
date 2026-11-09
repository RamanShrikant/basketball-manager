// 2C.2D-3A: static server boundary + executable fixtures from the unchanged
// SINGLE-PLAYER financial evaluator. No API calls, no dev server or SQL changes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';
const repo=resolve(import.meta.dirname,'../..');
const read=p=>readFileSync(resolve(repo,p),'utf8');
const sql=read('supabase/bm_online_human_trade_finances_phase2c2d3.sql');
const ui=read('frontend/src/online/OnlineHumanTradeRoom.jsx');
const single=read('frontend/src/utils/tradeExecution.js');
const originalSql=read('supabase/bm_online_human_trades_phase2c2d2.sql');
assert.match(originalSql,/abs\(v_salary_a-v_salary_b\)>1000/);
assert.doesNotMatch(sql,/abs\(v_salary_a-v_salary_b\)>1000/);
for(const part of [
 /bm_online_validate_human_trade_finances\(/,
 /perform public\.bm_online_validate_human_trade_finances\(\s*p_state,v_a,v_salary_a,v_salary_b/,
 /perform public\.bm_online_validate_human_trade_finances\(\s*p_state,v_b,v_salary_b,v_salary_a/,
 /jsonb_array_elements\(p_team->'players'\)/,
 /p_state->'deadCapByTeam'/,
 /first apron/i,/second apron/i,/hard cap/i,/matching/i,
 /v_payroll<v_cap and p_incoming<=p_outgoing\+v_cap_room\+1000/,
 /7500000\*v_inflation/,/29000000\*v_inflation/,
 /v_count_out>1 and v_count_in=1/,
 /security definer set search_path=''/,
 /revoke all on function public\.bm_online_validate_human_trade_finances/,
 /function public\.bm_online_prepare_human_player_trade/,
 /p_state,v_a,v_salary_a,v_salary_b,v_send_a,v_send_b/,
 /p_state,v_b,v_salary_b,v_salary_a,v_send_b,v_send_a/,
]) assert.match(sql,part,`SQL missing ${part}`);
assert.match(ui,/import \{evaluateTradeFinancialLegality\} from '\.\.\/utils\/tradeExecution\.js'/);
assert.match(ui,/mineFinancial\.ok&&otherFinancial\.ok/);
assert.match(ui,/salary matching now uses the existing single-player/i);
assert.doesNotMatch(ui,/Math\.abs\(sentSalary-receivedSalary\)<=1000/);
assert.doesNotMatch(ui,/\b(?:localStorage|sessionStorage)\s*[.\[]/);
assert.doesNotMatch(ui,/setLeagueData\(|saveLeagueData\(/);
// Pull source bodies from the untouched single-player implementation rather
// than creating a second JS formula for the regression tests.
function bodyFor(name) {
  const marker=`function ${name}(`;
  const start=single.indexOf(marker);
  assert(start>=0,`Single-player ${name} missing`);
  const open=single.indexOf('{',start);
  let depth=0;
  for(let i=open;i<single.length;i++) {
    if(single[i]==='{')depth++;
    if(single[i]==='}'&&--depth===0)return single.slice(start,i+1);
  }
  throw new Error(`Failed to extract ${name}`);
}
// Functions contain default destructured parameters which include `{` before
// the body. Use the exact function slice boundaries as emitted in the repo.
function sliceFn(name,next) {
  const a=single.indexOf(`function ${name}(`);
  const b=single.indexOf(`function ${next}(`,a+1);
  assert(a>=0&&b>a);
  return single.slice(a,b);
}
const financialEval=sliceFn('evaluateTradeFinancialLegality','formatPick');
const matchingFns=sliceFn('scaledTradeMatchingAmount','formatPick');
const teamCap=sliceFn('getTeamCapInfo','scaledTradeMatchingAmount');
const sandbox={
  TRADE_SALARY_TOLERANCE:1000,
  TRADE_MATCHING_SMALL_OUTGOING:7500000,
  TRADE_MATCHING_MID_OUTGOING:29000000,
  TRADE_MATCHING_BUFFER:250000,
  formatMoney:x=>String(Math.round(x)),
  getFinancialLimits:()=>({salaryCap:164961000,firstApron:209015000,secondApron:221686000,hardCap:221686000,inflationIndex:1,seasonYear:2026}),
  getTeamBasePayroll:team=>team.payroll,
};
const evaluate=vm.runInNewContext(`${teamCap}\n${matchingFns}\nevaluateTradeFinancialLegality`,sandbox);
const team=payroll=>({name:'Team',payroll});
const leagueData={seasonStartYear:2026};
const run=(payroll,outgoing,incoming)=>evaluate({team:team(payroll),leagueData,outgoingSalary:outgoing,incomingSalary:incoming});
assert.equal(run(150000000,1000000,10000000).ok,true,'cap room must work');
assert.equal(run(180000000,5000000,9000000).ok,true,'small-band 2x salary must work');
assert.equal(run(180000000,5000000,12000000).ok,false,'small-band overflow must fail');
assert.equal(run(212000000,5000000,5500000).ok,false,'first apron blocks salary increase');
assert.equal(run(212000000,5000000,4999000).ok,true,'salary reduction allowed at first apron');
assert.equal(run(175000000,15000000,22000000).ok,true,'mid-band permitted');
assert.equal(run(175000000,15000000,24000000).ok,false,'mid-band exceeded');
assert.equal(run(175000000,40000000,48000000).ok,true,'large-band permitted');
assert.equal(run(175000000,40000000,51000000).ok,false,'large-band exceeded');
console.log('PASS: Online 2C.2D-3A salary gateway and original single-player matching fixtures (cap room, bands, first apron)');
console.log('NOTE: SQL syntax execution and live two-GM tests must happen in Supabase; CPU/pick parity is not included.');
