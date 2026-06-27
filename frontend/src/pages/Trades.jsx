import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import PageFade from "../components/PageFade";
import CpuTradeDiscoveryPanel from "../components/CpuTradeDiscoveryPanel.jsx";
import {
  readTradeDeskFeed,
  mergeTradeDeskFeedWithLeague,
  buildTradeHistoryLogEntries,
} from "../utils/tradeDeskFeed.js";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";

const TRADE_BUILDER_KEY = "bm_trade_builder_v1";

const DESK_FILTERS = [
  { key: "rumor", label: "Rumors", countKey: "rumors" },
  { key: "negotiation", label: "Talks", countKey: "negotiations" },
  { key: "transaction", label: "Deals", countKey: "transactions" },
];

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

function buildEmptyDeskItems(teams = []) {
  const teamCount = teams.length;
  return [
    {
      id: "empty_transaction_wire",
      label: "Transaction Wire",
      headline: "No CPU-to-CPU trade has been logged yet. Sim ahead and completed league moves will appear here.",
      tag: "Feed",
      type: "empty",
      date: "Live",
    },
    {
      id: "empty_market_watch",
      label: "Market Watch",
      headline: teamCount
        ? `${teamCount} teams are being tracked. Rumors will update from real CPU buyer/seller signals during the season.`
        : "League teams are still loading. Trade Desk intel will appear once the league is ready.",
      tag: "Waiting",
      type: "empty",
      date: "Live",
    },
  ];
}

