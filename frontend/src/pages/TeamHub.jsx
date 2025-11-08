import React from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";

export default function TeamHub() {
  const { selectedTeam } = useGame();
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

  const tiles = [
    { name: "View Roster", path: "/roster-view" },
    { name: "Trades", path: "#" },
    { name: "Coach Gameplan", path: "#" },
    { name: "Standings", path: "#" },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-neutral-900 text-white">
      <h1 className="text-4xl font-bold text-orange-500 mb-6">{selectedTeam.name}</h1>
      <img src={selectedTeam.logo} alt="Team Logo" className="h-28 mb-10" />

      <div className="grid grid-cols-2 gap-8">
        {tiles.map((tile) => (
          <div
            key={tile.name}
            onClick={() => tile.path !== "#" && navigate(tile.path)}
            className={`flex flex-col items-center justify-center w-56 h-40 rounded-2xl shadow-lg cursor-pointer transition transform hover:scale-105 ${
              tile.path !== "#"
                ? "bg-orange-600 hover:bg-orange-500"
                : "bg-neutral-800 hover:bg-neutral-700"
            }`}
          >
            <h2 className="text-xl font-semibold">{tile.name}</h2>
          </div>
        ))}
      </div>

      <p className="mt-10 text-gray-400 text-sm italic">Select an option to continue</p>
    </div>
  );
}
