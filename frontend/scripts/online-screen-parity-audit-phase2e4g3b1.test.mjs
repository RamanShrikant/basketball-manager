import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ONLINE_PENDING_VIEW_PATHS} from '../src/online/onlineNavigationAvailability.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const sidebar=read('../src/online/OnlineBmSidebar.jsx');
const route=read('../src/online/OnlineFranchise.jsx');
const provider=read('../src/online/onlineReadOnlyContext.jsx');
const pick=read('../src/online/OnlineRosterView.jsx');
const stats=read('../src/online/OnlinePlayerStats.jsx');
const standings=read('../src/online/OnlineStandings.jsx');
const views=[...sidebar.matchAll(/\["[^"\n]+","(\/[a-z-]+)","[a-zA-Z]+"\]/g)].map(m=>m[1]);
const routes=new Set([...route.matchAll(/"(\/[a-z-]+)":Online[A-Za-z]+/g)].map(m=>m[1]));
test('all 29 sidebar destinations either render a dedicated online component or are unavailable',()=>{
  assert.equal(views.length,29);
  for(const view of views)assert.ok(routes.has(view)||ONLINE_PENDING_VIEW_PATHS.includes(view),view);
  assert.equal(new Set(views).size,views.length);
});
test('unimplemented nine are visibly unavailable and never fallback to single player',()=>{
  assert.equal(ONLINE_PENDING_VIEW_PATHS.length,9);
  for(const view of ONLINE_PENDING_VIEW_PATHS){assert.ok(views.includes(view));assert.ok(!routes.has(view),view);}
  assert.match(sidebar,/aria-disabled="true"/);
  assert.match(route,/Online Page Unavailable/);
  assert.match(provider,/navigate\(`\/online\/franchise\/\$\{id\}/);
});
test('authoritative read-only context is separate from local GameProvider',()=>{
  assert.doesNotMatch(provider,/import.*GameProvider/);
  assert.match(provider,/OnlineReadOnlyContext.Provider/);
});
test('full single-player roster-management parity is intentionally NOT yet achieved',()=>{
  assert.match(pick,/canManageCurrentRoster = false &&/);
  assert.match(pick,/releaseOnlineStandardPlayer/);
});
test('archived stats and playoffs are NOT full online parity yet',()=>{
  assert.match(stats,/const isOffseasonMode = false/);
  assert.match(standings,/onlineInertStorage.getItem\("bm_offseason_state_v1"\)/);
  assert.ok(ONLINE_PENDING_VIEW_PATHS.includes('/playoff-stats'));
});
test('online routes still use current single-player style and utilities where mirrored',()=>{
  for(const p of ['OnlineTeamHubMirror.jsx','OnlineRosterView.jsx','OnlineSalaryTable.jsx','OnlineStandings.jsx','OnlineTrades.jsx']) {
    const s=read('../src/online/'+p);
    assert.match(s,/useGame/);
    assert.match(s,/\.\.\/pages\/|\.\.\/components\/TeamHub|READ-ONLY MIRROR|single-player/);
  }
});
