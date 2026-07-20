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
    <div className={`${styles.retirementsPage} bmCourtPage h-full min-h-0 overflow-hidden px-4 py-3 text-white`}>
      <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-3">
        <header className="flex shrink-0 items-center justify-between gap-5 rounded-2xl border border-white/10 bg-neutral-800/85 px-5 py-3 shadow-xl">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">Offseason Event</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-3xl font-extrabold text-orange-500">Player Retirements</h1>
              <span className="text-sm font-bold text-white/60">{seasonYear} Offseason</span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <button
              onClick={toggleRetirementsDisabled}
              disabled={alreadyRan}
              className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
                alreadyRan
                  ? "cursor-not-allowed bg-neutral-700 text-white/45"
                  : retirementsDisabled
                  ? "bg-emerald-700 hover:bg-emerald-600"
                  : "bg-neutral-700 hover:bg-neutral-600"
              }`}
            >
              {retirementsDisabled ? "Retirements Off" : "Retirements On"}
            </button>

            {!alreadyRan && (
              <>
                <button
                  onClick={() => finalizeRetirementsAsSkipped({ disabled: retirementsDisabled })}
                  disabled={loading}
                  className="rounded-lg bg-neutral-700 px-4 py-2 text-sm font-bold transition hover:bg-neutral-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Skip
                </button>
                <button
                  onClick={runRetirements}
                  disabled={loading || retirementsDisabled}
                  className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-white/45"
                >
                  {loading ? "Processing..." : retirementsDisabled ? "Disabled" : "Run Retirements"}
                </button>
              </>
            )}

            {alreadyRan && (
              <button
                onClick={() => navigate("/offseason")}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold transition hover:bg-orange-500"
              >
                Continue
              </button>
            )}
          </div>
        </header>

        {error && (
          <div className="shrink-0 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200">
            {error}
          </div>
        )}

        <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-4">
          <SummaryCard label="Retired" value={summary.retiredCount || 0} tone="orange" />
          <SummaryCard label="Average Age" value={fmt1(summary.averageAge || 0)} />
          <SummaryCard label="Average OVR" value={fmt1(summary.averageOverall || 0)} />
          <SummaryCard label="Teams Hit" value={summary.teamsAffected || 0} tone="green" />
        </div>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-800/85 shadow-xl">
          <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-3">
            <div>
              <h2 className="text-xl font-extrabold">Retirement Results</h2>
              <p className="text-xs text-white/50">
                {alreadyRan ? `${retiredPlayers.length} players retired.` : "Run retirements to generate the league result."}
              </p>
            </div>
          </div>

          <div className="bmTableScroller min-h-0 flex-1 overflow-y-auto">
            {!alreadyRan ? (
              <div className="flex h-full min-h-[220px] items-center justify-center text-white/45">No results yet.</div>
            ) : retiredPlayers.length === 0 ? (
              <div className="flex h-full min-h-[220px] flex-col items-center justify-center text-center">
                <p className="text-xl font-bold">{retirementResult?.disabled ? "Retirements are disabled." : "No retirements this offseason."}</p>
                <p className="mt-1 text-sm text-white/50">Every player remains active.</p>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {retiredPlayers.map((player, idx) => {
                  const logo = teamLogoMap[player?.retiredFromTeam] || "";
                  const headshot = player?.headshot || player?.portrait || player?.image || player?.photo || player?.face || null;
                  return (
                    <div key={`${player?.name || "retired"}-${idx}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-5 py-2.5 transition hover:bg-white/5">
                      <div className="flex min-w-0 items-center gap-3">
                        {headshot ? (
                          <img src={headshot} alt={player?.name || "Retired Player"} className="h-10 w-10 shrink-0 rounded-full border border-white/10 bg-white/5 object-cover" />
                        ) : (
                          <div className="h-10 w-10 shrink-0 rounded-full border border-white/10 bg-white/5" />
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-bold">{player?.name || "Unknown Player"}</div>
                          <div className="text-xs text-white/50">{player?.pos || "-"} • Age {player?.age ?? "-"} • OVR {player?.overall ?? player?.ovr ?? "-"}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-sm text-white/70">
                        {logo ? <img src={logo} alt="" className="h-6 w-6 object-contain" /> : null}
                        <span className="hidden whitespace-nowrap lg:inline">{player?.retiredFromTeam || "Free Agency"}</span>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-xs text-white/50">{Math.round(Number(player?.retirementProbability || 0) * 100)}%</span>
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-200">Retired</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );

}
