// G3A-1: read-only frontend availability hint. The trusted CPU backend and
// Supabase RPC remain the sole authorities for trade eligibility and execution.
export function isSupportedOnlineCpuTradeYear(year) {
  return Number.isInteger(year) && year >= 2026 && year <= 2028;
}
