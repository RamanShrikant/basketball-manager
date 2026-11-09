import test from 'node:test';
import assert from 'node:assert/strict';
import {cpuTradeTestHelpers as h} from '../onlineCpuTrades.js';

function readyThirdYear() {
  return {
    seasonYear: 2028, seasonStartYear: 2028, currentFinancialSeasonYear: 2029,
    onlineSchedule: {seasonYear: 2028, phase: 'regular-season', cursor:'2028-11-19'},
    onlineSeasonRollover: {status: 'complete', fromYear: 2027, toYear: 2028},
    onlineSeasonHistory: [{seasonYear: 2026}, {seasonYear: 2027}],
    financials: {baseSeasonYear: 2027, currentFinancialSeasonYear: 2029, annualInflationRate: 0.065,
      baseRules: {salaryCap: 165000000, firstApron: 209000000, secondApron: 221000000, hardCap: 221000000}},
    onlineCheckpoints: {}
  };
}

test('2028-29 CPU trades allowed only after both archived seasons',()=>{
  assert.equal(h.validatedCpuSeason(readyThirdYear()), 2028);
});

for(const [reason, mutate] of [
 ['missing archive',s=>s.onlineSeasonHistory.pop()],
 ['duplicate archive',s=>s.onlineSeasonHistory.push({seasonYear:2027})],
 ['missing archive ledger',s=>delete s.onlineSeasonHistory],
 ['wrong rollover origin',s=>s.onlineSeasonRollover.fromYear=2026],
 ['wrong rollover destination',s=>s.onlineSeasonRollover.toYear=2027],
 ['wrong active schedule year',s=>s.onlineSchedule.seasonYear=2027],
 ['wrong payroll year',s=>s.currentFinancialSeasonYear=2028],
 ['wrong financial baseline year',s=>s.financials.currentFinancialSeasonYear=2028],
 ['invalid base rules',s=>s.financials.baseRules.salaryCap='not-money'],
 ['missing inflation',s=>delete s.financials.annualInflationRate],
 ['trade deadline',s=>s.onlineSchedule.cursor='2029-02-05'],
 ['old year date',s=>s.onlineSchedule.cursor='2027-11-19'],
 ['wrong stage',s=>s.onlineSchedule.phase='postseason'],
 ['closed checkpoint',s=>s.onlineCheckpoints.trade_deadline={status:'closed'}],
 ['offseason active',s=>s.offseasonState={active:true}],
]) test(`2028 ${reason}: reject`,()=>{
  const state=readyThirdYear();mutate(state);
  assert.throws(()=>h.validatedCpuSeason(state));
});

test('third-season salaries use year offset without altering the authoritative roster',()=>{
  const team={name:'Toronto Raptors',players:[
    {id:'vet',name:'Veteran', contract:{startYear:2026,salaryByYear:[9000000,13000000,17000000,20000000]}},
    {id:'recent',name:'Recent',contract:{startYear:2028,salaryByYear:[5500000,6500000]}}
  ]};
  const before=JSON.stringify(team);
  const model=h.cpuEvaluatorRoster(team,2028);
  assert.equal(model.players[0].salary,17000000);
  assert.equal(model.players[0].yearsLeft,2);
  assert.equal(model.players[1].salary,5500000);
  assert.equal(h.stablePlayers(team,['vet'],2028)[0].salary,17000000);
  assert.equal(h.stablePlayers(team,['vet'],2028)[0].yearsLeft,2);
  assert.equal(JSON.stringify(team),before);
});

test('2029-30 remains locked pending subsequent financial/trading migrations',()=>{
  const s=readyThirdYear();s.seasonYear=2029;s.seasonStartYear=2029;
  assert.throws(()=>h.validatedCpuSeason(s),/not supported/);
});
