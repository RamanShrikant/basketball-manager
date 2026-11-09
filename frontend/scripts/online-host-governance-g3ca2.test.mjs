import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const read=rel=>readFileSync(resolve(root,rel),'utf8');
const sql=read('supabase/BM_G3C_A2_HOST_RECOVERY_MANUAL.sql');
const gm=read('frontend/src/online/OnlineGmPanel.jsx');
const franchise=read('frontend/src/online/OnlineFranchise.jsx');
const ui=read('frontend/src/online/OnlineHostGovernance.jsx');
const pre=read('supabase/BM_G3C_A2_HOST_RECOVERY_PRECHECK.sql');
const post=read('supabase/BM_G3C_A2_HOST_RECOVERY_POSTCHECK.sql');

test('host update paths are paired and atomically locked',()=>{
 assert.match(sql,/bm_online_host_accept\(p_lobby uuid\)/);
 assert.match(sql,/bm_online_host_recovery_vote\(p_lobby uuid,p_candidate uuid\)/);
 assert.equal((sql.match(/UPDATE public\.bm_online_franchises SET host_id=/g)||[]).length,2);
 assert.equal((sql.match(/UPDATE public\.bm_online_lobbies SET host_id=/g)||[]).length,2);
 assert.match(sql,/FOR UPDATE/g);
 assert.match(sql,/Franchise host mismatch; refusing/);
});
test('transfer requires host nomination and explicit nominee acceptance',()=>{
 assert.match(sql,/v_host<>v_me/);
 assert.match(sql,/v_g\.nominee_id IS DISTINCT FROM v_me/);
 assert.match(sql,/interval '7 days'/);
 assert.match(sql,/p_candidate=v_me/);
});
test('recovery requires authenticated non-host membership and 48h inactivity',()=>{
 assert.match(sql,/v_me=v_host OR NOT EXISTS/);
 assert.match(sql,/host_last_seen_at > now\(\)-interval '48 hours'/);
 assert.match(sql,/auth\.uid\(\)/);
 assert.match(sql,/Commissioner recovery requires 48 hours/);
});
test('recovery requires quorum, self vote and bound 24-hour epoch',()=>{
 assert.match(sql,/v_needed:=\(\(v_total-1\)\/2\)\+1/);
 assert.match(sql,/voter_id=p_candidate AND candidate_id=p_candidate/);
 assert.match(sql,/generation=v_g\.generation/);
 assert.match(sql,/interval '24 hours'/);
});
test('host activity cancels pending recovery and does not run on idle timer',()=>{
 assert.match(sql,/DELETE FROM public\.bm_online_host_recovery_votes WHERE lobby_id=p_lobby/);
 assert.match(ui,/addEventListener\("pointerdown"/);
 assert.match(ui,/addEventListener\("keydown"/);
 assert.doesNotMatch(ui,/setInterval\([^]*?bm_online_host_heartbeat/);
});
test('no browser DML grants on governance tables',()=>{
 assert.match(sql,/REVOKE ALL ON public\.bm_online_host_governance/);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.doesNotMatch(ui,/\.from\("bm_online_host_governance"\)/);
 assert.match(sql,/SECURITY DEFINER SET search_path = ''/);
});
test('all authority changes are audited without roster or runtime mutation',()=>{
 assert.match(sql,/CREATE TABLE public\.bm_online_host_audit/);
 for(const action of ['nominate','cancel_nomination','accept_transfer','recovery_vote','recovery_transfer'])assert.ok(sql.includes(action));
 assert.doesNotMatch(sql,/UPDATE public\.bm_online_franchise_runtime/);
 assert.doesNotMatch(sql,/UPDATE public\.bm_online_lobby_members/);
});
test('UI integrates commissioner controls and polls host changes independently of roster revision',()=>{
 assert.match(gm,/<OnlineHostGovernance room=\{room\} user=\{user\}/);
 assert.match(franchise,/onGovernanceChange=\{refreshCommissioner\}/);
 assert.match(franchise,/table:"bm_online_lobbies"/);
 assert.match(franchise,/setInterval\(refreshRole,15000\)/);
 assert.match(ui,/recovery_eligible/);
});
test('read-only precheck and postcheck cover database safety',()=>{
 for(const n of ['started_franchise_schema','no_prior_a2_objects','source_authorization'])assert.ok(pre.includes(n));
 for(const n of ['bm_online_host_nominate','bm_online_host_recovery_vote','bm_online_host_status'])assert.ok(post.includes(n));
 assert.match(post,/anon_exec/);
 assert.match(post,/locked_governance_tables_and_init_trigger/);
});
