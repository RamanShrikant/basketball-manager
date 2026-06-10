import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import * as simEngine from "../api/simEnginePy.js";

const LEAGUE_KEY = "leagueData";
const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
const STANDARD_ROSTER_MAX = 15;
const TWO_WAY_MAX = 3;
const OFFSEASON_CONTROLLED_MAX = 20;

function getAllTeams(leagueData) {
  if (Array.isArray(leagueData?.teams)) return leagueData.teams;
  return Object.values(leagueData?.conferences || {}).flatMap((teams) => teams || []);
}

function findTeamByName(leagueData, teamName) {
  if (!teamName) return null;
  return getAllTeams(leagueData).find((team) => team?.name === teamName || team?.teamName === teamName) || null;
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
  const controlledCount = standardCount + twoWayCount + stashCount + pendingCount;

  return {
    standardCount,
    twoWayCount,
    stashCount,
    pendingCount,
    controlledCount,
    standardSlotsOpen: Math.max(0, STANDARD_ROSTER_MAX - standardCount),
    twoWaySlotsOpen: Math.max(0, TWO_WAY_MAX - twoWayCount),
    controlledSlotsOpen: Math.max(0, OFFSEASON_CONTROLLED_MAX - controlledCount),
  };
}

const CONTROLLED_ROOKIE_DECISIONS = new Set(["standard", "two_way", "stash"]);

function normalizeDecisionValue(decision) {
  let next = String(decision || "two_way").toLowerCase();
  if (next === "draft_rights") next = "stash";
  if (!["standard", "two_way", "stash", "release"].includes(next)) next = "release";
  return next;
}

function normalizeDecisionForSlots(decision, runningCounts) {
  let next = normalizeDecisionValue(decision);

  // Rookie decisions are a batch replacement. Pending rookies already occupy
  // controlled slots, so availability should be based on the roster after all
  // pending rookies are removed, not the raw pre-resolution controlled count.
  const controlledFull = Number(runningCounts.controlledCount || 0) >= OFFSEASON_CONTROLLED_MAX;
  const twoWayFull = Number(runningCounts.twoWayCount || 0) >= TWO_WAY_MAX;

  if (next === "two_way" && twoWayFull) next = "stash";
  if (CONTROLLED_ROOKIE_DECISIONS.has(next) && controlledFull) next = "release";

  return next;
}

