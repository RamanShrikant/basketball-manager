// Standings.jsx
import React, { useMemo, useState } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";
import LZString from "lz-string";

/* -----------------------------
   Results V3 (per-game storage)
   ----------------------------- */
const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_";
const resultV3Key = (gameId) => `${RESULT_V3_PREFIX}${gameId}`;

function loadResultsIndexV3() {
  try {
    const raw = localStorage.getItem(RESULT_V3_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // ✅ normalize ids to strings so everything compares cleanly
    return parsed.map((x) => String(x));
  } catch {
    return [];
  }
}

function loadOneResultV3(gameIdStr) {
  try {
    const stored = localStorage.getItem(resultV3Key(gameIdStr));
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
  for (const idStr of ids) {
    const r = loadOneResultV3(idStr);
    if (r) out[idStr] = r; // ✅ keep keys as strings
  }
  return out;
}

// pick a logo from whatever key the team uses
const resolveLogo = (t) =>
  t.logo || t.teamLogo || t.newTeamLogo || t.logoUrl || t.image || t.img || "";

export default function Standings() {
  const schedule = useMemo(() => {
    try {
      const raw = localStorage.getItem("bm_schedule_v3");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, []);

  const { leagueData, selectedTeam } = useGame();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState("all");

  // ✅ load V3 per-game results once
  const results = useMemo(() => loadAllResultsV3(), []);

  const allTeams = useMemo(() => {
    if (!leagueData?.conferences) return [];
    return Object.entries(leagueData.conferences).flatMap(([conf, teams]) =>
      teams.map((t) => ({
        ...t,
        conf,
        logo: resolveLogo(t),
      }))
    );
  }, [leagueData]);

  // ✅ Build a fast lookup map: gameId(string) -> meta
  const scheduleById = useMemo(() => {
    const map = {};
    for (const games of Object.values(schedule || {})) {
      for (const g of games || []) {
        if (g?.id == null) continue;
        map[String(g.id)] = g;
      }
    }
    return map;
  }, [schedule]);

  const teamStats = useMemo(() => {
    const stats = {};

    // start every team at 0
    allTeams.forEach((t) => {
      stats[t.name] = {
        team: t.name,
        conf: t.conf,
        logo: t.logo,
        w: 0,
        l: 0,
        pf: 0,
        pa: 0,
      };
    });

    Object.entries(results).forEach(([gameIdStr, g]) => {
      if (!g || !g.totals) return;

      // ✅ lookup meta using normalized string id
      const meta = scheduleById[gameIdStr];
      if (!meta) return;

      const homeName = meta.home;
      const awayName = meta.away;

      const homePts = Number(g.totals.home || 0);
      const awayPts = Number(g.totals.away || 0);

      if (!stats[homeName]) {
        stats[homeName] = {
          team: homeName,
          conf: meta.confHome || "",
          logo: resolveLogo(meta) || "",
          w: 0,
          l: 0,
          pf: 0,
          pa: 0,
        };
      }
      if (!stats[awayName]) {
        stats[awayName] = {
          team: awayName,
          conf: meta.confAway || "",
          logo: resolveLogo(meta) || "",
          w: 0,
          l: 0,
          pf: 0,
          pa: 0,
        };
      }

      // points for / against
      stats[homeName].pf += homePts;
      stats[homeName].pa += awayPts;
      stats[awayName].pf += awayPts;
      stats[awayName].pa += homePts;

      // decide winner directly from points
      if (homePts > awayPts) {
        stats[homeName].w += 1;
        stats[awayName].l += 1;
      } else if (awayPts > homePts) {
        stats[awayName].w += 1;
        stats[homeName].l += 1;
      }
    });

    // final shape for the table
    return Object.values(stats).map((t) => ({
      ...t,
      pct: t.w + t.l > 0 ? (t.w / (t.w + t.l)).toFixed(3) : "0.000",
      diff: t.pf - t.pa,
    }));
  }, [results, allTeams, scheduleById]);

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
                    <div className="flex items-center gap-2">
                      {t.logo && (
                        <img
                          src={t.logo}
                          alt={t.team}
                          className="w-6 h-6 object-contain"
                        />
                      )}
                      <span>
                        {i + 1}. {t.team}
                      </span>
                    </div>
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
