BM Patch 32B - CPU Market Player Floor 60

Purpose:
- Applies on top of Patch 32 trade economy.
- Lowers CPU-to-CPU candidate pool floor from the current MIN_MARKET_PLAYER_OVR value to 60.
- This lets the CPU include lower-end deflated-scale bench/depth players in trade candidate packages.

Changed file:
- frontend/public/python/cpu_cpu_trade_logic.py

Exact change:
- MIN_MARKET_PLAYER_OVR = 63
+ MIN_MARKET_PLAYER_OVR = 60

Notes:
- No Trade Finder changes.
- No Propose Trade changes.
- No contract/market-value changes.
- No game sim or stat logic changes.
- This only widens the CPU-to-CPU player candidate pool; actual trade acceptance/value checks still happen after candidate generation.

Backup:
C:\Users\Saeyo\OneDrive\Documents\vs bbgm\basketball-manager-mega-trade-clean\_bm_patch_backups\BM_PATCH32B_CPU_MARKET_FLOOR_60_20260820-130453
