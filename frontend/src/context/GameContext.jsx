// GameContext.jsx
import { createContext, useContext, useState, useEffect, useMemo } from "react";
import { ensureGameplansForLeague } from "../utils/ensureGameplans.js";
import { loadLeagueData, saveLeagueDataInBackground } from "../utils/leagueStorage.js";
import { ensureLeagueFinancials } from "../utils/leagueFinancials.js";

const GameContext = createContext();

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function leagueHasTeams(leagueData) {
  const teams = getAllTeamsFromLeague(leagueData);
  return Array.isArray(teams) && teams.length > 0;
}

function normalizeLeagueFinancials(leagueData) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;
  return ensureLeagueFinancials(leagueData);
}

export function GameProvider({ children }) {
  const [leagueData, setLeagueDataRaw] = useState(null);

  // Store only the team name. This prevents stale roster objects.
  const [selectedTeamName, setSelectedTeamName] = useState(null);

  const setLeagueData = (nextLeagueData) => {
    const normalized = normalizeLeagueFinancials(nextLeagueData);
    setLeagueDataRaw(normalized);

    if (normalized && leagueHasTeams(normalized)) {
      saveLeagueDataInBackground(normalized);
    }
  };

  // Load league from IndexedDB first, then migrate old localStorage saves.
  useEffect(() => {
    let cancelled = false;
    let intervalId = null;

    const tryHydrateLeague = async () => {
      try {
        const parsed = normalizeLeagueFinancials(await loadLeagueData());
        if (!parsed || !leagueHasTeams(parsed)) return false;
        if (cancelled) return true;

        console.log("🔥 Loaded populated leagueData into GameContext:", parsed);

        // Seed missing CPU gameplans automatically. Does not overwrite existing ones.
        try {
          const res = ensureGameplansForLeague(parsed);
          console.log("✅ ensureGameplansForLeague:", res);
        } catch (e) {
          console.warn("ensureGameplansForLeague failed:", e);
        }

        setLeagueDataRaw(parsed);
        saveLeagueDataInBackground(parsed);
        return true;
      } catch (err) {
        console.error("Failed to load leagueData:", err);
        return false;
      }
    };

    tryHydrateLeague().then((ok) => {
      if (ok || cancelled) return;

      intervalId = setInterval(() => {
        tryHydrateLeague().then((done) => {
          if (done && intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        });
      }, 250);
    });

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  // Restore selectedTeam. Supports old saved object and new saved string.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("selectedTeam");
      if (!saved) return;

      const parsed = JSON.parse(saved);

      if (parsed && typeof parsed === "object" && parsed.name) {
        setSelectedTeamName(parsed.name);
      } else if (typeof parsed === "string") {
        setSelectedTeamName(parsed);
      }
    } catch {}
  }, []);

  // Derive the live team object from leagueData every render.
  const selectedTeam = useMemo(() => {
    if (!leagueData || !selectedTeamName) return null;
    const teams = getAllTeamsFromLeague(leagueData);
    return teams.find((t) => t?.name === selectedTeamName) || null;
  }, [leagueData, selectedTeamName]);

  // Keep existing API: accepts setSelectedTeam(teamObj) or setSelectedTeam("Team Name").
  const setSelectedTeam = (teamOrName) => {
    const name =
      typeof teamOrName === "string"
        ? teamOrName
        : teamOrName?.name || null;

    setSelectedTeamName(name);

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
