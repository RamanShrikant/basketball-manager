import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import styles from "../components/TeamHub.module.css";

export default function TeamHub() {
  const { selectedTeam } = useGame();
  const navigate = useNavigate();

  useEffect(() => {
    document.body.classList.add("th-no-scroll");
    return () => document.body.classList.remove("th-no-scroll");
  }, []);

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

  const tiles = [
    { name: "View Roster", path: "/roster-view" },
    { name: "Trades", path: "#" },
    { name: "Coach Gameplan", path: "/coach-gameplan" },
    { name: "Schedule", path: "/calendar" },
    { name: "Statistics", path: "/player-stats" },
    { name: "Standings", path: "/standings" },
  ];

  return (
    <div className={styles.wrapper}>
      <div className={styles.scrollRow}>
        {tiles.map((tile) => {
          const enabled = tile.path !== "#";

          return (
            <div
              key={tile.name}
              onClick={() => enabled && navigate(tile.path)}
              className={`${styles.card} ${enabled ? "" : styles.disabled}`}
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
                  <div className={styles.teamName}>{selectedTeam.name}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
