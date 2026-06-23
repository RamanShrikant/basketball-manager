import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { evaluateTradeProposal } from "../api/tradeNegotiationPy.js";
import { getLeagueFinancialRules } from "../utils/leagueFinancials.js";
import { normalizeDraftPickAsset, normalizeTeamName } from "../utils/draftPicks.js";
import { saveLeagueData } from "../utils/leagueStorage.js";
import PageFade from "../components/PageFade";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";

const TRADE_BUILDER_KEY = "bm_trade_builder_v1";
const TRADE_DEADLINE_STATUS_KEY = "bm_trade_deadline_status_v1";
const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
const DRAFT_LOTTERY_KEY = "bm_draft_lottery_v1";
const DRAFT_STATE_KEY = "bm_draft_state_v1";
const MAX_SIDE_ITEMS = 6;
const REGULAR_SEASON_MIN_STANDARD_PLAYERS = 14;
const REGULAR_SEASON_MAX_STANDARD_PLAYERS = 15;


// Manual trade-card layout controls.
// Change only these numbers to move/resize the player face, OVR ring, name,
// position/age line, and contract line inside each selected trade asset card.
const TRADE_PLAYER_CARD_TUNING = {
  cardHeight: 126,
  face: {
    boxWidth: 180,
    imageHeight: 180,
    x: 0,
    y: 32,
  },
  ring: {
    size: 95,
    x: -12,
    y: 14,
  },
  ringText: {
    ovrLabel: {
      size: 12,
      x: 0,
      y: 0,
    },
    ovrNumber: {
      size: 30,
      x: 0,
      y: 0,
    },
    potLine: {
      size: 8,
      x: 0,
      y: 0,
    },
  },
  textBlock: {
    x: 0,
    y: 0,
  },
  name: {
    size: 30,
    x: 0,
    y: 0,
  },
  positionAge: {
    size: 16,
    x: 0,
    y: 0,
  },
  contract: {
    size: 13,
    x: 0,
    y: 0,
  },
};


// Manual background-logo controls for every trade item pill.
// This places the item's team logo behind player/pick content at low opacity.
const TRADE_ITEM_BACKGROUND_LOGO_TUNING = {
  enabled: true,
  size: 500,
  opacity: 0.17,
  x: 0,
  y: 0,
  rotate: 0,
  blur: 0,
  brightness: 1.35,
  contrast: 1.15,
  saturate: 1.25,
  blendMode: "screen",
};

// Manual team-specific logo watermark controls.
// These override TRADE_ITEM_BACKGROUND_LOGO_TUNING only for matching team logos.
// This affects player pills by the player/team side and draft-pick pills by the pick's original team.
const TRADE_ITEM_BACKGROUND_LOGO_TEAM_OVERRIDES = {
  pelicans: {
    size: 500,
    opacity: 0.2,
    x: 0,
    y: 0,
    rotate: 0,
    blur: 0,
    brightness: 1.45,
    contrast: 1.2,
    saturate: 1.35,
    blendMode: "screen",
  },
  trailBlazers: {
    size: 900,
    opacity: 0.3,
    x: 0,
    y: 120,
    rotate: 0,
    blur: 0,
    brightness: 1.85,
    contrast: 1.25,
    saturate: 1.5,
    blendMode: "screen",
  },
};


// Manual 2K-style financial-footer controls.
// Change these numbers to move/resize the team logo, financial text,
// value column, and Valid Trade / Hard Cap Issue bar at the bottom of each side.
const TRADE_FINANCIAL_FOOTER_TUNING = {
  footer: {
    paddingX: 20,
    paddingY: 12,
    logoColumnWidth: 150,
    gap: 22,
    x: 0,
    y: 0,
  },
  logo: {
    size: 118,
    x: 0,
    y: 0,
  },
  rowsBlock: {
    x: 0,
    y: 0,
    width: "100%",
  },
  rows: {
    gap: 2,
  },
  label: {
    size: 14,
    x: 0,
    y: 0,
    letterSpacing: "0.08em",
  },
  value: {
    size: 14,
    x: 0,
    y: 0,
  },
  statusBar: {
    height: 30,
    marginTop: 8,
    width: "100%",
    x: 0,
    y: 0,
    fontSize: 14,
    textX: 0,
    textY: 0,
  },
};

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function teamLogoOf(team) {
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

function playerNameOf(player) {
  return player?.name || player?.player || "Unknown Player";
}

function getCurrentSeasonYear(leagueData) {
  return Number(
    leagueData?.seasonYear ||
      leagueData?.currentSeasonYear ||
      leagueData?.seasonStartYear ||
      2026
  );
}

function getPlayerSalary(player, leagueData) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract.salaryByYear) ? contract.salaryByYear : [];
  if (!salaries.length) return 0;

  const startYear = Number(contract.startYear || getCurrentSeasonYear(leagueData));
  let idx = getCurrentSeasonYear(leagueData) - startYear;
  if (!Number.isFinite(idx) || idx < 0) idx = 0;
  if (idx >= salaries.length) idx = salaries.length - 1;
  return Number(salaries[idx] || 0);
}

function getContractYearsRemaining(player, leagueData) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract.salaryByYear) ? contract.salaryByYear : [];
  if (!salaries.length) return 0;

  const startYear = Number(contract.startYear || getCurrentSeasonYear(leagueData));
  let idx = getCurrentSeasonYear(leagueData) - startYear;
  if (!Number.isFinite(idx) || idx < 0) idx = 0;
  if (idx >= salaries.length) idx = salaries.length - 1;
  return Math.max(1, salaries.length - idx);
}

function formatMoney(amount) {
  const n = Number(amount || 0);
  if (!Number.isFinite(n) || n === 0) return "$0";

  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);

  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${sign}$${Math.round(abs / 1000)}K`;
}

function safeReadBuilder() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRADE_BUILDER_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function saveBuilder(builder) {
  localStorage.setItem(TRADE_BUILDER_KEY, JSON.stringify(builder));
}


function safeJSON(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function readOffseasonState() {
  return safeJSON(localStorage.getItem(OFFSEASON_STATE_KEY), {}) || {};
}

function readSavedDraftLottery(seasonYear) {
  const saved = safeJSON(localStorage.getItem(DRAFT_LOTTERY_KEY), null);
  if (!saved || typeof saved !== "object") return null;
  if (Number(saved.seasonYear || seasonYear) !== Number(seasonYear)) return null;
  return saved;
}

function readSavedDraftState(seasonYear) {
  const saved = safeJSON(localStorage.getItem(DRAFT_STATE_KEY), null);
  if (!saved || typeof saved !== "object") return null;
  if (Number(saved.seasonYear || seasonYear) !== Number(seasonYear)) return null;
  return saved;
}

function writeSavedDraftLottery(nextLottery) {
  if (!nextLottery || typeof nextLottery !== "object") return;
  localStorage.setItem(DRAFT_LOTTERY_KEY, JSON.stringify(nextLottery));
}

function writeSavedDraftState(nextDraftState) {
  if (!nextDraftState || typeof nextDraftState !== "object") return;
  localStorage.setItem(DRAFT_STATE_KEY, JSON.stringify(nextDraftState));
}

function readTradePhaseInfo(leagueData) {
  const seasonYear = getCurrentSeasonYear(leagueData);
  const offseasonState = readOffseasonState();
  const savedLottery = readSavedDraftLottery(seasonYear);
  const savedDraftState = readSavedDraftState(seasonYear);

  const draftOrder = getLockedDraftOrder(leagueData, seasonYear);
  const draftOrderLocked = draftOrder.length >= 60;
  const draftComplete = Boolean(
    (Number(offseasonState?.seasonYear || seasonYear) === Number(seasonYear) && offseasonState?.draftComplete) ||
      (Number(savedDraftState?.seasonYear || 0) === Number(seasonYear) && savedDraftState?.completed) ||
      (Number(leagueData?.draftState?.seasonYear || seasonYear) === Number(seasonYear) && leagueData?.draftState?.completed)
  );

  const inOffseason = Boolean(
    offseasonState?.inOffseason ||
      offseasonState?.offseason ||
      offseasonState?.active ||
      offseasonState?.started ||
      offseasonState?.retirementsComplete ||
      offseasonState?.teamOptionsComplete ||
      offseasonState?.draftLotteryComplete ||
      offseasonState?.draftComplete ||
      offseasonState?.rookieSigningsComplete ||
      offseasonState?.freeAgencyComplete ||
      offseasonState?.rosterFinalizationStarted ||
      savedLottery ||
      savedDraftState ||
      leagueData?.draftState?.draftLotteryComplete ||
      leagueData?.draftState?.draftOrder?.length
  );

  return {
    seasonYear,
    inOffseason,
    draftOrderLocked,
    draftComplete,
    draftInProgress: Boolean(savedDraftState && !savedDraftState.completed && Number(savedDraftState.currentPickIndex || 0) > 0),
    enforceRegularSeasonRosterLimits: !inOffseason,
  };
}

function getPickNumberFromAny(row = {}) {
  const n = Number(row.pick ?? row.pickNumber ?? row.overallPick ?? row.draftPickNumber ?? row.resolvedPickNumber ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getRoundFromAny(row = {}) {
  const explicit = Number(row.round || row.roundNum || row.pickRound || 0);
  if (explicit === 1 || explicit === 2) return explicit;
  const pickNumber = getPickNumberFromAny(row);
  return pickNumber && pickNumber <= 30 ? 1 : 2;
}

function getOriginalTeamFromAny(row = {}) {
  return row.originalTeam || row.originalTeamName || row.originalPickTeamName || row.naturalLotteryTeamName || row.team || row.teamName || "";
}

function getOwnerTeamFromDraftRow(row = {}) {
  return row.currentOwnerTeamName || row.ownerTeamName || row.ownerTeam || row.owner || row.currentOwner || row.teamName || "";
}

function getLockedDraftOrder(leagueData, seasonYear = getCurrentSeasonYear(leagueData)) {
  const direct = leagueData?.draftState?.draftOrder;
  if (Array.isArray(direct) && direct.length) return direct;

  const lotteryOrder = leagueData?.draftState?.lottery?.fullDraftOrder;
  if (Array.isArray(lotteryOrder) && lotteryOrder.length) return lotteryOrder;

  const savedLottery = readSavedDraftLottery(seasonYear);
  if (
    savedLottery &&
    savedLottery.firstRoundRevealed &&
    savedLottery.secondRoundRevealed &&
    Array.isArray(savedLottery?.result?.fullDraftOrder)
  ) {
    return savedLottery.result.fullDraftOrder;
  }

  return [];
}

function resolvedPickIdentityMatches(row = {}, pick = {}) {
  const rowPick = getPickNumberFromAny(row);
  const pickNumber = getPickNumberFromAny(pick);
  if (!rowPick || !pickNumber || rowPick !== pickNumber) return false;

  const rowRound = getRoundFromAny(row);
  const pickRound = getRoundFromAny(pick);
  if (Number(rowRound) !== Number(pickRound)) return false;

  const rowOriginal = getOriginalTeamFromAny(row);
  const pickOriginal = getOriginalTeamFromAny(pick);
  return !pickOriginal || sameTeamName(rowOriginal, pickOriginal);
}

function setDraftRowOwner(row = {}, toTeamName = "", leagueData = {}, tradeStamp = {}) {
  const toTeam = findTeamInLeague(leagueData, toTeamName);
  const ownerLogo = teamLogoOf(toTeam);
  return {
    ...row,
    teamName: toTeamName,
    ownerTeam: toTeamName,
    owner: toTeamName,
    currentOwner: toTeamName,
    ownerTeamName: toTeamName,
    currentOwnerTeamName: toTeamName,
    ownerLogo: ownerLogo || row.ownerLogo || "",
    currentOwnerTeamLogo: ownerLogo || row.currentOwnerTeamLogo || row.logo || "",
    logo: ownerLogo || row.logo || "",
    lastTrade: tradeStamp,
    tradeHistory: Array.isArray(row.tradeHistory) ? [...row.tradeHistory, tradeStamp] : [tradeStamp],
  };
}

function updateDraftOrderOwner(rows = [], pick = {}, fromTeamName = "", toTeamName = "", leagueData = {}, tradeStamp = {}) {
  let found = false;
  let ownedByFrom = false;
  let label = formatPick(pick);

  const nextRows = (Array.isArray(rows) ? rows : []).map((row) => {
    if (!resolvedPickIdentityMatches(row, pick)) return row;

    found = true;
    const currentOwner = getOwnerTeamFromDraftRow(row);
    if (!sameTeamName(currentOwner, fromTeamName)) return row;

    ownedByFrom = true;
    label = `#${getPickNumberFromAny(row)} ${formatPick({ ...pick, originalTeam: getOriginalTeamFromAny(row) })}`;
    return setDraftRowOwner(row, toTeamName, leagueData, tradeStamp);
  });

  return { rows: nextRows, found, ownedByFrom, label };
}

