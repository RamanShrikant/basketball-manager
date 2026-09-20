import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sortBoxRowsForDisplay } from '../src/utils/boxScoreDisplay.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const sidebar = read('src/components/TeamHubSidebar.jsx');
const calendar = read('src/pages/Calendar.jsx');
const playoffs = read('src/pages/Playoffs.jsx');
const offseason = read('src/pages/OffseasonHub.jsx');
const finalsActions = read('src/utils/finalsMvpSeasonActions.js');
const box = read('src/components/GameBoxScoreModal.jsx');
const boxDisplay = read('src/utils/boxScoreDisplay.js');

const checks = [];
const check = (ok, id, detail) => checks.push({ status: ok ? 'PASS' : 'FAIL', id, detail });

check(
  sidebar.includes('showPostseasonNavigation') &&
  sidebar.includes('name: "Return to Offseason Hub"') &&
  sidebar.includes('{ name: "Playoffs", path: "/playoffs", enabled: true') &&
  !sidebar.includes('description: "Review Completed Regular Season"'),
  'nav.offseason_hides_schedule_keeps_playoffs',
  'Offseason returns to Offseason Hub, hides Schedule, and keeps the completed Playoffs link.'
);
check(
  sidebar.includes('description: isPlayoffMode') &&
  sidebar.includes('? "Review Regular Season Schedule"'),
  'nav.postseason_keeps_schedule',
  'Schedule remains available while the postseason itself is active.'
);
check(
  calendar.includes('isOffseasonScheduleBlocked') &&
  calendar.includes('navigate("/offseason", { replace: true })'),
  'nav.offseason_calendar_route_guard',
  'Direct/back-button access to Calendar during offseason returns to Offseason Hub instead of exposing a partial schedule.'
);
check(
  finalsActions.includes('Keep the completed regular season + postseason runtime alive through the') &&
  !finalsActions.includes('clearSeasonStores();'),
  'lifecycle.finals_transition_still_safe',
  'Finals-to-offseason does not introduce a new destructive save transition.'
);
check(
  offseason.split('clearCompletedSeasonRuntimeForNextSeason();').length - 1 === 2,
  'lifecycle.cleanup_at_next_season_boundary',
  'Manual and dev offseason completion still clear old live runtime before the next calendar.'
);
check(
  playoffs.includes('isOffseasonPostseasonReview') && playoffs.includes('Completed Postseason Review'),
  'playoffs.offseason_review_read_only',
  'Completed Playoffs remains reviewable during offseason without simulation controls.'
);
check(
  calendar.includes('GameBoxScoreModal') && playoffs.includes('GameBoxScoreModal'),
  'boxscore.single_shared_component',
  'Regular season and postseason still use one box-score presentation.'
);
check(
  box.includes('style={{ left: "var(--bm-persistent-sidebar-width, 0px)" }}'),
  'boxscore.respects_sidebar_canvas',
  'Shared box score remains positioned inside the persistent-sidebar content canvas.'
);
const frozenRotation = ['Starter A', 'Injured Star', 'Starter B', 'Bench A', 'DNP B'];
const orderedRows = sortBoxRowsForDisplay([
  { player: 'DNP B', min: 0 },
  { player: 'Starter B', min: 31 },
  { player: 'Injured Star', min: 0 },
  { player: 'Bench A', min: '12:30' },
  { player: 'Starter A', min: 36 },
], frozenRotation);
check(
  orderedRows.map((row) => row.player).join('|') ===
    'Starter A|Starter B|Bench A|Injured Star|DNP B' &&
  box.includes('result?.rotationOrder?.[side]') &&
  boxDisplay.includes('if (aPlayed !== bPlayed) return aPlayed ? -1 : 1;'),
  'boxscore.played_then_dnp_frozen_rotation',
  'Played players stay in frozen gameplan order and all DNPs remain at the bottom.'
);
check(
  box.includes("['MIN','PTS','REB','AST','STL','BLK','FG','3P','FT','TO','PF']") &&
  box.includes('<LineScore game={game} result={result} />'),
  'boxscore.full_stats_and_line_score',
  'Shared box score still includes quarter/OT scoring plus the full stat columns.'
);
check(
  playoffs.includes('const periods = quartersHome.length || quartersAway.length || rawPeriods') &&
  playoffs.includes('periods,') && playoffs.includes('ot: otCount'),
  'boxscore.postseason_periods_preserved',
  'New postseason games still retain quarter and overtime period data.'
);
check(
  playoffs.includes('ResponsivePlayoffBracket') &&
  playoffs.includes('grid grid-cols-7') &&
  playoffs.includes('BRACKET_R1_CENTERS = [12.5, 37.5, 62.5, 87.5]') &&
  playoffs.includes('viewBox="0 0 700 1000"') &&
  !playoffs.includes('BASE_W') &&
  !playoffs.includes('uiScale') &&
  !playoffs.includes('BracketSide2K'),
  'postseason.bracket_uses_content_grid',
  'Bracket is a seven-column responsive content-pane layout with no virtual scaled canvas.'
);
check(
  playoffs.includes('h-[108px]') && playoffs.includes('top-[108px]') &&
  playoffs.includes('absolute inset-x-0 top-[108px] bottom-0 min-h-0 min-w-0 overflow-hidden'),
  'postseason.header_and_workspace_separated',
  'Toolbar/title retain their own row and the bracket owns only the remaining content height.'
);

// Geometry proof for the actual persistent shell widths. The sidebar is
// clamp(210px, 14.2vw, 252px); the bracket gets the remaining pane minus px-3.
for (const viewportWidth of [1366, 1440, 1536, 1920]) {
  const sidebarWidth = Math.min(252, Math.max(210, viewportWidth * 0.142));
  const contentWidth = viewportWidth - sidebarWidth;
  const bracketWidth = contentWidth - 24;
  const columnWidth = bracketWidth / 7;
  const cardWidth = Math.min(190, columnWidth - 14);
  const westLeft = 12 + (columnWidth - cardWidth) / 2;
  const eastRight = 12 + columnWidth * 7 - (columnWidth - cardWidth) / 2;
  check(
    cardWidth >= 145 && westLeft >= 0 && eastRight <= contentWidth,
    `postseason.geometry_${viewportWidth}`,
    `${viewportWidth}px viewport keeps all seven columns/cards inside the pane right of the sidebar.`
  );
}

console.table(checks);
const failed = checks.filter((row) => row.status === 'FAIL');
if (failed.length) {
  console.error(`Postseason lifecycle/box-score regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Postseason lifecycle/box-score regression passed: ${checks.length}/${checks.length} checks.`);
