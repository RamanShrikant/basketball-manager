// Phase 2E.2 online-only source/route isolation contracts.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const room=read('../src/online/OnlineDraftRoom.jsx');
const lottery=read('../src/online/OnlineDraftLottery.jsx');
const franchise=read('../src/online/OnlineFranchise.jsx');
const sidebar=read('../src/online/OnlineBmSidebar.jsx');
const context=read('../src/online/onlineReadOnlyContext.jsx');
const backend=read('../../backend/onlineDraftActions.js');
const app=read('../../backend/app.js');
for(const marker of ['onlineDraftRights','onlineDraft','availableProspects','pending rookie signing',
  'selectedTeam','humanTeamNames','onAccepted','expectedRevision','requestId','supabase.auth.getSession','Confirm'])
 assert.ok(room.toLowerCase().includes(marker.toLowerCase()),`Missing authenticated online draft contract: ${marker}`);
for(const source of [room,lottery])for(const forbidden of ['localStorage','setLeagueData','../context/GameContext'])
 assert.ok(!source.includes(forbidden),`Online draft illegally touches single-player state: ${forbidden}`);
assert.match(franchise,/"\/nba-draft":OnlineDraftRoom/);
assert.match(sidebar,/"NBA Draft","\/nba-draft"/);
assert.match(context,/humanTeamNames/);
assert.match(lottery,/originalTeamName/);
assert.match(room,/rightsSettlement.*pending/);
for(const action of ['settle-rights','start','pick'])assert.ok(app.includes(`/api/online/draft/${action}`),`Missing backend action ${action}`);
assert.ok(backend.includes('service_role')===false,'Service role must be referenced only through private environment variables');
assert.match(backend,/SUPABASE_SERVICE_ROLE_KEY/);
assert.match(backend,/chooseTrustedDraftPickMode/,'Draft actor authority uses the shared trusted policy');
assert.match(backend,/if\(kind==='pick'&&otherHuman\)fail\(403/,'Normal picks cannot usurp another human GM');
assert.match(backend,/if\(kind==='auto-pick'&&\(!otherHuman\|\|!session\.host\)\)fail\(403/,'Commissioner recovery cannot be used on ordinary picks');
assert.match(backend,/verifiedExpiredHumanPick/,'Human-pick recovery requires expiry verification');
assert.match(backend,/forceCpu,prospectId:forceCpu\?null:/,'CPU path cannot accept a player picked by the browser');
assert.match(room,/disabled={!myTurn\|\|busy}/);
console.log('PASS: authenticated shared draft, rights ownership, GM/CPU controls, and local-state isolation');
