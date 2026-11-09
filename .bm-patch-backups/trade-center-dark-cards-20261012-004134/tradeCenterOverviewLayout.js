/** TRADE CENTER — EXPANDED CAP / EXPIRING PANEL MANUAL CONTROLS
 * CSS/display only, independent from Salary Table and trading rules.
 * x: right positive, y: down positive, scale: 1 = original size.
 * These affect visual paint only; the row dimensions / scrollbar stay fixed.
 * Each group is independent. Change maxHeight to alter the vertical scroll area.
 */
export const TRADE_CENTER_OVERVIEW_LAYOUT = {
  cap: {
    maxHeight: 272,
    headshot: { x: 0, y: 0, scale: 1 },
    name: { x: 0, y: 0, scale: 1 },
    age: { x: 0, y: 0, scale: 1 },
    salary: { x: 0, y: 0, scale: 1 },
    years: { x: 0, y: 0, scale: 1 },
    option: { x: 0, y: 0, scale: 1 },
  },
  expiring: {
    maxHeight: 272,
    headshot: { x: 0, y: 0, scale: 1 },
    name: { x: 0, y: 0, scale: 1 },
    age: { x: 0, y: 0, scale: 1 },
    ring: { x: 0, y: 0, scale: 1 },
    money: { x: 0, y: 0, scale: 1 },
    interest: { x: 0, y: 0, scale: 1 },
    option: { x: 0, y: 0, scale: 1 },
  },
};
function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function tune(layer) {
  return `translate(${numberOr(layer?.x, 0)}px, ${numberOr(layer?.y, 0)}px) scale(${Math.max(0.1, numberOr(layer?.scale, 1))})`;
}
export function tradeCenterOverviewVars(section) {
  const c = TRADE_CENTER_OVERVIEW_LAYOUT[section] || TRADE_CENTER_OVERVIEW_LAYOUT.cap;
  return {
    '--bm-tco-max-height': `${Math.max(90, numberOr(c.maxHeight, 272))}px`,
    ...Object.fromEntries(['headshot','name','age','salary','years','option','ring','money','interest']
      .map((key) => [`--bm-tco-${key}-tune`, tune(c[key])])),
  };
}
