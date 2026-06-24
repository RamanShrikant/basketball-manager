// src/pages/Intel_v1.jsx
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import PageFade from "../components/PageFade";
import {
  buildLeagueIntel,
  formatMoney,
  formatPick,
  phaseTone,
  playerHeadshotOf,
  playerNameOf,
  teamLogoOf,
} from "../utils/teamIntel_v1.js";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";

const sectionCard = "rounded-[24px] border border-white/10 bg-neutral-950/80 shadow-2xl";

function Pill({ children, className = "" }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.12em] ${className}`}>
      {children}
    </span>
  );
}

function RatingBadge({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-center">
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-black text-orange-300">{value ?? "—"}</div>
    </div>
  );
}

function MiniPlayer({ row, rightMeta = null }) {
  const player = row?.player || row;
  const headshot = row?.headshot || playerHeadshotOf(player);
  const name = row?.name || playerNameOf(player);
  const overall = row?.overall ?? player?.overall ?? "—";
  const potential = row?.potential ?? player?.potential ?? "—";
  const age = row?.age ?? player?.age ?? "—";
  const pos = row?.pos || player?.pos || "-";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] p-3 transition hover:border-orange-400/30 hover:bg-orange-500/10">
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 shrink-0 items-end justify-center overflow-hidden rounded-xl bg-black/50">
          {headshot ? (
            <img src={headshot} alt={name} className="h-16 w-auto object-contain" />
          ) : (
            <div className="text-[10px] font-bold text-neutral-600">No Img</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black text-white">{name}</div>
          <div className="mt-1 text-[11px] font-black uppercase tracking-[0.12em] text-neutral-400">
            {pos} • Age {age} • OVR {overall} • POT {potential}
          </div>
          {row?.reason && <div className="mt-1 text-xs font-bold text-orange-200">{row.reason}</div>}
        </div>
        {rightMeta}
      </div>
    </div>
  );
}

function PickLine({ row }) {
  const pick = row?.pick || row;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 transition hover:border-orange-400/30 hover:bg-orange-500/10">
      <div className="text-sm font-black text-white">{row?.label || formatPick(pick)}</div>
      <div className="mt-1 text-xs font-bold text-neutral-400">{row?.reason || "draft asset"}</div>
    </div>
  );
}

function EmptyNote({ children }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/35 p-4 text-sm font-bold leading-6 text-neutral-400">
      {children}
    </div>
  );
}

function ListBlock({ title, children, subtitle = "" }) {
  return (
    <div className={sectionCard}>
      <div className="border-b border-white/10 px-5 py-4">
        <div className="text-sm font-black uppercase tracking-[0.18em] text-orange-300">{title}</div>
        {subtitle && <div className="mt-1 text-xs font-bold text-neutral-500">{subtitle}</div>}
      </div>
      <div className="grid gap-3 p-5">{children}</div>
    </div>
  );
}

function TeamSelectorRow({ row, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${
        active
          ? "border-orange-400/60 bg-orange-500/15"
          : "border-white/10 bg-white/[0.035] hover:border-orange-400/30 hover:bg-orange-500/10"
      }`}
    >
      {row.logo ? (
        <img src={row.logo} alt={row.name} className="h-9 w-9 object-contain" />
      ) : (
        <div className="h-9 w-9 rounded-xl bg-black/50" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-black text-white">{row.name}</div>
        <div className="mt-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-neutral-500">
          {row.phaseLabel} • OVR {row.ratings.overall}
        </div>
      </div>
    </button>
  );
}

