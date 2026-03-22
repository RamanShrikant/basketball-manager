import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import LZString from "lz-string";

const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_";
const PLAYER_STATS_KEY = "bm_player_stats_v1";
const SCHED_KEY = "bm_schedule_v3";
const META_KEY = "bm_league_meta_v1";

const TRACKER_MIN_GAMES = 10;
const TRACKER_LIMIT = 10;

const resultV3Key = (gameId) => `${RESULT_V3_PREFIX}${gameId}`;

const TAB_META = {
  mvp: {
    title: "MVP Ladder",
    short: "MVP",
    description: "Top 10 most valuable players based on current season impact.",
  },
  dpoy: {
    title: "DPOY Ladder",
    short: "DPOY",
    description: "Top 10 defenders based on steals, blocks, defense, and wins.",
  },
  sixth_man: {
    title: "6MOY Ladder",
    short: "6MOY",
    description: "Top 10 bench players based on role and production.",
  },
};

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

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function statsKey(player, team) {
  return `${player}__${team}`;
}

function fmt1(x) {
  return Number.isFinite(Number(x)) ? Number(Number(x).toFixed(1)) : 0;
}

function perGame(total, gp) {
  return gp > 0 ? total / gp : 0;
}

function ppg(p) {
  return perGame(Number(p.pts || 0), Number(p.gp || 0));
}

function apg(p) {
  return perGame(Number(p.ast || 0), Number(p.gp || 0));
}

function rpg(p) {
  return perGame(Number(p.reb || 0), Number(p.gp || 0));
}

function spg(p) {
  return perGame(Number(p.stl || 0), Number(p.gp || 0));
}

function bpg(p) {
  return perGame(Number(p.blk || 0), Number(p.gp || 0));
}

function mpg(p) {
  return perGame(Number(p.min || 0), Number(p.gp || 0));
}

function norm(v, vmax) {
  if (vmax <= 0) return 0;
  return Math.max(0, Math.min(1, v / vmax));
}

function normDef(v, lo, hi) {
  if (hi <= lo) return 0;
  return Math.max(0, Math.min(1, (hi - v) / (hi - lo)));
}

function buildCtx(players) {
  if (!players.length) {
    return {
      ppg: 1,
      apg: 1,
      rpg: 1,
      spg: 1,
      bpg: 1,
      wins: 82,
      def_lo: 90,
      def_hi: 120,
    };
  }

  return {
    ppg: Math.max(...players.map((p) => ppg(p)), 1),
    apg: Math.max(...players.map((p) => apg(p)), 1),
    rpg: Math.max(...players.map((p) => rpg(p)), 1),
    spg: Math.max(...players.map((p) => spg(p)), 1),
    bpg: Math.max(...players.map((p) => bpg(p)), 1),
    wins: Math.max(...players.map((p) => Number(p._team_wins || 0)), 1),
    def_lo: Math.min(...players.map((p) => Number(p.def_rating ?? 110))),
    def_hi: Math.max(...players.map((p) => Number(p.def_rating ?? 110))),
  };
}

function impactMvp(p, c) {
  return (
    0.30 * norm(ppg(p), c.ppg) +
    0.15 * norm(apg(p), c.apg) +
    0.15 * norm(rpg(p), c.rpg) +
    0.20 * norm(Number(p._team_wins || 0), c.wins) +
    0.075 * norm(spg(p), c.spg) +
    0.075 * norm(bpg(p), c.bpg) +
    0.05 * normDef(Number(p.def_rating ?? c.def_hi), c.def_lo, c.def_hi)
  );
}

function impactDpoy(p, c) {
  return (
    0.35 * norm(spg(p), c.spg) +
    0.35 * norm(bpg(p), c.bpg) +
    0.20 * normDef(Number(p.def_rating ?? c.def_hi), c.def_lo, c.def_hi) +
    0.10 * norm(Number(p._team_wins || 0), c.wins)
  );
}

function impact6Moy(p, c) {
  return (
    0.35 * norm(ppg(p), c.ppg) +
    0.20 * norm(apg(p), c.apg) +
    0.20 * norm(rpg(p), c.rpg) +
    0.10 * norm(spg(p), c.spg) +
    0.10 * norm(bpg(p), c.bpg) +
    0.05 * normDef(Number(p.def_rating ?? c.def_hi), c.def_lo, c.def_hi)
  );
}

