// Read-only shared NBA league access. Never imports game simulation, GameContext or browser saves.
import { supabase } from "../auth/supabaseClient.js";
import { extractTeams } from "./onlineApi.js";
import { validateOnlineStartingSeed } from "./onlineSeedIntegrity.mjs";

const fail = error => { if (error) throw new Error(error.message || String(error)); };

export function teamsInSnapshot(snapshot) {
  if (Array.isArray(snapshot?.teams)) return snapshot.teams;
  return [...(snapshot?.conferences?.East || []), ...(snapshot?.conferences?.West || [])];
}

export function validateSeed(snapshot, expectedNames) {
  const names = extractTeams(snapshot);
  const expected = [...(expectedNames || [])];
  if (names.length !== expected.length ||
      names.slice().sort().join("\u0000") !== expected.sort().join("\u0000")) {
    throw new Error("The starting roster does not match this lobby. Close and recreate the lobby with the correct roster.");
  }
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
  if (bytes > 12_000_000) throw new Error("The franchise seed is too large (12 MB maximum).");
  return snapshot;
}

export async function loadHostSeed(lobby) {
  if (!lobby || !lobby.team_names) throw new Error("Lobby not loaded yet.");
  let snapshot;
  if (lobby.roster_kind === "default") {
    const response = await fetch("/defaults/default_roster.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to load bundled NBA starting rosters.");
    snapshot = await response.json();
  } else if (lobby.roster_kind === "custom" && lobby.roster_path) {
    const { data, error } = await supabase.storage.from("bm-online-rosters").download(lobby.roster_path);
    fail(error);
    snapshot = JSON.parse(await data.text());
  } else throw new Error("Lobby roster configuration is incomplete.");
  return validateSeed(snapshot, lobby.team_names);
}

export async function launchSharedFranchise(lobby) {
  // Never trust a storage upload or a waiting lobby as playable.
  // The launch RPC has a separate authoritative database constraint.
  const seed = validateOnlineStartingSeed(await loadHostSeed(lobby));
  const { data, error } = await supabase.rpc("bm_launch_online_franchise", {
    p_lobby: lobby.id, p_seed: seed,
  });
  fail(error);
  return data;
}

export async function franchiseForLobby(lobbyId) {
  const { data, error } = await supabase.from("bm_online_franchises")
    .select("lobby_id,host_id,roster_kind,seed_state,revision,schema_version,created_at")
    .eq("lobby_id",lobbyId).maybeSingle();
  fail(error);
  return data;
}

export async function newestSharedFranchise() {
  const { data, error } = await supabase.from("bm_online_franchises")
    .select("lobby_id,created_at")
    .order("created_at",{ascending:false}).limit(1).maybeSingle();
  fail(error);
  return data;
}
