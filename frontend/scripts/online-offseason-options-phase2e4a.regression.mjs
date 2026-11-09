import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const screen=read('src/online/OnlineOffseasonOptions.jsx');
const nav=read('src/online/OnlineBmSidebar.jsx');
const franchise=read('src/online/OnlineFranchise.jsx');
const api=read('../backend/onlineOptions.js');
const sql=read('../supabase/bm_online_options_phase2e4a.sql');
assert.ok(existsSync(new URL('src/online/online-options.css',root)));
for(const k of ['Player & Team Options','teamOptions','twoWay','stash','Confirm league finalization','Lock in my decisions','isHost','allSubmitted','submitted'])
 assert.ok(screen.includes(k),k);
for(const path of ['/player-team-options','OnlineOffseasonOptions'])assert.ok(franchise.includes(path),path);
assert.ok(nav.includes('/player-team-options'));
for(const mode of ['preview','submit','finalize'])assert.ok(api.includes(`mode==='${mode}'`)||api.includes(`mode!==\'${mode}\'`),mode);
for(const k of ['runOriginalOptions','verifyOriginalOptionChanges','readyForOptions','bm_online_submit_options_phase2e4a','bm_online_finalize_options_phase2e4a'])assert.ok(api.includes(k));
for(const k of ['for update','decisionsByTeam','bm.online_options_write','p_expected_revision','service_role','optionsComplete'])assert.ok(sql.includes(k));
for(const prohibited of ['saveLeagueData','localStorage.setItem("bm_league','GameProvider','simEnginePy','../context/GameContext'])
 assert.ok(!screen.includes(prohibited),`Forbidden single-player coupling: ${prohibited}`);
console.log('PASS: original options engine, team-scoped decisions, host finalization, online isolation and SQL guards');
