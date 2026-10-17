import { useEffect, useRef } from "react";
import { useGame } from "../context/GameContext.jsx";
import { activeBrowserAccountId } from "../auth/accountLocalVault.js";
import { uploadCloudSave, notifyCloudSaveStatus } from "../auth/cloudSaveClient.js";
import { checkpointActiveLeagueSave, getActiveLeagueSaveId } from "../storage/leagueSaves.js";
import { flushAllLeagueRuntimeWrites } from "../storage/saveManager.js";

// Cloud snapshots are deliberately independent of the existing local autosave.
// A network outage must never interrupt simulation or overwrite local progress.
export function CloudAutosaveBridge({ user }) {
  const { leagueData, selectedTeam } = useGame();
  const latest = useRef({ leagueData, selectedTeam });
  latest.current = { leagueData, selectedTeam };
  // Debounce autosync until the game settles; do not upload every sim tick.
  useEffect(() => {
    if (!leagueData) return;
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event("bm:cloud-save-request"));
    }, 25000);
    return () => clearTimeout(timer);
  }, [leagueData]);
  const running = useRef(false);
  useEffect(() => {
    let disposed = false;
    async function saveCloud() {
      if (disposed || running.current || activeBrowserAccountId() !== user.id) return;
      // Calendar and Playoffs checkpoint resumable simulation intents locally.
      // Do not publish a partly simulated season as the account's latest cloud copy.
      try {
        const calendarIntent = JSON.parse(localStorage.getItem("bm_pending_calendar_sim_v1") || "null");
        const playoffsIntent = JSON.parse(localStorage.getItem("bm_pending_postseason_sim_v1") || "null");
        if ((calendarIntent && !calendarIntent.pausedReason) || (playoffsIntent && !playoffsIntent.pausedReason)) {
          notifyCloudSaveStatus("waiting", "Cloud sync deferred until simulation finishes");
          return;
        }
      } catch { /* Invalid intents are diagnosed by the game's own recovery paths. */ }
      running.current = true;
      try {
        notifyCloudSaveStatus("saving", "Saving franchises to cloud…");
        const { leagueData: current, selectedTeam: team } = latest.current;
        if (getActiveLeagueSaveId() && current) {
          await checkpointActiveLeagueSave({
            leagueData: current, selectedTeamName: team?.name || "",
            source: "cloud_auto_checkpoint", savedRoute: window.location.pathname,
          });
        }
        await flushAllLeagueRuntimeWrites();
        const result = await uploadCloudSave(user.id);
        if (!disposed) notifyCloudSaveStatus("saved", result.skipped ? "Already backed up" : "Cloud backup complete");
      } catch (error) {
        if (!disposed) notifyCloudSaveStatus("error", error?.message || String(error));
        console.warn("[BM Cloud Save] Local saves remain intact:", error);
      } finally { running.current = false; }
    }
    const startup = setTimeout(saveCloud, 12000);
    const interval = setInterval(saveCloud, 180000);
    const onVisibility = () => { if (document.visibilityState === "hidden") saveCloud(); };
    const onManual = () => saveCloud();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("bm:cloud-save-request", onManual);
    return () => {
      disposed = true;
      clearTimeout(startup);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("bm:cloud-save-request", onManual);
    };
  }, [user.id]);
  return null;
}
