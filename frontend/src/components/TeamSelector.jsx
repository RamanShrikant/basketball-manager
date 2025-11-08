import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";

export default function TeamSelector() {
  const { leagueData, setSelectedTeam } = useGame();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(null);

  if (!leagueData) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-neutral-900 text-white">
        <p className="text-lg mb-4">No league loaded.</p>
        <button
          onClick={() => navigate("/play")}
          className="px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
        >
          Go Back
        </button>
      </div>
    );
  }

  // Flatten teams from both conferences
  const allTeams = [
    ...(leagueData.conferences?.East || []),
    ...(leagueData.conferences?.West || []),
  ];

  const handleSelect = (team) => {
    setSelected(team.name);
  };

  const handleAdvance = () => {
    if (!selected) return;
    const teamObj = allTeams.find((t) => t.name === selected);
    setSelectedTeam(teamObj);
    navigate("/team-hub"); // we'll create this next
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-neutral-900 text-white">
      <h1 className="text-3xl font-bold text-orange-500 mb-6">
        Select Your Team
      </h1>

      {/* Scrollable row */}
      <div className="flex overflow-x-auto space-x-6 px-6 py-4 max-w-6xl scroll-smooth snap-x snap-mandatory">
        {allTeams.map((team) => (
          <div
            key={team.name}
            onClick={() => handleSelect(team)}
            className={`flex flex-col items-center justify-center min-w-[220px] h-[300px] bg-neutral-800 rounded-xl shadow-lg cursor-pointer snap-center transition transform hover:scale-105 ${
              selected === team.name
                ? "ring-4 ring-orange-500"
                : "hover:ring-2 hover:ring-orange-400"
            }`}
          >
            <img
              src={team.logo}
              alt={team.name}
              className="h-32 object-contain mb-4 select-none pointer-events-none"
            />
            <h2 className="text-xl font-semibold">{team.name}</h2>
          </div>
        ))}
      </div>

      <button
        onClick={handleAdvance}
        disabled={!selected}
        className={`mt-8 px-8 py-3 rounded-lg font-semibold transition ${
          selected
            ? "bg-orange-600 hover:bg-orange-500 text-white"
            : "bg-gray-600 text-gray-400 cursor-not-allowed"
        }`}
      >
        Advance
      </button>

      {selected && (
        <p className="mt-4 text-sm text-gray-400">
          Selected: <span className="text-orange-400">{selected}</span>
        </p>
      )}
    </div>
  );
}
