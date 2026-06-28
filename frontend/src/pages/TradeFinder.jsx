import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { findComfortableTradeFinderOffers, sortTradeFinderOfferItems } from "../utils/tradeFinderOfferEngine.js";
import { getLeagueFinancialRules } from "../utils/leagueFinancials.js";
import PageFade from "../components/PageFade";
import {
  canAddCustomProtectionToPick,
  getTradePickBaseProtectionLabel,
  getTradeablePickOwnedRange,
  normalizeDraftPicks,
  normalizeTeamName,
  protectionDisplayForOwnedRange,
  sortDraftPickAssets,
  validateCustomPickProtection,
} from "../utils/draftPicks.js";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";

const TRADE_BUILDER_KEY = "bm_trade_builder_v1";
const TRADE_FINDER_STATE_KEY = "bm_trade_finder_state_v1";
const DEFAULT_PICK_PROTECTION = "Unprotected";
const REGULAR_SEASON_MIN_STANDARD_PLAYERS = 14;
const REGULAR_SEASON_MAX_STANDARD_PLAYERS = 16;
const TRADE_MATCHING_SMALL_OUTGOING = 7_500_000;
const TRADE_MATCHING_MID_OUTGOING = 29_000_000;
const TRADE_MATCHING_BUFFER = 250_000;
const TRADE_SALARY_TOLERANCE = 1_000;

// Manual scrollbar controls for the Trade Finder scroll areas.
// This styles the tall vertical scrollbar/thumb on the package and offer panels.
const TRADE_FINDER_SCROLLBAR_TUNING = {
  width: 14,
  radius: 999,
  thumbTop: "#f97316",
  thumbBottom: "#c2410c",
  thumbHoverTop: "#fb923c",
  thumbHoverBottom: "#ea580c",
  trackTop: "rgba(0,0,0,0.70)",
  trackBottom: "rgba(20,20,20,0.86)",
  trackBorder: "rgba(255,255,255,0.10)",
  thumbBorder: "rgba(0,0,0,0.78)",
  glow: "rgba(249,115,22,0.38)",
};

// Manual headshot controls for player rows in Trade Finder.
// These are absolute-positioned so the pills stay the same size.
const TRADE_FINDER_HEADSHOT_TUNING = {
  packageRows: {
    // Face/headshot manual controls for the left package rows.
    // size = visible player face/body image height.
    // x/y = move the image inside the pill.
    // boxWidth = invisible lane for the image before it crops.
    // leftPad = where the OVR ring/name section starts after the image.
    boxWidth: 150,
    size: 96,
    imageHeight: 76,
    x: 12,
    y: 0,
    leftPad: 148,
    opacity: 1,
  },
  offerRows: {
    // Right-side offer pills now use the same visual scale as the left package pills.
    boxWidth: 150,
    size: 96,
    imageHeight: 76,
    x: 12,
    y: 0,
    leftPad: 148,
    opacity: 1,
  },
};


// Manual OVR/POT ring controls for Trade Finder player rows.
// The ring is placed to the right of the headshot and before the name/contract text.
const TRADE_FINDER_RATING_RING_TUNING = {
  packageRows: {
    // Change `size` to shrink/grow the WHOLE ring.
    // The OVR/POT text now auto-scales with this number.
    size: 72,
    referenceSize: 70,
    autoScaleText: true,
    textScale: 1,
    x: -10,
    y: 0,
    gap: 16,
    ovrLabelSize: 8,
    ovrLabelX: 0,
    ovrLabelY: 0,
    ovrNumberSize: 28,
    ovrNumberX: 0,
    ovrNumberY: 0,
    potSize: 8,
    potX: 0,
    potY: 0,
    strokeWidth: 8,
    trackOpacity: 0.08,
    fillOpacity: 0.3,
  },
  offerRows: {
    // Same scale as the user package rows, but still separately tunable.
    size: 72,
    referenceSize: 70,
    autoScaleText: true,
    textScale: 1,
    x: -10,
    y: 0,
    gap: 16,
    ovrLabelSize: 8,
    ovrLabelX: 0,
    ovrLabelY: 0,
    ovrNumberSize: 28,
    ovrNumberX: 0,
    ovrNumberY: 0,
    potSize: 8,
    potX: 0,
    potY: 0,
    strokeWidth: 8,
    trackOpacity: 0.08,
    fillOpacity: 0.3,
  },
};

// Manual row/text/button controls for Trade Finder player pills.
// Use these when the headshot/ring/text spacing needs tiny 2K-style tuning.
const TRADE_FINDER_PLAYER_ROW_TUNING = {
  packageRows: {
    rowMinHeight: 92,
    rowPaddingX: 16,
    rowPaddingY: 14,
    rowRadius: 16,

    contentX: 0,
    contentY: 0,

    textBlockX: 0,
    textBlockY: 0,
    nameSize: 16,
    nameX: 0,
    nameY: 0,

    // POS / AGE line controls. These are separate now.
    positionSize: 12,
    positionX: 0,
    positionY: 0,
    ageSize: 12,
    ageX: 0,
    ageY: 0,
    positionLineGap: 8,
    dotSize: 12,
    dotX: 0,
    dotY: 0,

    contractSize: 11,
    contractX: 0,
    contractY: 0,

    buttonX: 0,
    buttonY: 0,
    buttonPadX: 14,
    buttonPadY: 8,
    buttonTextSize: 12,
    buttonRadius: 12,
  },
  offerRows: {
    // Right-side offer player pills match the left-side package player pill style.
    rowMinHeight: 92,
    rowPaddingX: 16,
    rowPaddingY: 14,
    rowRadius: 16,

    contentX: 0,
    contentY: 0,

    textBlockX: 0,
    textBlockY: 0,
    nameSize: 16,
    nameX: 0,
    nameY: 0,

    positionSize: 12,
    positionX: 0,
    positionY: 0,
    ageSize: 12,
    ageX: 0,
    ageY: 0,
    positionLineGap: 8,
    dotSize: 12,
    dotX: 0,
    dotY: 0,

    contractSize: 11,
    contractX: 0,
    contractY: 0,
  },
};

// Manual background logo controls for each player/pick pill in Trade Finder.
// packageRows = left side user package pills. offerRows = right side offer pills.
// x/y move the watermark from the center of the pill.
const TRADE_FINDER_PILL_LOGO_TUNING = {
  packageRows: {
    enabled: true,
    size: 280,
    opacity: 0.11,
    x: 250,
    y: 0,
    rotate: 0,
    blur: 0,
    brightness: 1.25,
    contrast: 1.12,
    saturate: 1.2,
    blendMode: "screen",
  },
  offerRows: {
    enabled: true,
    size: 260,
    opacity: 0.1,
    x: 250,
    y: 0,
    rotate: 0,
    blur: 0,
    brightness: 1.25,
    contrast: 1.12,
    saturate: 1.2,
    blendMode: "screen",
  },
};

