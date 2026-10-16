import assert from "node:assert/strict";
import {
  buildLegalFreeAgentSalarySchedule,
  getFreeAgentContractRules,
  getPlayerMaximumSalary,
  getPlayerMinimumSalary,
} from "../src/utils/freeAgencyContractRules.js";
import { ensureLeagueFinancials } from "../src/utils/leagueFinancials.js";

let checks = 0;
const check = (condition, message) => {
  checks += 1;
  assert.ok(condition, message);
};

const league = ensureLeagueFinancials({
  seasonYear: 2026,
  currentSeasonYear: 2026,
  currentFinancialSeasonYear: 2027,
  financials: {
    baseSeasonYear: 2027,
    currentSeasonYear: 2027,
    currentFinancialSeasonYear: 2027,
    appliedThroughSeasonYear: 2027,
  },
});

const makePlayer = ({ name, age, proSeasons, rights = {}, previousSalary = 10_000_000 }) => ({
  id: name.toLowerCase().replaceAll(" ", "-"),
  name,
  age,
  proSeasons,
  overall: 80,
  potential: 80,
  rights,
  previousContract: { startYear: 2026, salaryByYear: [previousSalary], option: null },
  marketValue: { expectedYear1Salary: 20_000_000, contractExpectedYear1Salary: 20_000_000 },
});

const young = makePlayer({ name: "Young", age: 24, proSeasons: 5 });
const prime = makePlayer({ name: "Prime", age: 28, proSeasons: 8 });
const veteran = makePlayer({ name: "Veteran", age: 34, proSeasons: 12 });

check(getPlayerMaximumSalary(league, young).amount === 41_240_000, "UI 25% max mismatch.");
check(getPlayerMaximumSalary(league, prime).amount === 49_488_000, "UI 30% max mismatch.");
check(getPlayerMaximumSalary(league, veteran).amount === 57_736_000, "UI 35% max mismatch.");
check(getPlayerMinimumSalary(league, young).amount === 2_500_000, "UI young minimum mismatch.");
check(getPlayerMinimumSalary(league, veteran).amount === 3_300_000, "UI veteran minimum mismatch.");

const capDashboard = {
  rawCapRoomWithoutHolds: 80_000_000,
  practicalCapRoom: 80_000_000,
  payrollZone: "below_cap",
  hardCapRoom: null,
};
const capRules = getFreeAgentContractRules({ leagueData: league, player: young, teamName: "Away", dashboard: capDashboard, year1Salary: 30_000_000 });
check(capRules.path === "cap_space", "Cap-space preview path mismatch.");
check(JSON.stringify(capRules.allowedYears) === JSON.stringify([1, 2, 3, 4]), "Cap-space years mismatch.");
check(capRules.maxFirstYearSalary === 41_240_000, "Cap-space slider must stop at player max.");

const fullBird = makePlayer({
  name: "Full Bird",
  age: 28,
  proSeasons: 8,
  previousSalary: 30_000_000,
  rights: { heldByTeam: "Home", birdLevel: "bird", seasonsTowardBird: 3 },
});
const birdRules = getFreeAgentContractRules({ leagueData: league, player: fullBird, teamName: "Home", dashboard: capDashboard, year1Salary: 30_000_000 });
check(birdRules.path === "bird", "Full Bird path mismatch.");
check(JSON.stringify(birdRules.allowedYears) === JSON.stringify([1, 2, 3, 4, 5]), "Full Bird must show five years.");
check(birdRules.maxFirstYearSalary === 49_488_000, "Full Bird slider must still stop at player max.");
check(birdRules.maxRaisePct === 0.08, "Full Bird must preview 8% raises.");

const earlyBird = makePlayer({
  name: "Early Bird",
  age: 26,
  proSeasons: 5,
  previousSalary: 8_000_000,
  rights: { heldByTeam: "Home", birdLevel: "early_bird", seasonsTowardBird: 2 },
});
const earlyRules = getFreeAgentContractRules({ leagueData: league, player: earlyBird, teamName: "Home", dashboard: capDashboard, year1Salary: 12_000_000 });
check(JSON.stringify(earlyRules.allowedYears) === JSON.stringify([1, 2, 3, 4]), "Early Bird UI should show cap-space-capable 1-4 years.");
check(earlyRules.maxFirstYearSalary === 41_240_000, "Early Bird slider should show true player max, not only Early Bird ceiling.");
check(earlyRules.maxRaisePct === 0.08, "Early Bird should preview 8% raises while within the rights ceiling.");
check(earlyRules.rightsCeiling > 0 && earlyRules.rightsCeiling < earlyRules.playerMaximumSalary, "Early Bird should expose rights ceiling separately.");

const nonBird = makePlayer({
  name: "Non Bird",
  age: 25,
  proSeasons: 5,
  previousSalary: 8_000_000,
  rights: { heldByTeam: "Home", birdLevel: "non_bird", seasonsTowardBird: 1 },
});
const nonBirdLow = getFreeAgentContractRules({ leagueData: league, player: nonBird, teamName: "Home", dashboard: capDashboard, year1Salary: 9_000_000 });
check(nonBirdLow.path === "non_bird", "Non-Bird preview should use rights path while under its ceiling.");
check(nonBirdLow.maxFirstYearSalary === 41_240_000, "Non-Bird slider should show true player max.");
check(nonBirdLow.rightsCeiling === 9_600_000, "Non-Bird rights ceiling mismatch.");
const nonBirdHigh = getFreeAgentContractRules({ leagueData: league, player: nonBird, teamName: "Home", dashboard: capDashboard, year1Salary: 30_000_000 });
check(nonBirdHigh.path === "cap_space", "Above Non-Bird ceiling should preview cap-space route.");
check(nonBirdHigh.maxRaisePct === 0.05, "Above Non-Bird ceiling should preview standard 5% raises.");

const roomRules = getFreeAgentContractRules({
  leagueData: league,
  player: young,
  teamName: "Away",
  dashboard: { rawCapRoomWithoutHolds: 2_000_000, practicalCapRoom: 2_000_000, roomException: 9_366_000, payrollZone: "below_cap", hardCapRoom: null },
  year1Salary: 8_000_000,
});
check(roomRules.maxFirstYearSalary === 41_240_000, "Room-limited team should still show full player salary range.");
check(JSON.stringify(roomRules.allowedYears) === JSON.stringify([1, 2, 3, 4]), "Room-limited team should not hide cap-space years in the builder.");

const minimumRules = getFreeAgentContractRules({
  leagueData: league,
  player: veteran,
  teamName: "Away",
  dashboard: { rawCapRoomWithoutHolds: -30_000_000, practicalCapRoom: -30_000_000, payrollZone: "second_apron", hardCapRoom: null },
  year1Salary: 3_300_000,
});
check(minimumRules.path === "minimum", "Minimum preview path mismatch.");
check(minimumRules.maxFirstYearSalary === 57_736_000, "Minimum-only teams still show true player max in the slider.");
check(JSON.stringify(minimumRules.allowedYears) === JSON.stringify([1, 2, 3, 4]), "Minimum-only teams should show player-legal years and let submit validation block illegal offers.");

check(
  JSON.stringify(buildLegalFreeAgentSalarySchedule(10_000_000, 4, 0.08)) === JSON.stringify([10_000_000, 10_800_000, 11_600_000, 12_400_000]),
  "UI legal salary schedule mismatch."
);

console.log(JSON.stringify({ status: "PASS", checks }, null, 2));
