CANONICAL PORTRAIT ENVELOPE PATCH — 2026-09-07

Purpose
-------
Normalize rare oversized portraits on Salary Table and Player Retirements without
changing any manual page tuning.

Behavior
--------
- Salary Table static/fallback headshots and runtime base+jersey composites both
  render inside the same canonical 1040x760 width-fit envelope.
- Player Retirements now uses the same canonical envelope.
- Odd square/tall static source images can no longer paint taller than a normal
  NBA 1040x760 headshot in these slots.
- Runtime composites on Player Retirements no longer use the oversized h-full path.

Preserved exactly
-----------------
- src/config/headshotLayout.js (NOT INCLUDED / NOT MODIFIED)
- src/config/retirementLayout.js (NOT INCLUDED / NOT MODIFIED)
- Salary Table row height / manual x/y/scale controls
- Retirement master-canvas x/y/scale controls
- All other pages keep their previous portrait behavior.

Verification
------------
From frontend/:
  node scripts/salary-table-portrait-envelope-regression.mjs
  node scripts/retirement-portrait-envelope-regression.mjs
  node scripts/retirement-master-canvas-regression.mjs
  node scripts/salary-table-rowheight-regression.mjs

Patch-specific results while packaged:
- Salary portrait envelope: 9/9 PASS
- Retirement portrait envelope: 8/8 PASS
- Retirement master canvas: 36/36 PASS
- Salary row height: 6/6 PASS
