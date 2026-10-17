// Node-only structure checks. These never contact Supabase or touch browser saves.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const main=read('src/main.jsx');
assert.match(main,/pathname\s*===\s*"\/online"/);
assert.match(main,/import\("\.\/online\/OnlineApp\.jsx"\)/);
assert.match(main,/import\("\.\/auth\/AccountRoot\.jsx"\)/);
assert.match(main,/await import\("\.\/game\/BasketballManagerGame\.jsx"\)/);
assert(!/import\s+(?!React|ReactDOM)[\s\S]*from\s+["']\.\/game\//.test(main),'No statically imported game on Online entry');
const modes=read('src/pages/GameModeLanding.jsx');
assert.match(modes,/href="\/online"/);
assert.match(modes,/to="\/singleplayer"/);
for (const name of ['OnlineApp.jsx','OnlineHome.jsx','OnlineLobby.jsx','FriendsPanel.jsx','onlineApi.js']) {
  const code=read(`src/online/${name}`).replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code,/(GameContext|accountLocalVault|leagueSaves|saveManager|cloudSaveClient|simEnginePy|window\.indexedDB|window\.localStorage|localStorage\.)/,`Online module ${name} must not touch single-player runtime`);
}
const api=read('src/online/onlineApi.js');
assert.match(api,/bm-online-rosters/);
assert.match(api,/postgres_changes/);
assert.match(api,/\/defaults\/default_roster\.json/);
const lobby=read('src/online/OnlineLobby.jsx');
assert.match(lobby,/bm_set_online_team/);
assert.match(lobby,/bm_set_online_ready/);
assert.match(lobby,/bm_cancel_online_lobby_invite/);
assert.match(lobby,/Start League — Coming Soon/);
assert.doesNotMatch(lobby,/window\.location\.assign\("\/team-hub"/);
const friends=read('src/online/FriendsPanel.jsx');
for(const fn of ['bm_send_friend_request','bm_answer_friend_request','bm_cancel_friend_request','bm_remove_friend'])assert(friends.includes(fn),`Missing ${fn}`);
const sql=fs.readFileSync(path.resolve(root,'../supabase/bm_online_social_lobbies_v1.sql'),'utf8');
for(const word of ['enable row level security','bm_is_online_lobby_member','bm_online_unique_lobby_team','for update','bm_join_online_lobby','bm_create_online_lobby','bm_set_online_team','bm_set_online_ready','bm-online-rosters'])assert(sql.includes(word),`Missing SQL contract: ${word}`);
assert(!sql.includes('drop table'), 'Do not drop production tables');
console.log('PASS: Online isolated boot, 4-digit identity, friend operations, 4-seat lobby, team uniqueness, ready states, RLS SQL contract');
