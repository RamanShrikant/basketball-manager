Basketball Manager - Trade Finder Patch 24
Exact Rating Hot Path

FILES CHANGED
- frontend/src/api/teamRatings.js
- frontend/src/utils/ensureGameplans.js
- frontend/src/utils/tradeTeamImpact.js

WHAT IT DOES
1. Replaces the per-position-transfer Set + array spread + filter + sort sequence
   with a fixed 13-slot numeric scratch buffer and insertion sort.
2. Keeps the exact same candidate amounts, ascending order, tie thresholds,
   position-credit formula, and legacy fallback behavior.
3. Adds an internal ratings-only mode so smart-rotation trial scores do not build
   per-player assignment maps or copied rosterOut objects that callers never read.
4. Reuses the exact current OVR already computed immediately before the POT proof
   bonus instead of rebuilding the same smart rotation and team rating.

WHAT IT DOES NOT CHANGE
- Trade Finder candidate packages
- Number of scan or exact evaluations
- Player/pick values
- CPU acceptance logic
- Comfort margins
- Position coverage formulas
- Rotation candidate order or tie behavior

VALIDATION BEFORE PACKAGING
- 5,000 randomized team-rating cases: zero differences
- Malformed-position and duplicate-name legacy cases: zero differences
- 120 complete smart-rotation cases: zero differences
- Complete impact-flow cases: zero differences
- Full synthetic league Trade Finder: identical final offers and evaluation counts
- Production Vite build: passed

LOCAL SYNTHETIC PERFORMANCE
- Full serial Finder: 14.6s -> 6.6s
- Impact work: 13.85s -> 5.80s

The real browser Sabonis baseline remains the final acceptance test.
