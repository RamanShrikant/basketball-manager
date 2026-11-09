BASKETBALL MANAGER — LEAGUE INTEL CHARCOAL UI PATCH
-------------------------------------------------
Only changed file:
  frontend/src/styles/BMLeagueIntel.css

Design changes (League Intel only):
- Removes navy/blue styling from League Intel panels, hero, projected starters,
  market cards, lists, buttons, evidence dialogs, and mini player rows.
- Uses the same grayscale basketball-pattern asset and gradient styling as
  the Draft Picks page (frontend/src/assets/basketball-pattern.svg).
- On the /intel route only, makes the persistent left navigation background
  neutral black/gray instead of its warmer gradient. No shared nav CSS edits.
- Keeps the existing layout, headshots, rating ring colors, orange title,
  active orange filter, active menu item, and gameplay data/evidence.

HOW TO APPLY (Windows PowerShell):
  cd "$env:USERPROFILE\Downloads\basketball-manager"
  Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\BM-LEAGUE-INTEL-CHARCOAL-UI.zip" -DestinationPath . -Force
  cd frontend
  npm run build
  npm run check:intel

Then refresh the Intel browser tab (Ctrl+Shift+R).

Safety:
- CSS only; no runtime, simulation, CPU trade, draft, finance, save, navigation,
  contracts, or other game logic changes.
- Replaces your current BMLeagueIntel.css; back up custom edits to this file
  before applying.
- Existing viewport and laptop media-query sizing rules remain intact.

Testing performed in patch workspace:
- Parsed stylesheet with tinycss2 (0 syntax errors).
- Browser checked computed colors for page/hero/panels/lineups/team rows.
- Browser checked sidebar override enabled only when data-bm-route="intel".
- Full app build cannot be performed here because app dependencies are absent;
  run npm run build in your local full repository.
