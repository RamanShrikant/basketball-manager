import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../../frontend/public/python/',import.meta.url);
test('trusted rookie contract engine copies are exactly the finished single-player Python files',()=>{
 for(const f of ['team_roster_logic.py','league_financials.py']){
  const original=readFileSync(new URL(f,root));
  const copy=readFileSync(new URL(`../online_rookie_python/${f}`,import.meta.url));
  const sha=b=>createHash('sha256').update(b).digest('hex');
  assert.equal(sha(copy),sha(original),f);
 }
});
test('only online code and guarded official migration are wired; never local save loaders',()=>{
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const handler=readFileSync(new URL('../onlineRookieSignings.js',import.meta.url),'utf8');
 const room=readFileSync(new URL('../../frontend/src/online/OnlineRookieSignings.jsx',import.meta.url),'utf8');
 assert.match(app,/api\/online\/rookies\/resolve-cpu/);
 assert.match(handler,/const target=kind==='sign'\?\[session.mine\]/);
 assert.match(handler,/new Set\(session.members.map/);
 assert.match(handler,/verifyChanges\(session.state,result.actions,target\)/);
 for(const name of ['localStorage','setLeagueData','saveLeagueData','../context/GameContext','leagueSaves'])assert.ok(!room.includes(name));
});
