import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'..');
const read=(p)=>readFileSync(resolve(root,p),'utf8');
const sql=read('../supabase/bm_online_signing_phase2c2a.sql');
const runtime=read('src/online/onlineRuntimeClient.js');
const franchise=read('src/online/OnlineFranchise.jsx');
const context=read('src/online/onlineReadOnlyContext.jsx');
const fa=read('src/online/OnlineFreeAgencyPreview.jsx');
const oldTest=read('scripts/online-coach-freeagency.regression.mjs');
// Structural security checks. Still require a live two-account RPC test!
for(const contract of [
  /security definer set search_path = ''/i, /auth\.uid\(\)/,
  /for update/i, /v_revision <> p_expected_revision/i,
  /v_prior\.actor_id <> v_actor/i,
  /request_id=p_request/i,
  /if v_standard_count>=15/i,
  /v_payroll\+p_first_year_salary>v_cap/i,
  /team_name into v_status,v_team/i,
  /insert into public\.bm_online_franchise_events/i,
  /update public\.bm_online_franchise_runtime/i,
  /if v_matches<>1/i,
  /grant execute on function public\.bm_online_sign_cap_room_free_agent\(uuid,uuid,bigint,text,bigint\) to authenticated/i,
]) assert.match(sql,contract);
assert.doesNotMatch(sql,/grant\s+(?:update|insert|delete|all)\s+on\s+public\.bm_online_franchise_runtime\s+to\s+authenticated/i);
assert.match(runtime,/bm_online_sign_cap_room_free_agent/);
assert.match(fa,/signOnlineCapRoomContract/,'Cap-room signing uses the current multi-year contract path');
assert.match(fa,/marketOpen\?'Submit Offer':'Sign Player'/,'Offseason offers and standard signings are visibly distinct');
assert.match(fa,/signOnlineCapRoomContract/,'Online free agent UI uses server-authoritative multi-year signing');
assert.match(franchise,/onAccepted=\{refreshSharedState\}/);
assert.match(context,/lobbyId=null, onAccepted=null/);
assert.doesNotMatch(fa,/\b(?:localStorage|sessionStorage|indexedDB)\s*\./);
assert.doesNotMatch(fa,/from ["']\.\.\/context\/GameContext/);
assert.match(oldTest,/signOnlineCapRoomContract/,'Coach/free-agency regression tracks the modern online contract client');
for(const path of ['src/online/onlineRuntimeClient.js','src/online/OnlineFranchise.jsx','src/online/onlineReadOnlyContext.jsx','src/online/OnlineFreeAgencyPreview.jsx']){
  const dir=dirname(resolve(root,path)), s=read(path);
  for(const m of s.matchAll(/(?:from\s*|import\s*)["'](\.{1,2}\/[^"']+)["']/g)){
    const p=resolve(dir,m[1]);
    assert([p,...['.js','.jsx','.mjs','.css'].map(ext=>p+ext)].some(existsSync),`Missing import ${path} -> ${m[1]}`);
  }
}
// Actual frontend client behavior against mocked authorized RPC.
const lobbyId='37db6f57-c5a7-4873-8ce1-5b219a81d6b1';
const req='e4841aa4-654f-41b3-a3e6-35243e7392fc';
let calls=[];
const mock={rpc:async(name,args)=>{calls.push([name,args]);return {data:{ok:true,revision:2,replayed:false},error:null}}};
const transformed=runtime.replace(/^import\s+\{supabase\}.*$/m,'').replaceAll(/^export (?=(?:async function|function))/gm,'');
const c=vm.createContext({supabase:mock,BigInt,String,Error,Number,RegExp});
vm.runInContext(transformed+'\nthis.sign = signOnlineCapRoomFreeAgent;',c);
const result=await c.sign({lobbyId,requestId:req,expectedRevision:'1',playerId:'test-free-agent',salary:1200000});
assert.equal(result.revision,2);assert.equal(calls.length,1);
assert.equal(calls[0][0],'bm_online_sign_cap_room_free_agent');
assert.equal(calls[0][1].p_expected_revision,'1');
assert.equal(calls[0][1].p_player_id,'test-free-agent');
await assert.rejects(()=>c.sign({lobbyId,requestId:req,expectedRevision:'1',playerId:'p',salary:1}),/salary/);
await assert.rejects(()=>c.sign({lobbyId:'bad',requestId:req,expectedRevision:'1',playerId:'p',salary:1200000}),/identifier/);
console.log('PASS: Online 2C.2A signing RPC wiring, explicit permissions, revision/idempotency/roster/cap guards and import paths');
