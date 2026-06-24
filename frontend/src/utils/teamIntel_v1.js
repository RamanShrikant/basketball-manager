// src/utils/teamIntel_v1.js
// Read-only front-office Intel engine for all 30 teams.
// This mirrors the existing CPU trade direction/value ideas in JS so the Intel
// page stays fast and does not need to boot Pyodide just to display rumors.

import LZString from "lz-string";
import { computeTeamRatings } from "../api/teamRatings.js";
import {
  getAllTeamsFromLeague,
  normalizeDraftPicks,
  normalizeTeamName,
  sortDraftPickAssets,
} from "./draftPicks.js";

const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_";
const SCHEDULE_KEY = "bm_schedule_v3";

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const DEFAULT_PICK_PROTECTION = "Unprotected";

const PHASE_PREFERENCES = {
  contender: {
    currentTalent: 1.18,
    upside: 0.72,
    picks: 0.82,
    salaryFlex: 0.82,
    starRetention: 1.25,
  },
  playoff: {
    currentTalent: 1.08,
    upside: 0.88,
    picks: 0.9,
    salaryFlex: 0.9,
    starRetention: 1.12,
  },
  middle: {
    currentTalent: 1,
    upside: 1,
    picks: 1,
    salaryFlex: 1,
    starRetention: 1,
  },
  retool: {
    currentTalent: 0.92,
    upside: 1.16,
    picks: 1.08,
    salaryFlex: 1.08,
    starRetention: 0.95,
  },
  rebuild: {
    currentTalent: 0.78,
    upside: 1.34,
    picks: 1.22,
    salaryFlex: 1.16,
    starRetention: 0.82,
  },
  tank: {
    currentTalent: 0.7,
    upside: 1.42,
    picks: 1.3,
    salaryFlex: 1.22,
    starRetention: 0.72,
  },
};

const PHASE_LABELS = {
  contender: "Contender",
  playoff: "Playoff Push",
  middle: "Middle",
  retool: "Retool",
  rebuild: "Rebuild",
  tank: "Tanking",
};

const PHASE_SUMMARIES = {
  contender: "Built to win now. They should protect stars, use expendable depth, and chase immediate upgrades.",
  playoff: "Trying to lock in a playoff spot. They value rotation help, but should not empty every future asset.",
  middle: "Caught between buying and selling. Their intel depends heavily on weak spots, age, and contract pressure.",
  retool: "Not a full teardown. They should reshape around younger impact players while staying competitive.",
  rebuild: "Future-focused. They should prioritize prospects, picks, cap flexibility, and veteran sell opportunities.",
  tank: "Deep future mode. Winning now matters less than draft position, youth upside, and clearing veterans.",
};

export function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function teamNameOf(team) {
  return String(team?.name || team?.teamName || "").trim();
}

export function playerNameOf(player) {
  return player?.name || player?.player || "Unknown Player";
}

export function teamLogoOf(team) {
  return (
    team?.logo ||
    team?.teamLogo ||
    team?.newTeamLogo ||
    team?.logoUrl ||
    team?.image ||
    team?.img ||
    ""
  );
}

export function playerHeadshotOf(player) {
  return (
    player?.headshot ||
    player?.headshotUrl ||
    player?.photoUrl ||
    player?.portrait ||
    player?.image ||
    player?.img ||
    ""
  );
}

