BASKETBALL MANAGER PATCH 26C
Awards Full-Viewport Polish + Play-In Auto-Switch
Date: 2026-07-22

BASE REQUIREMENT
- Apply over a project that already includes Patch 26B.

WHAT CHANGED
1. Awards and season-honors pages now use the entire viewport when the global Team Hub footer is intentionally hidden.
2. The empty reserved footer strip no longer exposes a bright document background below Individual Awards or All-NBA pages.
3. The Awards flow keeps its existing internal Previous/Next controls and remains protected from the Team Hub deadlock.
4. Simulate Play-In now automatically switches to the playoff bracket after both conferences finish their final play-in games.
5. The Play-In toggle remains available afterward, so the user can still return to review play-in results.
6. Existing Sim One Day behavior is preserved.

FILES
- frontend/src/pages/Playoffs.jsx
- frontend/src/styles/BMResponsiveDensity.css

TARGETED VALIDATION
- Confirmed the new view switch runs only after the full Simulate Play-In branch completes both conferences.
- Confirmed it uses the same all-play-ins-complete condition already used by Sim One Day.
- Confirmed the Awards override is route-scoped to /awards and does not change global footer sizing on other pages.
- Confirmed patch reconstruction over Patch 26B produces only the two intended source-file changes.

BUILD NOTE
- Run npm run build after applying. The patch contains no dependency changes.
