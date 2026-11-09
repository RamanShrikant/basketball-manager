// Phase 2C.2D-2 — static authority boundaries, no frontend/dev server.
// This DOES NOT substitute for executing the SQL in Supabase or a two-GM live test.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');
const sql=read('supabase/bm_online_human_trades_phase2c2d2.sql');
const ui=read('frontend/src/online/OnlineHumanTradeRoom.jsx');
const trades=read('frontend/src/online/OnlineTrades.jsx');
const franchise=read('frontend/src/online/OnlineFranchise.jsx');
const client=read('frontend/src/online/onlineRuntimeClient.js');
for(const part of [
  /create table if not exists public\.bm_online_trade_offers/,
  /enable row level security/,
  /revoke all on public\.bm_online_trade_offers/,
  /create policy bm_online_trade_offers_member_read/,
  /bm_is_online_lobby_member\(lobby_id\)/,
  /create or replace function public\.bm_online_prepare_human_player_trade/,
  /create or replace function public\.bm_online_offer_human_trade/,
  /create or replace function public\.bm_online_respond_human_trade/,
  /auth\.uid\(\)/,
  /for update/g,
  /v_revision<>p_expected_revision/,
  /v_actor<>v_offer\.recipient_id/,
  /v_actor<>v_offer\.proposer_id/,
  /v_count_a<>cardinality\(p_ids_a\)/,
  /v_count_b<>cardinality\(p_ids_b\)/,
  /abs\(v_salary_a-v_salary_b\)>1000/,
  /v_total_identity_count<>1/,
  /greatest\(16,v_standard_a\+1\)/,
  /greatest\(16,v_standard_b\+1\)/,
  /tradeHistory/,
  /bm_online_franchise_events/,
  /'human_trade_accepted'/,
  /v_offer\.status<>'pending'/,
  /v_offer\.proposer_player_ids/,
  /v_offer\.recipient_player_ids/,
  /v_date_lock/,
  /p_ids_a\|\|p_ids_b/,
  /2026-27 season only/,
  /recipient_player_labels/,
]) assert.match(sql,part,`Trade SQL missing: ${part}`);
for(const part of [
  /function listOnlineHumanTradeOffers|async function listOnlineHumanTradeOffers/,
  /bm_online_offer_human_trade/,
  /bm_online_respond_human_trade/,
  /p_expected_revision:positiveRevision\(expectedRevision\)/,
  /p_sending_ids:tradeIds\(sendingIds\)/,
]) assert.match(client,part);
for(const part of [
  /OnlineHumanTradeRoom/,
  /offerOnlineHumanAssetTrade/,
  /respondOnlineHumanTrade/,
  /listOnlineHumanTradeOffers/,
  /lobbyState\(lobbyId\)/,
  /await onAccepted\?\.\(\)/,
  /salaryValid/,
  /getAllowedTradeRosterMax/,
  /role="alert"/,
  /onClick=\{create\}/,
]) assert.match(ui,part);
assert.match(trades,/navigate\('\/trade-proposal'\)/);
assert.match(trades,/navigate\('\/trade-finder'\)/);
assert.match(franchise,/"\/trade-proposal":OnlineHumanTradeRoom/);
assert.doesNotMatch(ui,/\b(?:localStorage|sessionStorage|indexedDB)\s*[.\[]/);
assert.doesNotMatch(ui,/setLeagueData\(|saveLeagueData\(|executeAcceptedTradeOnLeague\(/);
assert.doesNotMatch(sql,/update\s+public\.bm_singleplayer/i);
console.log('PASS: Human-GM offer/accept transaction boundaries, readonly isolation, original first-stage SQL authorization, salary parity overlay and live-journal integration.');
console.log('NOTE: This is not full trade-engine parity, and live SQL + two-account tests remain required.');
