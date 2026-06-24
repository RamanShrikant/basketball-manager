import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import LZString from "lz-string";
import { useGame } from "../context/GameContext";
import { computeTeamRatings } from "../api/teamRatings.js";
import { GAMEPLAN_VERSION, buildSmartRotation } from "../utils/ensureGameplans";
import PageFade from "../components/PageFade";
import "../styles/BMPageBackground.css";
import "../styles/BMAnimations.css";

const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_";
const SCHEDULE_KEY = "bm_schedule_v3";
const POWER_RANKINGS_AUTO_RATINGS_CACHE_KEY = "bm_power_rankings_auto_ratings_v1";

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

function getLegacyGameplanRosterSignature(teamPlayers = []) {
  return [...(teamPlayers || [])]
    .map((p) =>
      [
        p.name || "",
        p.pos || "",
        p.secondaryPos || "",
        p.overall || 0,
      ].join("|")
    )
    .sort()
    .join("||");
}

function getPowerRankingsRosterSignature(teamPlayers = []) {
  return [...(teamPlayers || [])]
    .map((p) =>
      [
        p.name || p.player || "",
        p.pos || "",
        p.secondaryPos || "",
        toNum(p.overall ?? p.ovr, 0),
        toNum(p.offRating ?? p.off ?? p.offense, 0),
        toNum(p.defRating ?? p.def ?? p.defense, 0),
        toNum(p.stamina, 75),
        toNum(p.potential ?? p.pot, 0),
        toNum(p.age, 0),
      ].join("|")
    )
    .sort()
    .join("||");
}

function getRosterNames(teamPlayers = []) {
  return new Set(
    (teamPlayers || [])
      .map((p) => p?.name || p?.player)
      .filter(Boolean)
  );
}

function setsMatch(a, b) {
  if (a.size !== b.size) return false;

  for (const value of a) {
    if (!b.has(value)) return false;
  }

  return true;
}

function hasValidMinutesMap(minutes, rosterNames) {
  if (!minutes || typeof minutes !== "object" || Array.isArray(minutes)) return false;

  const minuteNames = new Set(Object.keys(minutes));
  if (!setsMatch(rosterNames, minuteNames)) return false;

  for (const name of minuteNames) {
    if (!Number.isFinite(Number(minutes[name]))) return false;
  }

  return true;
}

