import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { activeBrowserAccountId, checkpointAccount, getAccountSaveMode } from "./accountLocalVault.js";
import { checkpointActiveLeagueSave, getActiveLeagueSaveId } from "../storage/leagueSaves.js";
import { flushAllLeagueRuntimeWrites } from "../storage/saveManager.js";
import { notifyCloudSaveStatus, uploadCloudSave } from "./cloudSaveClient.js";
import { useGame } from "../context/GameContext.jsx";

// Only mounted on /game-modes. Never floats above single-player gameplay.
// Use the existing, safety-checked sign-out pathway, including a final cloud
// checkpoint when the active single-player storage location is Cloud.
export function AccountControls({ user }) {
  const { leagueData, selectedTeam } = useGame();
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [onlineProfile, setOnlineProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [nickname, setNickname] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setProfileLoading(true);
    setError("");
    supabase.from("bm_online_profiles")
      .select("display_name,player_tag")
      .eq("user_id", user.id).maybeSingle()
      .then(({ data, error: readError }) => {
        if (!active) return;
        if (readError) throw readError;
        setOnlineProfile(data || null);
        setNickname(data?.display_name || "");
      })
      .catch(err => { if (active) setError(`Profile unavailable: ${err.message}`); })
      .finally(() => { if (active) setProfileLoading(false); });
    return () => { active = false; };
  }, [open, user.id]);

  async function renameProfile(event) {
    event.preventDefault();
    if (working || !onlineProfile) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const { data, error: renameError } = await supabase.rpc("bm_online_profile", { p_name: nickname.trim() });
      if (renameError) throw renameError;
      setOnlineProfile(data);
      setNickname(data.display_name);
      setNotice("Display name updated. Your four-digit ID is unchanged.");
    } catch (err) { setError(err.message || "Could not update your display name."); }
    finally { setWorking(false); }
  }

  async function signOut() {
    if (working || !window.confirm("Sign out of Basketball Manager? Your local franchises will remain on this device.")) return;
    setWorking(true); setError(""); setNotice("");
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
      if (getAccountSaveMode(user.id) === "cloud") {
        try {
          notifyCloudSaveStatus("saving", "Final cloud backup…");
          await uploadCloudSave(user.id, { force: true });
          notifyCloudSaveStatus("saved", "Backed up before sign-out");
        } catch (cloudError) {
          notifyCloudSaveStatus("error", cloudError.message);
          if (!window.confirm(`Your cloud franchise is saved in the local cache, but its cloud backup FAILED: ${cloudError.message}\nSign out anyway?`)) return;
        }
      }
      const { error: authError } = await supabase.auth.signOut();
      if (authError) throw authError;
      window.location.assign("/game-modes");
    } catch (err) { setError(err.message || "Couldn't sign out safely."); }
    finally { setWorking(false); }
  }

  const darkButton = "rounded-lg border border-white/15 bg-[#151515] px-3 py-2 text-xs font-bold text-white/75 transition hover:border-orange-500/40 hover:text-white disabled:opacity-50";
  return <div className="relative z-[250]" aria-label="Account menu">
    <button type="button" className={darkButton} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      Account & Profile
    </button>
    {open && <section role="dialog" aria-label="Account and player profile" className="absolute right-0 top-full mt-2 w-[min(88vw,360px)] rounded-xl border border-white/15 bg-[#101010] p-4 text-white shadow-[0_18px_55px_#000b]">
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-black">Account & Profile</h2><button type="button" aria-label="Close profile menu" className="text-lg text-white/60 hover:text-white" onClick={() => setOpen(false)}>×</button></div>
      <p className="mt-2 break-all text-xs text-white/45">{user.email}</p>
      <div className="mt-4 rounded-lg border border-white/10 bg-[#080808] p-3">
        {profileLoading ? <p className="text-xs text-white/55">Loading player identity…</p> : onlineProfile ? <>
          <p className="text-[10px] font-black uppercase tracking-widest text-orange-300">Online player identity</p>
          <p className="mt-1 text-lg font-extrabold">{onlineProfile.display_name}<span className="text-orange-300">#{onlineProfile.player_tag}</span></p>
          <p className="mt-1 text-xs text-white/45">Your four-digit ID stays the same when you rename yourself.</p>
          <form className="mt-3 flex gap-2" onSubmit={renameProfile}>
            <input aria-label="Display name" className="min-w-0 flex-1 rounded-md border border-white/15 bg-[#171717] px-2 py-2 text-xs text-white" value={nickname} maxLength={24} minLength={2} required onChange={event => setNickname(event.target.value)}/>
            <button type="submit" className={darkButton} disabled={working}>Update</button>
          </form>
        </> : <><p className="text-xs text-white/60">You haven't set up your Online player identity yet.</p><a href="/online" className="mt-3 inline-block text-xs font-bold text-orange-200 hover:text-orange-100">Create Online profile →</a></>}
      </div>
      {notice && <p className="mt-3 text-xs text-green-300" role="status">{notice}</p>}
      {error && <p className="mt-3 text-xs text-red-300" role="alert">{error}</p>}
      <button type="button" className={`${darkButton} mt-4 w-full`} disabled={working} onClick={signOut}>{working ? "Saving…" : "Sign out"}</button>
    </section>}
  </div>;
}