export default function Intel() {
  const navigate = useNavigate();
  const { leagueData, selectedTeam } = useGame();
  const [filter, setFilter] = useState("all");
  const rows = useMemo(() => buildLeagueIntel(leagueData), [leagueData]);
  const [activeName, setActiveName] = useState(() => selectedTeam?.name || "");

  const visibleRows = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((row) => row.phase === filter);
  }, [filter, rows]);

  const active = useMemo(() => {
    if (!rows.length) return null;
    return rows.find((row) => row.name === activeName) || rows.find((row) => row.name === selectedTeam?.name) || rows[0];
  }, [activeName, rows, selectedTeam?.name]);

  if (!leagueData) {
    return (
      <PageFade>
        <div className="bmCourtPage flex min-h-screen items-center justify-center text-white">
          Loading league intel...
        </div>
      </PageFade>
    );
  }

  if (!active) {
    return (
      <PageFade>
        <div className="bmCourtPage flex min-h-screen flex-col items-center justify-center px-4 text-white">
          <p className="mb-4 text-lg font-semibold">No teams found.</p>
          <button onClick={() => navigate("/team-hub")} className="rounded-xl bg-orange-600 px-6 py-3 font-bold">
            Team Hub
          </button>
        </div>
      </PageFade>
    );
  }

  return (
    <PageFade>
      <div className="bmCourtPage min-h-screen px-4 py-8 text-white">
        <div className="mx-auto w-full max-w-7xl">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <button
              onClick={() => navigate("/team-hub")}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-neutral-200 transition hover:bg-white/10 hover:text-white"
            >
              ← Team Hub
            </button>

            <div className="text-center">
              <div className="text-xs font-black uppercase tracking-[0.24em] text-orange-300">Front Office</div>
              <h1 className="mt-1 text-4xl font-black text-orange-500">League Intel</h1>
            </div>

            <button
              onClick={() => navigate("/trades")}
              className="rounded-xl border border-orange-400/25 bg-orange-500/10 px-4 py-2 text-sm font-black text-orange-100 hover:bg-orange-500/20"
            >
              Trade Center
            </button>
          </div>

          <div className="mb-5 flex flex-wrap justify-center gap-2">
            {["all", "contender", "playoff", "middle", "retool", "rebuild", "tank"].map((mode) => (
              <button
                key={mode}
                onClick={() => setFilter(mode)}
                className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.12em] transition ${
                  filter === mode ? "bg-orange-600 text-white" : "border border-white/10 bg-black/40 text-neutral-300 hover:bg-white/10"
                }`}
              >
                {mode === "all" ? "All" : mode === "tank" ? "Tanking" : mode}
              </button>
            ))}
          </div>

          <div className="grid gap-5 xl:grid-cols-[330px_1fr]">
            <div className={`${sectionCard} xl:sticky xl:top-6 xl:max-h-[calc(100vh-48px)] xl:overflow-hidden`}>
              <div className="border-b border-white/10 px-5 py-4">
                <div className="text-sm font-black uppercase tracking-[0.18em] text-orange-300">All Teams</div>
                <div className="mt-1 text-xs font-bold text-neutral-500">{visibleRows.length} teams shown</div>
              </div>
              <div className="grid max-h-[72vh] gap-2 overflow-y-auto p-4">
                {visibleRows.map((row) => (
                  <TeamSelectorRow
                    key={row.name}
                    row={row}
                    active={row.name === active.name}
                    onClick={() => setActiveName(row.name)}
                  />
                ))}
              </div>
            </div>

            <div className="grid gap-5">
              <div className="overflow-hidden rounded-[30px] border border-white/10 bg-neutral-950/85 shadow-2xl">
                <div className="relative overflow-hidden border-b border-white/10 bg-gradient-to-r from-orange-600/25 via-neutral-950 to-black px-6 py-6">
                  {active.logo && (
                    <img
                      src={active.logo}
                      alt=""
                      aria-hidden="true"
                      className="pointer-events-none absolute right-4 top-1/2 h-44 w-44 -translate-y-1/2 object-contain opacity-10"
                    />
                  )}

                  <div className="relative z-10 flex flex-wrap items-center justify-between gap-5">
                    <div className="flex min-w-0 items-center gap-4">
                      {active.logo ? (
                        <img src={active.logo} alt={active.name} className="h-20 w-20 object-contain" />
                      ) : (
                        <div className="h-20 w-20 rounded-2xl bg-black/50" />
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-black uppercase tracking-[0.22em] text-orange-200">Team Intel Report</div>
                        <h2 className="mt-1 truncate text-4xl font-black text-white">{active.name}</h2>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Pill className={phaseTone(active.phase)}>{active.phaseLabel}</Pill>
                          <Pill className="border-white/10 bg-black/35 text-neutral-300">
                            {active.record.gp ? `${active.record.w}-${active.record.l}` : "Preseason read"}
                          </Pill>
                          <Pill className="border-white/10 bg-black/35 text-neutral-300">
                            Avg Age {active.roster.avgAge.toFixed(1)}
                          </Pill>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <RatingBadge label="OVR" value={active.ratings.overall} />
                      <RatingBadge label="OFF" value={active.ratings.off} />
                      <RatingBadge label="DEF" value={active.ratings.def} />
                    </div>
                  </div>

                  <div className="relative z-10 mt-5 rounded-2xl border border-white/10 bg-black/35 p-4 text-sm font-bold leading-6 text-neutral-300">
                    {active.phaseSummary}
                  </div>
                </div>

                <div className="grid gap-4 p-5 lg:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-black/35 p-4">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-neutral-500">Roster</div>
                    <div className="mt-2 text-lg font-black text-white">{active.roster.count} standard players</div>
                    <div className="mt-1 text-xs font-bold text-neutral-400">Top-8 avg OVR {active.roster.avgTopOverall.toFixed(1)}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/35 p-4">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-neutral-500">Point Diff</div>
                    <div className="mt-2 text-lg font-black text-white">
                      {active.record.gp ? `${active.record.pointDiff >= 0 ? "+" : ""}${active.record.pointDiff.toFixed(1)}` : "No games"}
                    </div>
                    <div className="mt-1 text-xs font-bold text-neutral-400">based on completed results</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/35 p-4">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-neutral-500">Draft Assets</div>
                    <div className="mt-2 text-lg font-black text-white">{active.ownedPicks.length} active picks</div>
                    <div className="mt-1 text-xs font-bold text-neutral-400">owned in draftPicks</div>
                  </div>
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <ListBlock title="Goals" subtitle="What the front office should be trying to do">
                  {active.goals.map((goal) => (
                    <div key={goal} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm font-bold text-neutral-200">
                      {goal}
                    </div>
                  ))}
                </ListBlock>

                <ListBlock title="Wants On Team" subtitle="Player types this team should be shopping for">
                  {active.wants.map((want) => (
                    <div key={want} className="rounded-2xl border border-orange-400/20 bg-orange-500/10 p-4 text-sm font-black text-orange-100">
                      {want}
                    </div>
                  ))}
                </ListBlock>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <ListBlock title="Core / Protected" subtitle="Players they should be reluctant to move">
                  {active.core.length ? (
                    active.core.map((row) => <MiniPlayer key={row.name} row={row} />)
                  ) : (
                    <EmptyNote>No clear protected core yet.</EmptyNote>
                  )}
                </ListBlock>

                <ListBlock title="Needs" subtitle="Weak spots detected from roster shape and ratings">
                  {active.needs.length ? (
                    active.needs.map((need) => (
                      <div key={`${need.type}-${need.pos}`} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                        <div className="text-sm font-black text-white">{need.label}</div>
                        <div className="mt-1 text-xs font-bold text-neutral-400">{need.detail}</div>
                      </div>
                    ))
                  ) : (
                    <EmptyNote>No major holes detected.</EmptyNote>
                  )}
                </ListBlock>
              </div>

              <ListBlock title="Targets" subtitle="Readable target list from other teams, based on fit and availability">
                {active.targets.length ? (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {active.targets.map((row) => (
                      <MiniPlayer
                        key={`${row.sourceTeamName}-${row.name}`}
                        row={row}
                        rightMeta={
                          <div className="hidden shrink-0 items-center gap-2 sm:flex">
                            {row.sourceLogo && <img src={row.sourceLogo} alt={row.sourceTeamName} className="h-7 w-7 object-contain" />}
                            <div className="max-w-[110px] truncate text-[10px] font-black uppercase tracking-[0.12em] text-neutral-500">
                              {row.sourceTeamName}
                            </div>
                          </div>
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyNote>No clean targets found from current roster data.</EmptyNote>
                )}
              </ListBlock>

              <ListBlock title="Looking To Give Up" subtitle="Players or picks this team may put in offers">
                {active.movable.length ? (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {active.movable.map((row, index) =>
                      row.type === "pick" ? (
                        <PickLine key={`${row.label}-${index}`} row={row} />
                      ) : (
                        <MiniPlayer
                          key={`${row.name}-${index}`}
                          row={row}
                          rightMeta={
                            row.salary ? (
                              <div className="hidden rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-right sm:block">
                                <div className="text-[10px] font-black uppercase tracking-[0.12em] text-neutral-500">Salary</div>
                                <div className="text-xs font-black text-white">{formatMoney(row.salary)}</div>
                              </div>
                            ) : null
                          }
                        />
                      )
                    )}
                  </div>
                ) : (
                  <EmptyNote>No obvious movable assets. They would probably need a direct overpay.</EmptyNote>
                )}
              </ListBlock>
            </div>
          </div>
        </div>
      </div>
    </PageFade>
  );
}