function isSixthManEligible(p) {
  const gp = Number(p.gp || 0);
  const starts = Number(p.started || 0);
  const sixth = Number(p.sixth || 0);

  return (
    gp >= TRACKER_MIN_GAMES &&
    mpg(p) >= 14 &&
    starts <= Math.floor(0.2 * gp) &&
    sixth >= Math.max(5, Math.floor(0.25 * gp))
  );
}

function buildTeamsWithWinsForAwards(allTeams, scheduleByDate, resultsById) {
  const wins = {};

  const bump = (teamName) => {
    if (!teamName) return;
    wins[teamName] = (wins[teamName] || 0) + 1;
  };

  for (const games of Object.values(scheduleByDate || {})) {
    for (const g of games || []) {
      if (!g?.played) continue;

      const r = resultsById?.[g.id];
      if (!r?.totals) continue;

      const homePts = Number(r.totals.home ?? 0);
      const awayPts = Number(r.totals.away ?? 0);

      if (homePts === awayPts) continue;

      if (homePts > awayPts) bump(g.home);
      else bump(g.away);
    }
  }

  return (allTeams || []).map((t) => ({
    team: t?.name || t?.team,
    wins: wins[t?.name || t?.team] || 0,
  }));
}

function buildRosterInfoIndex(leagueData) {
  const teams = getAllTeamsFromLeague(leagueData);
  const idx = {};

  for (const team of teams) {
    const teamName = team?.name || team?.team;
    const teamLogo =
      team?.logo ||
      team?.teamLogo ||
      team?.logoUrl ||
      team?.image ||
      team?.img ||
      team?.newTeamLogo ||
      null;

    for (const p of team.players || []) {
      const playerName = p?.name || p?.player;
      if (!playerName || !teamName) continue;

      idx[statsKey(playerName, teamName)] = {
        headshot:
          p?.portrait ||
          p?.image ||
          p?.photo ||
          p?.headshot ||
          p?.img ||
          p?.face ||
          null,
        overall:
          p?.overall ??
          p?.ovr ??
          p?.rating ??
          p?.overall_rating ??
          null,
        potential:
          p?.potential ??
          p?.pot ??
          p?.potential_rating ??
          null,
        pos: p?.pos || p?.position || "",
        secondaryPos: p?.secondaryPos || p?.secondary_pos || "",
        age: p?.age ?? null,
        teamLogo,
        def_rating:
          p?.def_rating ??
          p?.defRating ??
          p?.defensive_rating ??
          p?.defensiveRating ??
          p?.drtg ??
          p?.defrtg ??
          110,
      };
    }
  }

  return idx;
}

function buildDisplayRow(p) {
  return {
    ...p,
    ppg: fmt1(ppg(p)),
    apg: fmt1(apg(p)),
    rpg: fmt1(rpg(p)),
    spg: fmt1(spg(p)),
    bpg: fmt1(bpg(p)),
    mpg: fmt1(mpg(p)),
    impact: fmt1((p._score || 0) * 100),
  };
}

function getColumnsForTab(tab) {
  if (tab === "dpoy") {
    return [
      { key: "team", label: "Team" },
      { key: "name", label: "Name" },
      { key: "OVR", label: "OVR" },
      { key: "GP", label: "GP" },
      { key: "REB", label: "REB" },
      { key: "STL", label: "STL" },
      { key: "BLK", label: "BLK" },
      { key: "DRTG", label: "DRTG" },
      { key: "Impact", label: "Impact" },
    ];
  }

  if (tab === "sixth_man") {
    return [
      { key: "team", label: "Team" },
      { key: "name", label: "Name" },
      { key: "OVR", label: "OVR" },
      { key: "GP", label: "GP" },
      { key: "PTS", label: "PTS" },
      { key: "REB", label: "REB" },
      { key: "AST", label: "AST" },
      { key: "Starts", label: "Starts" },
      { key: "Sixth", label: "Sixth" },
    ];
  }

  return [
    { key: "team", label: "Team" },
    { key: "name", label: "Name" },
    { key: "OVR", label: "OVR" },
    { key: "GP", label: "GP" },
    { key: "PTS", label: "PTS" },
    { key: "REB", label: "REB" },
    { key: "AST", label: "AST" },
    { key: "STL", label: "STL" },
    { key: "BLK", label: "BLK" },
    { key: "Impact", label: "Impact" },
  ];
}

