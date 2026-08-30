Basketball Manager — History / Seeding / Draft Ownership / Portrait FA Patch
Local date: 2026-08-29

PURPOSE
=======
This patch contains four high-confidence systemic fixes only:

1) Historical team archival
   - Completed regular-season stats remain attached to the team carried by the historical stat record.
   - Current offseason roster membership no longer rewrites the prior season.
   - True in-season multi-team stints remain preserved.
   - Targets New Chapter false prior-season leaders and Player Card false team history after FA signings.

2) Canonical standings / postseason seeding
   - Standings, Playoff Picture, and Playoffs now share one canonical live standings/tiebreak module.
   - Tie order: winning percentage, head-to-head, conference percentage, point differential, then team name for deterministic fallback.
   - Prevents Standings and Play-In/Playoffs from ranking tied teams differently.

3) Canonical ownership for traded resolved draft picks
   - Trading a resolved current-year pick updates both locked draft-order state and leagueData.draftPicks.
   - Later Draft Assets / Draft ownership reconstruction can no longer revert the acquired resolved pick to its old owner.
   - Targets both stale Draft Picks display and acquired #5 not being owned during the actual draft.

4) Generated-player free-agent portrait persistence
   - Jerseyless bases are no longer valid finished portraits for generated veterans.
   - A veteran generated FA preserves the last valid team presentation from existing FA metadata.
   - If a legacy save has no resolvable last-team jersey, the safe fallback is the finished draft-attire portrait, never the naked base.
   - Existing first-year released-rookie draft-attire behavior remains intact.
   - Existing real-player no-naked-base behavior remains intact.

FILES INTENTIONALLY NOT INCLUDED / NOT TOUCHED
=============================================
- frontend/src/config/headshotLayout.js
- frontend/src/pages/SalaryTable.jsx
- retirement layout/page files
- FA contract/minimum logic
- RFA lifecycle logic
- CPU trade evaluation logic
- injury/simulation performance logic

This preserves the user's finalized Salary Table and Retirement UI tuning.

TESTS
=====
From the frontend directory:

  node scripts/four-system-fixes-regression.mjs
  node scripts/portrait-dressing-regression.mjs

Expected:
- Four-system regression: 13/13 PASS
- Portrait dressing regression: 23/23 PASS

The broad bm-regression-check currently has the same four pre-existing CPU-trade benchmark/schema failures in untouched CPU-trade-market code. No new broad-regression failures were introduced by this patch.

MANUAL TESTING NOTES
====================
Immediate on an existing save:
- Standings vs Play-In/Playoffs should now use the same live ranking/tiebreak result.
- A generated veteran free agent should never display the jerseyless base.

Requires recreating the event if the current save was already corrupted by the old code:
- Historical archive / New Chapter / Player Card prior-team history: recreate the offseason archive/FA-signing sequence from a pre-event save or a new season. Already-written bad historical rows are persisted data and are not guessed/reconstructed by this patch.
- Resolved draft-pick trade: recreate the trade from a pre-trade save/new draft-day scenario. A pick already lost by the old canonical-ownership path is not reconstructed from trade prose/history.
