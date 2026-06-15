import {
  GAMEPLAN_VERSION,
  rebuildSingleTeamGameplan,
  getRosterSignatureForGameplan,
  buildSmartRotation,
} from "../utils/ensureGameplans";
import { computeTeamRatings } from "../api/teamRatings";
import React, { useState, useEffect, useMemo } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";
import PageFade from "../components/PageFade";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";

const STARTER_MINUTES = 24;

function getRosterSignature(teamPlayers = []) {
    return [...teamPlayers]
        .map((p) =>
            [
                p.name || "",
                p.pos || "",
                p.secondaryPos || "",
                p.overall || 0,
            ].join("|")
        )
        .sort()
        .join("||");
}

function buildGameplanPayload(teamName, teamPlayers, sortedPlayers, minutesObj, options = {}) {
    const orderedMinutes = {};
    for (const p of sortedPlayers) {
        orderedMinutes[p.name] = Number(minutesObj[p.name] || 0);
    }
    for (const p of teamPlayers) {
        if (!(p.name in orderedMinutes)) {
            orderedMinutes[p.name] = Number(minutesObj[p.name] || 0);
        }
    }

    const source = options.source || "coach_gameplan";
    const manualLocked = options.manualLocked ?? source === "coach_gameplan";
    const userEdited = options.userEdited ?? source === "coach_gameplan";

    return {
        version: GAMEPLAN_VERSION,
        teamName,
        rosterSignature: getRosterSignature(teamPlayers),
        order: sortedPlayers.map((p) => p.name),
        minutes: orderedMinutes,
        manualLocked,
        userEdited,
        source,
        updatedAt: Date.now(),
    };
}

function saveGameplanToStorage(teamName, teamPlayers, sortedPlayers, minutesObj, options = {}) {
    if (!teamName) return;

    const payload = buildGameplanPayload(
        teamName,
        teamPlayers,
        sortedPlayers,
        minutesObj,
        options
    );

    localStorage.setItem(`gameplan_${teamName}`, JSON.stringify(payload));
}

