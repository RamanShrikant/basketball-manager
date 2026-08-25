Basketball Manager — Trade Context Dashboard v15
================================================

Base expected: Trade Context Dashboard v14 already installed.

Changes:
1. Removed the duplicate Front Office back button added by the trade page.
   The app shell's existing Front Office control remains the only one.
2. Added a compact PICK DEPTH row directly under Position Depth.
3. Pick Depth uses five small tiles to match the position row aesthetic:
   - Unprotected 1sts
   - Protected 1sts
   - Unprotected 2nds
   - Protected 2nds
   - Swap Rights
4. Pick counts are pulled from the live draft-pick ledger for the currently
   selected team and count only active owned assets.
5. Swap Rights count active future swap-right assets owned by the team.
6. Existing v14 trade dashboard layout, contract alerts, live record header,
   and rumor-board functionality remain intact.

Targeted validation:
- Runtime polish regression updated for pick depth + no duplicate front-office button.
