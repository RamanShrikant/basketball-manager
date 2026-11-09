// Regression for the *effective* Online CSS rather than an obsolete design pass.
// The shared court SVG still exists, but the later Online diagonal-grid pass
// deliberately overrides the original curved-court background.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const css=readFileSync(new URL('../src/online/online.css',import.meta.url),'utf8');
const shared=readFileSync(new URL('../src/styles/BMPageBackground.css',import.meta.url),'utf8');
const svgPath=new URL('../src/assets/basketball-pattern.svg',import.meta.url);
assert(existsSync(svgPath),'Original shared basketball-pattern.svg must remain available');
const svg=readFileSync(svgPath,'utf8');
assert(svg.includes('<circle')&&svg.includes('<path'),'Original asset retains basketball seams');
assert(shared.includes('url("../assets/basketball-pattern.svg")'),'Single-player court asset reference must stay intact');
const original='/* BM ONLINE — exact curved court pattern from BMPageBackground.css */';
const active='/* Online diagonal-only pass: remove court-shape overlays and use the clean BM diagonal grid everywhere. */';
const originalAt=css.indexOf(original),activeAt=css.indexOf(active);
assert(originalAt>=0,'Original online curved-court style must remain present');
assert(activeAt>originalAt,'Active diagonal-only design pass must override the earlier online background');
const activeRules=css.slice(activeAt);
assert.match(activeRules,/\.on-root\s*\{\s*background-color:\s*#060606;\s*background-image:\s*linear-gradient\(/,'Diagonal grid remains the effective online root background');
assert.match(activeRules,/repeating-linear-gradient\(45deg/,'Diagonal grid has the ascending lines');
assert.match(activeRules,/repeating-linear-gradient\(-45deg/,'Diagonal grid has the descending lines');
assert.match(activeRules,/\.on-online-home \.on-panel,[\s\S]*?\.on-profile-box\s*\{\s*background-image:/,'Online panels and profile surfaces share the later background override');
console.log('PASS: current diagonal-only Online background, shared basketball SVG preserved for single-player');
