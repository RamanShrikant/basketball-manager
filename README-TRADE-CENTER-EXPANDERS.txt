BASKETBALL MANAGER — TRADE CENTER CAP/EXPIRING EXPANDERS

Purpose:
- Preserve the existing compact Cap Outlook and Expiring Contracts summary cards.
- Clicking the new circular chevron expands/collapses a connected details panel.
- Each panel scrolls vertically within a configurable max-height.
- Cap list: rostered salary-paying players with headshot, name, age, current salary, years remaining, and genuine unresolved Player/Team option if present.
- Expiring list: already-existing expiring contract shortlist with headshot, OVR/POT ring, recorded remaining contract salary, and *read-only* extension-interest preview.
- Extension preview is fetched only when Expiring Contracts is expanded; 'Open to talks' means eligible to negotiate, NOT a guaranteed signature. For unavailable info, shows 'Interest not assessed'.
- Existing Salary Table and Contract Extensions page links move to the footers of their expanded panels.
- Both accordions may open independently. Propose Trade / Trade Finder, position/pick depth, player search, Trade Desk and gameplay rules unchanged.

NEW MANUAL CONTROLS:
frontend/src/config/tradeCenterOverviewLayout.js
  cap.maxHeight, expiring.maxHeight
  cap.headshot, cap.name, cap.age, cap.salary, cap.years, cap.option
  expiring.headshot, expiring.name, expiring.age, expiring.ring, expiring.money, expiring.interest, expiring.option
Each visual control has x, y and scale, and affects only the corresponding drawn layer, not the saved league or row geometry.

PATCH FILES:
frontend/src/pages/Trades.jsx
frontend/src/pages/Trades.css
frontend/src/utils/tradeCenterOverviewDetails.js (new, read-only)
frontend/src/config/tradeCenterOverviewLayout.js (new)
frontend/scripts/trade-center-overview-expansion.regression.mjs (new)
frontend/scripts/trades-board-reorder.regression.mjs (updated intentional layout regression)

INSTALL:
1. Back up frontend/src/pages/Trades.jsx and Trades.css.
2. Expand ZIP to repository root, replacing files.
3. cd frontend
4. node scripts/trades-board-reorder.regression.mjs
5. node scripts/trade-center-overview-expansion.regression.mjs
6. npm run build
7. Visit Trade Center, expand both panels, scroll them, and confirm the Salary Table and Contract Extensions footer links.

Testing done: targeted read-only contract/option/extension regressions, preserved-navigation/order regression, TypeScript JSX parse, CSS syntax parse, and isolated Chromium scroll geometry. Full Vite build needs the complete local project and node_modules.
