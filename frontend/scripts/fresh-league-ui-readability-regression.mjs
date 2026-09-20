import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const play = read("src/pages/Play.jsx");
const editor = read("src/pages/LeagueEditor.jsx");

for (const key of [
  "bm_league_clock_v1",
  "bm_trade_deadline_status_v1",
  "bm_calendar_current_date_v1",
  "bm_calendar_cursor_date_v1",
  "bm_calendar_sim_cursor_v1_",
  "bm_trade_deadline_handled_v1_",
]) {
  assert.match(play, new RegExp(key), `New-league startup reset must clear ${key}.`);
  assert.match(editor, new RegExp(key), `League import reset must clear ${key}.`);
}
assert.match(play, /runtimePrefixes\.some\(\(prefix\) => key\.startsWith\(prefix\)\)/);
console.log("PASS fresh_league.trade_runtime_reset");

const playoffCss = read("src/pages/PlayoffPicture.module.css");
assert.match(playoffCss, /position:\s*relative/);
assert.match(playoffCss, /height:\s*var\(--bm-route-height, 100dvh\)/);
assert.doesNotMatch(playoffCss, /position:\s*fixed/);
assert.doesNotMatch(playoffCss, /inset:\s*0 0 48px 0/);
console.log("PASS playoff_picture.sidebar_safe_canvas");

const locker = read("src/pages/LockerRoom.jsx");
assert.match(locker, /locker-room-detail-scroll/);
assert.match(locker, /xl:grid-cols-\[450px_minmax\(0,1fr\)\]/);
assert.match(locker, /overflow-y-auto p-3 pr-2/);
assert.doesNotMatch(locker, /grid-rows-\[164px_minmax\(0,1fr\)\]/);
assert.doesNotMatch(locker, /auto-rows-fr grid-cols-2 gap-2 xl:grid-cols-3/);
console.log("PASS locker_room.readable_scroll_flow");

const intel = read("src/pages/Intel_v1.jsx");
assert.match(intel, /bm-intel-scroll min-h-0 overflow-y-auto pr-1/);
assert.match(intel, /min-h-\[138px\]/);
assert.match(intel, /xl:grid-cols-2/);
assert.match(intel, /xl:col-span-2/);
assert.doesNotMatch(intel, /grid-rows-\[102px_1fr\]/);
assert.doesNotMatch(intel, /grid-rows-\[208px_1fr\]/);
assert.doesNotMatch(intel, /grid-rows-\[168px_1fr\]/);
console.log("PASS team_intel.readable_scroll_flow");

console.log("Fresh-league/UI readability regression passed: 4/4 checks.");
