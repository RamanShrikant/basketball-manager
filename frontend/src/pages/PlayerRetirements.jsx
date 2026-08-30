import React, { useEffect, useMemo, useRef, useState } from "react";
import RuntimePlayerPortrait from "../components/RuntimePlayerPortrait.jsx";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { saveLeagueData } from "../utils/leagueStorage.js";
import {
  captureOffseasonMoodBaseline,
  recordRetirementMoodEvents,
} from "../utils/offseasonMoodEvents.js";
import PlayerCardModal from "../components/PlayerCardModal.jsx";
import PlayerRatingRing from "../components/PlayerRatingRing.jsx";
import { RETIREMENT_LAYOUT } from "../config/retirementLayout.js";
import {
  buildRetirementNarrativeSnapshot,
  getRetirementNarrativeKey,
} from "../utils/retirementNarrative.js";
import {
  loadRetirementNarrativesFromDB,
  saveRetirementNarrativesToDB,
} from "../utils/retirementNarrativeStorage.js";
import styles from "./PlayerRetirements.module.css";

const RETIREMENT_RESULTS_KEY = "bm_retirement_results_v1";
const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
const PLAYER_STATS_KEY = "bm_player_stats_v1";

function safeJSON(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
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

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function getAllPlayerBucketsFromLeague(leagueData) {
  const players = [];
  for (const team of getAllTeamsFromLeague(leagueData)) {
    for (const bucket of [team?.players, team?.twoWayPlayers, team?.stashPlayers]) {
      if (Array.isArray(bucket)) {
        for (const player of bucket) players.push({ ...(player || {}), teamName: team?.name || player?.teamName || player?.team || "" });
      }
    }
  }
  if (Array.isArray(leagueData?.freeAgents)) players.push(...leagueData.freeAgents);
  if (Array.isArray(leagueData?.retiredPlayersHistory)) players.push(...leagueData.retiredPlayersHistory);
  return players.filter(Boolean);
}

function findMatchingFullPlayer(leagueData, player) {
  const targetId = player?.id ?? player?.playerId ?? null;
  const targetName = String(player?.name || player?.player || "").trim().toLowerCase();
  const targetTeam = String(player?.retiredFromTeam || player?.teamName || player?.team || "").trim().toLowerCase();
  if (targetId == null && !targetName) return null;

  return getAllPlayerBucketsFromLeague(leagueData).find((row) => {
    const rowId = row?.id ?? row?.playerId ?? null;
    if (targetId != null && rowId != null && String(rowId) === String(targetId)) return true;
    const rowName = String(row?.name || row?.player || "").trim().toLowerCase();
    if (!targetName || rowName !== targetName) return false;
    const rowTeam = String(row?.retiredFromTeam || row?.teamName || row?.team || "").trim().toLowerCase();
    return !targetTeam || !rowTeam || rowTeam === targetTeam;
  }) || null;
}

function preferNonEmpty(primary, fallback) {
  if (Array.isArray(primary) && primary.length) return primary;
  if (primary && typeof primary === "object" && Object.keys(primary).length) return primary;
  if (primary != null && primary !== "") return primary;
  return fallback;
}

function mergeHistoryRows(fallbackRows = [], primaryRows = [], keyFn = () => "") {
  const map = new Map();
  for (const row of [...(Array.isArray(fallbackRows) ? fallbackRows : []), ...(Array.isArray(primaryRows) ? primaryRows : [])]) {
    if (!row || typeof row !== "object") continue;
    const key = keyFn(row) || JSON.stringify(row);
    map.set(key, row);
  }
  return [...map.values()];
}

function mergePlayerHistory(primaryHistory, fallbackHistory) {
  const primary = primaryHistory && typeof primaryHistory === "object" ? primaryHistory : {};
  const fallback = fallbackHistory && typeof fallbackHistory === "object" ? fallbackHistory : {};
  return {
    ...fallback,
    ...primary,
    seasons: mergeHistoryRows(fallback?.seasons, primary?.seasons, (row) =>
      `${Number(row?.seasonYear || row?.year || 0)}|${String(row?.teamName || row?.team || "").toLowerCase()}|${row?.rowType || "season"}`
    ),
    accolades: mergeHistoryRows(fallback?.accolades, primary?.accolades, (row) =>
      `${Number(row?.seasonYear || row?.year || 0)}|${row?.type || row?.key || ""}|${row?.label || ""}|${String(row?.team || row?.teamName || "").toLowerCase()}`
    ),
    transactions: mergeHistoryRows(fallback?.transactions, primary?.transactions, (row) =>
      String(row?.id || `${row?.date || row?.completedAt || ""}|${row?.type || ""}|${row?.fromTeam || ""}|${row?.toTeam || ""}|${row?.label || ""}`)
    ),
  };
}

function hydrateRetiredPlayerForCard(player, leagueData) {
  const full = findMatchingFullPlayer(leagueData, player) || {};
  return {
    ...full,
    ...player,
    history: mergePlayerHistory(player?.history, full?.history),
    accolades: preferNonEmpty(player?.accolades, full?.accolades || full?.awards || full?.honors || []),
    attrs: preferNonEmpty(player?.attrs, full?.attrs || full?.attributes || []),
    contract: preferNonEmpty(player?.contract, full?.contract),
    height: preferNonEmpty(player?.height, full?.height),
    teamName: player?.retiredFromTeam || player?.teamName || full?.teamName || full?.team || "Free Agency",
    team: player?.retiredFromTeam || player?.team || full?.team || full?.teamName || "Free Agency",
    retired: true,
  };
}

function resolveLogo(team) {
  return team?.logo || team?.teamLogo || team?.newTeamLogo || team?.logoUrl || team?.image || "";
}

function normalizeTeamLabel(value) {
  return String(value || "").trim();
}

function isFreeAgencyLabel(value) {
  const normalized = normalizeTeamLabel(value).toLowerCase().replace(/[^a-z]/g, "");
  return !normalized || normalized === "fa" || normalized === "freeagent" || normalized === "freeagency" || normalized === "unsigned";
}

function finiteHistoryNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Pick the team that best represents a free agent's NBA career. This is not
// simply "most recent team": it rewards both sustained games and productive
// seasons, so a player's real prime/legacy team tends to win.
function getCareerLegacyTeam(player) {
  const seasons = Array.isArray(player?.history?.seasons) ? player.history.seasons : [];
  const byTeam = new Map();

  for (const row of seasons) {
    if (!row || row?.rowType === "total") continue;

    const teamName = normalizeTeamLabel(row?.teamName || row?.team);
    if (isFreeAgencyLabel(teamName)) continue;

    const games = Math.max(0, finiteHistoryNumber(row?.games ?? row?.gp, 0));
    const ppg = Math.max(0, finiteHistoryNumber(row?.ppg, 0));
    const rpg = Math.max(0, finiteHistoryNumber(row?.rpg, 0));
    const apg = Math.max(0, finiteHistoryNumber(row?.apg, 0));
    const spg = Math.max(0, finiteHistoryNumber(row?.spg, 0));
    const bpg = Math.max(0, finiteHistoryNumber(row?.bpg, 0));
    const seasonYear = finiteHistoryNumber(row?.seasonYear, 0);

    // The production weighting mirrors the broad impact weighting already used
    // elsewhere in the game. Games provide longevity; production identifies
    // where the player actually had his best basketball years.
    const production = ppg + 0.55 * rpg + 0.65 * apg + 1.35 * spg + 1.35 * bpg;
    const seasonScore = games > 0
      ? games * (1 + production / 20)
      : 1; // preserve sparse historical rows as a weak tenure signal

    const current = byTeam.get(teamName) || {
      teamName,
      score: 0,
      games: 0,
      peakProduction: 0,
      latestSeasonYear: 0,
      teamLogo: "",
    };

    current.score += seasonScore;
    current.games += games;
    current.peakProduction = Math.max(current.peakProduction, production);
    current.latestSeasonYear = Math.max(current.latestSeasonYear, seasonYear);
    current.teamLogo = current.teamLogo || row?.teamLogo || row?.logo || "";
    byTeam.set(teamName, current);
  }

  const ranked = [...byTeam.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.games !== a.games) return b.games - a.games;
    if (b.peakProduction !== a.peakProduction) return b.peakProduction - a.peakProduction;
    if (b.latestSeasonYear !== a.latestSeasonYear) return b.latestSeasonYear - a.latestSeasonYear;
    return a.teamName.localeCompare(b.teamName);
  });

  return ranked[0] || null;
}

