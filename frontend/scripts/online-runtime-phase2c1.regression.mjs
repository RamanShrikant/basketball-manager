import assert from "node:assert/strict";
import {readFileSync, existsSync} from "node:fs";
import {resolve} from "node:path";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "../..");
const read = path => readFileSync(resolve(root,path), "utf8");
const sql = read("supabase/bm_online_runtime_phase2c1.sql");
const runtime = read("frontend/src/online/onlineRuntimeClient.js");
const franchise = read("frontend/src/online/OnlineFranchise.jsx");
const panel = read("frontend/src/online/OnlineGmPanel.jsx");
const css = read("frontend/src/online/online.css");
assert.match(sql,/create table if not exists public\.bm_online_franchise_runtime/i);
assert.match(sql,/create table if not exists public\.bm_online_franchise_events/i);
assert.match(sql,/for update of f/i);
assert.match(sql,/on conflict \(lobby_id\) do nothing/i);
assert.match(sql,/m\.user_id = v_user/i);
assert.match(sql,/l\.status = 'started'/i);
assert.match(sql,/enable row level security/i);
assert.match(sql,/revoke all on public\.bm_online_franchise_runtime from public, anon, authenticated/i);
assert.match(sql,/revoke all on public\.bm_online_franchise_events from public, anon, authenticated/i);
assert.doesNotMatch(sql,/grant\s+(?:insert|update|delete|all)\s+on\s+public\.bm_online_franchise_(?:runtime|events)\s+to\s+authenticated/i);
assert.match(franchise,/initializeOnlineRuntime\(id\)/);
assert.match(franchise,/readOnlineRuntimeRevision\(id\)/);
assert.match(franchise,/readOnlineRuntime\(id\)/);
assert.doesNotMatch(franchise,/franchiseForLobby\(id\)/);
assert.match(panel,/Refresh shared state/);
assert.match(css,/PHASE 2C1 ONLINE RUNTIME/);
assert(existsSync(resolve(root,"frontend/src/online/OnlineSeasonSchedule.jsx")),"Phase 2B.5 required");
for(const path of ["frontend/src/online/onlineRuntimeClient.js","frontend/src/online/OnlineFranchise.jsx","frontend/src/online/OnlineGmPanel.jsx"]){
  const code = read(path);
  assert.doesNotMatch(code,/\b(?:localStorage|sessionStorage|indexedDB)\s*\./);
  assert.doesNotMatch(code,/from\s+["']\.\.\/context\/GameContext/);
}

// Behavioral test: run actual runtime client functions against in-memory Supabase contract.
const id = "37db6f57-c5a7-4873-8ce1-5b219a81d6b1";
let revision = "1", state={teams:[{name:"Boston Celtics",players:[]}]};
let calls = {rpc:0,full:0,meta:0};
const mock = {
  rpc:async(name,args)=>{
    calls.rpc++;
    assert.equal(name,"bm_init_online_franchise_runtime");
    assert.equal(args.p_lobby,id);
    return {data:revision,error:null};
  },
  from:table=>{
    assert.equal(table,"bm_online_franchise_runtime");
    return {select:columns=>({eq:(key,value)=>{
      assert.equal(key,"lobby_id");assert.equal(value,id);
      if(columns.includes("state")) calls.full++; else calls.meta++;
      return {maybeSingle:async()=>({data:columns.includes("state")?{state,revision,updated_at:"2026-11-01"}:{revision,updated_at:"2026-11-01"},error:null})};
    }})};
  }
};
const transformed = runtime.replace(/^import\s+\{supabase\}.*$/m,"")
  .replaceAll(/^export (?=(?:async function|function))/gm,"");
const context = vm.createContext({supabase:mock,BigInt,Error,String,Array,RegExp});
vm.runInContext(`${transformed}\nthis.api = {initializeOnlineRuntime,readOnlineRuntime,readOnlineRuntimeRevision,isNewerRevision};`,context);
const api=context.api;
assert.equal(await api.initializeOnlineRuntime(id),"1");
const first=await api.readOnlineRuntime(id);
assert.equal(first.state.teams[0].name,"Boston Celtics");
assert.equal(first.revision,"1");
assert.equal((await api.readOnlineRuntimeRevision(id)).revision,"1");
assert.equal(calls.full,1,"one full snapshot download");
assert.equal(calls.meta,1,"metadata-only refresh");
revision="2";state={teams:[{name:"Boston Celtics",players:[{name:"Tatum"}]}]};
assert.equal(api.isNewerRevision(revision,first.revision),true);
assert.equal((await api.readOnlineRuntime(id)).state.teams[0].players.length,1);
assert.equal(api.isNewerRevision("1","2"),false);
await assert.rejects(()=>api.initializeOnlineRuntime("../../bad"),/Invalid Online franchise identifier/);
console.log("PASS: Phase 2C.1 SQL permission structure, runtime initialization, metadata polling, state refresh and isolation");
