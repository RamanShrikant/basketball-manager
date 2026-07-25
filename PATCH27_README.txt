BASKETBALL MANAGER PATCH 27
Calendar Resume/Trade-Deadline Performance + Reverse Trade Finder Coverage
Date: 2026-07-25
Base commit inspected: afb0969c7d1586d7b25734dabc7a11b410cb1cc0

BASE REQUIREMENT
- Apply over the clean main-branch project represented by the supplied context ZIP.
- No package or dependency changes are included.

ROOT CAUSES CONFIRMED
1. Calendar resume slowdown
   - Sim To Date and Sim Season restarted their date loops at opening night.
   - CPU trade-bank processing ran before completed games were skipped, so a resumed run repeated trade generation, bank consumption, record building, revalidation, and execution checks for historical dates.
   - Once the deadline had passed, Calendar still entered the CPU trade pass. The bank blocked actual trades internally, but Calendar continued performing expensive setup/revalidation work.
   - A pre-deadline background generation job could remain attached until a later pass consumed it.

2. Reverse Trade Finder false no-offer results
   - Reverse Finder reused the standard finder candidate order, which deliberately ranks strongest packages first. A finite cap could therefore crowd out cheaper/near-target asking prices.
   - Only a small exact-evaluation slice was checked after the fast scan.
   - Exact-accepted packages were discarded whenever the CPU acceptance margin exceeded 8, even though those offers were completely legal and accepted.
   - When the fast scan and exact model disagreed, there was no exhaustive rescue path before reporting no trades.

WHAT CHANGED
A. Calendar and CPU trades
- Finds the first genuinely pending game date before each long simulation.
- Preserves Trade Deadline and All-Star checkpoints, but skips per-game storage/reconciliation work for completed historical dates.
- Runs CPU trade processing only on genuinely pending dates before the deadline.
- Hard-locks the CPU trade pass before any record building, bank initialization, generation consumption, revalidation, or execution work on and after the deadline.
- Detaches an unfinished pre-deadline generation job at the deadline; its eventual completion is ignored safely.
- Records elapsed time, historical dates skipped, deadline dates skipped, CPU-trade passes/time, completed CPU trades, and games simulated.

B. Reverse Trade Finder
- Adds an optional reverse-only nearest-value candidate order. Standard Trade Finder keeps its prior strongest-first default unchanged.
- Expands raw candidate coverage to 640 and retains up to 220 legal reverse candidates.
- Preserves simple one-asset asking prices before multi-asset variations.
- Runs 48 initial exact checks, then checks every remaining retained legal candidate when fewer than five distinct offers were found, stopping early once five are available.
- Removes the invalid upper acceptance-margin filter. Legal exact-accepted packages are no longer hidden simply because the CPU likes the deal by more than eight points.
- Keeps exact execution validation for ownership, salary matching, and temporary roster limits.
- Returns stage-specific no-offer messages and detailed counters for generation, roster filters, salary filters, scan acceptance, initial/rescue exact checks, exact acceptance, comfort-floor rejection, and final validation.

C. Diagnostics and regression coverage
- Console command: bmDiag.simPerformance()
- Console command: bmDiag.reverseTradeFinder()
- Direct snapshots:
  window.__BM_LAST_SIMULATION_PERFORMANCE__
  window.__BM_LAST_REVERSE_TRADE_FINDER__
- Optional detailed CPU trade logging remains available with:
  window.__debugCpuTrades = true
- Expanded the Node regression suite to cover deadline locking, historical resume skipping, active pre-deadline processing, reverse single-asset preservation, deduplication, rescue queue behavior, and unchanged standard finder defaults.

FILES
- frontend/src/pages/Calendar.jsx
- frontend/src/pages/TradeFinder.jsx
- frontend/src/utils/bmDiagnostics.js
- frontend/src/utils/calendarCpuTradeTiming.js                (new)
- frontend/src/utils/reverseTradeFinderCoverage.js           (new)
- frontend/src/utils/reverseTradeFinderOfferEngine.js
- frontend/src/utils/tradeFinderPackageBuilder.js
- frontend/scripts/bm-regression-check.mjs

EXPECTED LIVE VERIFICATION
1. Start a long sim toward the sixth-last game, handle the Trade Deadline checkpoint, then continue toward the second-last game.
2. Open the latest collapsed [BM SIM PERFORMANCE] console group or run bmDiag.simPerformance().
3. A resumed run whose first pending date is on/after the deadline should show:
   - cpuTradePasses: 0
   - cpuTradeMs: 0
   - historicalDatesSkipped greater than 0 when prior dates were already complete
   - deadlineDatesSkipped covering the pending post-deadline dates
4. Try Reverse Trade Finder on several ordinary players and picks.
5. Run bmDiag.reverseTradeFinder() after any search. A true no-offer result now shows exactly which stage removed candidates rather than silently returning a generic message.

BUILD NOTE
- Run npm run test:bm and npm run build after applying.
- Existing baseline-browser-mapping, Browserslist, mixed dynamic/static import, and large-chunk messages are warnings only when the build exits with code 0.
- Do not update dependencies solely to remove those warnings as part of this patch.
