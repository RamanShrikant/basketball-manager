import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIntelCpuPythonPayload, startIntelCpuPythonProbe } from "../src/utils/teamIntelPythonProbe.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const adapterText = readFileSync(resolve(root, "src/utils/teamIntelCpuOverlay.js"), "utf8");
const uiText = readFileSync(resolve(root, "src/pages/Intel_v1.jsx"), "utf8");
const worker = readFileSync(resolve(root, "public/workers/intelCpuReadOnlyWorker.js"), "utf8");
const python = readFileSync(resolve(root, "public/python/league_intel_readonly.py"), "utf8");
const source = adapterText.replace(/^import\s+.*?;\s*$/gm, "").replace(/^export\s+/gm, "");
const league = {
  seasonYear: 2026, teams: [
    { name: "Alpha", players: [
      { id: "a", name: "Alpha Wing", overall: 77, pos: "SF", potential: 78, age: 29 },
      { id: "ac", name: "Alpha Prospect", overall: 80, potential: 94, pos: "PG", age: 20 },
    ] },
    { name: "Bravo", players: [{ id: "b", name: "Bravo Center", overall: 81, pos: "C", potential: 82, age: 29 }] },
    { name: "User", players: [{ id: "u", name: "User Guard", overall: 79, pos: "SG", potential: 84, age: 22 }] },
  ],
  draftPicks: [{ id: "u-pick", ownerTeam: "User", originalTeam: "User", year: 2027, round: 1, status: "active", protection: "Unprotected" }],
};
const original = JSON.stringify(league);
const sourceValue = { teams: { Alpha: {
  cpuCpuPhase: "seller", negotiationPhase: "rebuild",
  outgoing: [{ id: "a", name: "Alpha Wing", sourceTeam: "Alpha" }],
  hardProtected: [{ id: "ac", name: "Alpha Prospect", sourceTeam: "Alpha" }],
  watchlist: [{ id: "b", name: "Bravo Center", sourceTeam: "Bravo", value: 44 }],
  valuedUserAssets: [
    { id: "u", name: "User Guard", sourceTeam: "User", value: 55, kind: "player" },
    { id: "u-pick", year: 2027, round: 1, originalTeam: "User", sourceTeam: "User", value: 35, kind: "pick" },
  ],
} } };
const context = { console, Set, Map, Object, Array, String, Number,
  scanCpuTradeMarket: async () => ({ rows: [], stats: {} }),
  evaluateTradeTeamImpact: () => ({ accepted: false }),
  getUserTradePickEligibility: () => ({ ok: true }),
};
vm.runInNewContext(`${source}\nthis.api = { presentCpuIntel, validateCpuIntelDisplay };`, context);
const { presentCpuIntel, validateCpuIntelDisplay } = context.api;
const team = { name: "Alpha", rosterLeaders: [], outgoingMarketPlayers: [], incomingMarketTargets: [] };
const snapshot = { bank: { observedCandidates: [] } };
const market = presentCpuIntel({ snapshot, team, leagueData: league, userTeamName: "User", cpuReadOnly: sourceValue });
assert.equal(market.available[0].name, "Alpha Wing");
assert.equal(market.available[0].evidence.kind, "cpu_outgoing_board");
assert.equal(market.targets[0].name, "Bravo Center");
assert.equal(market.targets[0].evidence.kind, "cpu_market_watch");
assert.equal(market.userAssets[0].name, "User Guard");
assert.equal(market.userAssets[0].evidence.kind, "cpu_valuation_only");
assert.ok(market.userAssets.some((a) => a.type === "pick"), "owned draft pick receives CPU valuation");
assert.equal(market.core[0].evidence.kind, "cpu_hard_core");
assert.equal(validateCpuIntelDisplay({ market, leagueData: league, userTeamName: "User" }).ok, true);
assert.equal(JSON.stringify(league), original, "preference display never mutates original save");
league.draftPicks[0].ownerTeam = "Bravo";
assert.equal(validateCpuIntelDisplay({ market, leagueData: league, userTeamName: "User" }).ok, false, "stale user draft pick invalidates displayed valuation");
league.draftPicks[0].ownerTeam = "User";
const payload = buildIntelCpuPythonPayload(league, { teams: [{ name: "Alpha", record: { wins: 1, losses: 3 } }] }, "User");
assert.equal(payload.recordsByTeam.Alpha.wins, 1);
assert.equal(payload.leagueData.teams.length, 3);
assert.equal(payload.userTeamName, "User");
let terminated = false;
const result = await new Promise((resolvePromise, rejectPromise) => {
  startIntelCpuPythonProbe(payload, { workerFactory: () => ({
    onmessage: null,
    postMessage(message) { queueMicrotask(() => this.onmessage({ data: { id: message.id, ok: true, value: sourceValue } })); },
    terminate() { terminated = true; },
  }), onResult: resolvePromise, onError: rejectPromise });
});
assert.equal(result.teams.Alpha.cpuCpuPhase, "seller");
assert.equal(terminated, false, "worker may stay alive until its owning React effect cleans up");
assert.match(python, /cpu\._buyer_mega_fit_score\(/, "targets use original CPU buyer roster fit");
assert.match(python, /cpu\._seller_trade_targets\(/);
assert.match(python, /cpu\._buyer_outgoing_players\(/);
assert.match(python, /cpu\._is_shared_untouchable_core\(/);
assert.match(python, /values\.player_trade_value\(/);
assert.match(python, /values\.pick_trade_value\(/);
assert.match(worker, /league_intel_readonly\.get_intel_cpu_profile_json/);
assert.doesNotMatch(worker, /executeCpuTradeCandidateOnLeague|ensureCpuTradeBankState|localStorage|indexedDB/);
assert.match(uiText, /cpuRuntime/);
assert.match(uiText, /startIntelCpuPythonProbe/);
assert.doesNotMatch(uiText, /setLeagueData\s*\(/);
console.log("PASS Intel Python CPU model source: exact existing candidate/valuation APIs, protected core, early-season watchlist, user picks, provenance, no mutation, ownership validation");
