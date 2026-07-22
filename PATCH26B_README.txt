BASKETBALL MANAGER PATCH 26B
Unified Team-Scrolling Trade Finder
Date: 2026-07-21

BASE REQUIREMENT
- Apply over a project that already includes Patch 26A.

WHAT CHANGED
1. The existing Trade Finder remains one unified page.
2. It opens on the user-controlled team and preserves the existing league-wide Trade Finder behavior there.
3. Left/right team arrows now scroll through every roster without a separate mode or tab.
4. Switching teams immediately resets selected assets, protections, search progress, cached results, and prior offers.
5. On another team, the left package becomes the package the user wants from that CPU team.
6. Search Offers then searches only the controlled team's players and picks for legal packages the target CPU team would comfortably accept.
7. Reverse searches return zero to five results. Five is an absolute cap, never a target.
8. Results are grouped by distinct primary value anchors and near-duplicate packages are removed.
9. A package is rejected when it is merely the same base offer with an unnecessary throw-in.
10. Every displayed result passes exact Propose Trade CPU evaluation, comfort thresholds, salary matching, roster legality, player eligibility, pick ownership, and final trade execution validation.
11. Excessive CPU-lean packages above a +8 comfort margin are not displayed.
12. Reverse searching runs in a dedicated Web Worker and falls back safely to the main thread if the worker fails.
13. Loading a reverse result places the generated controlled-team package on the user side and the requested CPU package on the CPU side in Trade Builder.

SEARCH PRIORITY
Accuracy -> comfortable CPU acceptance -> trade legality -> meaningful diversity -> number of results.

DIVERSITY RULES
- One winning result per primary player/pick anchor.
- Strong package-overlap filtering prevents repeated versions of effectively the same offer.
- Clean one-asset packages receive exact checks before larger combinations, preventing unnecessary add-ons.
- It is normal to receive 0, 1, or 2 results when those are the only genuinely different acceptable packages.

FILES
- frontend/src/pages/TradeFinder.jsx
- frontend/src/utils/reverseTradeFinderOfferEngine.js
- frontend/src/workers/reverseTradeFinderWorker.js

VALIDATION COMPLETED
- Vite production build passed with 143 transformed modules.
- Dedicated reverse Trade Finder worker bundled successfully.
- Existing tradeFinderOfferEngine.js remained byte-for-byte unchanged.
- Real roster test: 93 OVR target returned 0 comfortable offers.
- Real roster test: 84 OVR target returned 2 distinct comfortable offers.
- Real roster test: lower-value target returned 3 distinct offers, not five filler variations.
- All returned anchors were unique.
- All returned comfort margins were between the dynamic comfort floor and +8.
- Duplicate-anchor synthetic test removed the larger throw-in variation.
- Python public modules compiled successfully.

EXPECTED BUILD WARNINGS
- Existing large bundle warning.
- Existing simEnginePy mixed static/dynamic import warning.
- Existing Browserslist/baseline-data freshness warnings.
These warnings do not stop the build.
