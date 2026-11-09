// Read-only Online sim-to-date source regression; no app launch, network, or DB.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planOnlineSimToDate} from '../src/online/onlineSimulationCheckpoints.mjs';
const read=path=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');
const online=read('frontend/src/online/OnlineSeasonSchedule.jsx');
const controls=read('frontend/src/online/OnlineSimulationBatchPanel.jsx');
const backend=read('backend/onlineSimulation.js');
const state={seasonStartYear:2026,onlineSchedule:{phase:'regular-season',byDate:{'2026-10-21':[{id:'a',home:'A',away:'B'}],'2026-10-22':[{id:'b',home:'C',away:'D'}],'2027-02-05':[{id:'c',home:'E',away:'F'}]}},onlineResults:{}};
const planned=planOnlineSimToDate(state,'2027-02-06');
assert.deepEqual(planned.days,['2026-10-21','2026-10-22']);
assert.equal(planned.blocked.kind,'trade_deadline');
for(const fragment of ['OnlineSimulationBatchPanel','firstBlockedOnlineCheckpoint','hasPartiallyCompletedDay','Simulate next day','Box score'])assert.ok(online.includes(fragment),fragment);
for(const fragment of ['readOnlineRuntime(lobbyId)','sessionStorage','pendingId(lobbyId,date)','forgetId(lobbyId,date)','stopRef.current','onAccepted?.()'])assert.ok(controls.includes(fragment),fragment);
assert.ok(backend.includes('firstBlockedOnlineCheckpoint'));
assert.ok(!controls.includes('localStorage.setItem'));
assert.ok(!controls.includes('setLeagueData('));
assert.ok(!controls.includes('game_sim.py'));
console.log('PASS: Online-only sim-to-date queue, checkpoint gate, replay recovery, no local results or single-player mutation');
