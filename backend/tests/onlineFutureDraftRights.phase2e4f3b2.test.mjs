import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planOnlineFutureDraftRights} from '../onlineFutureDraftRights.js';
import {createDefaultDraftPicksForTeams,normalizeDraftPicks} from '../online_draft_shared/draftPicks.js';

const names=Array.from({length:30},(_,i)=>`NBA Team ${i+1}`);
function fixture(){return {teams:names.map(name=>({name})),
 draftPicks:createDefaultDraftPicksForTeams(names,2027,2033),
 draftPickMeta:{existing:true},onlineDraft:{status:'complete',draftYear:2027},
 onlineDraftRights:{status:'settled',draftYear:2027}};}
test('F3B2 adds 60 natural 2034 rights, retires 2027, and preserves the original input',()=>{
 const s=fixture();const before=JSON.stringify(s);
 const plan=planOnlineFutureDraftRights(s,2027);
 assert.equal(JSON.stringify(s),before);
 assert.equal(plan.futureYear,2034);assert.equal(plan.addedCount,60);assert.equal(plan.retiredCount,60);
 assert.equal(plan.draftPicks.length,420);
 assert.equal(plan.draftPicks.filter(x=>x.year===2034).length,60);
 assert.equal(plan.draftPicks.filter(x=>x.year===2027).length,0);
 assert.equal(plan.draftPickMeta.existing,true);
 assert.equal(plan.draftPickMeta.lastAutoAddedFutureYear,2034);
 assert.equal(new Set(plan.draftPicks.map(x=>x.id)).size,plan.draftPicks.length);
 const normalized=normalizeDraftPicks(plan.draftPicks,names);
 assert.equal(normalized.filter(x=>x.year===2034).length,60);
});
test('F3B2 keeps future traded picks, split protections and paired swaps byte-for-byte',()=>{
 const s=fixture();
 const existing=s.draftPicks.find(x=>x.year===2029&&x.round===1&&x.originalTeam===names[0]);
 s.draftPicks=s.draftPicks.filter(x=>x!==existing);
 s.draftPicks.push({...existing,id:'protected-a',ownerTeam:names[0],ownedSlots:{start:1,end:10},protections:'Top 10 Protected'});
 s.draftPicks.push({...existing,id:'protected-b',ownerTeam:names[1],ownedSlots:{start:11,end:30},protections:'Top 10 Protected'});
 const swapped={id:'paired-swap',assetType:'swap',type:'swap',year:2032,round:1,
  originalTeam:names[2],ownerTeam:names[3],swapWithTeam:names[4],status:'active',
  protections:'best',realLifeDetails:{swapParticipants:[names[2],names[4]]}};
 s.draftPicks.push(swapped);
 const currentFuture=s.draftPicks.filter(x=>x.year>2027);
 const rolled=planOnlineFutureDraftRights(s,2027);
 assert.deepEqual(rolled.draftPicks.slice(0,currentFuture.length),currentFuture);
});
test('F3B2 rejects incomplete or ambiguous ledgers without minting rights',()=>{
 for(const mutate of [
  s=>{s.onlineDraftRights.status='pending';},
  s=>{s.onlineDraft.status='active';},
  s=>{s.teams.pop();},
  s=>{s.draftPicks.pop();s.draftPicks.push(s.draftPicks[0]);},
  s=>{s.draftPicks.push({...s.draftPicks[0],id:'future-drafted',year:2034});},
  s=>{s.draftPickForfeitures=[{year:2034,round:1,originalTeam:names[0]}];},
  s=>{s.draftPicks=s.draftPicks.filter(x=>x.year!==2033);},
  s=>{s.draftPickMeta.lastRolledCompletedSeasonYear=2027;},
  s=>{s.draftPicks[0].ownerTeam='Unknown Team';},
  s=>{s.draftPicks[0].year=2035;},
  s=>{s.draftPicks=null;},
 ]){const s=fixture();mutate(s);const old=JSON.stringify(s);assert.throws(()=>planOnlineFutureDraftRights(s,2027));assert.equal(JSON.stringify(s),old);}
});
test('F3B2 requires a new year each cycle and avoids reusing IDs',()=>{
 const first=fixture(),once=planOnlineFutureDraftRights(first,2027);
 first.draftPicks=once.draftPicks;first.draftPickMeta=once.draftPickMeta;
 assert.throws(()=>planOnlineFutureDraftRights(first,2027));
 // Once the 2028 draft is actually completed, the outer year advances to 2035.
 first.onlineDraft.draftYear=2028;first.onlineDraftRights.draftYear=2028;
 const twice=planOnlineFutureDraftRights(first,2028);
 assert.equal(twice.futureYear,2035);
 assert.equal(twice.draftPicks.some(x=>x.year===2028),false);
 assert.equal(twice.draftPicks.filter(x=>x.year===2035).length,60);
});
test('F3B2 SQL retains original guarded rollover and adds private entitlement checks',()=>{
 const sql=readFileSync(new URL('../../supabase/bm_online_future_draft_rights_phase2e4f3b2.sql',import.meta.url),'utf8');
 for(const c of ['Unexpected Phase E rollover function definition','v_future_year := p_to_year+7',
  'Outer draft year already has rights','Future pick identifier collides',
  'SELECT coalesce(pg_catalog.jsonb_agg','INSERT INTO public.bm_online_season_archives',
  'UPDATE public.bm_online_franchise_runtime','FOR UPDATE',
  'bm.online_rollover_write','REVOKE ALL ON FUNCTION public.bm_online_rollover_season_phase2e4e',
  'TO service_role;'])assert.ok(sql.includes(c),c);
 assert.doesNotMatch(sql,/\b(?:TRUNCATE|DROP TABLE|DELETE FROM)\b/i);
});
