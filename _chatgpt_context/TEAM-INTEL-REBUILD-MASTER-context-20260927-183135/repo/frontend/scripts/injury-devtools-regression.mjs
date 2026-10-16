import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { areDevToolsEnabled, withDevToolsEnabled } from '../src/utils/devTools.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n?/g, '\n');

const play = read('src/pages/Play.jsx');
const calendar = read('src/pages/Calendar.jsx');
const playoffs = read('src/pages/Playoffs.jsx');
const offseason = read('src/pages/OffseasonHub.jsx');
const offers = read('src/pages/ViewingOffers.jsx');
const lottery = read('src/pages/DraftLottery.jsx');
const scanner = read('src/components/CpuTradeDiscoveryPanel.jsx');

const checks = [];
const check = (ok, id, detail) => checks.push({ status: ok ? 'PASS' : 'FAIL', id, detail });

check(areDevToolsEnabled(null) === false, 'dev.unloaded_state_off', 'Dev controls stay hidden until an actual league has loaded.');
check(areDevToolsEnabled({ settings: {} }) === true, 'dev.legacy_default_on', 'Existing saves without the setting keep their historical dev-tool visibility.');
check(areDevToolsEnabled(withDevToolsEnabled({ settings: {} }, false)) === false, 'dev.new_off_persists', 'League-level OFF is authoritative.');
check(areDevToolsEnabled(withDevToolsEnabled({ settings: {} }, true)) === true, 'dev.new_on_persists', 'League-level ON is authoritative.');
check(
  play.includes('const [devToolsEnabled, setDevToolsEnabled] = useState(false);') &&
  play.includes('nextLeagueData = withDevToolsEnabled(nextLeagueData, devToolsEnabled);') &&
  play.includes('role="switch"') && play.includes('Developer Tools'),
  'dev.new_league_toggle_default_off',
  'New League exposes an explicit toggle, defaults OFF, and stamps the selected value into leagueData before the save is created.'
);
check(
  calendar.includes('{devToolsEnabled && (') &&
  calendar.includes('{devToolsEnabled && DEV_QUICK_SIM_TOOLS && (') &&
  playoffs.includes('{devToolsEnabled && (') && playoffs.includes('Dev Instant Playoffs') &&
  offseason.includes('{devToolsEnabled && (') &&
  offers.includes('{devToolsEnabled && (') &&
  lottery.includes('{devToolsEnabled && (') &&
  scanner.includes('if (!devToolsEnabled) return null;'),
  'dev.visible_surfaces_gated',
  'All currently visible developer shortcut surfaces are gated by the per-league setting.'
);
check(
  playoffs.includes('const PENDING_POSTSEASON_SIM_INTENT_KEY = "bm_pending_postseason_sim_v1";') &&
  playoffs.includes('pausedReason: "injury_alert"') &&
  playoffs.includes('Resume the postseason simulation from the next unplayed game.'),
  'injury.postseason_persistent_resume',
  'Postseason injury interruptions persist a resumable intent and expose a Resume Simulation banner after navigation.'
);
check(
  playoffs.includes('if (showUserPostseasonInjuryAlert(recovery.events)) {\n      return POSTSEASON_INJURY_PAUSE_RESULT;') &&
  playoffs.includes('if (showUserPostseasonInjuryAlert(recovery.events)) return false;'),
  'injury.return_stops_before_game',
  'Both playoff and play-in return events stop before the scheduled game is simulated.'
);
check(
  !/async function simOneSafe[\s\S]*?recoverPlayersForDate\(leagueData, currentDate\);[\s\S]*?const multiYearCloneStartedAt/.test(playoffs),
  'injury.no_duplicate_recovery_inside_worker_path',
  'Postseason recovery is performed once at the outer checkpoint instead of again inside simOneSafe.'
);
check(
  playoffs.includes('if (stopRequestedRef.current) break;\n        await simPlayInGameInCur') &&
  playoffs.includes('if (stopRequestedRef.current) break;\n        await new Promise'),
  'injury.playin_same_date_stops_after_alert',
  'Play-in one-day simulation does not continue into another same-date game after a user injury alert.'
);
check(
  playoffs.includes('onAdjustManually={() => {') &&
  playoffs.includes('navigate("/coach-gameplan");') &&
  !playoffs.includes('onAdjustManually={() => {\n            setPostseasonInjuryAlert(null);\n            postseasonResumeIntentRef.current = null;'),
  'injury.manual_adjust_keeps_resume_intent',
  'Manual postseason rotation adjustment no longer discards the paused simulation intent.'
);
check(
  playoffs.includes('persistPostseasonSimIntent({ mode: "one_day" });') &&
  playoffs.includes('persistPostseasonSimIntent({ mode: "round" });') &&
  playoffs.includes('persistPostseasonSimIntent({ mode: "playoffs" });') &&
  playoffs.includes('persistPostseasonSimIntent({ mode: "playin_all" });'),
  'injury.all_primary_postseason_batch_modes_resumable',
  'One-day, play-in, round, and full-playoff batch operations can all resume after an injury interruption.'
);

console.table(checks);
const failed = checks.filter((row) => row.status === 'FAIL');
if (failed.length) {
  console.error(`Injury/dev-tools regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Injury/dev-tools regression passed: ${checks.length}/${checks.length} checks.`);
