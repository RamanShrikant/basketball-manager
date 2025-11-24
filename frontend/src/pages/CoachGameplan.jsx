    import { computeTeamRatings as engineTeamRatings } from "../api/simEngine";
    import React, { useState, useEffect, useMemo } from "react";
    import { useGame } from "../context/GameContext";
    import { useNavigate } from "react-router-dom";
    

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
    const fatiguePenalty = (mins, stamina) => {
        const threshold = 0.359 * stamina + 2.46;
        const over = Math.max(0, mins - threshold);
        return Math.max(0.7, 1 - 0.0075 * over);
    };

    const calculateTeamRatings = (playersArr, minutesObj) => {
  try {
    // exact parity with the sim: pass a team-like object with a players field
    const out = engineTeamRatings({ players: playersArr }, minutesObj);
    return { overall: out.overall, off: out.off, def: out.def };
  } catch (e) {
    console.warn("calcTeamRatings fallback:", e);
    return { overall: 0, off: 0, def: 0 };
  }
};


    // === AUTO-SORT – parity with the Python "average OVR w/ primary preference" ===
    const buildSmartRotation = (teamPlayers) => {
        const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
        const valid = (teamPlayers || []).filter(
        (p) => p && p.name && Number.isFinite(p.overall)
        );
        if (valid.length === 0) return { sorted: [], obj: {} };

        const score = (p) => (p.overall || 0) + ((p.stamina || 70) - 70) * 0.15;

        // ---- choose ~10 and baseline minutes (unchanged from your version) ----
        const chosen = [];
        for (const pos of POSITIONS) {
        const posPlayers = valid
            .filter((p) => p.pos === pos || p.secondaryPos === pos)
            .sort((a, b) => score(b) - score(a));
        if (posPlayers.length) {
            const best = posPlayers[0];
            if (!chosen.find((c) => c.name === best.name)) chosen.push(best);
        }
        }
        for (const p of [...valid].sort((a, b) => score(b) - score(a))) {
        if (chosen.length >= Math.min(10, valid.length)) break;
        if (!chosen.find((c) => c.name === p.name)) chosen.push(p);
        }

        const work = chosen.map((p) => ({ ...p, minutes: 0 }));

        // give everyone minutes, then smooth (unchanged)
        for (const w of work) w.minutes = 12;
        let remain = 240 - 12 * work.length;
        let i = 0;
        while (remain > 0 && work.length > 0) {
        work[i % work.length].minutes += 1;
        i++;
        remain--;
        }

        const teamTotal = (arr) => {
        let off = 0, deff = 0, ovr = 0;
        const posTot = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
        for (const p of arr) {
            const m = p.minutes || 0;
            if (m <= 0) continue;
            const pen = fatiguePenalty(m, p.stamina || 70);
            const w = m / 240;
            off += w * ((p.offRating || 0) * pen);
            deff += w * ((p.defRating || 0) * pen);
            ovr += w * ((p.overall || 0) * pen);
            if (p.pos) posTot[p.pos] += m;
            if (p.secondaryPos) posTot[p.secondaryPos] += m * 0.2;
        }
        const missing =
            Math.max(0, 48 - (posTot.PG || 0)) +
            Math.max(0, 48 - (posTot.SG || 0)) +
            Math.max(0, 48 - (posTot.SF || 0)) +
            Math.max(0, 48 - (posTot.PF || 0)) +
            Math.max(0, 48 - (posTot.C  || 0));
        const coveragePenalty = 1 - 0.02 * (missing / 240);
        return { off: off * coveragePenalty, deff: deff * coveragePenalty, ovr: ovr * coveragePenalty };
        };

        // small minute hill-climb (unchanged)
        const coreSet = new Set(work.slice(0, 5).map((p) => p.name));
        let improved = true;
        while (improved) {
        improved = false;
        let base = teamTotal(work).ovr;

        for (let a = 0; a < work.length; a++) {
            for (let b = 0; b < work.length; b++) {
            if (a === b) continue;
            const A = work[a], B = work[b];
            if ((A.minutes || 0) <= 12) continue;
            if ((B.minutes || 0) >= 24 && !coreSet.has(B.name)) continue;

            A.minutes -= 1;
            B.minutes += 1;

            const test = teamTotal(work).ovr;
            if (test > base) {
                base = test;
                improved = true;
            } else {
                A.minutes += 1;
                B.minutes -= 1;
            }
            }
        }
        }

        // --- Python parity: starters chosen by MAX AVERAGE OVR with primary bonus & secondary penalty
        const permute = (arr) => {
        const out = [];
        const rec = (path, rest) => {
            if (rest.length === 0) { out.push(path.slice()); return; }
            for (let i = 0; i < rest.length; i++) {
            path.push(rest[i]);
            rec(path, [...rest.slice(0, i), ...rest.slice(i + 1)]);
            path.pop();
            }
        };
        rec([], arr.slice());
        return out;
        };
        const combos = (arr, k) => {
        const res = [];
        const go = (start, path) => {
            if (path.length === k) { res.push(path.slice()); return; }
            for (let i = start; i < arr.length; i++) {
            path.push(arr[i]);
            go(i + 1, path);
            path.pop();
            }
        };
        go(0, []);
        return res;
        };

        const posPerms = permute(POSITIONS);
        let bestMap = null, bestScore = -Infinity;

        const PRIMARY_BONUS = 0.02; // tiny nudge toward primaries
        const SECONDARY_PEN = 0.01; // tiny nudge against secondaries

        for (const five of combos(work, Math.min(5, work.length))) {
        for (const perm of posPerms) {
            let ok = true;
            let primaryHits = 0;
            let secUses = 0;
            let sumOvr = 0;
            const mapping = {};
            for (let k = 0; k < five.length; k++) {
            const pl = five[k], pos = perm[k];
            const eligible = (pl.pos === pos) || (pl.secondaryPos === pos);
            if (!eligible) { ok = false; break; }
            mapping[pos] = pl;
            sumOvr += (pl.overall || 0);
            if (pos === pl.pos) primaryHits += 1;
            else if (pl.secondaryPos === pos) secUses += 1;
            }
            if (!ok) continue;
            const avgOvr = sumOvr / 5;
            const score = avgOvr + PRIMARY_BONUS * primaryHits - SECONDARY_PEN * secUses;
            if (score > bestScore) { bestScore = score; bestMap = mapping; }
        }
        }

        if (!bestMap) {
        const top5 = [...work].sort((a, b) => (b.overall || 0) - (a.overall || 0)).slice(0, 5);
        bestMap = {};
        const POS = ["PG", "SG", "SF", "PF", "C"];
        for (let i = 0; i < POS.length; i++) if (top5[i]) bestMap[POS[i]] = top5[i];
        }

        const starters = ["PG", "SG", "SF", "PF", "C"].map((p) => bestMap[p]).filter(Boolean);
        const starterIds = new Set(starters.map((p) => p.name));
        const bench = work
        .filter((p) => !starterIds.has(p.name))
        .sort((a, b) => (b.minutes || 0) - (a.minutes || 0));
        const usedNames = new Set(work.map((w) => w.name));
        const others = valid.filter((p) => !usedNames.has(p.name));
        const sorted = [...starters, ...bench, ...others];

        // minutes remain exactly as allocated above (Python parity)
        const obj = {};
        for (const p of sorted) obj[p.name] = p.minutes || 0;
        for (const p of valid) if (!(p.name in obj)) obj[p.name] = 0;

        return { sorted, obj };
    };

    const enforceStarterMinimums = (arr, minsObj) => {
        const updated = { ...minsObj };
        let added = 0;

        for (let i = 0; i < Math.min(5, arr.length); i++) {
        const nm = arr[i].name;
        if ((updated[nm] ?? 0) < 1) {
            updated[nm] = 1;
            added += 1;
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
            const extra = Math.max(0, (updated[p.name] || 0) - 1);
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
        const saved = localStorage.getItem(key);
        const teamPlayers = selectedTeam.players || [];

if (saved) {
    const obj = JSON.parse(saved);

    // Always rebuild sorted ordering using minutes
    const sortedNames = Object.keys(obj);

    const sortedPlayers = sortedNames
        .map(name => teamPlayers.find(p => p.name === name))
        .filter(Boolean);

    // fallback in case order mismatch
    const missing = teamPlayers.filter(p => !sortedNames.includes(p.name));
    const finalSorted = [...sortedPlayers, ...missing];

    setMinutes(obj);
    setPlayers(finalSorted);
    setTeamRatings(calculateTeamRatings(finalSorted, obj));
}
 else {
        const { sorted, obj } = buildSmartRotation(teamPlayers);
        setMinutes(obj);
        setPlayers(sorted);
        setTeamRatings(calculateTeamRatings(sorted, obj));
        }
    }, [selectedTeam]); // switching teams auto-loads

const handleSave = () => {
    if (!selectedTeam) return;

    setMinutes(prev => {
        localStorage.setItem(
            `gameplan_${selectedTeam.name}`,
            JSON.stringify(prev)
        );
        return prev;
    });

    setToast(true);
    setTimeout(() => setToast(false), 2000);
};


    const handleAutoRebuild = () => {
        if (!selectedTeam) return;
        const { sorted, obj } = buildSmartRotation(selectedTeam.players);
        setPlayers(sorted);
        setMinutes(obj);
        setTeamRatings(calculateTeamRatings(sorted, obj));
    };

    const handleMinuteChange = (name, value) => {
        const numRaw = Math.round(Number(value));
        const idx = players.findIndex((p) => p.name === name);
        const minAllowed = idx > -1 && idx < 5 ? 1 : 0;
        const num = Math.max(minAllowed, numRaw);

        const totalNow = Object.entries(minutes)
        .filter(([k]) => k !== name)
        .reduce((a, [, v]) => a + v, 0);
        if (totalNow + num > 240) return;

        const updated = { ...minutes, [name]: num };
        setMinutes(updated);
        setTeamRatings(calculateTeamRatings(players, updated));
    };

    const handleSquareClick = (player) => {
        if (!swapSelection) {
        setSwapSelection(player);
        } else if (swapSelection.name === player.name) {
        setSwapSelection(null);
        } else {
        const p1 = swapSelection, p2 = player;
        let newPlayers = [];
        setPlayers((prev) => {
            const arr = [...prev];
            const i1 = arr.findIndex((x) => x.name === p1.name);
            const i2 = arr.findIndex((x) => x.name === p2.name);
            if (i1 !== -1 && i2 !== -1) [arr[i1], arr[i2]] = [arr[i2], arr[i1]];
            newPlayers = arr;
            return arr;
        });

        setMinutes((prev) => {
            const adjusted = enforceStarterMinimums(newPlayers.length ? newPlayers : players, prev);
            setTeamRatings(calculateTeamRatings(newPlayers.length ? newPlayers : players, adjusted));
            return adjusted;
        });

        setSwapSelection(null);
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
        <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center py-10">
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
                            min={i < 5 ? 1 : 0}
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
