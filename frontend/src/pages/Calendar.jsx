import React, { useEffect, useMemo, useState } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";
import { simulateOneGame } from "../api/simEngine";

/* ----------------------- date helpers ----------------------- */
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const rangeDays = (start, end) => { const out = []; for (let d = new Date(start); d <= end; d = addDays(d, 1)) out.push(new Date(d)); return out; };
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const rotate = (arr, k) => { const n = arr.length; if (!n) return arr; const s = ((k % n) + n) % n; return arr.slice(s).concat(arr.slice(0, s)); };

/* ----------------------- league helpers ----------------------- */
function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) {
    const confs = leagueData.conferences;
    let arr = [];
    Object.keys(confs).forEach((k) => (arr = arr.concat(confs[k] || [])));
    return arr;
  }
  return [];
}

const Logo = ({ team, size = 36 }) => {
  const src = team.logo || team.teamLogo || team.newTeamLogo || team.image || team.logoUrl || "";
  if (src) return <img src={src} alt={team.name} className="object-contain" style={{ width: size, height: size }} />;
  const initials = (team.name || "?").split(" ").map(w => w[0]?.toUpperCase()).join("").slice(0,3);
  return (
    <div className="flex items-center justify-center rounded bg-neutral-700 text-white" style={{ width: size, height: size }}>
      <span className="text-sm font-bold">{initials}</span>
    </div>
  );
};

/* ----------------------- round-robin (supports odd N) ----------------------- */
function singleRoundRobinRounds(teamIds) {
  const ids = [...teamIds];
  if (ids.length % 2 === 1) ids.push("__BYE__");
  const n = ids.length;
  const rounds = [];
  let arr = ids.slice();

  for (let r = 0; r < n - 1; r++) {
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== "__BYE__" && b !== "__BYE__") {
        games.push(r % 2 === 0 ? { home: a, away: b } : { home: b, away: a });
      }
    }
    rounds.push(games);
    // standard circle method rotate
    arr = [arr[0], arr[n - 1]].concat(arr.slice(1, n - 1));
  }
  return rounds;
}

