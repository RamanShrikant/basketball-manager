import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import * as simEngine from "../api/simEnginePy.js";
import styles from "./OffseasonHub.module.css";
import { saveLeagueData } from "../utils/leagueStorage.js";
import { recomputeDerivedRatingsInLeague } from "../utils/playerProgressionDerived_v1.js";
import { applyLeagueInflationForOffseason, getLeagueFinancialRules } from "../utils/leagueFinancials.js";
import { rollDraftPickAssetsForCompletedSeason } from "../utils/draftPicks.js";

const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
const FREE_AGENCY_LAST_ROUTE_KEY = "bm_free_agency_last_route_v1";
const PROG_META_KEY = "bm_progression_meta_v1";
const PROG_DELTAS_KEY = "bm_progression_deltas_v1";
const DRAFT_LOTTERY_KEY = "bm_draft_lottery_v1";
const DRAFT_STATE_KEY = "bm_draft_state_v1";
const CUSTOM_DRAFT_CLASS_KEY = "bm_custom_draft_class_v1";
const CUSTOM_DRAFT_CLASS_PREFIX = "bm_custom_draft_class_";
const CUSTOM_DRAFT_CLASS_MODE_BY_YEAR_KEY = "bm_draft_class_mode_by_year_v1";
const RETIREMENT_RESULTS_KEY = "bm_retirement_results_v1";
const OPTIONS_RESULTS_KEY = "bm_option_decision_results_v1";
const LEAGUE_KEY = "leagueData";
const FREE_AGENTS_TEAM_LABEL = "Free Agents";
const DEV_SIM_STOPPED = "DEV_SIM_STOPPED";
const DEV_SIM_PAUSED = "DEV_SIM_PAUSED";

// Stage 1 dev-sim rule: the full-offseason shortcut should behave like an
// untouched CPU simulation. The selected team is handed back to the user after
// the sim, but every backend offseason step receives no user team so it drafts,
// resolves rookie/stash decisions, options/rights, free agency, RFA matching,
// and final roster cleanup using CPU logic.
const DEV_SIM_TREAT_SELECTED_TEAM_AS_CPU = true;

function getDevBackendUserTeamName(userTeamName = "") {
  return DEV_SIM_TREAT_SELECTED_TEAM_AS_CPU ? null : userTeamName || null;
}

const DEV_SIM_TARGET_OPTIONS = [
  { value: "retirements", label: "Retirements" },
  { value: "lottery", label: "Draft Lottery" },
  { value: "draft", label: "NBA Draft" },
  { value: "rookie_signings", label: "Rookie Signings" },
  { value: "options", label: "Options / Rights" },
  { value: "free_agency_start", label: "Free Agency Opens" },
  { value: "free_agency_complete", label: "Free Agency Complete" },
  { value: "roster_ready", label: "Roster Legalized" },
  { value: "progression", label: "Progression Complete" },
  { value: "calendar", label: "Next Season Calendar" },
];

function getDevSimTargetLabel(value) {
  return DEV_SIM_TARGET_OPTIONS.find((row) => row.value === value)?.label || "Next Season Calendar";
}

function safeJSON(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function getRowsFromDraftClassPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.draftClass)) return payload.draftClass;
  if (Array.isArray(payload?.prospects)) return payload.prospects;
  if (Array.isArray(payload?.players)) return payload.players;
  return [];
}

function readDraftClassModeForYear(seasonYear, hasCustomClass = false) {
  const yearKey = String(Number(seasonYear || 2026));
  const modesByYear = safeJSON(localStorage.getItem(CUSTOM_DRAFT_CLASS_MODE_BY_YEAR_KEY), {}) || {};
  const explicitYearMode = modesByYear?.[yearKey];

  if (explicitYearMode === "custom" || explicitYearMode === "auto") {
    return explicitYearMode;
  }

  return hasCustomClass ? "custom" : "auto";
}

function readCustomDraftClassSetupForYear(seasonYear) {
  const seasonKey = `${CUSTOM_DRAFT_CLASS_PREFIX}${Number(seasonYear || 2026)}`;
  const savedSeasonClass = safeJSON(localStorage.getItem(seasonKey), null);
  const savedDefaultClass = safeJSON(localStorage.getItem(CUSTOM_DRAFT_CLASS_KEY), null);
  const draftClassPayload = savedSeasonClass || savedDefaultClass || null;
  const rows = getRowsFromDraftClassPayload(draftClassPayload);
  const hasCustomClass = rows.length > 0;
  const mode = readDraftClassModeForYear(seasonYear, hasCustomClass);

  if (mode !== "custom") return { mode, draftClassPayload: null, hasCustomClass };
  if (!draftClassPayload || typeof draftClassPayload !== "object" || !hasCustomClass) {
    return { mode, draftClassPayload: null, hasCustomClass: false };
  }

  const classSeasonYear = Number(draftClassPayload.seasonYear || draftClassPayload.draftClassYear || rows?.[0]?.draftClassYear || rows?.[0]?.seasonYear || seasonYear);
  if (classSeasonYear && Number(classSeasonYear) !== Number(seasonYear)) {
    return { mode, draftClassPayload: null, hasCustomClass: false };
  }

  return {
    mode,
    hasCustomClass: true,
    draftClassPayload: {
      ...draftClassPayload,
      seasonYear: Number(seasonYear),
      draftClass: rows.map((row, index) => ({
        ...row,
        draftClassYear: Number(row?.draftClassYear || row?.seasonYear || seasonYear),
        seasonYear: Number(row?.seasonYear || row?.draftClassYear || seasonYear),
        draftProjection: Number(row?.draftProjection || row?.trueRank || row?.rank || index + 1),
        trueRank: Number(row?.trueRank || row?.draftProjection || row?.rank || index + 1),
      })),
    },
  };
}

function snapshotLeague(obj) {
  try {
    if (typeof structuredClone === "function") return structuredClone(obj);
  } catch {}

  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
}

function getSeasonYear(leagueData) {
  const candidates = [];

  const pushYear = (value) => {
    const y = Number(value);
    if (Number.isFinite(y) && y >= 2020 && y <= 2100) {
      candidates.push(y);
    }
  };

  const meta = safeJSON(localStorage.getItem("bm_league_meta_v1"), {});
  const offseasonState = safeJSON(localStorage.getItem(OFFSEASON_STATE_KEY), {});

  pushYear(meta?.seasonYear);
  pushYear(meta?.currentSeasonYear);
  pushYear(meta?.seasonStartYear);
  pushYear(offseasonState?.seasonYear);
  pushYear(leagueData?.seasonYear);
  pushYear(leagueData?.currentSeasonYear);
  pushYear(leagueData?.seasonStartYear);

  if (candidates.length) {
    return Math.max(...candidates);
  }

  return 2026;
}

function getChampionName() {
  const champ = safeJSON(localStorage.getItem("bm_champ_v1"), null);
  if (!champ) return null;

  if (typeof champ === "string") return champ;
  return champ.team || champ.teamName || champ.name || null;
}

function buildDefaultOffseasonState(seasonYear) {
  return {
    active: true,
    seasonYear,
    retirementsComplete: false,
    retirementsSkipped: false,
    retirementsDisabled: false,
    leagueInflationComplete: false,
    leagueInflationSeasonYear: null,
    draftLotteryComplete: false,
    draftComplete: false,
    rookieSigningsComplete: false,
    optionsComplete: false,
    rightsManagementComplete: false,
    preFreeAgencyResolved: false,
    freeAgencyComplete: false,
    rosterFinalizationComplete: false,
    progressionComplete: false,
  };
}

function readOffseasonState(seasonYear) {
  const resolvedSeasonYear = Number(seasonYear || 2026);
  const stored = safeJSON(localStorage.getItem(OFFSEASON_STATE_KEY), null);

  if (!stored || typeof stored !== "object") {
    return buildDefaultOffseasonState(resolvedSeasonYear);
  }

  const storedSeasonYear = Number(stored?.seasonYear || 0);

  // Surgical year-rollover guard:
  // Never carry completed offseason flags into a different season. This was
  // causing Year 2+ to skip Options/Rights, skip expired-contract cleanup, and
  // open free agency with no newly-added free agents.
  if (storedSeasonYear > 0 && storedSeasonYear !== resolvedSeasonYear) {
    const fresh = buildDefaultOffseasonState(resolvedSeasonYear);
    try {
      localStorage.setItem(OFFSEASON_STATE_KEY, JSON.stringify(fresh));
      localStorage.removeItem(FREE_AGENCY_LAST_ROUTE_KEY);
      localStorage.removeItem(OPTIONS_RESULTS_KEY);
    } catch {}
    return fresh;
  }

  return {
    ...buildDefaultOffseasonState(resolvedSeasonYear),
    ...stored,
    seasonYear: resolvedSeasonYear,
  };
}

function saveOffseasonState(state) {
  localStorage.setItem(OFFSEASON_STATE_KEY, JSON.stringify(state));
}

function isIndexedDbLeaguePointer(value = {}) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.__storageMode === "indexedDB" &&
      !value.teams &&
      !value.conferences
  );
}

function makeUnavailableAgeAudit(seasonYear, reason = "NO_FULL_LEAGUE_OBJECT") {
  return {
    seasonYear: Number(seasonYear || 0),
    totalPlayers: 0,
    freeAgentPlayers: 0,
    staleCount: 0,
    staleExamples: [],
    ok: false,
    unavailable: true,
    reason,
  };
}

function getLeagueDataSnapshot(leagueData) {
  if (leagueData && typeof leagueData === "object") return leagueData;
  return safeJSON(localStorage.getItem("leagueData"), {}) || {};
}

function getSelectedTeamName(selectedTeam) {
  if (selectedTeam?.name) return selectedTeam.name;

  const saved = safeJSON(localStorage.getItem("selectedTeam"), null);
  if (typeof saved === "string") return saved;
  if (saved?.name) return saved.name;

  return "";
}

function getAllTeamsFromLeague(leagueData) {
  const snapshot = getLeagueDataSnapshot(leagueData);

  if (Array.isArray(snapshot?.teams)) return snapshot.teams;
  if (snapshot?.conferences) return Object.values(snapshot.conferences).flat();

  return [];
}

function getOptionYearIndicesLocal(option) {
  if (!option || typeof option !== "object") return [];

  const raw = Array.isArray(option.yearIndices)
    ? option.yearIndices
    : option.yearIndex !== undefined && option.yearIndex !== null
    ? [option.yearIndex]
    : [];

  return raw
    .map((value) => Number(value))
    .filter((value, index, arr) => Number.isFinite(value) && value >= 0 && arr.indexOf(value) === index)
    .sort((a, b) => a - b);
}

function getOptionPickValueLocal(option, yearIndex) {
  if (!option || typeof option !== "object") return null;

  const picked = option.picked;
  if (picked && typeof picked === "object" && !Array.isArray(picked)) {
    if (String(yearIndex) in picked) return picked[String(yearIndex)];
    if ("default" in picked) return picked.default;
    return null;
  }

  return picked;
}

function getSalaryForSeasonLocal(contract, seasonYear) {
  if (!contract || typeof contract !== "object") return 0;

  const startYear = Number(contract.startYear || 0);
  const salaryByYear = Array.isArray(contract.salaryByYear) ? contract.salaryByYear : [];
  const idx = Number(seasonYear) - startYear;

  if (idx < 0 || idx >= salaryByYear.length) return 0;
  return Number(salaryByYear[idx] || 0);
}

function hasPendingOptionForSeasonLocal(player, seasonYear) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : null;
  if (!contract) return false;

  const option = contract.option && typeof contract.option === "object" ? contract.option : null;
  if (!option?.type) return false;

  const startYear = Number(contract.startYear || 0);
  const salaryByYear = Array.isArray(contract.salaryByYear) ? contract.salaryByYear : [];
  const targetIdx = Number(seasonYear) - startYear;
  const optionYears = getOptionYearIndicesLocal(option);

  if (targetIdx >= 0 && targetIdx < salaryByYear.length && optionYears.includes(targetIdx)) {
    return getOptionPickValueLocal(option, targetIdx) === null || getOptionPickValueLocal(option, targetIdx) === undefined;
  }

  const bridgeSourceIdx = targetIdx - 1;
  if (salaryByYear.length === 1 && bridgeSourceIdx === 0 && optionYears.includes(bridgeSourceIdx)) {
    return getOptionPickValueLocal(option, bridgeSourceIdx) === null || getOptionPickValueLocal(option, bridgeSourceIdx) === undefined;
  }

  return false;
}

function hasUnresolvedPreFreeAgencyContracts(leagueData, seasonYear) {
  const snapshot = getLeagueDataSnapshot(leagueData);
  const targetSeasonYear = Number(seasonYear || snapshot?.seasonYear || snapshot?.currentSeasonYear || 2026) + 1;

  for (const team of getAllTeamsFromLeague(snapshot) || []) {
    const rosterBuckets = [team?.players || [], team?.twoWayPlayers || []];

    for (const players of rosterBuckets) {
      for (const player of players || []) {
        if (!player || typeof player !== "object") continue;

        const contract = player.contract && typeof player.contract === "object" ? player.contract : null;
        if (!contract) return true;

        if (hasPendingOptionForSeasonLocal(player, targetSeasonYear)) return true;
        if (getSalaryForSeasonLocal(contract, targetSeasonYear) <= 0) return true;
      }
    }
  }

  return false;
}

function getSelectedTeamFromLeague(leagueData, selectedTeam) {
  const teamName = getSelectedTeamName(selectedTeam);
  if (!teamName) return null;

  return getAllTeamsFromLeague(leagueData).find((team) => team?.name === teamName) || null;
}

function shouldResumeViewingOffers(leagueData) {
  const snapshot = getLeagueDataSnapshot(leagueData);
  const state = snapshot?.freeAgencyState || {};

  if (!state || typeof state !== "object") return false;

  const pendingUserDecisions = Array.isArray(state.pendingUserDecisions)
    ? state.pendingUserDecisions.length
    : 0;
  const pendingRfaMatchDecisions = Array.isArray(state.pendingRfaMatchDecisions)
    ? state.pendingRfaMatchDecisions.length
    : 0;

  const latestResults = state.latestResults || null;
  const latestHasContent = Boolean(
    latestResults &&
      ((latestResults.dayResolved !== null &&
        latestResults.dayResolved !== undefined) ||
        (Array.isArray(latestResults.signings) &&
          latestResults.signings.length > 0) ||
        (Array.isArray(latestResults.generatedOffers) &&
          latestResults.generatedOffers.length > 0) ||
        latestResults.stateSummary)
  );

  return Boolean(
    pendingUserDecisions > 0 ||
      pendingRfaMatchDecisions > 0 ||
      latestHasContent
  );
}

