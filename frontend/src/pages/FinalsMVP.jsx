// src/pages/FinalsMvp.jsx
// FMVP page wrapper surgical patch v4
import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import FinalsMvpReveal from "../components/FinalsMvpReveal";
import { finalizeFinalsMvpAndGoOffseason } from "../utils/finalsMvpSeasonActions";
import styles from "./FinalsMvp.module.css";

export default function FinalsMvp() {
  const navigate = useNavigate();
  const { leagueData, setLeagueData, selectedTeam, setSelectedTeam } = useGame();

  const fmvpRaw = useMemo(
    () => JSON.parse(localStorage.getItem("bm_finals_mvp_v1") || "null"),
    []
  );

  const continueToOffseasonHub = () => {
    finalizeFinalsMvpAndGoOffseason({
      leagueData,
      fmvpRaw,
      selectedTeam,
      setLeagueData,
      setSelectedTeam,
      navigate,
    });
  };

  return (
    <div className={`${styles.finalsMvpPage} min-h-screen text-white py-10`}>
      <FinalsMvpReveal
        leagueData={leagueData}
        fmvpRaw={fmvpRaw}
        onContinue={continueToOffseasonHub}
        continueLabel="Continue to Offseason"
        onBack={() => navigate("/playoffs")}
        backLabel="Back"
        mode="page"
      />
    </div>
  );
}
