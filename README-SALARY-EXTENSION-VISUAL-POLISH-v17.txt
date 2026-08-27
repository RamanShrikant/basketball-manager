Basketball Manager — Salary + Extension Visual Polish v17
==========================================================

Base expected: current main after Trade / Team Hub / Extension Polish v16.

Contract Extensions
-------------------
1. Player list pills now include the live runtime player portrait.
2. Added the standard OVR/POT PlayerRatingRing directly inside each pill.
3. Removed the old POS / Age / text OVR / text POT metadata line.
4. Existing eligibility/refusal reason remains under the player name.
5. Existing Has Ask / Refuses / Ineligible / Extended status remains.
6. Added explicit manual visual controls in CONTRACT_EXTENSION_PLAYER_PILL_TUNING.
7. Desktop and laptop profiles are separate; laptop activates at <=1440px.
8. Portraits use layoutPage="contract-extensions", so the centralized
   headshotLayout.js x/y control remains available too.

Salary Table
------------
1. Removed the standalone OVR table column.
2. Added the OVR/POT PlayerRatingRing into the Player cell beside the portrait.
3. Removed the circular border/bubble shell around the player portrait.
4. Preserved position, salary-year columns, options, total remaining, expiry,
   cap holds, dead cap, two-way and stash functionality.
5. Added potential to salary-row view models where available.
6. Added explicit manual visual controls in SALARY_TABLE_PLAYER_VISUAL_TUNING.
7. Desktop and laptop profiles are separate; laptop activates at <=1440px.
8. Portraits use layoutPage="salary-table", so centralized headshotLayout.js
   x/y tuning remains available.
9. Salary table minimum width reduced from 980px to 920px after removing the
   standalone OVR column, while horizontal scrolling is still retained.

Validation on reconstructed current repo:
- Runtime polish regression: 61/61 PASS
- New Chapter regression: 70/70 PASS
- Portrait dressing regression: 21/21 PASS
