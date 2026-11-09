BASKETBALL MANAGER — LEAGUE INTEL: ROSTER VIEW OVR/POT RINGS + PORTRAIT REFINEMENT

PATCH CONTENTS (presentation-only):
  frontend/src/pages/Intel_v1.jsx
  frontend/src/styles/BMLeagueIntel.css
  frontend/src/config/leagueIntelLayout.js
  frontend/scripts/team-intel-visual.regression.mjs
  frontend/scripts/team-intel-rating-visual.regression.mjs

INSTALL: Extract this ZIP at the repository ROOT with folder paths intact.
  PowerShell:
    cd "$env:USERPROFILE\Downloads\basketball-manager"
    Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\BM-LEAGUE-INTEL-ROSTER-RINGS-PORTRAITS.zip" -DestinationPath . -Force
    cd frontend
    npm run check:intel
    node scripts/team-intel-visual.regression.mjs
    node scripts/team-intel-rating-visual.regression.mjs
    npm run build

VISUAL CHANGES:
- The exact shared PlayerRatingRing.jsx used by Roster View is now used
  in League Intel's starter, scouting, Team Needs player and roster-popup rings.
  It renders OVR and POT from existing roster values. No new valuation or rating logic.
- The five starter names remain below the headshot divider, but ages are hidden.
- No artificial square portraits in Protected Core, Likely Available, Targets,
  Team Needs player entries and Expiring Deals. Transparent headshot backdrop.
- Team Needs player entries keep the same outer row dimensions; they use a
  compact player portrait and the shared OVR/POT ring. Labels show player name.
- Team Needs draft picks display a dimmed logo for the ORIGIN team of the pick,
  not necessarily its current owner (which may be your controlled franchise).
- Existing Intel charcoal theme, colors, top header, lifecycle behavior,
  scouting sourcing, trade engine and all saved league data unchanged.

MANUAL CONTROLS (exact file):
  frontend/src/config/leagueIntelLayout.js

  Group                   Description
  starters                Five large lineup player cards
  scoutingRows            Protected Core, Likely Available, Targets
  teamNeeds               Bottom-left user-asset rows (player/pick)
  expiringDeals           Bottom-middle expiring-contracts list
  fullRoster              Full Roster modal

  In each group:
  headshot.x, .y, .scale          Headshot position and zoom
  headshot.borderWidth           Border thickness (0 = no square)
  name.x, .y, .scale              Name position and zoom
  ring.x, .y, .scale              Orange OVR/POT ring position and zoom
  ring.strokeWidth               SVG ring thickness, e.g. 5, 7, 10
  card.borderWidth               Outer card outline thickness

  Additional controls:
  starters.divider.borderWidth   Gray line between starter portrait and name
  teamNeeds.pickLogo.opacity     Draft pick origin-logo transparency (0 to 1)

  Positive x is right, positive y is down; 1.0 is normal scale.
  Positions use responsive card-width units, as in the previous Intel patch.

SAFETY/TESTING:
  Six existing Intel regression suites passed against the assembled workspace,
  plus the two visual regressions. JSX syntax and CSS parser checks passed.
  The isolated environment does not include the full application dependencies
  or the portrait sync script; run npm run build on your own full repository.
  No shared PlayerRatingRing.jsx, Salary Table configuration, trade logic,
  simulator, draft engine, storage or global styling is included in the ZIP.
