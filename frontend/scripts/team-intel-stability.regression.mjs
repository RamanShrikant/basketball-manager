import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { captureIntelSnapshot, compareIntelSnapshots, saveIntelCapture, diffIntelCaptures, listIntelCaptures } from "../src/utils/teamIntelDiagnostics.js";
import { startIntelCpuPythonProbe } from "../src/utils/teamIntelPythonProbe.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");
const mem = new Map();
const localStorage = {getItem:(key)=>mem.get(key) ?? null, setItem:(key,value)=>mem.set(key,String(value))};
const code = read("src/utils/teamIntelLifecycle.js")
  .replace(/^import\s+(?:[\s\S]*?\s+from\s+)?["'][^"']+["'];\s*$/gm, "")
  .replace(/^export\s+/gm, "");
const env = {localStorage, Set, Map, JSON, Object, Math, Number, String, Array,
  getOffseasonTradeContext:()=>({}), getUserTradeDeadlineStatus:()=>({locked:false}),
  getContractSeasonYear:()=>2035, getSeasonStartYear:()=>2035};
vm.runInNewContext(`${code}\nthis.lib={intelLiveSignature,intelStoredInputSignature}`,env);
const {intelLiveSignature,intelStoredInputSignature} = env.lib;
const season = {signature:"live_market|2035",mode:"live_market",stage:"pre_deadline",seasonYear:2035,payrollYear:2035,draftYear:2036};
const fresh = () => ({leagueName:"year 10",seasonYear:2035,teams:[
  {name:"Alpha",players:[{id:"a",name:"Alpha G",overall:74,potential:78,pos:"PG",age:22,contract:{salaryByYear:[2e6]}},{id:"c",name:"Alpha F",overall:84,age:29}]},
  {name:"Bravo",players:[{id:"b",name:"Bravo F",overall:79,potential:84,pos:"SF",age:26}]},
  {name:"User",players:[{id:"u",name:"User C",overall:76,potential:87,pos:"C",age:24}]}],
  draftPicks:[{id:"p1",year:2036,round:1,status:"active",originalTeam:"Alpha",ownerTeam:"User"}],tradeHistory:[]});
const league = fresh();
const untouched = JSON.stringify(league);
const view = (team, opts={})=>captureIntelSnapshot({leagueData:league,controlledTeam:"User",scoutedTeam:team,lifecycle:season,
 signature:intelLiveSignature(league, season),observation:{teams:[{name:"Alpha",phase:opts.phase || "retooling",record:{wins:24,losses:28}}]},
 market:{cpuSource:{phase:opts.cpuPhase || "seller"},available:opts.available || [],targets:opts.targets || [],userAssets:[],core:[]}});
