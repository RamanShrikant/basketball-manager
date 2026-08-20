Basketball Manager — Headshot Layout File-Only V3 Fix

This patch fixes the dead/clipped Y-tuning behavior on shared hero portrait pages.

What changed
- Keeps the manual file-based headshot layout system in VS Code.
- Removes the inner clipping pocket that caused portraits to disappear into a void when Y was increased.
- Lets page-level X/Y tuning move runtime portraits more naturally.
- Raises the white divider line above the portrait layer on shared hero pages so the line stays visually clean.

Primary files
- frontend/src/components/PlayerPortraitFrame.jsx
- frontend/src/components/RuntimePlayerPortrait.jsx
- frontend/src/components/HeadshotLayoutTransform.jsx
- frontend/src/pages/RosterView.jsx
- frontend/src/pages/CoachGameplan.jsx
- frontend/src/pages/PlayerStats.jsx
- frontend/src/pages/FreeAgents.jsx
- frontend/src/pages/AllNbaTeams.jsx
- frontend/src/pages/TradePlayerSelect.jsx

Continue editing:
- frontend/src/config/headshotLayout.js