function getFreeAgencyResumeRoute(leagueData, offseasonState = {}) {
  const savedRoute = localStorage.getItem(FREE_AGENCY_LAST_ROUTE_KEY);

  if (!isFreeAgencyStateCurrentForOffseason(leagueData, offseasonState)) {
    localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/free-agents");
    return "/free-agents";
  }

  if (savedRoute === "/viewing-offers" && shouldResumeViewingOffers(leagueData)) {
    return "/viewing-offers";
  }

  if (savedRoute === "/free-agents") {
    return "/free-agents";
  }

  if (shouldResumeViewingOffers(leagueData)) {
    return "/viewing-offers";
  }

  return "/free-agents";
}

function getProgressionAgeCompletionAudit(leagueData, seasonYear) {
  const snapshot = getLeagueDataSnapshot(leagueData);
  const rows = [];

  for (const row of getProgressionPlayerRowsFromLeague(snapshot, true)) {
    const player = row.player;
    const lastBirthdayYear = Number(player?.lastBirthdayYear);
    rows.push({
      name: player?.name || "",
      team: row.teamName,
      age: player?.age,
      lastBirthdayYear: Number.isFinite(lastBirthdayYear) ? lastBirthdayYear : null,
      stale:
        !Number.isFinite(lastBirthdayYear) ||
        lastBirthdayYear < Number(seasonYear || 0),
    });
  }

  const staleRows = rows.filter((row) => row.stale);

  return {
    seasonYear: Number(seasonYear || 0),
    totalPlayers: rows.length,
    freeAgentPlayers: rows.filter((row) => row.team === FREE_AGENTS_TEAM_LABEL).length,
    staleCount: staleRows.length,
    staleExamples: staleRows.slice(0, 12),
    ok:
      rows.length > 0 &&
      staleRows.length <= Math.max(2, Math.floor(rows.length * 0.01)),
  };
}

function isProgressionReallyCompleteForSeason(seasonYear, leagueData = null, offseasonState = null) {
  const savedLeague = safeJSON(localStorage.getItem(LEAGUE_KEY), null);
  const progressionMeta = safeJSON(localStorage.getItem(PROG_META_KEY), null);
  const savedDeltas = safeJSON(localStorage.getItem(PROG_DELTAS_KEY), {}) || {};
  const storedDeltaCount =
    savedDeltas && typeof savedDeltas === "object" && !Array.isArray(savedDeltas)
      ? Object.keys(savedDeltas).length
      : 0;
  const deltaCount = Math.max(Number(progressionMeta?.deltaCount || 0), storedDeltaCount);
  const metaMatches = Number(progressionMeta?.appliedForSeasonYear) === Number(seasonYear);
  const stageDone = progressionMeta?.stage === "DONE" || progressionMeta?.deltasSaved === true;
  const offseasonSaysComplete = Boolean(offseasonState?.progressionComplete);

  const liveAgeAudit =
    leagueData && !isIndexedDbLeaguePointer(leagueData)
      ? getProgressionAgeCompletionAudit(leagueData, seasonYear)
      : makeUnavailableAgeAudit(seasonYear, "NO_LIVE_FULL_LEAGUE_OBJECT");
  const savedAgeAudit =
    savedLeague && !isIndexedDbLeaguePointer(savedLeague)
      ? getProgressionAgeCompletionAudit(savedLeague, seasonYear)
      : makeUnavailableAgeAudit(seasonYear, "LOCALSTORAGE_INDEXEDDB_POINTER");
  const ageAudit = liveAgeAudit.ok ? liveAgeAudit : savedAgeAudit.ok ? savedAgeAudit : liveAgeAudit;

  const markerOk = metaMatches && stageDone && deltaCount > 0;

  return {
    ok: markerOk && (ageAudit.ok || offseasonSaysComplete),
    metaMatches,
    stageDone,
    deltaCount,
    storedDeltaCount,
    progressionMeta,
    ageAudit,
    liveAgeAudit,
    savedAgeAudit,
    offseasonSaysComplete,
    localStorageIsPointer: isIndexedDbLeaguePointer(savedLeague),
  };
}

function freeAgencyHasRealMarketEvidence(leagueData) {
  const snapshot = getLeagueDataSnapshot(leagueData);
  const state = snapshot?.freeAgencyState || {};

  if (!state || typeof state !== "object") return false;

  const offersByPlayer =
    state.offersByPlayer && typeof state.offersByPlayer === "object"
      ? state.offersByPlayer
      : {};

  return Boolean(
    state.isActive ||
      Number(state.currentDay || 0) > 0 ||
      Number(state.signedCount || 0) > 0 ||
      (Array.isArray(state.dailyLog) && state.dailyLog.length > 0) ||
      (Array.isArray(state.signedPlayersLog) && state.signedPlayersLog.length > 0) ||
      (Array.isArray(state.offerHistory) && state.offerHistory.length > 0) ||
      (Array.isArray(state.pendingUserDecisions) && state.pendingUserDecisions.length > 0) ||
      (Array.isArray(state.pendingRfaMatchDecisions) && state.pendingRfaMatchDecisions.length > 0) ||
      Object.keys(offersByPlayer).length > 0 ||
      Boolean(state.latestResults)
  );
}

function hasStaleFreeAgencyComplete(leagueData, offseasonState) {
  const snapshot = getLeagueDataSnapshot(leagueData);
  const freeAgents = Array.isArray(snapshot?.freeAgents) ? snapshot.freeAgents : [];

  return Boolean(
    offseasonState?.freeAgencyComplete &&
      freeAgents.length > 0 &&
      !freeAgencyHasRealMarketEvidence(snapshot)
  );
}

function isFreeAgencyStateCurrentForOffseason(leagueData, offseasonState) {
  const snapshot = getLeagueDataSnapshot(leagueData);
  const state = snapshot?.freeAgencyState || {};
  if (!state || typeof state !== "object") return true;

  const currentSeasonYear = Number(
    snapshot?.seasonYear ||
      snapshot?.currentSeasonYear ||
      offseasonState?.seasonYear ||
      2026
  );
  const stateSeasonYear = Number(state?.seasonYear || 0);

  if (stateSeasonYear > 0 && stateSeasonYear !== currentSeasonYear) {
    return false;
  }

  const currentDay = Number(state?.currentDay || 0);
  const maxDays = Number(state?.maxDays || 0);
  const completeFlag = Boolean(
    state?.marketComplete ||
      state?.freeAgencyComplete ||
      state?.completed ||
      state?.isComplete ||
      state?.status === "complete"
  );

  const looksLikeClosedOldMarket =
    !state?.isActive &&
    maxDays > 0 &&
    (currentDay >= maxDays || completeFlag);

  const currentOffseasonHasNotStartedFA =
    offseasonState?.active &&
    Number(offseasonState?.seasonYear || currentSeasonYear) === currentSeasonYear &&
    !!offseasonState?.optionsComplete &&
    !offseasonState?.freeAgencyComplete;

  if (stateSeasonYear <= 0 && currentOffseasonHasNotStartedFA && looksLikeClosedOldMarket) {
    return false;
  }

  return true;
}

function getRosterStatus(leagueData, selectedTeam) {
  const snapshot = getLeagueDataSnapshot(leagueData);
  const teamName = getSelectedTeamName(selectedTeam);
  const liveTeam = getSelectedTeamFromLeague(snapshot, selectedTeam);

  if (!teamName || !liveTeam) {
    return {
      hasTeam: false,
      teamName,
      rosterCount: 0,
      minRoster: 14,
      maxRoster: 15,
      isValid: true,
      message: "",
    };
  }

  const minRoster = Number(
    snapshot?.minRosterSize ||
      snapshot?.minRosterLimit ||
      snapshot?.freeAgencyMinRosterSize ||
      snapshot?.offseasonMinRosterSize ||
      14
  );

  const maxRoster = Number(
    snapshot?.rosterLimit ||
      snapshot?.maxRosterSize ||
      15
  );

  const rosterCount = Array.isArray(liveTeam?.players)
    ? liveTeam.players.length
    : 0;

  let message = "";
  if (rosterCount < minRoster) {
    message = `${teamName} has ${rosterCount} standard players. You need at least ${minRoster} before simulating games.`;
  } else if (rosterCount > maxRoster) {
    message = `${teamName} has ${rosterCount} standard players. You can keep extra players during the offseason, but must trim to ${maxRoster} before simulating games.`;
  }

  return {
    hasTeam: true,
    teamName,
    rosterCount,
    minRoster,
    maxRoster,
    isValid: !message,
    message,
  };
}

function resolveLotteryLogo(team = {}) {
  return (
    team.logo ||
    team.teamLogo ||
    team.newTeamLogo ||
    team.logoUrl ||
    team.image ||
    team.img ||
    ""
  );
}

function normalizeLotteryTeamName(value = "") {
  return String(value || "").trim().toLowerCase();
}

function resolveLotteryTeamLogoFromLeague(leagueData, teamName) {
  const target = normalizeLotteryTeamName(teamName);
  if (!target) return "";

  for (const team of getAllTeamsFromLeague(leagueData)) {
    const names = [
      team.name,
      team.teamName,
      team.currentOwnerTeamName,
      team.originalTeamName,
    ];

    if (names.some((name) => normalizeLotteryTeamName(name) === target)) {
      return resolveLotteryLogo(team);
    }
  }

  return "";
}

function getRecordTeamName(row = {}) {
  return row.teamName || row.team || row.name || row.team_name || "";
}

function getRecordWins(row = {}) {
  return Number(row.wins ?? row.w ?? row.record?.wins ?? row.teamRecord?.wins ?? row.standings?.wins ?? 0);
}

function getRecordLosses(row = {}) {
  return Number(row.losses ?? row.l ?? row.record?.losses ?? row.teamRecord?.losses ?? row.standings?.losses ?? 0);
}

function hasUsableLotteryRecord(row = {}) {
  const teamName = getRecordTeamName(row);
  const wins = getRecordWins(row);
  const losses = getRecordLosses(row);
  return Boolean(teamName) && Number.isFinite(wins) && Number.isFinite(losses) && wins + losses > 0;
}

function normalizeLotteryRecord(row = {}, leagueData = null, index = 0) {
  const teamName = getRecordTeamName(row) || `Team ${index + 1}`;
  const wins = getRecordWins(row);
  const losses = getRecordLosses(row);
  const gamesPlayed = wins + losses;
  const rawConferenceSeed = Number(
    row.conferenceSeed ?? row.confSeed ?? row.seed ?? row.regularSeasonConferenceSeed ?? row.playInSeed ?? 0
  );
  const conferenceSeed = Number.isFinite(rawConferenceSeed) && rawConferenceSeed >= 1 && rawConferenceSeed <= 15
    ? rawConferenceSeed
    : null;

  return {
    ...row,
    teamName,
    name: row.name || teamName,
    currentOwnerTeamName: row.currentOwnerTeamName || teamName,
    originalTeamName: row.originalTeamName || teamName,
    wins,
    losses,
    gamesPlayed,
    winPct: gamesPlayed ? Number((wins / gamesPlayed).toFixed(3)) : 0,
    pointDifferential: Number(row.pointDifferential || row.netRating || 0),
    conferenceSeed,
    madePlayoffs: Boolean(row.madePlayoffs),
    madePlayIn: Boolean(row.madePlayIn || (conferenceSeed && conferenceSeed >= 7 && conferenceSeed <= 10)),
    lostSevenEightGame: Boolean(row.lostSevenEightGame || row.lost78Game || row.lost7v8Game),
    wonSevenEightGame: Boolean(row.wonSevenEightGame || row.won78Game || row.won7v8Game),
    playoffResult: row.playoffResult || (row.madePlayoffs ? "playoffs" : "missed_playoffs"),
    leagueRank: Number(row.leagueRank || index + 1),
    logo: resolveLotteryLogo(row) || resolveLotteryTeamLogoFromLeague(leagueData, teamName),
  };
}

function getUsableLotteryRows(rows = [], leagueData = null) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => normalizeLotteryRecord(row, leagueData, index))
    .filter(hasUsableLotteryRecord);
}

function getSeasonHistoryCandidates(leagueData, seasonYear) {
  const history = Array.isArray(leagueData?.seasonHistory) ? leagueData.seasonHistory : [];
  if (!history.length) return [];

  const resolvedSeasonYear = Number(seasonYear);
  const targetYears = [
    resolvedSeasonYear - 1,
    resolvedSeasonYear,
  ].filter((year) => Number.isFinite(year) && year >= 2020 && year <= 2100);

  const out = [];
  const seenRows = new Set();

  const pushEntry = (entry) => {
    if (!entry || typeof entry !== "object" || seenRows.has(entry)) return;
    if (!Array.isArray(entry.teams)) return;
    seenRows.add(entry);
    out.push(entry);
  };

  for (const targetYear of targetYears) {
    const matches = history.filter(
      (row) =>
        row &&
        typeof row === "object" &&
        Number(row.seasonYear) === Number(targetYear) &&
        Array.isArray(row.teams)
    );

    const complete = matches.filter((row) => row.status === "complete");
    [...complete, ...matches].reverse().forEach(pushEntry);
  }

  [...history]
    .filter((row) => row && typeof row === "object" && Array.isArray(row.teams))
    .filter((row) => Number(row.seasonYear || 0) <= resolvedSeasonYear)
    .sort((a, b) => Number(b.seasonYear || 0) - Number(a.seasonYear || 0))
    .forEach(pushEntry);

  return out;
}

function getLatestSeasonHistoryEntry(leagueData, seasonYear) {
  for (const entry of getSeasonHistoryCandidates(leagueData, seasonYear)) {
    const usableRows = getUsableLotteryRows(entry?.teams || [], leagueData);
    if (usableRows.length >= 30) {
      return entry;
    }
  }

  return null;
}

function getTeamRecordsForDevLottery(leagueData, seasonYear) {
  const latest = getLatestSeasonHistoryEntry(leagueData, seasonYear);
  if (latest) {
    const rows = getUsableLotteryRows(latest.teams, leagueData);
    if (rows.length >= 30) return rows.slice(0, 30);
  }

  const currentTeamRows = getUsableLotteryRows(
    getAllTeamsFromLeague(leagueData).map((team, index) => ({
      teamName: team?.name || team?.teamName || `Team ${index + 1}`,
      name: team?.name || team?.teamName || `Team ${index + 1}`,
      wins: team?.wins ?? team?.w ?? 0,
      losses: team?.losses ?? team?.l ?? 0,
      pointDifferential: team?.pointDifferential || 0,
      madePlayoffs: Boolean(team?.madePlayoffs),
      madePlayIn: Boolean(team?.madePlayIn),
      playoffResult: team?.playoffResult || "unknown",
      leagueRank: index + 1,
      logo: resolveLotteryLogo(team),
    })),
    leagueData
  );

  if (currentTeamRows.length >= 30) return currentTeamRows.slice(0, 30);

  return [];
}

