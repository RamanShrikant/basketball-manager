// Run with: node scripts/online-home-final-fit.regression.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css = readFileSync(new URL('../src/online/online.css', import.meta.url), 'utf8');
assert(css.includes('Online home final fit + social drawer grid treatment.'), 'final fit block exists');
assert(css.includes('.on-online-home{\n  height:calc(100vh - 74px);'), 'online home locked to viewport height');
assert(css.includes('.on-home-grid>.on-panel{display:flex;flex-direction:column;min-height:0}'), 'home panels compact flex layout exists');
assert(css.includes('.on-drawer{\n  background-color:#0f0f10;'), 'drawer line background exists');
assert(css.includes('.on-profile-box{\n  background-color:rgba(23,23,24,.92);'), 'profile box background styling exists');
console.log('PASS: online home locked to one-screen layout and social drawer gets grid background');
