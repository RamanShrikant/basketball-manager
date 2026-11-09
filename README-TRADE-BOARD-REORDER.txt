BASKETBALL MANAGER — TRADE CENTER PANEL REORDER

Visible order in left-hand Team Context panel:
1. Propose Trade / Trade Finder
2. Position Depth
3. Pick Depth
4. Cap Outlook / Expiring Contracts

The contextual trade-locked notice remains immediately after the action buttons.
The League Rumor Board (right side) is unchanged.

Only frontend/src/pages/Trades.jsx was changed. No styles, settings, search,
trade calculations, gameplay state, save format or salary rules were modified.
All JSX blocks were moved with byte-identical content.

From frontend/:
  node scripts/trades-board-reorder.regression.mjs
  npm run build

Keep a backup of your locally edited Trades.jsx before installing.
