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

// -------------------------
// NEW SEASON HELPERS
// -------------------------
const META_KEY = "bm_league_meta_v1";
const PLAYER_STATS_KEY = "bm_player_stats_v1";
const SCHED_KEY = "bm_schedule_v3";
const RESULT_V2_BLOB_KEY = "bm_results_v2";
const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_";

const DELTAS_KEY = "bm_progression_deltas_v1";

function bumpSeasonYearMeta() {
  const today = new Date();
  const fallback = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;

  let meta = {};
  try {
    meta = JSON.parse(localStorage.getItem(META_KEY) || "{}") || {};
  } catch {
    meta = {};
  }

  const cur = Number.isFinite(Number(meta.seasonYear)) ? Number(meta.seasonYear) : fallback;
  meta.seasonYear = cur + 1;

  localStorage.setItem(META_KEY, JSON.stringify(meta));
  return meta.seasonYear;
}

function clearSeasonStores() {
  // playoffs + schedule/results
  localStorage.removeItem("bm_postseason_v2");
  localStorage.removeItem("bm_champ_v1");
  localStorage.removeItem(SCHED_KEY);

  // results v2 blob + v3 per-game
  localStorage.removeItem(RESULT_V2_BLOB_KEY);
  localStorage.removeItem(RESULT_V3_INDEX_KEY);

  // delete all per-game result keys
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.startsWith(RESULT_V3_PREFIX)) localStorage.removeItem(k);
  }

  // wipe season stats (new season starts empty)
  localStorage.removeItem(PLAYER_STATS_KEY);
}

function ageUpLeagueAndMakeDeltas(league) {
  const clone = structuredClone(league);

  const teams = getAllTeamsFromLeague(clone);
  const deltas = {};

  for (const t of teams) {
    for (const p of (t.players || [])) {
      const name = p?.name || p?.player;
      if (!name) continue;

      const prevAge = Number.isFinite(Number(p.age)) ? Number(p.age) : 25;
      p.age = prevAge + 1;

      // only thing you explicitly want right now
      deltas[name] = { age: 1 };
    }
  }

  return { league: clone, deltas };
}

function pushFinalsMvpToHistory(fmvpRaw) {
  if (!fmvpRaw) return;

  // keep "latest" around
  localStorage.setItem("bm_finals_mvp_latest", JSON.stringify(fmvpRaw));

  // append to history
  const key = "bm_finals_mvp_history_v1";
  let hist = [];
  try {
    hist = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(hist)) hist = [];
  } catch {
    hist = [];
  }

  hist.push(fmvpRaw);
  localStorage.setItem(key, JSON.stringify(hist));
}

export default function FinalsMvp() {
  const navigate = useNavigate();
  const { leagueData, setLeagueData, selectedTeam, setSelectedTeam } = useGame();

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

  const continueToProgressionThenCalendar = () => {
    // 1) preserve Finals MVP always (history + latest)
    pushFinalsMvpToHistory(fmvpRaw);

    // 2) age up everyone + store deltas (you asked for +1 ages)
    const baseLeague =
      leagueData ||
      (() => {
        try {
          return JSON.parse(localStorage.getItem("leagueData") || "null");
        } catch {
          return null;
        }
      })();

    if (baseLeague) {
      const { league: nextLeague, deltas } = ageUpLeagueAndMakeDeltas(baseLeague);

      localStorage.setItem("leagueData", JSON.stringify(nextLeague));
      localStorage.setItem(DELTAS_KEY, JSON.stringify(deltas));

      setLeagueData(nextLeague);

      // keep selectedTeam in sync with new league blob
      if (selectedTeam?.name) {
        const teams = getAllTeamsFromLeague(nextLeague);
        const updatedTeam = teams.find((t) => t?.name === selectedTeam.name) || null;
        if (updatedTeam) {
          setSelectedTeam(updatedTeam);
          localStorage.setItem("selectedTeam", JSON.stringify(updatedTeam));
        }
      }
    }

    // 3) bump season year so Calendar header updates + schedule window changes
    bumpSeasonYearMeta();

    // 4) clear season runtime keys so Calendar generates a fresh schedule/results
    clearSeasonStores();

    // 5) do NOT delete finals mvp history/latest; we only clear the "one-time page payload"
    localStorage.removeItem("bm_finals_mvp_v1");

    // 6) go to progression screen (then you hit Return to Calendar)
    navigate("/player-progression");
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
                <h2 className="text-[42px] font-bold leading-tight">{winner?.player}</h2>
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
                <td className="py-3 px-4 text-left font-bold">{winner?.player}</td>

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
            onClick={continueToProgressionThenCalendar}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