export function formatMoney(amount) {
  const n = Number(amount || 0);
  if (!Number.isFinite(n) || n === 0) return "$0";

  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${sign}$${Math.round(abs / 1000)}K`;
}

function parseMaybeCompressed(raw, fallback = null) {
  if (!raw) return fallback;

  try {
    if (String(raw).startsWith("lz:")) {
      const decompressed = LZString.decompressFromUTF16(String(raw).slice(3));
      return decompressed ? JSON.parse(decompressed) : fallback;
    }
  } catch {}

  try {
    return JSON.parse(raw);
  } catch {}

  try {
    const decompressed = LZString.decompressFromUTF16(raw);
    return decompressed ? JSON.parse(decompressed) : fallback;
  } catch {
    return fallback;
  }
}

function safeLocalStorageGet(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function loadSchedule() {
  return parseMaybeCompressed(safeLocalStorageGet(SCHEDULE_KEY), {}) || {};
}

function resultV3Key(gameId) {
  return `${RESULT_V3_PREFIX}${gameId}`;
}

function loadResultsV3() {
  const ids = parseMaybeCompressed(safeLocalStorageGet(RESULT_V3_INDEX_KEY), []) || [];
  const out = {};

  for (const id of ids) {
    const result = parseMaybeCompressed(safeLocalStorageGet(resultV3Key(id)), null);
    if (result) out[String(id)] = result;
  }

  return out;
}

export function getCurrentSeasonYear(leagueData) {
  return Number(
    leagueData?.seasonYear ||
      leagueData?.currentSeasonYear ||
      leagueData?.seasonStartYear ||
      2026
  );
}

export function buildRecordMap(teams = []) {
  const schedule = loadSchedule();
  const results = loadResultsV3();
  const map = {};

  const ensure = (teamName) => {
    if (!teamName) return null;
    if (!map[teamName]) {
      map[teamName] = { w: 0, l: 0, gp: 0, pf: 0, pa: 0 };
    }
    return map[teamName];
  };

  for (const team of teams || []) {
    ensure(teamNameOf(team));
  }

  for (const games of Object.values(schedule || {})) {
    for (const game of games || []) {
      if (!game?.id) continue;

      const result = results?.[String(game.id)];
      if (!game.played && !result) continue;

      const homePts = toNum(result?.totals?.home ?? result?.winner?.home, NaN);
      const awayPts = toNum(result?.totals?.away ?? result?.winner?.away, NaN);
      if (!Number.isFinite(homePts) || !Number.isFinite(awayPts)) continue;
      if (homePts === awayPts) continue;

      const home = ensure(game.home);
      const away = ensure(game.away);
      if (!home || !away) continue;

      home.gp += 1;
      away.gp += 1;
      home.pf += homePts;
      home.pa += awayPts;
      away.pf += awayPts;
      away.pa += homePts;

      if (homePts > awayPts) {
        home.w += 1;
        away.l += 1;
      } else {
        away.w += 1;
        home.l += 1;
      }
    }
  }

  return map;
}

function readSavedGameplanMinutes(teamName) {
  if (!teamName) return null;

  try {
    const raw = localStorage.getItem(`gameplan_${teamName}`);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    if (
      parsed.minutes &&
      typeof parsed.minutes === "object" &&
      !Array.isArray(parsed.minutes)
    ) {
      return { ...parsed.minutes };
    }

    return { ...parsed };
  } catch {
    return null;
  }
}

function buildFallbackMinutes(team) {
  const players = [...(team?.players || [])]
    .filter((p) => p?.name || p?.player)
    .sort((a, b) => toNum(b?.overall || b?.ovr, 0) - toNum(a?.overall || a?.ovr, 0));

  const minuteSlots = [36, 34, 32, 30, 28, 24, 20, 16, 12, 8];
  const minutes = {};

  for (let i = 0; i < Math.min(players.length, minuteSlots.length); i += 1) {
    const name = players[i]?.name || players[i]?.player;
    if (name) minutes[name] = minuteSlots[i];
  }

  return minutes;
}

function computeSafeTeamRatings(team) {
  try {
    const minutes = readSavedGameplanMinutes(teamNameOf(team)) || buildFallbackMinutes(team);
    const ratings = computeTeamRatings(team, minutes);
    return {
      overall: toNum(ratings?.overall, 0),
      off: toNum(ratings?.off, 0),
      def: toNum(ratings?.def, 0),
      exactOverall: toNum(ratings?.exactOverall, ratings?.overall || 0),
      exactOff: toNum(ratings?.exactOff, ratings?.off || 0),
      exactDef: toNum(ratings?.exactDef, ratings?.def || 0),
    };
  } catch {
    const top = getStandardPlayers(team)
      .map((p) => playerOverall(p))
      .sort((a, b) => b - a)
      .slice(0, 8);
    const fallback = top.length ? top.reduce((sum, value) => sum + value, 0) / top.length : 0;
    return {
      overall: Math.round(fallback),
      off: Math.round(fallback),
      def: Math.round(fallback),
      exactOverall: fallback,
      exactOff: fallback,
      exactDef: fallback,
    };
  }
}

export function getStandardPlayers(team) {
  return Array.isArray(team?.players) ? team.players.filter(isTradeableStandardPlayer) : [];
}

export function playerOverall(player) {
  return toNum(
    player?.overall || player?.ovr || player?.rating || player?.overallRating,
    60
  );
}

export function playerPotential(player) {
  return toNum(player?.potential || player?.pot, playerOverall(player));
}

export function playerAge(player) {
  return toNum(player?.age, 27);
}

export function getPlayerSalary(player, leagueData) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract.salaryByYear) ? contract.salaryByYear : [];

  if (salaries.length) {
    const startYear = Number(contract.startYear || getCurrentSeasonYear(leagueData));
    let idx = getCurrentSeasonYear(leagueData) - startYear;
    if (!Number.isFinite(idx) || idx < 0) idx = 0;
    if (idx >= salaries.length) idx = salaries.length - 1;
    return Number(salaries[idx] || 0);
  }

  const fallback = Number(
    player?.salary ??
      player?.currentSalary ??
      player?.contractSalary ??
      player?.capHit ??
      player?.aav ??
      0
  );

  return Number.isFinite(fallback) ? fallback : 0;
}

function contractYearsLeft(player, leagueData) {
  const direct = toNum(player?.yearsLeft ?? player?.contractYears, -1);
  if (direct >= 0) return Math.round(direct);

  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract.salaryByYear) ? contract.salaryByYear : [];
  if (!salaries.length) return 0;

  const startYear = Number(contract.startYear || getCurrentSeasonYear(leagueData));
  let idx = getCurrentSeasonYear(leagueData) - startYear;
  if (!Number.isFinite(idx) || idx < 0) idx = 0;
  if (idx >= salaries.length) idx = salaries.length - 1;
  return Math.max(1, salaries.length - idx);
}

function isTradeableStandardPlayer(player) {
  const status = String(player?.rosterStatus || player?.contractType || "").toLowerCase();
  return !(
    player?.isTwoWay ||
    player?.isStash ||
    status.includes("two_way") ||
    status.includes("two-way") ||
    status.includes("stash") ||
    status.includes("stashed")
  );
}

function average(values, fallback = 0) {
  const rows = values.filter((v) => Number.isFinite(Number(v)));
  if (!rows.length) return fallback;
  return rows.reduce((sum, value) => sum + Number(value), 0) / rows.length;
}

function averageTopOverall(team, count = 8) {
  const top = getStandardPlayers(team)
    .map(playerOverall)
    .sort((a, b) => b - a)
    .slice(0, count);
  return average(top, 0);
}

function averageRosterAge(team) {
  return average(getStandardPlayers(team).map(playerAge), 27);
}

function readExplicitPhase(team) {
  const raw = String(team?.phase || team?.status || team?.direction || "").toLowerCase().trim();
  return PHASE_PREFERENCES[raw] ? raw : "";
}

export function inferTeamPhase(team, record = null, ratings = null) {
  const explicit = readExplicitPhase(team);
  if (explicit) return explicit;

  const safeRecord = record || {};
  const games = toNum(safeRecord.w, 0) + toNum(safeRecord.l, 0);
  if (games > 0) {
    const winPct = toNum(safeRecord.w, 0) / Math.max(games, 1);
    if (winPct >= 0.62) return "contender";
    if (winPct >= 0.52) return "playoff";
    if (winPct >= 0.43) return "middle";
    if (winPct >= 0.32) return "retool";
    if (winPct < 0.25) return "tank";
    return "rebuild";
  }

  const rating = toNum(ratings?.overall, 0);
  const topOverall = averageTopOverall(team);
  const avgAge = averageRosterAge(team);
  const strength = Math.max(rating, topOverall);

  if (strength >= 85) return "contender";
  if (strength >= 81) return "playoff";
  if (strength >= 78) return "middle";
  if (strength >= 75 || avgAge <= 25) return "retool";
  if (strength <= 71 && avgAge >= 27) return "tank";
  return "rebuild";
}

function ageValue(age) {
  if (age <= 22) return 9;
  if (age <= 25) return 6;
  if (age <= 29) return 2;
  if (age <= 32) return -2;
  if (age <= 34) return -7;
  return -13;
}

function upsideAgeMultiplier(age) {
  if (age <= 21) return 2.4;
  if (age <= 24) return 1.9;
  if (age <= 27) return 1.15;
  return 0.35;
}

export function playerTradeValue(player, phase = "middle", leagueData = null) {
  if (!player || typeof player !== "object") return 0;

  const prefs = PHASE_PREFERENCES[phase] || PHASE_PREFERENCES.middle;
  const overall = playerOverall(player);
  const potential = playerPotential(player);
  const age = playerAge(player);
  const salary = getPlayerSalary(player, leagueData);
  const yearsLeft = contractYearsLeft(player, leagueData);

  const currentValue = Math.max(0, (overall - 60) * 2.35);
  const upsideGap = Math.max(0, potential - overall);
  const upsideValue = upsideGap * upsideAgeMultiplier(age);
  const salaryM = salary / 1_000_000;
  const expectedSalaryM = Math.max(1.5, (overall - 55) * 1.55);
  const salaryDelta = salaryM - expectedSalaryM;

  let contractPenalty = 0;
  if (salaryDelta > 0) contractPenalty += salaryDelta * 0.75 * prefs.salaryFlex;
  else contractPenalty += salaryDelta * 0.25;
  if (yearsLeft >= 4 && salaryDelta > 8) contractPenalty += 5 * prefs.salaryFlex;

  let value = currentValue * prefs.currentTalent + upsideValue * prefs.upside + ageValue(age) - contractPenalty;
  if (overall >= 92) value += 24;
  else if (overall >= 88) value += 14;
  else if (overall >= 84) value += 7;

  return Math.round(Math.max(-25, value) * 10) / 10;
}

function protectionPenaltyText(protection = "") {
  const text = String(protection || "").toLowerCase();
  if (!text || text === "none" || text === "null" || text.includes("unprotected")) return 0;
  if (text.includes("lottery") || text.includes("1-14")) return 11;
  if (text.includes("top 20")) return 15;
  if (text.includes("top 10")) return 8;
  if (text.includes("top 8")) return 6;
  if (text.includes("top 5")) return 4;
  if (text.includes("top 3")) return 3;
  return 5;
}

export function pickProtectionLabel(pick) {
  const raw = pick?.protection || pick?.protections || pick?.displayProtection || "";
  const label = String(raw || "").trim();
  if (!label || label.toLowerCase() === "none" || label.toLowerCase() === "null") return DEFAULT_PICK_PROTECTION;
  return label;
}

export function formatPick(pick) {
  const round = Number(pick?.round || 1) === 1 ? "1st" : "2nd";
  const original = pick?.originalTeam || pick?.originalTeamName || "Own";
  const pickNumber = Number(
    pick?.pickNumber ||
      pick?.overallPick ||
      pick?.resolvedPickNumber ||
      pick?.draftPickNumber ||
      0
  );
  const pickText = pickNumber ? ` #${pickNumber}` : "";
  return `${pick?.year || "Future"} ${round}${pickText} - ${original}`;
}

