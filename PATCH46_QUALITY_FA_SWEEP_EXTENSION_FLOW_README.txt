Patch 46 — Quality FA Sweep + Extension Flow Polish

Scope:
- frontend/public/python/free_agency_logic.py
- frontend/public/python/player_mood_logic.py
- frontend/public/python/contract_extension_logic.py

What changed:
- Restores/retunes the existing pre-simulation high-value free-agent sweep for deflated rosters.
- The old 76+ unsigned-FA sweep now uses 71+ visible OVR.
- The sweep still signs placeable quality free agents to one-year CPU deals before regular-season simulation.
- User team remains skipped.
- Existing cap/exception/minimum validation remains in place.
- Older fringe/depth veterans are less likely to flood Contract Extensions with HAS ASK unless they have real role/upside.
- Generic rookie-deadline close calls are normalized so they cannot close the veteran window before March 31.

What did NOT change:
- free-agency Day 1 bidding logic
- CPU extension approval from Patch 45
- rookie signing decisions
- extension salary/package generation
- progression/regression
- trade logic
- sim game engine

Validation performed by this patch script:
- py_compile free_agency_logic.py
- py_compile player_mood_logic.py
- py_compile contract_extension_logic.py
- quality FA sweep threshold marker check
- extension fringe-interest hook check
- extension deadline phase-normalizer check
