// src/pages/Intel_v1.jsx
import RuntimePlayerPortrait from "../components/RuntimePlayerPortrait.jsx";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import PageFade from "../components/PageFade";
import useKeyboardListNavigation from "../utils/useKeyboardListNavigation";
import {
  buildLeagueIntel,
  formatMoney,
  phaseTone,
  playerHeadshotOf,
  playerNameOf,
} from "../utils/teamIntel_v1.js";
import { normalizeTeamName } from "../utils/draftPicks.js";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";

const GLASS = "border border-white/10 bg-neutral-950/82 shadow-[0_22px_70px_rgba(0,0,0,0.42)] backdrop-blur-xl";
const PANEL = `rounded-[24px] ${GLASS}`;
const MINI = "rounded-2xl border border-white/10 bg-black/35";

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

function Pill({ children, className = "" }) {
  return (
    <span className={cx("inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.13em]", className)}>
      {children}
    </span>
  );
}

function SectionTitle({ label, sub }) {
  return (
    <div className="shrink-0">
      <div className="text-[11px] font-black uppercase tracking-[0.22em] text-orange-300">{label}</div>
      {sub && <div className="mt-0.5 truncate text-[10px] font-bold text-neutral-500">{sub}</div>}
    </div>
  );
}

function FilterButton({ mode, label, count, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "rounded-full border px-3.5 py-2 text-[11px] font-black uppercase tracking-[0.13em] transition",
        active
          ? "border-orange-400/60 bg-orange-600 text-white shadow-lg shadow-orange-500/20"
          : "border-white/10 bg-black/40 text-neutral-300 hover:border-orange-400/35 hover:bg-orange-500/10 hover:text-white"
      )}
    >
      {label}
      <span className="ml-2 rounded-full bg-black/30 px-1.5 py-0.5 text-[9px] text-white/80">{count}</span>
    </button>
  );
}

function TeamRow({ row, active, onClick, rowIndex }) {
  const phaseLetter = row.phase === "contending" ? "CONT" : row.phase === "retooling" ? "RETO" : "REBU";
  return (
    <button
      type="button"
      data-bm-intel-row-index={rowIndex}
      onClick={onClick}
      className={cx(
        "group grid h-[46px] w-full grid-cols-[30px_1fr_auto] items-center gap-2 rounded-xl border px-2.5 text-left transition",
        active
          ? "border-orange-400/70 bg-gradient-to-r from-orange-500/25 to-orange-500/8 shadow-lg shadow-orange-500/10"
          : "border-white/8 bg-white/[0.035] hover:border-orange-400/30 hover:bg-orange-500/10"
      )}
    >
      <div className="grid h-7 w-7 place-items-center overflow-hidden rounded-lg bg-black/40 ring-1 ring-white/10">
        {row.logo ? <img src={row.logo} alt={row.name} className="h-6 w-6 object-contain" /> : <span className="text-[8px] text-neutral-600">NBA</span>}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-black leading-none text-white">{row.name}</div>
        <div className="mt-1 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.11em] text-neutral-500">
          <span>{phaseLetter}</span>
          <span>•</span>
          <span>{row.power.conference || "Conf"} #{row.power.conferenceRank || "—"}</span>
        </div>
      </div>
      <div className="rounded-full border border-white/10 bg-black/25 px-2 py-1 text-[10px] font-black text-orange-200">
        #{row.power.rank || "—"}
      </div>
    </button>
  );
}

function TeamSidebar({ visibleRows, active, setActiveName }) {
  return (
    <aside className={cx(PANEL, "flex min-h-0 flex-col overflow-hidden")}> 
      <div className="shrink-0 border-b border-white/10 px-4 py-3">
        <SectionTitle label="Opposing Teams" sub={`Your team hidden • ${visibleRows.length} shown`} />
      </div>
      <div className="bm-intel-scroll min-h-0 flex-1 overflow-y-auto p-2.5 pr-1.5">
        <div className="grid gap-2 pr-1">
          {visibleRows.map((row, rowIndex) => (
            <TeamRow key={row.name} row={row} active={row.name === active?.name} rowIndex={rowIndex} onClick={() => setActiveName(row.name)} />
          ))}
        </div>
      </div>
    </aside>
  );
}

function StatTile({ label, value, sub = "", tone = "orange" }) {
  const toneClass = tone === "green" ? "text-emerald-300" : tone === "red" ? "text-rose-300" : "text-orange-300";
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-center">
      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/65">{label}</div>
      <div className={cx("mt-1 truncate text-3xl font-black leading-none", toneClass)}>{value}</div>
      {sub && <div className="mt-1 truncate text-[10px] font-bold text-neutral-500">{sub}</div>}
    </div>
  );
}