export function pickTradeValue(pick, phase = "middle", leagueData = null) {
  if (!pick || typeof pick !== "object") return 0;

  const prefs = PHASE_PREFERENCES[phase] || PHASE_PREFERENCES.middle;
  const round = Number(pick?.round || 1);
  const year = Number(pick?.year || getCurrentSeasonYear(leagueData) + 2);
  const now = getCurrentSeasonYear(leagueData || {});
  const pickNumber = Number(
    pick?.pickNumber ||
      pick?.overallPick ||
      pick?.resolvedPickNumber ||
      pick?.draftPickNumber ||
      pick?.projectedRank ||
      0
  );
  const projectedRank = pickNumber || Number(pick?.projectedRank || pick?.recordRank || pick?.expectedRank || pick?.slot || 18);
  const exactPick = String(pick?.assetType || pick?.type || "").toLowerCase() === "resolved" || pickNumber > 0;
  const yearsOut = exactPick && year === now ? 0 : Math.max(0, year - now);
  const futurePenalty = yearsOut * (round === 1 ? 1.75 : 0.7);

  let base = round === 1 ? Math.max(6, 38 - projectedRank * 0.85) : Math.max(1, 7 - projectedRank * 0.08);
  if (exactPick && round === 1) {
    if (projectedRank <= 1) base += 10;
    else if (projectedRank <= 3) base += 6;
    else if (projectedRank <= 14) base += 2.5;
  } else if (exactPick) {
    base += 1;
  }

  return Math.max(0.5, (base - futurePenalty - protectionPenaltyText(pickProtectionLabel(pick))) * prefs.picks);
}

