// Run with: node scripts/online-home-polish.regression.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const get = p => readFileSync(new URL('../'+p, import.meta.url),'utf8');
const home=get('src/online/OnlineHome.jsx');
const css=get('src/online/online.css');
assert(home.includes('className="on-page on-online-home"'),'Online home gets compact one-page wrapper');
assert(home.includes('className="on-back-link"'),'Back button exists');
assert(home.includes('navigate("/game-modes")'),'Back button returns to game modes');
assert(home.includes('className="on-grid on-home-grid"'),'Home grid class added');
assert(css.includes('.on-home-topline{'),'Home topline styling added');
assert(css.includes('.on-online-home{min-height:calc(100vh - 74px)'), 'One-screen layout installed');
assert(css.includes('.on-primary{background:#141414;color:#ffb178;border-color:#5a4333}'),'Primary buttons use dark surface with orange text');
assert(css.includes('.on-kicker{color:#ffa365'),'Orange text accent restored');
assert(!css.includes('.on-primary{background:#e1e1e1;color:#111'),'Old white primary buttons removed');
console.log('PASS: Online home has back nav, orange text accents, and compact one-screen layout');
