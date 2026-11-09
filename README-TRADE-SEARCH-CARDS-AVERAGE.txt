BASKETBALL MANAGER — TRADES SEARCH POLISHED CARDS + ANNUAL AVERAGE

Build on top of the previous BM-TRADES-SEARCH-OVR-POT-CONTRACTS patch.

WHAT CHANGED
- Player-result row keeps its original 56px height; adds subtle gray border,
  charcoal fill, and 4px spacing to distinguish individual player cards.
- Team logo is a larger, centered, subtle (10% opacity) watermark clipped
  within each row's rounded border.
- Portrait viewport widened to 49px, same 40px height, and object-fit:contain,
  which reduces clipping at the left/right edges of ESPN images.
- Name/details receive a bit more horizontal space after the headshot.
- Gold bottom line now displays average salary per remaining contracted year
  from saved salaryByYear. Annual salary-by-year breakdown stays in hover title.
- On old/incomplete saves, show the known current salary labeled "Current"
  instead of falsely calculating an average; show unavailable when no data.
- Free agents remain labeled unsigned.

FILES REPLACED
frontend/src/pages/Trades.jsx
frontend/src/pages/Trades.css
frontend/src/utils/tradeSearchPresentation.js
frontend/scripts/trade-search-visual.regression.mjs

INSTALL (PowerShell, from repo root)
  Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\BM-TRADES-SEARCH-POLISHED-CARDS.zip" -DestinationPath . -Force
  cd frontend
  node scripts/trade-search-visual.regression.mjs
  npm run build

SCOPE / SAFETY
No gameplay trade evaluator, contract storage, draft, roster, save,
League Intel UI, or finalized Salary Table manual settings are modified.
The source headshot image files are not changed.
