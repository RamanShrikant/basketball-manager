BASKETBALL MANAGER — PLAYER CARD TRENDS / HEADER REFINEMENT
========================================================

Source of truth: the user's PLAYER-CARD-UI context ZIP (20261011-223312).

INCLUDED PATCH FILES:
  frontend/src/components/PlayerCardModal.jsx
  frontend/scripts/player-card-trends.regression.mjs

WHAT CHANGED:
1. The Trends tab now shows three neatly stacked charts for Points (orange),
   Rebounds (blue), and Assists (green). Each has its own data-based per-game
   Y-axis, always including zero, so smaller stats aren't squeezed by points.
2. Every season circle accepts hover, click/tap and keyboard focus (Enter/Space)
   and shows the exact recorded value in its chart's matching color. Clicking
   pins a tooltip; clicking again unpins. The Season by Season table remains.
3. Removed atmospheric orange/amber glow layers that tinted the right side of
   the Player Card. The ring, accents, and player data are unchanged.
4. The header's Contract cell displays:
   - two-way players: "Two-Way Contract"
   - other active contracts with saved salary schedule: "3Y left · $161.5M remaining"
   - unsigned / unknown cases: explicitly labeled, no made-up money
   Existing contract season calculations are reused. The Contract tab is intact.

SAFETY:
UI presentation + read-only derivations only. No changes to contracts,
rosters, season history, Salary Table, CPU trading, simulations, game saves,
or the shared portrait/ring components.

INSTALL (PowerShell from repo root):
  Copy-Item frontend\src\components\PlayerCardModal.jsx frontend\src\components\PlayerCardModal.before-trends.jsx.txt
  Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\BM-PLAYER-CARD-TRENDS-REFINEMENT.zip" -DestinationPath . -Force
  cd frontend
  node scripts/player-card-trends.regression.mjs
  npm run build

VERIFICATION:
- JSX parser checked with TypeScript's TSX-aware parser; no syntax errors.
- 8 independent source/helpers regression checks passed in isolated context.
- The full Vite build / real saved-game UI must be checked in the user's repo.
