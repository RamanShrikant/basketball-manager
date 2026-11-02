// Online-only franchise library. Does not load NBA snapshots or browser-local saves.
import { supabase } from "../auth/supabaseClient.js";
import { profilesFor } from "./onlineApi.js";

function check(error) {
  if (error) throw new Error(error.message || String(error));
}

export async function listOnlineFranchiseLibrary(userId) {
  if (!userId) throw new Error("Sign in to view your Online franchises.");
  // RLS returns only franchises accessible to the signed-in member.
  // Critically, do NOT SELECT seed_state here: it can be a multi-megabyte NBA snapshot.
  const franchises = await supabase.from("bm_online_franchises")
    .select("lobby_id,host_id,roster_kind,revision,created_at,updated_at")
    .order("created_at", { ascending:false }).limit(100);
  check(franchises.error);
  const candidates = franchises.data || [];
  if (!candidates.length) return [];
  const ids = candidates.map(f => f.lobby_id);
  const [lobbies, members, visibility] = await Promise.all([
    supabase.from("bm_online_lobbies").select("id,status").in("id",ids),
    supabase.from("bm_online_lobby_members")
      .select("lobby_id,user_id,team_name,joined_at").in("lobby_id",ids),
    supabase.from("bm_online_franchise_visibility")
      .select("lobby_id,hidden").eq("user_id",userId).in("lobby_id",ids),
  ]);
  check(lobbies.error);check(members.error);check(visibility.error);
  const statusById = new Map((lobbies.data || []).map(l => [l.id,l.status]));
  const membersById = new Map();
  for (const m of members.data || []) {
    if (!membersById.has(m.lobby_id)) membersById.set(m.lobby_id,[]);
    membersById.get(m.lobby_id).push(m);
  }
  const hiddenById = new Map((visibility.data || []).map(v => [v.lobby_id,v.hidden]));
  // Separate ownership from online/offline presence: these are permanent league members.
  const accessible = candidates.filter(f =>
    statusById.get(f.lobby_id)==="started" &&
    (membersById.get(f.lobby_id) || []).some(m => m.user_id===userId));
  const people = await profilesFor(accessible.flatMap(f =>
    (membersById.get(f.lobby_id) || []).map(m => m.user_id)));
  return accessible.map(f => ({
    ...f, hidden: hiddenById.get(f.lobby_id)===true,
    myTeam: (membersById.get(f.lobby_id) || []).find(m=>m.user_id===userId)?.team_name || "Unknown team",
    members: (membersById.get(f.lobby_id) || []).map(m => ({
      ...m,
      displayName: people[m.user_id]?.display_name || "Manager",
      playerTag: people[m.user_id]?.player_tag || "----",
    })),
  }));
}

export async function setOnlineFranchiseArchived(lobbyId, archived) {
  if (!lobbyId || typeof archived !== "boolean") throw new Error("Invalid archive request.");
  const result = await supabase.rpc("bm_set_online_franchise_hidden",{
    p_lobby:lobbyId,p_hidden:archived,
  });
  check(result.error);
  return result.data;
}
