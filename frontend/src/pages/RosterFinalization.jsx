import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { applyRosterFinalization, previewRosterFinalization } from "../api/simEnginePy.js";

const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";

function safeJSON(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function getAllTeamsFromLeague(leagueData) {
  if (Array.isArray(leagueData?.teams)) return leagueData.teams;
  if (leagueData?.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function getSelectedTeamName(selectedTeam) {
  if (selectedTeam?.name) return selectedTeam.name;
  const saved = safeJSON(localStorage.getItem("selectedTeam"), null);
  if (typeof saved === "string") return saved;
  if (saved?.name) return saved.name;
  return "";
}

function persistLeagueData(updated, setLeagueData, selectedTeamName, setSelectedTeam) {
  if (!updated) return;

  localStorage.setItem("leagueData", JSON.stringify(updated));

  if (typeof setLeagueData === "function") {
    setLeagueData(updated);
  }

  const updatedTeam = getAllTeamsFromLeague(updated).find((team) => team?.name === selectedTeamName);
  if (updatedTeam) {
    localStorage.setItem("selectedTeam", JSON.stringify(updatedTeam));
    if (typeof setSelectedTeam === "function") {
      setSelectedTeam(updatedTeam);
    }
  }
}

function updateOffseasonState(patch) {
  const current = safeJSON(localStorage.getItem(OFFSEASON_STATE_KEY), {}) || {};
  const next = { ...current, ...patch };
  localStorage.setItem(OFFSEASON_STATE_KEY, JSON.stringify(next));
  return next;
}

function CountPill({ label, value, tone = "neutral" }) {
  const cls =
    tone === "green"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      : tone === "red"
      ? "border-red-500/30 bg-red-500/10 text-red-200"
      : tone === "orange"
      ? "border-orange-500/30 bg-orange-500/10 text-orange-200"
      : "border-white/10 bg-white/[0.05] text-white/75";

  return (
    <div className={`rounded-2xl border px-4 py-3 ${cls}`}>
      <div className="text-[11px] font-black uppercase tracking-[0.16em] opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-black text-white">{value}</div>
    </div>
  );
}

function TeamStatusRow({ row }) {
  const ok = !!row?.ok;
  return (
    <div className={`rounded-2xl border px-4 py-3 ${ok ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/25 bg-red-500/10"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-base font-black text-white">{row?.teamName || "Unknown Team"}</div>
          <div className="mt-1 text-xs font-semibold text-white/45">
            Standard {row?.standardCount}/{row?.standardMax} · Two-Way {row?.twoWayCount}/{row?.twoWayMax} · Stash {row?.stashCount || 0} · Pending {row?.pendingRookiesCount || 0}
          </div>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.14em] ${ok ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-red-400/30 bg-red-500/10 text-red-200"}`}>
          {ok ? "Legal" : "Needs Fix"}
        </span>
      </div>

      {!ok && Array.isArray(row?.errors) && row.errors.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm font-semibold text-red-200">
          {row.errors.map((error, index) => (
            <li key={`${error}-${index}`}>• {error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function RosterFinalization() {
  const navigate = useNavigate();
  const { leagueData, selectedTeam, setLeagueData, setSelectedTeam } = useGame();
  const [workingLeagueData, setWorkingLeagueData] = useState(leagueData || safeJSON(localStorage.getItem("leagueData"), {}) || {});
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const selectedTeamName = useMemo(() => getSelectedTeamName(selectedTeam), [selectedTeam]);

  useEffect(() => {
    if (leagueData) setWorkingLeagueData(leagueData);
  }, [leagueData]);

  const loadPreview = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await previewRosterFinalization(workingLeagueData, {
        userTeamName: selectedTeamName,
      });

      if (!res?.ok) {
        setError(res?.reason || "Roster finalization preview failed.");
        setPreview(res || null);
        return;
      }

      setPreview(res);
      if (res?.leagueData) {
        setWorkingLeagueData(res.leagueData);
        persistLeagueData(res.leagueData, setLeagueData, selectedTeamName, setSelectedTeam);
      }
    } catch (err) {
      console.error("[RosterFinalization] preview failed", err);
      setError(err?.message || "Roster finalization preview failed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTeamName]);

  const summary = preview?.summary || result?.summary || {};
  const userRow = summary?.userTeam || null;
  const userOk = userRow ? !!userRow.ok : true;
  const cpuIssueCount = Number(summary?.cpuIllegalTeamCount || 0);
  const teams = Array.isArray(summary?.teams) ? summary.teams : [];
  const illegalTeams = teams.filter((row) => !row?.ok);

  const handleApply = async () => {
    setApplying(true);
    setError("");
    setResult(null);

    try {
      const res = await applyRosterFinalization(workingLeagueData, {
        userTeamName: selectedTeamName,
      });

      if (!res?.ok) {
        setError(res?.message || res?.reason || "Roster finalization failed.");
        setPreview(res || preview);
        return;
      }

      setResult(res);
      setPreview(res);
      setWorkingLeagueData(res.leagueData);
      persistLeagueData(res.leagueData, setLeagueData, selectedTeamName, setSelectedTeam);
      updateOffseasonState({ rosterFinalizationComplete: true });
    } catch (err) {
      console.error("[RosterFinalization] apply failed", err);
      setError(err?.message || "Roster finalization failed.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-300/80">Offseason</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-orange-500">Roster Finalization</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
              Lock the season-start roster. Your team must be legal before progression. CPU teams will first move eligible young fringe players to two-way, then cut only if still over 15, and sign emergency minimum players if they are short. Carrying 0-3 two-way players is legal.
            </p>
          </div>

          <button
            type="button"
            onClick={() => navigate("/offseason")}
            className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black text-white/75 transition hover:border-orange-400/40 hover:bg-orange-500/10 hover:text-white"
          >
            Back to Hub
          </button>
        </div>

        {error && (
          <div className="mb-5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
            {error}
          </div>
        )}

        {result?.ok && (
          <div className="mb-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-200">
            Roster finalization complete. CPU fixes applied: {Array.isArray(result.actions) ? result.actions.length : 0}.
          </div>
        )}

        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <CountPill label="Your Standard" value={userRow ? `${userRow.standardCount}/${userRow.standardMax}` : "-"} tone={userRow?.standardCount > userRow?.standardMax || userRow?.standardCount < userRow?.standardMin ? "red" : "green"} />
          <CountPill label="Your Two-Way" value={userRow ? `${userRow.twoWayCount}/${userRow.twoWayMax}` : "-"} tone={userRow?.twoWayCount > userRow?.twoWayMax ? "red" : "green"} />
          <CountPill label="CPU Teams to Fix" value={cpuIssueCount} tone={cpuIssueCount ? "orange" : "green"} />
          <CountPill label="League Illegal" value={illegalTeams.length} tone={illegalTeams.length ? "orange" : "green"} />
        </div>

        {userRow && !userOk && (
          <div className="mb-6 rounded-3xl border border-red-500/30 bg-red-500/10 p-5">
            <h2 className="text-xl font-black text-red-100">Your roster needs fixing first</h2>
            <p className="mt-2 text-sm leading-6 text-red-100/75">
              Roster finalization will not auto-cut your team. Fix your roster manually, then come back and refresh this page.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigate("/roster-view")}
                className="rounded-xl bg-orange-600 px-4 py-3 text-sm font-black text-white transition hover:bg-orange-500"
              >
                Open Roster
              </button>
              <button
                type="button"
                onClick={() => navigate("/free-agents")}
                className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm font-black text-white/75 transition hover:border-orange-400/40 hover:bg-orange-500/10 hover:text-white"
              >
                Open Free Agency
              </button>
            </div>
          </div>
        )}

        <div className="mb-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={loadPreview}
            disabled={loading || applying}
            className="rounded-xl border border-white/10 bg-white/[0.05] px-5 py-3 text-sm font-black text-white/75 transition hover:border-orange-400/40 hover:bg-orange-500/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh Preview"}
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={loading || applying || !preview?.ok || !userOk || result?.ok}
            className="rounded-xl bg-orange-600 px-5 py-3 text-sm font-black text-white transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {applying ? "Finalizing..." : result?.ok ? "Finalized" : "Finalize Rosters"}
          </button>
          {result?.ok && (
            <button
              type="button"
              onClick={() => navigate("/offseason")}
              className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-500"
            >
              Return to Hub
            </button>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <h2 className="text-xl font-black text-white">Your Team</h2>
            <div className="mt-4">
              {userRow ? <TeamStatusRow row={userRow} /> : <div className="text-sm text-white/50">No selected team found.</div>}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <h2 className="text-xl font-black text-white">Teams Needing Cleanup</h2>
            <div className="mt-4 max-h-[520px] space-y-3 overflow-y-auto pr-1">
              {illegalTeams.length ? (
                illegalTeams.map((row) => <TeamStatusRow key={row.teamName} row={row} />)
              ) : (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-8 text-center text-sm font-bold text-emerald-200">
                  Every team is currently legal for season start.
                </div>
              )}
            </div>
          </div>
        </div>

        {Array.isArray(result?.actions) && result.actions.length > 0 && (
          <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <h2 className="text-xl font-black text-white">CPU Finalization Log</h2>
            <div className="mt-4 max-h-[360px] overflow-y-auto rounded-2xl border border-white/10">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-neutral-900 text-left text-xs uppercase tracking-[0.14em] text-white/45">
                  <tr>
                    <th className="px-4 py-3">Team</th>
                    <th className="px-4 py-3">Player</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">OVR</th>
                  </tr>
                </thead>
                <tbody>
                  {result.actions.map((row, index) => (
                    <tr key={`${row.playerId || row.playerName}-${index}`} className="border-t border-white/5">
                      <td className="px-4 py-3 font-bold text-white">{row.teamName || "-"}</td>
                      <td className="px-4 py-3 text-white/80">{row.playerName || "-"}</td>
                      <td className="px-4 py-3 text-orange-200">{String(row.action || "").replaceAll("_", " ")}</td>
                      <td className="px-4 py-3 text-white/70">{row.overall ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
