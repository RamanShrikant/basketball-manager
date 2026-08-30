RETIREMENT UI LAPTOP FIX v6 — FIXED COLUMNS + TRUE ROW VERTICAL CENTERING

Scope:
- UI only: PlayerRetirements.jsx + retirementLayout.js
- No retirement logic, offseason logic, simulation, storage, roster, contract, or gameplay changes.

Laptop behavior (<=1536px viewport):
- OVR ring remains pinned to one fixed X coordinate for every row.
- OVR ring is now vertically centered in the 150px retirement row (no more riding above the row).
- Compact player portrait is also vertically centered/contained inside the row.
- Name/meta fixed lane from v5 remains unchanged.
- No player-name measurement or dynamic ring movement.

Desktop behavior:
- Existing desktop retirement tuning is untouched.
