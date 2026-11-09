Basketball Manager / League Intel — READ-ONLY CPU SOURCE CORRECTION
-------------------------------------------------------------------
Purpose: fix the previous all-empty market panels, without inventing a second
trade-value formula or changing CPU trades, save state, contracts, rotations or
simulation. Applies on top of BM-LEAGUE-INTEL-CPU-ADAPTER.zip.

INSTALL (from basketball-manager repo root in Windows PowerShell):
  Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\BM-LEAGUE-INTEL-CPU-SOURCE-FIX.zip" -DestinationPath . -Force
  cd frontend
  npm run check:intel
  npm run build
  npm run dev

WHAT CHANGED
- A dedicated, browser-only Pyodide Worker loads your UNMODIFIED:
    public/python/cpu_cpu_trade_logic.py
    public/python/trade_team_ai.py
    public/python/trade_value_model.py
- A new tiny Python adapter calls existing _phase_for, _seller_trade_targets,
  _buyer_outgoing_players, _is_shared_untouchable_core, player_trade_value
  and pick_trade_value. It does not generate or execute a trade, initialize
  the bank, advance games, or write to storage.
- Likely Available: saved CPU bank -> mutually accepted scan -> original CPU
  candidate board. BOARD is preliminary, NOT an accepted offer.
- Targets: saved CPU bank -> mutually accepted scan -> WATCHLIST based on other
  teams' current CPU outgoing boards plus the SELECTED CPU team's original
  receiving-side valuation. WATCH is NOT a verified wishlist or accepted deal.
- Team Needs: evaluator-accepted user assets first -> actual controlled
  franchise's players/picks valued by original CPU Python model -> existing
  generic preference labels. Valuation is not trade feasibility confirmation.
- Protected Core: the original CPU-to-CPU outgoing hard-protection helper
  marked CORE first, then visible roster leaders. Hard core guard does not
  represent an absolute veto in all user-to-CPU negotiation lanes.
- Existing rumor strip, lineup, expiring deals, assets and constraints preserved.
- New diagnostics distinguish scouted vs controlled team and show CPU worker
  readiness and recorded CPU-to-CPU trade counts.

EVIDENCE TAGS
  BANK  = stored CPU candidate accepted when initially generated
  SCAN  = hypothetical mutually accepted package from existing market scanner
  BOARD = original Python candidate-selection board (not an approved trade)
  WATCH = existing CPU market board + original receiving-side value (unverified)
  CORE  = original Python CPU-to-CPU hard core protection guard
  INFO  = roster leadership / factual information
  Team Needs: check each row's evidence popup for "cpu_valuation_only" versus
  "user_cpu_accepted_framework". A valuation alone is NOT acceptance.

EXPECTED FIRST LAUNCH
The additional isolated Python observer must load Pyodide and its modules.
Allow time for the worker (could take several seconds or more on a cold load);
the main page stays usable. It uses the same jsDelivr Pyodide CDN used by the
existing game workers. If CDN is offline or initialization fails, the original
bank + bounded market scan continue to work and the worker error is exposed.

DEVTOOLS CONSOLE (while viewing League Intel):
  BMIntel.summary()
  BMIntel.market()
  BMIntel.validate()

Look for:
  BMIntel.summary().controlledTeam === "Charlotte Hornets"
  BMIntel.market().cpuRuntime.loaded === true
  BMIntel.market().cpuSource // counts of real CPU candidate/valuation rows
  BMIntel.validate().ok === true

IMPORTANT LIMITATIONS
- No saved CPU bank entries or rumors are invented. Completed trades do not
  necessarily leave a current CPU bank candidate behind.
- CPU candidate-board, watchlist and asset valuation rows are preliminary
  and do NOT prove that any concrete trade package is acceptable.
- The existing market scanner is still conservative and limited in Instant
  mode; "0 mutual accepts" can coexist with nonempty BOARD/WATCH data.
- Team Needs user-facing hypothetical package search still inherits the
  older scanner's initial CPU-vs-CPU bilateral gate; full user-to-CPU offer
  generation should be improved separately if needed. Valuation fallback
  addresses empty presentation without pretending an offer passed.
- The new Python worker is an additional Pyodide runtime. Browser RAM usage
  may increase while the League Intel page is open.
- Real-time Pyodide startup, Vite build, and live league appearance must be
  verified in the user's complete frontend environment.

MODIFIED FILES
  frontend/src/pages/Intel_v1.jsx
  frontend/src/utils/teamIntelCpuOverlay.js
  frontend/src/utils/teamIntelPythonProbe.js (new)
  frontend/public/python/league_intel_readonly.py (new)
  frontend/public/workers/intelCpuReadOnlyWorker.js (new)
  frontend/scripts/team-intel-cpu-python.regression.mjs (new)
  frontend/package.json (only expands check:intel script)

NO CHANGE to any gameplay/CPU trade engine, salary table, sim, Free Agency,
trade execution, bank generation, save storage, or manual layout settings.