function readSavedGameplanPayload(teamName) {
  if (!teamName) return null;

  try {
    const raw = localStorage.getItem(`gameplan_${teamName}`);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function isUsableSavedAutoGameplan(team, savedPlan) {
  if (!team?.name || !savedPlan || typeof savedPlan !== "object") return false;

  // Power Rankings should represent the roster's rebuilt/default strength.
  // User-edited Coach Gameplan minutes are strategy-only and should never move
  // a team up/down this screen.
  if (savedPlan.manualLocked || savedPlan.userEdited || savedPlan.source === "coach_gameplan") {
    return false;
  }

  if (savedPlan.version !== GAMEPLAN_VERSION) return false;
  if (savedPlan.teamName !== team.name) return false;
  if (savedPlan.rosterSignature !== getLegacyGameplanRosterSignature(team?.players || [])) {
    return false;
  }

  return hasValidMinutesMap(savedPlan.minutes, getRosterNames(team?.players || []));
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

function readAutoRatingsCache() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(POWER_RANKINGS_AUTO_RATINGS_CACHE_KEY) || "{}"
    );

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function writeAutoRatingsCache(cache) {
  try {
    localStorage.setItem(
      POWER_RANKINGS_AUTO_RATINGS_CACHE_KEY,
      JSON.stringify(cache || {})
    );
  } catch {}
}

function normalizeRatingsForPowerRankings(ratings) {
  return {
    overall: toNum(ratings?.overall, 0),
    off: toNum(ratings?.off, 0),
    def: toNum(ratings?.def, 0),
    exactOverall: toNum(ratings?.exactOverall ?? ratings?.overall, 0),
  };
}

function computeRatingsFromMinutes(team, minutes) {
  return normalizeRatingsForPowerRankings(computeTeamRatings(team, minutes));
}

function buildAutoRebuiltMinutes(team) {
  try {
    const built = buildSmartRotation(team?.players || []);
    if (built?.obj && typeof built.obj === "object") return built.obj;
  } catch (error) {
    console.warn("Power Rankings auto rotation fallback:", error);
  }

  return buildFallbackMinutes(team);
}

function getTeamRatingsForPowerRankings(team, autoRatingsCache, markCacheDirty) {
  const teamName = team?.name || "";
  const signature = getPowerRankingsRosterSignature(team?.players || []);
  const cached = teamName ? autoRatingsCache?.[teamName] : null;

  if (cached?.signature === signature) {
    return normalizeRatingsForPowerRankings(cached);
  }

  const savedPlan = readSavedGameplanPayload(teamName);
  const minutes = isUsableSavedAutoGameplan(team, savedPlan)
    ? savedPlan.minutes
    : buildAutoRebuiltMinutes(team);
  const ratings = computeRatingsFromMinutes(team, minutes);

  if (teamName && autoRatingsCache) {
    autoRatingsCache[teamName] = { signature, ...ratings };
    markCacheDirty?.();
  }

  return ratings;
}

// Fast Team POT helper for this page. Coach Gameplan's exported POT helper also
// auto-optimizes a full smart rotation for the proof bonus. That is fine for one
// team, but very expensive when Power Rankings opens and asks for all 30 teams.
// This keeps the same future-window formula and uses the already-computed team
// OVR above as the proof bonus input, avoiding 30 full rotation rebuilds.
const POT_FUTURE_WINDOWS = [
  { years: 3, weight: 0.30 },
  { years: 5, weight: 0.35 },
  { years: 7, weight: 0.35 },
];

const POT_SCALE_BASE = 77.8156;
const POT_SCALE_FLOOR_VALUE = 70;
const POT_SCALE_MULTIPLIER = 2.0199;
const POT_PROOF_BASE_OVERALL = 84;
const POT_PROOF_MULTIPLIER = 0.20;
const POT_ELITE_PROOF_BASE_OVERALL = 92;
const POT_ELITE_PROOF_MULTIPLIER = 1.10;

const POT_AGE_POINTS = [
  [18, 1.10],
  [20, 1.10],
  [22, 1.09],
  [24, 1.06],
  [26, 1.02],
  [27, 1.00],
  [28, 0.98],
  [29, 0.95],
  [30, 0.92],
  [31, 0.89],
  [32, 0.85],
  [33, 0.80],
  [34, 0.74],
  [35, 0.68],
  [36, 0.60],
  [37, 0.50],
  [38, 0.40],
  [39, 0.30],
  [40, 0.22],
  [41, 0.15],
  [42, 0.10],
  [45, 0.04],
];

function hasFiniteRating(value) {
  return Number.isFinite(Number(value));
}

function getPlayerPotentialValue(player) {
  if (hasFiniteRating(player?.potential)) return Number(player.potential);
  if (hasFiniteRating(player?.overall)) return Number(player.overall);
  return 75;
}

function getPlayerOverallValue(player) {
  if (hasFiniteRating(player?.overall)) return Number(player.overall);
  return getPlayerPotentialValue(player);
}

function potentialAgeMultiplier(age) {
  const numericAge = Number(age || 0);

  if (numericAge <= POT_AGE_POINTS[0][0]) return POT_AGE_POINTS[0][1];

  for (let i = 1; i < POT_AGE_POINTS.length; i += 1) {
    const [prevAge, prevValue] = POT_AGE_POINTS[i - 1];
    const [nextAge, nextValue] = POT_AGE_POINTS[i];

    if (numericAge <= nextAge) {
      const t = (numericAge - prevAge) / (nextAge - prevAge);
      return prevValue + (nextValue - prevValue) * t;
    }
  }

  return 0.04;
}

function playerPotentialWindowScore(player, yearsAhead) {
  const potential = getPlayerPotentialValue(player);
  const overall = getPlayerOverallValue(player);
  const futureAge = Number(player?.age ?? 25) + yearsAhead;
  const ageMultiplier = potentialAgeMultiplier(futureAge);
  const upsideGap = Math.max(0, potential - overall);
  const uncertaintyPenalty = Math.min(5, upsideGap * 0.35) * ageMultiplier;
  const eliteBonus = Math.max(0, potential - 92) * 0.12 * ageMultiplier;

  return 58 + (potential - 58) * ageMultiplier + eliteBonus - uncertaintyPenalty;
}

function averageTop(scores, count) {
  const usableCount = Math.min(count, scores.length);
  if (usableCount <= 0) return 0;

  return scores.slice(0, usableCount).reduce((sum, value) => sum + value, 0) / usableCount;
}

function weightedFullRosterAverage(scores) {
  let numerator = 0;
  let denominator = 0;

  scores.forEach((score, index) => {
    const weight = Math.pow(0.86, index);
    numerator += score * weight;
    denominator += weight;
  });

  return denominator > 0 ? numerator / denominator : 0;
}

function potentialWindowTeamScore(players, yearsAhead) {
  const scores = (players || [])
    .map((player) => playerPotentialWindowScore(player, yearsAhead))
    .filter((score) => Number.isFinite(score))
    .sort((a, b) => b - a);

  if (scores.length === 0) return 0;

  return (
    0.48 * averageTop(scores, 2) +
    0.37 * averageTop(scores, 5) +
    0.15 * weightedFullRosterAverage(scores)
  );
}

function getTeamPotentialForPowerRankings(team, exactCurrentOverall = 0) {
  const valid = (team?.players || []).filter(
    (player) => player && player.name && (hasFiniteRating(player.potential) || hasFiniteRating(player.overall))
  );

  if (valid.length === 0) return 0;

  const windowScores = POT_FUTURE_WINDOWS.map((window) => ({
    ...window,
    score: potentialWindowTeamScore(valid, window.years),
  }));

  const rawPot = windowScores.reduce(
    (sum, window) => sum + window.score * window.weight,
    0
  );

  const futureStrength = Math.max(0, rawPot - 84) / 10;
  const proofBonus =
    Math.max(0, toNum(exactCurrentOverall, 0) - POT_PROOF_BASE_OVERALL) *
      futureStrength *
      POT_PROOF_MULTIPLIER +
    Math.max(0, toNum(exactCurrentOverall, 0) - POT_ELITE_PROOF_BASE_OVERALL) *
      futureStrength *
      POT_ELITE_PROOF_MULTIPLIER;

  const exactPot = Math.min(
    99,
    POT_SCALE_FLOOR_VALUE + (rawPot + proofBonus - POT_SCALE_BASE) * POT_SCALE_MULTIPLIER
  );

  return Math.round(toNum(exactPot, 0));
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
    const autoRatingsCache = readAutoRatingsCache();
    let autoRatingsCacheDirty = false;
    const markAutoRatingsCacheDirty = () => {
      autoRatingsCacheDirty = true;
    };

    const baseRows = teams.map((team) => {
      const ratings = getTeamRatingsForPowerRankings(
        team,
        autoRatingsCache,
        markAutoRatingsCacheDirty
      );
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
        potential: getTeamPotentialForPowerRankings(team, ratings.exactOverall),
        w: toNum(record.w, 0),
        l: toNum(record.l, 0),
        gp,
        winPct: gp > 0 ? toNum(record.w, 0) / gp : 0,
        diff,
        pointDiff: gp > 0 ? diff / gp : 0,
        topPlayers: getTopPlayers(team),
      };
    });

    if (autoRatingsCacheDirty) {
      writeAutoRatingsCache(autoRatingsCache);
    }

    const useRecordPowerRankings =
      baseRows.length > 0 && baseRows.every((row) => row.gp >= 20);

    const rowsWithScores = baseRows.map((row) => {
      const recordScore = row.winPct * 100;
      const powerScore = useRecordPowerRankings
        ? row.overall * 0.5 + recordScore * 0.5
        : row.overall;

      return {
        ...row,
        recordScore,
        powerScore,
        useRecordPowerRankings,
      };
    });

    rowsWithScores.sort(
      (a, b) =>
        b.powerScore - a.powerScore ||
        (useRecordPowerRankings ? b.winPct - a.winPct : 0) ||
        b.overall - a.overall ||
        b.off + b.def - (a.off + a.def) ||
        b.pointDiff - a.pointDiff ||
        b.w - a.w ||
        a.name.localeCompare(b.name)
    );

    return rowsWithScores.map((row, idx) => ({ ...row, rank: idx + 1 }));
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
        case "potential":
          diff = compareNumber(a.potential, b.potential);
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
                  <SortHeader label="POT" sortKey="potential" sortConfig={sortConfig} onSort={handleSort} />
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
                    <td className="px-3 py-2 font-semibold text-orange-300">{row.potential}</td>
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
