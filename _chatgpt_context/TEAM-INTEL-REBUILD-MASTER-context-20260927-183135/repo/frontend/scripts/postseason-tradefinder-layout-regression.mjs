import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const playoffs = read('src/pages/Playoffs.jsx');
const finder = read('src/pages/TradeFinder.jsx');
const responsive = read('src/styles/BMResponsiveDensity.css');

const checks = [];
const check = (condition, id, detail) => checks.push({ status: condition ? 'PASS' : 'FAIL', id, detail });

check(
  !playoffs.includes('bottom-[48px]') && !playoffs.includes('const FOOTER_H = 48'),
  'postseason.no_legacy_footer_gap',
  'Playoffs no longer reserves the removed 48px footer strip.'
);

check(
  playoffs.includes('ResponsivePlayoffBracket') &&
  playoffs.includes('grid grid-cols-7') &&
  !playoffs.includes('window.innerWidth') &&
  !playoffs.includes('BASE_W') &&
  !playoffs.includes('uiScale'),
  'postseason.measure_actual_content_canvas',
  'Bracket is natively sized by the persistent-shell content pane instead of measuring/scaling against the browser viewport.'
);

check(
  playoffs.includes('relative h-full min-h-0 w-full overflow-hidden'),
  'postseason.root_inside_shell',
  'Postseason root fills its route container instead of fixed-positioning underneath the sidebar.'
);

check(
  finder.includes('bmCourtPage h-full min-h-0 px-3 py-3') &&
  finder.includes('flex h-full min-h-0 w-full max-w-[1760px] flex-col') &&
  finder.includes('grid min-h-0 flex-1 gap-4 pt-1 xl:grid-cols-3'),
  'tradefinder.viewport_fill_structure',
  'Trade Finder header is shrink-wrapped and the three-panel board consumes the remaining route height.'
);

check(
  !finder.includes('max-h-[calc(100vh-170px)]'),
  'tradefinder.no_arbitrary_scroller_cap',
  'Trade Finder scrollers flex inside full-height panels instead of ending early at an arbitrary max-height.'
);

check(
  responsive.includes('body[data-bm-route="awards"] .bm-layout--immersive') &&
  responsive.includes('body[data-bm-route="awards"] .bm-layout-main > .bmCourtPage'),
  'awards.full_height_parent_chain',
  'Awards forces its legacy Layout parent chain to the full route height so no bottom strip is exposed.'
);

console.table(checks);
const failed = checks.filter((row) => row.status === 'FAIL');
if (failed.length) {
  console.error(`Postseason/Trade Finder layout regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Postseason/Trade Finder layout regression passed: ${checks.length}/${checks.length} checks.`);
