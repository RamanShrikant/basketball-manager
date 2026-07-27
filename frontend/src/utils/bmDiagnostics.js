import {
  buildCpuTradeDiagnosticReport,
  compareCpuTradeDiagnosticReports,
  readCpuTradeBaselineReport,
  resetCpuTradeDiagnostics,
  runCpuTradePackageBenchmarks,
  saveCpuTradeBaselineReport,
} from "./cpuTradeDiagnostics.js";
import {
  REGULAR_SEASON_MAX_STANDARD_PLAYERS,
  REGULAR_SEASON_MAX_TWO_WAY_PLAYERS,
  REGULAR_SEASON_MIN_STANDARD_PLAYERS,
  ROSTER_RULES_VERSION,
  TRADE_TEMPORARY_STANDARD_ROSTER_MAX,
  countStandardRosterPlayers,
  countTwoWayRosterPlayers,
  evaluateTeamSimulationRoster,
  evaluateTradeRosterProjection,
} from "./rosterRules.js";

const DIAGNOSTICS_VERSION = "2026-07-27_cpu_trade_speed_v3_order_probe";
const AUTO_DIAGNOSTICS_KEY = "bm_diagnostics_auto_v1";

const runtime = {
  leagueData: null,
  selectedTeam: null,
  tradeFinder: null,
  lastLoadAttempt: null,
  lastPreSimulation: null,
  lastCpuTradeRepair: null,
  lastSimulationPerformance: null,
  simulationPerformanceHistory: [],
  lastCpuTradeReport: null,
  lastCpuTradeComparison: null,
  lastReport: null,
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function teamNameOf(team = {}) {
  return team?.name || team?.teamName || team?.team || "Unknown Team";
}

function playerNameOf(player = {}) {
  return player?.name || player?.player || player?.fullName || "Unknown Player";
}

function playerIdentity(player = {}) {
  const id = player?.id ?? player?.playerId ?? player?.personId ?? player?.nbaId;
  if (id !== null && id !== undefined && String(id).trim()) return `id:${String(id)}`;
  return `name:${normalizeText(playerNameOf(player))}`;
}

function getAllTeams(leagueData = {}) {
  if (Array.isArray(leagueData?.teams)) return leagueData.teams.filter(Boolean);
  const conferences = leagueData?.conferences;
  if (!conferences || typeof conferences !== "object") return [];
  return Object.values(conferences).flatMap((rows) => (Array.isArray(rows) ? rows.filter(Boolean) : []));
}

function contractTypeOf(player = {}) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  return String(
    player?.contractType ||
      player?.rosterStatus ||
      contract?.type ||
      contract?.contractType ||
      "standard"
  ).toLowerCase();
}

function isTwoWayContract(player = {}) {
  const type = contractTypeOf(player);
  return Boolean(player?.isTwoWay || type.includes("two_way") || type.includes("two-way"));
}

function isStashContract(player = {}) {
  const type = contractTypeOf(player);
  return Boolean(player?.isStash || type.includes("stash") || type.includes("stashed"));
}

function addCheck(checks, {
  id,
  ok,
  severity = "error",
  message,
  details = null,
}) {
  const status = ok ? "pass" : severity === "warning" ? "warning" : "fail";
  checks.push({ id, status, severity, message, details });
}

function finishReport(name, checks, extra = {}) {
  const errors = checks.filter((row) => row.status === "fail").length;
  const warnings = checks.filter((row) => row.status === "warning").length;
  const passed = checks.filter((row) => row.status === "pass").length;
  const report = {
    name,
    diagnosticsVersion: DIAGNOSTICS_VERSION,
    rosterRulesVersion: ROSTER_RULES_VERSION,
    generatedAt: nowIso(),
    ok: errors === 0,
    summary: { passed, warnings, errors, total: checks.length },
    checks,
    ...extra,
  };
  runtime.lastReport = report;
  try {
    window.__BM_LAST_DIAGNOSTICS__ = report;
  } catch {}
  return report;
}

function printReport(report, label = "BM DIAGNOSTICS") {
  if (!report) return report;
  const method = report.ok ? "log" : "error";
  console.groupCollapsed(
    `[${label}] ${report.ok ? "PASS" : "FAIL"} • ${report.summary?.errors || 0} errors • ${report.summary?.warnings || 0} warnings`
  );
  console[method](report);
  const rows = (report.checks || [])
    .filter((row) => row.status !== "pass")
    .map((row) => ({
      status: row.status,
      id: row.id,
      message: row.message,
    }));
  if (rows.length) console.table(rows);
  else console.log("All checks passed.");
  console.groupEnd();
  return report;
}

function autoDiagnosticsEnabled() {
  try {
    return localStorage.getItem(AUTO_DIAGNOSTICS_KEY) !== "0";
  } catch {
    return true;
  }
}

export function updateBasketballManagerDiagnosticsContext({ leagueData, selectedTeam } = {}) {
  if (leagueData !== undefined) runtime.leagueData = leagueData;
  if (selectedTeam !== undefined) runtime.selectedTeam = selectedTeam;
  try {
    window.__BM_DIAGNOSTICS_CONTEXT__ = {
      leagueData: runtime.leagueData,
      selectedTeam: runtime.selectedTeam,
    };
  } catch {}
}

