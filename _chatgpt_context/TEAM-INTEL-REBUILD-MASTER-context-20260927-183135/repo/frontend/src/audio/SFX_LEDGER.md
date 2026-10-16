# Basketball Manager SFX Ledger

This file tracks the semantic sound keys, their audio assets, and the UI/gameplay actions that currently trigger them.

## Sound families

### PLAYER_RELEASE_SUCCESS — `player.release.success`
Assets:
- `/sounds/player/player-release-success-1.mp3`
- `/sounds/player/player-release-success-2.mp3`

Current placements:
- Roster View: successful standard-player release to free agency.
- Roster View: successful two-way-player release to free agency.

Rule: play only after a release succeeds.

### PLAYER_TRANSACTION_SUCCESS — `player.transaction.success`
Assets:
- `/sounds/player/player-trade-sign-1.mp3`
- `/sounds/player/player-trade-sign-2.mp3`

Current placements:
- Propose Trade: accepted user trade.
- Free Agency: successful regular-season signing / successful contract submission flows already wired by the page.
- Player / Team Options: completed accepted/exercised option transactions.
- Player / Team Options: qualifying-offer extension when at least one QO is extended.
- Viewing Offers: successful selected free-agent signing resolution.
- Contract Extensions: successful accepted extension offer. Declines/errors do not play this sound.

Rule: transaction-success audio must mean the transaction actually succeeded. Prime before asynchronous actions when necessary, then play only after success is confirmed.

### SIDEBAR_NAVIGATION — `ui.sidebar.navigation`
Asset in the current registry:
- `/sounds/ui/sidebar-navigation-click-1.mp3`

Current placements:
- Persistent left sidebar destinations.
- Persistent sidebar section expand/collapse.
- Contract Extensions: selecting a player in the left list.
- Contract Extensions: selecting a requested extension package.
- Player Card: opening a Player Card from a button labelled/title/aria-labelled Player Card.
- Player Card modal: every enabled non-selected button inside the card, including tabs, filters, and dropdown buttons.
- Schedule / Calendar: clicking a real date tile.
- Offseason Hub: every enabled button on the hub.

Rule: generic UI navigation sounds must not replace purpose-built success/action sounds. Disabled controls make no generic sound.

### UI_BACK_CANCEL — `ui.backCancel`
Asset:
- `/sounds/ui/sidebar-navigation-click-2.mp3`

Current placements include:
- Existing back/cancel/remove interactions already explicitly wired by pages such as Propose Trade, Trade Finder, and Team Selector.
- Global Back controls across the game.
- Global X/Close controls across the game.

### TEAM_SELECTION_ADVANCE — `ui.teamSelection.advance`
Asset:
- `/sounds/ui/team-selection-advance.mp3`

Current placement:
- Team Selector advance/confirm flow.

### TEAM_SELECTOR_CYCLE — `ui.teamSelector.cycle`
Asset:
- `/sounds/ui/team-selector-cycle.mp3`

Current placement:
- Team Selector previous/next cycling.

### COACH_GAMEPLAN_SWAP — `ui.coachGameplan.swap`
Asset:
- `/sounds/ui/coach-gameplan-swap.mp3`

Current placement:
- Coach Gameplan player/rotation swap interaction.

### TRADE_FINDER_ADD_ASSET — `tradeFinder.addAsset`
Asset:
- `/sounds/ui/sidebar-navigation-click-1.mp3`

Current placement:
- Trade Finder Add asset.

### TRADE_FINDER_SEARCH_OFFERS — `tradeFinder.searchOffers`
Asset:
- `/sounds/trade/trade-finder-search-offers.mp3`

Current placement:
- Trade Finder Search Offers.

## Generic UI binding rules

`uiSoundBindings.js` owns cross-page generic click coverage. It currently covers:
- explicit `data-bm-sfx-ui-nav="true"` targets,
- enabled non-selected buttons inside `data-bm-sfx-scope="player-card"`,
- enabled non-selected buttons inside `data-bm-sfx-scope="offseason"`,
- Player Card opener buttons,
- enabled interactive controls on `/trades`,
- enabled generic interactive controls on `/trade-finder` while preserving Add/Remove/Search Offers dedicated sounds,
- global Back and X/Close controls routed to `UI_BACK_CANCEL`.

Use `data-bm-sfx-skip-ui-nav="true"` on a control if it receives a dedicated sound and should not also receive the generic UI navigation sound.

One physical click should produce at most one semantic UI sound. Re-clicking an already-selected tab/tile/player/package is a no-op and does not replay the generic UI sound.
