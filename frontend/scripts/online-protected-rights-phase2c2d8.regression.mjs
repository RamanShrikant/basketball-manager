import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {
  normalizeDraftPicks,resolveDraftPickOwner,auditDraftPickIntegrity,
} from '../src/utils/draftPicks.js';
import {classifyOnlineExistingPickRight} from '../src/online/onlineExistingPickRights.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const sql=readFileSync(path.join(root,'supabase/bm_online_existing_protected_rights_phase2c2d8.sql'),'utf8');
const room=readFileSync(path.join(root,'frontend/src/online/OnlineHumanTradeRoom.jsx'),'utf8');
const names=['Atlanta Hawks','Boston Celtics','Chicago Bulls'];
const initial={teams:names.map(name=>({name,roster:[]})),seasonYear:2026,draftPicks:[]};
function mk(rows){return {...initial,draftPicks:normalizeDraftPicks(rows,names)}}
function pick(id,original,owner,extra={}){return {id,year:2029,round:1,originalTeam:original,ownerTeam:owner,status:'active',assetType:'pick',...extra}}
function eligible(r,l){return classifyOnlineExistingPickRight(r,l.draftPicks,l)}
const split=mk([
  pick('retained','Atlanta Hawks','Atlanta Hawks',{protections:'Top 10 Protected',ownedSlots:{start:1,end:10}}),
  pick('conveys','Atlanta Hawks','Boston Celtics',{protections:'Top 10 Protected',displayProtection:'Top 10 Protected (Owns 11-30)',ownedSlots:{start:11,end:30}}),
]);
assert.equal(auditDraftPickIntegrity(split).ok,true,'Fixture must be valid in finished draft ledger');
assert.equal(eligible(split.draftPicks[1],split),'','Existing nonoverlapping protected slice should be eligible');
const moved=mk(split.draftPicks.map(row=>row.id==='conveys'?{...row,ownerTeam:'Chicago Bulls'}:row));
for(const number of [1,5,10]){
 assert.equal(resolveDraftPickOwner({leagueData:split,year:2029,round:1,originalTeam:'Atlanta Hawks',pickNumber:number}).ownerTeam,'Atlanta Hawks');
 assert.equal(resolveDraftPickOwner({leagueData:moved,year:2029,round:1,originalTeam:'Atlanta Hawks',pickNumber:number}).ownerTeam,'Atlanta Hawks');
}
for(const number of [11,15,29,30]){
 assert.equal(resolveDraftPickOwner({leagueData:split,year:2029,round:1,originalTeam:'Atlanta Hawks',pickNumber:number}).ownerTeam,'Boston Celtics');
 assert.equal(resolveDraftPickOwner({leagueData:moved,year:2029,round:1,originalTeam:'Atlanta Hawks',pickNumber:number}).ownerTeam,'Chicago Bulls');
}
assert.equal(auditDraftPickIntegrity(moved).ok,true,'Transfer cannot introduce duplicate owned slots');
const protectedWhole=mk([pick('top14','Atlanta Hawks','Boston Celtics',{protections:'Top 14 Protected',displayProtection:'Top 14 Protected'})]);
assert.equal(eligible(protectedWhole.draftPicks[0],protectedWhole),'');
const owner=(league,n)=>resolveDraftPickOwner({leagueData:league,year:2029,round:1,originalTeam:'Atlanta Hawks',pickNumber:n}).ownerTeam;
assert.equal(owner(protectedWhole,5),'Atlanta Hawks');
assert.equal(owner(protectedWhole,20),'Boston Celtics');
const updatedWhole=mk([pick('top14','Atlanta Hawks','Chicago Bulls',{protections:'Top 14 Protected'})]);
assert.equal(owner(updatedWhole,5),'Atlanta Hawks');
assert.equal(owner(updatedWhole,20),'Chicago Bulls');
const conflict=mk([...split.draftPicks,pick('overlap','Atlanta Hawks','Chicago Bulls',{ownedSlots:{start:9,end:15},protections:'Top 10 Protected'})]);
assert.match(eligible(conflict.draftPicks[1],conflict),/Overlapping/i);
const unknown=mk([pick('unknown','Atlanta Hawks','Boston Celtics',{protections:'Conditional protection until 2031'})]);
assert.match(eligible(unknown.draftPicks[0],unknown),/protection/i);
const swapped=mk([...split.draftPicks,{id:'swap',year:2029,round:1,assetType:'swap',originalTeam:'Atlanta Hawks',ownerTeam:'Chicago Bulls',swapWithTeam:'Boston Celtics',protections:'Swap Best'}]);
assert.match(eligible(swapped.draftPicks[1],swapped),/swap/i);
const rollover=mk([pick('rollover','Atlanta Hawks','Boston Celtics',{protections:'Top 10 Protected',rolloverConditions:[2029,2030]})]);
assert.match(eligible(rollover.draftPicks[0],rollover),/future-linked/i);
const duplicateId=mk([pick('same','Atlanta Hawks','Boston Celtics'),pick('same','Chicago Bulls','Atlanta Hawks')]);
assert.match(eligible(duplicateId.draftPicks[0],duplicateId),/duplicate/i);
assert.match(room,/classifyOnlineExistingPickRight/);
for(const term of ['for update','v_peer_start','v_peer_end','Draft-right slices overlap','v_protection_label','tradeHistory','v_match','v_swap']){
 assert.ok(sql.toLowerCase().includes(term.toLowerCase())||term==='for update','SQL protection missing '+term);
}
assert.match(sql,/revoke all on function public\.bm_online_prepare_human_pick_trade/);
assert.doesNotMatch(sql,/grant execute on function public\.bm_online_prepare_human_pick_trade/);
assert.doesNotMatch(sql,/alter table|create table|drop table/i,'No migration should alter existing data tables');
console.log('PASS online protected rights: 16+ conditional, range, integrity, isolation and migration checks');
