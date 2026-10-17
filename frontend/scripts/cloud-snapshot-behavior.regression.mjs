// Isolated fake-Supabase behavior tests. Never touches users' real saves or cloud.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const code = readFileSync(path.resolve(here, "../src/auth/cloudSaveClient.js"), "utf8")
  // Installer writes Windows CRLF: normalize before removing ES imports for vm.Script.
  .replace(/\r\n?/g, "\n")
  .replace(/import \{ supabase \} from "\.\/supabaseClient\.js";\n/, "")
  .replace(/import \{[\s\S]*?\} from "\.\/accountLocalVault\.js";\n/, "")
  .replace(/^export /gm, "");
class MemoryStorage {
  values = new Map();
  getItem(k) { return this.values.get(k) ?? null; }
  setItem(k,v) { this.values.set(k,String(v)); }
}
const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const bucket = new Map();
let head = null;
let restored = null;
const localStorage = new MemoryStorage();
let snapshot = {
  version: 1, capturedAt: "2026-10-16", activeSaveId: "slotA",
  local: { selectedTeam: '"Celtics"' }, session: { bm_game: "record" },
  dbs: { basketball_manager_local_save_slots_v1: { stores: {
    leagueSaves: [{ saveId: "slotA", snapshot: { leagueData: { teams: [{ name: "Celtics" }] } } }]
  } } },
};
const service = {
  from() { return { select() { return { eq() { return { maybeSingle: async()=>({data:head,error:null}) }; } }; } }; },
  storage: { from() { return {
    async upload(key, data) {
      if (data.type !== "application/gzip") return {error:new Error("mime type application/octet-stream is not supported")};
      if (bucket.has(key)) return {error:new Error("duplicate")};
      bucket.set(key,data); return {error:null};
    },
    async download(key) { return bucket.has(key) ? {data:bucket.get(key),error:null} : {data:null,error:new Error("missing")}; },
    async list() { return {data:[],error:null}; },
    async remove() { return {error:null}; },
  }; } },
  async rpc(_fn, {p_expected_revision,p_snapshot_id,p_storage_path,p_size_bytes,p_content_sha256}) {
    if (Number(head?.revision||0) !== p_expected_revision) return {data:{ok:false,reason:"version_conflict"},error:null};
    head = {revision:p_expected_revision+1,snapshot_id:p_snapshot_id,storage_path:p_storage_path,
      size_bytes:p_size_bytes,content_sha256:p_content_sha256};
    return {data:{ok:true,revision:head.revision},error:null};
  },
};
const ctx = {
  supabase:service, localStorage, window:{dispatchEvent(){ }}, CustomEvent:class{},
  Blob, Response, TextEncoder, CompressionStream, DecompressionStream,
  crypto:webcrypto, Date, console,
  activeBrowserAccountId:()=>id,
  validateAccountId:x=>x,
  getAccountSaveMode:()=>"cloud",
  captureAccountCloudSnapshot:async()=>structuredClone(snapshot),
  restoreAccountCloudSnapshot:async(_id,value)=>{restored=value;},
};
vm.createContext(ctx);
vm.runInContext(code + '\nglobalThis.api={uploadCloudSave,getCloudHead,restoreCloudSave,cloudStartupDecision,readCloudMarker};',ctx);
const api=ctx.api;
assert.equal((await api.cloudStartupDecision(id)).mode,"ready");
const first=await api.uploadCloudSave(id);
assert.equal(first.head.revision,1);
assert.equal(bucket.size,1);
assert.match([...bucket.keys()][0], /\/slot-v2\//);
assert.equal(bucket.values().next().value.type,"application/gzip");
assert.equal((await api.cloudStartupDecision(id)).mode,"ready");
// Simulate sign-in on a clean second browser by clearing only local marker and snapshot.
localStorage.values.clear();
const original=structuredClone(snapshot);
snapshot={version:1, capturedAt:"2026-10-16",activeSaveId:"",local:{},session:{},dbs:{}};
assert.equal((await api.cloudStartupDecision(id)).mode,"restore");
await api.restoreCloudSave(id);
assert.equal(restored.activeSaveId,"slotA");
assert.equal(restored.dbs.basketball_manager_local_save_slots_v1.stores.leagueSaves.length,1);
// Device B changes its league, and commits revision 2.
snapshot=structuredClone(original);
snapshot.local.selectedTeam='"Lakers"';
const second=await api.uploadCloudSave(id);
assert.equal(second.head.revision,2);
// Stale device A can never overwrite the newer revision.
localStorage.values.clear();
snapshot=structuredClone(original);
await assert.rejects(()=>api.uploadCloudSave(id),/changed elsewhere/);
assert.equal(head.revision,2);
// Local mode is NEVER permitted to upload; no additional objects are stored.
ctx.getAccountSaveMode = ()=>"local";
await assert.rejects(()=>api.uploadCloudSave(id),/Local-only saves/);
assert.equal(head.revision,2);
console.log("PASS: cloud upload, private snapshot download, new-device restore, and stale-device conflict protection");
