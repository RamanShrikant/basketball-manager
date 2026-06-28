import React, { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import LZString from "lz-string";
import styles from "../components/TeamHub.module.css";
import PageFade from "../components/PageFade";
import "../styles/BMAnimations.css";

const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
const POSTSEASON_KEY = "bm_postseason_v2";
const FREE_AGENCY_LAST_ROUTE_KEY = "bm_free_agency_last_route_v1";

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

export default function TeamHub() {
  const { leagueData, selectedTeam, setSelectedTeam } = useGame();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    document.body.classList.add("th-no-scroll");
    return () => document.body.classList.remove("th-no-scroll");
  }, []);

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

  const normalTiles = [
    { name: "View Roster", path: "/roster-view", enabled: true },
    { name: "Coach Gameplan", path: "/coach-gameplan", enabled: true },
    { name: "Schedule", path: "/calendar", enabled: true },
    { name: "Free Agents", path: "/free-agents", enabled: true },
    { name: "Trades", path: "/trades", enabled: true },
    { name: "Draft Picks", path: "/draft-picks", enabled: true },
    { name: "Statistics", path: "/player-stats", enabled: true },
    { name: "Standings", path: "/standings", enabled: true },
    { name: "Power Rankings", path: "/power-rankings", enabled: true },
    { name: "Award Tracker", path: "/award-tracker", enabled: true },
    { name: "Salary Table", path: "/salary-table", enabled: true },
    { name: "Locker Room", path: "/locker-room", enabled: true },
    { name: "Intel", path: "/intel", enabled: true },
  ];

  const offseasonTiles = [
    { name: "Return to Offseason Hub", path: offseasonReturnTo, enabled: true },
    { name: "View Roster", path: "/roster-view", enabled: true },
    { name: "Locker Room", path: "/locker-room", enabled: true },
    { name: "Trades", path: "/trades", enabled: true },
    { name: "Intel", path: "/intel", enabled: true },
    { name: "Power Rankings", path: "/power-rankings", enabled: true },
    { name: "Draft Picks", path: "/draft-picks", enabled: true },
    { name: "Free Agents", path: offseasonFreeAgentsPath, enabled: true },
    { name: "Salary Table", path: "/salary-table", enabled: true },
    { name: "Coach Gameplan", path: "#", enabled: false },
    { name: "Schedule", path: "#", enabled: false },
    { name: "Statistics", path: "#", enabled: false },
    { name: "Standings", path: "#", enabled: false },
    { name: "Award Tracker", path: "#", enabled: false },
  ];

  const playoffTiles = [
    { name: "Return to Playoffs", path: playoffReturnTo, enabled: true },
    { name: "View Roster", path: "/roster-view", enabled: true },
    { name: "Locker Room", path: "/locker-room", enabled: true },
    { name: "Trades", path: "#", enabled: false },
    { name: "Intel", path: "/intel", enabled: true },
    { name: "Power Rankings", path: "/power-rankings", enabled: true },
    { name: "Draft Picks", path: "/draft-picks", enabled: true },
    { name: "Coach Gameplan", path: "/coach-gameplan", enabled: true },
    { name: "Statistics", path: "/player-stats", enabled: true },
    { name: "Standings", path: "/standings", enabled: true },
    { name: "Salary Table", path: "/salary-table", enabled: true },
    { name: "Award Tracker", path: "/award-tracker", enabled: true },
    { name: "Free Agents", path: "#", enabled: false },
  ];

  const tiles = isOffseasonMode
    ? offseasonTiles
    : isPlayoffMode
    ? playoffTiles
    : normalTiles;

  const handleTileClick = (tile) => {
    if (!tile.enabled || tile.path === "#") return;

    const navState = isOffseasonMode
      ? {
          offseasonMode: true,
          returnTo: offseasonReturnTo,
        }
      : isPlayoffMode
      ? {
          playoffMode: true,
          playoffReturnTo,
        }
      : undefined;

    navigate(tile.path, {
      state: navState,
    });
  };

  return (
    <PageFade>
      <div className={styles.wrapper}>
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

      {isOffseasonMode && (
        <div
          style={{
            width: "min(1200px, 94vw)",
            margin: "0 auto 18px auto",
            padding: "14px 18px",
            borderRadius: "14px",
            border: "1px solid rgba(251, 146, 60, 0.35)",
            background: "rgba(234, 88, 12, 0.14)",
            color: "white",
            fontWeight: 700,
            textAlign: "center",
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.25)",
          }}
        >
          Offseason mode is active. Manage your roster here, then return to the
          Offseason Hub to continue.
        </div>
      )}

      {isPlayoffMode && !isOffseasonMode && (
        <div
          style={{
            width: "min(1200px, 94vw)",
            margin: "0 auto 18px auto",
            padding: "14px 18px",
            borderRadius: "14px",
            border: "1px solid rgba(251, 146, 60, 0.35)",
            background: "rgba(234, 88, 12, 0.14)",
            color: "white",
            fontWeight: 700,
            textAlign: "center",
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.25)",
          }}
        >
          Playoff mode is active. Manage your team here, then return to the
          playoff bracket to continue the postseason.
        </div>
      )}

      <div className={styles.scrollRow}>
        {tiles.map((tile) => {
          const enabled = tile.enabled && tile.path !== "#";

          return (
            <div
              key={tile.name}
              onClick={() => handleTileClick(tile)}
              className={`${styles.card} ${enabled ? "bmRouteCardClickable" : styles.disabled}`}
              style={{
                opacity: enabled ? 1 : 0.55,
                cursor: enabled ? "pointer" : "not-allowed",
              }}
            >
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
                    {tile.name === "Return to Offseason Hub"
                      ? "Resume offseason flow"
                      : tile.name === "Return to Playoffs"
                      ? "Resume playoff bracket"
                      : tile.name === "Power Rankings"
                      ? "League-wide team ratings"
                      : tile.name === "Draft Picks"
                      ? "Team draft assets"
                      : tile.name === "Trades"
                      ? "Propose and review trades"
                      : tile.name === "Intel"
                      ? "Front office team intel"
                      : tile.name === "Locker Room"
                      ? "Player morale and role check"
                      : selectedTeam.name}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
    </PageFade>
  );
}
