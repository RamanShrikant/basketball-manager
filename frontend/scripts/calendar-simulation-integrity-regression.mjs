import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findFirstPendingSimulationDate,
  resolveSimulationCursorAfterTarget,
  resolveSimulationRunCursorDate,
} from '../src/utils/calendarCpuTradeTiming.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const calendar = fs.readFileSync(path.join(root, 'src/pages/Calendar.jsx'), 'utf8');

const checks = [];
const check = (condition, id, detail) => checks.push({ status: condition ? 'PASS' : 'FAIL', id, detail });

const schedule = {
  '2026-10-20': [{ id: 'g1', played: true }],
  '2026-10-21': [{ id: 'g2', played: false }],
  '2026-10-22': [{ id: 'g3', played: false }],
};
const results = { g1: { totals: { home: 110, away: 101 } } };

check(
  findFirstPendingSimulationDate(schedule, results) === '2026-10-21',
  'calendar.pending_finds_stranded_game',
  'Earliest unfinished scheduled game is detected even when earlier games are complete.'
);

check(
  resolveSimulationRunCursorDate({
    storedCursorDate: '2026-11-01',
    firstPendingDate: '2026-10-21',
    seasonStartDate: '2026-10-20',
  }) === '2026-10-21',
  'calendar.cursor_repairs_forward_skip',
  'A stale cursor that advanced past an unfinished game is pulled back to that game.'
);

check(
  resolveSimulationRunCursorDate({
    storedCursorDate: '2026-10-18',
    firstPendingDate: '2026-10-25',
    seasonStartDate: '2026-10-20',
  }) === '2026-10-20',
  'calendar.cursor_preserves_pre_game_calendar_days',
  'Cursor still starts at season start/off-days so checkpoints and CPU-trade pacing are not skipped.'
);

check(
  resolveSimulationCursorAfterTarget({
    nextCalendarDate: '2026-11-11',
    firstPendingDate: '2026-11-10',
  }) === '2026-11-10',
  'calendar.postrun_cursor_never_passes_pending_game',
  'Sim-to-Date cannot advance its resume cursor beyond a game that remained unfinished.'
);

check(
  resolveSimulationCursorAfterTarget({
    nextCalendarDate: '2026-11-11',
    firstPendingDate: '2026-11-14',
  }) === '2026-11-11',
  'calendar.postrun_cursor_keeps_offdays',
  'Normal off-days between target date and next game remain available for calendar events.'
);

check(
  calendar.includes('blockedSimulationError = {') &&
  calendar.includes('blockedFullSeasonError = {') &&
  calendar.includes('Simulation stopped safely'),
  'calendar.game_failures_fail_closed',
  'Both Sim-to-Date and Full Season stop on a failed game instead of continuing into later games.'
);

check(
  calendar.includes('resolveSimulationCursorAfterTarget({') &&
  calendar.includes('resolveSimulationRunCursorDate({'),
  'calendar.cursor_helpers_wired',
  'Calendar uses the tested cursor invariants in live simulation code.'
);

check(
  calendar.includes('? ` · ${Number(result?.winner?.ot') && !calendar.includes('Ã‚Â·'),
  'calendar.ot_label_clean',
  'Calendar overtime scores use a clean middle-dot OT label with no mojibake.'
);

console.table(checks);
const failed = checks.filter((row) => row.status === 'FAIL');
if (failed.length) {
  console.error(`Calendar simulation integrity regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Calendar simulation integrity regression passed: ${checks.length}/${checks.length} checks.`);