export function auditLeagueIntegrity(leagueData = runtime.leagueData, { selectedTeam = runtime.selectedTeam } = {}) {
  const checks = [];
  const teams = getAllTeams(leagueData || {});

  addCheck(checks, {
    id: "league.loaded",
    ok: Boolean(leagueData && typeof leagueData === "object"),
    message: leagueData ? "League data is loaded." : "League data is not loaded.",
  });
  if (!leagueData || typeof leagueData !== "object") return finishReport("league_integrity", checks);

  addCheck(checks, {
    id: "league.team_count",
    ok: teams.length === 30,
    severity: "warning",
    message: teams.length === 30
      ? "League contains 30 teams."
      : `League contains ${teams.length} teams instead of 30.`,
    details: { teamCount: teams.length },
  });

  const teamNames = teams.map(teamNameOf);
  const normalizedTeamNames = teamNames.map(normalizeText);
  const duplicateTeamNames = normalizedTeamNames.filter((name, index) => name && normalizedTeamNames.indexOf(name) !== index);
  addCheck(checks, {
    id: "league.unique_teams",
    ok: duplicateTeamNames.length === 0,
    message: duplicateTeamNames.length
      ? `Duplicate team names detected: ${Array.from(new Set(duplicateTeamNames)).join(", ")}.`
      : "Team names are unique.",
    details: { duplicateTeamNames: Array.from(new Set(duplicateTeamNames)) },
  });

  const ownership = new Map();
  const rosterRows = [];
  const duplicateWithinTeam = [];
  const metadataMismatches = [];
  const standardListContractErrors = [];
  const twoWayListContractWarnings = [];

  for (const team of teams) {
    const teamName = teamNameOf(team);
    const standardPlayers = Array.isArray(team?.players) ? team.players.filter(Boolean) : [];
    const twoWayPlayers = Array.isArray(team?.twoWayPlayers) ? team.twoWayPlayers.filter(Boolean) : [];
    const readiness = evaluateTeamSimulationRoster(team);
    rosterRows.push({
      team: teamName,
      standard: readiness.standardCount,
      twoWay: readiness.twoWayCount,
      pendingRookies: readiness.pendingRookieCount,
      readyToSim: readiness.ok,
    });

    addCheck(checks, {
      id: `roster.standard_max.${normalizeText(teamName)}`,
      ok: readiness.standardCount <= REGULAR_SEASON_MAX_STANDARD_PLAYERS,
      message: readiness.standardCount <= REGULAR_SEASON_MAX_STANDARD_PLAYERS
        ? `${teamName} is at or below the ${REGULAR_SEASON_MAX_STANDARD_PLAYERS}-player standard-roster maximum.`
        : `${teamName} has ${readiness.standardCount} standard players, above the ${REGULAR_SEASON_MAX_STANDARD_PLAYERS}-player maximum.`,
      details: readiness,
    });

    addCheck(checks, {
      id: `roster.standard_min.${normalizeText(teamName)}`,
      ok: readiness.standardCount >= REGULAR_SEASON_MIN_STANDARD_PLAYERS,
      severity: "warning",
      message: readiness.standardCount >= REGULAR_SEASON_MIN_STANDARD_PLAYERS
        ? `${teamName} meets the ${REGULAR_SEASON_MIN_STANDARD_PLAYERS}-player simulation minimum.`
        : `${teamName} has ${readiness.standardCount} standard players and must auto-sign or sign ${REGULAR_SEASON_MIN_STANDARD_PLAYERS - readiness.standardCount} before simulation.`,
      details: readiness,
    });

    addCheck(checks, {
      id: `roster.two_way_max.${normalizeText(teamName)}`,
      ok: readiness.twoWayCount <= REGULAR_SEASON_MAX_TWO_WAY_PLAYERS,
      message: readiness.twoWayCount <= REGULAR_SEASON_MAX_TWO_WAY_PLAYERS
        ? `${teamName} is at or below the ${REGULAR_SEASON_MAX_TWO_WAY_PLAYERS}-player two-way maximum.`
        : `${teamName} has ${readiness.twoWayCount} two-way players, above the ${REGULAR_SEASON_MAX_TWO_WAY_PLAYERS}-player maximum.`,
      details: readiness,
    });

    const localSeen = new Set();
    const inspect = (player, bucket) => {
      const identity = playerIdentity(player);
      if (localSeen.has(identity)) duplicateWithinTeam.push({ team: teamName, player: playerNameOf(player), identity, bucket });
      localSeen.add(identity);

      const owners = ownership.get(identity) || [];
      owners.push({ team: teamName, bucket, player: playerNameOf(player) });
      ownership.set(identity, owners);

      const metadataTeam = player?.team || player?.teamName || player?.currentTeam;
      if (metadataTeam && normalizeText(metadataTeam) !== normalizeText(teamName)) {
        metadataMismatches.push({ player: playerNameOf(player), containerTeam: teamName, metadataTeam, bucket });
      }

      if (bucket === "standard" && (isTwoWayContract(player) || isStashContract(player))) {
        standardListContractErrors.push({ team: teamName, player: playerNameOf(player), contractType: contractTypeOf(player) });
      }
      if (bucket === "two_way" && !isTwoWayContract(player)) {
        twoWayListContractWarnings.push({ team: teamName, player: playerNameOf(player), contractType: contractTypeOf(player) });
      }
    };

    standardPlayers.forEach((player) => inspect(player, "standard"));
    twoWayPlayers.forEach((player) => inspect(player, "two_way"));
  }

  const crossTeamDuplicates = Array.from(ownership.entries())
    .filter(([, owners]) => new Set(owners.map((row) => normalizeText(row.team))).size > 1)
    .map(([identity, owners]) => ({ identity, owners }));

  addCheck(checks, {
    id: "players.duplicate_within_team",
    ok: duplicateWithinTeam.length === 0,
    message: duplicateWithinTeam.length
      ? `${duplicateWithinTeam.length} duplicate player roster entries were found within teams.`
      : "No duplicate player entries were found within a team.",
    details: duplicateWithinTeam,
  });

  addCheck(checks, {
    id: "players.cross_team_ownership",
    ok: crossTeamDuplicates.length === 0,
    message: crossTeamDuplicates.length
      ? `${crossTeamDuplicates.length} players appear on more than one team's roster.`
      : "Every rostered player has one team owner.",
    details: crossTeamDuplicates,
  });

  const rosterIdentitySet = new Set(ownership.keys());
  const freeAgents = Array.isArray(leagueData?.freeAgents) ? leagueData.freeAgents.filter(Boolean) : [];
  const freeAgentDuplicates = freeAgents
    .map((player) => ({ identity: playerIdentity(player), player: playerNameOf(player) }))
    .filter((row) => rosterIdentitySet.has(row.identity));
  addCheck(checks, {
    id: "players.roster_free_agent_overlap",
    ok: freeAgentDuplicates.length === 0,
    message: freeAgentDuplicates.length
      ? `${freeAgentDuplicates.length} players are both rostered and listed as free agents.`
      : "No rostered player is duplicated in free agency.",
    details: freeAgentDuplicates,
  });

  addCheck(checks, {
    id: "players.standard_list_contract_types",
    ok: standardListContractErrors.length === 0,
    message: standardListContractErrors.length
      ? `${standardListContractErrors.length} two-way/stash contracts are incorrectly stored on standard rosters.`
      : "Standard roster lists contain only standard-roster contracts.",
    details: standardListContractErrors,
  });

  addCheck(checks, {
    id: "players.two_way_list_contract_types",
    ok: twoWayListContractWarnings.length === 0,
    severity: "warning",
    message: twoWayListContractWarnings.length
      ? `${twoWayListContractWarnings.length} players in two-way lists do not have an explicit two-way contract marker.`
      : "Two-way roster entries have two-way contract markers.",
    details: twoWayListContractWarnings,
  });

  addCheck(checks, {
    id: "players.team_metadata",
    ok: metadataMismatches.length === 0,
    severity: "warning",
    message: metadataMismatches.length
      ? `${metadataMismatches.length} player team labels disagree with their roster container.`
      : "Player team labels agree with roster ownership.",
    details: metadataMismatches,
  });

  const controlledName = teamNameOf(selectedTeam || {});
  const controlled = teams.find((team) => normalizeText(teamNameOf(team)) === normalizeText(controlledName));
  if (controlled && controlledName !== "Unknown Team") {
    const userReadiness = evaluateTeamSimulationRoster(controlled);
    addCheck(checks, {
      id: "user.simulation_readiness",
      ok: userReadiness.ok,
      severity: "warning",
      message: userReadiness.ok
        ? `${controlledName} is ready to simulate.`
        : userReadiness.message,
      details: userReadiness,
    });
  }

  return finishReport("league_integrity", checks, { rosterRows });
}

