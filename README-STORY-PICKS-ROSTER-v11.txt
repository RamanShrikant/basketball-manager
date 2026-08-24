Basketball Manager — Story Picks + Roster Polish v11
====================================================

Base expected: New Chapter Story v9 + Runtime Polish v10 already installed.

Changes:
1. Trade Finder no longer exposes the internal "CPU-Lean Offer" label. New and stale/non-comfort offers render as "Accepted Offer"; "Comfort Offer" remains for close-value packages.
2. New Chapter Y1 and Y2+ now analyzes first-round assets owned from other teams, including year, original team, protections, prior team record/finish when available, current roster strength/age when needed, long-range volatility, and how that pick portfolio fits the user's franchise direction.
3. Y2+ stores compact outside-pick intelligence in the frozen New Chapter dossier and adds an "Outside first-round assets" Outlook section.
4. Y1 keeps the handcrafted TEAM BRIEFING copy unchanged and layers outside-pick analysis into Prospects & Picks and Season Outlook.
5. Roster View gets a compact Position toggle in the roster-status strip. It groups PG -> SG -> SF -> PF -> C and sorts by OVR descending inside each position. Clicking again returns to OVR descending.
6. Season briefing content version bumped to 10 so already-frozen old briefings regenerate with the new pick intelligence.

Targeted validation performed on the packaged files:
- Runtime polish regression: 27/27 PASS
- New Chapter regression: 70/70 PASS
- Portrait dressing regression: 21/21 PASS

A full Vite production build could not be run in the isolated patch workspace because node_modules was intentionally absent. Run npm run build in the real repo after installing.
