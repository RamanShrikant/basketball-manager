import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {onlineDraftTradeWindow} from '../src/online/onlineDraftTradeWindow.mjs';
import {canOnlineAddPickProtection} from '../src/online/onlineCustomPickProtections.mjs';
import {canOnlineCreateSwapPair} from '../src/online/onlinePickSwapCommands.mjs';
import {classifyOnlineExistingPickRight} from '../src/online/onlineExistingPickRights.mjs';
const third=()=>({seasonYear:2028,seasonStartYear:2028,
 onlineSchedule:{seasonYear:2028,phase:'regular-season',cursor:'2028-11-03'},
 onlineSeasonRollover:{fromYear:2027,toYear:2028,status:'complete'},
 onlineSeasonHistory:[{seasonYear:2026},{seasonYear:2027}],
 draftPickMeta:{lastRolledCompletedSeasonYear:2028,lastAutoAddedFutureYear:2035,
 rollingWindowVersion:'online_future_draft_rights_f3b2'},
 draftPicks:Array.from({length:60},(_,i)=>({id:`f-${i}`,year:2035}))});
const pick=(year,id,team)=>({id,year,round:1,assetType:'pick',type:'pick',originalTeam:team,
 ownerTeam:team,status:'active',protections:'unprotected'});
test('third NBA year opens a bounded 2029-2035 draft pick window and 2029-2034 swaps',()=>{
 const state=third(),w=onlineDraftTradeWindow(state);
 assert.deepEqual(w,{activeSeason:2028,firstPickYear:2029,lastPickYear:2035,lastSwapYear:2034});
 const a=pick(2034,'a','A'),b=pick(2034,'b','B');
 assert.equal(canOnlineCreateSwapPair(a,b,[a,b],state),true);
 assert.equal(canOnlineAddPickProtection(a,[a,b],state),true);
 assert.equal(canOnlineCreateSwapPair(pick(2035,'c','A'),pick(2035,'d','B'),[],state),false);
 const beyond=pick(2036,'x','A');
 assert.match(classifyOnlineExistingPickRight(beyond,[beyond],state),/Outside the supported/);
});
test('no fake rollover, missing archive or missing outer entitlements can open 2028 trading',()=>{
 const edits=[
 s=>{s.onlineSeasonHistory.pop()},s=>{s.onlineSeasonHistory.push({seasonYear:2026})},
 s=>{s.onlineSeasonRollover.fromYear=2026},s=>{s.onlineSeasonRollover.status='pending'},
 s=>{s.onlineSchedule.seasonYear=2027},s=>{s.onlineSchedule.phase='offseason'},
 s=>{s.onlineSchedule.cursor='2026-11-01'},s=>{s.onlineSchedule.cursor='2029-02-05'},
 s=>{s.onlineSchedule.cursor='garbage'},s=>{s.seasonStartYear=2027},
 s=>{s.draftPickMeta.lastAutoAddedFutureYear=2034},
 s=>{s.draftPickMeta.lastRolledCompletedSeasonYear=2027},
 s=>{s.draftPickMeta.rollingWindowVersion='unknown'},
 s=>{s.draftPicks.pop()},s=>{delete s.draftPicks},
 s=>{s.seasonYear=2029},s=>{s.seasonYear=2027},
 ];
 for(const edit of edits){const s=third();edit(s);assert.equal(onlineDraftTradeWindow(s),null);}
});
test('2026 and validated 2027 pick windows stay unchanged',()=>{
 assert.deepEqual(onlineDraftTradeWindow({seasonYear:2026}),
  {activeSeason:2026,firstPickYear:2027,lastPickYear:2033,lastSwapYear:2032});
 assert.deepEqual(onlineDraftTradeWindow({seasonYear:2027,
 onlineSchedule:{seasonYear:2027,phase:'regular-season'},onlineSeasonRollover:{toYear:2027}}),
  {activeSeason:2027,firstPickYear:2028,lastPickYear:2034,lastSwapYear:2033});
 assert.equal(onlineDraftTradeWindow({seasonYear:2029}),null);
});
test('G2B SQL preserves the draft-right transfer, protection and swap algorithms',()=>{
 const s=readFileSync(new URL('../../supabase/bm_online_third_season_draft_trades_phase2e4g2b.sql',import.meta.url),'utf8');
 assert.equal((s.match(/PHASE 2E.4-G2B: third-season draft eligibility/g)||[]).length,2);
 assert.equal((s.match(/v_active_season not between 2026 and 2028/g)||[]).length,2);
 assert.equal((s.match(/v_first_pick_year := v_active_season\+1/g)||[]).length,2);
 assert.equal((s.match(/v_last_pick_year := v_active_season\+7/g)||[]).length,2);
 assert.ok(s.includes('for v_year_scan in v_first_pick_year..v_last_swap_year loop'));
 assert.ok(s.includes('Trade creates a new Stepien consecutive-first-round violation'));
 assert.ok(s.includes('Draft pick is encumbered by an active swap right'));
 assert.ok(s.includes('Multiple draft ownership ledgers need reconciliation'));
 assert.ok(s.includes("lastAutoAddedFutureYear}' IS DISTINCT FROM '2035'"));
 assert.equal((s.match(/REVOKE ALL ON FUNCTION/g)||[]).length,2);
});
