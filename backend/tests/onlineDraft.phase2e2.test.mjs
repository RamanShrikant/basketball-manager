import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runOriginalDraftLottery} from '../onlineDraftLottery.js';
import {settleOnlineDraftRights,preflightDraftRights} from '../onlineDraftRightsCore.mjs';
import {initializeAuthoritativeOnlineDraft,makeAuthoritativeOnlinePick,onlineDraftAction} from '../onlineDraftActions.js';
import {createDefaultDraftPicksForTeams,applyDraftPickOwnershipToLotteryResult} from '../online_draft_shared/draftPicks.js';
const HOST='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GUEST='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOBBY='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function fixture(){
 const snapshot=[],teams=[],conf={},seedOrder={};
 for(const c of ['East','West']){
  const names=Array.from({length:15},(_,i)=>`${c} ${i+1}`);
  const pi={g78:{played:true,home:names[6],away:names[7],winner:names[6],loser:names[7]},
    g910:{played:true,home:names[8],away:names[9],winner:names[8],loser:names[9]},
    gFinal:{played:true,home:names[7],away:names[8],winner:names[8],loser:names[7]},
    seed7:names[6],seed8:names[8]};
  conf[c]={playIn:pi};seedOrder[c]=names.slice(0,10);
  names.forEach((name,i)=>{teams.push({name,conference:c,players:[],pendingRookieSignings:[]});
    snapshot.push({teamName:name,conference:c,wins:62-i*2,losses:20+i*2,
      leagueRank:1+i*2+(c==='East'?0:1),conferenceSeed:i<10?i+1:null});});
 }
 return {teams,conferences:undefined,draftPicks:createDefaultDraftPicksForTeams(teams.map(t=>t.name),2027,2027),
  freeAgents:[],onlineSchedule:{phase:'postseason',seasonYear:2026},
  onlinePostseason:{seasonYear:2026,phase:'postseasonComplete',champion:'East 1',
   regularSeasonSnapshot:snapshot,seedOrder,conf}};
}
function prepared(){const state=fixture();state.onlineDraftLottery=runOriginalDraftLottery(state,'new-draft-test-seed');return state;}
const respond=()=>({statusCode:200,set(){return this;},status(code){this.statusCode=code;return this;},json(data){this.data=data;return this;}});
const request=(body={lobbyId:LOBBY,requestId:REQUEST,expectedRevision:9})=>({body,get:()=>`Bearer ${'x'.repeat(40)}`});
async function withMock(state,action,handler,{actor=HOST,revision=9,memberTeam='East 1',humanTeams=['East 1','West 1'],event=null}={}){
 const savedFetch=globalThis.fetch,url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://mock.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='mock-service-role';
 const calls=[];
 globalThis.fetch=async(target,options={})=>{
  if(target.includes('/auth/v1/user'))return new Response(JSON.stringify({id:actor}));
  if(target.includes('/bm_online_lobbies'))return new Response(JSON.stringify([{host_id:HOST,status:'started'}]));
  if(target.includes('/bm_online_lobby_members'))return new Response(JSON.stringify(
    target.includes('team_name')&&!target.includes('user_id=')?humanTeams.map(team_name=>({team_name})):[{user_id:actor,team_name:memberTeam}]));
  if(target.includes('/bm_online_franchise_events'))return new Response(JSON.stringify(event?[event]:[]));
  if(target.includes('/bm_online_franchise_runtime'))return new Response(JSON.stringify([{state,revision}]));
  if(target.includes('/rpc/')){calls.push({target,body:JSON.parse(options.body)});return new Response(JSON.stringify({ok:true,revision:revision+1}));}
  throw Error(`Unexpected fetch ${target}`);
 };
 try{return await handler(calls);}finally{globalThis.fetch=savedFetch;
   if(url===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=url;
   if(key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=key;}
}

test('settle: exact original NBA resolver, no in-place league modifications and 60 unique owners',()=>{
 const state=prepared(),old=JSON.stringify(state),rights=settleOnlineDraftRights(state);
 assert.equal(JSON.stringify(state),old);assert.equal(rights.status,'settled');
 assert.equal(rights.order.length,60);
 assert.equal(new Set(rights.order.map(x=>x.pick)).size,60);
 assert.equal(rights.rightsSourceSha256.length,64);
 assert.ok(rights.order.every(p=>p.currentOwnerTeamName===p.originalTeamName));
});
test('protected range transfers only picks outside protection; 1-30 retains correct natural slots',()=>{
 const state=prepared();const draftYear=state.onlineDraftLottery.draftYear;
 const source=state.draftPicks.find(p=>p.originalTeam==='East 1'&&p.round===1&&p.year===draftYear);
 state.draftPicks=state.draftPicks.filter(p=>p!==source);
 state.draftPicks.push({...source,id:'split-retained',ownerTeam:'East 1',ownedSlots:{start:1,end:10},
    protections:'Top 10 Protected',displayProtection:'Top 10 Protected (Owns 1-10)'});
 state.draftPicks.push({...source,id:'split-conveyed',ownerTeam:'West 1',ownedSlots:{start:11,end:30},
    protections:'Top 10 Protected',displayProtection:'Top 10 Protected (Owns 11-30)'});
 const pick=state.onlineDraftLottery.result.firstRoundOrder.find(p=>p.originalTeamName==='East 1');
 const rights=settleOnlineDraftRights(state);
 const slot=rights.order.find(p=>p.pick===pick.pick);
 assert.equal(slot.currentOwnerTeamName,pick.pick<=10?'East 1':'West 1');
});
test('reject ambiguous/overlapping or missing entitlement slices and duplicate source IDs',()=>{
 for(const modify of [
  s=>{s.draftPicks[0].id=s.draftPicks[1].id;},
  s=>{const a=s.draftPicks[0];s.draftPicks.push({...a,id:'duplicate',ownerTeam:'West 1',ownedSlots:{start:8,end:30}});},
  s=>{const a=s.draftPicks[0];s.draftPicks=s.draftPicks.filter(p=>p!==a);s.draftPicks.push({...a,id:'split-a',ownedSlots:{start:1,end:5}},{...a,id:'split-b',ownerTeam:'West 1',ownedSlots:{start:7,end:30}});},
  s=>{s.draftState={draftPicks:[{id:'other-ledger'}]};}
 ]){const s=prepared();modify(s);assert.throws(()=>preflightDraftRights(s,2027));}
});
test('paired swap: better pick goes to Best holder; single-player resolver agrees',()=>{
 const s=prepared(),year=2027;
 const [a,b]=['East 3','West 3'].map(name=>s.draftPicks.find(p=>p.originalTeam===name&&p.year===year&&p.round===1));
 s.draftPicks=s.draftPicks.filter(p=>![a,b].includes(p));
 const details={swapParticipants:['East 3','West 3'],swapOwnerParticipants:['East 3','West 3'],tradeGenerated:true};
 s.draftPicks.push({id:'swap-best',year,round:1,assetType:'swap',type:'swap',originalTeam:'East 3',swapWithTeam:'West 3',
  ownerTeam:'West 3',logicType:'trade_machine_swap',protections:'Swap Best',status:'active',realLifeDetails:details},
 {id:'swap-worst',year,round:1,assetType:'swap',type:'swap',originalTeam:'East 3',swapWithTeam:'West 3',
  ownerTeam:'East 3',logicType:'trade_machine_swap',protections:'Swap Worst',status:'active',realLifeDetails:details});
 const rights=settleOnlineDraftRights(s);
 const rows=rights.order.filter(r=>['East 3','West 3'].includes(r.originalTeamName));
 const first=rows.find(r=>r.round===1&&r.pick===Math.min(...rows.filter(x=>x.round===1).map(x=>x.pick)));
 const last=rows.find(r=>r.round===1&&r.pick===Math.max(...rows.filter(x=>x.round===1).map(x=>x.pick)));
 assert.equal(first.currentOwnerTeamName,'West 3');assert.equal(last.currentOwnerTeamName,'East 3');
});
test('original Python draft engine generates shared class, CPU pick, and unsigned rookie without local mutation',()=>{
 const s=prepared();s.onlineDraftRights=settleOnlineDraftRights(s);
 const before=JSON.stringify(s),draft=initializeAuthoritativeOnlineDraft(s,12345);
 assert.equal(JSON.stringify(s),before);
 assert.equal(draft.status,'active');assert.ok(draft.draftState.availableProspects.length>=60);
 s.onlineDraft=draft;
 const result=makeAuthoritativeOnlinePick(s,{actorTeam:'',forceCpu:true});
 assert.equal(result.nextDraft.currentPickIndex,1);assert.equal(result.pick.pick,draft.draftState.draftOrder[0].pick);
 assert.equal(result.player.rookieSigningPending,true);assert.equal(result.player.contract.type,'unsigned_rookie');
 assert.ok(result.player.id.startsWith('rookie_2027_'));
 assert.equal(s.onlineDraft.draftState.currentPickIndex,0,'original shared state was not mutated');
});
test('human ownership: reject another GM, hidden CPU override and unavailable player',()=>{
 const s=prepared();s.onlineDraftRights=settleOnlineDraftRights(s);
 s.onlineDraft=initializeAuthoritativeOnlineDraft(s,12345);
 assert.throws(()=>makeAuthoritativeOnlinePick(s,{actorTeam:'Not Owner',forceCpu:false,prospectId:'x'}));
 assert.throws(()=>makeAuthoritativeOnlinePick(s,{actorTeam:'',forceCpu:true,prospectId:'x'}));
 assert.throws(()=>makeAuthoritativeOnlinePick(s,{actorTeam:s.onlineDraft.draftState.draftOrder[0].currentOwnerTeamName,
   forceCpu:false,prospectId:'not-a-real-prospect'}));
});
test('host settlement commits only with matching revision, guest and replay are rejected or idempotent',async()=>{
 const s=prepared();
 await withMock(s,'settle',async calls=>{
  const res=respond();await onlineDraftAction(request(),res,'settle');
  assert.equal(res.data.ok,true);assert.equal(calls.length,1);
  assert.equal(calls[0].body.p_rights.order.length,60);
 });
 await withMock(s,'settle',async calls=>{
  const res=respond();await onlineDraftAction(request(),res,'settle');assert.equal(res.statusCode,403);assert.equal(calls.length,0);
 },{actor:GUEST});
 await withMock(s,'settle',async calls=>{
  const res=respond();await onlineDraftAction(request(),res,'settle');assert.equal(res.statusCode,409);assert.equal(calls.length,0);
 },{revision:10});
 await withMock(s,'settle',async calls=>{
  const res=respond();await onlineDraftAction(request(),res,'settle');assert.equal(res.data.replayed,true);assert.equal(calls.length,0);
 },{event:{actor_id:HOST,action_type:'nba_draft_rights_settled',revision:12}});
});
test('SQL explicitly checks locked state, turn owner, restricted RPC role and immutable draft state',()=>{
 const sql=readFileSync(new URL('../../supabase/bm_online_draft_rights_and_live_draft_phase2e2.sql',import.meta.url),'utf8');
 for(const term of ['for update','onlineDraftRights','draftPickForfeitures','currentOwnerTeamName',
   'pendingRookieSignings','npc','service_role','nba_draft_pick_made','bm.online_draft_write',
   'human']){if(['npc','human'].includes(term))continue;assert.ok(sql.includes(term),term);}
 for(const f of ['bm_online_settle_draft_rights_phase2e2','bm_online_start_draft_phase2e2','bm_online_make_draft_pick_phase2e2']){
   assert.ok(sql.includes(`revoke all on function public.${f}`));
 }
});

test('human GM can choose only an available rookie for the current owned pick; CPU bypass is denied',async()=>{
 const s=prepared();s.onlineDraftRights=settleOnlineDraftRights(s);
 s.onlineDraft=initializeAuthoritativeOnlineDraft(s,3117);
 const owner=s.onlineDraft.draftState.draftOrder[0].currentOwnerTeamName;
 const rookie=String(s.onlineDraft.draftState.availableProspects[0].id);
 await withMock(s,'pick',async calls=>{
  const res=respond();await onlineDraftAction(request({...request().body,prospectId:rookie}),res,'pick');
  assert.equal(res.statusCode,200);assert.equal(calls.length,1);
  assert.equal(calls[0].body.p_owner,owner);
  assert.equal(calls[0].body.p_cpu,false);
  assert.equal(calls[0].body.p_player.rookieSigningPending,true);
  assert.equal(calls[0].body.p_next_draft.currentPickIndex,1);
  assert.equal(s.onlineDraft.draftState.currentPickIndex,0);
 },{memberTeam:owner,humanTeams:[owner,'West 2']});
 await withMock(s,'pick',async calls=>{
  const res=respond();await onlineDraftAction(request({...request().body,prospectId:rookie}),res,'pick');
  assert.equal(res.statusCode,403);assert.equal(calls.length,0);
 },{actor:GUEST,memberTeam:'West 1',humanTeams:[owner,'West 1']});
 await withMock(s,'pick',async calls=>{
  const res=respond();await onlineDraftAction(request(),res,'pick');
  assert.equal(res.statusCode,400);assert.equal(calls.length,0);
 },{memberTeam:owner,humanTeams:[owner,'West 2']});
});

test('host can advance only CPU teams; cannot inject CPU prospect or move a human pick',async()=>{
 const s=prepared();s.onlineDraftRights=settleOnlineDraftRights(s);
 s.onlineDraft=initializeAuthoritativeOnlineDraft(s,3317);
 const owner=s.onlineDraft.draftState.draftOrder[0].currentOwnerTeamName;
 await withMock(s,'pick',async calls=>{
  const res=respond();await onlineDraftAction(request(),res,'pick');
  assert.equal(res.statusCode,200);assert.equal(calls.length,1);
  assert.equal(calls[0].body.p_cpu,true);
 },{memberTeam:'West 1',humanTeams:['West 1','West 2']});
 await withMock(s,'pick',async calls=>{
  const res=respond();await onlineDraftAction(request({...request().body,prospectId:'force-cpu-prospect'}),res,'pick');
  assert.equal(res.statusCode,400);assert.equal(calls.length,0);
 },{memberTeam:'West 1',humanTeams:['West 1','West 2']});
 await withMock(s,'pick',async calls=>{
  const res=respond();await onlineDraftAction(request(),res,'pick');
  assert.equal(res.statusCode,403);assert.equal(calls.length,0);
 },{actor:GUEST,memberTeam:'West 2',humanTeams:['West 1','West 2']});
 await withMock(s,'pick',async calls=>{
  const res=respond();await onlineDraftAction(request(),res,'pick');
  assert.equal(res.statusCode,403);assert.equal(calls.length,0);
 },{memberTeam:'West 1',humanTeams:[owner,'West 1']});
});

test('draft pick exact request replay returns prior result and does not select a second prospect',async()=>{
 const s=prepared();s.onlineDraftRights=settleOnlineDraftRights(s);
 s.onlineDraft=initializeAuthoritativeOnlineDraft(s,777);
 const event={actor_id:HOST,action_type:'nba_draft_pick_made',revision:27,details:{pick:{pick:1,playerName:'Test Prospect'}}};
 await withMock(s,'pick',async calls=>{
  const res=respond();await onlineDraftAction(request(),res,'pick');
  assert.equal(res.statusCode,200);assert.equal(res.data.replayed,true);
  assert.equal(res.data.pick.playerName,'Test Prospect');assert.equal(calls.length,0);
 },{event});
 await withMock(s,'pick',async calls=>{
  const res=respond();await onlineDraftAction(request(),res,'pick');
  assert.equal(res.statusCode,409);assert.equal(calls.length,0);
 },{event:{...event,action_type:'nba_draft_started'}});
});

test('drafted ID colliding with an existing roster or pending rookie is rejected before SQL',()=>{
 const s=prepared();s.onlineDraftRights=settleOnlineDraftRights(s);
 s.onlineDraft=initializeAuthoritativeOnlineDraft(s,24680);
 const owner=s.onlineDraft.draftState.draftOrder[0].currentOwnerTeamName;
 const first=makeAuthoritativeOnlinePick(s,{actorTeam:'',forceCpu:true});
 const team=s.teams.find(t=>t.name===owner);
 team.players.push({id:first.player.id,name:'Existing player'});
 assert.throws(()=>makeAuthoritativeOnlinePick(s,{actorTeam:'',forceCpu:true}),/already exists/);
});

test('only host starts the original draft class and locked board after rights settlement',async()=>{
 const s=prepared();s.onlineDraftRights=settleOnlineDraftRights(s);
 s.onlineDraftLottery.rightsSettlement='settled';
 await withMock(s,'start',async calls=>{
  const res=respond();await onlineDraftAction(request(),res,'start');
  assert.equal(res.statusCode,200);assert.equal(calls.length,1);
  assert.equal(calls[0].body.p_draft.status,'active');
  assert.equal(calls[0].body.p_draft.draftState.draftOrder.length,60);
  assert.equal(calls[0].body.p_draft.draftState.currentPickIndex,0);
  assert.equal(s.onlineDraft,undefined);
 });
 await withMock(s,'start',async calls=>{
  const res=respond();await onlineDraftAction(request(),res,'start');
  assert.equal(res.statusCode,403);assert.equal(calls.length,0);
 },{actor:GUEST});
});
