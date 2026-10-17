/** Private, conflict-aware cloud backups for ONE isolated cloud-mode franchise.
 * Local-mode franchises never upload. Not used by Online multiplayer.
 */
import { supabase } from "./supabaseClient.js";
import {
  activeBrowserAccountId, validateAccountId, getAccountSaveMode,
  captureAccountCloudSnapshot, restoreAccountCloudSnapshot,
} from "./accountLocalVault.js";

const BUCKET = "bm-singleplayer-saves";
const HEAD_TABLE = "bm_cloud_slot_heads";
const MARKER_PREFIX = "bm_cloud_slot_sync_v2_";
const MAX_UNCOMPRESSED_BYTES = 100_000_000; // additional corrupt-payload safeguard
const MAX_COMPRESSED_BYTES = 49_000_000; // Supabase Free per-file ceiling is 50 MB
let uploadInFlight = null;

function requireAccount(id) {
  const userId = validateAccountId(id);
  if (activeBrowserAccountId() !== userId) throw new Error("Wrong active account. Cloud sync stopped; reload the page.");
  if (getAccountSaveMode(userId) !== "cloud") throw new Error("Local-only saves are never uploaded to cloud.");
  if (!supabase) throw new Error("Supabase authentication is unavailable.");
  return userId;
}

const markerKey = id => `${MARKER_PREFIX}${id}`;
export function readCloudMarker(userId) {
  try { return JSON.parse(localStorage.getItem(markerKey(userId)) || "null") || null; }
  catch { return null; }
}
function rememberCloud(userId, head, sha = "") {
  const state = {
    revision: Number(head?.revision || 0),
    snapshotId: head?.snapshot_id || null,
    sha: sha || head?.content_sha256 || "",
    at: Date.now(),
  };
  localStorage.setItem(markerKey(userId), JSON.stringify(state));
  return state;
}

export async function getCloudHead(userId) {
  requireAccount(userId);
  const { data, error } = await supabase.from(HEAD_TABLE)
    .select("revision,snapshot_id,storage_path,content_sha256,size_bytes,updated_at")
    .eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`Cloud backup unavailable: ${error.message}. Configure the cloud-save SQL first.`);
  return data || null;
}

export async function cloudStartupDecision(userId) {
  requireAccount(userId);
  let remote;
  try { remote = await getCloudHead(userId); }
  catch (error) { return { mode: "unavailable", error: error.message }; }
  if (!remote) return { mode: "ready", remote: null };

  const snapshot = await captureAccountCloudSnapshot(userId);
  const hasLocalData = Object.keys(snapshot.local || {}).length > 0 ||
    Object.values(snapshot.dbs || {}).some(db => Object.values(db?.stores || {}).some(rows => rows?.length));
  if (!hasLocalData) return { mode: "restore", remote };
  const marker = readCloudMarker(userId);
  if (marker?.snapshotId === remote.snapshot_id && Number(marker.revision) === Number(remote.revision)) {
    return { mode: "ready", remote };
  }
  return { mode: "choice", remote };
}

function safeCloudDocument(doc, userId) {
  if (!doc || doc.format !== "bm-singleplayer-cloud-slot-v2" || doc.userId !== userId || doc.snapshot?.version !== 1) {
    throw new Error("Cloud save format is invalid or belongs to a different account.");
  }
  for (const [name, db] of Object.entries(doc.snapshot.dbs || {})) {
    if (!name.startsWith("basketball_manager_") || !db || typeof db.stores !== "object") {
      throw new Error("Unrecognized database content in cloud save.");
    }
    for (const rows of Object.values(db.stores)) if (!Array.isArray(rows)) throw new Error("Invalid cloud save storage rows.");
  }
  if (!doc.snapshot.local || typeof doc.snapshot.local !== "object" ||
      !doc.snapshot.session || typeof doc.snapshot.session !== "object") {
    throw new Error("Cloud save is missing local storage information.");
  }
  const slots = doc.snapshot.dbs?.basketball_manager_local_save_slots_v1?.stores?.leagueSaves || [];
  if (slots.length > 1 || slots.some(slot => Number(slot.slotIndex ?? 0) !== 0)) {
    throw new Error("Cloud slot contains incompatible save-slot data. Local saves were not changed.");
  }
  return doc.snapshot;
}

async function decodeBackup(blob) {
  if (blob.size > MAX_COMPRESSED_BYTES) throw new Error("Cloud save file exceeds the supported size.");
  if (typeof DecompressionStream !== "function") throw new Error("This browser does not support gzip restoration.");
  const text = await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text();
  if (new TextEncoder().encode(text).byteLength > MAX_UNCOMPRESSED_BYTES) throw new Error("Uncompressed cloud save is too large.");
  return JSON.parse(text);
}

export async function restoreCloudSave(userId, cloudHead = null) {
  requireAccount(userId);
  const head = cloudHead || await getCloudHead(userId);
  if (!head?.storage_path) throw new Error("No cloud backup has been uploaded.");
  if (!head.storage_path.startsWith(`${userId}/`)) throw new Error("Cloud backup path is not owned by this account.");
  const { data, error } = await supabase.storage.from(BUCKET).download(head.storage_path);
  if (error) throw new Error(`Cloud download failed: ${error.message}`);
  const doc = await decodeBackup(data);
  const snapshot = safeCloudDocument(doc, userId);
  const stable = JSON.stringify({ ...doc, snapshot: { ...snapshot, capturedAt: null } });
  if (head.content_sha256 && await sha256(stable) !== head.content_sha256) {
    throw new Error("Cloud backup checksum mismatch. Local saves were not changed.");
  }
  // Never clear old local content without capturing a local rollback copy first.
  await restoreAccountCloudSnapshot(userId, snapshot);
  rememberCloud(userId, head);
  return head;
}

