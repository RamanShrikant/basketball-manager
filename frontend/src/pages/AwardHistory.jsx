import React, { useMemo, useState } from "react";
import { useGame } from "../context/GameContext.jsx";
import PageFade from "../components/PageFade.jsx";
import {
  LEAGUE_HISTORY_AWARD_META,
  LEAGUE_HISTORY_AWARD_ORDER,
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

function PlayerBadge({ name, team, player }) {
  const img = playerImage(player);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/40 shadow-lg">
        {img ? (
          <img src={img} alt={name} className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs font-black text-orange-200">{initials(name)}</span>
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-base font-black text-white">{name}</div>
        <div className="truncate text-xs font-bold uppercase tracking-[0.12em] text-neutral-500">{team || "Team unknown"}</div>
      </div>
    </div>
  );
}

function TeamLogo({ name, src }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/35">
        {src ? <img src={src} alt={name} className="h-7 w-7 object-contain" /> : <span className="text-[11px] font-black text-orange-200">{initials(name)}</span>}
      </div>
      <span className="truncate text-sm font-bold text-neutral-300">{name || "—"}</span>
    </div>
  );
}

export default function AwardHistory() {
  const { leagueData } = useGame();
  const [awardIndex, setAwardIndex] = useState(0);

  const history = useMemo(() => getMergedLeagueHistory(leagueData || {}), [leagueData]);
  const playerLookup = useMemo(() => createPlayerLookup(leagueData || {}), [leagueData]);
  const teamLogoLookup = useMemo(() => createTeamLogoLookup(leagueData || {}), [leagueData]);

  const awardKey = LEAGUE_HISTORY_AWARD_ORDER[awardIndex] || "mvp";
  const meta = LEAGUE_HISTORY_AWARD_META[awardKey];
  const rows = history?.awards?.[awardKey] || [];

  const moveAward = (delta) => {
    setAwardIndex((prev) => (prev + delta + LEAGUE_HISTORY_AWARD_ORDER.length) % LEAGUE_HISTORY_AWARD_ORDER.length);
  };

  return (
    <PageFade>
      <div className="h-screen max-h-screen overflow-hidden bmCourtPage px-5 pt-3 pb-[82px] text-white">
        <div className="mx-auto flex h-full max-w-[1600px] min-h-0 flex-col">
          <div className="mb-2 shrink-0 rounded-[28px] border border-white/10 bg-neutral-950/85 px-4 py-3 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => moveAward(-1)}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/40 text-2xl font-black text-white transition hover:border-orange-400/50 hover:bg-orange-500/20"
                aria-label="Previous award"
              >
                ‹
              </button>

              <div className="min-w-0 flex-1 text-center">
                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-orange-300">{meta.shortLabel}</div>
                <div className="truncate text-3xl font-black text-white">{meta.label}</div>
                <div className="mt-0.5 text-xs font-semibold text-neutral-400">{meta.description}</div>
              </div>

              <button
                type="button"
                onClick={() => moveAward(1)}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/40 text-2xl font-black text-white transition hover:border-orange-400/50 hover:bg-orange-500/20"
                aria-label="Next award"
              >
                ›
              </button>
            </div>

            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {LEAGUE_HISTORY_AWARD_ORDER.map((key, idx) => {
                const item = LEAGUE_HISTORY_AWARD_META[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAwardIndex(idx)}
                    className={`rounded-2xl px-4 py-1.5 text-xs font-black uppercase tracking-[0.14em] transition ${
                      key === awardKey
                        ? "bg-orange-500 text-white"
                        : "border border-white/10 bg-black/30 text-neutral-400 hover:border-orange-400/30 hover:text-white"
                    }`}
                  >
                    {item.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mb-2 min-h-0 flex-1 overflow-y-auto rounded-[28px] border border-white/10 bg-neutral-950/85 pb-2 shadow-2xl">
            <div className="sticky top-0 z-10 grid grid-cols-[120px_1fr_330px] gap-4 border-b border-white/10 bg-neutral-900/95 px-5 py-2.5 text-xs font-black uppercase tracking-[0.18em] text-neutral-400 backdrop-blur">
              <div>Season</div>
              <div>Winner</div>
              <div>Team</div>
            </div>

            {rows.length ? (
              rows.map((row) => {
                const player = findPlayerByHistoryName(playerLookup, row.player);
                const logo = findTeamLogoByHistoryName(teamLogoLookup, row.team);
                return (
                  <div key={`${row.key}_${row.seasonYear}_${row.player}_${row.team}`} className="grid grid-cols-[120px_1fr_330px] gap-4 border-b border-white/10 px-5 py-3 last:border-b-0">
                    <div>
                      <div className="text-base font-black text-orange-200">{row.seasonLabel}</div>
                      <div className="text-xs font-bold uppercase tracking-[0.12em] text-neutral-600">{row.seasonYear}</div>
                    </div>
                    <PlayerBadge name={row.player} team={row.team} player={player} />
                    <TeamLogo name={row.team} src={logo} />
                  </div>
                );
              })
            ) : (
              <div className="p-10 text-center text-sm font-bold text-neutral-500">No winners recorded for this award yet.</div>
            )}
          </div>

        </div>
      </div>
    </PageFade>
  );
}
