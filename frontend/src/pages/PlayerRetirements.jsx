import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { saveLeagueData } from "../utils/leagueStorage.js";
import {
  captureOffseasonMoodBaseline,
  recordRetirementMoodEvents,
} from "../utils/offseasonMoodEvents.js";
import styles from "./PlayerRetirements.module.css";

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
  const candidates = [];

  const pushYear = (value) => {
    const y = Number(value);
    if (Number.isFinite(y) && y >= 2020 && y <= 2100) {
      candidates.push(y);
    }
  };

  const meta = safeJSON(localStorage.getItem("bm_league_meta_v1"), {});
  const offseasonState = safeJSON(localStorage.getItem(OFFSEASON_STATE_KEY), {});

  pushYear(meta?.seasonYear);
  pushYear(meta?.currentSeasonYear);
  pushYear(meta?.seasonStartYear);
  pushYear(offseasonState?.seasonYear);
  pushYear(leagueData?.seasonYear);
  pushYear(leagueData?.currentSeasonYear);
  pushYear(leagueData?.seasonStartYear);

  if (candidates.length) {
    return Math.max(...candidates);
  }

  return 2026;
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
  retirementsSkipped: false,
  retirementsDisabled: false,
  freeAgencyComplete: false,
  progressionComplete: false,
};
  }

return {
  active: true,
  retirementsComplete: false,
  retirementsSkipped: false,
  retirementsDisabled: false,
  freeAgencyComplete: false,
  progressionComplete: false,
  ...stored,
  seasonYear,
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


function compactRetiredPlayer(player) {
  if (!player || typeof player !== "object") return null;

  return {
    id: player.id ?? null,
    name: player.name || player.playerName || "",
    pos: player.pos || player.position || "",
    age: player.age ?? null,
    overall: player.overall ?? player.ovr ?? null,
    ovr: player.ovr ?? player.overall ?? null,
    potential: player.potential ?? player.pot ?? null,
    retiredSeasonYear: player.retiredSeasonYear ?? null,
    retiredFromTeam: player.retiredFromTeam || player.currentTeam || player.teamName || player.team || "",
    lastKnownTeam: player.lastKnownTeam || "",
    retirementSource: player.retirementSource || "",
    retirementProbability: player.retirementProbability ?? player.retirementSnapshot?.retirementProbability ?? 0,
    retirementRoll: player.retirementRoll ?? null,
    headshot: player.headshot || player.portrait || player.image || player.photo || player.face || "",
  };
}

function compactRetirementResult(result) {
  if (!result || typeof result !== "object") return result;

  return {
    ok: Boolean(result.ok),
    skipped: Boolean(result.skipped),
    disabled: Boolean(result.disabled),
    seasonYear: result.seasonYear ?? result.summary?.seasonYear ?? null,
    retiredPlayers: Array.isArray(result.retiredPlayers)
      ? result.retiredPlayers.map(compactRetiredPlayer).filter(Boolean)
      : [],
    summary: result.summary || {
      retiredCount: 0,
      averageAge: 0,
      averageOverall: 0,
      teamsAffected: 0,
    },
  };
}

function saveRetirementResult(result) {
  const compact = compactRetirementResult(result);

  try {
    localStorage.setItem(RETIREMENT_RESULTS_KEY, JSON.stringify(compact));
    return compact;
  } catch (err) {
    console.warn("[Retirements] Compact retirement save failed. Saving ultra-light result.", err);
  }

  const ultraLight = {
    ok: Boolean(result?.ok),
    skipped: Boolean(result?.skipped),
    disabled: Boolean(result?.disabled),
    seasonYear: result?.seasonYear ?? result?.summary?.seasonYear ?? null,
    retiredPlayers: Array.isArray(result?.retiredPlayers)
      ? result.retiredPlayers.map((player) => ({
          id: player?.id ?? null,
          name: player?.name || player?.playerName || "",
          pos: player?.pos || player?.position || "",
          age: player?.age ?? null,
          overall: player?.overall ?? player?.ovr ?? null,
          retiredFromTeam: player?.retiredFromTeam || player?.currentTeam || player?.teamName || player?.team || "",
          retirementProbability: player?.retirementProbability ?? 0,
        }))
      : [],
    summary: result?.summary || null,
  };

  localStorage.setItem(RETIREMENT_RESULTS_KEY, JSON.stringify(ultraLight));
  return ultraLight;
}

function compactFreeAgencyStateForRetirementStorage(state) {
  if (!state || typeof state !== "object") return state;

  return {
    ...state,
    latestResults: null,
    offerHistory: Array.isArray(state.offerHistory) ? state.offerHistory.slice(-40) : [],
    dailyLog: Array.isArray(state.dailyLog) ? state.dailyLog.slice(-8) : [],
    signedPlayersLog: Array.isArray(state.signedPlayersLog)
      ? state.signedPlayersLog.slice(-80).map((row) => ({
          day: row?.day ?? null,
          playerId: row?.playerId ?? null,
          playerName: row?.playerName || "",
          teamName: row?.teamName || row?.signedWith || "",
          signedWith: row?.signedWith || row?.teamName || "",
          contract: row?.contract || row?.signedContract || null,
          totalValue: row?.totalValue || row?.signedTotalValue || 0,
          aav: row?.aav || 0,
          spendingType: row?.spendingType || "",
          exceptionType: row?.exceptionType || "",
          rfaMatched: Boolean(row?.rfaMatched),
        }))
      : [],
    userOfferOutcomeLog: Array.isArray(state.userOfferOutcomeLog)
      ? state.userOfferOutcomeLog.slice(-80).map((row) => ({
          day: row?.day ?? null,
          playerId: row?.playerId ?? null,
          playerName: row?.playerName || "",
          status: row?.status || row?.offerStatus || "",
          signedWith: row?.signedWith || "",
        }))
      : [],
  };
}

function compactLeagueDataForRetirementStorage(leagueData) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;

  return {
    ...leagueData,
    freeAgencyState: compactFreeAgencyStateForRetirementStorage(leagueData.freeAgencyState),
    retiredPlayersHistory: Array.isArray(leagueData.retiredPlayersHistory)
      ? leagueData.retiredPlayersHistory.map(compactRetiredPlayer).filter(Boolean)
      : [],
  };
}