function getPlayerKeyFromAny(row = {}) {
  if (row?.playerId !== undefined && row?.playerId !== null && row?.playerId !== "") return String(row.playerId);
  if (row?.id !== undefined && row?.id !== null && row?.id !== "") return String(row.id);
  return String(row?.playerName || row?.name || "");
}

function buildAutoRookieDecisions(rows = []) {
  const decisions = {};
  for (const row of rows || []) {
    const key = row?.playerId ?? row?.id;
    if (key === undefined || key === null || key === "") continue;
    let decision = row?.recommendedDecision || row?.recommendation || row?.defaultDecision || "two_way";
    if (decision === "draft_rights") decision = "stash";
    if (!["standard", "two_way", "stash", "release"].includes(decision)) decision = "stash";
    decisions[key] = decision;
  }
  return decisions;
}

function buildAutoTeamOptionDecisions(rows = []) {
  const decisions = {};

  for (const row of rows || []) {
    const idKey = row?.playerId !== undefined && row?.playerId !== null && row?.playerId !== ""
      ? String(row.playerId)
      : null;
    const nameKey = String(row.playerName || row.name || "");

    const rawRecommendation = String(
      row?.recommendedDecision ||
        row?.recommendation ||
        row?.teamRecommendation ||
        row?.defaultDecision ||
        ""
    ).toLowerCase();

    const explicitChoice =
      row?.recommendedExercise ??
      row?.shouldExercise ??
      row?.exerciseRecommended ??
      row?.teamShouldExercise ??
      null;

    const exercise = explicitChoice !== null && explicitChoice !== undefined
      ? Boolean(explicitChoice)
      : rawRecommendation.includes("decline") || rawRecommendation.includes("reject")
      ? false
      : true;

    if (idKey) decisions[idKey] = exercise;
    if (nameKey) decisions[nameKey] = exercise;
  }

  return decisions;
}

function hasPendingQualifyingOffer(row) {
  return row?.qualifyingOfferEligible?.status === "pending";
}

function hasExtendedQualifyingOffer(row) {
  return row?.qualifyingOffer?.status === "extended" || !!row?.qualifyingOffer?.amount;
}

function getDefaultRightsDecision(row) {
  if (hasExtendedQualifyingOffer(row)) return "keep_qo";
  if (hasPendingQualifyingOffer(row)) return "extend_qo";
  return "keep";
}

function buildAutoRightsDecisions(rows = []) {
  const decisions = {};

  for (const row of rows || []) {
    const key = row?.playerKey || getPlayerKeyFromAny(row);
    if (!key) continue;
    decisions[key] = getDefaultRightsDecision(row);
  }

  return decisions;
}

function buildCleanFreeAgencyStateForDev(seasonYear, userTeamName = null, maxDays = 10, originalUserTeamName = null) {
  return {
    seasonYear,
    isActive: false,
    currentDay: 0,
    maxDays,
    offersByPlayer: {},
    dailyLog: [],
    signedPlayersLog: [],
    offerHistory: [],
    userOfferOutcomeLog: [],
    pendingUserDecisions: [],
    pendingRfaMatchDecisions: [],
    exceptionUsageByTeam: {},
    teamNeedProfiles: {},
    pendingUserTeamName: userTeamName,
    pendingUserTeamSnapshot: null,
    devSimTreatSelectedTeamAsCpu: DEV_SIM_TREAT_SELECTED_TEAM_AS_CPU,
    devOriginalSelectedTeamName: originalUserTeamName || null,
    latestResults: null,
    marketComplete: false,
    freeAgencyComplete: false,
    completed: false,
    isComplete: false,
    status: "not_started",
  };
}

function compactSigningForDevStorage(row) {
  if (!row || typeof row !== "object") return row;
  return {
    day: row.day ?? null,
    playerId: row.playerId ?? null,
    playerName: row.playerName || "",
    playerKey: row.playerKey || "",
    teamName: row.teamName || row.signedWith || "",
    signedWith: row.signedWith || row.teamName || "",
    contract: row.contract || row.signedContract || null,
    totalValue: row.totalValue || row.signedTotalValue || 0,
    aav: row.aav || 0,
    years: row.years || row.signedYears || row.contract?.salaryByYear?.length || 0,
    spendingType: row.spendingType || "",
    exceptionType: row.exceptionType || "",
    rfaMatched: Boolean(row.rfaMatched),
  };
}

function compactOfferForDevStorage(offer) {
  if (!offer || typeof offer !== "object") return offer;
  return {
    offerId: offer.offerId || null,
    playerId: offer.playerId ?? null,
    playerName: offer.playerName || "",
    playerKey: offer.playerKey || "",
    teamName: offer.teamName || "",
    source: offer.source || "",
    status: offer.status || "active",
    submittedDay: offer.submittedDay ?? offer.day ?? null,
    day: offer.day ?? offer.submittedDay ?? null,
    contract: offer.contract || null,
    years: offer.years || offer.contract?.salaryByYear?.length || 0,
    totalValue: offer.totalValue || 0,
    aav: offer.aav || 0,
    playerViewScore: offer.playerViewScore || 0,
    spendingType: offer.spendingType || "",
    exceptionType: offer.exceptionType || "",
    payrollZone: offer.payrollZone || "",
    rfaOfferSheet: Boolean(offer.rfaOfferSheet),
    rfaMatched: Boolean(offer.rfaMatched),
    rightsTeamName: offer.rightsTeamName || "",
  };
}

function compactFreeAgencyStateForDevStorage(state) {
  if (!state || typeof state !== "object") return state;

  const offersByPlayer = {};
  for (const [playerKey, offers] of Object.entries(state.offersByPlayer || {})) {
    offersByPlayer[playerKey] = Array.isArray(offers)
      ? offers.slice(0, 8).map(compactOfferForDevStorage)
      : offers;
  }

  const compacted = {
    ...state,
    offersByPlayer,
    latestResults: state.latestResults
      ? {
          dayResolved: state.latestResults.dayResolved ?? null,
          stateSummary: state.latestResults.stateSummary || null,
          signings: Array.isArray(state.latestResults.signings)
            ? state.latestResults.signings.slice(0, 40).map(compactSigningForDevStorage)
            : [],
          generatedOffers: Array.isArray(state.latestResults.generatedOffers)
            ? state.latestResults.generatedOffers.slice(0, 40).map(compactOfferForDevStorage)
            : [],
        }
      : null,
    signedPlayersLog: Array.isArray(state.signedPlayersLog)
      ? state.signedPlayersLog.slice(-40).map(compactSigningForDevStorage)
      : [],
    offerHistory: Array.isArray(state.offerHistory)
      ? state.offerHistory.slice(-40).map(compactOfferForDevStorage)
      : [],
    dailyLog: Array.isArray(state.dailyLog) ? state.dailyLog.slice(-6) : [],
    userOfferOutcomeLog: Array.isArray(state.userOfferOutcomeLog)
      ? state.userOfferOutcomeLog.slice(-40)
      : [],
  };

  delete compacted.fullActionLog;
  delete compacted.rfaDebugLog;
  delete compacted.cpuOfferDebugLog;
  delete compacted.rfaMatchDebugLog;
  delete compacted.finalizeDebugLog;
  delete compacted.blockedCapHoldRenounceLog;
  delete compacted.rightsRenounceLog;
  delete compacted.freeAgencyDebugErrors;

  return compacted;
}

function compactLeagueDataForDevStorage(leagueData) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;
  return {
    ...leagueData,
    freeAgencyState: compactFreeAgencyStateForDevStorage(leagueData.freeAgencyState),
  };
}

function loadStatsByKeyFromStorage() {
  const keysToTry = [
    "bm_player_stats_v1",
    "bm_season_player_stats_v1",
    "playerStatsByKey",
    "statsByKey",
  ];

  const stores = [localStorage, sessionStorage];

  for (const store of stores) {
    for (const k of keysToTry) {
      try {
        const raw = store.getItem(k);
        if (!raw) continue;

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") continue;

        const someKey = Object.keys(parsed)[0];
        if (someKey && someKey.includes("__")) {
          return parsed;
        }

        const rows = Array.isArray(parsed) ? parsed : Object.values(parsed);

        const statsByKey = {};
        for (const r of rows) {
          const name = r?.player ?? r?.name ?? r?.playerName;
          const team = r?.team ?? r?.teamName;
          if (!name || !team) continue;
          statsByKey[`${name}__${team}`] = r;
        }

        if (Object.keys(statsByKey).length > 0) {
          try {
            localStorage.setItem("bm_player_stats_v1", JSON.stringify(statsByKey));
          } catch {}
          return statsByKey;
        }
      } catch {}
    }
  }

  return {};
}

function progressionPlayerKey(player = {}) {
  return String(player?.id || player?.name || "");
}

function getTeamNameForProgression(team = {}) {
  return team?.name || team?.teamName || "";
}

function isTwoWayRosterPlayer(player = {}) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const type = String(player?.contractType || player?.rosterStatus || contract?.type || "").toLowerCase();
  return type === "two_way" || type === "two-way" || player?.assignmentStatus === "g_league";
}

function stripProgressionBucketMarker(player = {}) {
  if (!player || typeof player !== "object") return player;
  const next = { ...player };
  delete next.__progressionRosterBucket;
  return next;
}

function getProgressionPlayersFromTeam(team, includeTwoWay = true) {
  const standardPlayers = Array.isArray(team?.players) ? team.players : [];
  if (!includeTwoWay) return standardPlayers;

  const twoWayPlayers = Array.isArray(team?.twoWayPlayers) ? team.twoWayPlayers : [];
  const stashPlayers = Array.isArray(team?.stashPlayers) ? team.stashPlayers : [];

  const seen = new Set(standardPlayers.map(progressionPlayerKey));
  const merged = [...standardPlayers];

  for (const player of twoWayPlayers) {
    const key = progressionPlayerKey(player);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(player);
  }

  for (const player of stashPlayers) {
    const key = progressionPlayerKey(player);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(player);
  }

  return merged;
}


function getFreeAgentsFromLeague(leagueData) {
  return Array.isArray(leagueData?.freeAgents)
    ? leagueData.freeAgents.filter((player) => player && typeof player === "object")
    : [];
}

function getProgressionPlayerRowsFromLeague(leagueData, includeFreeAgents = true) {
  const rows = [];

  for (const team of getAllTeamsFromLeague(leagueData) || []) {
    const teamName = getTeamNameForProgression(team) || "Team";
    for (const player of getProgressionPlayersFromTeam(team)) {
      if (!player || typeof player !== "object") continue;
      rows.push({ player, teamName, isFreeAgent: false });
    }
  }

  if (includeFreeAgents) {
    for (const player of getFreeAgentsFromLeague(leagueData)) {
      rows.push({ player, teamName: FREE_AGENTS_TEAM_LABEL, isFreeAgent: true });
    }
  }

  return rows;
}

function isCurrentDraftClassRookie(player = {}, seasonYear = null) {
  const resolvedSeasonYear = Number(seasonYear || 0);
  if (!Number.isFinite(resolvedSeasonYear) || resolvedSeasonYear <= 0) return false;

  const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
  const draftYear = Number(
    meta?.draftYear ??
      player?.draftYear ??
      player?.draftClassYear ??
      player?.draftedYear ??
      0
  );

  if (!Number.isFinite(draftYear) || draftYear !== resolvedSeasonYear) return false;

  const acquiredVia = String(meta?.acquiredVia || player?.acquiredVia || "").toLowerCase();
  const playerId = String(player?.id || "").toLowerCase();

  return (
    acquiredVia.includes("draft") ||
    playerId.startsWith(`rookie_${resolvedSeasonYear}_`) ||
    Boolean(player?.rights?.rookieScale) ||
    Boolean(player?.rookieSigningPending)
  );
}

function makeCurrentDraftRookieMap(beforeLeague, seasonYear) {
  const byTeam = new Map();

  const ensureTeamMap = (teamName) => {
    if (!byTeam.has(teamName)) {
      byTeam.set(teamName, {
        players: new Map(),
        twoWayPlayers: new Map(),
        stashPlayers: new Map(),
        freeAgents: new Map(),
        any: new Map(),
      });
    }
    return byTeam.get(teamName);
  };

  const addRookie = (teamName, bucketName, player) => {
    if (!isCurrentDraftClassRookie(player, seasonYear)) return;
    const key = progressionPlayerKey(player);
    if (!key) return;
    const cleanPlayer = snapshotLeague(player);
    const teamMap = ensureTeamMap(teamName);
    teamMap[bucketName].set(key, cleanPlayer);
    teamMap.any.set(key, cleanPlayer);
  };

  for (const team of getAllTeamsFromLeague(beforeLeague) || []) {
    const teamName = getTeamNameForProgression(team);
    if (!teamName) continue;

    for (const player of team.players || []) addRookie(teamName, "players", player);
    for (const player of team.twoWayPlayers || []) addRookie(teamName, "twoWayPlayers", player);
    for (const player of team.stashPlayers || []) addRookie(teamName, "stashPlayers", player);
  }

  for (const player of getFreeAgentsFromLeague(beforeLeague)) {
    addRookie(FREE_AGENTS_TEAM_LABEL, "freeAgents", player);
  }

  return byTeam;
}

function restoreCurrentDraftClassRookiesAfterProgression(updatedLeague, beforeLeague, seasonYear) {
  if (!updatedLeague || !beforeLeague) return updatedLeague;

  const rookieMapByTeam = makeCurrentDraftRookieMap(beforeLeague, seasonYear);
  if (!rookieMapByTeam.size) return updatedLeague;

  const league = snapshotLeague(updatedLeague);

  const restoreBucket = (players = [], bucketName = "players", rookieMaps = null) => {
    if (!rookieMaps) return Array.isArray(players) ? players : [];

    const restored = [];
    const seen = new Set();
    const bucketMap = rookieMaps[bucketName] || new Map();

    for (const player of players || []) {
      const key = progressionPlayerKey(player);
      const replacement = key ? bucketMap.get(key) || rookieMaps.any.get(key) : null;
      const nextPlayer = replacement ? snapshotLeague(replacement) : player;
      const nextKey = progressionPlayerKey(nextPlayer);
      if (nextKey && seen.has(nextKey)) continue;
      if (nextKey) seen.add(nextKey);
      restored.push(nextPlayer);
    }

    for (const [key, rookie] of bucketMap.entries()) {
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      restored.push(snapshotLeague(rookie));
    }

    return restored;
  };

  for (const team of getAllTeamsFromLeague(league) || []) {
    const teamName = getTeamNameForProgression(team);
    const rookieMaps = rookieMapByTeam.get(teamName);
    if (!rookieMaps) continue;

    team.players = restoreBucket(Array.isArray(team.players) ? team.players : [], "players", rookieMaps);
    team.twoWayPlayers = restoreBucket(Array.isArray(team.twoWayPlayers) ? team.twoWayPlayers : [], "twoWayPlayers", rookieMaps);
    team.stashPlayers = restoreBucket(Array.isArray(team.stashPlayers) ? team.stashPlayers : [], "stashPlayers", rookieMaps);
  }

  const freeAgentRookieMaps = rookieMapByTeam.get(FREE_AGENTS_TEAM_LABEL);
  if (freeAgentRookieMaps) {
    league.freeAgents = restoreBucket(
      Array.isArray(league.freeAgents) ? league.freeAgents : [],
      "freeAgents",
      freeAgentRookieMaps
    );
  }

  return league;
}

