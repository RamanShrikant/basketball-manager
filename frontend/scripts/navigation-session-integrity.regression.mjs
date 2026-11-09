import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const app = read("src/App.jsx");
const main = read("src/main.jsx");
const play = read("src/pages/Play.jsx");
const gate = read("src/navigation/FranchiseRouteGate.jsx");
const sb = read("src/components/TeamHubSidebar.jsx");
const online = read("src/online/OnlineApp.jsx");
const auth = read("src/auth/AccountRoot.jsx");

assert.match(app, /<Route element={<FranchiseRouteGate \/>}>/);
assert.match(app, /<Route path="\/team-selector"/);
assert.match(app, /<Route path="\/team-hub"/);
assert.match(app, /<Route path="\/roster-view"/);
assert.match(app, /<Route path="\/free-agents"/);
assert.match(app, /<Route path="\*" element={<Navigate to="\/game-modes" replace \/>}/);
assert.match(gate, /getActiveLeagueSaveId\(\)/);
assert.match(gate, /getLeagueSave\(saveId\)/);
assert.match(gate, /Recover to empty save slot/);
assert.match(gate, /Export emergency backup/);
assert.match(gate, /Leave after backup/);
assert.match(gate, /!exported/);
assert.match(gate, /Exit without backup \(last resort\)/);
assert.match(sb, /Exit without saving \(last resort\)/);
assert.match(main, /window\.location\.pathname === "\/online"/);
assert.match(online, /href="\/game-modes"/);
assert.match(sb, /exitToLeagueSlots\(\)/);
assert.match(play, /navigate\("\/game-modes"\)/);
assert.match(auth, /onAuthStateChange/);

// Execute the real exit coordinator with synthetic dependencies. The test is
// browser/DB independent but covers the critical result-state contract.
let source = read("src/navigation/franchiseExit.js");
source = source.replace(/^import\s+[\s\S]*?\s+from\s+["'][^"']+["'];\s*/gm, "");
source = source.replace(/\bexport (?=(?:async )?function\b)/g, "");
const factory = new Function("deps", `with (deps) { ${source}; return { saveFranchiseForExit, recoverUnlinkedFranchise, assertFranchiseSimulationPaused }; }`);
const league = { teams: [{ name: "Atlanta Hawks" }] };
const save = { saveId: "s1", updatedAt: "2026-11-02T00:00:00.000Z", snapshot: { leagueData: league } };
let calls, activeId, mode, uploadError, currentSave, slots, pending;
function reset(){
  calls=[];activeId="s1";mode="local";uploadError=null;currentSave=save;slots=[];pending={};
}
const deps = {
  localStorage: { getItem: k => pending[k] || null },
  getActiveLeagueSaveId: () => activeId,
  getLeagueSave: async () => { calls.push("read"); return currentSave; },
  flushAllLeagueRuntimeWrites: async () => { calls.push("flush"); },
  checkpointActiveLeagueSave: async () => { calls.push("checkpoint"); return save; },
  flushLeagueSaveSlotWrites: async () => { calls.push("flushSlots"); },
  activeBrowserAccountId: () => "account1",
  getAccountSaveMode: () => mode,
  uploadCloudSave: async () => { calls.push("cloud"); if(uploadError) throw uploadError; },
  notifyCloudSaveStatus: () => {},
  listLeagueSaves: async () => slots,
  findFirstAvailableLeagueSaveSlot: (items, n) => items.length >= n ? null : items.length,
  createLeagueSave: async () => { calls.push("create");activeId="s1";return save; },
  captureActiveLeagueRuntime: async () => ({ leagueData: league, runtime: {} }),
  MAX_LEAGUE_SAVE_SLOTS: 10,
};
const {saveFranchiseForExit:exit, recoverUnlinkedFranchise:recover} = factory(deps);
reset();
let result=await exit({leagueData:league});
assert.equal(result.status,"saved");
assert.deepEqual(calls,["read","flush","checkpoint","flushSlots","read"]);
reset();mode="cloud";uploadError=new Error("network down");
result=await exit({leagueData:league});
assert.equal(result.status,"cloud-failed");
assert.equal(result.saved.saveId,"s1");
assert.equal(calls.at(-1),"cloud");
reset();activeId="";
assert.equal((await exit({leagueData:null})).status,"empty");
assert.deepEqual(calls,[]);
reset();activeId="";
result=await exit({leagueData:league});
assert.equal(result.status,"unlinked");
assert.deepEqual(calls,[]);
reset();currentSave=null;
result=await exit({leagueData:league});
assert.equal(result.status,"unlinked");
assert.deepEqual(calls,["read"]);
reset();currentSave={ ...save, snapshot: {leagueData:{...league,__leagueStorageId:"other"}} };
result=await exit({leagueData:{...league,__leagueStorageId:"active"}});
assert.equal(result.status,"unlinked");
assert.deepEqual(calls,["read"]);
reset();pending["bm_pending_calendar_sim_v1"]=JSON.stringify({start:1});
await assert.rejects(exit({leagueData:league}),/pause/);
assert.deepEqual(calls,[]);
reset();activeId="";
result=await recover({leagueData:league});
assert.equal(result.status,"saved");
assert.equal(result.recoveredSaveId,"s1");
assert.deepEqual(calls.slice(0,2),["flush","create"]);
reset();activeId="";slots=Array.from({length:10},(_,i)=>({slotIndex:i}));
await assert.rejects(recover({leagueData:league}),/occupied/);
assert.equal(calls.includes("create"),false);
console.log("PASS: route guard, cross-app exits, auth boundary, orphan recovery, cloud-offline and simulation safeguards");
