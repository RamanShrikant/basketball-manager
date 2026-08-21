PATCH48B_MEGA_TRADE_POWER_RANKING_PROTECTION_FIXED

Purpose:
- Keep top-14 mega-trade seller protection, but use fully healthy auto-rebuilt Team OVR like Power Rankings.
- Prevent injured/slumping contenders from selling a 90+ franchise star when they are still elite healthy.

Changed files:
- frontend/src/utils/cpuTradeBank.js
- frontend/src/utils/tradeExecution.js

Behavior:
- Mega seller healthy rank rebuilds a healthy smart rotation and calls computeTeamRatings.
- Final loose mega execution now uses the same top-14 protection.
- The old top-12 execution mismatch is removed.
- Normal CPU trades, user trades, contracts, drafts, FA, progression, and locker room are untouched.
