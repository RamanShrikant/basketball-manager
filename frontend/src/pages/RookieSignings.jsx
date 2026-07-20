import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import * as simEngine from "../api/simEnginePy.js";
import { saveLeagueData } from "../utils/leagueStorage.js";

const LEAGUE_KEY = "leagueData";
const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
const DRAFT_STATE_KEY = "bm_draft_state_v1";
const STANDARD_ROSTER_MAX = 15;
const TWO_WAY_MAX = 3;
const OFFSEASON_CONTROLLED_MAX = Number.POSITIVE_INFINITY;

function getAllTeams(leagueData) {
  if (Array.isArray(leagueData?.teams)) return leagueData.teams;
  return Object.values(leagueData?.conferences || {}).flatMap((teams) => teams || []);
}

function findTeamByName(leagueData, teamName) {
  if (!teamName) return null;
  return getAllTeams(leagueData).find((team) => team?.name === teamName || team?.teamName === teamName) || null;
}

function getLeaguePlayerIds(leagueData) {
  const ids = new Set();
  const addRows = (rows) => {
    for (const player of rows || []) {
      if (player?.id) ids.add(String(player.id));
    }
  };

  for (const team of getAllTeams(leagueData)) {
    addRows(team?.players);
    addRows(team?.twoWayPlayers);
    addRows(team?.stashPlayers);
    addRows(team?.pendingRookieSignings);
  }
  addRows(leagueData?.freeAgents);
  return ids;
}

function getDraftIntegrityIssue(leagueData, seasonYear) {
  const savedDraft = safeJSON(localStorage.getItem(DRAFT_STATE_KEY), null);
  if (!savedDraft || Number(savedDraft?.seasonYear) !== Number(seasonYear)) return "";
  if (!savedDraft?.completed) return "";

  const draftedIds = (savedDraft?.draftedPicks || [])
    .map((pick) => pick?.playerId)
    .filter(Boolean)
    .map(String);
  if (!draftedIds.length) return "";

  const leagueIds = getLeaguePlayerIds(leagueData);
  const missing = draftedIds.filter((id) => !leagueIds.has(id));
  if (!missing.length) return "";

  return `Draft results are out of sync with the league save (${missing.length} drafted players are missing). Return to the NBA Draft to rebuild this class before continuing.`;
}

function getImageUrl(player) {
  return player?.headshot || player?.image || player?.img || "";
}

function getRosterCounts(leagueData, teamName) {
  const team = findTeamByName(leagueData, teamName);
  const standardCount = Array.isArray(team?.players) ? team.players.length : 0;
  const twoWayCount = Array.isArray(team?.twoWayPlayers) ? team.twoWayPlayers.length : 0;
  const stashCount = Array.isArray(team?.stashPlayers) ? team.stashPlayers.length : 0;
  const pendingCount = Array.isArray(team?.pendingRookieSignings) ? team.pendingRookieSignings.length : 0;

  // Stashes are unlimited draft-rights style holds. They still display in the
  // stash count, but they do not consume the 20-player offseason controlled cap
  // and should never block another rookie from being stashed.
  const controlledCount = standardCount + twoWayCount + pendingCount;
  const totalWithStashCount = controlledCount + stashCount;

  return {
    standardCount,
    twoWayCount,
    stashCount,
    pendingCount,
    controlledCount,
    totalWithStashCount,
    standardSlotsOpen: Math.max(0, STANDARD_ROSTER_MAX - standardCount),
    twoWaySlotsOpen: Math.max(0, TWO_WAY_MAX - twoWayCount),
    controlledSlotsOpen: Math.max(0, OFFSEASON_CONTROLLED_MAX - controlledCount),
  };
}

const CONTROLLED_ROOKIE_DECISIONS = new Set(["standard", "two_way"]);

function normalizeDecisionValue(decision) {
  let next = String(decision || "two_way").toLowerCase();
  if (next === "draft_rights") next = "stash";
  if (!["standard", "two_way", "stash", "release"].includes(next)) next = "release";
  return next;
}

