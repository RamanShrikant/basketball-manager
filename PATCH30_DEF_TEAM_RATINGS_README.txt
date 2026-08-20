BM Patch 30 - Native Deflated Team Ratings Calibration

Purpose:
- Treat the deflated roster scale as the real Basketball Manager scale.
- Tune Team OVR/OFF/DEF/FTR first, before trade/free-agency/progression tuning.
- Lower star/core thresholds so 80+ players matter as core pieces and 88+ players matter as superstar-level pieces.
- Add a soft top-end star curve so 97-99 players do not become absurdly more valuable than 93-96 players.
- Make a 65 -> 70 roster upgrade matter more under the deflated scale.

Files patched:
- frontend/src/api/teamRatings.js
- frontend/src/utils/ensureGameplans.js
- frontend/src/pages/PowerRankings.jsx
- frontend/public/python/efficiency.py
- frontend/public/python/game_sim.py

Main changes:
- Team OVR scale center moved from old 84/81 language to native 80/76 language.
- OFF/DEF scale center moved from old 84/82 language to native 80/77 language.
- Star reference moved from 84 to 80.
- Star curve now soft-caps the gap above 92-equivalent territory.
- Star multipliers and exponents reduced so elite players remain elite but 97 -> 99 is not a massive team-rating jump.
- Team POT proof/elite thresholds moved from old 84/92 to native 80/88, with lower multipliers to prevent huge POT spikes.
- GAMEPLAN_VERSION bumped from 18 to 19.
- Power Rankings roster cache bumped from v6 to v7.
- Python sim means moved from OFF/DEF 80 to 77, matching the new deflated team scale.
- Python efficiency coverage penalty aligned with frontend constants.

This patch intentionally does NOT touch trade logic yet. The next patch should use the new Team OVR/POT/FTR outputs to retune trades, CPU-to-CPU trades, mega-trade thresholds, free agency, and extensions.
