import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const app=read('src/online/OnlineFranchise.jsx');
const coach=read('src/online/OnlineCoachGameplanPreview.jsx');
const free=read('src/online/OnlineFreeAgencyPreview.jsx');
const css=read('src/online/online.css');
assert.match(app,/"\/coach-gameplan":OnlineCoachGameplanPreview/);
assert.match(app,/"\/free-agents":OnlineFreeAgencyPreview/);
assert.match(css,/PHASE 2B4B ONLINE COACH AND FREE AGENCY/);
for(const [name,src] of [['Coach',coach],['Free Agency',free]]){
  assert.match(src,/from '\.\/onlineReadOnlyContext\.jsx'/,`${name}: Online-only provider`);
  assert.doesNotMatch(src,/\b(?:localStorage|sessionStorage|indexedDB)\s*\./,`${name}: no SP saves`);
  assert.doesNotMatch(src,/\.\s*(?:rpc|insert|update|upsert|delete)\s*\(/,`${name}: no DB mutation`);
  assert.doesNotMatch(src,/from\s+["']\.\.\/(?:context\/GameContext|utils\/leagueStorage|api\/simEngine)/,`${name}: no SP persistence`);
}
assert.match(coach,/projectedRotation/);
assert.match(coach,/saveOnlineCoachGameplan/,'Online coach submits through authoritative server client');
assert.match(coach,/onAccepted\?\.\(\)/,'Online coach refreshes shared state after successful save');
assert.match(coach,/Reload shared state/,'Online coach offers stale-plan recovery');
assert.match(coach,/Saving…'\s*:\s*'Save Gameplan'/,'Online coach save is no longer a placeholder');
assert.match(free,/leagueData/);
assert.match(free,/signOnlineCapRoomContract/);
assert.match(free,/Sign Player/);
const files=['src/online/OnlineCoachGameplanPreview.jsx','src/online/OnlineFreeAgencyPreview.jsx','src/online/OnlineFranchise.jsx'];
let count=0;
for(const f of files){
 const source=read(f);
 const base=dirname(resolve(root,f));
 for(const m of source.matchAll(/(?:\bfrom\s*|\bimport\s*)["'](\.{1,2}\/[^"']+)["']/g)){
   const target=resolve(base,m[1]);
   const options=[target,...['.js','.jsx','.mjs','.css','.module.css','.ts','.tsx'].map(x=>target+x),resolve(target,'index.js'),resolve(target,'index.jsx')];
   assert(options.some(existsSync),`Missing ${f}: ${m[1]}`);count++;
 }
}
console.log(`PASS: authoritative Coach & Free Agency routes, no SP persistence or direct DB writes, ${count} imports resolved`);
