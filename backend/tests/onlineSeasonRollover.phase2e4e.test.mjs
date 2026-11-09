import test from 'node:test';
import assert from 'node:assert/strict';
import {rolloverReady,buildRolloverCalendar} from '../onlineSeasonRollover.js';
import {getDefaultDivisionForTeam} from '../../frontend/src/utils/leagueDivisions.js';
import {createDefaultDraftPicksForTeams} from '../online_draft_shared/draftPicks.js';
function fixture(){
 const names=['Atlanta Hawks','Boston Celtics','Brooklyn Nets','Charlotte Hornets','Chicago Bulls','Cleveland Cavaliers','Detroit Pistons','Indiana Pacers','Miami Heat','Milwaukee Bucks','New York Knicks','Orlando Magic','Philadelphia 76ers','Toronto Raptors','Washington Wizards',
 'Dallas Mavericks','Denver Nuggets','Golden State Warriors','Houston Rockets','Los Angeles Clippers','Los Angeles Lakers','Memphis Grizzlies','Minnesota Timberwolves','New Orleans Pelicans','Oklahoma City Thunder','Phoenix Suns','Portland Trail Blazers','Sacramento Kings','San Antonio Spurs','Utah Jazz'];
 const teams=names.map((name,i)=>({name,conference:i<15?'East':'West',division:getDefaultDivisionForTeam(name,i<15?'East':'West'),players:Array.from({length:10},(_,j)=>({id:`${i}-${j}`,name:`Player ${i}-${j}`,age:25,contract:{startYear:2026,salaryByYear:[2000000,2200000]}}))}));
 return {seasonStartYear:2026,teams,freeAgents:[],
  draftPicks:createDefaultDraftPicksForTeams(names,2027,2033),
  onlineDraftRights:{status:'settled',draftYear:2027},onlineSchedule:{seasonYear:2026,byDate:{'2026-10-20':[]}},onlineResults:Object.fromEntries(Array.from({length:1230},(_,i)=>['g'+i,{date:'2026-10-20',home:names[0],away:names[1]}])),onlinePostseason:{seasonYear:2026,phase:'postseasonComplete',champion:names[0]},onlineDraft:{status:'complete',draftYear:2027},onlineRetirements:{status:'complete'},onlineRookieSignings:{status:'complete'},onlineOptions:{status:'complete',year:2027},onlineRights:{status:'complete',year:2027},onlineOffseasonMarket:{status:'complete',year:2027},onlineProgression:{status:'complete',seasonYear:2027},freeAgencyState:{marketComplete:true,isActive:false},offseasonState:{active:true,retirementsComplete:true,rookieSigningsComplete:true,optionsComplete:true,rightsManagementComplete:true,freeAgencyComplete:true,progressionComplete:true}};
}
test('ready season is precisely one year after completed postseason',()=>{
 const r=rolloverReady(fixture());assert.equal(r.fromYear,2026);assert.equal(r.toYear,2027);assert.equal(r.playerCount,300);
});
test('original NBA scheduler builds 1,230 games and 82 per team for next year',()=>{
 const {byDate,details}=buildRolloverCalendar(fixture());
 const games=Object.values(byDate).flat();assert.equal(games.length,1230);assert.equal(details.toYear,2027);
 const appearance=new Map();for(const g of games){assert.equal(g.date.slice(0,4)==='2027'||g.date.slice(0,4)==='2028',true);for(const k of [g.home,g.away])appearance.set(k,(appearance.get(k)||0)+1);}
 assert.equal(appearance.size,30);for(const n of appearance.values())assert.equal(n,82);
});
test('rejects incomplete and duplicate state',()=>{
 for(const mutate of [s=>{s.onlineProgression=null;},s=>{s.onlineOffseasonMarket.status='active'},s=>{s.teams[0].players[0].id=s.teams[1].players[0].id},s=>{s.teams[0].pendingRookieSignings=[{id:'pending'}]},s=>{s.freeAgencyState.pendingUserDecisions=[{x:1}]},s=>{s.onlineSeasonHistory=[{seasonYear:2026}]},s=>{s.onlineResults={}},s=>{s.offseasonState.optionsComplete=false}]){
 const s=fixture();mutate(s);assert.throws(()=>rolloverReady(s));}
});

test('rejects malformed prior-year archive state and unfinalized postseason',()=>{
 const a=fixture();a.onlineSeasonHistory={bad:true};assert.throws(()=>rolloverReady(a));
 const b=fixture();b.onlinePostseason.phase='playoffs';assert.throws(()=>rolloverReady(b));
 const c=fixture();c.onlineSchedule.seasonYear=2027;assert.throws(()=>rolloverReady(c));
});
test('contract salary arrays, players and draft rights are read-only inputs to builder',()=>{
 const state=fixture();
 const before=JSON.stringify(state);
 const {details}=buildRolloverCalendar(state);
 assert.equal(details.toYear,2027);assert.equal(JSON.stringify(state),before);
});
test('SQL installs only private service-role rollover, archive, and scoped legacy guard bridge',async()=>{
 const fs=await import('node:fs');
 const url=new URL('../../supabase/bm_online_season_rollover_phase2e4e.sql',import.meta.url);
 const sql=fs.readFileSync(url,'utf8');
 for(const clause of [
  'CREATE TABLE IF NOT EXISTS public.bm_online_season_archives',
  'bm.online_rollover_write',
  'FOR UPDATE',
  "v_old#>>'{onlineProgression,status}' IS DISTINCT FROM 'complete'",
  'INSERT INTO public.bm_online_season_archives',
  'pg_catalog.jsonb_array_elements',
  "SET status='cancelled'",
  'REVOKE ALL ON FUNCTION public.bm_online_rollover_season_phase2e4e',
  'TO service_role;'
 ])assert.ok(sql.includes(clause),`missing ${clause}`);
 assert.doesNotMatch(sql,/\b(?:TRUNCATE|DROP TABLE|DELETE FROM)\b/i);
});
