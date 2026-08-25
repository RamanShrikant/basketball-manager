Basketball Manager — Trade Context Dashboard v14
================================================

Base expected: Trade Hub Polish v13 already installed.

Changes:
1. Trade Center rebuilt to closely follow the approved two-panel dashboard mockup.
2. Left side is now TEAM CONTEXT with only simple, factual contract alerts plus position depth.
3. Contract alerts are intentionally short:
   - "Anthony Davis is expiring after this season."
   - "Alex Sarr is extension eligible soon."
   The panel shows at most two priority alerts and avoids essay-style advice.
4. Position depth counts STANDARD-ROSTER players by PRIMARY listed position only.
   Targets are fixed at 2 for PG / SG / SF / PF / C.
   - 0/2 = red
   - 1/2 = orange
   - 2/2 or more = neutral
5. Propose Trade and Trade Finder use the approved mockup-style action cards.
6. Right side is a cleaner League Rumor Board with Live Board / History Log, Rumors / Talks / Deals counters, and a centered empty state.
7. Duplicate "Open Trade Builder" action removed from the right panel.
8. Page header now shows the selected team's live W-L record and conference standing when available.
9. Existing live rumor/deal/history functionality remains intact.

Targeted validation:
- Runtime polish regression: 45/45 PASS
- New Chapter regression: 70/70 PASS
- Portrait dressing regression: 21/21 PASS
