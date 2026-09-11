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

function read(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

function setClock({ date, phase, seasonYear }) {
  localStorage.setItem(
    "bm_league_clock_v1",
    JSON.stringify({ date, phase, seasonYear, source: "surgical_patch_regression" })
  );
}

const { getOffseasonTradeContext } = await import("../src/utils/offseasonTradeContext.js");
const { getOffseasonGuaranteedContractStatus } = await import("../src/utils/tradeRosterEligibility.js");
const { getUserTradeDeadlineStatus, getUserTradePlayerSalary } = await import("../src/utils/userTradeRules.js");

// ---------------------------------------------------------------------------
// 1) Offseason contract/payroll-year correctness.
// Reproduce the reported shape: the offseason/draft label is one year ahead of
// seasonStartYear, while the guaranteed upcoming salary is keyed by the draft
// year itself (2029), NOT seasonYear + 1 (2030).
// ---------------------------------------------------------------------------
localStorage.clear();
setClock({ date: "2029-07-15", phase: "offseason", seasonYear: 2029 });

const offseasonLeague = {
  seasonStartYear: 2028,
  seasonYear: 2028,
  currentSeasonYear: 2028,
  draftYear: 2029,
  currentDraftYear: 2029,
  teams: [],
  offseasonState: {
    seasonYear: 2029,
    active: true,
    retirementsComplete: true,
    optionsComplete: true,
    draftComplete: true,
    freeAgencyStarted: true,
  },
};

const offseasonContext = getOffseasonTradeContext(offseasonLeague);
assert.equal(offseasonContext.inOffseason, true);
assert.equal(offseasonContext.seasonYear, 2029);
assert.equal(
  offseasonContext.targetContractSeasonYear,
  2029,
  "Upcoming guaranteed salary must use the 2029 payroll slot, not 2030."
);

const guaranteedVeteran = {
  id: "guaranteed-veteran",
  name: "Guaranteed Veteran",
  contract: {
    startYear: 2026,
    salaryByYear: [18_000_000, 20_000_000, 22_000_000, 24_000_000],
  },
};
const guaranteedStatus = getOffseasonGuaranteedContractStatus(guaranteedVeteran, {
  leagueData: offseasonLeague,
  tradeContext: offseasonContext,
});
assert.equal(guaranteedStatus.eligible, true, "Guaranteed upcoming-year veterans must be tradeable in the offseason.");
assert.equal(guaranteedStatus.targetSeasonYear, 2029);
assert.equal(guaranteedStatus.salary, 24_000_000);
assert.equal(
  getUserTradePlayerSalary(guaranteedVeteran, offseasonLeague),
  24_000_000,
  "User trade salary matching must use the same upcoming payroll year."
);

const expiredVeteran = {
  id: "expired-veteran",
  name: "Expired Veteran",
  contract: {
    startYear: 2026,
    salaryByYear: [18_000_000, 20_000_000, 22_000_000],
  },
};
assert.equal(
  getOffseasonGuaranteedContractStatus(expiredVeteran, {
    leagueData: offseasonLeague,
    tradeContext: offseasonContext,
  }).code,
  "EXPIRING_CONTRACT",
  "Actually expired contracts must remain blocked."
);

const pendingOption = {
  id: "pending-option",
  name: "Pending Option",
  contract: {
    startYear: 2026,
    salaryByYear: [8_000_000, 9_000_000, 10_000_000, 11_000_000],
    option: { type: "team", yearIndex: 3, picked: null },
  },
};
const optionStatus = getOffseasonGuaranteedContractStatus(pendingOption, {
  leagueData: offseasonLeague,
  tradeContext: offseasonContext,
});
assert.equal(optionStatus.eligible, false);
assert.equal(optionStatus.code, "PENDING_TEAM_OPTION", "Pending options must still be blocked until resolved.");

console.log("PASS surgical_patch.offseason_contract_payroll_year");

// ---------------------------------------------------------------------------
// 2) Trade deadline state must be season-scoped.
// ---------------------------------------------------------------------------
localStorage.clear();
setClock({ date: "2029-10-01", phase: "regular_season", seasonYear: 2029 });
const regularLeague = {
  seasonStartYear: 2029,
  seasonYear: 2029,
  currentSeasonYear: 2029,
  draftYear: 2029,
  currentDraftYear: 2029,
  teams: [],
};

localStorage.setItem(
  "bm_trade_deadline_status_v1",
  JSON.stringify({ seasonYear: 2028, deadlineDate: "2029-02-04", locked: true })
);
assert.equal(
  getUserTradeDeadlineStatus(regularLeague).locked,
  false,
  "A prior season's locked deadline status must never lock opening day of the new season."
);

localStorage.setItem(
  "bm_trade_deadline_status_v1",
  JSON.stringify({ seasonYear: 2029, deadlineDate: "2030-02-04", locked: true })
);
assert.equal(
  getUserTradeDeadlineStatus(regularLeague).locked,
  true,
  "A lock explicitly scoped to the current season must still be honored."
);
console.log("PASS surgical_patch.trade_deadline_season_scope");

// ---------------------------------------------------------------------------
// 3) Trade Finder hot path: an already-resolved explicit context must be reused
// verbatim during the regular season. This prevents schedule/results parsing for
// each team/package evaluation.
// ---------------------------------------------------------------------------
localStorage.clear();
setClock({ date: "2029-12-10", phase: "regular_season", seasonYear: 2029 });
const explicitContext = {
  version: 4,
  seasonYear: 2029,
  contractSeasonYear: 2029,
  targetContractSeasonYear: 2029,
  inOffseason: false,
  stage: "regular_season",
  recordSnapshot: { "Charlotte Hornets": { w: 18, l: 7, gp: 25 } },
};
assert.equal(
  getOffseasonTradeContext(regularLeague, explicitContext),
  explicitContext,
  "Trade Finder must reuse the already-resolved search context instead of reconstructing it."
);
console.log("PASS surgical_patch.trade_finder_explicit_context_reuse");

// ---------------------------------------------------------------------------
// 4) Static guards for UI/performance changes that are intentionally surgical.
// ---------------------------------------------------------------------------
const progressionSource = read("src/pages/PlayerProgression.jsx");
assert.match(progressionSource, /\["POT", featured\.potential, deltaFor\(featured, "potential"\)\]/);
assert.match(progressionSource, /DeltaBadge d=\{deltaFor\(p, "potential"\)\}/);
assert.doesNotMatch(progressionSource, /\["POT", featured\.potential, 0\]/);
console.log("PASS surgical_patch.potential_delta_visible");

const portraitSource = read("src/components/RuntimePlayerPortrait.jsx");
const tradeFinderSource = read("src/pages/TradeFinder.jsx");
assert.match(portraitSource, /layoutPage === "trade-finder"/);
assert.match(tradeFinderSource, /layoutPage="trade-finder"/);
console.log("PASS surgical_patch.trade_finder_portrait_envelope");

const playerCardSource = read("src/components/PlayerCardModal.jsx");
assert.match(playerCardSource, /function getRemainingContractView\(/);
assert.match(playerCardSource, /salaryByYear\.slice\(offset\)/);
assert.match(playerCardSource, /getContractOptionInfo\(player\?\.contract, originalIndex,/);
assert.match(playerCardSource, /value=\{contractDisplayStartYear \|\| "-"\}/);
assert.match(playerCardSource, /pc-overview-fit/);
console.log("PASS surgical_patch.player_card_current_contract_view");

const calendarSource = read("src/pages/Calendar.jsx");
const playoffsSource = read("src/pages/Playoffs.jsx");
assert.match(calendarSource, /function refreshSimulationRuntimeForTouchedTeams\(/);
assert.doesNotMatch(calendarSource, /structuredClone\(activeLeagueData\)/);
assert.match(calendarSource, /saveInjuryStateOverlay\(normalizedInjurySnapshot/);
assert.match(playoffsSource, /Playoffs\.injuryRecovery\.sidecar/);
assert.match(playoffsSource, /Playoffs\.gameInjury\.sidecar/);
assert.match(playoffsSource, /Playoffs\.playInInjuryRecovery\.sidecar/);
assert.match(playoffsSource, /Playoffs\.playInGameInjury\.sidecar/);
assert.doesNotMatch(playoffsSource, /Playoffs\.(?:injuryRecovery|gameInjury|playInInjuryRecovery|playInGameInjury)\.explicit/);
console.log("PASS surgical_patch.injury_sidecar_fast_path");

const impactSource = read("src/utils/tradeTeamImpact.js");
assert.match(impactSource, /let tradeFinderLeaguePowerSignatureCache = new WeakMap\(\)/);
assert.match(impactSource, /function tradeFinderLeaguePowerSignature\(/);
assert.match(impactSource, /const cached = tradeFinderLeaguePowerSignatureCache\.get\(key\)/);
assert.match(impactSource, /tradeFinderLeaguePowerSignatureCache\.set\(key, \{ leagueData, signature \}\)/);
assert.match(impactSource, /const leagueSignature = tradeFinderLeaguePowerSignature\(leagueData, teams, cpuTradeContext\)/);
console.log("PASS surgical_patch.trade_finder_power_signature_cache");

console.log("Surgical patch regression passed: 8/8 checks.");
