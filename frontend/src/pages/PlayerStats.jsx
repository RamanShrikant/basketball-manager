import React, { useEffect, useMemo, useState } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";
import LZString from "lz-string";
import PlayerCardModal from "../components/PlayerCardModal.jsx";

/* -------------------------------------------------------------------------- */
/*                              STORAGE HELPERS                               */
/* -------------------------------------------------------------------------- */

const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_";
const PLAYER_STATS_KEY = "bm_player_stats_v1";
const SCHED_KEY = "bm_schedule_v3";

const resultV3Key = (gameId) => `${RESULT_V3_PREFIX}${gameId}`;

function readCompressedOrJson(key, fallback = {}) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;

    if (raw.startsWith("lz:")) {
      const decompressed = LZString.decompressFromUTF16(raw.slice(3));
      return decompressed ? JSON.parse(decompressed) : fallback;
    }

    try {
      return JSON.parse(raw);
    } catch {}

    const decompressed = LZString.decompressFromUTF16(raw);
    return decompressed ? JSON.parse(decompressed) : fallback;
  } catch {
    return fallback;
  }
}

function loadResultsIndexV3() {
  try {
    const raw = localStorage.getItem(RESULT_V3_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadOneResultV3(gameId) {
  try {
    const stored = localStorage.getItem(resultV3Key(gameId));
    if (!stored) return null;

    const decompressed = LZString.decompressFromUTF16(stored);
    const json = decompressed || stored;
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function loadAllResultsV3() {
  const ids = loadResultsIndexV3();
  const out = {};

  for (const id of ids) {
    const r = loadOneResultV3(id);
    if (r) out[String(id)] = r;
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/*                               LEAGUE HELPERS                               */
/* -------------------------------------------------------------------------- */

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function playerNameOf(player) {
  return player?.name || player?.player || "Unknown";
}

function playerPosOf(player) {
  return player?.pos || player?.position || "-";
}

function teamLogoOf(team) {
  return (
    team?.logo ||
    team?.teamLogo ||
    team?.newTeamLogo ||
    team?.logoUrl ||
    team?.image ||
    team?.img ||
    ""
  );
}

function playerHeadshotOf(player) {
  return (
    player?.headshot ||
    player?.portrait ||
    player?.image ||
    player?.photo ||
    player?.img ||
    player?.face ||
    ""
  );
}

function fmtAvg(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : "0.0";
}

/* -------------------------------------------------------------------------- */
/*                                 COMPONENT                                  */
/* -------------------------------------------------------------------------- */

export default function PlayerStats() {
  const { leagueData, selectedTeam, setSelectedTeam } = useGame();
  const navigate = useNavigate();

  const [mode, setMode] = useState("players"); // players | league | teams
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "desc" });
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playerCardPlayer, setPlayerCardPlayer] = useState(null);
  const [selectedTeamRow, setSelectedTeamRow] = useState(null);

  useEffect(() => {
    if (selectedTeam) return;

    try {
      const saved = localStorage.getItem("selectedTeam");
      if (!saved) return;

      const parsed = JSON.parse(saved);
      if (typeof parsed === "string") setSelectedTeam(parsed);
      else if (parsed?.name) setSelectedTeam(parsed.name);
    } catch {}
  }, [selectedTeam, setSelectedTeam]);

  useEffect(() => {
    if (selectedTeam?.name) {
      localStorage.setItem("selectedTeam", JSON.stringify(selectedTeam.name));
    }
  }, [selectedTeam]);

  const allTeams = useMemo(() => {
    return getAllTeamsFromLeague(leagueData)
      .filter((team) => team?.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [leagueData]);

  const teamLogo = useMemo(() => {
    const map = {};
    for (const team of allTeams) {
      map[team.name] = teamLogoOf(team);
    }
    return map;
  }, [allTeams]);

  const allPlayers = useMemo(() => {
    return allTeams.flatMap((team) =>
      (team.players || []).map((player) => ({
        ...player,
        name: playerNameOf(player),
        pos: playerPosOf(player),
        headshot: playerHeadshotOf(player),
        teamName: team.name,
        teamLogo: teamLogoOf(team),
      }))
    );
  }, [allTeams]);

  const playerStatsMap = useMemo(() => {
    return readCompressedOrJson(PLAYER_STATS_KEY, {});
  }, []);

  const schedule = useMemo(() => {
    return readCompressedOrJson(SCHED_KEY, {});
  }, []);

  const results = useMemo(() => loadAllResultsV3(), []);

  const computePlayerStats = (playerName, teamName) => {
    const key = `${playerName}__${teamName}`;
    const rec = playerStatsMap?.[key];

    if (!rec || !Number(rec.gp || 0)) {
      return {
        GP: 0,
        MIN: "0.0",
        PTS: "0.0",
        REB: "0.0",
        AST: "0.0",
        STL: "0.0",
        BLK: "0.0",
        FG: "0.0",
        "3P": "0.0",
        FT: "0.0",
        "3PA": "0.0",
        FTA: "0.0",
      };
    }

    const games = Number(rec.gp || 1);
    const fgPct = rec.fga > 0 ? (Number(rec.fgm || 0) / Number(rec.fga || 1)) * 100 : 0;
    const tpPct = rec.tpa > 0 ? (Number(rec.tpm || 0) / Number(rec.tpa || 1)) * 100 : 0;
    const ftPct = rec.fta > 0 ? (Number(rec.ftm || 0) / Number(rec.fta || 1)) * 100 : 0;

    return {
      GP: Number(rec.gp || 0),
      MIN: fmtAvg(Number(rec.min || 0) / games),
      PTS: fmtAvg(Number(rec.pts || 0) / games),
      REB: fmtAvg(Number(rec.reb || 0) / games),
      AST: fmtAvg(Number(rec.ast || 0) / games),
      STL: fmtAvg(Number(rec.stl || 0) / games),
      BLK: fmtAvg(Number(rec.blk || 0) / games),
      FG: fmtAvg(fgPct),
      "3P": fmtAvg(tpPct),
      FT: fmtAvg(ftPct),
      "3PA": fmtAvg(Number(rec.tpa || 0) / games),
      FTA: fmtAvg(Number(rec.fta || 0) / games),
    };
  };

  const teamPlayers = useMemo(() => {
    if (!selectedTeam?.players) return [];

    return (selectedTeam.players || []).map((player) => ({
      ...player,
      name: playerNameOf(player),
      pos: playerPosOf(player),
      headshot: playerHeadshotOf(player),
      teamName: selectedTeam.name,
      teamLogo: teamLogoOf(selectedTeam),
      stats: computePlayerStats(playerNameOf(player), selectedTeam.name),
    }));
  }, [selectedTeam, playerStatsMap]);

  const leaguePlayers = useMemo(() => {
    return allPlayers.map((player) => ({
      ...player,
      stats: computePlayerStats(player.name, player.teamName),
    }));
  }, [allPlayers, playerStatsMap]);

  const allTeamsAgg = useMemo(() => {
    const totals = {};

    const ensure = (teamName) => {
      if (!teamName) return null;

      if (!totals[teamName]) {
        totals[teamName] = {
          gp: 0,
          pts: 0,
          oppPts: 0,
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

      return totals[teamName];
    };

    for (const games of Object.values(schedule || {})) {
      for (const game of games || []) {
        const result = results?.[String(game.id)];
        if (!result?.totals) continue;

        const homeRow = ensure(game.home);
        const awayRow = ensure(game.away);
        if (!homeRow || !awayRow) continue;

        homeRow.gp += 1;
        homeRow.pts += Number(result.totals.home || 0);
        homeRow.oppPts += Number(result.totals.away || 0);

        awayRow.gp += 1;
        awayRow.pts += Number(result.totals.away || 0);
        awayRow.oppPts += Number(result.totals.home || 0);
      }
    }

    for (const rec of Object.values(playerStatsMap || {})) {
      const row = ensure(rec?.team);
      if (!row) continue;

      row.reb += Number(rec.reb || 0);
      row.ast += Number(rec.ast || 0);
      row.stl += Number(rec.stl || 0);
      row.blk += Number(rec.blk || 0);
      row.fgm += Number(rec.fgm || 0);
      row.fga += Number(rec.fga || 0);
      row.tpm += Number(rec.tpm || 0);
      row.tpa += Number(rec.tpa || 0);
      row.ftm += Number(rec.ftm || 0);
      row.fta += Number(rec.fta || 0);
    }

    const rows = Object.keys(totals).map((teamName) => {
      const t = totals[teamName];
      const gp = Number(t.gp || 0);
      const safeGp = gp || 1;

      return {
        teamName,
        logo: teamLogo[teamName] || "",
        stats: {
          GP: gp,
          PTS: fmtAvg(t.pts / safeGp),
          PA: fmtAvg(t.oppPts / safeGp),
          REB: fmtAvg(t.reb / safeGp),
          AST: fmtAvg(t.ast / safeGp),
          STL: fmtAvg(t.stl / safeGp),
          BLK: fmtAvg(t.blk / safeGp),
          FG: t.fga > 0 ? fmtAvg((t.fgm / t.fga) * 100) : "0.0",
          "3P": t.tpa > 0 ? fmtAvg((t.tpm / t.tpa) * 100) : "0.0",
          FT: t.fta > 0 ? fmtAvg((t.ftm / t.fta) * 100) : "0.0",
          "3PA": fmtAvg(t.tpa / safeGp),
          FTA: fmtAvg(t.fta / safeGp),
        },
      };
    });

    const have = new Set(rows.map((row) => row.teamName));

    for (const team of allTeams) {
      if (!have.has(team.name)) {
        rows.push({
          teamName: team.name,
          logo: teamLogoOf(team),
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
  }, [schedule, results, playerStatsMap, allTeams, teamLogo]);

  useEffect(() => {
    if (mode === "players") {
      setSelectedPlayer((prev) => {
        if (prev && teamPlayers.some((p) => p.name === prev.name)) return prev;
        return teamPlayers[0] || null;
      });
    }

    if (mode === "league") {
      setSelectedPlayer((prev) => {
        if (prev && leaguePlayers.some((p) => p.name === prev.name && p.teamName === prev.teamName)) return prev;
        return leaguePlayers[0] || null;
      });
    }

    if (mode === "teams") {
      setSelectedTeamRow((prev) => {
        if (prev && allTeamsAgg.some((row) => row.teamName === prev)) return prev;
        return allTeamsAgg[0]?.teamName || null;
      });
    }
  }, [mode, teamPlayers, leaguePlayers, allTeamsAgg]);

  const currentIndex = selectedTeam
    ? allTeams.findIndex((team) => team.name === selectedTeam.name)
    : -1;

  const handleTeamSwitch = (dir) => {
    if (mode !== "players") return;
    if (!allTeams.length || currentIndex < 0) return;

    let newIndex = dir === "next" ? currentIndex + 1 : currentIndex - 1;
    newIndex = (newIndex + allTeams.length) % allTeams.length;

    setSelectedTeam(allTeams[newIndex].name);
    setSelectedPlayer(null);
  };

  const handleSort = (key) => {
    let direction = "desc";

    if (sortConfig.key === key && sortConfig.direction === "desc") {
      direction = "asc";
    } else if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "default";
    }

    setSortConfig({ key, direction });
  };

  const positionOrder = ["PG", "SG", "SF", "PF", "C"];

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

  const teamCols = [
    { key: "team", label: "Team" },
    { key: "GP", label: "GP" },
    { key: "PTS", label: "PTS" },
    { key: "PA", label: "PA" },
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

  const applySort = (rows, type) => {
    if (!sortConfig.key || sortConfig.direction === "default") return rows;

    const dir = sortConfig.direction === "asc" ? 1 : -1;
    const sorted = [...rows];

    if (type === "players") {
      sorted.sort((a, b) => {
        const key = sortConfig.key;

        if (key === "name") return dir * String(a.name || "").localeCompare(String(b.name || ""));

        if (key === "pos") {
          const aIdx = positionOrder.indexOf(a.pos);
          const bIdx = positionOrder.indexOf(b.pos);
          return dir * ((aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx));
        }

        const aVal = parseFloat(a.stats?.[key]) || 0;
        const bVal = parseFloat(b.stats?.[key]) || 0;
        return dir * (aVal - bVal);
      });
    }

    if (type === "teams") {
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
    mode === "players"
      ? applySort(teamPlayers, "players")
      : applySort(leaguePlayers, "players");

  const rowsTeams = applySort(allTeamsAgg, "teams");

  const cardPlayer =
    mode === "players" || mode === "league"
      ? selectedPlayer || rowsPlayers[0] || null
      : null;

  const cardTeam = useMemo(() => {
    return rowsTeams.find((row) => row.teamName === selectedTeamRow) || rowsTeams[0] || null;
  }, [rowsTeams, selectedTeamRow]);

  const fillPercent = Math.min((Number(cardPlayer?.overall || 0)) / 99, 1);
  const circleCircumference = 2 * Math.PI * 50;
  const strokeOffset = circleCircumference * (1 - fillPercent);

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

  return (
    <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center py-10">
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
              mode === tab.k
                ? "bg-orange-600 text-white"
                : "bg-neutral-800 text-gray-300 hover:bg-neutral-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode !== "teams" && cardPlayer && (
        <div className="relative w-full flex justify-center">
          <div className="relative bg-neutral-800 w-full max-w-5xl px-8 pt-8 pb-3 rounded-t-xl shadow-lg">
            <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-white opacity-60" />

            <div className="flex items-end justify-between relative">
              <div className="flex items-end gap-6">
                <div className="relative -mb-[9px]">
                  {cardPlayer.headshot ? (
                    <img
                      src={cardPlayer.headshot}
                      alt={cardPlayer.name}
                      className="h-[175px] w-auto object-contain"
                    />
                  ) : (
                    <div className="h-[175px] w-[120px]" />
                  )}
                </div>

                <div className="flex flex-col justify-end mb-3">
                  <h2 className="text-[44px] font-bold leading-tight">{cardPlayer.name}</h2>
                  <p className="text-gray-400 text-[24px] mt-1">
                    {cardPlayer.pos}
                    {cardPlayer.secondaryPos ? ` / ${cardPlayer.secondaryPos}` : ""} • Age{" "}
                    {cardPlayer.age ?? "-"}
                  </p>
                  <button
                    type="button"
                    onClick={() => setPlayerCardPlayer(cardPlayer)}
                    className="mt-4 w-fit px-5 py-2 bg-white/[0.06] hover:bg-orange-500/15 border border-white/10 hover:border-orange-400/40 rounded-lg text-sm font-semibold transition"
                  >
                    Open Player Card
                  </button>
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
                    {cardPlayer.overall ?? "-"}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-[-2px]">
                    POT{" "}
                    <span className="text-orange-400 font-semibold">
                      {cardPlayer.potential ?? "-"}
                    </span>
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
            <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-white opacity-60" />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                {cardTeam.logo ? (
                  <img
                    src={cardTeam.logo}
                    alt={cardTeam.teamName}
                    className="h-[90px] w-[90px] object-contain"
                  />
                ) : (
                  <div className="h-[90px] w-[90px]" />
                )}

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

      <div className="w-full flex justify-center mt-[-1px]">
        <div className="w-full max-w-5xl overflow-x-auto no-scrollbar">
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
                {rowsPlayers.map((player) => (
                  <tr
                    key={`${player.teamName || selectedTeam.name}-${player.name}`}
                    onClick={() => setSelectedPlayer(player)}
                    className={`cursor-pointer transition ${
                      (selectedPlayer || rowsPlayers[0])?.name === player.name &&
                      (mode !== "league" ||
                        (selectedPlayer || rowsPlayers[0])?.teamName === player.teamName)
                        ? "bg-orange-600 text-white"
                        : "hover:bg-neutral-800"
                    }`}
                  >
                    {mode === "league" && (
                      <td className="py-2 px-2">
                        {player.teamLogo ? (
                          <img
                            src={player.teamLogo}
                            alt={player.teamName}
                            className="inline-block h-[36px] w-[36px] object-contain"
                            title={player.teamName}
                          />
                        ) : null}
                      </td>
                    )}

                    <td className="py-2 px-3 text-left pl-4">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPlayer(player);
                          setPlayerCardPlayer(player);
                        }}
                        className="text-left font-bold underline-offset-4 hover:text-orange-200 hover:underline"
                        title="Open player card"
                      >
                        {player.name}
                      </button>
                    </td>
                    <td>{player.pos}</td>
                    <td>{player.stats.GP}</td>
                    <td>{player.stats.MIN}</td>
                    <td>{player.stats.PTS}</td>
                    <td>{player.stats.REB}</td>
                    <td>{player.stats.AST}</td>
                    <td>{player.stats.STL}</td>
                    <td>{player.stats.BLK}</td>
                    <td>{player.stats.FG}</td>
                    <td>{player.stats["3P"]}</td>
                    <td>{player.stats.FT}</td>
                    <td>{player.stats["3PA"]}</td>
                    <td>{player.stats.FTA}</td>
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
                {rowsTeams.map((team) => (
                  <tr
                    key={team.teamName}
                    onClick={() => setSelectedTeamRow(team.teamName)}
                    className={`cursor-pointer transition ${
                      (cardTeam || rowsTeams[0])?.teamName === team.teamName
                        ? "bg-orange-600 text-white"
                        : "hover:bg-neutral-800"
                    }`}
                  >
                    <td className="py-2 px-3 text-left pl-4">
                      <div className="flex items-center gap-3">
                        {team.logo ? (
                          <img
                            src={team.logo}
                            alt={team.teamName}
                            className="h-[32px] w-[32px] object-contain"
                          />
                        ) : (
                          <div className="h-[32px] w-[32px]" />
                        )}

                        <span>{team.teamName}</span>
                      </div>
                    </td>

                    <td>{team.stats.GP}</td>
                    <td>{team.stats.PTS}</td>
                    <td>{team.stats.PA}</td>
                    <td>{team.stats.REB}</td>
                    <td>{team.stats.AST}</td>
                    <td>{team.stats.STL}</td>
                    <td>{team.stats.BLK}</td>
                    <td>{team.stats.FG}</td>
                    <td>{team.stats["3P"]}</td>
                    <td>{team.stats.FT}</td>
                    <td>{team.stats["3PA"]}</td>
                    <td>{team.stats.FTA}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>


      <PlayerCardModal
        open={!!playerCardPlayer}
        player={playerCardPlayer}
        teamName={playerCardPlayer?.teamName || selectedTeam?.name}
        teamLogo={playerCardPlayer?.teamLogo || teamLogoOf(selectedTeam)}
        leagueData={leagueData}
        currentStats={playerCardPlayer?.stats || null}
        onClose={() => setPlayerCardPlayer(null)}
      />

      <button
        onClick={() => navigate("/team-hub")}
        className="mt-10 px-8 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
      >
        Back to Team Hub
      </button>
    </div>
  );
}
