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

function PlayerRow({ player, index, lookup, variant = "page" }) {
  const info = getRosterInfo(player, lookup);
  const modal = variant === "modal";

  return (
    <div
      className={
        modal
          ? "grid h-[34px] grid-cols-[18px_24px_minmax(0,1fr)_42px_82px] items-center gap-1.5 rounded-md border border-white/[0.08] bg-neutral-800/88 px-2"
          : "grid h-[32px] grid-cols-[22px_26px_minmax(0,1fr)_46px_122px] items-center gap-2 rounded-md border border-white/[0.08] bg-neutral-800/88 px-2"
      }
    >
      <span className="text-center text-[10px] font-black text-neutral-500">{index + 1}</span>

      <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-950 ring-1 ring-white/10">
        <RuntimePlayerPortrait
          player={info}
          teamName={player.team || ""}
          src={info.headshot}
          alt={player.player}
          className="h-full w-full"
          fallback={<div className="flex h-full w-full items-center justify-center text-[8px] text-neutral-500">—</div>}
        />
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1">
          {info.teamLogo ? <img src={info.teamLogo} alt="" className="h-3.5 w-3.5 shrink-0 object-contain" /> : null}
          <span className="truncate text-[12px] font-black leading-tight text-white" title={player.player}>{player.player}</span>
        </div>
      </div>

      <div className="rounded border border-orange-500/25 bg-orange-500/10 px-1 py-0.5 text-center leading-none">
        <div className="text-[7px] font-black uppercase tracking-wide text-neutral-400">OVR</div>
        <div className="text-[13px] font-black text-orange-400">{info.overall ?? "--"}</div>
      </div>

      <div className="text-right text-[9px] font-bold leading-[1.05] text-neutral-300">
        <div>{fmt(player.ppg)} PPG</div>
        <div>{fmt(player.rpg)} RPG • {fmt(player.apg)} APG</div>
      </div>
    </div>
  );
}

function Section({ title, players, lookup, variant = "page" }) {
  return (
    <div className="min-h-0">
      <h4 className="mb-1 text-[11px] font-black uppercase tracking-wide text-orange-400">{title}</h4>
      <div className="space-y-1">
        {(players || []).map((player, index) => (
          <PlayerRow key={title + "_" + player.player + "_" + player.team + "_" + index} player={player} index={index} lookup={lookup} variant={variant} />
        ))}
      </div>
    </div>
  );
}

function ConferencePageCard({ title, data, lookup }) {
  return (
    <div className="rounded-xl border border-white/15 bg-neutral-950/80 p-3">
      <h3 className="mb-2 text-lg font-black leading-none text-white">{title}</h3>
      <div className="space-y-3">
        <Section title="Starters" players={data?.starters || []} lookup={lookup} variant="page" />
        <Section title="Reserves" players={data?.reserves || []} lookup={lookup} variant="page" />
      </div>
    </div>
  );
}

function GroupCard({ eyebrow, title, players, lookup }) {
  return (
    <div className="rounded-xl border border-white/15 bg-neutral-950/80 p-2.5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="truncate text-[15px] font-black leading-none text-white">{title}</h3>
        <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-orange-400">{eyebrow}</span>
      </div>
      <Section title="" players={players || []} lookup={lookup} variant="modal" />
    </div>
  );
}

function AllStarsPageBoard({ data, lookup }) {
  return (
    <div className="grid items-start gap-3 lg:grid-cols-2">
      <ConferencePageCard title="Eastern Conference" data={data.east} lookup={lookup} />
      <ConferencePageCard title="Western Conference" data={data.west} lookup={lookup} />
    </div>
  );
}

function AllStarsModalBoard({ data, lookup }) {
  return (
    <div className="grid items-start gap-3 xl:grid-cols-4 lg:grid-cols-2">
      <GroupCard eyebrow="East" title="Starters" players={data.east?.starters || []} lookup={lookup} />
      <GroupCard eyebrow="East" title="Reserves" players={data.east?.reserves || []} lookup={lookup} />
      <GroupCard eyebrow="West" title="Starters" players={data.west?.starters || []} lookup={lookup} />
      <GroupCard eyebrow="West" title="Reserves" players={data.west?.reserves || []} lookup={lookup} />
    </div>
  );
}

export function AllStarsContent({ data, leagueData, variant = "modal" }) {
  const lookup = useMemo(() => buildRosterLookupFromLeague(leagueData), [leagueData]);

  if (!data) return null;

  return (
    <div className="min-h-0">
      <div className="mb-2 shrink-0">
        <h2 className="text-2xl font-black leading-none text-orange-400">All-Star Teams</h2>
        <p className="mt-1 text-xs font-semibold text-neutral-300">{data.season} • Cutoff: {data.cutoff_date || "Midseason"}</p>
        <p className="mt-0.5 text-xs text-neutral-400">Eastern and Western Conference starters and reserves.</p>
      </div>

      {variant === "page" ? <AllStarsPageBoard data={data} lookup={lookup} /> : <AllStarsModalBoard data={data} lookup={lookup} />}
    </div>
  );
}

export default function AllStars({ open, data, onClose, closeLabel = "Close" }) {
  const { leagueData } = useGame();

  if (!open || !data) return null;

  return createPortal(
    <>
      <style>{"@keyframes bmModalBackdropIn { from { opacity: 0; } to { opacity: 1; } } @keyframes bmModalLiftIn { from { opacity: 0; transform: translateY(10px) scale(0.985); } to { opacity: 1; transform: translateY(0) scale(1); } } .bmModalFade { animation: bmModalBackdropIn 220ms ease-out both; } .bmModalLift { animation: bmModalLiftIn 260ms cubic-bezier(0.22, 1, 0.36, 1) both; will-change: opacity, transform; } @media (prefers-reduced-motion: reduce) { .bmModalFade, .bmModalLift { animation: none; } }"}</style>

      <div className="bmModalFade fixed inset-0 z-[240] flex items-center justify-center bg-black/80 p-3 backdrop-blur-md" onClick={onClose}>
        <div className="bmModalLift w-full max-w-[1660px] overflow-hidden rounded-2xl border border-white/20 bg-neutral-900 p-4 text-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
          <div className="mb-2 flex shrink-0 justify-end">
            <button className="rounded-lg bg-neutral-700 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-600" onClick={onClose}>
              {closeLabel}
            </button>
          </div>
          <AllStarsContent data={data} leagueData={leagueData} variant="modal" />
        </div>
      </div>
    </>,
    document.body
  );
}
