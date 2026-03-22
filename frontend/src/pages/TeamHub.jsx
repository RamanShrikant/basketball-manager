import React, { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import styles from "../components/TeamHub.module.css";

const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
const POSTSEASON_KEY = "bm_postseason_v2";

function safeJSON(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export default function TeamHub() {
  const { selectedTeam } = useGame();
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
    { name: "Trades", path: "#", enabled: false },
    { name: "Coach Gameplan", path: "/coach-gameplan", enabled: true },
    { name: "Free Agents", path: "/free-agents", enabled: true },
    { name: "Schedule", path: "/calendar", enabled: true },
    { name: "Statistics", path: "/player-stats", enabled: true },
    { name: "Standings", path: "/standings", enabled: true },
    { name: "Salary Table", path: "/salary-table", enabled: true },
    { name: "Award Tracker", path: "/award-tracker", enabled: true },
  ];

  const offseasonTiles = [
    { name: "Return to Offseason Hub", path: offseasonReturnTo, enabled: true },
    { name: "View Roster", path: "/roster-view", enabled: true },
    { name: "Trades", path: "#", enabled: false },
    { name: "Free Agents", path: "/free-agents", enabled: true },
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
    { name: "Trades", path: "#", enabled: false },
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

    navigate(tile.path, {
      state: isOffseasonMode
        ? {
            offseasonMode: true,
            returnTo: offseasonReturnTo,
          }
        : isPlayoffMode
        ? {
            playoffMode: true,
            playoffReturnTo,
          }
        : undefined,
    });
  };

  return (
    <div className={styles.wrapper}>
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
              className={`${styles.card} ${enabled ? "" : styles.disabled}`}
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
                      : selectedTeam.name}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}