function isResolvedPickAlreadyDrafted(pick = {}, seasonYear = 2026) {
  const savedDraftState = readSavedDraftState(seasonYear);
  if (!savedDraftState || typeof savedDraftState !== "object") return false;
  if (savedDraftState.completed) return true;

  const pickNumber = getPickNumberFromAny(pick);
  const pickRound = getRoundFromAny(pick);
  const drafted = Array.isArray(savedDraftState.draftedPicks) ? savedDraftState.draftedPicks : [];

  if (drafted.some((row) => getPickNumberFromAny(row) === pickNumber && getRoundFromAny(row) === pickRound)) {
    return true;
  }

  const order = Array.isArray(savedDraftState.draftOrder) ? savedDraftState.draftOrder : [];
  const index = order.findIndex((row) => resolvedPickIdentityMatches(row, pick));
  const currentPickIndex = Number(savedDraftState.currentPickIndex || 0);
  return index >= 0 && currentPickIndex > index;
}

function readTradeDeadlineStatus() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRADE_DEADLINE_STATUS_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function isTradeDeadlineLocked(status) {
  return Boolean(status?.locked);
}

function makeEmptyBuilder(userTeamName, cpuTeamName) {
  return {
    userTeamName,
    cpuTeamName,
    userItems: [],
    cpuItems: [],
    updatedAt: Date.now(),
  };
}

function itemKey(item) {
  if (!item) return "";
  if (item.type === "player") {
    return `player:${item.player?.id || item.player?.playerId || playerNameOf(item.player)}`;
  }
  if (item.type === "pick") {
    const pick = item.pick || {};
    return `pick:${pick.id || pick.pickId || `${pick.year}_${pick.round}_${pick.originalTeam || pick.team || pick.owner || ""}`}`;
  }
  return `${item.type}:${JSON.stringify(item)}`;
}

function getSideItems(builder, side) {
  return side === "user" ? builder.userItems || [] : builder.cpuItems || [];
}

function setSideItems(builder, side, nextItems) {
  if (side === "user") return { ...builder, userItems: nextItems, updatedAt: Date.now() };
  return { ...builder, cpuItems: nextItems, updatedAt: Date.now() };
}

function sideSalary(items, leagueData) {
  return (items || []).reduce((sum, item) => {
    if (item?.type !== "player") return sum;
    return sum + getPlayerSalary(item.player, leagueData);
  }, 0);
}

function getLeagueAmount(leagueData, rules, keys, fallback = 0) {
  for (const key of keys) {
    const value = Number(leagueData?.[key] || 0);
    if (Number.isFinite(value) && value > 0) return value;
  }

  const fallbackValue = Number(fallback || 0);
  return Number.isFinite(fallbackValue) ? fallbackValue : 0;
}

function getFinancialLimits(leagueData) {
  const seasonYear = getCurrentSeasonYear(leagueData);
  const rules = getLeagueFinancialRules(leagueData || {}, seasonYear);
  const salaryCap = getLeagueAmount(leagueData, rules, ["salaryCap", "capLimit"], rules.salaryCap);
  const hardCap = getLeagueAmount(
    leagueData,
    rules,
    ["hardCap", "hardCapLimit", "secondApron", "apron2"],
    rules.hardCap || rules.secondApron || salaryCap
  );

  return { salaryCap, hardCap };
}

function getCurrentDeadCapForTeam(team, leagueData) {
  const teamName = team?.name;
  const seasonYear = getCurrentSeasonYear(leagueData);
  const rows = Array.isArray(leagueData?.deadCapByTeam?.[teamName])
    ? leagueData.deadCapByTeam[teamName]
    : [];

  return rows.reduce((sum, row) => {
    const rowSeason = Number(row?.seasonYear || seasonYear);
    if (rowSeason !== Number(seasonYear)) return sum;
    return sum + Number(row?.amount ?? row?.netAmount ?? row?.originalAmount ?? 0);
  }, 0);
}

function getTeamBasePayroll(team, leagueData) {
  const standardPlayers = Array.isArray(team?.players) ? team.players : [];
  const rosterPayroll = standardPlayers.reduce(
    (sum, player) => sum + getPlayerSalary(player, leagueData),
    0
  );
  const deadCap = getCurrentDeadCapForTeam(team, leagueData);
  const computedPayroll = rosterPayroll + deadCap;

  if (computedPayroll > 0) return computedPayroll;

  const storedPayroll = Number(team?.payroll ?? team?.totalSalary ?? team?.financials?.payroll ?? 0);
  return Number.isFinite(storedPayroll) ? storedPayroll : 0;
}

function getTeamCapInfo(team, leagueData, outgoingSalary = 0, incomingSalary = 0) {
  const { salaryCap, hardCap } = getFinancialLimits(leagueData);
  const basePayroll = getTeamBasePayroll(team, leagueData);
  const payroll = Math.max(0, basePayroll - Number(outgoingSalary || 0) + Number(incomingSalary || 0));
  const capRoom = salaryCap > 0 ? salaryCap - payroll : Number(team?.capRoom ?? team?.financials?.capRoom ?? 0);
  const hardCapRoom = hardCap > 0 ? hardCap - payroll : Number(team?.hardCapRoom ?? team?.financials?.hardCapRoom ?? 0);

  return { capRoom, hardCapRoom, payroll, basePayroll, salaryCap, hardCap };
}

function formatPick(pick) {
  if (!pick) return "Unknown Pick";
  const year = pick.year || pick.season || pick.seasonYear || "Future";
  const round = Number(pick.round || pick.rnd || 1);
  const original = pick.originalTeam || pick.original || pick.team || pick.fromTeam || pick.owner || "Own";
  const suffix = round === 1 ? "1st" : round === 2 ? "2nd" : `R${round}`;
  return `${year} ${suffix} - ${original}`;
}

function getPickOriginalTeamName(pick = {}) {
  return (
    pick?.originalTeam ||
    pick?.originalTeamName ||
    pick?.original ||
    pick?.fromTeam ||
    pick?.sourceTeam ||
    pick?.team ||
    ""
  );
}

