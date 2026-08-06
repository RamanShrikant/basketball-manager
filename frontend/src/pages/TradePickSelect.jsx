import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import PageFade from "../components/PageFade";
import useKeyboardListNavigation from "../utils/useKeyboardListNavigation";
import { getOffseasonTradeContext } from "../utils/offseasonTradeContext.js";
import { getUserTradePickEligibility } from "../utils/userTradeRules.js";
import {
  canAddCustomProtectionToPick,
  canCreateSwapWithPick,
  getActiveSwapParticipantKeySet,
  getAllTeamsFromLeague,
  getDraftPickConflictKey,
  getDraftPickProtectionLabel,
  formatResolvedDraftPickLabel,
  getTeamLogoMap,
  getTradePickBaseProtectionLabel,
  getTradeablePickOwnedRange,
  isResolvedDraftPickAsset,
  isSwapDraftPickAsset,
  normalizeDraftPicks,
  normalizeTeamName,
  protectionDisplayForOwnedRange,
  sortDraftPickAssets,
  validateCustomPickProtection,
} from "../utils/draftPicks.js";
import {
  filterTradeableLiveDraftRows,
} from "../utils/liveDraftTradeAvailability.js";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";

const TRADE_BUILDER_KEY = "bm_trade_builder_v1";
const MAX_SIDE_ITEMS = 8;

