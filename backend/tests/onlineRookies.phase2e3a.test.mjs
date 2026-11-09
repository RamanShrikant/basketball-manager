import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runOriginalRookieEngine,onlineRookieSigningsRequest} from '../onlineRookieSignings.js';
const HOST='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',GUEST='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOBBY='cccccccc-cccc-4ccc-8ccc-cccccccccccc',REQUEST='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const mk=(team,id,pick,round=1)=>({id,name:`Prospect ${id}`,age:19,overall:round===1?72:62,potential:85,
 pos:'PG',team,contractType:'unsigned_rookie',contract:{type:'unsigned_rookie',startYear:2027,pendingRookieSigning:true,salaryByYear:[]},
 meta:{draftYear:2027,draftPick:pick,draftRound:round},rookieSigningPending:true});
function fixture(){
 const teams=Array.from({length:30},(_,i)=>({name:`Team ${i+1}`,players:[{id:`old-${i+1}`,name:'Veteran',overall:79}],twoWayPlayers:[],stashPlayers:[],pendingRookieSignings:[]}));
 const a=mk('Team 1','r1',1),b=mk('Team 2','r2',32,2),c=mk('Team 3','r3',3),d=mk('Team 4','r4',44,2);
 teams[0].pendingRookieSignings=[a];teams[1].pendingRookieSignings=[b];
 teams[2].pendingRookieSignings=[c];teams[3].pendingRookieSignings=[d];
 const order=Array.from({length:60},(_,i)=>({pick:i+1,currentOwnerTeamName:`Team ${(i%30)+1}`}));
 return {teams,freeAgents:[],onlineDraftRights:{status:'settled',draftYear:2027},
  onlineDraft:{status:'complete',draftYear:2027,draftState:{completed:true,draftOrder:order,draftedPicks:order.map((p,i)=>({playerId:['r1','r2','r3','r4'][i]||`draft-other-${i}`,teamName:`Team ${(i%30)+1}`}))}}};
}
const response=()=>({statusCode:200,set(){return this;},status(n){this.statusCode=n;return this;},json(x){this.data=x;return this;}});
function request(kind,opts={}){return {body:{lobbyId:LOBBY,expectedRevision:9,
  ...(kind!=='preview'?{requestId:REQUEST}:{}),...(kind==='sign'?{decisions:{r1:'standard'}}:{}),...opts},
  get:()=>`Bearer ${'x'.repeat(42)}`};}
