import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runOriginalInWorker} from '../onlineOriginalWorkerPool.mjs';

// No real league, Supabase, or HTTP server involved.
test('trusted worker rejects unknown task names without running code',async()=>{
 await assert.rejects(runOriginalInWorker('../../../evil',[]),e=>e.status===400);
});
test('trusted worker propagates original validator status off main thread',async()=>{
 await assert.rejects(runOriginalInWorker('draft.initialize',[{},1]), e=>e.status===409 && /draft-pick owners/i.test(e.message));
});
test('worker thread is not a direct SQL-write path',()=>{
 const body=readFileSync(new URL('../onlineOriginalWorkerThread.mjs',import.meta.url),'utf8');
 assert.match(body,/TASKS=Object\.freeze/);
 assert.doesNotMatch(body,/service_role|bm_online_apply|\/rest\/v1\/rpc\/|fetch\(/i);
});
test('original synchronous validators remain available for existing tests',async()=>{
 const mod=await import('../onlineDraftActions.js');
 assert.equal(typeof mod.initializeAuthoritativeOnlineDraft,'function');
 assert.equal(typeof mod.makeAuthoritativeOnlinePick,'function');
});
