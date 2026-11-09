import React, {createContext, useContext, useMemo} from "react";
import {useNavigate, useParams} from "react-router-dom";
import {normalizeOnlineTeamLayout} from "./onlineSeedIntegrity.mjs";

// Separate from GameContext: does not mount GameProvider, hydrate IndexedDB,
// set selectedTeam, or run any local/cloud league autosave effects.
const OnlineReadOnlyContext = createContext(null);

export function OnlineReadOnlyProvider({seed, selectedTeam, revision=null, lobbyId=null, onAccepted=null, isHost=false, humanTeamNames=[], children}) {
  // Display-only fallback for an older flat-format league. No runtime writes.
  const value = useMemo(() => Object.freeze({leagueData: normalizeOnlineTeamLayout(seed), selectedTeam, revision, lobbyId, onAccepted, isHost, humanTeamNames}), [seed, selectedTeam, revision, lobbyId, onAccepted, isHost, humanTeamNames]);
  return <OnlineReadOnlyContext.Provider value={value}>{children}</OnlineReadOnlyContext.Provider>;
}

export function useGame() {
  const value = useContext(OnlineReadOnlyContext);
  if (!value) throw new Error("Online read-only Team Hub requires OnlineReadOnlyProvider");
  return value;
}

export function useOnlineRouteNav() {
  const navigate = useNavigate();
  const {id} = useParams();
  return (to) => {
    if (to === "/team-hub") {
      navigate(`/online/franchise/${id}`);
      return;
    }
    if (to === "/team-selector") {
      navigate("/online");
      return;
    }
    // All unimplemented routes remain inside Online. Never cross to
    // /trades, /roster-view, /calendar, etc. in the single-player runtime.
    const path = typeof to === "string" && /^\/[a-z0-9-]+$/i.test(to) ? to : "/unavailable";
    navigate(`/online/franchise/${id}?view=${encodeURIComponent(path)}`);
  };
}
