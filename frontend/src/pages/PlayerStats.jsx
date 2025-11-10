import React, { useMemo, useState, useEffect } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";

export default function PlayerStats() {
  const { leagueData, selectedTeam, setSelectedTeam } = useGame();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState("my"); // my | east | west | all
  const [sortConfig, setSortConfig] = useState({ key: "pts", dir: "desc" });

  // --- Load results from localStorage ---
  const results = useMemo(() => {
    try {
      const raw = localStorage.getItem("bm_results_v1");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, []);

  // --- Flatten league teams ---
  const allTeams = useMemo(() => {
    if (!leagueData?.conferences) return [];
    return Object.entries(leagueData.conferences).flatMap(([conf, teams]) =>
      teams.map((t) => ({ ...t, conf }))
    );
  }, [leagueData]);

  // --- Aggregate stats per player ---
  const allStats = useMemo(() => {
    const totals = {}; // playerName -> totals

    Object.values(results).forEach((g) => {
      if (!g?.box) return;
      for (const side of ["home", "away"]) {
        (g.box[side] || []).forEach((row) => {
          const name = row.player;
          if (!totals[name]) {
            totals[name] = {
              player: name,
              gp: 0,
              min: 0,
              pts: 0,
              reb: 0,
              ast: 0,
              stl: 0,
              blk: 0,
              to: 0,
              pf: 0,
              fgm: 0,
              fga: 0,
              tpm: 0,
              tpa: 0,
              ftm: 0,
              fta: 0,
            };
          }
          const t = totals[name];
          t.gp += 1;
          t.min += parseFloat(row.min) || 0;
          t.pts += row.pts || 0;
          t.reb += row.reb || 0;
          t.ast += row.ast || 0;
          t.stl += row.stl || 0;
          t.blk += row.blk || 0;
          t.to += row.to || 0;
          t.pf += row.pf || 0;

          const parsePair = (val) =>
            val && val.includes("/")
              ? val.split("/").map((x) => parseInt(x) || 0)
              : [0, 0];
          const [fgm, fga] = parsePair(row.fg);
          const [tpm, tpa] = parsePair(row["3p"]);
          const [ftm, fta] = parsePair(row.ft || "0/0");
          t.fgm += fgm;
          t.fga += fga;
          t.tpm += tpm;
          t.tpa += tpa;
          t.ftm += ftm;
          t.fta += fta;
        });
      }
    });

    // Merge 0-GP players from rosters
    allTeams.forEach((team) =>
      (team.players || []).forEach((p) => {
        if (!totals[p.name]) {
          totals[p.name] = { player: p.name, gp: 0 };
        }
        totals[p.name].team = team.name;
        totals[p.name].conf = team.conf;
        totals[p.name].headshot = p.headshot;
      })
    );

    return Object.values(totals).map((p) => ({
      ...p,
      team: p.team || "Free Agent",
      conf: p.conf || "Unknown",
      min: p.gp ? (p.min / p.gp).toFixed(1) : 0,
      pts: p.gp ? (p.pts / p.gp).toFixed(1) : 0,
      reb: p.gp ? (p.reb / p.gp).toFixed(1) : 0,
      ast: p.gp ? (p.ast / p.gp).toFixed(1) : 0,
      stl: p.gp ? (p.stl / p.gp).toFixed(1) : 0,
      blk: p.gp ? (p.blk / p.gp).toFixed(1) : 0,
      fgPct: p.fga ? ((p.fgm / p.fga) * 100).toFixed(1) : "-",
      tpPct: p.tpa ? ((p.tpm / p.tpa) * 100).toFixed(1) : "-",
      ftPct: p.fta ? ((p.ftm / p.fta) * 100).toFixed(1) : "-",
      tpa: p.tpa,
      fta: p.fta,
    }));
  }, [results, allTeams]);

  // --- Filter by view mode ---
  const filteredStats = useMemo(() => {
    if (viewMode === "my" && selectedTeam)
      return allStats.filter((p) => p.team === selectedTeam.name);
    if (viewMode === "east")
      return allStats.filter((p) => p.conf?.toLowerCase() === "east");
    if (viewMode === "west")
      return allStats.filter((p) => p.conf?.toLowerCase() === "west");
    return allStats;
  }, [viewMode, selectedTeam, allStats]);

  // --- Sorting ---
  const sorted = useMemo(() => {
    const { key, dir } = sortConfig;
    const arr = [...filteredStats];
    arr.sort((a, b) => {
      const aVal = parseFloat(a[key]) || 0;
      const bVal = parseFloat(b[key]) || 0;
      return dir === "asc" ? aVal - bVal : bVal - aVal;
    });
    return arr;
  }, [filteredStats, sortConfig]);

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key)
        return { key, dir: prev.dir === "desc" ? "asc" : "desc" };
      return { key, dir: "desc" };
    });
  };

  // --- UI ---
  const columns = [
    { key: "player", label: "Player" },
    { key: "team", label: "Team" },
    { key: "gp", label: "GP" },
    { key: "min", label: "MIN" },
    { key: "pts", label: "PTS" },
    { key: "reb", label: "REB" },
    { key: "ast", label: "AST" },
    { key: "stl", label: "STL" },
    { key: "blk", label: "BLK" },
    { key: "fgPct", label: "FG%" },
    { key: "tpPct", label: "3P%" },
    { key: "ftPct", label: "FT%" },
    { key: "tpa", label: "3PA" },
    { key: "fta", label: "FTA" },
  ];

  return (
    <div className="min-h-screen bg-neutral-900 text-white py-10 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-orange-500">Player Stats</h1>
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode("my")}
              className={`px-3 py-1 rounded ${
                viewMode === "my" ? "bg-orange-600" : "bg-neutral-700"
              }`}
            >
              My Team
            </button>
            <button
              onClick={() => setViewMode("east")}
              className={`px-3 py-1 rounded ${
                viewMode === "east" ? "bg-orange-600" : "bg-neutral-700"
              }`}
            >
              East
            </button>
            <button
              onClick={() => setViewMode("west")}
              className={`px-3 py-1 rounded ${
                viewMode === "west" ? "bg-orange-600" : "bg-neutral-700"
              }`}
            >
              West
            </button>
            <button
              onClick={() => setViewMode("all")}
              className={`px-3 py-1 rounded ${
                viewMode === "all" ? "bg-orange-600" : "bg-neutral-700"
              }`}
            >
              All
            </button>
          </div>
        </div>

        <div className="overflow-auto rounded-xl border border-neutral-800">
          <table className="w-full text-sm text-center">
            <thead className="bg-neutral-800 text-gray-300">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className="px-3 py-2 cursor-pointer select-none"
                  >
                    {col.label}
                    {sortConfig.key === col.key && (
                      <span className="text-orange-400 ml-1">
                        {sortConfig.dir === "desc" ? "▼" : "▲"}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.player} className="hover:bg-neutral-800/60">
                  <td className="px-3 py-2">{p.player}</td>
                  <td className="px-3 py-2 text-gray-300">{p.team}</td>
                  <td className="px-3 py-2">{p.gp || 0}</td>
                  <td className="px-3 py-2">{p.min}</td>
                  <td className="px-3 py-2 font-semibold text-orange-400">
                    {p.pts}
                  </td>
                  <td className="px-3 py-2">{p.reb}</td>
                  <td className="px-3 py-2">{p.ast}</td>
                  <td className="px-3 py-2">{p.stl}</td>
                  <td className="px-3 py-2">{p.blk}</td>
                  <td className="px-3 py-2">{p.fgPct}</td>
                  <td className="px-3 py-2">{p.tpPct}</td>
                  <td className="px-3 py-2">{p.ftPct}</td>
                  <td className="px-3 py-2">{p.tpa}</td>
                  <td className="px-3 py-2">{p.fta}</td>
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
