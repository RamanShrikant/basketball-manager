import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import LZString from "lz-string";
import { useGame } from "../context/GameContext";
import { computeTeamRatings } from "../api/teamRatings.js";
import PageFade from "../components/PageFade";
import "../styles/BMPageBackground.css";
import "../styles/BMAnimations.css";

const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_";
const SCHEDULE_KEY = "bm_schedule_v3";

const toNum = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function getTeamConferenceMap(leagueData, teams) {
  const map = {};

  if (leagueData?.conferences && typeof leagueData.conferences === "object") {
    for (const [conf, arr] of Object.entries(leagueData.conferences)) {
      for (const team of arr || []) {
        if (team?.name) map[team.name] = conf;
      }
    }
  }

  for (const team of teams || []) {
    const name = team?.name || team?.team;
    if (!name) continue;
    if (!map[name]) {
      map[name] = team?.conference || team?.conf || team?.divisionConference || "";
    }
  }

  return map;
}

function getLogo(team) {
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

function parseMaybeCompressed(raw, fallback = null) {
  if (!raw) return fallback;

  try {
    if (raw.startsWith("lz:")) {
      const decompressed = LZString.decompressFromUTF16(raw.slice(3));
      return decompressed ? JSON.parse(decompressed) : fallback;
    }
  } catch {}

  try {
    return JSON.parse(raw);
  } catch {}

  try {
    const decompressed = LZString.decompressFromUTF16(raw);
    return decompressed ? JSON.parse(decompressed) : fallback;
  } catch {
    return fallback;
  }
}

function readSavedGameplanMinutes(teamName) {
  if (!teamName) return null;

  try {
    const raw = localStorage.getItem(`gameplan_${teamName}`);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    if (
      parsed.minutes &&
      typeof parsed.minutes === "object" &&
      !Array.isArray(parsed.minutes)
    ) {
      return { ...parsed.minutes };
    }

    return { ...parsed };
  } catch {
    return null;
  }
}

function buildFallbackMinutes(team) {
  const players = [...(team?.players || [])]
    .filter((p) => p?.name || p?.player)
    .sort((a, b) => toNum(b?.overall || b?.ovr, 0) - toNum(a?.overall || a?.ovr, 0));

  const minuteSlots = [36, 34, 32, 30, 28, 24, 20, 16, 12, 8];
  const minutes = {};

  for (let i = 0; i < Math.min(players.length, minuteSlots.length); i += 1) {
    const name = players[i]?.name || players[i]?.player;
    if (name) minutes[name] = minuteSlots[i];
  }

  return minutes;
}

function getTeamRatingsForPowerRankings(team) {
  const minutes = readSavedGameplanMinutes(team?.name) || buildFallbackMinutes(team);
  const ratings = computeTeamRatings(team, minutes);

  return {
    overall: toNum(ratings?.overall, 0),
    off: toNum(ratings?.off, 0),
    def: toNum(ratings?.def, 0),
  };
}

function loadSchedule() {
  return parseMaybeCompressed(localStorage.getItem(SCHEDULE_KEY), {}) || {};
}

function resultV3Key(gameId) {
  return `${RESULT_V3_PREFIX}${gameId}`;
}

function loadResultsV3() {
  const ids = parseMaybeCompressed(localStorage.getItem(RESULT_V3_INDEX_KEY), []) || [];
  const out = {};

  for (const id of ids) {
    const result = parseMaybeCompressed(localStorage.getItem(resultV3Key(id)), null);
    if (result) out[String(id)] = result;
  }

  return out;
}

function buildRecordMap() {
  const schedule = loadSchedule();
  const results = loadResultsV3();
  const map = {};

  const ensure = (teamName) => {
    if (!map[teamName]) {
      map[teamName] = { w: 0, l: 0, gp: 0, pf: 0, pa: 0 };
    }
    return map[teamName];
  };

  for (const games of Object.values(schedule || {})) {
    for (const game of games || []) {
      if (!game?.id) continue;

      const result = results?.[String(game.id)];
      if (!game.played && !result) continue;

      const homePts = toNum(result?.totals?.home ?? result?.winner?.home, NaN);
      const awayPts = toNum(result?.totals?.away ?? result?.winner?.away, NaN);
      if (!Number.isFinite(homePts) || !Number.isFinite(awayPts)) continue;
      if (homePts === awayPts) continue;

      const home = ensure(game.home);
      const away = ensure(game.away);

      home.gp += 1;
      away.gp += 1;
      home.pf += homePts;
      home.pa += awayPts;
      away.pf += awayPts;
      away.pa += homePts;

      if (homePts > awayPts) {
        home.w += 1;
        away.l += 1;
      } else {
        away.w += 1;
        home.l += 1;
      }
    }
  }

  return map;
}

function getTopPlayers(team) {
  return [...(team?.players || [])]
    .filter((p) => p?.name || p?.player)
    .sort((a, b) => toNum(b?.overall || b?.ovr, 0) - toNum(a?.overall || a?.ovr, 0))
    .slice(0, 3)
    .map((p) => `${p?.name || p?.player} ${toNum(p?.overall || p?.ovr, 0)}`)
    .join(" • ");
}

function SortHeader({ label, sortKey, sortConfig, onSort, align = "center" }) {
  const active = sortConfig?.key === sortKey && sortConfig?.direction !== "default";
  const arrow = active ? (sortConfig.direction === "asc" ? " ▲" : " ▼") : "";

  return (
    <th
      className={`px-3 py-2 select-none cursor-pointer ${
        align === "left" ? "text-left pl-4" : "text-center"
      }`}
      onClick={() => onSort(sortKey)}
      title="Click to sort ascending, descending, then reset"
    >
      {label}
      {active && <span className="text-orange-400">{arrow}</span>}
    </th>
  );
}

export default function PowerRankings() {
  const navigate = useNavigate();
  const { leagueData, selectedTeam } = useGame();
  const [conferenceFilter, setConferenceFilter] = useState("all");
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "default" });

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key !== key || prev.direction === "default") {
        return { key, direction: "asc" };
      }

      if (prev.direction === "asc") {
        return { key, direction: "desc" };
      }

      return { key: null, direction: "default" };
    });
  };

  const teams = useMemo(() => getAllTeamsFromLeague(leagueData), [leagueData]);
  const confMap = useMemo(
    () => getTeamConferenceMap(leagueData, teams),
    [leagueData, teams]
  );

  const rows = useMemo(() => {
    const records = buildRecordMap();

    const baseRows = teams.map((team) => {
      const ratings = getTeamRatingsForPowerRankings(team);
      const record = records?.[team.name] || { w: 0, l: 0, gp: 0, pf: 0, pa: 0 };
      const conference = confMap?.[team.name] || "";
      const diff = toNum(record.pf, 0) - toNum(record.pa, 0);
      const gp = toNum(record.gp, 0);

      return {
        team,
        name: team.name,
        logo: getLogo(team),
        conference,
        overall: ratings.overall,
        off: ratings.off,
        def: ratings.def,
        w: toNum(record.w, 0),
        l: toNum(record.l, 0),
        gp,
        winPct: gp > 0 ? toNum(record.w, 0) / gp : 0,
        diff,
        pointDiff: gp > 0 ? diff / gp : 0,
        rosterCount: Array.isArray(team?.players) ? team.players.length : 0,
        topPlayers: getTopPlayers(team),
      };
    });

    baseRows.sort(
      (a, b) =>
        b.overall - a.overall ||
        b.off + b.def - (a.off + a.def) ||
        b.pointDiff - a.pointDiff ||
        a.name.localeCompare(b.name)
    );

    return baseRows.map((row, idx) => ({ ...row, rank: idx + 1 }));
  }, [teams, confMap]);

  const filteredRows = useMemo(() => {
    if (conferenceFilter === "all") return rows;
    return rows.filter(
      (row) => String(row.conference || "").toLowerCase() === conferenceFilter
    );
  }, [rows, conferenceFilter]);

  const visibleRows = useMemo(() => {
    if (!sortConfig.key || sortConfig.direction === "default") return filteredRows;

    const direction = sortConfig.direction === "asc" ? 1 : -1;
    const sorted = [...filteredRows];

    const compareNumber = (a, b) => {
      const av = toNum(a, 0);
      const bv = toNum(b, 0);
      return av === bv ? 0 : av > bv ? 1 : -1;
    };

    const compareString = (a, b) =>
      String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });

    sorted.sort((a, b) => {
      let diff = 0;

      switch (sortConfig.key) {
        case "rank":
          diff = compareNumber(a.rank, b.rank);
          break;
        case "team":
          diff = compareString(a.name, b.name);
          break;
        case "overall":
          diff = compareNumber(a.overall, b.overall);
          break;
        case "off":
          diff = compareNumber(a.off, b.off);
          break;
        case "def":
          diff = compareNumber(a.def, b.def);
          break;
        case "record": {
          diff = compareNumber(a.winPct, b.winPct);
          if (!diff) diff = compareNumber(a.w, b.w);
          if (!diff) diff = compareNumber(a.pointDiff, b.pointDiff);
          if (!diff) diff = compareNumber(b.l, a.l);
          break;
        }
        case "conference":
          diff = compareString(a.conference, b.conference);
          break;
        case "roster":
          diff = compareNumber(a.rosterCount, b.rosterCount);
          break;
        case "topPlayers":
          diff = compareString(a.topPlayers, b.topPlayers);
          break;
        default:
          diff = 0;
      }

      if (!diff) diff = compareNumber(a.rank, b.rank);
      return diff * direction;
    });

    return sorted;
  }, [filteredRows, sortConfig]);

  if (!leagueData) {
    return (
      <div className="bmCourtPage flex min-h-screen items-center justify-center text-white">
        Loading power rankings...
      </div>
    );
  }

  return (
    <PageFade>
      <div className="bmCourtPage min-h-screen text-white py-10 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-bold text-orange-500">Power Rankings</h1>

            <div className="flex gap-2">
              <button
                onClick={() => navigate("/standings")}
                className="px-3 py-1 rounded bg-neutral-700 hover:bg-neutral-600 font-semibold"
              >
                Standings
              </button>
              <button
                onClick={() => navigate("/team-hub")}
                className="px-3 py-1 rounded bg-neutral-700 hover:bg-neutral-600 font-semibold"
              >
                Team Hub
              </button>
              {["all", "east", "west"].map((mode) => (
                <button
                  key={mode}
                  onClick={() => setConferenceFilter(mode)}
                  className={`px-3 py-1 rounded font-semibold ${
                    conferenceFilter === mode ? "bg-orange-600" : "bg-neutral-700"
                  }`}
                >
                  {mode === "all"
                    ? "All"
                    : mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-auto rounded-xl border border-neutral-800 bg-neutral-900/80">
            <table className="w-full min-w-[980px] text-sm text-center">
              <thead className="bg-neutral-800 text-gray-300">
                <tr>
                  <SortHeader label="Rank" sortKey="rank" sortConfig={sortConfig} onSort={handleSort} />
                  <SortHeader label="Team" sortKey="team" sortConfig={sortConfig} onSort={handleSort} align="left" />
                  <SortHeader label="Team OVR" sortKey="overall" sortConfig={sortConfig} onSort={handleSort} />
                  <SortHeader label="OFF" sortKey="off" sortConfig={sortConfig} onSort={handleSort} />
                  <SortHeader label="DEF" sortKey="def" sortConfig={sortConfig} onSort={handleSort} />
                  <SortHeader label="Record" sortKey="record" sortConfig={sortConfig} onSort={handleSort} />
                  <SortHeader label="Conf" sortKey="conference" sortConfig={sortConfig} onSort={handleSort} />
                  <SortHeader label="Roster" sortKey="roster" sortConfig={sortConfig} onSort={handleSort} />
                  <SortHeader label="Top Players" sortKey="topPlayers" sortConfig={sortConfig} onSort={handleSort} align="left" />
                </tr>
              </thead>

              <tbody>
                {visibleRows.map((row) => (
                  <tr
                    key={row.name}
                    className={`hover:bg-neutral-800/60 ${
                      selectedTeam?.name === row.name ? "bg-orange-600/70" : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-semibold">{row.rank}</td>
                    <td className="px-3 py-2 text-left pl-4 font-semibold">
                      <div className="flex items-center gap-2">
                        {row.logo && (
                          <img
                            src={row.logo}
                            alt={row.name}
                            className="w-6 h-6 object-contain"
                          />
                        )}
                        <span>{row.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 font-bold text-orange-300">{row.overall}</td>
                    <td className="px-3 py-2">{row.off}</td>
                    <td className="px-3 py-2">{row.def}</td>
                    <td className="px-3 py-2 font-semibold">
                      <span className="text-green-400">{row.w}</span>
                      <span className="text-gray-400"> - </span>
                      <span className="text-red-400">{row.l}</span>
                    </td>
                    <td className="px-3 py-2">{row.conference || "—"}</td>
                    <td className="px-3 py-2">{row.rosterCount}</td>
                    <td className="px-3 py-2 text-left text-gray-300">{row.topPlayers || "—"}</td>
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
    </PageFade>
  );
}
