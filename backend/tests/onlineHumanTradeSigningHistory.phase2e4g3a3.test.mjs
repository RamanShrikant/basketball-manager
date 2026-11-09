// Phase G3A3 structural and model-level tests. No live PostgreSQL execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=(path)=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');
const sql=read('supabase/bm_online_human_trade_signing_history_phase2e4g3a3.sql');
const precheck=read('supabase/bm_online_human_trade_signing_history_phase2e4g3a3_PRECHECK.sql');
const audit=read('supabase/bm_online_human_trade_signing_history_phase2e4g3a3_READ_ONLY_AUDIT.sql');
const manifest=JSON.parse(read('G3A3-BASELINE-MANIFEST.json'));
const nameRegex=(name)=>new RegExp(String.raw`create or replace function public\.${name}\([\s\S]*?\)\s*returns jsonb language plpgsql security definer set search_path='' as \$\$([\s\S]*?)\$\$;`,'i');
function body(source,name){const m=source.match(nameRegex(name));assert.ok(m,`No source for ${name}`);return m[1];}
function md5(s){return createHash('md5').update(s.replace(/\r/g,''),'utf8').digest('hex');}
const rows=Object.entries(manifest);
for(const [label,entry] of rows){
 test(`G3A3 ${label} retains exact audited original source`,()=>{
   const original=body(read(entry.sourceFile.startsWith('supabase/')? entry.sourceFile: `supabase/${entry.sourceFile}`),entry.function);
   assert.equal(md5(original),entry.baselineMd5);
   const updated=body(sql,entry.function);
   assert.match(updated,/G3A3_SIGNED_REVISION_CUTOFF/);
   assert.match(updated,/v_signed_cutoff:=public\.bm_online_human_trade_signing_cutoff_phase2e4g3a3\(p_lobby,v_state,v_revision\)/);
   assert.match(updated,/e\.revision>v_signed_cutoff/);
   assert.match(updated,/e\.details->>'player_id'=any\(/);
   assert.match(updated,/for update/i);
   assert.match(updated,/v_revision<>p_expected_revision|v_revision is distinct from p_expected_revision/i);
   const restored=updated
     .replace('  v_signed_cutoff bigint;\n','')
     .replace(/\n  -- G3A3_SIGNED_REVISION_CUTOFF:[^\n]*\n  v_signed_cutoff:=public\.bm_online_human_trade_signing_cutoff_phase2e4g3a3\(p_lobby,v_state,v_revision\);/g,'')
     .replace('e.lobby_id=p_lobby and e.revision>v_signed_cutoff\n      and e.action_type',
       'e.lobby_id=p_lobby and e.action_type');
   assert.equal(restored,original,'Unexpected functional body change beyond the scoped guard');
   assert.equal((updated.match(/sign_cap_room_contract/g)||[]).length,1);
   assert.equal((updated.match(/v_signed_cutoff/g)||[]).length,3);
 });
}
test('helper requires authoritative prior season archive and history with increasing revisions',()=>{
 assert.match(sql,/FOR v_prior_year IN 2026\.\.\(v_year-1\) LOOP/);
 assert.match(sql,/v_archive_revision>=p_revision OR v_archive_revision<=v_prior_cutoff/);
 assert.match(sql,/archiveRevision/);
 assert.match(sql,/bm_online_season_archives/);
 assert.match(sql,/v_year NOT BETWEEN 2026 AND 2028/);
 assert.match(sql,/v_year=2026 THEN\s*RETURN 0/);
 assert.match(sql,/onlineSchedule,phase/);
});
test('all three offer and response paths use a shared server-side cutoff, no direct client bypass',()=>{
 assert.equal((sql.match(/G3A3_SIGNED_REVISION_CUTOFF/g)||[]).length,3);
 assert.equal((sql.match(/e\.revision>v_signed_cutoff/g)||[]).length,3);
 assert.equal((sql.match(/v_signed_cutoff:=public\.bm_online_human_trade_signing_cutoff_phase2e4g3a3/g)||[]).length,3);
 assert.match(sql,/bm_online_offer_human_trade/);
 assert.match(sql,/bm_online_offer_human_asset_trade/);
 assert.match(sql,/bm_online_respond_human_trade/);
});
test('SQL guard and ACL ensure exact old functions are required before replacement',()=>{
 for(const entry of Object.values(manifest)){
  assert.ok(precheck.includes(entry.baselineMd5));
  assert.ok(sql.includes(entry.baselineMd5));
 }
 assert.match(sql,/BEGIN;/);
 assert.match(sql,/COMMIT;/);
 assert.match(sql,/G3A2_SIGNED_REVISION_CUTOFF/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.bm_online_respond_human_trade/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.bm_online_human_trade_signing_cutoff_phase2e4g3a3/);
 assert.match(audit,/anon_exec/);
});
// This models the intended revision cutoff, not PostgreSQL execution.
function cutoff(year, currentRevision,archives,history,rollover){
 if(!Number.isInteger(currentRevision)||currentRevision<1||year<2026||year>2028)throw Error('unsupported');
 if(year===2026)return 0;
 if(rollover?.fromYear!==year-1||rollover?.toYear!==year||rollover?.status!=='complete')throw Error('rollover');
 let previous=0;
 for(let y=2026;y<year;y++){
  const rev=archives[y];
  if(!Number.isInteger(rev)||rev<=previous||rev>=currentRevision||
    history.filter(h=>h.seasonYear===y&&h.archiveRevision===rev).length!==1)throw Error('archive');
  previous=rev;
 }
 if(Math.max(...Object.keys(archives).map(Number))!==year-1)throw Error('stale');
 return previous;
}
const roll=(fromYear,toYear)=>({fromYear,toYear,status:'complete'});
test('2026 signings remain locked, no rollover required',()=>{
 assert.equal(cutoff(2026,42,{},[],null),0);
 assert.equal([6,11,37].some(rev=>rev>0),true);
});
test('2027 historical signing expires but 2027 signing remains blocked',()=>{
 const bound=cutoff(2027,201,{2026:150},[{seasonYear:2026,archiveRevision:150}],roll(2026,2027));
 assert.equal(bound,150); assert.equal(120>bound,false);assert.equal(188>bound,true);
});
test('2028 only current-year signings are restricted after both archived seasons',()=>{
 const bound=cutoff(2028,310,{2026:150,2027:250},[
  {seasonYear:2026,archiveRevision:150},{seasonYear:2027,archiveRevision:250}],roll(2027,2028));
 assert.equal(bound,250); assert.equal(149>bound,false);assert.equal(241>bound,false);assert.equal(301>bound,true);
});
test('incomplete, duplicated or mismatched archive history blocks trades',()=>{
 assert.throws(()=>cutoff(2028,310,{2026:150,2027:250},[],roll(2027,2028)),/archive/);
 assert.throws(()=>cutoff(2028,310,{2026:150,2027:250},[
  {seasonYear:2026,archiveRevision:150},{seasonYear:2026,archiveRevision:150},{seasonYear:2027,archiveRevision:250}],roll(2027,2028)),/archive/);
 assert.throws(()=>cutoff(2028,310,{2026:150,2027:250},[
  {seasonYear:2026,archiveRevision:150},{seasonYear:2027,archiveRevision:249}],roll(2027,2028)),/archive/);
 assert.throws(()=>cutoff(2027,151,{2026:151},[{seasonYear:2026,archiveRevision:151}],roll(2026,2027)),/archive/);
 assert.throws(()=>cutoff(2027,201,{2026:150},[{seasonYear:2026,archiveRevision:150}],roll(2025,2027)),/rollover/);
});
test('2029 and later remain locked until separate compatibility work',()=>{
 assert.throws(()=>cutoff(2029,500,{2026:100,2027:200,2028:300},[],roll(2028,2029)),/unsupported/);
});
test('existing rollover cancels pending old-season human offers',()=>{
 const rolloverSql=read('supabase/bm_online_future_draft_rights_phase2e4f3b2.sql');
 assert.match(rolloverSql,/UPDATE public\.bm_online_trade_offers\s+SET status='cancelled'/i);
 assert.match(rolloverSql,/WHERE lobby_id=p_lobby AND status='pending'/i);
});