function makeItems(count, prefix) {
  return Array.from({ length: count }, (_, index) => ({
    type: "player",
    player: {
      id: `${prefix}_${index + 1}`,
      name: `${prefix} ${index + 1}`,
      contractType: "standard",
      rosterStatus: "standard",
    },
  }));
}

function makeTeam(name, count) {
  return {
    name,
    players: makeItems(count, name.replace(/\s+/g, "_")).map((item) => item.player),
    twoWayPlayers: [],
  };
}

export function runTradeRosterRegressionTests() {
  const checks = [];
  const cases = [
    {
      id: "asymmetric.1_for_3_balanced",
      description: "A 14-player team may temporarily reach 16 while the other side moves from 16 to 14.",
      a: 14,
      b: 16,
      aOut: 1,
      bOut: 3,
      expectedOk: true,
      expectedA: 16,
      expectedB: 14,
      expectedRepairA: true,
      expectedRepairB: false,
    },
    {
      id: "asymmetric.1_for_3_both_repair",
      description: "A one-for-three package is legal even when one side reaches 16 and the other falls to 13; both must repair before simulation.",
      a: 14,
      b: 15,
      aOut: 1,
      bOut: 3,
      expectedOk: true,
      expectedA: 16,
      expectedB: 13,
      expectedRepairA: true,
      expectedRepairB: true,
    },
    {
      id: "asymmetric.3_for_1_reverse",
      description: "A three-for-one trade is legal when a 14-player team temporarily reaches 16.",
      a: 16,
      b: 14,
      aOut: 3,
      bOut: 1,
      expectedOk: true,
      expectedA: 14,
      expectedB: 16,
      expectedRepairA: false,
      expectedRepairB: true,
    },
    {
      id: "temporary_limit.blocks_17_from_15",
      description: "A 15-player team cannot jump directly to 17 because its temporary transaction limit is 16.",
      a: 15,
      b: 15,
      aOut: 1,
      bOut: 3,
      expectedOk: false,
      expectedA: 17,
      expectedB: 13,
      expectedRepairA: true,
      expectedRepairB: true,
    },
    {
      id: "temporary_limit.current_16_can_add_one",
      description: "A team already at 16 may add one net standard contract and reach 17, then must repair before simulation.",
      a: 16,
      b: 15,
      aOut: 1,
      bOut: 2,
      expectedOk: true,
      expectedA: 17,
      expectedB: 14,
      expectedRepairA: true,
      expectedRepairB: false,
    },
    {
      id: "temporary_limit.current_16_cannot_add_two",
      description: "A team at 16 cannot add two net standard contracts because only one extra is permitted.",
      a: 16,
      b: 15,
      aOut: 1,
      bOut: 3,
      expectedOk: false,
      expectedA: 18,
      expectedB: 13,
      expectedRepairA: true,
      expectedRepairB: true,
    },
    {
      id: "temporary_limit.current_17_can_add_one",
      description: "A temporary/legacy 17-player roster may add at most one net player and reach 18, then must repair.",
      a: 17,
      b: 15,
      aOut: 1,
      bOut: 2,
      expectedOk: true,
      expectedA: 18,
      expectedB: 14,
      expectedRepairA: true,
      expectedRepairB: false,
    },
  ];

  const caseRows = [];
  for (const testCase of cases) {
    const teamA = makeTeam("Team A", testCase.a);
    const teamB = makeTeam("Team B", testCase.b);
    const aItems = makeItems(testCase.aOut, "A_out");
    const bItems = makeItems(testCase.bOut, "B_out");
    const aProjection = evaluateTradeRosterProjection({ team: teamA, outgoingItems: aItems, incomingItems: bItems });
    const bProjection = evaluateTradeRosterProjection({ team: teamB, outgoingItems: bItems, incomingItems: aItems });
    const actualOk = aProjection.ok && bProjection.ok;
    const passed = Boolean(
      actualOk === testCase.expectedOk &&
        aProjection.counts.projected === testCase.expectedA &&
        bProjection.counts.projected === testCase.expectedB &&
        aProjection.requiresRepairBeforeSimulation === testCase.expectedRepairA &&
        bProjection.requiresRepairBeforeSimulation === testCase.expectedRepairB
    );
    caseRows.push({
      id: testCase.id,
      passed,
      actualOk,
      aProjected: aProjection.counts.projected,
      bProjected: bProjection.counts.projected,
      aAllowedMax: aProjection.allowedMax,
      bAllowedMax: bProjection.allowedMax,
      aRepair: aProjection.requiresRepairBeforeSimulation,
      bRepair: bProjection.requiresRepairBeforeSimulation,
      description: testCase.description,
    });
    addCheck(checks, {
      id: `regression.${testCase.id}`,
      ok: passed,
      message: passed ? testCase.description : `Regression failed: ${testCase.description}`,
      details: { testCase, aProjection, bProjection },
    });
  }

  const standardTeam = makeTeam("Standard Team", 15);
  standardTeam.twoWayPlayers = makeItems(3, "tw").map((item) => ({
    ...item.player,
    contractType: "two_way",
    rosterStatus: "two_way",
  }));
  const readiness = evaluateTeamSimulationRoster(standardTeam);
  addCheck(checks, {
    id: "regression.two_way_not_standard",
    ok:
      countStandardRosterPlayers(standardTeam) === 15 &&
      countTwoWayRosterPlayers(standardTeam) === 3 &&
      readiness.ok,
    message: "Two-way players are excluded from the 15-player standard-roster simulation limit.",
    details: {
      standardCount: countStandardRosterPlayers(standardTeam),
      twoWayCount: countTwoWayRosterPlayers(standardTeam),
      readiness,
    },
  });

  return finishReport("trade_roster_regressions", checks, { cases: caseRows });
}

