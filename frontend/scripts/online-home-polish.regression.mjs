// Run with: node scripts/online-home-polish.regression.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const get = p => readFileSync(new URL('../'+p, import.meta.url),'utf8');
const home=get('src/online/OnlineHome.jsx');
const css=get('src/online/online.css');
assert(home.includes('className="on-page on-online-home"'),'Online home gets compact one-page wrapper');
assert(home.includes('className="on-back-link"'),'Back button exists');
assert.match(home,/<Link to="\/game-modes" className="on-back-link">/,'Back link uses SPA router navigation');
assert(home.includes('className="on-grid on-home-grid"'),'Home grid class added');
assert(css.includes('.on-home-topline{'),'Home topline styling added');
assert(css.includes('.on-online-home{min-height:calc(100vh - 74px)'), 'One-screen layout installed');
assert(/\.on-primary\s*\{[^}]*background:/m.test(css),'Primary buttons retain a defined background');
assert(/\.on-kicker\s*\{[^}]*color:/m.test(css),'Section kickers retain a defined foreground');
assert(home.includes('Online franchise beta'),'Online home reflects the current shared-franchise phase');
assert(!home.includes('simulation, trades and free agency remain locked'),'Outdated locked-features claim removed');
console.log('PASS: Online home has client-side back navigation, current beta copy and compact layout');
