// Run from frontend: node scripts/online-release-realtime.regression.mjs
// Static contract checks; deployment/live concurrency must ALSO be tested with 2 accounts.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..', '..');
const src = relative => readFileSync(resolve(root, relative), 'utf8');
const release = src('supabase/bm_online_roster_release_phase2c2b.sql');
const signing = src('supabase/bm_online_signing_phase2c2a_hardening.sql');
const realtime = src('supabase/bm_online_realtime_phase2c3.sql');
const roster = src('frontend/src/online/OnlineRosterView.jsx');
const api = src('frontend/src/online/onlineRuntimeClient.js');
const franchise = src('frontend/src/online/OnlineFranchise.jsx');
const assertPatterns=(name,text,patterns)=>{for(const p of patterns)assert.match(text,p,`${name}: missing ${p}`)};
assertPatterns('release server', release, [
  /security definer set search_path = ''/i,/auth\.uid\(\)/i,/for update/i,
  /bm_online_lobby_members/i,/v_status<>'started'/i,/v_revision<>p_expected_revision/i,
  /unique|request_id=p_request/i,/action_type<>'release_standard_player'/i,
  /v_total_id_count<>1/i,/v_player_count<>1/i,/two_way\|two-way/i,
  /deadCapByTeam/i,/originalRemainingRows/i,/totalGuaranteedOwed/i,
  /jsonb_set\(v_new_state,'\{freeAgents\}'/i,
  /insert into public\.bm_online_franchise_events/i,
  /grant execute on function public\.bm_online_release_standard_player/i
]);
assert.doesNotMatch(release, /update\s+public\.bm_singleplayer/i);
assertPatterns('signing cap integrity', signing, [/deadCapByTeam/i,/v_payroll:=v_payroll\+v_dead_amount/i,/qualifyingOffer/i,/restrictedFreeAgent/i,/for update/i]);
assertPatterns('realtime', realtime,[/supabase_realtime/i,/bm_online_franchise_events/i]);
assertPatterns('release client', api,[/releaseOnlineStandardPlayer/i,/bm_online_release_standard_player/i,/positiveRevision\(expectedRevision\)/i]);
assertPatterns('roster UI',roster,[/canReleaseCurrentRoster/i,/releaseBusy/i,/releaseOnlineStandardPlayer\(/i,/await onAccepted\(\)/i,/role="alert"/i]);
assertPatterns('reconnect',franchise,[/postgres_changes/i,/bm_online_franchise_events/i,/readOnlineRuntimeRevision/i,/setInterval\(\(\)=>void check\(false\),20000\)/i,/visibilitychange/i,/removeChannel/i]);
assert.doesNotMatch(franchise,/from\s+["']\.\.\/contexts?\/GameContext/i);
console.log('PASS — Online release, dead-cap signing, realtime/reconnect and isolation static contracts');
console.log('NOTE — Static checks do not replace Supabase migrations and live two-account testing.');
