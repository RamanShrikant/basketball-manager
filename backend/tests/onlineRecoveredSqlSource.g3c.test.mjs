// Source-only regression coverage for the 2026-11-08 multiplayer recovery.
// No database, network, backend server, or single-player runtime access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const read=path=>readFileSync(resolve(root,path),'utf8');
const sqlFiles=readdirSync(resolve(root,'supabase')).filter(n=>n.endsWith('.sql')).map(n=>`supabase/${n}`);
const sources=Object.fromEntries(sqlFiles.map(f=>[f,read(f)]));
const functions={
  "supabase/bm_online_calendar_phase2d1.sql": [
    "bm_online_initialize_calendar_phase2d1"
  ],
  "supabase/bm_online_simulate_day_phase2d2.sql": [
    "bm_online_simulate_day_phase2d2"
  ],
  "supabase/bm_online_coach_gameplans_phase2d2b.sql": [
    "bm_online_save_coach_gameplan_phase2d2b"
  ],
  "supabase/bm_online_trade_deadline_phase2d2d.sql": [
    "bm_online_trade_deadline_for_state",
    "bm_online_close_trade_deadline_phase2d2d",
    "bm_online_closed_trade_offer_guard",
    "bm_online_closed_trade_event_guard",
    "bm_online_deadline_runtime_guard"
  ],
  "supabase/bm_online_all_stars_phase2d2e.sql": [
    "bm_online_all_star_date_for_state",
    "bm_online_select_all_stars_phase2d2e",
    "bm_online_all_star_runtime_guard"
  ],
  "supabase/bm_online_veteran_extensions_phase2d2f.sql": [
    "bm_online_veteran_extension_date_phase2d2f",
    "bm_online_extension_rosters_phase2d2f",
    "bm_online_commit_extension_phase2d2f",
    "bm_online_veteran_extension_guard_phase2d2f"
  ],
  "supabase/bm_online_playin_phase2d3a.sql": [
    "bm_online_seed_postseason_phase2d3a",
    "bm_online_simulate_playin_phase2d3a"
  ],
  "supabase/bm_online_playoffs_phase2d3b.sql": [
    "bm_online_wire_series_phase2d3b",
    "bm_online_simulate_playoffs_phase2d3b"
  ],
  "supabase/bm_online_draft_lottery_phase2e1.sql": [
    "bm_online_draw_draft_lottery_phase2e1"
  ],
  "supabase/bm_online_draft_rights_and_live_draft_phase2e2.sql": [
    "bm_online_settle_draft_rights_phase2e2",
    "bm_online_start_draft_phase2e2",
    "bm_online_make_draft_pick_phase2e2"
  ],
  "supabase/bm_online_rookie_signings_phase2e3a.sql": [
    "bm_online_apply_rookie_signings_phase2e3a",
    "bm_online_rookie_signing_guard_phase2e3a"
  ],
  "supabase/bm_online_retirements_phase2e3b.sql": [
    "bm_online_apply_retirements_phase2e3b",
    "bm_online_retirement_runtime_guard_phase2e3b"
  ]
};
const triggers={
  "bm_online_trade_offer_deadline_guard": "supabase/bm_online_trade_deadline_phase2d2d.sql",
  "bm_online_trade_event_deadline_guard": "supabase/bm_online_trade_deadline_phase2d2d.sql",
  "bm_online_deadline_runtime_guard": "supabase/bm_online_trade_deadline_phase2d2d.sql",
  "bm_online_all_star_runtime_guard": "supabase/bm_online_all_stars_phase2d2e.sql",
  "bm_online_veteran_extension_runtime_guard": "supabase/bm_online_veteran_extensions_phase2d2f.sql",
  "bm_online_postseason_runtime_guard_phase2d3a": "supabase/bm_online_playin_phase2d3a.sql",
  "bm_online_draft_runtime_guard_phase2e2": "supabase/bm_online_draft_rights_and_live_draft_phase2e2.sql",
  "bm_online_rookie_signing_guard_phase2e3a": "supabase/bm_online_rookie_signings_phase2e3a.sql",
  "bm_online_retirement_runtime_guard_phase2e3b": "supabase/bm_online_retirements_phase2e3b.sql"
};
function stripSqlLiteralsAndComments(s){
 return s.replace(/--[^\n]*/g,'').replace(/'(?:''|[^'])*'/g,"''");
}
test('27 recovered functions still have authoritative SQL source definitions',()=>{
 assert.equal(Object.values(functions).reduce((n,a)=>n+a.length,0),27);
 for(const [file,names] of Object.entries(functions)){
  const s=sources[file];assert.ok(s,`Missing ${file}`);
  for(const name of names)assert.match(s,new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`,'i'),`${file}: ${name}`);
 }
});
test('nine recovered trigger bindings remain present in source migrations',()=>{
 assert.equal(Object.keys(triggers).length,9);
 for(const [name,file] of Object.entries(triggers))
   assert.match(sources[file],new RegExp(`\\bcreate\\s+trigger\\s+${name}\\b`,'i'),`${file}: ${name}`);
});
test('SQL uses function-call syntax compatible with qualified pg_catalog functions',()=>{
 for(const [file,s] of Object.entries(sources)){
   const code=stripSqlLiteralsAndComments(s);
   assert.doesNotMatch(code,/\bpg_catalog\.coalesce\s*\(/i,`${file}: COALESCE is an SQL expression, not a schema-qualified function`);
   assert.doesNotMatch(code,/\bpg_catalog\.substring\s*\([^;]*?\bfrom\s+\d/ig,`${file}: qualified SUBSTRING with FROM is invalid`);
   assert.doesNotMatch(code,/\bpg_catalog\.extract\s*\([^;]*?\bfrom\s+/ig,`${file}: qualified EXTRACT with FROM is invalid`);
 }
});
test('runtime guard CASE expressions are parenthesized and veteran loop is balanced',()=>{
 const vet=sources['supabase/bm_online_veteran_extensions_phase2d2f.sql'];
 const play=sources['supabase/bm_online_playin_phase2d3a.sql'];
 assert.match(vet,/v_prior\.action_type is distinct from \(case when/i);
 assert.match(vet,/p_date is distinct from \(case when/i);
 assert.match(play,/winner,side}' is distinct from \(case when/i);
 const f=vet.match(/create or replace function public\.bm_online_commit_extension_phase2d2f\([\s\S]*?as \$\$([\s\S]*?)\$\$;/i);
 assert.ok(f,'Missing veteran contract extension function');
 const code=stripSqlLiteralsAndComments(f[1]);
 const all=(code.match(/\bloop\b/gi)||[]).length;
 const closes=(code.match(/\bend\s+loop\b/gi)||[]).length;
 assert.equal(all-closes,closes,`Veteran extension has mismatched LOOP / END LOOP (${all-closes} vs ${closes})`);
});
test('coach-gameplan CASE bounds remain parser-safe',()=>{
 const s=sources['supabase/bm_online_coach_gameplans_phase2d2b.sql'];
 assert.match(s,/v_minutes\s*<\s*\(case when v_idx<=5 then 1 else 0 end\)/i);
 assert.match(s,/v_minutes\s*>\s*\(case when v_idx<=5 then 48 else 47 end\)/i);
});
