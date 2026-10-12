import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LEAGUE_INTEL_LAYOUT, leagueIntelTuningVars } from "../src/config/leagueIntelLayout.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(resolve(root, "src/utils/teamIntelCpuOverlay.js"), "utf8");
const page = readFileSync(resolve(root, "src/pages/Intel_v1.jsx"), "utf8");
const py = readFileSync(resolve(root, "public/python/league_intel_readonly.py"), "utf8");
const css = readFileSync(resolve(root, "src/styles/BMLeagueIntel.css"), "utf8");

// Preserve the EXACT latest user-configured values. All UI sections stay independent.
assert.deepEqual(LEAGUE_INTEL_LAYOUT.starters.headshot, {x:15,y:-2.6,scale:1,borderWidth:0});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.starters.name, {x:45,y:0,scale:1});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.starters.ring, {x:15,y:-35,scale:.7,strokeWidth:8});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.scoutingRows.headshot, {x:20,y:10,scale:1.7,borderWidth:0});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.scoutingRows.name, {x:40,y:0,scale:1});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.scoutingRows.ring, {x:25,y:-5,scale:1.1,strokeWidth:7});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.scoutingRows.ringText, {x:0,y:0,scale:.8});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.scoutingRows.position, {x:40,y:0,scale:1});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.scoutingRows.age, {x:40,y:0,scale:1});
for(const section of ["starters","scoutingRows","teamNeeds","expiringDeals","fullRoster"]){
  for(const layer of ["headshot", "name", "ring"]){
    assert.ok(LEAGUE_INTEL_LAYOUT[section][layer], `${section}: ${layer} preserved`);
  }
  assert.ok(leagueIntelTuningVars(section)["--bm-il-ring-text-tune"]);
}
assert.deepEqual(LEAGUE_INTEL_LAYOUT.teamNeeds.pickLogo, {x:0,y:0,scale:1,opacity:.36});
assert.deepEqual(LEAGUE_INTEL_LAYOUT.teamNeedsPlayers.headshot, LEAGUE_INTEL_LAYOUT.scoutingRows.headshot);
assert.deepEqual(LEAGUE_INTEL_LAYOUT.teamNeedsPlayers.ring, LEAGUE_INTEL_LAYOUT.scoutingRows.ring);
assert.deepEqual(LEAGUE_INTEL_LAYOUT.teamNeedsPlayers.name, LEAGUE_INTEL_LAYOUT.scoutingRows.name);
assert.deepEqual(LEAGUE_INTEL_LAYOUT.expiringDeals.ring, {x:0,y:0,scale:1,strokeWidth:7});

assert.match(page, /title="TEAM NEEDS: PLAYERS"/);
assert.match(page, /title="TEAM NEEDS: PICKS"/);
assert.doesNotMatch(page, /title="EXPIRING DEALS"/);
assert.match(page, /playerNeeds\.length \? playerNeeds\.map/);
assert.match(page, /pickNeeds\.length \? pickNeeds\.map/);
assert.match(page, /pickOriginLogo\(need, displayLeague, liveTeams\)/);
assert.match(page, /leagueIntelTuningVars\("teamNeeds"\)/);
assert.match(css, /\.bm-il-need--split/);
assert.match(py, /user_player_values\[:12\] \+ user_pick_values\[:12\]/);
assert.doesNotMatch(py, /user_pick_values\[:1\] \+ user_player_values\[:1\]/);

// Synthetic Intel fixture with enough candidate players and picks, where the
// most valuable pick is restricted. It MUST still populate two legal pick rows.
const userPlayers=Array.from({length:4},(_,n)=>({id:`u${n}`,name:`User Player ${n}`,pos:'SG',overall:75+n,potential:81,age:24}));
const pickRows=Array.from({length:4},(_,n)=>({id:`pick${n}`,year:2027+n,round:1,originalTeam:'User',ownerTeam:'User',status:'active'}));
const league={seasonYear:2026,teams:[{name:'Opponent',players:[{id:'op',name:'Opponent PG',overall:80}]},{name:'User',players:userPlayers}],draftPicks:pickRows};
const before=JSON.stringify(league);
const valued=[
 ...userPlayers.map((p,n)=>({id:p.id,name:p.name,sourceTeam:'User',kind:'player',value:100-n})),
 ...pickRows.map((p,n)=>({id:p.id,kind:'pick',sourceTeam:'User',value:100-n,year:p.year,round:1,originalTeam:'User'})),
];
const data={teams:{Opponent:{valuedUserAssets:valued}}};
const ctx={console,Set,Map,Object,Array,String,Number, getUserTradePickEligibility:({pick})=>({ok:pick.id!=='pick0'})};
vm.runInNewContext(`${src.replace(/^import\s+.*?;\s*$/gm,"").replace(/^export\s+/gm,"")}\nthis.api={presentCpuIntel,validateCpuIntelDisplay}`,ctx);
const market=ctx.api.presentCpuIntel({snapshot:{bank:{observedCandidates:[]}},team:{name:'Opponent',rosterLeaders:[]},leagueData:league,userTeamName:'User',cpuReadOnly:data});
assert.equal(market.userPlayerNeeds.length,2);
assert.equal(market.userPickNeeds.length,2);
assert.deepEqual(Array.from(market.userPlayerNeeds,p=>p.name),['User Player 0','User Player 1']);
assert.deepEqual(Array.from(market.userPickNeeds,p=>p.id),['pick1','pick2']);
assert.equal(market.userAssets.length,4);
assert.equal(ctx.api.validateCpuIntelDisplay({market,leagueData:league,userTeamName:'User'}).ok,true);
assert.equal(JSON.stringify(league),before,'Intel must never write to league state');
console.log('PASS Team Needs split: 2 players, 2 legally eligible picks, fallback after restricted pick, saved manual settings, read-only');