function getRetirementLogoChoice(player, teamLogoMap) {
  // If he retired directly from an NBA roster, that latest team wins.
  const retiredFrom = normalizeTeamLabel(player?.retiredFromTeam || player?.teamName || player?.team);
  if (!isFreeAgencyLabel(retiredFrom)) {
    return {
      teamName: retiredFrom,
      logo: teamLogoMap?.[retiredFrom] || player?.teamLogo || "",
      source: "latest-team",
    };
  }

  // Free agents use the team associated with their strongest body of career
  // seasons. If there is no usable NBA history, intentionally show no logo.
  const legacy = getCareerLegacyTeam(player);
  if (!legacy?.teamName) return null;

  return {
    teamName: legacy.teamName,
    logo: teamLogoMap?.[legacy.teamName] || legacy.teamLogo || "",
    source: "career-legacy",
  };
}


function readOffseasonState(seasonYear) {
  const stored = safeJSON(localStorage.getItem(OFFSEASON_STATE_KEY), null);

  if (!stored || typeof stored !== "object") {
return {
  active: true,
  seasonYear,
  retirementsComplete: false,
  retirementsSkipped: false,
  retirementsDisabled: false,
  freeAgencyComplete: false,
  progressionComplete: false,
};
  }

return {
  active: true,
  retirementsComplete: false,
  retirementsSkipped: false,
  retirementsDisabled: false,
  freeAgencyComplete: false,
  progressionComplete: false,
  ...stored,
  seasonYear,
};
}

