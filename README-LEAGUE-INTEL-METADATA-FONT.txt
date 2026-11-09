LEAGUE INTEL — PLAYER POSITION & AGE FONT MATCH

Scope: Only frontend/src/styles/BMLeagueIntel.css is replaced.

The player position and age labels in Protected Core, Likely Available,
Targets, and Team Needs: Players now match player names in font family
and bold font weight (950). Their size remains slightly smaller to prevent
crowding in narrow row cards. A comfortable line-height prevents clipping.

No changes to any of your manual X/Y/scale, ring, or pick-logo controls.
No changes to the Salary Table, CPU logic, trades, rosters or saves.

INSTALL:
  1. Copy the ZIP to Downloads.
  2. Back up the current frontend/src/styles/BMLeagueIntel.css if desired.
  3. Expand-Archive -LiteralPath "$env:USERPROFILE\\Downloads\\BM-LEAGUE-INTEL-METADATA-FONT.zip" -DestinationPath . -Force
     (Run from the root basketball-manager repository.)
  4. Run `cd frontend` then `npm run build` and refresh the browser.
