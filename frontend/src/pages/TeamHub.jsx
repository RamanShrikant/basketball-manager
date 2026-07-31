import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import LZString from "lz-string";
import styles from "../components/TeamHub.module.css";
import PageFade from "../components/PageFade";
import "../styles/BMAnimations.css";
import {
  isAllStarsAvailable,
  readOffseasonState as readAllStarsOffseasonState,
  readSavedAllStars,
} from "../utils/allStarsAvailability";

const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
const POSTSEASON_KEY = "bm_postseason_v2";
const FREE_AGENCY_LAST_ROUTE_KEY = "bm_free_agency_last_route_v1";
const TEAM_HUB_RETURN_CONTEXT_KEY = "bm_team_hub_return_context_v1";

function safeJSON(raw, fallback = null) {
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {}

  try {
    const source = raw.startsWith("lz:") ? raw.slice(3) : raw;
    const decompressed = LZString.decompressFromUTF16(source);
    if (!decompressed) return fallback;

    const parsed = JSON.parse(decompressed);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function getOffseasonFreeAgencyReturnPath() {
  const lastRoute = localStorage.getItem(FREE_AGENCY_LAST_ROUTE_KEY);

  if (lastRoute !== "/viewing-offers") {
    return "/free-agents";
  }

  const leagueData = safeJSON(localStorage.getItem("leagueData"), null);
  const freeAgencyState = leagueData?.freeAgencyState || {};

  const pendingUserDecisionCount = Array.isArray(freeAgencyState?.pendingUserDecisions)
    ? freeAgencyState.pendingUserDecisions.length
    : 0;

  const pendingRfaDecisionCount = Array.isArray(freeAgencyState?.pendingRfaMatchDecisions)
    ? freeAgencyState.pendingRfaMatchDecisions.length
    : 0;

  const hasLatestResults = Boolean(freeAgencyState?.latestResults);
  const marketIsActive = Boolean(freeAgencyState?.isActive);
  const currentDay = Number(freeAgencyState?.currentDay || 0);
  const maxDays = Number(freeAgencyState?.maxDays || 0);
  const marketComplete = Boolean(
    freeAgencyState?.marketComplete ||
      freeAgencyState?.freeAgencyComplete ||
      freeAgencyState?.completed ||
      freeAgencyState?.isComplete ||
      freeAgencyState?.status === "complete" ||
      (!marketIsActive && maxDays > 0 && currentDay >= maxDays)
  );

  if (marketComplete && pendingUserDecisionCount === 0 && pendingRfaDecisionCount === 0) {
    return "/free-agents";
  }

  if (pendingUserDecisionCount > 0 || pendingRfaDecisionCount > 0 || hasLatestResults) {
    return "/viewing-offers";
  }

  return "/free-agents";
}

function tileSubtitle(tile, selectedTeamName, { allStarsAvailable = false, isOffseasonMode = false } = {}) {
  if (tile.description) return tile.description;

  return tile.name === "Return to Offseason Hub"
    ? "Resume offseason flow"
    : tile.name === "Return to Playoffs"
    ? "Resume playoff bracket"
    : tile.name === "Schedule"
    ? "Calendar and Season Simulation"
    : tile.name === "Standings"
    ? "League, Conference, and Division Table"
    : tile.name === "Playoff Picture"
    ? "Seeds, Play-In, and Playoff Race"
    : tile.name === "Award Tracker"
    ? "Live MVP, DPOY, 6MOY, MIP, CPOTY, ROTY"
    : tile.name === "Free Agents"
    ? "Market and Available Players"
    : tile.name === "Salary Table"
    ? "Contracts, Cap, and Payroll"
    : tile.name === "Contract Extensions"
    ? "Eligibility, Negotiations, and Future Payroll"
    : tile.name === "Power Rankings"
    ? "League-Wide Team Ratings"
    : tile.name === "Draft Picks"
    ? "Team Draft Assets"
    : tile.name === "Trades"
    ? "Propose and Review Trades"
    : tile.name === "Team Intel"
    ? "Team scouting and trade intel"
    : tile.name === "Locker Room"
    ? "Player Morale and Role Check"
    : tile.name === "Playoff Statistics"
    ? isOffseasonMode ? "Previous Postseason" : "Current Postseason"
    : tile.name === "View All-Stars"
    ? allStarsAvailable ? "Starters and Reserves" : "Available After Selections"
    : selectedTeamName;
}


function shouldIgnoreHubShortcut(event) {
  const tagName = String(event?.target?.tagName || "").toLowerCase();
  if (["input", "select", "textarea"].includes(tagName)) return true;
  if (event?.target?.isContentEditable) return true;
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return true;
  return false;
}

function sectionReturnPayload(section, mode = {}) {
  if (!section) return null;
  return {
    section,
    label: section,
    offseasonMode: Boolean(mode.isOffseasonMode),
    playoffMode: Boolean(mode.isPlayoffMode),
    returnTo: mode.offseasonReturnTo || null,
    playoffReturnTo: mode.playoffReturnTo || null,
    updatedAt: Date.now(),
  };
}

function writeTeamHubReturnContext(payload) {
  try {
    if (!payload?.section) {
      sessionStorage.removeItem(TEAM_HUB_RETURN_CONTEXT_KEY);
      return;
    }
    sessionStorage.setItem(TEAM_HUB_RETURN_CONTEXT_KEY, JSON.stringify(payload));
  } catch {}
}

export default function TeamHub() {
  const { leagueData, selectedTeam, setSelectedTeam } = useGame();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTileIndex, setActiveTileIndex] = useState(0);
  const [activeSection, setActiveSection] = useState(() => (typeof location.state?.hubSection === "string" ? location.state.hubSection : null));
  const hubRef = useRef(null);
  const scrollRowRef = useRef(null);
  const tileRefs = useRef([]);
  const scrollSnapTimerRef = useRef(null);
  const programmaticScrollRef = useRef(false);
  const scrollReleaseTimerRef = useRef(null);
  const programmaticScrollTimerRef = useRef(null);
  const ignoreScrollUntilRef = useRef(0);
  const activeTileIndexRef = useRef(0);

  useEffect(() => {
    document.body.classList.add("th-no-scroll");
    return () => document.body.classList.remove("th-no-scroll");
  }, []);

  useEffect(() => {
    activeTileIndexRef.current = activeTileIndex;
  }, [activeTileIndex]);

  useEffect(() => {
    const requestedSection = location.state?.hubSection;
    if (typeof requestedSection === "string" && requestedSection) {
      setActiveSection(requestedSection);
    }
  }, [location.state?.hubSection]);

  useEffect(() => {
    if (!selectedTeam) return undefined;
    const frame = window.requestAnimationFrame(() => hubRef.current?.focus?.());
    return () => window.cancelAnimationFrame(frame);
  }, [selectedTeam?.name]);

  useLayoutEffect(() => {
    activeTileIndexRef.current = 0;
    setActiveTileIndex(0);
    tileRefs.current = [];
    if (scrollSnapTimerRef.current) window.clearTimeout(scrollSnapTimerRef.current);
    if (scrollReleaseTimerRef.current) window.clearTimeout(scrollReleaseTimerRef.current);
    if (programmaticScrollTimerRef.current) window.clearTimeout(programmaticScrollTimerRef.current);
    programmaticScrollRef.current = true;
    const row = scrollRowRef.current;
    if (row) row.scrollLeft = 0;
    programmaticScrollTimerRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 120);
  }, [activeSection]);

  const offseasonState = safeJSON(
    localStorage.getItem(OFFSEASON_STATE_KEY),
    {}
  );

  const postseasonState = safeJSON(
    localStorage.getItem(POSTSEASON_KEY),
    null
  );

  const isOffseasonMode = Boolean(
    location.state?.offseasonMode || offseasonState?.active
  );

  const isPlayoffMode = Boolean(
    !isOffseasonMode &&
      (location.state?.playoffMode || postseasonState)
  );

  const offseasonReturnTo = location.state?.returnTo || "/offseason";
  const playoffReturnTo = location.state?.playoffReturnTo || "/playoffs";
  const offseasonFreeAgentsPath = getOffseasonFreeAgencyReturnPath();
  const savedAllStars = readSavedAllStars();
  const allStarsAvailable = isAllStarsAvailable({
    leagueData,
    offseasonState: readAllStarsOffseasonState(),
    data: savedAllStars,
  });

  const teamsSorted = useMemo(() => {
    const teams = Array.isArray(leagueData?.teams)
      ? leagueData.teams
      : Object.values(leagueData?.conferences || {}).flat();

    return teams
      .filter(Boolean)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [leagueData]);

  const handleControlledTeamChange = (event) => {
    const nextTeamName = event.target.value;
    const nextTeam = teamsSorted.find((team) => team?.name === nextTeamName);
    if (!nextTeam) return;
    setSelectedTeam(nextTeam);
  };

  const regularSectionTiles = {
    Team: [
      { name: "View Roster", path: "/roster-view", enabled: true },
      { name: "Coach Gameplan", path: "/coach-gameplan", enabled: true },
    ],
    Stats: [
      { name: "Statistics", path: "/player-stats", enabled: true },
      { name: "Playoff Statistics", path: "#", enabled: false },
    ],
    "Front Office": [
      { name: "Trades", path: "/trades", enabled: true },
      { name: "Free Agents", path: "/free-agents", enabled: true },
      { name: "Draft Picks", path: "/draft-picks", enabled: true },
      { name: "Salary Table", path: "/salary-table", enabled: true },
      { name: "Contract Extensions", path: "/contract-extensions", enabled: true },
    ],
    Season: [
      { name: "Standings", path: "/standings", enabled: true },
      { name: "Playoff Picture", path: "/playoff-picture", enabled: true },
      { name: "Power Rankings", path: "/power-rankings", enabled: true },
    ],
    Scouting: [
      { name: "Locker Room", path: "/locker-room", enabled: true },
      { name: "Team Intel", path: "/intel", enabled: true },
    ],
    Awards: [
      { name: "Award Tracker", path: "/award-tracker", enabled: true },
      { name: "View All-Stars", path: allStarsAvailable ? "/all-stars" : "#", enabled: allStarsAvailable },
    ],
  };

  const offseasonSectionTiles = {
    Offseason: [
      { name: "Free Agents", path: offseasonFreeAgentsPath, enabled: true },
      { name: "Draft Picks", path: "/draft-picks", enabled: true },
      { name: "Salary Table", path: "/salary-table", enabled: true },
    ],
    Team: [
      { name: "View Roster", path: "/roster-view", enabled: true },
      { name: "Coach Gameplan", path: "#", enabled: false },
    ],
    Season: [
      { name: "Standings", path: "/standings", enabled: true },
      { name: "Power Rankings", path: "/power-rankings", enabled: true },
    ],
    Stats: [
      { name: "Playoff Statistics", path: "/playoff-stats", enabled: true },
    ],
    "Front Office": [
      { name: "Trades", path: "/trades", enabled: true },
      { name: "Contract Extensions", path: "/contract-extensions", enabled: true },
    ],
    Scouting: [
      { name: "Locker Room", path: "/locker-room", enabled: true },
      { name: "Team Intel", path: "/intel", enabled: true },
    ],
  };

  const playoffSectionTiles = {
    Playoffs: [
      { name: "Playoff Statistics", path: "/playoff-stats", enabled: true },
      { name: "Standings", path: "/standings", enabled: true },
    ],
    Team: [
      { name: "View Roster", path: "/roster-view", enabled: true },
      { name: "Coach Gameplan", path: "/coach-gameplan", enabled: true },
    ],
    Season: [
      { name: "Power Rankings", path: "/power-rankings", enabled: true },
      { name: "Playoff Picture", path: "#", enabled: false },
    ],
    Stats: [
      { name: "Statistics", path: "/player-stats", enabled: true },
      { name: "Playoff Statistics", path: "/playoff-stats", enabled: true },
    ],
    "Front Office": [
      { name: "Draft Picks", path: "/draft-picks", enabled: true },
      { name: "Salary Table", path: "/salary-table", enabled: true },
      { name: "Trades", path: "#", enabled: false },
      { name: "Free Agents", path: "#", enabled: false },
      { name: "Contract Extensions", path: "#", enabled: false },
    ],
    Scouting: [
      { name: "Locker Room", path: "/locker-room", enabled: true },
      { name: "Team Intel", path: "/intel", enabled: true },
    ],
    Awards: [
      { name: "Award Tracker", path: "/award-tracker", enabled: true },
      { name: "View All-Stars", path: allStarsAvailable ? "/all-stars" : "#", enabled: allStarsAvailable },
    ],
  };

  const sectionTiles = isOffseasonMode
    ? offseasonSectionTiles
    : isPlayoffMode
    ? playoffSectionTiles
    : regularSectionTiles;

  const mainItems = isOffseasonMode
    ? [
        { name: "Return to Offseason Hub", path: offseasonReturnTo, enabled: true, direct: true, description: "Resume Offseason Flow" },
        { name: "Offseason", sectionKey: "Offseason", enabled: true, description: "Free Agency, Picks, and Cap Tools" },
        { name: "Team", sectionKey: "Team", enabled: true, description: "Roster and Gameplan" },
        { name: "Stats", sectionKey: "Stats", enabled: true, description: "Postseason Stat Tables" },
        { name: "Front Office", sectionKey: "Front Office", enabled: true, description: "Trades and League Tools" },
        { name: "Season", sectionKey: "Season", enabled: true, description: "Standings and Power Rankings" },
        { name: "Scouting", sectionKey: "Scouting", enabled: true, description: "Locker Room and Team Intel" },
      ]
    : isPlayoffMode
    ? [
        { name: "Return to Playoffs", path: playoffReturnTo, enabled: true, direct: true, description: "Resume Playoff Bracket" },
        { name: "Playoffs", sectionKey: "Playoffs", enabled: true, description: "Playoff Stats and Standings" },
        { name: "Team", sectionKey: "Team", enabled: true, description: "Roster and Gameplan" },
        { name: "Stats", sectionKey: "Stats", enabled: true, description: "Regular and Playoff Stats" },
        { name: "Front Office", sectionKey: "Front Office", enabled: true, description: "Draft Assets and Salary" },
        { name: "Season", sectionKey: "Season", enabled: true, description: "Power Rankings and Playoff Picture" },
        { name: "Scouting", sectionKey: "Scouting", enabled: true, description: "Locker Room and Team Intel" },
        { name: "Awards", sectionKey: "Awards", enabled: true, description: "Award Tracker and All-Stars" },
      ]
    : [
        { name: "Schedule", path: "/calendar", enabled: true, direct: true, description: "Calendar and Season Simulation" },
        { name: "Team", sectionKey: "Team", enabled: true, description: "Roster and Gameplan" },
        { name: "Stats", sectionKey: "Stats", enabled: true, description: "Player and Playoff Stat Tables" },
        { name: "Front Office", sectionKey: "Front Office", enabled: true, description: "Trades, Free Agency, Picks, Salary" },
        { name: "Season", sectionKey: "Season", enabled: true, description: "Standings, Playoff Picture, Rankings" },
        { name: "Scouting", sectionKey: "Scouting", enabled: true, description: "Locker Room and Team Intel" },
        { name: "Awards", sectionKey: "Awards", enabled: true, description: "Tracker and All-Star Selections" },
      ];

  const currentSection = activeSection && sectionTiles[activeSection] ? activeSection : null;
  const activeSectionTiles = currentSection ? sectionTiles[currentSection] || [] : [];
  const tiles = currentSection ? activeSectionTiles : mainItems;

  const navigateWithMode = (path, tile = null) => {
    const hubReturnContext = currentSection
      ? sectionReturnPayload(currentSection, {
          isOffseasonMode,
          isPlayoffMode,
          offseasonReturnTo,
          playoffReturnTo,
        })
      : null;

    writeTeamHubReturnContext(hubReturnContext);

    const navState = {
      ...(isOffseasonMode
        ? {
            offseasonMode: true,
            returnTo: offseasonReturnTo,
          }
        : {}),
      ...(isPlayoffMode
        ? {
            playoffMode: true,
            playoffReturnTo,
          }
        : {}),
      ...(hubReturnContext
        ? {
            hubSection: hubReturnContext.section,
            hubSectionLabel: hubReturnContext.label,
          }
        : {}),
    };

    navigate(path, {
      state: Object.keys(navState).length ? navState : undefined,
    });
  };

  const handleTileClick = (tile) => {
    if (!tile?.enabled) return;

    if (!currentSection && tile.sectionKey) {
      activeTileIndexRef.current = 0;
      setActiveTileIndex(0);
      setActiveSection(tile.sectionKey);
      return;
    }

    if (!tile.path || tile.path === "#") return;
    navigateWithMode(tile.path, tile);
  };

  const getTileCenterTargetLeft = (index) => {
    const row = scrollRowRef.current;
    const node = tileRefs.current[index];
    if (!row || !node) return null;

    const targetLeft = node.offsetLeft - (row.clientWidth - node.offsetWidth) / 2;
    const maxLeft = Math.max(0, row.scrollWidth - row.clientWidth);
    return Math.max(0, Math.min(maxLeft, targetLeft));
  };

  const nearestTileIndexFromScroll = () => {
    const row = scrollRowRef.current;
    if (!row || !tiles.length) return activeTileIndex;

    const maxLeft = Math.max(0, row.scrollWidth - row.clientWidth);

    // Edge handling matters here. On wide screens the last card cannot always be
    // centered, so row-center math can incorrectly pick Season/Stats while the
    // user is clearly parked at Awards/front-office end.
    if (row.scrollLeft <= 4) return 0;
    if (maxLeft > 0 && row.scrollLeft >= maxLeft - 4) return tiles.length - 1;

    const rowCenter = row.scrollLeft + row.clientWidth / 2;
    let nearestIndex = activeTileIndex;
    let nearestDistance = Number.POSITIVE_INFINITY;

    tileRefs.current.forEach((node, index) => {
      if (!node) return;
      const cardCenter = node.offsetLeft + node.offsetWidth / 2;
      const distance = Math.abs(cardCenter - rowCenter);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    return nearestIndex;
  };

  const scrollToTile = (index, behavior = "smooth") => {
    if (!tiles.length) return;
    const nextIndex = Math.max(0, Math.min(tiles.length - 1, index));
    activeTileIndexRef.current = nextIndex;
    setActiveTileIndex(nextIndex);

    const row = scrollRowRef.current;
    const targetLeft = getTileCenterTargetLeft(nextIndex);
    if (!row || targetLeft === null) return;

    if (scrollSnapTimerRef.current) window.clearTimeout(scrollSnapTimerRef.current);
    if (scrollReleaseTimerRef.current) window.clearTimeout(scrollReleaseTimerRef.current);
    if (programmaticScrollTimerRef.current) window.clearTimeout(programmaticScrollTimerRef.current);

    programmaticScrollRef.current = true;
    ignoreScrollUntilRef.current = Date.now() + (behavior === "smooth" ? 520 : 160);
    row.scrollTo({ left: targetLeft, behavior });

    // End every keyboard/button move by forcing the intended card. Do not let
    // scrollbar position or native scroll-snap reinterpret the active card.
    programmaticScrollTimerRef.current = window.setTimeout(() => {
      const finalLeft = getTileCenterTargetLeft(nextIndex);
      if (finalLeft !== null) row.scrollTo({ left: finalLeft, behavior: "auto" });
      activeTileIndexRef.current = nextIndex;
      setActiveTileIndex(nextIndex);
      programmaticScrollRef.current = false;
      ignoreScrollUntilRef.current = Date.now() + 160;
    }, behavior === "smooth" ? 280 : 40);
  };

  const moveTileFocus = (direction) => {
    if (!tiles.length) return;

    const currentIndex = Math.max(0, Math.min(tiles.length - 1, Number(activeTileIndexRef.current || 0)));
    const nextIndex = currentIndex + direction;

    // Hard clamp: at the edge, do absolutely nothing. No wrap, no scroll
    // recalc, no nearest-card guess.
    if (nextIndex < 0 || nextIndex >= tiles.length) return;

    scrollToTile(nextIndex, "smooth");
  };

  const handleHubKeyDown = (event) => {
    const tagName = String(event.target?.tagName || "").toLowerCase();
    if (["input", "select", "textarea"].includes(tagName)) return;

    if (event.key === "Escape" || event.key === "Backspace") {
      if (currentSection) {
        event.preventDefault();
        activeTileIndexRef.current = 0;
        setActiveTileIndex(0);
        setActiveSection(null);
      }
      return;
    }

    if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
      event.preventDefault();
      moveTileFocus(1);
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
      event.preventDefault();
      moveTileFocus(-1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleTileClick(tiles[activeTileIndexRef.current] || tiles[activeTileIndex]);
    }
  };

  const snapManualScrollToNearestTile = () => {
    if (!tiles.length) return;
    const nearestIndex = nearestTileIndexFromScroll();
    activeTileIndexRef.current = nearestIndex;
    setActiveTileIndex(nearestIndex);
    scrollToTile(nearestIndex, "smooth");
  };

  const handleRowScroll = () => {
    // Navigation is intentionally owned by activeTileIndex. Native scroll events
    // were causing edge-card jumps, so the row no longer changes selection.
  };

  useEffect(() => {
    return () => {
      if (scrollSnapTimerRef.current) window.clearTimeout(scrollSnapTimerRef.current);
      if (scrollReleaseTimerRef.current) window.clearTimeout(scrollReleaseTimerRef.current);
      if (programmaticScrollTimerRef.current) window.clearTimeout(programmaticScrollTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const onWindowKeyDown = (event) => {
      if (event.defaultPrevented || shouldIgnoreHubShortcut(event)) return;
      const key = event.key;
      const isNavKey =
        key === "ArrowRight" ||
        key === "ArrowLeft" ||
        key === "a" ||
        key === "A" ||
        key === "d" ||
        key === "D" ||
        key === "Enter" ||
        key === " " ||
        key === "Escape" ||
        key === "Backspace";

      if (!isNavKey) return;
      hubRef.current?.focus?.({ preventScroll: true });
      handleHubKeyDown(event);
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [activeTileIndex, currentSection, tiles]);

  if (!selectedTeam) {
    return (
      <div className={styles.wrapper}>
        <p style={{ fontSize: "18px", marginBottom: "16px" }}>No team selected.</p>
        <button
          onClick={() => navigate("/team-selector")}
          style={{
            padding: "12px 24px",
            backgroundColor: "#ea580c",
            borderRadius: "10px",
            fontWeight: 700,
            border: "none",
            cursor: "pointer",
            color: "white",
          }}
        >
          Back to Team Select
        </button>
      </div>
    );
  }


  return (
    <PageFade>
      <div
        ref={hubRef}
        className={styles.wrapper}
        tabIndex={0}
        aria-label="Team Hub navigation"
      >
      {teamsSorted.length > 0 && (
        <div
          style={{
            position: "fixed",
            top: "18px",
            right: "22px",
            zIndex: 30,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 10px",
            borderRadius: "12px",
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(15, 15, 15, 0.86)",
            boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
            backdropFilter: "blur(10px)",
          }}
        >
          <span
            style={{
              color: "rgba(255,255,255,0.72)",
              fontSize: "12px",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Control
          </span>
          <select
            value={selectedTeam?.name || ""}
            onChange={handleControlledTeamChange}
            title="Switch controlled team"
            style={{
              maxWidth: "210px",
              padding: "7px 32px 7px 10px",
              borderRadius: "10px",
              border: "1px solid rgba(251,146,60,0.45)",
              background: "rgba(23,23,23,0.96)",
              color: "white",
              fontSize: "13px",
              fontWeight: 800,
              outline: "none",
              cursor: "pointer",
            }}
          >
            {teamsSorted.map((team) => (
              <option key={team.name} value={team.name}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {(isOffseasonMode || isPlayoffMode) && (
        <div className={styles.modeBadge}>
          {isOffseasonMode ? "Offseason" : "Playoffs"}
        </div>
      )}

      <div className={styles.carouselShell}>
        <button
          type="button"
          className={styles.railArrow}
          onClick={() => moveTileFocus(-1)}
          disabled={activeTileIndex <= 0}
          aria-label="Previous Team Hub option"
        >
          ◄
        </button>

        <div key={currentSection || "main"} ref={scrollRowRef} className={styles.scrollRow} onScroll={handleRowScroll}>
          {tiles.map((tile, index) => {
            const enabled = tile.enabled && (tile.sectionKey || tile.path !== "#");
            const active = index === activeTileIndex;
            const chipText = currentSection || tile.name;

            return (
              <div
                key={`${currentSection || "main"}-${tile.name}`}
                ref={(node) => { tileRefs.current[index] = node; }}
                onClick={() => {
                  activeTileIndexRef.current = index;
                  setActiveTileIndex(index);
                  scrollToTile(index, "auto");
                  handleTileClick(tile);
                }}
                tabIndex={enabled ? 0 : -1}
                aria-current={active ? "true" : undefined}
                className={`${styles.card} ${active ? styles.activeCard : ""} ${enabled ? "bmRouteCardClickable" : styles.disabled}`}
                style={{ cursor: enabled ? "pointer" : "not-allowed" }}
              >
                <div className={tile.direct ? styles.directChip : styles.sectionChip}>{chipText}</div>

                <img
                  src={selectedTeam.logo}
                  alt={selectedTeam.name}
                  className={styles.logo}
                />

                <div className={styles.labelBar}>
                  <div className={styles.labelBg} />
                  <div className={styles.labelText}>
                    <div className={styles.tileName}>{tile.name}</div>
                    <div className={styles.teamName}>
                      {tileSubtitle(tile, selectedTeam.name, { allStarsAvailable, isOffseasonMode })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className={styles.railArrow}
          onClick={() => moveTileFocus(1)}
          disabled={activeTileIndex >= tiles.length - 1}
          aria-label="Next Team Hub option"
        >
          ►
        </button>
      </div>

      {currentSection && (
        <button
          type="button"
          className={styles.sectionBottomBackButton}
          onClick={() => {
            activeTileIndexRef.current = 0;
            setActiveTileIndex(0);
            setActiveSection(null);
          }}
        >
          <span aria-hidden="true">←</span>
          <span>Team Hub</span>
        </button>
      )}
    </div>
    </PageFade>
  );
}
