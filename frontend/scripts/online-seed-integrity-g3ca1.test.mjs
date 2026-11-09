import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateOnlineStartingSeed,normalizeOnlineTeamLayout} from '../src/online/onlineSeedIntegrity.mjs';

const baseline=JSON.parse(readFileSync(new URL('../public/defaults/default_roster.json',import.meta.url),'utf8'));
const fresh=()=>structuredClone(baseline);
const bad=(seed,pattern)=>assert.throws(()=>validateOnlineStartingSeed(seed),pattern);

test('bundled 2026 NBA seed is a valid playable 30-team, 2027 draft starting universe',()=>{
 const s=validateOnlineStartingSeed(baseline);
 assert.equal(s.conferences.East.length,15);
 assert.equal(s.conferences.West.length,15);
 assert.equal(s.conferences.East.reduce((sum,t)=>sum+t.players.length,0)+s.conferences.West.reduce((sum,t)=>sum+t.players.length,0),439);
 assert.equal(s.freeAgents.length,201);
 assert.notEqual(s,baseline); // no mutation
});
test('flat valid custom upload is converted to canonical East/West without a second teams copy',()=>{
 const s=fresh();s.teams=[...s.conferences.East,...s.conferences.West]; delete s.conferences;
 const normalized=validateOnlineStartingSeed(s);
 assert.equal('teams' in normalized,false);
 assert.equal(normalized.conferences.East.length,15);
 assert.equal(normalized.conferences.West.length,15);
 assert.equal(s.teams.length,30);
});
test('custom team names are allowed when NBA division/conference structure is provided',()=>{
 const s=fresh(); const t=s.conferences.East[0];
 const old=t.name; t.name='Markham Meteorites';
 for(const p of t.players) if(p.rights?.heldByTeam===old) p.rights.heldByTeam=t.name;
 for(const pick of s.draftPicks) if(pick.ownerTeam===old) pick.ownerTeam=t.name;
 assert.equal(validateOnlineStartingSeed(s).conferences.East[0].name,t.name);
});
test('reject 30 name-only teams even though the older lobby name-only check accepted them',()=>{
 const s={seasonYear:2026,conferences:{East:[],West:[]},freeAgents:[],draftPicks:[]};
 for(let i=0;i<15;i++){s.conferences.East.push({name:`Fake East ${i}`,division:'Atlantic'});s.conferences.West.push({name:`Fake West ${i}`,division:'Pacific'});}
 bad(s,/8–20 standard players/);
});
test('reject a team with fewer than eight players',()=>{const s=fresh();s.conferences.East[0].players.length=7;bad(s,/8–20/);});
test('reject duplicate player IDs across teams',()=>{const s=fresh();s.conferences.East[0].players[0].id=s.conferences.West[0].players[0].id;bad(s,/duplicate player ID/);});
test('reject duplicate ID between team and free-agent pool',()=>{const s=fresh();s.freeAgents[0].id=s.conferences.East[0].players[0].id;bad(s,/duplicate player ID/);});
test('reject two identical active player names on one roster',()=>{const s=fresh();s.conferences.East[0].players[1].name=s.conferences.East[0].players[0].name;bad(s,/duplicate active player name/);});
test('reject invalid player skill vectors',()=>{const s=fresh();s.conferences.East[0].players[0].attrs=[99];bad(s,/15 valid skill ratings/);});
test('reject missing salary years for rostered players',()=>{const s=fresh();s.conferences.East[0].players[0].contract=null;bad(s,/invalid contract/);});
test('reject expired contracts at franchise start',()=>{const s=fresh();s.conferences.East[0].players[0].contract={startYear:2020,salaryByYear:[123456]};bad(s,/does not cover/);});
test('reject invalid salary',()=>{const s=fresh();s.conferences.East[0].players[0].contract.salaryByYear=[-1];bad(s,/invalid contract/);});
test('reject missing free-agent array',()=>{const s=fresh();delete s.freeAgents;bad(s,/freeAgents/);});
test('reject missing draft-pick ledger',()=>{const s=fresh();delete s.draftPicks;bad(s,/draftPicks/);});
test('reject incomplete first-year draft',()=>{const s=fresh();s.draftPicks=s.draftPicks.filter(p=>p.year!==2027).concat(s.draftPicks.filter(p=>p.year===2027).slice(0,4));bad(s,/at least 60/);});
test('reject ghost draft-pick owners',()=>{const s=fresh();s.draftPicks[0].ownerTeam='Ghost Franchise';bad(s,/non-league owner/);});
test('reject missing NBA season calendar',()=>{const s=fresh();delete s.calendar;bad(s,/calendar must contain/);});
test('reject invalid calendar dates',()=>{const s=fresh();s.calendar.regularSeasonStart='2026-13-99';bad(s,/calendar must contain/);});
test('reject missing salary-cap financial setup',()=>{const s=fresh();delete s.financials;bad(s,/financials/);});
test('reject duplicate pick rights',()=>{const s=fresh();s.draftPicks[1].id=s.draftPicks[0].id;bad(s,/duplicate draft-pick/);});
test('reject duplicate team names ignoring case',()=>{const s=fresh();s.conferences.East[1].name=s.conferences.East[0].name.toUpperCase();bad(s,/duplicate team name/);});
test('reject wrong team count',()=>{const s=fresh();s.conferences.East.pop();bad(s,/15 Eastern/);});
test('reject incorrect division assignment',()=>{const s=fresh();s.conferences.East[0].division='Pacific';bad(s,/valid East NBA division/);});
test('reject unbalanced divisions',()=>{const s=fresh();s.conferences.East[0].division='Central';bad(s,/division must contain exactly five/);});
test('reject ambiguous flat names with no conference metadata',()=>{const s=fresh();s.teams=[...s.conferences.East,...s.conferences.West];delete s.conferences;s.teams[0].name='New Franchise A';delete s.teams[0].division;delete s.teams[0].conference;bad(s,/flat teams require East\/West/);});
test('reject flat + conference split-brain',()=>{const s=fresh();s.teams=[...s.conferences.East,...s.conferences.West];bad(s,/either teams or conferences/);});
test('reject unsupported starting season',()=>{const s=fresh();for(const key of ['seasonYear','seasonStartYear','currentSeasonYear']) s[key]=2029;bad(s,/supported start year/);});
test('read-only view compatibility normalizes a valid legacy flat league without mutating the input',()=>{const s=fresh();s.teams=[...s.conferences.East,...s.conferences.West];delete s.conferences;const c=normalizeOnlineTeamLayout(s);assert.equal(c.conferences.West.length,15);assert.equal('conferences' in s,false);});
test('ambiguous legacy flat layout is left unchanged rather than guessing conference data',()=>{const s={teams:[{name:'Unknown'}]};assert.equal(normalizeOnlineTeamLayout(s),s);});
test('upload, launch, and online-only read provider are wired into the validator',()=>{
 const get=p=>readFileSync(new URL(`../src/online/${p}`,import.meta.url),'utf8');
 assert.match(get('onlineApi.js'),/validateOnlineStartingSeed\(roster\)/);
 assert.match(get('onlineFranchiseApi.js'),/validateOnlineStartingSeed\(await loadHostSeed\(lobby\)\)/);
 assert.match(get('onlineReadOnlyContext.jsx'),/leagueData: normalizeOnlineTeamLayout\(seed\)/);
});
test('authoritative SQL blocks invalid INSERT and preserves original RPC body',()=>{
 const sql=readFileSync(new URL('../../supabase/BM_G3C_A1_SEED_INTEGRITY_MANUAL.sql',import.meta.url),'utf8');
 assert.match(sql,/BEFORE INSERT ON public\.bm_online_franchises/);
 assert.match(sql,/NEW\.seed_state:=s/);
 assert.match(sql,/8–20 standard players/);
 assert.match(sql,/first_picks < 60/);
 assert.match(sql,/SECURITY DEFINER SET search_path = ''/);
 assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION public\.bm_launch_online_franchise/i);
});
