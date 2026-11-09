import React, { useState } from "react";
import { supabase } from "./supabaseClient.js";
import { activeBrowserAccountId, checkpointAccount } from "./accountLocalVault.js";
import { checkpointActiveLeagueSave, getActiveLeagueSaveId } from "../storage/leagueSaves.js";
import { flushAllLeagueRuntimeWrites } from "../storage/saveManager.js";
import { useGame } from "../context/GameContext.jsx";

export function AccountControls({ user }) {
  const { leagueData, selectedTeam } = useGame();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

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
      const { error: authError } = await supabase.auth.signOut();
      if (authError) throw authError;
      // Hard reload resets all game module-level caches safely.
      window.location.assign("/play");
    } catch (err) { setError(err?.message || "Couldn't sign out safely."); setWorking(false); }
  }
  return (
    <div className="bmAccountChip" aria-label="Basketball Manager account">
      <span className="bmAccountChipLabel" title={user.email || "Signed in"}>{user.email || "Player"}</span>
      <button type="button" disabled={working} onClick={signOut}>{working ? "Saving…" : "Sign out"}</button>
      {error && <span className="bmAccountChipError" role="alert" title={error}>Save failed: {error}</span>}
    </div>
  );
}