export function recordTradeFinderSearchSnapshot(snapshot = {}) {
  runtime.tradeFinder = {
    ...snapshot,
    recordedAt: nowIso(),
  };
  try {
    window.__BM_TRADE_FINDER_DIAGNOSTICS__ = runtime.tradeFinder;
  } catch {}

  if (autoDiagnosticsEnabled()) {
    const report = auditTradeFinderSnapshot(runtime.tradeFinder);
    if (!report.ok) printReport(report, "BM TRADE FINDER AUTO CHECK");
  }
  return runtime.tradeFinder;
}

export function recordTradeFinderLoadAttempt(attempt = {}) {
  runtime.lastLoadAttempt = {
    ...attempt,
    recordedAt: nowIso(),
  };
  try {
    window.__BM_LAST_TRADE_FINDER_LOAD__ = runtime.lastLoadAttempt;
  } catch {}
  if (autoDiagnosticsEnabled() && attempt?.validation && !attempt.validation.ok) {
    console.error("[BM DIAGNOSTICS][TRADE FINDER LOAD BLOCKED]", runtime.lastLoadAttempt);
  }
  return runtime.lastLoadAttempt;
}

export function auditTradeFinderSnapshot(snapshot = runtime.tradeFinder) {
  const checks = [];
  if (!snapshot) {
    addCheck(checks, {
      id: "trade_finder.snapshot",
      ok: false,
      severity: "warning",
      message: "No Trade Finder search snapshot is available. Run a Trade Finder search first.",
    });
    return finishReport("trade_finder_snapshot", checks);
  }

  const offers = Array.isArray(snapshot?.offers) ? snapshot.offers : [];
  const rejectedGeneratedOffers = Array.isArray(snapshot?.rejectedGeneratedOffers)
    ? snapshot.rejectedGeneratedOffers
    : [];
  addCheck(checks, {
    id: "trade_finder.search_completed",
    ok: Boolean(snapshot?.searchCompleted !== false),
    message: snapshot?.searchCompleted === false
      ? "Trade Finder search did not complete."
      : "Trade Finder search completed and recorded diagnostics.",
    details: snapshot,
  });

  addCheck(checks, {
    id: "trade_finder.generated_offers_exactly_valid",
    ok: rejectedGeneratedOffers.length === 0,
    message: rejectedGeneratedOffers.length === 0
      ? "Every generated offer passed exact pre-display validation."
      : `${rejectedGeneratedOffers.length} generated offer${rejectedGeneratedOffers.length === 1 ? " was" : "s were"} filtered before display because exact validation failed.`,
    details: rejectedGeneratedOffers,
  });

  addCheck(checks, {
    id: "trade_finder.displayed_offers_loadable",
    ok: offers.every((offer) => offer?.loadValidation?.ok !== false),
    message: offers.every((offer) => offer?.loadValidation?.ok !== false)
      ? `All ${offers.length} displayed Trade Finder offers pass the same load validation.`
      : `${offers.filter((offer) => offer?.loadValidation?.ok === false).length} displayed offers would fail when Load Offer is clicked.`,
    details: offers.filter((offer) => offer?.loadValidation?.ok === false),
  });

  addCheck(checks, {
    id: "trade_finder.no_duplicate_assets",
    ok: offers.every((offer) => !offer?.duplicateAssetKeys?.length),
    message: offers.every((offer) => !offer?.duplicateAssetKeys?.length)
      ? "Displayed offers contain no duplicate assets."
      : "One or more displayed offers contain duplicate assets.",
    details: offers.filter((offer) => offer?.duplicateAssetKeys?.length),
  });

  addCheck(checks, {
    id: "trade_finder.asymmetric_packages_supported",
    ok: offers.every((offer) => offer?.asymmetricAllowed !== false),
    message: "Trade Finder diagnostics treat one-for-many and many-for-one player packages as legal shapes.",
    details: offers.map((offer) => ({
      team: offer.team,
      userPlayerCount: offer.userPlayerCount,
      cpuPlayerCount: offer.cpuPlayerCount,
      asymmetric: offer.userPlayerCount !== offer.cpuPlayerCount,
      userRequiresRepair: offer.userRosterProjection?.requiresRepairBeforeSimulation,
      cpuRequiresRepair: offer.cpuRosterProjection?.requiresRepairBeforeSimulation,
    })),
  });

  if (snapshot?.reverseFinder) {
    const engine = snapshot?.engineDiagnostics || null;
    addCheck(checks, {
      id: "trade_finder.reverse_engine_diagnostics",
      ok: Boolean(engine),
      severity: "warning",
      message: engine
        ? "Reverse Trade Finder recorded candidate-generation, legality, exact-check, rescue, and validation stage counts."
        : "Reverse Trade Finder did not return engine-stage diagnostics.",
      details: engine,
    });
    if (engine) {
      addCheck(checks, {
        id: "trade_finder.reverse_candidate_coverage",
        ok: Number(engine?.rawGenerated || 0) > 0 && Number(engine?.candidatesSelectedForScan || 0) > 0,
        severity: "warning",
        message: Number(engine?.candidatesSelectedForScan || 0) > 0
          ? `${Number(engine.candidatesSelectedForScan)} legal reverse candidates reached the scan stage.`
          : "No reverse candidates reached the scan stage; inspect rosterRejected and financialRejected.",
        details: engine,
      });
      addCheck(checks, {
        id: "trade_finder.reverse_exact_coverage",
        ok: Number(engine?.initialExactChecks || 0) + Number(engine?.rescueExactChecks || 0) > 0 || Number(engine?.legalCandidates || 0) === 0,
        severity: "warning",
        message: `${Number(engine?.initialExactChecks || 0)} initial and ${Number(engine?.rescueExactChecks || 0)} rescue exact checks were completed.`,
        details: engine,
      });
    }
  }

  return finishReport("trade_finder_snapshot", checks, { snapshot });
}

