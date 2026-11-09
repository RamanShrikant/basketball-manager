BASKETBALL MANAGER — TRADE CENTER SCROLL / ARROW FINISH

CHANGES:
- Removed circular border around Cap Outlook / Expiring Contracts arrows.
- Closed arrow points right; open arrow points down, without a ring.
- The Trade Center page and the left panel do not scroll when either card expands.
- Historical index.css forces the left column to scroll; this patch overrides that
  rule only on the /trades route without overwriting any global styles.
- Internal Cap/Expiring contract lists still scroll vertically independently.
- Their scrollbars now use vivid game-orange #f97316, with orange hover #fb923c.
- The internal list height is bounded by the actual remaining visible height,
  so it works at different desktop/laptop screen resolutions.
- Keyboard/trackpad scrolling stays inside these lists.

PRESERVED:
- Manual controls in src/config/tradeCenterOverviewLayout.js (not replaced)
- Cap and Expiring player data, saved contracts, extension checks
- Propose Trade, Trade Finder, Position/Pick Depth, Rumor Board
- Player Search, Player Card, Salary Table, gameplay and saves

FILES:
frontend/src/pages/Trades.jsx
frontend/src/pages/Trades.css
frontend/scripts/trades-board-reorder.regression.mjs
frontend/scripts/trades-overview-scroll-lock.regression.mjs (new)

INSTALL:
From repository root, unzip with destination . and overwrite. Then run:
  cd frontend
  node scripts/trades-overview-scroll-lock.regression.mjs
  node scripts/trade-center-overview-expansion.regression.mjs
  node scripts/trades-board-reorder.regression.mjs
  npm run build

The full Vite app needs your local repository/dependencies; the isolated tests
and a standalone Chromium viewport/CSS smoke test passed.
