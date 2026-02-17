// src/pages/AllNbaTeams.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";

/* -------------------------------------------------------------------------- */
/*                             AWARDS NORMALIZATION                           */
/* -------------------------------------------------------------------------- */

// Turn [["k", value], ...] into { k: value }
function fromEntriesMaybe(arr) {
  if (!Array.isArray(arr)) return arr;
  return Object.fromEntries(arr);
}

function normalizeAwards(raw) {
  if (!raw) return null;

  let awards = raw;

  // LocalStorage format: array of [key, value] pairs
  if (Array.isArray(raw)) {
    awards = Object.fromEntries(raw);
  }

  // Single winners (for future use if needed)
  for (const key of ["mvp", "dpoy", "roty", "sixth_man"]) {
    if (awards[key] && Array.isArray(awards[key])) {
      awards[key] = fromEntriesMaybe(awards[key]);
    }
  }

  // Races
  for (const key of ["mvp_race", "dpoy_race", "roty_race", "sixth_man_race"]) {
    if (Array.isArray(awards[key])) {
      awards[key] = awards[key].map((entry) =>
        Array.isArray(entry) ? Object.fromEntries(entry) : entry
      );
    }
  }

  // 🔥 All-NBA teams: arrays of players
  for (const key of ["all_nba_first", "all_nba_second", "all_nba_third"]) {
    if (Array.isArray(awards[key])) {
      awards[key] = awards[key].map((entry) =>
        Array.isArray(entry) ? Object.fromEntries(entry) : entry
      );
    }
  }

  return awards;
}

/* -------------------------------------------------------------------------- */
/*                             SMALL LEAGUE HELPERS                           */
/* -------------------------------------------------------------------------- */

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) {
    return Object.values(leagueData.conferences).flat();
  }
  return [];
}

/* -------------------------------------------------------------------------- */
/*                             ALL-NBA TEAMS PAGE                             */
/* -------------------------------------------------------------------------- */

