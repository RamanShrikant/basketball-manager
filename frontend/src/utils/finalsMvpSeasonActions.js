// src/utils/finalsMvpSeasonActions.js
import { archiveCurrentSeasonIntoPlayerCards } from "./playerCareerHistory";
import { saveLeagueDataInBackground } from "./leagueStorage.js";

const META_KEY = "bm_league_meta_v1";
const SCHED_KEY = "bm_schedule_v3";
const RESULT_V2_BLOB_KEY = "bm_results_v2";
const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_";
const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
const RETIREMENT_RESULTS_KEY = "bm_retirement_results_v1";
const PLAYER_STATS_KEY = "bm_player_stats_v1";

function safeClone(value) {
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch {}

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function bumpSeasonYearMeta() {
  const today = new Date();
  const fallback = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;

  let meta = {};
  try {
    meta = JSON.parse(localStorage.getItem(META_KEY) || "{}") || {};
  } catch {
    meta = {};
  }

  const cur = Number.isFinite(Number(meta.seasonYear)) ? Number(meta.seasonYear) : fallback;
  meta.seasonYear = cur + 1;
  meta.currentSeasonYear = meta.seasonYear;
  meta.seasonStartYear = meta.seasonYear;

  localStorage.setItem(META_KEY, JSON.stringify(meta));
  return meta.seasonYear;
}

export function getCompletedSeasonYearForArchive(leagueData, fmvpRaw) {
  try {
    const meta = JSON.parse(localStorage.getItem(META_KEY) || "{}") || {};
    const metaStartYear = Number(meta?.seasonYear);

    if (Number.isFinite(metaStartYear) && metaStartYear > 1900) {
      return metaStartYear + 1;
    }
  } catch {}

  const leagueYear = Number(
    leagueData?.seasonYear ||
      leagueData?.currentSeasonYear ||
      0
  );

  if (Number.isFinite(leagueYear) && leagueYear > 1900) {
    return leagueYear + 1;
  }

  const fmvpSeason = Number(fmvpRaw?.season);
  if (Number.isFinite(fmvpSeason) && fmvpSeason > 1900) {
    return fmvpSeason;
  }

  return 2026;
}

function clearSeasonStores() {
  // playoffs + schedule/results
  localStorage.removeItem("bm_postseason_v2");
  localStorage.removeItem("bm_champ_v1");
  localStorage.removeItem(SCHED_KEY);

  // results v2 blob + v3 per-game
  localStorage.removeItem(RESULT_V2_BLOB_KEY);
  localStorage.removeItem(RESULT_V3_INDEX_KEY);

  // delete all per-game result keys
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.startsWith(RESULT_V3_PREFIX)) localStorage.removeItem(k);
  }

  // wipe season stats so the next season starts from 0
  localStorage.removeItem(PLAYER_STATS_KEY);
}

function pushFinalsMvpToHistory(fmvpRaw) {
  if (!fmvpRaw) return;

  // keep "latest" around
  localStorage.setItem("bm_finals_mvp_latest", JSON.stringify(fmvpRaw));

  // append to history
  const key = "bm_finals_mvp_history_v1";
  let hist = [];
  try {
    hist = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(hist)) hist = [];
  } catch {
    hist = [];
  }

  hist.push(fmvpRaw);
  localStorage.setItem(key, JSON.stringify(hist));
}

function buildFreshOffseasonState(seasonYear) {
  return {
    active: true,
    seasonYear,
    retirementsComplete: false,
    freeAgencyComplete: false,
    progressionComplete: false,
  };
}

export function finalizeFinalsMvpAndGoOffseason({
  leagueData,
  fmvpRaw,
  selectedTeam,
  setLeagueData,
  setSelectedTeam,
  navigate,
}) {
  // 1) resolve the completed season display year from the current calendar season
  const completedSeasonYear = getCompletedSeasonYearForArchive(leagueData, fmvpRaw);
  const correctedFmvpRaw = fmvpRaw
    ? { ...fmvpRaw, season: completedSeasonYear }
    : fmvpRaw;

  // 2) preserve Finals MVP always (history + latest) with the corrected year
  pushFinalsMvpToHistory(correctedFmvpRaw);

  // 3) archive completed live season stats/accolades into player cards BEFORE clearing current-season stats
  const archivedLeagueData = archiveCurrentSeasonIntoPlayerCards(
    leagueData,
    completedSeasonYear
  );

  // 4) bump season year so offseason pages can read the next cycle
  const nextSeasonYear = bumpSeasonYearMeta();

  // 5) clear season runtime keys so Calendar generates a fresh schedule/results later
  clearSeasonStores();

  // 6) reset offseason state/results for the new offseason
  localStorage.setItem(
    OFFSEASON_STATE_KEY,
    JSON.stringify(buildFreshOffseasonState(nextSeasonYear))
  );
  localStorage.removeItem(RETIREMENT_RESULTS_KEY);

  // 7) update leagueData season year in memory + IndexedDB. localStorage only keeps a tiny pointer.
  if (archivedLeagueData) {
    const updatedLeague = safeClone(archivedLeagueData);
    updatedLeague.seasonYear = nextSeasonYear;
    updatedLeague.currentSeasonYear = nextSeasonYear;
    updatedLeague.seasonStartYear = nextSeasonYear;

    if (typeof setLeagueData === "function") {
      setLeagueData(updatedLeague);
    }

    saveLeagueDataInBackground(updatedLeague);

    if (selectedTeam?.name && typeof setSelectedTeam === "function") {
      let updatedSelectedTeam = null;

      for (const confKey of Object.keys(updatedLeague.conferences || {})) {
        const found = (updatedLeague.conferences[confKey] || []).find(
          (t) => t.name === selectedTeam.name
        );

        if (found) {
          updatedSelectedTeam = found;
          break;
        }
      }

      if (updatedSelectedTeam) {
        setSelectedTeam(updatedSelectedTeam.name);
        localStorage.setItem("selectedTeam", JSON.stringify(updatedSelectedTeam.name));
      }
    }
  }

  // 8) do NOT delete finals mvp history/latest; we only clear the one-time page payload
  localStorage.removeItem("bm_finals_mvp_v1");

  // 9) go to offseason hub
  navigate("/offseason");
}
