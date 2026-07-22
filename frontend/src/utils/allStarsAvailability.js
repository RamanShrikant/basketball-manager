export const ALL_STARS_KEY = "bm_all_stars_v1";
export const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";

function safeJson(raw, fallback = null) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function readSavedAllStars() {
  return safeJson(localStorage.getItem(ALL_STARS_KEY), null);
}

export function readOffseasonState() {
  return safeJson(localStorage.getItem(OFFSEASON_STATE_KEY), {});
}

export function getLeagueSeasonYear(leagueData) {
  const values = [
    leagueData?.seasonYear,
    leagueData?.currentSeasonYear,
    leagueData?.seasonStartYear,
  ]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 2020 && value <= 2100);

  return values.length ? Math.max(...values) : 2025;
}

export function getAllStarSeasonStartYear(data) {
  const match = String(data?.season || "").match(/(\d{4})/);
  return match ? Number(match[1]) : null;
}

export function isAllStarsAvailable({ leagueData, offseasonState = readOffseasonState(), data = readSavedAllStars() } = {}) {
  if (!data?.east || !data?.west) return false;

  const savedStartYear = getAllStarSeasonStartYear(data);
  if (!Number.isFinite(savedStartYear)) return false;

  const currentSeasonYear = getLeagueSeasonYear(leagueData);
  const offseasonActive = Boolean(offseasonState?.active);

  if (savedStartYear === currentSeasonYear) return true;
  if (offseasonActive && savedStartYear === currentSeasonYear - 1) return true;

  return false;
}
