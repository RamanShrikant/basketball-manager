BASKETBALL MANAGER — LEAGUE INTEL LIFECYCLE INTEGRATION
2026-10-11

INSTALL INTO THE ROOT OF YOUR EXISTING, UP-TO-DATE basketball-manager REPOSITORY.
This ZIP is an overlay patch. Do not delete or replace your repository folder.

WHAT CHANGED
- Pre-trade-deadline Intel retains existing CPU boards, bank evidence, and bounded scans.
- After deadline and in playoffs: OFFSEASON OUTLOOK; no trade scans or stale CPU-bank offers.
- During offseason: existing season projection and salary/legality helpers are passed to
  the existing bounded CPU scanner. Returned packages are hypothetical, NOT guaranteed
  trade offers. No new draft-pick package generator was implemented.
- Before lottery reveal: never expose hidden exact pick slot numbers or resolved assets.
- After reveal: existing draft pick slots can be shown from saved ownership records.
- During live draft: consumed resolved pick rights excluded; no draft order changes.
- Contracts with ended salaryByYear arrays never resurrect stale direct salary amounts.
- Upcoming offseason cap from the game's existing inflation/financial-years helper.
- Changes to rosters/contracts/picks/clock/Trade Desk refresh read-only Intel evidence;
  stale scans and Python results are discarded on franchise or season changes.
- Regression fixtures test season start years 2026, 2027, 2030, 2035, 2040.

WHAT WAS NOT MODIFIED
No game simulation, trade execution, underlying CPU Python value/decision formulas,
trade-bank generation, save storage, draft lottery/draft execution, free agency,
roster rule settings, CSS layout tuning, or Salary Table code.

FILES REPLACED/ADDED
frontend/src/pages/Intel_v1.jsx
frontend/src/utils/teamIntelLifecycle.js (new)
frontend/src/utils/teamIntelObserver.js
frontend/src/utils/teamIntelCpuOverlay.js
frontend/src/utils/teamIntelPythonProbe.js
frontend/scripts/team-intel-lifecycle.regression.mjs (new)
frontend/scripts/team-intel-phase2.regression.mjs
frontend/package.json (one script change: check:intel includes new lifecycle regression)

INSTALL (PowerShell)
cd "$env:USERPROFILE\Downloads\basketball-manager"
git status --short
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\BM-LEAGUE-INTEL-LIFECYCLE.zip" -DestinationPath . -Force
cd frontend
npm run check:intel
npm run build
npm run dev

NOTE: If the ZIP is downloaded to a different folder, update the ZIP path above.
Do NOT continue if git status shows local edits to the same Intel files you want to keep;
back them up or commit first.

IN-GAME CHECKS
1. Before deadline: BMIntel.summary().lifecycle.mode should be 'live_market'.
2. After deadline or in playoffs: should be 'future_outlook'; RESCAN disappears.
3. During offseason: should be 'offseason_market'; next salary season should be shown.
4. Before lottery reveal: no unrevealed #1 / slot positions.
5. After reveal: owned/available draft rights reflect actual ownership.
6. Draft in progress: consumed picks are no longer presented as available assets.
7. Switch controlled franchise, make a roster trade, advance season, reopen League Intel:
   BMIntel.market().controlledTeam and rows must reflect the current save.
8. BMIntel.validate() should report ok:true. A passing check alone does NOT
   prove a hypothetical deal is legally executable.

TEST STATUS
The five included Intel test scripts have passed in the supplied targeted source
context. A full Vite build could NOT be run in the targeted context: the supplied
context omits node_modules and a prebuild portrait-sync script. Run npm run build
locally on your full project before committing. Full end-to-end gameplay/15-season
simulation has NOT been performed. Synthetic regression tests are not a guarantee
of zero future bugs.