export function collectOwnedPicksForTeam(leagueData, teamName) {
  if (!leagueData || !teamName) return [];

  const teamNames = getAllTeamsFromLeague(leagueData)
    .map((team) => team?.name || team?.teamName)
    .filter(Boolean);

  return normalizeDraftPicks(leagueData?.draftPicks || [], teamNames)
    .filter((pick) => String(pick.status || "active").toLowerCase() === "active")
    .filter((pick) => normalizeTeamName(pick.ownerTeam || pick.owner || pick.currentOwnerTeamName || "") === normalizeTeamName(teamName))
    .sort(sortDraftPickAssets);
}

function getPositionScores(team) {
  const scores = Object.fromEntries(POSITIONS.map((pos) => [pos, 0]));
  for (const player of getStandardPlayers(team)) {
    const overall = playerOverall(player);
    const primary = player?.pos;
    const secondary = player?.secondaryPos;
    if (scores[primary] !== undefined) scores[primary] = Math.max(scores[primary], overall);
    if (scores[secondary] !== undefined) scores[secondary] = Math.max(scores[secondary], overall * 0.55);
  }
  return scores;
}

function topRotation(team, count = 8) {
  return getStandardPlayers(team)
    .sort((a, b) => playerOverall(b) - playerOverall(a))
    .slice(0, count);
}

