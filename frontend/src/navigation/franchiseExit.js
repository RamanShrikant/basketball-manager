// Single-player save/exit safety boundary. Import this only from the authenticated
// single-player app: Online must never import or snapshot browser game storage.
import {
  checkpointActiveLeagueSave,
  createLeagueSave,
  getActiveLeagueSaveId,
  getLeagueSave,
  listLeagueSaves,
  MAX_LEAGUE_SAVE_SLOTS,
  flushLeagueSaveSlotWrites,
} from "../storage/leagueSaves.js";
import { findFirstAvailableLeagueSaveSlot } from "../storage/leagueSaveSlots.js";
import { captureActiveLeagueRuntime, flushAllLeagueRuntimeWrites } from "../storage/saveManager.js";
import { activeBrowserAccountId, getAccountSaveMode } from "../auth/accountLocalVault.js";
import { notifyCloudSaveStatus, uploadCloudSave } from "../auth/cloudSaveClient.js";

export function assertFranchiseSimulationPaused() {
  for (const key of ["bm_pending_calendar_sim_v1", "bm_pending_postseason_sim_v1"]) {
    let intent;
    try { intent = JSON.parse(localStorage.getItem(key) || "null"); }
    catch { throw new Error("A pending simulation marker is invalid. Resolve it before saving or exiting."); }
    if (intent && !intent.pausedReason) {
      throw new Error("Finish or safely pause the current simulation before saving and exiting.");
    }
  }
}

function requireLeagueTeams(leagueData) {
  const teams = Array.isArray(leagueData?.teams)
    ? leagueData.teams
    : leagueData?.conferences && typeof leagueData.conferences === "object"
      ? Object.values(leagueData.conferences).flat()
      : [];
  if (!teams.length) throw new Error("No loaded franchise is available to save. Return to save slots to open a league.");
}

export async function saveFranchiseForExit({ leagueData, selectedTeamName = "", savedRoute = "/team-hub", onStage = () => {} }) {
  assertFranchiseSimulationPaused();
  const id = getActiveLeagueSaveId();
  const hasLiveLeague = Boolean((Array.isArray(leagueData?.teams) && leagueData.teams.length) ||
    (leagueData?.conferences && Object.values(leagueData.conferences).flat().length));
  // An empty launcher state is always allowed to return to the save menu.
  if (!id) return hasLiveLeague
    ? { status: "unlinked", reason: "No active save slot is linked to this franchise." }
    : { status: "empty" };
  // Never create a phantom save by updating a missing record.
  const record = await getLeagueSave(id);
  if (!record?.snapshot?.leagueData) {
    return hasLiveLeague
      ? { status: "unlinked", reason: "The active save slot was not found. Your live league has not been overwritten." }
      : { status: "empty" };
  }
  const liveIdentity = String(leagueData?.__leagueStorageId || "").trim();
  const savedIdentity = String(record.snapshot.leagueData?.__leagueStorageId || "").trim();
  if (liveIdentity && savedIdentity && liveIdentity !== savedIdentity) {
    return { status: "unlinked", reason: "The active save ID points to a DIFFERENT league. Nothing was overwritten. Recover into a new empty slot." };
  }
  // If GameContext did not hydrate, there is no live state to checkpoint.
  // The previous saved record remains available, so exiting cannot strand user.
  if (!hasLiveLeague) return { status: "saved", saved: record, usedExistingSnapshot: true };
  onStage("local");
  await flushAllLeagueRuntimeWrites();
  const saved = await checkpointActiveLeagueSave({ leagueData, selectedTeamName, source: "navigation.saveAndExit", savedRoute });
  if (!saved || saved.saveId !== id) throw new Error("Local save verification failed. You are still in your franchise.");
  await flushLeagueSaveSlotWrites();
  const verified = await getLeagueSave(id);
  if (!verified?.snapshot?.leagueData || verified.updatedAt !== saved.updatedAt) {
    throw new Error("The local save could not be verified. Stay in-game and retry.");
  }
  const accountId = activeBrowserAccountId();
  if (accountId && getAccountSaveMode(accountId) === "cloud") {
    onStage("cloud");
    notifyCloudSaveStatus("saving", "Backing up franchise before exit…");
    try {
      await uploadCloudSave(accountId, { force: true });
      notifyCloudSaveStatus("saved", "Cloud saved before exit");
    } catch (error) {
      const message = error?.message || String(error);
      notifyCloudSaveStatus("error", message);
      return { status: "cloud-failed", saved: verified, reason: message };
    }
  }
  return { status: "saved", saved: verified };
}

export async function recoverUnlinkedFranchise({ leagueData, selectedTeamName = "", savedRoute = "/team-hub", onStage = () => {} }) {
  requireLeagueTeams(leagueData);
  assertFranchiseSimulationPaused();
  onStage("local");
  await flushAllLeagueRuntimeWrites();
  const accountId = activeBrowserAccountId();
  const isCloud = Boolean(accountId && getAccountSaveMode(accountId) === "cloud");
  const slots = await listLeagueSaves();
  const firstFree = findFirstAvailableLeagueSaveSlot(slots, isCloud ? 1 : MAX_LEAGUE_SAVE_SLOTS);
  if (firstFree == null) {
    throw new Error("All save slots are occupied. Nothing was overwritten. Export an emergency backup and return to save slots to manage them.");
  }
  // No existing save is ever modified by this operation. Require a free slot.
  const name = `Recovered Franchise ${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const record = await createLeagueSave({ leagueName: name, leagueData, selectedTeamName, slotIndex: firstFree, activate: true, source: "navigation_recovery" });
  // Newly created recoveries default to Team Hub on the next resume.
  // Commit a final savedRoute now, then verify as for ordinary exits.
  const result = await saveFranchiseForExit({ leagueData, selectedTeamName, savedRoute, onStage });
  if (result.status === "unlinked") throw new Error("Recovery record could not be re-opened. Do not exit yet.");
  return { ...result, recoveredSaveId: record.saveId };
}

// Portable disaster-recovery export, including IndexedDB/sidecar state.
// The automatic Play import feature is not yet available: this is a safety
// artifact, not a claim that a one-click import exists.
export async function exportEmergencyFranchise({ leagueData, selectedTeamName = "" }) {
  requireLeagueTeams(leagueData);
  await flushAllLeagueRuntimeWrites();
  const captured = await captureActiveLeagueRuntime({ leagueData });
  const payload = {
    format: "bm_emergency_franchise_snapshot_v1",
    exportedAt: new Date().toISOString(),
    activeSaveId: getActiveLeagueSaveId() || null,
    saveMode: getAccountSaveMode(activeBrowserAccountId()) || "local",
    selectedTeamName,
    snapshot: { leagueData: captured.leagueData, runtime: captured.runtime },
    note: "Emergency backup with game runtime. Keep this file safe; automatic import is not implemented.",
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `BM-emergency-franchise-${Date.now()}.json`;
  document.body.appendChild(a);
  try { a.click(); } finally { a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
  return payload;
}

export function exitToLeagueSlots() {
  // Call ONLY after a successful local checkpoint or an explicitly acknowledged
  // emergency-export recovery exit. A hard replace prevents router cache reuse.
  window.location.replace("/play");
}
