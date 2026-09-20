import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { getUserTradeDeadlineStatus } from "../utils/userTradeRules.js";
import { buildRecordMap, getStandardPlayers, playerHeadshotOf, playerOverall } from "../utils/teamIntel_v1.js";
import { readScheduleFromStorage } from "../utils/scheduleStorage.js";
import { buildCanonicalStandingLabelMap, loadRegularSeasonResultsV3FromStorage } from "../utils/canonicalStandings.js";
import { getContractSeasonYear } from "../utils/seasonContext.js";
import { getLeagueFinancialRules } from "../utils/leagueFinancials.js";
import { normalizeDraftPicks, normalizeTeamName } from "../utils/draftPicks.js";
import PageFade from "../components/PageFade";
import PlayerCardModal from "../components/PlayerCardModal.jsx";
import RuntimePlayerPortrait from "../components/RuntimePlayerPortrait.jsx";
import PlayerRatingRing from "../components/PlayerRatingRing.jsx";
import { TRADE_CONTEXT_POPUP_TUNING } from "../config/tradeContextPopupTuning.js";
import {
  readTradeDeskFeed,
  mergeTradeDeskFeedWithLeague,
  buildTradeHistoryLogEntries,
} from "../utils/tradeDeskFeed.js";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";
import "./Trades.css";

const TRADE_BUILDER_KEY = "bm_trade_builder_v1";

const DESK_FILTERS = [
  { key: "rumor", label: "Rumors", countKey: "rumors" },
  { key: "negotiation", label: "Talks", countKey: "negotiations" },
  { key: "transaction", label: "Deals", countKey: "transactions" },
];


const POSITION_TARGETS = Object.freeze([
  { key: "PG", label: "Point Guard" },
  { key: "SG", label: "Shooting Guard" },
  { key: "SF", label: "Small Forward" },
  { key: "PF", label: "Power Forward" },
  { key: "C", label: "Center" },
]);

function useTradeContextPopupVisualTuning() {
  const readViewportWidth = () => {
    if (typeof window === "undefined") return 1600;
    return window.innerWidth;
  };

  const [viewportWidth, setViewportWidth] = useState(readViewportWidth);

  useEffect(() => {
    const onResize = () => setViewportWidth(readViewportWidth());
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Internal responsive scale. You never need to tune this.
  const responsiveScale = Math.max(0.78, Math.min(1, viewportWidth / 1600));

  const resolveVisual = (key) => {
    const visual = TRADE_CONTEXT_POPUP_TUNING?.[key] || {};
    const x = Number(visual.x);
    const y = Number(visual.y);
    const scale = Number(visual.scale);
    return {
      x: (Number.isFinite(x) ? x : 0) * responsiveScale,
      y: (Number.isFinite(y) ? y : 0) * responsiveScale,
      scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
    };
  };

  return {
    responsiveScale,
    headshot: resolveVisual("headshot"),
    overall: resolveVisual("overall"),
    outerRing: resolveVisual("outerRing"),
    name: resolveVisual("name"),
    ageText: resolveVisual("ageText"),
  };
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function primaryPositionOf(player = {}) {
  const raw = String(player?.pos || player?.position || player?.primaryPosition || "").toUpperCase().trim();
  if (!raw) return "";
  const primary = raw.split(/[\/|,]/)[0].trim().split(/\s+/)[0];
  return POSITION_TARGETS.some((row) => row.key === primary) ? primary : "";
}

function buildPositionDepth(team) {
  const counts = Object.fromEntries(POSITION_TARGETS.map((row) => [row.key, 0]));
  for (const player of getStandardPlayers(team)) {
    const primary = primaryPositionOf(player);
    if (primary && Object.prototype.hasOwnProperty.call(counts, primary)) counts[primary] += 1;
  }
  return POSITION_TARGETS.map((row) => ({ ...row, count: counts[row.key] || 0, target: 2 }));
}

function contractYearsLeft(player, leagueData) {
  const direct = safeNumber(player?.yearsLeft ?? player?.contractYears, -1);
  if (direct >= 0) return Math.max(0, Math.round(direct));
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract?.salaryByYear) ? contract.salaryByYear : [];
  if (!salaries.length) return 0;
  const currentYear = getContractSeasonYear(leagueData || {});
  const startYear = safeNumber(contract?.startYear, currentYear);
  let index = currentYear - startYear;
  if (!Number.isFinite(index) || index < 0) index = 0;
  if (index >= salaries.length) return 0;
  return Math.max(0, salaries.length - index);
}

function currentContractSalary(player, leagueData) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract?.salaryByYear) ? contract.salaryByYear : [];
  if (salaries.length) {
    const currentYear = getContractSeasonYear(leagueData || {});
    const startYear = safeNumber(contract?.startYear, currentYear);
    let index = currentYear - startYear;
    if (!Number.isFinite(index) || index < 0) index = 0;
    if (index >= salaries.length) index = salaries.length - 1;
    return safeNumber(salaries[index], 0);
  }
  return safeNumber(player?.salary ?? player?.currentSalary ?? player?.contractSalary ?? player?.capHit ?? player?.aav, 0);
}

function contractOriginalTerm(player) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
  const explicit = safeNumber(
    contract?.originalTermYears ?? contract?.termYears ?? contract?.years ?? meta?.originalTermYears ?? meta?.contractYears,
    0
  );
  if (explicit > 0) return Math.round(explicit);
  return Array.isArray(contract?.salaryByYear) ? contract.salaryByYear.length : 0;
}

function hasFutureExtension(player, leagueData) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const currentYear = getContractSeasonYear(leagueData || {});
  const rows = [
    ...(Array.isArray(contract?.extensions) ? contract.extensions : []),
    ...(contract?.extensionMeta && typeof contract.extensionMeta === "object" ? [contract.extensionMeta] : []),
  ];
  return rows.some((row) => safeNumber(row?.extensionStartYear, 0) > currentYear);
}

function unresolvedContractOption(player, leagueData) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const option = contract?.option && typeof contract.option === "object" ? contract.option : null;
  if (!option || option.picked != null) return false;
  const years = Array.isArray(option.yearIndices) ? option.yearIndices : [];
  if (!years.length) return false;
  const currentYear = getContractSeasonYear(leagueData || {});
  const startYear = safeNumber(contract?.startYear, currentYear);
  const currentIndex = Math.max(0, currentYear - startYear);
  return years.some((index) => safeNumber(index, -99) >= currentIndex);
}

function isExtensionEligibleSoon(player, leagueData) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const yearsLeft = contractYearsLeft(player, leagueData);
  if (yearsLeft <= 0 || hasFutureExtension(player, leagueData) || unresolvedContractOption(player, leagueData)) return false;
  const status = String(player?.contractType || player?.rosterStatus || contract?.type || "standard").toLowerCase();
  if (status.includes("two-way") || status.includes("two_way") || status.includes("stash")) return false;
  const rights = player?.rights && typeof player.rights === "object" ? player.rights : {};
  const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
  const draftRound = safeNumber(meta?.draftRound ?? player?.draftRound, 0);
  const rookieScale = Boolean(rights?.rookieScale || player?.rookieScale || contract?.rookieScale);
  const originalTerm = contractOriginalTerm(player);
  if (rookieScale && draftRound === 1 && yearsLeft === 1) return true;
  return !rookieScale && originalTerm >= 3 && (yearsLeft === 1 || (yearsLeft === 2 && originalTerm >= 4));
}