function safeJSON(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
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

const TEAM_CODES = {
  "Atlanta Hawks": "ATL",
  "Boston Celtics": "BOS",
  "Brooklyn Nets": "BKN",
  "Charlotte Hornets": "CHA",
  "Chicago Bulls": "CHI",
  "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL",
  "Denver Nuggets": "DEN",
  "Detroit Pistons": "DET",
  "Golden State Warriors": "GSW",
  "Houston Rockets": "HOU",
  "Indiana Pacers": "IND",
  "Los Angeles Clippers": "LAC",
  "Los Angeles Lakers": "LAL",
  "Memphis Grizzlies": "MEM",
  "Miami Heat": "MIA",
  "Milwaukee Bucks": "MIL",
  "Minnesota Timberwolves": "MIN",
  "New Orleans Pelicans": "NOP",
  "New York Knicks": "NYK",
  "Oklahoma City Thunder": "OKC",
  "Orlando Magic": "ORL",
  "Philadelphia 76ers": "PHI",
  "Phoenix Suns": "PHX",
  "Portland Trail Blazers": "POR",
  "Sacramento Kings": "SAC",
  "San Antonio Spurs": "SAS",
  "Toronto Raptors": "TOR",
  "Utah Jazz": "UTA",
  "Washington Wizards": "WAS",
};

const CODE_ALIASES = {
  BRK: "BKN",
  BKN: "BKN",
  PHL: "PHI",
  PHI: "PHI",
  PHO: "PHX",
  PHX: "PHX",
  SA: "SAS",
  SAS: "SAS",
  GS: "GSW",
  GSW: "GSW",
  WSH: "WAS",
  WAS: "WAS",
  CHO: "CHA",
  CHA: "CHA",
  NO: "NOP",
  NOP: "NOP",
  UTH: "UTA",
  UTA: "UTA",
};

const KNOWN_CODES = new Set([
  ...Object.values(TEAM_CODES).filter(Boolean),
  ...Object.keys(CODE_ALIASES),
  ...Object.values(CODE_ALIASES),
]);

function canonicalTeamCode(code) {
  const upper = String(code || "").trim().toUpperCase();
  return CODE_ALIASES[upper] || upper;
}

function uniqueList(values = []) {
  const seen = new Set();
  return values.filter((value) => {
    const key = String(value || "").trim().toUpperCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getTeamCode(teamName = "", teamNames = []) {
  const raw = String(teamName || "").trim();
  if (!raw) return "";

  const directCode = canonicalTeamCode(raw);
  if (KNOWN_CODES.has(directCode)) return directCode;

  const exact = Object.entries(TEAM_CODES).find(([name]) => normalizeTeamName(name) === normalizeTeamName(raw));
  if (exact) return exact[1];

  const leagueHit = (teamNames || []).find((name) => normalizeTeamName(name) === normalizeTeamName(raw));
  if (leagueHit && TEAM_CODES[leagueHit]) return TEAM_CODES[leagueHit];

  return raw.length <= 4 ? raw.toUpperCase() : raw;
}

function extractCodesFromText(text = "", teamNames = []) {
  const value = String(text || "");
  const upper = value.toUpperCase();
  const codes = [];

  for (const code of KNOWN_CODES) {
    const regex = new RegExp(`\\b${code}\\b`, "i");
    if (regex.test(upper)) codes.push(canonicalTeamCode(code));
  }

  for (const teamName of teamNames || []) {
    if (upper.includes(String(teamName || "").toUpperCase())) {
      codes.push(getTeamCode(teamName, teamNames));
    }
  }

  return uniqueList(codes.map(canonicalTeamCode));
}

function getSwapParticipantNamesForDisplay(asset = {}, teamNames = []) {
  const structuredParticipants = Array.isArray(asset?.realLifeDetails?.swapParticipants)
    ? asset.realLifeDetails.swapParticipants
    : Array.isArray(asset?.swapParticipants)
    ? asset.swapParticipants
    : Array.isArray(asset?.swap?.participants)
    ? asset.swap.participants
    : [];

  const structuredCodes = uniqueList(
    structuredParticipants.flatMap((participant) => extractCodesFromText(participant, teamNames)).map(canonicalTeamCode)
  ).slice(0, 2);

  if (structuredCodes.length >= 2) return structuredCodes;

  const text = [asset.originalTeam, asset.originalTeamName, asset.swapWithTeam, asset.swap?.withTeam, structuredParticipants.join(" / ")]
    .filter(Boolean)
    .join(" / ");
  const codes = uniqueList(extractCodesFromText(text, teamNames).map(canonicalTeamCode)).slice(0, 2);
  if (codes.length >= 2) return codes;

  const fallback = [asset.originalTeam || asset.originalTeamName, asset.swapWithTeam || asset.swap?.withTeam]
    .filter(Boolean)
    .map((name) => getTeamCode(name, teamNames));
  return uniqueList(fallback).slice(0, 2);
}

function formatSwapParticipants(asset = {}, teamNames = []) {
  const parts = getSwapParticipantNamesForDisplay(asset, teamNames);
  return parts.length ? parts.join(" / ") : asset?.originalTeam || asset?.originalTeamName || "Swap Rights";
}

function readBuilder() {
  try {
    return JSON.parse(localStorage.getItem(TRADE_BUILDER_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveBuilder(builder) {
  localStorage.setItem(
    TRADE_BUILDER_KEY,
    JSON.stringify({ ...builder, updatedAt: Date.now() })
  );
}

function getSideItems(builder, side) {
  return side === "user" ? builder.userItems || [] : builder.cpuItems || [];
}

function setSideItems(builder, side, items) {
  if (side === "user") return { ...builder, userItems: items };
  return { ...builder, cpuItems: items };
}

function otherSideOf(side) {
  return side === "user" ? "cpu" : "user";
}

function getBuilderTeamName(builder, side) {
  return side === "user" ? builder.userTeamName || "" : builder.cpuTeamName || "";
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

function getPickOwnerName(row = {}) {
  return row.currentOwnerTeamName || row.ownerTeamName || row.teamName || row.ownerTeam || "";
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
    projectedRank: pickNumber || undefined,
    originalTeam,
    ownerTeam,
    owner: ownerTeam,
    displayProtection: "Resolved",
    protection: "Resolved",
    protections: "Resolved",
    status: "resolved",
    notes: row.draftPickProtection || row.swapProtectionLabel || "Resolved draft pick",
  };
}

function assetTypeLabel(asset) {
  const type = String(asset?.assetType || asset?.type || "pick").toLowerCase();
  if (type === "swap") return "Swap";
  if (type === "resolved") return "Resolved Pick";
  return "Pick";
}

function pickKey(pick) {
  return String(
    pick?.id ||
      pick?.pickId ||
      `${pick?.year || ""}_${pick?.round || ""}_${pick?.ownerTeam || pick?.owner || ""}_${pick?.originalTeam || ""}_${pick?.assetType || pick?.type || "pick"}`
  );
}

function itemKey(item) {
  if (item?.type === "pick") {
    const rule = item.tradeRule || item.pick?.tradeRule || {};
    if (rule.swapId) return `swap:${rule.swapId}:${rule.mirror ? "mirror" : "primary"}`;
    return `pick:${pickKey(item.pick)}:${rule.action || item.protection || "full"}`;
  }
  if (item?.type === "player") return `player:${item.player?.id || item.player?.name}`;
  return JSON.stringify(item);
}

function isSamePickItem(item, pick) {
  return item?.type === "pick" && pickKey(item.pick) === pickKey(pick);
}

function getAlreadyAddedPickKeys(items = []) {
  const keys = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.type === "pick" && item.pick) keys.add(pickKey(item.pick));
  }
  return keys;
}

function roundLabel(round) {
  return Number(round) === 1 ? "1st Round" : Number(round) === 2 ? "2nd Round" : `Round ${round || "?"}`;
}

function getPickNumberLabel(asset) {
  const pickNumber =
    asset?.pickNumber ??
    asset?.pickNo ??
    asset?.overallPick ??
    asset?.draftPickNumber ??
    asset?.resolvedPickNumber ??
    null;

  if (pickNumber !== null && pickNumber !== undefined && pickNumber !== "") {
    return `#${pickNumber}`;
  }

  return "--";
}

function compactProtectionLabel(asset) {
  const rawType = String(asset?.assetType || asset?.type || "").toLowerCase();
  if (rawType === "resolved") return "Resolved";

  const label = getDraftPickProtectionLabel(asset);
  if (!label || label === "none" || label === "null") return "Unprotected";
  return label;
}

function getOriginLabel(asset, teamNames = []) {
  if (assetTypeLabel(asset) === "Swap") return formatSwapParticipants(asset, teamNames);
  return asset?.originalTeam || asset?.originalTeamName || "Own";
}

function formatPick(asset) {
  if (isResolvedDraftPickAsset(asset)) return formatResolvedDraftPickLabel(asset);
  const pickNumber = getPickNumberLabel(asset);
  const numberSuffix = pickNumber !== "--" ? ` ${pickNumber}` : "";
  return `${asset?.year || "Future"} ${roundLabel(asset?.round)}${numberSuffix}`;
}


function shortRoundLabel(round) {
  return Number(round) === 1 ? "1st" : "2nd";
}

function defaultRoundRange(round = 1) {
  return Number(round || 1) === 2 ? { start: 31, end: 60 } : { start: 1, end: 30 };
}

function isFullOwnedRangeForPick(asset = {}) {
  const owned = getTradeablePickOwnedRange(asset);
  const full = defaultRoundRange(asset?.round || 1);
  return Number(owned?.start) === Number(full.start) && Number(owned?.end) === Number(full.end);
}

function buildPickShortName(asset = {}, teamNames = []) {
  if (isResolvedDraftPickAsset(asset)) return formatResolvedDraftPickLabel(asset);
  const year = asset?.year || "Future";
  const teamCode = getTeamCode(asset?.originalTeam || asset?.originalTeamName || "Own", teamNames);
  return `${year} ${teamCode} ${shortRoundLabel(asset?.round)}`;
}

function buildAddedProtectionDisplayLabel(asset = {}, validation = {}, teamNames = []) {
  const conveyed = validation.conveyedRange || null;
  const conveyText = conveyed ? ` — ${conveyed.start}-${conveyed.end} conveys` : "";
  return `Add Protection: ${validation.baseProtectionLabel || "Protected"}${conveyText} (${buildPickShortName(asset, teamNames)})`;
}

function buildFullOwnedPieceDisplayLabel(asset = {}, teamNames = []) {
  if (isResolvedDraftPickAsset(asset)) return formatResolvedDraftPickLabel(asset);
  if (isSwapDraftPickAsset(asset)) return buildExistingSwapDisplayLabel(asset, teamNames);
  const owned = getTradeablePickOwnedRange(asset);
  const full = defaultRoundRange(asset?.round || 1);
  const base = getTradePickBaseProtectionLabel(asset) || compactProtectionLabel(asset);
  const pickName = buildPickShortName(asset, teamNames);

  if (owned && (Number(owned.start) !== Number(full.start) || Number(owned.end) !== Number(full.end))) {
    return `Range Rights: Owns ${owned.start}-${owned.end} (${pickName})`;
  }

  if (base && !["Unprotected", "Resolved"].includes(base)) {
    return `Protected Pick: ${base} (${pickName})`;
  }

  return undefined;
}

function isDirectPickOccupiedBySwap(pick = {}, activeSwapKeys = new Set(), leagueData = null) {
  if (!pick || typeof pick !== "object") return false;
  if (isSwapDraftPickAsset(pick) || isResolvedDraftPickAsset(pick)) return false;
  const key = getDraftPickConflictKey(pick, leagueData);
  return Boolean(key && activeSwapKeys?.has?.(key));
}

function getFastEncumbranceReason(pick = {}, activeSwapKeys = new Set(), leagueData = null) {
  if (!isDirectPickOccupiedBySwap(pick, activeSwapKeys, leagueData)) return "";
  const roundText = Number(pick?.round || 1) === 1 ? "1st" : "2nd";
  const original = pick?.originalTeam || pick?.originalTeamName || "this pick";
  return `${pick?.year || "Future"} ${roundText} - ${original} is already tied to an active swap right.`;
}

function collectTradeablePicks({ leagueData, teamName, teamNames, activeSwapKeys }) {
  if (!leagueData || !teamName) return [];

  const seasonYear = getSeasonYearFromLeague(leagueData);
  const tradeContext = getOffseasonTradeContext(leagueData);
  const draftOrder = tradeContext?.draftOrderLocked
    ? tradeContext.draftOrder
    : readLockedDraftOrder(leagueData, seasonYear);
  const draftComplete = tradeContext?.inOffseason
    ? Boolean(tradeContext.draftComplete)
    : isDraftCompleteForSeason(leagueData, seasonYear);
  const draftOrderLocked = Boolean(tradeContext?.draftOrderLocked || draftOrder.length > 0);

  const normalizedFuturePicks = normalizeDraftPicks(leagueData?.draftPicks || [], teamNames)
    .filter((pick) => String(pick.status || "active").toLowerCase() === "active")
    .filter((pick) => Number(pick.year || 0) >= Number(seasonYear))
    .filter((pick) => !(draftComplete && Number(pick.year || 0) === Number(seasonYear)))
    .filter((pick) => !(draftOrderLocked && !draftComplete && Number(pick.year || 0) === Number(seasonYear)))
    .filter((pick) => !isDirectPickOccupiedBySwap(pick, activeSwapKeys, leagueData));

  const resolvedCurrentYearPicks =
    draftOrderLocked && !draftComplete
      ? filterTradeableLiveDraftRows(draftOrder, leagueData, seasonYear)
          .map((row) => buildResolvedDraftAsset(row, seasonYear))
          .filter(Boolean)
      : [];

  const activeKey = normalizeTeamName(teamName);
  const rows = [...resolvedCurrentYearPicks, ...normalizedFuturePicks]
    .filter((pick) => normalizeTeamName(pick.ownerTeam || pick.owner || "") === activeKey)
    .sort(sortDraftPickAssets);

  const seen = new Set();
  return rows.filter((pick) => {
    const key = pickKey(pick);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildTradePickPayload(asset, protection, tradeRule = null) {
  const protectionLabel = protection || compactProtectionLabel(asset) || "Unprotected";
  const pickNumber = Number(asset?.pickNumber || asset?.overallPick || asset?.resolvedPickNumber || 0);

  return {
    ...asset,
    id: pickKey(asset),
    owner: asset?.ownerTeam || asset?.owner || "",
    ownerTeam: asset?.ownerTeam || asset?.owner || "",
    originalTeam: asset?.originalTeam || asset?.originalTeamName || "Own",
    year: asset?.year || asset?.seasonYear || "Future",
    round: Number(asset?.round || 1),
    projectedRank: asset?.projectedRank || asset?.recordRank || asset?.expectedRank || pickNumber || undefined,
    protection: protectionLabel,
    protections: protectionLabel,
    displayProtection: protectionLabel,
    tradeRule: tradeRule || undefined,
  };
}

function defaultProtectionEnd(asset) {
  const owned = getTradeablePickOwnedRange(asset);
  const round = Number(asset?.round || 1) === 2 ? 2 : 1;
  const preferred = round === 1 && owned.start === 1 ? 14 : owned.start + 4;
  return Math.max(owned.start, Math.min(owned.end - 1, preferred));
}

function inverseSwapDirection(direction) {
  return direction === "worst" ? "best" : "worst";
}

function swapDirectionLabel(direction) {
  return direction === "worst" ? "Swap Worst" : "Swap Best";
}

function buildSwapDisplayLabel(direction, sourcePick, swapPick, teamNames = []) {
  const label = swapDirectionLabel(direction);
  const suffix = Number(sourcePick?.round || 1) === 1 ? "1st" : "2nd";
  const participants = [sourcePick?.originalTeam || sourcePick?.originalTeamName, swapPick?.originalTeam || swapPick?.originalTeamName]
    .filter(Boolean)
    .map((name) => getTeamCode(name, teamNames))
    .join(" / ");
  return `${label} ${sourcePick?.year || "Future"} ${suffix} - ${participants || "Pick A / Pick B"}`;
}

function buildExistingSwapDisplayLabel(asset, teamNames = []) {
  const label = compactProtectionLabel(asset);
  const suffix = Number(asset?.round || 1) === 1 ? "1st" : "2nd";
  return `${label} ${asset?.year || "Future"} ${suffix} - ${formatSwapParticipants(asset, teamNames)}`;
}

export default function TradePickSelect() {
  const navigate = useNavigate();
  const location = useLocation();
  const { leagueData } = useGame();
  const tradeSide = location.state?.tradeSide || "user";
  const tradeTeamName = location.state?.tradeTeamName || "";
  const returnTo = location.state?.returnTo || "/propose-trade";

  const teams = useMemo(() => getAllTeamsFromLeague(leagueData), [leagueData]);
  const teamNames = useMemo(
    () => teams.map((team) => team?.name || team?.teamName).filter(Boolean),
    [teams]
  );
  const logoMap = useMemo(() => getTeamLogoMap(leagueData), [leagueData]);
  const team = teams.find((t) => (t?.name || t?.teamName) === tradeTeamName) || null;
  const teamLogo = logoMap[normalizeTeamName(tradeTeamName)] || teamLogoOf(team);

  const builderSnapshot = useMemo(() => readBuilder(), []);
  const currentSideItems = useMemo(
    () => getSideItems(builderSnapshot, tradeSide),
    [builderSnapshot, tradeSide]
  );
  const otherTradeSide = otherSideOf(tradeSide);
  const otherSideItems = useMemo(
    () => getSideItems(builderSnapshot, otherTradeSide),
    [builderSnapshot, otherTradeSide]
  );
  const alreadyAddedPickKeys = useMemo(
    () => getAlreadyAddedPickKeys(currentSideItems),
    [currentSideItems]
  );
  const otherSideAddedPickKeys = useMemo(
    () => getAlreadyAddedPickKeys(otherSideItems),
    [otherSideItems]
  );
  const sideItemCount = currentSideItems.length;
  const sideIsFull = sideItemCount >= MAX_SIDE_ITEMS;
  const otherTeamName = getBuilderTeamName(builderSnapshot, otherTradeSide);
  const activeSwapKeys = useMemo(
    () => getActiveSwapParticipantKeySet(leagueData?.draftPicks || [], leagueData),
    [leagueData]
  );

  const picks = useMemo(
    () => collectTradeablePicks({ leagueData, teamName: tradeTeamName, teamNames, activeSwapKeys }),
    [activeSwapKeys, leagueData, tradeTeamName, teamNames]
  );

  const otherTeamPicks = useMemo(
    () => collectTradeablePicks({ leagueData, teamName: otherTeamName, teamNames, activeSwapKeys }),
    [activeSwapKeys, leagueData, otherTeamName, teamNames]
  );

  const rowEligibilityByKey = useMemo(() => {
    const map = new Map();
    for (const pick of picks) {
      const canPreviewAsProtected = canAddCustomProtectionToPick(pick);
      const previewItem = {
        type: "pick",
        teamName: tradeTeamName,
        pick,
        // Preview a protectable pick as protected so the second-apron rule does
        // not hide an asset that can still be moved legally with protection.
        // Picks that cannot accept protection are previewed as their full asset.
        // Stepien still evaluates either version as an outgoing future first.
        tradeRule: { action: canPreviewAsProtected ? "protected" : "full" },
        protection: canPreviewAsProtected ? "Protected" : getTradePickBaseProtectionLabel(pick),
      };
      map.set(pickKey(pick), getUserTradePickEligibility({
        leagueData,
        teamName: tradeTeamName,
        pick,
        item: previewItem,
        outgoingItems: currentSideItems,
        incomingItems: otherSideItems,
      }));
    }
    return map;
  }, [currentSideItems, leagueData, otherSideItems, picks, tradeTeamName]);

  const [selectedKey, setSelectedKey] = useState("");
  const [rulePickKey, setRulePickKey] = useState("");
  const [ruleMode, setRuleMode] = useState("full");
  const [protectEnd, setProtectEnd] = useState(0);
  const [swapDirection, setSwapDirection] = useState("best");
  const [selectedSwapKey, setSelectedSwapKey] = useState("");
  const [ruleError, setRuleError] = useState("");

  useEffect(() => {
    if (!picks.length) {
      setSelectedKey("");
      return;
    }

    setSelectedKey((prev) => {
      const prevStillAvailable = prev && picks.some((pick) => pickKey(pick) === prev) && !alreadyAddedPickKeys.has(prev) && rowEligibilityByKey.get(prev)?.ok !== false;
      if (prevStillAvailable) return prev;
      const firstAvailable = picks.find((pick) => {
        const key = pickKey(pick);
        return !alreadyAddedPickKeys.has(key) && rowEligibilityByKey.get(key)?.ok !== false;
      });
      return pickKey(firstAvailable || picks[0]);
    });
  }, [alreadyAddedPickKeys, picks, rowEligibilityByKey]);

  const selectedPick = picks.find((pick) => pickKey(pick) === selectedKey) || picks[0] || null;

  useKeyboardListNavigation({
    items: picks,
    selectedItem: selectedPick,
    onSelect: (pick) => setSelectedKey(pickKey(pick)),
    getKey: pickKey,
    rowSelector: "[data-bm-trade-pick-row-index]",
  });
  const selectedPickAlreadyAdded = Boolean(selectedPick && alreadyAddedPickKeys.has(pickKey(selectedPick)));
  const selectedPickEligibility = selectedPick ? rowEligibilityByKey.get(pickKey(selectedPick)) : null;
  const selectedPickRuleLocked = Boolean(selectedPickEligibility?.ok === false);
  const canOpenSelectedPick = Boolean(selectedPick && !selectedPickAlreadyAdded && !selectedPickRuleLocked && !sideIsFull);
  const rulePick = picks.find((pick) => pickKey(pick) === rulePickKey) || null;
  const ownedRange = rulePick ? getTradeablePickOwnedRange(rulePick) : null;
  const rulePickEncumbrance = rulePick ? getFastEncumbranceReason(rulePick, activeSwapKeys, leagueData) : "";
  const canProtect = rulePick ? canAddCustomProtectionToPick(rulePick) : false;
  const canSwapBase = rulePick ? canCreateSwapWithPick(rulePick) && !rulePickEncumbrance : false;
  const swapCandidates = useMemo(() => {
    if (!rulePick || !canSwapBase || !otherTeamName) return [];
    return otherTeamPicks.filter(
      (pick) =>
        Number(pick.year || 0) === Number(rulePick.year || 0) &&
        Number(pick.round || 0) === Number(rulePick.round || 0) &&
        canCreateSwapWithPick(pick) &&
        !isDirectPickOccupiedBySwap(pick, activeSwapKeys, leagueData) &&
        !otherSideAddedPickKeys.has(pickKey(pick))
    );
  }, [activeSwapKeys, canSwapBase, leagueData, otherSideAddedPickKeys, otherTeamName, otherTeamPicks, rulePick]);
  const canSwap = canSwapBase && swapCandidates.length > 0;
  const swapUnavailableReason = rulePickEncumbrance
    ? rulePickEncumbrance
    : canSwapBase
    ? `Unavailable: no valid fully unprotected matching ${rulePick?.year || "future"} ${roundLabel(rulePick?.round)} pick found for ${otherTeamName || "the other team"}.`
    : "Swaps are only available for fully unprotected normal picks. Protected picks and swap rights cannot be swapped.";
  const selectedSwapPick = swapCandidates.find((pick) => pickKey(pick) === selectedSwapKey) || swapCandidates[0] || null;

  const openRuleModal = (pick) => {
    if (!pick) return;
    const key = pickKey(pick);
    const rowEligibility = rowEligibilityByKey.get(key);
    if (rowEligibility?.ok === false) {
      setRuleError(rowEligibility.reason || "This pick is not trade eligible.");
      return;
    }
    if (alreadyAddedPickKeys.has(key)) {
      setRuleError("That pick is already in this trade package. Remove it from the builder before adding it again.");
      return;
    }
    if (sideIsFull) {
      setRuleError(`This side already has ${MAX_SIDE_ITEMS} trade items.`);
      return;
    }
    const encumbrance = getFastEncumbranceReason(pick, activeSwapKeys, leagueData);
    if (encumbrance) {
      setRuleError(encumbrance);
      return;
    }

    if (isResolvedDraftPickAsset(pick)) {
      const tradeRule = {
        action: "full",
        ownedRange: getTradeablePickOwnedRange(pick),
        source: "trade_pick_select_resolved_exact_v3",
      };
      const nextPick = buildTradePickPayload(pick, "Resolved", tradeRule);
      addItemsToBuilder({
        type: "pick",
        teamName: tradeTeamName,
        protection: "Resolved",
        tradeRule,
        displayLabel: formatResolvedDraftPickLabel(pick),
        pick: nextPick,
      });
      return;
    }

    const fullEligibility = getUserTradePickEligibility({
      leagueData,
      teamName: tradeTeamName,
      pick,
      item: { type: "pick", teamName: tradeTeamName, pick, tradeRule: { action: "full" } },
      outgoingItems: currentSideItems,
      incomingItems: otherSideItems,
    });
    const canUseProtection = canAddCustomProtectionToPick(pick);

    setSelectedKey(key);
    setRulePickKey(key);
    setRuleMode(!fullEligibility.ok && fullEligibility.code === "second_apron_furthest_first" && canUseProtection ? "protected" : "full");
    setProtectEnd(defaultProtectionEnd(pick));
    setSwapDirection("best");
    setSelectedSwapKey("");
    setRuleError("");
  };

  useEffect(() => {
    if (!rulePick || !swapCandidates.length) {
      setSelectedSwapKey("");
      return;
    }
    setSelectedSwapKey((prev) => {
      if (prev && swapCandidates.some((pick) => pickKey(pick) === prev)) return prev;
      return pickKey(swapCandidates[0]);
    });
  }, [rulePickKey, swapCandidates]);

  useEffect(() => {
    if (ruleMode === "swap" && !canSwap) setRuleMode("full");
  }, [canSwap, ruleMode]);

  const addItemsToBuilder = (primaryItem, mirrorItem = null) => {
    const primaryEligibility = getUserTradePickEligibility({
      leagueData,
      teamName: tradeTeamName,
      pick: primaryItem?.pick,
      item: primaryItem,
      outgoingItems: currentSideItems,
      incomingItems: otherSideItems,
    });
    if (!primaryEligibility.ok) {
      setRuleError(primaryEligibility.reason || "This pick is not trade eligible.");
      return;
    }
    if (mirrorItem) {
      const mirrorEligibility = getUserTradePickEligibility({
        leagueData,
        teamName: otherTeamName,
        pick: mirrorItem?.pick,
        item: mirrorItem,
        outgoingItems: otherSideItems,
        incomingItems: currentSideItems,
      });
      if (!mirrorEligibility.ok) {
        setRuleError(mirrorEligibility.reason || "The linked swap pick is not trade eligible.");
        return;
      }
    }

    const builder = readBuilder();
    const currentItems = getSideItems(builder, tradeSide);
    const currentOtherItems = getSideItems(builder, otherTradeSide);

    if (currentItems.some((item) => isSamePickItem(item, primaryItem.pick))) {
      setRuleError("That pick is already in this trade package. Remove it from the builder before adding it again.");
      return;
    }
    if (currentItems.length >= MAX_SIDE_ITEMS) {
      setRuleError(`This side already has ${MAX_SIDE_ITEMS} trade items.`);
      return;
    }

    const nextPrimaryItems = [...currentItems, primaryItem];

    let nextOtherItems = currentOtherItems;
    if (mirrorItem) {
      if (currentOtherItems.some((item) => isSamePickItem(item, mirrorItem.pick))) {
        setRuleError("The linked swap pick is already in the other side of this trade package.");
        return;
      }
      if (currentOtherItems.length >= MAX_SIDE_ITEMS) {
        setRuleError(`The other side already has ${MAX_SIDE_ITEMS} trade items, so the linked swap cannot be added.`);
        return;
      }
      nextOtherItems = [...currentOtherItems, mirrorItem];
    }

    let nextBuilder = setSideItems(builder, tradeSide, nextPrimaryItems);
    if (mirrorItem) nextBuilder = setSideItems(nextBuilder, otherTradeSide, nextOtherItems);
    saveBuilder(nextBuilder);
    sessionStorage.setItem("bm_trade_builder_resume_v1", String(Date.now()));
    navigate(returnTo, { state: { resumeTradeBuilder: true } });
  };

  const addConfiguredPick = () => {
    if (!rulePick) return;
    setRuleError("");

    if (ruleMode === "protected") {
      const validation = validateCustomPickProtection(rulePick, ownedRange?.start, protectEnd);
      if (!validation.ok) {
        setRuleError(validation.reason);
        return;
      }

      const tradeRule = {
        action: "protected",
        protectStart: validation.retainedRange.start,
        protectEnd: validation.retainedRange.end,
        retainedRange: validation.retainedRange,
        conveyedRange: validation.conveyedRange,
        ownedRange: validation.ownedRange,
        baseProtectionLabel: validation.baseProtectionLabel,
        source: "trade_pick_select_v2",
      };
      const nextPick = buildTradePickPayload(rulePick, validation.baseProtectionLabel, tradeRule);
      const nextItem = {
        type: "pick",
        teamName: tradeTeamName,
        protection: validation.baseProtectionLabel,
        tradeRule,
        displayLabel: buildAddedProtectionDisplayLabel(rulePick, validation, teamNames),
        pick: nextPick,
      };
      addItemsToBuilder(nextItem);
      return;
    }

    if (ruleMode === "swap") {
      if (!canSwap) {
        setRuleError(swapUnavailableReason);
        return;
      }
      if (!selectedSwapPick) {
        setRuleError(`No matching fully unprotected ${rulePick.year} ${roundLabel(rulePick.round)} pick was found for ${otherTeamName}.`);
        return;
      }
      const selectedSwapEncumbrance = getFastEncumbranceReason(selectedSwapPick, activeSwapKeys, leagueData);
      if (selectedSwapEncumbrance) {
        setRuleError(selectedSwapEncumbrance);
        return;
      }

      const swapId = `swap_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const primaryLabel = swapDirectionLabel(swapDirection);
      const mirrorDirection = inverseSwapDirection(swapDirection);
      const mirrorLabel = swapDirectionLabel(mirrorDirection);
      const tradeRule = {
        action: "swap",
        swapId,
        swapDirection,
        swapRightHolder: otherTeamName,
        fromTeamName: tradeTeamName,
        toTeamName: otherTeamName,
        sourcePick: rulePick,
        swapPick: selectedSwapPick,
        source: "trade_pick_select_v2",
      };
      const mirrorRule = {
        ...tradeRule,
        mirror: true,
        swapDirection: mirrorDirection,
        swapRightHolder: tradeTeamName,
      };

      const primaryPick = buildTradePickPayload(rulePick, primaryLabel, tradeRule);
      const mirrorPick = buildTradePickPayload(selectedSwapPick, mirrorLabel, mirrorRule);
      const primaryItem = {
        type: "pick",
        teamName: tradeTeamName,
        protection: primaryLabel,
        tradeRule,
        displayLabel: buildSwapDisplayLabel(swapDirection, rulePick, selectedSwapPick, teamNames),
        pick: primaryPick,
      };
      const mirrorItem = {
        type: "pick",
        teamName: otherTeamName,
        protection: mirrorLabel,
        tradeRule: mirrorRule,
        tradeValueExcluded: true,
        displayOnlyLinkedSwap: true,
        displayLabel: buildSwapDisplayLabel(mirrorDirection, selectedSwapPick, rulePick, teamNames),
        pick: mirrorPick,
      };
      addItemsToBuilder(primaryItem, mirrorItem);
      return;
    }

    const baseProtection = getTradePickBaseProtectionLabel(rulePick) || compactProtectionLabel(rulePick);
    const tradeRule = {
      action: "full",
      ownedRange: getTradeablePickOwnedRange(rulePick),
      source: "trade_pick_select_v2",
    };
    const nextPick = buildTradePickPayload(rulePick, baseProtection, tradeRule);
    const nextItem = {
      type: "pick",
      teamName: tradeTeamName,
      protection: nextPick.protection,
      tradeRule,
      displayLabel: buildFullOwnedPieceDisplayLabel(rulePick, teamNames),
      pick: nextPick,
    };
    addItemsToBuilder(nextItem);
  };

  const modalProtectionValidation = rulePick && ownedRange
    ? validateCustomPickProtection(rulePick, ownedRange.start, protectEnd)
    : { ok: false, reason: "No pick selected." };
  const fullModeEligibility = rulePick
    ? getUserTradePickEligibility({
        leagueData,
        teamName: tradeTeamName,
        pick: rulePick,
        item: { type: "pick", teamName: tradeTeamName, pick: rulePick, tradeRule: { action: "full" } },
        outgoingItems: currentSideItems,
        incomingItems: otherSideItems,
      })
    : { ok: true };
  const configuredModeLocked = Boolean(ruleMode === "full" && fullModeEligibility.ok === false);

  return (
    <PageFade>
      <div className="bmCourtPage h-full min-h-0 overflow-hidden p-3 text-white">
        <div className="mx-auto flex h-full min-h-0 w-full max-w-[1520px] flex-col">
          <div className="mb-2 flex h-[54px] shrink-0 items-center justify-between gap-4">
            <button
              onClick={() => {
                sessionStorage.setItem("bm_trade_builder_resume_v1", String(Date.now()));
                navigate(returnTo, { state: { resumeTradeBuilder: true } });
              }}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-neutral-200 hover:bg-white/10 hover:text-white"
            >
              ← Back
            </button>

            <div className="text-center">
              <div className="text-xs font-black uppercase tracking-[0.22em] text-orange-300">Select Pick</div>
              <h1 className="text-2xl font-black text-orange-500">{tradeTeamName}</h1>
            </div>

            <button
              onClick={() => openRuleModal(selectedPick)}
              disabled={!canOpenSelectedPick}
              className="rounded-xl bg-orange-600 px-5 py-2 text-sm font-black text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {selectedPickAlreadyAdded ? "Already Added" : selectedPickRuleLocked ? "Trade Locked" : sideIsFull ? "Limit Reached" : "Add Pick"}
            </button>
          </div>

          <div className="mb-2 shrink-0 rounded-xl border border-white/10 bg-neutral-950/85 px-4 py-2">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {teamLogo ? (
                  <img src={teamLogo} alt={team?.name || tradeTeamName} className="h-9 w-9 object-contain" />
                ) : (
                  <div className="h-12 w-12 rounded-full bg-white/5" />
                )}
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500">Pick Rules</div>
                  <div className="text-sm font-black text-white">Choose the asset and rule.</div>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-neutral-300">
                {sideItemCount}/{MAX_SIDE_ITEMS} items used
              </div>
            </div>
          </div>

          {!picks.length ? (
            <div className="rounded-2xl border border-white/10 bg-neutral-950/85 p-8 text-center">
              <div className="text-2xl font-black text-white">No draft assets found for this team</div>
              <p className="mt-2 text-sm font-semibold text-neutral-500">
                This selector reads the same normalized leagueData.draftPicks source used by the Draft Picks page.
              </p>
            </div>
          ) : (
            <div className="bmTableScroller min-h-0 flex-1 overflow-auto rounded-xl border border-white/10 bg-neutral-950/80">
              <div className="sticky top-0 z-10 grid grid-cols-[1fr_110px_165px_180px] gap-0 border-b border-white/10 bg-neutral-800 px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-neutral-400">
                <div>Asset</div>
                <div className="text-center">Pick</div>
                <div>Protection</div>
                <div>Origin</div>
              </div>

              {picks.map((pick, index) => {
                const key = pickKey(pick);
                const active = key === selectedKey;
                const alreadyAdded = alreadyAddedPickKeys.has(key);
                const eligibility = rowEligibilityByKey.get(key) || { ok: true };
                const ruleLocked = eligibility.ok === false;
                const isSwapRow = assetTypeLabel(pick) === "Swap";
                const isResolvedRow = isResolvedDraftPickAsset(pick);
                const originalLogo = isSwapRow ? "" : logoMap[normalizeTeamName(pick?.originalTeam || "")];
                const range = getTradeablePickOwnedRange(pick);
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={alreadyAdded || ruleLocked || sideIsFull}
                    onClick={() => openRuleModal(pick)}
                    data-bm-trade-pick-row-index={index}
                    className={`grid w-full grid-cols-[1fr_110px_165px_180px] items-center gap-0 px-4 py-3 text-left transition disabled:cursor-not-allowed ${
                      alreadyAdded || ruleLocked
                        ? "bg-neutral-950/85 text-neutral-500 opacity-70"
                        : sideIsFull
                        ? "bg-neutral-950/85 text-neutral-500 opacity-60"
                        : active
                        ? "bg-orange-600 text-white"
                        : index % 2 === 0
                        ? "bg-neutral-950/85 text-neutral-200 hover:bg-orange-500/10"
                        : "bg-neutral-900/85 text-neutral-200 hover:bg-orange-500/10"
                    }`}
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-sm font-black">
                        <span>{formatPick(pick)}</span>
                        {alreadyAdded && (
                          <span className="rounded-full border border-orange-400/40 bg-orange-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-orange-200">
                            Already in package
                          </span>
                        )}
                        {ruleLocked && (
                          <span className="rounded-full border border-red-400/40 bg-red-500/15 px-2 py-0.5 text-[10px] font-black text-red-200">
                            {eligibility.reason}
                          </span>
                        )}
                        {!alreadyAdded && !ruleLocked && sideIsFull && (
                          <span className="rounded-full border border-red-400/40 bg-red-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-red-200">
                            Limit reached
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs font-bold uppercase tracking-[0.12em] opacity-70">
                        {isResolvedRow
                          ? `Exact draft pick • Owner: ${pick.ownerTeam || pick.owner || tradeTeamName}`
                          : `${assetTypeLabel(pick)} • Owner: ${pick.ownerTeam || pick.owner || tradeTeamName} • Owns ${range.start}-${range.end}`}
                      </div>
                    </div>

                    <div className="text-center text-lg font-black">{getPickNumberLabel(pick)}</div>

                    <div className="text-sm font-bold opacity-90">
                      {isResolvedRow ? "Exact" : compactProtectionLabel(pick)}
                    </div>

                    <div className="flex items-center gap-3 text-sm font-bold opacity-90">
                      {originalLogo ? (
                        <img src={originalLogo} alt={getOriginLabel(pick, teamNames)} className="h-7 w-7 object-contain" />
                      ) : null}
                      <span>{getOriginLabel(pick, teamNames)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {rulePick && typeof document !== "undefined" && createPortal((
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setRulePickKey("");
            }}
          >
            <div className="flex max-h-[min(820px,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950 shadow-2xl">
              <div className="border-b border-white/10 bg-gradient-to-r from-orange-600/20 to-neutral-900 px-6 py-5">
                <div className="text-xs font-black uppercase tracking-[0.2em] text-orange-300">Draft Pick Rule</div>
                <div className="mt-1 text-2xl font-black text-white">{formatPick(rulePick)}</div>
                <div className="mt-1 text-sm font-bold text-neutral-400">
                  Current: {compactProtectionLabel(rulePick)} • Owns {ownedRange?.start}-{ownedRange?.end}
                  {!isFullOwnedRangeForPick(rulePick) ? " • Range rights asset" : ""}
                </div>
              </div>

              <div className="grid flex-1 gap-4 overflow-y-auto p-5">
                <button
                  type="button"
                  disabled={fullModeEligibility.ok === false}
                  onClick={() => fullModeEligibility.ok !== false && setRuleMode("full")}
                  className={`rounded-2xl border px-5 py-4 text-left transition ${
                    ruleMode === "full" ? "border-orange-400 bg-orange-500/15" : "border-white/10 bg-black hover:border-orange-400/40"
                  } ${fullModeEligibility.ok === false ? "cursor-not-allowed opacity-45 hover:border-white/10" : ""}`}
                >
                  <div className="text-lg font-black text-white">
                    {!isFullOwnedRangeForPick(rulePick) ? "Trade range rights" : "Trade full owned piece"}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-neutral-400">
                    {fullModeEligibility.ok === false
                      ? fullModeEligibility.reason
                      : !isFullOwnedRangeForPick(rulePick)
                      ? `Sends only the owned slots ${ownedRange?.start}-${ownedRange?.end}; the original protection stays attached.`
                      : "Sends exactly what this team owns right now. Existing protections stay attached."}
                  </div>
                </button>

                <button
                  type="button"
                  disabled={!canProtect}
                  onClick={() => canProtect && setRuleMode("protected")}
                  className={`rounded-2xl border px-5 py-4 text-left transition ${
                    ruleMode === "protected" ? "border-orange-400 bg-orange-500/15" : "border-white/10 bg-black hover:border-orange-400/40"
                  } ${!canProtect ? "opacity-45" : ""}`}
                >
                  <div className="text-lg font-black text-white">Add custom protection</div>
                  <div className="mt-1 text-sm font-semibold text-neutral-400">
                    {isSwapDraftPickAsset(rulePick)
                      ? "Swap rights cannot be protected."
                      : isResolvedDraftPickAsset(rulePick)
                      ? "Resolved picks cannot receive new protections."
                      : "Protect only the part this team owns. The protected range cannot cover the whole asset."}
                  </div>
                </button>

                {ruleMode === "protected" && canProtect && (
                  <div className="rounded-2xl border border-white/10 bg-black p-4">
                    <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
                      <label className="grid gap-2 text-sm font-black text-neutral-300">
                        Protection starts at
                        <input
                          value={ownedRange?.start || ""}
                          readOnly
                          className="rounded-xl border border-white/10 bg-neutral-900 px-3 py-2 font-black text-white outline-none"
                        />
                      </label>
                      <label className="grid gap-2 text-sm font-black text-neutral-300">
                        Protection ends at
                        <input
                          type="number"
                          min={ownedRange?.start || 1}
                          max={(ownedRange?.end || 2) - 1}
                          value={protectEnd || ""}
                          onChange={(event) => setProtectEnd(Number(event.target.value))}
                          className="rounded-xl border border-white/10 bg-neutral-900 px-3 py-2 font-black text-white outline-none"
                        />
                      </label>
                    </div>
                    <div className={`mt-3 text-sm font-bold ${modalProtectionValidation.ok ? "text-emerald-300" : "text-red-300"}`}>
                      {modalProtectionValidation.ok
                        ? `${protectionDisplayForOwnedRange(modalProtectionValidation.baseProtectionLabel, modalProtectionValidation.retainedRange)} retained; ${protectionDisplayForOwnedRange(modalProtectionValidation.baseProtectionLabel, modalProtectionValidation.conveyedRange)} conveys.`
                        : modalProtectionValidation.reason}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  disabled={!canSwap}
                  onClick={() => canSwap && setRuleMode("swap")}
                  className={`rounded-2xl border px-5 py-4 text-left transition ${
                    ruleMode === "swap" ? "border-orange-400 bg-orange-500/15" : "border-white/10 bg-black hover:border-orange-400/40"
                  } ${!canSwap ? "cursor-not-allowed opacity-45 hover:border-white/10" : ""}`}
                >
                  <div className="text-lg font-black text-white">Create swap right</div>
                  <div className="mt-1 text-sm font-semibold text-neutral-400">
                    {canSwap
                      ? "Only available when both picks are fully unprotected in the same year and round."
                      : swapUnavailableReason}
                  </div>
                </button>

                {ruleMode === "swap" && canSwap && (
                  <div className="rounded-2xl border border-white/10 bg-black p-4">
                    <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                      <label className="grid gap-2 text-sm font-black text-neutral-300">
                        Right being sent
                        <select
                          value={swapDirection}
                          onChange={(event) => setSwapDirection(event.target.value)}
                          className="rounded-xl border border-white/10 bg-neutral-900 px-3 py-2 font-black text-white outline-none"
                        >
                          <option value="best">Swap Best</option>
                          <option value="worst">Swap Worst</option>
                        </select>
                      </label>
                      <label className="grid gap-2 text-sm font-black text-neutral-300">
                        Matching {otherTeamName || "other team"} pick
                        <select
                          value={selectedSwapKey}
                          onChange={(event) => setSelectedSwapKey(event.target.value)}
                          className="rounded-xl border border-white/10 bg-neutral-900 px-3 py-2 font-black text-white outline-none"
                        >
                          {swapCandidates.map((pick) => (
                            <option key={pickKey(pick)} value={pickKey(pick)}>
                              {formatPick(pick)} - {getTeamCode(pick.originalTeam || pick.originalTeamName, teamNames)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="mt-3 text-sm font-bold text-neutral-400">
                      {swapCandidates.length
                        ? `${swapDirectionLabel(swapDirection)} will be shown on this side, with the linked ${swapDirectionLabel(inverseSwapDirection(swapDirection))} item shown for ${otherTeamName}.`
                        : `No valid fully unprotected ${rulePick.year} ${roundLabel(rulePick.round)} pick found for ${otherTeamName}.`}
                    </div>
                  </div>
                )}

                {ruleError ? (
                  <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
                    {ruleError}
                  </div>
                ) : null}

                <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-3 border-t border-white/10 bg-neutral-950/95 px-5 py-4 backdrop-blur">
                  <button
                    type="button"
                    onClick={() => setRulePickKey("")}
                    className="rounded-xl border border-white/10 bg-black px-5 py-3 text-sm font-black text-neutral-300 hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={addConfiguredPick}
                    disabled={Boolean(rulePick && alreadyAddedPickKeys.has(pickKey(rulePick))) || sideIsFull || configuredModeLocked}
                    className="rounded-xl bg-orange-600 px-5 py-3 text-sm font-black text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {rulePick && alreadyAddedPickKeys.has(pickKey(rulePick)) ? "Already Added" : configuredModeLocked ? "Trade Locked" : sideIsFull ? "Limit Reached" : "Add Pick"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ), document.body)}
      </div>
    </PageFade>
  );
}
