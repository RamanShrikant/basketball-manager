import assert from 'node:assert/strict';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const get = x => readFileSync(path.join(root,x),'utf8');
const app=get('src/online/OnlineFranchise.jsx');
assert(app.includes('"/power-rankings":OnlinePowerRankings'), 'power rankings route is online');
assert(app.includes('"/player-stats":OnlinePlayerStats'), 'stats route is online');
assert(app.includes('data-online-read-only="true"'), 'Online read-only shell retained');
const pages=['OnlinePlayerStats','OnlinePowerRankings'];
for(const page of pages){
 const file='src/online/'+page+'.jsx';
 const src=get(file);
 assert(src.includes('PHASE 2B4A ONLINE STATS AND POWER RANKINGS'),`${page}: built from verified single-player screen`);
 assert(src.includes('onlineReadOnlyContext.jsx'),`${page}: isolated provider`);
 assert(src.includes('useOnlineRouteNav()'),`${page}: isolated navigation`);
 assert(src.includes('onlineInertStorage.js'),`${page}: in-memory preferences`);
 assert(!/\b(localStorage|sessionStorage|indexedDB)\b/.test(src),`${page}: no browser persistence`);
 assert(!src.includes('from "../context/GameContext"'),`${page}: no single-player context`);
 assert(!src.includes('from "../utils/scheduleStorage.js"'),`${page}: no single-player schedule storage`);
 const imports=[...src.matchAll(/\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g)].map(m=>m[1]);
 for(const item of imports){
   const base=path.resolve(root,'src/online',item);
   const variants=[base,base+'.js',base+'.jsx',base+'.ts',base+'.tsx',base+'.css',base+'.module.css',path.join(base,'index.js'),path.join(base,'index.jsx')];
   assert(variants.some(x=>existsSync(x) && statSync(x).isFile()),`${page}: missing direct import ${item}`);
 }
}
const stats=get('src/online/OnlinePlayerStats.jsx');
assert(stats.includes('leagueData?.onlinePlayerStats || {}'),'Stats must use online player statistics');
assert(stats.includes('leagueData?.onlineSchedule?.byDate || {}'),'Stats must use online calendar');
assert(stats.includes('leagueData?.onlineResults || {}'),'Stats must use online results');
assert(!stats.includes('readCanonicalRegularPlayerStatsMap'),'Stats must not invoke single-player stats reader');
assert(!stats.includes('PlayerCardModal'),'Stats must not load storage-bound player modal');
const power=get('src/online/OnlinePowerRankings.jsx');
assert(power.includes('buildRecordMap(leagueData)'),'rankings derive records from online snapshot');
assert(power.includes('leagueData?.onlineResults || {}'),'rankings use online results');
console.log('PASS: Online Stats and Power Rankings use original UI, isolated shared state, no direct persistent browser writes and fully resolved direct imports');
