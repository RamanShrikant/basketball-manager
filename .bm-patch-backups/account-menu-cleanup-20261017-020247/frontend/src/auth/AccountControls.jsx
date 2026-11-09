import React, { useEffect, useState } from "react";
import { uploadCloudSave, notifyCloudSaveStatus } from "./cloudSaveClient.js";
import { supabase } from "./supabaseClient.js";
import { activeBrowserAccountId, checkpointAccount, getAccountSaveMode } from "./accountLocalVault.js";
import { checkpointActiveLeagueSave, getActiveLeagueSaveId } from "../storage/leagueSaves.js";
import { flushAllLeagueRuntimeWrites } from "../storage/saveManager.js";
import { useGame } from "../context/GameContext.jsx";

export function AccountControls({ user }) {
  const { leagueData, selectedTeam } = useGame();
  const isCloudMode = getAccountSaveMode(user.id) === "cloud";
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [cloudStatus, setCloudStatus] = useState(() => window.__bmCloudSaveStatus || {status: "checking", detail: ""});
  useEffect(() => {
    const listener = event => setCloudStatus(event.detail);
    window.addEventListener("bm:cloud-save-status", listener);
    return () => window.removeEventListener("bm:cloud-save-status", listener);
  }, []);

  async function signOut() {
    if (working || !window.confirm("Sign out? Your franchises will stay saved on this computer.")) return;
    setWorking(true); setError("");
    try {
      if (activeBrowserAccountId() !== user.id) throw new Error("Another account became active. Reload before signing out.");
      if (getActiveLeagueSaveId() && leagueData) {
        await checkpointActiveLeagueSave({
          leagueData, selectedTeamName: selectedTeam?.name || "",
          source: "account_sign_out", savedRoute: window.location.pathname,
        });
      }
      await flushAllLeagueRuntimeWrites();
      await checkpointAccount(user.id);
      if (isCloudMode) try {
        notifyCloudSaveStatus("saving", "Final cloud backup…");
        await uploadCloudSave(user.id, { force: true });
        notifyCloudSaveStatus("saved", "Backed up before sign-out");
      } catch (cloudError) {
        notifyCloudSaveStatus("error", cloudError.message);
        if (!window.confirm(`Your cloud franchise is saved in the local cache, but the cloud upload FAILED: ${cloudError.message}\nSign out anyway?`)) {
          setWorking(false);
          return;
        }
      }
      const { error: authError } = await supabase.auth.signOut();
      if (authError) throw authError;
      // Hard reload resets all game module-level caches safely.
      window.location.assign("/game-modes");
    } catch (err) { setError(err?.message || "Couldn't sign out safely."); setWorking(false); }
  }
  return (
    <div className="bmAccountChip" aria-label="Basketball Manager account">
      <span className="bmAccountChipLabel" title={user.email || "Signed in"}>{user.email || "Player"}</span>
      {isCloudMode ? <span title={cloudStatus.detail || "Cloud backup status"} style={{color:cloudStatus.status === "error" ? "#ffb4a4" : "#a2d4b0"}}>
        {cloudStatus.status === "saving" ? "Syncing…" : cloudStatus.status === "saved" ? "Cloud saved" : cloudStatus.status === "error" ? "Cloud issue" : cloudStatus.status === "waiting" ? "Sync paused" : "Cloud checking"}
      </span> : <span style={{color:"#b0b0b0"}} title="Never uploaded to Supabase">Local only</span>}
      {isCloudMode && <button type="button" disabled={working} onClick={() => window.dispatchEvent(new Event("bm:cloud-save-request"))}>Sync now</button>}
      <button type="button" disabled={working} onClick={signOut}>{working ? "Saving…" : "Sign out"}</button>
      {error && <span className="bmAccountChipError" role="alert" title={error}>Save failed: {error}</span>}
    </div>
  );
}

