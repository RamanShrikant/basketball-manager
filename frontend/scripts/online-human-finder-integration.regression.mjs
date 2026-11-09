import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {findHumanTradeMatches} from '../src/online/onlineHumanTradeFinder.mjs';
const repo=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const read=p=>readFileSync(resolve(repo,p),'utf8');
const player=(id,salary,overall=70)=>({id,name:id,overall,contract:{startYear:2026,salaryByYear:[salary]}});
const single=player('my',9000000,80);
const pool=[player('a',9000000,81),player('b',4500000,70),player('c',4500000,75),
  player('too-expensive',39000000,99),player('zero',0),{...player('two-way',4000000),isTwoWay:true}];
const basic={sending:single,targetPlayers:pool,year:2026,
 evaluateMine:(out,incoming)=>({ok:incoming<=out*1.2}),
 evaluateTheirs:(out,incoming)=>({ok:incoming<=out*1.2})};
const matches=findHumanTradeMatches(basic);
assert(matches.length>=2);
assert(matches.some(m=>m.receiveIds.length===1&&m.receiveIds[0]==='a'));
assert(matches.some(m=>m.receiveIds.includes('b')&&m.receiveIds.includes('c')));
assert(matches.every(m=>!m.receiveIds.includes('zero')&&!m.receiveIds.includes('two-way')&&!m.receiveIds.includes('too-expensive')));
assert.deepEqual(findHumanTradeMatches(basic),matches,'deterministic search');
assert.deepEqual(findHumanTradeMatches({...basic,ownRosterCount:16,ownRosterMax:16}).map(m=>m.receiveIds.length),
  matches.filter(m=>m.receiveIds.length===1).map(m=>m.receiveIds.length), 'roster max must block receiving an extra player');
assert.deepEqual(findHumanTradeMatches({...basic,evaluateMine:()=>({ok:false})}),[],'team finance cannot be bypassed');
assert.deepEqual(findHumanTradeMatches({...basic,evaluateTheirs:()=>({ok:false})}),[],'other-team finance cannot be bypassed');
assert.deepEqual(findHumanTradeMatches({...basic,targetPlayers:[{...player('a',9e6),id:'my'}]}),[],'same asset cannot be traded both ways');
assert.deepEqual(findHumanTradeMatches({...basic,sending:{...single,isTwoWay:true}}),[],'development players forbidden');
assert.deepEqual(findHumanTradeMatches({...basic,targetPlayers:null}),[]);
assert(findHumanTradeMatches({...basic,maxResults:1}).length<=1);
const room=read('frontend/src/online/OnlineHumanTradeRoom.jsx');
const finder=read('frontend/src/online/OnlineHumanTradeFinder.jsx');
const overview=read('frontend/src/online/OnlineTrades.jsx');
const router=read('frontend/src/online/OnlineFranchise.jsx');
assert(router.includes('"/trade-finder":OnlineHumanTradeFinder'));
assert(overview.includes("navigate('/trade-finder')"));
assert(finder.includes('evaluateTradeFinancialLegality')&&finder.includes('findHumanTradeMatches'));
assert(finder.includes('finderRevision')&&room.includes('sourceRevision!==String(revision)'));
assert(room.includes('sendingExists')&&room.includes('theirIds.has(id)')&&room.includes('otherGms.some'));
assert(room.includes('responseRequestRef.current.get(responseKey)'));
assert(room.includes('Confirm trade')&&room.includes('Review & accept'));
assert(room.includes('setOfferFilter')&&room.includes('displayedOffers'));
assert(room.includes('This approval cannot be undone.'));
const stress=Array.from({length:40},(_,i)=>player(`stress-${i}`,9000000+i*1000,70+i%25));
const stressStart=performance.now();
assert(findHumanTradeMatches({...basic,targetPlayers:stress,maxResults:25}).length<=25);
assert(performance.now()-stressStart<2000,'40-player bounded candidate scan must be fast');
assert(room.includes('await offerOnlineHumanAssetTrade')&&room.includes('await respondOnlineHumanTrade'));
for(const source of [finder,room]){
 assert.doesNotMatch(source,/\b(?:localStorage|sessionStorage|indexedDB)\s*[.\[]/);
 assert.doesNotMatch(source,/saveLeagueData\(|setLeagueData\(/);
 assert.doesNotMatch(source,/executeAcceptedTradeOnLeague\(/);
}
assert.equal(read('frontend/src/utils/tradeExecution.js').includes('function evaluateTradeFinancialLegality'),true);
console.log('PASS: human-GM finder matches, both-team salary checks, roster/eligibility cases, route-prefill isolation, idempotency');
console.log('PENDING: live SQL and GM-to-GM browser acceptance; CPU Trade Finder parity is NOT established');
