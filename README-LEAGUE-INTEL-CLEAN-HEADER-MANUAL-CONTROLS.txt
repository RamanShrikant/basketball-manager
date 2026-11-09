BASKETBALL MANAGER — LEAGUE INTEL CLEAN HEADER & MANUAL TUNING
===============================================================

PURPOSE
- Opponent team logos have no square backgrounds.
- Header shows only team identity + Record + Payroll in normal text.
- Removes scout conference rank, CPU buyer, contending, scout number,
  average-age pills and the large stat boxes from the hero.
- Starter positions are plain text, without boxes.
- Intel OVR rings use orange/gold across all ratings rather than green/yellow.
- A gray divider separates each starter's headshot area and name area.
- Independent manual X/Y/scale for headshots AND names for four row types.
- Keeps the existing charcoal / Draft Picks inspired theme.

INSTALL
1) In your Windows Downloads folder, save the ZIP from the chat.
2) Back up any uncommitted edits to the three affected source files.
3) From PowerShell in the basketball-manager repository root:

   Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\BM-LEAGUE-INTEL-CLEAN-HEADER-TUNING.zip" -DestinationPath . -Force

4) cd frontend
   npm run check:intel
   node scripts/team-intel-visual.regression.mjs
   npm run build

5) Refresh /intel in the browser (Ctrl+Shift+R).

EDIT MANUAL CONTROLS
File: frontend/src/config/leagueIntelLayout.js

The sections are separate:

  starters:      projected lineup (5 large cards)
  scoutingRows:  Protected Core / Likely Available / Targets
  expiringDeals: bottom middle panel
  fullRoster:    View Full Roster popup

Each has TWO independent controls:
  headshot: { x: 0, y: 0, scale: 1 },
  name:     { x: 0, y: 0, scale: 1 },

Example: move the big starter portrait slightly left/up and enlarge it, but
leave the starter name where it is:

  starters: {
    headshot: { x: -10, y: -8, scale: 1.08 },
    name:     { x: 0,   y: 0,  scale: 1 },
  },

x positive moves right; y positive moves down. "scale: 1" is original size.
These offsets are reference pixels that automatically scale with each card's
width using CSS container queries. No separate laptop profile is needed.
Only values in this file need editing; no browser controls/save steps.

SCOPE
Only these files are replaced/added:
- frontend/src/pages/Intel_v1.jsx
- frontend/src/styles/BMLeagueIntel.css
- frontend/src/config/leagueIntelLayout.js (new)
- frontend/scripts/team-intel-visual.regression.mjs (new; optional quick test)

NO CHANGES to Salary Table manual settings or headshotLayout.js.
NO CHANGES to CPU trading, simulation, rookies, draft, saves or other screens.

VERIFICATION
- All existing Intel regression tests passed in the partial test workspace.
- Independent visual tuning test passed (header, controls, CSS hooks).
- CSS parsed successfully using PostCSS.
- Full Vite build on the local app is still required (dependencies unavailable
  in the patch-only workspace); this is an honest limitation, not a known error.
