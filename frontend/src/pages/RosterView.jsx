import React, { useState } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";

function RosterView() {
  const { selectedTeam } = useGame();
  const [selectedPlayer, setSelectedPlayer] = useState(null);
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

  // Calculate arc fill based on OVR (cap 99)
  const fillPercent = Math.min(player.overall / 99, 1);
  const circleCircumference = 2 * Math.PI * 50;
  const strokeOffset = circleCircumference * (1 - fillPercent);

  return (
    <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center py-10">
      <h1 className="text-4xl font-extrabold text-orange-500 mb-4">
        {selectedTeam.name} Roster
      </h1>

      {/* --- HEADER --- */}
      <div className="relative w-full max-w-5xl bg-neutral-800 px-8 pt-8 pb-2 rounded-t-xl shadow-lg">
        {/* White divider line */}
        <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-white opacity-60"></div>

        <div className="flex items-end justify-between relative">
          {/* Left: Player image + info */}
          <div className="flex items-end gap-6">
            <div className="relative -mb-[4.5px]"> {/* lifted so it sits right above the white line */}
              <img
                src={player.headshot}
                alt={player.name}
                className="h-[175px] w-auto object-contain"
              />
            </div>
            <div className="flex flex-col justify-end mb-3">
              <h2 className="text-4xl font-bold leading-tight">
                {player.name}
              </h2>
              <p className="text-gray-400 text-lg mt-1">
                {player.pos} • Age {player.age}
              </p>
            </div>
          </div>

          {/* Right: OVR circular arc */}
          <div className="relative flex flex-col items-center justify-center mr-4 mb-2">
            <svg width="110" height="110" viewBox="0 0 120 120">
              <defs>
                <linearGradient id="ovrGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#FFA500" />
                  <stop offset="100%" stopColor="#FFD54F" />
                </linearGradient>
              </defs>

              {/* Background ring */}
              <circle
                cx="60"
                cy="60"
                r="50"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="8"
                fill="none"
              />

              {/* Dynamic foreground ring */}
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
                transform="rotate(-90 60 60)" // start arc at top
              />
            </svg>

            <div className="absolute flex flex-col items-center justify-center text-center">
              <p className="text-sm text-gray-300 tracking-wide mb-1">OVR</p>
              <p className="text-[40px] font-extrabold text-orange-400 leading-none">
                {player.overall}
              </p>
<p className="text-[10px] text-gray-500 mt-[2px] tracking-tight leading-tight">
  CAP <span className="text-orange-400 font-medium text-[9px]">99</span>
</p>

            </div>
          </div>
        </div>
      </div>

      {/* --- TABLE --- */}
      <div className="w-full max-w-5xl overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead className="bg-neutral-800 text-gray-300">
            <tr>
              <th className="p-3">Name</th>
              <th className="p-3">POS</th>
              <th className="p-3">AGE</th>
              <th className="p-3">OVR</th>
              <th className="p-3">OFF</th>
              <th className="p-3">DEF</th>
              <th className="p-3">STAM</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr
                key={p.name}
                onClick={() => setSelectedPlayer(p)}
                className={`cursor-pointer transition ${
                  player.name === p.name
                    ? "bg-orange-600 text-white"
                    : "hover:bg-neutral-800"
                }`}
              >
                <td className="p-3">{p.name}</td>
                <td className="p-3">{p.pos}</td>
                <td className="p-3">{p.age}</td>
                <td className="p-3">{p.overall}</td>
                <td className="p-3">{p.offRating}</td>
                <td className="p-3">{p.defRating}</td>
                <td className="p-3">{p.stamina}</td>
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

export default RosterView;