function getPickOriginalTeamLogoTeam(leagueData, pick = {}, fallbackTeam = null) {
  const originalTeamName = getPickOriginalTeamName(pick);
  const directOriginalLogo =
    pick?.originalTeamLogo ||
    pick?.originalLogo ||
    pick?.fromTeamLogo ||
    pick?.sourceTeamLogo ||
    "";

  if (directOriginalLogo) {
    return {
      ...(fallbackTeam || {}),
      name: originalTeamName || fallbackTeam?.name || fallbackTeam?.teamName || "Original Team",
      logo: directOriginalLogo,
    };
  }

  if (originalTeamName) {
    const originalTeam = findTeamInLeague(leagueData, originalTeamName);
    if (originalTeam) return originalTeam;
  }

  return fallbackTeam;
}

function getTradePlayers(items) {
  return (items || [])
    .filter((item) => item?.type === "player" && item.player)
    .map((item) => item.player);
}

function getTradePicks(items, leagueData = null) {
  const seasonYear = getCurrentSeasonYear(leagueData || {});
  return (items || [])
    .filter((item) => item?.type === "pick" && item.pick)
    .map((item) => {
      const pick = item.pick || {};
      const pickNumber = getPickNumberFromAny(pick);
      const protection = item.protection || pick.protection || pick.protections || pick.displayProtection || "Unprotected";
      return {
        ...pick,
        pickNumber: pick.pickNumber || pick.overallPick || pick.resolvedPickNumber || pickNumber || undefined,
        overallPick: pick.overallPick || pick.pickNumber || pick.resolvedPickNumber || pickNumber || undefined,
        projectedRank: pick.projectedRank || pick.recordRank || pick.expectedRank || pick.slot || pickNumber || undefined,
        currentSeasonYear: seasonYear,
        leagueSeasonYear: seasonYear,
        protection,
        protections: protection,
        displayProtection: protection,
      };
    });
}

function readTeamRecord(team) {
  const wins = Number(
    team?.wins ??
      team?.record?.wins ??
      team?.seasonRecord?.wins ??
      team?.stats?.wins ??
      0
  );

  const losses = Number(
    team?.losses ??
      team?.record?.losses ??
      team?.seasonRecord?.losses ??
      team?.stats?.losses ??
      0
  );

  return {
    wins: Number.isFinite(wins) ? wins : 0,
    losses: Number.isFinite(losses) ? losses : 0,
  };
}