function PlayerTiny({ row, source = false, compact = false }) {
  const player = row?.player || row;
  const name = row?.name || playerNameOf(player);
  const headshot = row?.headshot || playerHeadshotOf(player);
  const overall = row?.overall ?? player?.overall ?? "—";
  const potential = row?.potential ?? player?.potential ?? "—";
  const age = row?.age ?? player?.age ?? "—";
  const pos = row?.pos || player?.pos || "-";
  const meta = `${pos} · ${overall} OVR · ${potential} POT · Age ${age}`;
  const footer = row?.salary ? formatMoney(row.salary) : "";

  return (
    <div className={cx("grid min-w-0 grid-cols-[36px_1fr_auto] items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.035] px-2.5", compact ? "h-full min-h-[46px] max-h-[54px]" : "h-[54px]")}> 
      <div className="flex h-8 w-8 shrink-0 items-end justify-center overflow-hidden rounded-lg bg-black/50 ring-1 ring-white/8">
        <RuntimePlayerPortrait player={player} teamName={row?.teamName || row?.team || player?.teamName || ""} src={headshot} alt={name} className="h-10 w-10" fallback={<span className="text-[8px] text-neutral-600">N/A</span>} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[12px] font-black leading-none text-white">{name}</div>
        <div className="mt-1 truncate text-[9px] font-black uppercase tracking-[0.08em] text-neutral-400">{meta}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {footer && <span className="max-w-[58px] truncate text-right text-[10px] font-black text-neutral-300">{footer}</span>}
        {source && row?.sourceLogo ? <img src={row.sourceLogo} alt={row.sourceTeamName} className="h-6 w-6 object-contain" /> : null}
      </div>
    </div>
  );
}

function ListPanel({ title, subtitle, rows = [], empty, source = false, limit = 3 }) {
  const shown = rows.slice(0, limit);
  const more = Math.max(0, rows.length - shown.length);
  const rowCount = Math.max(1, shown.length);
  return (
    <div className={cx(PANEL, "flex min-h-0 flex-col overflow-hidden p-3")}> 
      <div className="mb-2 flex shrink-0 items-start justify-between gap-2">
        <SectionTitle label={title} sub={subtitle} />
        {more > 0 && <Pill className="border-white/10 bg-black/30 text-neutral-300">+{more}</Pill>}
      </div>
      <div
        className="grid min-h-0 flex-1 gap-2"
        style={{ gridTemplateRows: shown.length ? `repeat(${rowCount}, minmax(0, 1fr))` : "1fr" }}
      >
        {shown.length ? shown.map((row) => (
          <div key={`${title}-${row.sourceTeamName || ""}-${row.name}`} className="min-h-0">
            <PlayerTiny row={row} source={source} compact />
          </div>
        )) : <EmptyMini>{empty}</EmptyMini>}
      </div>
    </div>
  );
}

function EmptyMini({ children = "No clear read." }) {
  return <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs font-bold text-neutral-500">{children}</div>;
}