function buildFilteredEmptyDeskItems(filterKey, teams = []) {
  const teamCount = teams.length;

  if (filterKey === "rumor") {
    return [
      {
        id: "empty_rumor_filter",
        label: "Rumor Wire",
        headline: teamCount
          ? `${teamCount} teams are being tracked. More real buyer/seller rumors will appear after future CPU trade checks.`
          : "League teams are still loading. Rumors will appear once the league is ready.",
        tag: "No Rumors",
        type: "empty",
        date: "Live",
      },
    ];
  }

  if (filterKey === "negotiation") {
    return [
      {
        id: "empty_talks_filter",
        label: "Negotiation Wire",
        headline: "No active or stalled CPU trade talks are currently logged. Sim ahead and framework talks will appear here.",
        tag: "No Talks",
        type: "empty",
        date: "Live",
      },
    ];
  }

  if (filterKey === "transaction") {
    return [
      {
        id: "empty_deals_filter",
        label: "Transaction Wire",
        headline: "No completed deal has been logged yet. Sim closer to the deadline and completed moves will appear here.",
        tag: "No Deals",
        type: "empty",
        date: "Live",
      },
    ];
  }

  return buildEmptyDeskItems(teams);
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
  const [showCpuTradeScanner, setShowCpuTradeScanner] = useState(false);

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
      <div className="min-h-screen bmCourtPage text-white px-4 py-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
          <div className="flex items-center justify-between gap-4">
            <button
              onClick={() => navigate("/team-hub")}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-neutral-200 transition hover:bg-white/10 hover:text-white"
            >
              ← Team Hub
            </button>

            <div className="text-center">
              <div className="text-xs font-black uppercase tracking-[0.24em] text-orange-300">
                Trade Center
              </div>
              <h1 className="mt-1 text-4xl font-black text-orange-500">
                {selectedTeam.name} Trades
              </h1>
            </div>

            <div className="w-[108px]" />
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.08fr_0.92fr]">
            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950/85 shadow-2xl">
              <div className="border-b border-white/10 bg-gradient-to-r from-orange-600/25 via-neutral-900 to-neutral-900 px-6 py-5">
                <div className="flex items-center gap-4">
                  {teamLogoOf(selectedTeam) ? (
                    <img
                      src={teamLogoOf(selectedTeam)}
                      alt={selectedTeam.name}
                      className="h-16 w-16 object-contain"
                    />
                  ) : (
                    <div className="h-16 w-16 rounded-2xl bg-white/5" />
                  )}
                  <div>
                    <div className="text-sm font-black uppercase tracking-[0.18em] text-orange-200">
                      Ready to negotiate
                    </div>
                    <div className="mt-1 text-2xl font-black text-white">
                      Build a proposal package
                    </div>
                    <div className="mt-1 text-sm font-semibold text-neutral-400">
                      Add players and picks to create your offer.
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6">
                <button
                  onClick={() => navigate("/propose-trade")}
                  className="w-full rounded-2xl bg-orange-600 px-6 py-5 text-xl font-black text-white shadow-[0_18px_45px_rgba(234,88,12,0.24)] transition hover:-translate-y-0.5 hover:bg-orange-500"
                >
                  Propose Trade
                </button>

                <button
                  onClick={() => navigate("/trade-finder")}
                  className="mt-4 w-full rounded-2xl border border-orange-400/25 bg-black px-6 py-5 text-xl font-black text-orange-100 transition hover:-translate-y-0.5 hover:border-orange-300/60 hover:bg-orange-500/10"
                >
                  Trade Finder
                </button>

                <button
                  type="button"
                  onClick={() => setShowCpuTradeScanner((prev) => !prev)}
                  className="mt-4 w-full rounded-2xl border border-sky-300/25 bg-sky-500/10 px-6 py-5 text-xl font-black text-sky-100 transition hover:-translate-y-0.5 hover:border-sky-300/60 hover:bg-sky-500/20"
                >
                  All Possible CPU Trades
                </button>

                {hasSavedProposal && (
                  <div className="mt-5 rounded-2xl border border-orange-400/25 bg-orange-500/10 p-4 text-sm font-semibold text-orange-100">
                    Saved proposal: {pluralize(userItems, "asset")} from your side, {pluralize(cpuItems, "asset")} from the other side.
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950/75 shadow-2xl">
              <div className="border-b border-white/10 bg-gradient-to-r from-neutral-900 to-black px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-black uppercase tracking-[0.2em] text-orange-300">
                      Trade Desk
                    </div>
                    <div className="mt-1 text-2xl font-black text-white">
                      {showingHistory ? "Trade History Log" : "League Rumor Board"}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-neutral-500">
                      {showingHistory
                        ? "Completed season trades with timing, full packages, and both-side reasoning."
                        : "Real CPU front-office signals, negotiations, and completed movement."}
                    </div>
                  </div>
                  <button
                    onClick={() => setStoredFeed(readTradeDeskFeed())}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-neutral-300 transition hover:border-orange-300/40 hover:bg-orange-500/10"
                  >
                    Refresh
                  </button>
                </div>
              </div>

              <div className="grid gap-3 p-6">
                <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/25 p-2 text-center">
                  <button
                    type="button"
                    onClick={() => setActiveDeskView("live")}
                    className={`rounded-xl border px-3 py-3 transition ${
                      !showingHistory
                        ? "border-orange-400/60 bg-orange-500/15 shadow-[0_0_20px_rgba(249,115,22,0.12)]"
                        : "border-transparent bg-transparent hover:border-orange-400/25 hover:bg-orange-500/10"
                    }`}
                  >
                    <div className="text-sm font-black text-white">Live Board</div>
                    <div className={`text-[10px] font-black uppercase tracking-[0.16em] ${!showingHistory ? "text-orange-200" : "text-neutral-500"}`}>
                      {allTradeDeskRows.length} items
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveDeskView("history")}
                    className={`rounded-xl border px-3 py-3 transition ${
                      showingHistory
                        ? "border-orange-400/60 bg-orange-500/15 shadow-[0_0_20px_rgba(249,115,22,0.12)]"
                        : "border-transparent bg-transparent hover:border-orange-400/25 hover:bg-orange-500/10"
                    }`}
                  >
                    <div className="text-sm font-black text-white">History Log</div>
                    <div className={`text-[10px] font-black uppercase tracking-[0.16em] ${showingHistory ? "text-orange-200" : "text-neutral-500"}`}>
                      {tradeHistoryRows.length} trades
                    </div>
                  </button>
                </div>

                {!showingHistory && (
                  <>
                    <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-black/25 p-3 text-center">
                      {DESK_FILTERS.map((filter) => {
                        const active = activeDeskFilter === filter.key;
                        return (
                          <button
                            key={filter.key}
                            type="button"
                            onClick={() =>
                              setActiveDeskFilter((prev) =>
                                prev === filter.key ? "all" : filter.key
                              )
                            }
                            className={`rounded-xl border px-2 py-3 transition ${
                              active
                                ? "border-orange-400/60 bg-orange-500/15 shadow-[0_0_20px_rgba(249,115,22,0.12)]"
                                : "border-transparent bg-transparent hover:border-orange-400/25 hover:bg-orange-500/10"
                            }`}
                            title={`Show ${filter.label.toLowerCase()} only`}
                          >
                            <div className="text-lg font-black text-white">
                              {feedCounts[filter.countKey]}
                            </div>
                            <div className={`text-[10px] font-black uppercase tracking-[0.16em] ${
                              active ? "text-orange-200" : "text-neutral-500"
                            }`}>
                              {filter.label}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {showingFilteredDesk && (
                      <div className="flex items-center justify-between gap-3 rounded-2xl border border-orange-400/20 bg-orange-500/10 px-4 py-3">
                        <div className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-100">
                          Showing {labelForDeskFilter(activeDeskFilter)} only
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveDeskFilter("all")}
                          className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-neutral-300 transition hover:border-orange-300/40 hover:text-white"
                        >
                          Show All
                        </button>
                      </div>
                    )}

                    {tradeDeskItems.map((item) => (
                      <div
                        key={item.id || `${item.label}_${item.headline}`}
                        className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition hover:border-orange-400/30 hover:bg-orange-500/10"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs font-black uppercase tracking-[0.16em] text-orange-200">
                            {item.label}
                          </div>
                          <div className="rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-neutral-400">
                            {item.tag}
                          </div>
                        </div>
                        <div className="mt-2 text-sm font-bold leading-relaxed text-neutral-200">
                          {item.headline}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-neutral-500">
                          <span>{formatFeedDate(item)}</span>
                          {Array.isArray(item.teamNames) && item.teamNames.slice(0, 2).map((team) => (
                            <span key={team} className="rounded-full border border-white/10 bg-black/25 px-2 py-1">
                              {team}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {showingHistory && (
                  <div className="grid max-h-[610px] gap-3 overflow-y-auto pr-1">
                    {tradeHistoryRows.length ? (
                      tradeHistoryRows.map((entry) => (
                        <TradeHistoryCard key={entry.id} entry={entry} teams={teams} />
                      ))
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                        <div className="text-xs font-black uppercase tracking-[0.16em] text-orange-200">
                          No Completed Trades
                        </div>
                        <div className="mt-2 text-sm font-bold leading-relaxed text-neutral-300">
                          No trade history has been saved for this season yet. Once user trades or CPU-to-CPU trades complete, the full packages and reasoning will appear here.
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={() => navigate("/propose-trade")}
                  className="mt-2 rounded-2xl border border-orange-400/25 bg-orange-500/10 px-5 py-4 text-sm font-black text-orange-100 transition hover:border-orange-300/50 hover:bg-orange-500/20"
                >
                  Open Trade Builder
                </button>

                <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-xs font-semibold text-neutral-500">
                  Trade desk refresh: live local feed • League teams available: {teams.length} • History trades: {tradeHistoryRows.length}
                </div>
              </div>
            </div>
          </div>

          {showCpuTradeScanner && (
            <CpuTradeDiscoveryPanel
              leagueData={leagueData}
              selectedTeam={selectedTeam}
            />
          )}
        </div>
      </div>
    </PageFade>
  );
}
