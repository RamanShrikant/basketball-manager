import assert from "node:assert/strict";
import { observeLeagueIntel, getObservedTeam, validateIntelObservation } from "../src/utils/teamIntelObserver.js";

function deepFreeze(obj) {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    for (const value of Object.values(obj)) deepFreeze(value);
    Object.freeze(obj);
  }
  return obj;
}

const player = (id, name, pos, overall, age, years, salary) => ({
  id, name, pos, overall, potential: overall + 2, age,
  contract: { startYear: 2026, salaryByYear: Array.from({ length: years }, () => salary) },
});

const league = {
  seasonStartYear: 2026,
  contractSeasonYear: 2026,
  salaryCap: 140_000_000,
  teams: [
    { name: "Alpha", conference: "East", players: [
      player("a1", "Alpha PG", "PG", 90, 25, 3, 30_000_000),
      player("a2", "Alpha SG", "SG", 80, 28, 1, 10_000_000),
      player("a3", "Alpha SF", "SF", 78, 27, 2, 8_000_000),
      player("a4", "Alpha PF", "PF", 77, 26, 2, 7_000_000),
      player("a5", "Alpha C", "C", 75, 29, 1, 6_000_000),
      { ...player("aw", "Two Way", "PG", 70, 20, 1, 1_000_000), isTwoWay: true },
    ] },
    { name: "Beta", conference: "West", players: [
      player("b1", "Beta PG", "PG", 82, 30, 2, 20_000_000),
      player("b2", "Beta C", "C", 79, 23, 3, 12_000_000),
    ] },
  ],
  draftPicks: [{ id: "pickA", ownerTeam: "Alpha", originalTeam: "Beta", year: 2027, round: 1, status: "active" }],
  cpuTradeBankState: {
    seasonYear: 2026, candidates: [{
      bankId: "bank-1", fromTeamName: "Alpha", toTeamName: "Beta",
      fromItems: [{ type: "player", player: { id: "a2", name: "Alpha SG" } }],
      toItems: [{ type: "player", player: { id: "b1", name: "Beta PG" } }],
      bankMeta: { acceptedAtGeneration: true, generatedDate: "2026-10-11" },
    }],
  },
};

deepFreeze(league);
const before = JSON.stringify(league);
const observed = observeLeagueIntel(league, { recordsByTeam: { Alpha: { w: 2, l: 1 } } });
const alpha = getObservedTeam(observed, "alpha");
const beta = getObservedTeam(observed, "beta");
assert.equal(observed.teams.length, 2, "team source");
assert.equal(alpha.roster.length, 5, "two-way exclusion");
assert.equal(alpha.projectedLineup.slots.length, 5, "five starter slots");
assert.equal(alpha.expiringContracts.length, 2, "contract year interpretation");
assert.equal(alpha.finance.standardRosterPayroll, 61_000_000, "standard payroll only");
assert.equal(alpha.finance.spendableCapSpace, null, "do not invent spendable cap room");
assert.equal(alpha.ownedPicks.length, 1, "saved pick ownership");
assert.equal(alpha.needs.length, 3, "only literal depth facts, capped to three");
assert.equal(alpha.record.wins, 2, "existing record supplied by caller");
assert.equal(alpha.outgoingMarketPlayers[0].name, "Alpha SG", "observed outgoing CPU package");
assert.equal(alpha.incomingMarketTargets[0].name, "Beta PG", "observed incoming CPU package");
assert.equal(beta.incomingMarketTargets[0].name, "Alpha SG", "counterparty trade direction");
assert.match(alpha.rosterLeaders[0].evidence.label, /CPU protection not guaranteed/, "no invented protected label");
assert.equal(validateIntelObservation(observed, league).ok, true, "observation consistency");
assert.equal(JSON.stringify(league), before, "observer did not mutate input");

const changed = JSON.parse(before);
changed.teams[0].players = changed.teams[0].players.filter((p) => p.id !== "a2");
changed.teams[1].players.push(player("a2", "Alpha SG", "SG", 80, 28, 1, 10_000_000));
const afterTrade = observeLeagueIntel(deepFreeze(changed));
assert.equal(afterTrade.bank.observedCandidates.length, 0, "stale CPU bank package suppressed");
assert.equal(afterTrade.bank.skipped.staleRoster, 1, "stale reason tracked");
assert.equal(validateIntelObservation(observed, changed).ok, false, "stale snapshot detected");

const empty = observeLeagueIntel({ teams: [{ name: "Empty", players: [] }] });
assert.equal(getObservedTeam(empty, "Empty").incomingMarketTargets.length, 0, "no fictional targets");
assert.equal(getObservedTeam(empty, "Empty").rosterLeaders.length, 0, "no fictional core");
assert.equal(empty.bank.initialized, false, "missing bank remains empty");

const oldSeason = JSON.parse(before);
oldSeason.seasonStartYear = 2027;
oldSeason.contractSeasonYear = 2027;
assert.equal(observeLeagueIntel(oldSeason).bank.skipped.wrongSeason, 1, "previous-season bank excluded");

console.log("PASS team-intel observer: source, roster, lineup, contracts, finances, picks, CPU evidence, stale bank, no mutation, empty states, year isolation");
