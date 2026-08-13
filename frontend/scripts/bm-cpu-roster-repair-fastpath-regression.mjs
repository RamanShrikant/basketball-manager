import assert from "node:assert/strict";
import {
  applyTargetedCpuRosterRepairFastPath,
  buildCpuRosterRepairFastPathBaseline,
  canUseTargetedCpuRosterRepairFastPath,
} from "../src/utils/cpuRosterRepairFastPath.js";

function player(id, teamName, overall = 72) {
  return {
    id,
    name: `Player ${id}`,
    overall,
    potential: overall + 1,
    age: 26,
    contractType: "standard",
    rosterStatus: "standard",
    rights: {
      heldByTeam: teamName,
      seasonsTowardBird: 2,
      birdLevel: "early_bird",
      rookieScale: false,
      restrictedFreeAgent: false,
    },
    meta: { yearsWithCurrentTeam: 2 },
  };
}

function twoWay(id, teamName) {
  return {
    ...player(id, teamName, 69),
    isTwoWay: true,
    isStash: false,
    contractType: "two_way",
    rosterStatus: "two_way",
  };
}

function team(name, prefix) {
  return {
    name,
    players: Array.from({ length: 14 }, (_, i) => player(`${prefix}-P${i + 1}`, name)),
    twoWayPlayers: [twoWay(`${prefix}-TW1`, name)],
    stashPlayers: [],
  };
}

function makeLeague() {
  return {
    seasonYear: 2027,
    minRosterSize: 14,
    conferences: {
      East: [team("Boston Celtics", "BOS"), team("Brooklyn Nets", "BKN")],
      West: [team("Denver Nuggets", "DEN"), team("Phoenix Suns", "PHX")],
    },
    freeAgents: [
      {
        id: "FA1",
        name: "Free Agent One",
        overall: 74,
        potential: 75,
        age: 29,
        contractType: "free_agent",
        rosterStatus: "free_agent",
        rights: {
          heldByTeam: null,
          seasonsTowardBird: 0,
          birdLevel: "none",
          rookieScale: false,
          restrictedFreeAgent: false,
        },
        marketValue: { expectedYear1Salary: 3500000 },
      },
    ],
    freeAgencyState: { isActive: false, currentDay: 0 },
    financials: { salaryCap: 170000000 },
  };
}

function findTeam(league, name) {
  return [...league.conferences.East, ...league.conferences.West].find((row) => row.name === name);
}

const original = makeLeague();
const baseline = buildCpuRosterRepairFastPathBaseline(original);

// Simulate a legal 1-for-1 trade after a known-clean worker repair. The only
// backend repair side effect should be rights normalization for the moved players.
const traded = structuredClone(original);
const bkn = findTeam(traded, "Brooklyn Nets");
const den = findTeam(traded, "Denver Nuggets");
const movedToDenver = bkn.players.shift();
const movedToBrooklyn = den.players.shift();
bkn.players.push({ ...movedToBrooklyn, rights: { ...movedToBrooklyn.rights, heldByTeam: "Denver Nuggets" } });
den.players.push({ ...movedToDenver, rights: { ...movedToDenver.rights, heldByTeam: "Brooklyn Nets" } });

const decision = canUseTargetedCpuRosterRepairFastPath({
  leagueData: traded,
  userTeamName: "Boston Celtics",
  minPlayers: 14,
  targetTeamNames: ["Brooklyn Nets", "Denver Nuggets"],
  baseline,
});
assert.equal(decision.ok, true, `expected fast path, got ${decision.reason}`);

const fast = applyTargetedCpuRosterRepairFastPath({
  leagueData: traded,
  targetTeamNames: ["Brooklyn Nets", "Denver Nuggets"],
  minPlayers: 14,
});
assert.equal(fast.ok, true);
assert.equal(fast.fastNoopBypass, true);
assert.equal(fast.signings.length, 0);
assert.equal(fast.droppedPlayers.length, 0);
assert.equal(fast.twoWayAssignments.length, 0);
assert.equal(findTeam(fast.leagueData, "Brooklyn Nets").players.at(-1).rights.heldByTeam, "Brooklyn Nets");
assert.equal(findTeam(fast.leagueData, "Denver Nuggets").players.at(-1).rights.heldByTeam, "Denver Nuggets");

const highValueFaLeague = structuredClone(traded);
highValueFaLeague.freeAgents[0].overall = 76;
assert.equal(
  canUseTargetedCpuRosterRepairFastPath({
    leagueData: highValueFaLeague,
    userTeamName: "Boston Celtics",
    minPlayers: 14,
    targetTeamNames: ["Brooklyn Nets", "Denver Nuggets"],
    baseline: buildCpuRosterRepairFastPathBaseline(highValueFaLeague),
  }).reason,
  "high_value_free_agent_present"
);

const deficitLeague = structuredClone(traded);
findTeam(deficitLeague, "Phoenix Suns").players.pop();
assert.equal(
  canUseTargetedCpuRosterRepairFastPath({
    leagueData: deficitLeague,
    userTeamName: "Boston Celtics",
    minPlayers: 14,
    targetTeamNames: ["Brooklyn Nets", "Denver Nuggets"],
    baseline: buildCpuRosterRepairFastPathBaseline(deficitLeague),
  }).reason,
  "roster_repair_possible"
);

const changedFaLeague = structuredClone(traded);
changedFaLeague.freeAgents[0].potential = 80;
assert.equal(
  canUseTargetedCpuRosterRepairFastPath({
    leagueData: changedFaLeague,
    userTeamName: "Boston Celtics",
    minPlayers: 14,
    targetTeamNames: ["Brooklyn Nets", "Denver Nuggets"],
    baseline,
  }).reason,
  "free_agent_state_changed"
);

const dirtyBucketLeague = structuredClone(traded);
const dirty = findTeam(dirtyBucketLeague, "Phoenix Suns").twoWayPlayers[0];
dirty.isTwoWay = false;
assert.equal(
  canUseTargetedCpuRosterRepairFastPath({
    leagueData: dirtyBucketLeague,
    userTeamName: "Boston Celtics",
    minPlayers: 14,
    targetTeamNames: ["Brooklyn Nets", "Denver Nuggets"],
    baseline: buildCpuRosterRepairFastPathBaseline(dirtyBucketLeague),
  }).reason,
  "roster_repair_possible"
);

const nextSeasonLeague = structuredClone(traded);
nextSeasonLeague.seasonYear = 2028;
assert.equal(
  canUseTargetedCpuRosterRepairFastPath({
    leagueData: nextSeasonLeague,
    userTeamName: "Boston Celtics",
    minPlayers: 14,
    targetTeamNames: ["Brooklyn Nets", "Denver Nuggets"],
    baseline,
  }).reason,
  "season_changed"
);

console.log("[BM CPU ROSTER REPAIR FAST PATH] PASS • 7/7");
console.log(JSON.stringify({
  cleanLegalTradeUsesFastPath: true,
  rightsNormalized: true,
  highValueFaForcesWorker: true,
  rosterDeficitForcesWorker: true,
  freeAgentMutationForcesWorker: true,
  dirtyRosterBucketsForceWorker: true,
  seasonChangeForcesWorker: true,
}, null, 2));