function buildInitialDecisions(rows, counts) {
  const initial = {};
  const running = {
    standardCount: Number(counts.standardCount || 0),
    twoWayCount: Number(counts.twoWayCount || 0),
    stashCount: Number(counts.stashCount || 0),
    controlledCount: Math.max(
      0,
      Number(counts.controlledCount || 0) - Number(counts.pendingCount || 0)
    ),
  };

  for (const row of rows || []) {
    const decision = normalizeDecisionForSlots(row.recommendedDecision, running);
    initial[row.playerId] = decision;

    if (decision === "standard") running.standardCount += 1;
    if (decision === "two_way") running.twoWayCount += 1;
    if (decision === "stash") running.stashCount += 1;
    if (CONTROLLED_ROOKIE_DECISIONS.has(decision)) running.controlledCount += 1;
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
  if (typeof setLeagueData === "function") setLeagueData(updated);
  localStorage.setItem(LEAGUE_KEY, JSON.stringify(updated));
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
  getProjectedCountsForDecision,
  animationIndex = 0,
}) {
  const imageUrl = getImageUrl(row);
  const standardProjection = getProjectedCountsForDecision(row.playerId, "standard");
  const twoWayProjection = getProjectedCountsForDecision(row.playerId, "two_way");
  const stashProjection = getProjectedCountsForDecision(row.playerId, "stash");

  // Options are blocked only when that specific choice would make the final
  // projected rookie-signing batch illegal. This lets a team at 21 raw controlled
  // players sign/stash one rookie while releasing another to finish at 20.
  const standardBlocked = standardProjection.controlledCount > OFFSEASON_CONTROLLED_MAX;
  const twoWayBlocked =
    twoWayProjection.twoWayCount > TWO_WAY_MAX ||
    twoWayProjection.controlledCount > OFFSEASON_CONTROLLED_MAX;
  const stashBlocked = stashProjection.controlledCount > OFFSEASON_CONTROLLED_MAX;

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
              Standard Contract{standardBlocked ? " - Offseason Full" : rosterCounts.standardSlotsOpen <= 0 ? " - Over 15 by Season Start" : ""}
            </option>
            <option value="two_way" disabled={twoWayBlocked}>
              Two-Way Contract{twoWayBlocked ? " - Full" : ""}
            </option>
            <option value="stash" disabled={stashBlocked}>
              1-Year Stash{stashBlocked ? " - Offseason Full" : ""}
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

  useEffect(() => {
    if (leagueData) setWorkingLeagueData(leagueData);
  }, [leagueData]);

  const userRows = preview?.userPendingRookies || [];
  const cpuRows = preview?.cpuPendingRookies || [];

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
    };
  };

  const getProjectedCountsForDecision = (playerId, nextDecision) => {
    return getProjectedCountsFromDecisions({
      ...decisions,
      [playerId]: normalizeDecisionValue(nextDecision),
    });
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
      setWorkingLeagueData(nextLeague);
      persistLeagueData(nextLeague, setLeagueData);
      setPreview(result);

      const nextCounts = getRosterCounts(nextLeague, selectedTeamName);
      setDecisions(buildInitialDecisions(result.userPendingRookies || [], nextCounts));
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

      if (result.complete) {
        updateOffseasonState({ rookieSigningsComplete: true });
      }

      setPreview({
        ...(preview || {}),
        userPendingRookies: result.remainingPendingRookies?.filter((row) => row.userControlled) || [],
        cpuPendingRookies: result.remainingPendingRookies?.filter((row) => !row.userControlled) || [],
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
    <div className="min-h-screen bmCourtPage text-white py-10 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-5 mb-8">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-white/40 mb-2">Offseason Event</p>
            <h1 className="text-5xl font-extrabold text-orange-500">Rookie Signings</h1>
            <p className="text-white/60 mt-3">
              Resolve every drafted rookie. First-rounders usually sign standard deals, while late firsts and second-rounders can be placed on standard, two-way, stash, or release paths.
            </p>
          </div>

          <button
            onClick={() => navigate("/offseason")}
            className="bmSmoothButton px-6 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 font-bold border border-white/10"
          >
            Back to Offseason
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-8 gap-3 mb-6">
          <div className="bmSolidPanel rounded-2xl bg-white/5 border border-white/10 p-4">
            <div className="text-xs uppercase tracking-wide text-white/40">Season</div>
            <div className="text-2xl font-extrabold">{seasonYear}</div>
          </div>
          <div className="bmSolidPanel rounded-2xl bg-white/5 border border-white/10 p-4">
            <div className="text-xs uppercase tracking-wide text-white/40">Projected Standard</div>
            <div className={`text-2xl font-extrabold ${projectedStandardCount > STANDARD_ROSTER_MAX ? "text-orange-300" : ""}`}>
              {projectedStandardCount}/{STANDARD_ROSTER_MAX}
            </div>
          </div>
          <div className="bmSolidPanel rounded-2xl bg-white/5 border border-white/10 p-4">
            <div className="text-xs uppercase tracking-wide text-white/40">Projected Two-Way</div>
            <div className={`text-2xl font-extrabold ${projectedTwoWayCount > TWO_WAY_MAX ? "text-red-300" : ""}`}>
              {projectedTwoWayCount}/{TWO_WAY_MAX}
            </div>
          </div>
          <div className="bmSolidPanel rounded-2xl bg-white/5 border border-white/10 p-4">
            <div className="text-xs uppercase tracking-wide text-white/40">Projected Stash</div>
            <div className="text-2xl font-extrabold">{projectedStashCount}</div>
          </div>
          <div className="bmSolidPanel rounded-2xl bg-white/5 border border-white/10 p-4">
            <div className="text-xs uppercase tracking-wide text-white/40">Projected Controlled</div>
            <div className={`text-2xl font-extrabold ${projectedControlledCount > OFFSEASON_CONTROLLED_MAX ? "text-red-300" : ""}`}>
              {projectedControlledCount}/{OFFSEASON_CONTROLLED_MAX}
            </div>
          </div>
          <div className="bmSolidPanel rounded-2xl bg-white/5 border border-white/10 p-4">
            <div className="text-xs uppercase tracking-wide text-white/40">Your Pending</div>
            <div className="text-2xl font-extrabold">{userRows.length}</div>
          </div>
          <div className="bmSolidPanel rounded-2xl bg-white/5 border border-white/10 p-4">
            <div className="text-xs uppercase tracking-wide text-white/40">CPU Pending</div>
            <div className="text-2xl font-extrabold">{cpuRows.length}</div>
          </div>
          <div className="bmSolidPanel rounded-2xl bg-white/5 border border-white/10 p-4">
            <div className="text-xs uppercase tracking-wide text-white/40">Two-Way Choices</div>
            <div className="text-2xl font-extrabold">{decisionSummary.two_way || 0}</div>
          </div>
          <div className="bmSolidPanel rounded-2xl bg-white/5 border border-white/10 p-4">
            <div className="text-xs uppercase tracking-wide text-white/40">Stash Choices</div>
            <div className="text-2xl font-extrabold">{decisionSummary.stash || 0}</div>
          </div>
          <div className="bmSolidPanel rounded-2xl bg-white/5 border border-white/10 p-4">
            <div className="text-xs uppercase tracking-wide text-white/40">Standard Choices</div>
            <div className="text-2xl font-extrabold">{decisionSummary.standard || 0}</div>
          </div>
        </div>

        {projectedStandardCount > STANDARD_ROSTER_MAX && projectedControlledCount <= OFFSEASON_CONTROLLED_MAX && userRows.length > 0 && (
          <div className="mb-5 rounded-2xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-orange-100 font-semibold">
            Your projected standard roster is {projectedStandardCount}/{STANDARD_ROSTER_MAX} after these rookie decisions. This is allowed during the offseason while you are under {OFFSEASON_CONTROLLED_MAX} controlled players, but roster finalization will require cuts before the season starts.
          </div>
        )}

        {projectedControlledCount > OFFSEASON_CONTROLLED_MAX && userRows.length > 0 && (
          <div className="mb-5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-100 font-semibold">
            Your projected offseason controlled roster is {projectedControlledCount}/{OFFSEASON_CONTROLLED_MAX}. Change a rookie decision to Release before resolving signings.
          </div>
        )}

        {projectedTwoWayCount > TWO_WAY_MAX && userRows.length > 0 && (
          <div className="mb-5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-100 font-semibold">
            Your projected two-way slots are {projectedTwoWayCount}/{TWO_WAY_MAX}. Change one of the two-way decisions before resolving signings.
          </div>
        )}

        {error && (
          <div className="mb-5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-200 font-semibold">
            {error}
          </div>
        )}

        {applied?.summary && (
          <div className="mb-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-200 font-semibold">
            Applied {applied.summary.appliedCount} rookie signing decisions. Remaining: {applied.summary.remainingCount}.
          </div>
        )}

        <div className="bmTablePanel rounded-3xl border border-white/10 bg-neutral-900/80 shadow-2xl overflow-hidden">
          <div className="p-5 border-b border-white/10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="text-2xl font-extrabold">Your Draft Picks</h2>
              <p className="text-white/55 text-sm mt-1">CPU teams are resolved automatically when you apply decisions. Stash is only available immediately after the draft and returns next offseason.</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={loadPreview}
                disabled={loading}
                className="bmSmoothButton px-5 py-3 rounded-xl bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 font-bold"
              >
                Refresh Preview
              </button>
              <button
                onClick={applyDecisions}
                disabled={loading}
                className="bmSmoothButton px-5 py-3 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-50 font-bold"
              >
                Resolve Rookie Signings
              </button>
            </div>
          </div>

          <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
            {loading && !preview ? (
              <div className="col-span-full text-white/50 py-10 text-center">Loading rookie signings...</div>
            ) : userRows.length ? (
              userRows.map((row, index) => (
                <RookieCard
                  key={row.playerId}
                  row={row}
                  animationIndex={index}
                  decision={decisions[row.playerId]}
                  onDecisionChange={updateDecision}
                  rosterCounts={rosterCounts}
                  getProjectedCountsForDecision={getProjectedCountsForDecision}
                />
              ))
            ) : (
              <div className="col-span-full text-white/50 py-10 text-center">
                No user-controlled rookie signing decisions are pending.
              </div>
            )}
          </div>
        </div>

        <div className="bmSolidPanel mt-6 rounded-3xl border border-white/10 bg-neutral-900/70 p-5">
          <h2 className="text-xl font-extrabold mb-2">CPU Teams</h2>
          <p className="text-white/55 text-sm">
            {cpuRows.length
              ? `${cpuRows.length} CPU rookie signing decisions will be auto-resolved.`
              : "No CPU rookie signing decisions are pending."}
          </p>
        </div>
      </div>
    </div>
  );
}
