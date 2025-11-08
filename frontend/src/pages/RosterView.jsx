import React, { useState } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";

export default function RosterView() {
  const { selectedTeam, teams } = useGame();
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "desc" });
  const navigate = useNavigate();

  if (!selectedTeam) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-neutral-900 text-white">
        <p className="text-lg mb-4">No team selected.</p>
        <button
          onClick={() => navigate("/team-selector")}
          className="px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
        >
          Back to Team Select
        </button>
      </div>
    );
  }

  const players = selectedTeam.players || [];
  const player = selectedPlayer || players[0];

  // --- Attribute mapping (from your LeagueEditor)
  const attrNames = [
    "Three Point","Mid Range","Close Shot","Free Throw",
    "Ball Handling","Passing","Speed","Athleticism",
    "Perimeter Defense","Interior Defense","Block","Steal",
    "Rebounding","Offensive IQ","Defensive IQ"
  ];

  const attrColumns = [
    { key: "attr0", label: "3PT", index: 0 },
    { key: "attr1", label: "MID", index: 1 },
    { key: "attr2", label: "CLOSE", index: 2 },
    { key: "attr3", label: "FT", index: 3 },
    { key: "attr4", label: "BALL", index: 4 },
    { key: "attr5", label: "PASS", index: 5 },
    { key: "attr8", label: "PER D", index: 8 },
    { key: "attr9", label: "INS D", index: 9 },
    { key: "attr10", label: "BLK", index: 10 },
    { key: "attr11", label: "STL", index: 11 },
    { key: "attr12", label: "REB", index: 12 },
    { key: "attr7", label: "ATH", index: 7 },
    { key: "attr13", label: "OIQ", index: 13 },
    { key: "attr14", label: "DIQ", index: 14 }
  ];

  // --- Sort handling
  const handleSort = (key) => {
    let direction = "desc";
    if (sortConfig.key === key && sortConfig.direction === "desc") direction = "asc";
    else if (sortConfig.key === key && sortConfig.direction === "asc") direction = "default";
    setSortConfig({ key, direction });
  };

  const getSortedPlayers = () => {
    if (!sortConfig.key || sortConfig.direction === "default") return players;

    const sorted = [...players];
    sorted.sort((a, b) => {
      const key = sortConfig.key;

      // Standard fields
      if (key === "age" || key === "overall" || key === "stamina" || key === "potential" || key === "offRating" || key === "defRating") {
        return sortConfig.direction === "asc" ? a[key] - b[key] : b[key] - a[key];
      }

      // Attribute-based fields
      if (key.startsWith("attr")) {
        const idx = parseInt(key.replace("attr", ""));
        const aVal = a.attrs?.[idx] ?? 0;
        const bVal = b.attrs?.[idx] ?? 0;
        return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
      }

      return 0;
    });
    return sorted;
  };

  const sortedPlayers = getSortedPlayers();

  // --- OVR ring
  const fillPercent = Math.min(player.overall / 99, 1);
  const circleCircumference = 2 * Math.PI * 50;
  const strokeOffset = circleCircumference * (1 - fillPercent);

  return (
    <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center py-10">
      {/* Header with arrows */}
      <div className="flex items-center justify-center gap-4 mb-6">
        <button
          onClick={() => navigate(`/team/${selectedTeam.prevTeam || ""}`)}
          className="text-2xl text-orange-500 hover:text-orange-400"
        >
          ‹
        </button>
        <h1 className="text-4xl font-extrabold text-orange-500 text-center">
          {selectedTeam.name} Roster
        </h1>
        <button
          onClick={() => navigate(`/team/${selectedTeam.nextTeam || ""}`)}
          className="text-2xl text-orange-500 hover:text-orange-400"
        >
          ›
        </button>
      </div>

      {/* Player card */}
      <div className="relative w-full max-w-5xl bg-neutral-800 px-8 pt-8 pb-2 rounded-t-xl shadow-lg">
        <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-white opacity-60"></div>
        <div className="flex items-end justify-between relative">
          <div className="flex items-end gap-6">
            <div className="relative -mb-[4.5px]">
              <img
                src={player.headshot}
                alt={player.name}
                className="h-[175px] w-auto object-contain"
              />
            </div>
            <div className="flex flex-col justify-end mb-3">
              <h2 className="text-4xl font-bold leading-tight">{player.name}</h2>
              <p className="text-gray-400 text-lg mt-1">
                {player.pos}
                {player.secondaryPos ? ` / ${player.secondaryPos}` : ""} • Age {player.age}
              </p>
            </div>
          </div>
          <div className="relative flex flex-col items-center justify-center mr-4 mb-2">
            <svg width="110" height="110" viewBox="0 0 120 120">
              <defs>
                <linearGradient id="ovrGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#FFA500" />
                  <stop offset="100%" stopColor="#FFD54F" />
                </linearGradient>
              </defs>
              <circle cx="60" cy="60" r="50" stroke="rgba(255,255,255,0.08)" strokeWidth="8" fill="none" />
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
              <p className="text-[40px] font-extrabold text-orange-400 leading-none">{player.overall}</p>
              <p className="text-[10px] text-gray-400 mt-1">
                CAP <span className="text-orange-400 font-semibold">99</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="w-full max-w-5xl overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead className="bg-neutral-800 text-gray-300">
            <tr>
              {[
                { key: "name", label: "Name" },
                { key: "pos", label: "POS" },
                { key: "age", label: "AGE" },
                { key: "overall", label: "OVR" },
                { key: "offRating", label: "OFF" },
                { key: "defRating", label: "DEF" },
                { key: "stamina", label: "STAM" },
                { key: "potential", label: "POT" },
                ...attrColumns
              ].map((col) => (
                <th
                  key={col.key}
                  className="p-2 cursor-pointer select-none"
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                  {sortConfig.key === col.key && (
                    <span className="ml-1 text-orange-400">
                      {sortConfig.direction === "asc" ? "▲" : sortConfig.direction === "desc" ? "▼" : ""}
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
                  player.name === p.name ? "bg-orange-600 text-white" : "hover:bg-neutral-800"
                }`}
              >
                <td className="p-2 whitespace-nowrap">{p.name}</td>
                <td className="p-2">{p.pos}</td>
                <td className="p-2">{p.age}</td>
                <td className="p-2">{p.overall}</td>
                <td className="p-2">{p.offRating}</td>
                <td className="p-2">{p.defRating}</td>
                <td className="p-2">{p.stamina}</td>
                <td className="p-2">{p.potential}</td>
                {attrColumns.map((a) => (
                  <td key={a.key} className="p-2">{p.attrs?.[a.index] ?? "-"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
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