// Team-specific manual watermark controls.
// These are intentionally handled through explicit if statements below.
const TRADE_FINDER_PILL_LOGO_TEAM_OVERRIDES = {
  pelicans: {
    packageRows: {
      size: 330,
      opacity: 0.11,
      x: 210,
      y: 0,
      rotate: 0,
      blur: 0,
      brightness: 1.35,
      contrast: 1.15,
      saturate: 1.25,
      blendMode: "screen",
    },
    offerRows: {
      size: 310,
      opacity: 0.11,
      x: 210,
      y: 0,
      rotate: 0,
      blur: 0,
      brightness: 1.35,
      contrast: 1.15,
      saturate: 1.25,
      blendMode: "screen",
    },
  },
  trailBlazers: {
    packageRows: {
      size: 400,
      opacity: 0.18,
      x: 220,
      y: 80,
      rotate: 0,
      blur: 0,
      brightness: 1.75,
      contrast: 1.22,
      saturate: 1.45,
      blendMode: "screen",
    },
    offerRows: {
      size: 400,
      opacity: 0.18,
      x: 220,
      y: 80,
      rotate: 0,
      blur: 0,
      brightness: 1.75,
      contrast: 1.22,
      saturate: 1.45,
      blendMode: "screen",
    },
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

function sameTeamName(a = "", b = "") {
  return normalizeTeamName(a) === normalizeTeamName(b);
}

function getTradeFinderPillLogoTuning(teamName, variant = "packageRows") {
  const base = TRADE_FINDER_PILL_LOGO_TUNING[variant] || TRADE_FINDER_PILL_LOGO_TUNING.packageRows;

  if (sameTeamName(teamName, "New Orleans Pelicans")) {
    return {
      ...base,
      ...(TRADE_FINDER_PILL_LOGO_TEAM_OVERRIDES.pelicans?.[variant] || {}),
    };
  }

  if (sameTeamName(teamName, "Portland Trail Blazers")) {
    return {
      ...base,
      ...(TRADE_FINDER_PILL_LOGO_TEAM_OVERRIDES.trailBlazers?.[variant] || {}),
    };
  }

  return base;
}

function TradeFinderPillBackgroundLogo({ team, variant = "packageRows" }) {
  const logo = teamLogoOf(team);
  const teamName = team?.name || team?.teamName || "";
  const t = getTradeFinderPillLogoTuning(teamName, variant);

  if (!t?.enabled || !logo) return null;

  return (
    <img
      src={logo}
      alt=""
      className="pointer-events-none absolute left-1/2 top-1/2 z-0 select-none object-contain"
      aria-hidden="true"
      style={{
        width: t.size,
        height: t.size,
        opacity: t.opacity,
        transform: `translate(calc(-50% + ${t.x || 0}px), calc(-50% + ${t.y || 0}px)) rotate(${t.rotate || 0}deg)`,
        filter: `blur(${t.blur || 0}px) brightness(${t.brightness ?? 1}) contrast(${t.contrast ?? 1}) saturate(${t.saturate ?? 1})`,
        mixBlendMode: t.blendMode || "normal",
      }}
    />
  );
}

function playerNameOf(player) {
  return player?.name || player?.player || "Unknown Player";
}

function playerHeadshotOf(player) {
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

function playerKey(player) {
  return String(player?.id || player?.playerId || playerNameOf(player));
}

function pickKey(pick) {
  return String(
    pick?.id ||
      pick?.pickId ||
      `${pick?.year || ""}_${pick?.round || ""}_${pick?.ownerTeam || pick?.owner || ""}_${pick?.originalTeam || ""}_${pick?.assetType || pick?.type || "pick"}`
  );
}

function getCurrentSeasonYear(leagueData) {
  return Number(
    leagueData?.seasonYear ||
      leagueData?.currentSeasonYear ||
      leagueData?.seasonStartYear ||
      2026
  );
}

function getTradePayrollSeasonYear(leagueData) {
  const rawYear = Number(getCurrentSeasonYear(leagueData));
  return Number.isFinite(rawYear) ? rawYear + 1 : 2026;
}

function getPlayerSalary(player, leagueData) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract.salaryByYear)
    ? contract.salaryByYear.map((value) => Number(value) || 0)
    : [];
  const payrollSeasonYear = getTradePayrollSeasonYear(leagueData);

  if (salaries.length) {
    let startYear = Number(contract.startYear || payrollSeasonYear);
    let idx = payrollSeasonYear - startYear;
    const lastYear = startYear + salaries.length - 1;
    const hasPayrollSeasonSlot = idx >= 0 && idx < salaries.length;

    if (salaries.length === 1 && startYear === payrollSeasonYear - 1 && !hasPayrollSeasonSlot) {
      startYear = payrollSeasonYear;
      idx = 0;
    }

    if (idx >= 0 && idx < salaries.length) return Number(salaries[idx] || 0);
    if (payrollSeasonYear > lastYear) return Number(salaries[salaries.length - 1] || 0);
    return Number(salaries[0] || 0);
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

function formatMoney(amount) {
  const n = Number(amount || 0);
  if (!Number.isFinite(n) || n === 0) return "$0";

  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);

  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${sign}$${Math.round(abs / 1000)}K`;
}

function formatPick(pick) {
  const round = Number(pick?.round || 1) === 1 ? "1st" : "2nd";
  const original = pick?.originalTeam || pick?.originalTeamName || "Own";
  const pickNumber = Number(pick?.pickNumber || pick?.overallPick || pick?.resolvedPickNumber || pick?.draftPickNumber || 0);
  const pickText = pickNumber ? ` #${pickNumber}` : "";
  return `${pick?.year || "Future"} ${round}${pickText} - ${original}`;
}

function pickProtectionLabel(pick) {
  const raw = pick?.protection || pick?.protections || pick?.displayProtection || "";
  const label = String(raw || "").trim();
  if (!label || label.toLowerCase() === "none" || label.toLowerCase() === "null") return DEFAULT_PICK_PROTECTION;
  return label;
}

function defaultFinderProtectionEnd(pick) {
  const owned = getTradeablePickOwnedRange(pick);
  const round = Number(pick?.round || 1) === 2 ? 2 : 1;
  const preferred = round === 1 && owned.start === 1 ? 14 : owned.start + 4;
  return Math.max(owned.start, Math.min(owned.end - 1, preferred));
}

function normalizeFinderPickRule(pick, rawRule) {
  if (rawRule && typeof rawRule === "object") {
    const mode = rawRule.mode === "protected" ? "protected" : "full";
    return {
      mode,
      protectEnd: Number(rawRule.protectEnd || defaultFinderProtectionEnd(pick)),
    };
  }

  return {
    mode: "full",
    protectEnd: defaultFinderProtectionEnd(pick),
  };
}

function buildFinderPickTradeRule(pick, rawRule) {
  const rule = normalizeFinderPickRule(pick, rawRule);
  if (rule.mode !== "protected") {
    return {
      action: "full",
      ownedRange: getTradeablePickOwnedRange(pick),
      source: "trade_finder_v2",
    };
  }

  const owned = getTradeablePickOwnedRange(pick);
  const validation = validateCustomPickProtection(pick, owned.start, rule.protectEnd);
  if (!validation.ok) {
    return {
      action: "full",
      ownedRange: owned,
      source: "trade_finder_v2",
      fallbackReason: validation.reason,
    };
  }

  return {
    action: "protected",
    protectStart: validation.retainedRange.start,
    protectEnd: validation.retainedRange.end,
    retainedRange: validation.retainedRange,
    conveyedRange: validation.conveyedRange,
    ownedRange: validation.ownedRange,
    baseProtectionLabel: validation.baseProtectionLabel,
    source: "trade_finder_v2",
  };
}

function finderPickProtectionLabel(pick, rawRule) {
  const tradeRule = buildFinderPickTradeRule(pick, rawRule);
  if (tradeRule.action === "protected") return tradeRule.baseProtectionLabel;
  return getTradePickBaseProtectionLabel(pick) || pickProtectionLabel(pick);
}

function buildFinderPickItem(asset, rawRule) {
  const tradeRule = buildFinderPickTradeRule(asset.pick, rawRule);
  const protection = tradeRule.action === "protected"
    ? tradeRule.baseProtectionLabel
    : getTradePickBaseProtectionLabel(asset.pick) || pickProtectionLabel(asset.pick);

  return {
    ...asset,
    protection,
    tradeRule,
    pick: {
      ...asset.pick,
      protection,
      protections: protection,
      displayProtection: protection,
      tradeRule,
    },
  };
}

function getTeamPlayers(team) {
  return Array.isArray(team?.players) ? team.players : [];
}

function safeJSON(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function getSeasonYearFromLeague(leagueData) {
  const offseasonState = safeJSON(localStorage.getItem("bm_offseason_state_v1"), {}) || {};
  const candidates = [
    offseasonState?.seasonYear,
    leagueData?.seasonYear,
    leagueData?.currentSeasonYear,
    leagueData?.seasonStartYear,
  ]
    .map(Number)
    .filter((year) => Number.isFinite(year) && year >= 2020 && year <= 2100);

  return candidates.length ? Math.max(...candidates) : 2026;
}

function readLockedDraftOrder(leagueData, seasonYear) {
  const direct = leagueData?.draftState?.draftOrder;
  if (Array.isArray(direct) && direct.length) return direct;

  const lotteryOrder = leagueData?.draftState?.lottery?.fullDraftOrder;
  if (Array.isArray(lotteryOrder) && lotteryOrder.length) return lotteryOrder;

  const savedLottery = safeJSON(localStorage.getItem("bm_draft_lottery_v1"), null);
  if (
    savedLottery &&
    Number(savedLottery.seasonYear) === Number(seasonYear) &&
    savedLottery.firstRoundRevealed &&
    savedLottery.secondRoundRevealed &&
    Array.isArray(savedLottery?.result?.fullDraftOrder)
  ) {
    return savedLottery.result.fullDraftOrder;
  }

  return [];
}

function isDraftCompleteForSeason(leagueData, seasonYear) {
  const offseasonState = safeJSON(localStorage.getItem("bm_offseason_state_v1"), {}) || {};
  const savedDraftState = safeJSON(localStorage.getItem("bm_draft_state_v1"), null);

  return Boolean(
    (Number(offseasonState?.seasonYear || seasonYear) === Number(seasonYear) && offseasonState?.draftComplete) ||
      (Number(savedDraftState?.seasonYear || 0) === Number(seasonYear) && savedDraftState?.completed) ||
      (Number(leagueData?.draftState?.seasonYear || seasonYear) === Number(seasonYear) && leagueData?.draftState?.completed)
  );
}

function isOffseasonTradeWindow(leagueData) {
  const seasonYear = getSeasonYearFromLeague(leagueData);
  const offseasonState = safeJSON(localStorage.getItem("bm_offseason_state_v1"), {}) || {};
  const savedLottery = safeJSON(localStorage.getItem("bm_draft_lottery_v1"), null);
  const savedDraftState = safeJSON(localStorage.getItem("bm_draft_state_v1"), null);

  return Boolean(
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
      (savedLottery && Number(savedLottery.seasonYear || seasonYear) === Number(seasonYear)) ||
      (savedDraftState && Number(savedDraftState.seasonYear || seasonYear) === Number(seasonYear)) ||
      leagueData?.draftState?.draftLotteryComplete ||
      leagueData?.draftState?.draftOrder?.length
  );
}

function getPickOwnerName(row = {}) {
  return row.currentOwnerTeamName || row.ownerTeamName || row.teamName || row.ownerTeam || row.owner || "";
}

function getPickOriginalName(row = {}) {
  return row.originalTeamName || row.originalPickTeamName || row.naturalLotteryTeamName || row.originalTeam || row.teamName || "";
}

function buildResolvedDraftAsset(row = {}, seasonYear) {
  const pickNumber = Number(row.pick || row.pickNumber || row.overallPick || row.draftPickNumber || row.resolvedPickNumber || 0);
  const round = Number(row.round || (pickNumber <= 30 ? 1 : 2));
  const ownerTeam = getPickOwnerName(row);
  const originalTeam = getPickOriginalName(row);

  return {
    id: `resolved_${seasonYear}_${round}_${pickNumber}_${ownerTeam}_${originalTeam}`,
    assetType: "resolved",
    type: "resolved",
    year: Number(seasonYear),
    round,
    pickNumber,
    overallPick: pickNumber,
    resolvedPickNumber: pickNumber,
    projectedRank: pickNumber || undefined,
    currentSeasonYear: Number(seasonYear),
    leagueSeasonYear: Number(seasonYear),
    originalTeam,
    originalTeamName: originalTeam,
    ownerTeam,
    owner: ownerTeam,
    currentOwnerTeamName: ownerTeam,
    displayProtection: "Resolved",
    protection: "Resolved",
    protections: "Resolved",
    status: "active",
    notes: row.draftPickProtection || row.swapProtectionLabel || "Resolved draft pick",
  };
}

function collectTradeablePicksForTeam(leagueData, teamName) {
  if (!leagueData || !teamName) return [];

  const teamNames = getAllTeamsFromLeague(leagueData)
    .map((team) => team?.name || team?.teamName)
    .filter(Boolean);
  const seasonYear = getSeasonYearFromLeague(leagueData);
  const draftOrder = readLockedDraftOrder(leagueData, seasonYear);
  const draftComplete = isDraftCompleteForSeason(leagueData, seasonYear);
  const draftOrderLocked = draftOrder.length >= 60;

  const futurePicks = normalizeDraftPicks(leagueData?.draftPicks || [], teamNames)
    .filter((pick) => String(pick.status || "active").toLowerCase() === "active")
    .filter((pick) => Number(pick.year || 0) >= Number(seasonYear))
    .filter((pick) => !(draftComplete && Number(pick.year || 0) === Number(seasonYear)))
    .filter((pick) => !(draftOrderLocked && !draftComplete && Number(pick.year || 0) === Number(seasonYear)))
    .map((pick) => ({
      ...pick,
      currentSeasonYear: seasonYear,
      leagueSeasonYear: seasonYear,
    }));

  const resolvedPicks = draftOrderLocked && !draftComplete
    ? draftOrder.map((row) => buildResolvedDraftAsset(row, seasonYear))
    : [];

  const activeKey = normalizeTeamName(teamName);
  const rows = [...resolvedPicks, ...futurePicks]
    .filter((pick) => normalizeTeamName(pick.ownerTeam || pick.owner || pick.currentOwnerTeamName || "") === activeKey)
    .sort(sortDraftPickAssets);

  const seen = new Set();
  return rows.filter((pick) => {
    const key = pickKey(pick);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectAllTradeablePicksForTradeFinder(leagueData, teams = []) {
  const byKey = new Map();
  for (const team of teams || []) {
    const teamName = team?.name || team?.teamName;
    for (const pick of collectTradeablePicksForTeam(leagueData, teamName)) {
      byKey.set(pickKey(pick), pick);
    }
  }
  return [...byKey.values()];
}

function getOwnedPicks(leagueData, teamName) {
  return collectTradeablePicksForTeam(leagueData, teamName);
}

function playerValue(player, leagueData) {
  const overall = Number(player?.overall || 0);
  const potential = Number(player?.potential || overall || 0);
  const age = Number(player?.age || 27);
  const salaryM = getPlayerSalary(player, leagueData) / 1_000_000;
  const primeBonus = age <= 25 ? 10 : age <= 28 ? 6 : age <= 31 ? 2 : -3;
  const contractPenalty = Math.max(0, salaryM - 18) * 0.45;
  const starBonus = overall >= 90 ? 18 : overall >= 85 ? 8 : overall >= 80 ? 3 : 0;

  return Math.max(1, overall * 0.72 + potential * 0.42 + primeBonus + starBonus - contractPenalty);
}

function pickValue(pick, protection = DEFAULT_PICK_PROTECTION, leagueData = null) {
  const round = Number(pick?.round || 1);
  const year = Number(pick?.year || 2030);
  const now = getSeasonYearFromLeague(leagueData || {});
  const pickNumber = Number(
    pick?.pickNumber ||
      pick?.overallPick ||
      pick?.resolvedPickNumber ||
      pick?.draftPickNumber ||
      pick?.projectedRank ||
      0
  );
  const exactPick = String(pick?.assetType || pick?.type || "").toLowerCase() === "resolved" || pickNumber > 0;
  const projectedRank = pickNumber || Number(pick?.projectedRank || pick?.recordRank || pick?.expectedRank || pick?.slot || 18);
  const yearsOut = exactPick && Number(year) === Number(now) ? 0 : Math.max(0, year - now);
  const futurePenalty = yearsOut * (round === 1 ? 1.75 : 0.7);
  const protectionText = String(exactPick ? "Unprotected" : protection || DEFAULT_PICK_PROTECTION).toLowerCase();

  let base = round === 1
    ? Math.max(6, 38 - projectedRank * 0.85)
    : Math.max(1, 7 - projectedRank * 0.08);

  if (exactPick && round === 1) {
    if (projectedRank <= 1) base += 10;
    else if (projectedRank <= 3) base += 6;
    else if (projectedRank <= 14) base += 2.5;
  } else if (exactPick) {
    base += 1;
  }

  let protectionPenalty = 0;
  if (protectionText.includes("lottery") || protectionText.includes("1-14")) protectionPenalty = 11;
  else if (protectionText.includes("top 20")) protectionPenalty = 15;
  else if (protectionText.includes("top 10")) protectionPenalty = 8;
  else if (protectionText.includes("top 8")) protectionPenalty = 6;
  else if (protectionText.includes("top 5")) protectionPenalty = 4;
  else if (protectionText.includes("top 3")) protectionPenalty = 3;
  else if (protectionText.includes("protected")) protectionPenalty = round === 1 ? 7 : 1.5;

  return Math.max(2, base - futurePenalty - protectionPenalty);
}

function assetValue(asset, leagueData) {
  if (asset.type === "player") return playerValue(asset.player, leagueData);
  return pickValue(asset.pick, asset.protection, leagueData);
}

function packageValue(items, leagueData) {
  return items.reduce((sum, item) => sum + assetValue(item, leagueData), 0);
}

function getCandidateAssets(team, leagueData) {
  const players = getTeamPlayers(team)
    .filter((player) => !player?.isTwoWay && !player?.isStash)
    .map((player) => ({
      type: "player",
      player,
      label: playerNameOf(player),
      value: playerValue(player, leagueData),
      salary: getPlayerSalary(player, leagueData),
    }));

  const picks = getOwnedPicks(leagueData, team?.name)
    .map((pick) => ({
      type: "pick",
      pick,
      protection: pickProtectionLabel(pick),
      label: `${pickProtectionLabel(pick)} ${formatPick(pick)}`,
      value: pickValue(pick, pickProtectionLabel(pick), leagueData),
      salary: 0,
    }));

  return [...players, ...picks].sort((a, b) => b.value - a.value);
}

function buildOfferForTeam(team, leagueData, targetValue) {
  const candidates = getCandidateAssets(team, leagueData);
  const targetLow = targetValue * 0.82;
  const targetHigh = targetValue * 1.08;
  const offer = [];
  let total = 0;

  for (const asset of candidates) {
    if (offer.length >= 4) break;
    if (asset.value > targetValue * 1.2 && offer.length === 0) continue;
    if (total + asset.value > targetHigh && total >= targetLow) continue;
    offer.push(asset);
    total += asset.value;
    if (total >= targetLow) break;
  }

  if (!offer.length && candidates[0]) {
    offer.push(candidates[0]);
    total = candidates[0].value;
  }

  const gap = total - targetValue;
  const quality = total >= targetLow ? "Likely Offer" : "Low Offer";

  return {
    team,
    offer,
    offerValue: total,
    targetValue,
    gap,
    quality,
  };
}

function buildTradeFinderOffers({ teams, selectedTeam, leagueData, selectedItems }) {
  const targetValue = packageValue(selectedItems, leagueData);
  if (!targetValue) return [];

  return teams
    .filter((team) => team?.name && !sameTeamName(team.name, selectedTeam?.name))
    .map((team) => buildOfferForTeam(team, leagueData, targetValue))
    .sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap));
}

function buildTradeFinderTeamContext(teams = []) {
  const context = {};

  for (const team of teams || []) {
    const name = team?.name || team?.teamName;
    if (!name) continue;

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

    context[name] = {
      wins: Number.isFinite(wins) ? wins : 0,
      losses: Number.isFinite(losses) ? losses : 0,
      phase: team?.phase || team?.status || team?.direction || undefined,
    };
  }

  return context;
}

function isTradeFinderOfferAccepted(offer = {}) {
  const decision = String(offer?.decision || offer?.evaluation?.decision || "").toLowerCase();
  return Boolean(
    offer?.accepted ||
      offer?.evaluation?.accepted ||
      decision === "accept" ||
      decision === "accepted"
  );
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
  const seasonYear = getTradePayrollSeasonYear(leagueData);
  const rules = getLeagueFinancialRules(leagueData || {}, seasonYear);
  const salaryCap = getLeagueAmount(leagueData, rules, ["salaryCap", "capLimit"], rules.salaryCap);
  const firstApron = getLeagueAmount(leagueData, rules, ["firstApron", "apron1"], rules.firstApron || salaryCap);
  const secondApron = getLeagueAmount(leagueData, rules, ["secondApron", "apron2"], rules.secondApron || firstApron);
  const hardCap = getLeagueAmount(
    leagueData,
    rules,
    ["hardCap", "hardCapLimit", "secondApron", "apron2"],
    rules.hardCap || rules.secondApron || secondApron || salaryCap
  );
  const inflationIndex = Number(rules.inflationIndex || 1);

  return { salaryCap, firstApron, secondApron, hardCap, inflationIndex, seasonYear };
}

function getCurrentDeadCapForTeam(team, leagueData) {
  const teamName = team?.name;
  const seasonYear = getTradePayrollSeasonYear(leagueData);
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
  const limits = getFinancialLimits(leagueData);
  const { salaryCap, firstApron, secondApron, hardCap } = limits;
  const basePayroll = getTeamBasePayroll(team, leagueData);
  const payroll = Math.max(0, basePayroll - Number(outgoingSalary || 0) + Number(incomingSalary || 0));
  const capRoom = salaryCap > 0 ? salaryCap - payroll : Number(team?.capRoom ?? team?.financials?.capRoom ?? 0);
  const firstApronRoom = firstApron > 0 ? firstApron - payroll : 0;
  const secondApronRoom = secondApron > 0 ? secondApron - payroll : 0;
  const hardCapRoom = hardCap > 0 ? hardCap - payroll : Number(team?.hardCapRoom ?? team?.financials?.hardCapRoom ?? 0);

  return {
    capRoom,
    firstApronRoom,
    secondApronRoom,
    hardCapRoom,
    payroll,
    basePayroll,
    salaryCap,
    firstApron,
    secondApron,
    hardCap,
    seasonYear: limits.seasonYear,
  };
}

function scaledTradeMatchingAmount(amount, leagueData) {
  const { inflationIndex } = getFinancialLimits(leagueData);
  return Number(amount || 0) * Math.max(0.5, Number(inflationIndex || 1));
}

function getBelowApronMatchingLimit(outgoingSalary, leagueData) {
  const outgoing = Number(outgoingSalary || 0);
  const smallBand = scaledTradeMatchingAmount(TRADE_MATCHING_SMALL_OUTGOING, leagueData);
  const midBand = scaledTradeMatchingAmount(TRADE_MATCHING_MID_OUTGOING, leagueData);
  const buffer = scaledTradeMatchingAmount(TRADE_MATCHING_BUFFER, leagueData);

  if (outgoing <= 0) return 0;
  if (outgoing <= smallBand) return outgoing * 2 + buffer;
  if (outgoing <= midBand) return outgoing + smallBand;
  return outgoing * 1.25 + buffer;
}

function isTradeFinanciallyLegal({ team, leagueData, outgoingSalary = 0, incomingSalary = 0 }) {
  const outgoing = Number(outgoingSalary || 0);
  const incoming = Number(incomingSalary || 0);
  if (incoming <= outgoing + TRADE_SALARY_TOLERANCE) return true;

  const cap = getTeamCapInfo(team, leagueData, outgoing, incoming);
  const basePayroll = Number(cap.basePayroll || 0);
  const projectedPayroll = Number(cap.payroll || 0);
  const salaryCap = Number(cap.salaryCap || 0);
  const firstApron = Number(cap.firstApron || 0);
  const capRoomBefore = Math.max(0, salaryCap - basePayroll);

  if (firstApron > 0 && basePayroll >= firstApron - TRADE_SALARY_TOLERANCE) return false;
  if (salaryCap > 0 && basePayroll < salaryCap && incoming <= outgoing + capRoomBefore + TRADE_SALARY_TOLERANCE) return true;

  const matchingLimit = getBelowApronMatchingLimit(outgoing, leagueData);
  const withinMatching = incoming <= matchingLimit + TRADE_SALARY_TOLERANCE;
  const projectedAtOrAboveFirstApron = firstApron > 0 && projectedPayroll >= firstApron - TRADE_SALARY_TOLERANCE;

  return withinMatching && !projectedAtOrAboveFirstApron;
}

function getAllowedProjectedStandardRosterMax(team) {
  return Math.max(REGULAR_SEASON_MAX_STANDARD_PLAYERS, getStandardRosterCount(team));
}

function sideSalary(items = [], leagueData) {
  return (items || []).reduce((sum, item) => {
    if (item?.type !== "player") return sum;
    return sum + getPlayerSalary(item.player, leagueData);
  }, 0);
}

function countTradePlayers(items = []) {
  return (items || []).filter((item) => item?.type === "player" && item.player).length;
}

function getStandardRosterCount(team) {
  return Array.isArray(team?.players) ? team.players.length : 0;
}

function getProjectedStandardRosterCount(team, outgoingItems = [], incomingItems = []) {
  return getStandardRosterCount(team) - countTradePlayers(outgoingItems) + countTradePlayers(incomingItems);
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

function findTeamInLeague(leagueData, teamName) {
  return getAllTeamsFromLeague(leagueData).find((team) => sameTeamName(team?.name || team?.teamName, teamName)) || null;
}

function isNormalPickOwnedByTeam(leagueData, pick = {}, teamName = "") {
  const owned = getOwnedPicks(leagueData, teamName);
  const targetKey = pickKey(pick);
  return owned.some((row) => pickKey(row) === targetKey);
}

function isResolvedPickOwnedByTeam(leagueData, pick = {}, teamName = "") {
  const seasonYear = Number(pick.year || pick.seasonYear || getSeasonYearFromLeague(leagueData));
  const rows = readLockedDraftOrder(leagueData, seasonYear);
  const targetPick = Number(pick.pickNumber || pick.overallPick || pick.resolvedPickNumber || pick.draftPickNumber || 0);
  const targetRound = Number(pick.round || (targetPick <= 30 ? 1 : 2));
  const targetOriginal = normalizeTeamName(pick.originalTeam || pick.originalTeamName || "");

  return rows.some((row) => {
    const rowPick = Number(row.pick || row.pickNumber || row.overallPick || row.draftPickNumber || row.resolvedPickNumber || 0);
    const rowRound = Number(row.round || (rowPick <= 30 ? 1 : 2));
    const rowOriginal = normalizeTeamName(getPickOriginalName(row));
    const owner = getPickOwnerName(row);
    return (
      rowPick === targetPick &&
      rowRound === targetRound &&
      (!targetOriginal || rowOriginal === targetOriginal) &&
      sameTeamName(owner, teamName)
    );
  });
}

function areTradeItemsStillOwned(leagueData, team, items = []) {
  const teamName = team?.name || team?.teamName || "";
  const teamPlayers = getTeamPlayers(team);
  const playerIds = new Set(teamPlayers.map((player) => playerKey(player)));

  for (const item of items || []) {
    if (item?.type === "player") {
      if (!playerIds.has(playerKey(item.player))) return false;
      continue;
    }

    if (item?.type === "pick") {
      const pick = item.pick || {};
      const type = String(pick.assetType || pick.type || "pick").toLowerCase();
      if (type === "resolved") {
        if (!isResolvedPickOwnedByTeam(leagueData, pick, teamName)) return false;
      } else if (!isNormalPickOwnedByTeam(leagueData, pick, teamName)) {
        return false;
      }
    }
  }

  return true;
}

function validateTradeFinderOffer({ leagueData, selectedTeam, offer }) {
  if (!leagueData || !selectedTeam || !offer?.team || !Array.isArray(offer.offer)) return false;
  if (!isTradeFinderOfferAccepted(offer)) return false;

  const offerTeamName = offer.team?.name || offer.team?.teamName || offer.teamName;
  const offerTeam = findTeamInLeague(leagueData, offerTeamName) || offer.team;
  const selectedItems = Array.isArray(offer.selectedItems) ? offer.selectedItems : [];
  const offerItems = offer.offer;

  if (!selectedItems.length || !offerItems.length) return false;
  if (getUnsupportedRosterTradePlayer(selectedItems) || getUnsupportedRosterTradePlayer(offerItems)) return false;
  if (!areTradeItemsStillOwned(leagueData, selectedTeam, selectedItems)) return false;
  if (!areTradeItemsStillOwned(leagueData, offerTeam, offerItems)) return false;

  const selectedOutgoingSalary = sideSalary(selectedItems, leagueData);
  const selectedIncomingSalary = sideSalary(offerItems, leagueData);
  const offerOutgoingSalary = sideSalary(offerItems, leagueData);
  const offerIncomingSalary = sideSalary(selectedItems, leagueData);

  const selectedFinancialOk = isTradeFinanciallyLegal({
    team: selectedTeam,
    leagueData,
    outgoingSalary: selectedOutgoingSalary,
    incomingSalary: selectedIncomingSalary,
  });
  const offerFinancialOk = isTradeFinanciallyLegal({
    team: offerTeam,
    leagueData,
    outgoingSalary: offerOutgoingSalary,
    incomingSalary: offerIncomingSalary,
  });

  if (!selectedFinancialOk || !offerFinancialOk) return false;

  if (!isOffseasonTradeWindow(leagueData)) {
    const selectedProjected = getProjectedStandardRosterCount(selectedTeam, selectedItems, offerItems);
    const offerProjected = getProjectedStandardRosterCount(offerTeam, offerItems, selectedItems);
    if (selectedProjected < REGULAR_SEASON_MIN_STANDARD_PLAYERS || selectedProjected > getAllowedProjectedStandardRosterMax(selectedTeam)) return false;
    if (offerProjected < REGULAR_SEASON_MIN_STANDARD_PLAYERS || offerProjected > getAllowedProjectedStandardRosterMax(offerTeam)) return false;
  }

  return true;
}

function attachSelectedItemsToOffers(offers = [], selectedItems = []) {
  return (Array.isArray(offers) ? offers : []).map((offer) => ({
    ...offer,
    selectedItems,
  }));
}

function filterLegalAcceptedTradeFinderOffers({ offers = [], leagueData, selectedTeam, selectedItems }) {
  return attachSelectedItemsToOffers(offers, selectedItems).filter((offer) =>
    validateTradeFinderOffer({ leagueData, selectedTeam, offer })
  );
}

function saveTradeBuilderFromOffer({ selectedTeam, offerTeam, selectedItems, offerItems }) {
  const userItems = selectedItems.map((item) => {
    if (item.type === "player") return { type: "player", player: item.player };
    return {
      type: "pick",
      pick: item.pick,
      protection: item.protection || DEFAULT_PICK_PROTECTION,
      tradeRule: item.tradeRule || item.pick?.tradeRule || undefined,
      displayLabel: item.displayLabel || undefined,
    };
  });

  const cpuItems = offerItems.map((item) => {
    if (item.type === "player") return { type: "player", player: item.player };
    return {
      type: "pick",
      pick: item.pick,
      protection: item.protection || DEFAULT_PICK_PROTECTION,
      tradeRule: item.tradeRule || item.pick?.tradeRule || undefined,
      displayLabel: item.displayLabel || undefined,
    };
  });

  localStorage.setItem(
    TRADE_BUILDER_KEY,
    JSON.stringify({
      source: "tradeFinder",
      returnToTradeFinder: true,
      userTeamName: selectedTeam?.name || "",
      cpuTeamName: offerTeam?.name || "",
      userItems,
      cpuItems,
      updatedAt: Date.now(),
    })
  );
}

function safeReadTradeFinderState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRADE_FINDER_STATE_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function saveTradeFinderState(snapshot) {
  try {
    localStorage.setItem(
      TRADE_FINDER_STATE_KEY,
      JSON.stringify({
        ...snapshot,
        updatedAt: Date.now(),
      })
    );
  } catch {}
}

function TradeFinderPlayerHeadshot({ player, variant = "packageRows" }) {
  const headshot = playerHeadshotOf(player);
  const t = TRADE_FINDER_HEADSHOT_TUNING[variant] || TRADE_FINDER_HEADSHOT_TUNING.packageRows;

  if (!headshot) return null;

  return (
    <div
      className="pointer-events-none absolute bottom-0 left-0 top-0 z-[2] flex items-end justify-start overflow-visible"
      style={{ width: t.boxWidth }}
      aria-hidden="true"
    >
      <img
        src={headshot}
        alt=""
        className="w-auto object-contain select-none"
        style={{
          height: t.size || t.imageHeight,
          opacity: t.opacity ?? 1,
          transform: `translate(${t.x || 0}px, ${t.y || 0}px)`,
        }}
      />
    </div>
  );
}


function TradeFinderRatingRing({ player, variant = "packageRows" }) {
  const t = TRADE_FINDER_RATING_RING_TUNING[variant] || TRADE_FINDER_RATING_RING_TUNING.packageRows;
  const overall = Number(player?.overall || 0);
  const potential = Number(player?.potential || overall || 0);
  const fillPercent = Math.min(Math.max(overall, 0) / 99, 1);
  const size = Math.max(1, Number(t.size || 0));
  const referenceSize = Math.max(1, Number(t.referenceSize || size || 70));
  const autoTextScale = t.autoScaleText === false ? 1 : size / referenceSize;
  const textScale = autoTextScale * Number(t.textScale ?? 1);
  const radius = 50;
  const strokeWidth = Number(t.strokeWidth || 8);
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference * (1 - fillPercent);
  const scaledTextSize = (value, fallback) => Math.max(1, Number(value ?? fallback) * textScale);

  return (
    <div
      className="relative flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size,
        transform: `translate(${t.x || 0}px, ${t.y || 0}px)`,
      }}
    >
      <svg width={size} height={size} viewBox="0 0 120 120">
        <defs>
          <linearGradient id="tradeFinderOvrGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#FFA500" />
            <stop offset="100%" stopColor="#FFD54F" />
          </linearGradient>
        </defs>
        <circle
          cx="60"
          cy="60"
          r={radius}
          stroke={`rgba(255,255,255,${t.trackOpacity ?? 0.08})`}
          strokeWidth={strokeWidth}
          fill={`rgba(0,0,0,${t.fillOpacity ?? 0.3})`}
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          stroke="url(#tradeFinderOvrGradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeOffset}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        <div
          className="font-black uppercase tracking-wide text-neutral-300"
          style={{
            fontSize: scaledTextSize(t.ovrLabelSize, 8),
            transform: `translate(${t.ovrLabelX || 0}px, ${t.ovrLabelY || 0}px)`,
          }}
        >
          OVR
        </div>
        <div
          className="font-black text-orange-400"
          style={{
            fontSize: scaledTextSize(t.ovrNumberSize, 28),
            lineHeight: 0.9,
            transform: `translate(${t.ovrNumberX || 0}px, ${t.ovrNumberY || 0}px)`,
          }}
        >
          {player?.overall ?? "-"}
        </div>
        <div
          className="font-black uppercase text-neutral-400"
          style={{
            fontSize: scaledTextSize(t.potSize, 8),
            transform: `translate(${t.potX || 0}px, ${t.potY || 0}px)`,
          }}
        >
          POT <span className="text-orange-400">{player?.potential ?? "-"}</span>
        </div>
      </div>
    </div>
  );
}

function AssetRow({ asset, selected, onToggle, pickRule, onPickRuleChange, leagueData, team }) {
  const isPlayer = asset.type === "player";
  const label = isPlayer ? playerNameOf(asset.player) : formatPick(asset.pick);
  const positionText = isPlayer
    ? `${asset.player?.pos || "-"}${asset.player?.secondaryPos ? ` / ${asset.player.secondaryPos}` : ""}`
    : "";
  const ageText = isPlayer && asset.player?.age ? `Age ${asset.player.age}` : "";
  const normalizedPickRule = !isPlayer ? normalizeFinderPickRule(asset.pick, pickRule) : null;
  const protection = !isPlayer ? finderPickProtectionLabel(asset.pick, pickRule) : DEFAULT_PICK_PROTECTION;
  const ownedRange = !isPlayer ? getTradeablePickOwnedRange(asset.pick) : null;
  const customProtectionAllowed = !isPlayer ? canAddCustomProtectionToPick(asset.pick) : false;
  const customProtectionValidation = !isPlayer && normalizedPickRule?.mode === "protected"
    ? validateCustomPickProtection(asset.pick, ownedRange.start, normalizedPickRule.protectEnd)
    : null;
  const contractLine = isPlayer
    ? `Contract: ${formatMoney(getPlayerSalary(asset.player, leagueData))}`
    : `${protection || DEFAULT_PICK_PROTECTION} • Owns ${ownedRange?.start || "?"}-${ownedRange?.end || "?"}`;
  const headshotT = TRADE_FINDER_HEADSHOT_TUNING.packageRows;
  const ringT = TRADE_FINDER_RATING_RING_TUNING.packageRows;
  const rowT = TRADE_FINDER_PLAYER_ROW_TUNING.packageRows;
  const hasHeadshot = isPlayer && Boolean(playerHeadshotOf(asset.player));

  return (
    <div
      className={`relative overflow-hidden border transition ${
        selected ? "border-orange-400/60 bg-orange-500/15" : "border-white/10 bg-white/[0.035] hover:border-orange-400/30"
      }`}
      style={{
        minHeight: isPlayer ? rowT.rowMinHeight : undefined,
        padding: `${rowT.rowPaddingY}px ${rowT.rowPaddingX}px`,
        borderRadius: rowT.rowRadius,
      }}
    >
      <TradeFinderPillBackgroundLogo team={team} variant="packageRows" />
      {isPlayer && <TradeFinderPlayerHeadshot player={asset.player} variant="packageRows" />}

      <div
        className="relative z-10 flex items-center justify-between gap-3"
        style={{
          paddingLeft: hasHeadshot ? headshotT.leftPad : 0,
          transform: `translate(${rowT.contentX || 0}px, ${rowT.contentY || 0}px)`,
        }}
      >
        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex flex-1 items-center text-left"
          style={{ gap: isPlayer ? ringT.gap : 0 }}
        >
          {isPlayer && <TradeFinderRatingRing player={asset.player} variant="packageRows" />}

          <div
            className="min-w-0 flex-1"
            style={{ transform: `translate(${rowT.textBlockX || 0}px, ${rowT.textBlockY || 0}px)` }}
          >
            <div
              className="truncate font-black text-white"
              style={{
                fontSize: rowT.nameSize,
                transform: `translate(${rowT.nameX || 0}px, ${rowT.nameY || 0}px)`,
              }}
            >
              {label}
            </div>
            {isPlayer ? (
              <div
                className="mt-1 flex min-w-0 items-center font-black uppercase tracking-[0.08em] text-neutral-300"
                style={{ gap: rowT.positionLineGap }}
              >
                <span
                  className="truncate"
                  style={{
                    fontSize: rowT.positionSize,
                    transform: `translate(${rowT.positionX || 0}px, ${rowT.positionY || 0}px)`,
                  }}
                >
                  {positionText}
                </span>
                {ageText && (
                  <>
                    <span
                      className="shrink-0 text-neutral-500"
                      style={{
                        fontSize: rowT.dotSize,
                        transform: `translate(${rowT.dotX || 0}px, ${rowT.dotY || 0}px)`,
                      }}
                    >
                      •
                    </span>
                    <span
                      className="shrink-0"
                      style={{
                        fontSize: rowT.ageSize,
                        transform: `translate(${rowT.ageX || 0}px, ${rowT.ageY || 0}px)`,
                      }}
                    >
                      {ageText}
                    </span>
                  </>
                )}
              </div>
            ) : (
              <div
                className="mt-1 font-black uppercase tracking-[0.08em] text-neutral-300"
                style={{
                  fontSize: rowT.positionSize,
                  transform: `translate(${rowT.positionX || 0}px, ${rowT.positionY || 0}px)`,
                }}
              >
                {contractLine}
              </div>
            )}
            {isPlayer && (
              <div
                className="mt-1 font-black uppercase tracking-[0.08em] text-neutral-400"
                style={{
                  fontSize: rowT.contractSize,
                  transform: `translate(${rowT.contractX || 0}px, ${rowT.contractY || 0}px)`,
                }}
              >
                {contractLine}
              </div>
            )}
          </div>
        </button>

        <button
          type="button"
          onClick={onToggle}
          className={`font-black transition ${
            selected ? "bg-orange-600 text-white" : "bg-black text-neutral-300 hover:bg-white/10"
          }`}
          style={{
            borderRadius: rowT.buttonRadius,
            padding: `${rowT.buttonPadY}px ${rowT.buttonPadX}px`,
            fontSize: rowT.buttonTextSize,
            transform: `translate(${rowT.buttonX || 0}px, ${rowT.buttonY || 0}px)`,
          }}
        >
          {selected ? "Added" : "Add"}
        </button>
      </div>

      {!isPlayer && selected && (
        <div className="relative z-10 mt-3 rounded-xl border border-white/10 bg-black p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => onPickRuleChange?.({ mode: "full", protectEnd: normalizedPickRule.protectEnd })}
              className={`rounded-lg px-3 py-2 text-xs font-black transition ${
                normalizedPickRule.mode !== "protected" ? "bg-orange-600 text-white" : "bg-neutral-900 text-neutral-300 hover:bg-white/10"
              }`}
            >
              Full Owned Piece
            </button>
            <button
              type="button"
              disabled={!customProtectionAllowed}
              onClick={() => onPickRuleChange?.({ mode: "protected", protectEnd: normalizedPickRule.protectEnd })}
              className={`rounded-lg px-3 py-2 text-xs font-black transition ${
                normalizedPickRule.mode === "protected" ? "bg-orange-600 text-white" : "bg-neutral-900 text-neutral-300 hover:bg-white/10"
              } ${!customProtectionAllowed ? "opacity-45" : ""}`}
            >
              Custom Protected
            </button>
          </div>

          {normalizedPickRule.mode === "protected" && customProtectionAllowed && (
            <div className="mt-3 grid gap-2">
              <label className="text-xs font-black uppercase tracking-[0.12em] text-neutral-400">
                Protects {ownedRange.start}-
                <input
                  type="number"
                  min={ownedRange.start}
                  max={ownedRange.end - 1}
                  value={normalizedPickRule.protectEnd || ""}
                  onChange={(event) => onPickRuleChange?.({ mode: "protected", protectEnd: Number(event.target.value) })}
                  className="ml-2 w-24 rounded-lg border border-white/10 bg-neutral-900 px-2 py-1 font-black text-white outline-none"
                />
              </label>
              <div className={`text-xs font-bold ${customProtectionValidation?.ok ? "text-emerald-300" : "text-red-300"}`}>
                {customProtectionValidation?.ok
                  ? `${protectionDisplayForOwnedRange(customProtectionValidation.baseProtectionLabel, customProtectionValidation.conveyedRange)} can be traded.`
                  : customProtectionValidation?.reason || "Enter a valid owned protection range."}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OfferAssetLine({ item, team }) {
  if (item.type === "player") {
    const headshotT = TRADE_FINDER_HEADSHOT_TUNING.offerRows;
    const ringT = TRADE_FINDER_RATING_RING_TUNING.offerRows;
    const rowT = TRADE_FINDER_PLAYER_ROW_TUNING.offerRows;
    const hasHeadshot = Boolean(playerHeadshotOf(item.player));
    const positionText = `${item.player?.pos || "-"}${item.player?.secondaryPos ? ` / ${item.player.secondaryPos}` : ""}`;
    const ageText = item.player?.age ? `Age ${item.player.age}` : "";
    const salary = Number(item.salary || 0);
    const contractLine = salary > 0 ? `Contract: ${formatMoney(salary)}` : "Contract: $0";

    return (
      <div
        className="relative overflow-hidden border border-white/10 bg-white/[0.035] transition hover:border-orange-400/30 hover:bg-orange-500/10"
        style={{
          minHeight: rowT.rowMinHeight,
          padding: `${rowT.rowPaddingY}px ${rowT.rowPaddingX}px`,
          borderRadius: rowT.rowRadius,
        }}
      >
        <TradeFinderPillBackgroundLogo team={team} variant="offerRows" />
        <TradeFinderPlayerHeadshot player={item.player} variant="offerRows" />

        <div
          className="relative z-10 flex items-center justify-between gap-3"
          style={{
            paddingLeft: hasHeadshot ? headshotT.leftPad : 0,
            transform: `translate(${rowT.contentX || 0}px, ${rowT.contentY || 0}px)`,
          }}
        >
          <div
            className="min-w-0 flex flex-1 items-center text-left"
            style={{ gap: ringT.gap }}
          >
            <TradeFinderRatingRing player={item.player} variant="offerRows" />

            <div
              className="min-w-0 flex-1"
              style={{ transform: `translate(${rowT.textBlockX || 0}px, ${rowT.textBlockY || 0}px)` }}
            >
              <div
                className="truncate font-black text-white"
                style={{
                  fontSize: rowT.nameSize,
                  transform: `translate(${rowT.nameX || 0}px, ${rowT.nameY || 0}px)`,
                }}
              >
                {playerNameOf(item.player)}
              </div>

              <div
                className="mt-1 flex min-w-0 items-center font-black uppercase tracking-[0.08em] text-neutral-300"
                style={{ gap: rowT.positionLineGap }}
              >
                <span
                  className="truncate"
                  style={{
                    fontSize: rowT.positionSize,
                    transform: `translate(${rowT.positionX || 0}px, ${rowT.positionY || 0}px)`,
                  }}
                >
                  {positionText}
                </span>
                {ageText && (
                  <>
                    <span
                      className="shrink-0 text-neutral-500"
                      style={{
                        fontSize: rowT.dotSize,
                        transform: `translate(${rowT.dotX || 0}px, ${rowT.dotY || 0}px)`,
                      }}
                    >
                      •
                    </span>
                    <span
                      className="shrink-0"
                      style={{
                        fontSize: rowT.ageSize,
                        transform: `translate(${rowT.ageX || 0}px, ${rowT.ageY || 0}px)`,
                      }}
                    >
                      {ageText}
                    </span>
                  </>
                )}
              </div>

              <div
                className="mt-1 font-black uppercase tracking-[0.08em] text-neutral-400"
                style={{
                  fontSize: rowT.contractSize,
                  transform: `translate(${rowT.contractX || 0}px, ${rowT.contractY || 0}px)`,
                }}
              >
                {contractLine}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative overflow-hidden border border-white/10 bg-white/[0.035] font-black text-white transition hover:border-orange-400/30 hover:bg-orange-500/10"
      style={{
        minHeight: 74,
        padding: "18px 20px",
        borderRadius: 16,
      }}
    >
      <TradeFinderPillBackgroundLogo team={team} variant="offerRows" />
      <span className="relative z-10">
        {item.protection || DEFAULT_PICK_PROTECTION} {formatPick(item.pick)}
      </span>
    </div>
  );
}

function TradeFinderScrollbarStyles() {
  const t = TRADE_FINDER_SCROLLBAR_TUNING;

  return (
    <style>{`
      .tradeFinderScroller {
        scrollbar-width: thin;
        scrollbar-color: ${t.thumbBottom} ${t.trackBottom};
        scrollbar-gutter: stable;
      }

      .tradeFinderScroller::-webkit-scrollbar {
        width: ${t.width}px;
        height: ${t.width}px;
      }

      .tradeFinderScroller::-webkit-scrollbar-track {
        background: linear-gradient(180deg, ${t.trackTop}, ${t.trackBottom});
        border-left: 1px solid ${t.trackBorder};
        border-radius: ${t.radius}px;
      }

      .tradeFinderScroller::-webkit-scrollbar-thumb {
        background: linear-gradient(180deg, ${t.thumbTop}, ${t.thumbBottom});
        border: 3px solid ${t.thumbBorder};
        border-radius: ${t.radius}px;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18), 0 0 14px ${t.glow};
      }

      .tradeFinderScroller::-webkit-scrollbar-thumb:hover {
        background: linear-gradient(180deg, ${t.thumbHoverTop}, ${t.thumbHoverBottom});
      }

      .tradeFinderScroller::-webkit-scrollbar-button {
        display: none;
        width: 0;
        height: 0;
      }
    `}</style>
  );
}

export default function TradeFinder() {
  const navigate = useNavigate();
  const { leagueData, selectedTeam } = useGame();
  const teams = useMemo(() => getAllTeamsFromLeague(leagueData), [leagueData]);
  const savedFinderState = useMemo(() => safeReadTradeFinderState(), []);
  const [selectedAssetKeys, setSelectedAssetKeys] = useState(() =>
    Array.isArray(savedFinderState?.selectedAssetKeys) ? savedFinderState.selectedAssetKeys : []
  );
  const [pickProtections, setPickProtections] = useState(() =>
    savedFinderState?.pickProtections && typeof savedFinderState.pickProtections === "object"
      ? savedFinderState.pickProtections
      : {}
  );
  const [searched, setSearched] = useState(() => Boolean(savedFinderState?.searched));
  const [pythonOffers, setPythonOffers] = useState(() =>
    Array.isArray(savedFinderState?.offers) ? savedFinderState.offers : []
  );
  const [isSearchingOffers, setIsSearchingOffers] = useState(false);
  const [offerSearchError, setOfferSearchError] = useState("");
  const [offerSearchProgress, setOfferSearchProgress] = useState("");

  const selectedTeamPlayers = useMemo(() => getTeamPlayers(selectedTeam), [selectedTeam]);
  const selectedTeamPicks = useMemo(() => getOwnedPicks(leagueData, selectedTeam?.name), [leagueData, selectedTeam]);

  const playerAssets = useMemo(
    () => selectedTeamPlayers.map((player) => ({ type: "player", player, key: `player:${playerKey(player)}` })),
    [selectedTeamPlayers]
  );

  const pickAssets = useMemo(
    () => selectedTeamPicks.map((pick) => ({ type: "pick", pick, key: `pick:${pickKey(pick)}` })),
    [selectedTeamPicks]
  );

  const allAssets = useMemo(() => [...playerAssets, ...pickAssets], [playerAssets, pickAssets]);

  const selectedItems = useMemo(() => {
    const keys = new Set(selectedAssetKeys);
    return allAssets
      .filter((asset) => keys.has(asset.key))
      .map((asset) => {
        if (asset.type === "pick") {
          return buildFinderPickItem(asset, pickProtections[asset.key]);
        }
        return asset;
      });
  }, [allAssets, pickProtections, selectedAssetKeys]);

  const selectedValue = useMemo(() => packageValue(selectedItems, leagueData), [selectedItems, leagueData]);
  const offers = searched ? pythonOffers : [];

  useEffect(() => {
    if (!selectedTeam?.name) return;
    saveTradeFinderState({
      selectedTeamName: selectedTeam.name,
      selectedAssetKeys,
      pickProtections,
      searched,
      offers: pythonOffers,
    });
  }, [selectedTeam?.name, selectedAssetKeys, pickProtections, searched, pythonOffers]);

  const toggleAsset = (asset) => {
    setSearched(false);
    setPythonOffers([]);
    setOfferSearchError("");
    setOfferSearchProgress("");
    setSelectedAssetKeys((prev) => {
      if (prev.includes(asset.key)) return prev.filter((key) => key !== asset.key);
      return [...prev, asset.key];
    });

    if (asset.type === "pick") {
      setPickProtections((prev) => ({
        ...prev,
        [asset.key]: prev[asset.key] || normalizeFinderPickRule(asset.pick, null),
      }));
    }
  };

  const runSearchOffers = async () => {
    setSearched(true);
    setOfferSearchError("");
    setOfferSearchProgress("");

    if (!selectedItems.length) {
      setPythonOffers([]);
      return;
    }

    setIsSearchingOffers(true);
    setOfferSearchProgress("Starting Trade Finder search...");

    try {
      const result = await findComfortableTradeFinderOffers({
        leagueData,
        selectedTeam,
        selectedItems,
        teams,
        onProgress: (progress = {}) => {
          const teamIndex = Number(progress.teamIndex || 0);
          const teamsToCheck = Number(progress.teamsToCheck || 0);
          const offersFound = Number(progress.offersFound || 0);
          const teamName = progress.team || "CPU teams";
          const elapsed = Number(progress.elapsedSec || 0);

          if (progress.phase === "complete") {
            setOfferSearchProgress(
              `Complete: checked ${teamsToCheck}/${teamsToCheck} teams, found ${offersFound} offer${offersFound === 1 ? "" : "s"} in ${elapsed.toFixed(1)}s.`
            );
            return;
          }

          if (progress.phase === "team_done") {
            setOfferSearchProgress(
              `Checked ${teamIndex}/${teamsToCheck}: ${teamName} (${Number(progress.teamMs || 0).toFixed(0)}ms, ${Number(progress.evaluationsForTeam || 0)} evals). Offers found: ${offersFound}.`
            );
            return;
          }

          if (progress.phase === "evaluating") {
            setOfferSearchProgress(
              `Checking ${teamIndex}/${teamsToCheck}: ${teamName} • ${Number(progress.evaluationsForTeam || 0)} evaluations • Offers found: ${offersFound}.`
            );
            return;
          }

          if (progress.phase === "team_start") {
            setOfferSearchProgress(
              `Checking ${teamIndex}/${teamsToCheck}: ${teamName}... Offers found: ${offersFound}.`
            );
            return;
          }

          setOfferSearchProgress("Searching CPU teams...");
        },
      });

      const nextOffers = Array.isArray(result?.offers)
        ? result.offers.map((offer) => ({
            ...offer,
            offer: sortTradeFinderOfferItems(offer.offer, leagueData),
          }))
        : [];
      setPythonOffers(nextOffers);

      if (!nextOffers.length) {
        setOfferSearchError(
          result?.message || "No CPU team found a Propose Trade-legal package it would comfortably accept."
        );
      }
    } catch (error) {
      console.warn("[TradeFinder] offer search failed.", error);
      setPythonOffers([]);
      setOfferSearchError(error?.message || "Trade Finder failed while checking Propose Trade-compatible CPU offers.");
      setOfferSearchProgress("");
    } finally {
      setIsSearchingOffers(false);
    }
  };

  const loadOffer = (offer) => {
    saveTradeFinderState({
      selectedTeamName: selectedTeam?.name || "",
      selectedAssetKeys,
      pickProtections,
      searched: true,
      offers: pythonOffers.length ? pythonOffers : offers,
    });

    saveTradeBuilderFromOffer({
      selectedTeam,
      offerTeam: offer.team,
      selectedItems,
      offerItems: sortTradeFinderOfferItems(offer.offer, leagueData),
    });

    navigate("/propose-trade", { state: { fromTradeFinder: true } });
  };

  if (!selectedTeam || !leagueData) {
    return (
      <PageFade>
        <div className="min-h-screen bmCourtPage text-white flex flex-col items-center justify-center px-4">
          <p className="mb-4 text-lg font-semibold">No league/team loaded.</p>
          <button onClick={() => navigate("/trades")} className="rounded-xl bg-orange-600 px-6 py-3 font-bold">
            Trade Center
          </button>
        </div>
      </PageFade>
    );
  }

  return (
    <PageFade>
      <TradeFinderScrollbarStyles />
      <div className="min-h-screen bmCourtPage px-4 py-8 text-white">
        <div className="mx-auto w-full max-w-7xl">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <button
              onClick={() => navigate("/trades")}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-neutral-200 transition hover:bg-white/10 hover:text-white"
            >
              ← Trade Center
            </button>

            <div className="text-center">
              <div className="text-xs font-black uppercase tracking-[0.24em] text-orange-300">Trade Finder</div>
              <h1 className="mt-1 text-4xl font-black text-orange-500">Find Offers</h1>
            </div>

            <button
              onClick={() => navigate("/propose-trade")}
              className="rounded-xl border border-orange-400/25 bg-orange-500/10 px-4 py-2 text-sm font-black text-orange-100 hover:bg-orange-500/20"
            >
              Builder
            </button>
          </div>

          <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950/85 shadow-2xl">
              <div className="border-b border-white/10 bg-gradient-to-r from-orange-600/20 to-black px-6 py-5">
                <div className="flex items-center gap-4">
                  {teamLogoOf(selectedTeam) ? (
                    <img src={teamLogoOf(selectedTeam)} alt={selectedTeam.name} className="h-14 w-14 object-contain" />
                  ) : (
                    <div className="h-14 w-14 rounded-2xl bg-white/5" />
                  )}
                  <div>
                    <div className="text-sm font-black uppercase tracking-[0.18em] text-orange-200">Your Package</div>
                    <div className="mt-1 text-2xl font-black text-white">{selectedTeam.name}</div>
                    <div className="mt-1 text-xs font-bold text-neutral-400">
                      Select players and picks. Picks can be sent as full owned pieces or with valid custom protections.
                    </div>
                  </div>
                </div>
              </div>

              <div className="tradeFinderScroller grid max-h-[68vh] gap-3 overflow-y-auto p-5">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">Players</div>
                {playerAssets.map((asset) => (
                  <AssetRow
                    key={asset.key}
                    asset={asset}
                    selected={selectedAssetKeys.includes(asset.key)}
                    onToggle={() => toggleAsset(asset)}
                    leagueData={leagueData}
                    team={selectedTeam}
                  />
                ))}

                <div className="mt-3 text-xs font-black uppercase tracking-[0.18em] text-orange-300">Draft Picks</div>
                {pickAssets.length ? (
                  pickAssets.map((asset) => (
                    <AssetRow
                      key={asset.key}
                      asset={asset}
                      selected={selectedAssetKeys.includes(asset.key)}
                      onToggle={() => toggleAsset(asset)}
                      pickRule={pickProtections[asset.key] || normalizeFinderPickRule(asset.pick, null)}
                      onPickRuleChange={(value) => {
                        setSearched(false);
                        setPythonOffers([]);
                        setOfferSearchError("");
                        setOfferSearchProgress("");
                        setPickProtections((prev) => ({ ...prev, [asset.key]: value }));
                      }}
                      leagueData={leagueData}
                      team={selectedTeam}
                    />
                  ))
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-black/35 p-4 text-sm font-bold text-neutral-500">
                    No tradeable picks found for this team.
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950/75 shadow-2xl">
              <div className="border-b border-white/10 bg-gradient-to-r from-neutral-900 to-black px-6 py-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-black uppercase tracking-[0.2em] text-orange-300">Legal CPU Offers</div>
                    <div className="mt-1 text-2xl font-black text-white">
                      {selectedItems.length ? `${selectedItems.length} asset package` : "Build a package"}
                    </div>
                    <div className="mt-1 text-xs font-bold text-neutral-500">
                      Package value: {selectedValue.toFixed(1)} • One comfortable offer max per CPU team • Teams checked: {Math.max(0, teams.length - 1)}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={runSearchOffers}
                    disabled={!selectedItems.length || isSearchingOffers}
                    className="rounded-2xl bg-orange-600 px-7 py-3 text-sm font-black text-white transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSearchingOffers ? "Searching..." : "Search Offers"}
                  </button>
                </div>
              </div>

              <div className="tradeFinderScroller max-h-[68vh] overflow-y-auto p-5">
                {!searched && (
                  <div className="rounded-2xl border border-orange-400/25 bg-orange-500/10 p-5 text-sm font-bold leading-6 text-orange-100">
                    Pick a package on the left, then press Search Offers. Each CPU team can show one legal, comfortable offer using the same acceptance logic as Propose Trade.
                  </div>
                )}

                {searched && !selectedItems.length && (
                  <div className="rounded-2xl border border-red-400/25 bg-red-500/10 p-5 text-sm font-bold text-red-100">
                    Add at least one player or pick before searching.
                  </div>
                )}

                {searched && isSearchingOffers && (
                  <div className="rounded-2xl border border-orange-400/25 bg-orange-500/10 p-5 text-sm font-bold leading-6 text-orange-100">
                    <div>
                      CPU front offices are building one comfortable package each, then checking Propose Trade acceptance, salary matching, and roster rules...
                    </div>
                    {offerSearchProgress && (
                      <div className="mt-3 rounded-xl border border-orange-300/20 bg-black/25 px-3 py-2 text-xs text-orange-50">
                        {offerSearchProgress}
                      </div>
                    )}
                  </div>
                )}

                {searched && offerSearchError && !isSearchingOffers && (
                  <div className="mb-3 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-xs font-bold leading-5 text-amber-100">
                    {offerSearchError}
                  </div>
                )}

                {searched && selectedItems.length > 0 && !isSearchingOffers && !offers.length && (
                  <div className="rounded-2xl border border-white/10 bg-black/35 p-5 text-sm font-bold leading-6 text-neutral-300">
                    No CPU team found a legal package it would comfortably accept for this offer. Very weak packages may get no responses.
                  </div>
                )}

                {searched && selectedItems.length > 0 && !isSearchingOffers && offers.length > 0 && (
                  <div className="grid gap-3">
                    {offers.map((offer) => (
                      <div
                        key={offer.team?.name}
                        className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition hover:border-orange-400/30 hover:bg-orange-500/10"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex min-w-0 items-center gap-3">
                            {teamLogoOf(offer.team) ? (
                              <img src={teamLogoOf(offer.team)} alt={offer.team.name} className="h-11 w-11 object-contain" />
                            ) : (
                              <div className="h-11 w-11 rounded-xl bg-white/5" />
                            )}
                            <div className="min-w-0">
                              <div className="truncate text-lg font-black text-white">{offer.team?.name}</div>
                              <div className="text-xs font-black uppercase tracking-[0.12em] text-neutral-500">
                                {offer.quality || "Accepted Offer"} • Value {Number(offer.offerValue || 0).toFixed(1)}
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => loadOffer(offer)}
                            className="shrink-0 rounded-xl border border-orange-400/30 bg-orange-500/10 px-4 py-2 text-xs font-black text-orange-100 transition hover:bg-orange-500/20"
                          >
                            Load Offer
                          </button>
                        </div>

                        <div className="mt-4 grid gap-3">
                          {sortTradeFinderOfferItems(offer.offer, leagueData).map((item, index) => (
                            <OfferAssetLine key={`${offer.team?.name}-${item.label}-${index}`} item={item} team={offer.team} />
                          ))}
                        </div>

                        <div className="mt-3 text-xs font-bold text-neutral-500">
                          Finder estimate: {Number(offer.gap || 0) >= 0 ? "+" : ""}{Number(offer.gap || 0).toFixed(1)} value versus your package • CPU comfort margin {Number(offer.comfortMargin || 0) >= 0 ? "+" : ""}{Number(offer.comfortMargin || 0).toFixed(2)}.
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageFade>
  );
}
