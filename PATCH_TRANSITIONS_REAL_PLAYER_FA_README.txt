BASKETBALL MANAGER — TRANSITIONS + REAL-PLAYER FA PORTRAIT PATCH

Scope: presentation/portrait behavior only. No simulation, trade-value, contract, roster-rule, or gameplay logic was intentionally changed.

TRANSITIONS
- Global pathname transitions now wait for two browser paint frames before beginning.
- Heavy pages such as Calendar, Stats, and Playoffs can no longer consume most of the fade while mounting.
- Removed the old mount-time keyframe progression and replaced it with a cleaner 290 ms opacity/3 px entrance transition.
- Browser Back/Forward continues to retrigger because App.jsx keys PageFade by pathname.
- Team Hub category swaps (Team/Stats/Front Office/etc.) do not change URLs, so they now get a separate 230 ms internal carousel fade.

REAL NBA PLAYER PORTRAITS
Required lifecycle is now preserved:
  Suns official -> traded to Spurs -> Spurs dressed portrait -> Free Agency -> KEEP Spurs dressed portrait.

Implementation:
- Existing freeAgencyMeta.fromTeam is used as the last valid team when a real player is a free agent.
- If the last/current team equals the player's original manifest team, the official source headshot remains in use.
- A real-player jerseyless base can render only when a valid team jersey is also being layered.
- If no valid jersey can be resolved, the official source headshot is used instead.
- A naked real-player base URL is suppressed even during fallback/loading.
- Generated rookie behavior remains unchanged.

FOCUSED REGRESSION RESULTS
- portrait-dressing-regression.mjs: 23/23 PASS
- navigation-fade-regression.mjs: 4/4 PASS
- Node syntax checks for modified utility/regression JS: PASS

BROADER BM REGRESSION
- The existing bm-regression-check.mjs reported 4 CPU-trade benchmark/schema failures in untouched CPU-trade files. These are outside this patch and were not introduced by these changes.

BUILD NOTE
- The context ZIP intentionally excluded node_modules. An attempted dependency bootstrap in the isolated environment was incomplete, so the Vite production build could not be completed here. Run npm.cmd run build in the real local repo after applying; focused regressions above passed.