async function sha256(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, "0")).join("");
}

async function encodeSnapshot(userId, snapshot) {
  if (typeof CompressionStream !== "function") throw new Error("Cloud backup requires a recent Chrome or Edge browser.");
  const document = { format: "bm-singleplayer-cloud-slot-v2", userId, snapshot };
  let json;
  try { json = JSON.stringify(document, (_, value) => {
    if (typeof value === "bigint" || typeof value === "function") throw new Error("Unsupported data type in save.");
    if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      throw new Error("Unsupported binary record in save. Cloud upload stopped safely.");
    }
    return value;
  }); } catch (error) { throw new Error(`Could not serialize cloud save: ${error.message}`); }
  if (new TextEncoder().encode(json).byteLength > MAX_UNCOMPRESSED_BYTES) throw new Error("Single-player save exceeds the safe export limit.");
  const stable = JSON.stringify({ ...document, snapshot: { ...snapshot, capturedAt: null } });
  const sha = await sha256(stable);
  const compressed = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
  // Supabase Storage checks the actual uploaded Blob MIME type, not just upload options.
  const gzipBlob = new Blob([compressed], { type: "application/gzip" });
  if (gzipBlob.size > MAX_COMPRESSED_BYTES) throw new Error("Compressed save exceeds the Supabase Free 50 MB limit.");
  return { data: gzipBlob, sha };
}

async function cleanupOldBackups(userId, activePath) {
  // Best effort. Never delete the current backup or anything uploaded recently.
  const { data, error } = await supabase.storage.from(BUCKET).list(`${userId}/slot-v2`, {
    limit: 100, sortBy: { column: "name", order: "desc" },
  });
  if (error || !Array.isArray(data)) return;
  const sorted = data.filter(x => /\.json\.gz$/.test(x.name)).sort((a,b)=>b.name.localeCompare(a.name));
  const keep = new Set([activePath.split("/").pop(), ...sorted.slice(0, 5).map(x=>x.name)]);
  const old = sorted.filter(x=>!keep.has(x.name) && Date.now()-Date.parse(x.created_at || 0) > 24*3600*1000).slice(0, 30);
  if (old.length) await supabase.storage.from(BUCKET).remove(old.map(x => `${userId}/slot-v2/${x.name}`));
}

async function doCloudUpload(userId, { force = false, expectedRevision = null, replaceRemote = false } = {}) {
  requireAccount(userId);
  const head = await getCloudHead(userId);
  const marker = readCloudMarker(userId);
  if (replaceRemote && expectedRevision === null) throw new Error("Cloud replacement requires a confirmed revision.");
  if (expectedRevision !== null && Number(head?.revision || 0) !== Number(expectedRevision)) {
    throw new Error("Cloud save changed on another device. Reopen the game to choose which copy to keep.");
  }
  if (head && !replaceRemote && (!marker || marker.snapshotId !== head.snapshot_id || Number(marker.revision) !== Number(head.revision))) {
    throw new Error("Cloud save changed elsewhere. No data was overwritten. Reload and choose a copy.");
  }
  const snapshot = await captureAccountCloudSnapshot(userId);
  const slots = snapshot.dbs?.basketball_manager_local_save_slots_v1?.stores?.leagueSaves || [];
  if (slots.length > 1 || slots.some(slot => Number(slot.slotIndex ?? 0) !== 0)) {
    throw new Error("Cloud mode supports one franchise slot. Existing saves were not overwritten.");
  }
  const { data, sha } = await encodeSnapshot(userId, snapshot);
  if (!force && marker?.sha === sha && head?.snapshot_id === marker?.snapshotId) return { skipped: true, head };
  const snapshotId = crypto.randomUUID();
  const path = `${userId}/slot-v2/${String(Date.now()).padStart(13, "0")}_${snapshotId}.json.gz`;
  const { error: uploadError } = await supabase.storage.from(BUCKET)
    .upload(path, data, { contentType: "application/gzip", upsert: false, cacheControl: "0" });
  if (uploadError) throw new Error(`Cloud upload failed: ${uploadError.message}`);
  const { data: result, error: commitError } = await supabase.rpc("bm_commit_cloud_slot_snapshot", {
    p_expected_revision: Number(head?.revision || 0),
    p_snapshot_id: snapshotId,
    p_storage_path: path,
    p_size_bytes: data.size,
    p_content_sha256: sha,
  });
  if (commitError) throw new Error(`Cloud commit failed: ${commitError.message}. Original cloud save remains unchanged.`);
  if (!result?.ok) throw new Error("Another device saved first. Original cloud save remains safe. Reload to resolve the conflict.");
  const newHead = { revision: result.revision, snapshot_id: snapshotId, storage_path: path, content_sha256: sha };
  rememberCloud(userId, newHead, sha);
  cleanupOldBackups(userId, path).catch(error => console.warn("[BM cloud cleanup]", error));
  return { skipped: false, head: newHead };
}

export function uploadCloudSave(userId, options = {}) {
  if (uploadInFlight) return options.force
    ? uploadInFlight.catch(() => {}).then(() => uploadCloudSave(userId, options))
    : uploadInFlight;
  uploadInFlight = doCloudUpload(userId, options).finally(() => { uploadInFlight = null; });
  return uploadInFlight;
}

export function notifyCloudSaveStatus(status, detail = "") {
  try {
    window.__bmCloudSaveStatus = { status, detail };
    window.dispatchEvent(new CustomEvent("bm:cloud-save-status", { detail: { status, detail } }));
  } catch {}
}
