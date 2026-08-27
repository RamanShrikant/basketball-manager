/**
 * GLOBAL PAGE NAVIGATION FADE — SIMPLE MANUAL CONTROL
 *
 * These are presentation-only values. They do not delay navigation and they
 * never touch game state. The route changes immediately; the newly mounted
 * page then settles in over the black app background.
 *
 * durationMs:
 *   How long the visible transition lasts.
 *
 * startOpacity:
 *   How visible the new page is on its first frame.
 *   Lower = stronger / easier to notice.
 *
 * moveY:
 *   Optional vertical motion. Kept at 0 for a clean pure fade.
 *
 * startScale:
 *   Tiny proportional size settle. 1 = none.
 */
export const NAVIGATION_FADE_TUNING = Object.freeze({
  durationMs: 310,
  startOpacity: 0.34,
  moveY: 0,
  startScale: 0.997,
});
