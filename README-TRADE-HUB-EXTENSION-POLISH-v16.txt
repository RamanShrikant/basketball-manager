Basketball Manager — Trade / Team Hub / Extension Polish v16
============================================================

Base expected: Trade Context Dashboard v15 already installed.

Changes
-------
1. Trade page finishing pass
   - Pick Depth labels no longer truncate with ellipses.
   - Contract-alert cards and section spacing are tightened slightly.
   - Before games are played, the header shows "Preseason • East/West" instead
     of the awkward "0-0 • East/West" presentation.
   - Once games exist, the header is explicit and compact:
       18-12 • East • 2nd
     so the ordinal conference standing has its own bullet-separated field.

2. Team Hub orange rail interaction
   - The existing orange bottom rail remains synced to the real carousel.
   - Mouse wheel and touchpad gestures over either the carousel or the orange
     rail now move the carousel horizontally.
   - Mouse dragging / range interaction remains supported.
   - Existing left/right arrow buttons are preserved unchanged.

3. Contract Extensions scrollbar
   - The player list now has an explicit polished orange scrollbar with a dark
     track, rounded orange thumb, hover state, and Firefox support.
   - No contract-extension behavior or negotiation logic is changed.

Validation
----------
- Runtime polish regression: 53/53 PASS
- New Chapter regression: 70/70 PASS
- Portrait dressing regression: 21/21 PASS
