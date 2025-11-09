import React, { useState, useEffect } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";

export default function CoachGameplan() {
  const { selectedTeam } = useGame();
  const [players, setPlayers] = useState([]);
  const [minutes, setMinutes] = useState({});
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [swapTarget, setSwapTarget] = useState(null);
  const [toast, setToast] = useState(false);
  const navigate = useNavigate();

  // --- Smart auto-rotation logic ---
  const buildSmartRotation = (teamPlayers) => {
    const positionOrder = ["PG", "SG", "SF", "PF", "C"];
    const sorted = [...teamPlayers].sort((a, b) => {
      const posA = positionOrder.indexOf(a.pos);
      const posB = positionOrder.indexOf(b.pos);
      if (posA !== posB) return posA - posB;
      return b.overall - a.overall;
    });

    const total = 240;
    const obj = {};
    const starterMinutes = [36, 34, 34, 34, 32];
    const benchMinutes = [25, 20, 18, 15, 12];

    sorted.forEach((p, i) => {
      if (i < 5) obj[p.name] = starterMinutes[i];
      else if (i < 10) obj[p.name] = benchMinutes[i - 5];
      else obj[p.name] = i >= sorted.length - 3 ? 0 : 6;
    });

    const sum = Object.values(obj).reduce((a, b) => a + b, 0);
    const ratio = 240 / sum;
    Object.keys(obj).forEach(
      (k) => (obj[k] = parseFloat((obj[k] * ratio).toFixed(1)))
    );

    return { sorted, obj };
  };

  // --- Load team + minutes ---
  useEffect(() => {
    if (!selectedTeam) return;
    const key = `gameplan_${selectedTeam.name}`;
    const saved = localStorage.getItem(key);
    const teamPlayers = selectedTeam.players || [];
    if (saved) {
      setMinutes(JSON.parse(saved));
      setPlayers([...teamPlayers]);
    } else {
      const { sorted, obj } = buildSmartRotation(teamPlayers);
      setMinutes(obj);
      setPlayers(sorted);
    }
  }, [selectedTeam]);

  // --- Save rotation ---
  const handleSave = () => {
    if (!selectedTeam) return;
    const key = `gameplan_${selectedTeam.name}`;
    localStorage.setItem(key, JSON.stringify(minutes));
    setToast(true);
    setTimeout(() => setToast(false), 2000);
  };

  // --- Auto rebuild ---
  const handleAutoRebuild = () => {
    const { sorted, obj } = buildSmartRotation(players);
    setPlayers(sorted);
    setMinutes(obj);
  };

  // --- Handle slider change ---
  const handleMinuteChange = (name, value) => {
    setMinutes((prev) => ({ ...prev, [name]: parseFloat(value) }));
  };

  // --- Click / Double-click logic ---
  const handlePlayerClick = (player, double = false) => {
    setSelectedPlayer(player);
    if (!swapTarget) {
      setSwapTarget(player);
    } else if (swapTarget.name === player.name) {
      setSwapTarget(null);
    } else if (double) {
      const p1 = swapTarget;
      const p2 = player;
      setPlayers((prev) => {
        const updated = [...prev];
        const i1 = updated.findIndex((p) => p.name === p1.name);
        const i2 = updated.findIndex((p) => p.name === p2.name);
        if (i1 !== -1 && i2 !== -1) [updated[i1], updated[i2]] = [updated[i2], updated[i1]];
        return updated;
      });
      setMinutes((prev) => {
        const updated = { ...prev };
        const temp = updated[p1.name];
        updated[p1.name] = updated[p2.name];
        updated[p2.name] = temp;
        return updated;
      });
      setSwapTarget(null);
    }
  };

  if (!selectedTeam)
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-neutral-900 text-white">
        <p>No team selected.</p>
        <button
          onClick={() => navigate("/team-selector")}
          className="mt-4 px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg"
        >
          Back to Team Select
        </button>
      </div>
    );

  // Guard if no players
  if (!players || players.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-neutral-900 text-white">
        <p className="text-lg">Loading lineup...</p>
      </div>
    );
  }

  const player = selectedPlayer || players[0];
  const total = Object.values(minutes).reduce((a, b) => a + b, 0);
  const overLimit = total > 240;

  // --- OVR circle ---
  const fillPercent = Math.min(player.overall / 99, 1);
  const circleCircumference = 2 * Math.PI * 50;
  const strokeOffset = circleCircumference * (1 - fillPercent);

  return (
    <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center py-10">
      {/* Toast */}
      {toast && (
        <div className="fixed top-6 right-6 bg-neutral-800 border border-orange-500 text-orange-400 px-5 py-2 rounded-lg shadow-lg animate-pulse transition-all">
          Gameplan saved!
        </div>
      )}

      <h1 className="text-4xl font-extrabold text-orange-500 mb-6">
        {selectedTeam.name} – Coach Gameplan
      </h1>

      {/* Player Card */}
      <div className="relative w-full flex justify-center mb-0">
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
                  {player.secondaryPos ? ` / ${player.secondaryPos}` : ""} • Age {player.age}
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
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="w-full flex justify-center mt-[-1px]">
        <div className="w-full max-w-5xl bg-neutral-800 rounded-b-xl p-6 shadow-lg">
          <div
            className={`text-right text-lg font-semibold mb-4 ${
              overLimit ? "text-red-500" : "text-gray-300"
            }`}
          >
            Total: {total.toFixed(1)} / 240
          </div>
          <div className="overflow-y-auto max-h-[480px]">
            <table className="w-full border-collapse text-left">
              <thead className="text-gray-400 text-[15px] border-b border-gray-700">
                <tr>
                  <th className="py-2">Player</th>
                  <th className="py-2 text-center">POS</th>
                  <th className="py-2 text-center">OVR</th>
                  <th className="py-2 text-center">Minutes</th>
                </tr>
              </thead>
              <tbody className="text-[16px]">
                {players.map((p) => (
                  <tr
                    key={p.name}
                    className={`cursor-pointer transition ${
                      selectedPlayer?.name === p.name
                        ? "bg-orange-600 text-white"
                        : "hover:bg-neutral-700"
                    }`}
                    onClick={() => handlePlayerClick(p)}
                    onDoubleClick={() => handlePlayerClick(p, true)}
                  >
                    <td className="py-2 font-semibold">{p.name}</td>
                    <td className="text-center">{p.pos}</td>
                    <td className="text-center text-orange-400 font-bold">{p.overall}</td>
                    <td className="text-center w-[250px]">
                      <div className="flex items-center gap-3 justify-center">
                        <input
                          type="range"
                          min="0"
                          max="48"
                          step="0.5"
                          value={minutes[p.name] ?? 0}
                          onChange={(e) =>
                            handleMinuteChange(p.name, e.target.value)
                          }
                          className="w-[160px] accent-white"
                        />
                        <span className="w-[50px] text-gray-200 text-sm">
                          {minutes[p.name]?.toFixed(1) ?? 0}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-4 mt-6">
            <button
              onClick={handleAutoRebuild}
              className="px-5 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg font-semibold transition"
            >
              Auto Rebuild Rotation
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-2 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
            >
              Save Gameplan
            </button>
            <button
              onClick={() => navigate("/team-hub")}
              className="px-5 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg font-semibold transition"
            >
              Back to Team Hub
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
