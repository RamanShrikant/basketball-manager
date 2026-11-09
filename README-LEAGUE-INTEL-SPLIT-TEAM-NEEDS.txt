BASKETBALL MANAGER — LEAGUE INTEL: SPLIT TEAM NEEDS
October 12, 2026

WHAT CHANGES
- Bottom LEFT:  TEAM NEEDS: PLAYERS — up to 2 CPU-valued assets from your currently selected controlled roster.
- Bottom MIDDLE: TEAM NEEDS: PICKS — up to 2 CPU-valued, standalone-eligible picks you own.
- Bottom RIGHT:  ASSETS & CONSTRAINTS — unchanged.
- Expiring Deals is removed from the League Intel page, as requested. It is not deleted from saved game data, contract logic, or other screens.
- The existing player headshots, OVR/POT ring, originating-team pick logo, gray checkerboard, inspect click, and evidence disclaimer remain.
- Each panel's two visual row slots are fixed. Empty data is shown honestly, never fabricated.
- Existing CPU evaluator-backed hypothetical user assets remain ranked before valuation-only evidence, independently in EACH category.
- The CPU Python read-only observer now returns a bounded pool of existing player/pick valuations instead of prematurely discarding valid alternatives from the combined top three. JS then applies the original legal-pick filter and displays two.

TUNING SETTINGS PRESERVED EXACTLY AS PROVIDED
- starters.headshot {x:15,y:-2.6,scale:1,borderWidth:0}
- starters.name {x:45,y:0,scale:1}
- starters.ring {x:15,y:-35,scale:.7,strokeWidth:8}
- scoutingRows.headshot {x:20,y:10,scale:1.7,borderWidth:0}
- scoutingRows.name {x:40,y:0,scale:1}
- scoutingRows.ring {x:25,y:-5,scale:1.1,strokeWidth:7}
- scoutingRows.ringText {x:0,y:0,scale:.8}
- scoutingRows.position/age x:40,y:0,scale:1
- All other user-provided values preserved, including teamNeeds.pickLogo.opacity .36 and all shared inner-ring text settings.
- expiringDeals settings remain in config for backwards compatibility even though this panel is no longer displayed.

PATCH FILES
frontend/src/pages/Intel_v1.jsx
frontend/src/styles/BMLeagueIntel.css
frontend/src/config/leagueIntelLayout.js
frontend/src/utils/teamIntelCpuOverlay.js
frontend/public/python/league_intel_readonly.py
frontend/scripts/team-intel-visual.regression.mjs
frontend/scripts/team-intel-rating-visual.regression.mjs
frontend/scripts/team-intel-ring-text-autofit.regression.mjs
frontend/scripts/team-intel-split-needs.regression.mjs

INSTALL in project root (PowerShell):
  cd "$env:USERPROFILE\Downloads\basketball-manager"
  Copy-Item frontend\src\config\leagueIntelLayout.js frontend\src\config\leagueIntelLayout.before-needs-split.js.bak
  Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\BM-LEAGUE-INTEL-SPLIT-TEAM-NEEDS.zip" -DestinationPath . -Force
  cd frontend
  npm run check:intel
  node scripts/team-intel-split-needs.regression.mjs
  node scripts/team-intel-ring-text-autofit.regression.mjs
  node scripts/team-intel-visual.regression.mjs
  node scripts/team-intel-rating-visual.regression.mjs
  npm run build

Optional browser Console while on /intel:
  const m = BMIntel.market();
  console.log('Player needs:', m.userPlayerNeeds);
  console.log('Pick needs:', m.userPickNeeds);
  console.log('Validation:', BMIntel.validate());

TESTING
- 6 Intel check:intel regression scripts passed in isolated source workspace.
- 4 visual/manual-control/split-needs regression scripts passed, including 4 players, 4 firsts, the top pick failing eligibility, and next two eligible picks being shown.
- JavaScript/JSX syntax parsed successfully using TypeScript AST, CSS parsed using PostCSS, Python compiled.
- Full Vite npm build was not run here because the isolated workspace lacks the full installed frontend dependencies. Run it locally.

NO GAMEPLAY CHANGES
Do not modify Salary Table manual controls, CPU decision weights/trade approval, simulation, roster, contract extension rules, saves, or the draft logic. This patch only modifies League Intel presentation, read-only CPU valuations and Intel tests.
