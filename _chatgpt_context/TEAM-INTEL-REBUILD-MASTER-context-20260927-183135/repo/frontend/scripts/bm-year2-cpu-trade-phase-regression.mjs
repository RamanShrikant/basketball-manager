import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");

const storage = new Map();
globalThis.localStorage = {
  getItem(key) {
    return storage.has(String(key)) ? storage.get(String(key)) : null;
  },
  setItem(key, value) {
    storage.set(String(key), String(value));
  },
  removeItem(key) {
    storage.delete(String(key));
  },
  clear() {
    storage.clear();
  },
  key(index) {
    return [...storage.keys()][index] ?? null;
  },
  get length() {
    return storage.size;
  },
};

// Reproduce the Year-2 failure state: the offseason page has left completed
// offseason/draft state behind while the CPU trade caller already knows the
// simulation is in the regular season.
localStorage.setItem(
  "bm_league_clock_v1",
  JSON.stringify({
    date: "2027-07-10",
    phase: "offseason",
    seasonYear: 2027,
    source: "regression",
  })
);
localStorage.setItem(
  "bm_offseason_state_v1",
  JSON.stringify({
    seasonYear: 2027,
    active: false,
    retirementsComplete: true,
    optionsComplete: true,
    draftLotteryComplete: true,
    draftComplete: true,
    rookieSigningsComplete: true,
    freeAgencyComplete: true,
    progressionComplete: true,
  })
);
localStorage.setItem(
  "bm_draft_lottery_v1",
  JSON.stringify({ seasonYear: 2027, completed: true })
);
localStorage.setItem(
  "bm_draft_state_v1",
  JSON.stringify({ seasonYear: 2027, completed: true })
);

const { getTradePlayerEligibility } = await import("../src/utils/tradeRosterEligibility.js");

const leagueData = {
  seasonYear: 2027,
  currentSeasonYear: 2027,
  seasonStartYear: 2027,
  draftYear: 2027,
  currentDraftYear: 2027,
};

const expiring = {
  id: "expiring",
  name: "Expiring Veteran",
  contract: {
    startYear: 2027,
    salaryByYear: [20_000_000],
  },
};

const pendingPlayerOption = {
  id: "player-option",
  name: "Pending Player Option",
  contract: {
    startYear: 2027,
    salaryByYear: [20_000_000, 21_000_000],
    option: { type: "player", yearIndex: 1, picked: null },
  },
};

const pendingTeamOption = {
  id: "team-option",
  name: "Pending Team Option",
  contract: {
    startYear: 2027,
    salaryByYear: [8_000_000, 9_000_000],
    option: { type: "team", yearIndex: 1, picked: null },
  },
};

const cases = [
  [expiring, "EXPIRING_CONTRACT"],
  [pendingPlayerOption, "PENDING_PLAYER_OPTION"],
  [pendingTeamOption, "PENDING_TEAM_OPTION"],
];

for (const [player] of cases) {
  const regularSeason = getTradePlayerEligibility(player, {
    leagueData,
    inOffseason: false,
  });
  assert.equal(
    regularSeason.eligible,
    true,
    `${player.name} must remain trade-eligible when the CPU validator explicitly says regular season.`
  );
  assert.equal(regularSeason.code, "STANDARD_ROSTER");
}

const explicitOffseasonContext = {
  version: 1,
  inOffseason: true,
  seasonYear: 2027,
  targetSeasonYear: 2028,
};

for (const [player, expectedCode] of cases) {
  const offseason = getTradePlayerEligibility(player, {
    leagueData,
    tradeContext: explicitOffseasonContext,
  });
  assert.equal(offseason.eligible, false, `${player.name} should still be blocked by real offseason rules.`);
  assert.equal(offseason.code, expectedCode);
}

const twoWay = getTradePlayerEligibility(
  { id: "two-way", name: "Two Way Player", isTwoWay: true },
  { leagueData, inOffseason: false }
);
assert.equal(twoWay.eligible, false, "Explicit regular-season phase must not make development-roster players tradeable.");
assert.equal(twoWay.code, "DEVELOPMENT_ROSTER");

// Guard the caller wiring too. The fix only works if the authoritative CPU
// phase reaches both validation and final execution re-validation.
const tradeExecutionSource = fs.readFileSync(
  path.join(frontendRoot, "src", "utils", "tradeExecution.js"),
  "utf8"
);

assert.match(
  tradeExecutionSource,
  /function validateTradeForExecution\(\{[^}]*inOffseason = null[^}]*\}\)/s,
  "validateTradeForExecution must accept the authoritative phase."
);
assert.match(
  tradeExecutionSource,
  /findIneligibleTradePlayer\(userItems, \{ leagueData, inOffseason \}\)/,
  "Outgoing-side player eligibility must receive the authoritative phase."
);
assert.match(
  tradeExecutionSource,
  /findIneligibleTradePlayer\(cpuItems, \{ leagueData, inOffseason \}\)/,
  "Incoming-side player eligibility must receive the authoritative phase."
);
assert.match(
  tradeExecutionSource,
  /evaluation: validation\.evaluation,\s+inOffseason,\s+\}\);/s,
  "Final normal CPU trade execution must preserve the authoritative phase."
);
assert.match(
  tradeExecutionSource,
  /evaluation,\s+inOffseason,\s+\}\);\s+if \(!execution\.ok\)/s,
  "Final mega CPU trade execution must preserve the authoritative phase."
);

console.log("PASS year2_cpu_trade_phase.authoritative_regular_season");
console.log("PASS year2_cpu_trade_phase.offseason_rules_preserved");
console.log("PASS year2_cpu_trade_phase.final_execution_revalidation_threaded");
console.log("Year-2 CPU trade phase regression passed: 3/3 checks.");
