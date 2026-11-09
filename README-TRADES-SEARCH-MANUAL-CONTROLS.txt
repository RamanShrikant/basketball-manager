BASKETBALL MANAGER — TRADES SEARCH MANUAL CONTROLS

Only modifies the Trades search dropdown's VISUAL positions. Does not modify
search logic, trade acceptance, contracts, saved rosters, Player Card, League
Intel, Roster View, or the finalized Salary Table.

FILES
  frontend/src/pages/Trades.jsx          (separate independently movable text spans)
  frontend/src/pages/Trades.css          (CSS variables applied to those spans)
  frontend/src/config/tradeSearchLayout.js   <-- EDIT THIS ONE FOR MANUAL TUNING
  frontend/scripts/trade-search-manual-controls.regression.mjs

CONFIG: frontend/src/config/tradeSearchLayout.js

export const TRADE_SEARCH_LAYOUT = {
  headshot: { x: 0, y: 6, scale: 1 },            // y=6 preserves current baseline
  name: { x: 0, y: 0, scale: 1 },
  position: { x: 0, y: 0, scale: 1 },
  age: { x: 0, y: 0, scale: 1 },
  contractYears: { x: 0, y: 0, scale: 1 },
  contractValue: { x: 0, y: 0, scale: 1 },
  averageSalary: { x: 0, y: 0, scale: 1 },
  teamLogo: { x: 0, y: 0, scale: 1, opacity: 0.10 },
};

  x + moves RIGHT. y + moves DOWN. Negative moves left/up.
  scale 1.0 = original, 1.2 = +20%. opacity from 0 (invisible) to 1.
  All position values are CSS pixels; visual transforms do not resize the row.
  Name, position, age, contract-years, remaining-value and average salary
  can each be shifted/scaled independently. Small separators remain in place.
  Moving just one text span far away might visually overlap another span;
  use small adjustments and check both normal and narrow/laptop widths.

OVR/POT RING: intentionally locked to its previous style and position.
NO tuning controls for the ring are added here.

INSTALL (PowerShell; from repository root):
  Copy-Item frontend\src\pages\Trades.jsx frontend\src\pages\Trades.manual-before.jsx.txt
  Copy-Item frontend\src\pages\Trades.css frontend\src\pages\Trades.manual-before.css.txt
  Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\BM-TRADES-SEARCH-MANUAL-CONTROLS.zip" -DestinationPath . -Force
  cd frontend
  node scripts/trade-search-manual-controls.regression.mjs
  node scripts/trade-search-visual.regression.mjs
  npm run build

A full production build must run in your complete local project.
