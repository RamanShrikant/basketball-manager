Basketball Manager — Salary Table Portrait Envelope Patch

Purpose
-------
Make runtime base+jersey composite portraits use the same visual contain envelope
as normal/static NBA headshots on Salary Table.

Important
---------
This patch DOES NOT include or modify:
- frontend/src/config/headshotLayout.js
- frontend/src/pages/SalaryTable.jsx
- any finalized Salary Table manual values
- retirement UI
- gameplay, contracts, trades, draft, simulation, or storage logic

Behavior
--------
Salary Table only:
- Static/fallback 1040x760 portrait: existing object-contain behavior remains.
- Runtime base+jersey 1040x760 portrait: width-fit inside the same slot, instead
  of forcing 100% slot height.
- Other pages preserve the existing runtime portrait height-fit behavior.

Verification
------------
From frontend:
  node scripts/salary-table-portrait-envelope-regression.mjs
  node scripts/portrait-dressing-regression.mjs

Expected:
- Salary Table portrait envelope: 5/5 PASS
- Portrait dressing: 23/23 PASS
