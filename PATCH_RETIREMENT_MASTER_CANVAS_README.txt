RETIREMENT UI — SINGLE MASTER-CANVAS RESPONSIVE SYSTEM

Goal
----
Preserve one manually tuned desktop retirement-row composition and translate it
proportionally to narrower laptop resolutions with no per-element laptop hacks.

What changed
------------
1. One canonical row canvas: 1700 x 150.
2. Every existing manual x/y/scale value remains a master-canvas value.
3. The COMPLETE row is transformed once using:
     scale = availableRowWidth / masterWidth
   clamped to the configured min/max.
4. Scaling is WIDTH ONLY. Browser height never changes row geometry.
5. 1366x625 and 1366x768 therefore render the same row composition/size; the
   shorter viewport simply shows fewer rows before scrolling.
6. Wider desktop rows remain 1:1 (maxScale = 1) so the authored desktop element
   sizes are not enlarged.
7. Removed all laptop-specific headshot/name/meta/OVR positioning logic from the
   retirement page and config.
8. Team-specific logo overrides remain master-canvas controls and therefore scale
   with the rest of the row automatically.

Manual tuning
-------------
Continue editing only:
  frontend/src/config/retirementLayout.js

headshot.x/y/scale, name.x/y/scale, meta.x/y/scale, ratingRing.x/y/scale,
reasonBox, accomplishmentsBox, and teamLogo controls all remain independent.
Whatever you tune in the master desktop coordinate system is automatically scaled
as one composition on narrower screens.

Important
---------
The only global calibration value is responsive.masterWidth. It is set to 1700,
which is the canonical width used by this patch. Do not add laptopX/laptopY/
laptopScale overrides. If the canonical desktop row width ever intentionally
changes, change masterWidth once; do not create per-resolution coordinates.

Scope / safety
--------------
UI only. No retirement engine, offseason state, simulation, storage, roster,
contracts, trades, progression, or player data logic is changed.

Regression
----------
From repo root:
  node frontend/scripts/retirement-master-canvas-regression.mjs
