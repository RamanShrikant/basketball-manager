BM_PATCH32_TRADE_ECONOMY

Goal:
- Make all trade/contract economy systems understand the native deflated rating scale.
- Keep sim speed and gameplay sim logic untouched.
- Keep mega trades guaranteed/available like before, but lower the visible mega target threshold from old 90 to new 86.
- Avoid the CPU treating visible 70s as old bench filler.

Included:
1. frontend/src/utils/nativeDeflatedTradeScale.js
2. frontend/public/python/deflated_trade_scale.py
3. Trade Finder player/package value retune
4. Trade Finder comfort floor retune
5. JS trade contract market value retune
6. Python FA/extension market value retune via idempotent economic player proxy
7. CPU extension core-score retune through economic player proxy
8. CPU-to-CPU visible tier retune:
   - mega target 90 -> 86
   - major target 80 -> 76
   - star target 85 -> 82
   - team phase/top-average thresholds shifted to deflated scale
9. Trade-team-impact CPU buyer/seller thresholds shifted lower
10. Retention tax tables shifted lower when the expected constants exist

Does NOT touch:
- game_sim.py possession/player-stat speed
- minutes logic
- team rating Patch 31 formulas
- generated draft classes
- displayed player OVR/POT values

Apply from repo root with the PowerShell command given by ChatGPT.
