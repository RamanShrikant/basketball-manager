import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../src/online/online.css', import.meta.url), 'utf8');
assert(css.includes('Online diagonal-only pass: remove court-shape overlays and use the clean BM diagonal grid everywhere.'), 'diagonal-only css block exists');
assert(css.includes('repeating-linear-gradient(45deg'), 'uses diagonal grid background');
assert(css.includes('.on-header,\n.on-page,\n.on-online-home,\n.on-drawer{'), 'extends background treatment through header/page/drawer');
assert(css.includes('.on-online-home .on-panel,\n.on-online-home .on-existing-lobby,\n.on-online-home .on-info,\n.on-drawer,\n.on-profile-box{'), 'online panels and social drawer receive diagonal-only surfaces');
console.log('PASS: online diagonal-only pass installed');
