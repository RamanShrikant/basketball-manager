import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";

const RETIREMENT_RESULTS_KEY = "bm_retirement_results_v1";
const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
const PLAYER_STATS_KEY = "bm_player_stats_v1";

function safeJSON(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function getSeasonYear(leagueData) {
  return Number(
    leagueData?.seasonYear ||
    leagueData?.currentSeasonYear ||
    safeJSON(localStorage.getItem("bm_league_meta_v1"), {})?.seasonYear ||
    2026
  );
}

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function resolveLogo(team) {
  return team?.logo || team?.teamLogo || team?.newTeamLogo || team?.logoUrl || team?.image || "";
}

function readOffseasonState(seasonYear) {
  const stored = safeJSON(localStorage.getItem(OFFSEASON_STATE_KEY), null);

  if (!stored || typeof stored !== "object") {
    return {
      active: true,
      seasonYear,
      retirementsComplete: false,
      freeAgencyComplete: false,
      progressionComplete: false,
    };
  }

  return {
    active: true,
    seasonYear,
    retirementsComplete: false,
    freeAgencyComplete: false,
    progressionComplete: false,
    ...stored,
  };
}

function saveOffseasonState(next) {
  localStorage.setItem(OFFSEASON_STATE_KEY, JSON.stringify(next));
}

function fmt1(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.0";
  return n.toFixed(1);
}

function SummaryCard({ label, value, tone = "neutral" }) {
  const toneClass =
    tone === "orange"
      ? "border-orange-500/30 bg-orange-500/10 text-orange-100"
      : tone === "green"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
      : "border-white/10 bg-white/5 text-white";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-xs uppercase tracking-[0.18em] text-white/45 mb-2">{label}</div>
      <div className="text-3xl font-extrabold">{value}</div>
    </div>
  );
}

