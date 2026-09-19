// Team Hub banner manual tuning.
//
// IMPORTANT:
// - banner.height changes ONLY the banner pill height.
// - block x/y moves the whole group, while the child controls below still work independently.
// - x/y are pixel offsets from the normal layout position.
// - size and height are pixels.
// - keep x/y at 0 to preserve the baseline layout.
// - invalid/non-numeric values safely fall back instead of breaking the page.
export const TEAM_HUB_BANNER_LAYOUT = {
  // Entire pill. Width/radius/grid stay controlled by the normal responsive CSS.
  banner: { height: 80 },

  // Whole identity block: logo + city + team name together.
  identityBlock: { x: 0, y: 0 },

  // Individual identity controls.
  logo: { x: 0, y: 0, size: 68 },
  teamCity: { x: 0, y: 0, size: 18 },
  teamName: { x: 0, y: 0, size: 31 },

  // Whole Record block. Individual text controls remain independent.
  recordBlock: { x: 0, y: 0 },
  recordLabel: { x: 0, y: 0, size: 9 },
  recordValue: { x: 0, y: 0, size: 18 },
  recordStanding: { x: 0, y: 0, size: 9 },

  // Whole Last 10 block. Individual text controls remain independent.
  last10Block: { x: 0, y: 0 },
  last10Label: { x: 0, y: 0, size: 9 },
  last10Value: { x: 0, y: 0, size: 18 },
  last10Subtext: { x: 0, y: 0, size: 9 },

  // Low-opacity background team logo. These values affect only the watermark.
  watermark: { x: 70, y: 0, scale: 1, opacity: 0.155, rotation: -5 },

  // Entire Next Game area.
  nextGameBlock: { x: 0, y: 0 },
  nextGameLabel: { x: 0, y: 0, size: 11 },
  nextGameValue: { x: 0, y: 0, size: 16 },
  nextGameLogo: { x: 0, y: 0, size: 42 },
  nextGameDate: { x: 0, y: 0, size: 10 },
  nextGameEmpty: { x: 0, y: 0, size: 10 },
};

export default TEAM_HUB_BANNER_LAYOUT;
