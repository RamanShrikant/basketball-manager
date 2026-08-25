Basketball Manager — Trade Finder + Hub UI Polish v13
======================================================

Base expected: GitHub main commit 661e5a9 (v9 + v10 + v11 already integrated).
This patch also includes the v12 Trade Finder record/standing work that was created
but was never pushed to GitHub main.

Changes:
1. Trade Finder shows live W-L and conference standing for the browsed team and each CPU offer team.
2. Picks originally belonging to another team show that original team's live W-L/standing beneath the pick.
3. Removes all player-facing Comfort Offer/offer quality copy, visible trade values, Finder gap, CPU comfort, and reverse comfort-margin diagnostics.
4. Rewrites Trade Finder search copy to neutral player-facing language while leaving internal evaluation untouched.
5. Team Hub gets an always-visible, draggable orange bottom scrollbar that mirrors the horizontal card carousel and does not depend on Windows/Chrome native scrollbar visibility.
6. Trade Center removes the Feed/Waiting tag chrome and Market Watch/Transaction Wire empty placeholders. Empty state is now one clean message; real Transaction Wire rows display as Completed Deal.

Targeted validation:
- Runtime polish regression: 38/38 PASS
- New Chapter regression: 70/70 PASS
- Portrait dressing regression: 21/21 PASS

Run npm run build in the real repo after installation.
