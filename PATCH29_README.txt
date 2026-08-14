Patch 29 - Trade visibility, FA decision consistency, history cleanup

Targeted fixes:
1. Trade screens now stop silently hiding standard-contract players. Trade Finder and Propose Trade player selection show the roster, with locked rows carrying exact trade-rule reasons.
2. Former two-way/stash players who later sign real standard contracts are no longer permanently treated as development-roster players.
3. Free-agency offer checks now separate raw cap room after cap-hold clearance from MLE logic, fixing wrong "over by" numbers for below-cap teams with holds.
4. Pending user FA decisions force selected offers to finalize as user signings, preserving offseason overfill rules so same-day selected signings are not blocked by CPU-style roster limits.
5. Free-agency signings clear stale two-way/stash metadata on the signed player.
6. League Events on the active market decision screen show the current day only while retaining the durable full log for summary/closed-market views.
7. Career stats display and archive application avoid attaching a new free-agency team to a previous season when the player did not actually log games for that team.
8. Mega-trade star selling protection increased from top-12 healthy team OVR to top-14 healthy team OVR in both Python and JS planning paths.
9. Trade Finder pick-add flow now applies the suggested protected rule before package validation, so second-apron furthest-first picks cannot sneak in as unprotected.
10. Propose Trade side status bars now reflect trade-rule asset legality, not only salary matching, so illegal picks do not still show as a green salary-valid trade.

Not changed:
- Player progression/stat impact logic was intentionally left untouched.
