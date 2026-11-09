import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chooseTrustedDraftPickMode} from '../onlineDraftFallbackPolicy.g3ca3.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const backend=fs.readFileSync(path.join(root,'onlineDraftActions.js'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const ui=fs.readFileSync(path.join(root,'../frontend/src/online/OnlineDraftRoom.jsx'),'utf8');
const sql=fs.readFileSync(path.join(root,'../supabase/BM_G3C_A3_DRAFT_FALLBACK_MANUAL.sql'),'utf8');
const d=(human,isHost,actorOwnsPick,submittedProspect,expired)=>chooseTrustedDraftPickMode({human,isHost,actorOwnsPick,submittedProspect,expired});
test('owner is allowed to select their prospect before the deadline',()=>assert.deepEqual(d(true,false,true,true,false),{ok:true,forceCpu:false}));
test('owner can still pick after deadline until the CPU commit wins',()=>assert.deepEqual(d(true,false,true,true,true),{ok:true,forceCpu:false}));
test('a GM must submit their own prospect ID',()=>assert.equal(d(true,false,true,false,true).status,400));
test('other GM can never pick their opponent prospect',()=>assert.equal(d(true,false,false,true,true).status,403));
test('other GM cannot CPU-auto their opponent even after deadline',()=>assert.equal(d(true,false,false,false,true).status,403));
test('commissioner cannot prematurely auto-pick a human team',()=>assert.equal(d(true,true,false,false,false).status,403));
test('commissioner can only CPU-auto an expired human turn',()=>assert.deepEqual(d(true,true,false,false,true),{ok:true,forceCpu:true}));
test('commissioner cannot choose a prospect on someone else’s turn',()=>assert.equal(d(true,true,false,true,true).status,400));
test('only host can advance a CPU team',()=>assert.equal(d(false,false,false,false,true).status,403));
test('host advances a CPU team with the original CPU engine',()=>assert.deepEqual(d(false,true,false,false,false),{ok:true,forceCpu:true}));
test('even CPU picks reject arbitrary prospect overrides',()=>assert.equal(d(false,true,false,true,false).status,400));
test('backend prechecks expiry before Python execution and SQL rechecks it',()=>{
 assert.match(backend,/verifiedExpiredHumanPick\(session/);
 assert.ok(backend.indexOf('verifiedExpiredHumanPick(session')<backend.indexOf('makeAuthoritativeOnlinePickAsync(session.state'));
 assert.match(sql,/public\.bm_online_draft_fallback_eligible_g3ca3\(p_lobby,v_year,v_index,v_human_owner\)/);
});
test('expiry is derived from server journal not client clocks',()=>{
 assert.match(sql,/bm_online_franchise_events e/);
 assert.match(sql,/e\.occurred_at/);
 assert.match(sql,/INTERVAL '24 hours'/);
 assert.match(sql,/v_count IS DISTINCT FROM p_index/);
 assert.doesNotMatch(sql,/p_deadline|p_started_at|p_duration/);
});
test('read-only clock requires actual authenticated league membership',()=>{
 assert.match(sql,/auth\.uid\(\) IS NULL/);
 assert.match(sql,/m\.user_id=auth\.uid\(\)/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.bm_online_draft_clock_g3ca3\(uuid\) TO authenticated,service_role/);
});
test('UI never permits fallback solely based on a local timer',()=>{
 assert.match(ui,/draftClock\?\.eligible===true/);
 assert.match(ui,/online_draft_clock_g3ca3/);
 assert.match(ui,/Auto-pick after expired GM deadline/);
});
test('trusted pick function remains service role only',()=>{
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.bm_online_make_draft_pick_phase2e2[\s\S]+FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.bm_online_make_draft_pick_phase2e2[\s\S]+TO service_role/);
});

test('an explicit commissioner recovery endpoint preserves the original human /pick denial',()=>{
 assert.match(app,/api\/online\/draft\/auto-pick/);
 assert.match(backend,/if\(kind==='pick'&&otherHuman\)fail\(403/);
 assert.match(backend,/if\(kind==='auto-pick'&&\(!otherHuman\|\|!session.host\)\)fail\(403/);
 assert.match(ui,/auto-pick':action/);
});