function attrAvg(players, index, fallback = 70) {
  return average(players.map((player) => Number(player?.attrs?.[index])), fallback);
}

function buildNeeds(team, phase, ratings) {
  const top8 = topRotation(team, 8);
  const posScores = getPositionScores(team);
  const needs = [];
  const pushNeed = (type, label, priority, detail, pos = "") => {
    if (!needs.some((need) => need.type === type && need.pos === pos)) {
      needs.push({ type, label, priority, detail, pos });
    }
  };

  const weakestPositions = POSITIONS
    .map((pos) => ({ pos, score: posScores[pos] || 0 }))
    .sort((a, b) => a.score - b.score);

  for (const row of weakestPositions.slice(0, 2)) {
    if (row.score < 78) {
      const label =
        row.pos === "PG"
          ? "Lead guard / ball handler"
          : row.pos === "C"
          ? "Rim protector / center depth"
          : `${row.pos} rotation upgrade`;
      pushNeed(`pos_${row.pos}`, label, Math.max(4, 92 - row.score), `${row.pos} top option is only ${Math.round(row.score)}.`, row.pos);
    }
  }

  const shooting = attrAvg(top8, 0, 70);
  const passing = attrAvg(top8, 5, 70);
  const ball = attrAvg(top8, 4, 70);
  const perD = attrAvg(top8, 8, 70);
  const insD = attrAvg(top8, 9, 70);
  const reb = attrAvg(top8, 12, 70);
  const benchOvr = playerOverall(topRotation(team, 9)[7] || {});

  if (shooting < 75) pushNeed("shooting", "Shooting / floor spacing", 14, `Top rotation 3PT avg is ${Math.round(shooting)}.`);
  if (phase !== "tank" && (passing < 74 || ball < 74)) pushNeed("creation", "Secondary creator", 12, "Needs more passing and ball handling.");
  if (perD < 75) pushNeed("perimeter_defense", "Point-of-attack defense", 11, `Perimeter defense avg is ${Math.round(perD)}.`);
  if (insD < 75 || reb < 75) pushNeed("interior_defense", "Interior defense / rebounding", 10, "Frontcourt defense or rebounding is light.", "C");
  if (benchOvr && benchOvr < 75 && ["contender", "playoff", "middle"].includes(phase)) {
    pushNeed("depth", "Reliable bench depth", 9, `8th man is around ${Math.round(benchOvr)} OVR.`);
  }

  if (["rebuild", "tank"].includes(phase)) {
    pushNeed("picks", "Extra draft capital", 16, "Future-focused teams should collect picks.");
    pushNeed("young_upside", "Young high-upside players", 15, "Youth and potential matter more than short-term wins.");
  }

  if (["contender", "playoff"].includes(phase) && toNum(ratings?.overall, 0) < 86) {
    pushNeed("star", "Top-end talent upgrade", 13, "Good team, but could use one more premium piece.");
  }

  return needs.sort((a, b) => b.priority - a.priority).slice(0, 7);
}

function buildGoals(phase, needs, record, ratings) {
  const goalsByPhase = {
    contender: ["Maximize current title odds", "Protect star core", "Use picks or depth for proven rotation help"],
    playoff: ["Secure playoff positioning", "Add a reliable starter or sixth man", "Avoid panic-selling future assets"],
    middle: ["Choose a clearer direction", "Shop duplicated depth", "Target younger upgrades without overpaying"],
    retool: ["Get younger without bottoming out", "Move older contracts if value is fair", "Find long-term starters"],
    rebuild: ["Develop the young core", "Move veterans for picks", "Prioritize cap flexibility and upside"],
    tank: ["Protect draft position", "Collect picks", "Give young players bigger roles"],
  };

  const dynamic = [];
  if (needs.some((need) => need.type === "shooting")) dynamic.push("Improve spacing");
  if (needs.some((need) => need.type === "interior_defense")) dynamic.push("Stabilize the paint");
  if (needs.some((need) => need.type === "creation")) dynamic.push("Add another creator");
  if (needs.some((need) => need.type === "picks")) dynamic.push("Turn vets into future assets");
  if (toNum(record?.gp, 0) > 0 && toNum(record?.w, 0) < toNum(record?.l, 0) && ["middle", "retool"].includes(phase)) {
    dynamic.push("Avoid being stuck in the middle");
  }
  if (toNum(ratings?.def, 0) < toNum(ratings?.off, 0) - 4) dynamic.push("Balance the roster with defense");
  if (toNum(ratings?.off, 0) < toNum(ratings?.def, 0) - 4) dynamic.push("Find more offense");

  return [...new Set([...(goalsByPhase[phase] || goalsByPhase.middle), ...dynamic])].slice(0, 6);
}

