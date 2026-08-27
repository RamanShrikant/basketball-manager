/**
 * HEADSHOT PAGE POSITIONING — MANUAL VS CODE CONTROL
 *
 * Edit x / y / scale below, save this file, and Vite will update the browser live.
 * No League Editor UI, no localStorage, no JSON export/import, no Save button.
 *
 * Coordinates use the same 1040 x 760 portrait-canvas reference as the rookie
 * portrait system so large and small headshots move proportionally.
 *
 *   x: positive = right, negative = left
 *   y: positive = down,  negative = up
 *   scale: 1 = default size, 1.15 = 15% larger, 0.90 = 10% smaller
 *
 * Example:
 *   "roster-view": { x: 0, y: -25, scale: 1 },
 *
 * Each entry applies to ALL headshots routed through the centralized portrait
 * renderer on that page. "player-card" is intentionally separate because the
 * player card/modal can be opened from many pages.
 */

export const HEADSHOT_CANVAS = Object.freeze({ width: 1040, height: 760 });

export const HEADSHOT_LAYOUTS = {
  "league-editor":      { x: 0, y: 0, scale: 1 },
  "player-card":        { x: 0, y: 0, scale: 1 },
  "players":            { x: 0, y: 0, scale: 1 },
  "trade":              { x: 0, y: 0, scale: 1 },
  "simulate":           { x: 0, y: 0, scale: 1 },
  "awards":             { x: 0, y: 0, scale: 1 },
  "individual-awards":  { x: 0, y: 0, scale: 1 },
  "all-nba":            { x: 0, y: 0, scale: 1 },
  "all-rookie":         { x: 0, y: 0, scale: 1 },
  "all-defensive":      { x: 0, y: 0, scale: 1 },
  "finals-mvp":         { x: 0, y: 110, scale: 1 },
  "play":               { x: 0, y: 0, scale: 1 },
  "team-selector":      { x: 0, y: 0, scale: 1 },
  "team-hub":           { x: 0, y: 0, scale: 1 },
  "roster-view":        { x: 0, y: 30, scale: 1 },
  "coach-gameplan":     { x: 0, y: 57, scale: 1 },
  "calendar":           { x: 0, y: 0, scale: 1 },
  "player-stats":       { x: 0, y: 31, scale: 1 },
  "playoff-stats":      { x: 0, y: 0, scale: 1 },
  "draft-lottery":      { x: 0, y: 0, scale: 1 },
  "draft":              { x: 0, y: 0, scale: 1 },
  "upcoming-draft":     { x: 0, y: 0, scale: 1 },
  "rookie-signings":    { x: 0, y: 0, scale: 1 },
  "roster-finalization":{ x: 0, y: 0, scale: 1 },
  "standings":          { x: 0, y: 0, scale: 1 },
  "power-rankings":     { x: 0, y: 0, scale: 1 },
  "draft-picks":        { x: 0, y: 0, scale: 1 },
  "trades":             { x: 0, y: 0, scale: 1 },
  "propose-trade":      { x: 0, y: 0, scale: 1 },
  "trade-player-select":{ x: 0, y: 0, scale: 1 },
  "trade-pick-select":  { x: 0, y: 0, scale: 1 },
  "trade-finder":       { x: 0, y: 0, scale: 1 },
  "locker-room":        { x: 0, y: 0, scale: 1 },
  "locker-room-list":   { x: 170, y: 0, scale: 1 },
  "locker-room-selected": { x: 0, y: -9, scale: 1 },
  "contract-extensions":{ x: 0, y: 50, scale: 1 },
  "intel":              { x: 0, y: 0, scale: 1 },
  "settings":           { x: 0, y: 0, scale: 1 },
  "league-history":     { x: 0, y: 0, scale: 1 },
  "award-history":      { x: 0, y: 0, scale: 1 },
  "past-champions":     { x: 0, y: 0, scale: 1 },
  "playoffs":           { x: 0, y: 0, scale: 1 },
  "playoff-picture":    { x: 0, y: 0, scale: 1 },
  "player-progression": { x: 0, y: 0, scale: 1 },
  "salary-table":       { x: 0, y: 200, scale: 1.6 },
  "free-agents":        { x: 0, y: 36, scale: 1 },
  "award-tracker":      { x: 0, y: 0, scale: 1 },
  "all-stars":          { x: 0, y: 0, scale: 1 },
  "offseason":          { x: 0, y: 0, scale: 1 },
  "player-team-options":{ x: 0, y: 0, scale: 1 },
  "player-retirements": { x: 0, y: 0, scale: 1 },
  "viewing-offers":     { x: 0, y: 0, scale: 1 },
};