function isProtectedPickAsset(asset = {}) {
  const raw = String(asset?.displayProtection || asset?.protections || asset?.protection || "").trim().toLowerCase();
  if (!raw) return false;
  if (raw === "none" || raw === "n/a") return false;
  return !raw.includes("unprotected");
}

function buildPickDepth(team, leagueData, teamNames = []) {
  const ownerKey = normalizeTeamName(team?.name || team?.teamName || "");
  const counts = {
    unprotectedFirsts: 0,
    protectedFirsts: 0,
    unprotectedSeconds: 0,
    protectedSeconds: 0,
    swapRights: 0,
  };
  const assets = normalizeDraftPicks(leagueData?.draftPicks || [], teamNames);
  for (const asset of assets) {
    if (String(asset?.status || "active").toLowerCase() !== "active") continue;
    if (normalizeTeamName(asset?.ownerTeam || "") !== ownerKey) continue;
    const assetType = String(asset?.assetType || asset?.type || "pick").toLowerCase();
    if (assetType === "swap") {
      counts.swapRights += 1;
      continue;
    }
    const isProtected = isProtectedPickAsset(asset);
    if (Number(asset?.round) === 1) {
      if (isProtected) counts.protectedFirsts += 1;
      else counts.unprotectedFirsts += 1;
    } else if (Number(asset?.round) === 2) {
      if (isProtected) counts.protectedSeconds += 1;
      else counts.unprotectedSeconds += 1;
    }
  }
  return [
    { key: "unprotectedFirsts", label: "Unprotected 1sts", count: counts.unprotectedFirsts },
    { key: "protectedFirsts", label: "Protected 1sts", count: counts.protectedFirsts },
    { key: "unprotectedSeconds", label: "Unprotected 2nds", count: counts.unprotectedSeconds },
    { key: "protectedSeconds", label: "Protected 2nds", count: counts.protectedSeconds },
    { key: "swapRights", label: "Swap Rights", count: counts.swapRights },
  ];
}


function getOwnedActiveDraftAssets(team, leagueData, teamNames = []) {
  const ownerKey = normalizeTeamName(team?.name || team?.teamName || "");
  return normalizeDraftPicks(leagueData?.draftPicks || [], teamNames)
    .filter((asset) => String(asset?.status || "active").toLowerCase() === "active")
    .filter((asset) => normalizeTeamName(asset?.ownerTeam || "") === ownerKey)
    .sort((a, b) => safeNumber(a?.year, 9999) - safeNumber(b?.year, 9999) || safeNumber(a?.round, 9) - safeNumber(b?.round, 9));
}

function pickDepthBucketKey(asset = {}) {
  const assetType = String(asset?.assetType || asset?.type || "pick").toLowerCase();
  if (assetType === "swap") return "swapRights";
  const protectedPick = isProtectedPickAsset(asset);
  if (Number(asset?.round) === 1) return protectedPick ? "protectedFirsts" : "unprotectedFirsts";
  if (Number(asset?.round) === 2) return protectedPick ? "protectedSeconds" : "unprotectedSeconds";
  return "";
}

function positionModalPlayers(team, positionKey) {
  return getStandardPlayers(team)
    .filter((player) => primaryPositionOf(player) === positionKey)
    .sort((a, b) => playerOverall(b) - playerOverall(a) || String(a?.name || a?.player || "").localeCompare(String(b?.name || b?.player || "")));
}

function playerPotentialValue(player) {
  return safeNumber(player?.potential ?? player?.pot, playerOverall(player));
}

function formatPickRound(round) {
  return Number(round) === 2 ? "2nd" : "1st";
}

