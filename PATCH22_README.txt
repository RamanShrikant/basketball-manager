Basketball Manager Trade Finder Patch 22

Purpose:
- Speeds up the exact team-rating formula used by Trade Finder rotations.
- Caches immutable position-option parsing per player and position signature.
- Tests positional allocation candidates in-place, then restores the original values exactly.
- Selects the top two star contributors in one stable pass instead of sorting copied arrays.
- Calculates positional coverage with allocation-free loops.

Correctness:
- No rating constants, formulas, candidate amounts, thresholds, trade rules, or rounding changed.
- 5,000 randomized team/minutes cases produced byte-for-byte identical computeTeamRatings results.
- Exact evaluator comparison produced identical full evaluation objects.
- Complete mini Finder tests preserved offers/order/values/margins/evaluation counts.

Files:
- frontend/src/api/teamRatings.js
