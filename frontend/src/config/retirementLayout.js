// Player Retirements row layout controls.
// Edit these values, save, and Vite hot-reloads the page.
//
// Every visible row element is independently positioned — there are NO grid columns.
// x: positive = right, negative = left
// y: positive = down, negative = up
// scale: 1 = normal size
// left/top/right: the element's base anchor inside the row
// rowHeight: exact row height in pixels
//
// Raman tuning snapshot preserved from 2026-08-21.

export const RETIREMENT_LAYOUT = {
  rowHeight: 150,

  // Responsive wrapper for the absolute-position master design below.
  // The existing headshot/name/ring/story/logo coordinates are authored against
  // this virtual row width. Smaller real rows scale the whole composition as one
  // unit instead of letting the absolute offsets collide.
  responsive: {
    designWidth: 1488,
    minScale: 0.6,
    maxScale: 1,
  },

  headshot: {
    left: 14,
    top: 4,
    width: 96,
    height: 100,
    x: 38,
    y: 5,
    scale: 1.8,
  },

  name: {
    left: 116,
    top: 28,
    fontSize: 16,
    x: 40,
    y: -9,
    scale: 1.5,
  },

  meta: {
    left: 116,
    top: 53,
    fontSize: 12,
    x: 40,
    y: 5,
    scale: 1.3,
  },

  // OVR-only ring. POT is intentionally hidden.
  ratingRing: {
    right: 24,
    top: 27,
    size: 86,
    x: -1260,
    y: 30,
    scale: 1.1,
  },

  // Player POV retirement reasoning box.
  // Fully independent from the headshot/name/ring/logo layout.
  reasonBox: {
    left: 520,
    top: 18,
    width: 300,
    height: 114,
    x: -90,
    y: -10,
    scale: 1.2,
    opacity: 1,
    padding: 11,
    titleFontSize: 10,
    bodyFontSize: 10,
    lineHeight: 1.38,
  },

  // Recorded career honors / longevity / peak-season box.
  accomplishmentsBox: {
    left: 835,
    top: 18,
    width: 250,
    height: 114,
    x: 0,
    y: -10,
    scale: 1.2,
    opacity: 1,
    padding: 11,
    titleFontSize: 10,
    bodyFontSize: 10,
    lineHeight: 1.32,
    itemGap: 4,
  },

  // Retirement team/legacy logo. Only the logo is shown — no team name/badge.
  // For a player retiring from an NBA team, that latest team is used.
  // For a player retiring from free agency, the page chooses the team that
  // owns the strongest body of career seasons in player.history.seasons.
  teamLogo: {
    right: 34,
    top: 45,
    size: 350,
    x: 20,
    y: -125,
    scale: 1,
    opacity: 0.6,
  },

  // Optional per-team nudges. These ADD to the global teamLogo controls.
  // Example:
  // "Atlanta Hawks": { x: -4, y: 2, scale: 1.08, opacity: 0.95 },
  teamLogoOverrides: {
    "Atlanta Hawks": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Boston Celtics": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Brooklyn Nets": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Charlotte Hornets": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Chicago Bulls": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Cleveland Cavaliers": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Dallas Mavericks": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Denver Nuggets": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Detroit Pistons": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Golden State Warriors": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Houston Rockets": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Indiana Pacers": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Los Angeles Clippers": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Los Angeles Lakers": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Memphis Grizzlies": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Miami Heat": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Milwaukee Bucks": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Minnesota Timberwolves": { x: 0, y: 0, scale: 1, opacity: 1 },
    "New Orleans Pelicans": { x: 0, y: 0, scale: 1, opacity: 1 },
    "New York Knicks": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Oklahoma City Thunder": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Orlando Magic": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Philadelphia 76ers": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Phoenix Suns": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Portland Trail Blazers": { x: 0, y: 140, scale: 2.2, opacity: 1 },
    "Sacramento Kings": { x: 0, y: 0, scale: 1, opacity: 1 },
    "San Antonio Spurs": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Toronto Raptors": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Utah Jazz": { x: 0, y: 0, scale: 1, opacity: 1 },
    "Washington Wizards": { x: 0, y: 0, scale: 1, opacity: 1 },
  },
};
