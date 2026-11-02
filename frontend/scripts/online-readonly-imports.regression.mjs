import assert from 'node:assert/strict';
import {readFileSync, existsSync, statSync} from 'node:fs';
import {dirname, resolve, extname} from 'node:path';
import {fileURLToPath} from 'node:url';

const onlineDir=fileURLToPath(new URL('../src/online/',import.meta.url));
const originalsDir=fileURLToPath(new URL('../src/pages/',import.meta.url));
const sources=['OnlineRosterView.jsx','OnlineDraftPicks.jsx','OnlineSalaryTable.jsx','OnlineStandings.jsx'];

function resolves(from, spec) {
  const abs=resolve(dirname(from), spec);
  const candidates=[abs, `${abs}.js`, `${abs}.jsx`, `${abs}.mjs`, `${abs}.json`, `${abs}.css`,
    resolve(abs,'index.js'), resolve(abs,'index.jsx')];
  return candidates.some(p=>existsSync(p) && statSync(p).isFile());
}
let validated=0;
for (const filename of sources) {
  const from=resolve(onlineDir, filename);
  assert(existsSync(from), `${filename}: Online page mirror missing`);
  const code=readFileSync(from,'utf8');
  assert(code.includes('ONLINE READ-ONLY MIRROR'), `${filename}: guarded Online mirror marker missing`);
  assert(!code.includes('from "../context/GameContext"'), `${filename}: SP context not allowed`);
  const re=/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"']+)["']/g;
  for (const match of code.matchAll(re)) {
    const spec=match[1];
    // ?query options (Vite resource imports) don't affect filesystem lookup
    const raw=spec.split('?')[0];
    assert(resolves(from,raw), `${filename}: missing direct dependency ${spec}`);
    validated++;
  }
}
const rosterCSS=resolve(originalsDir,'RosterView.module.css');
const salaryCSS=resolve(originalsDir,'SalaryTable.module.css');
assert(existsSync(rosterCSS),'original RosterView.module.css missing');
assert(existsSync(salaryCSS),'original SalaryTable.module.css missing');
assert(readFileSync(resolve(onlineDir,'OnlineRosterView.jsx'),'utf8').includes('../pages/RosterView.module.css'),'roster must reuse original stylesheet');
assert(readFileSync(resolve(onlineDir,'OnlineDraftPicks.jsx'),'utf8').includes('../pages/RosterView.module.css'),'draft must reuse original stylesheet');
assert(readFileSync(resolve(onlineDir,'OnlineSalaryTable.jsx'),'utf8').includes('../pages/SalaryTable.module.css'),'salary must reuse original stylesheet');
console.log(`PASS: all ${validated} relative imports resolve across four Online read-only screens; original CSS reused`);
