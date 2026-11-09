BASKETBALL MANAGER - LEAGUE INTEL PHASE 2
=========================================

PATCH CONTENTS
- frontend/src/pages/Intel_v1.jsx          (replaces old UI, connects observer)
- frontend/src/styles/BMLeagueIntel.css    (new completely scoped UI stylesheet)
- frontend/src/utils/teamIntelObserver.js  (Phase 1 updated to V2)
- frontend/scripts/team-intel-phase2.regression.mjs (new tests)
- frontend/scripts/team-intel-observer.regression.mjs (Phase 1 tests unchanged)
- frontend/package.json                    (extends check:intel to run both tests)
- INTEL-PHASE2-REFRESH-OLD-TESTS.ps1        (OPTIONAL: two stale assertions)

GAMEPLAY SAFETY
- No files from CPU trade generator/bank/validator/evaluation, Free Agency,
  drafts, simulation, or save systems are included in this patch.
- Never invokes CPU trade evaluation or trade execution. Never writes to save.
- Page reads existing gameplan localStorage and the existing ResultsV3 reader.
- Existing Salary Table and Contract Extensions manual UI tuning untouched.
- Team rank/phase are SCOUTING ESTIMATES from roster strength and (after 20
  games for everyone) win percentage. They are not canonical Power Rankings.
- "Protected Core" contains top-rated roster leaders, NOT permanent CPU vetoes.
- "Likely Available" displays observed accepted-at-generation bank player
  packages if any; otherwise labeled scouting estimates. No guarantee of trade.
- "Targets" displays observed incoming CPU bank players if any; otherwise
  explicitly labeled needs-based fits, NOT standing GM wishlists.
- Bank evidence checks current player and draft-pick ownership. It does not
  re-run actual trade validation, which could alter CPU behavior or be costly.
- Team Needs currently means only standard primary-position depth below 2.
- Payroll figure is a sum of current standard-player contracts when complete.
  It is not spendable cap room and doesn't claim to include cap holds.
- Opposing team's Full Roster opens an in-page, read-only roster drawer/dialog.

INSTALL (PowerShell, repo root)
cd "$env:USERPROFILE\Downloads\basketball-manager"
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\BM-TEAM-INTEL-PHASE2.zip" -DestinationPath . -Force

RUN TESTS
cd frontend
npm run check:intel
npm run build
npm run test:bm

PRIOR TWO STALE REGRESSION CHECKS
The previous suite had 2 known failures unrelated to Intel:
1) Contract Extensions navigation moved to TeamHubSidebar.jsx.
2) CPU bank VERSION 13; test was hardcoded to VERSION 12.
To fix only those regression assertions after installing this patch:
cd ..
& .\INTEL-PHASE2-REFRESH-OLD-TESTS.ps1
cd frontend
npm run test:bm
If PowerShell script execution is blocked, use:
powershell -ExecutionPolicy Bypass -File .\INTEL-PHASE2-REFRESH-OLD-TESTS.ps1
(run this from the repo root).

BROWSER VERIFICATION (Run dev, navigate to /intel, F12 -> Console)
BMIntel.help()
BMIntel.summary()
BMIntel.validate()
BMIntel.team("Oklahoma City Thunder")
BMIntel.sources()
BMIntel.inspect("Oklahoma City Thunder", "core", "Shai Gilgeous-Alexander")
BMIntel.inspect("Oklahoma City Thunder", "available", "<observed player>")
BMIntel.inspect("Oklahoma City Thunder", "scoutedAvailability", "<scouted player>")
BMIntel.inspect("Oklahoma City Thunder", "targets", "<observed incoming player>")
BMIntel.inspect("Oklahoma City Thunder", "projectedFits", "<estimated fit>")

In the UI, click any player row/need/expiring contract for evidence; "View
Full Roster" opens an in-place, live, read-only roster listing. If available
or targets sections have no CPU packages, their subtitles say they're estimates.

ACTUAL SAVE ACCEPTANCE
- Verify roster, OVR, age and contract against actual roster/salary table.
- Open multiple teams; verify selected team is excluded.
- Click evidence on core / available / targets and check trace status.
- After a normal in-game trade, revisit Intel: no stale source-team players.
- After sim, check results and estimated ranks update.
- Verify no page-wide scrolling at 1920x1080 and inspect a laptop resolution.
- Run a normal unrelated Trade Finder/Free Agency/simulation smoke test.

VALIDATION LIMITATION
Unit tests are run against deterministic fixtures. This patch is built from
user-provided targeted source context, not the entire app. Actual full Vite
build, visual screenshots and live-save assertions must run locally.

No commits/pushes are included. Review git diff before committing.
