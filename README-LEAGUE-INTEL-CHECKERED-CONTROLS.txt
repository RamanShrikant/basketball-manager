BASKETBALL MANAGER — LEAGUE INTEL CHECKERED CARDS & METADATA TUNING
October 2026

SCOPE: PRESENTATION ONLY. Only these files are replaced:
  frontend/src/pages/Intel_v1.jsx
  frontend/src/styles/BMLeagueIntel.css
  frontend/src/config/leagueIntelLayout.js
  frontend/scripts/team-intel-visual.regression.mjs
  frontend/scripts/team-intel-checkered-controls.regression.mjs (new)

WHAT CHANGED
- The starter PHOTO section uses the same dark basketball/checker texture as Draft Picks/League Intel's background. The existing name strip remains solid dark.
- Protected Core / Likely Available / Targets, Team Needs, Expiring Deals and Full Roster rows use subtle gray checker texture instead of flat gray.
- Position and age metadata get independent X, Y, Scale manual tuning in scoutingRows, teamNeeds, expiringDeals, and fullRoster. Starter PG/SG/SF/PF/C label gets its own position control.
- Team Needs players can show position/age when actually present in saved data; no invented metadata. The row shape stays unchanged.
- Expiring Deals now uses the SAME PlayerRatingRing.jsx orange OVR/POT ring helper as Likely Available while keeping the salary and expiration information on the right; its headshot/ring/name/age/position controls all remain independent.
- No portrait source normalization, auto-cropping, changes to CPU trade rules, simulation, Salary Table, or the data model.

YOUR EXISTING VALUES PRESERVED EXACTLY
starters.headshot = {x:15,y:-2.6,scale:1,borderWidth:0}
starters.name = {x:45,y:0,scale:1}
starters.ring = {x:15,y:-35,scale:0.7,strokeWidth:8}
starters.card.borderWidth = 1, starters.divider.borderWidth = 1
scoutingRows.headshot = {x:15,y:10,scale:1.7,borderWidth:0}
scoutingRows.name = {x:25,y:0,scale:1}
scoutingRows.ring = {x:15,y:0,scale:1,strokeWidth:7}
All prior teamNeeds/expiringDeals/fullRoster values were also preserved exactly.
New position/age controls default to x:0, y:0, scale:1.

INSTALL (PowerShell, from Downloads)
  cd "$env:USERPROFILE\Downloads\basketball-manager"
  Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\BM-LEAGUE-INTEL-CHECKERED-CONTRACTS.zip" -DestinationPath . -Force
  cd frontend
  npm run check:intel
  node scripts/team-intel-visual.regression.mjs
  node scripts/team-intel-rating-visual.regression.mjs
  node scripts/team-intel-evidence-help.regression.mjs
  node scripts/team-intel-checkered-controls.regression.mjs
  npm run build

If the app is already open, restart Vite as needed and Ctrl+Shift+R. Run the full Vite build on your local full repository; the isolated patch workspace has no node_modules.
