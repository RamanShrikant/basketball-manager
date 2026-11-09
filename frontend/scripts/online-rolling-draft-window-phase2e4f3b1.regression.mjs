// Phase 2E.4-F3B1: deterministic UI and SQL guards, no network or database calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {onlineDraftTradeWindow} from '../src/online/onlineDraftTradeWindow.mjs';
import {canOnlineAddPickProtection} from '../src/online/onlineCustomPickProtections.mjs';
import {canOnlineCreateSwapPair} from '../src/online/onlinePickSwapCommands.mjs';
import {classifyOnlineExistingPickRight} from '../src/online/onlineExistingPickRights.mjs';
const scenarios = [
  {label:'first season', league:{seasonYear:2026}, first:2027,last:2033,swap:2032},
  {label:'first rollover',league:{seasonYear:2027,onlineSchedule:{seasonYear:2027,phase:'regular-season'},onlineSeasonRollover:{toYear:2027}},first:2028,last:2034,swap:2033},
];
const make = (year,id,team) => ({id,year,round:1,assetType:'pick',type:'pick',originalTeam:team,
    originalTeamName:team,ownerTeam:team,status:'active',protections:'unprotected'});
let n=0;
for(const s of scenarios){
 const window=onlineDraftTradeWindow(s.league);
 assert.deepEqual([window.firstPickYear,window.lastPickYear,window.lastSwapYear],[s.first,s.last,s.swap]);n++;
 const a=make(s.swap,`${s.label}-a`,'A'),b=make(s.swap,`${s.label}-b`,'B');
 assert.equal(canOnlineCreateSwapPair(a,b,[a,b],s.league),true);n++;
 const tooFar=make(s.swap+1,`${s.label}-far`,'B');
 assert.equal(canOnlineCreateSwapPair(a,tooFar,[a,tooFar],s.league),false);n++;
 assert.equal(canOnlineAddPickProtection(a,[a,b],s.league),true);n++;
 assert.equal(canOnlineAddPickProtection(make(s.last+1,'off','C'),[],s.league),false);n++;
 const old=make(s.first-1,'expired','C');
 assert.match(classifyOnlineExistingPickRight(old,[old],s.league),/Outside the supported/);n++;
}
assert.equal(onlineDraftTradeWindow({seasonYear:2027,onlineSchedule:{seasonYear:2027,phase:'regular-season'}}),null);n++;
assert.equal(onlineDraftTradeWindow({seasonYear:2027,onlineSchedule:{seasonYear:2026,phase:'regular-season'},onlineSeasonRollover:{toYear:2027}}),null);n++;
assert.equal(onlineDraftTradeWindow({seasonYear:2028,onlineSchedule:{seasonYear:2028,phase:'regular-season'},onlineSeasonRollover:{toYear:2028}}),null);n++;
const sql=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),'../../supabase/bm_online_rolling_draft_window_phase2e4f3b1.sql'),'utf8');
assert.ok(sql.includes('v_year not between v_first_pick_year and v_last_pick_year'));n++;
assert.ok(sql.includes('v_year not between v_first_pick_year and v_last_swap_year'));n++;
assert.ok(sql.includes('for v_year_scan in v_first_pick_year..v_last_swap_year loop'));n++;
assert.equal((sql.match(/'seasonYear',v_active_season/g)||[]).length,3);n++;
assert.ok(sql.includes('pg_catalog.md5(base_body)')&&sql.includes('pg_catalog.md5(wrapper_body)'));n++;
assert.ok(sql.includes('only the first rollover')||sql.includes('Only the first rollover'));n++;
console.log(`F3B1 regression: ${n}/${n} PASS`);