function averageTeamOverall(team) {
  const players = Array.isArray(team?.players) ? team.players : [];
  const top = [...players]
    .map((player) => Number(player?.overall || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b - a)
    .slice(0, 8);

  if (!top.length) return 0;
  return top.reduce((sum, value) => sum + value, 0) / top.length;
}

function inferTeamPhase(team) {
  const { wins, losses } = readTeamRecord(team);
  const games = wins + losses;
  const winPct = games > 0 ? wins / games : null;
  const avgOvr = averageTeamOverall(team);

  if (winPct !== null) {
    if (winPct >= 0.6) return "contender";
    if (winPct >= 0.5) return "playoff";
    if (winPct <= 0.35) return "rebuild";
    return "retool";
  }

  if (avgOvr >= 84) return "contender";
  if (avgOvr >= 80) return "playoff";
  if (avgOvr <= 75) return "rebuild";
  return "retool";
}

function buildTeamContextForTrade(userTeam, cpuTeam) {
  const context = {};

  for (const team of [userTeam, cpuTeam]) {
    if (!team?.name) continue;
    const { wins, losses } = readTeamRecord(team);
    context[team.name] = {
      wins,
      losses,
      phase: inferTeamPhase(team),
    };
  }

  return context;
}

function buildTradeProposalPayload({ userTeamName, cpuTeamName, userTeam, cpuTeam, userItems, cpuItems, leagueData }) {
  const seasonYear = getCurrentSeasonYear(leagueData || {});
  return {
    seasonYear,
    currentSeasonYear: seasonYear,
    userTeam: userTeamName,
    cpuTeam: cpuTeamName,
    teamContext: buildTeamContextForTrade(userTeam, cpuTeam),
    cpuReceives: {
      players: getTradePlayers(userItems),
      picks: getTradePicks(userItems, leagueData),
    },
    cpuSends: {
      players: getTradePlayers(cpuItems),
      picks: getTradePicks(cpuItems, leagueData),
    },
  };
}


function hasAcceptedEvaluation(evaluation) {
  return Boolean(
    evaluation?.accepted ||
      String(evaluation?.decision || "").toLowerCase() === "accept" ||
      String(evaluation?.decision || "").toLowerCase() === "accepted"
  );
}

function cloneTeamForTrade(team = {}) {
  return {
    ...team,
    players: Array.isArray(team.players) ? team.players.map((player) => ({ ...player })) : [],
    twoWayPlayers: Array.isArray(team.twoWayPlayers)
      ? team.twoWayPlayers.map((player) => ({ ...player }))
      : [],
    stashPlayers: Array.isArray(team.stashPlayers)
      ? team.stashPlayers.map((player) => ({ ...player }))
      : [],
    financials: team.financials && typeof team.financials === "object" ? { ...team.financials } : team.financials,
  };
}

function cloneLeagueForTrade(leagueData = {}) {
  const next = {
    ...leagueData,
    draftPicks: Array.isArray(leagueData?.draftPicks)
      ? leagueData.draftPicks.map((pick) => ({ ...pick }))
      : [],
    tradeHistory: Array.isArray(leagueData?.tradeHistory) ? [...leagueData.tradeHistory] : [],
    draftState: leagueData?.draftState && typeof leagueData.draftState === "object"
      ? JSON.parse(JSON.stringify(leagueData.draftState))
      : leagueData?.draftState,
  };

  if (Array.isArray(leagueData?.teams)) {
    next.teams = leagueData.teams.map(cloneTeamForTrade);
  }

  if (leagueData?.conferences && typeof leagueData.conferences === "object") {
    next.conferences = Object.fromEntries(
      Object.entries(leagueData.conferences).map(([confName, rows]) => [
        confName,
        Array.isArray(rows) ? rows.map(cloneTeamForTrade) : rows,
      ])
    );
  }

  return next;
}

function sameTeamName(a = "", b = "") {
  return normalizeTeamName(a) === normalizeTeamName(b);
}

function findTeamInLeague(leagueData, teamName) {
  return getAllTeamsFromLeague(leagueData).find((team) => sameTeamName(team?.name || team?.teamName, teamName)) || null;
}

function getPlayerIdentity(player = {}) {
  const id = player?.id ?? player?.playerId ?? player?.player_id ?? player?.uuid ?? null;
  if (id !== null && id !== undefined && String(id).trim() !== "") return `id:${String(id)}`;
  return `name:${normalizeTeamName(playerNameOf(player))}`;
}

function sameTradePlayer(a = {}, b = {}) {
  const aid = getPlayerIdentity(a);
  const bid = getPlayerIdentity(b);
  return aid && bid && aid === bid;
}

function findStandardPlayerIndex(team, player) {
  const rows = Array.isArray(team?.players) ? team.players : [];
  return rows.findIndex((row) => sameTradePlayer(row, player));
}

function transferStandardPlayer(nextLeague, fromTeamName, toTeamName, playerItem) {
  const fromTeam = findTeamInLeague(nextLeague, fromTeamName);
  const toTeam = findTeamInLeague(nextLeague, toTeamName);
  const player = playerItem?.player || {};
  const playerName = playerNameOf(player);

  if (!fromTeam || !toTeam) {
    return { ok: false, reason: `Could not find ${!fromTeam ? fromTeamName : toTeamName} in the league save.` };
  }

  if (player?.isTwoWay || player?.isStash) {
    return {
      ok: false,
      reason: `${playerName} is not a standard-roster player. Trade execution currently supports standard roster players only.`,
    };
  }

  const fromIndex = findStandardPlayerIndex(fromTeam, player);
  if (fromIndex < 0) {
    return { ok: false, reason: `${playerName} is no longer on ${fromTeamName}'s standard roster.` };
  }

  const [movedRaw] = fromTeam.players.splice(fromIndex, 1);
  const moved = {
    ...movedRaw,
    isTwoWay: false,
    isStash: false,
    rosterStatus: movedRaw?.rosterStatus === "free_agent" ? "standard" : movedRaw?.rosterStatus,
  };

  if (moved.teamName !== undefined) moved.teamName = toTeamName;
  if (moved.currentTeam !== undefined) moved.currentTeam = toTeamName;
  if (typeof moved.team === "string") moved.team = toTeamName;

  toTeam.players = (Array.isArray(toTeam.players) ? toTeam.players : []).filter((row) => !sameTradePlayer(row, moved));
  toTeam.players.push(moved);

  return { ok: true, playerName };
}

function getTeamNamesForDraftPickMatch(leagueData) {
  return getAllTeamsFromLeague(leagueData)
    .map((team) => team?.name || team?.teamName)
    .filter(Boolean);
}

function pickIdentityMatches(normalizedRow = {}, targetPick = {}, fromTeamName = "") {
  const normalizedTarget = {
    ...targetPick,
    assetType: String(targetPick?.assetType || targetPick?.type || "pick").toLowerCase(),
    type: String(targetPick?.assetType || targetPick?.type || "pick").toLowerCase(),
  };

  const targetId = String(targetPick?.id || targetPick?.pickId || "");
  if (targetId && String(normalizedRow.id || "") === targetId) return true;

  const sameCore =
    String(normalizedRow.assetType || normalizedRow.type || "pick").toLowerCase() ===
      String(normalizedTarget.assetType || normalizedTarget.type || "pick").toLowerCase() &&
    Number(normalizedRow.year || 0) === Number(normalizedTarget.year || normalizedTarget.seasonYear || 0) &&
    Number(normalizedRow.round || 0) === Number(normalizedTarget.round || 0) &&
    sameTeamName(normalizedRow.originalTeam, normalizedTarget.originalTeam || normalizedTarget.originalTeamName);

  if (!sameCore) return false;

  const targetOwner = normalizedTarget.ownerTeam || normalizedTarget.owner || normalizedTarget.currentOwnerTeamName || fromTeamName;
  return sameTeamName(normalizedRow.ownerTeam, targetOwner) || sameTeamName(normalizedRow.ownerTeam, fromTeamName);
}


function transferResolvedDraftPick(nextLeague, fromTeamName, toTeamName, pickItem) {
  const pick = pickItem?.pick || {};
  const seasonYear = Number(pick.year || pick.seasonYear || getCurrentSeasonYear(nextLeague));
  const phaseInfo = readTradePhaseInfo(nextLeague);

  if (phaseInfo.draftComplete) {
    return { ok: false, reason: `${formatPick(pick)} cannot be traded because the draft is already complete.` };
  }

  if (isResolvedPickAlreadyDrafted(pick, seasonYear)) {
    return { ok: false, reason: `${formatPick(pick)} has already been used in the draft and cannot be traded as a pick.` };
  }

  const tradeStamp = {
    fromTeam: fromTeamName,
    toTeam: toTeamName,
    protection: "Resolved",
    seasonYear,
    completedAt: new Date().toISOString(),
    assetType: "resolved",
    pickNumber: getPickNumberFromAny(pick),
  };

  let found = false;
  let ownedByFrom = false;
  let pickLabel = formatPick(pick);

  const applyToRows = (rows) => {
    const result = updateDraftOrderOwner(rows, pick, fromTeamName, toTeamName, nextLeague, tradeStamp);
    found = found || result.found;
    ownedByFrom = ownedByFrom || result.ownedByFrom;
    pickLabel = result.label || pickLabel;
    return result.rows;
  };

  if (!nextLeague.draftState || typeof nextLeague.draftState !== "object") {
    nextLeague.draftState = { seasonYear };
  }

  if (Array.isArray(nextLeague.draftState.draftOrder) && nextLeague.draftState.draftOrder.length) {
    nextLeague.draftState.draftOrder = applyToRows(nextLeague.draftState.draftOrder);
  }

  if (Array.isArray(nextLeague.draftState?.lottery?.fullDraftOrder) && nextLeague.draftState.lottery.fullDraftOrder.length) {
    nextLeague.draftState.lottery = {
      ...nextLeague.draftState.lottery,
      fullDraftOrder: applyToRows(nextLeague.draftState.lottery.fullDraftOrder),
    };
  }

  const savedLottery = readSavedDraftLottery(seasonYear);
  if (savedLottery?.result?.fullDraftOrder?.length) {
    const nextFullDraftOrder = applyToRows(savedLottery.result.fullDraftOrder);
    const nextLottery = {
      ...savedLottery,
      result: {
        ...savedLottery.result,
        fullDraftOrder: nextFullDraftOrder,
        firstRoundOrder: Array.isArray(savedLottery.result.firstRoundOrder)
          ? applyToRows(savedLottery.result.firstRoundOrder)
          : savedLottery.result.firstRoundOrder,
        secondRoundOrder: Array.isArray(savedLottery.result.secondRoundOrder)
          ? applyToRows(savedLottery.result.secondRoundOrder)
          : savedLottery.result.secondRoundOrder,
      },
    };
    writeSavedDraftLottery(nextLottery);

    if (!Array.isArray(nextLeague.draftState.draftOrder) || !nextLeague.draftState.draftOrder.length) {
      nextLeague.draftState.draftOrder = nextFullDraftOrder;
    }
    nextLeague.draftState.lottery = {
      ...(nextLeague.draftState.lottery || {}),
      ...(nextLottery.result || {}),
      fullDraftOrder: nextFullDraftOrder,
    };
  }

  const savedDraftState = readSavedDraftState(seasonYear);
  if (savedDraftState?.draftOrder?.length) {
    const nextDraftState = {
      ...savedDraftState,
      draftOrder: applyToRows(savedDraftState.draftOrder),
    };
    writeSavedDraftState(nextDraftState);
  }

  if (!found) {
    return { ok: false, reason: `Could not find ${formatPick(pick)} in the locked draft order.` };
  }

  if (!ownedByFrom) {
    return { ok: false, reason: `${fromTeamName} no longer owns ${formatPick(pick)}.` };
  }

  return { ok: true, pickLabel };
}

function transferDraftPick(nextLeague, fromTeamName, toTeamName, pickItem) {
  const rows = Array.isArray(nextLeague?.draftPicks) ? nextLeague.draftPicks : [];
  const pick = pickItem?.pick || {};
  const type = String(pick?.assetType || pick?.type || "pick").toLowerCase();

  if (type === "resolved") {
    return transferResolvedDraftPick(nextLeague, fromTeamName, toTeamName, pickItem);
  }

  const teamNames = getTeamNamesForDraftPickMatch(nextLeague);
  const index = rows.findIndex((row, rowIndex) => {
    const normalized = normalizeDraftPickAsset(row, rowIndex, teamNames);
    return pickIdentityMatches(normalized, pick, fromTeamName);
  });

  if (index < 0) {
    return { ok: false, reason: `Could not find ${formatPick(pick)} in leagueData.draftPicks.` };
  }

  const normalized = normalizeDraftPickAsset(rows[index], index, teamNames);
  if (!sameTeamName(normalized.ownerTeam, fromTeamName)) {
    return {
      ok: false,
      reason: `${fromTeamName} no longer owns ${formatPick(normalized)}. Current owner is ${normalized.ownerTeam}.`,
    };
  }

  const toTeam = findTeamInLeague(nextLeague, toTeamName);
  const ownerLogo = teamLogoOf(toTeam);
  const protection = pickItem?.protection || pick?.protection || pick?.protections || normalized.protections || "Unprotected";
  const tradeStamp = {
    fromTeam: fromTeamName,
    toTeam: toTeamName,
    protection,
    seasonYear: getCurrentSeasonYear(nextLeague),
    completedAt: new Date().toISOString(),
  };

  rows[index] = {
    ...rows[index],
    ownerTeam: toTeamName,
    owner: toTeamName,
    currentOwner: toTeamName,
    currentOwnerTeamName: toTeamName,
    ownerTeamName: toTeamName,
    teamName: toTeamName,
    ownerLogo: ownerLogo || rows[index]?.ownerLogo || "",
    currentOwnerTeamLogo: ownerLogo || rows[index]?.currentOwnerTeamLogo || "",
    logo: ownerLogo || rows[index]?.logo || "",
    protection,
    protections: protection,
    displayProtection: protection,
    status: rows[index]?.status || "active",
    lastTrade: tradeStamp,
    tradeHistory: Array.isArray(rows[index]?.tradeHistory)
      ? [...rows[index].tradeHistory, tradeStamp]
      : [tradeStamp],
  };

  return { ok: true, pickLabel: formatPick({ ...normalized, protection }) };
}

function summarizeTradeItems(items = []) {
  const players = items
    .filter((item) => item?.type === "player")
    .map((item) => playerNameOf(item.player));
  const picks = items
    .filter((item) => item?.type === "pick")
    .map((item) => `${formatPick(item.pick)} (${item.protection || item.pick?.protection || "Unprotected"})`);
  return { players, picks };
}

function refreshTeamFinancialSnapshot(team, leagueData) {
  if (!team) return;
  const cap = getTeamCapInfo(team, leagueData, 0, 0);
  team.payroll = cap.payroll;
  team.totalSalary = cap.payroll;
  team.capRoom = cap.capRoom;
  team.hardCapRoom = cap.hardCapRoom;
  team.financials = {
    ...(team.financials && typeof team.financials === "object" ? team.financials : {}),
    payroll: cap.payroll,
    totalSalary: cap.payroll,
    capRoom: cap.capRoom,
    hardCapRoom: cap.hardCapRoom,
    salaryCap: cap.salaryCap,
    hardCap: cap.hardCap,
  };
}

function getUnsupportedRosterTradePlayer(items = []) {
  return (items || []).find((item) => {
    if (item?.type !== "player" || !item.player) return false;
    const player = item.player || {};
    const status = String(player.rosterStatus || player.contractType || "").toLowerCase();
    return Boolean(
      player.isTwoWay ||
        player.isStash ||
        status.includes("two_way") ||
        status.includes("two-way") ||
        status.includes("stash") ||
        status.includes("stashed")
    );
  }) || null;
}

function getProjectedStandardRosterCount(team, outgoingItems = [], incomingItems = []) {
  const current = getStandardRosterCount(team);
  const outgoingPlayers = countTradePlayers(outgoingItems);
  const incomingPlayers = countTradePlayers(incomingItems);
  const projected = current - outgoingPlayers + incomingPlayers;

  return {
    current,
    outgoingPlayers,
    incomingPlayers,
    projected,
  };
}

function validateProjectedStandardRosterCount(team, outgoingItems = [], incomingItems = []) {
  const teamName = team?.name || team?.teamName || "This team";
  const counts = getProjectedStandardRosterCount(team, outgoingItems, incomingItems);

  if (counts.projected < REGULAR_SEASON_MIN_STANDARD_PLAYERS) {
    return {
      ok: false,
      reason: `Trade blocked: ${teamName} would have ${counts.projected} standard players after this trade. Minimum is ${REGULAR_SEASON_MIN_STANDARD_PLAYERS}.`,
      counts,
    };
  }

  if (counts.projected > REGULAR_SEASON_MAX_STANDARD_PLAYERS) {
    return {
      ok: false,
      reason: `Trade blocked: ${teamName} would have ${counts.projected} standard players after this trade. Maximum is ${REGULAR_SEASON_MAX_STANDARD_PLAYERS}.`,
      counts,
    };
  }

  return { ok: true, counts };
}

function validateRosterLimitsForTrade({ leagueData, userTeam, cpuTeam, userItems, cpuItems }) {
  const unsupportedUserPlayer = getUnsupportedRosterTradePlayer(userItems);
  if (unsupportedUserPlayer) {
    return {
      ok: false,
      reason: `${playerNameOf(unsupportedUserPlayer.player)} is not on the standard roster. Trade execution currently supports standard roster players only.`,
    };
  }

  const unsupportedCpuPlayer = getUnsupportedRosterTradePlayer(cpuItems);
  if (unsupportedCpuPlayer) {
    return {
      ok: false,
      reason: `${playerNameOf(unsupportedCpuPlayer.player)} is not on the standard roster. Trade execution currently supports standard roster players only.`,
    };
  }

  const phaseInfo = readTradePhaseInfo(leagueData);
  if (!phaseInfo.enforceRegularSeasonRosterLimits) {
    return {
      ok: true,
      offseasonRosterFlex: true,
      userRoster: getProjectedStandardRosterCount(userTeam, userItems, cpuItems),
      cpuRoster: getProjectedStandardRosterCount(cpuTeam, cpuItems, userItems),
    };
  }

  const userRoster = validateProjectedStandardRosterCount(userTeam, userItems, cpuItems);
  if (!userRoster.ok) return userRoster;

  const cpuRoster = validateProjectedStandardRosterCount(cpuTeam, cpuItems, userItems);
  if (!cpuRoster.ok) return cpuRoster;

  return {
    ok: true,
    userRoster: userRoster.counts,
    cpuRoster: cpuRoster.counts,
  };
}

function validateTradeForExecution({ leagueData, userTeam, cpuTeam, userItems, cpuItems, evaluation }) {
  if (!hasAcceptedEvaluation(evaluation)) {
    return { ok: false, reason: "CPU must accept the proposal before it can be submitted." };
  }

  if (!userTeam || !cpuTeam) {
    return { ok: false, reason: "Both teams must still exist in the league save." };
  }

  if (!userItems.length || !cpuItems.length) {
    return { ok: false, reason: "Add at least one asset from each side before submitting." };
  }

  const userCap = getTeamCapInfo(userTeam, leagueData, sideSalary(userItems, leagueData), sideSalary(cpuItems, leagueData));
  const cpuCap = getTeamCapInfo(cpuTeam, leagueData, sideSalary(cpuItems, leagueData), sideSalary(userItems, leagueData));

  if (Number(userCap.hardCapRoom || 0) < 0) {
    return { ok: false, reason: `${userTeam.name} would be over the hard cap after this trade.` };
  }

  if (Number(cpuCap.hardCapRoom || 0) < 0) {
    return { ok: false, reason: `${cpuTeam.name} would be over the hard cap after this trade.` };
  }

  const rosterValidation = validateRosterLimitsForTrade({ leagueData, userTeam, cpuTeam, userItems, cpuItems });
  if (!rosterValidation.ok) return rosterValidation;

  return { ok: true };
}


function clearSavedGameplanForTeam(teamName = "") {
  if (!teamName) return;
  try {
    localStorage.removeItem(`gameplan_${teamName}`);
  } catch {}
}

function executeAcceptedTradeOnLeague({ leagueData, userTeamName, cpuTeamName, userItems, cpuItems, evaluation }) {
  const userTeam = findTeamInLeague(leagueData, userTeamName);
  const cpuTeam = findTeamInLeague(leagueData, cpuTeamName);
  const validation = validateTradeForExecution({ leagueData, userTeam, cpuTeam, userItems, cpuItems, evaluation });
  if (!validation.ok) return validation;

  const nextLeague = cloneLeagueForTrade(leagueData);
  const movedPlayers = [];
  const movedPicks = [];

  const playerMoves = [
    ...userItems.filter((item) => item?.type === "player").map((item) => ({ item, from: userTeamName, to: cpuTeamName })),
    ...cpuItems.filter((item) => item?.type === "player").map((item) => ({ item, from: cpuTeamName, to: userTeamName })),
  ];

  for (const move of playerMoves) {
    const result = transferStandardPlayer(nextLeague, move.from, move.to, move.item);
    if (!result.ok) return result;
    movedPlayers.push({ name: result.playerName, fromTeam: move.from, toTeam: move.to });
  }

  const pickMoves = [
    ...userItems.filter((item) => item?.type === "pick").map((item) => ({ item, from: userTeamName, to: cpuTeamName })),
    ...cpuItems.filter((item) => item?.type === "pick").map((item) => ({ item, from: cpuTeamName, to: userTeamName })),
  ];

  for (const move of pickMoves) {
    const result = transferDraftPick(nextLeague, move.from, move.to, move.item);
    if (!result.ok) return result;
    movedPicks.push({ label: result.pickLabel, fromTeam: move.from, toTeam: move.to });
  }

  const nextUserTeam = findTeamInLeague(nextLeague, userTeamName);
  const nextCpuTeam = findTeamInLeague(nextLeague, cpuTeamName);
  refreshTeamFinancialSnapshot(nextUserTeam, nextLeague);
  refreshTeamFinancialSnapshot(nextCpuTeam, nextLeague);

  const tradeRecord = {
    id: `trade_${Date.now()}`,
    completedAt: new Date().toISOString(),
    seasonYear: getCurrentSeasonYear(nextLeague),
    userTeamName,
    cpuTeamName,
    userSent: summarizeTradeItems(userItems),
    cpuSent: summarizeTradeItems(cpuItems),
    movedPlayers,
    movedPicks,
    cpuDecision: evaluation?.decision || "accept",
    cpuScore: Number(evaluation?.score || 0),
  };

  nextLeague.tradeHistory = [...(Array.isArray(nextLeague.tradeHistory) ? nextLeague.tradeHistory : []), tradeRecord];
  nextLeague.lastTrade = tradeRecord;

  clearSavedGameplanForTeam(userTeamName);
  clearSavedGameplanForTeam(cpuTeamName);

  return { ok: true, leagueData: nextLeague, tradeRecord };
}

function decisionTone(decision) {
  if (decision === "accept") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
  if (decision === "counter") return "border-amber-400/30 bg-amber-500/10 text-amber-100";
  return "border-red-400/30 bg-red-500/10 text-red-100";
}

function RatingRing({ overall, potential, size = 88, style = {}, textTuning = {} }) {
  const safeOverall = Number(overall || 0);
  const fillPercent = Math.min(Math.max(safeOverall, 0) / 99, 1);
  const radius = 34;
  const strokeWidth = 7;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference * (1 - fillPercent);
  const ovrLabel = textTuning.ovrLabel || {};
  const ovrNumber = textTuning.ovrNumber || {};
  const potLine = textTuning.potLine || {};

  return (
    <div className="relative flex shrink-0 items-center justify-center" style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size} viewBox="0 0 88 88">
        <defs>
          <linearGradient id="tradeOvrGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#FFA500" />
            <stop offset="100%" stopColor="#FFD54F" />
          </linearGradient>
        </defs>
        <circle
          cx="44"
          cy="44"
          r={radius}
          stroke="rgba(255,255,255,0.10)"
          strokeWidth={strokeWidth}
          fill="rgba(0,0,0,0.22)"
        />
        <circle
          cx="44"
          cy="44"
          r={radius}
          stroke="url(#tradeOvrGradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeOffset}
          transform="rotate(-90 44 44)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        <div
          className="font-black uppercase tracking-wide text-neutral-300"
          style={{
            fontSize: ovrLabel.size ?? 8,
            transform: `translate(${ovrLabel.x || 0}px, ${ovrLabel.y || 0}px)`,
          }}
        >
          OVR
        </div>
        <div
          className="mt-0.5 font-black text-orange-400"
          style={{
            fontSize: ovrNumber.size ?? 25,
            transform: `translate(${ovrNumber.x || 0}px, ${ovrNumber.y || 0}px)`,
          }}
        >
          {overall ?? "-"}
        </div>
        <div
          className="mt-0.5 font-black uppercase text-neutral-400"
          style={{
            fontSize: potLine.size ?? 7,
            transform: `translate(${potLine.x || 0}px, ${potLine.y || 0}px)`,
          }}
        >
          POT <span className="text-orange-300">{potential ?? "-"}</span>
        </div>
      </div>
    </div>
  );
}

