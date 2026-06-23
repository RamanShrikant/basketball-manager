import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import PageFade from "../components/PageFade";
import {
  getAllTeamsFromLeague,
  getTeamLogoMap,
  getDraftPickProtectionLabel,
  normalizeDraftPicks,
  normalizeTeamName,
  sortDraftPickAssets,
} from "../utils/draftPicks.js";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";

const TRADE_BUILDER_KEY = "bm_trade_builder_v1";
const MAX_SIDE_ITEMS = 6;

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

function getPickOwnerName(row = {}) {
  return row.currentOwnerTeamName || row.ownerTeamName || row.teamName || row.ownerTeam || "";
}

function getPickOriginalName(row = {}) {
  return row.originalTeamName || row.originalPickTeamName || row.naturalLotteryTeamName || row.originalTeam || row.teamName || "";
}

function buildResolvedDraftAsset(row = {}, seasonYear) {
  const pickNumber = Number(row.pick || row.pickNumber || row.overallPick || 0);
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
  if (item?.type === "pick") return `pick:${pickKey(item.pick)}`;
  if (item?.type === "player") return `player:${item.player?.id || item.player?.name}`;
  return JSON.stringify(item);
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

function getOriginLabel(asset) {
  if (assetTypeLabel(asset) === "Swap") {
    const participants = Array.isArray(asset?.realLifeDetails?.swapParticipants)
      ? asset.realLifeDetails.swapParticipants
      : Array.isArray(asset?.swapParticipants)
      ? asset.swapParticipants
      : [];

    if (participants.length) return participants.slice(0, 2).join(" / ");
    return asset?.originalTeam || asset?.swapWithTeam || "Swap Rights";
  }

  return asset?.originalTeam || asset?.originalTeamName || "Own";
}

function formatPick(asset) {
  const pickNumber = getPickNumberLabel(asset);
  const numberSuffix = pickNumber !== "--" ? ` ${pickNumber}` : "";
  return `${asset?.year || "Future"} ${roundLabel(asset?.round)}${numberSuffix}`;
}

function collectTradeablePicks({ leagueData, teamName, teamNames }) {
  if (!leagueData || !teamName) return [];

  const seasonYear = getSeasonYearFromLeague(leagueData);
  const draftOrder = readLockedDraftOrder(leagueData, seasonYear);
  const draftComplete = isDraftCompleteForSeason(leagueData, seasonYear);
  const draftOrderLocked = draftOrder.length >= 60;

  const normalizedFuturePicks = normalizeDraftPicks(leagueData?.draftPicks || [], teamNames)
    .filter((pick) => Number(pick.year || 0) >= Number(seasonYear))
    .filter((pick) => !(draftComplete && Number(pick.year || 0) === Number(seasonYear)))
    .filter((pick) => !(draftOrderLocked && !draftComplete && Number(pick.year || 0) === Number(seasonYear)));

  const resolvedCurrentYearPicks =
    draftOrderLocked && !draftComplete
      ? draftOrder.map((row) => buildResolvedDraftAsset(row, seasonYear))
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

function buildTradePickPayload(asset, protection) {
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
  };
}

const PROTECTIONS = [
  "Unprotected",
  "Top 3 protected",
  "Top 4 protected",
  "Top 5 protected",
  "Top 8 protected",
  "Top 10 protected",
  "Lottery protected",
  "Top 14 protected",
  "1-20 protected",
  "31-55 protected",
];

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

  const picks = useMemo(
    () => collectTradeablePicks({ leagueData, teamName: tradeTeamName, teamNames }),
    [leagueData, tradeTeamName, teamNames]
  );

  const [selectedKey, setSelectedKey] = useState("");
  const [protection, setProtection] = useState("Unprotected");

  useEffect(() => {
    if (!picks.length) {
      setSelectedKey("");
      return;
    }

    setSelectedKey((prev) => {
      if (prev && picks.some((pick) => pickKey(pick) === prev)) return prev;
      return pickKey(picks[0]);
    });
  }, [picks]);

  const selectedPick = picks.find((pick) => pickKey(pick) === selectedKey) || picks[0] || null;

  const addSelected = () => {
    if (!selectedPick) return;

    const builder = readBuilder();
    const currentItems = getSideItems(builder, tradeSide);
    const nextPick = buildTradePickPayload(selectedPick, protection);
    const nextItem = {
      type: "pick",
      teamName: tradeTeamName,
      protection: nextPick.protection,
      pick: nextPick,
    };

    const nextKey = itemKey(nextItem);
    const withoutDupes = currentItems.filter((item) => itemKey(item) !== nextKey);
    const nextItems = [...withoutDupes, nextItem].slice(0, MAX_SIDE_ITEMS);

    saveBuilder(setSideItems(builder, tradeSide, nextItems));
    navigate(returnTo);
  };

  return (
    <PageFade>
      <div className="min-h-screen bmCourtPage text-white px-4 py-8">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-5 flex items-center justify-between gap-4">
            <button
              onClick={() => navigate(returnTo)}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-neutral-200 hover:bg-white/10 hover:text-white"
            >
              ← Back
            </button>

            <div className="text-center">
              <div className="text-xs font-black uppercase tracking-[0.22em] text-orange-300">Select Pick</div>
              <h1 className="text-4xl font-black text-orange-500">{tradeTeamName}</h1>
            </div>

            <button
              onClick={addSelected}
              disabled={!selectedPick}
              className="rounded-xl bg-orange-600 px-5 py-2 text-sm font-black text-white hover:bg-orange-500 disabled:opacity-50"
            >
              Add Pick
            </button>
          </div>

          <div className="mb-5 rounded-2xl border border-white/10 bg-neutral-950/85 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {teamLogo ? (
                  <img src={teamLogo} alt={team?.name || tradeTeamName} className="h-12 w-12 object-contain" />
                ) : (
                  <div className="h-12 w-12 rounded-full bg-white/5" />
                )}
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500">Pick Protection</div>
                  <div className="text-xl font-black text-white">Attach rules before adding</div>
                </div>
              </div>

              <select
                value={protection}
                onChange={(e) => setProtection(e.target.value)}
                className="rounded-xl border border-white/10 bg-black px-4 py-3 font-black text-white outline-none"
              >
                {PROTECTIONS.map((row) => (
                  <option key={row} value={row}>
                    {row}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!picks.length ? (
            <div className="rounded-2xl border border-white/10 bg-neutral-950/85 p-8 text-center">
              <div className="text-2xl font-black text-white">No draft assets found for this team</div>
              <p className="mt-2 text-sm font-semibold text-neutral-500">
                This selector now reads the same normalized leagueData.draftPicks source used by the Draft Picks page.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/80">
              <div className="grid grid-cols-[1fr_130px_180px_180px] gap-0 border-b border-white/10 bg-neutral-800 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-neutral-400">
                <div>Asset</div>
                <div className="text-center">Pick</div>
                <div>Protection</div>
                <div>Origin</div>
              </div>

              {picks.map((pick, index) => {
                const active = pickKey(pick) === selectedKey;
                const originalLogo = logoMap[normalizeTeamName(pick?.originalTeam || "")];
                return (
                  <button
                    key={pickKey(pick)}
                    onClick={() => setSelectedKey(pickKey(pick))}
                    onDoubleClick={addSelected}
                    className={`grid w-full grid-cols-[1fr_130px_180px_180px] items-center gap-0 px-4 py-4 text-left transition ${
                      active
                        ? "bg-orange-600 text-white"
                        : index % 2 === 0
                        ? "bg-neutral-950/85 text-neutral-200 hover:bg-orange-500/10"
                        : "bg-neutral-900/85 text-neutral-200 hover:bg-orange-500/10"
                    }`}
                  >
                    <div>
                      <div className="text-lg font-black">{formatPick(pick)}</div>
                      <div className="mt-1 text-xs font-bold uppercase tracking-[0.12em] opacity-70">
                        {assetTypeLabel(pick)} • Owner: {pick.ownerTeam || pick.owner || tradeTeamName}
                      </div>
                    </div>

                    <div className="text-center text-lg font-black">{getPickNumberLabel(pick)}</div>

                    <div className="text-sm font-bold opacity-90">
                      {compactProtectionLabel(pick)}
                    </div>

                    <div className="flex items-center gap-3 text-sm font-bold opacity-90">
                      {originalLogo ? (
                        <img src={originalLogo} alt={getOriginLabel(pick)} className="h-7 w-7 object-contain" />
                      ) : null}
                      <span>{getOriginLabel(pick)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </PageFade>
  );
}