export function recordPreSimulationDiagnostics({ leagueData, selectedTeam, repairResult = null, mode = "simulation" } = {}) {
  updateBasketballManagerDiagnosticsContext({ leagueData, selectedTeam });
  const report = auditLeagueIntegrity(leagueData, { selectedTeam });
  runtime.lastPreSimulation = {
    mode,
    repairResult,
    report,
    recordedAt: nowIso(),
  };
  try {
    window.__BM_LAST_PRE_SIM_DIAGNOSTICS__ = runtime.lastPreSimulation;
  } catch {}
  if (autoDiagnosticsEnabled()) {
    const controlledName = teamNameOf(selectedTeam || {});
    const controlled = getAllTeams(leagueData || {}).find(
      (team) => normalizeText(teamNameOf(team)) === normalizeText(controlledName)
    );
    const userReadiness = controlled ? evaluateTeamSimulationRoster(controlled) : null;
    const cpuRepairFailed = Boolean(repairResult && repairResult?.ok !== true);

    if (!report.ok || cpuRepairFailed || userReadiness?.ok === false) {
      printReport(report, "BM PRE-SIM AUTO CHECK");
      if (cpuRepairFailed) {
        console.error("[BM DIAGNOSTICS][CPU PRE-SIM REPAIR FAILED]", repairResult);
      }
      if (userReadiness?.ok === false) {
        console.warn("[BM DIAGNOSTICS][USER ROSTER BLOCKED SIMULATION]", userReadiness);
      }
    }
  }
  return runtime.lastPreSimulation;
}

export function recordCpuTradeRepairDiagnostics(payload = {}) {
  runtime.lastCpuTradeRepair = {
    ...payload,
    recordedAt: nowIso(),
  };
  try {
    window.__BM_LAST_CPU_TRADE_REPAIR__ = runtime.lastCpuTradeRepair;
  } catch {}
  const repairOk = payload?.repairResult?.ok === true;
  if (autoDiagnosticsEnabled() && !repairOk) {
    console.error("[BM DIAGNOSTICS][CPU TRADE ROSTER REPAIR FAILED]", runtime.lastCpuTradeRepair);
  }
  return runtime.lastCpuTradeRepair;
}

export function recordSimulationPerformanceDiagnostics(payload = {}) {
  runtime.lastSimulationPerformance = {
    ...payload,
    recordedAt: nowIso(),
  };
  runtime.simulationPerformanceHistory.push(runtime.lastSimulationPerformance);
  if (runtime.simulationPerformanceHistory.length > 8) {
    runtime.simulationPerformanceHistory.splice(
      0,
      runtime.simulationPerformanceHistory.length - 8
    );
  }
  try {
    window.__BM_LAST_SIMULATION_PERFORMANCE__ = runtime.lastSimulationPerformance;
    window.__BM_SIMULATION_PERFORMANCE_HISTORY__ = runtime.simulationPerformanceHistory;
  } catch {}

  console.groupCollapsed(
    `[BM SIM PERFORMANCE] ${payload?.mode || "simulation"} • ${Number(payload?.elapsedMs || 0).toFixed(0)}ms • ${Number(payload?.cpuTradePasses || 0)} CPU-trade passes`
  );
  console.log(runtime.lastSimulationPerformance);
  console.table([
    {
      runId: payload?.runId || "",
      mode: payload?.mode || "simulation",
      resumed: Boolean(payload?.resumed),
      firstPendingDate: payload?.firstPendingDate || "",
      datesVisited: Number(payload?.datesVisited || 0),
      historicalDatesSkipped: Number(payload?.historicalDatesSkipped || 0),
      deadlineDatesSkipped: Number(payload?.deadlineDatesSkipped || 0),
      cpuTradePasses: Number(payload?.cpuTradePasses || 0),
      cpuTradeMs: Number(payload?.cpuTradeMs || 0).toFixed(0),
      gamesSimmed: Number(payload?.gamesSimmed || 0),
      gameOrderDateInversions: Number(payload?.gameOrderDateInversions || 0),
    },
  ]);
  console.groupEnd();
  return runtime.lastSimulationPerformance;
}

export function auditRecentRuntimeEvents() {
  const checks = [];

  addCheck(checks, {
    id: "runtime.trade_finder_load",
    ok: runtime.lastLoadAttempt ? runtime.lastLoadAttempt?.validation?.ok !== false : false,
    severity: runtime.lastLoadAttempt ? "error" : "warning",
    message: runtime.lastLoadAttempt
      ? runtime.lastLoadAttempt?.validation?.ok !== false
        ? "The most recent Trade Finder offer loaded with valid ownership, salary, and roster projections."
        : `The most recent Trade Finder load was blocked: ${runtime.lastLoadAttempt?.validation?.reason || "unknown reason"}`
      : "No Trade Finder Load Offer attempt has been recorded this session.",
    details: runtime.lastLoadAttempt,
  });

  addCheck(checks, {
    id: "runtime.cpu_trade_repair",
    ok: runtime.lastCpuTradeRepair ? runtime.lastCpuTradeRepair?.repairResult?.ok === true : false,
    severity: runtime.lastCpuTradeRepair ? "error" : "warning",
    message: runtime.lastCpuTradeRepair
      ? runtime.lastCpuTradeRepair?.repairResult?.ok === true
        ? "The most recent CPU trade roster repair completed successfully."
        : "The most recent CPU trade roster repair failed."
      : "No post-trade CPU roster repair has been recorded this session.",
    details: runtime.lastCpuTradeRepair,
  });

  addCheck(checks, {
    id: "runtime.pre_simulation",
    ok: runtime.lastPreSimulation ? runtime.lastPreSimulation?.repairResult?.ok === true : false,
    severity: runtime.lastPreSimulation ? "error" : "warning",
    message: runtime.lastPreSimulation
      ? runtime.lastPreSimulation?.repairResult?.ok === true
        ? "The most recent pre-simulation CPU repair completed successfully."
        : "The most recent pre-simulation CPU repair failed."
      : "No pre-simulation diagnostics snapshot has been recorded this session.",
    details: runtime.lastPreSimulation,
  });

  addCheck(checks, {
    id: "runtime.simulation_performance",
    ok: Boolean(runtime.lastSimulationPerformance),
    severity: "warning",
    message: runtime.lastSimulationPerformance
      ? `The most recent calendar run simulated ${Number(runtime.lastSimulationPerformance?.gamesSimmed || 0)} games with ${Number(runtime.lastSimulationPerformance?.cpuTradePasses || 0)} CPU-trade passes.`
      : "No calendar simulation performance snapshot has been recorded this session.",
    details: runtime.lastSimulationPerformance,
  });

  return finishReport("runtime_events", checks);
}

