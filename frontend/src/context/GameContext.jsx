// GameContext.jsx
import { createContext, useContext, useState, useEffect, useMemo } from "react";
import { ensureGameplansForLeague } from "../utils/ensureGameplans.js";

const GameContext = createContext();

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

export function GameProvider({ children }) {
  const [leagueData, setLeagueData] = useState(null);

  // ✅ store ONLY the team name (prevents stale roster objects)
  const [selectedTeamName, setSelectedTeamName] = useState(null);

  // Load league from localStorage at startup
  useEffect(() => {
    try {
      const saved = localStorage.getItem("leagueData");
if (saved) {
  const parsed = JSON.parse(saved);
  console.log("🔥 Loaded leagueData into GameContext:", parsed);

  // ✅ Seed missing CPU gameplans automatically (does NOT overwrite existing ones)
  try {
    const res = ensureGameplansForLeague(parsed);
    console.log("✅ ensureGameplansForLeague:", res);
  } catch (e) {
    console.warn("ensureGameplansForLeague failed:", e);
  }

  setLeagueData(parsed);
}

    } catch (err) {
      console.error("Failed to parse leagueData:", err);
    }
  }, []);

  // ✅ restore selectedTeam (supports OLD saved object too)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("selectedTeam");
      if (!saved) return;

      const parsed = JSON.parse(saved);

      // old format: full object
      if (parsed && typeof parsed === "object" && parsed.name) {
        setSelectedTeamName(parsed.name);
      }
      // new format: string
      else if (typeof parsed === "string") {
        setSelectedTeamName(parsed);
      }
    } catch {}
  }, []);

  // ✅ derive the LIVE team object from leagueData every render
  const selectedTeam = useMemo(() => {
    if (!leagueData || !selectedTeamName) return null;
    const teams = getAllTeamsFromLeague(leagueData);
    return teams.find((t) => t?.name === selectedTeamName) || null;
  }, [leagueData, selectedTeamName]);

  // ✅ keep existing API: accepts setSelectedTeam(teamObj) OR setSelectedTeam("Team Name")
  const setSelectedTeam = (teamOrName) => {
    const name =
      typeof teamOrName === "string"
        ? teamOrName
        : teamOrName?.name || null;

    setSelectedTeamName(name);

    // store only the name going forward
    if (name) localStorage.setItem("selectedTeam", JSON.stringify(name));
  };

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
