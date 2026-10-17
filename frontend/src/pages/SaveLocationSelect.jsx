import React, { useState } from "react";
import { Link } from "react-router-dom";
import { activeBrowserAccountId, getAccountSaveMode, requestAccountSaveMode } from "../auth/accountLocalVault.js";
import { checkpointActiveLeagueSave, getActiveLeagueSaveId } from "../storage/leagueSaves.js";
import { flushAllLeagueRuntimeWrites } from "../storage/saveManager.js";
import { uploadCloudSave, notifyCloudSaveStatus } from "../auth/cloudSaveClient.js";
import { useGame } from "../context/GameContext.jsx";

const card = "flex min-h-[230px] flex-col justify-between rounded-2xl border border-white/10 bg-[#0d0d0d] p-7 text-left transition hover:border-orange-500/50 hover:bg-[#15100d] disabled:opacity-50";
export default function SaveLocationSelect({ user }) {
  const { leagueData, selectedTeam } = useGame();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = getAccountSaveMode(user.id);
  async function choose(mode) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (activeBrowserAccountId() !== user.id) throw new Error("Account switched. Please reload.");
      // Save and drain the CURRENT world before switching; next boot swaps stores
      // before the game's modules initialize. No gameplay storage is shared.
      if (getActiveLeagueSaveId() && leagueData) {
        await checkpointActiveLeagueSave({ leagueData, selectedTeamName: selectedTeam?.name || "", source: "SaveLocationSelect.changeMode" });
      }
      await flushAllLeagueRuntimeWrites();
      if (mode !== active && active === "cloud") {
        // Never switch away from Cloud while its current state is unconfirmed.
        const calendarIntent = JSON.parse(localStorage.getItem("bm_pending_calendar_sim_v1") || "null");
        const postseasonIntent = JSON.parse(localStorage.getItem("bm_pending_postseason_sim_v1") || "null");
        if ((calendarIntent && !calendarIntent.pausedReason) || (postseasonIntent && !postseasonIntent.pausedReason)) {
          throw new Error("Finish or safely pause the simulation before changing save location.");
        }
        notifyCloudSaveStatus("saving", "Confirming cloud slot before switching...");
        try {
          await uploadCloudSave(user.id, { force: true });
          notifyCloudSaveStatus("saved", "Cloud franchise saved");
        } catch (cloudError) {
          notifyCloudSaveStatus("error", cloudError?.message || String(cloudError));
          throw new Error(`Cloud backup failed: ${cloudError.message}. You have NOT switched to Local. Your cloud cache is safe.`);
        }
      }
      requestAccountSaveMode(user.id, mode);
      window.location.assign("/play"); // Mandatory boot boundary for IndexedDB and module cache isolation.
    } catch (err) { setError(err?.message || "Could not switch save location."); }
    finally { setBusy(false); }
  }
  return <main className="flex min-h-screen items-center justify-center bg-[#050505] px-5 py-12 text-white">
    <section className="w-full max-w-4xl">
      <Link to="/game-modes" className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/45 hover:text-orange-200">← Game Modes</Link>
      <p className="mt-8 text-[11px] font-black uppercase tracking-[0.2em] text-orange-300">Singleplayer • Beta</p>
      <h1 className="mt-2 text-4xl font-black tracking-[-0.06em] md:text-5xl">Choose Save Location</h1>
      <p className="mt-3 max-w-xl text-sm text-white/50">Local and Cloud are separate franchise collections. Neither option changes the other.</p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <button type="button" disabled={busy} onClick={() => choose("local")} className={card}>
          <div><span className="text-[11px] font-black uppercase tracking-widest text-orange-300">10 save slots {active === "local" ? "• Active" : ""}</span>
            <h2 className="mt-4 text-2xl font-black">Local Saves</h2>
            <p className="mt-3 text-sm leading-6 text-white/55">Autosaves to this browser only. Never uploads to Supabase. Best for offline singleplayer and multiple separate rebuilds.</p></div>
          <span className="mt-7 text-sm font-black text-orange-200">Open Local →</span>
        </button>
        <button type="button" disabled={busy} onClick={() => choose("cloud")} className={card}>
          <div><span className="text-[11px] font-black uppercase tracking-widest text-orange-300">1 save slot {active === "cloud" ? "• Active" : ""}</span>
            <h2 className="mt-4 text-2xl font-black">Cloud Saves</h2>
            <p className="mt-3 text-sm leading-6 text-white/55">One private account-linked franchise. Uses a local cache for gameplay and automatically syncs to Supabase when online.</p></div>
          <span className="mt-7 text-sm font-black text-orange-200">Open Cloud →</span>
        </button>
      </div>
      {error && <p role="alert" className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200">{error}</p>}
      <p className="mt-6 text-xs text-white/35">Existing browser franchises remain in Local. Older account-wide cloud backups are retained for recovery and are not automatically imported into the new single-slot cloud system.</p>
    </section>
  </main>;
}
