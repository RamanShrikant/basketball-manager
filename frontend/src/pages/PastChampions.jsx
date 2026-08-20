import React, { useMemo } from "react";
import { useGame } from "../context/GameContext.jsx";
import PageFade from "../components/PageFade.jsx";
import HeadshotLayoutTransform from "../components/HeadshotLayoutTransform.jsx";
import {
  createPlayerLookup,
  createTeamLogoLookup,
  findPlayerByHistoryName,
  findTeamLogoByHistoryName,
  getMergedLeagueHistory,
} from "../utils/leagueHistoryUtils.js";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";

function initials(text = "") {
  const parts = String(text).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function playerImage(player = {}) {
  return player?.headshot || player?.portrait || player?.image || player?.img || player?.photo || player?.headshotUrl || "";
}

function TeamCell({ name, logo, sub }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/35 shadow-lg">
        {logo ? <img src={logo} alt={name} className="h-9 w-9 object-contain" /> : <span className="text-xs font-black text-orange-200">{initials(name)}</span>}
      </div>
      <div className="min-w-0">
        <div className="truncate text-base font-black text-white">{name}</div>
        {sub ? <div className="truncate text-xs font-bold uppercase tracking-[0.12em] text-neutral-500">{sub}</div> : null}
      </div>
    </div>
  );
}

function FinalsMvpCell({ name, team, player }) {
  const img = playerImage(player);
  if (!name) {
    return <div className="text-sm font-bold text-neutral-500">Not awarded before 1969</div>;
  }

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/35">
        {img ? <HeadshotLayoutTransform className="h-full w-full"><img src={img} alt={name} className="h-full w-full object-cover" /></HeadshotLayoutTransform> : <span className="text-xs font-black text-orange-200">{initials(name)}</span>}
      </div>
      <div className="min-w-0">
        <div className="truncate text-base font-black text-white">{name}</div>
        <div className="truncate text-xs font-bold uppercase tracking-[0.12em] text-neutral-500">{team || "Finals MVP"}</div>
      </div>
    </div>
  );
}

export default function PastChampions() {
  const { leagueData } = useGame();
  const history = useMemo(() => getMergedLeagueHistory(leagueData || {}), [leagueData]);
  const playerLookup = useMemo(() => createPlayerLookup(leagueData || {}), [leagueData]);
  const teamLogoLookup = useMemo(() => createTeamLogoLookup(leagueData || {}), [leagueData]);
  const rows = history?.champions || [];
  const latest = rows[0] || null;

  return (
    <PageFade>
      <div className="h-screen max-h-screen overflow-hidden bmCourtPage px-5 pt-3 pb-[82px] text-white">
        <div className="mx-auto flex h-full max-w-[1600px] min-h-0 flex-col">
          <div className="mb-2 grid shrink-0 grid-cols-2 gap-3">
            <div className="rounded-[24px] border border-white/10 bg-neutral-950/80 px-4 py-3">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-neutral-500">Latest Champion</div>
              <div className="mt-1 text-2xl font-black text-white">{latest?.championTeam || "—"}</div>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-neutral-950/80 px-4 py-3">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-neutral-500">Latest Finals MVP</div>
              <div className="mt-1 text-2xl font-black text-white">{latest?.finalsMvp || "—"}</div>
            </div>
          </div>

          <div className="mb-2 min-h-0 flex-1 overflow-y-auto rounded-[28px] border border-white/10 bg-neutral-950/85 pb-2 shadow-2xl">
            <div className="sticky top-0 z-10 grid grid-cols-[120px_1fr_1fr_1fr_160px] gap-4 border-b border-white/10 bg-neutral-900/95 px-5 py-2.5 text-xs font-black uppercase tracking-[0.18em] text-neutral-400 backdrop-blur">
              <div>Season</div>
              <div>Champion</div>
              <div>Runner-Up</div>
              <div>Finals MVP</div>
              <div>Finals</div>
            </div>

            {rows.length ? (
              rows.map((row) => {
                const championLogo = findTeamLogoByHistoryName(teamLogoLookup, row.championTeam);
                const runnerUpLogo = findTeamLogoByHistoryName(teamLogoLookup, row.runnerUp);
                const fmvpPlayer = findPlayerByHistoryName(playerLookup, row.finalsMvp);
                return (
                  <div key={`${row.seasonYear}_${row.championTeam}`} className="grid grid-cols-[120px_1fr_1fr_1fr_160px] gap-4 border-b border-white/10 px-5 py-3 last:border-b-0">
                    <div>
                      <div className="text-base font-black text-orange-200">{row.seasonLabel}</div>
                      <div className="text-xs font-bold uppercase tracking-[0.12em] text-neutral-600">{row.seasonYear}</div>
                    </div>
                    <TeamCell name={row.championTeam} logo={championLogo} sub="NBA Champion" />
                    <TeamCell name={row.runnerUp || "—"} logo={runnerUpLogo} sub={row.runnerUp ? "Finals runner-up" : "Runner-up not recorded"} />
                    <FinalsMvpCell name={row.finalsMvp} team={row.finalsMvpTeam} player={fmvpPlayer} />
                    <div>
                      <div className="text-base font-black text-white">{row.series || "—"}</div>
                      {row.runnerUp ? <div className="mt-1 text-xs font-bold text-neutral-500">def. {row.runnerUp}</div> : null}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-10 text-center text-sm font-bold text-neutral-500">No champions recorded yet.</div>
            )}
          </div>

        </div>
      </div>
    </PageFade>
  );
}
