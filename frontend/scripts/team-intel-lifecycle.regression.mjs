import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const lib = (path, injection, exports) => {
  const code = read(path).replace(/^import\s+(?:[\s\S]*?\s+from\s+)?["'][^"']+["'];\s*$/gm, "").replace(/^export\s+/gm, "");
  const sandbox = { ...injection, Set, Map, Object, Array, String, Number, Boolean, JSON, Math, Date };
  vm.runInNewContext(`${code}\nthis.api = { ${exports.join(", ")} };`, sandbox);
  return sandbox.api;
};
const baseline = (start) => ({
  leagueName: `${start}-${start+1}`, seasonStartYear: start,
  seasonYear: start, contractSeasonYear: start,
  teams: [{name: "CPU", players: [{id:"x", name:"Veteran", salary:21000000, yearsLeft:3,
    contract: {startYear:start, salaryByYear:[18000000]}}]}, {name:"User", players:[{id:"u", name:"Young",overall:80}]}],
  draftPicks:[{id:"pick-1", year:start+1, round:1, ownerTeam:"User", originalTeam:"CPU", status:"active", assetType:"pick", pickNumber:1}],
});
const draft = {version:4, inOffseason:false, stage:"regular_season", seasonYear:2027,
  targetContractSeasonYear:2027, lotteryRevealed:false, draftOrderLocked:false,
  draftComplete:false, draftInProgress:false};
const ctx = (extra={}) => ({...draft,...extra});
const flags = (data, overrides={}) => lifecycle.resolveIntelLifecycle(data, {
  context:ctx(overrides), deadline:{locked:false}, clockPhase:"regular_season"});
