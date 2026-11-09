BASKETBALL MANAGER — LEAGUE INTEL OBSERVER, PHASE 1
SOURCE BASELINE: c67196faf5fb5010dae6b191fe5fe829063591b1

FILES IN THIS PATCH
  NEW  frontend/src/utils/teamIntelObserver.js
  NEW  frontend/scripts/team-intel-observer.regression.mjs
  EDIT frontend/package.json — one added check:intel script

UNCHANGED
  frontend/src/pages/Intel_v1.jsx (visual UI not yet redesigned)
  All existing CPU trade engines/evaluators/trade bank and execution modules
  Simulation, salary mechanics, Free Agency, draft and save infrastructure
  All visual layout configurations, including contractExtensionsLayout.js

WHAT PHASE 1 DOES
  - Observes current standard rosters and player OVR, age, potential, contracts
  - Gives a basic five-position rating-based PROJECTION, not gameplan starters
  - Reports literal position depth counts; not inferred offense/defense weaknesses
  - Labels top roster players as roster leaders, NOT confirmed CPU untouchables
  - Reads cpuTradeBankState candidates with acceptedAtGeneration and team ownership
  - Excludes stale candidates when a referenced player is no longer on that team
  - Preserves direction: who was outgoing/incoming in the CPU package
  - Reads draft pick ownership, but does not declare picks legal to trade
  - Reports standard roster payroll, never pretends it is spendable cap room
  - Never calls the trade engine, creates a trade, writes storage, or mutates saves

EVIDENCE LIMITATIONS
  An accepted bank candidate is not a confirmed executable deal, is not a GM
  shopping list, and may still be rejected at a subsequent execution gate.
  Stale checks verify PLAYER OWNERSHIP, not every salary/pick/Stepien restriction.
  A real CPU GM protected-core list is not currently universally observable.
  Empty target and available lists are legitimate and MUST NOT be auto-filled.
  Records are passed in by the existing standings system when integrated.

INSTALL IN WINDOWS POWERSHELL (from Downloads)
  1. Inspect git status; your existing contractExtensionsLayout.js edit is safe.
  2. cd "$env:USERPROFILE\Downloads\basketball-manager"
  3. Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\BM-TEAM-INTEL-OBSERVER-PHASE1.zip" -DestinationPath . -Force
  4. cd frontend
  5. npm run check:intel
  6. cd ..
  7. git status --short

EXPECTED TEST
  PASS team-intel observer: source, roster, lineup, contracts, finances,
  picks, CPU evidence, stale bank, no mutation, empty states, year isolation

NEXT PHASE (NOT INCLUDED HERE)
  Attach observer to the League Intel view, then the premium no-scroll visual UI.
  Add a development-only browser-console BMIntel summary/validate entrypoint.
  Run local-save checks against your real season/CPU bank and full regression.

NOTE: This ZIP does not include or overwrite your original gameplay files.
