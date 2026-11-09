BASKETBALL MANAGER — LEAGUE INTEL INNER RING TEXT + CENTRED NAMES
===================================================================

WHY THIS PATCH
- Add 4 separate manual groups for text inside OVR/POT rings in ALL Intel sections.
- Auto-centre starter names and shrink long names (e.g., Giannis Antetokounmpo)
  if necessary at desktop or laptop resolutions.
- Preserve the user's pasted CURRENT `leagueIntelLayout.js` settings exactly.
- No CPU/scouting/gameplay logic, saved league data, Salary Table tuning,
  or shared `PlayerRatingRing.jsx` changes.

THE MANUAL CONTROLS
Open frontend/src/config/leagueIntelLayout.js

Every Intel section now has, IN ADDITION to the existing `ring` outer-circle
controls:
  ringText:  { x: 0, y: 0, scale: 1 }, // all inner text (OVR, number, POT)
  ringLabel: { x: 0, y: 0, scale: 1 }, // just 'OVR'
  ringValue: { x: 0, y: 0, scale: 1 }, // just the numeric rating
  ringPot:   { x: 0, y: 0, scale: 1 }, // just 'POT xx'

For example, to move ONLY the numbers in Protected/Available/Targets:
  scoutingRows.ringValue.x = -2
  scoutingRows.ringValue.y = 1
  scoutingRows.ringValue.scale = 0.9

The EXISTING `ring` controls still position/scale the entire ring and configure
its strokeWidth, and have NOT been changed.

STARTER NAMES
- All five cards now align their names to the exact centre of the name strip.
- The EXISTING starters.name.x = 45 is kept and becomes the centred reference.
- Change it to 50 to nudge the name right, or 40 to nudge it left.
- starters.name.y and starters.name.scale remain user-editable.
- Longer names shrink automatically until the text fits inside the card.
- Name fitting is computed separately for each card when its dimensions change.
- No player-specific portrait sizing changes; no new portrait-source logic.

EXACT USER SETTINGS PRESERVED
  starters.headshot { x:15, y:-2.6, scale:1, borderWidth:0 }
  starters.name     { x:45, y:0, scale:1 }
  starters.ring     { x:15, y:-35, scale:.7, strokeWidth:8 }
  scoutingRows.headshot { x:20, y:10, scale:1.7, borderWidth:0 }
  scoutingRows.name     { x:40, y:0, scale:1 }
  scoutingRows.ring     { x:25, y:0, scale:1.2, strokeWidth:7 }
  scoutingRows.position { x:40, y:0, scale:1 }
  scoutingRows.age      { x:40, y:0, scale:1 }
  teamNeeds, expiringDeals, fullRoster, pickLogo, borders and other settings
  retain the exact values from the user's supplied config.

INSTALL (PowerShell from repository root)
  Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\BM-LEAGUE-INTEL-INNER-RING-NAME-FIT.zip" -DestinationPath . -Force
  cd frontend
  npm run check:intel
  node scripts/team-intel-visual.regression.mjs
  node scripts/team-intel-rating-visual.regression.mjs
  node scripts/team-intel-checkered-controls.regression.mjs
  node scripts/team-intel-ring-text-autofit.regression.mjs
  npm run build

TESTED HERE
- All 6 Intel logic regression scripts passed.
- Three prior Intel visual checks passed.
- New inner-text/manual-controls/auto-fit regression passed.
- CSS parsed with PostCSS.
- Headless Chromium validated centring/fit at 185px and 120px card widths.
- Full Vite production build cannot be run in this partial source snapshot;
  please run npm run build on your complete local repository.

PACKAGE CONTENTS
frontend/src/config/leagueIntelLayout.js
frontend/src/pages/Intel_v1.jsx
frontend/src/styles/BMLeagueIntel.css
frontend/scripts/team-intel-visual.regression.mjs
frontend/scripts/team-intel-ring-text-autofit.regression.mjs
README-LEAGUE-INTEL-INNER-RING-NAME-FIT.txt
