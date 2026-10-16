import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useGame } from "../context/GameContext.jsx";
import { initializeDraft, getLockerRoomMoods } from "../api/simEnginePy.js";
import { saveLeagueData } from "../utils/leagueStorage.js";
import { readScheduleFromStorage } from "../utils/scheduleStorage.js";
import {
  buildPreviewDraftOrder,
  buildUpcomingDraftPreviewLeagueData,
  getUpcomingDraftYearForPhase,
  isDraftStartedForYear,
  isUpcomingDraftPreviewCompatible,
  readCustomDraftClassSetupForYear,
  readUpcomingDraftClassForYear,
  saveUpcomingDraftClassForYear,
} from "../utils/upcomingDraftClass.js";
import SeasonBriefingModal from "./SeasonBriefingModal.jsx";
import {
  buildSeasonBriefingData,
  getSeasonBriefingDiagnostics,
  getSeasonBriefingKey,
  getSeasonBriefingLeagueScope,
  getSeasonBriefingWallpaperUrl,
  getStoredSeasonBriefingSnapshot,
  hasViewedSeasonBriefing,
  isSeasonBriefingOpeningWindow,
  markSeasonBriefingViewed,
  preloadSeasonBriefingWallpaper,
  storeSeasonBriefingSnapshot,
} from "../utils/seasonBriefing.js";

export const OPEN_SEASON_BRIEFING_EVENT = "bm:open-season-briefing";

const AUTO_POLL_MS = 350;
const AUTO_MAX_POLLS = 80;

function latestLeague(fallback) {
  try {
    return window.__leagueData || window.leagueData || fallback;
  } catch {
    return fallback;
  }
}

async function ensureDraftPreviewForBriefing(leagueData, selectedTeamName) {
  if (!leagueData) return null;

  const draftYear = Number(
    getUpcomingDraftYearForPhase(leagueData, { isOffseasonMode: false }) || 0
  );
  if (!draftYear || isDraftStartedForYear(draftYear, leagueData)) {
    return readUpcomingDraftClassForYear(draftYear);
  }

  const sourceSetup = readCustomDraftClassSetupForYear(draftYear);
  const savedPreview = readUpcomingDraftClassForYear(draftYear);
  if (isUpcomingDraftPreviewCompatible(savedPreview, sourceSetup)) return savedPreview;

  // A missing custom file should never prevent the season briefing itself from
  // opening. Upcoming Draft owns the blocking error UI for that configuration.
  if (sourceSetup?.mode === "custom" && !sourceSetup?.draftClassPayload?.draftClass?.length) {
    return null;
  }

  const payload = {
    seasonYear: draftYear,
    userTeamName: selectedTeamName || "",
    draftOrder: buildPreviewDraftOrder(leagueData),
  };

  if (sourceSetup?.mode === "custom") {
    payload.draftClass = sourceSetup.draftClassPayload.draftClass;
    payload.classType = "custom";
  }

  const result = await initializeDraft(buildUpcomingDraftPreviewLeagueData(leagueData), payload);
  if (!result?.ok) throw new Error(result?.reason || "Unable to prepare the upcoming draft class.");

  const draftState = result?.draftState || {};
  const rows = draftState?.draftClass || draftState?.availableProspects || [];
  if (!rows.length) throw new Error("The upcoming draft class did not contain any prospects.");

  const classMeta = {
    ...(draftState?.classMeta || {}),
    seasonYear: draftYear,
    previewGenerated: true,
    sourceMode: sourceSetup?.mode || "auto",
  };

  return saveUpcomingDraftClassForYear({
    seasonYear: draftYear,
    sourceMode: sourceSetup?.mode || "auto",
    sourceFingerprint: sourceSetup?.fingerprint || "",
    classType:
      sourceSetup?.mode === "custom"
        ? "custom"
        : draftState?.classType || classMeta?.classType || "auto",
    seed: draftState?.seed || classMeta?.seed || null,
    seedMode:
      sourceSetup?.mode === "custom"
        ? "custom"
        : draftState?.seedMode || classMeta?.seedMode || "fresh_random",
    classMeta,
    draftClass: rows,
  });
}

