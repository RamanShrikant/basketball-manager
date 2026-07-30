// src/utils/finalsMvpSeasonActions.js
import { archiveCurrentSeasonIntoPlayerCards } from "./playerCareerHistory";
import { saveLeagueDataInBackground } from "./leagueStorage.js";
import { ensureCompletedSeasonStatsArchive } from "./seasonStatsArchive.js";
import { clearBoxScoresFromDB } from "./indexedDbStorage.js";
import { withOffseasonSeasonContext } from "./seasonContext.js";

const META_KEY = "bm_league_meta_v1";
const SCHED_KEY = "bm_schedule_v3";
const RESULT_V2_BLOB_KEY = "bm_results_v2";
const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_";
const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
const RETIREMENT_RESULTS_KEY = "bm_retirement_results_v1";
const PLAYER_STATS_KEY = "bm_player_stats_v1";
const CLUTCH_STATS_KEY = "bm_clutch_stats_v1";
const DRAFT_LOTTERY_KEY = "bm_draft_lottery_v1";
const DRAFT_STATE_KEY = "bm_draft_state_v1";
const LAST_CHAMPION_KEY = "bm_last_champion_v1";
const FIRST_PLAYABLE_SEASON_YEAR = 2025;

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

function safeSeasonYear(value, fallback = null) {
  const y = Number(value);
  return Number.isFinite(y) && y >= 2020 && y <= 2100 ? Math.trunc(y) : fallback;
}

function bumpSeasonYearMeta(currentSeasonStartYear = null) {
  const fallback = FIRST_PLAYABLE_SEASON_YEAR;

  let meta = {};
  try {
    meta = JSON.parse(localStorage.getItem(META_KEY) || "{}") || {};
  } catch {
    meta = {};
  }

  const cur =
    safeSeasonYear(currentSeasonStartYear) ??
    safeSeasonYear(meta.seasonYear) ??
    fallback;

  const nextSeasonYear = cur + 1;
  meta.seasonYear = nextSeasonYear;
  meta.currentSeasonYear = nextSeasonYear;
  meta.seasonStartYear = nextSeasonYear;
  meta.displaySeasonYear = nextSeasonYear + 1;
  meta.seasonEndYear = nextSeasonYear + 1;
  meta.contractSeasonYear = nextSeasonYear;
  meta.payrollSeasonYear = nextSeasonYear;
  meta.currentPayrollSeasonYear = nextSeasonYear;
  meta.salarySeasonYear = nextSeasonYear;
  meta.currentSalarySeasonYear = nextSeasonYear;
  meta.draftYear = nextSeasonYear;
  meta.currentDraftYear = nextSeasonYear;
  meta.currentFinancialSeasonYear = nextSeasonYear + 1;
  meta.financialSeasonYear = nextSeasonYear + 1;

  localStorage.setItem(META_KEY, JSON.stringify(meta));
  return meta.seasonYear;
}

export function getCompletedSeasonYearForArchive(leagueData, fmvpRaw) {
  const leagueYear = Number(
    leagueData?.seasonYear ||
      leagueData?.currentSeasonYear ||
      leagueData?.seasonStartYear ||
      0
  );

  if (Number.isFinite(leagueYear) && leagueYear > 1900) {
    return leagueYear + 1;
  }

  try {
    const meta = JSON.parse(localStorage.getItem(META_KEY) || "{}") || {};
    const metaStartYear = Number(meta?.seasonYear);

    if (Number.isFinite(metaStartYear) && metaStartYear > 1900) {
      return metaStartYear + 1;
    }
  } catch {}

  const fmvpSeason = Number(fmvpRaw?.season);
  if (Number.isFinite(fmvpSeason) && fmvpSeason > 1900) {
    return fmvpSeason;
  }

  return FIRST_PLAYABLE_SEASON_YEAR + 1;
}

function clearSeasonStores() {
  // Delete the actual result payloads synchronously before dropping the index.
  // The previous deferred cleanup could be interrupted by a reload/navigation,
  // leaving 1,230 invisible prior-season keys that consumed localStorage until
  // the Year-2 awards save failed with QuotaExceededError.
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(RESULT_V3_PREFIX)) localStorage.removeItem(key);
  }

  localStorage.removeItem("bm_postseason_v2");
  localStorage.removeItem("bm_champ_v1");
  localStorage.removeItem(SCHED_KEY);
  localStorage.removeItem(DRAFT_LOTTERY_KEY);
  localStorage.removeItem(DRAFT_STATE_KEY);
  localStorage.removeItem(RESULT_V2_BLOB_KEY);
  localStorage.removeItem(RESULT_V3_INDEX_KEY);

  clearBoxScoresFromDB().catch((error) => {
    if (typeof window !== "undefined" && window.__debugSimLogs) {
      console.warn("[OffseasonCleanup] box-score cleanup failed", error);
    }
  });

  localStorage.removeItem(PLAYER_STATS_KEY);
  localStorage.removeItem(CLUTCH_STATS_KEY);
  localStorage.removeItem("bm_awards_latest");
  localStorage.removeItem("bm_awards_v1");
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
  const y = safeSeasonYear(seasonYear, FIRST_PLAYABLE_SEASON_YEAR + 1);
  return {
    active: true,
    seasonYear: y,
    draftYear: y,
    currentDraftYear: y,
    payrollSeasonYear: y,
    contractSeasonYear: y,
    salarySeasonYear: y,
    financialSeasonYear: y + 1,
    currentFinancialSeasonYear: y + 1,
    displaySeasonYear: y + 1,
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

  const completedChampion =
    correctedFmvpRaw?.champion_team ||
    correctedFmvpRaw?.finals_mvp?.team ||
    null;

  if (completedChampion) {
    localStorage.setItem(
      LAST_CHAMPION_KEY,
      JSON.stringify({
        team: completedChampion,
        season: completedSeasonYear,
      })
    );
  }

  // 3) freeze the completed season before any offseason roster movement or runtime cleanup.
  // This preserves regular-season/player-team assignments, playoff statistics, and final standings.
  const seasonStartYear = completedSeasonYear - 1;
  const leagueWithSeasonStatsArchive = ensureCompletedSeasonStatsArchive(
    leagueData,
    seasonStartYear
  );

  // 4) archive completed live season stats/accolades into player cards BEFORE clearing current-season stats
  const archivedLeagueData = archiveCurrentSeasonIntoPlayerCards(
    leagueWithSeasonStatsArchive,
    completedSeasonYear
  );

  // 5) bump season year so offseason pages can read the next cycle
  const currentSeasonStartYear = completedSeasonYear - 1;
  const nextSeasonYear = bumpSeasonYearMeta(currentSeasonStartYear);

  // 6) clear season runtime keys so Calendar generates a fresh schedule/results later
  clearSeasonStores();

  // 7) reset offseason state/results for the new offseason
  localStorage.setItem(
    OFFSEASON_STATE_KEY,
    JSON.stringify(buildFreshOffseasonState(nextSeasonYear))
  );
  localStorage.removeItem(RETIREMENT_RESULTS_KEY);

  // 8) update leagueData season year in memory + IndexedDB. localStorage only keeps a tiny pointer.
  if (archivedLeagueData) {
    const updatedLeague = withOffseasonSeasonContext(safeClone(archivedLeagueData), nextSeasonYear);
    updatedLeague.draftState = null;

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

  // 9) do NOT delete finals mvp history/latest; we only clear the one-time page payload
  localStorage.removeItem("bm_finals_mvp_v1");

  // 10) go to offseason hub
  navigate("/offseason");
}