function getTradeItemLogoTuningForTeam(team) {
  const teamName = team?.name || team?.teamName || "";
  let override = null;

  if (sameTeamName(teamName, "New Orleans Pelicans")) {
    override = TRADE_ITEM_BACKGROUND_LOGO_TEAM_OVERRIDES.pelicans;
  }

  if (sameTeamName(teamName, "Portland Trail Blazers")) {
    override = TRADE_ITEM_BACKGROUND_LOGO_TEAM_OVERRIDES.trailBlazers;
  }

  return {
    ...TRADE_ITEM_BACKGROUND_LOGO_TUNING,
    ...(override || {}),
  };
}

function TeamLogoWatermark({ team }) {
  const logo = teamLogoOf(team);
  const t = getTradeItemLogoTuningForTeam(team);

  if (!t.enabled || !logo) return null;

  return (
    <img
      src={logo}
      alt=""
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-1/2 z-0 object-contain select-none"
      style={{
        width: t.size,
        height: t.size,
        opacity: t.opacity,
        mixBlendMode: t.blendMode || "normal",
        filter: `brightness(${t.brightness || 1}) contrast(${t.contrast || 1}) saturate(${t.saturate || 1}) blur(${t.blur || 0}px)`,
        transform: `translate(-50%, -50%) translate(${t.x || 0}px, ${t.y || 0}px) rotate(${t.rotate || 0}deg)`,
      }}
    />
  );
}