export function normalizeHeadshotPageKey(value = "") {
  return String(value || "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\//g, "-") || "league-editor";
}

export const SALARY_TABLE_VISUAL_TUNING = Object.freeze({
  // MASTER Salary Table controls. Tune these once in VS Code.
  // Pixel offsets and row height are automatically scaled from this reference
  // width so the same values stay proportional on smaller/larger screens.
  referenceWidth: 1600,
  minResponsiveScale: 0.78,
  maxResponsiveScale: 1,

  row: {
    // Player-row height at the reference width.
    height: 60,
  },

  name: {
    // x: positive = right, negative = left
    // y: positive = down,  negative = up
    // scale: 1 = default, 1.10 = 10% larger, 0.90 = 10% smaller
    x: 0,
    y: 0,
    scale: 1,
  },

  overall: {
    // Controls the complete OVR/POT ring as one visual.
    x: 0,
    y: 0,
    scale: 1,
  },
});

export const CONTRACT_EXTENSION_VISUAL_TUNING = Object.freeze({
  // These are MASTER values for a 1600px-wide page. The page automatically
  // scales every pixel-based value together on smaller screens, so you only
  // maintain one set of numbers instead of separate desktop/laptop profiles.
  referenceWidth: 1600,
  minResponsiveScale: 0.78,
  maxResponsiveScale: 1,
  row: {
    minHeight: 84,
    paddingX: 12,
    paddingY: 10,
    gap: 9,
  },
  headshot: {
    width: 58,
    height: 62,
  },
  overall: {
    size: 52,
    x: 0,
    y: 0,
    scale: 1,
    strokeWidth: 7,
  },
  statusBar: {
    x: 0,
    y: 0,
    scale: 1,
  },
  text: {
    nameSize: 14,
    reasonSize: 11,
  },
});

export function getHeadshotLayout(pageKey = "") {
  const key = normalizeHeadshotPageKey(pageKey);
  const row = HEADSHOT_LAYOUTS[key] || { x: 0, y: 0, scale: 1 };
  const x = Number(row.x);
  const y = Number(row.y);
  const scale = Number(row.scale);
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
  };
}

export function getHeadshotTransformStyle(pageKey = "") {
  const { x, y, scale } = getHeadshotLayout(pageKey);
  const xPct = (x / HEADSHOT_CANVAS.width) * 100;
  const yPct = (y / HEADSHOT_CANVAS.height) * 100;
  return {
    transform: `translate3d(${xPct}%, ${yPct}%, 0) scale(${scale})`,
    transformOrigin: "center bottom",
  };
}

export function getResponsiveVisualScale(viewportWidth, tuning = CONTRACT_EXTENSION_VISUAL_TUNING) {
  const width = Number(viewportWidth);
  const reference = Math.max(1, Number(tuning?.referenceWidth || 1600));
  const min = Number.isFinite(Number(tuning?.minResponsiveScale)) ? Number(tuning.minResponsiveScale) : 0.78;
  const max = Number.isFinite(Number(tuning?.maxResponsiveScale)) ? Number(tuning.maxResponsiveScale) : 1;
  if (!Number.isFinite(width) || width <= 0) return max;
  return Math.max(min, Math.min(max, width / reference));
}
