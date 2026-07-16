Basketball Manager Trade Finder Patch 21

Purpose:
- Restores the clean pre-Patch-20 Trade Finder files.
- Skips expensive post-trade pick projection only when neither side contains a primary pick asset.
- Preserves current CPU pick-direction fields and the complete returned evaluation object.
- Pick-containing trades use the untouched exact projection path.

Files:
- frontend/src/utils/tradeFinderOfferEngine.js
- frontend/src/utils/tradeFinderEvaluatorCache.js
- frontend/src/utils/tradeTeamImpact.js
- frontend/src/utils/tradePickValue.js
