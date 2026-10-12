import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { observeLeagueIntel, validateIntelObservation } from "../src/utils/teamIntelObserver.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const adapterText = readFileSync(resolve(root, "src/utils/teamIntelCpuOverlay.js"), "utf8");
const uiText = readFileSync(resolve(root, "src/pages/Intel_v1.jsx"), "utf8");
const enginePath = resolve(root, "public/python/cpu_cpu_trade_logic.py");
const engineText = existsSync(enginePath) ? readFileSync(enginePath, "utf8") : "";
const prefsPath = resolve(root, "public/python/trade_team_ai.py");
const prefsText = existsSync(prefsPath) ? readFileSync(prefsPath, "utf8") : "";
// The test extracts ONLY the adapter body; imports are replaced by injected
// dummy evaluator/scanner so we can test API and provenance without invoking
// actual CPU engine or changing any save data.
const source = adapterText
  .replace(/^import\s+.*?;\s*$/gm, "")
  .replace(/^export\s+/gm, "");
const players = {
  a1: { id: "a1", name: "Alpha Wing", pos: "SF", overall: 77, age: 27, potential: 82 },
  a2: { id: "a2", name: "Alpha Prospect", pos: "PG", overall: 74, age: 21, potential: 89 },
  b1: { id: "b1", name: "Bravo Center", pos: "C", overall: 81, age: 28, potential: 82 },
  u1: { id: "u1", name: "User Guard", pos: "SG", overall: 76, age: 26, potential: 81 },
};
const league = {
  seasonStartYear: 2026, contractSeasonYear: 2026, seasonYear: 2026,
  teams: [
    { name: "Alpha", conference: "East", players: [players.a1, players.a2] },
    { name: "Bravo", conference: "West", players: [players.b1] },
    { name: "User", conference: "West", players: [players.u1] },
  ],
  draftPicks: [
    { id: "b-pick", year: 2027, round: 1, originalTeam: "Bravo", ownerTeam: "Bravo", status: "active" },
    { id: "u-pick", year: 2028, round: 1, originalTeam: "User", ownerTeam: "User", status: "active" },
  ],
  cpuTradeBankState: { seasonYear: 2026, candidates: [{ id: "real-bank", fromTeamName: "Bravo", toTeamName: "Alpha", fromItems: [{ type: "pick", pick: { id: "b-pick", year: 2027, round: 1, originalTeam: "Bravo" } }], toItems: [{ type: "player", player: players.a1 }], bankMeta: { acceptedAtGeneration: true } }] },
};
const savedBefore = JSON.stringify(league);
const snapshot = observeLeagueIntel(league);
assert.equal(validateIntelObservation(snapshot, league).ok, true, "banked draft right passes source validator");
const alpha = snapshot.teams.find((t) => t.name === "Alpha");
assert.equal(alpha.incomingMarketTargets[0].assetKind, "pick", "CPU-bank incoming pick surfaced");
assert.equal(alpha.outgoingMarketPlayers[0].name, "Alpha Wing", "CPU-bank outgoing player surfaced");

