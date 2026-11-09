BASKETBALL MANAGER — LEAGUE INTEL EVIDENCE HELP + PICK LOGO TUNING
=================================================================
Base: BM-LEAGUE-INTEL-ROSTER-RINGS-PORTRAITS.zip (install this after that patch)

WHAT CHANGED
- CORE / BOARD / WATCH / INFO labels are replaced by the round '?' help
  treatment already used by the game's Settings help buttons.
- The entire row remains a single semantic button: click, Enter, or Space
  opens a readable explanation. No invalid nested buttons.
- Opening an explanation plays existing SFX #1 (sidebar-navigation-click-1).
  Closing via x, Escape, or clicking outside plays SFX #2
  (sidebar-navigation-click-2). Existing user sound on/off + volume settings
  are respected via soundManager; no new audio files.
- Evidence explanations are based on existing evidence.kind/source objects.
  WATCH is explicitly unconfirmed interest; BOARD is not an accepted deal;
  CORE is not a universal trade veto. Optional Source details preserve the
  original model/evaluator text for debugging or deeper inspection.
- Team Needs originating-team draft-pick logo now has independent x, y, scale
  controls in addition to opacity. Existing positioning of all other images,
  names and ratings remains unchanged.

MANUAL CONTROLS (frontend/src/config/leagueIntelLayout.js)

starters:
  headshot: { x, y, scale, borderWidth }
  name:     { x, y, scale }
  ring:     { x, y, scale, strokeWidth }
  card:     { borderWidth }
  divider:  { borderWidth }  <-- GRAY LINE BETWEEN HEADSHOT AND NAME

scoutingRows (Protected Core / Likely Available / Targets):
  headshot: { x, y, scale, borderWidth }
  name:     { x, y, scale }
  ring:     { x, y, scale, strokeWidth }
  card:     { borderWidth }

teamNeeds:
  headshot: { x, y, scale, borderWidth }
  name:     { x, y, scale }
  ring:     { x, y, scale, strokeWidth }
  pickLogo: { x, y, scale, opacity }  <-- NEW X/Y/SCALE
  card:     { borderWidth }

expiringDeals:
  headshot: { x, y, scale, borderWidth }
  name:     { x, y, scale }
  card:     { borderWidth }
  NOTE: OVR is text in Expiring Deals, not a visual ring at this time,
        so its ring settings have no visible target on this view.

fullRoster:
  headshot: { x, y, scale, borderWidth }
  name:     { x, y, scale }
  ring:     { x, y, scale, strokeWidth }
  card:     { borderWidth }

Offsets scale with the containing card width using CSS container units so the
same numbers should hold proportionally on a laptop. x+ moves right, y+ down;
scale 1 = 100%; pickLogo.opacity 0 = transparent, 1 = opaque.

INSTALL (Windows PowerShell)
  cd "$env:USERPROFILE\Downloads\basketball-manager"
  Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\BM-LEAGUE-INTEL-QUESTION-HELP-TUNING.zip" -DestinationPath . -Force
  cd frontend
  npm run check:intel
  node scripts/team-intel-evidence-help.regression.mjs
  node scripts/team-intel-rating-visual.regression.mjs
  npm run build
  npm run dev

NOT CHANGED
- CPU trade generator, valuation, negotiations, draft/sim execution, save
  state, Salary Table styles/settings, shared portrait and ring components.
- No new claims of real offers. Purely read-only UI explanations.

TESTS COMPLETED IN PATCH WORKSPACE
- Six existing Intel regression scripts: PASS
- Previous visual-control regression scripts: PASS
- New evidence help + pick-logo controls regression: PASS
- TypeScript JSX parser check: PASS
- PostCSS parse: PASS
- Full Vite build in user's working repo: NOT RUN here (dependencies missing)
