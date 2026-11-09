import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=(name)=>fs.readFileSync(path.join(root,name),'utf8');
const migration=read('supabase/bm_online_cpu_signing_history_phase2e4g3a2.sql');
const original=read('supabase/bm_online_cpu_player_trades_phase2c2d6.sql');
const precheck=read('supabase/bm_online_cpu_signing_history_phase2e4g3a2_PRECHECK.sql');
const audit=read('supabase/bm_online_cpu_signing_history_phase2e4g3a2_READ_ONLY_AUDIT.sql');
const extract=(s)=>s.match(/create or replace function public\.bm_online_commit_cpu_player_trade\([\s\S]*?\) returns jsonb language plpgsql security definer set search_path='' as \$\$([\s\S]*?)\$\$;/i)?.[1];
const oldBody=extract(original),body=extract(migration);
test('original and updated CPU commit bodies extracted',()=>{assert.ok(oldBody);assert.ok(body);});
test('new version is a precise edit of the original commit body',()=>{
 const recent=/  -- G3A2_SIGNED_REVISION_CUTOFF:[\s\S]*?    raise exception 'Recently signed player is not yet eligible for trade'; end if;/;
 const old=`  if exists (select 1 from public.bm_online_franchise_events e\n    where e.lobby_id=p_lobby and e.action_type in ('sign_cap_room_contract','sign_cap_room_free_agent')\n    and e.details->>'player_id'=any(p_sending_ids||p_receiving_ids)) then\n    raise exception 'Recently signed player is not yet eligible for trade'; end if;`;
 assert.ok(recent.test(body));
 const roundtrip=body.replace('  v_active_year integer;\n  v_archived_revision bigint := 0;\n','').replace(recent,old);
 assert.equal(roundtrip,oldBody);
});
test('requires 2026-2028, consistent roster year and archive history',()=>{
 for(const s of ['between 2026 and 2028','v_archived_revision>=v_revision',"'{onlineSeasonRollover,fromYear}'","'{onlineSeasonRollover,toYear}'","'{onlineSchedule,phase}'",'onlineSeasonHistory','archiveRevision','bm_online_season_archives']) assert.ok(migration.includes(s),s);
});
test('never uses wall clock to compute a league signing restriction',()=>{
 assert.match(migration,/e\.revision>v_archived_revision/);
 assert.doesNotMatch(migration,/e\.occurred_at/);
 assert.doesNotMatch(migration,/interval '30 days'/);
});
test('preserves private RPC authentication, stale revision, idempotency and state lock',()=>{
 for(const s of ["auth.role() is distinct from 'service_role'",'for update','v_prior.actor_id<>p_actor','v_revision is distinct from p_expected_revision','bm_online_prepare_human_asset_trade','v_updated:=v_result']) assert.ok(body.includes(s),s);
 assert.match(migration,/REVOKE ALL ON FUNCTION/);
 assert.match(migration,/GRANT EXECUTE ON FUNCTION .* TO service_role;/);
});
test('precheck and migration reject unexpected live versions',()=>{
 assert.match(precheck,/SOURCE MISMATCH - STOP/);
 assert.match(migration,/G3A2 unexpected live CPU trade source/);
 assert.match(audit,/G3A2_SIGNED_REVISION_CUTOFF/);
});
// Model-level boundary cases; PostgreSQL tests are separate/live and not claimed.
function signedThisYear(year,events,archives,ids){
 if(![2026,2027,2028].includes(year)) throw Error('year not supported');
 const cutoff=year===2026?0:archives[year-1];
 if(year>2026 && !Number.isInteger(cutoff)) throw Error('archive missing');
 return events.some(e=>e.revision>cutoff && ['sign_cap_room_contract','sign_cap_room_free_agent'].includes(e.type) && ids.includes(e.player_id));
}
test('2026 current signing stays locked',()=>assert.equal(signedThisYear(2026,[{revision:9,type:'sign_cap_room_contract',player_id:'a'}],{},['a']),true));
test('prior-season signed player unlocked after 2027 rollover',()=>assert.equal(signedThisYear(2027,[{revision:9,type:'sign_cap_room_contract',player_id:'a'}],{2026:100},['a']),false));
test('2027 new signing still locked after 2026 archive',()=>assert.equal(signedThisYear(2027,[{revision:101,type:'sign_cap_room_contract',player_id:'a'}],{2026:100},['a']),true));
test('new signing after 2027 archive re-locks in 2028',()=>assert.equal(signedThisYear(2028,[{revision:40,type:'sign_cap_room_contract',player_id:'a'},{revision:111,type:'sign_cap_room_free_agent',player_id:'a'}],{2027:100},['a']),true));
test('old 2027 signing unlocks in 2028',()=>assert.equal(signedThisYear(2028,[{revision:40,type:'sign_cap_room_contract',player_id:'a'}],{2027:100},['a']),false));
test('missing archive and unsupported future years fail closed',()=>{assert.throws(()=>signedThisYear(2027,[],{},['a']));assert.throws(()=>signedThisYear(2029,[],{2028:100},['a']));});
test('other players signing events do not lock unaffected players',()=>assert.equal(signedThisYear(2027,[{revision:110,type:'sign_cap_room_contract',player_id:'b'}],{2026:100},['a']),false));
