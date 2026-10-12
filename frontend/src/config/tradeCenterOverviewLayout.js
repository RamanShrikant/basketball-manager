/** TRADE CENTER — EXPANDED CAP / EXPIRING PANEL MANUAL CONTROLS
 * CSS/display only, independent from Salary Table and trading rules.
 * x: right positive, y: down positive, scale: 1 = original size.
 * These affect visual paint only; the row dimensions / scrollbar stay fixed.
 * Each group is independent. Change maxHeight to alter the vertical scroll area.
 */
export const TRADE_CENTER_OVERVIEW_LAYOUT = {
  cap: {
    maxHeight: 272,
    card: { borderWidth: 1, radius: 12 },
    logo: { x: 0, y: 0, scale: 1.7, opacity: 0.09 },
    ring: { x: -95, y: 0, scale: 1.1 },
    headshot: { x: 7, y: -0.5, scale: 1.15 },
    name: { x: 45, y: 0, scale: 1.1 },
    age: { x: 45, y: 0, scale: 1.1 },
    salary: { x: 45, y: 0, scale: 1.1 },
    years: { x: 45, y: 0, scale: 1.1 },
    option: { x: 45, y: 0, scale: 1.1 },
  },
  expiring: {
    maxHeight: 272,
    card: { borderWidth: 1, radius: 12 },
    logo: { x: 0, y: 0, scale: 1.7, opacity: 0.09 },
    headshot: { x: 7, y: -0.5, scale: 1.15 },
    name: { x: 45, y: 0, scale: 1.1 },
    age: { x: 45, y: 0, scale: 1.1 },
    ring: { x: -95, y: 0, scale: 1.1 },
    money: { x: 45, y: 0, scale: 1.1 },
    interest: { x: 45, y: 0, scale: 1.1 },
    option: { x: 45, y: 0, scale: 1.1 },
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
    '--bm-tco-logo-tune': tune(c.logo),
    '--bm-tco-logo-opacity': Math.max(0, Math.min(1, numberOr(c.logo?.opacity, .09))),
    '--bm-tco-card-border-width': `${Math.max(0, numberOr(c.card?.borderWidth, 1))}px`,
    '--bm-tco-card-radius': `${Math.max(0, numberOr(c.card?.radius, 12))}px`,
    ...Object.fromEntries(['headshot','name','age','salary','years','option','ring','money','interest']
      .map((key) => [`--bm-tco-${key}-tune`, tune(c[key])])),
  };
}
