import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { observeLeagueIntel, inspectIntelClaim, validateIntelObservation } from "../src/utils/teamIntelObserver.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(resolve(root, "src/pages/Intel_v1.jsx"), "utf8");
const css = readFileSync(resolve(root, "src/styles/BMLeagueIntel.css"), "utf8");

// Integration contract: the live page must call the observer, but MUST NOT
// compute the old independent buildLeagueIntel() or run CPU actions.
assert.match(page, /observeLeagueIntel\(displayLeague,\s*\{ recordsByTeam, minutesByTeam, payrollSeasonYear: lifecycle\.payrollYear, upcomingFinancialYear: lifecycle\.inOffseason \}\)/);
assert.match(page, /buildRecordMap\(liveTeams\)/);
assert.doesNotMatch(page, /\bbuildLeagueIntel\s*\(/);
assert.match(page, /window\.BMIntel\s*=\s*api/);
assert.match(page, /inspectIntelClaim/);
assert.match(page, /validateIntelObservation/);
assert.match(page, /data-bm-league-intel-v2/);
assert.match(page, /projectedLineup\.slots\.slice\(0,\s*5\)/);
assert.match(page, /setShowRoster\(true\)/);
assert.doesNotMatch(page, /setLeagueData\s*\(/);
assert.doesNotMatch(page, /executeCpuTrade|addGeneratedCpuTradeCandidates|evaluateTradeTeamImpact|generateCpuTrade|ensureCpuTradeBankState/);
assert.match(css, /\.bm-il-main\{[^}]*overflow:hidden/);
assert.match(css, /\.bm-il-team-scroll\{[^}]*overflow-y:auto/);
assert.match(css, /\.bm-il-report\{[^}]*overflow:hidden/);

const makePlayer = (id, pos, ovr, years = 3) => ({ id, name: `Player ${id}`, pos, overall: ovr, age: 28, potential: ovr + 2, contract: { startYear: 2026, salaryByYear: Array(years).fill(5_000_000) } });
const league = {
  seasonYear: 2026, seasonStartYear: 2026, contractSeasonYear: 2026,
  teams: [
    { name: "North", conference: "East", players: [makePlayer("n1", "PG", 92), makePlayer("n2", "SG", 80), makePlayer("n3", "SF", 78), makePlayer("n4", "PF", 75), makePlayer("n5", "C", 72)] },
    { name: "South", conference: "East", players: [makePlayer("s1", "PG", 84), makePlayer("s2", "SG", 75), makePlayer("s3", "PF", 71)] },
    { name: "West", conference: "West", players: [makePlayer("w1", "PG", 73), makePlayer("w2", "SF", 76)] },
  ],
  draftPicks: [{ id: "own-pick", year: 2027, round: 1, originalTeam: "North", ownerTeam: "North", status: "active" }],
  cpuTradeBankState: { seasonYear: 2026, candidates: [{ bankId: "candidate-5", fromTeamName: "North", toTeamName: "South", fromItems: [{ type: "player", player: { id: "n2", name: "Player n2" } }], toItems: [{ type: "player", player: { id: "s2", name: "Player s2" } }], bankMeta: { acceptedAtGeneration: true } }] },
};
const before = JSON.stringify(league);
const snapshot = observeLeagueIntel(league, { recordsByTeam: { North: { w: 22, l: 1 }, South: { w: 8, l: 15 }, West: { w: 4, l: 17 } }, minutesByTeam: { North: { "Player n1": 34, "Player n2": 32 } } });
const north = snapshot.teams.find((t) => t.name === "North");
assert.equal(north.projectedLineup.slots.length, 5);
assert.match(north.projectedLineup.evidence.label, /Saved minute allocations/);
assert.equal(north.standing.conferenceRank, 1);
assert.equal(north.record.wins, 22);
assert.equal(north.rosterLeaders[0].name, "Player n1");
assert.match(north.rosterLeaders[0].evidence.label, /not guaranteed/i);
assert.equal(inspectIntelClaim(snapshot, "North", "core", "Player n1").ok, true);
assert.equal(inspectIntelClaim(snapshot, "North", "available", "Player n2").entry.candidateId, "candidate-5");
assert.equal(inspectIntelClaim(snapshot, "North", "targets", "Player s2").entry.sourceTeam, "South");
assert.equal(inspectIntelClaim(snapshot, "North", "targets", "Not There").ok, false);
assert.ok(north.scoutedAvailability.every((p) => p.evidence.kind === "scouting_estimate"));
assert.ok(north.needs.every((need) => need.evidence.kind === "roster_fact"));
assert.equal(validateIntelObservation(snapshot, league).ok, true);
assert.equal(JSON.stringify(league), before, "observer must not mutate input");

const pickLeague = JSON.parse(before);
pickLeague.cpuTradeBankState.candidates[0].fromItems.push({ type: "pick", pick: { id: "own-pick", ownerTeam: "North", year: 2027, round: 1, originalTeam: "North" } });
assert.equal(observeLeagueIntel(pickLeague).bank.observedCandidates.length, 1);
pickLeague.draftPicks[0].ownerTeam = "West";
const afterPickTrade = observeLeagueIntel(pickLeague);
assert.equal(afterPickTrade.bank.observedCandidates.length, 0);
assert.equal(afterPickTrade.bank.skipped.staleRoster, 1);

console.log("PASS League Intel Phase 2: live wiring contract, evidence trace, roster changes, draft-pick ownership, saved minutes, no game mutations, responsive style hooks");

// Phase 3: only existing CPU-bank and evaluator evidence appears as market activity.
const wing = (id, name, overall, potential, age, years) => ({
  id, name, pos: "SF", overall, potential, age,
  contract: { startYear: 2026, salaryByYear: Array(years).fill(7_000_000) },
});
const marketLeague = {
  seasonStartYear: 2026, contractSeasonYear: 2026,
  teams: [
    { name: "OKC", conference: "West", players: [
      { ...makePlayer("shai", "PG", 97), name: "Shai" },
      { ...makePlayer("jalen", "SF", 83), name: "Jalen" },
      { ...makePlayer("chet", "PF", 82), name: "Chet" },
      { ...makePlayer("cason", "PG", 75, 1), name: "Cason Wallace", age: 22, potential: 83 },
      { ...makePlayer("tw", "SF", 79), name: "Excluded Two-Way", contractType: "two_way" },
    ] },
    { name: "Full Wing Team", conference: "East", players: [wing("mega", "Mega Superstar SF", 97, 98, 32, 3), wing("wing", "Expiring Wing", 74, 76, 30, 1)] },
  ],
};
const marketBefore = JSON.stringify(marketLeague);
const marketSnapshot = observeLeagueIntel(marketLeague);
const marketOkc = marketSnapshot.teams.find((t) => t.name === "OKC");
assert.equal(marketSnapshot.version, 4, "CPU-correction observer version installed");
assert.equal(marketOkc.roster.some((p) => p.name === "Excluded Two-Way"), false);
assert.equal(marketOkc.needs.find((n) => n.position === "SG")?.label, "SG depth: 0 players");
assert.equal(marketOkc.scoutedAvailability.length, 0, "invented availability score removed");
assert.equal(marketOkc.projectedFits.length, 0, "invented target ranking removed");
assert.equal(validateIntelObservation(marketSnapshot, marketLeague).ok, true);
assert.equal(JSON.stringify(marketLeague), marketBefore, "CPU correction cannot mutate saved league");
assert.doesNotMatch(page, /active\.scoutedAvailability|active\.projectedFits/);
assert.match(page, /scanIntelCpuEvidence/);
assert.match(page, /presentCpuIntel/);
assert.doesNotMatch(page, /STANDARD PLAYERS|Standard roster payroll|No expiring standard contracts/);
console.log("PASS Intel CPU correction: no invented availability/targets, explicit scanner wiring, roster, no side effects");
