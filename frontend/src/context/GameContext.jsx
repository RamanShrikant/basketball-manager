import { createContext, useContext, useState } from "react";

const GameContext = createContext();

// ✅ This provider wraps your entire app (we added it to main.jsx)
export function GameProvider({ children }) {
  const [leagueData, setLeagueData] = useState(null); // stores parsed JSON
  const [selectedTeam, setSelectedTeam] = useState(null); // stores chosen team object

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

// ✅ This hook lets you access the context anywhere easily
export function useGame() {
  return useContext(GameContext);
}
