import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { findComfortableTradeFinderOffers, sortTradeFinderOfferItems } from "../utils/tradeFinderOfferEngine.js";
import { findComfortableReverseTradeFinderOffers } from "../utils/reverseTradeFinderOfferEngine.js";
import { evaluateTradeTeamImpact } from "../utils/tradeTeamImpact.js";
import {
  buildOffseasonTradeEvaluationLeague,
  getOffseasonTradeContext,
  getTeamFromTradeLeague,
} from "../utils/offseasonTradeContext.js";
import {
  filterTradeEligiblePlayers,
  findIneligibleTradePlayer,
} from "../utils/tradeRosterEligibility.js";
import {
  evaluateTradeRosterProjection,
} from "../utils/rosterRules.js";
import {
  recordTradeFinderLoadAttempt,
  recordTradeFinderSearchSnapshot,
} from "../utils/bmDiagnostics.js";
import { getLeagueFinancialRules } from "../utils/leagueFinancials.js";
import { getContractSeasonYear, getDraftYear } from "../utils/seasonContext.js";
import { getTradeWindowLockMessage } from "../utils/tradeWindow.js";
import { formatInjuryReturnLabel, isPlayerInjured } from "../utils/injurySystem.js";
import {
  attachUserTradeRuleContext,
  getUserTradeDeadlineStatus,
  getUserTradeCurrentDate,
  getUserTradePickEligibility,
  getUserTradePlayerEligibility,
  validateUserTradeAssetPackage,
  validateUserTradeRules,
} from "../utils/userTradeRules.js";
import PageFade from "../components/PageFade";
import {
  canAddCustomProtectionToPick,
  formatResolvedDraftPickLabel,
  getTradePickBaseProtectionLabel,
  getTradeablePickOwnedRange,
  isResolvedDraftPickAsset,
  normalizeDraftPicks,
  normalizeTeamName,
  protectionDisplayForOwnedRange,
  sortDraftPickAssets,
  validateCustomPickProtection,
} from "../utils/draftPicks.js";
import {
  filterTradeableLiveDraftRows,
  getLiveDraftProgressSignature,
  isResolvedPickConsumed,
} from "../utils/liveDraftTradeAvailability.js";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";

const TRADE_BUILDER_KEY = "bm_trade_builder_v1";
const TRADE_FINDER_STATE_KEY = "bm_trade_finder_state_v1";
const TRADE_DEBUG_KEY = "bm_trade_debug_v1";
const DEFAULT_PICK_PROTECTION = "Unprotected";
const MAX_TRADE_FINDER_PACKAGE_ASSETS = 8;
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
    // Compact enough for the 3-column finder, but still keeps the 2K-style card look.
    boxWidth: 126,
    size: 90,
    imageHeight: 72,
    x: 8,
    y: 0,
    leftPad: 124,
    opacity: 1,
  },
  offerRows: {
    // Keep right-side offer pills at the same scale as the left/middle pills.
    boxWidth: 126,
    size: 90,
    imageHeight: 72,
    x: 8,
    y: 0,
    leftPad: 124,
    opacity: 1,
  },
};


