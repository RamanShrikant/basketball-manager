import { getLeagueFinancialRules, roundMoney } from "./leagueFinancials.js";

const DEFAULT_SEASON_YEAR = 2026;
const BASE_MAX_SALARY = 54_000_000;
const YEARLY_RAISE = 0.05;
const CONTRACT_OVERPAY_CAP_SHARE_FLOOR = 0.015;
const CONTRACT_OVERPAY_MARKET_BUFFER = 0.12;
const BASE_DOLLAR_BUFFER = 2_000_000;
const BAD_CONTRACT_TUNING_STRENGTH = 7.0;
const INCOMING_BAD_WEIGHT = 1.0;
const OUTGOING_BAD_RELIEF_WEIGHT = 0.12;
const OUTGOING_GOOD_PENALTY_WEIGHT = 0.18;
const MIN_CONTRACT_FRICTION = -0.12;
const MAX_CONTRACT_FRICTION = 1.75;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round4 = (value) => Math.round(Number(value || 0) * 10000) / 10000;

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function finitePositiveYear(value) {
  const year = Number(value);
  return Number.isFinite(year) && year >= 2000 && year <= 2100 ? Math.round(year) : null;
}

function pushUniqueYear(list, value) {
  const year = finitePositiveYear(value);
  if (year && !list.includes(year)) list.push(year);
}

