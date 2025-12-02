// GameContext.jsx
import { createContext, useContext, useState, useEffect } from "react";

const GameContext = createContext();

export function GameProvider({ children }) {
  const [leagueData, setLeagueData] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState(null);

  // Load league from localStorage at startup
  useEffect(() => {
    try {
      const saved = localStorage.getItem("leagueData");
      if (saved) {
        const parsed = JSON.parse(saved);
        console.log("🔥 Loaded leagueData into GameContext:", parsed);
        setLeagueData(parsed);
      }
    } catch (err) {
      console.error("Failed to parse leagueData:", err);
    }
  }, []);

  // Restore selectedTeam
  useEffect(() => {
    try {
      const saved = localStorage.getItem("selectedTeam");
      if (saved) setSelectedTeam(JSON.parse(saved));
    } catch {}
  }, []);

  // Persist selectedTeam
  useEffect(() => {
    if (selectedTeam)
      localStorage.setItem("selectedTeam", JSON.stringify(selectedTeam));
  }, [selectedTeam]);

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
