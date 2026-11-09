TRADE CENTER — MATCHING SUMMARY TILE POLISH

This patch builds on BM-TRADE-CENTER-TEAM-INTEL-CARDS.zip.
It only changes UI presentation for the collapsed/expanded summary tiles.

Files updated:
  frontend/src/pages/Trades.jsx
  frontend/src/pages/Trades.css
  frontend/src/config/tradeCenterOverviewLayout.js

New UI:
  - Restrained charcoal, crosshatched summary background, matching contract pills
  - Low-opacity logo of the controlled team behind each summary
  - Subtle orange hover, focus, and open-state accent
  - Consistent label/value/subtitle typography and icon styling
  - Original 93px minimum summary tile height, unboxed arrows
  - Both scrollable contract panels and the outer page scroll lock unchanged

Manual controls, independently for each summary tile:
  TRADE_CENTER_OVERVIEW_LAYOUT.cap.summaryLogo
  TRADE_CENTER_OVERVIEW_LAYOUT.expiring.summaryLogo
  e.g. { x: 0, y: 0, scale: 1, opacity: 0.075 }

These controls affect only the team watermark behind the SUMMARY tile.
The earlier .logo controls still tune the PLAYER ROWS below it.
All previous numeric settings, salary data, extension previews, and gameplay
systems are left unchanged.

From repository root in PowerShell:
  Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\BM-TRADE-CENTER-SUMMARY-POLISH.zip" -DestinationPath . -Force
  cd frontend
  node scripts/trade-center-summary-polish.regression.mjs
  node scripts/trade-center-overview-expansion.regression.mjs
  node scripts/trades-board-reorder.regression.mjs
  node scripts/trades-overview-scroll-lock.regression.mjs
  npm run build

If you changed the previous files locally since installing the earlier patch,
back them up or compare before overwriting.
