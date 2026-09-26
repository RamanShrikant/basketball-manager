// Manual text-position controls for Contract Extensions.
// Presentation only: these values do not affect player data, ratings,
// contracts, eligibility, negotiation logic, CPU behavior, saves, or simulation.
//
// box.x / box.y move the whole name + meta block in pixels.
// box.scale scales the whole block together.
// name.x / name.y move only the player name; name.size is font size in px.
// meta.x / meta.y move only the position / age line; meta.size is font size in px.

export const CONTRACT_EXTENSIONS_TEXT_LAYOUT = {
  playerList: {
    box: {
      x: 5,
      y: 0,
      scale: 1,
    },
    name: {
      x: 0,
      y: 0,
      size: 12,
    },
    meta: {
      x: 0,
      y: 0,
      size: 10,
    },
  },

  selectedPlayer: {
    box: {
      x: 40,
      y: -10,
      scale: 1,
    },
    name: {
      x: 0,
      y: 0,
      size: 29,
    },
    meta: {
      x: 0,
      y: 0,
      size: 14,
    },
  },
};

export default CONTRACT_EXTENSIONS_TEXT_LAYOUT;