/* ----------------------- schedule generation (revamped) ----------------------- */
function slugifyId(v) {
  if (!v) return "";
  return String(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function isScheduleValid(byDate, teamIds, target, start, end) {
  if (!byDate || typeof byDate !== "object") return false;
  const keys = Object.keys(byDate);
  if (!keys.length) return false;
  const first = keys[0], last = keys[keys.length - 1];
  if (first !== fmt(start) || last !== fmt(end)) return false;

  // no undefined teams
  for (const games of Object.values(byDate)) {
    for (const g of games) {
      if (!g?.homeId || !g?.awayId) return false;
    }
  }

  // check per-team counts
  const cnt = Object.fromEntries(teamIds.map(id => [id, 0]));
  for (const games of Object.values(byDate)) {
    for (const g of games) {
      if (cnt[g.homeId] == null || cnt[g.awayId] == null) return false;
      cnt[g.homeId]++; cnt[g.awayId]++;
    }
  }
  return teamIds.every(id => cnt[id] === target);
}

function generateFullSeasonSchedule(teams, startDate, endDate) {
  const teamIds = teams.map((t, i) => t.id ?? t.name ?? `team_${i}`);
  const canonicalIds = teamIds.map((id, i) => slugifyId(id) || `team_${i}`);
  const idMap = Object.fromEntries(teamIds.map((id, i) => [id, canonicalIds[i]]));
  const N = canonicalIds.length;

  if (N < 2) return { byDate: {}, list: [] };

  // Build quick lookup for display snapshots (name/logo at generation time)
  const byCanon = {};
  teams.forEach((t, i) => {
    const cid = idMap[t.id ?? t.name ?? `team_${i}`];
    byCanon[cid] = {
      id: cid,
      name: t.name ?? `Team ${i + 1}`,
      logo: t.logo || t.teamLogo || t.newTeamLogo || t.image || t.logoUrl || "",
    };
  });

  const target = 82;
  const perTeamPerDouble = 2 * (N - 1);   // double round-robin yields this many games per team
  const baseCycles = Math.floor(target / perTeamPerDouble); // e.g., with N=12, baseCycles=3 (66 games)
  const remainingPerTeam = target - baseCycles * perTeamPerDouble; // e.g., 16 rounds to reach 82

  // Core rounds
  const single = singleRoundRobinRounds(canonicalIds);
  const mirrored = single.map((rd) => rd.map((g) => ({ home: g.away, away: g.home })));
  const oneDouble = [...single, ...mirrored]; // length = 2*(N-1)

  // Assemble the complete set of "rounds" (each round: each team plays once)
  const rounds = [];

  // Base cycles of double RR
  for (let c = 0; c < baseCycles; c++) {
    const rotatedDouble = rotate(oneDouble, c % oneDouble.length);
    // alternate reversing to vary H/A patterns over cycles
    const pack = (c % 2 === 0) ? rotatedDouble : rotatedDouble.slice().reverse();
    for (const rd of pack) rounds.push(rd.map(g => ({ ...g }))); // push one round at a time
  }

// Extra rounds (exactly remainingPerTeam)
for (let i = 0; i < remainingPerTeam; i++) {
  // alternate single/mirrored to roughly balance home/away in the tail
  const base = (i % 2 === 0) ? single : mirrored;
  const rd = base[i % base.length];              // ✅ pick ONE round
  rounds.push(rd.map(g => ({ ...g })));          // ✅ push a single proper round
}


  const days = rangeDays(startDate, endDate);
  const D = days.length;
  const R = rounds.length;

  const byDate = {};
  const dayTeams = Array.from({ length: D }, () => new Set());
  const teamGamesCount = Object.fromEntries(canonicalIds.map(id => [id, 0]));

  // Helper to place a single game on first feasible day >= startIdx, else search forward then backward
  function placeGame(game, startIdx, forceDayIdx = null) {
    const tryDay = (di) => {
      if (di < 0 || di >= D) return false;
      const used = dayTeams[di];
      if (used.has(game.home) || used.has(game.away)) return false;
      if (teamGamesCount[game.home] >= target || teamGamesCount[game.away] >= target) return false;

      const dateStr = fmt(days[di]);
      const arr = byDate[dateStr] || [];
      arr.push({
        id: `${dateStr}_${byCanon[game.home]?.name || game.home}_vs_${byCanon[game.away]?.name || game.away}_${arr.length}`,
        date: dateStr,
        homeId: game.home,
        awayId: game.away,
        // snapshot human-friendly labels now (stable for display)
        home: byCanon[game.home]?.name || game.home,
        away: byCanon[game.away]?.name || game.away,
        played: false,
      });
      byDate[dateStr] = arr;
      used.add(game.home); used.add(game.away);
      teamGamesCount[game.home]++; teamGamesCount[game.away]++;
      return true;
    };

    if (forceDayIdx != null) {
      return tryDay(forceDayIdx);
    }

    // forward sweep from desired start
    for (let di = startIdx; di < D; di++) {
      if (tryDay(di)) return true;
    }
    // backward sweep (only if we couldn't place forward)
    for (let di = startIdx - 1; di >= 0; di--) {
      if (tryDay(di)) return true;
    }
    return false;
  }

  // Distribute rounds across window; guarantee at least one game on first and last day
  for (let r = 0; r < R; r++) {
    // desired anchor day for this round
    const desired = Math.floor(r * (D - 1) / Math.max(1, R - 1));
    const roundGames = rounds[r];

    // Special handling to anchor the first/last day with at least one game
    if (r === 0) {
      // place one game on day 0 if possible
      let anchored = false;
      for (let k = 0; k < roundGames.length; k++) {
        if (placeGame(roundGames[k], 0, 0)) { roundGames.splice(k,1); anchored = true; break; }
      }
      // continue placing the rest normally
    } else if (r === R - 1) {
      // place one game on last day if possible
      let anchored = false;
      for (let k = 0; k < roundGames.length; k++) {
        if (placeGame(roundGames[k], D - 1, D - 1)) { roundGames.splice(k,1); anchored = true; break; }
      }
    }

    // place remaining games of the round with spillover (never drop)
    for (const g of roundGames) {
      const ok = placeGame(g, desired);
      if (!ok) {
        // As a last resort, try ANY day (should be rare)
        let forced = false;
        for (let di = 0; di < D && !forced; di++) forced = placeGame(g, di, di);
        if (!forced) {
          console.warn("Failed to place a game; this should not happen", g);
        }
      }
    }
  }

  // Final validation & summary
  const perTeam = Object.fromEntries(canonicalIds.map(id => [id, 0]));
  Object.values(byDate).forEach(games => {
    games.forEach(g => { perTeam[g.homeId]++; perTeam[g.awayId]++; });
  });

  const countsArr = Object.entries(perTeam).map(([id,c]) => ({ id, c }));
  countsArr.sort((a,b)=>a.c-b.c);

  const firstKey = Object.keys(byDate).sort()[0];
  const lastKey = Object.keys(byDate).sort().slice(-1)[0];

  console.debug("[Calendar] Schedule summary:",
    { start: fmt(startDate), end: fmt(endDate), days: D, rounds: R,
      minGames: countsArr[0]?.c, maxGames: countsArr[countsArr.length-1]?.c,
      firstDay: firstKey, lastDay: lastKey });

  return { byDate, list: Object.values(byDate).flat() };
}

/* ============================================================= */
/*                          COMPONENT                             */
/* ============================================================= */
export default function Calendar() {
  const navigate = useNavigate();
  const { leagueData, selectedTeam, setSelectedTeam } = useGame();

  // Season window (pin to Oct 21 -> Apr 12)
  const now = new Date();
  const seasonYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const seasonStart = useMemo(() => new Date(seasonYear, 9, 21), [seasonYear]);      // Oct 21
  const seasonEnd   = useMemo(() => new Date(seasonYear + 1, 3, 12), [seasonYear]);  // Apr 12
  const allDays     = useMemo(() => rangeDays(seasonStart, seasonEnd), [seasonStart, seasonEnd]);

  // Teams
  const teams = useMemo(() => {
    const arr = getAllTeamsFromLeague(leagueData);
    return arr.map((t, i) => ({ ...t, id: t.id ?? t.name ?? `team_${i}` }));
  }, [leagueData]);

  // Team switching
  const allTeamsSorted = useMemo(() => [...teams].sort((a,b)=> (a.name||"").localeCompare(b.name||"")), [teams]);
  const currentIndex = useMemo(() => selectedTeam ? allTeamsSorted.findIndex(t => t.name === selectedTeam.name) : -1, [selectedTeam, allTeamsSorted]);
  const handleTeamSwitch = (dir) => {
    if (!allTeamsSorted.length || currentIndex === -1) return;
    const i = dir === "next" ? (currentIndex + 1) % allTeamsSorted.length : (currentIndex - 1 + allTeamsSorted.length) % allTeamsSorted.length;
    setSelectedTeam(allTeamsSorted[i]);
  };
  useEffect(() => { if (selectedTeam) localStorage.setItem("selectedTeam", JSON.stringify(selectedTeam)); }, [selectedTeam]);

  // Storage helpers
  const SCHED_KEY = "bm_schedule_v3";
  const RESULT_KEY = "bm_results_v1";
  const [scheduleByDate, setScheduleByDate] = useState({});
  const [resultsById, setResultsById] = useState({});

  const saveSchedule = (obj) => { setScheduleByDate(obj); localStorage.setItem(SCHED_KEY, JSON.stringify(obj)); };
  const saveResults  = (obj) => { setResultsById(obj);   localStorage.setItem(RESULT_KEY, JSON.stringify(obj)); };

  // Load / build schedule + results
  useEffect(() => {
    if (!teams || teams.length < 2) return;

    const wantStart = fmt(seasonStart);
    const wantEnd = fmt(seasonEnd);
    const canonicalIds = teams.map((t, i) => slugifyId(t.id ?? t.name ?? `team_${i}`));
    const target = 82;

    const shouldRegen = (obj) => {
      try {
        if (!obj || !Object.keys(obj).length) return true;
        const keys = Object.keys(obj).sort();
        if (keys[0] !== wantStart || keys[keys.length-1] !== wantEnd) return true;
        return !isScheduleValid(obj, canonicalIds, target, seasonStart, seasonEnd);
      } catch { return true; }
    };

    let parsedSched = {};
    try { const savedRaw = localStorage.getItem(SCHED_KEY); parsedSched = savedRaw ? JSON.parse(savedRaw) : {}; } catch {}

    if (shouldRegen(parsedSched)) {
      // blow away broken schedules (e.g., undefined teams / wrong window / wrong counts)
      const { byDate } = generateFullSeasonSchedule(teams, seasonStart, seasonEnd);
      saveSchedule(byDate);
      console.info("[Calendar] Generated fresh schedule and saved to localStorage.");
    } else {
      setScheduleByDate(parsedSched);
      console.info("[Calendar] Loaded existing valid schedule from localStorage.");
    }

    let parsedResults = {};
    try { const savedR = localStorage.getItem(RESULT_KEY); parsedResults = savedR ? JSON.parse(savedR) : {}; } catch {}
    setResultsById(parsedResults);
  }, [teams, seasonStart, seasonEnd]);

  // Selected team context
  const selectedTeamId = useMemo(() => selectedTeam ? (selectedTeam.id ?? selectedTeam.name ?? null) : null, [selectedTeam]);

  // My team’s games by date
  const myGames = useMemo(() => {
    if (!selectedTeamId) return {};
    const map = {};
    Object.entries(scheduleByDate).forEach(([d, games]) => {
      const g = games.find(x => x.homeId === slugifyId(selectedTeamId) || x.awayId === slugifyId(selectedTeamId));
      if (g) map[d] = g;
    });
    return map;
  }, [scheduleByDate, selectedTeamId]);

  // Focused date
  const [focusedDate, setFocusedDate] = useState(null);
  useEffect(() => {
    const firstGameDate = Object.keys(myGames).sort()[0];
    setFocusedDate(firstGameDate || fmt(seasonStart));
  }, [myGames, seasonStart]);

  // Months & visible days
  const [month, setMonth] = useState(() => monthKey(seasonStart));
  const months = useMemo(() => Array.from(new Set(allDays.map(monthKey))), [allDays]);
  const visibleDays = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const last = new Date(y, m, 0);
    const days = rangeDays(first, last);
    const padStart = first.getDay();
    const padded = Array(padStart).fill(null).concat(days);
    while (padded.length % 7 !== 0) padded.push(null);
    return padded;
  }, [month]);

  // Modals
  const [boxModal, setBoxModal] = useState(null);     // {game, result}
  const [actionModal, setActionModal] = useState(null); // { dateStr, game }

  /* ----------------------- simulation helpers ----------------------- */
  const simOne = (game) => simulateOneGame({
    leagueData,
    homeTeamName: teams.find(t => slugifyId(t.id ?? t.name) === game.homeId)?.name || game.home,
    awayTeamName: teams.find(t => slugifyId(t.id ?? t.name) === game.awayId)?.name || game.away,
  });

  const handleSimOnlyGame = (dateStr, game) => {
    const upd = { ...scheduleByDate };
    const newResults = { ...resultsById };
    upd[dateStr] = (upd[dateStr] || []).map(g => g.id === game.id ? { ...g, played: true } : g);
    newResults[game.id] = simOne(game);
    saveSchedule(upd);
    saveResults(newResults);
    setActionModal(null);
    setBoxModal({ game, result: newResults[game.id] });
  };

  const handleSimToDate = (dateStr) => {
    const sorted = Object.keys(scheduleByDate).sort();
    const upd = { ...scheduleByDate };
    const newResults = { ...resultsById };

    for (const d of sorted) {
      if (d > dateStr) break;
      upd[d] = upd[d].map((g) => {
        if (!g.played) {
          const res = simOne(g);
          newResults[g.id] = res;
        }
        return { ...g, played: true };
      });
    }
    saveSchedule(upd);
    saveResults(newResults);
    setActionModal(null);
  };

  const handleSimSeason = () => {
    const upd = { ...scheduleByDate };
    const newResults = { ...resultsById };

    Object.keys(upd).sort().forEach((d) => {
      upd[d] = upd[d].map((g) => {
        if (!g.played) {
          const res = simOne(g);
          newResults[g.id] = res;
        }
        return { ...g, played: true };
      });
    });

    saveSchedule(upd);
    saveResults(newResults);
    setActionModal(null);
  };

  const handleBackfillMissing = () => {
    const upd = { ...scheduleByDate };
    const newResults = { ...resultsById };

    Object.keys(upd).forEach((d) => {
      upd[d] = upd[d].map((g) => {
        if (g.played && !newResults[g.id]) {
          const res = simOne(g);
          newResults[g.id] = res;
        }
        return g;
      });
    });

    saveResults(newResults);
  };

  const hasPlayedWithoutResult = useMemo(() => {
    for (const games of Object.values(scheduleByDate)) {
      for (const g of games) if (g.played && !resultsById[g.id]) return true;
    }
    return false;
  }, [scheduleByDate, resultsById]);

  const handleResetSeason = () => {
    if (!window.confirm("Reset the season? This clears all results and regenerates the schedule.")) return;
    localStorage.removeItem(SCHED_KEY);
    localStorage.removeItem(RESULT_KEY);
    const { byDate } = generateFullSeasonSchedule(teams, seasonStart, seasonEnd);
    saveSchedule(byDate);
    saveResults({});
    const firstGameDate = Object.keys(byDate).sort()[0];
    setFocusedDate(firstGameDate || fmt(seasonStart));
  };

  /* ----------------------- guards ----------------------- */
  if (!selectedTeam) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center justify-center">
        <p className="mb-4">No team selected.</p>
        <button className="px-5 py-2 bg-orange-600 hover:bg-orange-500 rounded-lg" onClick={() => navigate("/team-selector")}>
          Pick a Team
        </button>
      </div>
    );
  }
  if (!teams || teams.length < 2) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center justify-center">
        <p className="text-lg">League data not loaded.</p>
        <p className="text-sm text-gray-400 mt-2">Load/create a league in the League Editor, then return here.</p>
        <button className="mt-5 px-5 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg" onClick={() => navigate("/league-editor")}>
          Go to League Editor
        </button>
      </div>
    );
  }

  const bannerText = (() => {
    if (!focusedDate) return "";
    const g = myGames[focusedDate];
    if (g) {
      const isHome = g.homeId === slugifyId(selectedTeam.id ?? selectedTeam.name);
      return `GAME DAY: ${isHome ? g.away : selectedTeam.name} @ ${isHome ? selectedTeam.name : g.home}`;
    }
    const dt = new Date(focusedDate);
    const label = dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    return `DATE: ${label}`;
  })();

  /* ----------------------- UI (unchanged) ----------------------- */
  return (
    <div className="min-h-screen bg-neutral-900 text-white py-8">
      <div className="max-w-6xl mx-auto px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          {/* LEFT: arrows + team identity */}
          <div className="flex items-center gap-4">
            <div className="w-16 flex items-center justify-start gap-2 select-none">
              <button
                onClick={() => handleTeamSwitch("prev")}
                className="text-2xl text-white hover:text-orange-400 transition-transform active:scale-90 font-bold"
                title="Previous Team"
              >
                ◄
              </button>
              <button
                onClick={() => handleTeamSwitch("next")}
                className="text-2xl text-white hover:text-orange-400 transition-transform active:scale-90 font-bold"
                title="Next Team"
              >
                ►
              </button>
            </div>
            <Logo team={selectedTeam} size={32} />
            <h1 className="text-2xl font-extrabold text-orange-500">{selectedTeam.name}</h1>
          </div>

          {/* RIGHT: controls */}
          <div className="flex items-center gap-2">
            <button className="px-3 py-2 bg-neutral-700 rounded hover:bg-neutral-600" onClick={() => navigate("/team-hub")}>Back to Team Hub</button>
            {hasPlayedWithoutResult && (
              <button className="px-3 py-2 bg-yellow-700 rounded hover:bg-yellow-600" onClick={handleBackfillMissing}>Backfill Scores</button>
            )}
            <button className="px-3 py-2 bg-red-700 rounded hover:bg-red-600" onClick={handleResetSeason}>Reset Season</button>
            <button className="px-3 py-2 bg-neutral-800 rounded hover:bg-neutral-700" onClick={() => { const i = months.indexOf(month); if (i > 0) setMonth(months[i - 1]); }}>‹ Prev</button>
            <select className="px-3 py-2 bg-neutral-800 rounded" value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => {
                const [y, mm] = m.split("-").map(Number);
                const dt = new Date(y, mm - 1, 1);
                const label = dt.toLocaleString("default", { month: "long", year: "numeric" });
                return <option key={m} value={m}>{label}</option>;
              })}
            </select>
            <button className="px-3 py-2 bg-neutral-800 rounded hover:bg-neutral-700" onClick={() => { const i = months.indexOf(month); if (i < months.length - 1) setMonth(months[i + 1]); }}>Next ›</button>
          </div>
        </div>

        {/* Top banner */}
        {focusedDate && (
          <div className="mb-5">
            <div className="px-4 py-2 rounded bg-neutral-800 border border-neutral-700 text-sm font-semibold">
              {bannerText}
            </div>
          </div>
        )}

        {/* Weekday header */}
        <div className="grid grid-cols-7 text-center text-gray-400 mb-2">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((w) => <div key={w} className="py-2">{w}</div>)}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-[6px]">
          {visibleDays.map((d, idx) => {
            if (!d)
              return <div key={`pad-${idx}`} className="h-28 rounded-lg bg-neutral-800/40 border border-neutral-800" />;

            const dateStr = fmt(d);
            const myGame = myGames[dateStr];
            const iAmHome = myGame && (myGame.homeId === slugifyId(selectedTeam.id ?? selectedTeam.name));
            const res = myGame ? resultsById[myGame.id] : null;

            // W/L + Final
            let finalScoreText = null;
            let WLTag = null;
            if (myGame && myGame.played && res?.totals) {
              const myScore  = iAmHome ? res.totals.home : res.totals.away;
              const oppScore = iAmHome ? res.totals.away : res.totals.home;
              const isWin = myScore > oppScore;
              WLTag = (
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold mr-1 ${isWin ? "bg-green-600/80" : "bg-red-600/80"}`}>
                  {isWin ? "W" : "L"}
                </span>
              );
              finalScoreText = `Final ${myScore}-${oppScore}`;
            }

            return (
              <div
                key={dateStr}
                className={`h-28 rounded-lg border p-2 relative cursor-pointer 
                  ${myGame ? (iAmHome ? "border-blue-400" : "border-red-400") : "border-neutral-800"} 
                  bg-neutral-850 hover:bg-neutral-700`}
                onClick={() => {
                  setFocusedDate(dateStr);
                  if (myGame) setActionModal({ dateStr, game: myGame });
                }}
              >
                <div className="text-xs text-gray-400">{d.getDate()}</div>

                {myGame && (
                  <div className="mt-2 flex items-center gap-2">
                    <Logo
                      team={iAmHome ? (teams.find(t => slugifyId(t.id ?? t.name) === myGame.awayId) || { name: myGame.away }) : (teams.find(t => slugifyId(t.id ?? t.name) === myGame.homeId) || { name: myGame.home })}
                      size={32}
                    />
                    <div className="text-sm">
                      {iAmHome ? myGame.away : myGame.home}
                    </div>
                  </div>
                )}

                {/* Bottom-right: W/L + Final only */}
                {myGame && myGame.played && (
                  <div className="absolute bottom-2 right-2 flex items-center">
                    {WLTag}
                    <span className="text-[11px] px-2 py-0.5 rounded bg-green-700/80">
                      {finalScoreText || "Final"}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Action modal (opens when clicking a tile) */}
      {actionModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-[520px] p-5">
            <div className="mb-3">
              <div className="text-sm text-gray-300 mb-1">{actionModal.dateStr}</div>
              <div className="text-lg font-bold">
                {actionModal.game.away} @ {actionModal.game.home}
              </div>
            </div>

            {!actionModal.game.played ? (
              <div className="flex flex-col gap-2">
                <button
                  className="px-4 py-2 rounded bg-neutral-700 hover:bg-neutral-600 text-left"
                  onClick={() => handleSimOnlyGame(actionModal.dateStr, actionModal.game)}
                >
                  Simulate only this game
                </button>
                <button
                  className="px-4 py-2 rounded bg-orange-600 hover:bg-orange-500 text-left"
                  onClick={() => handleSimToDate(actionModal.dateStr)}
                >
                  Simulate to this day
                </button>
                <button
                  className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-left"
                  onClick={handleSimSeason}
                >
                  Simulate season
                </button>
                <button className="px-4 py-2 rounded bg-neutral-800 hover:bg-neutral-700 text-left" onClick={() => setActionModal(null)}>
                  Close
                </button>
              </div>
            ) : (
              <div className="flex gap-2 justify-end">
                <button
                  className="px-4 py-2 rounded bg-neutral-700 hover:bg-neutral-600"
                  onClick={() => {
                    let r = resultsById[actionModal.game.id];
                    if (!r) {
                      const newResults = { ...resultsById, [actionModal.game.id]: simOne(actionModal.game) };
                      saveResults(newResults);
                      r = newResults[actionModal.game.id];
                    }
                    setActionModal(null);
                    setBoxModal({ game: actionModal.game, result: r });
                  }}
                >
                  View box score
                </button>
                <button className="px-4 py-2 rounded bg-neutral-800 hover:bg-neutral-700" onClick={() => setActionModal(null)}>
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Box Score modal */}
      {boxModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-[920px] max-h-[85vh] overflow-auto p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xl font-bold">
                {boxModal.game.away} @ {boxModal.game.home} • {boxModal.result?.winner?.score}{boxModal.result?.winner?.ot ? " (OT)" : ""}
              </h3>
              <button className="px-3 py-1 bg-neutral-700 rounded hover:bg-neutral-600" onClick={() => setBoxModal(null)}>Close</button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {["away","home"].map(side => {
                const teamName = side === "away" ? boxModal.game.away : boxModal.game.home;
                const rows = boxModal.result?.box?.[side] || [];
                return (
                  <div key={side} className="bg-neutral-800 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Logo team={teams.find(t => t.name === teamName) || { name: teamName }} size={28} />
                      <h4 className="font-semibold">{teamName}</h4>
                    </div>
                    <div className="overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="text-gray-300">
                          <tr className="text-left border-b border-neutral-700">
                            <th className="py-1 pr-2">Player</th>
                            <th className="py-1 pr-2">MIN</th>
                            <th className="py-1 pr-2">PTS</th>
                            <th className="py-1 pr-2">REB</th>
                            <th className="py-1 pr-2">AST</th>
                            <th className="py-1 pr-2">STL</th>
                            <th className="py-1 pr-2">BLK</th>
                            <th className="py-1 pr-2">FG</th>
                            <th className="py-1 pr-2">3P</th>
                            <th className="py-1 pr-2">FT</th>
                            <th className="py-1 pr-2">TO</th>
                            <th className="py-1 pr-2">PF</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(r => (
                            <tr key={r.player} className="border-b border-neutral-800">
                              <td className="py-1 pr-2">{r.player}</td>
                              <td className="py-1 pr-2">{r.min}</td>
                              <td className="py-1 pr-2">{r.pts}</td>
                              <td className="py-1 pr-2">{r.reb}</td>
                              <td className="py-1 pr-2">{r.ast}</td>
                              <td className="py-1 pr-2">{r.stl}</td>
                              <td className="py-1 pr-2">{r.blk}</td>
                              <td className="py-1 pr-2">{r.fg}</td>
                              <td className="py-1 pr-2">{r["3p"]}</td>
                              <td className="py-1 pr-2">{r.ft}</td>
                              <td className="py-1 pr-2">{r.to}</td>
                              <td className="py-1 pr-2">{r.pf}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
