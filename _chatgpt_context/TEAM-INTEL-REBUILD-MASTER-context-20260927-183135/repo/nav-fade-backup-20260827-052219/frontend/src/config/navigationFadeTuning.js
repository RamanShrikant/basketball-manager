/**
 * GLOBAL PAGE NAVIGATION FADE — MANUAL VS CODE CONTROL
 *
 * ONLY CHANGE THESE FOUR NUMBERS.
 * Save the file and Vite updates the browser live.
 *
 * durationMs:
 *   higher = slower / more noticeable
 *   lower  = faster / snappier
 *
 * startOpacity:
 *   1.00 = almost no fade
 *   0.80 = subtle fade
 *   0.60 = stronger fade
 *
 * moveY:
 *   0 = no movement
 *   positive = page settles upward from slightly lower down
 *
 * startScale:
 *   1 = no scale
 *   0.995 = extremely subtle settle-in
 */
export const NAVIGATION_FADE_TUNING = Object.freeze({
  durationMs: 205,
  startOpacity: 0.82,
  moveY: 1,
  startScale: 1,
});