function TradeContextDetailModal({ detail, team, leagueData, teamNames, onClose }) {
  useEffect(() => {
    if (!detail) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detail, onClose]);

  const visualTuning = useTradeContextPopupVisualTuning();

  if (!detail) return null;

  const isPosition = detail.type === "position";
  const rows = isPosition
    ? positionModalPlayers(team, detail.key)
    : getOwnedActiveDraftAssets(team, leagueData, teamNames).filter((asset) => pickDepthBucketKey(asset) === detail.key);

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${detail.label} details`}
        className="flex max-h-[72vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[20px] border border-white/10 bg-neutral-950 shadow-[0_28px_90px_rgba(0,0,0,0.72)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 bg-gradient-to-r from-orange-600/[0.09] via-neutral-950 to-neutral-950 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-orange-400">
              {isPosition ? "Position Depth" : "Pick Depth"}
            </div>
            <div className="mt-1 truncate text-lg font-black text-white">{detail.label}</div>
            <div className="mt-1 text-[11px] font-semibold text-neutral-500">
              {rows.length} {isPosition ? (rows.length === 1 ? "player" : "players") : (rows.length === 1 ? "asset" : "assets")}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/35 text-sm font-black text-neutral-400 transition hover:border-orange-400/30 hover:bg-orange-500/10 hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="trade-context-modal-scroll min-h-0 flex-1 overflow-y-auto p-3 pr-2">
          {rows.length ? (
            <div className="grid gap-2">
              {isPosition ? rows.map((player, index) => {
                const name = player?.name || player?.player || `Player ${index + 1}`;
                const overall = playerOverall(player);
                const potential = playerPotentialValue(player);
                const age = safeNumber(player?.age, 0);
                const teamName = String(team?.name || team?.teamName || "");
                const headshot = player?.headshot || player?.headshotUrl || player?.photo || player?.image || "";
                const portraitSlotSize = 58 * visualTuning.responsiveScale;
                const portraitRenderSize = portraitSlotSize * visualTuning.headshot.scale;
                const ringSize = 58 * visualTuning.responsiveScale;

                return (
                  <div
                    key={player?.id || player?.playerId || `${name}_${index}`}
                    className="trade-context-player-row flex items-center rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2"
                    style={{ minHeight: 72 * visualTuning.responsiveScale }}
                  >
                    {/*
                      Keep the layout slot fixed, but render the portrait at its
                      actual tuned size. This prevents a tiny 58px layer from being
                      rasterized first and then enlarged by CSS transform.
                    */}
                    <div
                      className="relative shrink-0 overflow-visible"
                      style={{ width: portraitSlotSize, height: portraitSlotSize }}
                    >
                      <div
                        className="absolute bottom-0 left-1/2 overflow-visible"
                        style={{
                          width: portraitRenderSize,
                          height: portraitRenderSize,
                          transform: `translate3d(calc(-50% + ${visualTuning.headshot.x}px), ${visualTuning.headshot.y}px, 0)`,
                          transformOrigin: "center bottom",
                        }}
                      >
                        <RuntimePlayerPortrait
                          player={player}
                          teamName={teamName}
                          src={headshot}
                          alt={name}
                          layoutPage="trade-context-popup"
                          className="h-full w-full"
                          fallback={<div className="h-full w-full" />}
                        />
                      </div>
                    </div>

                    <div
                      className="ml-2 shrink-0"
                      style={{
                        transform: `translate(${visualTuning.overall.x}px, ${visualTuning.overall.y}px) scale(${visualTuning.overall.scale})`,
                        transformOrigin: "center center",
                      }}
                    >
                      <PlayerRatingRing
                        overall={overall}
                        potential={potential}
                        size={ringSize}
                        ringStyle={{
                          transform: `translate(${visualTuning.outerRing.x}px, ${visualTuning.outerRing.y}px) scale(${visualTuning.outerRing.scale})`,
                          transformOrigin: "center center",
                          transformBox: "fill-box",
                        }}
                      />
                    </div>

                    {/*
                      Fixed paint viewport: name/age scale and movement are visual
                      only and can no longer change the row/modal scroll geometry.
                    */}
                    <div
                      className="trade-context-player-copy ml-3 min-w-0 flex-1"
                      style={{ height: 58 * visualTuning.responsiveScale }}
                    >
                      <div
                        className="trade-context-player-name truncate text-sm font-black text-neutral-100"
                        style={{
                          top: 20 * visualTuning.responsiveScale,
                          fontSize: 14 * visualTuning.responsiveScale,
                          transform: `translate(${visualTuning.name.x}px, ${visualTuning.name.y}px) scale(${visualTuning.name.scale})`,
                          transformOrigin: "left center",
                        }}
                      >
                        {name}
                      </div>

                      {age > 0 && (
                        <div
                          className="trade-context-player-age text-[10px] font-bold uppercase tracking-[0.09em] text-neutral-500"
                          style={{
                            top: 39 * visualTuning.responsiveScale,
                            fontSize: 10 * visualTuning.responsiveScale,
                            transform: `translate(${visualTuning.ageText.x}px, ${visualTuning.ageText.y}px) scale(${visualTuning.ageText.scale})`,
                            transformOrigin: "left center",
                          }}
                        >
                          Age {age}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }) : rows.map((asset, index) => {
                const isSwap = String(asset?.assetType || asset?.type || "pick").toLowerCase() === "swap";
                const year = safeNumber(asset?.year, 0);
                const roundLabel = formatPickRound(asset?.round);
                const originalTeam = String(asset?.originalTeam || "").trim();
                const selectedName = String(team?.name || team?.teamName || "").trim();
                const via = originalTeam && normalizeTeamName(originalTeam) !== normalizeTeamName(selectedName) ? `via ${originalTeam}` : "Own pick";
                const protection = isSwap
                  ? (asset?.swapWithTeam ? `Swap with ${asset.swapWithTeam}` : "Swap right")
                  : (asset?.displayProtection || asset?.protections || asset?.protection || "Unprotected");
                return (
                  <div
                    key={asset?.id || `${detail.key}_${year}_${index}`}
                    className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-neutral-100">
                          {year || "Future"} {roundLabel} Round {isSwap ? "Swap" : "Pick"}
                        </div>
                        <div className="mt-1 truncate text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-500">{via}</div>
                      </div>
                      <div className="max-w-[46%] shrink-0 rounded-full border border-orange-400/15 bg-orange-500/[0.07] px-2.5 py-1 text-right text-[9px] font-black uppercase tracking-[0.08em] text-orange-200">
                        {protection}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-[170px] items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-5 text-center text-sm font-semibold text-neutral-500">
              {isPosition ? `No ${detail.label.toLowerCase()}s on the standard roster.` : `No ${detail.label.toLowerCase()} assets are currently owned.`}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function buildTeamContextAlerts(team, leagueData) {
  const players = getStandardPlayers(team);
  const extensionRows = players
    .filter((player) => isExtensionEligibleSoon(player, leagueData))
    .sort((a, b) => playerOverall(b) - playerOverall(a));
  const extensionNames = new Set(extensionRows.map((player) => String(player?.name || player?.player || "")));
  const expiringRows = players
    .filter((player) => contractYearsLeft(player, leagueData) === 1 && currentContractSalary(player, leagueData) > 0)
    .filter((player) => !extensionNames.has(String(player?.name || player?.player || "")))
    .sort((a, b) => playerOverall(b) - playerOverall(a));

  const alerts = [];
  if (expiringRows[0]) alerts.push(`${expiringRows[0]?.name || expiringRows[0]?.player} is expiring after this season.`);
  if (extensionRows[0]) alerts.push(`${extensionRows[0]?.name || extensionRows[0]?.player} is extension eligible soon.`);

  if (alerts.length < 2 && expiringRows[1]) alerts.push(`${expiringRows[1]?.name || expiringRows[1]?.player} is expiring after this season.`);
  if (alerts.length < 2 && extensionRows[1]) alerts.push(`${extensionRows[1]?.name || extensionRows[1]?.player} is extension eligible soon.`);
  return alerts.slice(0, 2);
}


function getExpiringContractRows(team, leagueData) {
  return getStandardPlayers(team)
    .filter((player) => contractYearsLeft(player, leagueData) === 1 && currentContractSalary(player, leagueData) > 0)
    .sort((a, b) => playerOverall(b) - playerOverall(a));
}

function formatTradeMoney(value) {
  const amount = Math.abs(Number(value || 0));
  if (amount >= 1_000_000_000) {
    const billions = Number((amount / 1_000_000_000).toFixed(amount >= 10_000_000_000 ? 0 : 1));
    return `$${billions}B`;
  }
  if (amount >= 1_000_000) {
    const millions = Number((amount / 1_000_000).toFixed(amount >= 10_000_000 ? 1 : 2));
    return `$${millions}M`;
  }
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount)}`;
}

function getTradeCenterDeadCap(team, leagueData) {
  const teamName = team?.name || team?.teamName || "";
  const seasonYear = getContractSeasonYear(leagueData || {});
  const rows = Array.isArray(leagueData?.deadCapByTeam?.[teamName]) ? leagueData.deadCapByTeam[teamName] : [];
  return rows.reduce((sum, row) => {
    const rowSeason = safeNumber(row?.seasonYear, seasonYear);
    if (rowSeason !== safeNumber(seasonYear, rowSeason)) return sum;
    return sum + safeNumber(row?.amount ?? row?.netAmount ?? row?.originalAmount, 0);
  }, 0);
}

function getTradeCenterPayroll(team, leagueData) {
  const rosterPayroll = (Array.isArray(team?.players) ? team.players : [])
    .reduce((sum, player) => sum + currentContractSalary(player, leagueData), 0);
  const computed = rosterPayroll + getTradeCenterDeadCap(team, leagueData);
  if (computed > 0) return computed;
  return safeNumber(team?.payroll ?? team?.totalSalary ?? team?.salaryTotal ?? team?.financials?.payroll, 0);
}

function buildCapOutlook(team, leagueData) {
  const rules = getLeagueFinancialRules(leagueData || {});
  const payroll = getTradeCenterPayroll(team, leagueData);
  const cap = safeNumber(rules?.salaryCap, 0);
  const tax = safeNumber(rules?.luxuryTaxLine, 0);
  const firstApron = safeNumber(rules?.firstApron, 0);
  const secondApron = safeNumber(rules?.secondApron, 0);

  if (!payroll) {
    return { primary: "—", secondary: "Payroll data unavailable", payroll: 0 };
  }
  if (cap && payroll <= cap) {
    return { primary: `${formatTradeMoney(cap - payroll)} cap room`, secondary: `Payroll ${formatTradeMoney(payroll)}`, payroll };
  }
  if (tax && payroll <= tax) {
    return { primary: `${formatTradeMoney(tax - payroll)} below tax`, secondary: `Payroll ${formatTradeMoney(payroll)}`, payroll };
  }
  if (firstApron && payroll <= firstApron) {
    return { primary: `${formatTradeMoney(firstApron - payroll)} below 1st apron`, secondary: `Payroll ${formatTradeMoney(payroll)}`, payroll };
  }
  if (secondApron && payroll <= secondApron) {
    return { primary: `${formatTradeMoney(secondApron - payroll)} below 2nd apron`, secondary: `Payroll ${formatTradeMoney(payroll)}`, payroll };
  }
  if (secondApron) {
    return { primary: `${formatTradeMoney(payroll - secondApron)} above 2nd apron`, secondary: `Payroll ${formatTradeMoney(payroll)}`, payroll };
  }
  return { primary: formatTradeMoney(payroll), secondary: "Current payroll", payroll };
}

