import React, { useMemo } from "react";
import { createPortal } from "react-dom";
import { useGame } from "../context/GameContext";
import RuntimePlayerPortrait from "../components/RuntimePlayerPortrait.jsx";

function buildRosterLookupFromLeague(leagueData) {
  const byKey = {};
  const byName = {};

  const allTeams = Array.isArray(leagueData?.teams)
    ? leagueData.teams
    : Object.values(leagueData?.conferences || {}).flat();

  for (const team of allTeams) {
    const teamName = team?.name || team?.team;
    const teamLogo =
      team?.logo ||
      team?.teamLogo ||
      team?.newTeamLogo ||
      team?.logoUrl ||
      team?.image ||
      team?.img ||
      "";

    for (const p of team?.players || []) {
      const playerName = p?.name || p?.player;
      if (!playerName || !teamName) continue;

      const info = {
        headshot: p?.headshot || p?.portrait || p?.image || p?.photo || p?.img || "",
        overall: p?.overall ?? p?.ovr ?? p?.rating ?? p?.overall_rating ?? null,
        teamLogo,
        portraitId: p?.portraitId || p?.portraitFamilyId || "",
        portraitFamilyId: p?.portraitFamilyId || p?.portraitId || "",
        portraitVariant: p?.portraitVariant || p?.portraitStage || "",
      };

      byKey[playerName + "__" + teamName] = info;
      if (!byName[playerName]) byName[playerName] = info;
    }
  }

  return { byKey, byName };
}

function getRosterInfo(player, lookup) {
  if (!player) return {};
  return lookup.byKey?.[String(player.player || "") + "__" + String(player.team || "")] || lookup.byName?.[player.player] || {};
}

function fmt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

function PlayerRow({ player, index, lookup }) {
  const info = getRosterInfo(player, lookup);

  return (
    <div className="grid min-h-[44px] grid-cols-[26px_34px_minmax(220px,1fr)_58px_118px] items-center gap-2 rounded-lg border border-white/[0.08] bg-neutral-800/88 px-2.5 py-1.5">
      <span className="text-center text-[11px] font-black text-neutral-500">{index + 1}</span>

      <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-950 ring-1 ring-white/10">
        <RuntimePlayerPortrait
          player={info}
          teamName={player.team || ""}
          src={info.headshot}
          alt={player.player}
          className="h-full w-full"
          fallback={<div className="flex h-full w-full items-center justify-center text-[8px] text-neutral-500">—</div>}
        />
      </div>

      <div className="min-w-0 pr-1">
        <div className="flex min-w-0 items-center gap-2">
          {info.teamLogo ? <img src={info.teamLogo} alt="" className="h-4 w-4 shrink-0 object-contain" /> : null}
          <span className="bmAllStarsPlayerName min-w-0 whitespace-normal break-words text-[14px] font-black leading-tight text-white" title={player.player}>
            {player.player}
          </span>
        </div>
      </div>

      <div className="rounded border border-orange-500/25 bg-orange-500/10 px-1.5 py-1 text-center leading-none">
        <div className="text-[7px] font-black uppercase tracking-wide text-neutral-400">OVR</div>
        <div className="text-[15px] font-black text-orange-400">{info.overall ?? "--"}</div>
      </div>

      <div className="min-w-[112px] text-right text-[10px] font-bold leading-[1.15] text-neutral-300">
        <div>{fmt(player.ppg)} PPG</div>
        <div>{fmt(player.rpg)} RPG • {fmt(player.apg)} APG</div>
      </div>
    </div>
  );
}

function Section({ title, players, lookup }) {
  return (
    <section className="min-w-0">
      <h4 className="mb-1.5 text-[12px] font-black uppercase tracking-wide text-orange-400">{title}</h4>
      <div className="space-y-1.5">
        {(players || []).map((player, index) => (
          <PlayerRow key={title + "_" + player.player + "_" + player.team + "_" + index} player={player} index={index} lookup={lookup} />
        ))}
      </div>
    </section>
  );
}

function ConferenceAllStarCard({ title, data, lookup }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/15 bg-neutral-950/80 p-3.5 shadow-xl shadow-black/25">
      <h3 className="mb-3 text-[21px] font-black leading-none text-white">{title}</h3>
      <div className="space-y-4">
        <Section title="Starters" players={data?.starters || []} lookup={lookup} />
        <Section title="Reserves" players={data?.reserves || []} lookup={lookup} />
      </div>
    </div>
  );
}

function AllStarsBoard({ data, lookup }) {
  return (
    <div className="bmAllStarsReadableBoard grid items-start gap-3 xl:grid-cols-2">
      <ConferenceAllStarCard title="Eastern Conference" data={data.east} lookup={lookup} />
      <ConferenceAllStarCard title="Western Conference" data={data.west} lookup={lookup} />
    </div>
  );
}

export function AllStarsContent({ data, leagueData }) {
  const lookup = useMemo(() => buildRosterLookupFromLeague(leagueData), [leagueData]);

  if (!data) return null;

  return (
    <div className="min-h-0">
      <div className="mb-3 shrink-0">
        <h2 className="text-2xl font-black leading-none text-orange-400">All-Star Teams</h2>
        <p className="mt-1 text-xs font-semibold text-neutral-300">{data.season} • Cutoff: {data.cutoff_date || "Midseason"}</p>
        <p className="mt-0.5 text-xs text-neutral-400">Eastern and Western Conference starters and reserves.</p>
      </div>

      <AllStarsBoard data={data} lookup={lookup} />
    </div>
  );
}

export default function AllStars({ open, data, onClose, closeLabel = "Close" }) {
  const { leagueData } = useGame();

  if (!open || !data) return null;

  return createPortal(
    <>
      <style>{"@keyframes bmModalBackdropIn { from { opacity: 0; } to { opacity: 1; } } @keyframes bmModalLiftIn { from { opacity: 0; transform: translateY(10px) scale(0.985); } to { opacity: 1; transform: translateY(0) scale(1); } } .bmModalFade { animation: bmModalBackdropIn 220ms ease-out both; } .bmModalLift { animation: bmModalLiftIn 260ms cubic-bezier(0.22, 1, 0.36, 1) both; will-change: opacity, transform; } @media (prefers-reduced-motion: reduce) { .bmModalFade, .bmModalLift { animation: none; } }"}</style>

      <div className="bmModalFade fixed inset-0 z-[240] flex items-center justify-center bg-black/82 p-3 backdrop-blur-md" onClick={onClose}>
        <div className="bmModalLift flex max-h-[94vh] w-[min(1680px,98vw)] flex-col overflow-hidden rounded-2xl border border-white/20 bg-neutral-900 text-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
          <div className="flex shrink-0 justify-end border-b border-white/10 bg-neutral-900/95 px-4 py-3">
            <button className="rounded-lg bg-neutral-700 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-600" onClick={onClose}>
              {closeLabel}
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto p-4">
            <AllStarsContent data={data} leagueData={leagueData} />
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
