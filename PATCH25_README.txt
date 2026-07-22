BASKETBALL MANAGER PATCH 25
Playoff Picture + Clutch Player of the Year + Draft-Night Trade Safety + Rating Ring Cleanup
Date: 2026-07-21

FEATURES

1) PLAYER OVR / POTENTIAL RATING RINGS
- Added one reusable PlayerRatingRing component with unique SVG gradient IDs.
- Typography scales to the rendered ring size so OVR/POT text no longer collides with the outside stroke.
- Replaced duplicated rating-circle markup in Free Agency, Roster, Player Stats, Coach Gameplan, All-NBA, and Finals MVP reveal.
- Added the previously referenced basketball-pattern.svg asset.

2) PERMANENT PLAYOFF PICTURE
- Added /playoff-picture and a permanent Team Hub tile.
- Regular season: shows an "if the season ended today" Play-In and playoff bracket using the same standings/tiebreak order as Playoffs.
- Active playoffs: Team Hub tile is disabled and direct navigation returns to /playoffs.
- Offseason: displays the most recently archived completed postseason.
- Completed playoff brackets are archived compactly in leagueData.seasonHistory without duplicating full box scores.

3) CLUTCH PLAYER OF THE YEAR (CPOTY)
- A clutch game is a regular-season game decided by 5 points or fewer.
- Full-game player stats from those games are tracked because the current simulator does not store possession-by-possession final-five-minute stats.
- Final eligibility: 65 total GP, 10 clutch GP, 18 clutch MPG, and appearances in at least 50% of the relevant team's clutch games.
- Live Award Tracker eligibility starts at 3 clutch GP with the same minutes/participation rules.

Clutch Impact = PTS + 0.75*REB + 0.90*AST + 1.60*STL + 1.60*BLK - TOV
Adjusted Clutch Win% = (Clutch Wins + 5) / (Clutch Games + 10)

CPOTY Score = 100 * (
  25% record percentile
+ 10% clutch-wins percentile
+ 35% production score
+ 20% clutch-vs-non-clutch elevation score
+ 10% clutch volume/participation score
)

Production = 85% clutch impact/game percentile + 15% clutch TS% percentile
Elevation = 80% impact-per-36 lift percentile + 20% TS% lift percentile
Volume = 65% min(clutch GP / 20, 1) + 35% participation

- Added CPOTY to final Awards, Award Tracker, award mood events, player-card/career accolades, season cleanup, and League Editor reset handling.
- Added the previously omitted automatic MIP career accolade mapping.
- Existing in-progress seasons backfill clutch aggregates from IndexedDB box scores when Calendar or Award Tracker opens.
- Dev quick-season simulation creates deterministic synthetic clutch splits so CPOTY can be tested through dev shortcuts.

4) DRAFT-NIGHT TRADE SAFETY
- Picks already used in the current draft are hidden from Trade Pick Select and Trade Finder.
- The team currently on the clock may still trade the current pick; later picks and future picks remain tradeable.
- Trade Finder refreshes its live draft inventory and invalidates cached offers whenever the draft advances.
- Trade Builder automatically removes a pick that became consumed, clears stale CPU acceptance/rejection output, and shows a clear notice.
- Existing final execution validation remains in place as a last safety layer.

DEPENDENCY / PACKAGING FIX
- lz-string is now declared in frontend/package.json and frontend/package-lock.json, allowing clean frontend-only installs.

VALIDATION COMPLETED
- npm production build: PASS (Vite, 140 modules transformed)
- Python compile check: PASS (23 public Python modules)
- CPOTY deterministic 82-game aggregation/ranking test: PASS
- Duplicate game protection test: PASS
- Live draft filtering/current-pick/stale-builder test: PASS
- Patch applied to a clean copy and rebuilt: PASS

The remaining Vite warnings are pre-existing bundle-size and mixed static/dynamic import warnings; they do not fail the build.