function playerTraitMatchesNeed(player, need) {
  const pos = player?.pos || "";
  const secondary = player?.secondaryPos || "";
  const attrs = Array.isArray(player?.attrs) ? player.attrs : [];
  const overall = playerOverall(player);
  const potential = playerPotential(player);
  const age = playerAge(player);

  if (need.pos && (pos === need.pos || secondary === need.pos)) return 16;
  if (need.type === "shooting") return toNum(attrs[0], 60) >= 78 ? 13 : 0;
  if (need.type === "creation") return toNum(attrs[4], 60) + toNum(attrs[5], 60) >= 154 ? 13 : 0;
  if (need.type === "perimeter_defense") return toNum(attrs[8], 60) >= 80 ? 12 : 0;
  if (need.type === "interior_defense") return (pos === "C" || secondary === "C" || toNum(attrs[9], 60) + toNum(attrs[10], 60) + toNum(attrs[12], 60) >= 230) ? 12 : 0;
  if (need.type === "depth") return overall >= 76 && overall <= 83 ? 10 : 0;
  if (need.type === "young_upside") return age <= 24 && potential >= overall + 3 ? 13 : 0;
  if (need.type === "star") return overall >= 84 ? 12 : 0;
  return 0;
}

function getCoreStatus(player, teamPhase = "middle") {
  const overall = playerOverall(player);
  const potential = playerPotential(player);
  const age = playerAge(player);

  if (overall >= 92) return { level: "franchise", label: "Franchise player" };
  if (overall >= 88) return { level: "star", label: "Star core" };
  if (age <= 24 && potential >= 88 && overall >= 78) return { level: "young_core", label: "Young core" };
  if (age <= 23 && potential >= 85 && ["rebuild", "tank", "retool"].includes(teamPhase)) return { level: "prospect", label: "Protected prospect" };
  if (overall >= 85 && ["contender", "playoff"].includes(teamPhase)) return { level: "starter", label: "Win-now starter" };
  return null;
}

function buildCorePlayers(team, phase) {
  return getStandardPlayers(team)
    .map((player) => {
      const status = getCoreStatus(player, phase);
      const score =
        playerOverall(player) * 1.4 +
        Math.max(0, playerPotential(player) - playerOverall(player)) * 2.2 +
        Math.max(0, 27 - playerAge(player)) * 1.2;
      return { player, status, score };
    })
    .filter((row) => row.status)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((row) => ({
      player: row.player,
      name: playerNameOf(row.player),
      pos: row.player?.pos || "-",
      overall: playerOverall(row.player),
      potential: playerPotential(row.player),
      age: playerAge(row.player),
      headshot: playerHeadshotOf(row.player),
      reason: row.status.label,
    }));
}

function positionalLogjamScore(player, team) {
  const pos = player?.pos;
  if (!pos) return 0;
  const ahead = getStandardPlayers(team).filter((row) => row?.pos === pos && playerOverall(row) >= playerOverall(player));
  return Math.max(0, ahead.length - 2) * 4;
}

