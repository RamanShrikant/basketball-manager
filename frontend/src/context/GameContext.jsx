import { createContext, useContext, useState, useEffect } from "react";
import { buildSmartRotation } from "../api/simEngine";  // <-- IMPORT CLEANLY

const GameContext = createContext();

export function GameProvider({ children }) {
  const [leagueData, setLeagueData] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState(null);

  // -----------------------------------------------------
  // AUTO-GENERATE GAMEPLANS ONCE PER TEAM
  // -----------------------------------------------------
useEffect(() => {
  if (!leagueData) return;

  const teams = Object.values(leagueData.conferences || {}).flat();

  teams.forEach((team) => {
    const key = `gameplan_${team.name}`;

    // do NOT override if user clicked "Save Gameplan"
    const exists = localStorage.getItem(key);
    if (exists) return;

    // Build auto rotation only once
    const { minutes } = buildSmartRotation(team.players || []);
    localStorage.setItem(key, JSON.stringify(minutes));
  });
}, [leagueData]);


  return (
    <GameContext.Provider
      value={{
        leagueData,
        setLeagueData,
        selectedTeam,
        setSelectedTeam,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  return useContext(GameContext);
}
