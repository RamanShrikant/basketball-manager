// Independent validation of the ORIGINAL Python engine's proposed online market changes.
// This is defense in depth; the Supabase function repeats ownership and roster checks.
const fail = m => { const e = new Error(m); e.status=409; throw e; };
const stable = v => JSON.stringify(v);
const buckets=['players','twoWayPlayers','stashPlayers'];
const listTeams = state => Array.isArray(state?.teams) ? state.teams :
  Object.values(state?.conferences||{}).flat();
const identity = p => String(p?.id??'');
const core = p => [p?.id,p?.name,p?.age,p?.overall,p?.potential,p?.pos??p?.position,p?.contract];
const maps = state => {
 const teams=listTeams(state), teamMap=new Map(), players=new Map(), existing=new Set();
 if(teams.length!==30) fail('Expected exactly 30 teams');
 for(const t of teams){
  if(!t?.name||teamMap.has(t.name))fail('Duplicate or unnamed NBA team');
  teamMap.set(t.name,t);
  for(const bucket of buckets){
   for(const p of t[bucket]||[]){
    const id=identity(p);if(!id||existing.has(id))fail('Duplicate or missing roster player ID');
    existing.add(id);players.set(id,{team:t.name,bucket,player:p});
   }
  }
 }
 const pool=new Map();
 for(const p of state?.freeAgents||[]){const id=identity(p);
  if(!id||pool.has(id)||existing.has(id))fail('Duplicate or missing free-agent ID');
  pool.set(id,p);
 }
 return {teamMap,players,pool};
};
const sameCore=(a,b)=>stable(core(a))===stable(core(b));
export function validateResolutionRequest(mode,body){
 if(!['resolve','decision','next'].includes(mode))fail('Unknown market resolution action');
 const keys=mode==='decision'?['lobbyId','expectedRevision','requestId','kind','playerKey','choice']:
   ['lobbyId','expectedRevision','requestId'];
 const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k))||
  !uuid.test(String(body.lobbyId||''))||!uuid.test(String(body.requestId||''))||
  !Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<1) fail('Invalid market revision or request');
 if(mode==='decision'&&(!['signing','rfa'].includes(body.kind)||
  !['accept','decline','match'].includes(body.choice)||
  (body.kind==='signing'&&body.choice==='match')||
  (body.kind==='rfa'&&body.choice==='accept')||
  typeof body.playerKey!=='string'||!/^id:[^\s]{1,150}$/.test(body.playerKey)))fail('Invalid GM decision');
 return body;
}
export function verifyMarketStep(before,result,{mode,humans,actorTeam}){
 const after=result?.state;
 if(result?.ok!==true||!after||typeof after!=='object'||Array.isArray(after))fail('Original engine returned no final state');
 const permitted=new Set(['teams','conferences','freeAgents','freeAgencyState','onlineOffseasonMarket','deadCapByTeam','offseasonState']);
 for(const k of new Set([...Object.keys(before),...Object.keys(after)])){
  if(!permitted.has(k)&&stable(before[k])!==stable(after[k]))fail(`Market changed unrelated league field: ${k}`);
 }
 if(('teams' in before)!==('teams' in after)||('conferences' in before)!==('conferences' in after))
  fail('Original market switched NBA roster layout');
 const b=maps(before),a=maps(after),original=listTeams(before),updated=listTeams(after);
 if(before.conferences){
  if(stable(Object.keys(before.conferences))!==stable(Object.keys(after.conferences||{})))
   fail('Market changed NBA conference structure');
  for(const key of Object.keys(before.conferences)){
   if(stable(before.conferences[key].map(t=>t.name))!==stable((after.conferences[key]||[]).map(t=>t.name)))
    fail('Market changed conference assignments');
  }
 }
 if(original.some((t,i)=>t.name!==updated[i]?.name))fail('Market changed NBA team order');
 for(const [name,t] of b.teamMap){
  const t2=a.teamMap.get(name);
  for(const k of new Set([...Object.keys(t),...Object.keys(t2||{})])){
   if(buckets.includes(k))continue;
   if(stable(t[k])!==stable(t2?.[k]))fail('Market rewrote unrelated team data');
  }
 }
 for(const [id,prev] of b.players){
  const next=a.players.get(id);
  if(!next||next.team!==prev.team||next.bucket!==prev.bucket||!sameCore(prev.player,next.player))
   fail('Market transferred or altered a pre-existing contracted player');
 }
 const newSigned=[];
 const legitimateFillers=[];
 const generatedOk=(p,team)=>after.onlineOffseasonMarket?.status==='complete'&&
   (mode==='resolve'||mode==='next')&&!humans.includes(team)&&
   p?.generatedEmergencyFiller===true&&p?.generatedForTeamName===team&&
   p?.generatedSeasonYear===after.onlineOffseasonMarket.year&&
   new RegExp(`^cpu_min_roster_filler_${after.onlineOffseasonMarket.year}_[a-zA-Z0-9_]+_[0-9]+$`).test(String(p.id))&&
   /^Emergency (PG|SG|SF|PF|C) [0-9]+$/.test(String(p.name))&&
   Number.isInteger(p.overall)&&p.overall>=62&&p.overall<=66&&
   p.potential===p.overall+1&&Number.isInteger(p.age)&&p.age>=24&&p.age<=31&&
   p.contract?.startYear===after.onlineOffseasonMarket.year&&
   Array.isArray(p.contract?.salaryByYear)&&p.contract.salaryByYear.length===1&&
   p.contract.salaryByYear[0]>=1_000_000&&p.contract.salaryByYear[0]<=4_000_000;
 for(const [id,row] of a.players){
  if(b.players.has(id))continue;
  const from=b.pool.get(id);
  if(!from){
   if(row.bucket!=='players'||!generatedOk(row.player,row.team))fail('A signing added an unverified replacement player');
   legitimateFillers.push(id);
   continue;
  }
  if(!sameCore({...from,contract:null},{...row.player,contract:null}))
   fail('A signing altered the identity or ratings of a free agent');
  if(a.pool.has(id))fail('Player signed but remains in free agency');
  if(row.bucket!=='players')fail('Market signed a free agent to an unverified roster bucket');
  if(mode==='resolve'||mode==='next'){
   if(humans.includes(row.team))fail('CPU resolution modified a human-owned team');
  }else if(mode==='decision'){
   if(row.team!==actorTeam){
    const rights=before.freeAgencyState?.pendingRfaMatchDecisions?.find(p=>String(p.playerId)===id);
    if(!rights||rights.rightsTeamName!==actorTeam||rights.offeringTeamName!==row.team)
     fail('GM decision signed someone to an unrelated team');
   }
  }
  newSigned.push(id);
 }
 for(const [id,player] of a.pool){
  const prior=b.pool.get(id);
  if(!prior||!sameCore({...prior,contract:null},{...player,contract:null}))
   fail('Original market introduced or rewrote a free agent');
 }
 if(b.pool.size-a.pool.size!==newSigned.length)fail('Market removed a free agent without a verified roster signing');
 if(legitimateFillers.length>60)fail('Too many generated emergency replacement players');
 const oldMarket=before.freeAgencyState,newMarket=after.freeAgencyState;
 const oldStage=before.onlineOffseasonMarket,newStage=after.onlineOffseasonMarket;
 if(!oldMarket||!newMarket||!oldStage||!newStage||oldStage.status!=='active'||
  newStage.year!==oldStage.year||newStage.day!==newMarket.currentDay||
  !Number.isInteger(newStage.lastResolvedDay)||newStage.lastResolvedDay<1||newStage.lastResolvedDay>10)
  fail('Market day or league season is inconsistent');
 const p=[...(newMarket.pendingUserDecisions||[]),...(newMarket.pendingRfaMatchDecisions||[])];
 if((newMarket.pendingUserDecisions||[]).some(r=>!humans.includes(r.teamName))||
    (newMarket.pendingRfaMatchDecisions||[]).some(r=>!humans.includes(r.rightsTeamName)))
  fail('Market decision is attributed to an invalid manager');
 if(mode==='resolve'){
  if(oldStage.phase!=='offers'||oldStage.lastResolvedDay===oldStage.day||newStage.lastResolvedDay!==oldStage.day||
     ![oldStage.day,oldStage.day+1].includes(newStage.day))fail('Day resolution skipped or replayed');
 }else if(mode==='decision'){
  if(oldStage.phase!=='decisions'||newStage.day!==oldStage.day||newStage.lastResolvedDay!==oldStage.lastResolvedDay)
   fail('GM decision advanced the free agency calendar');
 }else if(mode==='next'){
  if(!['needs_next','needs_finish'].includes(oldStage.phase)||newStage.lastResolvedDay!==oldStage.day||
     newStage.day!==(oldStage.day<10?oldStage.day+1:oldStage.day))fail('Market continuation skipped dates');
 }
 if(newStage.status==='complete'){
  if(newMarket.isActive!==false||newMarket.marketComplete!==true||after.offseasonState?.freeAgencyComplete!==true||p.length)
   fail('Market marked complete with unfinished manager decisions');
 }else if(newStage.status!=='active'||newMarket.isActive!==true||
  after.offseasonState?.freeAgencyComplete===true||
  (p.length>0&&newStage.phase!=='decisions')||
  (p.length===0&&newStage.phase==='decisions'))fail('Invalid market decision checkpoint');
 if((newMarket.signedPlayersLog||[]).length < (oldMarket.signedPlayersLog||[]).length)
   fail('Market truncated signing history');
 return {newSignings:newSigned.length,emergencyFillers:legitimateFillers.length,pendingCount:p.length,phase:newStage.phase,day:newStage.day};
}