function saveOffseasonState(next) {
  localStorage.setItem(OFFSEASON_STATE_KEY, JSON.stringify(next));
}

function fmt1(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.0";
  return n.toFixed(1);
}


function compactRetiredPlayer(player) {
  if (!player || typeof player !== "object") return null;

  return {
    id: player.id ?? null,
    name: player.name || player.playerName || "",
    pos: player.pos || player.position || "",
    age: player.age ?? null,
    overall: player.overall ?? player.ovr ?? null,
    ovr: player.ovr ?? player.overall ?? null,
    potential: player.potential ?? player.pot ?? null,
    retiredSeasonYear: player.retiredSeasonYear ?? null,
    retiredFromTeam: player.retiredFromTeam || player.currentTeam || player.teamName || player.team || "",
    lastKnownTeam: player.lastKnownTeam || "",
    retirementSource: player.retirementSource || "",
    retirementProbability: player.retirementProbability ?? player.retirementSnapshot?.retirementProbability ?? 0,
    retirementRoll: player.retirementRoll ?? null,
    headshot: player.headshot || player.portrait || player.image || player.photo || player.face || "",
    image: player.headshot || player.portrait || player.image || player.photo || player.face || "",
    teamName: player.retiredFromTeam || player.currentTeam || player.teamName || player.team || "",
    team: player.retiredFromTeam || player.currentTeam || player.teamName || player.team || "",
    height: player.height ?? null,
    attrs: Array.isArray(player.attrs) ? player.attrs : Array.isArray(player.attributes) ? player.attributes : [],
    offRating: player.offRating ?? player.offense ?? null,
    defRating: player.defRating ?? player.defense ?? null,
    stamina: player.stamina ?? null,
    history: player.history || player.careerHistory || null,
    accolades: player.accolades || player.awards || player.honors || [],
    stats: player.stats || player.currentStats || null,
    contract: player.contract || null,
  };
}

function compactRetirementResult(result) {
  if (!result || typeof result !== "object") return result;

  return {
    ok: Boolean(result.ok),
    skipped: Boolean(result.skipped),
    disabled: Boolean(result.disabled),
    seasonYear: result.seasonYear ?? result.summary?.seasonYear ?? null,
    retiredPlayers: Array.isArray(result.retiredPlayers)
      ? result.retiredPlayers.map(compactRetiredPlayer).filter(Boolean)
      : [],
    summary: result.summary || {
      retiredCount: 0,
      averageAge: 0,
      averageOverall: 0,
      teamsAffected: 0,
    },
  };
}

function saveRetirementResult(result) {
  const compact = compactRetirementResult(result);

  try {
    localStorage.setItem(RETIREMENT_RESULTS_KEY, JSON.stringify(compact));
    return compact;
  } catch (err) {
    console.warn("[Retirements] Compact retirement save failed. Saving ultra-light result.", err);
  }

  const ultraLight = {
    ok: Boolean(result?.ok),
    skipped: Boolean(result?.skipped),
    disabled: Boolean(result?.disabled),
    seasonYear: result?.seasonYear ?? result?.summary?.seasonYear ?? null,
    retiredPlayers: Array.isArray(result?.retiredPlayers)
      ? result.retiredPlayers.map((player) => ({
          id: player?.id ?? null,
          name: player?.name || player?.playerName || "",
          pos: player?.pos || player?.position || "",
          age: player?.age ?? null,
          overall: player?.overall ?? player?.ovr ?? null,
          retiredFromTeam: player?.retiredFromTeam || player?.currentTeam || player?.teamName || player?.team || "",
          retirementProbability: player?.retirementProbability ?? 0,
        }))
      : [],
    summary: result?.summary || null,
  };

  localStorage.setItem(RETIREMENT_RESULTS_KEY, JSON.stringify(ultraLight));
  return ultraLight;
}

