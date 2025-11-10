import React, { useState, useEffect, useMemo } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";

export default function PlayerStats() {
  const { leagueData, selectedTeam, setSelectedTeam } = useGame();
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "desc" });
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const navigate = useNavigate();

  // --- Restore last viewed team if needed ---
  useEffect(() => {
    if (!selectedTeam) {
      const saved = localStorage.getItem("selectedTeam");
      if (saved) setSelectedTeam(JSON.parse(saved));
    }
  }, [selectedTeam, setSelectedTeam]);

  useEffect(() => {
    if (selectedTeam) localStorage.setItem("selectedTeam", JSON.stringify(selectedTeam));
  }, [selectedTeam]);

  // --- Load results from localStorage ---
  const results = useMemo(() => {
    try {
      const saved = localStorage.getItem("bm_results_v1");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  }, []);

  if (!leagueData || !selectedTeam)
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-neutral-900 text-white">
        <p className="mb-3 text-lg">No team selected or league missing.</p>
        <button
          onClick={() => navigate("/team-selector")}
          className="px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold"
        >
          Back to Team Select
        </button>
      </div>
    );

  // --- Extract all teams and their players ---
  const allTeams = useMemo(() => {
    const confs = Object.values(leagueData.conferences || {});
    return confs.flat().sort((a, b) => a.name.localeCompare(b.name));
  }, [leagueData]);

  // --- Flatten all players for global mode ---
  const allPlayers = useMemo(() => {
    return allTeams.flatMap((t) =>
      (t.players || []).map((p) => ({
        ...p,
        teamName: t.name,
      }))
    );
  }, [allTeams]);

  const currentIndex = allTeams.findIndex((t) => t.name === selectedTeam.name);
  const [showAll, setShowAll] = useState(false);

  const handleTeamSwitch = (dir) => {
    if (!showAll) {
      let newIndex =
        dir === "next"
          ? currentIndex + 1
          : currentIndex - 1;
      if (newIndex >= allTeams.length) {
        setShowAll(true);
        return;
      }
      if (newIndex < 0) {
        setShowAll(true);
        return;
      }
      setSelectedTeam(allTeams[(newIndex + allTeams.length) % allTeams.length]);
      setSelectedPlayer(null);
    } else {
      setShowAll(false);
      setSelectedTeam(allTeams[0]);
    }
  };

  // --- Compute per-player aggregated stats ---
  const computeStats = (playerName) => {
    let gp = 0,
      min = 0,
      pts = 0,
      reb = 0,
      ast = 0,
      stl = 0,
      blk = 0,
      fgm = 0,
      fga = 0,
      tpm = 0,
      tpa = 0,
      ftm = 0,
      fta = 0;

    for (const g of Object.values(results)) {
      if (!g.box) continue;
      for (const side of ["home", "away"]) {
        const rec = g.box[side]?.find((r) => r.player === playerName);
        if (rec) {
          gp++;
          min += rec.min || 0;
          pts += rec.pts || 0;
          reb += rec.reb || 0;
          ast += rec.ast || 0;
          stl += rec.stl || 0;
          blk += rec.blk || 0;

          const [fgmN, fgaN] = rec.fg?.split("/")?.map(Number) || [0, 0];
          const [tpmN, tpaN] = rec["3p"]?.split("/")?.map(Number) || [0, 0];
          const [ftmN, ftaN] = rec.ft?.split("/")?.map(Number) || [0, 0];
          fgm += fgmN; fga += fgaN;
          tpm += tpmN; tpa += tpaN;
          ftm += ftmN; fta += ftaN;
        }
      }
    }

    if (gp === 0) {
      return {
        GP: 0, MIN: 0, PTS: 0, REB: 0, AST: 0, STL: 0, BLK: 0,
        FG: 0, "3P": 0, FT: 0, "3PA": 0, FTA: 0
      };
    }
    const games = gp || 1;
    return {
      GP: gp,
      MIN: (min / games).toFixed(1),
      PTS: (pts / games).toFixed(1),
      REB: (reb / games).toFixed(1),
      AST: (ast / games).toFixed(1),
      STL: (stl / games).toFixed(1),
      BLK: (blk / games).toFixed(1),
      FG: fga > 0 ? ((fgm / fga) * 100).toFixed(1) : "0.0",
      "3P": tpa > 0 ? ((tpm / tpa) * 100).toFixed(1) : "0.0",
      FT: fta > 0 ? ((ftm / fta) * 100).toFixed(1) : "0.0",
      "3PA": (tpa / games).toFixed(1),
      FTA: (fta / games).toFixed(1),
    };
  };

  // --- Players to show ---
  const players = useMemo(() => {
    if (showAll) return allPlayers;
    return selectedTeam.players || [];
  }, [showAll, allPlayers, selectedTeam]);

  // --- Build stat-augmented data ---
  const statRows = useMemo(() => {
    return players.map((p) => ({
      ...p,
      stats: computeStats(p.name),
    }));
  }, [players, results]);

  const positionOrder = ["PG", "SG", "SF", "PF", "C"];

  const handleSort = (key) => {
    let direction = "desc";
    if (sortConfig.key === key && sortConfig.direction === "desc") direction = "asc";
    else if (sortConfig.key === key && sortConfig.direction === "asc") direction = "default";
    setSortConfig({ key, direction });
  };

  const sortedPlayers = useMemo(() => {
    if (!sortConfig.key || sortConfig.direction === "default") return statRows;
    const sorted = [...statRows];
    sorted.sort((a, b) => {
      const key = sortConfig.key;
      const dir = sortConfig.direction === "asc" ? 1 : -1;
      if (key === "pos") {
        const aIdx = positionOrder.indexOf(a.pos);
        const bIdx = positionOrder.indexOf(b.pos);
        return dir * ((aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx));
      }
      if (key === "name") return dir * a.name.localeCompare(b.name);
      const aVal = parseFloat(a.stats?.[key]) || 0;
      const bVal = parseFloat(b.stats?.[key]) || 0;
      return dir * (aVal - bVal);
    });
    return sorted;
  }, [sortConfig, statRows]);

  const player = selectedPlayer || sortedPlayers[0];
  const fillPercent = Math.min((player?.overall || 0) / 99, 1);
  const circleCircumference = 2 * Math.PI * 50;
  const strokeOffset = circleCircumference * (1 - fillPercent);

  return (
    <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center py-10">
      {/* Header */}
      <div className="flex items-center justify-center gap-6 mb-6 select-none">
        <button
          onClick={() => handleTeamSwitch("prev")}
          className="text-4xl text-white hover:text-orange-400 transition-transform active:scale-90 font-bold"
        >
          ◄
        </button>
        <h1 className="text-4xl font-extrabold text-orange-500 text-center min-w-[280px]">
          {showAll ? "All League Players" : `${selectedTeam.name} Stats`}
        </h1>
        <button
          onClick={() => handleTeamSwitch("next")}
          className="text-4xl text-white hover:text-orange-400 transition-transform active:scale-90 font-bold"
        >
          ►
        </button>
      </div>

      {/* Player Card */}
      {player && (
        <div className="relative w-full flex justify-center">
          <div className="relative bg-neutral-800 w-full max-w-5xl px-8 pt-8 pb-3 rounded-t-xl shadow-lg">
            <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-white opacity-60"></div>
            <div className="flex items-end justify-between relative">
              <div className="flex items-end gap-6">
                <div className="relative -mb-[9px]">
                  <img
                    src={player.headshot}
                    alt={player.name}
                    className="h-[175px] w-auto object-contain"
                  />
                </div>
                <div className="flex flex-col justify-end mb-3">
                  <h2 className="text-[44px] font-bold leading-tight">{player.name}</h2>
                  <p className="text-gray-400 text-[24px] mt-1">
                    {player.pos}
                    {player.secondaryPos ? ` / ${player.secondaryPos}` : ""} • Age{" "}
                    {player.age}
                  </p>
                </div>
              </div>

              {/* OVR Circle */}
              <div className="relative flex flex-col items-center justify-center mr-4 mb-2">
                <svg width="110" height="110" viewBox="0 0 120 120">
                  <defs>
                    <linearGradient id="ovrGradient" x1="0%" y1="0%" x2="100%" y2="0%">
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
                  <p className="text-sm text-gray-300 tracking-wide mb-1">OVR</p>
                  <p className="text-[47px] font-extrabold text-orange-400 leading-none mt-[-11px]">
                    {player.overall}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-[-2px]">
                    POT{" "}
                    <span className="text-orange-400 font-semibold">
                      {player.potential}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="w-full flex justify-center mt-[-1px]">
        <div className="w-full max-w-5xl overflow-x-auto">
          <table className="w-full border-collapse text-center text-[17px] font-medium">
            <thead className="bg-neutral-800 text-gray-300 text-[16px] font-semibold">
              <tr>
                {[
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
                  { key: "3P", label: "3P%" },
                  { key: "FT", label: "FT%" },
                  { key: "3PA", label: "3PA" },
                  { key: "FTA", label: "FTA" },
                ].map((col) => (
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
              {sortedPlayers.map((p) => (
                <tr
                  key={p.name}
                  onClick={() => setSelectedPlayer(p)}
                  className={`cursor-pointer transition ${
                    player.name === p.name
                      ? "bg-orange-600 text-white"
                      : "hover:bg-neutral-800"
                  }`}
                >
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
                  <td>{p.stats["3P"]}</td>
                  <td>{p.stats.FT}</td>
                  <td>{p.stats["3PA"]}</td>
                  <td>{p.stats.FTA}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <button
        onClick={() => navigate("/team-hub")}
        className="mt-10 px-8 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
      >
        Back to Team Hub
      </button>
    </div>
  );
}
