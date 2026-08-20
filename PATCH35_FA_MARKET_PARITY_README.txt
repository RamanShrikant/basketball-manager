BM Patch 35 - FA Market Parity + Events + Reg-Season Repair Gate

Purpose:
- Keep visible player ratings deflated.
- Make free-agency decision logic behave like old inflated ratings did.
- Do not create hidden player ratings or change displayed OVR/POT.
- Do not use end-of-free-agency cleanup to force good players into minimum deals.

Files changed:
- frontend/public/python/free_agency_logic.py
- frontend/src/utils/cpuRosterRepairFastPath.js
- frontend/src/pages/ViewingOffers.jsx

Key behavior:
- Adds a free-agency market-equivalent OVR helper used only by FA decision logic.
- Retunes CPU target tiers so visible 72-75 behaves like old useful rotation market players.
- Keeps visible 60-71 players in the natural depth/minimum lane so low-OVR signings still happen.
- Retunes offer aggression, serious-offer minimum guard, incumbent retention, late own-rights retention, and priority overfill around FA-market tier meaning.
- Lowers the regular-season/sim-start high-value FA repair gate from 76+ to 72+.
- Filters the Market Decisions League Events panel to current-day signings instead of repeating prior-day events.

Not changed:
- No trade logic changes.
- No stat sim changes.
- No team-rating changes.
- No emergency end-of-FA cleanup for good players.
