export const SOUND_KEYS = Object.freeze({
  PLAYER_RELEASE_SUCCESS: "player.release.success",
  PLAYER_TRANSACTION_SUCCESS: "player.transaction.success",
  SIDEBAR_NAVIGATION: "ui.sidebar.navigation",
  TRADE_FINDER_ADD_ASSET: "tradeFinder.addAsset",
  TRADE_FINDER_SEARCH_OFFERS: "tradeFinder.searchOffers",
});

export const SOUND_REGISTRY = Object.freeze({
  [SOUND_KEYS.PLAYER_RELEASE_SUCCESS]: Object.freeze({
    sources: Object.freeze([
      "/sounds/player/player-release-success-1.mp3",
      "/sounds/player/player-release-success-2.mp3",
    ]),
    volume: 0.72,
  }),
  [SOUND_KEYS.PLAYER_TRANSACTION_SUCCESS]: Object.freeze({
    sources: Object.freeze([
      "/sounds/player/player-trade-sign-1.mp3",
      "/sounds/player/player-trade-sign-2.mp3",
    ]),
    volume: 0.72,
  }),
  [SOUND_KEYS.SIDEBAR_NAVIGATION]: Object.freeze({
    sources: Object.freeze([
      "/sounds/ui/sidebar-navigation-click-1.mp3",
      "/sounds/ui/sidebar-navigation-click-2.mp3",
    ]),
    volume: 0.72,
  }),
  [SOUND_KEYS.TRADE_FINDER_ADD_ASSET]: Object.freeze({
    sources: Object.freeze([
      "/sounds/ui/sidebar-navigation-click-2.mp3",
    ]),
    volume: 0.72,
  }),
  [SOUND_KEYS.TRADE_FINDER_SEARCH_OFFERS]: Object.freeze({
    sources: Object.freeze([
      "/sounds/trade/trade-finder-search-offers.mp3",
    ]),
    volume: 0.72,
  }),
});
