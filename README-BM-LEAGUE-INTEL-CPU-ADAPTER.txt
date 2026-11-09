BASKETBALL MANAGER — LEAGUE INTEL CPU EVIDENCE ADAPTER
Observer v4 / install ON TOP OF PHASE 2 (works if Phase 2.1 refinement is absent)

THIS IS AN INTEL-ONLY PATCH. Do not copy any previous backup directories.

FILES INCLUDED
  frontend/src/pages/Intel_v1.jsx
  frontend/src/styles/BMLeagueIntel.css
  frontend/src/utils/teamIntelObserver.js
  frontend/src/utils/teamIntelCpuOverlay.js                  [NEW]
  frontend/scripts/team-intel-phase2.regression.mjs
  frontend/scripts/team-intel-cpu-evidence.regression.mjs  [NEW]
  frontend/package.json
  README-BM-LEAGUE-INTEL-CPU-ADAPTER.txt

HOW IT WORKS
1. The existing CPU Trade Bank is read first from the saved league. Entries must be
   accepted when generated, match the current season, and reference assets still
   owned by the teams. The dashboard displays both player and draft-pick assets.
   *BANK does NOT mean it has been re-accepted against current trade settings.*
2. Existing Trade Desk rumors/negotiations are read via readTradeDeskFeed(). Their
   headlines appear in the Targets panel as reports, NOT automatically targets.
3. After the selected opponent is stable for 850ms, the existing async bounded
   scanCpuTradeMarket() checks one matchup versus the controlled franchise and
   then up to 29 other teams (excluding yours). Obsolete work is cancelled on
   navigation/league changes. Only one selected team's scan is active at a time.
   The scan uses the existing bilateral CPU trade evaluators, caps, hard rules,
   contracts, and pick handling. It does NOT call the CPU bank generator or
   execution methods. SCAN signals are plausible hypothetical deals only.
4. User assets in Team Needs appear only after a specific hypothetical package
   passes the existing CPU mutual scanner AND the normal user-facing exact CPU
   acceptance check. Otherwise Team Needs shows generic preference descriptors
   based on the existing six-phase trade_team_ai.py direction weights (not a
   newly invented valuation formula). A user asset is NOT a standing CPU offer.
5. Expiring Deals and Assets & Constraints continue to come from live saved data.
6. Old Intel-only scored availability and projected target rankings are no longer
   calculated. Protected Core still displays top-rated roster leaders as a
   transparent scouting projection, NOT a hard CPU veto. This is a remaining
   architectural boundary: the private Python _is_shared_untouchable_core()
   function is not exposed as a browser-safe, stable read-only CPU API.

IMPORTANT LIMITATIONS / TRADE RULE SAFETY
- Preseason bank can be empty: there is no real CPU intent on disk to display.
  An existing CPU proposal scanner can still find hypothetical opportunities.
- CPU-to-CPU and user-facing evaluator rules are related, but not identical.
  User assets get the extra user-facing acceptance check; actual Trade Center
  execution can still fail due to deadline, patience, later roster changes,
  contract restrictions, financial constraints or other settings.
- "No match" after a 9s limited league scan does NOT prove no trade is possible.
  The existing scanner considers a bounded subset of packages and matchups.
- The six displayed negotiation directions mirror current trade_team_ai.py
  thresholds. The separately implemented CPU-to-CPU generation phases have
  different names and details. The displayed label is NOT the CPU-to-CPU phase.
- Mirrored Python direction thresholds require an Intel update if the original
  Python team-direction code is changed later; no original CPU files were edited.
- Trade Desk entries are reports, not private saved wishlists. The feed is not
  guaranteed to contain every background negotiation.
- Old CPU bank candidates are accepted at GENERATION, not automatically valid
  against the present-day evaluator. Picks and players are only rechecked for
  current ownership in the passive observer.
- Market scans may take seconds on slower laptops, with a maximum budget from
  cpuTradeDiscovery.js; they run in memory and are cancelled on navigation.
- This patch does not change player contracts, team ratings, trades, trading
  algorithms, protected-core rules, Free Agency, draft, roster or simulation.

INSTALL FROM PROJECT ROOT — PowerShell
  cd "$env:USERPROFILE\Downloads\basketball-manager"
  Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\BM-LEAGUE-INTEL-CPU-ADAPTER.zip" -DestinationPath . -Force
  cd frontend
  npm run check:intel
  npm run build
  cd ..
  git status --short

RUN LIVE
  cd frontend
  npm run dev
  # Open League Intel; wait for scanning and then select OKC or another CPU team
  # F12 Console:
  BMIntel.summary()       // version: 4
  BMIntel.validate()      // checks saved observer + displayed market ownership
  BMIntel.market()        // evidence provenance, trade scan stats, user assets
  BMIntel.sources()       // bank candidates and explicit limitations

EXPECTED: [BANK] saved CPU-bank generation evidence; [SCAN] existing evaluated
hypothetical CPU-to-CPU opportunity; Team Needs generic labels when no
user-facing accepted package is found. Target pick rows are shown as R1/R2.

POSTINSTALL VERIFICATION
- No navigation or sim features should be changed.
- Test a preseason new save (empty bank) and later save with bank candidates.
- Test changing selected team while scan is pending, verifying old results are
  not displayed on the new team.
- Test at desktop and laptop resolution; take screenshots to confirm layout.
- Do not commit until npm run build and live-save spot check pass locally.
- Existing bm-regression-check.mjs stale assumptions about TeamHub navigation
  and CPU bank version 12 vs 13 may still produce two unrelated red tests.

INTEGRITY
No gameplay/CPU trade engine, storage, Salary Table, Free Agency, season
simulation, contractExtensionsLayout.js, or headshotLayout.js files are in ZIP.
