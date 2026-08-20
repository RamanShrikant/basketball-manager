BM Patch 31 — Native Deflated Scale Stretch + JSON Stat Profile Tune

Purpose
- Keep the game native to the deflated roster scale.
- Smoothly stretch team ratings for the current deflation roster target ranges without hard caps/mins:
  - Team OVR about 89–65
  - OFF about 92–68
  - DEF about 91–66
  - POT about 93–65
- Preserve final player OVR/POT/offRating/defRating in the JSON.
- Improve stat-driving player attributes so sim output better follows real recent healthy profiles.

Code files changed
- frontend/src/api/teamRatings.js
- frontend/src/utils/ensureGameplans.js
- frontend/src/pages/PowerRankings.jsx
- frontend/public/python/efficiency.py
- frontend/public/python/game_sim.py

JSON included
- deflation fc PATCH31.json

JSON tuning notes
- Preserved each player’s displayed OVR and POT.
- Preserved offRating and defRating.
- Tuned stat-driving attrs only: 3PT, FT, Passing, Rebounding, Blocks, Steals, plus tiny scoringRating nudges for a few obvious cases.
- Used the player’s latest healthy/relevant history row when available; very small latest samples fall back to the most recent healthier season.
- Fixed obvious profile mismatches like elite PG passing hierarchy and non-shooting big 3PT profiles.

Cache bumps
- GAMEPLAN_VERSION 19 -> 20
- Power Rankings auto-rating cache v6 -> v7

After applying
1. Restart npm run dev.
2. Import/load deflation fc PATCH31.json.
3. Check Power Rankings sorted by Team OVR, OFF, DEF, and POT.
4. Run one injury-off season sim and compare standings/stats.
