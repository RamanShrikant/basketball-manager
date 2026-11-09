BASKETBALL MANAGER — TRADE CENTER SEARCH RESULT VISUAL PATCH

Scope (only these files):
  frontend/src/pages/Trades.jsx
  frontend/src/pages/Trades.css
  frontend/src/utils/tradeSearchPresentation.js  [NEW]
  frontend/scripts/trade-search-visual.regression.mjs  [NEW TEST]

WHAT CHANGED
  - Original square-backplate 40x40 search portraits now have no box/border.
  - Original square number badge now uses the SAME shared PlayerRatingRing.jsx component (OVR + POT) as League Intel, fitted into 40x40.
  - Result metadata now displays player position and age; no printed team name.
  - A faint originating/current team logo appears in each signed player's search-result background; free agents have no team watermark.
  - Contract details come from contract.salaryByYear and getContractSeasonYear, not estimated from ratings. Shows remaining years/value and annual amounts.
  - Annual amounts are horizontally scrollable in the existing row and available in full through the browser's native title tooltip; the rows' existing 56px footprint is maintained.
  - No changes to selection, results ranking, keyboard Enter, search indexing, actual contract storage, save data, trade execution, portraits, or league finances.

CONTRACT EDGE CASES
  - Free agents: Free agent / unsigned. No team-logo watermark.
  - Older saves lacking salaryByYear: show only saved known term or current salary, with explicit no-breakdown notice. No invented annual amounts.
  - Season rollover uses the game's existing salary start-year indexing. One-year prior-offseason legacy contract is handled.

LOCAL TEST COMMANDS FROM frontend:
  node scripts/trade-search-visual.regression.mjs
  npm run build

The script and JSX syntax were checked in the context workspace; the complete game production build must run locally since node_modules and the full project were not in the supplied context zip.
