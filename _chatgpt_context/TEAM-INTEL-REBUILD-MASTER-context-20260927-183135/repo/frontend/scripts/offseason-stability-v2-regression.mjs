import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildRetirementAccomplishments } from '../src/utils/retirementNarrative.js';
import { applyDraftPickOwnershipToOrder, finalizeResolvedDraftOrderAssets, repairUnstartedDualSwapOrder } from '../src/utils/draftPicks.js';
import { readCurrentOffseasonState, currentOptionsResult, optionsPreviewNeedsProcessing } from '../src/utils/offseasonCompletion.js';
let checks=0;function check(label,fn){fn();checks++;console.log('PASS '+label);}
check('championship duplicates merge and retain team',()=>{
 const player={name:'Retiring',history:{accolades:[{seasonYear:2021,type:'champion',label:'NBA Champion'},{seasonYear:2021,type:'champion',label:'NBA Champion',team:'Milwaukee Bucks'},{seasonYear:2024,type:'champion',label:'NBA Champion',team:'Boston Celtics'}]}};
 const lines=buildRetirementAccomplishments(player,{}).filter(x=>x.includes('Champion'));
 assert.equal(lines.length,2);assert(lines.find(x=>x.includes('2021')).includes('Milwaukee Bucks'));
});
check('old offseason flags cannot become current',()=>{const s=readCurrentOffseasonState({seasonYear:2027,optionsComplete:true,rightsManagementComplete:true},2028,{optionsComplete:false,rightsManagementComplete:false});assert.equal(s.optionsComplete,false);assert.equal(s.rightsManagementComplete,false);});
check('old applied receipt cannot be relabeled by preview',()=>assert.equal(currentOptionsResult({seasonYear:2027,applied:{ok:true}},2028),null));
check('fresh preview overrides stale completion evidence',()=>assert(optionsPreviewNeedsProcessing({ok:true,expiredContracts:[{playerId:1}]})));
check('completed preview has no remaining decisions',()=>assert.equal(optionsPreviewNeedsProcessing({ok:true,expiredContracts:[],teamOptions:[]}),false));
const teams=[{name:'Milwaukee Bucks',players:[]},{name:'Portland Trail Blazers',players:[]},{name:'Boston Celtics',players:[]}];
function swap(id,direction,owner){return {id,year:2028,round:1,assetType:'swap',ownerTeam:owner,originalTeam:'Milwaukee Bucks',protections:'Swap '+direction,status:'active',realLifeDetails:{swapParticipants:['Milwaukee Bucks','Portland Trail Blazers'],tradeGenerated:true},tradeHistory:[{id:'trade-1'}]};}
const order=[{pick:5,round:1,teamName:'Portland Trail Blazers',originalTeamName:'Portland Trail Blazers'},{pick:11,round:1,teamName:'Milwaukee Bucks',originalTeamName:'Milwaukee Bucks'}];
const league={seasonYear:2028,draftYear:2028,teams,draftPicks:[swap('best','Best','Milwaukee Bucks'),swap('worst','Worst','Milwaukee Bucks')]};
check('owning both swap outcomes grants both picks',()=>{const result=applyDraftPickOwnershipToOrder(order,{leagueData:league,seasonYear:2028});assert(result.every(p=>p.currentOwnerTeamName==='Milwaukee Bucks'));assert.equal(new Set(result.map(p=>p.pick)).size,2);});
check('ordinary split swap remains split',()=>{const l={...league,draftPicks:[swap('best','Best','Milwaukee Bucks'),swap('worst','Worst','Portland Trail Blazers')]};const r=applyDraftPickOwnershipToOrder(order,{leagueData:l,seasonYear:2028});assert.equal(r[0].currentOwnerTeamName,'Milwaukee Bucks');assert.equal(r[1].currentOwnerTeamName,'Portland Trail Blazers');});
check('third-party acquisition of both outcomes is respected',()=>{const l={...league,draftPicks:[swap('best','Best','Boston Celtics'),swap('worst','Worst','Boston Celtics')]};assert(applyDraftPickOwnershipToOrder(order,{leagueData:l,seasonYear:2028}).every(p=>p.currentOwnerTeamName==='Boston Celtics'));});
check('finalized swaps preserve correct exact ownership',()=>{const r=applyDraftPickOwnershipToOrder(order,{leagueData:league,seasonYear:2028});const final=finalizeResolvedDraftOrderAssets(league,r,2028);assert(final.draftPicks.filter(p=>p.assetType==='pick').every(p=>p.ownerTeam==='Milwaukee Bucks'));assert.equal(finalizeResolvedDraftOrderAssets(final,r,2028),final);});
const wrongOrder=order.map((r,i)=>({...r,currentOwnerTeamName:i===0?'Milwaukee Bucks':'Portland Trail Blazers',ownershipType:i===0?'swap_best':'swap_worst'}));
const brokenLeague=finalizeResolvedDraftOrderAssets(league,wrongOrder,2028);
check('unstarted incorrectly resolved dual swap is repaired',()=>{const fixed=repairUnstartedDualSwapOrder(brokenLeague,wrongOrder,2028,{seasonYear:2028,currentPickIndex:0});assert(fixed.every(r=>r.currentOwnerTeamName==='Milwaukee Bucks'));});
check('repair never reassigns a started draft',()=>assert.equal(repairUnstartedDualSwapOrder(brokenLeague,wrongOrder,2028,{seasonYear:2028,currentPickIndex:1}),wrongOrder));
check('repair preserves later exact pick trades',()=>{const traded={...brokenLeague,draftPicks:brokenLeague.draftPicks.map(a=>a.assetType==='pick'?{...a,tradeHistory:[{id:'later-trade'}]}:a)};assert.equal(repairUnstartedDualSwapOrder(traded,wrongOrder,2028),wrongOrder);});
// Execute the actual calendar generator, not a copied version of its algorithm.
const source=fs.readFileSync(new URL('../src/pages/Calendar.jsx',import.meta.url),'utf8');
const begin=source.indexOf('function stableHashNumber('),last=source.indexOf('\n}',source.indexOf('function generateFullSeasonSchedule('))+2;
const fixture=JSON.parse(fs.readFileSync(new URL('../public/defaults/default_roster.json',import.meta.url),'utf8'));
const roster=fixture.teams||Object.values(fixture.conferences).flat();
const east=new Set(['Atlantic','Central','Southeast']);
const dates={
 console,Date,Set,Map,
 slugifyId:v=>String(v).toLowerCase().replace(/[^a-z0-9]+/g,'-'),
 resolveTeamDivision:t=>t.division,
 getDivisionConference:d=>east.has(d)?'East':'West',
 parseCalendarDate:v=>v?new Date(String(v).slice(0,10)+'T12:00:00'):null,
 addDays:(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x;},
 fmt:d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
 rangeDays:(a,b)=>{const out=[];for(let d=new Date(a);d<=b;d.setDate(d.getDate()+1))out.push(new Date(d));return out;}
};
vm.createContext(dates);vm.runInContext(source.slice(begin,last),dates);
const make=y=>dates.generateFullSeasonSchedule(roster,new Date(y,9,1,12),new Date(y+1,3,20,12));
const first=make(2027),second=make(2028),repeat=make(2027);
const sequence=s=>s.list.map(g=>g.away+'@'+g.home).join('|');
check('different years have different opponent sequences',()=>assert.notEqual(sequence(first),sequence(second)));
check('same season regeneration is deterministic',()=>assert.equal(JSON.stringify(first),JSON.stringify(repeat)));
for(const [year,schedule] of [[2027,first],[2028,second]])check(`schedule ${year} retains 1230 games, 82 per team and no same-day duplicates`,()=>{
 assert.equal(schedule.list.length,1230);const totals=new Map();
 for(const games of Object.values(schedule.byDate)){const seen=new Set();for(const g of games){assert.notEqual(g.home,g.away);for(const t of [g.home,g.away]){assert(!seen.has(t));seen.add(t);totals.set(t,(totals.get(t)||0)+1);}}}
 assert.equal(totals.size,30);assert([...totals.values()].every(n=>n===82));
});
console.log(`Offseason stability v2 regression passed: ${checks}/${checks}.`);
