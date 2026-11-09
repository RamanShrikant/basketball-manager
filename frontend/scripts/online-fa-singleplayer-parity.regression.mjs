import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'src/online/OnlineFreeAgencyPreview.jsx'),'utf8');
const original=fs.readFileSync(path.join(root,'src/pages/FreeAgents.jsx'),'utf8');
const css=fs.readFileSync(path.join(root,'src/online/online.css'),'utf8');
const originalCss=fs.readFileSync(path.join(root,'src/pages/FreeAgents.module.css'),'utf8');
const requiredMarkup=[
  'styles.freeAgentsPage','styles.viewportShell','styles.tableViewport',
  'PlayerPortraitFrame','PlayerRatingRing','bg-neutral-800/95 backdrop-blur-md',
  'min-w-[1400px] w-max','sticky top-0 z-20 bg-neutral-800',
  'bg-orange-600 text-white','Offer Contract','Player Card','Unsigned Free Agent',
  '3PT','MID','CLOSE','FT','BALL','PASS','PER D','INS D','BLK','STL','REB','ATH','OIQ','DIQ',
];
for(const needle of requiredMarkup){
  assert(source.includes(needle),`Online view lost a single-player visual: ${needle}`);
  assert(original.includes(needle) || ['styles.freeAgentsPage','styles.viewportShell','styles.tableViewport','PER D','INS D','RE B'].includes(needle),`Single-player baseline lacks expected token: ${needle}`);
}
assert(source.includes("import styles from '../pages/FreeAgents.module.css'"));
assert(originalCss.includes('.tableViewport::-webkit-scrollbar-thumb'));
assert(css.includes('BM Online Free Agency — presentation parity'));
assert(css.includes(':has(.bmOnlineFaRoot)'));
assert(source.includes('signOnlineCapRoomContract'));
assert(source.includes('buildLegalFreeAgentSalarySchedule'));
assert(source.includes('offerYears'));
assert(source.includes('optionType'));
assert(source.includes('expectedRevision:attempt.revision'));
assert(source.includes('onAccepted'));
assert(!source.includes('saveLeagueData('));
assert(!source.includes('loadLeagueData('));
assert(!source.includes('localStorage.'));
assert(!source.includes('sessionStorage.'));
assert(!/import\s*\{[^}]*GameProvider|<GameProvider\b/.test(source));
assert(!source.includes("from '../context/GameContext"));
assert(!source.includes("from '../pages/FreeAgents.jsx'"));
assert(!source.includes('simEngine.signFreeAgent'));
assert(!source.includes('setLeagueData('));
console.log('PASS: Original single-player visual classes and complete ratings table mirrored in Online');
console.log('PASS: authoritative revisioned signing retained; browser saves, GameProvider and local simulation isolated');