export default function AwardTracker() {
  const navigate = useNavigate();
  const { leagueData, selectedTeam } = useGame();

  const [currentTab, setCurrentTab] = useState("mvp");
  const [selectedPlayerKey, setSelectedPlayerKey] = useState(null);

  const seasonLabel = useMemo(() => {
    try {
      const raw = localStorage.getItem(META_KEY);
      const meta = raw ? JSON.parse(raw) : null;
      const y = Number(meta?.seasonYear);
      if (Number.isFinite(y)) return `${y}-${y + 1}`;
    } catch {}

    const today = new Date();
    const y = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
    return `${y}-${y + 1}`;
  }, []);

  const statsMap = useMemo(() => {
    try {
      const raw = localStorage.getItem(PLAYER_STATS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, []);

  const scheduleByDate = useMemo(() => {
    try {
      const raw = localStorage.getItem(SCHED_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, []);

  const resultsById = useMemo(() => loadAllResultsV3(), []);
  const allTeams = useMemo(() => getAllTeamsFromLeague(leagueData), [leagueData]);
  const rosterInfoIndex = useMemo(() => buildRosterInfoIndex(leagueData), [leagueData]);

  const teamWinsMap = useMemo(() => {
    const arr = buildTeamsWithWinsForAwards(allTeams, scheduleByDate, resultsById);
    const map = {};
    for (const t of arr) {
      map[t.team] = Number(t.wins || 0);
    }
    return map;
  }, [allTeams, scheduleByDate, resultsById]);

  const playerPool = useMemo(() => {
    const out = [];

    for (const team of allTeams) {
      const teamName = team?.name || team?.team;
      if (!teamName) continue;

      for (const p of team.players || []) {
        const playerName = p?.name || p?.player;
        if (!playerName) continue;

        const key = statsKey(playerName, teamName);
        const s = statsMap[key];
        const info = rosterInfoIndex[key] || {};

        if (!s || Number(s.gp || 0) <= 0) continue;

        out.push({
          player: playerName,
          team: teamName,
          gp: Number(s.gp || 0),
          min: Number(s.min || 0),
          pts: Number(s.pts || 0),
          reb: Number(s.reb || 0),
          ast: Number(s.ast || 0),
          stl: Number(s.stl || 0),
          blk: Number(s.blk || 0),
          started: Number(s.started || 0),
          sixth: Number(s.sixth || 0),
          def_rating: Number(info.def_rating ?? 110),
          overall: info.overall ?? null,
          potential: info.potential ?? null,
          headshot: info.headshot || null,
          teamLogo: info.teamLogo || null,
          pos: info.pos || "",
          secondaryPos: info.secondaryPos || "",
          age: info.age ?? null,
          _team_wins: Number(teamWinsMap[teamName] || 0),
        });
      }
    }

    return out;
  }, [allTeams, statsMap, rosterInfoIndex, teamWinsMap]);

  const eligiblePool = useMemo(() => {
    const filtered = playerPool.filter((p) => Number(p.gp || 0) >= TRACKER_MIN_GAMES);
    return filtered.length ? filtered : playerPool;
  }, [playerPool]);

  const mvpTop10 = useMemo(() => {
    const ctx = buildCtx(eligiblePool);

    return eligiblePool
      .map((p) => buildDisplayRow({ ...p, _score: impactMvp(p, ctx) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, TRACKER_LIMIT);
  }, [eligiblePool]);

  const dpoyTop10 = useMemo(() => {
    const ctx = buildCtx(eligiblePool);

    return eligiblePool
      .map((p) => buildDisplayRow({ ...p, _score: impactDpoy(p, ctx) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, TRACKER_LIMIT);
  }, [eligiblePool]);

  const sixthPool = useMemo(() => {
    const strict = eligiblePool.filter((p) => isSixthManEligible(p));

    if (strict.length) return strict;

    return eligiblePool.filter(
      (p) =>
        mpg(p) >= 14 &&
        Number(p.started || 0) <= Math.floor(0.4 * Number(p.gp || 0))
    );
  }, [eligiblePool]);

  const sixthTop10 = useMemo(() => {
    const base = sixthPool.length ? sixthPool : [];
    const ctx = buildCtx(base.length ? base : eligiblePool);

    return base
      .map((p) => buildDisplayRow({ ...p, _score: impact6Moy(p, ctx) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, TRACKER_LIMIT);
  }, [sixthPool, eligiblePool]);

  const activeRows = useMemo(() => {
    if (currentTab === "dpoy") return dpoyTop10;
    if (currentTab === "sixth_man") return sixthTop10;
    return mvpTop10;
  }, [currentTab, mvpTop10, dpoyTop10, sixthTop10]);

  useEffect(() => {
    if (!activeRows.length) {
      setSelectedPlayerKey(null);
      return;
    }

    setSelectedPlayerKey((prev) => {
      const exists = activeRows.some((p) => statsKey(p.player, p.team) === prev);
      return exists ? prev : statsKey(activeRows[0].player, activeRows[0].team);
    });
  }, [activeRows, currentTab]);

  const cardPlayer = useMemo(() => {
    if (!activeRows.length) return null;
    return (
      activeRows.find((p) => statsKey(p.player, p.team) === selectedPlayerKey) ||
      activeRows[0]
    );
  }, [activeRows, selectedPlayerKey]);

  const fillPercent = Math.min((cardPlayer?.overall || 0) / 99, 1);
  const circleCircumference = 2 * Math.PI * 50;
  const strokeOffset = circleCircumference * (1 - fillPercent);

  const columns = getColumnsForTab(currentTab);
  const meta = TAB_META[currentTab];

  if (!leagueData || !selectedTeam) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-900 text-white">
        <p className="mb-3 text-lg">No team selected or league missing.</p>
        <button
          onClick={() => navigate("/team-selector")}
          className="rounded-lg bg-orange-600 px-6 py-3 font-semibold hover:bg-orange-500"
        >
          Back to Team Select
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center py-10">
      <div className="w-full max-w-5xl flex items-center justify-between mb-6 select-none">
        <div className="w-24" />
        <h1 className="text-3xl md:text-4xl font-extrabold text-orange-500 text-center">
          Award Tracker
        </h1>
        <div className="w-24" />
      </div>

      <div className="w-full max-w-5xl flex items-center justify-end gap-2 mb-3">
        {[
          { k: "mvp", label: "MVP" },
          { k: "dpoy", label: "DPOY" },
          { k: "sixth_man", label: "6MOY" },
        ].map((tab) => (
          <button
            key={tab.k}
            onClick={() => setCurrentTab(tab.k)}
            className={`px-3 py-1 rounded-md text-sm font-semibold ${
              currentTab === tab.k
                ? "bg-orange-600 text-white"
                : "bg-neutral-800 text-gray-300 hover:bg-neutral-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {cardPlayer && (
        <div className="relative w-full flex justify-center">
          <div className="relative bg-neutral-800 w-full max-w-5xl px-8 pt-8 pb-3 rounded-t-xl shadow-lg">
            <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-white opacity-60"></div>

            <div className="flex items-end justify-between relative">
              <div className="flex items-end gap-6">
                <div className="relative -mb-[9px]">
                  {cardPlayer.headshot ? (
                    <img
                      src={cardPlayer.headshot}
                      alt={cardPlayer.player}
                      className="h-[175px] w-auto object-contain"
                    />
                  ) : (
                    <div className="flex h-[175px] w-[130px] items-center justify-center text-sm text-neutral-500">
                      No image
                    </div>
                  )}
                </div>

                <div className="flex flex-col justify-end mb-3">
                  <div className="text-sm font-semibold uppercase tracking-wide text-orange-400">
                    {meta.title}
                  </div>

                  <h2 className="text-[44px] font-bold leading-tight">
                    {cardPlayer.player}
                  </h2>

                  <p className="text-gray-400 text-[24px] mt-1">
                    {cardPlayer.pos}
                    {cardPlayer.secondaryPos ? ` / ${cardPlayer.secondaryPos}` : ""}
                    {cardPlayer.age != null ? ` • Age ${cardPlayer.age}` : ""}
                  </p>

                  <div className="mt-2 flex items-center gap-2 text-sm text-neutral-300">
                    {cardPlayer.teamLogo ? (
                      <img
                        src={cardPlayer.teamLogo}
                        alt={cardPlayer.team}
                        className="h-6 w-6 object-contain"
                      />
                    ) : null}
                    <span>{cardPlayer.team}</span>
                    <span>•</span>
                    <span>{cardPlayer._team_wins} wins</span>
                    <span>•</span>
                    <span>#{activeRows.findIndex((p) => p.player === cardPlayer.player && p.team === cardPlayer.team) + 1}</span>
                  </div>
                </div>
              </div>

              <div className="relative flex flex-col items-center justify-center mr-4 mb-2">
                <svg width="110" height="110" viewBox="0 0 120 120">
                  <defs>
                    <linearGradient id="ovrGradientTracker" x1="0%" y1="0%" x2="100%" y2="0%">
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
                    stroke="url(#ovrGradientTracker)"
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
                    {cardPlayer.overall ?? "--"}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-[-2px]">
                    POT <span className="text-orange-400 font-semibold">{cardPlayer.potential ?? "--"}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="w-full flex justify-center mt-[-1px]">
        <div className="w-full max-w-5xl overflow-x-auto no-scrollbar">
          <table className="w-full border-collapse text-center text-[17px] font-medium">
            <thead className="bg-neutral-800 text-gray-300 text-[16px] font-semibold">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`py-3 px-3 min-w-[90px] ${
                      col.key === "name"
                        ? "min-w-[180px] text-left pl-4"
                        : col.key === "team"
                        ? "min-w-[70px]"
                        : "text-center"
                    }`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {activeRows.map((p) => {
                const rowKey = statsKey(p.player, p.team);
                const isSelected = (cardPlayer ? statsKey(cardPlayer.player, cardPlayer.team) : "") === rowKey;

                return (
                  <tr
                    key={rowKey}
                    onClick={() => setSelectedPlayerKey(rowKey)}
                    className={`cursor-pointer transition ${
                      isSelected ? "bg-orange-600 text-white" : "hover:bg-neutral-800"
                    }`}
                  >
                    {columns.map((col) => {
                      if (col.key === "team") {
                        return (
                          <td key={col.key} className="py-2 px-2">
                            {p.teamLogo ? (
                              <img
                                src={p.teamLogo}
                                alt={p.team}
                                className="inline-block h-[36px] w-[36px] object-contain"
                                title={p.team}
                              />
                            ) : (
                              <span className="text-xs text-neutral-400">-</span>
                            )}
                          </td>
                        );
                      }

                      if (col.key === "name") {
                        return (
                          <td key={col.key} className="py-2 px-3 text-left pl-4">
                            {p.player}
                          </td>
                        );
                      }

                      if (col.key === "OVR") {
                        return <td key={col.key}>{p.overall ?? "--"}</td>;
                      }

                      if (col.key === "GP") {
                        return <td key={col.key}>{p.gp}</td>;
                      }

                      if (col.key === "PTS") {
                        return <td key={col.key}>{p.ppg}</td>;
                      }

                      if (col.key === "REB") {
                        return <td key={col.key}>{p.rpg}</td>;
                      }

                      if (col.key === "AST") {
                        return <td key={col.key}>{p.apg}</td>;
                      }

                      if (col.key === "STL") {
                        return <td key={col.key}>{p.spg}</td>;
                      }

                      if (col.key === "BLK") {
                        return <td key={col.key}>{p.bpg}</td>;
                      }

                      if (col.key === "DRTG") {
                        return <td key={col.key}>{fmt1(p.def_rating)}</td>;
                      }

                      if (col.key === "Impact") {
                        return <td key={col.key}>{p.impact}</td>;
                      }

                      if (col.key === "Starts") {
                        return <td key={col.key}>{p.started}</td>;
                      }

                      if (col.key === "Sixth") {
                        return <td key={col.key}>{p.sixth}</td>;
                      }

                      return <td key={col.key}>-</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {activeRows.length === 0 && (
            <div className="bg-neutral-800 text-neutral-400 text-center py-8">
              No qualified players yet.
            </div>
          )}
        </div>
      </div>

      <div className="w-full max-w-5xl mt-4 text-sm text-neutral-400">
        {meta.description} Live for {seasonLabel}. Minimum {TRACKER_MIN_GAMES} GP for the tracker.
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