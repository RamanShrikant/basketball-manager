/**
 * CALENDAR TEAM SNAPSHOT ROSTER — MANUAL VS CODE CONTROL
 *
 * ONLY CHANGE THESE NUMBERS.
 * Save this file and Vite updates the browser live.
 *
 * x: positive = right, negative = left
 * y: positive = down,  negative = up
 * scale: 1 = normal, 1.10 = 10% larger, 0.90 = 10% smaller
 *
 * x/y and row height automatically scale proportionally across normal
 * desktop/laptop widths. Scale stays relative to each responsive base size.
 */
export const CALENDAR_TEAM_SNAPSHOT_TUNING = Object.freeze({
  rowHeight: 62,

  headshot:     { x: 0, y: -2, scale: 1.25 },
  overall:      { x: 0, y: 0, scale: 0.7 },
  outerRing:    { x: 0, y: 0, scale: 1.25 },
  name:         { x: 7, y: 0, scale: 1 },
  ageText:      { x: 7, y: 0, scale: 1 },
  positionText: { x: 7, y: 0, scale: 1 },
});

// Responsive plumbing — leave this alone.
export function getCalendarTeamSnapshotResponsiveScale(viewportWidth) {
  const width = Number(viewportWidth);
  if (!Number.isFinite(width) || width <= 0) return 1;
  return Math.max(0.78, Math.min(1, width / 1600));
}
