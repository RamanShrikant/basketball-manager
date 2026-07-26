// src/utils/tradeWindow.js
// Shared trade-window helpers. This keeps page buttons and backend trade saves
// aligned without changing trade value or acceptance logic.

const TRADE_DEADLINE_STATUS_KEY = "bm_trade_deadline_status_v1";

export function readTradeDeadlineStatus() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRADE_DEADLINE_STATUS_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function isTradeDeadlineLocked(status = readTradeDeadlineStatus()) {
  return Boolean(status?.locked);
}

export function isTradeWindowLocked({ tradeContext = null, deadlineStatus = readTradeDeadlineStatus() } = {}) {
  return !tradeContext?.inOffseason && isTradeDeadlineLocked(deadlineStatus);
}

export function getTradeWindowLockMessage() {
  return "Trade deadline passed. New trade offers reopen in the offseason.";
}