function saveLeagueDataAfterRetirements(updated) {
  if (!updated) return;

  // Keep this surgical: retirements should use the central IndexedDB league save.
  // Do not write full leagueData directly to localStorage here, because large
  // saves can hit browser quota and trap the offseason on the retirement step.
  saveLeagueData(compactLeagueDataForRetirementStorage(updated)).catch((err) => {
    console.warn("[Retirements] IndexedDB leagueData save failed after retirements.", err);
  });
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

  useEffect(() => {
    if (!workingLeagueData) return;

    try {
      captureOffseasonMoodBaseline(workingLeagueData, { seasonYear });
    } catch (err) {
      console.warn("[Retirements] Failed to capture offseason mood baseline", err);
    }
  }, [workingLeagueData, seasonYear]);

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
const retirementsDisabled = !!offseasonState.retirementsDisabled;

const finalizeRetirementsAsSkipped = ({ disabled = false } = {}) => {
  const skippedLeagueData = workingLeagueData
    ? {
        ...workingLeagueData,
        seasonYear,
        currentSeasonYear: seasonYear,
        seasonStartYear: seasonYear,
      }
    : workingLeagueData;

  const res = {
    ok: true,
    skipped: true,
    disabled,
    seasonYear,
    leagueData: skippedLeagueData,
    retiredPlayers: [],
    summary: {
      retiredCount: 0,
      averageAge: 0,
      averageOverall: 0,
      teamsAffected: 0,
    },
  };

  setRetirementResult(res);

  if (typeof setLeagueData === "function" && skippedLeagueData) {
    setLeagueData(skippedLeagueData);
  }

  if (skippedLeagueData) {
    saveLeagueDataAfterRetirements(skippedLeagueData);
  }

  saveRetirementResult(res);

  const nextOffseasonState = {
    ...readOffseasonState(seasonYear),
    active: true,
    seasonYear,
    retirementsComplete: true,
    retirementsSkipped: true,
    retirementsDisabled: disabled ? true : retirementsDisabled,
  };

  saveOffseasonState(nextOffseasonState);
  setError("");
};

const toggleRetirementsDisabled = () => {
  const next = {
    ...readOffseasonState(seasonYear),
    retirementsDisabled: !retirementsDisabled,
  };

  saveOffseasonState(next);
  setError("");
};
  const runRetirements = async () => {
if (!workingLeagueData) {
  setError("No league data found.");
  return;
}

if (readOffseasonState(seasonYear).retirementsDisabled) {
  finalizeRetirementsAsSkipped({ disabled: true });
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

      try {
        captureOffseasonMoodBaseline(workingLeagueData, { seasonYear });
      } catch (err) {
        console.warn("[Retirements] Failed to capture offseason mood baseline before run", err);
      }

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

      const updated = {
        ...res.leagueData,
        seasonYear,
        currentSeasonYear: seasonYear,
        seasonStartYear: seasonYear,
      };
      const compactResult = saveRetirementResult({
        ...res,
        leagueData: updated,
        seasonYear,
        summary: {
          ...(res.summary || {}),
          seasonYear,
        },
      });

      try {
        recordRetirementMoodEvents(updated, compactResult, {
          seasonYear,
          source: "manual_retirements",
        });
      } catch (err) {
        console.warn("[Retirements] Failed to record retirement mood events", err);
      }

      setWorkingLeagueData(updated);
      setRetirementResult(compactResult);

      if (typeof setLeagueData === "function") {
        setLeagueData(updated);
      }

      saveLeagueDataAfterRetirements(updated);

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
          localStorage.setItem("selectedTeam", JSON.stringify(nextSelectedTeam.name));
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
    <div className={`${styles.retirementsPage} min-h-screen text-white py-10 px-4`}>
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
    onClick={toggleRetirementsDisabled}
    disabled={alreadyRan}
    className={`px-5 py-3 rounded-xl font-bold transition ${
      alreadyRan
        ? "bg-neutral-700 text-white/45 cursor-not-allowed"
        : retirementsDisabled
        ? "bg-emerald-700 hover:bg-emerald-600 text-white"
        : "bg-neutral-700 hover:bg-neutral-600 text-white"
    }`}
  >
    {retirementsDisabled ? "Retirements: OFF" : "Retirements: ON"}
  </button>

  <button
    onClick={() => finalizeRetirementsAsSkipped({ disabled: retirementsDisabled })}
    disabled={loading || alreadyRan}
    className={`px-5 py-3 rounded-xl font-bold transition ${
      loading || alreadyRan
        ? "bg-neutral-700 text-white/45 cursor-not-allowed"
        : "bg-blue-600 hover:bg-blue-500 text-white"
    }`}
  >
    Skip This Offseason
  </button>

  <button
    onClick={runRetirements}
    disabled={loading || alreadyRan || retirementsDisabled}
    className={`px-5 py-3 rounded-xl font-bold transition ${
      loading || alreadyRan || retirementsDisabled
        ? "bg-neutral-700 text-white/45 cursor-not-allowed"
        : "bg-orange-600 hover:bg-orange-500 text-white"
    }`}
  >
    {loading
      ? "Running Retirements..."
      : alreadyRan
      ? "Retirements Complete"
      : retirementsDisabled
      ? "Retirements Disabled"
      : "Run Player Retirements"}
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
  <p className="text-2xl font-bold text-white">
    {retirementResult?.disabled ? "Retirements are disabled." : "No retirements this offseason."}
  </p>
  <p className="text-white/55 mt-2">
    {retirementResult?.disabled
      ? "Veteran players will remain active in the league until you turn retirements back on."
      : "The league rolls forward with every player still active."}
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