function buildMovablePlayers(team, phase, leagueData, ownedPicks) {
  const coreNames = new Set(buildCorePlayers(team, phase).map((row) => normalizeTeamName(row.name)));
  const players = getStandardPlayers(team)
    .filter((player) => !coreNames.has(normalizeTeamName(playerNameOf(player))))
    .map((player) => {
      const overall = playerOverall(player);
      const potential = playerPotential(player);
      const age = playerAge(player);
      const salary = getPlayerSalary(player, leagueData);
      const salaryM = salary / 1_000_000;
      const value = playerTradeValue(player, phase, leagueData);
      const years = contractYearsLeft(player, leagueData);
      const logjam = positionalLogjamScore(player, team);
      let score = 0;
      const reasons = [];

      if (["rebuild", "tank"].includes(phase) && age >= 29 && overall >= 74) {
        score += 26;
        reasons.push("veteran on future team");
      }
      if (phase === "retool" && age >= 30 && overall >= 76) {
        score += 18;
        reasons.push("older retool piece");
      }
      if (["contender", "playoff"].includes(phase) && overall <= 76) {
        score += 12;
        reasons.push("expendable depth");
      }
      if (salaryM >= 20 && overall < 84) {
        score += 18;
        reasons.push("salary flexibility");
      }
      if (years >= 3 && salaryM >= 14 && overall < 82) {
        score += 10;
        reasons.push("long money");
      }
      if (logjam > 0) {
        score += logjam;
        reasons.push("position crowding");
      }
      if (overall <= 73 && age >= 25) {
        score += 8;
        reasons.push("back-end roster spot");
      }
      if (potential <= overall + 1 && age >= 28 && !["contender", "playoff"].includes(phase)) {
        score += 8;
        reasons.push("limited upside");
      }

      return {
        type: "player",
        player,
        name: playerNameOf(player),
        pos: player?.pos || "-",
        overall,
        potential,
        age,
        salary,
        value,
        headshot: playerHeadshotOf(player),
        score,
        reason: reasons.slice(0, 2).join(" / ") || "available in the right offer",
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.value - b.value)
    .slice(0, 6);

  const pickAssets = [];
  if (["contender", "playoff"].includes(phase)) {
    for (const pick of ownedPicks.filter((row) => Number(row.round || 1) === 1).slice(0, 2)) {
      pickAssets.push({
        type: "pick",
        pick,
        label: formatPick(pick),
        reason: "win-now trade chip",
        value: pickTradeValue(pick, phase, leagueData),
      });
    }
  } else if (phase === "middle") {
    for (const pick of ownedPicks.filter((row) => Number(row.round || 1) === 2).slice(0, 2)) {
      pickAssets.push({
        type: "pick",
        pick,
        label: formatPick(pick),
        reason: "small sweetener",
        value: pickTradeValue(pick, phase, leagueData),
      });
    }
  }

  return [...players, ...pickAssets].slice(0, 7);
}

function targetReasonFor(player, needs, phase) {
  const matched = needs
    .map((need) => ({ need, score: playerTraitMatchesNeed(player, need) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)[0];

  if (matched) return matched.need.label;
  if (["rebuild", "tank"].includes(phase) && playerAge(player) <= 24) return "young upside";
  if (["contender", "playoff"].includes(phase) && playerOverall(player) >= 80) return "win-now rotation help";
  return "good value fit";
}

function buildTargetsForTeam(team, phase, needs, teams, sourceIntelByName, leagueData) {
  const ownName = teamNameOf(team);
  const prefs = PHASE_PREFERENCES[phase] || PHASE_PREFERENCES.middle;
  const needPriority = needs.reduce((sum, need) => sum + toNum(need.priority, 0), 0);

  const rows = [];
  for (const sourceTeam of teams || []) {
    const sourceName = teamNameOf(sourceTeam);
    if (!sourceName || normalizeTeamName(sourceName) === normalizeTeamName(ownName)) continue;

    const sourcePhase = sourceIntelByName?.[normalizeTeamName(sourceName)]?.phase || inferTeamPhase(sourceTeam);
    const sourceCore = new Set(buildCorePlayers(sourceTeam, sourcePhase).map((row) => normalizeTeamName(row.name)));

    for (const player of getStandardPlayers(sourceTeam)) {
      const name = playerNameOf(player);
      if (sourceCore.has(normalizeTeamName(name))) continue;

      const overall = playerOverall(player);
      const potential = playerPotential(player);
      const age = playerAge(player);
      const value = playerTradeValue(player, sourcePhase, leagueData);
      const needScore = needs.reduce((sum, need) => sum + playerTraitMatchesNeed(player, need), 0);

      let score = needScore;
      if (["contender", "playoff"].includes(phase)) {
        if (overall >= 78 && overall <= 87) score += 18;
        if (overall >= 88) score += 6;
        if (age >= 26 && age <= 32) score += 6;
        if (["rebuild", "tank", "retool"].includes(sourcePhase) && age >= 28) score += 10;
        if (overall < 74) score -= 18;
      } else if (["rebuild", "tank"].includes(phase)) {
        if (age <= 23) score += 20;
        if (potential >= overall + 4) score += 16;
        if (potential >= 84) score += 10;
        if (age >= 29) score -= 24;
        if (overall >= 87) score -= 12;
      } else {
        if (age <= 26 && potential >= 80) score += 14;
        if (overall >= 77 && overall <= 85) score += 10;
        if (needPriority > 0 && needScore <= 0) score -= 8;
      }

      if (value > 80 && !["contender", "playoff"].includes(phase)) score -= 18;
      if (overall >= 92) score -= 30;
      if (age <= 22 && potential >= 90) score -= 18;
      if (score <= 12) continue;

      rows.push({
        player,
        sourceTeam,
        sourceTeamName: sourceName,
        sourceLogo: teamLogoOf(sourceTeam),
        name,
        pos: player?.pos || "-",
        overall,
        potential,
        age,
        salary: getPlayerSalary(player, leagueData),
        value,
        headshot: playerHeadshotOf(player),
        reason: targetReasonFor(player, needs, phase),
        score,
      });
    }
  }

  return rows
    .sort((a, b) => b.score - a.score || b.overall - a.overall || a.name.localeCompare(b.name))
    .slice(0, 8);
}

function buildWantProfile(phase, needs) {
  const base = {
    contender: ["Proven playoff rotation players", "Two-way wings", "Low-risk veterans"],
    playoff: ["Starter upgrades", "Bench scoring", "Defensive role players"],
    middle: ["Younger long-term starters", "Value contracts", "Clearer roster direction"],
    retool: ["Age 22-26 starters", "High-POT prospects", "Flexible contracts"],
    rebuild: ["Draft picks", "Young prospects", "Bad money only with assets attached"],
    tank: ["First-round picks", "Raw upside", "Cap flexibility"],
  };

  const fromNeeds = needs.map((need) => need.label);
  return [...new Set([...(base[phase] || base.middle), ...fromNeeds])].slice(0, 8);
}

function buildIntelForTeam({ team, teams, leagueData, record, sourceIntelByName = {} }) {
  const ratings = computeSafeTeamRatings(team);
  const phase = inferTeamPhase(team, record, ratings);
  const needs = buildNeeds(team, phase, ratings);
  const goals = buildGoals(phase, needs, record, ratings);
  const ownedPicks = collectOwnedPicksForTeam(leagueData, teamNameOf(team));
  const core = buildCorePlayers(team, phase);
  const movable = buildMovablePlayers(team, phase, leagueData, ownedPicks);
  const targets = buildTargetsForTeam(team, phase, needs, teams, sourceIntelByName, leagueData);
  const topPlayers = topRotation(team, 3).map((player) => ({
    name: playerNameOf(player),
    pos: player?.pos || "-",
    overall: playerOverall(player),
    potential: playerPotential(player),
    age: playerAge(player),
    headshot: playerHeadshotOf(player),
  }));

  return {
    team,
    name: teamNameOf(team),
    logo: teamLogoOf(team),
    phase,
    phaseLabel: PHASE_LABELS[phase] || phase,
    phaseSummary: PHASE_SUMMARIES[phase] || PHASE_SUMMARIES.middle,
    preferences: PHASE_PREFERENCES[phase] || PHASE_PREFERENCES.middle,
    record: {
      w: toNum(record?.w, 0),
      l: toNum(record?.l, 0),
      gp: toNum(record?.gp, 0),
      pf: toNum(record?.pf, 0),
      pa: toNum(record?.pa, 0),
      pointDiff: toNum(record?.gp, 0) > 0 ? (toNum(record?.pf, 0) - toNum(record?.pa, 0)) / Math.max(1, toNum(record?.gp, 0)) : 0,
    },
    ratings,
    roster: {
      count: getStandardPlayers(team).length,
      avgAge: averageRosterAge(team),
      avgTopOverall: averageTopOverall(team),
    },
    goals,
    needs,
    wants: buildWantProfile(phase, needs),
    core,
    targets,
    movable,
    topPlayers,
    ownedPicks,
  };
}

export function buildLeagueIntel(leagueData) {
  const teams = getAllTeamsFromLeague(leagueData);
  const records = buildRecordMap(teams);

  // First pass only decides each source team's rough direction. Targets use this
  // so they avoid pulling likely untouchables from teams that should protect them.
  const sourceIntelByName = {};
  for (const team of teams) {
    const name = teamNameOf(team);
    const ratings = computeSafeTeamRatings(team);
    sourceIntelByName[normalizeTeamName(name)] = {
      phase: inferTeamPhase(team, records[name], ratings),
      ratings,
    };
  }

  return teams
    .map((team) =>
      buildIntelForTeam({
        team,
        teams,
        leagueData,
        record: records[teamNameOf(team)] || {},
        sourceIntelByName,
      })
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function phaseTone(phase) {
  if (phase === "contender") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
  if (phase === "playoff") return "border-sky-400/30 bg-sky-500/10 text-sky-100";
  if (phase === "middle") return "border-amber-400/30 bg-amber-500/10 text-amber-100";
  if (phase === "retool") return "border-orange-400/30 bg-orange-500/10 text-orange-100";
  if (phase === "rebuild") return "border-purple-400/30 bg-purple-500/10 text-purple-100";
  return "border-red-400/30 bg-red-500/10 text-red-100";
}