export default function AllNbaTeams({ leagueDataProp }) {
  const navigate = useNavigate();
  const { leagueData: ctxLeagueData } = useGame();
  const leagueData = leagueDataProp || ctxLeagueData;


  // --- guard: no league yet ---
  if (!leagueData) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-neutral-900 text-white">
        <p className="mb-3 text-lg">League data not found.</p>
        <button
          onClick={() => navigate("/team-selector")}
          className="px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold"
        >
          Back to Team Select
        </button>
      </div>
    );
  }

  /* -------------------- load awards + player stats from LS ------------------- */

  const awardsRaw = useMemo(() => {
    try {
      const raw = localStorage.getItem("bm_awards_v1");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  const awards = useMemo(() => normalizeAwards(awardsRaw), [awardsRaw]);

  const playerStatsMap = useMemo(() => {
    try {
      const raw = localStorage.getItem("bm_player_stats_v1");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, []);

  /* ----------------------------- league indexes ----------------------------- */

  const allTeams = useMemo(() => getAllTeamsFromLeague(leagueData), [leagueData]);

  // team name -> logo
  const teamLogo = useMemo(() => {
    const map = {};
    for (const t of allTeams) {
      map[t.name] =
        t.logo ||
        t.teamLogo ||
        t.logoUrl ||
        t.image ||
        t.img ||
        t.newTeamLogo ||
        "";
    }
    return map;
  }, [allTeams]);

  // (player, team) -> full player object (headshot, ovr, potential, etc.)
  const playerIndex = useMemo(() => {
    const idx = {};
    for (const t of allTeams) {
      for (const p of t.players || []) {
        const key = `${p.name}__${t.name}`;
        idx[key] = {
          ...p,
          teamName: t.name,
          teamLogo: teamLogo[t.name] || "",
        };
      }
    }
    return idx;
  }, [allTeams, teamLogo]);

  /* ---------------------------- stats helper (copy of PlayerStats) --------------------------- */

  const computePlayerStats = (playerName, teamName) => {
    const key = `${playerName}__${teamName}`;
    const rec = playerStatsMap[key];

    if (!rec || !rec.gp) {
      return {
        GP: 0,
        MIN: "0.0",
        PTS: "0.0",
        REB: "0.0",
        AST: "0.0",
        STL: "0.0",
        BLK: "0.0",
        FG: "0.0",
      };
    }

    const games = rec.gp || 1;

    const fgPct = rec.fga > 0 ? ((rec.fgm / rec.fga) * 100).toFixed(1) : "0.0";

    return {
      GP: rec.gp,
      MIN: (rec.min / games).toFixed(1),
      PTS: (rec.pts / games).toFixed(1),
      REB: (rec.reb / games).toFixed(1),
      AST: (rec.ast / games).toFixed(1),
      STL: (rec.stl / games).toFixed(1),
      BLK: (rec.blk / games).toFixed(1),
      FG: fgPct,
    };
  };

  /* ---------------------------- build All-NBA rows --------------------------- */

  const buildAllNbaRows = (list) => {
    if (!list || !list.length) return [];
    return list.map((a) => {
      const key = `${a.player}__${a.team}`;
      const base = playerIndex[key] || {};
      return {
        // from league roster
        name: base.name || a.player,
        pos: base.pos || base.position || "PG",
        secondaryPos: base.secondaryPos || "",
        age: base.age || "",
        headshot:
          base.headshot ||
          base.portrait ||
          base.image ||
          base.photo ||
          base.img ||
          "",
        overall: base.overall || base.ovr || 0,
        potential: base.potential || base.pot || 0,
        teamName: a.team,
        teamLogo: teamLogo[a.team] || base.teamLogo || "",
        stats: computePlayerStats(a.player, a.team),
      };
    });
  };

  const allNbaFirst = useMemo(
    () => buildAllNbaRows(awards?.all_nba_first || []),
    [awards, playerIndex, teamLogo, playerStatsMap]
  );
  const allNbaSecond = useMemo(
    () => buildAllNbaRows(awards?.all_nba_second || []),
    [awards, playerIndex, teamLogo, playerStatsMap]
  );
  const allNbaThird = useMemo(
    () => buildAllNbaRows(awards?.all_nba_third || []),
    [awards, playerIndex, teamLogo, playerStatsMap]
  );

  /* ----------------------------- UI state (tabs) ---------------------------- */

  const [tier, setTier] = useState("first"); // "first" | "second" | "third"
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  const currentRows = useMemo(() => {
    if (tier === "first") return allNbaFirst;
    if (tier === "second") return allNbaSecond;
    return allNbaThird;
  }, [tier, allNbaFirst, allNbaSecond, allNbaThird]);

  useEffect(() => {
    // when changing team tier, reset selected player to first in that list
    setSelectedPlayer((prev) => {
      if (!prev) return currentRows[0] || null;
      const stillThere = currentRows.find((p) => p.name === prev.name && p.teamName === prev.teamName);
      return stillThere || currentRows[0] || null;
    });
  }, [tier, currentRows]);

  /* ------------------------------- sorting (like All League) ------------------------------ */

  const [sortConfig, setSortConfig] = useState({ key: null, direction: "desc" });

  const baseCols = [
    { key: "name", label: "Name" },
    { key: "pos", label: "POS" },
    { key: "GP", label: "GP" },
    { key: "MIN", label: "MIN" },
    { key: "PTS", label: "PTS" },
    { key: "REB", label: "REB" },
    { key: "AST", label: "AST" },
    { key: "STL", label: "STL" },
    { key: "BLK", label: "BLK" },
    { key: "FG", label: "FG%" },
  ];

  const positionOrder = ["PG", "SG", "SF", "PF", "C"];

  const handleSort = (key) => {
    let direction = "desc";
    if (sortConfig.key === key && sortConfig.direction === "desc") direction = "asc";
    else if (sortConfig.key === key && sortConfig.direction === "asc")
      direction = "default";
    setSortConfig({ key, direction });
  };

  const applySort = (rows) => {
    if (!sortConfig.key || sortConfig.direction === "default") return rows;
    const dir = sortConfig.direction === "asc" ? 1 : -1;
    const sorted = [...rows];

    sorted.sort((a, b) => {
      const key = sortConfig.key;
      if (key === "name") return dir * a.name.localeCompare(b.name);
      if (key === "pos") {
        const aIdx = positionOrder.indexOf(a.pos);
        const bIdx = positionOrder.indexOf(b.pos);
        return dir * ((aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx));
      }
      const aVal = parseFloat(a.stats?.[key]) || 0;
      const bVal = parseFloat(b.stats?.[key]) || 0;
      return dir * (aVal - bVal);
    });

    return sorted;
  };

  const rows = applySort(currentRows);
  const cardPlayer = selectedPlayer || rows[0];

  // OVR circle calc (same as PlayerStats)
  const fillPercent = Math.min((cardPlayer?.overall || 0) / 99, 1);
  const circleCircumference = 2 * Math.PI * 50;
  const strokeOffset = circleCircumference * (1 - fillPercent);

  /* -------------------------------------------------------------------------- */
  /*                                   RENDER                                   */
  /* -------------------------------------------------------------------------- */

  return (
    <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center py-10">
     {/* Title row (no arrows) */}
<div className="w-full max-w-5xl flex items-center justify-between mt-6 mb-6 select-none">
  <h1 className="text-3xl md:text-4xl font-extrabold text-orange-500">
    All-NBA Teams
  </h1>

  <div className="flex items-center gap-2">
    {[
      { k: "first", label: "First Team" },
      { k: "second", label: "Second Team" },
      { k: "third", label: "Third Team" },
    ].map((tab) => (
      <button
        key={tab.k}
        onClick={() => {
          setTier(tab.k);
          setSortConfig({ key: null, direction: "desc" });
        }}
        className={`px-3 py-1 rounded-md text-sm font-semibold ${
          tier === tab.k
            ? "bg-orange-600 text-white"
            : "bg-neutral-800 text-gray-300 hover:bg-neutral-700"
        }`}
      >
        {tab.label}
      </button>
    ))}
  </div>
</div>

      {cardPlayer && (
        <div className="relative w-full flex justify-center">
          <div className="relative bg-neutral-800 w-full max-w-5xl px-8 pt-8 pb-3 rounded-t-xl shadow-lg">
            <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-white opacity-60"></div>
            <div className="flex items-end justify-between relative">
              <div className="flex items-end gap-6">
                <div className="relative -mb-[9px]">
                  <img
                    src={cardPlayer.headshot}
                    alt={cardPlayer.name}
                    className="h-[175px] w-auto object-contain"
                  />
                </div>
                <div className="flex flex-col justify-end mb-3">
                  <h2 className="text-[44px] font-bold leading-tight">
                    {cardPlayer.name}
                  </h2>
                  <p className="text-gray-400 text-[24px] mt-1">
                    {cardPlayer.pos}
                    {cardPlayer.secondaryPos
                      ? ` / ${cardPlayer.secondaryPos}`
                      : ""}{" "}
                    {cardPlayer.age ? `• Age ${cardPlayer.age}` : ""}
                  </p>
                </div>
              </div>

              {/* OVR circle */}
              <div className="relative flex flex-col items-center justify-center mr-4 mb-2">
                <svg width="110" height="110" viewBox="0 0 120 120">
                  <defs>
                    <linearGradient
                      id="ovrGradient"
                      x1="0%"
                      y1="0%"
                      x2="100%"
                      y2="0%"
                    >
                      <stop offset="0%" stopColor="#FFA500" />
                      <stop offset="100%" stopColor="#FFD54F" />
                    </linearGradient>
                  </defs>
                  <circle
                    cx="60"
                    cy="60"
                    r="50"
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth="8"
                    fill="none"
                  />
                  <circle
                    cx="60"
                    cy="60"
                    r="50"
                    stroke="url(#ovrGradient)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    fill="none"
                    strokeDasharray={circleCircumference}
                    strokeDashoffset={strokeOffset}
                    transform="rotate(-90 60 60)"
                  />
                </svg>
                <div className="absolute flex flex-col items-center justify-center text-center">
                  <p className="text-sm text-gray-300 tracking-wide mb-1">
                    OVR
                  </p>
                  <p className="text-[47px] font-extrabold text-orange-400 leading-none mt-[-11px]">
                    {cardPlayer.overall}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-[-2px]">
                    POT{" "}
                    <span className="text-orange-400 font-semibold">
                      {cardPlayer.potential}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table – 5 players of selected All-NBA team */}
      <div className="w-full flex justify-center mt-[-1px]">
        <div className="w-full max-w-5xl overflow-x-auto no-scrollbar">
          <table className="w-full border-collapse text-center text-[17px] font-medium">
            <thead className="bg-neutral-800 text-gray-300 text-[16px] font-semibold">
              <tr>
                <th className="py-3 px-2 min-w-[60px] text-left pl-4">Team</th>
                {baseCols.map((col) => (
                  <th
                    key={col.key}
                    className={`py-3 px-3 min-w-[90px] ${
                      col.key === "name"
                        ? "min-w-[150px] text-left pl-4"
                        : "text-center"
                    } cursor-pointer select-none`}
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}
                    {sortConfig.key === col.key && (
                      <span className="ml-1 text-orange-400">
                        {sortConfig.direction === "asc"
                          ? "▲"
                          : sortConfig.direction === "desc"
                          ? "▼"
                          : ""}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={`${p.teamName}-${p.name}`}
                  onClick={() => setSelectedPlayer(p)}
                  className={`cursor-pointer transition ${
                    (cardPlayer || rows[0])?.name === p.name &&
                    (cardPlayer || rows[0])?.teamName === p.teamName
                      ? "bg-orange-600 text-white"
                      : "hover:bg-neutral-800"
                  }`}
                >
<td className="py-2 px-3 text-left pl-4">
  <div className="flex items-center">
    <img
      src={p.teamLogo}
      alt={p.teamName}
      className="inline-block h-[36px] w-[36px] object-contain"
      title={p.teamName}
    />
  </div>      
</td>

                  <td className="py-2 px-3 text-left pl-4">{p.name}</td>
                  <td>{p.pos}</td>
                  <td>{p.stats.GP}</td>
                  <td>{p.stats.MIN}</td>
                  <td>{p.stats.PTS}</td>
                  <td>{p.stats.REB}</td>
                  <td>{p.stats.AST}</td>
                  <td>{p.stats.STL}</td>
                  <td>{p.stats.BLK}</td>
                  <td>{p.stats.FG}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

<div className="flex justify-end w-full max-w-5xl mt-6">
  <button
    className="px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded font-semibold"
    onClick={() => navigate("/playoffs")}
  >
    Playoffs ▶
  </button>
</div>


    </div>
  );
}
