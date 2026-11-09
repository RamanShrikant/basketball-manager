import React, { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useGame } from "../context/GameContext.jsx";
import { clearActiveLeagueSaveId, getActiveLeagueSaveId, getLeagueSave } from "../storage/leagueSaves.js";
import { exportEmergencyFranchise, recoverUnlinkedFranchise, exitToLeagueSlots } from "./franchiseExit.js";

/** Block stale or unlinked gameplay routes without deleting the live runtime. */
export default function FranchiseRouteGate() {
  const { leagueData, selectedTeam } = useGame();
  const location = useLocation();
  const [state, setState] = useState({ kind: "checking", detail: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [exported, setExported] = useState(false);
  const [unsafeExitAcknowledged, setUnsafeExitAcknowledged] = useState(false);
  const [recheck, setRecheck] = useState(0);

  useEffect(() => {
    let live = true;
    const saveId = getActiveLeagueSaveId();
    setState({ kind: "checking", detail: "" });
    if (!saveId) {
      setState({ kind: "unlinked", detail: "No active franchise save slot was selected." });
      return () => { live = false; };
    }
    getLeagueSave(saveId).then(record => {
      if (!live) return;
      const savedIdentity = String(record?.snapshot?.leagueData?.__leagueStorageId || "").trim();
      const liveIdentity = String(leagueData?.__leagueStorageId || "").trim();
      if (savedIdentity && liveIdentity && savedIdentity !== liveIdentity) {
        setState({ kind: "unlinked", detail: "The active save slot belongs to a different franchise. Playing it would risk overwriting that save." });
      } else {
        setState(record?.snapshot?.leagueData
          ? { kind: "ready", detail: "" }
          : { kind: "unlinked", detail: "The selected save record is missing or incomplete." });
      }
    }).catch(e => {
      if (live) setState({ kind: "error", detail: e?.message || "Could not read save slots." });
    });
    return () => { live = false; };
  }, [recheck, leagueData?.__leagueStorageId]);

  if (state.kind === "ready") return <Outlet />;
  if (state.kind === "checking") return <main className="flex min-h-screen items-center justify-center bg-[#080808] p-8 text-white" role="status">Verifying your saved franchise…</main>;
  const hasLiveLeague = Boolean((Array.isArray(leagueData?.teams) && leagueData.teams.length) || (leagueData?.conferences && Object.values(leagueData.conferences).flat().length));
  const name = selectedTeam?.name || "";
  const run = async action => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  };
  return <main className="flex min-h-screen items-center justify-center bg-[#080808] px-5 py-12 text-white">
    <section className="w-full max-w-2xl rounded-2xl border border-orange-500/25 bg-[#111] p-7 shadow-2xl" role="alert">
      <p className="text-xs font-black uppercase tracking-widest text-orange-300">Franchise protection</p>
      <h1 className="mt-2 text-2xl font-black">A save needs attention</h1>
      <p className="mt-3 text-sm leading-6 text-white/70">{state.detail} We stopped navigation to prevent playing in an unlinked franchise. No save was deleted or overwritten.</p>
      {hasLiveLeague && <p className="mt-3 text-sm text-amber-200">Live league data is still present. Recover it into an empty slot or export an emergency backup before leaving.</p>}
      {error && <p className="mt-4 rounded-lg border border-red-500/40 p-3 text-sm text-red-200" role="alert">{error}</p>}
      <div className="mt-6 flex flex-wrap gap-3">
        <button className="rounded-lg border border-orange-500 bg-orange-600 px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={busy || !hasLiveLeague || state.kind === "error"} onClick={() => run(async () => {
          const result = await recoverUnlinkedFranchise({ leagueData, selectedTeamName: name, savedRoute: location.pathname });
          if (result.status === "cloud-failed") {
            setError(`Recovered locally, but cloud sync failed: ${result.reason}. Export a backup or retry cloud sync before leaving.`);
            setRecheck(x => x + 1);
            return;
          }
          exitToLeagueSlots();
        })}>Recover to empty save slot</button>
        <button className="rounded-lg border border-white/20 px-4 py-2 text-sm disabled:opacity-50" disabled={busy || !hasLiveLeague} onClick={() => run(async () => {
          await exportEmergencyFranchise({ leagueData, selectedTeamName: name });
          setExported(true);
        })}>Export emergency backup</button>
        <button className="rounded-lg border border-white/20 px-4 py-2 text-sm disabled:opacity-50" disabled={busy} onClick={() => { setError(""); setRecheck(x => x + 1); }}>Retry verification</button>
        <button className="rounded-lg border border-white/20 px-4 py-2 text-sm disabled:opacity-50" disabled={busy || (hasLiveLeague && !exported)} onClick={() => {
          if (hasLiveLeague && !window.confirm("Your emergency export is your only new backup. Leave without writing this league to a save slot?")) return;
          clearActiveLeagueSaveId();
          exitToLeagueSlots();
        }}>{hasLiveLeague ? "Leave after backup" : "Return to save slots"}</button>
      </div>
      {hasLiveLeague && !exported && <div className="mt-5 border-t border-red-500/20 pt-3 text-xs text-red-200">
        <label className="flex items-start gap-2"><input type="checkbox" checked={unsafeExitAcknowledged} onChange={event => setUnsafeExitAcknowledged(event.target.checked)} /> Last resort: I understand that leaving without any backup could permanently lose unsaved league progress.</label>
        <button type="button" className="mt-3 rounded-md border border-red-500/40 px-3 py-2 disabled:opacity-40" disabled={busy || !unsafeExitAcknowledged} onClick={() => {
          if (!window.confirm("LAST RESORT: no new backup was made. Leave this live franchise and risk losing unsaved progress?")) return;
          clearActiveLeagueSaveId(); exitToLeagueSlots();
        }}>Exit without backup (last resort)</button>
      </div>}
      <p className="mt-5 text-xs text-white/45">Emergency JSON includes league runtime but needs a manual restore procedure. Automatic import is not available yet. Cloud leagues must sync before they are safe on other devices.</p>
    </section>
  </main>;
}