function TradeItemCard({ item, team, leagueData, onRemove }) {
  if (!item) return null;

  if (item.type === "player") {
    const player = item.player || {};
    const yearsRemaining = getContractYearsRemaining(player, leagueData);
    const t = TRADE_PLAYER_CARD_TUNING;

    return (
      <div
        className="relative isolate overflow-hidden rounded-2xl border border-white/15 bg-black pr-10"
        style={{ height: t.cardHeight }}
      >
        <TeamLogoWatermark team={team} />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          className="absolute right-2 top-2 z-20 rounded-full bg-black/70 px-2 py-0.5 text-xs font-black text-neutral-300 hover:bg-red-600 hover:text-white"
        >
          ✕
        </button>

        <div className="relative z-10 flex h-full items-center gap-4">
          <div
            className="relative flex h-full shrink-0 items-end justify-center overflow-hidden rounded-l-2xl"
            style={{ width: t.face.boxWidth }}
          >
            {player?.headshot ? (
              <img
                src={player.headshot}
                alt={playerNameOf(player)}
                className="w-auto object-contain"
                style={{
                  height: t.face.imageHeight,
                  transform: `translate(${t.face.x}px, ${t.face.y}px)`,
                }}
              />
            ) : (
              <div className="h-full w-full" />
            )}
          </div>

          <RatingRing
            overall={player.overall}
            potential={player.potential}
            size={t.ring.size}
            style={{ transform: `translate(${t.ring.x}px, ${t.ring.y}px)` }}
            textTuning={t.ringText}
          />

          <div
            className="min-w-0 flex-1"
            style={{ transform: `translate(${t.textBlock.x}px, ${t.textBlock.y}px)` }}
          >
            <div
              className="truncate font-black leading-tight text-white"
              style={{
                fontSize: t.name.size,
                transform: `translate(${t.name.x}px, ${t.name.y}px)`,
              }}
            >
              {playerNameOf(player)}
            </div>
            <div
              className="mt-1 font-black uppercase tracking-[0.18em] text-white"
              style={{
                fontSize: t.positionAge.size,
                transform: `translate(${t.positionAge.x}px, ${t.positionAge.y}px)`,
              }}
            >
              {player.pos || "-"}{player.secondaryPos ? ` / ${player.secondaryPos}` : ""}
              <span className="mx-2 text-white">•</span>
              Age {player.age ?? "-"}
            </div>
            <div
              className="mt-1 font-black uppercase tracking-[0.12em] text-white"
              style={{
                fontSize: t.contract.size,
                transform: `translate(${t.contract.x}px, ${t.contract.y}px)`,
              }}
            >
              Contract: <span className="text-white">{formatMoney(getPlayerSalary(player, leagueData))}</span>
              <span className="mx-2 text-white">•</span>
              <span className="text-white">
                {yearsRemaining || "—"} YR{yearsRemaining === 1 ? "" : "S"}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const pickProtection = item.protection || item.pick?.protection || "Unprotected";
  const pickLabel = formatPick(item.pick);
  const pickOriginalTeam = getPickOriginalTeamLogoTeam(leagueData, item.pick, team);

  return (
    <div className="relative isolate h-full overflow-hidden rounded-2xl border border-white/15 bg-black p-4">
      <TeamLogoWatermark team={pickOriginalTeam} />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove?.();
        }}
        className="absolute right-2 top-2 z-20 rounded-full bg-black/60 px-2 py-0.5 text-xs font-black text-neutral-300 hover:bg-red-600 hover:text-white"
      >
        ✕
      </button>
      <div className="relative z-10 text-xs font-black uppercase tracking-[0.18em] text-orange-300">Draft Pick</div>
      <div className="relative z-10 mt-2 pr-8 text-lg font-black text-white">
        {pickProtection} {pickLabel}
      </div>
    </div>
  );
}

function EmptySlot({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-[126px] w-full rounded-2xl border border-white/15 bg-black p-6 text-left transition hover:border-orange-400/45"
    >
      <div className="text-xl font-black text-white">{label}</div>
      <div className="mt-2 text-sm font-semibold text-neutral-500">Player or Pick</div>
    </button>
  );
}

function AddAssetButton({ onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-[126px] w-full rounded-2xl border border-white/15 bg-black p-6 text-left transition hover:border-orange-400/45 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <div className="text-xl font-black text-white">Add Trade Item</div>
      <div className="mt-2 text-sm font-semibold text-neutral-500">Player or Pick</div>
    </button>
  );
}


function countTradePlayers(items = []) {
  return (items || []).filter((item) => item?.type === "player" && item.player).length;
}

function getStandardRosterCount(team) {
  return Array.isArray(team?.players) ? team.players.length : 0;
}

function TradeFinancialRow({ label, value, tuning }) {
  const labelT = tuning?.label || {};
  const valueT = tuning?.value || {};

  return (
    <div
      className="grid grid-cols-[1fr_auto] items-center gap-5"
      style={{ paddingTop: tuning?.rows?.gap ?? 2, paddingBottom: tuning?.rows?.gap ?? 2 }}
    >
      <div
        className="font-black uppercase text-white"
        style={{
          fontSize: labelT.size ?? 14,
          letterSpacing: labelT.letterSpacing ?? "0.08em",
          transform: `translate(${labelT.x || 0}px, ${labelT.y || 0}px)`,
        }}
      >
        {label}
      </div>
      <div
        className="text-right font-black text-white"
        style={{
          fontSize: valueT.size ?? 14,
          transform: `translate(${valueT.x || 0}px, ${valueT.y || 0}px)`,
        }}
      >
        {value}
      </div>
    </div>
  );
}


function buildHardCapIssueDetails({ team, cap, outgoingSalary = 0, incomingSalary = 0, netSalary = 0, playerCount = 0 }) {
  const teamName = team?.name || team?.teamName || "This team";
  const overBy = Math.max(0, Math.abs(Number(cap?.hardCapRoom || 0)));
  const hardCap = Number(cap?.hardCap || 0);
  const projectedPayroll = Number(cap?.payroll || 0);
  const basePayroll = Number(cap?.basePayroll || 0);

  return {
    title: `${teamName} Hard Cap Issue`,
    message: `${teamName} cannot complete this trade because the projected payroll would be ${formatMoney(overBy)} above the hard cap.`,
    rows: [
      { label: "Current payroll", value: formatMoney(basePayroll) },
      { label: "Outgoing salary", value: formatMoney(outgoingSalary) },
      { label: "Incoming salary", value: formatMoney(incomingSalary) },
      { label: "Net salary change", value: formatMoney(netSalary) },
      { label: "Projected payroll", value: formatMoney(projectedPayroll) },
      { label: "Hard cap", value: hardCap > 0 ? formatMoney(hardCap) : "Not found" },
      { label: "Over hard cap by", value: formatMoney(overBy) },
      { label: "Projected players", value: playerCount },
    ],
  };
}