function normalizeDecisionForSlots(decision) {
  // Offseason signing is intentionally permissive. The user can overfill
  // standard contracts, two-way slots, and the old 20-man controlled count.
  // Calendar simulation is the hard gate that forces trimming before games.
  return normalizeDecisionValue(decision);
}

function buildInitialDecisions(rows) {
  const initial = {};

  for (const row of rows || []) {
    initial[row.playerId] = normalizeDecisionForSlots(row.recommendedDecision);
  }

  return initial;
}

function safeJSON(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function getSelectedTeamName(selectedTeam) {
  if (selectedTeam?.name) return selectedTeam.name;
  const saved = safeJSON(localStorage.getItem("selectedTeam"), null);
  if (typeof saved === "string") return saved;
  if (saved?.name) return saved.name;
  return "";
}

function getSeasonYear(leagueData) {
  const offseasonState = safeJSON(localStorage.getItem(OFFSEASON_STATE_KEY), {}) || {};
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

function persistLeagueData(updated, setLeagueData) {
  if (!updated) return;

  if (typeof setLeagueData === "function") {
    setLeagueData(updated);
  }

  // Never write the full league object into localStorage. Large saves belong
  // in IndexedDB via leagueStorage; localStorage should only hold the tiny
  // pointer written by saveLeagueData().
  saveLeagueData(updated).catch((err) => {
    console.warn("[RookieSignings] IndexedDB league save failed", err);
  });
}

function updateOffseasonState(patch) {
  const current = safeJSON(localStorage.getItem(OFFSEASON_STATE_KEY), {}) || {};
  const next = { ...current, ...patch };
  localStorage.setItem(OFFSEASON_STATE_KEY, JSON.stringify(next));
  return next;
}

function formatDecision(decision) {
  if (decision === "standard") return "Standard Contract";
  if (decision === "two_way") return "Two-Way Contract";
  if (decision === "stash") return "1-Year Stash";
  if (decision === "release") return "Release to Free Agency";
  return decision || "-";
}

function formatPick(row) {
  if (!row?.draftPick) return "-";
  return `#${row.draftPick}`;
}

function RookieCard({
  row,
  decision,
  onDecisionChange,
  rosterCounts,
  animationIndex = 0,
}) {
  const imageUrl = getImageUrl(row);
  // No offseason roster-count blockers here. Counts are warnings only until
  // the user tries to simulate games from Calendar.
  const standardBlocked = false;
  const twoWayBlocked = false;
  const stashBlocked = false;

  return (
    <div
      className="bmSolidPanel bmRowEnter rounded-2xl border border-white/10 bg-neutral-900/80 p-4 shadow-xl"
      style={{ animationDelay: `${Math.min(animationIndex, 12) * 26}ms` }}
    >
      <div className="flex gap-4">
        <div className="h-20 w-20 rounded-2xl bg-black/40 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
          {imageUrl ? (
            <img src={imageUrl} alt={row.playerName} className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs text-white/40">No Image</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-orange-200 text-sm font-extrabold">{formatPick(row)}</div>
              <h3 className="text-xl font-extrabold text-white leading-tight">{row.playerName}</h3>
              <p className="text-sm text-white/55">
                {row.pos}{row.secondaryPos ? ` / ${row.secondaryPos}` : ""} - {row.age} - {row.college || row.nationality || "Rookie"}
              </p>
            </div>
            <div className="text-right text-sm text-white/60 shrink-0">
              <div><span className="text-white/40">OVR</span> <b className="text-white">{row.overall}</b></div>
              <div><span className="text-white/40">POT</span> <b className="text-emerald-300">{row.potential}</b></div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-white/55">
            <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-2">
              Recommended: <span className="text-white font-bold">{formatDecision(row.recommendedDecision)}</span>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-2">
              Type: <span className="text-white font-bold">{row.archetype || "Rookie"}</span>
            </div>
          </div>

          <select
            value={decision || "two_way"}
            onChange={(e) => onDecisionChange(row.playerId, e.target.value)}
            className="mt-3 w-full rounded-xl bg-neutral-800 border border-white/10 px-3 py-3 text-white font-bold outline-none focus:border-orange-500"
          >
            <option value="standard" disabled={standardBlocked}>
              Standard Contract{rosterCounts.standardSlotsOpen <= 0 ? " - Must Trim Before Sim" : ""}
            </option>
            <option value="two_way" disabled={twoWayBlocked}>
              Two-Way Contract{rosterCounts.twoWaySlotsOpen <= 0 ? " - Must Trim Before Sim" : ""}
            </option>
            <option value="stash" disabled={stashBlocked}>
              1-Year Stash
            </option>
            <option value="release">Release to Free Agency</option>
          </select>
        </div>
      </div>
    </div>
  );
}

export default function RookieSignings() {
  const navigate = useNavigate();
  const { leagueData, setLeagueData, selectedTeam } = useGame();

  const selectedTeamName = getSelectedTeamName(selectedTeam);
  const seasonYear = getSeasonYear(leagueData);

  const [workingLeagueData, setWorkingLeagueData] = useState(leagueData || safeJSON(localStorage.getItem(LEAGUE_KEY), {}) || {});
  const [preview, setPreview] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(null);
  const [draftIntegrityIssue, setDraftIntegrityIssue] = useState("");

  useEffect(() => {
    if (leagueData) setWorkingLeagueData(leagueData);
  }, [leagueData]);

  const userRows = preview?.userPendingRookies || [];
  const cpuRows = preview?.cpuPendingRookies || [];
  const totalPending = userRows.length + cpuRows.length;
  const stageComplete = Boolean(!draftIntegrityIssue && (applied?.complete || (preview && totalPending === 0)));

  const rosterCounts = useMemo(() => {
    return getRosterCounts(workingLeagueData, selectedTeamName);
  }, [workingLeagueData, selectedTeamName]);

  const getProjectedCountsFromDecisions = (nextDecisions = decisions) => {
    const selectedDecisions = userRows.map((row) =>
      normalizeDecisionValue(nextDecisions[row.playerId] || row.recommendedDecision || "two_way")
    );

    const standardChoices = selectedDecisions.filter((x) => x === "standard").length;
    const twoWayChoices = selectedDecisions.filter((x) => x === "two_way").length;
    const stashChoices = selectedDecisions.filter((x) => x === "stash").length;
    const controlledChoices = selectedDecisions.filter((x) =>
      CONTROLLED_ROOKIE_DECISIONS.has(x)
    ).length;

    return {
      standardCount: rosterCounts.standardCount + standardChoices,
      twoWayCount: rosterCounts.twoWayCount + twoWayChoices,
      stashCount: rosterCounts.stashCount + stashChoices,
      controlledCount: Math.max(
        0,
        rosterCounts.controlledCount - rosterCounts.pendingCount
      ) + controlledChoices,
      totalWithStashCount: Math.max(
        0,
        rosterCounts.controlledCount - rosterCounts.pendingCount
      ) + controlledChoices + rosterCounts.stashCount + stashChoices,
    };
  };

  const projectedCounts = getProjectedCountsFromDecisions(decisions);
  const projectedStandardCount = projectedCounts.standardCount;
  const projectedTwoWayCount = projectedCounts.twoWayCount;
  const projectedStashCount = projectedCounts.stashCount;
  const projectedControlledCount = projectedCounts.controlledCount;

  const decisionSummary = useMemo(() => {
    const counts = { standard: 0, two_way: 0, stash: 0, release: 0 };
    for (const row of userRows) {
      const decision = decisions[row.playerId] || row.recommendedDecision || "two_way";
      counts[decision] = (counts[decision] || 0) + 1;
    }
    return counts;
  }, [userRows, decisions]);

  const loadPreview = async () => {
    setLoading(true);
    setError("");

    try {
      const integrityIssue = getDraftIntegrityIssue(workingLeagueData, seasonYear);
      setDraftIntegrityIssue(integrityIssue);
      if (integrityIssue) {
        updateOffseasonState({ draftComplete: false, rookieSigningsComplete: false });
        setApplied(null);
        setPreview({ userPendingRookies: [], cpuPendingRookies: [], summary: null });
        setError(integrityIssue);
        return;
      }

      if (typeof simEngine.previewRookieSignings !== "function") {
        throw new Error("previewRookieSignings is not wired in simEnginePy.js yet.");
      }

      const result = await simEngine.previewRookieSignings(workingLeagueData, {
        seasonYear,
        userTeamName: selectedTeamName,
      });

      if (!result?.ok) {
        throw new Error(result?.reason || "Failed to preview rookie signings.");
      }

      const nextLeague = result.leagueData || workingLeagueData;
      setDraftIntegrityIssue("");
      setWorkingLeagueData(nextLeague);
      persistLeagueData(nextLeague, setLeagueData);
      setPreview(result);

      const nextUserRows = result.userPendingRookies || [];
      const nextCpuRows = result.cpuPendingRookies || [];
      setDecisions(buildInitialDecisions(nextUserRows));

      if (nextUserRows.length === 0 && nextCpuRows.length === 0) {
        const completeResult = {
          complete: true,
          summary: { appliedCount: 0, remainingCount: 0 },
          autoCompleted: true,
        };
        setApplied(completeResult);
        updateOffseasonState({ rookieSigningsComplete: true });
      } else {
        setApplied(null);
      }
    } catch (err) {
      console.error("[RookieSignings] preview failed", err);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateDecision = (playerId, decision) => {
    setDecisions((prev) => ({ ...prev, [playerId]: decision }));
  };

  const applyDecisions = async () => {
    setLoading(true);
    setError("");

    try {
      if (typeof simEngine.applyRookieSignings !== "function") {
        throw new Error("applyRookieSignings is not wired in simEnginePy.js yet.");
      }

      const result = await simEngine.applyRookieSignings(workingLeagueData, {
        seasonYear,
        userTeamName: selectedTeamName,
        decisions,
      });

      if (!result?.ok) {
        throw new Error(result?.reason || "Failed to apply rookie signings.");
      }

      const nextLeague = result.leagueData || workingLeagueData;
      setWorkingLeagueData(nextLeague);
      persistLeagueData(nextLeague, setLeagueData);
      setApplied(result);

      const remainingUser = result.remainingPendingRookies?.filter((row) => row.userControlled) || [];
      const remainingCpu = result.remainingPendingRookies?.filter((row) => !row.userControlled) || [];
      const isComplete = Boolean(result.complete || (remainingUser.length === 0 && remainingCpu.length === 0));

      if (isComplete) {
        updateOffseasonState({ rookieSigningsComplete: true });
        setApplied({ ...result, complete: true });
      }

      setPreview({
        ...(preview || {}),
        userPendingRookies: remainingUser,
        cpuPendingRookies: remainingCpu,
        summary: result.summary,
      });
    } catch (err) {
      console.error("[RookieSignings] apply failed", err);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bmCourtPage h-full min-h-0 overflow-hidden px-4 py-3 text-white">
      <div className="mx-auto flex h-full min-h-0 max-w-[1700px] flex-col gap-3">
        <div className="flex shrink-0 items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">Offseason</p>
            <h1 className="text-2xl font-black text-orange-500">Rookie Signings</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadPreview} disabled={loading} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-black hover:bg-white/10 disabled:opacity-50">Refresh</button>
            {draftIntegrityIssue ? (
              <button onClick={() => navigate("/draft")} className="rounded-lg bg-orange-600 px-5 py-2 text-sm font-black hover:bg-orange-500">
                Return to NBA Draft
              </button>
            ) : !stageComplete ? (
              <button onClick={applyDecisions} disabled={loading || totalPending === 0} className="rounded-lg bg-orange-600 px-5 py-2 text-sm font-black hover:bg-orange-500 disabled:cursor-not-allowed disabled:bg-neutral-700">
                {loading ? "Processing..." : userRows.length === 0 && cpuRows.length > 0 ? "Resolve CPU Signings" : "Resolve Signings"}
              </button>
            ) : (
              <button onClick={() => navigate("/player-team-options")} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-black hover:bg-emerald-500">
                Continue to Player / Team Options
              </button>
            )}
          </div>
        </div>

        <div className="grid shrink-0 grid-cols-3 gap-2 lg:grid-cols-6">
          {[
            ["Standard", `${projectedStandardCount}/${STANDARD_ROSTER_MAX}`, projectedStandardCount > STANDARD_ROSTER_MAX],
            ["Two-Way", `${projectedTwoWayCount}/${TWO_WAY_MAX}`, projectedTwoWayCount > TWO_WAY_MAX],
            ["Stash", projectedStashCount, false],
            ["Your Pending", userRows.length, false],
            ["CPU Pending", cpuRows.length, false],
            ["Season", seasonYear, false],
          ].map(([label,value,warn]) => (
            <div key={label} className={`rounded-lg border px-3 py-2 ${warn ? "border-orange-500/35 bg-orange-500/10" : "border-white/10 bg-white/[0.04]"}`}>
              <div className="text-[9px] font-black uppercase tracking-wider text-white/45">{label}</div>
              <div className="mt-0.5 text-lg font-black">{value}</div>
            </div>
          ))}
        </div>

        {(error || applied?.summary || projectedStandardCount > STANDARD_ROSTER_MAX || projectedTwoWayCount > TWO_WAY_MAX) && (
          <div className={`shrink-0 rounded-lg border px-4 py-2 text-sm font-bold ${error ? "border-red-500/30 bg-red-500/10 text-red-200" : applied?.summary ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-orange-500/30 bg-orange-500/10 text-orange-100"}`}>
            {error || (applied?.summary ? `Applied ${applied.summary.appliedCount} decisions. ${applied.summary.remainingCount} remain.` : "Offseason overfill is allowed. Final roster limits are enforced before games.")}
          </div>
        )}

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-neutral-900/80">
          <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <h2 className="font-black">Your Draft Picks</h2>
              <div className="text-xs font-semibold text-white/45">Choose standard, two-way, stash, or release.</div>
            </div>
            <div className="flex gap-2 text-xs font-black">
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-200">Standard {decisionSummary.standard || 0}</span>
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-cyan-200">2W {decisionSummary.two_way || 0}</span>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-amber-200">Stash {decisionSummary.stash || 0}</span>
            </div>
          </div>
          <div className="bmTableScroller grid min-h-0 flex-1 grid-cols-1 content-start gap-3 overflow-y-auto p-3 lg:grid-cols-2">
            {loading && !preview ? (
              <div className="col-span-full flex h-full items-center justify-center text-white/50">Loading rookie signings...</div>
            ) : userRows.length ? (
              userRows.map((row,index)=><RookieCard key={row.playerId} row={row} animationIndex={index} decision={decisions[row.playerId]} onDecisionChange={updateDecision} rosterCounts={rosterCounts} />)
            ) : draftIntegrityIssue ? (
              <div className="col-span-full flex h-full flex-col items-center justify-center gap-4 px-6 text-center text-orange-100">
                <div className="max-w-2xl font-bold">{draftIntegrityIssue}</div>
                <button onClick={() => navigate("/draft")} className="rounded-lg bg-orange-600 px-5 py-2 text-sm font-black text-white hover:bg-orange-500">
                  Return to NBA Draft
                </button>
              </div>
            ) : (
              <div className="col-span-full flex h-full flex-col items-center justify-center gap-4 text-white/55">
                <div>No rookie decisions are pending. This stage is complete.</div>
                <button onClick={() => navigate("/player-team-options")} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-black text-white hover:bg-emerald-500">
                  Continue to Player / Team Options
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
