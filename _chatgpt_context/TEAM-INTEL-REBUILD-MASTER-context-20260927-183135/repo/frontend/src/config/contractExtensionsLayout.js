// Manual visual controls for Contract Extensions player portraits and OVR/POT rings.
// These values affect presentation only. They do not change player ratings, eligibility,
// contract logic, negotiation behavior, CPU behavior, saves, or simulation.
//
// x / y are pixel offsets.
// scale is a multiplier where 1 = the current/default size.

export const CONTRACT_EXTENSIONS_LAYOUT = {
  playerList: {
    teamLogo: {
      x: 0,
      y: 0,
      scale: 1,
      opacity: 0.25,
    },
    headshot: {
      x: -10,
      y: 22.5,
      scale: 1.7,
    },
    overallRing: {
      x: 9,
      y: 0,
      scale: 1,
      // Text inside the LEFT OVR/POT ring.
      ovrLabelSize: 6,
      ovrLabelX: 0,
      ovrLabelY: -1,
      ovrNumberSize: 17,
      ovrNumberX: 0,
      ovrNumberY: 0,
      potSize: 6,
      potX: 0,
      potY: 1,
    },
  },

  selectedPlayer: {
    teamLogo: {
      x: 40,
      y: 0,
      scale: 1,
      opacity: 0.175,
    },
    headshot: {
      x: 35,
      y: -17,
      scale: 1.25,
    },
    overallRing: {
      x: 0,
      y: 0,
      scale: 1.3,
      // Text inside the TOP selected-player OVR/POT ring.
      ovrLabelSize: 8,
      ovrLabelX: 0,
      ovrLabelY: 0,
      ovrNumberSize: 26,
      ovrNumberX: 0,
      ovrNumberY: 0,
      potSize: 8,
      potX: 0,
      potY: 0,
    },
  },
};

export default CONTRACT_EXTENSIONS_LAYOUT;
