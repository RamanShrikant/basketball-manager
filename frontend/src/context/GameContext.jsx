import { createContext, useContext, useState, useEffect } from "react";
import { buildSmartRotation } from "../api/simEngine";

const GameContext = createContext();

export function GameProvider({ children }) {
  const [leagueData, setLeagueData] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState(null);

  useEffect(() => {
    if (!leagueData) return;

    const teams = Object.values(leagueData.conferences || {}).flat();

    teams.forEach((team) => {
      const key = `gameplan_${team.name}`;

      const raw = localStorage.getItem(key);

      // If missing or corrupted, rebuild auto-minutes
      if (!raw || raw === "undefined") {
        const { obj } = buildSmartRotation(team.players || []);
        localStorage.setItem(key, JSON.stringify(obj));
        return;
      }
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
