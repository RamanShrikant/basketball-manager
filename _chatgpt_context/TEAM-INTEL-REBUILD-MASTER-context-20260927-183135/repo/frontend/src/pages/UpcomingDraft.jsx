import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { initializeDraft } from "../api/simEnginePy.js";
import {
  buildPreviewDraftOrder,
  buildUpcomingDraftPreviewLeagueData,
  getUpcomingDraftYearForPhase,
  isDraftStartedForYear,
  isUpcomingDraftPreviewCompatible,
  readCustomDraftClassSetupForYear,
  readUpcomingDraftClassForYear,
  safeJSON,
  saveUpcomingDraftClassForYear,
} from "../utils/upcomingDraftClass.js";
import HeadshotLayoutTransform from "../components/HeadshotLayoutTransform.jsx";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";

const DEFAULT_DRAFT_SORT = { key: null, direction: null };

function getHeadshot(source = {}) {
  return source.headshot || source.image || source.img || "";
}

function getDraftSource(source = {}) {
  return (
    source.college ||
    source.school ||
    source.university ||
    source.academy ||
    source.academyName ||
    source.sourceName ||
    source.draftSource ||
    source.nationality ||
    ""
  );
}

function formatMoney(amount) {
  const value = Number(amount || 0);
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

function attrLetter(value) {
  const n = Number(value || 0);
  if (n >= 94) return "A+";
  if (n >= 87) return "A";
  if (n >= 80) return "A-";
  if (n >= 77) return "B+";
  if (n >= 73) return "B";
  if (n >= 70) return "B-";
  if (n >= 67) return "C+";
  if (n >= 63) return "C";
  if (n >= 60) return "C-";
  if (n >= 57) return "D+";
  if (n >= 53) return "D";
  if (n >= 50) return "D-";
  return "F";
}

function getProspectRank(prospect = {}, fallback = 999) {
  const rank = Number(prospect?.draftProjection ?? prospect?.rank ?? prospect?.boardRank ?? prospect?.trueRank);
  return Number.isFinite(rank) ? rank : fallback;
}

function prospectSort(a, b) {
  return (
    getProspectRank(a, 999) - getProspectRank(b, 999) ||
    Number(b?.potential || 0) - Number(a?.potential || 0) ||
    Number(b?.overall || 0) - Number(a?.overall || 0) ||
    String(a?.name || "").localeCompare(String(b?.name || ""))
  );
}

function getProspectSortValue(prospect = {}, key = "") {
  if (key === "rank") return getProspectRank(prospect, 999);
  if (key === "overall") return Number(prospect.overall ?? prospect.ovr ?? -1);
  if (key === "potential") return Number(prospect.potential ?? prospect.pot ?? -1);
  if (key === "age") return Number(prospect.age ?? 99);
  if (key === "position") return String(prospect.pos || prospect.position || "").toUpperCase();
  return "";
}

function sortDraftProspects(prospects = [], sortState = DEFAULT_DRAFT_SORT) {
  const key = sortState?.key;
  const direction = sortState?.direction;
  if (!key || !direction) return [...prospects].sort(prospectSort);

  const multiplier = direction === "desc" ? -1 : 1;
  return [...prospects].sort((a, b) => {
    const aValue = getProspectSortValue(a, key);
    const bValue = getProspectSortValue(b, key);
    let result = 0;

    if (typeof aValue === "number" && typeof bValue === "number") {
      result = aValue - bValue;
    } else {
      result = String(aValue || "").localeCompare(String(bValue || ""));
    }

    return result !== 0 ? result * multiplier : prospectSort(a, b);
  });
}

function getNextDraftSortState(currentSort, key) {
  if (currentSort?.key !== key) return { key, direction: "asc" };
  if (currentSort?.direction === "asc") return { key, direction: "desc" };
  return DEFAULT_DRAFT_SORT;
}

function SortableDraftHeader({ label, sortKey, sortState, onSortChange }) {
  const active = sortState?.key === sortKey;
  const arrow = !active ? "↕" : sortState.direction === "asc" ? "▲" : "▼";

  return (
    <th className="px-4 py-3 text-center">
      <button
        type="button"
        onClick={() => onSortChange(sortKey)}
        className={`inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 font-extrabold transition ${
          active
            ? "bg-orange-600/25 text-orange-200"
            : "text-white/70 hover:bg-white/10 hover:text-white"
        }`}
      >
        <span>{label}</span>
        <span className="text-[10px] opacity-80">{arrow}</span>
      </button>
    </th>
  );
}

function ProspectHeadshot({ src, name }) {
  if (!src) {
    return (
      <div className="flex h-16 w-14 shrink-0 items-center justify-center text-[10px] font-black text-white/25">
        IMG
      </div>
    );
  }

  return (
    <div className="flex h-16 w-14 shrink-0 items-end justify-center overflow-hidden">
      <HeadshotLayoutTransform className="h-full w-full">
        <img
          src={src}
          alt={name || "Prospect"}
          className="h-full w-full object-contain object-bottom drop-shadow-[0_8px_12px_rgba(0,0,0,0.5)]"
          loading="lazy"
        />
      </HeadshotLayoutTransform>
    </div>
  );
}

function ProspectHeroHeadshot({ src, name }) {
  return (
    <div className="relative flex h-40 w-44 shrink-0 self-end items-end justify-center overflow-hidden">
      {src ? (
        <HeadshotLayoutTransform className="h-full w-full">
          <img
            src={src}
            alt={name || "Prospect"}
            className="h-full w-full object-contain object-bottom drop-shadow-[0_16px_18px_rgba(0,0,0,0.5)]"
            loading="lazy"
          />
        </HeadshotLayoutTransform>
      ) : (
        <div className="flex h-28 w-24 items-center justify-center text-[10px] font-black text-white/25">
          IMG
        </div>
      )}
    </div>
  );
}

function SmallPill({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-1 text-sm font-extrabold text-white">{value}</div>
    </div>
  );
}

function OverallPill({ value }) {
  const overall = Number(value || 0);
  const fillPercent = Math.min(overall / 99, 1);
  const circumference = 2 * Math.PI * 50;
  const strokeOffset = circumference * (1 - fillPercent);

  return (
    <div className="flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-1 py-1">
      <div className="relative flex items-center justify-center">
        <svg width="42" height="42" viewBox="0 0 120 120">
          <defs>
            <linearGradient id="upcomingDraftOvrGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#FFA500" />
              <stop offset="100%" stopColor="#FFD54F" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="50" stroke="rgba(255,255,255,0.08)" strokeWidth="8" fill="none" />
          <circle
            cx="60"
            cy="60"
            r="50"
            stroke="url(#upcomingDraftOvrGradient)"
            strokeWidth="8"
            strokeLinecap="round"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeOffset}
            transform="rotate(-90 60 60)"
          />
        </svg>
        <div className="absolute flex flex-col items-center justify-center text-center">
          <p className="mb-0.5 text-[9px] tracking-wide text-gray-300">OVR</p>
          <p className="mt-[-4px] text-[14px] font-extrabold leading-none text-orange-400">{value ?? "-"}</p>
        </div>
      </div>
    </div>
  );
}