function getLeagueLabelPayrollYear(leagueData) {
  const label = [
    leagueData?.name,
    leagueData?.leagueName,
    leagueData?.title,
    leagueData?.fileName,
    leagueData?.metadata?.name,
    leagueData?.meta?.name,
  ]
    .filter(Boolean)
    .join(" ");

  const fullRange = label.match(/(?:^|\D)(20\d{2})\s*[\/-]\s*(20\d{2})(?:\D|$)/);
  if (fullRange) return finitePositiveYear(fullRange[2]);

  const shortRange = label.match(/(?:^|\D)(\d{2})\s*[\/-]\s*(\d{2})(?:\D|$)/);
  if (shortRange) return finitePositiveYear(2000 + Number(shortRange[2]));

  return null;
}

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function getStoredTeamPayroll(team) {
  const value = Number(
    team?.payroll ??
      team?.totalSalary ??
      team?.salaryTotal ??
      team?.financials?.payroll ??
      team?.financials?.totalSalary ??
      0
  );
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizeContract(contract) {
  if (!contract || typeof contract !== "object") return null;
  const salaryByYear = Array.isArray(contract.salaryByYear)
    ? contract.salaryByYear.map((value) => Math.max(0, Math.round(num(value, 0)))).filter((value) => value > 0)
    : [];

  if (!salaryByYear.length) return null;

  return {
    startYear: finitePositiveYear(contract.startYear) || DEFAULT_SEASON_YEAR,
    salaryByYear,
    option: contract.option && typeof contract.option === "object" ? contract.option : null,
  };
}

function getRemainingSalaryRows(player, payrollSeasonYear) {
  const contract = normalizeContract(player?.contract);
  if (!contract) {
    const fallback = Math.max(0, Math.round(num(
      player?.salary ??
        player?.currentSalary ??
        player?.contractSalary ??
        player?.capHit ??
        player?.aav ??
        0,
      0
    )));
    return fallback > 0 ? [fallback] : [];
  }

  let startYear = contract.startYear;
  let idx = payrollSeasonYear - startYear;
  const hasPayrollSeasonSlot = idx >= 0 && idx < contract.salaryByYear.length;

  // Match Salary Table / Propose Trade display behavior for one-year deals saved
  // with the previous offseason as startYear.
  if (contract.salaryByYear.length === 1 && startYear === payrollSeasonYear - 1 && !hasPayrollSeasonSlot) {
    startYear = payrollSeasonYear;
    idx = 0;
  }

  if (!Number.isFinite(idx) || idx < 0) idx = 0;
  if (idx >= contract.salaryByYear.length) idx = contract.salaryByYear.length - 1;

  return contract.salaryByYear.slice(idx).filter((value) => Number(value || 0) > 0);
}

function getRosterPayrollForYear(team, payrollSeasonYear) {
  return (Array.isArray(team?.players) ? team.players : []).reduce(
    (sum, player) => sum + num(getRemainingSalaryRows(player, payrollSeasonYear)[0], 0),
    0
  );
}

export function getTradeContractPayrollSeasonYear(leagueData = {}) {
  const candidates = [];

  pushUniqueYear(candidates, leagueData?.payrollSeasonYear);
  pushUniqueYear(candidates, leagueData?.salarySeasonYear);
  pushUniqueYear(candidates, leagueData?.currentPayrollSeasonYear);
  pushUniqueYear(candidates, getLeagueLabelPayrollYear(leagueData));
  pushUniqueYear(candidates, Number(leagueData?.seasonStartYear) + 1);
  pushUniqueYear(candidates, Number(leagueData?.seasonYear) + 1);
  pushUniqueYear(candidates, Number(leagueData?.currentSeasonYear) + 1);
  pushUniqueYear(candidates, leagueData?.seasonStartYear);
  pushUniqueYear(candidates, leagueData?.seasonYear);
  pushUniqueYear(candidates, leagueData?.currentSeasonYear);
  pushUniqueYear(candidates, DEFAULT_SEASON_YEAR);

  const teamsWithStoredPayroll = getAllTeamsFromLeague(leagueData)
    .map((team) => ({ team, storedPayroll: getStoredTeamPayroll(team) }))
    .filter((row) => row.storedPayroll > 0);

  if (teamsWithStoredPayroll.length && candidates.length) {
    let best = null;

    for (const year of candidates) {
      const totalError = teamsWithStoredPayroll.reduce((sum, row) => {
        const rosterPayroll = getRosterPayrollForYear(row.team, year);
        return sum + Math.abs(rosterPayroll - row.storedPayroll);
      }, 0);

      if (!best || totalError < best.totalError) {
        best = { year, totalError };
      }
    }

    if (best) return best.year;
  }

  return candidates[0] || DEFAULT_SEASON_YEAR;
}

function buildSalaryByYear(yearOneSalary, years) {
  const out = [];
  for (let i = 0; i < clamp(Math.round(num(years, 1)), 1, 4); i += 1) {
    out.push(roundMoney(yearOneSalary * Math.pow(1 + YEARLY_RAISE, i), 1_000));
  }
  return out;
}

function getRealisticExpectedContractYears(player = {}) {
  const overall = num(player?.overall ?? player?.ovr, 75);
  const age = Math.round(num(player?.age, 27));
  const potential = num(player?.potential ?? player?.pot, overall);
  const upside = Math.max(0, potential - overall);

  const minimumBucket =
    overall <= 72 ||
    (overall <= 73 && age >= 30 && upside <= 1) ||
    (overall <= 74 && age >= 32 && upside <= 1);

  if (minimumBucket) {
    if (age <= 25 && upside >= 4) return 2;
    return age >= 30 ? 1 : 2;
  }

  let years;

  if (overall >= 90) {
    if (age <= 34) years = 4;
    else if (age <= 36) years = 3;
    else if (age <= 38) years = 2;
    else years = 1;
  } else if (overall >= 88) {
    if (age <= 34) years = 4;
    else if (age <= 35) years = 3;
    else if (age <= 38) years = 2;
    else years = 1;
  } else if (overall >= 85) {
    if (age <= 34) years = 4;
    else if (age <= 36) years = 2;
    else if (age <= 37 && overall >= 87) years = 2;
    else years = 1;
  } else if (overall >= 81) {
    if (age <= 31) years = 4;
    else if (age <= 34) years = 3;
    else if (age <= 37) years = 2;
    else years = 1;
  } else if (overall >= 78) {
    if (age <= 29) years = 4;
    else if (age <= 31) years = 3;
    else if (age <= 34) years = 2;
    else if (age <= 36 && overall >= 80) years = 2;
    else years = 1;
  } else if (overall >= 76) {
    if (age <= 29) years = 4;
    else if (age <= 31) years = 3;
    else if (age <= 33) years = 2;
    else years = 1;
  } else if (overall >= 74) {
    if (age <= 25 && upside >= 3) years = 3;
    else if (age <= 28) years = 2;
    else if (age <= 31 && overall >= 75) years = 2;
    else years = 1;
  } else if (overall >= 73) {
    if (age <= 25 && upside >= 3) years = 3;
    else if (age <= 29) years = 2;
    else years = 1;
  } else {
    years = 1;
  }

  if (age <= 24 && upside >= 4 && overall >= 74) years = Math.min(4, years + 1);
  if (age <= 29 && overall >= 76) years = Math.max(years, 4);
  if (age <= 31 && overall >= 81) years = Math.max(years, 4);
  if (age <= 34 && overall >= 85) years = Math.max(years, 4);
  if (age >= 35 && age <= 37 && overall >= 82) years = Math.max(years, 2);
  if (age >= 36 && age <= 38 && overall >= 90) years = Math.max(years, 2);

  return clamp(Math.round(years), 1, 4);
}

export function estimateTradeMarketValue(player = {}, leagueData = {}) {
  const payrollSeasonYear = getTradeContractPayrollSeasonYear(leagueData);
  const rules = getLeagueFinancialRules(leagueData, payrollSeasonYear);
  const maxSalary = num(rules?.maxSalary ?? rules?.maxContract, BASE_MAX_SALARY);
  const minimumSalary = num(rules?.minimumSalary, 1_200_000);
  const minimumException = num(rules?.minimumException, 1_500_000);
  const scale = maxSalary / BASE_MAX_SALARY;

  const overall = num(player?.overall ?? player?.ovr, 75);
  const age = Math.round(num(player?.age, 27));
  const potential = num(player?.potential ?? player?.pot, overall);
  const upside = Math.max(0, potential - overall);
  const offRating = num(player?.offRating ?? player?.off ?? player?.offense, overall);
  const defRating = num(player?.defRating ?? player?.def ?? player?.defense, overall);
  const scoringRating = num(player?.scoringRating ?? player?.scoring ?? player?.shooting ?? 50, 50);

  const years = getRealisticExpectedContractYears(player);
  const minimumBucket =
    overall <= 72 ||
    (overall <= 73 && age >= 27 && upside <= 1) ||
    (overall <= 74 && age >= 30 && upside <= 1);

  if (minimumBucket) {
    let baseSalary = minimumSalary;
    if (overall >= 73 && age <= 26) {
      baseSalary = Math.max(minimumSalary, Math.round(1_900_000 * scale));
    } else if (overall >= 73) {
      baseSalary = Math.max(minimumSalary, Math.round(minimumException));
    }

    const salaryByYear = buildSalaryByYear(roundMoney(baseSalary, 1_000), years);
    const expectedAAV = Math.round(salaryByYear.reduce((sum, value) => sum + value, 0) / salaryByYear.length);
    return {
      marketAAV: expectedAAV,
      expectedAAV,
      expectedYear1Salary: salaryByYear[0],
      expectedYears: years,
      salaryByYear,
      minimumBucket: true,
    };
  }

  let baseSalary;
  if (overall <= 75) {
    baseSalary = 3_100_000 + Math.max(0, overall - 74) * 1_250_000;
  } else if (overall <= 78) {
    baseSalary = 4_800_000 + (overall - 76) * 2_050_000;
  } else if (overall <= 81) {
    baseSalary = 10_800_000 + (overall - 79) * 3_000_000;
  } else if (overall <= 84) {
    baseSalary = 19_000_000 + (overall - 82) * 3_500_000;
  } else if (overall <= 88) {
    baseSalary = 26_000_000 + (overall - 84) * 2_850_000;
  } else {
    baseSalary = 37_400_000 + (overall - 88) * 3_200_000;
  }

  baseSalary *= scale;

  if (age <= 22) {
    baseSalary *= 1.08 + Math.min(0.18, upside * 0.025);
  } else if (age <= 25) {
    baseSalary *= 1.05 + Math.min(0.14, upside * 0.018);
  } else if (age <= 27) {
    baseSalary *= 1.02 + Math.min(0.08, upside * 0.010);
  } else if (age <= 30) {
    baseSalary *= 1.00;
  } else if (age <= 33) {
    baseSalary *= Math.max(0.85, 1.0 - (age - 30) * 0.043);
  } else if (overall >= 84) {
    const starScore = clamp((overall - 84) / 8, 0, 1);
    const startingMult = 0.88 + starScore * 0.10;
    const yearlyDrop = 0.040 - starScore * 0.018;
    const floorMult = 0.68 + starScore * 0.14;
    baseSalary *= Math.max(floorMult, startingMult - (age - 34) * yearlyDrop);
  } else {
    baseSalary *= Math.max(0.62, 0.84 - (age - 33) * 0.062);
  }

  if (age >= 31 && overall <= 80) baseSalary *= overall >= 77 ? 0.94 : 0.92;
  if (age >= 34 && overall <= 79) baseSalary *= overall >= 77 ? 0.91 : 0.88;
  if (age >= 36 && overall <= 82) baseSalary *= overall >= 80 ? 0.93 : 0.90;

  if (offRating >= 88) baseSalary *= 1.04;
  if (defRating >= 88) baseSalary *= 1.04;
  if (scoringRating >= 84) baseSalary *= 1.03;
  if (overall <= 83 && Math.max(offRating, defRating) >= overall + 7) baseSalary *= 1.05;
  if (age >= 34 && overall >= 77 && overall <= 82 && (Math.max(offRating, defRating) >= 86 || scoringRating >= 82)) {
    baseSalary *= 1.025;
  }

  const yearOneSalary = roundMoney(clamp(baseSalary, minimumSalary, maxSalary), 1_000);
  const salaryByYear = buildSalaryByYear(yearOneSalary, years);
  const expectedAAV = Math.round(salaryByYear.reduce((sum, value) => sum + value, 0) / salaryByYear.length);

  return {
    marketAAV: expectedAAV,
    expectedAAV,
    expectedYear1Salary: salaryByYear[0],
    expectedYears: years,
    salaryByYear,
    minimumBucket: false,
  };
}

function getContractSnapshot(player = {}, leagueData = {}) {
  const payrollSeasonYear = getTradeContractPayrollSeasonYear(leagueData);
  const remainingRows = getRemainingSalaryRows(player, payrollSeasonYear);
  const remainingYears = remainingRows.length;
  const remainingTotal = remainingRows.reduce((sum, value) => sum + num(value, 0), 0);
  const actualAAV = remainingYears > 0 ? remainingTotal / remainingYears : 0;

  return {
    payrollSeasonYear,
    currentSalary: num(remainingRows[0], 0),
    remainingYears,
    remainingTotal,
    actualAAV,
  };
}

function getYearsMultiplier(yearsRemaining) {
  const years = Math.max(1, Math.round(num(yearsRemaining, 1)));
  if (years <= 1) return 0.25;
  if (years === 2) return 0.65;
  if (years === 3) return 1.0;
  return 1.35;
}

function getSalaryImportance(actualAAV, marketAAV, salaryCap) {
  const cap = Math.max(1, num(salaryCap, 154_647_000));
  const salaryShare = Math.max(num(actualAAV, 0), num(marketAAV, 0)) / cap;
  return clamp(0.75 + salaryShare * 2.25, 0.75, 1.55);
}

function getForgivenessZone({ salaryCap, marketAAV, inflationIndex }) {
  return Math.max(
    num(salaryCap, 154_647_000) * CONTRACT_OVERPAY_CAP_SHARE_FLOOR,
    num(marketAAV, 0) * CONTRACT_OVERPAY_MARKET_BUFFER,
    BASE_DOLLAR_BUFFER * Math.max(0.75, num(inflationIndex, 1))
  );
}

export function evaluatePlayerContractValue(player = {}, leagueData = {}) {
  const payrollSeasonYear = getTradeContractPayrollSeasonYear(leagueData);
  const rules = getLeagueFinancialRules(leagueData, payrollSeasonYear);
  const salaryCap = num(rules?.salaryCap ?? rules?.capLimit, 154_647_000);
  const inflationIndex = num(rules?.inflationIndex, 1);
  const contract = getContractSnapshot(player, leagueData);
  const market = estimateTradeMarketValue(player, leagueData);

  if (contract.remainingYears <= 0 || contract.actualAAV <= 0) {
    return {
      playerName: player?.name || player?.player || "Unknown Player",
      payrollSeasonYear,
      salaryCap,
      marketAAV: market.marketAAV,
      actualAAV: 0,
      remainingYears: 0,
      badScore: 0,
      goodScore: 0,
      effectiveOverpay: 0,
      effectiveUnderpay: 0,
      forgivenessZone: getForgivenessZone({ salaryCap, marketAAV: market.marketAAV, inflationIndex }),
    };
  }

  const forgivenessZone = getForgivenessZone({ salaryCap, marketAAV: market.marketAAV, inflationIndex });
  const effectiveOverpay = Math.max(0, contract.actualAAV - market.marketAAV - forgivenessZone);
  const effectiveUnderpay = Math.max(0, market.marketAAV - contract.actualAAV - forgivenessZone);
  const yearsMultiplier = getYearsMultiplier(contract.remainingYears);
  const salaryImportance = getSalaryImportance(contract.actualAAV, market.marketAAV, salaryCap);

  const badScore = round4(
    (effectiveOverpay / Math.max(1, salaryCap)) *
      salaryImportance *
      yearsMultiplier *
      BAD_CONTRACT_TUNING_STRENGTH
  );

  const goodScore = round4(
    (effectiveUnderpay / Math.max(1, salaryCap)) *
      salaryImportance *
      yearsMultiplier *
      BAD_CONTRACT_TUNING_STRENGTH
  );

  return {
    playerName: player?.name || player?.player || "Unknown Player",
    payrollSeasonYear,
    salaryCap,
    marketAAV: Math.round(market.marketAAV),
    actualAAV: Math.round(contract.actualAAV),
    currentSalary: Math.round(contract.currentSalary),
    remainingYears: contract.remainingYears,
    remainingTotal: Math.round(contract.remainingTotal),
    expectedYears: market.expectedYears,
    badScore,
    goodScore,
    effectiveOverpay: Math.round(effectiveOverpay),
    effectiveUnderpay: Math.round(effectiveUnderpay),
    forgivenessZone: Math.round(forgivenessZone),
    yearsMultiplier,
    salaryImportance: round4(salaryImportance),
  };
}

function sumContractScores(players = [], leagueData = {}) {
  const rows = (players || []).map((player) => evaluatePlayerContractValue(player, leagueData));
  return {
    rows,
    badScore: round4(rows.reduce((sum, row) => sum + num(row.badScore, 0), 0)),
    goodScore: round4(rows.reduce((sum, row) => sum + num(row.goodScore, 0), 0)),
  };
}

function topBadContractLabel(rows = []) {
  const sorted = [...rows].sort((a, b) => num(b.badScore, 0) - num(a.badScore, 0));
  const top = sorted.find((row) => num(row.badScore, 0) > 0.025);
  if (!top) return "";
  return `${top.playerName} is above market by about $${(top.effectiveOverpay / 1_000_000).toFixed(1)}M/year after the small-overpay buffer.`;
}

function topGoodContractLabel(rows = []) {
  const sorted = [...rows].sort((a, b) => num(b.goodScore, 0) - num(a.goodScore, 0));
  const top = sorted.find((row) => num(row.goodScore, 0) > 0.04);
  if (!top) return "";
  return `${top.playerName} is on a below-market deal.`;
}

export function evaluateCpuContractFriction({ leagueData = {}, cpuIncomingPlayers = [], cpuOutgoingPlayers = [] } = {}) {
  const incoming = sumContractScores(cpuIncomingPlayers, leagueData);
  const outgoing = sumContractScores(cpuOutgoingPlayers, leagueData);

  const rawFriction =
    incoming.badScore * INCOMING_BAD_WEIGHT -
    outgoing.badScore * OUTGOING_BAD_RELIEF_WEIGHT +
    outgoing.goodScore * OUTGOING_GOOD_PENALTY_WEIGHT;

  const friction = round4(clamp(rawFriction, MIN_CONTRACT_FRICTION, MAX_CONTRACT_FRICTION));
  const reasons = [];

  if (friction > 0.03) {
    const incomingLabel = topBadContractLabel(incoming.rows);
    const outgoingGoodLabel = topGoodContractLabel(outgoing.rows);
    if (incoming.badScore > 0.04) {
      reasons.push(
        `Contract friction: +${friction.toFixed(2)} threshold because the CPU is taking on meaningful bad salary${incomingLabel ? ` (${incomingLabel})` : "."}`
      );
    } else if (outgoing.goodScore > 0.04) {
      reasons.push(
        `Contract friction: +${friction.toFixed(2)} threshold because the CPU is giving up useful below-market contract value${outgoingGoodLabel ? ` (${outgoingGoodLabel})` : "."}`
      );
    } else {
      reasons.push(`Contract friction: +${friction.toFixed(2)} threshold from contract value.`);
    }
  } else if (friction < -0.02) {
    const outgoingLabel = topBadContractLabel(outgoing.rows);
    reasons.push(
      `Contract relief: ${friction.toFixed(2)} threshold because the user is taking bad money off the CPU${outgoingLabel ? ` (${outgoingLabel})` : "."}`
    );
  } else if (incoming.badScore > 0.025 || outgoing.badScore > 0.025 || outgoing.goodScore > 0.025) {
    reasons.push("Contract impact is basically neutral after the small-overpay buffer and salary-dump relief cap.");
  }

  return {
    friction,
    rawFriction: round4(rawFriction),
    minFriction: MIN_CONTRACT_FRICTION,
    maxFriction: MAX_CONTRACT_FRICTION,
    incomingBadScore: incoming.badScore,
    outgoingBadScore: outgoing.badScore,
    outgoingGoodScore: outgoing.goodScore,
    incomingRows: incoming.rows,
    outgoingRows: outgoing.rows,
    reasons,
    weights: {
      incomingBad: INCOMING_BAD_WEIGHT,
      outgoingBadRelief: OUTGOING_BAD_RELIEF_WEIGHT,
      outgoingGoodPenalty: OUTGOING_GOOD_PENALTY_WEIGHT,
    },
  };
}
