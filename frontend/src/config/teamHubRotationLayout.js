// Team Hub Starting Five / Bench portrait controls.
//
// These values are intentionally visual-only. They do not change player ratings,
// rotations, roster logic, trade logic, simulation logic, or save data.
//
// Positive X moves right.
// Positive Y moves down.
export const TEAM_HUB_ROTATION_LAYOUT = {
  headshot: {
    x: 0,
    y: 0,
    width: 118,
    height: 120,
    scale: 1,
  },

  overallRing: {
    x: 0,
    y: 0,
    size: 90,
    scale: 0.54,
  },

  // Per-player visual exceptions for source images that are framed differently.
  // Values are applied on top of the global headshot controls above.
  playerOverrides: {
    "Jaylon Tyson": {
      headshot: {
        x: 0,
        y: 0,
        scale: 0.68,
      },
    },
  },

  // Watermark controls for the team logo shown inside each Draft Assets pill.
  // Positive X moves right. Positive Y moves down.
  draftAssetLogo: {
    x: 0,
    y: 0,
    size: 64,
    scale: 1,
    opacity: 0.555,
    rotation: -8,
  },
};

export default TEAM_HUB_ROTATION_LAYOUT;
