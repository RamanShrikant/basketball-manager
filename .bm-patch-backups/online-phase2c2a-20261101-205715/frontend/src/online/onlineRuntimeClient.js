// Online-only, server-controlled runtime state. No single-player game imports.
// All accepted league mutations will be operation-specific backend RPCs in Phase 2C.2.
import {supabase} from "../auth/supabaseClient.js";

function assertLobbyId(lobbyId) {
  if (typeof lobbyId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(lobbyId)) {
    throw new Error("Invalid Online franchise identifier.");
  }
  return lobbyId;
}
function check(error) {if(error) throw new Error(error.message || "Online request failed.");}
function positiveRevision(value) {
  const text = String(value ?? "");
  if (!/^[1-9][0-9]*$/.test(text)) throw new Error("Invalid shared franchise revision.");
  return text;
}

export async function initializeOnlineRuntime(lobbyId) {
  const {data,error} = await supabase.rpc("bm_init_online_franchise_runtime", {p_lobby:assertLobbyId(lobbyId)});
  check(error);
  return positiveRevision(data);
}

export async function readOnlineRuntime(lobbyId) {
  const {data,error} = await supabase.from("bm_online_franchise_runtime")
    .select("state,revision,updated_at")
    .eq("lobby_id",assertLobbyId(lobbyId)).maybeSingle();
  check(error);
  if (!data || !data.state || typeof data.state !== "object" || Array.isArray(data.state)) {
    throw new Error("The shared franchise runtime is unavailable to this account.");
  }
  return {state:data.state, revision:positiveRevision(data.revision), updated_at:data.updated_at};
}

// Lightweight revision check: avoid transferring the full roster every polling cycle.
export async function readOnlineRuntimeRevision(lobbyId) {
  const {data,error} = await supabase.from("bm_online_franchise_runtime")
    .select("revision,updated_at")
    .eq("lobby_id",assertLobbyId(lobbyId)).maybeSingle();
  check(error);
  if (!data) throw new Error("The shared franchise runtime is unavailable to this account.");
  return {revision:positiveRevision(data.revision), updated_at:data.updated_at};
}

export function isNewerRevision(candidate, current) {
  return BigInt(positiveRevision(candidate)) > BigInt(positiveRevision(current));
}