// Manual OVR/POT ring controls for Trade Finder player rows.
// The ring is placed to the right of the headshot and before the name/contract text.
const TRADE_FINDER_RATING_RING_TUNING = {
  packageRows: {
    // Change `size` to shrink/grow the WHOLE ring.
    // The OVR/POT text now auto-scales with this number.
    size: 62,
    referenceSize: 70,
    autoScaleText: true,
    textScale: 1,
    x: -6,
    y: 0,
    gap: 10,
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
    // Same exact scale as the left/middle package rows.
    size: 62,
    referenceSize: 70,
    autoScaleText: true,
    textScale: 1,
    x: -6,
    y: 0,
    gap: 10,
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
    rowMinHeight: 88,
    rowPaddingX: 14,
    rowPaddingY: 12,
    rowRadius: 16,

    contentX: 0,
    contentY: 0,

    textBlockX: 0,
    textBlockY: 0,
    nameSize: 15,
    nameX: 0,
    nameY: 0,

    // POS / AGE line controls. These are separate now.
    positionSize: 11,
    positionX: 0,
    positionY: 0,
    ageSize: 11,
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
    buttonPadX: 12,
    buttonPadY: 8,
    buttonTextSize: 12,
    buttonRadius: 12,
  },
  offerRows: {
    // Right-side offer player pills match the left/middle package player pill style.
    rowMinHeight: 88,
    rowPaddingX: 14,
    rowPaddingY: 12,
    rowRadius: 16,

    contentX: 0,
    contentY: 0,

    textBlockX: 0,
    textBlockY: 0,
    nameSize: 15,
    nameX: 0,
    nameY: 0,

    positionSize: 11,
    positionX: 0,
    positionY: 0,
    ageSize: 11,
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
    size: 250,
    opacity: 0.1,
    x: 185,
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
    size: 250,
    opacity: 0.1,
    x: 185,
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

function TradeFinderInjuryBadge({ player, currentDate = null, compact = false }) {
  if (!isPlayerInjured(player, currentDate)) return null;
  const label = formatInjuryReturnLabel(player, currentDate);
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border border-red-400/45 bg-red-500/15 font-black uppercase tracking-[0.10em] text-red-200 ${compact ? "px-1.5 py-0.5 text-[8px]" : "px-2 py-0.5 text-[9px]"}`}>
      INJ{label ? ` — ${label}` : ""}
    </span>
  );
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
  return getContractSeasonYear(leagueData || {});
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


function getPlayerContractYearsRemaining(player, leagueData) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract.salaryByYear) ? contract.salaryByYear : [];
  if (!salaries.length) return 0;

  const payrollSeasonYear = getTradePayrollSeasonYear(leagueData);
  let startYear = Number(contract.startYear || payrollSeasonYear);
  let index = payrollSeasonYear - startYear;

  if (salaries.length === 1 && startYear === payrollSeasonYear - 1 && (index < 0 || index >= salaries.length)) {
    startYear = payrollSeasonYear;
    index = 0;
  }

  if (!Number.isFinite(index)) index = 0;
  if (index < 0) index = 0;
  if (index >= salaries.length) return 0;
  return Math.max(0, salaries.length - index);
}

function getPlayerContractOptionAbbrev(player) {
  const option = player?.contract?.option;
  if (!option || typeof option !== "object" || option?.picked === true || option?.picked === false) return "";
  const type = String(option?.type || "").toLowerCase();
  if (type === "player") return "PO";
  if (type === "team") return "TO";
  return "";
}

function formatTradeFinderPlayerContract(player, leagueData) {
  const salary = formatMoney(getPlayerSalary(player, leagueData));
  const years = getPlayerContractYearsRemaining(player, leagueData);
  const option = getPlayerContractOptionAbbrev(player);
  const yearsLabel = years > 0 ? `${years} ${years === 1 ? "YR" : "YRS"} LEFT` : "EXPIRING";
  return `${salary} • ${yearsLabel}${option ? ` • ${option}` : ""}`;
}

function formatPick(pick) {
  if (isResolvedDraftPickAsset(pick)) return formatResolvedDraftPickLabel(pick);
  const round = Number(pick?.round || 1) === 1 ? "1st" : "2nd";
  const original = pick?.originalTeam || pick?.originalTeamName || "Own";
  const pickNumber = Number(pick?.pickNumber || pick?.overallPick || pick?.resolvedPickNumber || pick?.draftPickNumber || 0);
  const pickText = pickNumber ? ` #${pickNumber}` : "";
  return `${pick?.year || "Future"} ${round}${pickText} - ${original}`;
}

function pickProtectionLabel(pick) {
  if (isResolvedDraftPickAsset(pick)) return "Resolved";
  const raw = pick?.protection || pick?.protections || pick?.displayProtection || "";
  const label = String(raw || "").trim();
  if (!label || label.toLowerCase() === "none" || label.toLowerCase() === "null") return DEFAULT_PICK_PROTECTION;
  return label;
}

function defaultFinderProtectionEnd(pick) {
  const owned = getTradeablePickOwnedRange(pick);
  const round = Number(pick?.round || 1) === 2 ? 2 : 1;
  // First-round custom protection defaults to lottery protection. Second-round
  // custom protection defaults to top-55, which is a much more familiar NBA
  // convention than the old 31-35 default.
  const preferred = round === 1 && owned.start === 1
    ? 14
    : round === 2
      ? 55
      : owned.start + 4;
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
    offseasonState?.draftYear,
    leagueData?.draftYear,
    leagueData?.currentDraftYear,
    leagueData?.draftState?.seasonYear,
    getDraftYear(leagueData || {}),
  ]
    .map(Number)
    .filter((year) => Number.isFinite(year) && year >= 2020 && year <= 2100);

  return candidates.length ? Math.max(...candidates) : 2026;
}


function getDraftOrderPickNumber(row = null) {
  if (!row || typeof row !== "object") return 0;
  const value = Number(row.pick || row.pickNumber || row.overallPick || row.draftPickNumber || row.resolvedPickNumber || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isUsableDraftOrderRow(row = null) {
  if (!row || typeof row !== "object") return false;
  if (getDraftOrderPickNumber(row) > 0) return true;
  return Boolean(row.teamName || row.currentOwnerTeamName || row.ownerTeamName || row.originalTeamName || row.originalPickTeamName);
}

function sanitizeDraftOrderRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter(isUsableDraftOrderRow);
}

function readLockedDraftOrder(leagueData, seasonYear) {
  const candidates = [];
  const pushRows = (rows, allowed = true) => {
    if (!allowed || !Array.isArray(rows)) return;
    const clean = sanitizeDraftOrderRows(rows.filter(Boolean));
    if (clean.length) candidates.push(clean);
  };

  const savedDraftState = safeJSON(localStorage.getItem("bm_draft_state_v1"), null);
  const savedLottery = safeJSON(localStorage.getItem("bm_draft_lottery_v1"), null);
  const savedDraftMatches = savedDraftState && Number(savedDraftState.seasonYear || seasonYear) === Number(seasonYear);
  const savedLotteryMatches = savedLottery && Number(savedLottery.seasonYear || seasonYear) === Number(seasonYear);
  const savedLotteryRevealed = Boolean(
    savedLotteryMatches &&
      savedLottery.firstRoundRevealed &&
      savedLottery.secondRoundRevealed &&
      !savedLottery.isPreview
  );
  const leagueLotteryComplete = Boolean(
    leagueData?.draftState?.draftLotteryComplete ||
      (Number(leagueData?.draftState?.seasonYear || seasonYear) === Number(seasonYear) &&
        Array.isArray(leagueData?.draftState?.draftOrder) &&
        leagueData.draftState.draftOrder.length)
  );

  pushRows(savedDraftState?.draftOrder, savedDraftMatches);
  pushRows(savedDraftState?.fullDraftOrder, savedDraftMatches);
  pushRows(savedLottery?.result?.fullDraftOrder, savedLotteryRevealed);
  pushRows(savedLottery?.fullDraftOrder, savedLotteryRevealed);
  pushRows(leagueData?.draftState?.fullDraftOrder, leagueLotteryComplete);
  pushRows(leagueData?.draftState?.draftOrder, leagueLotteryComplete);
  pushRows(leagueData?.draftState?.lottery?.fullDraftOrder, leagueLotteryComplete);
  pushRows(leagueData?.draftLottery?.fullDraftOrder, leagueLotteryComplete);

  candidates.sort((a, b) => b.length - a.length);
  return candidates.find((rows) => rows.length >= 60) || candidates[0] || [];
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
  if (!row || typeof row !== "object") return null;
  const pickNumber = Number(row.pick || row.pickNumber || row.overallPick || row.draftPickNumber || row.resolvedPickNumber || 0);
  if (!Number.isFinite(pickNumber) || pickNumber <= 0) return null;
  const round = Number(row.round || (pickNumber <= 30 ? 1 : 2));
  const ownerTeam = getPickOwnerName(row);
  const originalTeam = getPickOriginalName(row);
  if (!ownerTeam) return null;

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
  const tradeContext = getOffseasonTradeContext(leagueData);
  const draftOrder = tradeContext?.draftOrderLocked
    ? tradeContext.draftOrder
    : readLockedDraftOrder(leagueData, seasonYear);
  const draftComplete = tradeContext?.inOffseason
    ? Boolean(tradeContext.draftComplete)
    : isDraftCompleteForSeason(leagueData, seasonYear);
  const draftOrderLocked = Boolean(tradeContext?.draftOrderLocked || draftOrder.length > 0);

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
    ? filterTradeableLiveDraftRows(draftOrder, leagueData, seasonYear)
        .map((row) => buildResolvedDraftAsset(row, seasonYear))
        .filter(Boolean)
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

const tradeFinderPickUniverseCache = new WeakMap();

function getTradeFinderPickUniverse(leagueData, teams = []) {
  if (!leagueData || typeof leagueData !== "object") return { resolvedPicks: [], futurePicks: [] };
  const teamNames = (Array.isArray(teams) && teams.length ? teams : getAllTeamsFromLeague(leagueData))
    .map((team) => team?.name || team?.teamName)
    .filter(Boolean);
  const seasonYear = getSeasonYearFromLeague(leagueData);
  const tradeContext = getOffseasonTradeContext(leagueData);
  const draftOrder = tradeContext?.draftOrderLocked
    ? tradeContext.draftOrder
    : readLockedDraftOrder(leagueData, seasonYear);
  const draftComplete = tradeContext?.inOffseason
    ? Boolean(tradeContext.draftComplete)
    : isDraftCompleteForSeason(leagueData, seasonYear);
  const draftOrderLocked = Boolean(tradeContext?.draftOrderLocked || draftOrder.length > 0);
  const signature = [
    seasonYear,
    draftComplete ? "draftComplete" : "draftOpen",
    draftOrderLocked ? "locked" : "unlocked",
    Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks.length : 0,
    Array.isArray(draftOrder) ? draftOrder.length : 0,
    teamNames.length,
  ].join("|");
  const cached = tradeFinderPickUniverseCache.get(leagueData);
  if (cached?.signature === signature) return cached.value;

  const futurePicks = normalizeDraftPicks(leagueData?.draftPicks || [], teamNames)
    .filter((pick) => String(pick.status || "active").toLowerCase() === "active")
    .filter((pick) => Number(pick.year || 0) >= Number(seasonYear))
    .filter((pick) => !(draftComplete && Number(pick.year || 0) === Number(seasonYear)))
    .filter((pick) => !(draftOrderLocked && !draftComplete && Number(pick.year || 0) === Number(seasonYear)))
    .map((pick) => ({ ...pick, currentSeasonYear: seasonYear, leagueSeasonYear: seasonYear }));

  const resolvedPicks = draftOrderLocked && !draftComplete
    ? filterTradeableLiveDraftRows(draftOrder, leagueData, seasonYear)
        .map((row) => buildResolvedDraftAsset(row, seasonYear))
        .filter(Boolean)
    : [];
  const value = { resolvedPicks, futurePicks };
  tradeFinderPickUniverseCache.set(leagueData, { signature, value });
  return value;
}

function collectTradeablePicksByTeamForFinder(leagueData, teams = []) {
  const byTeam = new Map();
  if (!leagueData) return byTeam;

  const teamNames = (Array.isArray(teams) && teams.length ? teams : getAllTeamsFromLeague(leagueData))
    .map((team) => team?.name || team?.teamName)
    .filter(Boolean);
  const seasonYear = getSeasonYearFromLeague(leagueData);
  const tradeContext = getOffseasonTradeContext(leagueData);
  const draftOrder = tradeContext?.draftOrderLocked
    ? tradeContext.draftOrder
    : readLockedDraftOrder(leagueData, seasonYear);
  const draftComplete = tradeContext?.inOffseason
    ? Boolean(tradeContext.draftComplete)
    : isDraftCompleteForSeason(leagueData, seasonYear);
  const draftOrderLocked = Boolean(tradeContext?.draftOrderLocked || draftOrder.length > 0);

  const futurePicks = normalizeDraftPicks(leagueData?.draftPicks || [], teamNames)
    .filter((pick) => String(pick.status || "active").toLowerCase() === "active")
    .filter((pick) => Number(pick.year || 0) >= Number(seasonYear))
    .filter((pick) => !(draftComplete && Number(pick.year || 0) === Number(seasonYear)))
    .filter((pick) => !(draftOrderLocked && !draftComplete && Number(pick.year || 0) === Number(seasonYear)))
    .map((pick) => ({ ...pick, currentSeasonYear: seasonYear, leagueSeasonYear: seasonYear }));

  const resolvedPicks = draftOrderLocked && !draftComplete
    ? filterTradeableLiveDraftRows(draftOrder, leagueData, seasonYear)
        .map((row) => buildResolvedDraftAsset(row, seasonYear))
        .filter(Boolean)
    : [];

  for (const pick of [...resolvedPicks, ...futurePicks]) {
    const ownerKey = normalizeTeamName(pick.ownerTeam || pick.owner || pick.currentOwnerTeamName || "");
    if (!ownerKey) continue;
    if (!byTeam.has(ownerKey)) byTeam.set(ownerKey, []);
    byTeam.get(ownerKey).push(pick);
  }

  for (const [teamKey, rows] of byTeam.entries()) {
    const seen = new Set();
    const deduped = rows
      .sort(sortDraftPickAssets)
      .filter((pick) => {
        const key = pickKey(pick);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    byTeam.set(teamKey, deduped);
  }

  return byTeam;
}

function getOwnedPicksFromFinderMap(picksByTeam, teamName = "") {
  const key = normalizeTeamName(teamName);
  if (!key || !picksByTeam || typeof picksByTeam.get !== "function") return [];
  return picksByTeam.get(key) || [];
}

function collectTradeablePicksForSingleTeamForFinder(leagueData, teamName = "", teams = []) {
  const ownerKey = normalizeTeamName(teamName);
  if (!leagueData || !ownerKey) return [];
  const { resolvedPicks, futurePicks } = getTradeFinderPickUniverse(leagueData, teams);
  const seen = new Set();
  return [...resolvedPicks, ...futurePicks]
    .filter((pick) => normalizeTeamName(pick.ownerTeam || pick.owner || pick.currentOwnerTeamName || "") === ownerKey)
    .sort(sortDraftPickAssets)
    .filter((pick) => {
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
  const ratingValue = Math.max(2, (overall - 60) * 2.4);
  const potentialBonus = Math.max(-8, potential - overall) * 1.2;
  const ageBonus = age <= 22 ? 9 : age <= 25 ? 7 : age <= 28 ? 4 : age <= 31 ? 1.5 : age <= 34 ? -2 : -6;
  const contractPenalty = Math.max(0, salaryM - 18) * 0.42;
  const bargainBonus = overall >= 76 && salaryM > 0 && salaryM <= 8 ? 6 : 0;
  const starBonus = overall >= 95 ? 42 : overall >= 92 ? 34 : overall >= 90 ? 26 : overall >= 85 ? 12 : overall >= 80 ? 5 : 0;

  return Math.max(1, ratingValue + potentialBonus + ageBonus + starBonus + bargainBonus - contractPenalty);
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
  const players = filterTradeEligiblePlayers(getTeamPlayers(team), { leagueData })
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
      label: isResolvedDraftPickAsset(pick)
        ? formatResolvedDraftPickLabel(pick)
        : `${pickProtectionLabel(pick)} ${formatPick(pick)}`,
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

function isTradeDebugEnabled() {
  try {
    return Boolean(
      typeof window !== "undefined" &&
        (window.__BM_TRADE_DEBUG || localStorage.getItem(TRADE_DEBUG_KEY) === "1")
    );
  } catch {
    return false;
  }
}

function tradeDebugItemLabel(item = {}) {
  if (item?.type === "player") return playerNameOf(item.player);
  if (item?.type === "pick") return `${item.protection || item.pick?.displayProtection || item.pick?.protection || DEFAULT_PICK_PROTECTION} ${formatPick(item.pick || {})}`;
  return item?.label || item?.type || "Unknown asset";
}

function tradeDebugItems(items = [], leagueData = null) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (item?.type === "player") {
      return {
        type: "player",
        name: playerNameOf(item.player),
        ovr: Number(item.player?.overall ?? item.player?.ovr ?? 0),
        pot: Number(item.player?.potential ?? item.player?.pot ?? item.player?.overall ?? 0),
        salaryM: Math.round((getPlayerSalary(item.player, leagueData) / 1_000_000) * 10) / 10,
      };
    }
    if (item?.type === "pick") {
      return {
        type: "pick",
        label: tradeDebugItemLabel(item),
        tradeRule: item.tradeRule || item.pick?.tradeRule || null,
      };
    }
    return { type: item?.type || "unknown", label: tradeDebugItemLabel(item) };
  });
}

function tradeDebugEvaluation(evaluation = {}) {
  const impact = evaluation?.teamImpact || {};
  const breakdown = impact?.scoreBreakdown || {};
  return {
    accepted: Boolean(evaluation?.accepted || ["accept", "accepted"].includes(String(evaluation?.decision || "").toLowerCase())),
    decision: evaluation?.decision || "",
    score: Number(evaluation?.score ?? 0),
    threshold: Number(impact?.threshold ?? 0),
    margin: Number(evaluation?.score ?? 0) - Number(impact?.threshold ?? 0),
    ratingMode: impact?.ratingMode || "",
    fastScan: Boolean(impact?.fastScan),
    fastFtr: Boolean(impact?.fastFtr),
    rank: impact?.rank,
    deltas: impact?.deltas || null,
    pickScore: breakdown?.pickScore,
    contractFriction: impact?.contractFriction ?? breakdown?.contractFriction,
    starRetentionTax: impact?.starRetentionTax ?? breakdown?.starRetentionTax,
    topReasons: Array.isArray(evaluation?.reasons) ? evaluation.reasons.slice(0, 10) : [],
  };
}

function debugTradeFinderLoadOffer({ leagueData, selectedTeam, selectedItems, offer }) {
  if (!isTradeDebugEnabled()) return;

  try {
    const offerTeam = findTeamInLeague(leagueData, offer?.team?.name || offer?.team?.teamName || offer?.teamName) || offer?.team;
    const offerItems = sortTradeFinderOfferItems(offer?.offer || [], leagueData);
    const projected = buildOffseasonTradeEvaluationLeague(leagueData);
    const evaluationLeague = projected.leagueData;
    const builderEvaluation = evaluateTradeTeamImpact({
      leagueData: evaluationLeague,
      userTeam: getTeamFromTradeLeague(evaluationLeague, selectedTeam?.name) || selectedTeam,
      cpuTeam: getTeamFromTradeLeague(evaluationLeague, offerTeam?.name) || offerTeam,
      userTeamName: selectedTeam?.name || selectedTeam?.teamName || "",
      cpuTeamName: offerTeam?.name || offerTeam?.teamName || offer?.teamName || "",
      userItems: selectedItems,
      cpuItems: offerItems,
      evaluationMode: "standard",
      cpuTradeRole: "",
      cpuTradeContext: { source: "trade_finder_load_offer_debug" },
    });

    const finderSummary = tradeDebugEvaluation(offer?.evaluation || {});
    const builderSummary = tradeDebugEvaluation(builderEvaluation);
    const mismatch = Boolean(offer?.accepted) && !builderSummary.accepted;
    const payload = {
      selectedTeam: selectedTeam?.name || selectedTeam?.teamName || "",
      cpuTeam: offerTeam?.name || offerTeam?.teamName || offer?.teamName || "",
      finderOfferMeta: {
        quality: offer?.quality,
        offerValue: offer?.offerValue,
        targetValue: offer?.targetValue,
        gap: offer?.gap,
        comfortMargin: offer?.comfortMargin,
        score: offer?.score,
        accepted: offer?.accepted,
        decision: offer?.decision,
      },
      finderEvaluation: finderSummary,
      builderEvaluation: builderSummary,
      userPackage: tradeDebugItems(selectedItems, leagueData),
      cpuPackage: tradeDebugItems(offerItems, leagueData),
    };

    if (mismatch) console.warn("[TRADE DEBUG][LOAD OFFER MISMATCH] Finder offer will be rejected by Builder", payload);
    else console.log("[TRADE DEBUG][LOAD OFFER] Builder comparison before navigation", payload);
  } catch (error) {
    console.warn("[TRADE DEBUG][LOAD OFFER] Debug comparison failed", error);
  }
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

function sideSalary(items = [], leagueData) {
  return (items || []).reduce((sum, item) => {
    if (item?.type !== "player") return sum;
    return sum + getPlayerSalary(item.player, leagueData);
  }, 0);
}

function countTradePlayers(items = []) {
  return (items || []).filter((item) => item?.type === "player" && item.player).length;
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

function tradeFinderItemKey(item = {}) {
  if (item?.type === "player") return `player:${playerKey(item.player)}`;
  if (item?.type === "pick") return `pick:${pickKey(item.pick)}`;
  return `${item?.type || "unknown"}:${tradeDebugItemLabel(item)}`;
}

function getDuplicateTradeFinderAssetKeys(...packages) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of packages.flatMap((rows) => (Array.isArray(rows) ? rows : []))) {
    const key = tradeFinderItemKey(item);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return Array.from(duplicates);
}

function findUnownedTradeItem(leagueData, team, items = []) {
  const teamName = team?.name || team?.teamName || "";
  const teamPlayers = getTeamPlayers(team);
  const playerIds = new Set(teamPlayers.map((player) => playerKey(player)));

  for (const item of items || []) {
    if (item?.type === "player") {
      if (!playerIds.has(playerKey(item.player))) {
        return {
          item,
          code: "player_not_owned",
          reason: `${playerNameOf(item.player)} is no longer on ${teamName}'s standard roster.`,
        };
      }
      continue;
    }

    if (item?.type === "pick") {
      const pick = item.pick || {};
      const type = String(pick.assetType || pick.type || "pick").toLowerCase();
      if (type === "resolved") {
        if (isResolvedPickConsumed(pick, leagueData)) {
          return {
            item,
            code: "resolved_pick_consumed",
            reason: `${formatPick(pick)} was already used in the live draft.`,
          };
        }
        if (!isResolvedPickOwnedByTeam(leagueData, pick, teamName)) {
          return {
            item,
            code: "resolved_pick_not_owned",
            reason: `${teamName} no longer owns ${formatPick(pick)}.`,
          };
        }
      } else if (!isNormalPickOwnedByTeam(leagueData, pick, teamName)) {
        return {
          item,
          code: "pick_not_owned",
          reason: `${teamName} no longer owns ${formatPick(pick)}.`,
        };
      }
    }
  }

  return null;
}

function validateTradeFinderOfferDetailed({ leagueData, selectedTeam, offer }) {
  const fail = (code, reason, details = null) => ({ ok: false, code, reason, details });

  if (!leagueData || !selectedTeam || !offer?.team || !Array.isArray(offer.offer)) {
    return fail("invalid_offer_shape", "The Trade Finder offer is missing league, team, or package data.");
  }
  if (!isTradeFinderOfferAccepted(offer)) {
    return fail("offer_not_accepted", "The CPU acceptance attached to this Trade Finder offer is no longer valid.");
  }

  const offerTeamName = offer.team?.name || offer.team?.teamName || offer.teamName;
  const offerTeam = findTeamInLeague(leagueData, offerTeamName) || offer.team;
  const selectedItems = Array.isArray(offer.selectedItems) ? offer.selectedItems : [];
  const offerItems = offer.offer;

  if (!selectedItems.length || !offerItems.length) {
    return fail("empty_package", "Both teams must have at least one asset in the trade.");
  }

  const duplicateAssetKeys = getDuplicateTradeFinderAssetKeys(selectedItems, offerItems);
  if (duplicateAssetKeys.length) {
    return fail("duplicate_assets", "The Trade Finder result contains a duplicated asset.", { duplicateAssetKeys });
  }

  const selectedIneligible = findIneligibleTradePlayer(selectedItems, { leagueData });
  if (selectedIneligible) {
    return fail(
      "selected_player_ineligible",
      `${playerNameOf(selectedIneligible.item?.player)} cannot be traded: ${selectedIneligible.eligibility?.reason || "the player is not trade eligible."}`,
      selectedIneligible
    );
  }

  const offerIneligible = findIneligibleTradePlayer(offerItems, { leagueData });
  if (offerIneligible) {
    return fail(
      "offer_player_ineligible",
      `${playerNameOf(offerIneligible.item?.player)} cannot be traded: ${offerIneligible.eligibility?.reason || "the player is not trade eligible."}`,
      offerIneligible
    );
  }

  const unsupportedSelected = getUnsupportedRosterTradePlayer(selectedItems);
  if (unsupportedSelected) {
    return fail(
      "selected_non_standard_player",
      `${playerNameOf(unsupportedSelected.player)} is not on the standard roster and cannot be loaded into this trade.`
    );
  }

  const unsupportedOffer = getUnsupportedRosterTradePlayer(offerItems);
  if (unsupportedOffer) {
    return fail(
      "offer_non_standard_player",
      `${playerNameOf(unsupportedOffer.player)} is not on the standard roster and cannot be loaded into this trade.`
    );
  }

  const selectedOwnershipIssue = findUnownedTradeItem(leagueData, selectedTeam, selectedItems);
  if (selectedOwnershipIssue) return fail(selectedOwnershipIssue.code, selectedOwnershipIssue.reason, selectedOwnershipIssue);

  const offerOwnershipIssue = findUnownedTradeItem(leagueData, offerTeam, offerItems);
  if (offerOwnershipIssue) return fail(offerOwnershipIssue.code, offerOwnershipIssue.reason, offerOwnershipIssue);

  const userRuleValidation = validateUserTradeRules({
    leagueData,
    userTeam: selectedTeam,
    cpuTeam: offerTeam,
    userTeamName: selectedTeam?.name || selectedTeam?.teamName || "",
    cpuTeamName: offerTeamName,
    userItems: selectedItems,
    cpuItems: offerItems,
    includeDeadline: true,
    includeFinancial: true,
  });
  if (!userRuleValidation.ok) {
    return fail(userRuleValidation.code || "user_trade_rule", userRuleValidation.reason || "This offer violates an enabled user trade rule.", userRuleValidation);
  }

  const inOffseason = isOffseasonTradeWindow(leagueData);
  const selectedRosterProjection = evaluateTradeRosterProjection({
    team: selectedTeam,
    outgoingItems: selectedItems,
    incomingItems: offerItems,
    inOffseason,
  });
  const offerRosterProjection = evaluateTradeRosterProjection({
    team: offerTeam,
    outgoingItems: offerItems,
    incomingItems: selectedItems,
    inOffseason,
  });

  if (!selectedRosterProjection.ok) {
    return fail("selected_roster_maximum", selectedRosterProjection.reason, {
      selectedRosterProjection,
      offerRosterProjection,
    });
  }
  if (!offerRosterProjection.ok) {
    return fail("offer_roster_maximum", offerRosterProjection.reason, {
      selectedRosterProjection,
      offerRosterProjection,
    });
  }

  return {
    ok: true,
    code: "ok",
    reason: "",
    details: {
      offerTeamName,
      duplicateAssetKeys,
      selectedRosterProjection,
      offerRosterProjection,
      asymmetricPlayerCounts:
        countTradePlayers(selectedItems) !== countTradePlayers(offerItems),
      repairBeforeSimulation: {
        selectedTeam: selectedRosterProjection.requiresRepairBeforeSimulation,
        offerTeam: offerRosterProjection.requiresRepairBeforeSimulation,
      },
    },
  };
}

function validateTradeFinderOffer({ leagueData, selectedTeam, offer }) {
  return validateTradeFinderOfferDetailed({ leagueData, selectedTeam, offer }).ok;
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

function saveTradeBuilderFromOffer({ selectedTeam, offerTeam, selectedItems, offerItems, offer = null }) {
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
      tradeFinderEvaluation: offer?.evaluation || null,
      tradeFinderOfferMeta: offer
        ? {
            quality: offer.quality,
            offerValue: offer.offerValue,
            targetValue: offer.targetValue,
            gap: offer.gap,
            comfortMargin: offer.comfortMargin,
            finderEvaluationMode: offer.finderEvaluationMode,
            finderSearchPhase: offer.finderSearchPhase,
          }
        : null,
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

function AssetRow({ asset, selected, onToggle, pickRule, onPickRuleChange, leagueData, team, currentDate = null, selectedActionLabel = "Added", disabled = false, disabledLabel = "Max", disabledReason = "" }) {
  const isPlayer = asset.type === "player";
  const isResolvedPick = !isPlayer && isResolvedDraftPickAsset(asset.pick);
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
    ? formatTradeFinderPlayerContract(asset.player, leagueData)
    : isResolvedPick
      ? "Exact resolved draft pick"
      : `${protection || DEFAULT_PICK_PROTECTION} • Owns ${ownedRange?.start || "?"}-${ownedRange?.end || "?"}`;
  const headshotT = TRADE_FINDER_HEADSHOT_TUNING.packageRows;
  const ringT = TRADE_FINDER_RATING_RING_TUNING.packageRows;
  const rowT = TRADE_FINDER_PLAYER_ROW_TUNING.packageRows;
  const hasHeadshot = isPlayer && Boolean(playerHeadshotOf(asset.player));
  const actionDisabled = Boolean(disabled && !selected);
  const handleToggle = () => {
    if (actionDisabled) return;
    onToggle?.();
  };

  return (
    <div
      className={`relative overflow-hidden border transition ${
        selected
          ? "border-orange-400/60 bg-orange-500/15"
          : actionDisabled
            ? "border-white/10 bg-white/[0.025] opacity-45"
            : "border-white/10 bg-white/[0.035] hover:border-orange-400/30"
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
          onClick={handleToggle}
          disabled={actionDisabled}
          className={`min-w-0 flex flex-1 items-center text-left ${actionDisabled ? "cursor-not-allowed" : ""}`}
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
            {isPlayer && (
              <div className="mt-1 flex min-w-0 items-center gap-1.5">
                <TradeFinderInjuryBadge player={asset.player} currentDate={currentDate} compact />
              </div>
            )}
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
            {(actionDisabled || selected) && disabledReason && (
              <div className="mt-1 line-clamp-2 text-[10px] font-black leading-tight text-red-300">
                {disabledReason}
              </div>
            )}
          </div>
        </button>

        <button
          type="button"
          onClick={handleToggle}
          disabled={actionDisabled}
          className={`font-black transition ${
            selected
              ? "bg-orange-600 text-white"
              : actionDisabled
                ? "bg-black/70 text-neutral-500 cursor-not-allowed"
                : "bg-black text-neutral-300 hover:bg-white/10"
          }`}
          style={{
            borderRadius: rowT.buttonRadius,
            padding: `${rowT.buttonPadY}px ${rowT.buttonPadX}px`,
            fontSize: rowT.buttonTextSize,
            transform: `translate(${rowT.buttonX || 0}px, ${rowT.buttonY || 0}px)`,
          }}
        >
          {selected ? selectedActionLabel : actionDisabled ? disabledLabel : "Add"}
        </button>
      </div>

      {!isPlayer && selected && !isResolvedPick && (
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

function OfferAssetLine({ item, team, leagueData, currentDate = null }) {
  if (item.type === "player") {
    const headshotT = TRADE_FINDER_HEADSHOT_TUNING.offerRows;
    const ringT = TRADE_FINDER_RATING_RING_TUNING.offerRows;
    const rowT = TRADE_FINDER_PLAYER_ROW_TUNING.offerRows;
    const hasHeadshot = Boolean(playerHeadshotOf(item.player));
    const positionText = `${item.player?.pos || "-"}${item.player?.secondaryPos ? ` / ${item.player.secondaryPos}` : ""}`;
    const ageText = item.player?.age ? `Age ${item.player.age}` : "";
    const contractLine = formatTradeFinderPlayerContract(item.player, leagueData);

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
              <div className="mt-1 flex min-w-0 items-center gap-1.5">
                <TradeFinderInjuryBadge player={item.player} currentDate={currentDate} compact />
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
        {isResolvedDraftPickAsset(item.pick)
          ? formatResolvedDraftPickLabel(item.pick)
          : `${item.protection || DEFAULT_PICK_PROTECTION} ${formatPick(item.pick)}`}
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
  const teams = useMemo(
    () => [...getAllTeamsFromLeague(leagueData)].sort((a, b) =>
      String(a?.name || a?.teamName || "").localeCompare(String(b?.name || b?.teamName || ""))
    ),
    [leagueData]
  );
  const tradeContext = useMemo(() => getOffseasonTradeContext(leagueData), [leagueData]);
  const [packageTeamIndex, setPackageTeamIndex] = useState(() => {
    const index = teams.findIndex((team) => sameTeamName(team?.name || team?.teamName, selectedTeam?.name || selectedTeam?.teamName));
    return index >= 0 ? index : 0;
  });
  const packageTeam = teams[packageTeamIndex] || selectedTeam;
  const isReverseFinder = Boolean(packageTeam && selectedTeam && !sameTeamName(packageTeam?.name || packageTeam?.teamName, selectedTeam?.name || selectedTeam?.teamName));
  const [selectedAssetKeys, setSelectedAssetKeys] = useState([]);
  const [pickProtections, setPickProtections] = useState({});
  const [searched, setSearched] = useState(false);
  const [pythonOffers, setPythonOffers] = useState([]);
  const [isSearchingOffers, setIsSearchingOffers] = useState(false);
  const [offerSearchError, setOfferSearchError] = useState("");
  const [offerSearchProgress, setOfferSearchProgress] = useState("");
  const [offerSearchStopped, setOfferSearchStopped] = useState(false);
  const [liveDraftProgressSignature, setLiveDraftProgressSignature] = useState(() =>
    getLiveDraftProgressSignature(leagueData)
  );
  const offerSearchAbortRef = useRef(null);
  const lastDraftProgressSignatureRef = useRef(liveDraftProgressSignature);
  const packageTeamInitializedRef = useRef(false);
  const userTradeCurrentDate = useMemo(() => getUserTradeCurrentDate(leagueData), [leagueData]);
  const userDeadlineStatus = useMemo(() => getUserTradeDeadlineStatus(leagueData), [leagueData]);
  const tradeWindowLocked = Boolean(userDeadlineStatus.locked);
  const tradeLockMessage = userDeadlineStatus.reason || getTradeWindowLockMessage();

  const resetFinderWorkspace = ({ clearPackage = true } = {}) => {
    try { offerSearchAbortRef.current?.abort?.(); } catch {}
    offerSearchAbortRef.current = null;
    if (clearPackage) {
      setSelectedAssetKeys([]);
      setPickProtections({});
    }
    setSearched(false);
    setPythonOffers([]);
    setIsSearchingOffers(false);
    setOfferSearchError("");
    setOfferSearchProgress("");
    setOfferSearchStopped(false);
  };

  const changePackageTeam = (direction) => {
    if (!teams.length) return;
    resetFinderWorkspace({ clearPackage: true });
    setPackageTeamIndex((current) => (current + Number(direction || 0) + teams.length) % teams.length);
  };

  useEffect(() => {
    if (!teams.length || !selectedTeam) return;
    if (!packageTeamInitializedRef.current) {
      const selectedIndex = teams.findIndex((team) => sameTeamName(team?.name || team?.teamName, selectedTeam?.name || selectedTeam?.teamName));
      setPackageTeamIndex(selectedIndex >= 0 ? selectedIndex : 0);
      packageTeamInitializedRef.current = true;
      return;
    }
    if (packageTeamIndex < 0 || packageTeamIndex >= teams.length) setPackageTeamIndex(0);
  }, [teams, selectedTeam, packageTeamIndex]);

  const shouldPollLiveDraftProgress = Boolean(
    tradeContext?.inOffseason && tradeContext?.draftOrderLocked && !tradeContext?.draftComplete
  );

  useEffect(() => {
    const syncDraftProgress = () => {
      setLiveDraftProgressSignature(getLiveDraftProgressSignature(leagueData));
    };
    syncDraftProgress();
    if (!shouldPollLiveDraftProgress) return undefined;
    window.addEventListener("storage", syncDraftProgress);
    const intervalId = window.setInterval(syncDraftProgress, 1500);
    return () => {
      window.removeEventListener("storage", syncDraftProgress);
      window.clearInterval(intervalId);
    };
  }, [leagueData, shouldPollLiveDraftProgress]);

  useEffect(() => {
    if (lastDraftProgressSignatureRef.current === liveDraftProgressSignature) return;
    lastDraftProgressSignatureRef.current = liveDraftProgressSignature;

    try { offerSearchAbortRef.current?.abort?.(); } catch {}
    offerSearchAbortRef.current = null;
    setSearched(false);
    setPythonOffers([]);
    setOfferSearchProgress("");
    setOfferSearchStopped(false);
  }, [liveDraftProgressSignature]);

  const selectedTeamPlayers = useMemo(
    () => (getTeamPlayers(packageTeam) || []).filter(Boolean),
    [packageTeam]
  );
  const selectedTeamPicks = useMemo(
    () => collectTradeablePicksForSingleTeamForFinder(leagueData, packageTeam?.name || packageTeam?.teamName || "", teams),
    [leagueData, packageTeam, teams, liveDraftProgressSignature]
  );

  const playerAssets = useMemo(
    () => selectedTeamPlayers
      .map((player) => ({ type: "player", player, key: `player:${playerKey(player)}` }))
      .sort((a, b) => {
        const aOvr = Number(a.player?.overall || 0);
        const bOvr = Number(b.player?.overall || 0);
        if (aOvr !== bOvr) return bOvr - aOvr;
        const aPot = Number(a.player?.potential || aOvr);
        const bPot = Number(b.player?.potential || bOvr);
        if (aPot !== bPot) return bPot - aPot;
        return playerNameOf(a.player).localeCompare(playerNameOf(b.player));
      }),
    [selectedTeamPlayers]
  );

  const pickAssets = useMemo(
    () => selectedTeamPicks.map((pick) => ({ type: "pick", pick, key: `pick:${pickKey(pick)}` })),
    [selectedTeamPicks]
  );

  const allAssets = useMemo(() => [...playerAssets, ...pickAssets], [playerAssets, pickAssets]);
  const selectedKeySet = useMemo(() => new Set(selectedAssetKeys), [selectedAssetKeys]);
  const selectedPackageAssets = useMemo(
    () => allAssets.filter((asset) => selectedKeySet.has(asset.key)),
    [allAssets, selectedKeySet]
  );
  const availablePlayerAssets = useMemo(
    () => playerAssets.filter((asset) => !selectedKeySet.has(asset.key)),
    [playerAssets, selectedKeySet]
  );
  const availablePickAssets = useMemo(
    () => pickAssets.filter((asset) => !selectedKeySet.has(asset.key)),
    [pickAssets, selectedKeySet]
  );

  const selectedItems = useMemo(() => {
    return selectedPackageAssets.map((asset) => {
      if (asset.type === "pick") {
        return buildFinderPickItem(asset, pickProtections[asset.key]);
      }
      return asset;
    });
  }, [pickProtections, selectedPackageAssets]);

  const playerEligibilityByKey = useMemo(() => {
    const map = new Map();
    const teamName = packageTeam?.name || packageTeam?.teamName || "";
    for (const asset of playerAssets) {
      map.set(asset.key, getUserTradePlayerEligibility({ leagueData, teamName, player: asset.player, currentDate: userTradeCurrentDate }));
    }
    return map;
  }, [playerAssets, leagueData, packageTeam, userTradeCurrentDate]);

  const pickEligibilityByKey = useMemo(() => {
    const map = new Map();
    const teamName = packageTeam?.name || packageTeam?.teamName || "";
    for (const asset of pickAssets) {
      const item = buildFinderPickItem(asset, pickProtections[asset.key]);
      let eligibility = getUserTradePickEligibility({
        leagueData,
        teamName,
        pick: item.pick,
        item,
        outgoingItems: selectedItems,
        incomingItems: [],
      });

      // The pick eligibility helper already performs the projected Stepien check.
      // Do not also run full package validation for every row on every render;
      // keep that full validation for click/search/submit paths.
      if (
        !selectedKeySet.has(asset.key) &&
        eligibility?.code === "second_apron_furthest_first" &&
        canAddCustomProtectionToPick(asset.pick)
      ) {
        const ownedRange = getTradeablePickOwnedRange(asset.pick);
        const suggestedRule = { mode: "protected", protectEnd: ownedRange.start };
        const protectedItem = buildFinderPickItem(asset, suggestedRule);
        const protectedEligibility = getUserTradePickEligibility({
          leagueData,
          teamName,
          pick: protectedItem.pick,
          item: protectedItem,
          outgoingItems: selectedItems,
          incomingItems: [],
        });
        if (protectedEligibility.ok) {
          eligibility = {
            ...protectedEligibility,
            suggestedPickRule: suggestedRule,
            note: "This second-apron pick must carry protection to be traded.",
          };
        }
      }
      map.set(asset.key, eligibility);
    }
    return map;
  }, [pickAssets, leagueData, packageTeam, pickProtections, selectedItems, selectedKeySet]);

  const assetEligibilityByKey = useMemo(() => {
    return new Map([...playerEligibilityByKey, ...pickEligibilityByKey]);
  }, [playerEligibilityByKey, pickEligibilityByKey]);

  const selectedPackageValidation = useMemo(() => validateUserTradeAssetPackage({
    leagueData,
    teamName: packageTeam?.name || packageTeam?.teamName || "",
    outgoingItems: selectedItems,
    incomingItems: [],
  }), [leagueData, packageTeam, selectedItems]);

  const selectedValue = useMemo(() => packageValue(selectedItems, leagueData), [selectedItems, leagueData]);

  useEffect(() => {
    if (selectedAssetKeys.length <= MAX_TRADE_FINDER_PACKAGE_ASSETS) return;
    const trimmedKeys = selectedAssetKeys.slice(0, MAX_TRADE_FINDER_PACKAGE_ASSETS);
    const keepKeys = new Set(trimmedKeys);
    setSelectedAssetKeys(trimmedKeys);
    setPickProtections((prev) => {
      const next = {};
      for (const [key, value] of Object.entries(prev || {})) {
        if (keepKeys.has(key)) next[key] = value;
      }
      return next;
    });
    setSearched(false);
    setPythonOffers([]);
    setOfferSearchError("");
    setOfferSearchProgress("Trade Finder packages are limited to 8 assets. Extra assets were removed.");
    setOfferSearchStopped(false);
  }, [selectedAssetKeys]);
  const offers = useMemo(() => {
    if (!searched) return [];
    return (pythonOffers || []).filter((offer) => {
      const rows = [...(offer?.offer || []), ...(offer?.targetItems || [])];
      return !rows.some((item) => item?.type === "pick" && isResolvedPickConsumed(item.pick || {}, leagueData));
    });
  }, [searched, pythonOffers, leagueData, liveDraftProgressSignature]);

  const isPackageFull = selectedItems.length >= MAX_TRADE_FINDER_PACKAGE_ASSETS;

  useEffect(() => {
    return () => {
      try {
        offerSearchAbortRef.current?.abort?.();
      } catch {}
      offerSearchAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    // Trade Finder is intentionally a fresh workspace on every visit.
    // The loaded offer is stored in Trade Builder, but the Finder itself should
    // never reopen with a stale package or old result list.
    localStorage.removeItem(TRADE_FINDER_STATE_KEY);
    return () => localStorage.removeItem(TRADE_FINDER_STATE_KEY);
  }, []);

  const toggleAsset = (asset) => {
    const eligibility = assetEligibilityByKey.get(asset?.key);
    const alreadySelected = selectedAssetKeys.includes(asset?.key);
    if (!alreadySelected && eligibility?.ok === false) {
      setOfferSearchError(eligibility.reason || "This asset is not trade eligible.");
      setOfferSearchProgress("");
      return;
    }

    if (!alreadySelected && asset?.type === "pick") {
      const effectiveRule = eligibility?.suggestedPickRule || pickProtections[asset.key];
      const candidateItem = buildFinderPickItem(asset, effectiveRule);
      const projectedPackageValidation = validateUserTradeAssetPackage({
        leagueData,
        teamName: packageTeam?.name || packageTeam?.teamName || "",
        outgoingItems: [...selectedItems, candidateItem],
        incomingItems: [],
      });
      if (!projectedPackageValidation.ok) {
        setOfferSearchError(projectedPackageValidation.reason || "This pick cannot be added under the active trade rules.");
        setOfferSearchProgress("");
        return;
      }
      if (eligibility?.suggestedPickRule) {
        setPickProtections((current) => ({ ...current, [asset.key]: eligibility.suggestedPickRule }));
      }
    }
    setSearched(false);
    setPythonOffers([]);
    setOfferSearchError("");
    setOfferSearchProgress("");
    setOfferSearchStopped(false);

    let shouldPrimePickProtection = false;

    setSelectedAssetKeys((prev) => {
      if (prev.includes(asset.key)) return prev.filter((key) => key !== asset.key);
      if (prev.length >= MAX_TRADE_FINDER_PACKAGE_ASSETS) {
        setOfferSearchProgress(`Trade Finder packages are limited to ${MAX_TRADE_FINDER_PACKAGE_ASSETS} assets. Remove one asset before adding another.`);
        return prev;
      }
      shouldPrimePickProtection = asset.type === "pick";
      return [...prev, asset.key];
    });

    if (asset.type === "pick" && shouldPrimePickProtection) {
      setPickProtections((prev) => ({
        ...prev,
        [asset.key]: prev[asset.key] || normalizeFinderPickRule(asset.pick, null),
      }));
    }
  };

  const stopSearchOffers = () => {
    const controller = offerSearchAbortRef.current;
    if (!controller) return;

    try {
      controller.abort();
    } catch {}

    setOfferSearchStopped(true);
    setOfferSearchProgress("Stopping after the current CPU evaluation finishes...");
  };

  const runSearchOffers = async () => {
    if (tradeWindowLocked) {
      setOfferSearchError(tradeLockMessage);
      setSearched(true);
      return;
    }

    try {
      offerSearchAbortRef.current?.abort?.();
    } catch {}

    const controller = typeof AbortController !== "undefined"
      ? new AbortController()
      : { signal: { aborted: false }, abort() { this.signal.aborted = true; } };
    offerSearchAbortRef.current = controller;

    setSearched(true);
    setOfferSearchError("");
    setOfferSearchProgress("");
    setOfferSearchStopped(false);

    if (!selectedItems.length) {
      setPythonOffers([]);
      return;
    }

    const packageValidation = validateUserTradeAssetPackage({
      leagueData,
      teamName: packageTeam?.name || packageTeam?.teamName || "",
      outgoingItems: selectedItems,
      incomingItems: [],
    });
    if (!packageValidation.ok) {
      setPythonOffers([]);
      setOfferSearchError(packageValidation.reason || "This Trade Finder package contains an illegal asset.");
      return;
    }

    setIsSearchingOffers(true);
    setOfferSearchProgress("Starting Trade Finder search...");

    try {
      const standardProgress = (progress = {}) => {
          const teamIndex = Number(progress.teamIndex || 0);
          const teamsToCheck = Number(progress.teamsToCheck || 0);
          const offersFound = Number(progress.offersFound || 0);
          const teamName = progress.team || "CPU teams";
          const elapsed = Number(progress.elapsedSec || 0);

          if (progress.phase === "complete" || progress.phase === "stopped") {
            const wasStopped = progress.phase === "stopped";
            setOfferSearchStopped(wasStopped);
            setOfferSearchProgress(
              wasStopped
                ? `Stopped: checked ${teamIndex}/${teamsToCheck} teams, found ${offersFound} offer${offersFound === 1 ? "" : "s"} in ${elapsed.toFixed(1)}s.`
                : `Complete: checked ${teamsToCheck}/${teamsToCheck} teams, found ${offersFound} offer${offersFound === 1 ? "" : "s"} in ${elapsed.toFixed(1)}s.`
            );
            return;
          }

          if (progress.phase === "scan_start") {
            setOfferSearchProgress(
              `Pass 1/2: quick scanning all ${teamsToCheck} CPU teams...`
            );
            return;
          }

          if (progress.phase === "rescue_start") {
            setOfferSearchProgress(
              `Pass 1 bonus: rescuing missed teams until about ${Number(progress.rescueTarget || 0)} offers are found. Current offers: ${offersFound}.`
            );
            return;
          }

          if (progress.phase === "refine_start") {
            setOfferSearchProgress(
              `Pass 2/2: refining the top ${teamsToCheck} promising offer${teamsToCheck === 1 ? "" : "s"}. Offers found: ${offersFound}.`
            );
            return;
          }

          if (["team_done", "scan_team_done", "rescue_team_done", "refine_team_done"].includes(progress.phase)) {
            const phaseLabel = progress.phase.startsWith("scan")
              ? "Scanned"
              : progress.phase.startsWith("rescue")
                ? "Rescued"
                : progress.phase.startsWith("refine")
                  ? "Refined"
                  : "Checked";
            setOfferSearchProgress(
              `${phaseLabel} ${teamIndex}/${teamsToCheck}: ${teamName} (${Number(progress.teamMs || 0).toFixed(0)}ms, ${Number(progress.evaluationsForTeam || 0)} evals). Offers found: ${offersFound}.`
            );
            return;
          }

          if (["evaluating", "scan_evaluating", "rescue_evaluating", "refine_evaluating"].includes(progress.phase)) {
            const phaseLabel = progress.phase.startsWith("scan")
              ? "Quick scan"
              : progress.phase.startsWith("rescue")
                ? "Rescue scan"
                : progress.phase.startsWith("refine")
                  ? "Refining"
                  : "Checking";
            setOfferSearchProgress(
              `${phaseLabel} ${teamIndex}/${teamsToCheck}: ${teamName} • ${Number(progress.evaluationsForTeam || 0)} evaluations • Offers found: ${offersFound}.`
            );
            return;
          }

          if (["team_start", "scan_team_start", "rescue_team_start", "refine_team_start"].includes(progress.phase)) {
            const phaseLabel = progress.phase.startsWith("scan")
              ? "Quick scanning"
              : progress.phase.startsWith("rescue")
                ? "Rescue scanning"
                : progress.phase.startsWith("refine")
                  ? "Refining"
                  : "Checking";
            setOfferSearchProgress(
              `${phaseLabel} ${teamIndex}/${teamsToCheck}: ${teamName}... Offers found: ${offersFound}.`
            );
            return;
          }

          setOfferSearchProgress("Searching CPU teams...");
      };

      const reverseProgress = (progress = {}) => {
        const candidateIndex = Number(progress.candidateIndex || 0);
        const candidatesToCheck = Number(progress.candidatesToCheck || 0);
        const exactCandidates = Number(progress.exactCandidates || 0);
        const offersFound = Number(progress.offersFound || 0);
        const elapsed = Number(progress.elapsedSec || 0);
        if (progress.phase === "scan_start") {
          setOfferSearchProgress(`Quick scanning ${candidatesToCheck} legal package shapes from ${selectedTeam?.name || "your team"}...`);
          return;
        }
        if (progress.phase === "scan_candidate") {
          setOfferSearchProgress(`Quick scan ${candidateIndex}/${candidatesToCheck} • ${offersFound} promising package${offersFound === 1 ? "" : "s"} • ${elapsed.toFixed(1)}s`);
          return;
        }
        if (progress.phase === "exact_start") {
          setOfferSearchProgress(`Exact checking the strongest ${exactCandidates} candidates with Propose Trade logic...`);
          return;
        }
        if (progress.phase === "exact_candidate") {
          setOfferSearchProgress(`Exact check ${candidateIndex}/${exactCandidates} • ${offersFound} accepted package${offersFound === 1 ? "" : "s"} found • ${elapsed.toFixed(1)}s`);
          return;
        }
        if (progress.phase === "rescue_start") {
          setOfferSearchProgress(`First exact pass found too few results. Rescue checking ${exactCandidates} additional legal candidates...`);
          return;
        }
        if (progress.phase === "rescue_candidate") {
          setOfferSearchProgress(`Rescue exact check ${candidateIndex}/${exactCandidates} • ${offersFound} distinct accepted package${offersFound === 1 ? "" : "s"} • ${elapsed.toFixed(1)}s`);
          return;
        }
        if (progress.phase === "complete" || progress.phase === "stopped") {
          const stopped = progress.phase === "stopped";
          setOfferSearchStopped(stopped);
          setOfferSearchProgress(`${stopped ? "Stopped" : "Complete"}: found ${offersFound} distinct accepted package${offersFound === 1 ? "" : "s"} in ${elapsed.toFixed(1)}s.`);
        }
      };

      const userRuleLeagueData = attachUserTradeRuleContext(leagueData);
      const result = isReverseFinder
        ? await findComfortableReverseTradeFinderOffers({
            leagueData: userRuleLeagueData,
            controlledTeam: selectedTeam,
            targetTeam: packageTeam,
            targetItems: selectedItems,
            signal: controller.signal,
            maxResults: 5,
            onProgress: reverseProgress,
            userDrivenRules: true,
          })
        : await findComfortableTradeFinderOffers({
            leagueData: userRuleLeagueData,
            selectedTeam,
            selectedItems,
            teams,
            signal: controller.signal,
            onProgress: standardProgress,
            userDrivenRules: true,
          });

      const nextOffers = Array.isArray(result?.offers)
        ? result.offers.map((offer) => ({
            ...offer,
            offer: sortTradeFinderOfferItems(offer.offer, leagueData),
          }))
        : [];

      const diagnosticsOffers = nextOffers.map((offer) => {
        const userItems = isReverseFinder
          ? sortTradeFinderOfferItems(offer?.offer || [], leagueData)
          : selectedItems;
        const cpuItems = isReverseFinder
          ? selectedItems
          : sortTradeFinderOfferItems(offer?.offer || [], leagueData);
        const offerTeam = isReverseFinder ? packageTeam : offer.team;
        const preparedOffer = {
          ...offer,
          team: offerTeam,
          selectedItems: userItems,
          offer: cpuItems,
        };
        const loadValidation = validateTradeFinderOfferDetailed({
          leagueData,
          selectedTeam,
          offer: preparedOffer,
        });
        const duplicateAssetKeys = getDuplicateTradeFinderAssetKeys(userItems, cpuItems);

        return {
          team: offerTeam?.name || offerTeam?.teamName || offer?.teamName || "",
          userPlayerCount: countTradePlayers(userItems),
          cpuPlayerCount: countTradePlayers(cpuItems),
          userAssetCount: userItems.length,
          cpuAssetCount: cpuItems.length,
          asymmetricAllowed: true,
          duplicateAssetKeys,
          loadValidation,
          userRosterProjection: loadValidation?.details?.selectedRosterProjection || null,
          cpuRosterProjection: loadValidation?.details?.offerRosterProjection || null,
          userItems: tradeDebugItems(userItems, leagueData),
          cpuItems: tradeDebugItems(cpuItems, leagueData),
        };
      });

      const loadableOffers = nextOffers.filter(
        (_offer, index) => diagnosticsOffers[index]?.loadValidation?.ok === true
      );
      const displayedOfferDiagnostics = diagnosticsOffers.filter(
        (offerDiagnostics) => offerDiagnostics?.loadValidation?.ok === true
      );
      const rejectedGeneratedOffers = diagnosticsOffers.filter(
        (offerDiagnostics) => offerDiagnostics?.loadValidation?.ok !== true
      );

      recordTradeFinderSearchSnapshot({
        searchCompleted: !result?.stopped,
        stopped: Boolean(result?.stopped),
        reverseFinder: isReverseFinder,
        selectedTeam: selectedTeam?.name || selectedTeam?.teamName || "",
        packageTeam: packageTeam?.name || packageTeam?.teamName || "",
        selectedItems: tradeDebugItems(selectedItems, leagueData),
        resultMessage: result?.message || "",
        engineDiagnostics: result?.diagnostics || null,
        generatedOfferCount: nextOffers.length,
        displayedOfferCount: loadableOffers.length,
        offers: displayedOfferDiagnostics,
        rejectedGeneratedOffers,
      });

      if (isReverseFinder) {
        try {
          window.__BM_LAST_REVERSE_TRADE_FINDER__ = {
            ...(result?.diagnostics || {}),
            resultMessage: result?.message || "",
            generatedOfferCount: nextOffers.length,
            displayedOfferCount: loadableOffers.length,
            recordedAt: new Date().toISOString(),
          };
          console.groupCollapsed(
            `[BM REVERSE TRADE FINDER] ${selectedTeam?.name || "Your team"} searching for ${packageTeam?.name || "target team"} assets • ${loadableOffers.length} displayed offer${loadableOffers.length === 1 ? "" : "s"}`
          );
          console.table([window.__BM_LAST_REVERSE_TRADE_FINDER__]);
          console.log("Full reverse finder result", result);
          console.groupEnd();
        } catch {}
      }

      if (rejectedGeneratedOffers.length) {
        console.error(
          `[BM DIAGNOSTICS][TRADE FINDER PRE-DISPLAY FILTER] Removed ${rejectedGeneratedOffers.length} generated offer${rejectedGeneratedOffers.length === 1 ? "" : "s"} that failed the exact Load Offer validation.`,
          rejectedGeneratedOffers
        );
      }

      if (isTradeDebugEnabled()) {
        console.log("[TRADE DEBUG][FINDER RESULTS] Search finished", {
          selectedTeam: selectedTeam?.name || selectedTeam?.teamName || "",
          packageTeam: packageTeam?.name || packageTeam?.teamName || "",
          reverseFinder: isReverseFinder,
          selectedValue,
          selectedItems: tradeDebugItems(selectedItems, leagueData),
          offerCount: nextOffers.length,
          resultMessage: result?.message,
          stopped: Boolean(result?.stopped),
          offers: nextOffers.map((offer) => ({
            cpuTeam: offer?.team?.name || offer?.team?.teamName || offer?.teamName,
            quality: offer?.quality,
            offerValue: offer?.offerValue,
            targetValue: offer?.targetValue,
            gap: offer?.gap,
            comfortMargin: offer?.comfortMargin,
            score: offer?.score,
            accepted: offer?.accepted,
            decision: offer?.decision,
            debugBuilderAccepted: offer?.debugBuilderAccepted,
            assets: tradeDebugItems(offer?.offer || [], leagueData),
          })),
        });
      }

      setPythonOffers(loadableOffers);

      if (result?.stopped) {
        setOfferSearchStopped(true);
        setOfferSearchError(result?.message || "Search stopped. Showing partial offers found so far.");
      }

      if (!loadableOffers.length && !result?.stopped) {
        setOfferSearchError(
          rejectedGeneratedOffers.length
            ? "Trade Finder generated offers, but all were filtered before display because they failed exact ownership, salary, or temporary-roster validation. Run bmDiag.tradeFinder() in the console for the precise reasons."
            : result?.message || "No CPU team found a Propose Trade-legal package it would comfortably accept."
        );
      }
    } catch (error) {
      if (controller.signal?.aborted) {
        setOfferSearchStopped(true);
        setOfferSearchError("Search stopped. Showing any offers found before stopping.");
      } else {
        console.warn("[TradeFinder] offer search failed.", error);
        setPythonOffers([]);
        setOfferSearchError(error?.message || "Trade Finder failed while checking Propose Trade-compatible CPU offers.");
        setOfferSearchProgress("");
      }
    } finally {
      if (offerSearchAbortRef.current === controller) {
        offerSearchAbortRef.current = null;
      }
      setIsSearchingOffers(false);
    }
  };

  const loadOffer = (offer) => {
    const userItems = isReverseFinder ? sortTradeFinderOfferItems(offer?.offer || [], leagueData) : selectedItems;
    const cpuItems = isReverseFinder ? selectedItems : sortTradeFinderOfferItems(offer?.offer || [], leagueData);
    const offerTeam = isReverseFinder ? packageTeam : offer.team;
    const preparedOffer = { ...offer, team: offerTeam, selectedItems: userItems, offer: cpuItems };
    const validation = validateTradeFinderOfferDetailed({
      leagueData,
      selectedTeam,
      offer: preparedOffer,
    });

    recordTradeFinderLoadAttempt({
      selectedTeam: selectedTeam?.name || selectedTeam?.teamName || "",
      offerTeam: offerTeam?.name || offerTeam?.teamName || offer?.teamName || "",
      reverseFinder: isReverseFinder,
      userItems: tradeDebugItems(userItems, leagueData),
      cpuItems: tradeDebugItems(cpuItems, leagueData),
      validation,
    });

    if (!validation.ok) {
      setPythonOffers((prev) => (prev || []).filter((row) => row !== offer));
      setOfferSearchError(
        validation.reason ||
          "That offer is no longer available because its ownership, salary, or roster legality changed."
      );
      return;
    }

    debugTradeFinderLoadOffer({ leagueData, selectedTeam, selectedItems: userItems, offer: preparedOffer });

    saveTradeBuilderFromOffer({
      selectedTeam,
      offerTeam,
      selectedItems: userItems,
      offerItems: cpuItems,
      offer,
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

  if (tradeWindowLocked) {
    return (
      <PageFade>
        <div className="min-h-screen bmCourtPage text-white flex flex-col items-center justify-center px-4 text-center">
          <div className="max-w-xl rounded-3xl border border-orange-400/25 bg-neutral-950/85 p-8 shadow-2xl">
            <div className="text-xs font-black uppercase tracking-[0.24em] text-orange-300">Trade Finder Locked</div>
            <h1 className="mt-2 text-3xl font-black text-orange-500">Trade deadline passed</h1>
            <p className="mt-3 text-sm font-bold text-neutral-300">{tradeLockMessage}</p>
            <button onClick={() => navigate("/trades")} className="mt-6 rounded-xl bg-orange-600 px-6 py-3 font-bold hover:bg-orange-500">
              Back to Trade Center
            </button>
          </div>
        </div>
      </PageFade>
    );
  }

  return (
    <PageFade>
      <TradeFinderScrollbarStyles />
      <div className="min-h-screen bmCourtPage px-3 py-6 text-white">
        <div className="mx-auto w-full max-w-[1760px]">
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

          <div className="grid min-h-0 gap-5 xl:grid-cols-3">
            <div className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-white/10 bg-neutral-950/85 shadow-2xl">
              <div className="shrink-0 border-b border-white/10 bg-gradient-to-r from-orange-600/20 to-black px-4 py-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => changePackageTeam(-1)}
                    disabled={isSearchingOffers || teams.length <= 1}
                    aria-label="Previous team"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/35 text-xl font-black text-orange-200 transition hover:border-orange-400/35 hover:bg-orange-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ‹
                  </button>

                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {teamLogoOf(packageTeam) ? (
                      <img src={teamLogoOf(packageTeam)} alt={packageTeam?.name || "Team"} className="h-12 w-12 shrink-0 object-contain" />
                    ) : (
                      <div className="h-12 w-12 shrink-0 rounded-2xl bg-white/5" />
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-black uppercase tracking-[0.18em] text-orange-200">
                        {isReverseFinder ? "Browse Target" : "Browse Assets"}
                      </div>
                      <div className="mt-0.5 truncate text-xl font-black text-white">{packageTeam?.name}</div>
                      <div className="mt-1 text-[10px] font-black uppercase tracking-[0.16em] text-neutral-600">
                        Team {packageTeamIndex + 1} of {teams.length}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => changePackageTeam(1)}
                    disabled={isSearchingOffers || teams.length <= 1}
                    aria-label="Next team"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/35 text-xl font-black text-orange-200 transition hover:border-orange-400/35 hover:bg-orange-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ›
                  </button>
                </div>
              </div>

              <div className="tradeFinderScroller grid max-h-[70vh] min-h-0 gap-3 overflow-y-auto p-4">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">Players</div>
                    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-neutral-600">
                      {availablePlayerAssets.length} left
                    </div>
                  </div>
                  <div className="grid gap-2">
                    {availablePlayerAssets.length ? (
                      availablePlayerAssets.map((asset) => (
                        <AssetRow
                          key={asset.key}
                          asset={asset}
                          selected={false}
                          onToggle={() => toggleAsset(asset)}
                          leagueData={leagueData}
                          team={packageTeam}
                          currentDate={userTradeCurrentDate}
                          disabled={isPackageFull || assetEligibilityByKey.get(asset.key)?.ok === false}
                          disabledLabel={assetEligibilityByKey.get(asset.key)?.ok === false ? "Locked" : "Full"}
                          disabledReason={assetEligibilityByKey.get(asset.key)?.reason || ""}
                        />
                      ))
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-black/35 p-4 text-sm font-bold text-neutral-500">
                        {isPackageFull ? "Package is full. Remove an asset from the middle to add another player." : "Every available player is already in your package."}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-2 mt-1 flex items-center justify-between gap-2">
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">Draft Picks</div>
                    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-neutral-600">
                      {availablePickAssets.length} left
                    </div>
                  </div>
                  <div className="grid gap-2">
                    {availablePickAssets.length ? (
                      availablePickAssets.map((asset) => (
                        <AssetRow
                          key={asset.key}
                          asset={asset}
                          selected={false}
                          onToggle={() => toggleAsset(asset)}
                          pickRule={pickProtections[asset.key] || normalizeFinderPickRule(asset.pick, null)}
                          onPickRuleChange={(value) => {
                            setSearched(false);
                            setPythonOffers([]);
                            setOfferSearchError("");
                            setOfferSearchProgress("");
                            setOfferSearchStopped(false);
                            setPickProtections((prev) => ({ ...prev, [asset.key]: value }));
                          }}
                          leagueData={leagueData}
                          team={packageTeam}
                          currentDate={userTradeCurrentDate}
                          disabled={isPackageFull || assetEligibilityByKey.get(asset.key)?.ok === false}
                          disabledLabel={assetEligibilityByKey.get(asset.key)?.ok === false ? "Locked" : "Full"}
                          disabledReason={assetEligibilityByKey.get(asset.key)?.reason || ""}
                        />
                      ))
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-black/35 p-4 text-sm font-bold text-neutral-500">
                        {isPackageFull ? "Package is full. Remove an asset from the middle to add another pick." : pickAssets.length ? "Every tradeable pick is already in your package." : "No tradeable picks found for this team."}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-orange-400/20 bg-neutral-950/85 shadow-2xl">
              <div className="shrink-0 border-b border-orange-400/15 bg-orange-500/10 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-black uppercase tracking-[0.2em] text-orange-300">Trade Package</div>
                    <div className="mt-0.5 truncate text-xl font-black text-white">
                      {selectedItems.length ? `${selectedItems.length} asset${selectedItems.length === 1 ? "" : "s"}` : "Build Package"}
                    </div>
                    <div className="mt-1 text-xs font-bold text-orange-100/70">
                      Value {selectedValue.toFixed(1)} • Click remove to send assets back left
                    </div>
                  </div>
                  <div className="rounded-xl border border-orange-300/25 bg-black/35 px-3 py-2 text-xs font-black text-orange-100">
                    {selectedItems.length} / {MAX_TRADE_FINDER_PACKAGE_ASSETS}
                  </div>
                </div>
              </div>

              <div className="tradeFinderScroller max-h-[70vh] min-h-0 flex-1 overflow-y-auto p-4">
                {selectedPackageAssets.length ? (
                  <div className="grid gap-3">
                    {selectedPackageAssets.map((asset) => (
                      <AssetRow
                        key={`selected:${asset.key}`}
                        asset={asset}
                        selected
                        selectedActionLabel="Remove"
                        onToggle={() => toggleAsset(asset)}
                        pickRule={asset.type === "pick" ? pickProtections[asset.key] || normalizeFinderPickRule(asset.pick, null) : undefined}
                        onPickRuleChange={asset.type === "pick" ? (value) => {
                          setSearched(false);
                          setPythonOffers([]);
                          setOfferSearchError("");
                          setOfferSearchProgress("");
                          setOfferSearchStopped(false);
                          setPickProtections((prev) => ({ ...prev, [asset.key]: value }));
                        } : undefined}
                        leagueData={leagueData}
                        team={packageTeam}
                        currentDate={userTradeCurrentDate}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-black/35 p-4 text-sm font-bold leading-6 text-neutral-400">
                    Select players or picks from the left column. Your package will stay here while you search offers on the right.
                  </div>
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-white/10 bg-neutral-950/75 shadow-2xl">
              <div className="shrink-0 border-b border-white/10 bg-gradient-to-r from-neutral-900 to-black px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-black uppercase tracking-[0.2em] text-orange-300">
                      {isReverseFinder ? "CPU Asking Prices" : "Legal CPU Offers"}
                    </div>
                    <div className="mt-0.5 truncate text-2xl font-black text-white">
                      {isReverseFinder
                        ? (selectedItems.length ? `What ${packageTeam?.name} wants` : "Build a target package")
                        : (selectedItems.length ? "Offers Back" : "Build a package")}
                    </div>
                    <div className="mt-1 text-xs font-bold text-neutral-500">
                      {isReverseFinder
                        ? `Searches ${selectedTeam?.name} assets • 0–5 distinct comfortable packages`
                        : `One comfortable offer max per CPU team • Teams checked: ${Math.max(0, teams.length - 1)}`}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={runSearchOffers}
                      disabled={!selectedItems.length || isSearchingOffers || selectedPackageValidation.ok === false}
                      className="rounded-2xl bg-orange-600 px-5 py-2.5 text-sm font-black text-white transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSearchingOffers ? "Searching..." : selectedPackageValidation.ok === false ? "Illegal Package" : "Search Offers"}
                    </button>

                    {isSearchingOffers && (
                      <button
                        type="button"
                        onClick={stopSearchOffers}
                        className="rounded-2xl border border-red-300/35 bg-red-500/15 px-4 py-2.5 text-sm font-black text-red-100 transition hover:bg-red-500/25"
                      >
                        Stop
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="tradeFinderScroller max-h-[70vh] min-h-0 flex-1 overflow-y-auto p-4">
                {selectedItems.length > 0 && selectedPackageValidation.ok === false && (
                  <div className="mb-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm font-bold leading-6 text-red-100">
                    {selectedPackageValidation.reason || "This package contains an asset that cannot currently be traded."}
                  </div>
                )}

                {!searched && (
                  <div className="rounded-2xl border border-orange-400/25 bg-orange-500/10 p-4 text-sm font-bold leading-6 text-orange-100">
                    {isReverseFinder
                      ? `Build the ${packageTeam?.name} target package in the middle, then search for asking prices from ${selectedTeam?.name}.`
                      : "Build your package in the middle, then search for legal CPU offers back."}
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
                      {offerSearchStopped
                        ? "Stopping search after the current CPU evaluation finishes..."
                        : isReverseFinder
                          ? `${packageTeam?.name} is checking distinct asking-price packages from ${selectedTeam?.name}...`
                          : "CPU teams are building one comfortable legal offer each..."}
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
                    {isReverseFinder
                      ? `${packageTeam?.name} did not find a distinct legal asking price from ${selectedTeam?.name}.`
                      : "No CPU team found a legal comfortable offer for this package."}
                  </div>
                )}

                {searched && selectedItems.length > 0 && !isSearchingOffers && offers.length > 0 && (
                  <div className="grid gap-3">
                    {offers.map((offer, offerIndex) => (
                      <div
                        key={`${offer.team?.name || packageTeam?.name}:${offer.anchorKey || offerIndex}`}
                        className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition hover:border-orange-400/30 hover:bg-orange-500/10"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex min-w-0 items-center gap-3">
                            {teamLogoOf(isReverseFinder ? selectedTeam : offer.team) ? (
                              <img
                                src={teamLogoOf(isReverseFinder ? selectedTeam : offer.team)}
                                alt={(isReverseFinder ? selectedTeam : offer.team)?.name || "Team"}
                                className="h-10 w-10 object-contain"
                              />
                            ) : (
                              <div className="h-10 w-10 rounded-xl bg-white/5" />
                            )}
                            <div className="min-w-0">
                              <div className="truncate text-lg font-black text-white">
                                {isReverseFinder ? `Package ${offerIndex + 1}` : offer.team?.name}
                              </div>
                              <div className="text-[11px] font-black uppercase tracking-[0.12em] text-neutral-500">
                                {isReverseFinder
                                  ? `Built around ${offer.anchorLabel || "value base"} • Value ${Number(offer.offerValue || 0).toFixed(1)}`
                                  : `${offer.quality || "Accepted Offer"} • Value ${Number(offer.offerValue || 0).toFixed(1)}`}
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
                            <OfferAssetLine
                              key={`${offer.team?.name}-${offerIndex}-${item.label}-${index}`}
                              item={item}
                              team={isReverseFinder ? selectedTeam : offer.team}
                              leagueData={leagueData}
                              currentDate={userTradeCurrentDate}
                            />
                          ))}
                        </div>

                        <div className="mt-3 text-xs font-bold text-neutral-500">
                          {isReverseFinder
                            ? `${packageTeam?.name} comfort margin ${Number(offer.comfortMargin || 0) >= 0 ? "+" : ""}${Number(offer.comfortMargin || 0).toFixed(2)}.`
                            : `Finder gap ${Number(offer.gap || 0) >= 0 ? "+" : ""}${Number(offer.gap || 0).toFixed(1)} • CPU comfort ${Number(offer.comfortMargin || 0) >= 0 ? "+" : ""}${Number(offer.comfortMargin || 0).toFixed(2)}.`}
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
