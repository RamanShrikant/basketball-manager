// Phase 2C.2D-1: parity and isolation regression, no dev server required.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const get=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const original=get('src/pages/Trades.jsx');
const online=get('src/online/OnlineTrades.jsx');
const franchise=get('src/online/OnlineFranchise.jsx');
const css=get('src/online/online.css');
const sha=createHash('sha256').update(original.replace(/\r\n/g, '\n')).digest('hex');
assert(online.includes(`// ${sha}`),'mirror must track exact single-player source baseline');
for(const section of [
  'Trade Center','Team Context','Position Depth','Pick Depth','Cap Outlook',
  'Expiring Contracts','League Rumor Board','Trade Finder','Propose Trade',
  'TradeContextDetailModal','TradeOverviewPlayerRow','buildPositionDepth(',
  'buildPickDepth(','buildTeamContextAlerts(','buildTradePageStandingMap(',
  'buildCapOutlook(','buildTradeHistoryLogEntries(','tradeSearchTuningVars()',
  'tradeCenterOverviewVars('
]){
  assert(original.includes(section),`single-player missing source section: ${section}`);
  assert(online.includes(section),`online mirror missing section: ${section}`);
}
assert.match(online,/useGame, useOnlineRouteNav.*onlineReadOnlyContext/);
assert.match(online,/const navigate = useOnlineRouteNav\(\)/);
assert.match(online,/scheduleByDate: leagueData\?\.onlineSchedule\?\.byDate/);
assert.match(online,/resultsById: leagueData\?\.onlineResults/);
assert.match(online,/const storedFeed = useMemo\(\(\) => \[\], \[\]\)/);
assert.match(online,/mergeTradeDeskFeedWithLeague\(storedFeed, leagueData\)/);
assert.match(online,/const tradeWindowLocked = true/);
assert.match(online,/CPU trades, protected pick structures and swaps remain locked/i);
assert.match(online,/navigate\('\/trade-proposal'\)/);
assert.match(online,/Human GM player-and-pick offers are open/i);
assert.match(online,/navigate\('\/trade-finder'\)/);
assert.match(online,/OnlinePlayerQuickView/);
assert.doesNotMatch(online,/\b(?:localStorage|sessionStorage|indexedDB)\s*[.\[]/);
assert.doesNotMatch(online,/from ["']\.\.\/context\/GameContext/);
assert.doesNotMatch(online,/from ["']\.\.\/utils\/(?:leagueStorage|scheduleStorage)/);
assert.doesNotMatch(online,/readTradeDeskFeed\(|loadRegularSeasonResultsV3FromStorage\(|readScheduleFromStorage\(/);
assert.doesNotMatch(online,/navigate\(["']\/propose-trade["']\)/);
assert.doesNotMatch(online,/setLeagueData\(|saveLeagueData\(|executeAcceptedTradeOnLeague\(/);
assert.doesNotMatch(online,/previewContractExtensions\(/);
assert.match(franchise,/import OnlineTrades from "\.\/OnlineTrades\.jsx"/);
assert.match(franchise,/"\/trades":OnlineTrades/);
assert.match(franchise,/view==="\/trades".*Human GM offers and eligible CPU player negotiations available/);
assert.match(css,/\[data-online-view="\/trades"\]/);
console.log('PASS: exact Trade Center source parity, isolated online state, safe navigation, human ideas and CPU player negotiations via server bridge');
