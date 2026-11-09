// Phase 2E.1 — source-contract regressions for online-only Draft Lottery.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const current=[
 '../src/online/OnlineDraftLottery.jsx',
 '../src/online/OnlineFranchise.jsx',
 '../src/online/OnlineBmSidebar.jsx',
 '../src/online/OnlinePlayoffPicturePreview.jsx',
];
for(const relative of current){
 const source=read(relative);
 assert.ok(source.length>100,`${relative} must be present`);
}
const draft=read('../src/online/OnlineDraftLottery.jsx');
const franchise=read('../src/online/OnlineFranchise.jsx');
const sidebar=read('../src/online/OnlineBmSidebar.jsx');
const playoffs=read('../src/online/OnlinePlayoffPicturePreview.jsx');
assert.match(franchise,/"\/draft-lottery":OnlineDraftLottery/);
assert.match(sidebar,/"Draft Lottery","\/draft-lottery"/);
assert.match(playoffs,/Continue to NBA Draft Lottery/);
for(const contract of ["onlineDraftLottery","onlinePostseasonRequestId","onAccepted","isHost","expectedRevision","lobbyId","requestId","Draft Lottery"]){
 assert.ok(draft.includes(contract),`missing online-only draft contract ${contract}`);
}
assert.ok(!draft.includes('localStorage')&&!draft.includes('setLeagueData')&&!draft.includes('../context/GameContext'));
assert.match(draft,/Only|host|HOST/);
assert.match(draft,/Pending settlement/);
assert.ok(draft.includes('leagueData?.onlinePostseason'));
assert.match(draft,/originalTeamName|Originating franchise/);
console.log('PASS: draft navigation, ownership warning, server auth, and storage isolation');