function prepareLeagueForProgressionWorker(league, seasonYear = null) {
  const cloned = snapshotLeague(league);
  const teams = getAllTeamsFromLeague(cloned);

  for (const team of teams || []) {
    if (!Array.isArray(team.players)) team.players = [];
    if (!Array.isArray(team.twoWayPlayers)) team.twoWayPlayers = [];
    if (!Array.isArray(team.stashPlayers)) team.stashPlayers = [];

    team.players = team.players.filter((player) => !isCurrentDraftClassRookie(player, seasonYear));
    team.twoWayPlayers = team.twoWayPlayers.filter((player) => !isCurrentDraftClassRookie(player, seasonYear));
    team.stashPlayers = team.stashPlayers.filter((player) => !isCurrentDraftClassRookie(player, seasonYear));

    const existing = new Set(team.players.map(progressionPlayerKey));

    for (const player of team.twoWayPlayers) {
      const key = progressionPlayerKey(player);
      if (key && existing.has(key)) continue;
      if (key) existing.add(key);
      team.players.push({
        ...player,
        __progressionRosterBucket: "twoWayPlayers",
        contractType: player?.contractType || "two_way",
        rosterStatus: player?.rosterStatus || "two_way",
        assignmentStatus: player?.assignmentStatus || "g_league",
      });
    }

    for (const player of team.stashPlayers) {
      const key = progressionPlayerKey(player);
      if (key && existing.has(key)) continue;
      if (key) existing.add(key);
      team.players.push({
        ...player,
        __progressionRosterBucket: "stashPlayers",
        contractType: player?.contractType || "stash",
        rosterStatus: player?.rosterStatus || "stashed",
        assignmentStatus: player?.assignmentStatus || "stash",
      });
    }
  }

  if (!Array.isArray(cloned.freeAgents)) cloned.freeAgents = [];
  cloned.freeAgents = cloned.freeAgents.filter((player) => !isCurrentDraftClassRookie(player, seasonYear));

  return cloned;
}

function restoreTwoWayBucketsAfterProgression(workerLeague, fallbackLeague) {
  const league = snapshotLeague(workerLeague);
  const fallbackTeams = getAllTeamsFromLeague(fallbackLeague);
  const fallbackByName = new Map();

  for (const team of fallbackTeams || []) {
    const teamName = getTeamNameForProgression(team);
    if (teamName) fallbackByName.set(teamName, team);
  }

  for (const team of getAllTeamsFromLeague(league) || []) {
    const teamName = getTeamNameForProgression(team);
    const fallbackTeam = fallbackByName.get(teamName);
    const originalTwoWayIds = new Set((fallbackTeam?.twoWayPlayers || []).map(progressionPlayerKey));
    const originalStashIds = new Set((fallbackTeam?.stashPlayers || []).map(progressionPlayerKey));

    const standardPlayers = [];
    const twoWayPlayers = [];
    const stashPlayers = [];
    const seenStandard = new Set();
    const seenTwoWay = new Set();
    const seenStash = new Set();

    for (const rawPlayer of team.players || []) {
      const player = stripProgressionBucketMarker(rawPlayer);
      const key = progressionPlayerKey(player);
      const belongsStash =
        rawPlayer?.__progressionRosterBucket === "stashPlayers" ||
        originalStashIds.has(key) ||
        player?.contractType === "stash" ||
        player?.rosterStatus === "stashed";

      if (belongsStash) {
        player.contractType = player.contractType || "stash";
        player.rosterStatus = player.rosterStatus || "stashed";
        player.assignmentStatus = player.assignmentStatus || "stash";
        if (!seenStash.has(key)) {
          seenStash.add(key);
          stashPlayers.push(player);
        }
        continue;
      }

      const belongsTwoWay =
        rawPlayer?.__progressionRosterBucket === "twoWayPlayers" ||
        originalTwoWayIds.has(key) ||
        isTwoWayRosterPlayer(player);

      if (belongsTwoWay) {
        player.contractType = player.contractType || "two_way";
        player.rosterStatus = player.rosterStatus || "two_way";
        player.assignmentStatus = player.assignmentStatus || "g_league";
        if (!seenTwoWay.has(key)) {
          seenTwoWay.add(key);
          twoWayPlayers.push(player);
        }
        continue;
      }

      if (!seenStandard.has(key)) {
        seenStandard.add(key);
        standardPlayers.push(player);
      }
    }

    for (const rawPlayer of team.twoWayPlayers || []) {
      const player = stripProgressionBucketMarker(rawPlayer);
      const key = progressionPlayerKey(player);
      if (!seenTwoWay.has(key)) {
        seenTwoWay.add(key);
        twoWayPlayers.push(player);
      }
    }

    for (const rawPlayer of team.stashPlayers || []) {
      const player = stripProgressionBucketMarker(rawPlayer);
      const key = progressionPlayerKey(player);
      if (!seenStash.has(key)) {
        seenStash.add(key);
        stashPlayers.push(player);
      }
    }

    team.players = standardPlayers;
    team.twoWayPlayers = twoWayPlayers;
    team.stashPlayers = stashPlayers;
  }

  return league;
}

function stampAgingGuards(league, seasonYear) {
  if (!league) return league;
  for (const row of getProgressionPlayerRowsFromLeague(league, true)) {
    const p = row.player;
    if (!p || typeof p !== "object") continue;
    if (!Number.isFinite(Number(p.lastBirthdayYear))) {
      p.lastBirthdayYear = seasonYear;
    }
  }
  return league;
}


function stampCareerSeasonCounters(league, seasonYear) {
  if (!league) return league;

  const resolvedSeasonYear = Number(seasonYear || 0);
  if (!Number.isFinite(resolvedSeasonYear) || resolvedSeasonYear <= 0) return league;

  const rows = getProgressionPlayerRowsFromLeague(league, true);

  for (const row of rows) {
    const player = row.player;
    const teamName = row.isFreeAgent ? "" : row.teamName;
    if (!player || typeof player !== "object") continue;

    const meta = player.meta && typeof player.meta === "object" ? { ...player.meta } : {};
    const rights = player.rights && typeof player.rights === "object" ? { ...player.rights } : {};

    const alreadyCounted =
      Number(meta.lastProSeasonCountedYear) === resolvedSeasonYear ||
      Number(player.lastProSeasonCountedYear) === resolvedSeasonYear;

    if (alreadyCounted) continue;

    const draftYear = Number(meta.draftYear ?? player.draftYear ?? 0);
    const currentProSeasons = Math.max(
      0,
      Number(meta.proSeasons ?? player.proSeasons ?? 0) || 0
    );

    const isBrandNewDraftRookie =
      Number.isFinite(draftYear) &&
      draftYear === resolvedSeasonYear &&
      currentProSeasons <= 0 &&
      String(meta.acquiredVia || player.acquiredVia || "").toLowerCase().includes("draft");

    if (isBrandNewDraftRookie) {
      meta.lastProSeasonCountedYear = resolvedSeasonYear;
      player.lastProSeasonCountedYear = resolvedSeasonYear;
      player.meta = meta;
      player.rights = rights;
      continue;
    }

    const nextProSeasons = currentProSeasons + 1;
    meta.proSeasons = nextProSeasons;
    player.proSeasons = nextProSeasons;
    meta.lastProSeasonCountedYear = resolvedSeasonYear;
    player.lastProSeasonCountedYear = resolvedSeasonYear;

    if (!teamName) {
      player.meta = meta;
      player.rights = rights;
      continue;
    }

    const contractStartYear = Number(player.contract?.startYear ?? 0);
    const currentYearsWithTeam = Math.max(
      0,
      Number(meta.yearsWithCurrentTeam ?? player.yearsWithCurrentTeam ?? 0) || 0
    );

    const likelyNewToTeamThisOffseason =
      contractStartYear === resolvedSeasonYear &&
      currentYearsWithTeam <= 0 &&
      !(Number.isFinite(draftYear) && draftYear > 0 && draftYear < resolvedSeasonYear);

    if (!likelyNewToTeamThisOffseason) {
      const nextYearsWithTeam = currentYearsWithTeam + 1;
      meta.yearsWithCurrentTeam = nextYearsWithTeam;
      player.yearsWithCurrentTeam = nextYearsWithTeam;

      const currentBirdSeasons = Math.max(
        0,
        Number(rights.seasonsTowardBird ?? 0) || 0
      );
      const nextBirdSeasons = Math.max(currentBirdSeasons + 1, nextYearsWithTeam);
      rights.seasonsTowardBird = nextBirdSeasons;

      if (teamName && !rights.heldByTeam) {
        rights.heldByTeam = teamName;
      }

      if (!rights.birdLevel || ["none", "non_bird", "early_bird", "bird"].includes(rights.birdLevel)) {
        if (nextBirdSeasons >= 3) rights.birdLevel = "bird";
        else if (nextBirdSeasons >= 2) rights.birdLevel = "early_bird";
        else if (nextBirdSeasons >= 1) rights.birdLevel = "non_bird";
      }
    }

    player.meta = meta;
    player.rights = rights;
  }

  return league;
}

function buildProgressionDeltas(beforeLeague, afterLeague) {
  const mapPlayers = (league) => {
    const m = {};
    for (const row of getProgressionPlayerRowsFromLeague(league, true)) {
      const p = row.player;
      const teamName = row.teamName || FREE_AGENTS_TEAM_LABEL;
      if (!p?.name || !teamName) continue;
      m[`${p.name}__${teamName}`] = p;
    }
    return m;
  };

  const A = mapPlayers(beforeLeague);
  const B = mapPlayers(afterLeague);

  const deltas = {};

  for (const key of Object.keys(B)) {
    const p0 = A[key];
    const p1 = B[key];
    if (!p0 || !p1) continue;

    const d = {};

    const scalarKeys = ["age", "overall", "offRating", "defRating", "stamina", "potential"];
    for (const k of scalarKeys) {
      const v0 = Number(p0?.[k] ?? 0);
      const v1 = Number(p1?.[k] ?? 0);
      const diff = v1 - v0;
      if (diff) d[k] = diff;
    }

    const attrs0 = Array.isArray(p0?.attrs) ? p0.attrs : [];
    const attrs1 = Array.isArray(p1?.attrs) ? p1.attrs : [];
    const maxLen = Math.max(attrs0.length, attrs1.length);

    for (let i = 0; i < maxLen; i++) {
      const v0 = Number(attrs0[i] ?? 0);
      const v1 = Number(attrs1[i] ?? 0);
      const diff = v1 - v0;
      if (diff) d[`attr${i}`] = diff;
    }

    if (Object.keys(d).length) {
      deltas[key] = d;
    }
  }

  return deltas;
}

function getMaxRosterForDev(leagueData) {
  return Number(
    leagueData?.rosterLimit ||
      leagueData?.maxRosterSize ||
      15
  );
}

function getMinRosterForDev(leagueData) {
  return Number(
    leagueData?.minRosterSize ||
      leagueData?.minRosterLimit ||
      leagueData?.freeAgencyMinRosterSize ||
      leagueData?.offseasonMinRosterSize ||
      14
  );
}

function getDevMinimumSalary(leagueData) {
  return Number(
    leagueData?.minimumSalary ||
      leagueData?.minSalary ||
      leagueData?.veteranMinimum ||
      leagueData?.rookieMinimum ||
      1250000
  );
}

function getDevReleaseOverall(player = {}) {
  return Number(player?.overall ?? player?.ovr ?? player?.rating ?? 0) || 0;
}

function getDevReleasePotential(player = {}) {
  return Number(player?.potential ?? player?.pot ?? 0) || 0;
}

function getDevReleaseAge(player = {}) {
  return Number(player?.age ?? 0) || 0;
}

function getDevFreeAgentRightsTeam(player = {}) {
  return String(
    player?.rights?.heldByTeam ||
      player?.rightsTeam ||
      player?.rightsTeamName ||
      ""
  );
}

function getDevFreeAgentFormerTeam(player = {}) {
  return String(
    player?.formerTeamName ||
      player?.previousTeam ||
      player?.lastTeamName ||
      ""
  );
}

function getDevRosterFillScore(player = {}, userTeamName = "") {
  const rightsTeam = getDevFreeAgentRightsTeam(player);
  const formerTeam = getDevFreeAgentFormerTeam(player);
  const listedTeam = String(player?.team || "");

  if (rightsTeam && rightsTeam !== userTeamName) return Number.NEGATIVE_INFINITY;

  if (
    listedTeam &&
    listedTeam !== "Free Agent" &&
    listedTeam !== userTeamName &&
    !rightsTeam &&
    formerTeam !== userTeamName
  ) {
    return Number.NEGATIVE_INFINITY;
  }

  let score =
    getDevReleaseOverall(player) * 10000 +
    getDevReleasePotential(player) * 100 -
    getDevReleaseAge(player);

  if (rightsTeam === userTeamName) score += 1000000;
  if (formerTeam === userTeamName) score += 500000;
  if (listedTeam === "Free Agent") score += 10000;

  return score;
}

function getDevFillerSalary(player = {}, leagueData = {}) {
  const minimumSalary = getDevMinimumSalary(leagueData);
  return Math.max(
    minimumSalary,
    Number(
      player?.qualifyingOffer?.amount ||
        player?.qualifyingOfferEligible?.amount ||
        player?.expectedAnnualSalary ||
        player?.marketValue ||
        player?.aav ||
        0
    ) || minimumSalary
  );
}

function buildDevFillerContract(player = {}, leagueData = {}) {
  const seasonForContract = Number(
    leagueData?.seasonYear ||
      leagueData?.currentSeasonYear ||
      leagueData?.seasonStartYear ||
      2026
  );

  return {
    type: "standard",
    startYear: seasonForContract + 1,
    salaryByYear: [Math.round(getDevFillerSalary(player, leagueData))],
    isGuaranteed: true,
    source: "dev_roster_minimum_fill",
  };
}