export default function PlayerRetirements() {
  const navigate = useNavigate();
  const { leagueData, setLeagueData, selectedTeam, setSelectedTeam } = useGame();

  const [workingLeagueData, setWorkingLeagueData] = useState(leagueData || null);
  const [retirementResult, setRetirementResult] = useState(
    safeJSON(localStorage.getItem(RETIREMENT_RESULTS_KEY), null)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setWorkingLeagueData(leagueData || null);
  }, [leagueData]);

  const seasonYear = getSeasonYear(workingLeagueData || leagueData);
  const offseasonState = useMemo(() => readOffseasonState(seasonYear), [seasonYear]);

  const teamLogoMap = useMemo(() => {
    const map = {};
    const teams = getAllTeamsFromLeague(workingLeagueData || leagueData);

    for (const team of teams) {
      map[team.name] = resolveLogo(team);
    }

    return map;
  }, [workingLeagueData, leagueData]);

  const retiredPlayers = retirementResult?.retiredPlayers || [];
  const summary = retirementResult?.summary || {
    retiredCount: retiredPlayers.length,
    averageAge: 0,
    averageOverall: 0,
    teamsAffected: 0,
  };

  const alreadyRan = !!retirementResult?.ok || !!offseasonState.retirementsComplete;

  const runRetirements = async () => {
    if (!workingLeagueData) {
      setError("No league data found.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const simEngineModule = await import("../api/simEnginePy.js");
      const runPlayerRetirements = simEngineModule?.runPlayerRetirements;

      if (typeof runPlayerRetirements !== "function") {
        setError("Retirement engine is not wired yet. Add the sim engine + worker export next.");
        setLoading(false);
        return;
      }

      const statsByKey = safeJSON(localStorage.getItem(PLAYER_STATS_KEY), {}) || {};

      const res = await runPlayerRetirements(
        workingLeagueData,
        statsByKey,
        {},
        {
          seasonYear,
          seed: seasonYear,
        }
      );

      if (!res?.ok || !res?.leagueData) {
        setError(res?.reason || "Retirement run failed.");
        setLoading(false);
        return;
      }

      const updated = res.leagueData;
      setWorkingLeagueData(updated);
      setRetirementResult(res);

      if (typeof setLeagueData === "function") {
        setLeagueData(updated);
      }

      localStorage.setItem("leagueData", JSON.stringify(updated));
      localStorage.setItem(RETIREMENT_RESULTS_KEY, JSON.stringify(res));

      if (selectedTeam?.name && typeof setSelectedTeam === "function") {
        let nextSelectedTeam = null;

        for (const confKey of Object.keys(updated.conferences || {})) {
          const found = (updated.conferences[confKey] || []).find(
            (team) => team.name === selectedTeam.name
          );
          if (found) {
            nextSelectedTeam = found;
            break;
          }
        }

        if (nextSelectedTeam) {
          setSelectedTeam(nextSelectedTeam);
          localStorage.setItem("selectedTeam", JSON.stringify(nextSelectedTeam));
        }
      }

      const nextOffseasonState = {
        ...readOffseasonState(seasonYear),
        active: true,
        seasonYear,
        retirementsComplete: true,
      };

      saveOffseasonState(nextOffseasonState);
    } catch (err) {
      setError(err?.message || "Retirement run failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-900 text-white py-10 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-7">
          <p className="text-sm uppercase tracking-[0.28em] text-white/40 mb-3">
            Offseason Event
          </p>
          <h1 className="text-5xl font-extrabold text-orange-500">PLAYER RETIREMENTS</h1>
          <p className="text-white/60 mt-3">
            Process veteran retirements before free agency opens.
          </p>
        </div>

        <div className="bg-neutral-800/85 border border-white/10 rounded-3xl shadow-2xl p-6 md:p-7 mb-7">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div>
              <div className="text-sm text-white/45 uppercase tracking-[0.2em] mb-2">
                Retirement Phase
              </div>
              <h2 className="text-3xl font-extrabold text-white">
                {seasonYear} Offseason
              </h2>
              <p className="text-white/60 mt-2 max-w-2xl">
                Run this once to remove retired players from active rosters and push them into
                league retirement history.
              </p>
            </div>

            <div className="flex gap-3 flex-wrap">
              <button
                onClick={() => navigate("/offseason")}
                className="px-5 py-3 bg-neutral-700 hover:bg-neutral-600 rounded-xl font-semibold transition"
              >
                Back to Hub
              </button>

              <button
                onClick={runRetirements}
                disabled={loading || alreadyRan}
                className={`px-5 py-3 rounded-xl font-bold transition ${
                  loading || alreadyRan
                    ? "bg-neutral-700 text-white/45 cursor-not-allowed"
                    : "bg-orange-600 hover:bg-orange-500 text-white"
                }`}
              >
                {loading ? "Running Retirements..." : alreadyRan ? "Retirements Complete" : "Run Player Retirements"}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-red-200 font-semibold">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-7">
          <SummaryCard label="Retired Players" value={summary.retiredCount || 0} tone="orange" />
          <SummaryCard label="Average Age" value={fmt1(summary.averageAge || 0)} />
          <SummaryCard label="Average OVR" value={fmt1(summary.averageOverall || 0)} />
          <SummaryCard label="Teams Hit" value={summary.teamsAffected || 0} tone="green" />
        </div>

        <div className="bg-neutral-800/85 border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
          <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-2xl font-extrabold text-white">Retirement Results</h3>
              <p className="text-white/55 mt-1">
                {alreadyRan
                  ? "These players have been removed from active league rosters."
                  : "Run retirements to generate this offseason result list."}
              </p>
            </div>

            {alreadyRan && (
              <button
                onClick={() => navigate("/offseason")}
                className="px-5 py-3 bg-orange-600 hover:bg-orange-500 rounded-xl font-semibold transition"
              >
                Continue to Offseason Hub
              </button>
            )}
          </div>

          {!alreadyRan ? (
            <div className="px-6 py-16 text-center text-white/50">
              No retirement results yet.
            </div>
          ) : retiredPlayers.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-2xl font-bold text-white">No retirements this offseason.</p>
              <p className="text-white/55 mt-2">
                The league rolls forward with every player still active.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {retiredPlayers.map((player, idx) => {
                const logo = teamLogoMap[player?.retiredFromTeam] || "";
                const headshot =
                  player?.headshot ||
                  player?.portrait ||
                  player?.image ||
                  player?.photo ||
                  player?.face ||
                  null;

                return (
                  <div
                    key={`${player?.name || "retired"}-${idx}`}
                    className="px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4 hover:bg-white/5 transition"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      {headshot ? (
                        <img
                          src={headshot}
                          alt={player?.name || "Retired Player"}
                          className="w-14 h-14 rounded-full object-cover border border-white/10 bg-white/5"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-full border border-white/10 bg-white/5" />
                      )}

                      <div className="min-w-0">
                        <div className="text-lg font-bold text-white truncate">
                          {player?.name || "Unknown Player"}
                        </div>
                        <div className="text-sm text-white/55 mt-1">
                          {player?.pos || "-"} • Age {player?.age ?? "-"} • OVR {player?.overall ?? player?.ovr ?? "-"}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 md:gap-8 flex-wrap md:flex-nowrap">
                      <div className="flex items-center gap-2">
                        {logo ? (
                          <img
                            src={logo}
                            alt={player?.retiredFromTeam || "Team"}
                            className="h-7 w-7 object-contain"
                          />
                        ) : (
                          <div className="h-7 w-7 rounded bg-white/5 border border-white/10" />
                        )}

                        <div className="text-sm text-white/70">
                          {player?.retiredFromTeam || "Unknown Team"}
                        </div>
                      </div>

                      <div className="text-sm text-white/55">
                        Chance:{" "}
                        <span className="font-semibold text-orange-300">
                          {`${Math.round((Number(player?.retirementProbability || 0)) * 100)}%`}
                        </span>
                      </div>

                      <div className="px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 text-xs font-bold uppercase tracking-wide">
                        Retired
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-8 flex justify-center gap-4 flex-wrap">
          <button
            onClick={() => navigate("/offseason")}
            className="px-6 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl font-semibold transition"
          >
            Back to Offseason Hub
          </button>

          <button
            onClick={() => navigate("/team-hub")}
            className="px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-xl font-semibold transition"
          >
            Back to Team Hub
          </button>
        </div>
      </div>
    </div>
  );
}