function ProspectCard({ prospect }) {
  if (!prospect) return null;

  const attrs = Array.isArray(prospect.attrs)
    ? prospect.attrs
    : Array.isArray(prospect.attributes)
    ? prospect.attributes
    : [];
  const labels = [
    ["3PT", attrs[0]],
    ["MID", attrs[1]],
    ["CLS", attrs[2]],
    ["BALL", attrs[4]],
    ["PASS", attrs[5]],
    ["ATH", attrs[7]],
    ["PER D", attrs[8]],
    ["INS D", attrs[9]],
    ["REB", attrs[12]],
    ["IQ", attrs[13]],
  ];
  const salary = prospect?.contract?.salaryByYear?.[0];

  return (
    <div className="bmSolidPanel bmRowEnter rounded-3xl border border-white/10 bg-neutral-900 p-6 shadow-2xl">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-end gap-5">
          <ProspectHeroHeadshot src={getHeadshot(prospect)} name={prospect.name} />
          <div className="min-w-0">
            <div className="mb-2 text-xs uppercase tracking-[0.2em] text-white/40">Scouting Report</div>
            <h2 className="text-3xl font-extrabold leading-tight text-white">{prospect.name}</h2>
            <p className="mt-1 text-white/55">
              {prospect.pos}{prospect.secondaryPos ? ` / ${prospect.secondaryPos}` : ""} - {prospect.archetype}
            </p>
            {getDraftSource(prospect) && (
              <p className="mt-1 text-xs text-white/40">{getDraftSource(prospect)}</p>
            )}
            {(prospect.nationality || prospect.identityKey) && (
              <p className="mt-1 text-xs text-white/35">
                {prospect.nationality || ""}
                {prospect.identityKey ? ` - ${String(prospect.identityKey).replaceAll("_", " ")}` : ""}
              </p>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs uppercase text-white/40">Projection</div>
          <div className="text-2xl font-extrabold text-orange-300">
            #{getProspectRank(prospect, "-")}
          </div>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-3">
        <OverallPill value={prospect.overall} />
        <SmallPill label="POT" value={prospect.potential} />
        <SmallPill label="Age" value={prospect.age ?? "-"} />
        <SmallPill
          label="Height"
          value={prospect.height ? `${Math.floor(prospect.height / 12)}'${prospect.height % 12}` : "-"}
        />
        <SmallPill label="Weight" value={prospect.weight || "-"} />
        <SmallPill label="Salary" value={salary ? formatMoney(salary) : "Rookie"} />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2">
        {labels.map(([label, value]) => {
          const hasValue = Number.isFinite(Number(value));
          return (
            <div
              key={label}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2"
            >
              <span className="text-xs font-semibold text-white/45">{label}</span>
              <span className="text-sm font-extrabold text-white">
                {hasValue ? attrLetter(value) : "-"}{" "}
                <span className="text-white/35">{hasValue ? value : ""}</span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
        <div className="mb-2 text-xs uppercase tracking-wide text-white/40">Traits</div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>NBA Ready: <span className="font-bold">{Math.round(Number(prospect.traits?.nbaReady || 0) * 100)}%</span></div>
          <div>Star Upside: <span className="font-bold">{Math.round(Number(prospect.traits?.starUpside || 0) * 100)}%</span></div>
          <div>Boom/Bust: <span className="font-bold">{Math.round(Number(prospect.traits?.boomBust || 0) * 100)}%</span></div>
          <div>Work Ethic: <span className="font-bold">{Math.round(Number(prospect.traits?.workEthic || 0) * 100)}%</span></div>
        </div>
      </div>
    </div>
  );
}

export default function UpcomingDraft() {
  const navigate = useNavigate();
  const location = useLocation();
  const { leagueData, selectedTeam } = useGame();
  const offseasonState = safeJSON(localStorage.getItem("bm_offseason_state_v1"), {});
  const isOffseasonMode = Boolean(location.state?.offseasonMode || offseasonState?.active);
  const seasonYear = getUpcomingDraftYearForPhase(leagueData || {}, {
    isOffseasonMode,
  });

  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedProspectId, setSelectedProspectId] = useState(null);
  const [scoutingReportOpen, setScoutingReportOpen] = useState(false);
  const [sortState, setSortState] = useState(DEFAULT_DRAFT_SORT);

  const draftStarted = isDraftStartedForYear(seasonYear, leagueData);

  useEffect(() => {
    document.body.classList.add("th-no-scroll");
    return () => document.body.classList.remove("th-no-scroll");
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      if (!leagueData || draftStarted) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const sourceSetup = readCustomDraftClassSetupForYear(seasonYear);
        if (sourceSetup.mode === "custom" && !sourceSetup.draftClassPayload?.draftClass?.length) {
          throw new Error(
            `The ${seasonYear} draft is set to use a custom class, but no valid class is loaded for that year.`
          );
        }

        const savedPreview = readUpcomingDraftClassForYear(seasonYear);
        if (isUpcomingDraftPreviewCompatible(savedPreview, sourceSetup)) {
          if (!cancelled) setPreview(savedPreview);
          return;
        }

        const draftOrder = buildPreviewDraftOrder(leagueData);
        const payload = {
          seasonYear,
          userTeamName: selectedTeam?.name || "",
          draftOrder,
        };

        if (sourceSetup.mode === "custom") {
          payload.draftClass = sourceSetup.draftClassPayload.draftClass;
          payload.classType = "custom";
        }

        const result = await initializeDraft(buildUpcomingDraftPreviewLeagueData(leagueData), payload);
        if (!result?.ok) {
          throw new Error(result?.reason || "Unable to build the upcoming draft class.");
        }

        const draftState = result?.draftState || {};
        const rows = draftState?.draftClass || draftState?.availableProspects || [];
        if (!rows.length) throw new Error("The upcoming draft class did not contain any prospects.");

        const classMeta = {
          ...(draftState?.classMeta || {}),
          seasonYear,
          previewGenerated: true,
          sourceMode: sourceSetup.mode,
        };

        const nextPreview = saveUpcomingDraftClassForYear({
          seasonYear,
          sourceMode: sourceSetup.mode,
          sourceFingerprint: sourceSetup.fingerprint,
          classType:
            sourceSetup.mode === "custom"
              ? "custom"
              : draftState?.classType || classMeta?.classType || "auto",
          seed: draftState?.seed || classMeta?.seed || null,
          seedMode:
            sourceSetup.mode === "custom"
              ? "custom"
              : draftState?.seedMode || classMeta?.seedMode || "fresh_random",
          classMeta,
          draftClass: rows,
        });

        if (!cancelled) setPreview(nextPreview);
      } catch (err) {
        console.error("[UpcomingDraft] Failed to load class", err);
        if (!cancelled) setError(String(err?.message || err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [leagueData, seasonYear, selectedTeam?.name, draftStarted]);

  const prospects = useMemo(
    () => sortDraftProspects(preview?.draftClass || [], sortState),
    [preview, sortState]
  );

  const selectedProspect = useMemo(
    () => prospects.find((row) => String(row?.id) === String(selectedProspectId || "")) || prospects[0] || null,
    [prospects, selectedProspectId]
  );

  useEffect(() => {
    if (!prospects.length) return;
    const exists = prospects.some((row) => String(row?.id) === String(selectedProspectId || ""));
    if (!exists) setSelectedProspectId(prospects[0].id);
  }, [prospects, selectedProspectId]);

  const returnToScouting = () => {
    navigate("/team-hub", {
      state: {
        ...(location.state || {}),
        hubSection: "Scouting",
      },
    });
  };

  if (draftStarted) {
    return (
      <div className="bmCourtPage flex min-h-screen items-center justify-center px-6 text-white">
        <div className="bmSolidPanel max-w-xl rounded-3xl border border-white/10 bg-neutral-900 p-8 text-center shadow-2xl">
          <div className="text-xs font-black uppercase tracking-[0.25em] text-orange-300">Scouting</div>
          <h1 className="mt-3 text-3xl font-extrabold">The {seasonYear} NBA Draft Has Started</h1>
          <p className="mt-3 text-sm text-white/55">
            The upcoming board closes once the live draft begins. It will return automatically for the next draft class when the following season starts.
          </p>
          <button
            type="button"
            onClick={returnToScouting}
            className="bmSmoothButton mt-6 rounded-xl bg-orange-600 px-6 py-3 font-extrabold hover:bg-orange-500"
          >
            Back to Scouting
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bmCourtPage h-screen overflow-hidden text-white">
      <style>{`
        .upcomingDraftScrollbar { scrollbar-width: thin; scrollbar-color: #f97316 rgba(12,12,12,.8); }
        .upcomingDraftScrollbar::-webkit-scrollbar { width: 12px; height: 12px; }
        .upcomingDraftScrollbar::-webkit-scrollbar-track { background: rgba(12,12,12,.78); border-radius: 999px; }
        .upcomingDraftScrollbar::-webkit-scrollbar-thumb { background: linear-gradient(180deg,#fb923c 0%,#f97316 55%,#ea580c 100%); border: 3px solid rgba(12,12,12,.92); border-radius: 999px; }
      `}</style>

      <div className="flex h-full min-h-0 flex-col px-5 pb-5 pt-4">
        <div className="mb-3 flex shrink-0 items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-[0.25em] text-white/40">Scouting</p>
            <h1 className="text-3xl font-extrabold text-orange-500">{seasonYear} Upcoming Draft</h1>
            <p className="mt-1 text-xs text-white/55">
              Full prospect board available until the NBA Draft begins.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {preview && (
              <div className="rounded-xl border border-white/10 bg-neutral-900/90 px-4 py-2 text-right">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Class Source</div>
                <div className="mt-1 text-sm font-extrabold text-orange-200">
                  {preview.sourceMode === "custom" ? "Uploaded Custom Class" : "Auto-Generated Class"}
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={returnToScouting}
              className="bmSmoothButton rounded-xl bg-neutral-800 px-5 py-3 text-sm font-extrabold hover:bg-neutral-700"
            >
              Back to Scouting
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-3 shrink-0 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 font-semibold text-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="bmSolidPanel flex min-h-0 flex-1 items-center justify-center rounded-3xl border border-white/10 bg-neutral-900">
            <div className="text-center">
              <div className="text-xl font-extrabold text-orange-300">Building the {seasonYear} draft board...</div>
              <div className="mt-2 text-sm text-white/45">The class is generated once and saved for the live NBA Draft.</div>
            </div>
          </div>
        ) : (
          <div className="bmTablePanel flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-900 shadow-2xl">
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-neutral-800/90 px-4 py-2.5">
              <div>
                <h2 className="text-2xl font-extrabold">Draft Board</h2>
                <p className="text-xs text-white/50">Upcoming prospects and full scouting reports.</p>
              </div>
              <div className="text-sm font-bold text-white/50">{prospects.length} prospects</div>
            </div>

            <div className="upcomingDraftScrollbar min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[1040px] text-sm">
                <thead className="sticky top-0 z-10 bg-neutral-800/95 text-white/70">
                  <tr>
                    <SortableDraftHeader label="Rank" sortKey="rank" sortState={sortState} onSortChange={(key) => setSortState((prev) => getNextDraftSortState(prev, key))} />
                    <th className="min-w-[310px] px-4 py-3 text-left">Player</th>
                    <SortableDraftHeader label="POS" sortKey="position" sortState={sortState} onSortChange={(key) => setSortState((prev) => getNextDraftSortState(prev, key))} />
                    <SortableDraftHeader label="OVR" sortKey="overall" sortState={sortState} onSortChange={(key) => setSortState((prev) => getNextDraftSortState(prev, key))} />
                    <SortableDraftHeader label="POT" sortKey="potential" sortState={sortState} onSortChange={(key) => setSortState((prev) => getNextDraftSortState(prev, key))} />
                    <SortableDraftHeader label="Age" sortKey="age" sortState={sortState} onSortChange={(key) => setSortState((prev) => getNextDraftSortState(prev, key))} />
                    <th className="px-4 py-3 text-left">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {prospects.map((prospect, index) => {
                    const active = String(selectedProspectId || "") === String(prospect.id);
                    return (
                      <tr
                        key={prospect.id}
                        onClick={() => setSelectedProspectId(prospect.id)}
                        onDoubleClick={() => {
                          setSelectedProspectId(prospect.id);
                          setScoutingReportOpen(true);
                        }}
                        className={`bmRowEnter bmDraftBoardRow cursor-pointer border-b border-white/10 transition ${
                          active ? "bmDraftBoardRowActive" : ""
                        }`}
                        style={{ animationDelay: `${Math.min(index, 18) * 18}ms` }}
                      >
                        <td className="px-4 py-2.5 font-bold text-orange-200">
                          #{getProspectRank(prospect, index + 1)}
                        </td>
                        <td className="min-w-[310px] px-4 py-2.5">
                          <div className="flex min-w-0 items-center gap-4">
                            <ProspectHeadshot src={getHeadshot(prospect)} name={prospect.name} />
                            <div className="min-w-0 flex-1">
                              <div className="text-lg font-extrabold leading-tight text-white">{prospect.name}</div>
                              <div className="text-xs leading-snug text-white/45">{getDraftSource(prospect)}</div>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedProspectId(prospect.id);
                                  setScoutingReportOpen(true);
                                }}
                                className="mt-2 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] font-black uppercase tracking-wide text-white/65 hover:border-orange-300/50 hover:bg-orange-500/15 hover:text-orange-100"
                              >
                                View Report
                              </button>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-center font-black text-white/75">{prospect.pos || prospect.position || "-"}</td>
                        <td className="px-4 py-2.5 text-center font-black text-orange-200">{prospect.overall ?? prospect.ovr ?? "-"}</td>
                        <td className="px-4 py-2.5 text-center font-black text-white/75">{prospect.potential ?? prospect.pot ?? "-"}</td>
                        <td className="px-4 py-2.5 text-center font-bold text-white/75">{prospect.age ?? "-"}</td>
                        <td className="px-4 py-2.5 text-left">
                          <div className="font-semibold text-white/80">{prospect.archetype || "Prospect"}</div>
                          <div className="text-xs text-white/45">{prospect.tier || "Draft Prospect"}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {!prospects.length && !error && (
                <div className="p-8 text-center text-white/50">No prospects are available for this draft class.</div>
              )}
            </div>
          </div>
        )}
      </div>

      {scoutingReportOpen && selectedProspect && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
          onClick={() => setScoutingReportOpen(false)}
        >
          <div
            className="relative max-h-[88vh] w-[min(760px,96vw)] overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setScoutingReportOpen(false)}
              className="absolute right-4 top-4 z-10 rounded-lg bg-neutral-800/90 px-3 py-2 text-xs font-black uppercase tracking-wide text-white/80 hover:bg-neutral-700"
            >
              Close
            </button>
            <ProspectCard prospect={selectedProspect} />
          </div>
        </div>
      )}
    </div>
  );
}
