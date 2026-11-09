import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cpuTradeTestHelpers as h} from '../onlineCpuTrades.js';
const player=(id,start=2026)=>({id,name:id,overall:80,age:26,contract:{startYear:start,salaryByYear:[9000000,12500000,14200000]}});
const team={name:'Toronto Raptors',players:[player('a'),player('b',2027)]};
const ready=()=>({
  seasonYear:2027,seasonStartYear:2027,currentFinancialSeasonYear:2028,
  onlineSchedule:{seasonYear:2027,phase:'regular-season',cursor:'2027-11-14'},
  onlineSeasonRollover:{status:'complete',fromYear:2026,toYear:2027},
  onlineCheckpoints:{},financials:{baseSeasonYear:2027,currentFinancialSeasonYear:2028,
    annualInflationRate:0.065,baseRules:{salaryCap:165000000,firstApron:209000000,secondApron:221000000,hardCap:221000000}}
});
test('2027 season accepted only after correct rollover and financial baseline',()=>assert.equal(h.validatedCpuSeason(ready()),2027));
test('2026 path stays valid without invented rollover prerequisites',()=>assert.equal(h.validatedCpuSeason({seasonYear:2026}),2026));
test('2029+ remains unsupported',()=>assert.throws(()=>h.validatedCpuSeason({...ready(),seasonYear:2029,seasonStartYear:2029}),/not supported/));
for(const [name,modify] of [
 ['incorrect rollover',s=>s.onlineSeasonRollover.toYear=2026],
 ['incorrect schedule',s=>s.onlineSchedule.seasonYear=2026],
 ['postseason phase',s=>s.onlineSchedule.phase='postseason'],
 ['stale payroll',s=>s.currentFinancialSeasonYear=2027],
 ['missing base cap',s=>delete s.financials.baseRules.salaryCap],
 ['missing inflation',s=>delete s.financials.annualInflationRate],
 ['invalid apron',s=>s.financials.baseRules.firstApron=10],
 ['past deadline',s=>s.onlineSchedule.cursor='2028-02-05'],
 ['stale old-year date',s=>s.onlineSchedule.cursor='2026-11-14'],
 ['closed checkpoint',s=>s.onlineCheckpoints.trade_deadline={status:'closed'}],
 ['offseason lock',s=>s.offseasonState={active:true}],
 ]) test(`${name} fails closed`,()=>{const s=ready();modify(s);assert.throws(()=>h.validatedCpuSeason(s));});
test('2027 model uses current contract year, not stale opening salary',()=>{
 const s=h.stablePlayers(team,['a'],2027)[0];
 assert.equal(s.salary,12500000);assert.equal(s.currentSalary,12500000);
 assert.equal(s.yearsLeft,2);
 const model=h.cpuEvaluatorRoster(team,2027);
 assert.equal(model.players[0].salary,12500000);
 assert.equal(model.players[1].salary,9000000);
 assert.equal(team.players[0].salary,undefined);
 assert.deepEqual(team.players[0].contract.salaryByYear,[9000000,12500000,14200000]);
});
test('2026 evaluator input keeps original salary model unchanged',()=>{
 const model=h.cpuEvaluatorRoster(team,2026);
 assert.equal(model.players[0].salary,undefined);assert.notStrictEqual(model.players[0],team.players[0]);
});
