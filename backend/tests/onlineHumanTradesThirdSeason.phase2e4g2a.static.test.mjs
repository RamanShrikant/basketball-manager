import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve(import.meta.dirname,'../../supabase/bm_online_third_season_player_trades_phase2e4g2a.sql');
const sql=fs.readFileSync(file,'utf8');
const body=sql.slice(sql.indexOf('-- Add the third-season player-only'));
test('migration retains explicit authorization and atomic rollback scope',()=>{
  assert.match(sql,/^BEGIN;/m);
  assert.match(sql,/COMMIT;\s*$/);
  assert.match(sql,/G2A unexpected F1 trade-function versions; STOP/);
  assert.match(sql,/G2A unexpected 2C2D3B asset helper version; STOP/);
  assert.doesNotMatch(sql,/\b(?:DROP TABLE|TRUNCATE|DELETE FROM)\b/i);
});
test('2028 only; later seasons remain rejected',()=>{
  assert.equal((sql.match(/v_year > 2028/g)||[]).length,2);
  assert.match(sql,/Third-season trade finances require both prior season archives/);
  assert.match(sql,/Third-season player trades require both prior season archives/);
  assert.match(sql,/v_date < '2028-09-01' OR v_date >= '2029-02-05'/);
});
test('pure player 2028-29 trades bypass the old pick gate, pick trades do not',()=>{
  assert.match(body,/\(p_state->>'seasonYear'\)='2028' AND/);
  assert.match(body,/cardinality\(p_pick_ids_a\)=0 AND cardinality\(p_pick_ids_b\)=0/);
  assert.match(body,/ELSE\s+v_picks:=public\.bm_online_prepare_human_pick_trade/);
  assert.match(body,/G2A: 2028-29 human player-only trades/);
});
