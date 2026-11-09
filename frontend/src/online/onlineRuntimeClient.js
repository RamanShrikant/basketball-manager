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

// Phase 2C.2A — only this operation-specific RPC can change a franchise roster.
export async function signOnlineCapRoomFreeAgent({lobbyId,requestId,expectedRevision,playerId,salary}) {
  if (!/^[0-9a-f-]{36}$/i.test(String(requestId))) throw new Error("Invalid signing request ID.");
  if (typeof playerId !== "string" || !playerId.trim() || playerId.length > 120) throw new Error("This free agent needs a stable player ID.");
  if (!Number.isSafeInteger(salary) || salary < 1200000 || salary > 57800000) throw new Error("One-year salary must be between $1.2M and $57.8M.");
  const {data,error} = await supabase.rpc("bm_online_sign_cap_room_free_agent", {
    p_lobby:assertLobbyId(lobbyId), p_request:requestId,
    p_expected_revision:positiveRevision(expectedRevision),
    p_player_id:playerId, p_first_year_salary:salary,
  });
  check(error);
  if (!data?.ok) throw new Error("Signing was not confirmed by the league server.");
  return data;
}

// Phase 2C.2B — atomic roster release; never mutate online state in a browser.
export async function releaseOnlineStandardPlayer({lobbyId,requestId,expectedRevision,playerId}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(requestId))) {
    throw new Error("Invalid release request ID.");
  }
  if (typeof playerId !== "string" || !playerId.trim() || playerId.length > 120) {
    throw new Error("This player needs a stable online player ID.");
  }
  const {data,error}=await supabase.rpc("bm_online_release_standard_player", {
    p_lobby:assertLobbyId(lobbyId),p_request:requestId,
    p_expected_revision:positiveRevision(expectedRevision),p_player_id:playerId,
  });
  check(error);
  if(!data?.ok) throw new Error("Release was not confirmed by the online server.");
  return data;
}

// Phase 2C.2C-A: server-owned 1–4 year standard cap-room contract, with
// final-year team/player option. The server constructs and validates all years.
export async function signOnlineCapRoomContract({lobbyId,requestId,expectedRevision,playerId,salary,years,optionType}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(requestId))) {
    throw new Error("Invalid Online contract request ID.");
  }
  if (typeof playerId !== "string" || !playerId.trim() || playerId.length > 120) {
    throw new Error("This player needs a stable Online player ID.");
  }
  if (!Number.isSafeInteger(salary) || salary < 1200000 || salary > 57800000) {
    throw new Error("Invalid first-year salary.");
  }
  if (!Number.isInteger(years) || years < 1 || years > 4 ||
    !["none", "team", "player"].includes(optionType) || (years === 1 && optionType !== "none")) {
    throw new Error("Invalid contract years or final-year option.");
  }
  const {data,error} = await supabase.rpc("bm_online_sign_cap_room_contract", {
    p_lobby:assertLobbyId(lobbyId),p_request:requestId,
    p_expected_revision:positiveRevision(expectedRevision),p_player_id:playerId,
    p_first_year_salary:salary,p_years:years,p_option_type:optionType,
  });
  check(error);
  if (!data?.ok) throw new Error("The Online server did not confirm this contract.");
  return data;
}

// Phase 2C.2D-2: online GM-to-GM standard-player trade offers.
// The browser submits IDs only. All asset resolution, locks and mutations are in SQL.
export async function listOnlineHumanTradeOffers(lobbyId) {
  const {data,error}=await supabase.from("bm_online_trade_offers")
    .select("id,lobby_id,proposer_id,recipient_id,proposer_team,recipient_team,proposer_player_ids,recipient_player_ids,proposer_player_labels,recipient_player_labels,proposer_pick_ids,recipient_pick_ids,proposer_pick_labels,recipient_pick_labels,status,created_at,resolved_at,resolved_revision")
    .eq("lobby_id",assertLobbyId(lobbyId)).order("created_at",{ascending:false}).limit(100);
  check(error);
  return data||[];
}

function tradeIds(ids) {
  if(!Array.isArray(ids)||ids.length<1||ids.length>4||new Set(ids).size!==ids.length ||
    ids.some(id=>typeof id!=="string"||!id.trim()||id.length>120)) {
    throw new Error("Select 1–4 players with unique stable IDs on each side.");
  }
  return ids;
}

export async function offerOnlineHumanTrade({lobbyId,requestId,expectedRevision,targetTeam,sendingIds,receivingIds}) {
  if(!/^[0-9a-f-]{36}$/i.test(String(requestId)))throw new Error("Invalid trade offer request ID.");
  if(typeof targetTeam!=="string"||!targetTeam.trim()||targetTeam.length>90)throw new Error("Select an eligible human GM team.");
  const {data,error}=await supabase.rpc("bm_online_offer_human_trade",{
    p_lobby:assertLobbyId(lobbyId),p_request:requestId,p_expected_revision:positiveRevision(expectedRevision),
    p_target_team:targetTeam,p_sending_ids:tradeIds(sendingIds),p_receiving_ids:tradeIds(receivingIds),
  });
  check(error);
  if(!data?.ok)throw new Error("Online trade offer was not confirmed.");
  return data;
}