function LineupCard({ active }) {
  const lineup = active.lineup || [];
  return (
    <div className={cx(PANEL, "flex min-h-0 flex-col overflow-hidden p-3")}> 
      <div className="mb-2 flex items-start justify-between gap-2">
        <SectionTitle label="Lineup" sub="current best six" />
        <Pill className="border-orange-400/25 bg-orange-500/10 text-orange-100">Best 6</Pill>
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-6 rounded-2xl border border-white/8 bg-black/20">
        {lineup.slice(0, 6).map((slot) => (
          <div key={slot.label} className="grid grid-cols-[40px_1fr_42px_38px] items-center border-b border-white/6 px-3 text-[12px] last:border-b-0">
            <div className="font-black text-orange-300">{slot.label}</div>
            <div className="truncate font-black text-white">{slot.player?.name || "—"}</div>
            <div className="text-right font-black text-orange-200">{slot.player?.overall ?? "—"}</div>
            <div className="text-right font-bold text-neutral-500">{slot.player?.age ?? "—"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusPanel({ active }) {
  const bullets = (active.statusBullets || []).slice(0, 5);
  return (
    <div className={cx(PANEL, "relative flex min-h-0 flex-col overflow-hidden")}> 
      <div className="grid shrink-0 grid-cols-[180px_1fr] border-b border-white/10 bg-gradient-to-r from-white/8 to-orange-500/8">
        <div className="px-4 py-2.5 text-[12px] font-black uppercase tracking-[0.16em] text-white">Team Status</div>
        <div className="px-4 py-2.5 text-center text-[12px] font-black uppercase tracking-[0.16em] text-orange-200">{active.phaseLabel}</div>
      </div>
      <div className="grid min-h-0 flex-1 content-center gap-1.5 px-5 py-2.5">
        {bullets.map((line, idx) => (
          <div key={`${line}-${idx}`} className="grid grid-cols-[18px_1fr] gap-2 text-[12px] font-semibold leading-5 text-neutral-100">
            <span className="pt-0.5 text-orange-300">▪</span>
            <span>{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExpiringPanel({ active }) {
  const expiring = (active.expiringContracts || []).slice(0, 4);
  const rowCount = Math.max(1, expiring.length);
  return (
    <div className={cx(PANEL, "flex min-h-0 flex-col overflow-hidden p-3")}> 
      <div className="mb-2 flex shrink-0 items-start justify-between gap-2">
        <SectionTitle label="Expiring Deals" sub="highest rated contracts ending soon" />
      </div>
      <div
        className="grid min-h-0 flex-1 gap-2"
        style={{ gridTemplateRows: expiring.length ? `repeat(${rowCount}, minmax(0, 1fr))` : "1fr" }}
      >
        {expiring.map((row) => (
          <div key={`exp-${row.name}`} className="min-h-0">
            <PlayerTiny row={{ ...row, reason: `${formatMoney(row.salary)} expiring` }} compact />
          </div>
        ))}
        {!expiring.length && <EmptyMini>No major expiring deals.</EmptyMini>}
      </div>
    </div>
  );
}

function ReportHeader({ active }) {
  const recordText = active.record.gp ? `${active.record.w}-${active.record.l}` : "0-0";
  const confText = active.power.conferenceRank ? `${active.power.conferenceRank}/${active.power.conferenceTeamCount || 15}` : "—";
  const capTone = active.capSpace >= 0 ? "green" : "red";

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950/85 shadow-2xl">
      {active.logo && <img src={active.logo} alt="" aria-hidden="true" className="pointer-events-none absolute -left-6 top-1/2 h-36 w-36 -translate-y-1/2 object-contain opacity-10" />}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_50%,rgba(249,115,22,0.22),transparent_33%),linear-gradient(90deg,rgba(0,0,0,0.28),rgba(0,0,0,0.8))]" />
      <div className="relative z-10 grid h-full grid-cols-[1fr_560px] items-center gap-4 px-6">
        <div className="min-w-0 pl-20">
          <div className="text-[10px] font-black uppercase tracking-[0.32em] text-orange-200">Team Intel Report</div>
          <div className="mt-1 flex min-w-0 items-center gap-3">
            {active.logo && <img src={active.logo} alt={active.name} className="h-10 w-10 shrink-0 object-contain" />}
            <h2 className="truncate text-[34px] font-black leading-none text-white">{active.name}</h2>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Pill className={phaseTone(active.phase)}>{active.phaseLabel}</Pill>
            <Pill className="border-white/10 bg-black/35 text-neutral-300">Power #{active.power.rank || "—"}</Pill>
            <Pill className="border-white/10 bg-black/35 text-neutral-300">Avg age {active.roster.avgAge.toFixed(1)}</Pill>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Record" value={recordText} sub={active.record.gp ? `${active.record.gp} games` : "preseason"} />
          <StatTile label="Conf" value={confText} sub={active.power.conference || "conference"} />
          <StatTile label="Cap Space" value={formatMoney(active.capSpace)} sub={`payroll ${formatMoney(active.payroll)}`} tone={capTone} />
        </div>
      </div>
    </div>
  );
}

export default function Intel() {
  const navigate = useNavigate();
  const { leagueData, selectedTeam } = useGame();
  const [filter, setFilter] = useState("all");
  const rows = useMemo(() => buildLeagueIntel(leagueData), [leagueData]);
  const userTeamName = selectedTeam?.name || "";
  const opponentRows = useMemo(
    () => rows.filter((row) => normalizeTeamName(row.name) !== normalizeTeamName(userTeamName)),
    [rows, userTeamName]
  );
  const [activeName, setActiveName] = useState("");

  const counts = useMemo(() => ({
    all: opponentRows.length,
    contending: opponentRows.filter((row) => row.phase === "contending").length,
    retooling: opponentRows.filter((row) => row.phase === "retooling").length,
    rebuilding: opponentRows.filter((row) => row.phase === "rebuilding").length,
  }), [opponentRows]);

  const visibleRows = useMemo(() => {
    return filter === "all" ? opponentRows : opponentRows.filter((row) => row.phase === filter);
  }, [filter, opponentRows]);

  const active = useMemo(() => {
    if (!visibleRows.length && !opponentRows.length) return null;
    return visibleRows.find((row) => row.name === activeName) || visibleRows[0] || opponentRows[0] || null;
  }, [activeName, visibleRows, opponentRows]);

  useEffect(() => {
    if (active?.name && active.name !== activeName) setActiveName(active.name);
  }, [active?.name, activeName]);

  useKeyboardListNavigation({
    items: visibleRows,
    selectedItem: active,
    onSelect: (row) => setActiveName(row.name),
    getKey: (row) => row?.name,
    rowSelector: "[data-bm-intel-row-index]",
  });

  if (!leagueData) {
    return (
      <PageFade>
        <div className="bmCourtPage flex h-full items-center justify-center text-white">Loading league intel...</div>
      </PageFade>
    );
  }

  if (!active) {
    return (
      <PageFade>
        <div className="bmCourtPage flex h-full flex-col items-center justify-center gap-4 px-4 text-center text-white">
          <h1 className="text-3xl font-black text-orange-500">League Intel</h1>
          <p className="text-neutral-400">No opponent teams found.</p>
          <button onClick={() => navigate("/team-hub")} className="rounded-xl bg-orange-600 px-6 py-3 font-bold">Team Hub</button>
        </div>
      </PageFade>
    );
  }

  return (
    <PageFade>
      <style>{`
        .bm-intel-scroll { scrollbar-width: thin; scrollbar-color: rgba(249,115,22,.88) rgba(255,255,255,.06); }
        .bm-intel-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .bm-intel-scroll::-webkit-scrollbar-track { background: rgba(255,255,255,.055); border-radius: 999px; }
        .bm-intel-scroll::-webkit-scrollbar-thumb { background: rgba(249,115,22,.9); border-radius: 999px; }
      `}</style>
      <div className="bmCourtPage h-full min-h-0 overflow-hidden px-4 pt-2 pb-5 text-white">
        <div className="mx-auto flex h-full min-h-0 w-full max-w-[1720px] flex-col overflow-hidden pb-1">
          <div className="mb-2 grid h-[44px] shrink-0 grid-cols-[280px_1fr_150px] items-center gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.28em] text-orange-300">Front Office</div>
              <h1 className="text-3xl font-black leading-none text-orange-500">League Intel</h1>
            </div>
            <div className="flex justify-center gap-2 overflow-hidden">
              <FilterButton mode="all" label="All" count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
              <FilterButton mode="contending" label="Contending" count={counts.contending} active={filter === "contending"} onClick={() => setFilter("contending")} />
              <FilterButton mode="retooling" label="Retooling" count={counts.retooling} active={filter === "retooling"} onClick={() => setFilter("retooling")} />
              <FilterButton mode="rebuilding" label="Rebuilding" count={counts.rebuilding} active={filter === "rebuilding"} onClick={() => setFilter("rebuilding")} />
            </div>
            <button onClick={() => navigate("/trades")} className="justify-self-end rounded-xl border border-orange-400/25 bg-orange-500/10 px-4 py-2 text-sm font-black text-orange-100 hover:bg-orange-500/20">
              Trade Center
            </button>
          </div>

          <div className="grid min-h-0 flex-1 gap-3 overflow-hidden pb-1 xl:grid-cols-[300px_1fr]">
            <TeamSidebar visibleRows={visibleRows} active={active} setActiveName={setActiveName} />

            <div className="grid min-h-0 grid-rows-[102px_1fr] gap-3 overflow-hidden">
              <ReportHeader active={active} />

              <div className="grid min-h-0 gap-3 overflow-hidden xl:grid-cols-[300px_1fr]">
                <div className="grid min-h-0 grid-rows-[208px_1fr] gap-3 overflow-hidden">
                  <LineupCard active={active} />
                  <ListPanel title="Untouchable" subtitle="protected core / hard to pry loose" rows={active.untouchables} empty="No true untouchable detected." limit={3} />
                </div>

                <div className="grid min-h-0 grid-rows-[168px_1fr] gap-3 overflow-hidden">
                  <StatusPanel active={active} />
                  <div className="grid min-h-0 grid-cols-3 gap-3 overflow-hidden">
                    <ListPanel title="Trade Block" subtitle="timeline, salary, or rotation squeeze" rows={active.tradeBlock} empty="No obvious movable players." limit={4} />
                    <ListPanel title="Targets" subtitle="fits from other rosters" rows={active.targets} empty="No clean target match." source limit={4} />
                    <ExpiringPanel active={active} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageFade>
  );
}
