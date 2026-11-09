// Online-only FA day resolution, existing Free Agents layout and no local save writes.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const page=read('src/online/OnlineFreeAgencyPreview.jsx');
const panel=read('src/online/OnlineMarketDecisionPanel.jsx');
const client=read('src/online/onlineFreeAgencyMarketClient.js');
const worker=read('../backend/online_options_python/online_free_agency_worker.py');
const server=read('../backend/onlineFreeAgency.js');
const guard=read('../backend/onlineMarketSettlement.js');
const routes=read('../backend/app.js');
for(const k of ['marketAcceptsOffers','OnlineMarketDecisionPanel','Free Agents','bmOnlineFaRoot','offseasonMarketLocked'])
 assert.ok(page.includes(k),`Free Agents visual parity or market stage is missing: ${k}`);
assert.match(panel,/data-online-market-resolution/);
for(const s of ['Resolve day','Continue next day','Match','Decline','pending','onlineOffseasonMarket'])
 assert.ok(panel.includes(s),s);
for(const action of ['resolve','decision','next']){
 assert.match(client,new RegExp(action));
 assert.ok(routes.includes(`/api/online/offseason/free-agency/${action}`),action);
}
assert.match(worker,/engine\.advance_free_agency_day/);
assert.match(worker,/engine\.process_pending_rfa_match_decision/);
assert.match(worker,/engine\.finalize_free_agent_signing_from_offer/);
assert.match(worker,/def __ne__/);
assert.match(worker,/original_pending = engine\.upsert_pending_user_decision/);
assert.match(server,/verifyMarketStep/);
assert.match(guard,/CPU resolution modified a human-owned team/);
for(const f of [page,panel,client])assert.doesNotMatch(f,/localStorage\.setItem|saveLeague\(|setLeagueData\(|updateLeagueData\(/);
assert.doesNotMatch(panel,/supabase\.rpc\(/);
console.log('PASS: C2 market resolution, human RFA/signing decisions, isolated single-player presentation');
