import React, { useEffect, useMemo, useState } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";

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

/* ----------------------- round-robin (fixed, supports odd N) ----------------------- */
/** Classic circle method:
 *  Add "__BYE__" if odd, pair (arr[i], arr[n-1-i]), then rotate:
 *  keep arr[0] fixed, move last into index 1, shift middle right.
 */
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
        // alternate H/A by round for a little variety
        games.push(r % 2 === 0 ? { home: a, away: b } : { home: b, away: a });
      }
    }
    rounds.push(games);
    // rotate
    arr = [arr[0], arr[n - 1]].concat(arr.slice(1, n - 1));
  }
  return rounds;
}

/* ----------------------- schedule generation ----------------------- */
function generateFullSeasonSchedule(teams, startDate, endDate) {
  const teamIds = teams.map((t, i) => t.id ?? t.name ?? `team_${i}`);
  const teamById = {}; teams.forEach((t, i) => (teamById[teamIds[i]] = t));
  const N = teamIds.length;
  if (N < 2) return { byDate: {}, list: [] };

  const target = 82;
  const perTeamPerDoubleCycle = 2 * (N - 1); // games per team per "home+away" cycle

  const baseCycles = Math.floor(target / perTeamPerDoubleCycle);
  const remainingPerTeam = target - baseCycles * perTeamPerDoubleCycle; // leftover per team (0..2N-3)

  const single = singleRoundRobinRounds(teamIds);
  const mirrored = single.map((rd) => rd.map((g) => ({ home: g.away, away: g.home })));
  const oneDouble = [...single, ...mirrored]; // array of rounds

  // Build base cycles with some rotation/reversal for variety
  const rounds = [];
  for (let c = 0; c < baseCycles; c++) {
    const rotated = rotate(oneDouble, c % oneDouble.length);
    rounds.push(...(c % 2 === 0 ? rotated : rotated.slice().reverse()));
  }

  // --- Correct "extra rounds" math ---
  // Total additional league games needed = remainingPerTeam * N / 2
  const totalExtraGames = Math.ceil((remainingPerTeam * N) / 2);
  const gamesPerRound = Math.floor(N / 2);
  const roundsNeeded = Math.ceil(totalExtraGames / gamesPerRound);

  for (let i = 0; i < roundsNeeded; i++) {
    rounds.push(rotate(single, i % single.length)); // add fair extra single rounds
  }

  const days = rangeDays(startDate, endDate);
  const D = days.length, R = rounds.length;

  const byDate = {};
  const teamGamesCount = Object.fromEntries(teamIds.map((id) => [id, 0]));
  const dayTeams = Array.from({ length: D }, () => new Set());

  // Evenly map rounds across the calendar
  for (let r = 0; r < R; r++) {
    const desired = Math.floor(r * (D - 1) / Math.max(1, R - 1));
    let dIdx = desired;
    let placed = false;

    while (dIdx < D && !placed) {
      const todaySet = dayTeams[dIdx];
      const toSchedule = [];

      for (const g of rounds[r]) {
        const a = g.home, b = g.away;
        if (teamGamesCount[a] >= target || teamGamesCount[b] >= target) continue;
        if (todaySet.has(a) || todaySet.has(b)) continue;
        toSchedule.push(g);
        todaySet.add(a); todaySet.add(b);
      }

      if (toSchedule.length) {
        const dateStr = fmt(days[dIdx]);
        const arr = byDate[dateStr] || [];
        for (const g of toSchedule) {
          arr.push({
            id: `${dateStr}_${g.home}_vs_${g.away}_${arr.length}`,
            date: dateStr,
            homeId: g.home, awayId: g.away,
            home: teamById[g.home]?.name || g.home,
            away: teamById[g.away]?.name || g.away,
            played: false,
          });
          teamGamesCount[g.home]++; teamGamesCount[g.away]++;
        }
        byDate[dateStr] = arr;
        placed = true;
      } else {
        dIdx++; // try next day
      }
    }
  }

  return { byDate, list: Object.values(byDate).flat() };
}

