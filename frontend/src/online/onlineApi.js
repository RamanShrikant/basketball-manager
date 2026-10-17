// Online-only Supabase data access. Never imports GameContext, IndexedDB or single-player saves.
import { supabase } from "../auth/supabaseClient.js";

export const ONLINE_BUCKET = "bm-online-rosters";
const err = (error) => { if (error) throw new Error(error.message || String(error)); };
export async function rpc(name, params = {}) {
  const { data, error } = await supabase.rpc(name, params);
  err(error);
  return data;
}
export async function profile(name = null) { return rpc("bm_online_profile", { p_name: name }); }
export async function profilesFor(ids) {
  const filtered = [...new Set(ids.filter(Boolean))];
  if (!filtered.length) return {};
  const { data, error } = await supabase.from("bm_online_profiles").select("user_id,display_name,player_tag").in("user_id", filtered);
  err(error);
  return Object.fromEntries((data || []).map(row => [row.user_id, row]));
}
export async function friendships(me) {
  const [friends, requests] = await Promise.all([
    supabase.from("bm_online_friends").select("user_low,user_high").or(`user_low.eq.${me},user_high.eq.${me}`),
    supabase.from("bm_online_friend_requests").select("id,sender_id,recipient_id,status,created_at").or(`sender_id.eq.${me},recipient_id.eq.${me}`).eq("status","pending")
  ]);
  err(friends.error); err(requests.error);
  const ids = [...(friends.data || []).map(row => row.user_low === me ? row.user_high : row.user_low),
    ...(requests.data || []).flatMap(r => [r.sender_id,r.recipient_id])];
  return { friends: (friends.data || []).map(row => row.user_low === me ? row.user_high : row.user_low),
    requests: requests.data || [], people: await profilesFor(ids) };
}
export async function inbox(userId) {
  const result = await supabase.from("bm_online_lobby_invites")
    .select("id,lobby_id,sender_id,recipient_id,status,message,created_at")
    .eq("recipient_id",userId).eq("status","pending").order("created_at",{ascending:false});
  err(result.error);
  return { invites: result.data || [], people: await profilesFor((result.data || []).map(x => x.sender_id)) };
}
export async function lobbyState(lobbyId) {
  const [lobby, members, invites] = await Promise.all([
    supabase.from("bm_online_lobbies").select("id,host_id,join_code,status,roster_kind,roster_path,team_names,created_at").eq("id",lobbyId).maybeSingle(),
    supabase.from("bm_online_lobby_members").select("lobby_id,user_id,team_name,ready,joined_at").eq("lobby_id",lobbyId).order("joined_at",{ascending:true}),
    supabase.from("bm_online_lobby_invites").select("id,lobby_id,recipient_id,status,message").eq("lobby_id",lobbyId).eq("status","pending")
  ]);
  err(lobby.error);err(members.error);err(invites.error);
  return { lobby: lobby.data, members: members.data || [], invites: invites.data || [],
    people: await profilesFor([lobby.data?.host_id,...(members.data || []).map(m=>m.user_id),...(invites.data || []).map(i=>i.recipient_id)]) };
}
export function watchTables(tables, onChange) {
  // Supabase Postgres Changes is supported by a safe timer refresh fallback in the pages.
  const channel = supabase.channel(`bm-online-${crypto.randomUUID()}`);
  for (const table of tables) channel.on("postgres_changes", {event:"*",schema:"public",table}, onChange);
  channel.subscribe();
  return () => { supabase.removeChannel(channel); };
}
export function extractTeams(json) {
  const source = Array.isArray(json?.teams) ? json.teams : [
    ...(json?.conferences?.East || []), ...(json?.conferences?.West || [])
  ];
  const names = source.map(t => typeof t?.name === "string" ? t.name.trim() : "");
  if (names.length < 2 || names.length > 64 || names.some(n=> n.length<2 || n.length>80) || new Set(names).size!==names.length) {
    throw new Error("Roster JSON must contain 2–64 unique teams with valid names (teams or conferences). ");
  }
  return names;
}
export async function defaultTeams() {
  const res = await fetch("/defaults/default_roster.json", { cache:"no-cache" });
  if(!res.ok) throw new Error("Could not read the bundled NBA roster.");
  return extractTeams(await res.json());
}
export async function uploadCustomRoster(file, userId) {
  if (!file || file.size > 10_000_000) throw new Error("Roster JSON must be under 10 MB.");
  const text = await file.text();
  let roster;
  try { roster = JSON.parse(text); } catch { throw new Error("The selected file isn't valid JSON."); }
  const teams = extractTeams(roster);
  const path = `${userId}/${crypto.randomUUID()}.json`;
  const { error } = await supabase.storage.from(ONLINE_BUCKET).upload(path,
    new Blob([text],{type:"application/json"}), { contentType:"application/json",upsert:false });
  err(error);
  return {teams, path};
}
