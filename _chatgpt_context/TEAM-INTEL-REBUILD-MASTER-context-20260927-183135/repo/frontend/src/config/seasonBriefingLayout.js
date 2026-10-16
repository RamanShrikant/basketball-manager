// Percentage-based controls for the 1672 x 941 Season Briefing artwork.
// Change only these numerals if a Photoshop export needs a small alignment fix.

export const DEFAULT_SEASON_BRIEFING_LAYOUT = {
  content: { x: 5.4, y: 20.5, width: 33.8, height: 43.2 },
  teamButton: { x: 4.8, y: 66.4, width: 7.4, height: 15.4 },
  leagueButton: { x: 13.3, y: 66.4, width: 7.4, height: 15.4 },
  prospectsButton: { x: 21.8, y: 66.4, width: 7.4, height: 15.4 },
  outlookButton: { x: 30.3, y: 66.4, width: 7.4, height: 15.4 },
  enterSeasonButton: { x: 5.3, y: 84.0, width: 32.2, height: 10.8 },
  closeButton: { x: 93.0, y: 2.0, width: 5.8, height: 9.5 },
};

// Optional per-team overrides. Keys use the lowercase wallpaper filename slug.
export const SEASON_BRIEFING_LAYOUT_OVERRIDES = {};

function mergeBox(base, override) {
  return { ...(base || {}), ...(override || {}) };
}

export function getSeasonBriefingLayout(teamSlug = "") {
  const override = SEASON_BRIEFING_LAYOUT_OVERRIDES[teamSlug] || {};
  return {
    content: mergeBox(DEFAULT_SEASON_BRIEFING_LAYOUT.content, override.content),
    teamButton: mergeBox(DEFAULT_SEASON_BRIEFING_LAYOUT.teamButton, override.teamButton),
    leagueButton: mergeBox(DEFAULT_SEASON_BRIEFING_LAYOUT.leagueButton, override.leagueButton),
    prospectsButton: mergeBox(DEFAULT_SEASON_BRIEFING_LAYOUT.prospectsButton, override.prospectsButton),
    outlookButton: mergeBox(DEFAULT_SEASON_BRIEFING_LAYOUT.outlookButton, override.outlookButton),
    enterSeasonButton: mergeBox(DEFAULT_SEASON_BRIEFING_LAYOUT.enterSeasonButton, override.enterSeasonButton),
    closeButton: mergeBox(DEFAULT_SEASON_BRIEFING_LAYOUT.closeButton, override.closeButton),
  };
}
