import assert from "node:assert/strict";
import {
  buildRetirementAccomplishments,
  buildRetirementReason,
  buildRetirementNarrativeSnapshot,
} from "../src/utils/retirementNarrative.js";

const horfordLike = {
  id: 1,
  name: "Veteran Big",
  age: 40,
  overall: 68,
  position: "C",
  retiredFromTeam: "Golden State Warriors",
  history: {
    seasons: [
      { seasonYear: 2015, team: "Atlanta Hawks", gp: 76, ppg: 15.2, rpg: 7.2, apg: 3.2 },
      { seasonYear: 2016, team: "Atlanta Hawks", gp: 82, ppg: 15.8, rpg: 7.3, apg: 3.3 },
      { seasonYear: 2025, team: "Golden State Warriors", gp: 62, ppg: 7.0, rpg: 4.3, apg: 2.1 },
    ],
    accolades: [
      { seasonYear: 2015, type: "all_star", label: "NBA All-Star", team: "Atlanta Hawks" },
      { seasonYear: 2016, type: "all_star", label: "NBA All-Star", team: "Atlanta Hawks" },
      { seasonYear: 2025, type: "champion", label: "NBA Champion", team: "Golden State Warriors" },
    ],
  },
};

const reason = buildRetirementReason(horfordLike);
assert.match(reason, /Atlanta Hawks/);
assert.match(reason, /(2025.*(championship|champions|title)|championship.*2025|title.*2025)/i);
assert.match(reason, /Golden State Warriors/);
assert.doesNotMatch(reason, /what i'll look back on most is nba champion/i);
assert.doesNotMatch(reason, /\b\d+\.\d+\s*(PPG|RPG|APG)\b/i);
assert.doesNotMatch(reason, /\b(PPG|RPG|APG)\b/i);

const accomplishments = buildRetirementAccomplishments(horfordLike);
assert.ok(accomplishments.includes("2025 NBA Champion — Golden State Warriors"));
assert.ok(accomplishments.some((row) => row.includes("2× NBA All-Star") && row.includes("2015") && row.includes("2016")));
assert.ok(accomplishments.some((row) => /15\.8 PPG/.test(row)), "Accomplishments should keep exact stats");

const sparse = {
  id: 2,
  name: "Sparse Veteran",
  age: 37,
  overall: 61,
  position: "SF",
  retiredFromTeam: "Free Agency",
  history: { seasons: [], accolades: [] },
};
const sparseReason = buildRetirementReason(sparse);
assert.ok(sparseReason.length > 30);
assert.deepEqual(buildRetirementAccomplishments(sparse), ["No major recorded career honors."]);

// Variation regression: similar veterans should not all open with the same canned sentence.
const mockVeterans = Array.from({ length: 24 }, (_, index) => ({
  id: 100 + index,
  name: `Mock Veteran ${index + 1}`,
  age: 35 + (index % 5),
  overall: 64 + (index % 8),
  position: index % 2 ? "PG" : "PF",
  retiredFromTeam: index % 3 === 0 ? "Free Agency" : "Example Team",
  history: {
    seasons: [
      { seasonYear: 2018, team: "Example Team", gp: 75, ppg: 18.6, rpg: 5.4, apg: 4.7 },
      { seasonYear: 2026, team: "Example Team", gp: 62, ppg: 7.2, rpg: 3.1, apg: 2.4 },
    ],
    accolades: [],
  },
}));

const openings = mockVeterans.map((player) => buildRetirementReason(player).split(/[.!?]/)[0].trim());
assert.ok(new Set(openings).size >= 12, `Expected broad opening variety, got ${new Set(openings).size}/24 unique openings`);
const fullReasons = mockVeterans.map((player) => buildRetirementReason(player));
assert.ok(new Set(fullReasons).size >= 22, `Expected near-unique full narratives, got ${new Set(fullReasons).size}/24 unique reasons`);
for (const text of mockVeterans.map((player) => buildRetirementReason(player))) {
  assert.doesNotMatch(text, /\b\d+\.\d+\s*(PPG|RPG|APG)\b/i);
  assert.doesNotMatch(text, /\b(PPG|RPG|APG)\b/i);
}

const snapshot = buildRetirementNarrativeSnapshot([horfordLike, sparse]);
assert.equal(Object.keys(snapshot).length, 2);
assert.ok(snapshot["id:1"].reason.includes("Golden State Warriors"));

console.log("Retirement story variety regression passed.");