function TradeFinancialFooter({ team, cap, netSalary, playerCount, hardCapDetails = null, onHardCapDetails = null }) {
  const isHardCapOk = Number(cap?.hardCapRoom || 0) >= 0;
  const t = TRADE_FINANCIAL_FOOTER_TUNING;

  return (
    <div
      className="border-t border-white/20 bg-black"
      style={{
        paddingLeft: t.footer.paddingX,
        paddingRight: t.footer.paddingX,
        paddingTop: t.footer.paddingY,
        paddingBottom: t.footer.paddingY,
        transform: `translate(${t.footer.x || 0}px, ${t.footer.y || 0}px)`,
      }}
    >
      <div
        className="grid items-center"
        style={{
          gridTemplateColumns: `${t.footer.logoColumnWidth}px 1fr`,
          columnGap: t.footer.gap,
        }}
      >
        <div className="flex items-center justify-center">
          {teamLogoOf(team) ? (
            <img
              src={teamLogoOf(team)}
              alt={team?.name || "Team"}
              className="object-contain"
              style={{
                width: t.logo.size,
                height: t.logo.size,
                transform: `translate(${t.logo.x || 0}px, ${t.logo.y || 0}px)`,
              }}
            />
          ) : (
            <div
              className="border border-white/15 bg-black"
              style={{
                width: t.logo.size,
                height: t.logo.size,
                transform: `translate(${t.logo.x || 0}px, ${t.logo.y || 0}px)`,
              }}
            />
          )}
        </div>

        <div
          className="min-w-0"
          style={{
            width: t.rowsBlock.width,
            transform: `translate(${t.rowsBlock.x || 0}px, ${t.rowsBlock.y || 0}px)`,
          }}
        >
          <div>
            <TradeFinancialRow label="Salary Cap Room" value={formatMoney(cap.capRoom)} tuning={t} />
            <TradeFinancialRow label="Hard Cap Room" value={formatMoney(cap.hardCapRoom)} tuning={t} />
            <TradeFinancialRow label="Net Salary" value={formatMoney(netSalary)} tuning={t} />
            <TradeFinancialRow label="Players" value={playerCount} tuning={t} />
          </div>

          <div
            className={`flex items-center justify-center font-black tracking-wide ${
              isHardCapOk ? "bg-emerald-500 text-white" : "bg-red-600 text-white"
            }`}
            style={{
              height: t.statusBar.height,
              marginTop: t.statusBar.marginTop,
              width: t.statusBar.width,
              fontSize: t.statusBar.fontSize,
              transform: `translate(${t.statusBar.x || 0}px, ${t.statusBar.y || 0}px)`,
            }}
          >
            <span
              className="inline-flex items-center justify-center gap-2"
              style={{ transform: `translate(${t.statusBar.textX || 0}px, ${t.statusBar.textY || 0}px)` }}
            >
              {isHardCapOk ? (
                "Valid Trade"
              ) : (
                <>
                  Hard Cap Issue
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onHardCapDetails?.(hardCapDetails);
                    }}
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/80 bg-transparent text-[10px] font-black leading-none text-white transition hover:bg-white hover:text-red-700"
                    title="Why is this a hard cap issue?"
                    aria-label="View hard cap issue details"
                  >
                    ?
                  </button>
                </>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SidePanel({ side, team, items, leagueData, incomingSalary = 0, incomingItems = [], onAdd, onRemove, onHardCapDetails }) {
  const salaryTotal = sideSalary(items, leagueData);
  const cap = getTeamCapInfo(team, leagueData, salaryTotal, incomingSalary);
  const hasItems = Array.isArray(items) && items.length > 0;
  const canAddMore = (items || []).length < MAX_SIDE_ITEMS;
  const netSalary = Number(incomingSalary || 0) - Number(salaryTotal || 0);
  const playerCount = Math.max(
    0,
    getStandardRosterCount(team) - countTradePlayers(items) + countTradePlayers(incomingItems)
  );
  const hardCapDetails = buildHardCapIssueDetails({
    team,
    cap,
    outgoingSalary: salaryTotal,
    incomingSalary,
    netSalary,
    playerCount,
  });

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/15 bg-black">
      <div className="border-b border-white/20 bg-black px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {teamLogoOf(team) ? (
              <img src={teamLogoOf(team)} alt={team?.name} className="h-12 w-12 shrink-0 object-contain" />
            ) : (
              <div className="h-12 w-12 rounded-xl bg-white/5" />
            )}
            <div className="min-w-0">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">
                {side === "user" ? "Your Team" : "CPU Team"}
              </div>
              <div className="truncate text-xl font-black text-white">{team?.name || "Select Team"}</div>
            </div>
          </div>
          <div className="rounded-xl border border-orange-400/25 bg-black px-3 py-2 text-right">
            <div className="text-[10px] font-black uppercase text-orange-200">Incoming</div>
            <div className="text-sm font-black text-white">{formatMoney(incomingSalary)}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-4">
        {hasItems ? (
          items.map((item, index) => (
            <div key={`${side}-${itemKey(item)}-${index}`} className="w-full" style={{ height: TRADE_PLAYER_CARD_TUNING.cardHeight }}>
              <TradeItemCard
                item={item}
                team={team}
                leagueData={leagueData}
                onRemove={() => onRemove(side, index)}
              />
            </div>
          ))
        ) : (
          <div className="w-full" style={{ height: TRADE_PLAYER_CARD_TUNING.cardHeight }}>
            <EmptySlot label="Add Trade Item" onClick={() => onAdd(side, 0)} />
          </div>
        )}

        {hasItems && canAddMore && (
          <AddAssetButton onClick={() => onAdd(side, items.length)} />
        )}

        {hasItems && !canAddMore && (
          <div className="rounded-2xl border border-white/15 bg-black px-5 py-4 text-xs font-bold text-neutral-500">
            Maximum trade assets added for this side.
          </div>
        )}
      </div>

      <TradeFinancialFooter
        team={team}
        cap={cap}
        netSalary={netSalary}
        playerCount={playerCount}
        hardCapDetails={hardCapDetails}
        onHardCapDetails={onHardCapDetails}
      />
    </div>
  );
}