const lifecycle = lib("src/utils/teamIntelLifecycle.js", {
  getOffseasonTradeContext:()=>ctx(), getUserTradeDeadlineStatus:()=>({locked:false}),
  getContractSeasonYear:(l)=>l.contractSeasonYear,
  getSeasonStartYear:(l)=>l.seasonStartYear,
  getLiveDraftProgressSignature:()=>"2027:0:0:0", isResolvedPickConsumed:(pick)=>Boolean(pick.consumed),
  isResolvedDraftPickAsset:(pick)=>pick.assetType==="resolved",
}, ["resolveIntelLifecycle","intelVisiblePick","intelVisibleDraftPicks","intelLiveSignature"]);
for (const year of [2026,2027,2030,2035,2040]) {
  const league=baseline(year);
  const live=flags(league);
  assert.equal(live.mode,"live_market");
  assert.equal(live.scansEnabled,true);
  assert.equal(live.payrollYear,year);
  assert.equal(flags(league,{inOffseason:false}).stage,"pre_deadline");
  assert.equal(lifecycle.resolveIntelLifecycle(league,{context:ctx(),deadline:{locked:true},clockPhase:"regular_season"}).mode,"future_outlook");
  assert.equal(lifecycle.resolveIntelLifecycle(league,{context:ctx(),deadline:{locked:false},clockPhase:"playoffs"}).mode,"future_outlook");
  const summer = lifecycle.resolveIntelLifecycle(league,{context:ctx({inOffseason:true,stage:"pre_lottery",seasonYear:year+1,targetContractSeasonYear:year+1}),deadline:{locked:true}});
  assert.equal(summer.mode,"offseason_market");
  assert.equal(summer.payrollYear,year+1);
  const exact = {...league.draftPicks[0],year:year+1,pickNumber:1,overallPick:1,lotterySlot:1};
  const hidden=lifecycle.intelVisiblePick(exact,summer,league);
  assert.ok(hidden);
  assert.equal(hidden.pickNumber,undefined);
  assert.equal(hidden.overallPick,undefined);
  assert.equal(hidden.lotterySlot,undefined);
  const resolved=lifecycle.intelVisiblePick({...exact,assetType:"resolved"},summer,league);
  assert.equal(resolved,null,"no resolved lottery information before reveal");
  const revealed={...summer,lotteryRevealed:true,stage:"post_lottery_pre_draft"};
  assert.equal(lifecycle.intelVisiblePick(exact,revealed,league).pickNumber,1);
  const during={...revealed,draftInProgress:true,stage:"live_draft"};
  assert.equal(lifecycle.intelVisiblePick({...exact,consumed:true},during,league),null);
  assert.equal(lifecycle.intelVisiblePick(exact,{...during,draftComplete:true},league),null);
  assert.notEqual(lifecycle.intelLiveSignature(league,live),lifecycle.intelLiveSignature({...league,draftPicks:[{...league.draftPicks[0],ownerTeam:"CPU"}]},live));
  const py=lib("src/utils/teamIntelPythonProbe.js",{},["buildIntelCpuPythonPayload"]);
  const payload=py.buildIntelCpuPythonPayload(league,{teams:[]},"User",summer);
  assert.equal(payload.leagueData.seasonYear,year+1,"CPU Python payload advances salary year");
  assert.equal(payload.leagueData.leagueName,"","old franchise league name cannot override current payroll year");
}
const obs = lib("src/utils/teamIntelObserver.js",{
  getContractSeasonYear:(l)=>l.contractSeasonYear,
  getLeagueFinancialRules:(_league,year)=>({salaryCap:year*1_000_000}),
  isStandardRosterPlayer:()=>true
},["observeLeagueIntel"]);
const lg=baseline(2040);
let shot=obs.observeLeagueIntel(lg,{payrollSeasonYear:2040});
assert.equal(shot.teams.find(t=>t.name==="CPU").finance.standardRosterPayroll,18000000);
shot=obs.observeLeagueIntel(lg,{payrollSeasonYear:2041});
assert.equal(shot.teams.find(t=>t.name==="CPU").finance.standardRosterPayroll,0,"expired salary must not be resurrected from direct salary");
assert.equal(shot.teams.find(t=>t.name==="CPU").expiringContracts.length,0);
const offseasonShot=obs.observeLeagueIntel(lg,{payrollSeasonYear:2041,upcomingFinancialYear:true});
assert.equal(offseasonShot.teams[0].finance.salaryCap,2042_000_000,"offseason cap must come from upcoming existing league financial rules");
const overlay=lib("src/utils/teamIntelCpuOverlay.js",{
  scanCpuTradeMarket:async()=>{throw Error("not executed during outlook")},
  evaluateTradeTeamImpact:()=>({accepted:false}),
  buildOffseasonTradeEvaluationLeague:()=>{throw Error("not executed during outlook")},
  validateUserTradeRules:()=>({ok:false}),isResolvedPickConsumed:()=>false
},["scanIntelCpuEvidence","presentCpuIntel"]);
const closed=await overlay.scanIntelCpuEvidence({leagueData:lg,focusTeamName:"CPU",userTeamName:"User",lifecycle:{mode:"future_outlook"}});
assert.equal(closed.complete,true);assert.equal(closed.disabled,"trade_window_locked");
const mockTeam={name:"CPU",outgoingMarketPlayers:[{id:"x",name:"Veteran"}],incomingMarketTargets:[],rosterLeaders:[]};
const mockSnapshot={bank:{observedCandidates:[{fromTeamName:"CPU",toTeamName:"User"}]}};
const rendered=overlay.presentCpuIntel({snapshot:mockSnapshot,team:mockTeam,leagueData:lg,userTeamName:"User",feed:[],lifecycle:{mode:"future_outlook"}});
assert.equal(rendered.bankCount,0);
assert.equal(rendered.available.length,0,"no stale saved CPU-bank offers after deadline");
assert.equal(rendered.targets.length,0);
const ui=read("src/pages/Intel_v1.jsx");
assert.match(ui,/lifecycle\.scansEnabled/);
assert.match(ui,/const key = scanKey;/,"market scan writes cache under same key the UI reads");
assert.match(ui,/cpuRuntime\.data\.userTeamName === userTeamName/,"old franchise results never surface as current CPU evidence");
assert.match(ui,/signatureRef/);
assert.match(ui,/displayLeague/);
assert.doesNotMatch(ui,/setLeagueData\s*\(/);
console.log("PASS Intel lifecycle: predeadline unchanged, deadline/playoffs, offseason salaries, lottery reveal, live draft consumption, years 1/2/5/10/15, stale bank, controlled async scan switch");