const humanDeal = {
  id: "hypothetical-user", teamAName: "Alpha", teamBName: "User", template: "draft solve",
  teamAItems: [{ type: "player", player: players.a2 }],
  teamBItems: [{ type: "player", player: players.u1 }, { type: "pick", pick: { id: "u-pick", year: 2028, round: 1, originalTeam: "User" } }],
};
const cpuDeal = {
  id: "hypothetical-league", teamAName: "Alpha", teamBName: "Bravo", template: "balanced",
  teamAItems: [{ type: "player", player: players.a2 }], teamBItems: [{ type: "player", player: players.b1 }],
};
let userAccepts = true;
let calls = [];
const context = { console, Set, Map, Object, Array, String, Number,
  scanCpuTradeMarket: async (args) => {
    calls.push(args);
    return args.opponentTeamName === "User"
      ? { rows: [{ opponentTeamName: "User", trades: [humanDeal] }], stats: { exactEvaluations: 3, mutualAcceptsFound: 1 } }
      : { rows: [{ opponentTeamName: "Bravo", trades: [cpuDeal] }], stats: { exactEvaluations: 8, mutualAcceptsFound: 1, capped: true } };
  },
  evaluateTradeTeamImpact: () => ({ accepted: userAccepts, score: 4.2 }),
};
vm.runInNewContext(`${source}\nthis.api = { negotiationTeamPhase, matchingIntelRumors, genericCpuNeeds, scanIntelCpuEvidence, presentCpuIntel, validateCpuIntelDisplay }`, context);
const api = context.api;
const rumor = { id: "r1", type: "rumor", date: "2026-11-01", teamNames: ["Alpha"], playerNames: ["Someone"], headline: "Alpha scouting players", label: "Buyer Watch" };
const initial = api.presentCpuIntel({ snapshot, team: alpha, leagueData: league, userTeamName: "User", feed: [rumor] });
assert.equal(initial.targets[0].assetKind, "pick", "real bank draft target first");
assert.equal(initial.targets[0].evidence.kind, "cpu_bank_at_generation");
assert.equal(initial.available[0].name, "Alpha Wing");
assert.equal(initial.rumors.length, 1, "rumor reported separately, never converted into a target");
assert.equal(initial.userAssets.length, 0, "no invented user assets when scan absent");
assert.equal(api.negotiationTeamPhase({ players: [players.a1] }, { record: { wins: 40, losses: 35 } }).phase, "playoff", "existing trade_team_ai record thresholds");
assert.equal(api.genericCpuNeeds("rebuild")[1], "First-round draft capital");
const tokenRef = { current: 1 };
const result = await api.scanIntelCpuEvidence({ leagueData: league, focusTeamName: "Alpha", userTeamName: "User", tokenRef, token: 1 });
assert.equal(result.complete, true);
assert.equal(result.userDeals.length, 1, "user-facing CPU evaluator accepted complete framework");
assert.equal(result.marketDeals.length, 1, "bounded existing CPU market result retained");
assert.equal(calls[0].opponentTeamName, "User", "user asset check first");
assert.equal(calls[1].userTeamName, "User", "league-wide scanner excludes user team");
const matched = api.presentCpuIntel({ snapshot, team: alpha, leagueData: league, userTeamName: "User", feed: [rumor], scan: result });
assert.equal(matched.targets[0].assetKind, "pick", "real bank has priority over hypothetical");
assert.equal(api.validateCpuIntelDisplay({ market: matched, leagueData: league, userTeamName: "User" }).ok, true, "market rows and user assets have traceable current ownership");
assert.ok(matched.targets.some((p) => p.name === "Bravo Center"), "scanned acquisition player shown");
assert.ok(matched.available.some((p) => p.name === "Alpha Prospect"), "scanned outgoing player shown");
assert.ok(matched.userAssets.some((p) => p.name === "User Guard"), "actual controlled player only after accepted offer framework");
assert.ok(matched.userAssets.some((p) => p.type === "pick"), "owned user pick only after acceptance");
assert.equal(matched.userAssets[0].evidence.kind, "user_cpu_accepted_framework");
assert.equal(matched.scanStatus.includes("limited scan"), true, "capped/incomplete scan disclosed");
userAccepts = false;
const rejected = await api.scanIntelCpuEvidence({ leagueData: league, focusTeamName: "Alpha", userTeamName: "User", tokenRef, token: 1 });
assert.equal(rejected.userDeals.length, 0, "user-facing rejected package NOT shown as user asset");
userAccepts = true;
league.draftPicks[1].ownerTeam = "Bravo";
assert.equal(api.validateCpuIntelDisplay({ market: matched, leagueData: league, userTeamName: "User" }).ok, false, "stale displayed user pick detected");
const stale = await api.scanIntelCpuEvidence({ leagueData: league, focusTeamName: "Alpha", userTeamName: "User", tokenRef, token: 1 });
assert.equal(stale.userDeals.length, 0, "ownership-changing pick invalidates accepted hypothetical");
assert.equal(api.presentCpuIntel({ snapshot, team: alpha, leagueData: league, userTeamName: "User", scan: stale }).userAssets.length, 0);
assert.notEqual(JSON.stringify(league), savedBefore, "test fixture changed ownership intentionally");
assert.match(uiText, /scanCacheRef\.current/);
assert.match(uiText, /clearTimeout\(timer\)/);
assert.match(uiText, /scanTokenRef\.current \+= 1/);
assert.doesNotMatch(uiText, /setLeagueData\s*\(|executeCpuTradeCandidateOnLeague\s*\(|ensureCpuTradeBankState\s*\(/);
if (engineText) assert.match(engineText, /def _market_player_score\(/, "reference CPU market scoring exists and is not duplicated");
if (prefsText) assert.match(prefsText, /PHASE_PREFERENCES/, "reference existing six-phase preference source exists");
console.log("PASS Intel CPU evidence: bank priority, owned picks, six-phase preferences, separate rumors, mutual CPU scans, user exact accept/reject, stale assets, cancellation wiring");
