import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { evaluateCpuContractFriction } from "../src/utils/tradeContractValue.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(frontendRoot, rel), "utf8");
}

function check(label, fn) {
  try {
    fn();
    console.log(`PASS ${label}`);
  } catch (error) {
    console.error(`FAIL ${label}`);
    throw error;
  }
}

const propose = read("src/pages/ProposeTrade.jsx");
const impact = read("src/utils/tradeTeamImpact.js");
const execution = read("src/utils/tradeExecution.js");

check("Propose Trade has no Evaluate Trade button", () => {
  assert.equal(propose.includes('"Evaluate Trade"'), false);
  assert.equal(propose.includes("onClick={evaluateWithCpu}"), false);
});

check("Submit Proposal is the single CPU negotiation action", () => {
  assert.match(propose, /const submitProposal = async \(\) =>/);
  assert.match(propose, /onClick=\{submitProposal\}/);
  assert.match(propose, /const freshEvaluation = evaluateTradeTeamImpact\(/);
  assert.match(propose, /evaluation: freshEvaluation,/);
});

check("Rejected proposal keeps package and stores internal margin", () => {
  assert.match(propose, /if \(!hasAcceptedEvaluation\(freshEvaluation\)\)/);
  assert.match(propose, /lastProposalEvaluation: buildInternalProposalEvaluationSnapshot\(freshEvaluation\)/);
  assert.match(propose, /setDecisionModal\(\{ accepted: false, teamName: cpuTeamName \}\)/);
});

check("Accepted proposal executes immediately and shows centered decision modal", () => {
  assert.match(propose, /executeAcceptedTradeOnLeagueShared\(\{/);
  assert.match(propose, /setDecisionModal\(\{ accepted: true, teamName: cpuTeamName \}\)/);
  assert.match(propose, /className="fixed inset-0 z-\[70\] flex items-center justify-center/);
  assert.match(propose, /has \{decisionModal\.accepted \? "accepted" : "declined"\} the trade\./);
});

check("Visible raw CPU score panel is removed", () => {
  assert.equal(propose.includes("CPU Decision"), false);
  assert.equal(propose.includes("Score {Number(evaluation.score"), false);
});

check("Canonical evaluator stores internal decision margin", () => {
  assert.match(impact, /decisionMargin: round4\(decisionMargin\)/);
  assert.match(impact, /rawScoreMargin,/);
  assert.match(impact, /acceptancePath,/);
});

check("User-only contract term nudge is shared through tradeTeamImpact", () => {
  assert.match(impact, /userTradeTermTuning: !isCpuCpuEvaluation/);
});

check("Executed user trades persist internal negotiation margin", () => {
  assert.match(execution, /cpuDecisionMargin:/);
  assert.match(execution, /decisionMargin:/);
  assert.match(execution, /cpuAcceptancePath:/);
});

const leagueData = {
  seasonYear: 2026,
  payrollSeasonYear: 2026,
  salaryCap: 164_961_000,
  maxSalary: 60_000_000,
  minimumSalary: 1_200_000,
};

function badContract(years) {
  return {
    id: `bad_${years}`,
    name: `Bad Contract ${years}`,
    overall: 72,
    potential: 72,
    age: 31,
    offRating: 72,
    defRating: 72,
    scoringRating: 60,
    contract: {
      startYear: 2026,
      salaryByYear: Array.from({ length: years }, () => 30_000_000),
    },
  };
}

function incomingFriction(years, tuned) {
  return evaluateCpuContractFriction({
    leagueData,
    cpuIncomingPlayers: [badContract(years)],
    cpuOutgoingPlayers: [],
    userTradeTermTuning: tuned,
  }).friction;
}

check("Expiring bad contract is only slightly easier for the CPU to take", () => {
  const base = incomingFriction(1, false);
  const tuned = incomingFriction(1, true);
  const ratio = tuned / base;
  assert.ok(tuned < base);
  assert.ok(ratio >= 0.95 && ratio <= 0.97, `expected tiny ~4% easing, got ${ratio}`);
});

check("Two-year bad contract is only slightly harder", () => {
  const base = incomingFriction(2, false);
  const tuned = incomingFriction(2, true);
  const ratio = tuned / base;
  assert.ok(tuned > base);
  assert.ok(ratio >= 1.005 && ratio <= 1.015, `expected tiny ~1% increase, got ${ratio}`);
});

check("Three-year bad contract is only slightly harder", () => {
  const base = incomingFriction(3, false);
  const tuned = incomingFriction(3, true);
  const ratio = tuned / base;
  assert.ok(tuned > base);
  assert.ok(ratio >= 1.015 && ratio <= 1.025, `expected tiny ~2% increase, got ${ratio}`);
});

check("Four-year bad contract is only slightly harder", () => {
  const base = incomingFriction(4, false);
  const tuned = incomingFriction(4, true);
  const ratio = tuned / base;
  assert.ok(tuned > base);
  assert.ok(ratio >= 1.025 && ratio <= 1.035, `expected tiny ~3% increase, got ${ratio}`);
});

check("CPU-to-CPU/default contract friction stays unchanged", () => {
  for (const years of [1, 2, 3, 4]) {
    const implicitDefault = evaluateCpuContractFriction({
      leagueData,
      cpuIncomingPlayers: [badContract(years)],
      cpuOutgoingPlayers: [],
    }).friction;
    const explicitUntuned = incomingFriction(years, false);
    assert.equal(implicitDefault, explicitUntuned);
  }
});

console.log("\nPatch 55 user-trade one-click regression: PASS");