function readGameplanFromStorage(teamName) {
    if (!teamName) return null;

    const raw = localStorage.getItem(`gameplan_${teamName}`);
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch (e) {
        console.warn("Bad saved gameplan, ignoring:", e);
        return null;
    }
}
    export default function CoachGameplan() {
    const { leagueData, selectedTeam, setSelectedTeam } = useGame(); // ⬅️ added leagueData + setSelectedTeam
    const [players, setPlayers] = useState([]);
    const [minutes, setMinutes] = useState({});
    const [selectedPlayer, setSelectedPlayer] = useState(null);
    const [swapSelection, setSwapSelection] = useState(null);
    const [toast, setToast] = useState(false);
    const [teamRatings, setTeamRatings] = useState({ overall: 0, off: 0, def: 0 });
    const navigate = useNavigate();

    // ---------- Team list + index for static arrows ----------
    const allTeams = useMemo(() => {
        if (!leagueData?.conferences) return [];
        const confs = Object.values(leagueData.conferences);
        return confs.flat().sort((a, b) => a.name.localeCompare(b.name));
    }, [leagueData]);
    const currentIndex = useMemo(() => {
        if (!selectedTeam) return -1;
        return allTeams.findIndex((t) => t.name === selectedTeam.name);
    }, [allTeams, selectedTeam]);

    const handleTeamSwitch = (dir) => {
        if (!allTeams.length || currentIndex < 0) return;
        const next =
        dir === "next"
            ? (currentIndex + 1) % allTeams.length
            : (currentIndex - 1 + allTeams.length) % allTeams.length;
        setSelectedTeam(allTeams[next]);
        setSelectedPlayer(null);
        setSwapSelection(null);
    };

    // --- Helper functions ---
    const calculateTeamRatings = (playersArr, minutesObj) => {
  try {
    // exact parity with the sim: pass a team-like object with a players field
    const out = computeTeamRatings({ players: playersArr }, minutesObj);
    return { overall: out.overall, off: out.off, def: out.def };
  } catch (e) {
    console.warn("calcTeamRatings fallback:", e);
    return { overall: 0, off: 0, def: 0 };
  }
};


    const enforceStarterMinimums = (arr, minsObj) => {
        const updated = { ...minsObj };
        let added = 0;

        for (let i = 0; i < Math.min(5, arr.length); i++) {
        const nm = arr[i].name;
        const current = Number(updated[nm] || 0);
        if (current < STARTER_MINUTES) {
            updated[nm] = STARTER_MINUTES;
            added += STARTER_MINUTES - current;
        }
        }
        if (added === 0) return updated;

        const bench = arr.slice(5).sort((a, b) => (updated[b.name] || 0) - (updated[a.name] || 0));
        let remain = added;
        for (const p of bench) {
        if (remain <= 0) break;
        const take = Math.min(updated[p.name] || 0, remain);
        if (take > 0) {
            updated[p.name] -= take;
            remain -= take;
        }
        }
        if (remain > 0) {
        const starters = arr.slice(0, 5).sort((a, b) => (updated[b.name] || 0) - (updated[a.name] || 0));
        for (const p of starters) {
            if (remain <= 0) break;
            const extra = Math.max(0, (updated[p.name] || 0) - STARTER_MINUTES);
            const take = Math.min(extra, remain);
            if (take > 0) {
            updated[p.name] -= take;
            remain -= take;
            }
        }
        }
        return updated;
    };

    // --- Load + build on team change ---
useEffect(() => {
  if (!selectedTeam) return;

  const key = `gameplan_${selectedTeam.name}`;
  const raw = localStorage.getItem(key);
  const teamPlayers = selectedTeam.players || [];
  const currentRosterSignature = getRosterSignatureForGameplan(teamPlayers);

  let loaded = false;

  if (raw) {
    try {
      const saved = JSON.parse(raw);

      const isNewFormat =
        saved &&
        typeof saved === "object" &&
        saved.minutes &&
        Array.isArray(saved.order);

      if (
        isNewFormat &&
        saved.version === GAMEPLAN_VERSION &&
        saved.rosterSignature === currentRosterSignature
      ) {
        const orderedPlayers = [
          ...saved.order
            .map((name) => teamPlayers.find((p) => p.name === name))
            .filter(Boolean),
          ...teamPlayers.filter((p) => !saved.order.includes(p.name)),
        ];

        const normalizedMinutes = {};
        for (const p of teamPlayers) {
          normalizedMinutes[p.name] = Number(saved.minutes?.[p.name] || 0);
        }

        setMinutes(normalizedMinutes);
        setPlayers(orderedPlayers);
        setTeamRatings(calculateTeamRatings(orderedPlayers, normalizedMinutes));
        loaded = true;
      }
    } catch (e) {
      console.warn("Bad saved gameplan:", e);
    }
  }

  if (!loaded) {
    rebuildSingleTeamGameplan(selectedTeam, { preserveManual: false });

    const freshRaw = localStorage.getItem(key);
    if (!freshRaw) return;

    try {
      const fresh = JSON.parse(freshRaw);

      const orderedPlayers = [
        ...fresh.order
          .map((name) => teamPlayers.find((p) => p.name === name))
          .filter(Boolean),
        ...teamPlayers.filter((p) => !fresh.order.includes(p.name)),
      ];

      const normalizedMinutes = {};
      for (const p of teamPlayers) {
        normalizedMinutes[p.name] = Number(fresh.minutes?.[p.name] || 0);
      }

      setMinutes(normalizedMinutes);
      setPlayers(orderedPlayers);
      setTeamRatings(calculateTeamRatings(orderedPlayers, normalizedMinutes));
    } catch (e) {
      console.warn("Failed loading rebuilt gameplan:", e);
    }
  }
}, [selectedTeam]);

const getMinutesTotal = (minutesObj) => {
  return Object.values(minutesObj || {}).reduce((sum, value) => {
    return sum + Number(value || 0);
  }, 0);
};

const persistCurrentGameplan = (nextPlayers = players, nextMinutes = minutes, showToast = false) => {
  if (!selectedTeam?.name) return false;
  if (getMinutesTotal(nextMinutes) !== 240) return false;

  saveGameplanToStorage(
    selectedTeam.name,
    selectedTeam.players || [],
    nextPlayers,
    nextMinutes
  );

  if (showToast) {
    setToast(true);
    setTimeout(() => setToast(false), 2000);
  }

  return true;
};

const handleSave = () => {
  persistCurrentGameplan(players, minutes, true);
};


const handleAutoRebuild = () => {
    if (!selectedTeam) return;

    const teamPlayers = selectedTeam.players || [];
    const { sorted, obj } = buildSmartRotation(teamPlayers);

    setPlayers(sorted);
    setMinutes(obj);
    setTeamRatings(calculateTeamRatings(sorted, obj));

    // Auto rebuild should not be protected as a manual/user-edited gameplan.
    saveGameplanToStorage(selectedTeam.name, teamPlayers, sorted, obj, {
        manualLocked: false,
        userEdited: false,
        source: "auto_rotation",
    });
};

    const handleMinuteChange = (name, value) => {
        const numRaw = Math.round(Number(value));
        const idx = players.findIndex((p) => p.name === name);
        const minAllowed = idx > -1 && idx < 5 ? STARTER_MINUTES : 0;
        const num = Math.max(minAllowed, numRaw);

        const totalNow = Object.entries(minutes)
        .filter(([k]) => k !== name)
        .reduce((a, [, v]) => a + Number(v || 0), 0);
        if (totalNow + num > 240) return;

        const updated = { ...minutes, [name]: num };
        setMinutes(updated);
        setTeamRatings(calculateTeamRatings(players, updated));
        persistCurrentGameplan(players, updated, false);
    };

    const handleSquareClick = (player) => {
        if (!swapSelection) {
        setSwapSelection(player);
        } else if (swapSelection.name === player.name) {
        setSwapSelection(null);
        } else {
        const p1 = swapSelection, p2 = player;
        const arr = [...players];
        const i1 = arr.findIndex((x) => x.name === p1.name);
        const i2 = arr.findIndex((x) => x.name === p2.name);

        if (i1 !== -1 && i2 !== -1) {
            [arr[i1], arr[i2]] = [arr[i2], arr[i1]];
        }

        const adjusted = enforceStarterMinimums(arr, minutes);
        setPlayers(arr);
        setMinutes(adjusted);
        setTeamRatings(calculateTeamRatings(arr, adjusted));
        persistCurrentGameplan(arr, adjusted, false);
        setSwapSelection(null);
        }
    };

    if (!selectedTeam)
        return (
        <div className="flex flex-col items-center justify-center min-h-screen bmCourtPage text-white">
            <p>No team selected.</p>
            <button
            onClick={() => navigate("/team-selector")}
            className="mt-4 px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg"
            >
            Back to Team Select
            </button>
        </div>
        );

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
    const circleCircumference = 2 * Math.PI * 50;
    const fillPercent = Math.min(player.overall / 99, 1);
    const strokeOffset = circleCircumference * (1 - fillPercent);
    const lineupLabels = ["PG", "SG", "SF", "PF", "C", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"];

    return (
    <PageFade>
        <div className="min-h-screen bmCourtPage text-white flex flex-col items-center py-10">
        {toast && (
            <div className="fixed top-6 right-6 bg-neutral-800 border border-orange-500 text-orange-400 px-5 py-2 rounded-lg shadow-lg animate-pulse">
            Gameplan saved!
            </div>
        )}

        {/* Static header with pinned arrows (never shifts) */}
        <div className="w-full max-w-5xl flex items-center justify-between mb-6 select-none">
            <div className="w-24 flex items-center justify-start">
            <button
                onClick={() => handleTeamSwitch("prev")}
                disabled={!allTeams.length}
                className={`text-4xl font-bold transition-transform active:scale-90 ${
                allTeams.length ? "text-white hover:text-orange-400" : "text-neutral-600 cursor-not-allowed"
                }`}
                title="Prev team"
            >
                ◄
            </button>
            </div>

            <h1 className="text-3xl md:text-4xl font-extrabold text-orange-500 text-center">
            {selectedTeam.name} – Coach Gameplan
            </h1>

            <div className="w-24 flex items-center justify-end">
            <button
                onClick={() => handleTeamSwitch("next")}
                disabled={!allTeams.length}
                className={`text-4xl font-bold transition-transform active:scale-90 ${
                allTeams.length ? "text-white hover:text-orange-400" : "text-neutral-600 cursor-not-allowed"
                }`}
                title="Next team"
            >
                ►
            </button>
            </div>
        </div>

        {/* Player Card */}
        <div className="relative w-full flex justify-center mb-0">
            <div className="relative bmSolidPanel w-full max-w-5xl px-8 pt-8 pb-3 rounded-t-xl shadow-lg">
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
            <div className="w-full max-w-5xl bmSolidPanel rounded-b-xl p-6 shadow-lg">
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
                onClick={() => {
                    persistCurrentGameplan(players, minutes, false);
                    navigate("/team-hub");
                }}
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
    
    </PageFade>
  );
    }
