/**
 * TRADES > SEARCH RESULTS — INDEPENDENT VISUAL TUNING (READ-ONLY)
 *
 * No search matching, transactions, player data or contract calculations
 * are affected by these values. This file does NOT affect Player Card,
 * League Intel, Roster View or the finalized Salary Table.
 *
 * x: positive right / negative left (CSS px, visual positioning only)
 * y: positive down  / negative up   (CSS px, visual positioning only)
 * scale: 1 is the current size, 1.10 is 10% larger, 0.9 is 10% smaller.
 * opacity: 0..1, for the team-logo watermark ONLY.
 *
 * Each field acts on its own text/portrait/image layer without altering the
 * size of its 56px result pill or moving other layers in the layout.
 * The orange OVR/POT ring is intentionally FIXED and has NO controls here.
 *
 * Headshot y=6 PRESERVES the already-installed 6px down adjustment.
 */
export const TRADE_SEARCH_LAYOUT = {
  headshot: { x: 0, y: 7, scale: 1 },
  name: { x: 0, y: 0, scale: 1 },
  position: { x: 0, y: 0, scale: 1 },
  age: { x: 0, y: 0, scale: 1 },
  contractYears: { x: 0, y: 0, scale: 1 },
  contractValue: { x: 0, y: 0, scale: 1 },
  averageSalary: { x: 0, y: 0, scale: 1 },
  teamLogo: { x: 80, y: 0, scale: 0.6, opacity: 0.10 },
};

const numberOr = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const visualTransform = (settings) => {
  const { x = 0, y = 0, scale = 1 } = settings || {};
  // Individual CSS transforms do not participate in normal flex layout.
  const safeScale = Math.max(0.1, numberOr(scale, 1));
  return `translate(${numberOr(x, 0)}px, ${numberOr(y, 0)}px) scale(${safeScale})`;
};

/** React inline style CSS variables: all visual-only, no DOM mutation. */
export function tradeSearchTuningVars() {
  const settings = TRADE_SEARCH_LAYOUT;
  return {
    "--bm-trade-search-headshot-tune": visualTransform(settings.headshot),
    "--bm-trade-search-name-tune": visualTransform(settings.name),
    "--bm-trade-search-position-tune": visualTransform(settings.position),
    "--bm-trade-search-age-tune": visualTransform(settings.age),
    "--bm-trade-search-contract-years-tune": visualTransform(settings.contractYears),
    "--bm-trade-search-contract-value-tune": visualTransform(settings.contractValue),
    "--bm-trade-search-average-tune": visualTransform(settings.averageSalary),
    "--bm-trade-search-logo-tune": visualTransform(settings.teamLogo),
    "--bm-trade-search-logo-opacity": Math.min(1, Math.max(0, numberOr(settings.teamLogo?.opacity, 0.10))),
  };
}