export function runAllBasketballManagerDiagnostics() {
  const rulesChecks = [];
  addCheck(rulesChecks, {
    id: "rules.standard_min",
    ok: REGULAR_SEASON_MIN_STANDARD_PLAYERS === 14,
    message: `Standard-roster simulation minimum is ${REGULAR_SEASON_MIN_STANDARD_PLAYERS}.`,
  });
  addCheck(rulesChecks, {
    id: "rules.standard_max",
    ok: REGULAR_SEASON_MAX_STANDARD_PLAYERS === 15,
    message: `Standard-roster simulation maximum is ${REGULAR_SEASON_MAX_STANDARD_PLAYERS}.`,
  });
  addCheck(rulesChecks, {
    id: "rules.trade_temporary_max",
    ok: TRADE_TEMPORARY_STANDARD_ROSTER_MAX === 16,
    message: `Temporary trade roster ceiling starts at ${TRADE_TEMPORARY_STANDARD_ROSTER_MAX}.`,
  });
  addCheck(rulesChecks, {
    id: "rules.two_way_max",
    ok: REGULAR_SEASON_MAX_TWO_WAY_PLAYERS === 3,
    message: `Two-way maximum is ${REGULAR_SEASON_MAX_TWO_WAY_PLAYERS}.`,
  });
  const rules = finishReport("roster_rules", rulesChecks);
  const regressions = runTradeRosterRegressionTests();
  const league = auditLeagueIntegrity(runtime.leagueData, { selectedTeam: runtime.selectedTeam });
  const tradeFinder = auditTradeFinderSnapshot(runtime.tradeFinder);
  const events = auditRecentRuntimeEvents();
  const reports = { rules, regressions, league, tradeFinder, events };
  const report = {
    name: "basketball_manager_full_diagnostics",
    diagnosticsVersion: DIAGNOSTICS_VERSION,
    generatedAt: nowIso(),
    ok: Object.values(reports).every((row) => row.ok || row.name === "trade_finder_snapshot" && row.summary.errors === 0),
    summary: {
      errors: Object.values(reports).reduce((sum, row) => sum + Number(row.summary?.errors || 0), 0),
      warnings: Object.values(reports).reduce((sum, row) => sum + Number(row.summary?.warnings || 0), 0),
      passed: Object.values(reports).reduce((sum, row) => sum + Number(row.summary?.passed || 0), 0),
    },
    reports,
  };
  runtime.lastReport = report;
  try {
    window.__BM_LAST_DIAGNOSTICS__ = report;
  } catch {}
  printReport(report, "BM FULL DIAGNOSTICS");
  return report;
}