async function mocked(state,fn,{actor=HOST,revision=9,memberTeam='Team 1',host=HOST,events=[],members=['Team 1','Team 2'],rpcOk=true}={}){
 const saved=globalThis.fetch,oldU=process.env.SUPABASE_URL,oldK=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://mock.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='server-secret';
 const writes=[];
 globalThis.fetch=async(url,opts={})=>{
  if(url.includes('/auth/v1/user'))return new Response(JSON.stringify({id:actor}));
  if(url.includes('/bm_online_lobbies'))return new Response(JSON.stringify([{host_id:host,status:'started'}]));
  if(url.includes('/bm_online_lobby_members'))return new Response(JSON.stringify(members.map((name,i)=>({user_id:i===0?actor:i===1?GUEST:`ee${i}`,team_name:name}))));
  if(url.includes('/bm_online_franchise_events'))return new Response(JSON.stringify(events));
  if(url.includes('/bm_online_franchise_runtime'))return new Response(JSON.stringify([{state,revision}]));
  if(url.includes('/rpc/')){writes.push({url,body:JSON.parse(opts.body)});return new Response(JSON.stringify(rpcOk?{ok:true,revision:revision+1,complete:false}:{ok:false}),{status:rpcOk?200:409});}
  throw Error('Unexpected network call: '+url);
 };
 try{return await fn(writes);}finally{globalThis.fetch=saved;
   if(oldU===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldU;
   if(oldK===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldK;
 }
}

test('original preview returns recommendation without modifying shared input',()=>{
 const s=fixture(),before=JSON.stringify(s);const data=runOriginalRookieEngine(s,{mode:'preview',teamNames:['Team 1'],draftYear:2027});
 assert.equal(data.rows.length,1);assert.equal(data.rows[0].recommendedDecision,'standard');assert.equal(JSON.stringify(s),before);
});
for(const decision of ['standard','two_way','stash','release'])test(`original contract path ${decision} stays unsigned until commit and retains ratings`,()=>{
 const s=fixture(),before=JSON.stringify(s),data=runOriginalRookieEngine(s,{mode:'human',teamNames:['Team 1'],draftYear:2027,decisions:{r1:decision}});
 assert.equal(JSON.stringify(s),before);
 assert.equal(data.actions.length,1);const rookie=data.actions[0].rookies[0];
 assert.equal(rookie.decision,decision);assert.equal(rookie.player.overall,72);
 assert.equal(rookie.player.meta.draftPick,1);assert.equal(rookie.player.rookieSigningPending,false);
 assert.equal(rookie.player.meta.rookieSigningDecision,decision);
 assert.equal(rookie.player.contract.type,decision==='release'?'free_agent':decision);
 assert.equal(rookie.player.contract.startYear,decision==='stash'?2028:2027);
 assert.equal(s.teams[0].pendingRookieSignings.length,1);
});
test('CPU decisions are original and exclude the two human rosters, no saved snapshot mutation',()=>{
 const s=fixture(),before=JSON.stringify(s),x=runOriginalRookieEngine(s,{mode:'cpu',teamNames:['Team 3','Team 4'],draftYear:2027});
 assert.deepEqual(x.actions.map(a=>a.teamName),['Team 3','Team 4']);
 assert.equal(x.actions.reduce((n,a)=>n+a.rookies.length,0),2);
 assert.equal(JSON.stringify(s),before);
 assert.throws(()=>runOriginalRookieEngine(s,{mode:'cpu',teamNames:['Team 3'],draftYear:2027,decisions:{r3:'release'}}));
});
test('human GM signs only their own rookie and trusted SQL receives only transformed rookies',async()=>{
 await mocked(fixture(),async writes=>{
  const res=response();await onlineRookieSigningsRequest(request('sign'),res,'sign');
  assert.equal(res.statusCode,200);assert.equal(writes.length,1);assert.equal(writes[0].body.p_mode,'human');
  const x=writes[0].body.p_actions[0];assert.equal(x.teamName,'Team 1');assert.equal(x.rookies[0].id,'r1');
  assert.ok(!('teams' in writes[0].body));assert.equal(x.rookies[0].player.contract.type,'standard');
 });
});
test('host CPU batch excludes human managers and resolves all pending CPU rookies',async()=>{
 await mocked(fixture(),async writes=>{
  const res=response();await onlineRookieSigningsRequest(request('cpu'),res,'cpu');
  assert.equal(res.statusCode,200);assert.equal(writes.length,1);
  assert.deepEqual(writes[0].body.p_actions.map(a=>a.teamName),['Team 3','Team 4']);
  assert.equal(res.data.count,2);
 });
});
test('non-host cannot decide CPU rookie contracts',async()=>{
 await mocked(fixture(),async writes=>{
  const res=response();await onlineRookieSigningsRequest(request('cpu'),res,'cpu');
  assert.equal(res.statusCode,403);assert.equal(writes.length,0);
 },{host:GUEST});
});
test('stale revision, incomplete draft and unauthorized user reject before Python or SQL',async()=>{
 await mocked(fixture(),async writes=>{
  const res=response();await onlineRookieSigningsRequest(request('sign'),res,'sign');assert.equal(res.statusCode,409);assert.equal(writes.length,0);
 },{revision:10});
 const incomplete=fixture();incomplete.onlineDraft.status='active';
 await mocked(incomplete,async writes=>{
  const res=response();await onlineRookieSigningsRequest(request('sign'),res,'sign');assert.equal(res.statusCode,409);assert.equal(writes.length,0);
 });
 await mocked(fixture(),async writes=>{
  const res=response();await onlineRookieSigningsRequest(request('sign'),res,'sign');assert.equal(res.statusCode,403);assert.equal(writes.length,0);
 },{members:[]});
});
test('replay must match actor, action and input hash; no second roster write',async()=>{
 const crypto=await import('node:crypto');
 const hash=crypto.createHash('sha256').update(JSON.stringify({action:'sign',team:'Team 1',decisions:{r1:'standard'}})).digest('hex');
 const event={actor_id:HOST,action_type:'rookie_signings_human',revision:13,details:{requestInputHash:hash}};
 await mocked(fixture(),async writes=>{
  const res=response();await onlineRookieSigningsRequest(request('sign'),res,'sign');
  assert.equal(res.statusCode,200);assert.equal(res.data.replayed,true);assert.equal(writes.length,0);
 },{events:[event]});
 await mocked(fixture(),async writes=>{
  const res=response();await onlineRookieSigningsRequest(request('sign',{decisions:{r1:'release'}}),res,'sign');
  assert.equal(res.statusCode,409);assert.equal(writes.length,0);
 },{events:[event]});
});
test('duplicate rookie in signed roster, bad GM choices and SQL failure leave no accepted action',async()=>{
 const duplicated=fixture();duplicated.teams[3].players.push({...duplicated.teams[0].pendingRookieSignings[0]});
 await mocked(duplicated,async writes=>{
  const res=response();await onlineRookieSigningsRequest(request('sign'),res,'sign');
  assert.equal(res.statusCode,409);assert.equal(writes.length,0);
 });
 await mocked(fixture(),async writes=>{
  const res=response();await onlineRookieSigningsRequest(request('sign',{decisions:{r1:'bad'}}),res,'sign');
  assert.equal(res.statusCode,400);assert.equal(writes.length,0);
 });
 await mocked(fixture(),async writes=>{
  const res=response();await onlineRookieSigningsRequest(request('sign'),res,'sign');
  assert.equal(res.statusCode,409);assert.equal(writes.length,1);
 },{rpcOk:false});
});
test('online-only migration contains independent server ownership, replay, provenance and atomic state checks',()=>{
 const sql=readFileSync(new URL('../../supabase/bm_online_rookie_signings_phase2e3a.sql',import.meta.url),'utf8');
 for(const text of ['for update','rookieSigningPending','onlineDraft','onlineDraftRights','rookie_signings_cpu',
  'p_input_hash','v_prev.details','current_setting','service_role','pg_catalog.jsonb_set',
  'pendingRookieSignings','bm_online_rookie_signing_guard_phase2e3a'])assert.ok(sql.includes(text),text);
 assert.ok(sql.includes('revoke all on function public.bm_online_apply_rookie_signings_phase2e3a'));
});

test('generated official 2E.2 draft rookie signs with original first-round salary and rights; state stays immutable',async()=>{
 const {initializeAuthoritativeOnlineDraft,makeAuthoritativeOnlinePick}=await import('../onlineDraftActions.js');
 const names=Array.from({length:30},(_,i)=>`NBA ${i+1}`);
 const order=Array.from({length:60},(_,i)=>({pick:i+1,round:Math.floor(i/30)+1,
   pickInRound:i%30+1,originalTeamName:names[i%30],teamName:names[i%30],currentOwnerTeamName:names[i%30]}));
 const s={teams:names.map(name=>({name,players:[],pendingRookieSignings:[],twoWayPlayers:[]})),freeAgents:[],
   onlineDraftRights:{status:'settled',draftYear:2027,seasonYear:2026,order}};
 s.onlineDraft=initializeAuthoritativeOnlineDraft(s,72027);
 const one=makeAuthoritativeOnlinePick(s,{actorTeam:'',forceCpu:true});
 s.teams[0].pendingRookieSignings.push(one.player);
 const before=JSON.stringify(s);
 const decision=runOriginalRookieEngine(s,{mode:'human',teamNames:[names[0]],draftYear:2027,
   decisions:{[String(one.player.id)]:'standard'}}).actions[0].rookies[0];
 assert.equal(JSON.stringify(s),before);
 assert.equal(decision.id,one.player.id);
 assert.equal(decision.player.contract.salaryByYear.length,4);
 assert.equal(decision.player.rights.rookieScale,true);
 assert.equal(decision.player.rights.heldByTeam,names[0]);
 assert.equal(decision.player.meta.draftYear,2027);
 assert.equal(decision.player.overall,one.player.overall);
});
