/**
 * HEADSHOT PAGE POSITIONING — MANUAL VS CODE CONTROL
 *
 * Edit ONLY x / y below, save this file, and Vite will update the browser live.
 * No League Editor UI, no localStorage, no JSON export/import, no Save button.
 *
 * Coordinates use the same 1040 x 760 portrait-canvas reference as the rookie
 * portrait system so large and small headshots move proportionally.
 *
 *   x: positive = right, negative = left
 *   y: positive = down,  negative = up
 *
 * Example:
 *   "roster-view": { x: 0, y: -25 },
 *
 * Each entry applies to ALL headshots routed through the centralized portrait
 * renderer on that page. "player-card" is intentionally separate because the
 * player card/modal can be opened from many pages.
 */

export const HEADSHOT_CANVAS = Object.freeze({ width: 1040, height: 760 });

export const HEADSHOT_LAYOUTS = {
  "league-editor":      { x: 0, y: 0 },
  "player-card":        { x: 0, y: 0 },
  "players":            { x: 0, y: 0 },
  "trade":              { x: 0, y: 0 },
  "simulate":           { x: 0, y: 0 },
  "awards":             { x: 0, y: 0 },
  "individual-awards":  { x: 0, y: 0 },
  "all-nba":            { x: 0, y: 0 },
  "all-rookie":         { x: 0, y: 0 },
  "all-defensive":      { x: 0, y: 0 },
  "finals-mvp":         { x: 0, y: 110 },
  "play":               { x: 0, y: 0 },
  "team-selector":      { x: 0, y: 0 },
  "team-hub":           { x: 0, y: 0 },
  "roster-view":        { x: 0, y: 30 },
  "coach-gameplan":     { x: 0, y: 57 },
  "calendar":           { x: 0, y: 0 },
  "player-stats":       { x: 0, y: 31 },
  "playoff-stats":      { x: 0, y: 0 },
  "draft-lottery":      { x: 0, y: 0 },
  "draft":              { x: 0, y: 0 },
  "upcoming-draft":     { x: 0, y: 0 },
  "rookie-signings":    { x: 0, y: 0 },
  "roster-finalization":{ x: 0, y: 0 },
  "standings":          { x: 0, y: 0 },
  "power-rankings":     { x: 0, y: 0 },
  "draft-picks":        { x: 0, y: 0 },
  "trades":             { x: 0, y: 0 },
  "propose-trade":      { x: 0, y: 0 },
  "trade-player-select":{ x: 0, y: 0 },
  "trade-pick-select":  { x: 0, y: 0 },
  "trade-finder":       { x: 0, y: 0 },
  "locker-room":        { x: 0, y: 0 },
  "contract-extensions":{ x: 0, y: 0 },
  "intel":              { x: 0, y: 0 },
  "settings":           { x: 0, y: 0 },
  "league-history":     { x: 0, y: 0 },
  "award-history":      { x: 0, y: 0 },
  "past-champions":     { x: 0, y: 0 },
  "playoffs":           { x: 0, y: 0 },
  "playoff-picture":    { x: 0, y: 0 },
  "player-progression": { x: 0, y: 0 },
  "salary-table":       { x: 0, y: 0 },
  "free-agents":        { x: 0, y: 36 },
  "award-tracker":      { x: 0, y: 0 },
  "all-stars":          { x: 0, y: 0 },
  "offseason":          { x: 0, y: 0 },
  "player-team-options":{ x: 0, y: 0 },
  "player-retirements": { x: 0, y: 0 },
  "viewing-offers":     { x: 0, y: 0 },
};

export function normalizeHeadshotPageKey(value = "") {
  return String(value || "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\//g, "-") || "league-editor";
}

export function getHeadshotLayout(pageKey = "") {
  const key = normalizeHeadshotPageKey(pageKey);
  const row = HEADSHOT_LAYOUTS[key] || { x: 0, y: 0 };
  const x = Number(row.x);
  const y = Number(row.y);
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}

export function getHeadshotTransformStyle(pageKey = "") {
  const { x, y } = getHeadshotLayout(pageKey);
  const xPct = (x / HEADSHOT_CANVAS.width) * 100;
  const yPct = (y / HEADSHOT_CANVAS.height) * 100;
  return {
    transform: `translate3d(${xPct}%, ${yPct}%, 0)`,
    transformOrigin: "center center",
  };
}
