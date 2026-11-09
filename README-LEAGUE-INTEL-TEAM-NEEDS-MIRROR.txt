BASKETBALL MANAGER — LEAGUE INTEL TEAM NEEDS PLAYER ROW MIRROR

WHAT CHANGED
- Team Needs: Players reuses the exact MiniPlayer component used by Protected Core / Likely Available / Targets.
- 2 player items, same shared portrait + orange OVR/POT ring, name, position, age, and ? evidence button.
- Dedicated teamNeedsPlayers manual controls are initialized to EXACT scoutingRows values from your pasted configuration.
- All existing starters, scoutingRows, and original teamNeeds manual settings are preserved.
- Team Needs: Picks keeps its previous pill and origin-logo behavior; no draft or CPU-valuation changes.
- Team Needs metadata uses a comfortable line height to avoid slicing lowercase descenders like g in Age.
- No gameplay, roster, save, Salary Table or shared portrait component changes.

MANUAL CONTROLS
frontend/src/config/leagueIntelLayout.js

New: LEAGUE_INTEL_LAYOUT.teamNeedsPlayers, set as:
  headshot: { x: 20, y: 10, scale: 1.7, borderWidth: 0 }
  name: { x: 40, y: 0, scale: 1 }
  ring: { x: 25, y: -5, scale: 1.1, strokeWidth: 7 }
  ringText: { x: 0, y: 0, scale: 0.8 }
  position: { x: 40, y: 0, scale: 1 }
  age: { x: 40, y: 0, scale: 1 }

Original teamNeeds settings are PRESERVED for the draft-pick logo/label layout:
  headshot { x: 0, y: 0, scale: 1.7, borderWidth: 0 }
  name     { x: 30, y: 0, scale: 1 }
  ring     { x: 30, y: 0, scale: 1, strokeWidth: 7 }
  position { x: 30, y: 0, scale: 1 }
  age      { x: 30, y: 0, scale: 1 }
  pickLogo { x: 0, y: 0, scale: 1, opacity: 0.36 }

INSTALL
1. Back up frontend/src/config/leagueIntelLayout.js in your working repo.
2. Extract ZIP at project ROOT with -Force.
3. In frontend run npm run check:intel, node scripts/team-intel-teamneeds-mirror.regression.mjs, npm run build.
4. Open Team Intel, inspect Team Needs: Players on desktop and laptop resolutions.

TESTED in isolated source workspace:
- Six standard Intel regression suites pass.
- Existing visual, rating, ring-text, split-needs tests pass.
- Dedicated player-row mirror, independent-controls, draft-pick preservation tests pass.
- JSX parse (TypeScript compiler) and CSS parse (PostCSS) pass.
- Full app Vite production build must be checked locally.