function compactFreeAgencyStateForRetirementStorage(state) {
  if (!state || typeof state !== "object") return state;

  return {
    ...state,
    latestResults: null,
    offerHistory: Array.isArray(state.offerHistory) ? state.offerHistory.slice(-40) : [],
    dailyLog: Array.isArray(state.dailyLog) ? state.dailyLog.slice(-8) : [],
    signedPlayersLog: Array.isArray(state.signedPlayersLog)
      ? state.signedPlayersLog.slice(-80).map((row) => ({
          day: row?.day ?? null,
          playerId: row?.playerId ?? null,
          playerName: row?.playerName || "",
          teamName: row?.teamName || row?.signedWith || "",
          signedWith: row?.signedWith || row?.teamName || "",
          contract: row?.contract || row?.signedContract || null,
          totalValue: row?.totalValue || row?.signedTotalValue || 0,
          aav: row?.aav || 0,
          spendingType: row?.spendingType || "",
          exceptionType: row?.exceptionType || "",
          rfaMatched: Boolean(row?.rfaMatched),
        }))
      : [],
    userOfferOutcomeLog: Array.isArray(state.userOfferOutcomeLog)
      ? state.userOfferOutcomeLog.slice(-80).map((row) => ({
          day: row?.day ?? null,
          playerId: row?.playerId ?? null,
          playerName: row?.playerName || "",
          status: row?.status || row?.offerStatus || "",
          signedWith: row?.signedWith || "",
        }))
      : [],
  };
}

function compactLeagueDataForRetirementStorage(leagueData) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;

  return {
    ...leagueData,
    freeAgencyState: compactFreeAgencyStateForRetirementStorage(leagueData.freeAgencyState),
    retiredPlayersHistory: Array.isArray(leagueData.retiredPlayersHistory)
      ? leagueData.retiredPlayersHistory.map(compactRetiredPlayer).filter(Boolean)
      : [],
  };
}

function saveLeagueDataAfterRetirements(updated) {
  if (!updated) return;

  // Keep this surgical: retirements should use the central IndexedDB league save.
  // Do not write full leagueData directly to localStorage here, because large
  // saves can hit browser quota and trap the offseason on the retirement step.
  saveLeagueData(compactLeagueDataForRetirementStorage(updated)).catch((err) => {
    console.warn("[Retirements] IndexedDB leagueData save failed after retirements.", err);
  });
}

function SummaryCard({ label, value, tone = "neutral" }) {
  const toneClass =
    tone === "orange"
      ? "border-orange-500/30 bg-orange-500/10 text-orange-100"
      : tone === "green"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
      : "border-white/10 bg-white/5 text-white";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-xs uppercase tracking-[0.18em] text-white/45 mb-2">{label}</div>
      <div className="text-3xl font-extrabold">{value}</div>
    </div>
  );
}

