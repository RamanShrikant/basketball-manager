Basketball Manager — Salary Table Row Height Patch

Purpose
-------
Makes HEADSHOT_LAYOUTS["salary-table"].rowHeight the authoritative player-row height control.

What changed
------------
- Removes hidden vertical td padding that previously forced rows to stay tall.
- Gives the player identity wrapper the configured row height explicitly.
- Allows headshots / OVR rings to remain visually large via overflow without forcing the table row taller.
- Applies to both selected-team and all-teams Salary Table render paths.
- Does NOT overwrite frontend/src/config/headshotLayout.js, so your current manual tuning values are preserved.

Manual control
--------------
Edit:
frontend/src/config/headshotLayout.js

HEADSHOT_LAYOUTS["salary-table"].rowHeight

Example:
rowHeight: 48,

Headshot / OVR / name scales remain independent.

Regression
----------
node frontend/scripts/salary-table-rowheight-regression.mjs