export default function SeasonBriefingHost() {
  const { leagueData, selectedTeam, setLeagueData } = useGame();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const autoOpenedKeyRef = useRef("");
  const preparationRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const teamName = selectedTeam?.name || "";
  const briefingKey = useMemo(
    () => getSeasonBriefingKey(leagueData || {}, teamName),
    [leagueData, teamName]
  );
  const leagueScope = useMemo(
    () => getSeasonBriefingLeagueScope(leagueData || {}),
    [leagueData]
  );
  const requestKey = briefingKey ? `${leagueScope}:${briefingKey}` : "";
  const wallpaperUrl = getSeasonBriefingWallpaperUrl(snapshot?.teamName || teamName);

  useEffect(() => {
    if (!open || !snapshot) return;
    const currentKey = getSeasonBriefingKey(leagueData || {}, teamName);
    if (snapshot.key === currentKey) return;
    // Developer team switching / season rollover must never pair one team's
    // chapter text with another team's artwork.
    setOpen(false);
    setSnapshot(null);
  }, [briefingKey, leagueData, open, snapshot, teamName]);

  const prepareSnapshot = async ({ force = false } = {}) => {
    if (!leagueData || !teamName || !briefingKey) return null;
    if (preparationRef.current) return preparationRef.current;

    const expectedKey = briefingKey;
    const expectedScope = leagueScope;
    const expectedTeam = teamName;

    const task = (async () => {
      if (mountedRef.current) setPreparing(true);
      try {
        let sourceLeague = latestLeague(leagueData);
        if (
          getSeasonBriefingLeagueScope(sourceLeague || {}) !== expectedScope ||
          getSeasonBriefingKey(sourceLeague || {}, expectedTeam) !== expectedKey
        ) return null;

        if (!force) {
          const stored = getStoredSeasonBriefingSnapshot(sourceLeague, expectedTeam);
          if (stored) return stored;
        } else {
          // Manual reopening should normally show the frozen chapter too. Force
          // only means "open even if viewed", not "rewrite history".
          const stored = getStoredSeasonBriefingSnapshot(sourceLeague, expectedTeam);
          if (stored) return stored;
        }

        try {
          await ensureDraftPreviewForBriefing(sourceLeague, expectedTeam);
        } catch (error) {
          // Draft preparation improves the Prospects tab but is not allowed to
          // block Team/League/Outlook if the worker or custom setup has a problem.
          console.warn("[New Chapter] upcoming draft preview unavailable", error);
        }

        sourceLeague = latestLeague(sourceLeague);
        if (
          getSeasonBriefingLeagueScope(sourceLeague || {}) !== expectedScope ||
          getSeasonBriefingKey(sourceLeague || {}, expectedTeam) !== expectedKey
        ) return null;

        let moodData = null;
        try {
          const moodResult = await getLockerRoomMoods(sourceLeague, expectedTeam);
          if (moodResult?.ok && Array.isArray(moodResult?.players)) moodData = moodResult;
        } catch (error) {
          // New Chapter should still open if the mood worker is unavailable.
          console.warn("[New Chapter] locker room mood snapshot unavailable", error);
        }

        const built = buildSeasonBriefingData(sourceLeague, expectedTeam, null, { moodData });
        if (!built) return null;

        const nextLeague = storeSeasonBriefingSnapshot(sourceLeague, expectedTeam, built);
        if (nextLeague !== sourceLeague) {
          setLeagueData(nextLeague, { persist: false, source: "NewChapter.snapshot" });
          try {
            window.__leagueData = nextLeague;
            window.leagueData = nextLeague;
          } catch {}
          await saveLeagueData(nextLeague, { source: "NewChapter.snapshot" });
        }
        return built;
      } finally {
        if (mountedRef.current) setPreparing(false);
        preparationRef.current = null;
      }
    })();

    preparationRef.current = task;
    return task;
  };

  const openBriefing = async ({ manual = false } = {}) => {
    if (!leagueData || !teamName || !wallpaperUrl) return false;

    const available = await preloadSeasonBriefingWallpaper(wallpaperUrl).catch(() => false);
    if (!available) {
      console.warn(`[New Chapter] artwork is missing for ${teamName}: ${wallpaperUrl}`);
      return false;
    }

    const nextSnapshot = await prepareSnapshot({ force: manual });
    if (!nextSnapshot || !mountedRef.current) return false;
    setSnapshot(nextSnapshot);
    setOpen(true);
    return true;
  };

  useEffect(() => {
    const handler = () => {
      openBriefing({ manual: true }).catch((error) => {
        console.warn("[New Chapter] manual open failed safely", error);
      });
    };
    window.addEventListener(OPEN_SEASON_BRIEFING_EVENT, handler);
    return () => window.removeEventListener(OPEN_SEASON_BRIEFING_EVENT, handler);
  });

  // Calendar owns schedule creation. Poll briefly after entering the route so
  // the host can wait for a freshly generated schedule without putting any of
  // the old New Chapter machinery back inside the simulation component.
  useEffect(() => {
    if (location.pathname !== "/calendar" || !leagueData || !teamName || !requestKey) return undefined;
    if (hasViewedSeasonBriefing(leagueData, briefingKey)) return undefined;
    if (autoOpenedKeyRef.current === requestKey) return undefined;

    let cancelled = false;
    let polls = 0;
    let timer = null;

    const check = async () => {
      if (cancelled || open || preparing) return;
      const currentLeague = latestLeague(leagueData);
      const currentKey = getSeasonBriefingKey(currentLeague || {}, teamName);
      if (currentKey !== briefingKey || hasViewedSeasonBriefing(currentLeague, currentKey)) return;

      const scheduleByDate = readScheduleFromStorage();
      if (
        isSeasonBriefingOpeningWindow({
          scheduleByDate,
          teamName,
          maxCompletedTeamGames: 2,
        })
      ) {
        autoOpenedKeyRef.current = requestKey;
        try {
          const opened = await openBriefing({ manual: false });
          if (!opened && !cancelled) autoOpenedKeyRef.current = "";
        } catch (error) {
          autoOpenedKeyRef.current = "";
          console.warn("[New Chapter] automatic open failed safely", error);
        }
        return;
      }

      polls += 1;
      if (polls < AUTO_MAX_POLLS && !cancelled) {
        timer = window.setTimeout(check, AUTO_POLL_MS);
      }
    };

    timer = window.setTimeout(check, 0);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [briefingKey, leagueData, location.pathname, open, preparing, requestKey, teamName]);

  const markViewedAndClose = () => {
    setOpen(false);
    const shown = snapshot;
    if (!shown?.teamName || !shown?.seasonYear) return;

    const sourceLeague = latestLeague(leagueData);
    if (!sourceLeague) return;
    const nextLeague = markSeasonBriefingViewed(
      sourceLeague,
      shown.teamName,
      shown.seasonYear
    );
    if (nextLeague === sourceLeague) return;

    setLeagueData(nextLeague, { persist: false, source: "NewChapter.viewed" });
    try {
      window.__leagueData = nextLeague;
      window.leagueData = nextLeague;
    } catch {}
    saveLeagueData(nextLeague, { source: "NewChapter.viewed" }).catch((error) => {
      console.warn("[New Chapter] failed to persist viewed state", error);
    });
  };

  useEffect(() => {
    try {
      window.bmNewChapter = {
        open: () => window.dispatchEvent(new CustomEvent(OPEN_SEASON_BRIEFING_EVENT)),
        report: () => getSeasonBriefingDiagnostics(latestLeague(leagueData), teamName),
        key: () => getSeasonBriefingKey(latestLeague(leagueData), teamName),
      };
    } catch {}
    return () => {
      try {
        delete window.bmNewChapter;
      } catch {}
    };
  }, [leagueData, teamName]);

  return (
    <SeasonBriefingModal
      open={open}
      wallpaperUrl={wallpaperUrl}
      briefing={snapshot}
      onClose={markViewedAndClose}
      onEnterSeason={markViewedAndClose}
    />
  );
}
