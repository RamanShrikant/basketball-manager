/**
 * TRADE CONTEXT POPUP — MANUAL VS CODE CONTROL
 *
 * ONLY CHANGE THESE NUMBERS.
 * Save the file and Vite updates the browser live.
 *
 * x: positive = right, negative = left
 * y: positive = down,  negative = up
 * scale: 1 = normal, 1.10 = 10% larger, 0.90 = 10% smaller
 *
 * x/y automatically scale with the viewport so your tuning stays
 * proportional across normal desktop/laptop resolutions.
 */
export const TRADE_CONTEXT_POPUP_TUNING = Object.freeze({
  headshot:  { x: 20, y: 9, scale: 1.55 },
  overall:   { x: 20, y: 0, scale: 1 },
  outerRing: { x: 0, y: 0, scale: 1 },
  name:      { x: 15, y: -15, scale: 1 },
  ageText:   { x: 15, y: -15, scale: 1 },
});
