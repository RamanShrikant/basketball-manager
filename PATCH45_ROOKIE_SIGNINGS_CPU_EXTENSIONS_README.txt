Patch 45 — Rookie Signing + CPU Extension Frequency Tuning

Scope:
- frontend/public/python/team_roster_logic.py
- frontend/public/python/cpu_contract_extensions.py
- frontend/public/python/contract_extension_logic.py

What changed:
- Rookie signing recommendations now match the deflated draft-class scale.
- First-round picks normally receive standard rookie-scale contracts.
- Useful second-round rookies in the 60-66 OVR range are treated as legitimate standard/two-way/stash decisions instead of old-scale fringe trash.
- CPU rookie signing randomness no longer downgrades deflated-scale useful first-round/early-second prospects too aggressively.
- CPU two-way upgrade/release thresholds are lowered for deflated ratings.
- CPU extension approval is less star-only:
  - rookie-scale gates loosened for useful 70+ young cores / good POT players
  - veteran gates loosened for useful younger 72-76 rotation/core players
  - old low-impact veterans remain selective
- CPU extension deadline diagnostics now persist every deadline run, not only zero-extension runs.

What did NOT change:
- user extension eligibility
- legal extension windows / deadlines
- player willingness / Locker Room interest math
- extension ask-package generation
- rookie contract salary structures
- free agency
- progression
- trade logic
- sim engine

Expected gameplay feel:
- First round: mostly standard contracts.
- Early second: standard/two-way depending quality.
- Late second: two-way/stash/release depending readiness/upside.
- CPU extensions: more useful young/core players retained, without extending every bench veteran.