const first=view("Alpha",{targets:[{id:"b",name:"Bravo F",sourceTeam:"Bravo",evidence:{kind:"cpu_market_watch"}}]});
assert.equal(JSON.stringify(league),untouched,"snapshot never mutates league");
assert.equal(listIntelCaptures().length,0);
const lastSignature = intelLiveSignature(league,season);
league.teams[0].players[0].secondaryPos="SG";
assert.notEqual(intelLiveSignature(league,season),lastSignature,"secondary position edit triggers refresh");
league.teams[0].players[0].isTwoWay=true;
const statusSig=intelLiveSignature(league,season);
league.teams[0].players[0].isTwoWay=false;
assert.notEqual(intelLiveSignature(league,season),statusSig,"two-way status triggers refresh");
const capSig=intelLiveSignature(league,season);
league.salaryCap=175_000_000;
assert.notEqual(intelLiveSignature(league,season),capSig,"cap change triggers refresh");
const savedSig=intelStoredInputSignature(league.teams);
localStorage.setItem("gameplan_Alpha",'{"minutes":{"Alpha G":32}}');
assert.notEqual(intelStoredInputSignature(league.teams),savedSig,"rotation storage triggers refresh");
const resSig=intelStoredInputSignature(league.teams);
localStorage.setItem("bm_results_index_v3",'["game-101"]');
assert.notEqual(intelStoredInputSignature(league.teams),resSig,"new result index triggers refresh");
// Trade #1: Alpha G for Bravo F. Both membership changes must register.
const alphaG=league.teams[0].players.shift(), bravoF=league.teams[1].players.shift();
league.teams[0].players.push(bravoF); league.teams[1].players.push(alphaG);
league.tradeHistory.push({id:"trade-1",fromTeamName:"Alpha",toTeamName:"Bravo"});
const afterOne=view("Alpha",{available:[{id:"b",name:"Bravo F",sourceTeam:"Alpha",evidence:{kind:"cpu_outgoing_board"}}]});
const d1=compareIntelSnapshots(first,afterOne);
assert.equal(d1.tradeCountDelta,1);
assert.equal(d1.movedPlayers.length,2);
assert.equal(d1.panelChanges.targets.removed.length,1);
assert.equal(d1.panelChanges.available.added.length,1);
// Trade #2 moves a player to the user, updates a pick owner, attributes,
// standings and CPU direction — before another React route reload.
const userC=league.teams[2].players.shift();
const justArrived=league.teams[0].players.shift();
league.teams[2].players.push(justArrived); league.teams[0].players.push(userC);
league.draftPicks[0].ownerTeam="Bravo";
league.teams[0].players[0].overall=83;
league.tradeHistory.push({id:"trade-2",fromTeamName:"User",toTeamName:"Alpha"});
const afterTwo=view("Alpha",{phase:"contending",cpuPhase:"buyer"});
const d2=compareIntelSnapshots(afterOne,afterTwo);
assert.equal(d2.tradeCountDelta,1);
assert.equal(d2.movedPlayers.length,2);
assert.equal(d2.pickChanges.length,1);
assert.ok(d2.teamChanges.length || Object.keys(d2.stateChanges).includes("cpuPhase"));
assert.equal(d2.stateChanges.cpuPhase.after,"buyer");
assert.equal(compareIntelSnapshots(first,afterTwo).tradeCountDelta,2,"multiple trades counted across capture range");
saveIntelCapture("before",{leagueData:fresh(),lifecycle:season,scoutedTeam:"Alpha",controlledTeam:"User"});
saveIntelCapture("after",{leagueData:league,lifecycle:season,scoutedTeam:"Alpha",controlledTeam:"User"});
assert.equal(diffIntelCaptures("before","after").tradeCountDelta,2);
assert.equal(listIntelCaptures().length,2);
// Market rumor from March of a previous *season* must be discarded in Oct.
const overlay=read("src/utils/teamIntelCpuOverlay.js").replace(/^import\s+.*?;\s*$/gm,"").replace(/^export\s+/gm,"");
const mock={Set, Map, JSON, Object, Number, String, Array};
vm.runInNewContext(`${overlay}\nthis.lib={matchingIntelRumors}`,mock);
const rumor=(date)=>({id:date,teamNames:["Alpha"],type:"rumor",date,headline:`Talks ${date}`});
assert.equal(mock.lib.matchingIntelRumors([rumor("2035-03-12")],"Alpha",{seasonStartYear:2035}).length,0);
assert.equal(mock.lib.matchingIntelRumors([rumor("2035-10-12")],"Alpha",{seasonStartYear:2035}).length,1);
// The same worker should survive two independent scouting requests, and an
// obsolete callback must not fire after an effect cleanup.
const originalWorker=globalThis.Worker;
let created=0, terminated=0, messages=[];
globalThis.Worker=class {
  constructor() {created++;messages.push(this);}
  postMessage(m) {queueMicrotask(()=>this.onmessage?.({data:{id:m.id,ok:true,value:{userTeamName:m.payload.userTeamName}}}));}
  terminate(){terminated++;}
};
try {
  const one=await new Promise((resolve,reject)=>startIntelCpuPythonProbe({userTeamName:"User"},{onResult:resolve,onError:reject}));
  const two=await new Promise((resolve,reject)=>startIntelCpuPythonProbe({userTeamName:"Bravo"},{onResult:resolve,onError:reject}));
  assert.equal(one.userTeamName,"User");assert.equal(two.userTeamName,"Bravo");
  assert.equal(created,1,"one persistent Python worker, not one per scan");
  assert.equal(terminated,0);
  let obsolete=false;
  const stop=startIntelCpuPythonProbe({userTeamName:"Old"},{onResult:()=>{obsolete=true;}});
  stop();await Promise.resolve();await Promise.resolve();
  assert.equal(obsolete,false,"stale worker result never leaks after franchise switch");
} finally {globalThis.Worker=originalWorker;}
console.log("PASS Intel stability: 2 consecutive trades, picks and players moved, salary/cap, position/two-way, saved results, gameplans, CPU direction, old rumors, persistent worker, stale cancellation");
