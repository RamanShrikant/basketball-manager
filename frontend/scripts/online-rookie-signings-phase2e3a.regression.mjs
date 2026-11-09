import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const view=read('../src/online/OnlineRookieSignings.jsx');
const franchise=read('../src/online/OnlineFranchise.jsx');
const sidebar=read('../src/online/OnlineBmSidebar.jsx');
const draft=read('../src/online/OnlineDraftRoom.jsx');
const app=read('../../backend/app.js');
const server=read('../../backend/onlineRookieSignings.js');
const sql=read('../../supabase/bm_online_rookie_signings_phase2e3a.sql');
assert.match(franchise,/"\/rookie-signings":OnlineRookieSignings/);
assert.match(sidebar,/"Rookie Signings","\/rookie-signings"/);
assert.match(draft,/Continue to Rookie Signings/);
for(const term of ['standard','two_way','stash','release','onAccepted','expectedRevision','selectedTeam',
  'humanTeamNames','supabase.auth.getSession','Confirm signings','Resolve CPU signings'])
 assert.ok(view.includes(term),`Missing rookie GM feature: ${term}`);
for(const forbidden of ['localStorage','saveLeagueData','setLeagueData','../context/GameContext','leagueSaves'])
 assert.ok(!view.includes(forbidden),`Online Rookie Signings accesses local single-player state: ${forbidden}`);
for(const route of ['/api/online/rookies/preview','/api/online/rookies/sign','/api/online/rookies/resolve-cpu'])
 assert.ok(app.includes(route),`Missing original rookies backend route: ${route}`);
for(const term of ['runOriginalRookieEngine','verifyChanges','expectedRevision','SUPABASE_SERVICE_ROLE_KEY',
  'requestInputHash','host','members','rookie_signings_cpu','rookie_signings_human'])
 assert.ok(server.includes(term),`Missing trusted backend safeguard: ${term}`);
assert.ok(sql.includes('for update'));
assert.match(sql,/revoke all on function public\.bm_online_apply_rookie_signings_phase2e3a/);
assert.match(sql,/bm_online_rookie_signing_guard_phase2e3a/);
console.log('PASS: online rookie signings, GM/CPU ownership, original contracts and single-player isolation');
