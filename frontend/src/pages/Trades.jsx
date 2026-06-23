import React from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import PageFade from "../components/PageFade";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";

const TRADE_BUILDER_KEY = "bm_trade_builder_v1";

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

export default function Trades() {
  const navigate = useNavigate();
  const { leagueData, selectedTeam } = useGame();
  const teams = getAllTeamsFromLeague(leagueData);
  const existing = readBuilder();
  const userItems = existing?.userItems?.length || 0;
  const cpuItems = existing?.cpuItems?.length || 0;
  const hasSavedProposal = Boolean(existing && (userItems > 0 || cpuItems > 0));

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

  const tradeDeskItems = [
    {
      label: "Star Watch",
      headline: "Several front offices are monitoring high-usage scorers before the deadline.",
      tag: "Rumor",
    },
    {
      label: "Available Names",
      headline: "Veteran wings and backup guards are expected to draw the most early calls.",
      tag: "Market",
    },
    {
      label: "League Pulse",
      headline: "Teams near the play-in line may wait two more weeks before choosing a direction.",
      tag: "Trend",
    },
    {
      label: "Transaction Wire",
      headline: "No major trade has been logged yet. New moves will appear here as the league updates.",
      tag: "Feed",
    },
  ];

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

                {hasSavedProposal && (
                  <div className="mt-5 rounded-2xl border border-orange-400/25 bg-orange-500/10 p-4 text-sm font-semibold text-orange-100">
                    Saved proposal: {pluralize(userItems, "asset")} from your side, {pluralize(cpuItems, "asset")} from the other side.
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950/75 shadow-2xl">
              <div className="border-b border-white/10 bg-gradient-to-r from-neutral-900 to-black px-6 py-5">
                <div className="text-sm font-black uppercase tracking-[0.2em] text-orange-300">
                  Trade Desk
                </div>
                <div className="mt-1 text-2xl font-black text-white">
                  League Rumor Board
                </div>
                <div className="mt-1 text-sm font-semibold text-neutral-500">
                  Around-the-league notes, availability signals, and recent movement.
                </div>
              </div>

              <div className="grid gap-3 p-6">
                {tradeDeskItems.map((item) => (
                  <div
                    key={item.label}
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
                  </div>
                ))}

                <button
                  onClick={() => navigate("/propose-trade")}
                  className="mt-2 rounded-2xl border border-orange-400/25 bg-orange-500/10 px-5 py-4 text-sm font-black text-orange-100 transition hover:border-orange-300/50 hover:bg-orange-500/20"
                >
                  Open Trade Builder
                </button>

                <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-xs font-semibold text-neutral-500">
                  Trade desk refresh: every 14 days • League teams available: {teams.length}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageFade>
  );
}
