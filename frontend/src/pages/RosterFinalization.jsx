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
    <div className="bmCourtPage h-full min-h-0 overflow-hidden bg-neutral-950 px-4 py-3 text-white">
      <div className="mx-auto flex h-full min-h-0 max-w-[1700px] flex-col gap-3">
        <div className="flex shrink-0 items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-300/70">Offseason</p>
            <h1 className="text-2xl font-black text-orange-500">Roster Finalization</h1>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={loadPreview} disabled={loading || applying} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-black hover:bg-white/10 disabled:opacity-50">
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <button type="button" onClick={handleApply} disabled={loading || applying || !preview?.ok || !userOk || result?.ok} className="rounded-lg bg-orange-600 px-5 py-2 text-sm font-black hover:bg-orange-500 disabled:cursor-not-allowed disabled:bg-neutral-700">
              {applying ? "Finalizing..." : result?.ok ? "Finalized" : "Finalize Rosters"}
            </button>
            {result?.ok && (
              <button type="button" onClick={() => navigate("/offseason")} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-black hover:bg-emerald-500">
                Continue
              </button>
            )}
          </div>
        </div>

        {(error || result?.ok) && (
          <div className={`shrink-0 rounded-lg border px-4 py-2 text-sm font-bold ${error ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`}>
            {error || `Roster finalization complete. ${Array.isArray(result?.actions) ? result.actions.length : 0} CPU moves were applied.`}
          </div>
        )}

        <div className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4">
          <CountPill label="Your Standard" value={userRow ? `${userRow.standardCount}/${userRow.standardMax}` : "-"} tone={userRow?.standardCount > userRow?.standardMax || userRow?.standardCount < userRow?.standardMin ? "red" : "green"} />
          <CountPill label="Your Two-Way" value={userRow ? `${userRow.twoWayCount}/${userRow.twoWayMax}` : "-"} tone={userRow?.twoWayCount > userRow?.twoWayMax ? "red" : "green"} />
          <CountPill label="CPU Teams to Fix" value={cpuIssueCount} tone={cpuIssueCount ? "orange" : "green"} />
          <CountPill label="League Illegal" value={illegalTeams.length} tone={illegalTeams.length ? "orange" : "green"} />
        </div>

        {userRow && !userOk && (
          <div className="flex shrink-0 items-center justify-between gap-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <div>
              <div className="font-black text-red-100">Your roster must be legal before finalizing.</div>
              <div className="text-xs text-red-100/70">Fix the standard or two-way count, then refresh.</div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => navigate("/roster-view")} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-black hover:bg-orange-500">Open Roster</button>
              <button type="button" onClick={() => navigate("/free-agents")} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-black hover:bg-white/10">Free Agents</button>
            </div>
          </div>
        )}

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[0.82fr_1.18fr]">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]">
            <div className="shrink-0 border-b border-white/10 px-4 py-3">
              <h2 className="font-black">Your Team</h2>
            </div>
            <div className="min-h-0 flex-1 p-3">
              {userRow ? <TeamStatusRow row={userRow} /> : <div className="text-sm text-white/50">No selected team found.</div>}
            </div>
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]">
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
              <h2 className="font-black">League Cleanup</h2>
              <span className="text-xs font-bold text-white/45">{illegalTeams.length} teams</span>
            </div>
            <div className="bmTableScroller min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {illegalTeams.length ? illegalTeams.map((row) => <TeamStatusRow key={row.teamName} row={row} />) : (
                <div className="flex h-full items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-sm font-bold text-emerald-200">Every team is legal.</div>
              )}
            </div>
          </section>
        </div>

        {Array.isArray(result?.actions) && result.actions.length > 0 && (
          <details className="shrink-0 rounded-xl border border-white/10 bg-white/[0.04]">
            <summary className="cursor-pointer px-4 py-2 text-sm font-black text-orange-200">CPU transaction log ({result.actions.length})</summary>
            <div className="bmTableScroller max-h-52 overflow-auto border-t border-white/10">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="sticky top-0 bg-neutral-900 text-left text-xs uppercase text-white/45"><tr><th className="px-4 py-2">Team</th><th className="px-4 py-2">Player</th><th className="px-4 py-2">Action</th><th className="px-4 py-2">OVR</th></tr></thead>
                <tbody>{result.actions.map((row,index)=><tr key={`${row.playerId || row.playerName}-${index}`} className="border-t border-white/5"><td className="px-4 py-2 font-bold">{row.teamName||"-"}</td><td className="px-4 py-2">{row.playerName||"-"}</td><td className="px-4 py-2 text-orange-200">{String(row.action||"").replaceAll("_"," ")}</td><td className="px-4 py-2">{row.overall??"-"}</td></tr>)}</tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