function fixUserRosterForDev(leagueData, userTeamName) {
  if (!leagueData || !userTeamName) {
    return { leagueData, releasedPlayers: [], signedPlayers: [] };
  }

  const league = snapshotLeague(leagueData);
  const minRoster = getMinRosterForDev(league);
  const maxRoster = getMaxRosterForDev(league);
  const team = getAllTeamsFromLeague(league).find(
    (row) => row?.name === userTeamName || row?.teamName === userTeamName
  );

  if (!team || !Array.isArray(team.players)) {
    return { leagueData, releasedPlayers: [], signedPlayers: [] };
  }

  if (!Array.isArray(league.freeAgents)) {
    league.freeAgents = [];
  }

  const releasedPlayers = [];
  const signedPlayers = [];

  while (team.players.length > maxRoster) {
    const ranked = team.players
      .map((player, index) => ({
        player,
        index,
        releaseScore:
          getDevReleaseOverall(player) * 10000 +
          getDevReleasePotential(player) * 100 -
          getDevReleaseAge(player),
      }))
      .sort((a, b) => a.releaseScore - b.releaseScore || a.index - b.index);

    const victimRow = ranked[0];
    if (!victimRow) break;

    const [victim] = team.players.splice(victimRow.index, 1);
    if (!victim) break;

    const freeAgentPlayer = {
      ...victim,
      team: "Free Agent",
      formerTeamName: userTeamName,
      releasedByTeamName: userTeamName,
      rosterStatus: "free_agent",
      assignmentStatus: "free_agent",
      devReleasedForRosterLimit: true,
      history: {
        ...(victim.history || {}),
        transactions: [
          ...((victim.history && Array.isArray(victim.history.transactions)) ? victim.history.transactions : []),
          {
            seasonYear: league?.seasonYear || league?.currentSeasonYear || null,
            type: "dev_roster_limit_release",
            label: `Released by ${userTeamName} through dev offseason roster cleanup`,
            teamName: userTeamName,
          },
        ],
      },
    };

    league.freeAgents.push(freeAgentPlayer);
    releasedPlayers.push({
      playerId: victim.id || victim.playerId || null,
      playerName: victim.name || victim.playerName || "Unknown Player",
      overall: getDevReleaseOverall(victim),
      potential: getDevReleasePotential(victim),
    });
  }

  const activeKeys = new Set(
    team.players
      .map((player) => String(player?.id || player?.playerId || player?.name || ""))
      .filter(Boolean)
  );

  while (team.players.length < minRoster && league.freeAgents.length > 0) {
    const rankedFreeAgents = league.freeAgents
      .map((player, index) => ({
        player,
        index,
        key: String(player?.id || player?.playerId || player?.name || ""),
        fillScore: getDevRosterFillScore(player, userTeamName),
      }))
      .filter((row) => row.key && !activeKeys.has(row.key) && Number.isFinite(row.fillScore))
      .sort((a, b) => b.fillScore - a.fillScore || a.index - b.index);

    const pickupRow = rankedFreeAgents[0];
    if (!pickupRow) break;

    const [pickup] = league.freeAgents.splice(pickupRow.index, 1);
    if (!pickup) break;

    const signedPlayer = {
      ...pickup,
      team: userTeamName,
      formerTeamName: pickup.formerTeamName || pickup.team || "Free Agent",
      signedWithTeamName: userTeamName,
      contractType: "standard",
      rosterStatus: "standard",
      assignmentStatus: "active",
      contract: buildDevFillerContract(pickup, league),
      rights: {
        ...(pickup.rights || {}),
        heldByTeam: userTeamName,
        restrictedFreeAgent: false,
      },
      qualifyingOffer: null,
      qualifyingOfferEligible: null,
      devSignedForRosterMinimum: true,
      history: {
        ...(pickup.history || {}),
        transactions: [
          ...((pickup.history && Array.isArray(pickup.history.transactions)) ? pickup.history.transactions : []),
          {
            seasonYear: league?.seasonYear || league?.currentSeasonYear || null,
            type: "dev_roster_minimum_signing",
            label: `Signed by ${userTeamName} through dev offseason roster fill`,
            teamName: userTeamName,
          },
        ],
      },
    };

    const signedKey = String(signedPlayer?.id || signedPlayer?.playerId || signedPlayer?.name || "");
    if (signedKey) activeKeys.add(signedKey);

    team.players.push(signedPlayer);
    signedPlayers.push({
      playerId: signedPlayer.id || signedPlayer.playerId || null,
      playerName: signedPlayer.name || signedPlayer.playerName || "Unknown Player",
      overall: getDevReleaseOverall(signedPlayer),
      potential: getDevReleasePotential(signedPlayer),
    });
  }

  return { leagueData: league, releasedPlayers, signedPlayers };
}

function releaseWorstUserPlayersForDev(leagueData, userTeamName) {
  return fixUserRosterForDev(leagueData, userTeamName);
}


// Dev sim intentionally does not force-clear RFA state. In CPU-mode dev sim,
// the selected team is passed to the backend as null, so the normal manual/CPU
// backend path should resolve free agency and RFA matching without any frontend
// decline-first or deadlock-clearing shortcut.

function StatPill({ label, value }) {
  return (
    <div className="px-4 py-3 rounded-xl bg-white/5 border border-white/10">
      <div className="text-xs text-white/50 uppercase tracking-wide">{label}</div>
      <div className="text-lg font-bold text-white mt-1">{value}</div>
    </div>
  );
}

function EventCard({
  step,
  title,
  description,
  status,
  accent = "neutral",
  buttonLabel,
  onClick,
  disabled = false,
}) {
  const outerClass =
    accent === "orange"
      ? "border-orange-500/50 bg-gradient-to-br from-orange-600/20 to-neutral-800"
      : accent === "green"
      ? "border-emerald-500/35 bg-gradient-to-br from-emerald-600/10 to-neutral-800"
      : "border-white/10 bg-neutral-800/85";

  const statusClass =
    status === "Current"
      ? "bg-orange-500/15 text-orange-200 border-orange-400/30"
      : status === "Complete"
      ? "bg-emerald-500/15 text-emerald-200 border-emerald-400/30"
      : "bg-white/5 text-white/60 border-white/10";

  return (
    <div
      className={`rounded-2xl border shadow-2xl p-6 min-h-[250px] flex flex-col justify-between transition ${outerClass} ${
        disabled ? "opacity-70" : "hover:-translate-y-1 hover:border-orange-500/40"
      }`}
    >
      <div>
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="h-12 w-12 rounded-2xl bg-black/25 border border-white/10 flex items-center justify-center text-xl font-extrabold text-orange-400">
            {step}
          </div>

          <div className={`px-3 py-1 rounded-full border text-xs font-semibold ${statusClass}`}>
            {status}
          </div>
        </div>

        <h2 className="text-2xl font-extrabold text-white mb-3">{title}</h2>
        <p className="text-sm leading-6 text-white/70">{description}</p>
      </div>

      <button
        onClick={onClick}
        disabled={disabled}
        className={`mt-6 w-full py-3 rounded-xl font-bold transition ${
          disabled
            ? "bg-neutral-700 text-white/45 cursor-not-allowed"
            : accent === "green"
            ? "bg-emerald-600 hover:bg-emerald-500 text-white"
            : accent === "orange"
            ? "bg-orange-600 hover:bg-orange-500 text-white"
            : "bg-neutral-700 hover:bg-neutral-600 text-white"
        }`}
      >
        {buttonLabel}
      </button>
    </div>
  );
}

