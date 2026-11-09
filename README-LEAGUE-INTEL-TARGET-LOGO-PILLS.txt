BM LEAGUE INTEL — TARGET LOGO PILLS

What changed:
- TARGETS panel removes inline source-team text from the metadata line.
- Each target row now renders the source team logo as a low-opacity watermark inside the pill background.
- Added a dedicated targetsRows manual-control block in leagueIntelLayout.js.
- Protected Core, Likely Available, Team Needs Players, Team Needs Picks, Expiring Deals and starters remain on their existing sections and settings.

New manual controls:
  targetsRows: {
    headshot: { x, y, scale, borderWidth },
    name: { x, y, scale },
    ring: { x, y, scale, strokeWidth },
    ringText: { x, y, scale },
    ringLabel: { x, y, scale },
    ringValue: { x, y, scale },
    ringPot: { x, y, scale },
    card: { borderWidth },
    position: { x, y, scale },
    age: { x, y, scale },
    teamLogo: { x, y, scale, opacity }
  }

CSS vars emitted for Targets:
- --bm-il-target-logo-tune
- --bm-il-target-logo-opacity

This is UI-only. No save data, CPU logic, trades, rosters, portraits, or Salary Table settings are changed.
