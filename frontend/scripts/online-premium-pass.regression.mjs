// Updated to reflect replacement of synthetic Online sounds with the official game sound manager.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const get = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
const home=get('src/online/OnlineHome.jsx');
const app=get('src/online/OnlineApp.jsx');
const css=get('src/online/online.css');
assert(!home.includes('useOnlineUiSfx'),'old synthesized sound hook disabled');
assert(app.includes('useOnlineGameSounds'),'official game sound hook installed');
assert(home.includes('className={invites.invites.length ? "on-invite-list is-scrollable" : "on-invite-list is-empty"}'),'invite list uses dynamic scroll');
assert(css.includes('Online premium pass: grid surfaces, orange scrollbar, and tighter invite styling.'),'premium styles still exist');
assert(css.includes('scrollbar-color:#e57c2f #0f0f10'),'orange scrollbar exists');
console.log('PASS: online premium styling retained and synthesized audio replaced with authentic game sounds');