/* ----------------------- component ----------------------- */
export default function Calendar() {
  const navigate = useNavigate();
  const { leagueData, selectedTeam, setSelectedTeam } = useGame();

  // Season window (Oct 19 -> Apr 25 next year)
  const now = new Date();
  const seasonYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const seasonStart = useMemo(() => new Date(seasonYear, 9, 19), [seasonYear]);     // Oct
  const seasonEnd   = useMemo(() => new Date(seasonYear + 1, 3, 25), [seasonYear]); // next Apr
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

  // Schedule state
  const [scheduleByDate, setScheduleByDate] = useState({});
  const [confirmDate, setConfirmDate] = useState(null);
  const [focusedDate, setFocusedDate] = useState(null);
  const [month, setMonth] = useState(() => monthKey(seasonStart));

  const selectedTeamId = useMemo(() => selectedTeam ? (selectedTeam.id ?? selectedTeam.name ?? null) : null, [selectedTeam]);

  // Generate / load schedule (v3 forces a clean rebuild with fixed logic)
  useEffect(() => {
    const KEY = "bm_schedule_v3";
    const withinWindow = (obj) => {
      const dates = Object.keys(obj || {});
      if (!dates.length) return false;
      const min = dates.reduce((a,b)=> (a<b?a:b));
      const max = dates.reduce((a,b)=> (a>b?a:b));
      return min >= fmt(seasonStart) && max <= fmt(seasonEnd);
    };
    const regen = () => {
      if (teams && teams.length >= 2) {
        const { byDate } = generateFullSeasonSchedule(teams, seasonStart, seasonEnd);
        setScheduleByDate(byDate);
        localStorage.setItem(KEY, JSON.stringify(byDate));
        return byDate;
      }
      return {};
    };

    let parsed = {};
    try { const savedRaw = localStorage.getItem(KEY); parsed = savedRaw ? JSON.parse(savedRaw) : {}; } catch {}
    if (!withinWindow(parsed)) parsed = regen(); else setScheduleByDate(parsed);
  }, [teams, seasonStart, seasonEnd]);

  const saveSchedule = (obj) => { setScheduleByDate(obj); localStorage.setItem("bm_schedule_v3", JSON.stringify(obj)); };

  // My team’s games by date
  const myGames = useMemo(() => {
    if (!selectedTeamId) return {};
    const map = {};
    Object.entries(scheduleByDate).forEach(([d, games]) => {
      const g = games.find(x => x.homeId === selectedTeamId || x.awayId === selectedTeamId);
      if (g) map[d] = g;
    });
    return map;
  }, [scheduleByDate, selectedTeamId]);

  // Focused date banner
  useEffect(() => {
    const firstGameDate = Object.keys(myGames).sort()[0];
    setFocusedDate(firstGameDate || fmt(seasonStart));
  }, [myGames, seasonStart]);

  // Months & visible days
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

  // Sim stubs (mark as played only)
  const handleSimToDate = (dateStr) => {
    const sorted = Object.keys(scheduleByDate).sort();
    const upd = { ...scheduleByDate };
    for (const d of sorted) if (d <= dateStr) upd[d] = upd[d].map((g) => ({ ...g, played: true }));
    saveSchedule(upd); setConfirmDate(null);
  };
  const handleSimSeason = () => {
    const upd = { ...scheduleByDate };
    Object.keys(upd).forEach((d) => (upd[d] = upd[d].map((g) => ({ ...g, played: true }))));
    saveSchedule(upd); setConfirmDate(null);
  };

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
      const isHome = g.homeId === (selectedTeam.id ?? selectedTeam.name);
      return `GAME DAY: ${isHome ? g.away : selectedTeam.name} @ ${isHome ? selectedTeam.name : g.home}`;
    }
    const dt = new Date(focusedDate);
    const label = dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    return `DATE: ${label}`;
  })();

  return (
    <div className="min-h-screen bg-neutral-900 text-white py-8">
      <div className="max-w-6xl mx-auto px-4">
        {/* Header: Current Team + arrows + Back */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <span className="text-gray-300">Current Team:</span>
            <Logo team={selectedTeam} size={32} />
            <h1 className="text-2xl font-extrabold text-orange-500">{selectedTeam.name}</h1>
            <div className="flex items-center gap-2 ml-2 select-none">
              <button onClick={() => handleTeamSwitch("prev")} className="text-2xl text-white hover:text-orange-400 transition-transform active:scale-90 font-bold" title="Previous Team">◄</button>
              <button onClick={() => handleTeamSwitch("next")} className="text-2xl text-white hover:text-orange-400 transition-transform active:scale-90 font-bold" title="Next Team">►</button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button className="px-3 py-2 bg-neutral-700 rounded hover:bg-neutral-600" onClick={() => navigate("/team-hub")}>Back to Team Hub</button>
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

        {/* Top banner like 2K */}
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
            const isHome = myGame && (myGame.homeId === (selectedTeam.id ?? selectedTeam.name));

            return (
              <div
                key={dateStr}
                className={`h-28 rounded-lg border bg-neutral-850 border-neutral-800 p-2 relative cursor-pointer hover:bg-neutral-700`}
                onClick={() => { setFocusedDate(dateStr); if (myGame) setConfirmDate(dateStr); }}
              >
                <div className="text-xs text-gray-400">{d.getDate()}</div>

                {myGame && (
                  <div className="mt-2 flex items-center gap-2">
                    <div title={isHome ? "Home" : "Away"} className={`w-2.5 h-2.5 rounded-full ${isHome ? "bg-blue-400" : "bg-red-400"}`} />
                    <div className="flex items-center gap-2">
                      <Logo team={isHome ? (teams.find(t => t.id === myGame.awayId) || { name: myGame.away }) : (teams.find(t => t.id === myGame.homeId) || { name: myGame.home })} size={32} />
                      <div className="text-sm">{isHome ? myGame.away : myGame.home}</div>
                    </div>
                  </div>
                )}

                {myGame?.played && (
                  <span className="absolute bottom-2 right-2 text-[10px] px-2 py-0.5 rounded bg-green-600/80">Simmed</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Confirm modal */}
      {confirmDate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-neutral-800 border border-neutral-700 rounded-xl p-5 w-[460px]">
            <h3 className="text-xl font-bold mb-2">Game Day: {confirmDate}</h3>
            <p className="text-gray-300 text-sm mb-4">Choose how far to simulate.</p>
            <div className="flex gap-3 justify-end">
              <button className="px-4 py-2 bg-neutral-700 rounded hover:bg-neutral-600" onClick={() => setConfirmDate(null)}>Cancel</button>
              <button className="px-4 py-2 bg-orange-600 rounded hover:bg-orange-500" onClick={() => handleSimToDate(confirmDate)}>Simulate to this day</button>
              <button className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-500" onClick={handleSimSeason}>Simulate season</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
