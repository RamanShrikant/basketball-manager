import {
  GAMEPLAN_VERSION,
  rebuildSingleTeamGameplan,
  getRosterSignatureForGameplan,
  buildSmartRotation,
  buildFullTeamRating,
  calculateTeamPotentialRating,
} from "../utils/ensureGameplans";
import {
  formatInjuryReturnLabel,
  isPlayerInjured,
  rebuildTeamGameplanForAvailability,
} from "../utils/injurySystem.js";
import { readLeagueClock } from "../utils/leagueClock.js";
import { computeTeamRatings } from "../api/teamRatings";
import React, { useState, useEffect, useMemo } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";
import PageFade from "../components/PageFade";
import PlayerPortraitFrame from "../components/PlayerPortraitFrame";
import PlayerRatingRing from "../components/PlayerRatingRing.jsx";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";
import useKeyboardListNavigation from "../utils/useKeyboardListNavigation.js";
import useKeyboardTeamNavigation from "../utils/useKeyboardTeamNavigation.js";
import { playSound, SOUND_KEYS } from "../audio/soundManager.js";

const MANUAL_STARTER_MINUTES = 1;
const MANUAL_STARTER_MAX_MINUTES = 48;
const MANUAL_BENCH_MINUTES = 0;
const MANUAL_BENCH_MAX_MINUTES = 47;

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
    const { leagueData, selectedTeam: controlledTeam } = useGame();
    const [players, setPlayers] = useState([]);
    const [minutes, setMinutes] = useState({});
    const [selectedPlayer, setSelectedPlayer] = useState(null);
    const [swapSelection, setSwapSelection] = useState(null);
    const [toast, setToast] = useState(false);
    const [teamRatings, setTeamRatings] = useState({
        overall: 0,
        off: 0,
        def: 0,
        exactOverall: 0,
        exactOff: 0,
        exactDef: 0,
    });
    const [ftrRatings, setFtrRatings] = useState({
        ftr: 0,
        exactFtr: 0,
        ftrOff: 0,
        ftrDef: 0,
        exactFtrOff: 0,
        exactFtrDef: 0,
    });
    const [potRatings, setPotRatings] = useState({
        pot: 0,
        exactPot: 0,
    });
    const [showRatingDetails, setShowRatingDetails] = useState(false);
    const navigate = useNavigate();

    useKeyboardListNavigation({
        items: players,
        selectedItem: selectedPlayer,
        onSelect: setSelectedPlayer,
        enabled: !showRatingDetails,
        getKey: (row) => row?.id || row?.playerId || row?.name,
    });

    // ---------- Team list + index for static arrows ----------
    const allTeams = useMemo(() => {
        if (!leagueData?.conferences) return [];
        const confs = Object.values(leagueData.conferences);
        return confs.flat().sort((a, b) => a.name.localeCompare(b.name));
    }, [leagueData]);
    const [viewTeamName, setViewTeamName] = useState(null);

    useEffect(() => {
        if (controlledTeam?.name) setViewTeamName(controlledTeam.name);
    }, [controlledTeam?.name]);

    const selectedTeam = useMemo(() => {
        const targetName = viewTeamName || controlledTeam?.name;
        return allTeams.find((t) => t.name === targetName) || controlledTeam || allTeams[0] || null;
    }, [allTeams, viewTeamName, controlledTeam]);

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
        setViewTeamName(allTeams[next]?.name || null);
        setSelectedPlayer(null);
        setSwapSelection(null);
    };

    useKeyboardTeamNavigation({
        enabled: allTeams.length > 1,
        onPrevious: () => handleTeamSwitch("prev"),
        onNext: () => handleTeamSwitch("next"),
    });

    // --- Helper functions ---
    const calculateTeamRatings = (playersArr, minutesObj) => {
  try {
    // exact parity with the sim: pass a team-like object with a players field
    const out = computeTeamRatings({ players: playersArr }, minutesObj);
    return {
      overall: out.overall,
      off: out.off,
      def: out.def,
      exactOverall: out.exactOverall ?? out.overall ?? 0,
      exactOff: out.exactOff ?? out.off ?? 0,
      exactDef: out.exactDef ?? out.def ?? 0,
    };
  } catch (e) {
    console.warn("calcTeamRatings fallback:", e);
    return { overall: 0, off: 0, def: 0, exactOverall: 0, exactOff: 0, exactDef: 0 };
  }
};

    const calculateFullTeamRating = (playersArr) => {
  try {
    return buildFullTeamRating(playersArr || []);
  } catch (e) {
    console.warn("calcFullTeamRating fallback:", e);
    return {
      ftr: 0,
      exactFtr: 0,
      ftrOff: 0,
      ftrDef: 0,
      exactFtrOff: 0,
      exactFtrDef: 0,
    };
  }
};

    const calculatePotentialRating = (playersArr) => {
  try {
    return calculateTeamPotentialRating(playersArr || []);
  } catch (e) {
    console.warn("calcPotentialRating fallback:", e);
    return { pot: 0, exactPot: 0 };
  }
};


    const clampManualMinutesForOrder = (arr, minsObj) => {
        const updated = {};
        const originalTotal = getMinutesTotal(minsObj);
        const minRequired = Math.min(5, arr.length) * MANUAL_STARTER_MINUTES;
        const targetTotal = Math.min(240, Math.max(minRequired, originalTotal));

        for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        const raw = Math.round(Number(minsObj?.[p.name] || 0));
        const minAllowed = i < 5 ? MANUAL_STARTER_MINUTES : MANUAL_BENCH_MINUTES;
        const maxAllowed = i < 5 ? MANUAL_STARTER_MAX_MINUTES : MANUAL_BENCH_MAX_MINUTES;
        updated[p.name] = Math.max(minAllowed, Math.min(maxAllowed, raw));
        }

        let total = getMinutesTotal(updated);

        if (total > targetTotal) {
        let extra = total - targetTotal;
        const reducePool = [...arr].sort((a, b) => {
            const ia = arr.findIndex((x) => x.name === a.name);
            const ib = arr.findIndex((x) => x.name === b.name);
            const minA = ia < 5 ? MANUAL_STARTER_MINUTES : MANUAL_BENCH_MINUTES;
            const minB = ib < 5 ? MANUAL_STARTER_MINUTES : MANUAL_BENCH_MINUTES;
            return (updated[b.name] - minB) - (updated[a.name] - minA);
        });

        for (const p of reducePool) {
            if (extra <= 0) break;
            const idx = arr.findIndex((x) => x.name === p.name);
            const minAllowed = idx < 5 ? MANUAL_STARTER_MINUTES : MANUAL_BENCH_MINUTES;
            const canTake = Math.max(0, updated[p.name] - minAllowed);
            const take = Math.min(canTake, extra);
            if (take > 0) {
            updated[p.name] -= take;
            extra -= take;
            }
        }
        }

        total = getMinutesTotal(updated);

        if (total < targetTotal) {
        let missing = targetTotal - total;
        const addPool = [...arr].sort((a, b) => (b.overall || 0) - (a.overall || 0));

        for (const p of addPool) {
            if (missing <= 0) break;
            const idx = arr.findIndex((x) => x.name === p.name);
            const maxAllowed = idx < 5 ? MANUAL_STARTER_MAX_MINUTES : MANUAL_BENCH_MAX_MINUTES;
            const room = Math.max(0, maxAllowed - updated[p.name]);
            const add = Math.min(room, missing);
            if (add > 0) {
            updated[p.name] += add;
            missing -= add;
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
  const currentDate = readLeagueClock()?.date || null;
  const teamPlayers = selectedTeam.players || [];
  const currentRosterSignature = getRosterSignatureForGameplan(teamPlayers);
  setPotRatings(calculatePotentialRating(teamPlayers));
  setFtrRatings(calculateFullTeamRating(teamPlayers));

  let loaded = false;

  if (raw) {
    try {
      const saved = JSON.parse(raw);

      const isNewFormat =
        saved &&
        typeof saved === "object" &&
        saved.minutes &&
        Array.isArray(saved.order);

      const isManualSaved = Boolean(
        saved?.manualLocked ||
          saved?.userEdited ||
          saved?.source === "coach_gameplan"
      );

      const injuryUnsafe = isNewFormat && teamPlayers.some((p) => {
        if (!isPlayerInjured(p, currentDate)) return false;
        return Number(saved.minutes?.[p.name] || 0) > 0 || (saved.order || []).slice(0, 5).includes(p.name);
      });

      if (
        isNewFormat &&
        !injuryUnsafe &&
        (saved.version === GAMEPLAN_VERSION || isManualSaved) &&
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
          normalizedMinutes[p.name] = isPlayerInjured(p, currentDate) ? 0 : Number(saved.minutes?.[p.name] || 0);
        }

        setMinutes(normalizedMinutes);
        setPlayers(orderedPlayers);
        setTeamRatings(calculateTeamRatings(orderedPlayers, normalizedMinutes));

        // If a user manually edited a rotation on an older auto-rotation
        // version, keep it instead of wiping it during this performance/logic
        // upgrade. Auto rotations still rebuild because their version no longer
        // matches GAMEPLAN_VERSION.
        if (isManualSaved && saved.version !== GAMEPLAN_VERSION) {
          saveGameplanToStorage(selectedTeam.name, teamPlayers, orderedPlayers, normalizedMinutes, {
            manualLocked: true,
            userEdited: true,
            source: "coach_gameplan",
          });
        }

        loaded = true;
      }
    } catch (e) {
      console.warn("Bad saved gameplan:", e);
    }
  }

  if (!loaded) {
    rebuildTeamGameplanForAvailability(selectedTeam, currentDate, { source: "coach_gameplan_injury_aware_rebuild" });

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
        normalizedMinutes[p.name] = isPlayerInjured(p, currentDate) ? 0 : Number(fresh.minutes?.[p.name] || 0);
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

    const currentDate = readLeagueClock()?.date || null;
    const teamPlayers = selectedTeam.players || [];
    rebuildTeamGameplanForAvailability(selectedTeam, currentDate, { source: "coach_gameplan_auto_rebuild" });
    const fresh = readGameplanFromStorage(selectedTeam.name);
    const sorted = [
        ...(fresh?.order || []).map((name) => teamPlayers.find((p) => p.name === name)).filter(Boolean),
        ...teamPlayers.filter((p) => !(fresh?.order || []).includes(p.name)),
    ];
    const obj = {};
    for (const p of teamPlayers) {
        obj[p.name] = isPlayerInjured(p, currentDate) ? 0 : Number(fresh?.minutes?.[p.name] || 0);
    }

    setPlayers(sorted);
    setMinutes(obj);
    setTeamRatings(calculateTeamRatings(sorted, obj));
};

    const handleMinuteChange = (name, value) => {
        const currentDate = readLeagueClock()?.date || null;
        const targetPlayer = players.find((p) => p.name === name);
        if (isPlayerInjured(targetPlayer, currentDate)) return;
        const idx = players.findIndex((p) => p.name === name);
        const isStarter = idx > -1 && idx < 5;
        const minAllowed = isStarter ? MANUAL_STARTER_MINUTES : MANUAL_BENCH_MINUTES;
        const maxAllowed = isStarter ? MANUAL_STARTER_MAX_MINUTES : MANUAL_BENCH_MAX_MINUTES;
        const numRaw = Math.round(Number(value));
        const num = Math.max(minAllowed, Math.min(maxAllowed, numRaw));

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
        const currentDate = readLeagueClock()?.date || null;
        if (isPlayerInjured(player, currentDate)) return;
        playSound(SOUND_KEYS.COACH_GAMEPLAN_SWAP);
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

        const adjusted = clampManualMinutesForOrder(arr, minutes);
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
    const activeTeamLogo =
        selectedTeam?.logo ||
        selectedTeam?.teamLogo ||
        selectedTeam?.newTeamLogo ||
        selectedTeam?.image ||
        selectedTeam?.logoUrl ||
        "";
    const minutesAssignedPercent = Math.max(0, Math.min(100, (total / 240) * 100));

    const formatExactRating = (value) => Number(value || 0).toFixed(4);
    const currentLeagueDate = readLeagueClock()?.date || null;

    return (
    <PageFade>
        <div className="h-full min-h-0 bmCourtPage text-white flex flex-col items-center overflow-hidden px-5 py-2">
        {toast && (
            <div className="fixed top-6 right-6 bg-neutral-800 border border-orange-500 text-orange-400 px-5 py-2 rounded-lg shadow-lg animate-pulse">
            Gameplan saved!
            </div>
        )}

        {showRatingDetails && (
            <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
            onClick={() => setShowRatingDetails(false)}
            >
            <div
                className="w-full max-w-sm rounded-xl border border-neutral-700 bg-neutral-950 p-5 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-extrabold text-orange-400">Exact Team Ratings</h2>
                <button
                    type="button"
                    onClick={() => setShowRatingDetails(false)}
                    className="h-8 w-8 rounded-full bg-neutral-800 text-gray-200 hover:bg-orange-600 hover:text-white transition"
                    aria-label="Close exact ratings popup"
                >
                    ×
                </button>
                </div>

                <div className="space-y-3 text-[16px] font-semibold text-gray-200">
                <div className="flex justify-between gap-4">
                    <span className="text-gray-400">Team POT:</span>
                    <span className="text-orange-400">{formatExactRating(potRatings.exactPot)}</span>
                </div>
                <div className="flex justify-between gap-4">
                    <span className="text-gray-400">FTR:</span>
                    <span className="text-orange-400">{formatExactRating(ftrRatings.exactFtr)}</span>
                </div>

                <div className="pt-2 border-t border-neutral-800">
                    <p className="mb-2 text-white">Team Overall:</p>
                    <div className="flex justify-between gap-4">
                    <span className="text-gray-400">OVR</span>
                    <span className="text-orange-400">{formatExactRating(teamRatings.exactOverall)}</span>
                    </div>
                    <div className="flex justify-between gap-4 mt-1">
                    <span className="text-gray-400">OFF</span>
                    <span className="text-orange-400">{formatExactRating(teamRatings.exactOff)}</span>
                    </div>
                    <div className="flex justify-between gap-4 mt-1">
                    <span className="text-gray-400">DEF</span>
                    <span className="text-orange-400">{formatExactRating(teamRatings.exactDef)}</span>
                    </div>
                </div>
                </div>
            </div>
            </div>
        )}

        {/* Roster-style team header */}
        <div className="w-full max-w-7xl flex items-center gap-3 mb-2 select-none shrink-0 px-1">
            <button
                onClick={() => handleTeamSwitch("prev")}
                disabled={!allTeams.length}
                className={`flex h-8 w-8 shrink-0 items-center justify-center text-[18px] font-black transition-transform active:scale-90 ${
                allTeams.length ? "text-white hover:text-orange-400" : "text-neutral-600 cursor-not-allowed"
                }`}
                title="Previous Team"
                aria-label="Previous Team"
            >
                ◄
            </button>

            {activeTeamLogo ? (
                <img
                    src={activeTeamLogo}
                    alt=""
                    aria-hidden="true"
                    className="h-11 w-11 shrink-0 object-contain"
                />
            ) : null}

            <h1 className="min-w-0 truncate text-[25px] font-extrabold leading-none text-white">
                {selectedTeam.name} Coach Gameplan
            </h1>

            <button
                onClick={() => handleTeamSwitch("next")}
                disabled={!allTeams.length}
                className={`flex h-8 w-8 shrink-0 items-center justify-center text-[18px] font-black transition-transform active:scale-90 ${
                allTeams.length ? "text-white hover:text-orange-400" : "text-neutral-600 cursor-not-allowed"
                }`}
                title="Next Team"
                aria-label="Next Team"
            >
                ►
            </button>
        </div>

        {/* Selected player + minutes summary */}
        <div className="relative w-full flex justify-center shrink-0">
            <div className="relative bmSolidPanel w-full max-w-7xl border border-neutral-700/70 rounded-t-xl px-5 pt-3 pb-0 shadow-lg overflow-hidden">
                {activeTeamLogo ? (
                    <img
                        src={activeTeamLogo}
                        alt=""
                        aria-hidden="true"
                        className="pointer-events-none absolute object-contain select-none"
                        style={{
                            left: "-18px",
                            top: "50%",
                            width: "190px",
                            height: "190px",
                            opacity: 0.08,
                            transform: "translateY(-50%)",
                            filter: "saturate(.85)",
                        }}
                    />
                ) : null}

            <div className="flex min-h-[118px] items-end justify-between gap-5">
                    <div className="flex min-w-0 items-end gap-4">
                        <PlayerPortraitFrame
                            src={player.headshot}
                            player={player}
                            team={selectedTeam}
                            teamName={selectedTeam?.name || ""}
                            alt={player.name}
                            className="h-[112px] w-[142px] shrink-0"
                        />

                        <div className="flex min-w-0 flex-col justify-end pb-4">
                            <h2 className="flex items-center gap-3 truncate text-[32px] font-bold leading-tight text-white">
                                <span className="truncate">{player.name}</span>
                                {isPlayerInjured(player, currentLeagueDate) && (
                                    <span className="rounded-full border border-red-400/40 bg-red-500/20 px-2 py-1 text-[12px] font-black uppercase tracking-wide text-red-100">
                                        INJ
                                    </span>
                                )}
                            </h2>
                            <p className="mt-0.5 text-[17px] font-bold text-white">
                                {player.pos}
                                {player.secondaryPos ? ` / ${player.secondaryPos}` : ""} <span className="mx-2 text-neutral-500">|</span> Age {player.age}
                                {isPlayerInjured(player, currentLeagueDate) ? ` • ${formatInjuryReturnLabel(player, currentLeagueDate)}` : ""}
                            </p>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-4 pb-3">
                        <PlayerRatingRing
                            overall={player.overall}
                            size={84}
                            showPotential={false}
                        />

                        <div className="flex h-[88px] min-w-[305px] items-center rounded-xl border border-neutral-700 bg-black/35 px-4">
                            <div
                                className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full"
                                style={{
                                    background: `conic-gradient(#f97316 ${minutesAssignedPercent * 3.6}deg, #27272a 0deg)`,
                                }}
                                aria-hidden="true"
                            >
                                <div className="h-10 w-10 rounded-full bg-neutral-950"></div>
                            </div>

                            <div className="ml-4 min-w-[112px]">
                                <div className="text-[22px] font-black leading-none text-white">{total} / 240</div>
                                <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400">
                                    Minutes Assigned
                                </div>
                            </div>

                            <div className="mx-4 h-12 w-px bg-neutral-700"></div>

                            <div className="min-w-[68px] text-center">
                                <div className={`text-[22px] font-black leading-none ${remaining > 0 ? "text-orange-400" : "text-white"}`}>
                                    {remaining}
                                </div>
                                <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400">
                                    Remaining
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        {/* Connected starters + bench rotation table */}
        <div className="w-full flex-1 min-h-0 flex justify-center -mt-px">
            <div className="w-full max-w-7xl bmSolidPanel border border-neutral-700/70 border-t-0 rounded-b-xl shadow-lg flex flex-col min-h-0 overflow-hidden">
                <div className="bmTableScroller overflow-y-auto flex-1 min-h-0">
                    <table className="w-full table-fixed border-collapse text-left">
                        <tbody className="text-[14px]">
                            <tr className="sticky top-0 z-10 border-b border-neutral-700 bg-neutral-900/95">
                                <td className="relative w-[60px] py-2"><span className="absolute left-3 top-1/2 -translate-y-1/2 whitespace-nowrap text-[12px] font-black uppercase tracking-[0.08em] text-orange-400">STARTERS</span></td>
                                <td className="py-2 w-[110px] text-center text-[13px] font-black uppercase tracking-[0.04em] text-gray-300">POS</td>
                                <td className="py-2 text-[13px] font-black uppercase tracking-[0.04em] text-gray-300">PLAYER</td>
                                <td className="py-2 w-[120px] text-center text-[13px] font-black uppercase tracking-[0.04em] text-gray-300">OVR</td>
                                <td className="py-2 w-[300px] text-center text-[13px] font-black uppercase tracking-[0.04em] text-gray-300">MINUTES</td>
                            </tr>

                            {players.slice(0, 5).map((p, i) => {
                                const injured = isPlayerInjured(p, currentLeagueDate);
                                return (
                                    <tr
                                        key={p.name}
                                        data-bm-nav-row-index={i}
                                        onClick={() => setSelectedPlayer(p)}
                                        className={`cursor-pointer border-b border-neutral-800/70 transition ${
                                        selectedPlayer?.name === p.name
                                            ? "bg-orange-600 text-white"
                                            : injured
                                            ? "bg-red-950/30 text-red-100"
                                            : "hover:bg-neutral-800"
                                        }`}
                                    >
                                        <td className="text-center">
                                            <div
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleSquareClick(p);
                                                }}
                                                title={injured ? "Injured players cannot be placed in the starting five" : "Swap rotation slot"}
                                                className={`w-5 h-5 mx-auto border-2 rounded-sm transition ${
                                                injured
                                                    ? "cursor-not-allowed border-red-300 bg-red-500/30 opacity-60"
                                                    : swapSelection?.name === p.name
                                                    ? "cursor-pointer bg-orange-500 border-orange-400"
                                                    : "cursor-pointer border-white"
                                                }`}
                                            ></div>
                                        </td>
                                        <td className="text-center font-bold text-white">{lineupLabels[i]}</td>
                                        <td className="py-1.5 font-semibold whitespace-nowrap">
                                            {p.name}
                                            {injured && (
                                                <span className="ml-2 rounded-full border border-red-400/40 bg-red-500/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-red-100">
                                                    INJ • {formatInjuryReturnLabel(p, currentLeagueDate)}
                                                </span>
                                            )}
                                        </td>
                                        <td className="text-center text-orange-400 font-bold">{p.overall}</td>
                                        <td className="text-center">
                                            <div className="flex items-center gap-3 justify-center">
                                                <input
                                                    type="range"
                                                    min={injured ? 0 : MANUAL_STARTER_MINUTES}
                                                    max={injured ? 0 : MANUAL_STARTER_MAX_MINUTES}
                                                    step="1"
                                                    value={injured ? 0 : minutes[p.name] ?? 0}
                                                    disabled={injured}
                                                    onChange={(e) => handleMinuteChange(p.name, e.target.value)}
                                                    className={`w-[150px] accent-white ${injured ? "cursor-not-allowed opacity-45" : ""}`}
                                                />
                                                <span className="w-[38px] text-right text-sm font-semibold text-gray-200">
                                                    {injured ? 0 : Math.round(minutes[p.name] ?? 0)}
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}

                            <tr className="border-b border-neutral-800 bg-neutral-900/95">
                                <td className="relative w-[60px] py-2"><span className="absolute left-3 top-1/2 -translate-y-1/2 whitespace-nowrap text-[12px] font-black uppercase tracking-[0.08em] text-orange-400">BENCH</span></td>
                                <td colSpan={4}></td>
                            </tr>

                            {players.slice(5).map((p, benchIndex) => {
                                const i = benchIndex + 5;
                                const injured = isPlayerInjured(p, currentLeagueDate);
                                return (
                                    <tr
                                        key={p.name}
                                        data-bm-nav-row-index={i}
                                        onClick={() => setSelectedPlayer(p)}
                                        className={`cursor-pointer border-b border-neutral-800/70 transition ${
                                        selectedPlayer?.name === p.name
                                            ? "bg-orange-600 text-white"
                                            : injured
                                            ? "bg-red-950/30 text-red-100"
                                            : "hover:bg-neutral-800"
                                        }`}
                                    >
                                        <td className="text-center">
                                            <div
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleSquareClick(p);
                                                }}
                                                title={injured ? "Injured players cannot be placed in the starting five" : "Swap rotation slot"}
                                                className={`w-5 h-5 mx-auto border-2 rounded-sm transition ${
                                                injured
                                                    ? "cursor-not-allowed border-red-300 bg-red-500/30 opacity-60"
                                                    : swapSelection?.name === p.name
                                                    ? "cursor-pointer bg-orange-500 border-orange-400"
                                                    : "cursor-pointer border-white"
                                                }`}
                                            ></div>
                                        </td>
                                        <td className="text-center font-bold text-white">{i + 1}</td>
                                        <td className="py-1.5 font-semibold whitespace-nowrap">
                                            {p.name}
                                            {injured && (
                                                <span className="ml-2 rounded-full border border-red-400/40 bg-red-500/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-red-100">
                                                    INJ • {formatInjuryReturnLabel(p, currentLeagueDate)}
                                                </span>
                                            )}
                                        </td>
                                        <td className="text-center text-orange-400 font-bold">{p.overall}</td>
                                        <td className="text-center">
                                            <div className="flex items-center gap-3 justify-center">
                                                <input
                                                    type="range"
                                                    min={injured ? 0 : MANUAL_BENCH_MINUTES}
                                                    max={injured ? 0 : MANUAL_BENCH_MAX_MINUTES}
                                                    step="1"
                                                    value={injured ? 0 : minutes[p.name] ?? 0}
                                                    disabled={injured}
                                                    onChange={(e) => handleMinuteChange(p.name, e.target.value)}
                                                    className={`w-[150px] accent-white ${injured ? "cursor-not-allowed opacity-45" : ""}`}
                                                />
                                                <span className="w-[38px] text-right text-sm font-semibold text-gray-200">
                                                    {injured ? 0 : Math.round(minutes[p.name] ?? 0)}
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <div className="flex justify-end gap-3 border-t border-neutral-800 bg-neutral-950/70 px-3 py-2 shrink-0">
                    <button
                        onClick={handleAutoRebuild}
                        className="px-5 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg font-semibold transition"
                    >
                        Auto Rebuild Rotation
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={total !== 240}
                        className={`px-5 py-2 rounded-lg font-semibold transition ${
                            total !== 240
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
                        disabled={total !== 240}
                        className={`bmLegacyRouteBack px-5 py-2 rounded-lg font-semibold transition ${
                            total !== 240
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
