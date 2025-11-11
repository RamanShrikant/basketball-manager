import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import styles from "./TeamSelector.module.css";

export default function TeamSelector() {
  const { leagueData, setSelectedTeam } = useGame();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Enter" && selected) handleAdvance();
    };
    const handleRightClick = (e) => {
      e.preventDefault();
      setSelected(null);
    };
    window.addEventListener("keydown", handleKey);
    window.addEventListener("contextmenu", handleRightClick);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("contextmenu", handleRightClick);
    };
  });

  if (!leagueData) {
    return (
      <div className={styles.wrapper}>
        <p>No league loaded.</p>
        <button onClick={() => navigate("/play")}>Go Back</button>
      </div>
    );
  }

  const allTeams = [
    ...(leagueData.conferences?.East || []),
    ...(leagueData.conferences?.West || []),
  ];

  const handleSelect = (team) => setSelected(team.name);

  const handleAdvance = () => {
    if (!selected) return;
    const teamObj = allTeams.find((t) => t.name === selected);
    setSelectedTeam(teamObj);
    navigate("/team-hub");
  };

  return (
    <div className={styles.wrapper}>
      <h1 className={styles.title}>Select Your Team</h1>

      <div className={styles.scrollRow}>
        {allTeams.map((team) => (
          <div
            key={team.name}
            onClick={() => handleSelect(team)}
            className={`${styles.card} ${
              selected === team.name ? styles.selected : ""
            }`}
          >
            <img src={team.logo} alt={team.name} className={styles.logo} />
            <h2 className={styles.name}>{team.name}</h2>
          </div>
        ))}
      </div>

      <div className={styles.controlsBar}>
        <div>ENTER: ADVANCE &nbsp;&nbsp; L-CLICK: SELECT &nbsp;&nbsp; R-CLICK: DESELECT</div>
        <button
          onClick={handleAdvance}
          disabled={!selected}
          className={`${styles.advanceBtn} ${selected ? styles.active : ""}`}
        >
          Advance
        </button>
      </div>
    </div>
  );
}
