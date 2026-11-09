BASKETBALL MANAGER — LEAGUE INTEL INTELLIGENCE + STABILITY PATCH
October 2026

INSTALL
1. Keep a Git backup/commit of any uncommitted edits to the files in this patch.
2. Unzip this archive into your existing basketball-manager repository ROOT,
   allowing overwrites. Do not unzip it inside the frontend folder.
3. From frontend run:
      npm run check:intel
      npm run build
      npm run dev
4. Browser: /intel, wait for the CPU runtime to finish loading.

SCOPE (frontend only)
- src/pages/Intel_v1.jsx
- src/utils/teamIntelCpuOverlay.js
- src/utils/teamIntelLifecycle.js
- src/utils/teamIntelPythonProbe.js
- src/utils/teamIntelDiagnostics.js (NEW)
- public/python/league_intel_readonly.py
- public/workers/intelCpuReadOnlyWorker.js
- scripts/team-intel-stability.regression.mjs (NEW)
- scripts/team-intel-cpu-python.regression.mjs (fixture updated)
- package.json (check:intel adds stability test)

NO GAMEPLAY MODIFICATIONS
Does not alter Python gameplay rules, CPUTRADE bank generation, trade execution,
league save storage, game simulation, FA, draft execution, or existing manual
Salary Table configuration.

WHAT CHANGED
A) Targets: rank watchlist with the ORIGINAL CPU-to-CPU buyer fit function
   alongside the existing user's-team valuation model. These remain WATCHLIST
   entries, not offers, requested trades, or proof of mutual acceptance.
   CPU buyer/seller direction is displayed independently from the scouting
   'contending / retooling / rebuilding' strength filters.
B) State reactivity: detect changes to position, two-way/status, roster and
   player contracts, records, draft rights and protection, salary-cap rules,
   bank/history, stored gameplans, ResultsV3 index and offseason/draft state.
   Restrict rumors to reports in the current season, avoid displaying draft
   picks that fail a standalone existing user-trade eligibility check.
C) Performance: reuse the League Intel-only Pyodide observer worker, ignore
   obsolete replies, coalesce unstarted work, and keep diagnostic history in
   memory (NOT the game save).

CONSOLE TRANSACTION AUDIT
Keep the same browser tab open while navigating League Intel -> Trade Center
-> League Intel. A full hard refresh clears in-memory test snapshots.

BEFORE ANY MOVES on /intel:
   BMIntel.capture('before')
   BMIntel.summary()
   BMIntel.validate()

AFTER TRADE #1 return to /intel, wait for scouting to finish:
   BMIntel.refresh()
   // Wait for the Python runtime and scan to finish before the next line:
   BMIntel.capture('trade1')
   BMIntel.diff('before', 'trade1')

AFTER TRADE #2, same process:
   BMIntel.refresh()
   BMIntel.capture('trade2')
   BMIntel.diff('trade1', 'trade2')
   BMIntel.diff('before', 'trade2')
   BMIntel.captures()
   BMIntel.validate()

BMIntel.diff() shows movedPlayers, addedPlayers, removedPlayers,
changedPlayers (OVR/contract/position), pickChanges, teamChanges, panelChanges,
tradeCountDelta, lifecycle/CPU-direction changes, and comparison warnings.
A normal game trade may update the save asynchronously; wait until the game has
returned to /intel and saved its changes before capturing.

REGRESSIONS EXECUTED IN PATCH WORKSPACE
  npm run check:intel = 6 PASS (includes two back-to-back synthetic trades,
    changed pick ownership, roster statuses, cap, results, gameplans, old
    trade rumors, stale-worker cancellation).
  Python syntax, worker syntax, JS syntax, and JSX parser = PASS.
  npm run build not available in this context ZIP (missing full project assets
    and installed frontend dependencies); run locally and report failure.

LIMITATIONS
- No guarantee that a WATCH candidate is truly pursued by a CPU team or
  that the Trade Center will accept a complete package. This patch does not
  create a new trade generator or alter acceptance thresholds.
- Single-pick eligibility is not full multi-asset package legality; Trade
  Center remains authoritative.
- Tests simulate years 1/2/5/10/15; an uninterrupted live multi-season
  career needs additional real-game end-to-end verification.
- Records correcting an already-indexed ResultsV3 entry without changing its
  index or React league state might require BMIntel.refresh().
