import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeAuthoritativeOnlineDraft,makeAuthoritativeOnlinePick} from '../onlineDraftActions.js';
const names=Array.from({length:30},(_,i)=>`NBA Test ${i+1}`);
const order=Array.from({length:60},(_,i)=>({pick:i+1,round:Math.floor(i/30)+1,
 pickInRound:i%30+1,teamName:names[i%30],currentOwnerTeamName:names[i%30],originalTeamName:names[i%30]}));
test('first five successive CPU picks create unique pending rookies and preserve committed state',()=>{
 const s={teams:names.map(name=>({name,players:[],pendingRookieSignings:[]})),
   freeAgents:[],onlineDraftRights:{status:'settled',draftYear:2027,seasonYear:2026,order}};
 s.onlineDraft=initializeAuthoritativeOnlineDraft(s,123456);
 const seen=new Set();
 for(let i=0;i<5;i++){
  const oldSnapshot=JSON.stringify(s.onlineDraft.draftState);
  const result=makeAuthoritativeOnlinePick(s,{actorTeam:'',forceCpu:true});
  assert.equal(JSON.stringify(s.onlineDraft.draftState),oldSnapshot,'Engine mutated the committed state');
  assert.equal(result.pick.pick,i+1);
  assert.equal(result.player.rookieSigningPending,true);
  assert.ok(!seen.has(result.player.id));seen.add(result.player.id);
  assert.equal(result.nextDraft.currentPickIndex,i+1);
  assert.equal(result.nextDraft.completed,false);
  s.onlineDraft.draftState=result.nextDraft;
  s.teams.find(t=>t.name===result.teamName).pendingRookieSignings.push(result.player);
  assert.equal(result.undrafted.length,0);
 }
 assert.equal(seen.size,5);
 assert.equal(s.teams.reduce((n,t)=>n+t.pendingRookieSignings.length,0),5);
 assert.equal(s.teams.reduce((n,t)=>n+t.players.length,0),0);
 assert.ok(s.freeAgents.length<=24);
 assert.equal(s.onlineDraft.draftState.completed,false);
});