export async function respondOnlineHumanTrade({lobbyId,offerId,requestId,expectedRevision,decision}) {
  if(!/^[0-9a-f-]{36}$/i.test(String(offerId))||!/^[0-9a-f-]{36}$/i.test(String(requestId))) {
    throw new Error("Invalid online trade response IDs.");
  }
  if(!["accept","decline","cancel"].includes(decision))throw new Error("Unsupported trade decision.");
  const {data,error}=await supabase.rpc("bm_online_respond_human_trade",{
    p_lobby:assertLobbyId(lobbyId),p_offer:offerId,p_request:requestId,
    p_expected_revision:positiveRevision(expectedRevision),p_decision:decision,
  });
  check(error);
  if(!data?.ok)throw new Error("Online trade response was not confirmed.");
  return data;
}

// Online draft-asset package offers: final ownership, Stepien, and status are
// checked against the locked server state at proposal AND acceptance time.
export async function offerOnlineHumanAssetTrade({lobbyId,requestId,expectedRevision,targetTeam,sendingIds,receivingIds,sendingPickIds=[],receivingPickIds=[]}) {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(requestId)))throw new Error('Invalid trade request ID.');
  if(typeof targetTeam!=="string"||!targetTeam.trim()||targetTeam.length>90)throw new Error('Select another human GM.');
  function pickIds(ids) {
    if(!Array.isArray(ids)||ids.length>3||new Set(ids).size!==ids.length ||
      ids.some(id=>typeof id!=="string"||!id.trim()||id.length>120)) {
      throw new Error('Select at most three unique eligible draft picks per team.');
    }
    const parsed=ids.map(id=>{
      const at=id.indexOf('~protect:');
      if(at<0)return id;
      if(at===0||!/^(?:[1-9]|1[0-9]|2[0-9])$/.test(id.slice(at+9)))return null;
      return id.slice(0,at);
    });
    if(parsed.some(x=>!x)||new Set(parsed).size!==ids.length) {
      throw new Error('The same draft right cannot be offered more than once, even with different protections.');
    }
    return ids;
  }
  const {data,error}=await supabase.rpc('bm_online_offer_human_asset_trade',{
    p_lobby:assertLobbyId(lobbyId),p_request:requestId,p_expected_revision:positiveRevision(expectedRevision),
    p_target_team:targetTeam,p_sending_ids:tradeIds(sendingIds),p_receiving_ids:tradeIds(receivingIds),
    p_sending_pick_ids:pickIds(sendingPickIds),p_receiving_pick_ids:pickIds(receivingPickIds),
  });
  check(error);
  if(!data?.ok)throw new Error('Online trade offer was not confirmed.');
  return data;
}

// Online Trade Center: realtime offer inbox updates. Does NOT transmit league
// snapshots or authorize trades; RLS scopes DB changes to current lobby members.
// An 8-second poll remains in the room as the offline/reconnect fallback.
export function subscribeOnlineTradeOffers(lobbyId, onChange, onStatus = () => {}) {
  const id = assertLobbyId(lobbyId);
  if (!supabase) return () => {};
  const channel = supabase.channel(`bm_online_trade_inbox_${id}_${crypto.randomUUID()}`)
    .on('postgres_changes', {
      event:'*',schema:'public',table:'bm_online_trade_offers',filter:`lobby_id=eq.${id}`,
    }, payload => onChange?.(payload))
    .subscribe(status => onStatus?.(status));
  return () => { void supabase.removeChannel(channel); };
}

// Phase 2D.2-B: team-owned, server-validated coaching rotation. No local league writes.
export async function saveOnlineCoachGameplan({lobbyId,requestId,expectedRevision,order,minutes}) {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(requestId)))
    throw new Error('Invalid gameplan request ID.');
  if(!Array.isArray(order)||order.length<5||order.length>30||
    new Set(order).size!==order.length||order.some(name=>typeof name!=='string'||!name.trim()||name.length>150) ||
    !minutes||typeof minutes!=='object'||Array.isArray(minutes)||
    Object.keys(minutes).length!==order.length||order.some(name=>!Object.hasOwn(minutes,name)))
    throw new Error('The rotation must include every player exactly once.');
  const total=order.reduce((sum,name,index)=>{
    const value=minutes[name];
    if(!Number.isInteger(value)||value<(index<5?1:0)||value>(index<5?48:47))
      throw new Error('Invalid starter or bench minutes.');
    return sum+value;
  },0);
  if(total!==240)throw new Error('Allocate exactly 240 minutes to save.');
  const {data,error}=await supabase.rpc('bm_online_save_coach_gameplan_phase2d2b',{
    p_lobby:assertLobbyId(lobbyId),p_request:requestId,p_expected_revision:positiveRevision(expectedRevision),
    p_order:order,p_minutes:minutes,
  });
  check(error);
  if(!data?.ok)throw new Error('Server did not confirm your gameplan.');
  return data;
}