export default function OffseasonHub() {
  const navigate = useNavigate();
  const { leagueData, selectedTeam, setLeagueData } = useGame();

  const seasonYear = getSeasonYear(leagueData);
  const champion = getChampionName();
  const [offseasonState, setOffseasonState] = useState(() => readOffseasonState(seasonYear));
  const [devOffseasonRunning, setDevOffseasonRunning] = useState(false);
  const [devOffseasonStatus, setDevOffseasonStatus] = useState("");
  const [devOffseasonTarget, setDevOffseasonTarget] = useState("calendar");
  const [devStopRequested, setDevStopRequested] = useState(false);
  const devStopRequestedRef = useRef(false);

  const persistDevLeagueData = (updated) => {
    if (!updated) return updated;

    const compact = compactLeagueDataForDevStorage(updated);

    saveLeagueData(compact).catch((err) => {
      console.error("[OffseasonHub Dev] IndexedDB compact leagueData save failed. Retrying ultra-light FA state.", err);

      const emergency = {
        ...compact,
        freeAgencyState: compact.freeAgencyState
          ? {
              seasonYear: compact.freeAgencyState.seasonYear,
              isActive: Boolean(compact.freeAgencyState.isActive),
              currentDay: Number(compact.freeAgencyState.currentDay || 0),
              maxDays: Number(compact.freeAgencyState.maxDays || 10),
              offersByPlayer: {},
              dailyLog: [],
              signedPlayersLog: [],
              offerHistory: [],
              userOfferOutcomeLog: [],
              pendingUserDecisions: compact.freeAgencyState.pendingUserDecisions || [],
              pendingRfaMatchDecisions: compact.freeAgencyState.pendingRfaMatchDecisions || [],
              exceptionUsageByTeam: compact.freeAgencyState.exceptionUsageByTeam || {},
              teamNeedProfiles: {},
              pendingUserTeamName: compact.freeAgencyState.pendingUserTeamName || null,
              pendingUserTeamSnapshot: null,
              latestResults: null,
              marketComplete: Boolean(compact.freeAgencyState.marketComplete),
              freeAgencyComplete: Boolean(compact.freeAgencyState.freeAgencyComplete),
              completed: Boolean(compact.freeAgencyState.completed),
              isComplete: Boolean(compact.freeAgencyState.isComplete),
              status: compact.freeAgencyState.status || "not_started",
            }
          : compact.freeAgencyState,
      };

      saveLeagueData(emergency).catch((finalErr) => {
        console.error("[OffseasonHub Dev] Emergency IndexedDB leagueData save failed.", finalErr);
      });
    });

    if (typeof setLeagueData === "function") {
      setLeagueData(updated);
    }

    return updated;
  };

  const updateDevOffseasonState = (patch) => {
    const next = {
      ...readOffseasonState(seasonYear),
      active: true,
      seasonYear,
      ...patch,
    };

    saveOffseasonState(next);
    setOffseasonState(next);
    return next;
  };

  const setDevStatus = (message) => {
    console.log("[OffseasonHub Dev]", message);
    setDevOffseasonStatus(message);
  };

  const requestDevStop = () => {
    devStopRequestedRef.current = true;
    setDevStopRequested(true);
    setDevStatus("Stop requested. Waiting for the current backend step to finish...");
  };

  const assertDevNotStopped = () => {
    if (!devStopRequestedRef.current) return;

    const err = new Error("Dev offseason sim stopped.");
    err.code = DEV_SIM_STOPPED;
    throw err;
  };

  const stopAtDevTarget = (target, step, message, route = null) => {
    if (target !== step) return false;
    setDevStatus(message);
    if (route) navigate(route);
    return true;
  };

  useEffect(() => {
    if (!leagueData || !offseasonState.retirementsComplete) return;
    if (offseasonState.leagueInflationComplete) return;

    const targetFinancialSeasonYear = Number(seasonYear) + 1;
    const inflatedLeague = applyLeagueInflationForOffseason(leagueData, targetFinancialSeasonYear);
    const rules = getLeagueFinancialRules(inflatedLeague, targetFinancialSeasonYear);

    const nextState = {
      ...readOffseasonState(seasonYear),
      active: true,
      seasonYear,
      leagueInflationComplete: true,
      leagueInflationSeasonYear: targetFinancialSeasonYear,
      leagueInflationSummary: {
        seasonYear: targetFinancialSeasonYear,
        inflationIndex: rules.inflationIndex,
        salaryCap: rules.salaryCap,
        luxuryTaxLine: rules.luxuryTaxLine,
        firstApron: rules.firstApron,
        secondApron: rules.secondApron,
        minimumSalary: rules.minimumSalary,
        maxSalary: rules.maxSalary,
      },
    };

    saveOffseasonState(nextState);
    setOffseasonState(nextState);

    if (typeof setLeagueData === "function") {
      setLeagueData(inflatedLeague);
    }

    saveLeagueData(inflatedLeague).catch((err) => {
      console.warn("[OffseasonHub] Failed to save league inflation update.", err);
    });
  }, [leagueData, offseasonState.retirementsComplete, offseasonState.leagueInflationComplete, seasonYear, setLeagueData]);

  const toggleRetirementsDisabled = () => {
    const next = {
      ...readOffseasonState(seasonYear),
      retirementsDisabled: !offseasonState.retirementsDisabled,
    };

    setOffseasonState(next);
    saveOffseasonState(next);
  };

  const handleAdvanceToNewSeason = async () => {
    const progressionCheck = isProgressionReallyCompleteForSeason(seasonYear, leagueData, offseasonState);

    if (!progressionCheck.ok) {
      console.error("[OffseasonHub] Blocked season advance because progression completion is not valid.", progressionCheck);
      alert(
        "Progression did not save cleanly yet. Re-open Player Progression so the player ages and progression save can complete before advancing."
      );

      const nextBlocked = {
        ...offseasonState,
        active: true,
        seasonYear,
        progressionComplete: false,
      };

      setOffseasonState(nextBlocked);
      saveOffseasonState(nextBlocked);

      if (!progressionCheck.metaMatches || progressionCheck.deltaCount <= 0) {
        try {
          localStorage.removeItem(PROG_META_KEY);
        } catch {}
      } else {
        console.warn("[OffseasonHub] Kept progression meta because the marker/deltas exist; block was caused by validation context, not a missing progression run.", progressionCheck);
      }

      navigate("/player-progression");
      return;
    }

    // User roster overfill is allowed into the calendar. Calendar simulation is
    // now the hard gate that forces standard/two-way trimming before games.

    let finalizedLeagueData = getLeagueDataSnapshot(leagueData);

    try {
      if (typeof simEngine.applyRosterFinalization === "function") {
        const result = await simEngine.applyRosterFinalization(finalizedLeagueData, {
          seasonYear,
          userTeamName: getSelectedTeamName(selectedTeam),
        });

        if (!result?.ok) {
          const reason = result?.reason || "Roster finalization failed.";
          console.error("[OffseasonHub] Automatic roster finalization failed.", result);
          alert(reason);
          navigate("/roster-view");
          return;
        }

        finalizedLeagueData = rollDraftPickAssetsForCompletedSeason(result.leagueData || finalizedLeagueData, seasonYear);
        saveLeagueData(finalizedLeagueData).catch((err) => {
          console.warn("[OffseasonHub] Failed to save finalized leagueData to IndexedDB.", err);
        });

        if (typeof setLeagueData === "function") {
          setLeagueData(finalizedLeagueData);
        }
      } else {
        console.warn("[OffseasonHub] applyRosterFinalization is not wired. Advancing without automatic CPU cleanup.");
      }
    } catch (err) {
      console.error("[OffseasonHub] Automatic roster finalization error.", err);
      alert("Automatic roster finalization failed. Check the console, then try again.");
      return;
    }

    finalizedLeagueData = rollDraftPickAssetsForCompletedSeason(finalizedLeagueData, seasonYear);
    saveLeagueData(finalizedLeagueData).catch((err) => {
      console.warn("[OffseasonHub] Failed to save rolled draft assets to IndexedDB.", err);
    });
    if (typeof setLeagueData === "function") {
      setLeagueData(finalizedLeagueData);
    }

    const next = {
      ...offseasonState,
      active: false,
      rosterFinalizationComplete: true,
      progressionComplete: true,
    };

    setOffseasonState(next);
    saveOffseasonState(next);

    navigate("/calendar");
  };

  const runDevRetirements = async (workingLeague, userTeamName) => {
    if (readOffseasonState(seasonYear).retirementsComplete) return workingLeague;

    if (readOffseasonState(seasonYear).retirementsDisabled) {
      const skippedLeague = {
        ...workingLeague,
        seasonYear,
        currentSeasonYear: seasonYear,
        seasonStartYear: seasonYear,
      };

      localStorage.setItem(
        RETIREMENT_RESULTS_KEY,
        JSON.stringify({
          ok: true,
          skipped: true,
          disabled: true,
          seasonYear,
          retiredPlayers: [],
          summary: {
            retiredCount: 0,
            averageAge: 0,
            averageOverall: 0,
            teamsAffected: 0,
          },
        })
      );

      updateDevOffseasonState({
        retirementsComplete: true,
        retirementsSkipped: true,
        retirementsDisabled: true,
      });

      return persistDevLeagueData(skippedLeague);
    }

    if (typeof simEngine.runPlayerRetirements !== "function") {
      throw new Error("runPlayerRetirements is not wired in simEnginePy.js yet.");
    }

    const statsByKey = safeJSON(localStorage.getItem("bm_player_stats_v1"), {}) || {};

    const res = await simEngine.runPlayerRetirements(
      workingLeague,
      statsByKey,
      {},
      {
        seasonYear,
        seed: seasonYear,
      }
    );

    if (!res?.ok || !res?.leagueData) {
      throw new Error(res?.reason || "Retirement run failed.");
    }

    const updated = {
      ...res.leagueData,
      seasonYear,
      currentSeasonYear: seasonYear,
      seasonStartYear: seasonYear,
    };

    localStorage.setItem(
      RETIREMENT_RESULTS_KEY,
      JSON.stringify({
        ok: Boolean(res.ok),
        skipped: Boolean(res.skipped),
        disabled: Boolean(res.disabled),
        seasonYear,
        retiredPlayers: Array.isArray(res.retiredPlayers) ? res.retiredPlayers : [],
        summary: res.summary || {},
      })
    );

    updateDevOffseasonState({ retirementsComplete: true });
    return persistDevLeagueData(updated);
  };

  const runDevLeagueInflation = async (workingLeague) => {
    const targetFinancialSeasonYear = Number(seasonYear) + 1;
    const state = readOffseasonState(seasonYear);

    if (state.leagueInflationComplete && Number(state.leagueInflationSeasonYear || 0) >= targetFinancialSeasonYear) {
      return workingLeague;
    }

    const inflatedLeague = applyLeagueInflationForOffseason(workingLeague, targetFinancialSeasonYear);
    const rules = getLeagueFinancialRules(inflatedLeague, targetFinancialSeasonYear);

    updateDevOffseasonState({
      leagueInflationComplete: true,
      leagueInflationSeasonYear: targetFinancialSeasonYear,
      leagueInflationSummary: {
        seasonYear: targetFinancialSeasonYear,
        inflationIndex: rules.inflationIndex,
        salaryCap: rules.salaryCap,
        luxuryTaxLine: rules.luxuryTaxLine,
        firstApron: rules.firstApron,
        secondApron: rules.secondApron,
        minimumSalary: rules.minimumSalary,
        maxSalary: rules.maxSalary,
      },
    });

    return persistDevLeagueData(inflatedLeague);
  };

  const runDevDraftLottery = async (workingLeague) => {
    if (readOffseasonState(seasonYear).draftLotteryComplete) return workingLeague;

    if (typeof simEngine.runDraftLottery !== "function") {
      throw new Error("runDraftLottery is not wired in simEnginePy.js yet.");
    }

    const teamRecords = getTeamRecordsForDevLottery(workingLeague, seasonYear);

    if (!Array.isArray(teamRecords) || teamRecords.length < 30) {
      throw new Error(
        `NO_USABLE_TEAM_RECORDS_FOR_DEV_LOTTERY: found ${teamRecords?.length || 0}. ` +
        `The ${seasonYear} draft needs the previous completed season standings.`
      );
    }

    const lotterySystem = Number(seasonYear) >= 2027 ? "three_two_one" : "legacy_14";

    const payload = await simEngine.runDraftLottery(workingLeague, {
      seasonYear,
      teamRecords,
      lotterySystem: "auto",
      forceLotterySystem: "auto",
      seed: `${seasonYear}_${lotterySystem}_dev_full_offseason_${Date.now()}`,
    });

    if (!payload?.ok) {
      throw new Error(payload?.reason || "Draft lottery failed.");
    }

    const nextLotteryState = {
      seasonYear,
      generatedAt: new Date().toISOString(),
      lotterySystem: payload?.meta?.system || payload?.meta?.autoResolvedSystem || lotterySystem,
      requestedLotterySystem: "auto",
      secondRoundRevealed: true,
      firstRoundRevealed: true,
      result: payload,
    };

    const updatedLeague = {
      ...(workingLeague || {}),
      draftState: {
        ...(workingLeague?.draftState || {}),
        seasonYear,
        lottery: payload,
        draftOrder: payload?.fullDraftOrder || [],
        draftLotteryComplete: true,
      },
    };

    localStorage.setItem(DRAFT_LOTTERY_KEY, JSON.stringify(nextLotteryState));
    updateDevOffseasonState({ draftLotteryComplete: true });
    return persistDevLeagueData(updatedLeague);
  };

  const runDevDraft = async (workingLeague, userTeamName) => {
    if (readOffseasonState(seasonYear).draftComplete) return workingLeague;

    const backendUserTeamName = getDevBackendUserTeamName(userTeamName);

    if (typeof simEngine.initializeDraft !== "function" || typeof simEngine.simRestOfDraft !== "function") {
      throw new Error("Draft backend is not fully wired in simEnginePy.js yet.");
    }

    const lotteryState = safeJSON(localStorage.getItem(DRAFT_LOTTERY_KEY), null);
    const draftOrder =
      lotteryState?.result?.fullDraftOrder ||
      workingLeague?.draftState?.draftOrder ||
      workingLeague?.draftState?.lottery?.fullDraftOrder ||
      [];

    if (!Array.isArray(draftOrder) || !draftOrder.length) {
      throw new Error("Draft order is missing after lottery.");
    }

    const customSetup = readCustomDraftClassSetupForYear(seasonYear);
    if (customSetup.mode === "custom" && !customSetup.draftClassPayload?.draftClass?.length) {
      throw new Error(`Custom draft class mode is selected for ${seasonYear}, but no custom class is loaded.`);
    }

    const draftPayload = {
      seasonYear,
      userTeamName: backendUserTeamName,
      devTreatUserTeamAsCpu: DEV_SIM_TREAT_SELECTED_TEAM_AS_CPU,
      originalUserTeamName: userTeamName || null,
      draftOrder,
    };

    if (customSetup.draftClassPayload?.draftClass?.length) {
      draftPayload.draftClass = customSetup.draftClassPayload.draftClass;
      draftPayload.classType = "custom";
    }

    const init = await simEngine.initializeDraft(workingLeague, draftPayload);

    if (!init?.ok) {
      throw new Error(init?.reason || "Draft initialization failed.");
    }

    const initializedLeague = init.leagueData || workingLeague;
    const initializedDraftState = init.draftState;

    const finished = await simEngine.simRestOfDraft(initializedLeague, {
      seasonYear,
      userTeamName: backendUserTeamName,
      devTreatUserTeamAsCpu: DEV_SIM_TREAT_SELECTED_TEAM_AS_CPU,
      originalUserTeamName: userTeamName || null,
      draftState: initializedDraftState,
    });

    if (!finished?.ok) {
      throw new Error(finished?.reason || "Draft simulation failed.");
    }

    const nextLeague = rollDraftPickAssetsForCompletedSeason(finished.leagueData || initializedLeague, seasonYear);
    const nextDraftState = finished.draftState || initializedDraftState;

    if (nextDraftState) {
      localStorage.setItem(DRAFT_STATE_KEY, JSON.stringify(nextDraftState));
    }

    updateDevOffseasonState({ draftComplete: true });
    return persistDevLeagueData(nextLeague);
  };

  const runDevRookieSignings = async (workingLeague, userTeamName) => {
    if (readOffseasonState(seasonYear).rookieSigningsComplete) return workingLeague;

    if (typeof simEngine.previewRookieSignings !== "function" || typeof simEngine.applyRookieSignings !== "function") {
      throw new Error("Rookie signing backend is not fully wired in simEnginePy.js yet.");
    }

    const backendUserTeamName = getDevBackendUserTeamName(userTeamName);

    const preview = await simEngine.previewRookieSignings(workingLeague, {
      seasonYear,
      userTeamName: backendUserTeamName,
      devTreatUserTeamAsCpu: DEV_SIM_TREAT_SELECTED_TEAM_AS_CPU,
      originalUserTeamName: userTeamName || null,
    });

    if (!preview?.ok) {
      throw new Error(preview?.reason || "Failed to preview rookie signings.");
    }

    const previewLeague = preview.leagueData || workingLeague;
    const decisionRows = DEV_SIM_TREAT_SELECTED_TEAM_AS_CPU
      ? preview.pendingRookies || []
      : preview.userPendingRookies || [];
    const decisions = buildAutoRookieDecisions(decisionRows);

    const result = await simEngine.applyRookieSignings(previewLeague, {
      seasonYear,
      userTeamName: backendUserTeamName,
      devTreatUserTeamAsCpu: DEV_SIM_TREAT_SELECTED_TEAM_AS_CPU,
      originalUserTeamName: userTeamName || null,
      decisions,
    });

    if (!result?.ok) {
      throw new Error(result?.reason || "Failed to apply rookie signings.");
    }

    updateDevOffseasonState({ rookieSigningsComplete: true });
    return persistDevLeagueData(result.leagueData || previewLeague);
  };

  const runDevOptionsAndRights = async (workingLeague, userTeamName) => {
    const currentOffseasonState = readOffseasonState(seasonYear);
    const unresolvedPreFreeAgencyContracts = hasUnresolvedPreFreeAgencyContracts(workingLeague, seasonYear);
    const backendUserTeamName = getDevBackendUserTeamName(userTeamName);

    if (
      currentOffseasonState.optionsComplete &&
      currentOffseasonState.rightsManagementComplete &&
      !unresolvedPreFreeAgencyContracts
    ) {
      return workingLeague;
    }

    if (typeof simEngine.previewOffseasonContracts !== "function" || typeof simEngine.applyOffseasonContractDecisions !== "function") {
      throw new Error("Option backend is not fully wired in simEnginePy.js yet.");
    }

    const preview = await simEngine.previewOffseasonContracts(workingLeague, backendUserTeamName);

    if (!preview?.ok) {
      throw new Error(preview?.reason || "Failed to preview player/team options.");
    }

    const previewLeague = preview.leagueData || workingLeague;
    const optionRowsForDev = [
      ...(preview.pendingUserTeamOptions || []),
      ...(preview.teamOptions || []),
      ...(preview.pendingTeamOptions || []),
      ...(preview.cpuTeamOptions || []),
      ...(preview.pendingCpuTeamOptions || []),
      ...(preview.expiredContracts || []),
    ];
    const decisions = buildAutoTeamOptionDecisions(optionRowsForDev);

    const applied = await simEngine.applyOffseasonContractDecisions(
      previewLeague,
      backendUserTeamName,
      decisions
    );

    if (!applied?.ok || !applied?.leagueData) {
      throw new Error(applied?.reason || "Failed to apply option decisions.");
    }

    let nextLeague = applied.leagueData;

    localStorage.setItem(
      OPTIONS_RESULTS_KEY,
      JSON.stringify({
        seasonYear,
        preview: {
          ok: true,
          seasonYear: preview?.seasonYear || seasonYear,
          summary: preview?.summary || {},
        },
        applied: {
          ok: true,
          summary: applied?.summary || {},
          decisionLog: applied?.decisionLog || [],
        },
      })
    );

    updateDevOffseasonState({
      optionsComplete: true,
      rightsManagementComplete: false,
      preFreeAgencyResolved: false,
      freeAgencyComplete: false,
      progressionComplete: false,
    });

    if (!DEV_SIM_TREAT_SELECTED_TEAM_AS_CPU && backendUserTeamName && typeof simEngine.previewRightsManagement === "function" && typeof simEngine.applyRightsManagement === "function") {
      const rightsPreview = await simEngine.previewRightsManagement(nextLeague, backendUserTeamName);

      if (rightsPreview?.ok) {
        const rightsRows = rightsPreview?.rightsRows || rightsPreview?.rows || rightsPreview?.teamSnapshot?.capHoldRows || [];
        const rightsDecisions = buildAutoRightsDecisions(Array.isArray(rightsRows) ? rightsRows : []);

        const rightsApplied = await simEngine.applyRightsManagement(nextLeague, backendUserTeamName, rightsDecisions);

        if (!rightsApplied?.ok || !rightsApplied?.leagueData) {
          throw new Error(rightsApplied?.reason || "Failed to apply rights management.");
        }

        nextLeague = rightsApplied.leagueData;
      }
    }

    updateDevOffseasonState({
      optionsComplete: true,
      rightsManagementComplete: true,
      preFreeAgencyResolved: true,
      freeAgencyComplete: false,
      progressionComplete: false,
    });

    return persistDevLeagueData(nextLeague);
  };

  const runDevFreeAgencyStart = async (workingLeague, userTeamName) => {
    if (readOffseasonState(seasonYear).freeAgencyComplete) return workingLeague;

    const backendUserTeamName = getDevBackendUserTeamName(userTeamName);

    if (typeof simEngine.initializeFreeAgencyPeriod !== "function") {
      throw new Error("Free agency backend is not fully wired in simEnginePy.js yet.");
    }

    let nextLeague = workingLeague;
    const state = nextLeague?.freeAgencyState || {};
    const alreadyStarted = Boolean(
      state?.isActive ||
        Number(state?.currentDay || 0) > 0 ||
        (Array.isArray(state?.dailyLog) && state.dailyLog.length > 0) ||
        (Array.isArray(state?.offerHistory) && state.offerHistory.length > 0) ||
        state?.latestResults
    );

    if (!alreadyStarted) {
      const leagueForInit = {
        ...nextLeague,
        freeAgencyState: buildCleanFreeAgencyStateForDev(seasonYear, backendUserTeamName, 10, userTeamName || null),
      };

      persistDevLeagueData(leagueForInit);

      const init = await simEngine.initializeFreeAgencyPeriod(
        leagueForInit,
        backendUserTeamName,
        10
      );

      if (!init?.ok || !init?.leagueData) {
        throw new Error(init?.reason || "Failed to start free agency.");
      }

      nextLeague = init.leagueData;
    }

    updateDevOffseasonState({
      optionsComplete: true,
      rightsManagementComplete: true,
      preFreeAgencyResolved: true,
      freeAgencyComplete: false,
    });

    localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/free-agents");
    return persistDevLeagueData(nextLeague);
  };

  const runDevFreeAgencyToEnd = async (workingLeague, userTeamName) => {
    if (readOffseasonState(seasonYear).freeAgencyComplete) return workingLeague;

    const backendUserTeamName = getDevBackendUserTeamName(userTeamName);

    if (typeof simEngine.initializeFreeAgencyPeriod !== "function" || typeof simEngine.advanceFreeAgencyDay !== "function") {
      throw new Error("Free agency backend is not fully wired in simEnginePy.js yet.");
    }

    let nextLeague = workingLeague;
    const startState = nextLeague?.freeAgencyState || {};
    const alreadyStarted = Boolean(
      startState?.isActive ||
        Number(startState?.currentDay || 0) > 0 ||
        (Array.isArray(startState?.dailyLog) && startState.dailyLog.length > 0) ||
        (Array.isArray(startState?.offerHistory) && startState.offerHistory.length > 0)
    );

    if (!alreadyStarted) {
      const leagueForInit = {
        ...nextLeague,
        freeAgencyState: buildCleanFreeAgencyStateForDev(seasonYear, backendUserTeamName, 10, userTeamName || null),
      };

      persistDevLeagueData(leagueForInit);

      const init = await simEngine.initializeFreeAgencyPeriod(
        leagueForInit,
        backendUserTeamName,
        10
      );

      if (!init?.ok || !init?.leagueData) {
        throw new Error(init?.reason || "Failed to start free agency.");
      }

      nextLeague = init.leagueData;
      persistDevLeagueData(nextLeague);
    }

    const safetyLimit = Number(nextLeague?.freeAgencyState?.maxDays || 10) + 10;

    for (let step = 0; step < safetyLimit; step += 1) {
      assertDevNotStopped();
      const state = nextLeague?.freeAgencyState || {};
      const pendingRfa = Array.isArray(state.pendingRfaMatchDecisions) ? state.pendingRfaMatchDecisions : [];
      const pendingUser = Array.isArray(state.pendingUserDecisions) ? state.pendingUserDecisions : [];

      if (pendingRfa.length > 0 || pendingUser.length > 0) {
        throw new Error(
          `DEV_SIM_PENDING_MANUAL_DECISIONS: backend produced ${pendingUser.length} pending user signing decision(s) and ${pendingRfa.length} pending RFA match decision(s). Dev sim is supposed to run the same backend path as manual FA with the selected team treated as CPU, so this is a real backend/wiring problem instead of something the frontend should auto-decline or force-clear.`
        );
      }

      const completeFlag = Boolean(
        state?.marketComplete ||
          state?.freeAgencyComplete ||
          state?.completed ||
          state?.isComplete ||
          state?.status === "complete"
      );
      const currentDay = Number(state?.currentDay || 0);
      const maxDays = Number(state?.maxDays || 0);

      if (!state?.isActive || completeFlag) {
        break;
      }

      if (maxDays > 0 && currentDay > maxDays) {
        throw new Error(
          `DEV_SIM_FREE_AGENCY_DAY_OVERFLOW: currentDay=${currentDay} maxDays=${maxDays}.`
        );
      }

      const advance = await simEngine.advanceFreeAgencyDay(nextLeague, backendUserTeamName);

      if (!advance?.ok || !advance?.leagueData) {
        throw new Error(advance?.reason || "Failed to advance free agency day.");
      }

      nextLeague = advance.leagueData;
      persistDevLeagueData(nextLeague);
    }

    const finalState = nextLeague?.freeAgencyState || {};
    const finalPendingRfa = Array.isArray(finalState.pendingRfaMatchDecisions) ? finalState.pendingRfaMatchDecisions : [];
    const finalPendingUser = Array.isArray(finalState.pendingUserDecisions) ? finalState.pendingUserDecisions : [];
    const finalCompleteFlag = Boolean(
      finalState?.marketComplete ||
        finalState?.freeAgencyComplete ||
        finalState?.completed ||
        finalState?.isComplete ||
        finalState?.status === "complete"
    );

    if (finalPendingRfa.length > 0 || finalPendingUser.length > 0) {
      throw new Error(
        `DEV_SIM_FREE_AGENCY_LEFT_PENDING_DECISIONS: ${finalPendingUser.length} pending user signing decision(s), ${finalPendingRfa.length} pending RFA match decision(s).`
      );
    }

    if (!finalCompleteFlag) {
      throw new Error(
        `DEV_SIM_FREE_AGENCY_DID_NOT_COMPLETE: stopped before backend marked FA complete. isActive=${Boolean(finalState?.isActive)} currentDay=${Number(finalState?.currentDay || 0)} maxDays=${Number(finalState?.maxDays || 0)}.`
      );
    }

    updateDevOffseasonState({
      optionsComplete: true,
      rightsManagementComplete: true,
      preFreeAgencyResolved: true,
      freeAgencyComplete: true,
    });

    localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/viewing-offers");
    return persistDevLeagueData(nextLeague);
  };

  const runDevTrimUserRoster = async (workingLeague, userTeamName) => {
    const result = releaseWorstUserPlayersForDev(workingLeague, userTeamName);
    const releasedPlayers = result.releasedPlayers || [];
    const signedPlayers = result.signedPlayers || [];

    if (!releasedPlayers.length && !signedPlayers.length) {
      return workingLeague;
    }

    const messages = [];
    if (releasedPlayers.length) {
      const releasedNames = releasedPlayers.map((row) => row.playerName).join(", ");
      messages.push(`released ${releasedPlayers.length} player(s): ${releasedNames}`);
    }

    if (signedPlayers.length) {
      const signedNames = signedPlayers.map((row) => row.playerName).join(", ");
      messages.push(`signed ${signedPlayers.length} filler player(s): ${signedNames}`);
    }

    setDevStatus(`Fixed user roster legality: ${messages.join("; ")}`);

    return persistDevLeagueData(result.leagueData || workingLeague);
  };

  const runDevProgression = async (workingLeague) => {
    if (readOffseasonState(seasonYear).progressionComplete) return workingLeague;

    if (typeof simEngine.computePlayerProgression !== "function") {
      throw new Error("computePlayerProgression is not wired in simEnginePy.js yet.");
    }

    // Match the manual PlayerProgression page exactly: normalize derived
    // ratings before the snapshot, then build visible deltas from the final
    // post-recompute league. This prevents dev/full-offseason from saving
    // Python-bumped OFF/DEF/STAM while manual progression saves V19 values.
    const sourceLeague = recomputeDerivedRatingsInLeague(snapshotLeague(workingLeague));
    const beforeSnapshot = snapshotLeague(sourceLeague);
    const leagueForProg = prepareLeagueForProgressionWorker(sourceLeague, seasonYear);

    leagueForProg.seasonYear = seasonYear;
    leagueForProg.currentSeasonYear = seasonYear;
    leagueForProg.seasonStartYear = seasonYear;

    const statsByKey = loadStatsByKeyFromStorage();

    localStorage.setItem(
      PROG_META_KEY,
      JSON.stringify({
        appliedForSeasonYear: "INFLIGHT",
        ts: Date.now(),
        seasonYear,
        runId: `dev_full_offseason_${Date.now()}`,
      })
    );

    const msg = await simEngine.computePlayerProgression(leagueForProg, statsByKey, {
      seed: seasonYear,
      seasonYear,
    });

    const res = msg?.league ? msg : msg?.payload;

    if (!res || !res.league) {
      throw new Error("Progression returned no league. Check worker response shape.");
    }

    let updatedLeague = restoreTwoWayBucketsAfterProgression(res.league, beforeSnapshot);

    updatedLeague.seasonYear = seasonYear;
    updatedLeague.currentSeasonYear = seasonYear;
    updatedLeague.seasonStartYear = seasonYear;

    updatedLeague = stampAgingGuards(updatedLeague, seasonYear);
    updatedLeague = stampCareerSeasonCounters(updatedLeague, seasonYear);

    // FORCE the same LeagueEditor/V19 derived-rating formulas used by the
    // manual PlayerProgression page. Python owns attrs/OVR/POT/age; frontend
    // V19 owns OFF/DEF/STAM/SCO display values.
    updatedLeague = recomputeDerivedRatingsInLeague(updatedLeague);

    updatedLeague = restoreCurrentDraftClassRookiesAfterProgression(updatedLeague, beforeSnapshot, seasonYear);

    const newDeltas = buildProgressionDeltas(beforeSnapshot, updatedLeague);
    const deltaCount = Object.keys(newDeltas || {}).length;

    if (deltaCount === 0) {
      throw new Error(`Progression returned zero deltas for ${seasonYear}. Refusing to advance.`);
    }

    const statKeysToClear = [
      "bm_player_stats_v1",
      "bm_season_player_stats_v1",
      "playerStatsByKey",
      "statsByKey",
    ];

    for (const store of [localStorage, sessionStorage]) {
      for (const key of statKeysToClear) {
        try {
          store.removeItem(key);
        } catch {}
      }
    }

    localStorage.setItem(PROG_DELTAS_KEY, JSON.stringify(newDeltas));
    persistDevLeagueData(updatedLeague);

    const ageAudit = getProgressionAgeCompletionAudit(updatedLeague, seasonYear);
    if (!ageAudit.ok) {
      localStorage.setItem(
        PROG_META_KEY,
        JSON.stringify({
          appliedForSeasonYear: "ERROR",
          ts: Date.now(),
          seasonYear,
          error: `Saved leagueData failed age validation. staleCount=${ageAudit.staleCount}`,
        })
      );
      throw new Error(`Progression age validation failed. staleCount=${ageAudit.staleCount}`);
    }

    localStorage.setItem(
      PROG_META_KEY,
      JSON.stringify({
        appliedForSeasonYear: seasonYear,
        ts: Date.now(),
        deltaCount,
        seasonYear,
        deltasSaved: true,
        stage: "DONE",
      })
    );

    updateDevOffseasonState({
      progressionComplete: true,
    });

    return updatedLeague;
  };

  const runDevRosterFinalization = async (workingLeague, userTeamName) => {
    if (typeof simEngine.applyRosterFinalization !== "function") {
      return workingLeague;
    }

    const backendUserTeamName = getDevBackendUserTeamName(userTeamName);

    const result = await simEngine.applyRosterFinalization(workingLeague, {
      seasonYear,
      userTeamName: backendUserTeamName,
      devTreatUserTeamAsCpu: DEV_SIM_TREAT_SELECTED_TEAM_AS_CPU,
      originalUserTeamName: userTeamName || null,
    });

    if (!result?.ok) {
      throw new Error(result?.reason || "Roster finalization failed.");
    }

    updateDevOffseasonState({ rosterFinalizationComplete: true });
    return persistDevLeagueData(result.leagueData || workingLeague);
  };

  const finalizeDevAdvanceToCalendar = (workingLeague) => {
    const nextState = {
      ...readOffseasonState(seasonYear),
      active: false,
      seasonYear,
      retirementsComplete: true,
      leagueInflationComplete: true,
      leagueInflationSeasonYear: Number(seasonYear) + 1,
      draftLotteryComplete: true,
      draftComplete: true,
      rookieSigningsComplete: true,
      optionsComplete: true,
      rightsManagementComplete: true,
      preFreeAgencyResolved: true,
      freeAgencyComplete: true,
      rosterFinalizationComplete: true,
      progressionComplete: true,
    };

    saveOffseasonState(nextState);
    setOffseasonState(nextState);
    persistDevLeagueData(workingLeague);
    navigate("/calendar");
  };

  const handleDevSimFullOffseason = async () => {
    if (devOffseasonRunning) return;

    const target = devOffseasonTarget || "calendar";
    const targetLabel = getDevSimTargetLabel(target);

    if (!window.confirm(`Dev sim until ${targetLabel}? This will automatically run each needed offseason step until that point.`)) {
      return;
    }

    try {
      setDevOffseasonRunning(true);
      setDevOffseasonStatus("");
      setDevStopRequested(false);
      devStopRequestedRef.current = false;

      const userTeamName = getSelectedTeamName(selectedTeam);
      let workingLeague = getLeagueDataSnapshot(leagueData);

      if (DEV_SIM_TREAT_SELECTED_TEAM_AS_CPU && userTeamName) {
        setDevStatus(`Dev CPU mode active: ${userTeamName} will be controlled by CPU logic for draft, options, rookie/stash decisions, free agency, RFA matching, and roster finalization.`);
      }

      if (!workingLeague || !Object.keys(workingLeague || {}).length) {
        throw new Error("No league data found.");
      }

      setDevStatus("Running retirements...");
      workingLeague = await runDevRetirements(workingLeague, userTeamName);
      assertDevNotStopped();
      if (stopAtDevTarget(target, "retirements", "Stopped after retirements.")) return;

      setDevStatus("Applying league financial inflation...");
      workingLeague = await runDevLeagueInflation(workingLeague);
      assertDevNotStopped();

      setDevStatus("Running draft lottery...");
      workingLeague = await runDevDraftLottery(workingLeague);
      assertDevNotStopped();
      if (stopAtDevTarget(target, "lottery", "Stopped after draft lottery.")) return;

      setDevStatus(DEV_SIM_TREAT_SELECTED_TEAM_AS_CPU ? "Simulating NBA Draft with selected team as CPU..." : "Simulating NBA Draft...");
      workingLeague = await runDevDraft(workingLeague, userTeamName);
      assertDevNotStopped();
      if (stopAtDevTarget(target, "draft", "Stopped after the NBA Draft.")) return;

      setDevStatus(DEV_SIM_TREAT_SELECTED_TEAM_AS_CPU ? "Resolving rookie/stash signings with selected team as CPU..." : "Resolving rookie signings...");
      workingLeague = await runDevRookieSignings(workingLeague, userTeamName);
      assertDevNotStopped();
      if (stopAtDevTarget(target, "rookie_signings", "Stopped after rookie signings.")) return;

      setDevStatus(DEV_SIM_TREAT_SELECTED_TEAM_AS_CPU ? "Resolving options, two-way, stash, and rights with selected team as CPU..." : "Resolving player/team options and rights...");
      workingLeague = await runDevOptionsAndRights(workingLeague, userTeamName);
      assertDevNotStopped();
      if (stopAtDevTarget(target, "options", "Stopped after options and rights.")) return;

      if (target === "free_agency_start") {
        setDevStatus("Opening free agency...");
        workingLeague = await runDevFreeAgencyStart(workingLeague, userTeamName);
        assertDevNotStopped();
        stopAtDevTarget(target, "free_agency_start", "Free agency is open.", "/free-agents");
        return;
      }

      setDevStatus(DEV_SIM_TREAT_SELECTED_TEAM_AS_CPU ? "Simulating free agency to the end with selected team as CPU..." : "Simulating free agency to the end...");
      workingLeague = await runDevFreeAgencyToEnd(workingLeague, userTeamName);
      assertDevNotStopped();
      if (stopAtDevTarget(target, "free_agency_complete", "Stopped after free agency completed.")) return;

      if (!DEV_SIM_TREAT_SELECTED_TEAM_AS_CPU) {
        setDevStatus("Fixing user roster legality if needed...");
        workingLeague = await runDevTrimUserRoster(workingLeague, userTeamName);
        assertDevNotStopped();
      }

      setDevStatus(DEV_SIM_TREAT_SELECTED_TEAM_AS_CPU ? "Finalizing all rosters with selected team as CPU..." : "Finalizing rosters...");
      workingLeague = await runDevRosterFinalization(workingLeague, userTeamName);
      assertDevNotStopped();

      if (!DEV_SIM_TREAT_SELECTED_TEAM_AS_CPU) {
        setDevStatus("Re-checking user roster legality...");
        workingLeague = await runDevTrimUserRoster(workingLeague, userTeamName);
        assertDevNotStopped();
      }
      if (stopAtDevTarget(target, "roster_ready", "Stopped after roster cleanup.")) return;

      setDevStatus("Running player progression...");
      workingLeague = await runDevProgression(workingLeague);
      assertDevNotStopped();
      if (stopAtDevTarget(target, "progression", "Stopped after player progression.")) return;

      setDevStatus("Advancing to calendar...");
      finalizeDevAdvanceToCalendar(workingLeague);
    } catch (err) {
      if (err?.code === DEV_SIM_STOPPED) {
        console.warn("[OffseasonHub Dev] Full offseason sim stopped by user.");
        setDevOffseasonStatus("Stopped after the current backend step finished.");
        return;
      }

      if (err?.code === DEV_SIM_PAUSED) {
        console.warn("[OffseasonHub Dev] Full offseason sim paused for manual resolution.", err);
        setDevOffseasonStatus(err?.message || "Dev sim paused for manual resolution.");
        return;
      }

      console.error("[OffseasonHub Dev] Full offseason sim failed", err);
      alert(err?.message || "Dev full offseason sim failed. Check the console.");
      setDevOffseasonStatus(err?.message || "Dev full offseason sim failed.");
    } finally {
      setDevOffseasonRunning(false);
      setDevStopRequested(false);
      devStopRequestedRef.current = false;
    }
  };

  useEffect(() => {
    const next = readOffseasonState(seasonYear);

    if (hasStaleFreeAgencyComplete(leagueData, next)) {
      next.freeAgencyComplete = false;
      next.rosterFinalizationComplete = false;
    }

    if (!isFreeAgencyStateCurrentForOffseason(leagueData, next)) {
      localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/free-agents");
    }

    setOffseasonState(next);
    saveOffseasonState(next);
  }, [seasonYear, leagueData]);

  const retirementResults = useMemo(() => {
    return safeJSON(localStorage.getItem("bm_retirement_results_v1"), null);
  }, []);

  const retiredCount = retirementResults?.summary?.retiredCount || 0;

  const rosterStatus = useMemo(() => {
    return getRosterStatus(leagueData, selectedTeam);
  }, [leagueData, selectedTeam]);

  const rosterWarningBeforeSim = rosterStatus.hasTeam && !rosterStatus.isValid;

  const currentStepLabel = useMemo(() => {
    if (offseasonState.progressionComplete) return "Start";
    if (offseasonState.freeAgencyComplete) return "Progression";
    if (offseasonState.optionsComplete) return "Free Agency";
    if (offseasonState.rookieSigningsComplete) return "Options";
    if (offseasonState.draftComplete) return "Rookie Signings";
    if (offseasonState.draftLotteryComplete) return "Draft";
    if (offseasonState.retirementsComplete) return offseasonState.leagueInflationComplete ? "Lottery" : "Apply Inflation";
    return "Retirements";
  }, [offseasonState]);

  const cards = useMemo(() => {
    const retirementsComplete = !!offseasonState.retirementsComplete;
    const leagueInflationComplete = !!offseasonState.leagueInflationComplete;
    const draftLotteryComplete = !!offseasonState.draftLotteryComplete;
    const draftComplete = !!offseasonState.draftComplete;
    const rookieSigningsComplete = !!offseasonState.rookieSigningsComplete;
    const optionsComplete = !!offseasonState.optionsComplete;
    const freeAgencyComplete =
      !!offseasonState.freeAgencyComplete &&
      !hasStaleFreeAgencyComplete(leagueData, offseasonState);
    const progressionComplete = !!offseasonState.progressionComplete;
    const freeAgencyReadyForProgression = freeAgencyComplete;

    return [
      {
        step: "1",
        title: "Player Retirements",
        description: offseasonState.retirementsDisabled
          ? "Retirements are disabled for this save, so veteran players will remain active and the offseason will continue without removing anyone."
          : "Run retirement logic, remove retired veterans from active rosters, and store them in league history before the draft process begins.",
        status: retirementsComplete ? "Complete" : "Current",
        accent: retirementsComplete ? "green" : "orange",
        buttonLabel: retirementsComplete ? "View Results" : "Open Retirements",
        disabled: false,
        onClick: () => navigate("/player-retirements"),
      },
      {
        step: "2",
        title: "Draft Lottery",
        description:
          "Review the lottery odds and draft matrix, reveal the first round, then reveal the second round to lock the full draft order.",
        status: draftLotteryComplete ? "Complete" : leagueInflationComplete ? "Current" : retirementsComplete ? "Preparing" : "Locked",
        accent: draftLotteryComplete ? "green" : leagueInflationComplete ? "orange" : retirementsComplete ? "orange" : "neutral",
        buttonLabel: leagueInflationComplete ? "Open Draft Lottery" : retirementsComplete ? "Applying Inflation..." : "Locked",
        disabled: !leagueInflationComplete,
        onClick: () => navigate("/draft-lottery"),
      },
      {
        step: "3",
        title: "NBA Draft",
        description:
          "Use your locked draft order and draft class to make picks. Sim CPU picks one at a time, sim to your pick, or run the rest of the draft.",
        status: draftComplete ? "Complete" : draftLotteryComplete ? "Current" : "Locked",
        accent: draftComplete ? "green" : draftLotteryComplete ? "orange" : "neutral",
        buttonLabel: draftLotteryComplete ? "Open Draft" : "Locked",
        disabled: !draftLotteryComplete,
        onClick: () => navigate("/draft"),
      },
      {
        step: "4",
        title: "Rookie Signings",
        description:
          "Finalize rookie contracts after the draft. First-rounders are handled as rookie-scale deals, while second-round picks can become standard contracts, two-way players, or free agents.",
        status: rookieSigningsComplete ? "Complete" : draftComplete ? "Current" : "Locked",
        accent: rookieSigningsComplete ? "green" : draftComplete ? "orange" : "neutral",
        buttonLabel: draftComplete ? "Open Rookie Signings" : "Locked",
        disabled: !draftComplete,
        onClick: () => navigate("/rookie-signings"),
      },
      {
        step: "5",
        title: "Player / Team Options",
        description:
          "Resolve player options and team options after rookie signings so every contract decision is settled before free agency begins.",
        status: optionsComplete ? "Complete" : rookieSigningsComplete ? "Current" : "Locked",
        accent: optionsComplete ? "green" : rookieSigningsComplete ? "orange" : "neutral",
        buttonLabel: rookieSigningsComplete ? "Open Options" : "Locked",
        disabled: !rookieSigningsComplete,
        onClick: () => navigate("/player-team-options"),
      },
      {
        step: "6",
        title: "Free Agency",
        description:
          "Negotiate with available players and reshape your roster once draft, rookie signing, and option decisions are settled.",
        status: freeAgencyComplete ? "Complete" : optionsComplete ? "Current" : "Locked",
        accent: freeAgencyComplete ? "green" : optionsComplete ? "orange" : "neutral",
        buttonLabel: optionsComplete ? "Open Free Agency" : "Locked",
        disabled: !optionsComplete,
        onClick: () => navigate(getFreeAgencyResumeRoute(leagueData, offseasonState)),
      },
      {
        step: "7",
        title: "Player Progression",
        description: rosterWarningBeforeSim
          ? "Apply offseason development now if you want. Your roster can stay overfilled until Calendar simulation, where you will be prompted to trim it."
          : "Apply offseason development once roster moves are finished so your updated squads grow into the next year together.",
        status: progressionComplete ? "Complete" : freeAgencyReadyForProgression ? "Current" : "Locked",
        accent: progressionComplete ? "green" : freeAgencyReadyForProgression ? "orange" : "neutral",
        buttonLabel: freeAgencyReadyForProgression ? "Open Progression" : "Locked",
        disabled: !freeAgencyReadyForProgression,
        onClick: () => navigate("/player-progression"),
      },
      {
        step: "8",
        title: "Advance to New Season",
        description:
          "Finalize the offseason, automatically clean up CPU rosters, and begin the new season once retirements, draft, rookie signings, options, free agency, and progression are all complete.",
        status: progressionComplete ? "Current" : "Locked",
        accent: progressionComplete ? "orange" : "neutral",
        buttonLabel: progressionComplete ? "Advance to New Season" : "Locked",
        disabled: !progressionComplete,
        onClick: handleAdvanceToNewSeason,
      },
    ];
  }, [navigate, offseasonState, leagueData, rosterWarningBeforeSim]);

  return (
    <div className={`${styles.offseasonPage} min-h-screen text-white py-10 px-4`}>
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <p className="text-sm text-white/45 tracking-[0.25em] uppercase mb-3">
            Basketball Manager
          </p>
          <h1 className="text-5xl font-extrabold text-orange-500 tracking-tight">
            OFFSEASON HUB
          </h1>
          <p className="text-white/60 mt-3 text-base">
            Move through each offseason stage one event at a time.
          </p>
        </div>

        <div className="bg-neutral-800/85 border border-white/10 rounded-3xl shadow-2xl p-6 md:p-7 mb-8">
          {rosterWarningBeforeSim && (
            <div className="mb-5 rounded-2xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm font-semibold text-orange-100">
              {rosterStatus.message} This will not block offseason steps, but it will block game simulation until fixed.
            </div>
          )}

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-white/40 mb-2">
                Offseason Overview
              </p>
              <h2 className="text-3xl font-extrabold text-white">
                {seasonYear} Offseason
              </h2>
              <p className="text-white/60 mt-2">
                {champion ? `Champions: ${champion}` : "Championship complete."}
                {selectedTeam?.name ? ` Your team: ${selectedTeam.name}.` : ""}
              </p>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  onClick={toggleRetirementsDisabled}
                  disabled={devOffseasonRunning}
                  className={`px-4 py-2 rounded-xl font-semibold transition ${
                    devOffseasonRunning
                      ? "bg-neutral-700 text-white/45 cursor-not-allowed"
                      : offseasonState.retirementsDisabled
                      ? "bg-emerald-700 hover:bg-emerald-600 text-white"
                      : "bg-neutral-700 hover:bg-neutral-600 text-white"
                  }`}
                >
                  {offseasonState.retirementsDisabled ? "Retirements: OFF" : "Retirements: ON"}
                </button>

                <select
                  value={devOffseasonTarget}
                  onChange={(event) => setDevOffseasonTarget(event.target.value)}
                  disabled={devOffseasonRunning}
                  className={`px-4 py-2 rounded-xl font-bold border transition ${
                    devOffseasonRunning
                      ? "bg-neutral-800 border-white/10 text-white/45 cursor-not-allowed"
                      : "bg-neutral-900 border-purple-500/35 text-purple-100 hover:border-purple-400"
                  }`}
                  title="Choose where the dev sim should stop."
                >
                  {DEV_SIM_TARGET_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <button
                  onClick={handleDevSimFullOffseason}
                  disabled={devOffseasonRunning}
                  className={`px-4 py-2 rounded-xl font-bold transition shadow-lg shadow-purple-950/30 ${
                    devOffseasonRunning
                      ? "bg-purple-950/70 text-white/55 cursor-not-allowed"
                      : "bg-purple-700 hover:bg-purple-600 text-white"
                  }`}
                  title="Developer shortcut: runs the offseason until the selected stop point."
                >
                  {devOffseasonRunning ? "Dev Simming..." : `DEV: Sim To ${getDevSimTargetLabel(devOffseasonTarget)}`}
                </button>

                {devOffseasonRunning && (
                  <button
                    onClick={requestDevStop}
                    disabled={devStopRequested}
                    className={`px-4 py-2 rounded-xl font-bold transition shadow-lg shadow-purple-950/30 ${
                      devStopRequested
                        ? "bg-neutral-800 text-white/45 cursor-not-allowed"
                        : "bg-purple-950 hover:bg-purple-900 text-white border border-purple-400/30"
                    }`}
                    title="Stops after the current backend step finishes."
                  >
                    {devStopRequested ? "Stopping..." : "Stop Dev Sim"}
                  </button>
                )}
              </div>

              {devOffseasonStatus && (
                <div className="mt-3 rounded-xl border border-purple-400/25 bg-purple-950/30 px-4 py-3 text-sm font-semibold text-purple-100">
                  {devOffseasonStatus}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatPill label="Season" value={seasonYear} />
              <StatPill label="Champion" value={champion || "TBD"} />
              <StatPill label="Retired" value={retiredCount} />
              <StatPill label="Current Step" value={devOffseasonRunning ? (devStopRequested ? "Stopping" : "Dev Sim") : currentStepLabel} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {cards.map((card) => (
            <EventCard key={card.step} {...card} />
          ))}
        </div>

        <div className="mt-8 flex justify-center gap-4 flex-wrap">
          <button
            onClick={() =>
              navigate("/team-hub", {
                state: { offseasonMode: true, returnTo: "/offseason" },
              })
            }
            disabled={devOffseasonRunning}
            className={`px-6 py-3 rounded-xl font-semibold transition ${
              devOffseasonRunning
                ? "bg-neutral-700 text-white/45 cursor-not-allowed"
                : "bg-orange-600 hover:bg-orange-500"
            }`}
          >
            Open Team Hub
          </button>
        </div>
      </div>
    </div>
  );
}
