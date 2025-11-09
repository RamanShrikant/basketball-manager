import React, { useState, useEffect } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";

export default function CoachGameplan() {
  const { selectedTeam } = useGame();
  const [players, setPlayers] = useState([]);
  const [minutes, setMinutes] = useState({});
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [swapSelection, setSwapSelection] = useState(null);
  const [toast, setToast] = useState(false);
  const [teamRatings, setTeamRatings] = useState({ overall: 0, off: 0, def: 0 });
  const navigate = useNavigate();

  // --- Helper functions ---
  const fatiguePenalty = (mins, stamina) => {
    const threshold = 0.359 * stamina + 2.46;
    const over = Math.max(0, mins - threshold);
    return Math.max(0.7, 1 - 0.0075 * over);
  };

  const calculateTeamRatings = (players, minutes) => {
    const totalMins = Object.values(minutes).reduce((a, b) => a + b, 0);
    if (totalMins === 0) return { overall: 0, off: 0, def: 0 };

    let teamOff = 0,
      teamDef = 0,
      teamOvr = 0;

    for (const p of players) {
      if (!p || !p.name) continue;
      const min = minutes[p.name] || 0;
      const weight = min / totalMins;
      const pen = fatiguePenalty(min, p.stamina || 70);
      teamOff += weight * ((p.offRating || 0) * pen);
      teamDef += weight * ((p.defRating || 0) * pen);
      teamOvr += weight * ((p.overall || 0) * pen);
    }

    return {
      overall: Math.round(teamOvr),
      off: Math.round(teamOff),
      def: Math.round(teamDef),
    };
  };

  const buildSmartRotation = (teamPlayers) => {
    const positionOrder = ["PG", "SG", "SF", "PF", "C"];
    const validPlayers = (teamPlayers || []).filter(
      (p) => p && typeof p.overall === "number" && p.name
    );
    if (validPlayers.length === 0) return { sorted: [], obj: {} };

    const sortedByOvr = [...validPlayers].sort((a, b) => b.overall - a.overall);
    const starters = [];
    const used = new Set();

    // Fill each role using primary or secondary match
    for (const pos of positionOrder) {
      const eligible = sortedByOvr.filter(
        (p) => !used.has(p.name) && (p.pos === pos || p.secondaryPos === pos)
      );
      if (eligible.length > 0) {
        starters.push(eligible[0]);
        used.add(eligible[0].name);
      }
    }

    // Fill bench and remaining spots
    for (const p of sortedByOvr) {
      if (!used.has(p.name)) {
        starters.push(p);
        used.add(p.name);
      }
    }

    // Minute tiers
    const starterMinutes = [36, 34, 34, 34, 32];
    const benchMinutes = [25, 20, 18, 15, 12];
    const deepBenchMinutes = [6, 4, 2, 1, 0];

    const obj = {};
    starters.forEach((p, i) => {
      if (i < starterMinutes.length) obj[p.name] = starterMinutes[i];
      else if (i < starterMinutes.length + benchMinutes.length)
        obj[p.name] = benchMinutes[i - starterMinutes.length];
      else if (i < starterMinutes.length + benchMinutes.length + deepBenchMinutes.length)
        obj[p.name] = deepBenchMinutes[i - starterMinutes.length - benchMinutes.length];
      else obj[p.name] = 0;
    });

    // Normalize to 240 minutes
    const total = Object.values(obj).reduce((a, b) => a + b, 0);
    const ratio = 240 / total;
    Object.keys(obj).forEach((k) => (obj[k] = Math.round(obj[k] * ratio)));
    let adj = 240 - Object.values(obj).reduce((a, b) => a + b, 0);
    const keys = Object.keys(obj);
    let i = 0;
    while (adj !== 0 && keys.length > 0) {
      obj[keys[i]] += adj > 0 ? 1 : -1;
      adj = 240 - Object.values(obj).reduce((a, b) => a + b, 0);
      i = (i + 1) % keys.length;
    }

    return { sorted: starters, obj };
  };

  // --- Hooks ---
  useEffect(() => {
    if (!selectedTeam) return;
    const key = `gameplan_${selectedTeam.name}`;
    const saved = localStorage.getItem(key);
    const teamPlayers = selectedTeam.players || [];

    if (saved) {
      const obj = JSON.parse(saved);
      setMinutes(obj);
      setPlayers([...teamPlayers]);
      setTeamRatings(calculateTeamRatings(teamPlayers, obj));
    } else {
      const { sorted, obj } = buildSmartRotation(teamPlayers);
      setMinutes(obj);
      setPlayers(sorted);
      setTeamRatings(calculateTeamRatings(sorted, obj));
    }
  }, [selectedTeam]);

  const handleSave = () => {
    if (!selectedTeam) return;
    localStorage.setItem(`gameplan_${selectedTeam.name}`, JSON.stringify(minutes));
    setToast(true);
    setTimeout(() => setToast(false), 2000);
  };

  const handleAutoRebuild = () => {
    const { sorted, obj } = buildSmartRotation(selectedTeam.players);
    setPlayers(sorted);
    setMinutes(obj);
    setTeamRatings(calculateTeamRatings(sorted, obj));
  };

  const handleMinuteChange = (name, value) => {
    const num = Math.round(Number(value));
    const totalNow = Object.entries(minutes)
      .filter(([k]) => k !== name)
      .reduce((a, [, v]) => a + v, 0);
    if (totalNow + num > 240) return;
    const updated = { ...minutes, [name]: num };
    setMinutes(updated);
    setTeamRatings(calculateTeamRatings(players, updated));
  };

  const handleSquareClick = (player) => {
    if (!swapSelection) setSwapSelection(player);
    else if (swapSelection.name === player.name) setSwapSelection(null);
    else {
      const p1 = swapSelection, p2 = player;
      setPlayers((prev) => {
        const arr = [...prev];
        const i1 = arr.findIndex((x) => x.name === p1.name);
        const i2 = arr.findIndex((x) => x.name === p2.name);
        if (i1 !== -1 && i2 !== -1) [arr[i1], arr[i2]] = [arr[i2], arr[i1]];
        return arr;
      });
      setMinutes((prev) => {
        const m = { ...prev };
        [m[p1.name], m[p2.name]] = [m[p2.name], m[p1.name]];
        return m;
      });
      setSwapSelection(null);
      setTeamRatings(calculateTeamRatings(players, minutes));
    }
  };

  // --- Fallback when no team selected ---
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

  // --- Defensive fallback for player object ---
  const player =
    selectedPlayer ||
    (players && players[0]) || {
      name: "Loading...",
      pos: "",
      secondaryPos: "",
      age: "",
      overall: 0,
      headshot: "",
    };

  const total = Object.values(minutes).reduce((a, b) => a + b, 0);
  const remaining = Math.max(0, 240 - total);
  const fillPercent = Math.min(player.overall / 99, 1);
  const circleCircumference = 2 * Math.PI * 50;
  const strokeOffset = circleCircumference * (1 - fillPercent);
  const lineupLabels = ["PG", "SG", "SF", "PF", "C", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"];

  return (
    <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center py-10">
      {toast && (
        <div className="fixed top-6 right-6 bg-neutral-800 border border-orange-500 text-orange-400 px-5 py-2 rounded-lg shadow-lg animate-pulse">
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
          <div className="flex items-end justify-between">
            <div className="flex items-end gap-6">
              <img
                src={player.headshot}
                alt={player.name}
                className="h-[175px] w-auto object-contain -mb-[9px]"
              />
              <div className="flex flex-col justify-end mb-3">
                <h2 className="text-[44px] font-bold leading-tight">{player.name}</h2>
                <p className="text-gray-400 text-[24px] mt-1">
                  {player.pos}
                  {player.secondaryPos ? ` / ${player.secondaryPos}` : ""} • Age{" "}
                  {player.age}
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
          <div className="flex justify-between items-center mb-4 text-gray-300 text-lg font-semibold">
            <span>
              Total: {total} / 240{" "}
              <span className={remaining > 0 ? "text-orange-400" : "text-gray-400"}>
                • Remaining: {remaining} min
              </span>
            </span>
            <div className="flex gap-6">
              <span className="text-white">Team Overall:</span>
              <span>
                OVR <span className="text-orange-400">{teamRatings.overall}</span>
              </span>
              <span>
                OFF <span className="text-orange-400">{teamRatings.off}</span>
              </span>
              <span>
                DEF <span className="text-orange-400">{teamRatings.def}</span>
              </span>
            </div>
          </div>

          <div className="overflow-y-auto max-h-[480px]">
            <table className="w-full border-collapse text-left">
              <thead className="text-gray-400 text-[15px] border-b border-gray-700">
                <tr>
                  <th className="py-2 w-[60px]"></th>
                  <th className="py-2 text-center">POS</th>
                  <th className="py-2">Player</th>
                  <th className="py-2 text-center">OVR</th>
                  <th className="py-2 text-center">Minutes</th>
                </tr>
              </thead>
              <tbody className="text-[16px]">
                {players.map((p, i) => (
                  <tr
                    key={p.name}
                    onClick={() => setSelectedPlayer(p)}
                    className={`cursor-pointer transition ${
                      selectedPlayer?.name === p.name
                        ? "bg-orange-600 text-white"
                        : i < 5
                        ? "bg-neutral-850"
                        : "hover:bg-neutral-700"
                    }`}
                  >
                    <td className="text-center">
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSquareClick(p);
                        }}
                        className={`w-5 h-5 mx-auto border-2 rounded-sm cursor-pointer transition ${
                          swapSelection?.name === p.name
                            ? "bg-orange-500 border-orange-400"
                            : "border-white"
                        }`}
                      ></div>
                    </td>
                    <td className="text-center font-semibold">
                      {lineupLabels[i] || i + 1}
                    </td>
                    <td className="py-2 font-semibold">
                      {p.name}
                      <span className="text-[#bfbfbf] text-sm ml-2">
                        {p.pos}
                        {p.secondaryPos ? ` / ${p.secondaryPos}` : ""}
                      </span>
                    </td>
                    <td className="text-center text-orange-400 font-bold">{p.overall}</td>
                    <td className="text-center w-[250px]">
                      <div className="flex items-center gap-3 justify-center">
                        <input
                          type="range"
                          min="0"
                          max="48"
                          step="1"
                          value={minutes[p.name] ?? 0}
                          onChange={(e) => handleMinuteChange(p.name, e.target.value)}
                          className="w-[160px] accent-white"
                        />
                        <span className="w-[50px] text-gray-200 text-sm">
                          {Math.round(minutes[p.name] ?? 0)}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-4 mt-6">
            <button
              onClick={handleAutoRebuild}
              className="px-5 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg font-semibold transition"
            >
              Auto Rebuild Rotation
            </button>
            <button
              onClick={handleSave}
              disabled={total < 240}
              className={`px-5 py-2 rounded-lg font-semibold transition ${
                total < 240
                  ? "bg-neutral-700 text-gray-500 cursor-not-allowed"
                  : "bg-orange-600 hover:bg-orange-500"
              }`}
            >
              Save Gameplan
            </button>
            <button
              onClick={() => navigate("/team-hub")}
              disabled={total < 240}
              className={`px-5 py-2 rounded-lg font-semibold transition ${
                total < 240
                  ? "bg-neutral-700 text-gray-500 cursor-not-allowed"
                  : "bg-neutral-700 hover:bg-neutral-600"
              }`}
            >
              Back to Team Hub
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
