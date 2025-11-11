import React, { useEffect, useMemo, useState } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";

export default function PlayerStats() {
  const { leagueData, selectedTeam, setSelectedTeam } = useGame();
  const navigate = useNavigate();

  // ----- View mode: players (team), league (all players), teams (all teams) -----
  const [mode, setMode] = useState("players"); // "players" | "league" | "teams"

  // sorting
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "desc" });

  // selections for header card
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [selectedTeamRow, setSelectedTeamRow] = useState(null);

  // restore last viewed team (for players mode)
  useEffect(() => {
    if (!selectedTeam) {
      const saved = localStorage.getItem("selectedTeam");
      if (saved) setSelectedTeam(JSON.parse(saved));
    }
  }, [selectedTeam, setSelectedTeam]);

  useEffect(() => {
    if (selectedTeam) localStorage.setItem("selectedTeam", JSON.stringify(selectedTeam));
  }, [selectedTeam]);

  // load observed results
  const results = useMemo(() => {
    try {
      const saved = localStorage.getItem("bm_results_v1");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  }, []);

  if (!leagueData || !selectedTeam) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-neutral-900 text-white">
        <p className="mb-3 text-lg">No team selected or league missing.</p>
        <button
          onClick={() => navigate("/team-selector")}
          className="px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold"
        >
          Back to Team Select
        </button>
      </div>
    );
  }

  // ---------- league helpers ----------
  const allTeams = useMemo(() => {
    const confs = Object.values(leagueData.conferences || {});
    return confs.flat().sort((a, b) => a.name.localeCompare(b.name));
  }, [leagueData]);

  const playerToTeam = useMemo(() => {
    const map = {};
    for (const t of allTeams) {
      for (const p of t.players || []) map[p.name] = t.name;
    }
    return map;
  }, [allTeams]);

  const teamLogo = useMemo(() => {
    const map = {};
    for (const t of allTeams) map[t.name] = t.logo || "";
    return map;
  }, [allTeams]);

  const allPlayers = useMemo(() => {
    return allTeams.flatMap((t) =>
      (t.players || []).map((p) => ({
        ...p,
        teamName: t.name,
        teamLogo: t.logo || "",
      }))
    );
  }, [allTeams]);

  // ---------- per-player stats from observed results ----------
  const computePlayerStats = (playerName) => {
    let gp = 0,
      min = 0,
      pts = 0,
      reb = 0,
      ast = 0,
      stl = 0,
      blk = 0,
      fgm = 0,
      fga = 0,
      tpm = 0,
      tpa = 0,
      ftm = 0,
      fta = 0;

    for (const g of Object.values(results)) {
      if (!g.box) continue;
      for (const side of ["home", "away"]) {
        const rec = g.box[side]?.find((r) => r.player === playerName);
        if (rec) {
          gp++;
          min += rec.min || 0;
          pts += rec.pts || 0;
          reb += rec.reb || 0;
          ast += rec.ast || 0;
          stl += rec.stl || 0;
          blk += rec.blk || 0;

          const [fgmN, fgaN] = rec.fg?.split("/")?.map(Number) || [0, 0];
          const [tpmN, tpaN] = rec["3p"]?.split("/")?.map(Number) || [0, 0];
          const [ftmN, ftaN] = rec.ft?.split("/")?.map(Number) || [0, 0];
          fgm += fgmN;
          fga += fgaN;
          tpm += tpmN;
          tpa += tpaN;
          ftm += ftmN;
          fta += ftaN;
        }
      }
    }

    if (gp === 0) {
      return {
        GP: 0,
        MIN: 0,
        PTS: 0,
        REB: 0,
        AST: 0,
        STL: 0,
        BLK: 0,
        FG: 0,
        "3P": 0,
        FT: 0,
        "3PA": 0,
        FTA: 0,
      };
    }
    const games = gp || 1;
    return {
      GP: gp,
      MIN: (min / games).toFixed(1),
      PTS: (pts / games).toFixed(1),
      REB: (reb / games).toFixed(1),
      AST: (ast / games).toFixed(1),
      STL: (stl / games).toFixed(1),
      BLK: (blk / games).toFixed(1),
      FG: fga > 0 ? ((fgm / fga) * 100).toFixed(1) : "0.0",
      "3P": tpa > 0 ? ((tpm / tpa) * 100).toFixed(1) : "0.0",
      FT: fta > 0 ? ((ftm / fta) * 100).toFixed(1) : "0.0",
      "3PA": (tpa / games).toFixed(1),
      FTA: (fta / games).toFixed(1),
    };
  };

  // ---------- team aggregates strictly from observed results (adds PA) ----------
  const allTeamsAgg = useMemo(() => {
    const totals = {}; // season totals
    const ensure = (team) => {
      if (!totals[team]) {
        totals[team] = {
          gp: 0,
          pts: 0,
          oppPts: 0, // <-- points allowed accumulator
          reb: 0,
          ast: 0,
          stl: 0,
          blk: 0,
          fgm: 0,
          fga: 0,
          tpm: 0,
          tpa: 0,
          ftm: 0,
          fta: 0,
        };
      }
      return totals[team];
    };

    for (const g of Object.values(results)) {
      if (!g.box) continue;

      // Build per-game team totals
      const perGameByTeam = {}; // { team: { pts, reb, ... } }
      for (const side of ["home", "away"]) {
        const list = g.box[side] || [];
        for (const rec of list) {
          const team = playerToTeam[rec.player];
          if (!team) continue;
          if (!perGameByTeam[team]) {
            perGameByTeam[team] = {
              pts: 0,
              reb: 0,
              ast: 0,
              stl: 0,
              blk: 0,
              fgm: 0,
              fga: 0,
              tpm: 0,
              tpa: 0,
              ftm: 0,
              fta: 0,
            };
          }
          perGameByTeam[team].pts += rec.pts || 0;
          perGameByTeam[team].reb += rec.reb || 0;
          perGameByTeam[team].ast += rec.ast || 0;
          perGameByTeam[team].stl += rec.stl || 0;
          perGameByTeam[team].blk += rec.blk || 0;

          const [fgmN, fgaN] = rec.fg?.split("/")?.map(Number) || [0, 0];
          const [tpmN, tpaN] = rec["3p"]?.split("/")?.map(Number) || [0, 0];
          const [ftmN, ftaN] = rec.ft?.split("/")?.map(Number) || [0, 0];
          perGameByTeam[team].fgm += fgmN;
          perGameByTeam[team].fga += fgaN;
          perGameByTeam[team].tpm += tpmN;
          perGameByTeam[team].tpa += tpaN;
          perGameByTeam[team].ftm += ftmN;
          perGameByTeam[team].fta += ftaN;
        }
      }

      // For each team in this game, opponent points = sum(other teams' points)
      const entries = Object.entries(perGameByTeam);
      for (const [team, box] of entries) {
        const oppPts = entries
          .filter(([t]) => t !== team)
          .reduce((s, [, b]) => s + (b.pts || 0), 0);

        const row = ensure(team);
        row.gp += 1;
        row.pts += box.pts;
        row.oppPts += oppPts; // <-- accumulate PA
        row.reb += box.reb;
        row.ast += box.ast;
        row.stl += box.stl;
        row.blk += box.blk;
        row.fgm += box.fgm;
        row.fga += box.fga;
        row.tpm += box.tpm;
        row.tpa += box.tpa;
        row.ftm += box.ftm;
        row.fta += box.fta;
      }
    }

    // produce per-game averages (include PA)
    const rows = Object.keys(totals).map((team) => {
      const t = totals[team];
      const gp = Math.max(1, t.gp);
      const FG = t.fga > 0 ? ((t.fgm / t.fga) * 100).toFixed(1) : "0.0";
      const TP = t.tpa > 0 ? ((t.tpm / t.tpa) * 100).toFixed(1) : "0.0";
      const FT = t.fta > 0 ? ((t.ftm / t.fta) * 100).toFixed(1) : "0.0";
      return {
        teamName: team,
        logo: teamLogo[team] || "",
        stats: {
          GP: t.gp,
          PTS: (t.pts / gp).toFixed(1),
          PA: (t.oppPts / gp).toFixed(1), // <-- points allowed per game
          REB: (t.reb / gp).toFixed(1),
          AST: (t.ast / gp).toFixed(1),
          STL: (t.stl / gp).toFixed(1),
          BLK: (t.blk / gp).toFixed(1),
          FG,
          "3P": TP,
          FT,
          "3PA": (t.tpa / gp).toFixed(1),
          FTA: (t.fta / gp).toFixed(1),
        },
      };
    });

    // include teams with 0 games so far (showing zeros)
    const have = new Set(rows.map((r) => r.teamName));
    for (const t of allTeams) {
      if (!have.has(t.name)) {
        rows.push({
          teamName: t.name,
          logo: t.logo || "",
          stats: {
            GP: 0,
            PTS: "0.0",
            PA: "0.0",
            REB: "0.0",
            AST: "0.0",
            STL: "0.0",
            BLK: "0.0",
            FG: "0.0",
            "3P": "0.0",
            FT: "0.0",
            "3PA": "0.0",
            FTA: "0.0",
          },
        });
      }
    }

    return rows.sort((a, b) => a.teamName.localeCompare(b.teamName));
  }, [results, playerToTeam, teamLogo, allTeams]);

  // ---------- rows for current mode ----------
  const positionOrder = ["PG", "SG", "SF", "PF", "C"];

  const teamPlayers = useMemo(() => {
    const roster = selectedTeam.players || [];
    return roster.map((p) => ({ ...p, stats: computePlayerStats(p.name) }));
  }, [selectedTeam, results]);

  const leaguePlayers = useMemo(() => {
    return allPlayers.map((p) => ({ ...p, stats: computePlayerStats(p.name) }));
  }, [allPlayers, results]);

  useEffect(() => {
    if (mode === "players") {
      setSelectedPlayer((prev) => prev || (teamPlayers[0] || null));
    } else if (mode === "league") {
      setSelectedPlayer((prev) => prev || (leaguePlayers[0] || null));
    } else if (mode === "teams") {
      setSelectedTeamRow((prev) => prev || (allTeamsAgg[0]?.teamName || null));
    }
  }, [mode, teamPlayers, leaguePlayers, allTeamsAgg]);

  // team switching (players mode only)
  const currentIndex = allTeams.findIndex((t) => t.name === selectedTeam.name);
  const handleTeamSwitch = (dir) => {
    if (mode !== "players") return;
    let newIndex = dir === "next" ? currentIndex + 1 : currentIndex - 1;
    newIndex = (newIndex + allTeams.length) % allTeams.length;
    setSelectedTeam(allTeams[newIndex]);
    setSelectedPlayer(null);
  };

  const handleSort = (key) => {
    let direction = "desc";
    if (sortConfig.key === key && sortConfig.direction === "desc") direction = "asc";
    else if (sortConfig.key === key && sortConfig.direction === "asc") direction = "default";
    setSortConfig({ key, direction });
  };

  const baseCols = [
    { key: "name", label: "Name" },
    { key: "pos", label: "POS" },
    { key: "GP", label: "GP" },
    { key: "MIN", label: "MIN" },
    { key: "PTS", label: "PTS" },
    { key: "REB", label: "REB" },
    { key: "AST", label: "AST" },
    { key: "STL", label: "STL" },
    { key: "BLK", label: "BLK" },
    { key: "FG", label: "FG%" },
    { key: "3P", label: "3P%" },
    { key: "FT", label: "FT%" },
    { key: "3PA", label: "3PA" },
    { key: "FTA", label: "FTA" },
  ];

  // Team table columns (adds PA after PTS)
  const teamCols = [
    { key: "team", label: "Team" },
    { key: "GP", label: "GP" },
    { key: "PTS", label: "PTS" },
    { key: "PA", label: "PA" }, // <-- Points Allowed per game
    { key: "REB", label: "REB" },
    { key: "AST", label: "AST" },
    { key: "STL", label: "STL" },
    { key: "BLK", label: "BLK" },
    { key: "FG", label: "FG%" },
    { key: "3P", label: "3P%" },
    { key: "FT", label: "FT%" },
    { key: "3PA", label: "3PA" },
    { key: "FTA", label: "FTA" },
  ];

  // sort helpers
  const applySort = (rows, type) => {
    if (!sortConfig.key || sortConfig.direction === "default") return rows;

    const dir = sortConfig.direction === "asc" ? 1 : -1;
    const sorted = [...rows];

    if (type === "players") {
      sorted.sort((a, b) => {
        const key = sortConfig.key;
        if (key === "name") return dir * a.name.localeCompare(b.name);
        if (key === "pos") {
          const aIdx = positionOrder.indexOf(a.pos);
          const bIdx = positionOrder.indexOf(b.pos);
          return dir * ((aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx));
        }
        const aVal = parseFloat(a.stats?.[key]) || 0;
        const bVal = parseFloat(b.stats?.[key]) || 0;
        return dir * (aVal - bVal);
      });
    } else if (type === "teams") {
      sorted.sort((a, b) => {
        const key = sortConfig.key;
        if (key === "team") return dir * a.teamName.localeCompare(b.teamName);
        const aVal = parseFloat(a.stats?.[key]) || 0;
        const bVal = parseFloat(b.stats?.[key]) || 0;
        return dir * (aVal - bVal);
      });
    }

    return sorted;
  };

  const rowsPlayers =
    mode === "players" ? applySort(teamPlayers, "players") : applySort(leaguePlayers, "players");
  const rowsTeams = applySort(allTeamsAgg, "teams");

  // header player circle fill
  const cardPlayer =
    mode === "players" || mode === "league" ? selectedPlayer || rowsPlayers[0] : null;
  const fillPercent = Math.min((cardPlayer?.overall || 0) / 99, 1);
  const circleCircumference = 2 * Math.PI * 50;
  const strokeOffset = circleCircumference * (1 - fillPercent);

  // selected team row object for teams mode
  const cardTeam = useMemo(
    () => rowsTeams.find((r) => r.teamName === selectedTeamRow) || rowsTeams[0],
    [rowsTeams, selectedTeamRow]
  );

  return (
    <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center py-10">
      {/* Header: pinned arrows + centered title + mode switch */}
      <div className="w-full max-w-5xl flex items-center justify-between mb-6 select-none">
        <div className="w-24 flex items-center justify-start">
          <button
            onClick={() => handleTeamSwitch("prev")}
            disabled={mode !== "players"}
            className={`text-4xl font-bold transition-transform active:scale-90 ${
              mode === "players"
                ? "text-white hover:text-orange-400"
                : "text-neutral-600 cursor-not-allowed"
            }`}
            title={mode === "players" ? "Prev team" : "Team switch available in Players view"}
          >
            ◄
          </button>
        </div>

        <h1 className="text-3xl md:text-4xl font-extrabold text-orange-500 text-center">
          {mode === "players"
            ? `${selectedTeam.name} Stats`
            : mode === "league"
            ? "All League Players"
            : "All Teams"}
        </h1>

        <div className="w-24 flex items-center justify-end">
          <button
            onClick={() => handleTeamSwitch("next")}
            disabled={mode !== "players"}
            className={`text-4xl font-bold transition-transform active:scale-90 ${
              mode === "players"
                ? "text-white hover:text-orange-400"
                : "text-neutral-600 cursor-not-allowed"
            }`}
            title={mode === "players" ? "Next team" : "Team switch available in Players view"}
          >
            ►
          </button>
        </div>
      </div>

      {/* Mode switch */}
      <div className="w-full max-w-5xl flex items-center justify-end gap-2 mb-3">
        {[
          { k: "players", label: "Players" },
          { k: "league", label: "All League" },
          { k: "teams", label: "Teams" },
        ].map((tab) => (
          <button
            key={tab.k}
            onClick={() => {
              setMode(tab.k);
              setSortConfig({ key: null, direction: "desc" });
            }}
            className={`px-3 py-1 rounded-md text-sm font-semibold ${
              mode === tab.k ? "bg-orange-600 text-white" : "bg-neutral-800 text-gray-300 hover:bg-neutral-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Header card */}
      {mode !== "teams" && cardPlayer && (
        <div className="relative w-full flex justify-center">
          <div className="relative bg-neutral-800 w-full max-w-5xl px-8 pt-8 pb-3 rounded-t-xl shadow-lg">
            <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-white opacity-60"></div>
            <div className="flex items-end justify-between relative">
              <div className="flex items-end gap-6">
                <div className="relative -mb-[9px]">
                  <img
                    src={cardPlayer.headshot}
                    alt={cardPlayer.name}
                    className="h-[175px] w-auto object-contain"
                  />
                </div>
                <div className="flex flex-col justify-end mb-3">
                  <h2 className="text-[44px] font-bold leading-tight">{cardPlayer.name}</h2>
                  <p className="text-gray-400 text-[24px] mt-1">
                    {cardPlayer.pos}
                    {cardPlayer.secondaryPos ? ` / ${cardPlayer.secondaryPos}` : ""} • Age{" "}
                    {cardPlayer.age}
                  </p>
                </div>
              </div>

              {/* OVR circle */}
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
                    {cardPlayer.overall}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-[-2px]">
                    POT <span className="text-orange-400 font-semibold">{cardPlayer.potential}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {mode === "teams" && cardTeam && (
        <div className="relative w-full flex justify-center">
          <div className="relative bg-neutral-800 w-full max-w-5xl px-8 pt-8 pb-4 rounded-t-xl shadow-lg">
            <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-white opacity-60"></div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                {/* Transparent logo (no background tile) */}
                <img
                  src={cardTeam.logo}
                  alt={cardTeam.teamName}
                  className="h-[90px] w-[90px] object-contain"
                />
                <h2 className="text-[40px] font-bold leading-tight">{cardTeam.teamName}</h2>
              </div>
              <div className="text-right text-gray-300 text-lg">
                <div>
                  GP: <span className="text-white font-semibold">{cardTeam.stats.GP}</span>
                </div>
                <div>
                  PTS: <span className="text-white font-semibold">{cardTeam.stats.PTS}</span>
                </div>
                <div>
                  PA: <span className="text-white font-semibold">{cardTeam.stats.PA}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tables */}
      <div className="w-full flex justify-center mt-[-1px]">
        <div className="w-full max-w-5xl overflow-x-auto">
          {(mode === "players" || mode === "league") && (
            <table className="w-full border-collapse text-center text-[17px] font-medium">
              <thead className="bg-neutral-800 text-gray-300 text-[16px] font-semibold">
                <tr>
                  {mode === "league" && <th className="py-3 px-2 min-w-[60px]">Team</th>}
                  {baseCols.map((col) => (
                    <th
                      key={col.key}
                      className={`py-3 px-3 min-w-[90px] ${
                        col.key === "name" ? "min-w-[150px] text-left pl-4" : "text-center"
                      } cursor-pointer select-none`}
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label}
                      {sortConfig.key === col.key && (
                        <span className="ml-1 text-orange-400">
                          {sortConfig.direction === "asc"
                            ? "▲"
                            : sortConfig.direction === "desc"
                            ? "▼"
                            : ""}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsPlayers.map((p) => (
                  <tr
                    key={`${p.teamName || selectedTeam.name}-${p.name}`}
                    onClick={() => setSelectedPlayer(p)}
                    className={`cursor-pointer transition ${
                      (selectedPlayer || rowsPlayers[0])?.name === p.name
                        ? "bg-orange-600 text-white"
                        : "hover:bg-neutral-800"
                    }`}
                  >
                    {mode === "league" && (
                      <td className="py-2 px-2">
                        {/* Fine to keep transparent here too if you like; currently unchanged */}
                        <img
                          src={p.teamLogo}
                          alt={p.teamName}
                          className="inline-block h-[36px] w-[36px] object-contain"
                          title={p.teamName}
                        />
                      </td>
                    )}
                    <td className="py-2 px-3 text-left pl-4">{p.name}</td>
                    <td>{p.pos}</td>
                    <td>{p.stats.GP}</td>
                    <td>{p.stats.MIN}</td>
                    <td>{p.stats.PTS}</td>
                    <td>{p.stats.REB}</td>
                    <td>{p.stats.AST}</td>
                    <td>{p.stats.STL}</td>
                    <td>{p.stats.BLK}</td>
                    <td>{p.stats.FG}</td>
                    <td>{p.stats["3P"]}</td>
                    <td>{p.stats.FT}</td>
                    <td>{p.stats["3PA"]}</td>
                    <td>{p.stats.FTA}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {mode === "teams" && (
            <table className="w-full border-collapse text-center text-[17px] font-medium">
              <thead className="bg-neutral-800 text-gray-300 text-[16px] font-semibold">
                <tr>
                  {teamCols.map((col) => (
                    <th
                      key={col.key}
                      className={`py-3 px-3 min-w-[90px] ${
                        col.key === "team" ? "min-w-[170px] text-left pl-4" : "text-center"
                      } cursor-pointer select-none`}
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label}
                      {sortConfig.key === col.key && (
                        <span className="ml-1 text-orange-400">
                          {sortConfig.direction === "asc"
                            ? "▲"
                            : sortConfig.direction === "desc"
                            ? "▼"
                            : ""}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsTeams.map((t) => (
                  <tr
                    key={t.teamName}
                    onClick={() => setSelectedTeamRow(t.teamName)}
                    className={`cursor-pointer transition ${
                      (cardTeam || rowsTeams[0])?.teamName === t.teamName
                        ? "bg-orange-600 text-white"
                        : "hover:bg-neutral-800"
                    }`}
                  >
                    <td className="py-2 px-3 text-left pl-4">
                      <div className="flex items-center gap-3">
                        {/* Transparent logo (no background tile) */}
                        <img
                          src={t.logo}
                          alt={t.teamName}
                          className="h-[32px] w-[32px] object-contain"
                        />
                        <span>{t.teamName}</span>
                      </div>
                    </td>
                    <td>{t.stats.GP}</td>
                    <td>{t.stats.PTS}</td>
                    <td>{t.stats.PA}</td>
                    <td>{t.stats.REB}</td>
                    <td>{t.stats.AST}</td>
                    <td>{t.stats.STL}</td>
                    <td>{t.stats.BLK}</td>
                    <td>{t.stats.FG}</td>
                    <td>{t.stats["3P"]}</td>
                    <td>{t.stats.FT}</td>
                    <td>{t.stats["3PA"]}</td>
                    <td>{t.stats.FTA}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
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
