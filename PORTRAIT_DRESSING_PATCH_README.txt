BASKETBALL MANAGER - PORTRAIT DRESSING EDITOR PATCH
Source of truth: basketball-manager-FULL-context-20260819-032844.zip
Jersey source: jerseyscomplete(2).zip

WHAT IS INCLUDED
- All 30 uploaded 1040x760 RGBA jersey PNGs, preserved with their uploaded filenames.
- Jersey manifest mapping all teams to those files (PHO source is exposed as PHX in the editor).
- Dedicated Dressing / Portrait Editor inside League Editor -> Player Creator.
- Current 44-rookie face manifest and PNG bank are used directly; no fake/new faces are invented.
- 1040x760 layered preview: rookie portrait below, team jersey above.
- Team dropdown plus previous/next controls for all 30 jerseys.
- Per-rookie fit: X, Y, Scale, Expand Left, Expand Right, Expand Up, Expand Down.
- Direct mouse/pointer drag for jersey X/Y.
- Optional alignment grid.
- Save fit metadata to localStorage key bm_portrait_dressing_fit_v1.
- Export/import JSON for fit metadata.
- Fit is per portrait, so switching teams reuses the same calibration instead of storing 30 composites.
- Existing Face DNA / Aging Lab remains available as a second tab.
- Reusable LayeredPlayerPortrait component is included for later runtime integration on player cards/team changes.

CURRENT ASSET COUNTS FROM THIS CONTEXT
- Rookie portrait PNGs: 44
- Rookie manifest entries: 44
- Team jersey PNGs: 30
- Jersey manifest entries: 30

APPLY FROM REPO ROOT IN POWERSHELL
Expand-Archive -Path "$env:USERPROFILE\Downloads\basketball-manager-PORTRAIT-DRESSING-patch-20260819.zip" -DestinationPath . -Force
cd frontend
npm run check:portrait-dressing
npm run build
npm run dev

IMPORTANT
This patch builds the editor and reusable layering system. It does not yet replace every existing player-card/headshot render in the whole game with the layered renderer. That should be a separate controlled integration after the editor fits are calibrated and approved.