export default function ProposeTrade() {
  const navigate = useNavigate();
  const location = useLocation();
  const { leagueData, selectedTeam, setLeagueData } = useGame();
  const teams = useMemo(() => getAllTeamsFromLeague(leagueData), [leagueData]);
  const userTeamName = selectedTeam?.name || "";
  const firstCpu = teams.find((t) => t?.name && t.name !== userTeamName)?.name || "";

  const [builder, setBuilder] = useState(() => {
    const saved = safeReadBuilder();
    return saved || makeEmptyBuilder(userTeamName, firstCpu);
  });
  const [slotMenu, setSlotMenu] = useState(null);
  const [notice, setNotice] = useState("");
  const [evaluation, setEvaluation] = useState(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deadlineStatus, setDeadlineStatus] = useState(() => readTradeDeadlineStatus());
  const [hardCapDetailModal, setHardCapDetailModal] = useState(null);

  useEffect(() => {
    const syncDeadlineStatus = () => setDeadlineStatus(readTradeDeadlineStatus());
    syncDeadlineStatus();

    window.addEventListener("storage", syncDeadlineStatus);
    const intervalId = window.setInterval(syncDeadlineStatus, 1500);

    return () => {
      window.removeEventListener("storage", syncDeadlineStatus);
      window.clearInterval(intervalId);
    };
  }, []);

  const tradeDeadlineLocked = isTradeDeadlineLocked(deadlineStatus);
  const tradeDeadlineMessage = tradeDeadlineLocked
    ? "The trade deadline has passed. New trade offers are locked until the offseason."
    : "";

  const cpuTeamName = builder.cpuTeamName || firstCpu;
  const userTeam = teams.find((t) => t?.name === userTeamName) || selectedTeam;
  const cpuTeam = teams.find((t) => t?.name === cpuTeamName) || teams.find((t) => t?.name !== userTeamName) || null;
  const userItems = builder.userItems || [];
  const cpuItems = builder.cpuItems || [];
  const cameFromTradeFinder = Boolean(
    builder?.returnToTradeFinder ||
      builder?.source === "tradeFinder" ||
      location?.state?.fromTradeFinder
  );
  const topBackLabel = cameFromTradeFinder ? "← Trade Finder Results" : "← Trade Center";
  const topBackPath = cameFromTradeFinder ? "/trade-finder" : "/trades";

  useEffect(() => {
    if (!userTeamName) return;

    setBuilder((prev) => {
      const next = {
        ...(prev || makeEmptyBuilder(userTeamName, firstCpu)),
        userTeamName,
        cpuTeamName: prev?.cpuTeamName && prev.cpuTeamName !== userTeamName ? prev.cpuTeamName : firstCpu,
      };
      saveBuilder(next);
      return next;
    });
  }, [userTeamName, firstCpu]);

  useEffect(() => {
    saveBuilder(builder);
  }, [builder]);

  const updateBuilder = (updater) => {
    setEvaluation(null);
    setBuilder((prev) => {
      const next = updater(prev || makeEmptyBuilder(userTeamName, firstCpu));
      saveBuilder(next);
      return next;
    });
  };

  const handleCpuTeamChange = (name) => {
    if (tradeDeadlineLocked) {
      setNotice(tradeDeadlineMessage);
      return;
    }

    updateBuilder((prev) => ({
      ...prev,
      cpuTeamName: name,
      cpuItems: prev.cpuTeamName === name ? prev.cpuItems : [],
      updatedAt: Date.now(),
    }));
  };

  const removeItem = (side, index) => {
    updateBuilder((prev) => {
      const items = [...getSideItems(prev, side)];
      items.splice(index, 1);
      return setSideItems(prev, side, items);
    });
  };

  const openAddMenu = (side, slotIndex) => {
    if (tradeDeadlineLocked) {
      setNotice(tradeDeadlineMessage);
      return;
    }

    setSlotMenu({ side, slotIndex });
  };

  const goSelectPlayer = () => {
    if (tradeDeadlineLocked) {
      setSlotMenu(null);
      setNotice(tradeDeadlineMessage);
      return;
    }

    if (!slotMenu) return;
    const teamName = slotMenu.side === "user" ? userTeamName : cpuTeamName;
    saveBuilder(builder);
    navigate("/trade-player-select", {
      state: {
        tradeSide: slotMenu.side,
        tradeTeamName: teamName,
        returnTo: "/propose-trade",
      },
    });
  };

  const goSelectPick = () => {
    if (tradeDeadlineLocked) {
      setSlotMenu(null);
      setNotice(tradeDeadlineMessage);
      return;
    }

    if (!slotMenu) return;
    const teamName = slotMenu.side === "user" ? userTeamName : cpuTeamName;
    saveBuilder(builder);
    navigate("/trade-pick-select", {
      state: {
        tradeSide: slotMenu.side,
        tradeTeamName: teamName,
        returnTo: "/propose-trade",
      },
    });
  };

  const clearProposal = () => {
    const next = makeEmptyBuilder(userTeamName, firstCpu);
    setBuilder(next);
    saveBuilder(next);
    setEvaluation(null);
    setNotice("Proposal cleared.");
  };

  const evaluateWithCpu = async () => {
    if (tradeDeadlineLocked) {
      setEvaluation(null);
      setNotice(tradeDeadlineMessage);
      return;
    }

    const hasBothSides = userItems.length > 0 && cpuItems.length > 0;

    if (!hasBothSides) {
      setEvaluation(null);
      setNotice("Add at least one item from each side before evaluation.");
      return;
    }

    const proposal = buildTradeProposalPayload({
      userTeamName,
      cpuTeamName,
      userTeam,
      cpuTeam,
      userItems,
      cpuItems,
      leagueData,
    });

    setIsEvaluating(true);
    setEvaluation(null);
    setNotice("CPU front office is reviewing the proposal...");

    try {
      const result = await evaluateTradeProposal(proposal);
      setEvaluation(result);
      setNotice(result?.message || "CPU negotiation complete.");
    } catch (error) {
      setEvaluation(null);
      setNotice(`CPU negotiation failed: ${error?.message || String(error || "Unknown error")}`);
    } finally {
      setIsEvaluating(false);
    }
  };


  const submitAcceptedTrade = () => {
    if (tradeDeadlineLocked) {
      setNotice(tradeDeadlineMessage);
      return;
    }

    if (isSubmitting) return;

    const result = executeAcceptedTradeOnLeague({
      leagueData,
      userTeamName,
      cpuTeamName,
      userItems,
      cpuItems,
      evaluation,
    });

    if (!result.ok) {
      setNotice(result.reason || "Trade could not be submitted.");
      return;
    }

    setIsSubmitting(true);

    try {
      setLeagueData(result.leagueData);
      saveLeagueData(result.leagueData).catch((err) => {
        console.warn("[ProposeTrade] IndexedDB league save failed", err);
      });
      try {
        window.__leagueData = result.leagueData;
        window.leagueData = result.leagueData;
        window.__basketballManagerLeagueData = result.leagueData;
      } catch {}

      const nextBuilder = makeEmptyBuilder(userTeamName, cpuTeamName || firstCpu);
      setBuilder(nextBuilder);
      saveBuilder(nextBuilder);
      setEvaluation(null);
      setNotice(`Trade completed: ${userTeamName} and ${cpuTeamName} have finalized the deal.`);
    } catch (error) {
      setNotice(`Trade save failed: ${error?.message || String(error || "Unknown error")}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!selectedTeam || !leagueData) {
    return (
      <PageFade>
        <div className="min-h-screen bmCourtPage text-white flex flex-col items-center justify-center px-4">
          <p className="mb-4 text-lg font-semibold">No league/team loaded.</p>
          <button onClick={() => navigate("/team-hub")} className="rounded-xl bg-orange-600 px-6 py-3 font-bold">
            Team Hub
          </button>
        </div>
      </PageFade>
    );
  }

  return (
    <PageFade>
      <div className="min-h-screen bmCourtPage text-white px-4 py-8">
        <div className="mx-auto w-full max-w-7xl">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <button
              onClick={() => navigate(topBackPath)}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-neutral-200 hover:bg-white/10 hover:text-white"
            >
              {topBackLabel}
            </button>

            <div className="text-center">
              <div className="text-xs font-black uppercase tracking-[0.24em] text-orange-300">
                Propose Trades
              </div>
              <h1 className="mt-1 text-4xl font-black text-orange-500">Trade Builder</h1>
            </div>

            <button
              onClick={clearProposal}
              className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-2 text-sm font-bold text-red-200 hover:bg-red-500/20"
            >
              Clear
            </button>
          </div>

          <div className="mb-5 grid gap-4 rounded-2xl border border-white/10 bg-black px-5 py-4 xl:grid-cols-[1fr_auto_1fr] xl:items-center">
            <div className="text-sm font-semibold text-neutral-300">
              Current Team: <span className="font-black text-white">{userTeamName}</span>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row xl:justify-center">
              <button
                onClick={evaluateWithCpu}
                disabled={isEvaluating || tradeDeadlineLocked}
                className="rounded-2xl bg-orange-600 px-8 py-3 text-sm font-black text-white transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isEvaluating ? "Evaluating..." : "Evaluate Trade"}
              </button>
              <button
                onClick={submitAcceptedTrade}
                disabled={isSubmitting || tradeDeadlineLocked}
                className="rounded-2xl border border-white/15 bg-black px-8 py-3 text-sm font-black text-neutral-200 transition hover:border-orange-400/35 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Submitting..." : "Submit Proposal"}
              </button>
            </div>

            <label className="flex items-center gap-3 text-sm font-bold text-neutral-300 xl:justify-end">
              CPU Team
              <select
                value={cpuTeamName}
                onChange={(e) => handleCpuTeamChange(e.target.value)}
                disabled={tradeDeadlineLocked}
                className="rounded-xl border border-white/10 bg-black px-3 py-2 font-black text-white outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                {teams
                  .filter((team) => team?.name && team.name !== userTeamName)
                  .map((team) => (
                    <option key={team.name} value={team.name}>
                      {team.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          {tradeDeadlineLocked && (
            <div className="mb-5 rounded-2xl border border-red-400/30 bg-red-500/10 px-5 py-4 text-sm font-black text-red-100">
              Trade deadline passed. New trade offers are locked until the offseason.
            </div>
          )}

          {(notice || evaluation) && (
            <div className="mb-5 grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
              {notice && (
                <div className="relative rounded-2xl border border-orange-400/25 bg-orange-500/10 p-3 pr-10 text-xs font-bold text-orange-100">
                  <button
                    type="button"
                    onClick={() => setNotice("")}
                    className="absolute right-2 top-2 rounded-full bg-black/35 px-2 py-0.5 text-[10px] font-black text-orange-100 transition hover:bg-red-600 hover:text-white"
                    title="Dismiss message"
                  >
                    ✕
                  </button>
                  {notice}
                </div>
              )}

              {evaluation && (
                <div className={`relative rounded-2xl border p-3 pr-10 text-left text-xs font-bold ${decisionTone(evaluation.decision)}`}>
                  <button
                    type="button"
                    onClick={() => setEvaluation(null)}
                    className="absolute right-2 top-2 rounded-full bg-black/35 px-2 py-0.5 text-[10px] font-black text-white/80 transition hover:bg-red-600 hover:text-white"
                    title="Dismiss CPU decision"
                  >
                    ✕
                  </button>
                  <div className="flex items-center justify-between gap-3 pr-8">
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] opacity-70">CPU Decision</span>
                    <span className="rounded-full bg-black/25 px-2 py-1 text-[10px] font-black uppercase">
                      Score {Number(evaluation.score || 0).toFixed(1)}
                    </span>
                  </div>
                  <div className="mt-2 text-lg font-black uppercase">
                    {evaluation.decision || "reject"}
                  </div>

                  {Array.isArray(evaluation.reasons) && evaluation.reasons.length > 0 && (
                    <div className="mt-3 space-y-1 opacity-90">
                      {evaluation.reasons.slice(0, 3).map((reason, index) => (
                        <div key={`reason-${index}`}>• {reason}</div>
                      ))}
                    </div>
                  )}

                  {Array.isArray(evaluation.counterSuggestions) && evaluation.counterSuggestions.length > 0 && (
                    <div className="mt-3 rounded-xl bg-black/25 p-2 text-[11px] opacity-95">
                      {evaluation.counterSuggestions[0]?.message || "CPU wants more value."}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-5 xl:grid-cols-2">
            <SidePanel
              side="user"
              team={userTeam}
              items={userItems}
              leagueData={leagueData}
              incomingSalary={sideSalary(cpuItems, leagueData)}
              incomingItems={cpuItems}
              onAdd={openAddMenu}
              onRemove={removeItem}
              onHardCapDetails={setHardCapDetailModal}
            />

            <SidePanel
              side="cpu"
              team={cpuTeam}
              items={cpuItems}
              leagueData={leagueData}
              incomingSalary={sideSalary(userItems, leagueData)}
              incomingItems={userItems}
              onAdd={openAddMenu}
              onRemove={removeItem}
              onHardCapDetails={setHardCapDetailModal}
            />
          </div>

        </div>

        {hardCapDetailModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setHardCapDetailModal(null);
            }}
          >
            <div className="w-full max-w-lg overflow-hidden rounded-[28px] border border-red-400/30 bg-neutral-950 shadow-2xl">
              <div className="border-b border-red-400/20 bg-gradient-to-r from-red-600/25 to-neutral-900 px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.2em] text-red-200">Hard Cap Details</div>
                    <div className="mt-1 text-2xl font-black text-white">
                      {hardCapDetailModal.title || "Hard Cap Issue"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setHardCapDetailModal(null)}
                    className="rounded-full bg-black/40 px-3 py-1 text-sm font-black text-white/80 transition hover:bg-red-600 hover:text-white"
                    title="Close"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="p-5">
                <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm font-bold leading-6 text-red-100">
                  {hardCapDetailModal.message || "This trade would put the team over the hard cap."}
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-black p-4">
                  {(hardCapDetailModal.rows || []).map((row, index) => (
                    <div
                      key={`${row.label}-${index}`}
                      className="grid grid-cols-[1fr_auto] gap-4 border-b border-white/10 py-2 text-sm last:border-b-0"
                    >
                      <div className="font-black uppercase tracking-[0.12em] text-neutral-400">{row.label}</div>
                      <div className="font-black text-white">{row.value}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 text-xs font-semibold leading-5 text-neutral-400">
                  Fix it by sending out more salary, taking back less salary, or choosing a different trade package.
                </div>
              </div>
            </div>
          </div>
        )}

        {slotMenu && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setSlotMenu(null);
            }}
          >
            <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950 shadow-2xl">
              <div className="border-b border-white/10 bg-gradient-to-r from-orange-600/20 to-neutral-900 px-6 py-5">
                <div className="text-xs font-black uppercase tracking-[0.2em] text-orange-300">Add Trade Item</div>
                <div className="mt-1 text-2xl font-black text-white">
                  {slotMenu.side === "user" ? userTeamName : cpuTeamName}
                </div>
              </div>
              <div className="grid gap-3 p-5">
                <button
                  onClick={goSelectPlayer}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-5 text-left transition hover:border-orange-400/40 hover:bg-orange-500/10"
                >
                  <div className="text-lg font-black text-white">Player</div>
                  <div className="mt-1 text-sm font-semibold text-neutral-500">Open trade player selector for this team.</div>
                </button>
                <button
                  onClick={goSelectPick}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-5 text-left transition hover:border-orange-400/40 hover:bg-orange-500/10"
                >
                  <div className="text-lg font-black text-white">Pick</div>
                  <div className="mt-1 text-sm font-semibold text-neutral-500">Open pick selector and attach protection.</div>
                </button>
                <button
                  onClick={() => setSlotMenu(null)}
                  className="rounded-2xl border border-white/10 bg-black px-5 py-3 text-sm font-black text-neutral-400 hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageFade>
  );
}
