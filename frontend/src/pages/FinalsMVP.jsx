// src/pages/FinalsMvp.jsx
import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function statsKey(player, team) {
  return `${player}__${team}`;
}

function buildPlayerIndex(leagueData) {
  const teams = getAllTeamsFromLeague(leagueData);
  const idx = {};
  for (const team of teams) {
    for (const p of team.players || []) {
      const key = statsKey(p.name || p.player, team.name);
      idx[key] = {
        portrait: p.portrait || p.image || p.photo || p.headshot || p.img || p.face || null,
        pos: p.pos || p.position || null,
        age: p.age ?? p.playerAge ?? null,
        ovr: p.ovr ?? p.overall ?? p.rating ?? null,
        pot: p.pot ?? p.potential ?? null,
        teamName: team.name,
      };
    }
  }
  return idx;
}

const resolveLogo = (t) =>
  t.logo || t.teamLogo || t.newTeamLogo || t.logoUrl || t.image || t.img || "";

function fmt1(x) {
  if (x === null || x === undefined || Number.isNaN(Number(x))) return "—";
  return Number(x).toFixed(1);
}

export default function FinalsMvp() {
  const navigate = useNavigate();
  const { leagueData } = useGame();

  const fmvpRaw = useMemo(
    () => JSON.parse(localStorage.getItem("bm_finals_mvp_v1") || "null"),
    []
  );

  const playerIndex = useMemo(() => buildPlayerIndex(leagueData), [leagueData]);

  const teamLogoMap = useMemo(() => {
    const teams = getAllTeamsFromLeague(leagueData);
    const map = {};
    for (const t of teams) map[t.name] = resolveLogo(t);
    return map;
  }, [leagueData]);

  const winner = fmvpRaw?.finals_mvp || null;
  const season = fmvpRaw?.season ?? "Season";
  const championTeam = fmvpRaw?.champion_team ?? winner?.team ?? null;

  const playerMeta = useMemo(() => {
    if (!winner?.player || !winner?.team) return null;
    const key = statsKey(winner.player, winner.team);
    return playerIndex[key] || null;
  }, [winner, playerIndex]);

  const portraitSrc = playerMeta?.portrait || null;

  const startNewSeason = () => {
    localStorage.removeItem("bm_postseason_v2");
    localStorage.removeItem("bm_results_v2");
    localStorage.removeItem("bm_schedule_v3");
    localStorage.removeItem("bm_champ_v1");
    localStorage.removeItem("bm_finals_mvp_v1");
    navigate("/calendar");
  };

  const finalsRow = useMemo(() => {
    if (!winner) return null;
    return {
      gp: winner.gp ?? null,
      ppg: winner.ppg ?? null,
      rpg: winner.rpg ?? null,
      apg: winner.apg ?? null,
      spg: winner.spg ?? null,
      bpg: winner.bpg ?? null,
      fg: winner.fg_pct ?? null,
      tp: winner.tp_pct ?? null,
    };
  }, [winner]);

  const fillPercent = Math.min((playerMeta?.ovr || 0) / 99, 1);
  const circleCircumference = 2 * Math.PI * 50;
  const strokeOffset = circleCircumference * (1 - fillPercent);

  return (
    <div className="min-h-screen bg-neutral-900 text-white py-10">
      <div className="max-w-5xl mx-auto px-4">

        {/* Title */}
        <div className="text-center mb-5">
          <h1 className="text-4xl font-extrabold text-orange-500">FINALS MVP</h1>
          <p className="text-sm text-neutral-400 mt-1">
            {season} NBA Finals • Champions: {championTeam}
          </p>
        </div>

        {/* Header Card */}
        <div className="relative bg-neutral-800 rounded-t-xl shadow-lg px-8 pt-7 pb-3">
          <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-white opacity-60" />

          <div className="flex items-end justify-between">
            <div className="flex items-end gap-6">
              <div className="relative -mb-[8px]">
                {portraitSrc && (
                  <img
                    src={portraitSrc}
                    alt={winner?.player}
                    className="h-[170px] w-auto object-contain"
                  />
                )}
              </div>

              <div className="mb-2">
                <h2 className="text-[42px] font-bold leading-tight">
                  {winner?.player}
                </h2>
                <p className="text-gray-400 text-[22px] mt-1">
                  {playerMeta?.pos} • Age {playerMeta?.age}
                </p>
              </div>
            </div>

            <div className="relative flex items-center justify-center mr-4 mb-2">
              <svg width="105" height="105" viewBox="0 0 120 120">
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

              <div className="absolute text-center">
                <p className="text-sm text-gray-300">OVR</p>
                <p className="text-[44px] font-extrabold text-orange-400 leading-none mt-[-6px]">
                  {playerMeta?.ovr}
                </p>
                <p className="text-[10px] text-gray-400">
                  POT <span className="text-orange-400 font-semibold">{playerMeta?.pot}</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto mt-[-1px]">
          <table className="w-full border-collapse text-center text-[16px] font-medium">
            <thead className="bg-neutral-800 text-gray-300 font-semibold">
              <tr>
                <th className="py-3 px-4 text-left">Name</th>
                <th className="w-[70px]">TEAM</th>
                <th>POS</th>
                <th>GP</th>
                <th>PTS</th>
                <th>REB</th>
                <th>AST</th>
                <th>STL</th>
                <th>BLK</th>
                <th>FG%</th>
                <th>3P%</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-orange-600 text-white">
                <td className="py-3 px-4 text-left font-bold">
                  {winner?.player}
                </td>

                <td className="text-center">
                  {winner?.team && teamLogoMap[winner.team] ? (
                    <img
                      src={teamLogoMap[winner.team]}
                      alt={winner.team}
                      className="mx-auto h-6 w-6 object-contain"
                    />
                  ) : (
                    "—"
                  )}
                </td>

                <td>{playerMeta?.pos}</td>
                <td>{finalsRow?.gp}</td>
                <td>{fmt1(finalsRow?.ppg)}</td>
                <td>{fmt1(finalsRow?.rpg)}</td>
                <td>{fmt1(finalsRow?.apg)}</td>
                <td>{fmt1(finalsRow?.spg)}</td>
                <td>{fmt1(finalsRow?.bpg)}</td>
                <td>{fmt1(finalsRow?.fg)}</td>
                <td>{fmt1(finalsRow?.tp)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Buttons */}
        <div className="mt-7 flex justify-center gap-4">
          <button
            className="px-6 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm"
            onClick={() => navigate("/awards")}
          >
            View Season Awards
          </button>
          <button
            className="px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg text-sm font-bold"
            onClick={startNewSeason}
          >
            Start New Season
          </button>
        </div>
      </div>
    </div>
  );
}
