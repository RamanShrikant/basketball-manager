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

function leagueHasTeams(leagueData) {
  const teams = getAllTeamsFromLeague(leagueData);
  return Array.isArray(teams) && teams.length > 0;
}

function normalizeLeagueFinancials(leagueData) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;

  const next = { ...leagueData };

  next.salaryCap = Number(next.salaryCap || next.capLimit || 154_647_000);
  next.capLimit = Number(next.capLimit || next.salaryCap || 154_647_000);

  next.luxuryTaxLine = Number(next.luxuryTaxLine || next.taxLine || 187_895_000);
  next.taxLine = Number(next.taxLine || next.luxuryTaxLine || 187_895_000);

  next.firstApron = Number(next.firstApron || next.apron1 || 195_945_000);
  next.apron1 = Number(next.apron1 || next.firstApron || 195_945_000);

  next.secondApron = Number(next.secondApron || next.apron2 || 207_824_000);
  next.apron2 = Number(next.apron2 || next.secondApron || 207_824_000);

  next.roomException = Number(next.roomException || next.roomExceptionAmount || 8_781_000);
  next.roomExceptionAmount = Number(next.roomExceptionAmount || next.roomException || 8_781_000);

  next.midLevelException = Number(
    next.midLevelException ||
    next.nonTaxpayerMLE ||
    next.nonTaxpayerMidLevelException ||
    14_104_000
  );
  next.nonTaxpayerMLE = Number(next.nonTaxpayerMLE || next.midLevelException || 14_104_000);
  next.nonTaxpayerMidLevelException = Number(
    next.nonTaxpayerMidLevelException ||
    next.midLevelException ||
    14_104_000
  );

  next.taxpayerMLE = Number(next.taxpayerMLE || next.taxpayerMidLevelException || 5_685_000);
  next.taxpayerMidLevelException = Number(
    next.taxpayerMidLevelException ||
    next.taxpayerMLE ||
    5_685_000
  );

  return next;
}

export function GameProvider({ children }) {
  const [leagueData, setLeagueDataRaw] = useState(null);

  // Store only the team name. This prevents stale roster objects.
  const [selectedTeamName, setSelectedTeamName] = useState(null);

  const setLeagueData = (nextLeagueData) => {
    const normalized = normalizeLeagueFinancials(nextLeagueData);
    setLeagueDataRaw(normalized);
  };

  // Load league from localStorage at startup and keep trying until populated.
  useEffect(() => {
    let intervalId = null;

    const tryHydrateLeague = () => {
      try {
        const saved = localStorage.getItem("leagueData");
        if (!saved) return false;

        const parsed = normalizeLeagueFinancials(JSON.parse(saved));

        // If league exists but has 0 teams, don't lock it in forever.
        if (!leagueHasTeams(parsed)) return false;

        console.log("🔥 Loaded populated leagueData into GameContext:", parsed);

        // Seed missing CPU gameplans automatically. Does not overwrite existing ones.
        try {
          const res = ensureGameplansForLeague(parsed);
          console.log("✅ ensureGameplansForLeague:", res);
        } catch (e) {
          console.warn("ensureGameplansForLeague failed:", e);
        }

        setLeagueDataRaw(parsed);
        localStorage.setItem("leagueData", JSON.stringify(parsed));
        return true;
      } catch (err) {
        console.error("Failed to parse leagueData:", err);
        return false;
      }
    };

    const ok = tryHydrateLeague();

    if (!ok) {
      intervalId = setInterval(() => {
        const done = tryHydrateLeague();
        if (done) clearInterval(intervalId);
      }, 250);
    }

    return () => {
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
