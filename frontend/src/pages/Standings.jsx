import React, { useMemo, useState } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";

export default function Standings() {
  const { leagueData, selectedTeam } = useGame();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState("all");

  const results = useMemo(() => {
    try {
      const raw = localStorage.getItem("bm_results_v1");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, []);

  const allTeams = useMemo(() => {
    if (!leagueData?.conferences) return [];
    return Object.entries(leagueData.conferences).flatMap(([conf, teams]) =>
      teams.map((t) => ({ ...t, conf }))
    );
  }, [leagueData]);

const teamStats = useMemo(() => {
  const stats = {};
  allTeams.forEach((t) => {
    stats[t.name] = { team: t.name, conf: t.conf, w: 0, l: 0, pf: 0, pa: 0 };
  });

  const parseTeams = (id) => {
    const parts = id.split("_vs_");
    if (parts.length < 2) return { home: null, away: null };
    const dateAndHome = parts[0].split("_");
    const date = dateAndHome[0];
    const home = dateAndHome.slice(1).join(" ");
    const away = parts[1].replace(/_\d+$/, "").trim();
    return { home, away, date };
  };

  Object.entries(results).forEach(([gameId, g]) => {
    const { home, away } = parseTeams(gameId);
    if (!home || !away || !g?.totals) return;

    const homePts = g.totals.home || 0;
    const awayPts = g.totals.away || 0;
    const winner = g.winner?.side;

    if (!stats[home]) stats[home] = { team: home, w: 0, l: 0, pf: 0, pa: 0 };
    if (!stats[away]) stats[away] = { team: away, w: 0, l: 0, pf: 0, pa: 0 };

    stats[home].pf += homePts;
    stats[home].pa += awayPts;
    stats[away].pf += awayPts;
    stats[away].pa += homePts;

    if (winner === "home") {
      stats[home].w++;
      stats[away].l++;
    } else if (winner === "away") {
      stats[away].w++;
      stats[home].l++;
    }
  });

  return Object.values(stats).map((t) => ({
    ...t,
    pct: (t.w + t.l) > 0 ? (t.w / (t.w + t.l)).toFixed(3) : "0.000",
    diff: t.pf - t.pa,
  }));
}, [results, allTeams]);


  const filtered = useMemo(() => {
    if (viewMode === "east")
      return teamStats.filter((t) => t.conf?.toLowerCase() === "east");
    if (viewMode === "west")
      return teamStats.filter((t) => t.conf?.toLowerCase() === "west");
    return teamStats;
  }, [teamStats, viewMode]);

  const sorted = useMemo(
    () =>
      [...filtered].sort(
        (a, b) => parseFloat(b.pct) - parseFloat(a.pct) || b.diff - a.diff
      ),
    [filtered]
  );

  return (
    <div className="min-h-screen bg-neutral-900 text-white py-10 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-orange-500">Standings</h1>
          <div className="flex gap-2">
            {["all", "east", "west"].map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 rounded ${
                  viewMode === mode ? "bg-orange-600" : "bg-neutral-700"
                }`}
              >
                {mode === "all"
                  ? "All"
                  : mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-auto rounded-xl border border-neutral-800">
          <table className="w-full text-sm text-center">
            <thead className="bg-neutral-800 text-gray-300">
              <tr>
                <th className="px-3 py-2 text-left pl-4">Team</th>
                <th className="px-3 py-2">W</th>
                <th className="px-3 py-2">L</th>
                <th className="px-3 py-2">PCT</th>
                <th className="px-3 py-2">PF</th>
                <th className="px-3 py-2">PA</th>
                <th className="px-3 py-2">DIFF</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t, i) => (
                <tr
                  key={t.team}
                  className={`hover:bg-neutral-800/60 ${
                    selectedTeam?.name === t.team ? "bg-orange-600/70" : ""
                  }`}
                >
                  <td className="px-3 py-2 text-left pl-4 font-semibold">
                    {i + 1}. {t.team}
                  </td>
                  <td className="px-3 py-2">{t.w}</td>
                  <td className="px-3 py-2">{t.l}</td>
                  <td className="px-3 py-2">{t.pct}</td>
                  <td className="px-3 py-2">{t.pf}</td>
                  <td className="px-3 py-2">{t.pa}</td>
                  <td className="px-3 py-2">{t.diff}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          onClick={() => navigate("/team-hub")}
          className="mt-8 px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold"
        >
          Back to Team Hub
        </button>
      </div>
    </div>
  );
}