function safeParseDiagnosticsJson(raw, fallback = null) {
  try {
    if (!raw) return fallback;
    return JSON.parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

function isCpuCpuTradeRecordForReport(row = {}) {
  return Boolean(row?.cpuCpuTrade || row?.source === "cpu_cpu_trade");
}

function receivedAssetsForReport(trade = {}, teamName = "") {
  const key = normalizeText(teamName);
  const side = Array.isArray(trade?.teamPackages)
    ? trade.teamPackages.find((pkg) => normalizeText(pkg?.teamName) === key)
    : null;
  return Array.isArray(side?.received) ? side.received : [];
}

function reportAssetLabel(asset = {}) {
  return asset?.label || asset?.displayLabel || asset?.playerName || asset?.name || "Asset";
}

function reportPlayerOverall(asset = {}) {
  return Number(asset?.overall ?? asset?.player?.overall ?? asset?.ovr ?? asset?.player?.ovr ?? 0) || 0;
}

function cpuTradeSummaryReport(leagueData = runtime.leagueData) {
  const league = leagueData && typeof leagueData === "object" ? leagueData : {};
  const bank = league?.cpuTradeBankState || null;
  const history = Array.isArray(league?.tradeHistory) ? league.tradeHistory : [];
  const official = history.filter(isCpuCpuTradeRecordForReport);
  const feed = typeof localStorage !== "undefined"
    ? safeParseDiagnosticsJson(localStorage.getItem("bm_trade_desk_feed_v1"), [])
    : [];
  const rawStoredFeedTransactions = Array.isArray(feed)
    ? feed.filter((row) => String(row?.type || "").toLowerCase() === "transaction").length
    : 0;
  const canonicalTradeRecordIds = new Set(official.map((row) => String(row?.id || row?.tradeId || "")).filter(Boolean));
  const canonicalStoredFeedTransactions = Array.isArray(feed)
    ? feed.filter((row) => {
        if (String(row?.type || "").toLowerCase() !== "transaction") return false;
        const tradeRecordId = String(row?.tradeRecordId || row?.id || "");
        return Boolean(tradeRecordId && (canonicalTradeRecordIds.has(tradeRecordId) || tradeRecordId.startsWith("history_")));
      }).length
    : 0;
  const staleStoredFeedTransactions = Math.max(0, rawStoredFeedTransactions - official.length);
  const storedFeedTransactions = official.length;

  const teamCounts = {};
  const topMovedPlayers = [];
  const packageRows = [];

  for (const trade of official) {
    const fromTeam = trade?.fromTeamName || trade?.userTeamName || "";
    const toTeam = trade?.toTeamName || trade?.cpuTeamName || "";
    for (const teamName of [fromTeam, toTeam]) {
      if (!teamName) continue;
      teamCounts[teamName] = (teamCounts[teamName] || 0) + 1;
    }

    const fromReceived = receivedAssetsForReport(trade, fromTeam);
    const toReceived = receivedAssetsForReport(trade, toTeam);
    const allAssets = [...fromReceived, ...toReceived];
    for (const asset of allAssets) {
      if (asset?.type !== "player") continue;
      topMovedPlayers.push({
        date: trade?.date || trade?.currentDate || "",
        player: reportAssetLabel(asset),
        ovr: reportPlayerOverall(asset),
        trade: `${toTeam || "Buyer"} / ${fromTeam || "Seller"}`,
      });
    }

    packageRows.push({
      date: trade?.date || trade?.currentDate || "",
      seller: fromTeam,
      buyer: toTeam,
      sellerGot: fromReceived.map(reportAssetLabel).join(", "),
      buyerGot: toReceived.map(reportAssetLabel).join(", "),
      assets: fromReceived.length + toReceived.length,
      maxOvrMoved: Math.max(0, ...allAssets.filter((asset) => asset?.type === "player").map(reportPlayerOverall)),
    });
  }

  const report = {
    generatedAt: nowIso(),
    officialCpuTradeCount: official.length,
    targetTrades: bank?.targetTrades ?? null,
    completedByBank: bank?.completedTrades ?? null,
    remainingTarget: bank ? Math.max(0, Number(bank.targetTrades || 0) - Number(bank.completedTrades || official.length)) : null,
    bankSize: Array.isArray(bank?.candidates) ? bank.candidates.length : 0,
    plannedSlots: Array.isArray(bank?.executionPlanDays) ? bank.executionPlanDays.length : 0,
    planCursor: bank?.planCursor ?? null,
    stats: bank?.stats || null,
    storedFeedTransactions,
    rawStoredFeedTransactions,
    canonicalStoredFeedTransactions,
    staleStoredFeedTransactions,
    teamCounts: Object.entries(teamCounts)
      .map(([team, count]) => ({ team, count }))
      .sort((a, b) => b.count - a.count || a.team.localeCompare(b.team)),
    topMovedPlayers: topMovedPlayers
      .sort((a, b) => b.ovr - a.ovr || String(b.date).localeCompare(String(a.date)))
      .slice(0, 20),
    packageRows,
  };

  console.log("[BM CPU TRADE REPORT]", report);
  console.table(report.packageRows);
  console.table(report.teamCounts);
  console.table(report.topMovedPlayers);
  return report;
}

async function copyJson(value) {
  const text = JSON.stringify(value, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    console.log("[BM DIAGNOSTICS] Copied report JSON to clipboard.");
  } catch {
    console.log(text);
  }
  return text;
}

function printCpuTradeReport(report) {
  if (!report) return report;
  console.groupCollapsed(
    `[BM CPU TRADE REPORT] ${report.ok ? "PASS" : "FAIL"} • ${Number(report?.summary?.completedByBank || 0)}/${Number(report?.summary?.targetTrades || 0)} target • ${Number(report?.summary?.processingMs || 0).toFixed(0)}ms bank processing`
  );
  console.log(report);
  console.table((report.checks || []).map((row) => ({
    status: row.status,
    check: row.name,
  })));
  console.table([{
    officialCpuTradeCount: report?.summary?.officialCpuTradeCount || 0,
    targetTrades: report?.summary?.targetTrades || 0,
    completedByBank: report?.summary?.completedByBank || 0,
    remainingTarget: report?.summary?.remainingTarget || 0,
    exactEvaluations: report?.summary?.exactEvaluations || 0,
    proposedCandidates: report?.summary?.proposedCandidates || 0,
    executionDeferrals: report?.summary?.executionDeferrals || 0,
    storedFeedTransactions: report?.summary?.storedFeedTransactions || 0,
    staleStoredFeedTransactions: report?.summary?.staleStoredFeedTransactions || 0,
    postDeadlineTradeCount: report?.summary?.postDeadlineTradeCount || 0,
    simulationElapsedMs: report?.summary?.simulationElapsedMs || 0,
  }]);
  if (report.packageBenchmarks?.length) {
    console.table(report.packageBenchmarks.map((row) => ({
      category: row.category,
      teams: row.teams?.join(" ↔ ") || "",
      replay: row.decisionReplayMatch ? "PASS" : "FAIL",
      coldMs: row.coldMs,
      warmMedianMs: row.warmMedianMs,
      warmP95Ms: row.warmP95Ms,
      signature: row.signature,
    })));
  }
  console.groupEnd();
  return report;
}

function buildLiveCpuTradeReport(options = {}) {
  const report = buildCpuTradeDiagnosticReport(runtime.leagueData || {}, {
    ...options,
    lastSimulationPerformance: runtime.lastSimulationPerformance,
  });
  runtime.lastCpuTradeReport = report;
  runtime.lastReport = report;
  try {
    window.__BM_LAST_CPU_TRADE_REPORT__ = report;
    window.__BM_LAST_DIAGNOSTICS__ = report;
  } catch {}
  return report;
}

export function installBasketballManagerDiagnostics() {
  if (typeof window === "undefined") return null;
  if (window.BMDiagnostics?.version === DIAGNOSTICS_VERSION) return window.BMDiagnostics;

  const api = {
    version: DIAGNOSTICS_VERSION,
    rules: {
      version: ROSTER_RULES_VERSION,
      standardMin: REGULAR_SEASON_MIN_STANDARD_PLAYERS,
      standardMax: REGULAR_SEASON_MAX_STANDARD_PLAYERS,
      temporaryTradeMax: TRADE_TEMPORARY_STANDARD_ROSTER_MAX,
      twoWayMax: REGULAR_SEASON_MAX_TWO_WAY_PLAYERS,
    },
    help() {
      const commands = [
        { command: "await bmDiag.runAll()", purpose: "Run roster rules, league integrity, Trade Finder, and regression checks." },
        { command: "bmDiag.regressions()", purpose: "Run synthetic one-for-many and many-for-one trade regression tests." },
        { command: "bmDiag.league()", purpose: "Audit all live teams, players, contracts, duplicate ownership, and roster limits." },
        { command: "bmDiag.tradeFinder()", purpose: "Audit the most recent Trade Finder search and verify every displayed offer is loadable." },
        { command: "bmDiag.reverseTradeFinder()", purpose: "Inspect candidate-stage counts from the most recent Reverse Trade Finder search." },
        { command: "bmDiag.lastLoad()", purpose: "Inspect the most recent Load Offer validation attempt." },
        { command: "bmDiag.lastRepair()", purpose: "Inspect the most recent CPU post-trade roster repair." },
        { command: "bmDiag.preSim()", purpose: "Inspect the most recent pre-simulation diagnostic snapshot." },
        { command: "bmDiag.simPerformance()", purpose: "Inspect the most recent calendar simulation timing, CPU-trade workload, and game execution order." },
        { command: "bmDiag.simHistory()", purpose: "Inspect recent pre/post-checkpoint simulation runs together, including scheduled game execution order." },
        { command: "bmDiag.cpuTradeReport()", purpose: "Build the full CPU-trade performance, quantity, quality, pacing, safety, and package replay report." },
        { command: "bmDiag.cpuTradeSummary()", purpose: "Print the compact reliability summary added by the CPU trade reliability patch." },
        { command: "bmDiag.cpuTradeBenchmarks()", purpose: "Rerun the captured simple, rejected, and complex package timing benchmarks." },
        { command: "bmDiag.cpuTradeSaveBaseline('pre-optimization')", purpose: "Save the current report for automatic before/after comparison." },
        { command: "bmDiag.cpuTradeCompare()", purpose: "Compare the current report against the saved pre-optimization baseline." },
        { command: "bmDiag.cpuTradeReset()", purpose: "Clear only in-memory CPU-trade diagnostics before a fresh-save benchmark." },
        { command: "bmDiag.events()", purpose: "Audit recent Trade Finder, CPU repair, and simulation events." },
        { command: "await bmDiag.copy()", purpose: "Copy the last diagnostics report as JSON." },
        { command: "bmDiag.auto(false)", purpose: "Disable automatic critical diagnostics logging." },
        { command: "bmDiag.auto(true)", purpose: "Enable automatic critical diagnostics logging." },
      ];
      console.table(commands);
      return commands;
    },
    runAll: runAllBasketballManagerDiagnostics,
    regressions() {
      return printReport(runTradeRosterRegressionTests(), "BM TRADE REGRESSIONS");
    },
    league() {
      return printReport(auditLeagueIntegrity(), "BM LEAGUE AUDIT");
    },
    tradeFinder() {
      return printReport(auditTradeFinderSnapshot(), "BM TRADE FINDER AUDIT");
    },
    reverseTradeFinder() {
      const diagnostics = runtime.tradeFinder?.engineDiagnostics || null;
      console.log(diagnostics);
      return diagnostics;
    },
    events() {
      return printReport(auditRecentRuntimeEvents(), "BM RUNTIME EVENT AUDIT");
    },
    last() {
      console.log(runtime.lastReport);
      return runtime.lastReport;
    },
    lastLoad() {
      console.log(runtime.lastLoadAttempt);
      return runtime.lastLoadAttempt;
    },
    lastRepair() {
      console.log(runtime.lastCpuTradeRepair);
      return runtime.lastCpuTradeRepair;
    },
    preSim() {
      console.log(runtime.lastPreSimulation);
      return runtime.lastPreSimulation;
    },
    simPerformance() {
      console.log(runtime.lastSimulationPerformance);
      return runtime.lastSimulationPerformance;
    },
    simHistory() {
      const rows = [...runtime.simulationPerformanceHistory];
      console.table(rows.map((row) => ({
        runId: row?.runId || "",
        mode: row?.mode || "",
        targetDate: row?.targetDate || "",
        resumed: Boolean(row?.resumed),
        firstPendingDate: row?.firstPendingDate || "",
        gamesSimmed: Number(row?.gamesSimmed || 0),
        dateInversions: Number(row?.gameOrderDateInversions || 0),
        paused: Boolean(row?.pausedAtCheckpoint || row?.pausedForTradeDeadline || row?.pausedForAllStar),
        checkpoint: row?.checkpointEvents?.[0]?.reason || "",
        elapsedMs: Number(row?.elapsedMs || 0),
      })));
      console.log(rows);
      return rows;
    },
    cpuTradeReport(options = {}) {
      return printCpuTradeReport(buildLiveCpuTradeReport(options));
    },
    cpuTradeSummary() {
      return cpuTradeSummaryReport();
    },
    cpuTradeBenchmarks(options = {}) {
      const rows = runCpuTradePackageBenchmarks(options);
      console.table((rows || []).map((row) => ({
        category: row.category,
        replay: row.decisionReplayMatch ? "PASS" : "FAIL",
        coldMs: row.coldMs,
        warmAverageMs: row.warmAverageMs,
        warmMedianMs: row.warmMedianMs,
        warmP95Ms: row.warmP95Ms,
        signature: row.signature,
      })));
      return rows;
    },
    cpuTradeSaveBaseline(label = "pre-optimization") {
      const report = runtime.lastCpuTradeReport || buildLiveCpuTradeReport({ runBenchmarks: true });
      const saved = saveCpuTradeBaselineReport(report, label);
      console.log(`[BM CPU TRADE REPORT] Saved baseline "${saved.label}".`, saved);
      return saved;
    },
    cpuTradeBaseline() {
      const saved = readCpuTradeBaselineReport();
      console.log(saved);
      return saved;
    },
    cpuTradeCompare(options = {}) {
      const current = buildLiveCpuTradeReport({ runBenchmarks: true, ...options });
      const comparison = compareCpuTradeDiagnosticReports(current);
      runtime.lastCpuTradeComparison = comparison;
      runtime.lastReport = comparison;
      console.groupCollapsed(`[BM CPU TRADE COMPARISON] ${comparison?.ok ? "PASS" : "FAIL"}`);
      console.log(comparison);
      if (comparison?.performance) console.table([comparison.performance]);
      if (comparison?.packageComparisons?.length) console.table(comparison.packageComparisons);
      console.groupEnd();
      return comparison;
    },
    cpuTradeReset() {
      const result = resetCpuTradeDiagnostics();
      runtime.lastCpuTradeReport = null;
      runtime.lastCpuTradeComparison = null;
      console.log("[BM CPU TRADE REPORT] In-memory diagnostics reset. Start from a fresh save for a clean baseline.");
      return result;
    },
    context() {
      console.log(runtime);
      return runtime;
    },
    copy() {
      return copyJson(runtime.lastReport || runAllBasketballManagerDiagnostics());
    },
    auto(enabled = true) {
      localStorage.setItem(AUTO_DIAGNOSTICS_KEY, enabled ? "1" : "0");
      console.log(`[BM DIAGNOSTICS] Automatic checks ${enabled ? "enabled" : "disabled"}.`);
      return enabled;
    },
  };

  window.BMDiagnostics = api;
  window.bmDiag = api;
  window.runBMDiagnostics = api.runAll;
  console.log("[BM Diagnostics] Ready. Run `await bmDiag.runAll()` or `bmDiag.help()`.");
  return api;
}
