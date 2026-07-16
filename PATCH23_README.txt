Basketball Manager Trade Finder Patch 23
Exact position-assignment solver optimization

Builds on Patch 21 + Patch 22.

Changed file:
- frontend/src/api/teamRatings.js

What changed:
- Replaces hot-loop player-name maps and option-object lookups with indexed arrays.
- Reuses numeric position indexes inside the split-position assignment solver.
- Avoids allocating a best-move object for every improving candidate.
- Preserves candidate order, penalties, tie thresholds, formulas, and output rounding.
- Falls back to the original legacy solver for malformed primary positions or duplicate player names.

Validation:
- 5,000 randomized roster/minute cases: 0 differences.
- 6 malformed/duplicate-name edge cases: 0 differences.
- 7 complete exact trade-impact evaluations: identical full result objects.
- Full synthetic Finder runs: identical offers, order, values, margins, and evaluation counts.