function DraftPickIcon({ className = "h-5 w-5" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 7.2h16v3a2 2 0 0 0 0 3.6v3H4v-3a2 2 0 0 0 0-3.6z" />
      <path d="M12 8.8v6.4" />
    </svg>
  );
}

function TradeSearchIcon({ className = "h-5 w-5" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.6 15.6 4.1 4.1" />
    </svg>
  );
}

function normalizePlayerSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function playerSearchMatchScore(value, query) {
  const text = normalizePlayerSearchText(value);
  const q = normalizePlayerSearchText(query);
  if (!text || !q) return Number.POSITIVE_INFINITY;
  if (text === q) return 0;
  if (text.startsWith(q)) return 1;
  if (text.split(/\s+/).some((word) => word.startsWith(q))) return 2;
  if (text.includes(q)) return 3;
  return Number.POSITIVE_INFINITY;
}

function playerSearchNameOf(player = {}) {
  return String(player?.name || player?.playerName || player?.player || "").trim();
}

function collectTradeCenterSearchablePlayers(leagueData = {}, teams = []) {
  const rows = [];
  const seen = new Set();

  const addPlayer = (player, team = null, teamName = "Free Agent") => {
    if (!player || typeof player !== "object") return;
    const name = playerSearchNameOf(player);
    if (!name) return;
    const resolvedTeamName = team ? String(team?.name || team?.teamName || "").trim() : String(teamName || "Free Agent");
    const identity = String(player?.id ?? player?.playerId ?? player?.uuid ?? name);
    const key = `${normalizePlayerSearchText(resolvedTeamName)}::${normalizePlayerSearchText(identity)}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      player,
      teamName: resolvedTeamName || "Free Agent",
      teamLogo: team ? teamLogoOf(team) : String(player?.teamLogo || ""),
    });
  };

  teams.forEach((team) => {
    const buckets = [
      team?.players,
      team?.roster,
      team?.standardPlayers,
      team?.twoWayPlayers,
      team?.twoWay,
      team?.stashPlayers,
      team?.stashes,
      getStandardPlayers(team),
    ];
    buckets.forEach((bucket) => {
      if (!Array.isArray(bucket)) return;
      bucket.forEach((player) => addPlayer(player, team));
    });
  });

  const freeAgentBuckets = [
    leagueData?.freeAgents,
    leagueData?.freeAgency?.freeAgents,
    leagueData?.freeAgency?.players,
    leagueData?.freeAgencyState?.freeAgents,
    leagueData?.freeAgencyState?.availablePlayers,
  ];
  freeAgentBuckets.forEach((bucket) => {
    if (!Array.isArray(bucket)) return;
    bucket.forEach((player) => addPlayer(player, null, "Free Agent"));
  });

  return rows;
}

function feedMatchesSearch(row, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const teamNames = Array.isArray(row?.teamNames) ? row.teamNames : [];
  const playerNames = Array.isArray(row?.playerNames) ? row.playerNames : [];
  const haystack = [row?.headline, row?.label, row?.tag, ...teamNames, ...playerNames]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function historyMatchesSearch(entry, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const bits = [entry?.headline, entry?.tag];
  for (const side of Array.isArray(entry?.teamPackages) ? entry.teamPackages : []) {
    bits.push(side?.teamName, side?.reason);
    for (const asset of Array.isArray(side?.received) ? side.received : []) {
      bits.push(assetLabel(asset), assetMeta(asset));
    }
  }
  return bits.filter(Boolean).join(" ").toLowerCase().includes(q);
}

function normalizeConferenceLabel(value) {
  const raw = String(value || "").trim();
  const lower = raw.toLowerCase();
  if (lower.includes("east")) return "East";
  if (lower.includes("west")) return "West";
  return raw;
}

function ordinalStanding(value) {
  const rank = Number(value || 0);
  if (!Number.isFinite(rank) || rank <= 0) return "";
  const mod100 = rank % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : rank % 10 === 1 ? "st" : rank % 10 === 2 ? "nd" : rank % 10 === 3 ? "rd" : "th";
  return `${rank}${suffix}`;
}

function buildTradePageStandingMap(leagueData, teams = []) {
  return buildCanonicalStandingLabelMap({
    leagueData,
    teams,
    recordsByTeam: buildRecordMap(teams),
    scheduleByDate: readScheduleFromStorage(),
    resultsById: loadRegularSeasonResultsV3FromStorage(),
  });
}

function standingLabel(standing) {
  if (!standing) return "";
  const record = `${standing.wins}-${standing.losses}`;
  const rank = ordinalStanding(standing.rank);
  if (standing.games <= 0) return standing.conference ? `Preseason • ${standing.conference}` : "Preseason";
  if (rank && standing.conference) return `${record} • ${standing.conference} • ${rank}`;
  if (standing.conference) return `${record} • ${standing.conference}`;
  return record;
}

function labelForDeskFilter(filterKey) {
  return DESK_FILTERS.find((filter) => filter.key === filterKey)?.label || "All";
}

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

function readBuilder() {
  try {
    return JSON.parse(localStorage.getItem(TRADE_BUILDER_KEY) || "null");
  } catch {
    return null;
  }
}

function pluralize(count, label) {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function formatFeedDate(entry = {}) {
  const date = entry.date || entry.currentDate;
  if (date) return date;

  const parsed = Date.parse(entry.createdAt || "");
  if (!Number.isFinite(parsed)) return "Live";

  try {
    return new Date(parsed).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "Live";
  }
}

function formatHistoryTiming(entry = {}) {
  const parts = [];
  const day = Number(entry.day || entry.dayIndex || entry.currentDay || 0);
  if (Number.isFinite(day) && day > 0) parts.push(`Day ${day}`);
  const date = formatFeedDate(entry);
  if (date && date !== "Live") parts.push(date);
  return parts.length ? parts.join(" • ") : "Trade logged";
}

function buildEmptyDeskItems() {
  return [];
}

function buildFilteredEmptyDeskItems() {
  return [];
}

function findTeamByName(teams = [], teamName = "") {
  const key = String(teamName || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return teams.find((team) => {
    const name = String(team?.name || team?.teamName || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    return name && name === key;
  }) || null;
}

function assetLabel(asset = {}) {
  return asset?.label || asset?.displayLabel || asset?.playerName || asset?.name || "Asset";
}

function assetMeta(asset = {}) {
  if (asset?.type === "player") {
    const bits = [];
    if (asset.pos) bits.push(asset.pos);
    if (Number.isFinite(Number(asset.age)) && Number(asset.age) > 0) bits.push(`Age ${asset.age}`);
    if (Number.isFinite(Number(asset.overall)) && Number(asset.overall) > 0) bits.push(`OVR ${asset.overall}`);
    if (Number.isFinite(Number(asset.potential)) && Number(asset.potential) > 0) bits.push(`POT ${asset.potential}`);
    return bits.join(" • ");
  }

  if (asset?.type === "pick") {
    const bits = [];
    if (asset.protection) bits.push(asset.protection);
    if (asset.originalTeam) bits.push(`via ${asset.originalTeam}`);
    return bits.join(" • ");
  }

  return asset?.meta || "";
}

function TradeHistoryAssetPill({ asset, team, fallbackLabel = "Asset" }) {
  const logo = teamLogoOf(team);
  const label = assetLabel(asset) || fallbackLabel;
  const meta = assetMeta(asset);
  const isPlayer = asset?.type === "player";
  const isPick = asset?.type === "pick";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/35 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      {logo && (
        <img
          src={logo}
          alt=""
          className="pointer-events-none absolute right-[-30px] top-1/2 h-28 w-28 -translate-y-1/2 object-contain opacity-[0.13] mix-blend-screen"
          aria-hidden="true"
        />
      )}
      <div className="relative z-10 flex items-start gap-3">
        <div className={`mt-0.5 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] ${
          isPlayer
            ? "border-orange-400/30 bg-orange-500/10 text-orange-100"
            : isPick
              ? "border-sky-300/20 bg-sky-400/10 text-sky-100"
              : "border-white/10 bg-white/5 text-neutral-300"
        }`}>
          {isPlayer ? "Player" : isPick ? "Pick" : "Asset"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black text-neutral-100">{label}</div>
          {meta && <div className="mt-0.5 truncate text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-500">{meta}</div>}
        </div>
      </div>
    </div>
  );
}

function TradeHistoryTeamPackage({ side, teams }) {
  const team = findTeamByName(teams, side.teamName);
  const logo = teamLogoOf(team);
  const assets = Array.isArray(side.received) ? side.received : [];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="flex items-center gap-3">
        {logo ? (
          <img src={logo} alt="" className="h-9 w-9 object-contain" />
        ) : (
          <div className="h-9 w-9 rounded-xl bg-white/5" />
        )}
        <div className="min-w-0">
          <div className="truncate text-base font-black text-white">{side.teamName}</div>
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-orange-200">Received</div>
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        {assets.length ? (
          assets.map((asset, index) => (
            <TradeHistoryAssetPill
              key={`${side.teamName}_${assetLabel(asset)}_${index}`}
              asset={asset}
              team={team}
            />
          ))
        ) : (
          <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm font-bold text-neutral-500">
            Package details unavailable for this older trade.
          </div>
        )}
      </div>

      <div className="mt-3 rounded-2xl border border-orange-400/15 bg-orange-500/10 p-3">
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-orange-200">Why it happened</div>
        <div className="mt-1 text-xs font-semibold leading-relaxed text-orange-50/90">
          {side.reason || `${side.teamName} accepted because the package matched its roster direction and value needs.`}
        </div>
      </div>
    </div>
  );
}

function TradeHistoryCard({ entry, teams }) {
  const packages = Array.isArray(entry.teamPackages) ? entry.teamPackages : [];

  return (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.045] p-4 transition hover:border-orange-400/30 hover:bg-orange-500/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-orange-200">
            {formatHistoryTiming(entry)}
          </div>
          <div className="mt-1 text-sm font-black leading-relaxed text-white">
            {entry.headline}
          </div>
        </div>
        <div className="shrink-0 rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-neutral-400">
          {entry.tag || "Completed"}
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {packages.length ? (
          packages.map((side) => (
            <TradeHistoryTeamPackage key={`${entry.id}_${side.teamName}`} side={side} teams={teams} />
          ))
        ) : (
          <div className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm font-bold text-neutral-400">
            This trade is logged, but package details were not saved by the older trade record.
          </div>
        )}
      </div>
    </div>
  );
}

export default function Trades() {
  const navigate = useNavigate();
  const { leagueData, selectedTeam } = useGame();
  const teams = getAllTeamsFromLeague(leagueData);
  const existing = readBuilder();
  const userItems = existing?.userItems?.length || 0;
  const cpuItems = existing?.cpuItems?.length || 0;
  const hasSavedProposal = Boolean(existing && (userItems > 0 || cpuItems > 0));
  const [storedFeed, setStoredFeed] = useState(() => readTradeDeskFeed());
  const [activeDeskFilter, setActiveDeskFilter] = useState("all");
  const [activeDeskView, setActiveDeskView] = useState("live");
  const [contextDetail, setContextDetail] = useState(null);
  const [playerSearchQuery, setPlayerSearchQuery] = useState("");
  const [playerSearchOpen, setPlayerSearchOpen] = useState(false);
  const [searchPlayerCard, setSearchPlayerCard] = useState(null);
  const playerSearchRef = useRef(null);

  useEffect(() => {
    const refresh = () => setStoredFeed(readTradeDeskFeed());
    refresh();

    const intervalId = window.setInterval(refresh, 2000);
    const onStorage = (event) => {
      if (!event.key || event.key === "bm_trade_desk_feed_v1") refresh();
    };

    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!playerSearchRef.current?.contains(event.target)) setPlayerSearchOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setPlayerSearchOpen(false);
        setPlayerSearchQuery("");
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const allTradeDeskRows = useMemo(() => {
    return mergeTradeDeskFeedWithLeague(storedFeed, leagueData);
  }, [storedFeed, leagueData]);

  const tradeHistoryRows = useMemo(() => {
    return buildTradeHistoryLogEntries(leagueData);
  }, [leagueData]);

  const tradeDeskItems = useMemo(() => {
    const rows = activeDeskFilter === "all"
      ? allTradeDeskRows
      : allTradeDeskRows.filter((row) => row.type === activeDeskFilter);

    const limited = rows.slice(0, 10);
    if (limited.length) return limited;

    return activeDeskFilter === "all"
      ? buildEmptyDeskItems(teams)
      : buildFilteredEmptyDeskItems(activeDeskFilter, teams);
  }, [allTradeDeskRows, activeDeskFilter, teams]);

  const feedCounts = useMemo(() => {
    return {
      transactions: allTradeDeskRows.filter((row) => row.type === "transaction").length,
      negotiations: allTradeDeskRows.filter((row) => row.type === "negotiation").length,
      rumors: allTradeDeskRows.filter((row) => row.type === "rumor").length,
    };
  }, [allTradeDeskRows]);

  const showingFilteredDesk = activeDeskFilter !== "all";
  const showingHistory = activeDeskView === "history";
  const userDeadlineStatus = getUserTradeDeadlineStatus(leagueData);
  const tradeWindowLocked = Boolean(userDeadlineStatus.locked);
  const tradeLockMessage = userDeadlineStatus.reason || "The trade deadline has passed.";
  const positionDepth = useMemo(() => buildPositionDepth(selectedTeam), [selectedTeam]);
  const pickDepth = useMemo(() => buildPickDepth(selectedTeam, leagueData, teams.map((team) => team?.name || team?.teamName || "")), [selectedTeam, leagueData, teams]);
  const teamContextAlerts = useMemo(() => buildTeamContextAlerts(selectedTeam, leagueData), [selectedTeam, leagueData]);
  const standingByTeam = useMemo(() => buildTradePageStandingMap(leagueData, teams), [leagueData, teams]);
  const selectedStanding = standingByTeam.get(normalizeTeamName(selectedTeam?.name || selectedTeam?.teamName || ""));
  const selectedStandingLabel = standingLabel(selectedStanding);
  const expiringContracts = useMemo(() => getExpiringContractRows(selectedTeam, leagueData), [selectedTeam, leagueData]);
  const capOutlook = useMemo(() => buildCapOutlook(selectedTeam, leagueData), [selectedTeam, leagueData]);
  const searchablePlayers = useMemo(
    () => collectTradeCenterSearchablePlayers(leagueData || {}, teams),
    [leagueData, teams]
  );
  const playerSearchResults = useMemo(() => {
    const query = normalizePlayerSearchText(playerSearchQuery);
    if (!query) return [];
    return searchablePlayers
      .map((entry) => {
        const nameScore = playerSearchMatchScore(playerSearchNameOf(entry.player), query);
        const teamScore = playerSearchMatchScore(entry.teamName, query);
        const positionScore = playerSearchMatchScore(entry.player?.pos || entry.player?.position || "", query);
        const score = Math.min(
          nameScore,
          Number.isFinite(teamScore) ? teamScore + 4 : Number.POSITIVE_INFINITY,
          Number.isFinite(positionScore) ? positionScore + 6 : Number.POSITIVE_INFINITY
        );
        return { ...entry, score };
      })
      .filter((result) => Number.isFinite(result.score))
      .sort((a, b) => a.score - b.score || playerSearchNameOf(a.player).localeCompare(playerSearchNameOf(b.player)) || playerOverall(b.player) - playerOverall(a.player))
      .slice(0, 6);
  }, [playerSearchQuery, searchablePlayers]);
  const firstPlayerSearchResult = playerSearchResults[0] || null;
  const primaryExpiringName = expiringContracts[0]?.name || expiringContracts[0]?.player || "";

  if (!selectedTeam) {
    return (
      <PageFade>
        <div className="min-h-screen bmCourtPage text-white flex flex-col items-center justify-center px-4">
          <p className="mb-4 text-lg font-semibold">No team selected.</p>
          <button
            onClick={() => navigate("/team-selector")}
            className="rounded-xl bg-orange-600 px-6 py-3 font-bold transition hover:bg-orange-500"
          >
            Back to Team Select
          </button>
        </div>
      </PageFade>
    );
  }

  return (
    <PageFade>
      <div className="bmCourtPage min-h-screen overflow-y-auto overflow-x-hidden px-4 py-3 text-white lg:px-5 lg:py-4">
        <div className="mx-auto flex min-h-0 w-full max-w-none flex-col gap-3">
          <header className="trade-center-header flex shrink-0 items-center justify-between gap-5 px-1 py-1 lg:gap-6">
            <div className="flex min-w-0 items-center gap-4 lg:gap-5">
              {teamLogoOf(selectedTeam) ? (
                <img src={teamLogoOf(selectedTeam)} alt={selectedTeam.name} className="trade-center-team-logo h-[62px] w-[62px] shrink-0 object-contain lg:h-[70px] lg:w-[70px]" />
              ) : (
                <div className="h-[62px] w-[62px] shrink-0 rounded-2xl bg-[#111318] lg:h-[70px] lg:w-[70px]" />
              )}
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.26em] text-orange-400 lg:text-[11px]">Trade Center</div>
                <h1 className="mt-1 truncate pb-[3px] pr-2 text-[29px] font-black leading-[1.16] tracking-[-0.025em] text-white sm:text-[31px] lg:text-[35px]">
                  {selectedTeam.name} Trades
                </h1>
                {selectedStandingLabel && (
                  <div className="mt-1.5 text-[12px] font-bold tracking-[0.02em] text-neutral-400 lg:text-sm">{selectedStandingLabel}</div>
                )}
              </div>
            </div>

            <div ref={playerSearchRef} className="relative hidden w-[332px] shrink-0 md:block lg:w-[382px]">
              <label className={`trade-center-search flex h-11 items-center gap-2.5 rounded-xl border bg-[#11151b] px-3.5 text-neutral-300 shadow-[0_12px_30px_rgba(0,0,0,0.26),inset_0_1px_0_rgba(255,255,255,0.045)] transition ${playerSearchOpen ? "border-orange-400/45 bg-[#131922]" : "border-white/[0.18]"}`}>
                <TradeSearchIcon className="h-4 w-4 shrink-0" />
                <input
                  type="search"
                  value={playerSearchQuery}
                  autoComplete="off"
                  spellCheck={false}
                  onFocus={() => setPlayerSearchOpen(true)}
                  onChange={(event) => {
                    setPlayerSearchQuery(event.target.value);
                    setPlayerSearchOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && firstPlayerSearchResult) {
                      event.preventDefault();
                      setSearchPlayerCard(firstPlayerSearchResult);
                      setPlayerSearchOpen(false);
                    }
                  }}
                  placeholder="Search players..."
                  className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-white outline-none placeholder:text-neutral-500"
                  aria-label="Search players"
                  aria-expanded={playerSearchOpen && Boolean(playerSearchQuery.trim())}
                  aria-controls="trade-center-player-search-results"
                />
                {playerSearchQuery && (
                  <button type="button" onClick={() => { setPlayerSearchQuery(""); setPlayerSearchOpen(false); }} className="text-[11px] font-black text-neutral-500 hover:text-white" aria-label="Clear player search">×</button>
                )}
              </label>

              {playerSearchOpen && playerSearchQuery.trim() ? (
                <div id="trade-center-player-search-results" className="absolute right-0 top-[calc(100%+8px)] z-50 w-full overflow-hidden rounded-xl border border-white/[0.12] bg-[#0d1014] p-2 shadow-[0_22px_48px_rgba(0,0,0,0.55)]">
                  <div className="px-2 pb-1.5 pt-1 text-[9px] font-black uppercase tracking-[0.16em] text-neutral-500">Players</div>
                  {playerSearchResults.length ? playerSearchResults.map((result) => {
                    const name = playerSearchNameOf(result.player);
                    const headshot = playerHeadshotOf(result.player);
                    return (
                      <button
                        key={`${result.teamName}-${result.player?.id ?? result.player?.playerId ?? name}`}
                        type="button"
                        onClick={() => {
                          setSearchPlayerCard(result);
                          setPlayerSearchOpen(false);
                        }}
                        className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/[0.06]"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-end justify-center overflow-hidden rounded-lg border border-white/[0.08] bg-[#171b21]">
                          {headshot ? <img src={headshot} alt="" className="h-full w-full object-cover object-top" /> : <span className="pb-2 text-sm font-black text-neutral-500">{name.slice(0, 1)}</span>}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-black text-white">{name}</span>
                          <span className="mt-0.5 block truncate text-[10px] font-semibold text-neutral-500">
                            {result.player?.pos || result.player?.position || "—"}{result.teamName ? ` • ${result.teamName}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-lg border border-orange-400/20 bg-orange-500/10 px-2 py-1 text-[11px] font-black text-orange-200">{playerOverall(result.player)}</span>
                      </button>
                    );
                  }) : (
                    <div className="px-3 py-5 text-center text-[11px] font-semibold text-neutral-500">No matching players.</div>
                  )}
                </div>
              ) : null}
            </div>
          </header>

          <div className="trade-center-grid grid min-h-0 gap-3 lg:grid-cols-[1fr_0.82fr]">
            <section className="trade-center-panel flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#0b0d10] shadow-[0_22px_56px_rgba(0,0,0,0.30)]">
              <div className="flex min-h-0 flex-1 flex-col p-4 lg:p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-orange-400/20 bg-orange-500/10 text-orange-400">
                    <span className="text-lg font-black">◎</span>
                  </div>
                  <div>
                    <div className="text-[15px] font-black uppercase tracking-[0.11em] text-white">Team Context</div>
                    <div className="mt-0.5 text-[11.5px] font-semibold text-neutral-400">Real roster, payroll, and contract context.</div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => navigate("/salary-table")}
                    className="group flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border border-white/[0.09] bg-[#171b21] px-3.5 py-3.5 text-left shadow-[0_10px_22px_rgba(0,0,0,0.16),inset_0_1px_0_rgba(255,255,255,0.03)] transition hover:-translate-y-px hover:border-orange-400/35 hover:bg-[#1b2027] hover:shadow-[0_14px_28px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.04)]"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-orange-400/15 bg-orange-500/[0.08] text-orange-300">
                      <span className="text-lg">◉</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-bold text-neutral-300">Cap Outlook</div>
                      <div className="mt-0.5 truncate text-[17px] font-black text-white">{capOutlook.primary}</div>
                      <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] font-semibold text-neutral-500">
                        <span className="truncate">{capOutlook.secondary}</span>
                        <span className="shrink-0 text-orange-300/75">Salary Table</span>
                      </div>
                    </div>
                    <span className="text-neutral-600 transition group-hover:translate-x-0.5 group-hover:text-orange-300">›</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => navigate("/contract-extensions")}
                    className="group flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border border-white/[0.09] bg-[#171b21] px-3.5 py-3.5 text-left shadow-[0_10px_22px_rgba(0,0,0,0.16),inset_0_1px_0_rgba(255,255,255,0.03)] transition hover:-translate-y-px hover:border-orange-400/35 hover:bg-[#1b2027] hover:shadow-[0_14px_28px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.04)]"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-orange-400/15 bg-orange-500/[0.08] text-orange-300">
                      <span className="text-lg">▤</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-bold text-neutral-300">Expiring Contracts</div>
                      <div className="mt-0.5 text-[17px] font-black text-white">{pluralize(expiringContracts.length, "player")}</div>
                      <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] font-semibold text-neutral-500">
                        <span className="truncate">{primaryExpiringName ? `${primaryExpiringName}${expiringContracts.length > 1 ? ` + ${expiringContracts.length - 1} more` : ""}` : "No standard contracts expiring"}</span>
                        <span className="shrink-0 text-orange-300/75">Contracts</span>
                      </div>
                    </div>
                    <span className="text-neutral-600 transition group-hover:translate-x-0.5 group-hover:text-orange-300">›</span>
                  </button>
                </div>

                <div className="mt-3 rounded-[16px] bg-[#101217] p-3.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.055)]">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[19px] text-orange-400">♙</span>
                    <div>
                      <div className="text-[13.5px] font-black uppercase tracking-[0.095em] text-white">Position Depth</div>
                      <div className="mt-0.5 text-[10.5px] font-semibold text-neutral-400">Players under contract by position.</div>
                    </div>
                  </div>
                  <div className="mt-2.5 grid grid-cols-5 gap-2">
                    {positionDepth.map((row) => {
                      const shortageClass = row.count === 0 ? "text-red-300" : row.count === 1 ? "text-orange-300" : "text-white";
                      const fillClass = row.count === 0 ? "bg-red-500/85" : row.count === 1 ? "bg-orange-500/90" : "bg-emerald-500/75";
                      const fillPercent = Math.min(100, Math.max(12, (row.count / Math.max(1, row.target)) * 100));
                      return (
                        <button key={row.key} type="button" onClick={() => setContextDetail({ type: "position", key: row.key, label: row.label })} className="group relative min-w-0 cursor-pointer rounded-xl border border-white/[0.07] bg-[#15181d] px-2.5 py-2.5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition hover:-translate-y-px hover:border-orange-400/35 hover:bg-[#191b20]" aria-label={`View ${row.label} players`}>
                          <span className="absolute right-2 top-1.5 text-[12px] font-black text-neutral-600 transition group-hover:translate-x-0.5 group-hover:text-orange-300">›</span>
                          <div className="text-[10.5px] font-black uppercase tracking-[0.1em] text-neutral-400">{row.key}</div>
                          <div className={`mt-1 text-[20px] font-black leading-none ${shortageClass}`}>{row.count}<span className="ml-0.5 text-[11px] text-neutral-500">/{row.target}</span></div>
                          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/[0.08]"><div className={`h-full rounded-full ${fillClass}`} style={{ width: `${fillPercent}%` }} /></div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex items-center gap-2.5">
                    <DraftPickIcon className="h-[19px] w-[19px] text-orange-400" />
                    <div>
                      <div className="text-[13.5px] font-black uppercase tracking-[0.095em] text-white">Pick Depth</div>
                      <div className="mt-0.5 text-[10.5px] font-semibold text-neutral-400">Draft assets and pick control.</div>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-5 gap-2">
                    {pickDepth.map((row) => (
                      <button key={row.key} type="button" onClick={() => setContextDetail({ type: "pick", key: row.key, label: row.label })} className="group relative flex min-w-0 cursor-pointer items-end justify-between gap-2 rounded-xl border border-white/[0.07] bg-[#15181d] px-2.5 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition hover:-translate-y-px hover:border-orange-400/35 hover:bg-[#191b20]" aria-label={`View ${row.label}`}>
                        <span className="absolute right-2 top-1.5 text-[12px] font-black text-neutral-600 transition group-hover:translate-x-0.5 group-hover:text-orange-300">›</span>
                        <div className="min-w-0 flex-1 pr-4">
                          <div className="min-h-[24px] text-[9.5px] font-bold leading-[1.2] text-neutral-400">{row.label}</div>
                          <div className="mt-1.5 text-[20px] font-black leading-none text-white">{row.count}</div>
                        </div>
                        <DraftPickIcon className="mb-0.5 h-3.5 w-3.5 shrink-0 text-orange-500/55" />
                      </button>
                    ))}
                  </div>
                </div>

                {tradeWindowLocked && <div className="mt-2.5 rounded-xl border border-orange-400/25 bg-orange-500/10 px-4 py-2.5 text-[11px] font-black text-orange-100">{tradeLockMessage}</div>}

                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  <button
                    onClick={() => !tradeWindowLocked && navigate("/propose-trade")}
                    disabled={tradeWindowLocked}
                    className="group flex min-w-0 items-center justify-between rounded-xl bg-gradient-to-r from-orange-600 to-orange-500 px-4 py-3.5 text-left text-white shadow-[0_16px_36px_rgba(234,88,12,0.18)] transition hover:-translate-y-0.5 hover:from-orange-500 hover:to-orange-400 disabled:cursor-not-allowed disabled:from-neutral-800 disabled:to-neutral-800 disabled:text-neutral-500 disabled:shadow-none disabled:hover:translate-y-0"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="text-[24px] leading-none">↔</span>
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-black">{hasSavedProposal ? "Resume Proposal" : "Propose Trade"}</span>
                        <span className="mt-0.5 block truncate text-[10px] font-semibold text-orange-50/85">
                          {hasSavedProposal ? `${pluralize(userItems, "asset")} from you • ${pluralize(cpuItems, "asset")} from them` : "Build and send a trade proposal."}
                        </span>
                      </span>
                    </span>
                    <span className="text-xl transition group-hover:translate-x-0.5">›</span>
                  </button>

                  <button onClick={() => !tradeWindowLocked && navigate("/trade-finder")} disabled={tradeWindowLocked} className="group flex min-w-0 items-center justify-between rounded-xl border border-orange-400/20 bg-[#111318] px-4 py-3.5 text-left text-white transition hover:-translate-y-0.5 hover:border-orange-300/45 hover:bg-orange-500/[0.08] disabled:cursor-not-allowed disabled:border-white/10 disabled:text-neutral-600 disabled:hover:translate-y-0">
                    <span className="flex min-w-0 items-center gap-3">
                      <TradeSearchIcon className="h-6 w-6 shrink-0 text-orange-400" />
                      <span className="min-w-0">
                        <span className="block text-[14px] font-black">Trade Finder</span>
                        <span className="mt-0.5 block truncate text-[10px] font-semibold text-neutral-400">Find matches and trade ideas.</span>
                      </span>
                    </span>
                    <span className="text-xl transition group-hover:translate-x-0.5">›</span>
                  </button>
                </div>
              </div>
            </section>

            <section className="trade-center-panel flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#0b0d10] shadow-[0_22px_56px_rgba(0,0,0,0.30)]">
              <div className="shrink-0 px-4 pb-2 pt-4 lg:px-5">
                <div className="flex items-center gap-3">
                  <span className="text-[22px] font-black text-orange-500">⌁</span>
                  <div>
                    <div className="text-[16px] font-black uppercase tracking-[0.035em] text-white">League Rumor Board</div>
                    <div className="mt-0.5 text-[11px] font-semibold text-neutral-400">Real CPU front-office signals, negotiations, and completed movement.</div>
                  </div>
                </div>
              </div>

              <div className="bmTableScroller flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4 lg:px-5">
                <div className="grid shrink-0 grid-cols-2 border-b border-white/10">
                  <button type="button" onClick={() => setActiveDeskView("live")} className={`relative px-3 py-3 text-[12px] font-black transition ${!showingHistory ? "text-white" : "text-neutral-500 hover:text-neutral-300"}`}>Live Board{!showingHistory && <span className="absolute bottom-[-1px] left-1/4 right-1/4 h-[2px] rounded-full bg-orange-500" />}</button>
                  <button type="button" onClick={() => setActiveDeskView("history")} className={`relative px-3 py-3 text-[12px] font-black transition ${showingHistory ? "text-white" : "text-neutral-500 hover:text-neutral-300"}`}>History Log{showingHistory && <span className="absolute bottom-[-1px] left-1/4 right-1/4 h-[2px] rounded-full bg-orange-500" />}</button>
                </div>

                {!showingHistory && (
                  <>
                    <div className="mt-3 grid shrink-0 grid-cols-3 gap-2.5">
                      {DESK_FILTERS.map((filter) => {
                        const active = activeDeskFilter === filter.key;
                        return <button key={filter.key} type="button" onClick={() => setActiveDeskFilter((prev) => prev === filter.key ? "all" : filter.key)} className={`rounded-xl border px-2 py-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition ${active ? "border-orange-400/35 bg-[#1b1511]" : "border-white/[0.07] bg-[#15181d] hover:border-orange-400/25 hover:bg-[#191b20]"}`}><div className="text-[22px] font-black leading-none text-white">{feedCounts[filter.countKey]}</div><div className={`mt-1.5 text-[10px] font-black uppercase tracking-[0.14em] ${active ? "text-orange-300" : "text-neutral-400"}`}>{filter.label}</div></button>;
                      })}
                    </div>

                    {showingFilteredDesk && (
                      <div className="mt-2.5 flex shrink-0 items-center justify-between gap-3 rounded-lg border border-orange-400/15 bg-[#18130f] px-3 py-1.5">
                        <div className="truncate text-[8px] font-black uppercase tracking-[0.12em] text-orange-100">{`Showing ${labelForDeskFilter(activeDeskFilter)} only`}</div>
                        <button type="button" onClick={() => setActiveDeskFilter("all")} className="text-[8px] font-black uppercase tracking-[0.1em] text-neutral-400 hover:text-white">Clear</button>
                      </div>
                    )}

                    {!tradeDeskItems.length && (
                      <div className="mt-3 flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-white/[0.08] bg-[#12161c] px-6 py-8 text-center shadow-[0_14px_28px_rgba(0,0,0,0.14),inset_0_1px_0_rgba(255,255,255,0.03)]">
                        <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full border border-orange-400/25 bg-orange-500/[0.08] text-[23px] text-orange-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">⌁</div>
                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-orange-200/90">Awaiting activity</div>
                        <div className="mt-1 text-[14px] font-black text-white">No live activity right now</div>
                        <div className="mt-1.5 max-w-[420px] text-[11px] font-semibold leading-relaxed text-neutral-400">Sim ahead and real CPU rumors, talks, and completed deals will appear here as league activity unfolds.</div>
                      </div>
                    )}

                    <div className="mt-3 grid gap-2">
                      {tradeDeskItems.map((item) => {
                        const displayLabel = item.label === "Transaction Wire" ? "Deal" : item.label;
                        const primaryTeam = Array.isArray(item.teamNames) ? findTeamByName(teams, item.teamNames[0]) : null;
                        const primaryLogo = teamLogoOf(primaryTeam);
                        const tagClass = item.type === "transaction" ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-300" : item.type === "negotiation" ? "border-sky-400/20 bg-sky-500/10 text-sky-300" : "border-orange-400/20 bg-orange-500/10 text-orange-300";
                        return (
                          <div key={item.id || `${item.label}_${item.headline}`} className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-[#15181d] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition hover:border-orange-400/25 hover:bg-[#191b20]">
                            {primaryLogo ? <img src={primaryLogo} alt="" className="h-8 w-8 shrink-0 object-contain" /> : <div className="h-8 w-8 shrink-0 rounded-lg bg-white/5" />}
                            <div className="min-w-0 flex-1"><div className="line-clamp-2 text-[11px] font-bold leading-snug text-neutral-200">{item.headline}</div></div>
                            <div className="shrink-0 text-right"><div className={`rounded-md border px-2 py-1 text-[8px] font-black uppercase tracking-[0.1em] ${tagClass}`}>{displayLabel}</div><div className="mt-1 text-[9px] font-bold text-neutral-500">{formatFeedDate(item)}</div></div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {showingHistory && (
                  <div className="mt-3 grid gap-3">
                    {tradeHistoryRows.length ? tradeHistoryRows.map((entry) => <TradeHistoryCard key={entry.id} entry={entry} teams={teams} />) : (
                      <div className="flex min-h-[260px] flex-col items-center justify-center rounded-xl border border-white/[0.07] bg-[#111318] px-6 py-8 text-center"><div className="text-[14px] font-black text-white">No completed trades yet</div><div className="mt-2 max-w-[440px] text-[11px] font-semibold leading-relaxed text-neutral-400">Completed user and CPU trades will appear here with their saved packages and reasoning.</div></div>
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      <TradeContextDetailModal
        detail={contextDetail}
        team={selectedTeam}
        leagueData={leagueData}
        teamNames={teams.map((team) => team?.name || team?.teamName || "")}
        onClose={() => setContextDetail(null)}
      />

      {searchPlayerCard ? (
        <PlayerCardModal
          open={Boolean(searchPlayerCard)}
          player={searchPlayerCard.player}
          teamName={searchPlayerCard.teamName || "Free Agent"}
          teamLogo={searchPlayerCard.teamLogo || ""}
          leagueData={leagueData}
          onClose={() => setSearchPlayerCard(null)}
        />
      ) : null}
    </PageFade>
  );
}
