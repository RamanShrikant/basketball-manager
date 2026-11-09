import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readOnlineGames,readOnlineBracket,readOnlineSeasonYear} from '../src/online/onlineSeasonReadModel.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>readFileSync(path.join(root,p),'utf8');
const app=read('src/online/OnlineFranchise.jsx');
const s=read('src/online/OnlineSeasonSchedule.jsx');
const p=read('src/online/OnlinePlayoffPicturePreview.jsx');
assert(app.includes('"/calendar":OnlineSeasonSchedule'));
assert(app.includes('"/playoff-picture":OnlinePlayoffPicturePreview'));
for(const [name,src] of [['Schedule',s],['Playoff Picture',p]]){
  assert(!/\b(?:localStorage|sessionStorage|indexedDB|GameContext|scheduleStorage|saveSchedule|simulateGames|setLeagueData)\b/.test(src), `${name} must not use single-player storage/simulation`);
  for(const match of src.matchAll(/\b(?:from\s*|import\s*)['"](\.{1,2}\/[^'"\n]+)['"]/g)){
    const target=path.resolve(root,'src/online',match[1]);
    assert([target,`${target}.js`,`${target}.jsx`,`${target}.mjs`,`${target}.css`].some(existsSync), `${name}: missing direct dependency ${match[1]}`);
  }
}
assert.deepEqual(readOnlineGames({schedule:{byDate:{'2026-10-21':[{id:'a',home:'Celtics',away:'Nets'}]}},results:{a:{homeScore:5,awayScore:2}}}),[], 'Never read SP schedule or results');
assert.equal(readOnlineBracket({postseason:{conferences:{East:{}}}}),null, 'Never fall back to SP playoffs');
const f={onlineSchedule:{byDate:{'2026-10-21':[{id:'A',home:'Celtics',away:'Nets'},{id:'B',home:'Hawks',away:'Bulls'}],'bad':[{}]}},onlineResults:{A:{homeScore:110,awayScore:108}}};
const games=readOnlineGames(f);assert.equal(games.length,2);assert.equal(games[0].played,true);assert.equal(games[0].homeScore,110);assert.equal(games[1].played,false);
assert.equal(readOnlineSeasonYear({seasonYear:2026}),2026);
assert.equal(readOnlineBracket({onlinePostseason:{conferences:{East:{}}}})?.conferences?.East!==undefined,true);
const css=read('src/online/online-season.css');assert(css.includes('.bmOnlineSeasonPage'));assert(css.includes('.bmOnlineSeasonEmpty'));
console.log('PASS: online-only Schedule and Playoff Picture routes, no SP data, all imports resolved, model behavior verified');
