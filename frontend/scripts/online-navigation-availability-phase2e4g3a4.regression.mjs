import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve, dirname} from "node:path";
import {ONLINE_PENDING_VIEW_PATHS, isOnlinePendingView} from "../src/online/onlineNavigationAvailability.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src/online");
const sidebar = readFileSync(resolve(root, "OnlineBmSidebar.jsx"), "utf8");
const franchise = readFileSync(resolve(root, "OnlineFranchise.jsx"), "utf8");
const css = readFileSync(resolve(root, "online.css"), "utf8");
const sourceRoutes = [...sidebar.matchAll(/\["[^"]+","(\/[^"]+)","[^"]+"\]/g)].map(m=>m[1]);
const onlineScreenObject = franchise.split('const ONLINE_READ_ONLY_SCREENS = {')[1]?.split('};')[0];
const implemented = [...onlineScreenObject.matchAll(/"(\/[^"]+)"\s*:/g)].map(m=>m[1]);
test("all sidebar destinations have explicit online availability", () => {
  assert.ok(onlineScreenObject, "online route mapping missing");
  assert.equal(sourceRoutes.length, 29);
  assert.equal(new Set(sourceRoutes).size, sourceRoutes.length);
  assert.deepEqual(sourceRoutes.filter(p=>!implemented.includes(p)).sort(), [...ONLINE_PENDING_VIEW_PATHS].sort());
  assert.equal(ONLINE_PENDING_VIEW_PATHS.length, 9);
});
test("pending routes cannot be clicked as available Link items", () => {
  assert.match(sidebar, /if \(isOnlinePendingView\(path\)\) return <span/);
  assert.match(sidebar, /aria-disabled="true"/);
  assert.match(sidebar, /bmOnlineNavSoon/);
  assert.match(sidebar, /return <Link key=\{path\}/);
  assert.ok(ONLINE_PENDING_VIEW_PATHS.every(isOnlinePendingView));
  assert.equal(isOnlinePendingView("/trades"), false);
  assert.equal(isOnlinePendingView("/next-season"), false);
});
test("direct deep links remain recoverable and do not open single-player", () => {
  assert.match(franchise, /isOnlinePendingView\(view\)/);
  assert.match(franchise, /Return to Team Hub/);
  assert.match(franchise, /to="\/online"/);
  assert.match(franchise, /shared franchise has not been changed/);
  assert.doesNotMatch(sidebar, /to="\/playoff-stats"/);
});
test("online-only styling has small-screen and screen reader treatment", () => {
  assert.match(css, /bmOnlineNavUnavailable/);
  assert.match(css, /bmOnlineNavLabelText/);
  assert.match(css, /@media \(max-width:1180px\)/);
  assert.match(sidebar, /aria-label="Basketball Manager Online navigation"/);
});