export default function PlayerRetirements() {
  const navigate = useNavigate();
  const { leagueData, setLeagueData, selectedTeam, setSelectedTeam } = useGame();

  const [workingLeagueData, setWorkingLeagueData] = useState(leagueData || null);
  const [retirementResult, setRetirementResult] = useState(
    safeJSON(localStorage.getItem(RETIREMENT_RESULTS_KEY), null)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [playerCardPlayer, setPlayerCardPlayer] = useState(null);
  const [retirementNarratives, setRetirementNarratives] = useState({});
  const autoRunSeasonRef = useRef(null);
  const retirementRowsViewportRef = useRef(null);
  const [retirementRowScale, setRetirementRowScale] = useState(1);

  useEffect(() => {
    setWorkingLeagueData(leagueData || null);
  }, [leagueData]);

  const seasonYear = getSeasonYear(workingLeagueData || leagueData);
  const offseasonState = useMemo(() => readOffseasonState(seasonYear), [seasonYear]);

  const retirementMasterWidth = Math.max(1, Number(RETIREMENT_LAYOUT.responsive?.masterWidth || 1700));
  const retirementMinScale = Math.max(0.1, Number(RETIREMENT_LAYOUT.responsive?.minScale ?? 0.5));
  const retirementMaxScale = Math.max(retirementMinScale, Number(RETIREMENT_LAYOUT.responsive?.maxScale ?? 1));

  useEffect(() => {
    const node = retirementRowsViewportRef.current;
    if (!node) return undefined;

    const updateScale = () => {
      const availableWidth = Math.max(1, node.clientWidth || node.getBoundingClientRect().width || retirementMasterWidth);

      // One equation for every compact viewport. Height never participates, so
      // 1366x625 and 1366x768 render the SAME row geometry; only the number of
      // visible rows changes. Wider screens stay at the authored desktop 1:1.
      const nextScale = Math.max(
        retirementMinScale,
        Math.min(retirementMaxScale, availableWidth / retirementMasterWidth)
      );

      // Avoid ResizeObserver micro-jitter from sub-pixel scrollbar changes.
      const roundedScale = Math.round(nextScale * 10000) / 10000;
      setRetirementRowScale((current) => (Math.abs(current - roundedScale) < 0.0001 ? current : roundedScale));
    };

    updateScale();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateScale);
      return () => window.removeEventListener("resize", updateScale);
    }

    const observer = new ResizeObserver(updateScale);
    observer.observe(node);
    return () => observer.disconnect();
  }, [retirementMasterWidth, retirementMinScale, retirementMaxScale]);

  useEffect(() => {
    let cancelled = false;
    loadRetirementNarrativesFromDB(seasonYear).then((stored) => {
      if (!cancelled && stored && typeof stored === "object") {
        setRetirementNarratives(stored);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [seasonYear]);

  useEffect(() => {
    if (!workingLeagueData) return;

    try {
      captureOffseasonMoodBaseline(workingLeagueData, { seasonYear });
    } catch (err) {
      console.warn("[Retirements] Failed to capture offseason mood baseline", err);
    }
  }, [workingLeagueData, seasonYear]);

  const teamLogoMap = useMemo(() => {
    const map = {};
    const teams = getAllTeamsFromLeague(workingLeagueData || leagueData);

    for (const team of teams) {
      map[team.name] = resolveLogo(team);
    }

    return map;
  }, [workingLeagueData, leagueData]);

  const retiredPlayers = useMemo(() => {
    const rows = Array.isArray(retirementResult?.retiredPlayers) ? retirementResult.retiredPlayers : [];
    return [...rows].sort((a, b) => {
      const aOvr = Number(a?.overall ?? a?.ovr ?? 0);
      const bOvr = Number(b?.overall ?? b?.ovr ?? 0);
      if (bOvr !== aOvr) return bOvr - aOvr;
      const aAge = Number(a?.age ?? 0);
      const bAge = Number(b?.age ?? 0);
      if (bAge !== aAge) return bAge - aAge;
      return String(a?.name || "").localeCompare(String(b?.name || ""));
    });
  }, [retirementResult?.retiredPlayers]);

  const derivedRetirementNarratives = useMemo(
    () => buildRetirementNarrativeSnapshot(retiredPlayers, workingLeagueData || leagueData),
    [retiredPlayers, workingLeagueData, leagueData]
  );

  const summary = retirementResult?.summary || {
    retiredCount: retiredPlayers.length,
    averageAge: 0,
    averageOverall: 0,
    teamsAffected: 0,
  };

const alreadyRan = !!retirementResult?.ok || !!offseasonState.retirementsComplete;

  useEffect(() => {
    if (!alreadyRan || retiredPlayers.length === 0) return;
    // Story text is a small derived cache. Keep it out of localStorage and persist
    // only the final strings/list in IndexedDB; the heavyweight source-of-truth
    // player/history data already lives in the central IndexedDB league save.
    saveRetirementNarrativesToDB(seasonYear, derivedRetirementNarratives).catch(() => {});
  }, [alreadyRan, retiredPlayers.length, seasonYear, derivedRetirementNarratives]);
  const runRetirements = async () => {
if (!workingLeagueData) {
  setError("No league data found.");
  return;
}

setLoading(true);
setError("");

    try {
      const simEngineModule = await import("../api/simEnginePy.js");
      const runPlayerRetirements = simEngineModule?.runPlayerRetirements;

      if (typeof runPlayerRetirements !== "function") {
        setError("Retirement engine is not wired yet. Add the sim engine + worker export next.");
        setLoading(false);
        return;
      }

      const statsByKey = safeJSON(localStorage.getItem(PLAYER_STATS_KEY), {}) || {};

      try {
        captureOffseasonMoodBaseline(workingLeagueData, { seasonYear });
      } catch (err) {
        console.warn("[Retirements] Failed to capture offseason mood baseline before run", err);
      }

      const res = await runPlayerRetirements(
        workingLeagueData,
        statsByKey,
        {},
        {
          seasonYear,
          seed: seasonYear,
        }
      );

      if (!res?.ok || !res?.leagueData) {
        setError(res?.reason || "Retirement run failed.");
        setLoading(false);
        return;
      }

      const updated = {
        ...res.leagueData,
        seasonYear,
        currentSeasonYear: seasonYear,
        seasonStartYear: seasonYear,
      };
      const compactResult = saveRetirementResult({
        ...res,
        leagueData: updated,
        seasonYear,
        summary: {
          ...(res.summary || {}),
          seasonYear,
        },
      });

      try {
        recordRetirementMoodEvents(updated, compactResult, {
          seasonYear,
          source: "auto_retirements",
        });
      } catch (err) {
        console.warn("[Retirements] Failed to record retirement mood events", err);
      }

      setWorkingLeagueData(updated);
      setRetirementResult(compactResult);

      if (typeof setLeagueData === "function") {
        setLeagueData(updated);
      }

      saveLeagueDataAfterRetirements(updated);

      if (selectedTeam?.name && typeof setSelectedTeam === "function") {
        let nextSelectedTeam = null;

        for (const confKey of Object.keys(updated.conferences || {})) {
          const found = (updated.conferences[confKey] || []).find(
            (team) => team.name === selectedTeam.name
          );
          if (found) {
            nextSelectedTeam = found;
            break;
          }
        }

        if (nextSelectedTeam) {
          setSelectedTeam(nextSelectedTeam);
          localStorage.setItem("selectedTeam", JSON.stringify(nextSelectedTeam.name));
        }
      }

      const nextOffseasonState = {
        ...readOffseasonState(seasonYear),
        active: true,
        seasonYear,
        retirementsComplete: true,
        retirementsSkipped: false,
        retirementsDisabled: false,
      };

      saveOffseasonState(nextOffseasonState);
    } catch (err) {
      setError(err?.message || "Retirement run failed.");
    } finally {
      setLoading(false);
    }
  };

  // Opening the retirement step runs the retirement engine automatically once
  // for this offseason. The ref protects against React StrictMode double effects.
  useEffect(() => {
    if (alreadyRan || loading || !workingLeagueData) return;
    if (autoRunSeasonRef.current === seasonYear) return;

    autoRunSeasonRef.current = seasonYear;
    runRetirements();
    // runRetirements intentionally runs once per season when this page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alreadyRan, loading, seasonYear, workingLeagueData]);

  return (
    <div className={`${styles.retirementsPage} bmCourtPage h-full min-h-0 overflow-hidden px-4 py-3 text-white`}>
      <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-3">
        <header className="flex shrink-0 items-center justify-between gap-5 rounded-2xl border border-white/10 bg-neutral-800/85 px-5 py-3 shadow-xl">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">Offseason Event</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-3xl font-extrabold text-orange-500">Player Retirements</h1>
              <span className="text-sm font-bold text-white/60">{seasonYear} Offseason</span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {!alreadyRan && (
              <div className="rounded-lg border border-orange-500/25 bg-orange-500/10 px-4 py-2 text-sm font-bold text-orange-200">
                {loading ? "Running retirements..." : "Preparing retirements..."}
              </div>
            )}

            {alreadyRan && (
              <button
                onClick={() => navigate("/offseason")}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold transition hover:bg-orange-500"
              >
                Continue
              </button>
            )}
          </div>
        </header>

        {error && (
          <div className="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => {
                autoRunSeasonRef.current = null;
                runRetirements();
              }}
              disabled={loading}
              className="rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-extrabold text-red-100 transition hover:bg-red-500/30 disabled:opacity-50"
            >
              Retry
            </button>
          </div>
        )}

        <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-4">
          <SummaryCard label="Retired" value={summary.retiredCount || 0} tone="orange" />
          <SummaryCard label="Average Age" value={fmt1(summary.averageAge || 0)} />
          <SummaryCard label="Average OVR" value={fmt1(summary.averageOverall || 0)} />
          <SummaryCard label="Teams Hit" value={summary.teamsAffected || 0} tone="green" />
        </div>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-800/85 shadow-xl">
          <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-3">
            <div>
              <h2 className="text-xl font-extrabold">Retirement Results</h2>
              <p className="text-xs text-white/50">
                {alreadyRan ? `${retiredPlayers.length} players retired.` : "Retirements run automatically when this step opens."}
              </p>
            </div>
          </div>

          <div ref={retirementRowsViewportRef} className="bmTableScroller min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            {!alreadyRan ? (
              <div className="flex h-full min-h-[220px] items-center justify-center text-white/45">{loading ? "Running retirements..." : "Preparing retirement results..."}</div>
            ) : retiredPlayers.length === 0 ? (
              <div className="flex h-full min-h-[220px] flex-col items-center justify-center text-center">
                <p className="text-xl font-bold">No retirements this offseason.</p>
                <p className="mt-1 text-sm text-white/50">Every player remains active.</p>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {retiredPlayers.map((player, idx) => {
                  const headshot = player?.headshot || player?.portrait || player?.image || player?.photo || player?.face || null;
                  const narrativeKey = getRetirementNarrativeKey(player);
                  const narrative = derivedRetirementNarratives[narrativeKey] || retirementNarratives[narrativeKey] || {};
                  const retirementReason = narrative.reason || "I felt it was the right time to step away from the game.";
                  const retirementAccomplishments = Array.isArray(narrative.accomplishments)
                    ? narrative.accomplishments
                    : ["No major recorded career honors."];
                  return (
                    <button
                      key={`${player?.name || "retired"}-${idx}`}
                      type="button"
                      onClick={() => setPlayerCardPlayer(hydrateRetiredPlayerForCard(player, workingLeagueData || leagueData))}
                      className="relative block w-full overflow-visible text-left transition hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-orange-500/60"
                      style={{ height: `${RETIREMENT_LAYOUT.rowHeight * retirementRowScale}px` }}
                      title={`Open ${player?.name || "player"} card`}
                    >
                      <div
                        className="relative"
                        style={{
                          width: `${retirementMasterWidth}px`,
                          height: `${RETIREMENT_LAYOUT.rowHeight}px`,
                          transform: `scale(${retirementRowScale})`,
                          transformOrigin: "left top",
                          willChange: "transform",
                        }}
                      >
                      <div
                        className="absolute overflow-visible"
                        style={{
                          left: `${RETIREMENT_LAYOUT.headshot.left}px`,
                          top: `${RETIREMENT_LAYOUT.headshot.top}px`,
                          width: `${RETIREMENT_LAYOUT.headshot.width}px`,
                          height: `${RETIREMENT_LAYOUT.headshot.height}px`,
                          transform: `translate(${RETIREMENT_LAYOUT.headshot.x}px, ${RETIREMENT_LAYOUT.headshot.y}px) scale(${RETIREMENT_LAYOUT.headshot.scale})`,
                          transformOrigin: "center center",
                        }}
                      >
                        <RuntimePlayerPortrait
                          player={player}
                          teamName={player?.retiredFromTeam || player?.teamName || player?.team || ""}
                          src={headshot || ""}
                          alt={player?.name || "Retired Player"}
                          className="absolute inset-0 h-full w-full overflow-visible bg-transparent"
                          imageClassName="object-contain object-bottom"
                          fallback={<div className="h-full w-full" />}
                        />
                      </div>

                      <div
                        className="absolute min-w-0 whitespace-nowrap font-extrabold"
                        style={{
                          left: `${RETIREMENT_LAYOUT.name.left}px`,
                          top: `${RETIREMENT_LAYOUT.name.top}px`,
                          fontSize: `${RETIREMENT_LAYOUT.name.fontSize}px`,
                          transform: `translate(${RETIREMENT_LAYOUT.name.x}px, ${RETIREMENT_LAYOUT.name.y}px) scale(${RETIREMENT_LAYOUT.name.scale})`,
                          transformOrigin: "left center",
                        }}
                      >
                        {player?.name || "Unknown Player"}
                      </div>

                      <div
                        className="absolute whitespace-nowrap text-white/50"
                        style={{
                          left: `${RETIREMENT_LAYOUT.meta.left}px`,
                          top: `${RETIREMENT_LAYOUT.meta.top}px`,
                          fontSize: `${RETIREMENT_LAYOUT.meta.fontSize}px`,
                          transform: `translate(${RETIREMENT_LAYOUT.meta.x}px, ${RETIREMENT_LAYOUT.meta.y}px) scale(${RETIREMENT_LAYOUT.meta.scale})`,
                          transformOrigin: "left center",
                        }}
                      >
                        {player?.pos || "-"} • Age {player?.age ?? "-"}
                      </div>

                      <div
                        className="absolute"
                        style={{
                          right: `${RETIREMENT_LAYOUT.ratingRing.right}px`,
                          top: `${RETIREMENT_LAYOUT.ratingRing.top}px`,
                          width: `${RETIREMENT_LAYOUT.ratingRing.size}px`,
                          height: `${RETIREMENT_LAYOUT.ratingRing.size}px`,
                          transform: `translate(${RETIREMENT_LAYOUT.ratingRing.x}px, ${RETIREMENT_LAYOUT.ratingRing.y}px) scale(${RETIREMENT_LAYOUT.ratingRing.scale})`,
                          transformOrigin: "center center",
                        }}
                      >
                        <PlayerRatingRing
                          overall={player?.overall ?? player?.ovr}
                          size={RETIREMENT_LAYOUT.ratingRing.size}
                          showPotential={false}
                          label="OVR"
                        />
                      </div>

                      <div
                        className={`absolute flex flex-col overflow-hidden rounded-xl border border-orange-400/15 bg-black/20 shadow-inner shadow-black/25 transition-colors hover:border-orange-400/50 hover:bg-orange-500/10 ${styles.storyBox}`}
                        style={{
                          left: `${RETIREMENT_LAYOUT.reasonBox.left}px`,
                          top: `${RETIREMENT_LAYOUT.reasonBox.top}px`,
                          width: `${RETIREMENT_LAYOUT.reasonBox.width}px`,
                          height: `${RETIREMENT_LAYOUT.reasonBox.height}px`,
                          padding: `${RETIREMENT_LAYOUT.reasonBox.padding}px`,
                          opacity: RETIREMENT_LAYOUT.reasonBox.opacity,
                          transform: `translate(${RETIREMENT_LAYOUT.reasonBox.x}px, ${RETIREMENT_LAYOUT.reasonBox.y}px) scale(${RETIREMENT_LAYOUT.reasonBox.scale})`,
                          transformOrigin: "left top",
                          boxSizing: "border-box",
                        }}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div
                          className="shrink-0 font-black uppercase tracking-[0.16em] text-orange-300/80"
                          style={{ fontSize: `${RETIREMENT_LAYOUT.reasonBox.titleFontSize}px`, lineHeight: 1 }}
                        >
                          Player Reasoning
                        </div>
                        <div
                          className={`mt-2 min-h-0 flex-1 overflow-y-auto pr-1 text-white/70 ${styles.storyScroller}`}
                          style={{
                            fontSize: `${RETIREMENT_LAYOUT.reasonBox.bodyFontSize}px`,
                            lineHeight: RETIREMENT_LAYOUT.reasonBox.lineHeight,
                          }}
                          onWheel={(event) => event.stopPropagation()}
                        >
                          {retirementReason}
                        </div>
                      </div>

                      <div
                        className={`absolute flex flex-col overflow-hidden rounded-xl border border-orange-400/15 bg-black/20 shadow-inner shadow-black/25 transition-colors hover:border-orange-400/50 hover:bg-orange-500/10 ${styles.storyBox}`}
                        style={{
                          left: `${RETIREMENT_LAYOUT.accomplishmentsBox.left}px`,
                          top: `${RETIREMENT_LAYOUT.accomplishmentsBox.top}px`,
                          width: `${RETIREMENT_LAYOUT.accomplishmentsBox.width}px`,
                          height: `${RETIREMENT_LAYOUT.accomplishmentsBox.height}px`,
                          padding: `${RETIREMENT_LAYOUT.accomplishmentsBox.padding}px`,
                          opacity: RETIREMENT_LAYOUT.accomplishmentsBox.opacity,
                          transform: `translate(${RETIREMENT_LAYOUT.accomplishmentsBox.x}px, ${RETIREMENT_LAYOUT.accomplishmentsBox.y}px) scale(${RETIREMENT_LAYOUT.accomplishmentsBox.scale})`,
                          transformOrigin: "left top",
                          boxSizing: "border-box",
                        }}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div
                          className="shrink-0 font-black uppercase tracking-[0.16em] text-orange-300/80"
                          style={{ fontSize: `${RETIREMENT_LAYOUT.accomplishmentsBox.titleFontSize}px`, lineHeight: 1 }}
                        >
                          Career Accomplishments
                        </div>
                        <div
                          className={`mt-2 min-h-0 flex-1 overflow-y-auto pr-1 text-white/70 ${styles.storyScroller}`}
                          style={{
                            fontSize: `${RETIREMENT_LAYOUT.accomplishmentsBox.bodyFontSize}px`,
                            lineHeight: RETIREMENT_LAYOUT.accomplishmentsBox.lineHeight,
                          }}
                          onWheel={(event) => event.stopPropagation()}
                        >
                          <div className="flex flex-col" style={{ gap: `${RETIREMENT_LAYOUT.accomplishmentsBox.itemGap}px` }}>
                            {retirementAccomplishments.map((item, itemIdx) => (
                              <div key={`${item}-${itemIdx}`} className="flex items-start gap-1.5">
                                <span className="mt-[0.15em] shrink-0 text-orange-400">•</span>
                                <span>{item}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {(() => {
                        const logoChoice = getRetirementLogoChoice(player, teamLogoMap);
                        if (!logoChoice?.logo) return null;

                        const base = RETIREMENT_LAYOUT.teamLogo || {};
                        const override = RETIREMENT_LAYOUT.teamLogoOverrides?.[logoChoice.teamName] || {};
                        const x = Number(base.x || 0) + Number(override.x || 0);
                        const y = Number(base.y || 0) + Number(override.y || 0);
                        const scale = Number(base.scale ?? 1) * Number(override.scale ?? 1);
                        const opacity = Math.max(0, Math.min(1, Number(base.opacity ?? 1) * Number(override.opacity ?? 1)));
                        const size = Number(base.size || 58);

                        return (
                          // Keep each retirement logo physically clipped to its own row.
                          // The row itself stays overflow-visible so Raman's large headshot
                          // tuning remains untouched; only this logo layer is row-locked.
                          <div className="pointer-events-none absolute inset-0 overflow-hidden">
                            <div
                              className="absolute flex items-center justify-center"
                              style={{
                                right: `${Number(base.right || 0)}px`,
                                top: `${Number(base.top || 0)}px`,
                                width: `${size}px`,
                                height: `${size}px`,
                                transform: `translate(${x}px, ${y}px) scale(${scale})`,
                                transformOrigin: "center center",
                                opacity,
                              }}
                              title={logoChoice.teamName}
                            >
                              <img
                                src={logoChoice.logo}
                                alt=""
                                className="h-full w-full object-contain"
                                draggable="false"
                              />
                            </div>
                          </div>
                        );
                      })()}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      <PlayerCardModal
        open={!!playerCardPlayer}
        player={playerCardPlayer}
        teamName={playerCardPlayer?.retiredFromTeam || playerCardPlayer?.teamName || playerCardPlayer?.team || "Free Agency"}
        teamLogo={teamLogoMap[playerCardPlayer?.retiredFromTeam] || teamLogoMap[playerCardPlayer?.teamName] || ""}
        leagueData={workingLeagueData || leagueData}
        onClose={() => setPlayerCardPlayer(null)}
      />
    </div>
  );

}
