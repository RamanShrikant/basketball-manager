import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import * as simEngine from "../api/simEnginePy.js";

function formatDollars(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(amount || 0));
}

function getContractSummary(contract, fallbackTotal = 0, fallbackYears = 0) {
  const salaryByYear = Array.isArray(contract?.salaryByYear)
    ? contract.salaryByYear
    : [];

  const years = salaryByYear.length || Number(fallbackYears || 0);
  const totalValue = salaryByYear.length
    ? salaryByYear.reduce((sum, value) => sum + Number(value || 0), 0)
    : Number(fallbackTotal || 0);

  const currentYearSalary = salaryByYear.length
    ? Number(salaryByYear[0] || 0)
    : 0;

  return {
    years,
    totalValue,
    currentYearSalary,
  };
}

function formatContractLine(contract, fallbackTotal = 0, fallbackYears = 0) {
  const summary = getContractSummary(contract, fallbackTotal, fallbackYears);

  if (!summary.years || !summary.totalValue) {
    return "-";
  }

  return `${formatDollars(summary.totalValue)} - ${summary.years} years`;
}
function getOvrRingMetrics(overall) {
  const fillPercent = Math.min(Math.max(Number(overall || 0) / 99, 0), 1);
  const radius = 22;
  const circumference = 2 * Math.PI * radius;

  return {
    radius,
    circumference,
    strokeOffset: circumference * (1 - fillPercent),
  };
}

export default function ViewingOffers() {
  const navigate = useNavigate();
  const { leagueData, selectedTeam, setLeagueData, setSelectedTeam } = useGame();

  const [hideLeagueEvents, setHideLeagueEvents] = useState(false);
  const [hideCpuOffers, setHideCpuOffers] = useState(false);
  const [selectedDecisionMap, setSelectedDecisionMap] = useState({});
  const [actionError, setActionError] = useState("");
  const [processingBack, setProcessingBack] = useState(false);
  const [processingAdvance, setProcessingAdvance] = useState(false);

  const advanceFreeAgencyDay = simEngine.advanceFreeAgencyDay;
  const processPendingUserFreeAgencyDecisions =
    simEngine.processPendingUserFreeAgencyDecisions;

  const freeAgencyState = leagueData?.freeAgencyState || {};
  const latestResults = freeAgencyState?.latestResults || null;
  const stateSummary = latestResults?.stateSummary || null;
  const marketClosed = Boolean(stateSummary && !stateSummary.isActive);

  const signings = latestResults?.signings || [];
  const generatedOffers = latestResults?.generatedOffers || [];
  const dayResolved = latestResults?.dayResolved;

  const pendingUserDecisions = Array.isArray(freeAgencyState?.pendingUserDecisions)
    ? freeAgencyState.pendingUserDecisions
    : [];

  const pendingUserTeamSnapshot =
    freeAgencyState?.pendingUserTeamSnapshot || null;

  const teamLogoMap = useMemo(() => {
    const map = new Map();

    for (const confKey of Object.keys(leagueData?.conferences || {})) {
      for (const team of leagueData?.conferences?.[confKey] || []) {
        if (team?.name) {
          map.set(team.name, team.logo || "");
        }
      }
    }

    return map;
  }, [leagueData]);

  const getTeamLogo = (teamName) => {
    return teamLogoMap.get(teamName) || "";
  };

  const applyLeagueUpdate = (updated) => {
    if (!updated) return;

    if (typeof setLeagueData === "function") {
      setLeagueData(updated);
    }

    localStorage.setItem("leagueData", JSON.stringify(updated));

    if (typeof setSelectedTeam === "function" && selectedTeam?.name) {
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
  };

  const applyLeagueUpdateWithLatestResults = (updated, nextLatestResults = null) => {
    if (!updated) return;

    const nextLeagueData = {
      ...updated,
      freeAgencyState: {
        ...(updated.freeAgencyState || {}),
        latestResults: nextLatestResults || null,
      },
    };

    applyLeagueUpdate(nextLeagueData);
  };

  useEffect(() => {
    setSelectedDecisionMap((prev) => {
      const next = {};
      for (const row of pendingUserDecisions) {
        next[row.playerKey] = Boolean(prev?.[row.playerKey]);
      }
      return next;
    });
  }, [pendingUserDecisions]);
  const finalizeFreeAgencyComplete = (updated, nextLatestResults = null) => {
  if (!updated) return;

  const nextLeagueData = {
    ...updated,
    freeAgencyState: {
      ...(updated.freeAgencyState || {}),
      isActive: false,
      completed: true,
      latestResults:
        nextLatestResults !== null
          ? nextLatestResults
          : updated.freeAgencyState?.latestResults ?? latestResults ?? null,
    },
  };

  applyLeagueUpdate(nextLeagueData);

  try {
    const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
    const raw = localStorage.getItem(OFFSEASON_STATE_KEY);
    const prev = raw ? JSON.parse(raw) : {};

    const nextOffseasonState = {
      ...prev,
      freeAgencyComplete: true,
      currentStep: 4,
    };

    localStorage.setItem(
      OFFSEASON_STATE_KEY,
      JSON.stringify(nextOffseasonState)
    );
  } catch (err) {
    console.error("Failed to persist free agency completion:", err);
  }
};

  const selectedPendingRows = useMemo(() => {
    return pendingUserDecisions.filter((row) => selectedDecisionMap[row.playerKey]);
  }, [pendingUserDecisions, selectedDecisionMap]);

  const selectionPreview = useMemo(() => {
    if (!pendingUserTeamSnapshot?.ok) {
      return null;
    }

    const selectedCurrentYearTotal = selectedPendingRows.reduce((sum, row) => {
      const summary = getContractSummary(
        row?.contract,
        row?.totalValue,
        row?.years
      );
      return sum + Number(summary.currentYearSalary || row?.currentYearSalary || 0);
    }, 0);

    const selectedTotalValue = selectedPendingRows.reduce((sum, row) => {
      const summary = getContractSummary(
        row?.contract,
        row?.totalValue,
        row?.years
      );
      return sum + Number(summary.totalValue || 0);
    }, 0);

    const selectedCount = selectedPendingRows.length;
    const payrollBefore = Number(pendingUserTeamSnapshot?.payroll || 0);
    const capRoomBefore = Number(pendingUserTeamSnapshot?.capRoom || 0);
    const hardCapRoomBefore =
      pendingUserTeamSnapshot?.hardCapRoom === null ||
      pendingUserTeamSnapshot?.hardCapRoom === undefined
        ? null
        : Number(pendingUserTeamSnapshot.hardCapRoom);
    const rosterBefore = Number(pendingUserTeamSnapshot?.rosterCount || 0);
    const rosterLimit = Number(pendingUserTeamSnapshot?.rosterLimit || 15);

    const payrollAfter = payrollBefore + selectedCurrentYearTotal;
    const capRoomAfter = capRoomBefore - selectedCurrentYearTotal;
    const hardCapRoomAfter =
      hardCapRoomBefore === null ? null : hardCapRoomBefore - selectedCurrentYearTotal;
    const rosterAfter = rosterBefore + selectedCount;

    const warnings = [];  



    if (hardCapRoomAfter !== null && hardCapRoomAfter < 0) {
      warnings.push("Selected signings put you over the hard cap.");
    }

    if (rosterAfter > rosterLimit) {
      warnings.push(`Selected signings would take you over the ${rosterLimit}-man roster limit.`);
    }

    return {
      selectedCount,
      selectedCurrentYearTotal,
      selectedTotalValue,
      payrollBefore,
      payrollAfter,
      capRoomBefore,
      capRoomAfter,
      hardCapRoomBefore,
      hardCapRoomAfter,
      rosterBefore,
      rosterAfter,
      rosterLimit,
      warnings,
      hasBlockingIssue: warnings.length > 0,
    };
  }, [pendingUserTeamSnapshot, selectedPendingRows]);

  const toggleDecision = (playerKey) => {
    setSelectedDecisionMap((prev) => ({
      ...prev,
      [playerKey]: !prev[playerKey],
    }));
    setActionError("");
  };

  const processSelections = async () => {
    if (!selectedTeam?.name) {
      return { ok: false, reason: "No team selected." };
    }

    if (selectionPreview?.hasBlockingIssue) {
      return {
        ok: false,
        reason: selectionPreview.warnings.join(" "),
      };
    }

    const selectedPlayerKeys = pendingUserDecisions
      .filter((row) => selectedDecisionMap[row.playerKey])
      .map((row) => row.playerKey);

    return await processPendingUserFreeAgencyDecisions(
      leagueData,
      selectedTeam.name,
      selectedPlayerKeys
    );
  };

const handleBackToFreeAgency = async () => {
  try {
    setProcessingBack(true);
    setActionError("");

    const processRes = await processSelections();
    if (!processRes?.ok) {
      if (processRes?.leagueData) {
        applyLeagueUpdate(processRes.leagueData);
      }
      setActionError(processRes?.reason || "Failed to process pending signings.");
      return;
    }

    const finalLeague = processRes?.leagueData || leagueData;
    const finalStateSummary = processRes?.stateSummary || stateSummary;
    const finalLatestResults =
      finalLeague?.freeAgencyState?.latestResults || latestResults || null;

    if (finalStateSummary && !finalStateSummary.isActive) {
      finalizeFreeAgencyComplete(finalLeague, finalLatestResults);
      navigate("/offseason");
      return;
    }

    if (finalLeague) {
      applyLeagueUpdate(finalLeague);
    }

    navigate("/free-agents");
  } catch (err) {
    setActionError(err?.message || "Failed to process pending signings.");
  } finally {
    setProcessingBack(false);
  }
};
const handleReturnToOffseasonHub = async () => {
  try {
    setProcessingBack(true);
    setActionError("");

    const processRes = await processSelections();
    if (!processRes?.ok) {
      if (processRes?.leagueData) {
        applyLeagueUpdate(processRes.leagueData);
      }
      setActionError(processRes?.reason || "Failed to process pending signings.");
      return;
    }

    const finalLeague = processRes?.leagueData || leagueData;
    const finalStateSummary = processRes?.stateSummary || stateSummary;
    const finalLatestResults =
      finalLeague?.freeAgencyState?.latestResults || latestResults || null;

    if (finalStateSummary && !finalStateSummary.isActive) {
      finalizeFreeAgencyComplete(finalLeague, finalLatestResults);
    } else if (finalLeague) {
      applyLeagueUpdate(finalLeague);
    }

    navigate("/offseason");
  } catch (err) {
    setActionError(err?.message || "Failed to return to offseason hub.");
  } finally {
    setProcessingBack(false);
  }
};

  const handleAdvanceFromResults = async () => {
    try {
      setProcessingAdvance(true);
      setActionError("");

      const processRes = await processSelections();
      if (!processRes?.ok) {
        if (processRes?.leagueData) {
          applyLeagueUpdate(processRes.leagueData);
        }
        setActionError(processRes?.reason || "Failed to process pending signings.");
        return;
      }

      const baseLeague = processRes?.leagueData || leagueData;
      const baseStateSummary = processRes?.stateSummary || null;

if (baseStateSummary && !baseStateSummary.isActive) {
  const latest = {
    dayResolved: dayResolved ?? null,
    signings: processRes?.processedSignings || [],
    generatedOffers: processRes?.generatedOffers || [],
    stateSummary: baseStateSummary,
  };

  finalizeFreeAgencyComplete(baseLeague, latest);
  return;
}

      const res = await advanceFreeAgencyDay(
        baseLeague,
        selectedTeam?.name || null
      );

      if (!res?.ok || !res?.leagueData) {
        if (res?.leagueData) {
          applyLeagueUpdate(res.leagueData);
        }
        setActionError(res?.reason || "Failed to advance free agency day.");
        return;
      }

      const latest = {
        dayResolved: res?.dayResolved ?? null,
        signings: res?.signings || [],
        generatedOffers: res?.generatedOffers || [],
        stateSummary: res?.stateSummary || null,
      };

      applyLeagueUpdateWithLatestResults(res.leagueData, latest);
    } catch (err) {
      setActionError(err?.message || "Failed to advance free agency day.");
    } finally {
      setProcessingAdvance(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-900 text-white px-6 py-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-extrabold text-orange-500 mb-2">
            Viewing Offers
          </h1>
          <p className="text-gray-400 text-base">
            Review the latest free agency activity before moving on.
          </p>
        </div>

        {!latestResults ? (
          <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-6 shadow-lg">
            <p className="text-lg text-gray-300">
              No daily results available yet.
            </p>

            <div className="mt-6 flex gap-3 flex-wrap">
              <button
                onClick={() => navigate("/free-agents")}
                className="px-5 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
              >
                Back to Free Agency
              </button>

              <button
                onClick={() => navigate("/offseason")}
                className="px-5 py-3 bg-neutral-700 hover:bg-neutral-600 rounded-lg font-semibold transition"
              >
                Back to Offseason Hub
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-6 mb-6 shadow-lg">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                  <div className="text-sm text-gray-400 mb-1">
                    Free Agency Daily Results
                  </div>
                  <div className="text-2xl font-bold text-white">
                    {dayResolved ? `Day ${dayResolved} Complete` : "Opening Market Results"}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full lg:w-auto">
                  <div className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                    <div className="text-xs text-gray-400 mb-1">Signings</div>
                    <div className="text-base font-semibold text-white">
                      {signings.length}
                    </div>
                  </div>

                  <div className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                    <div className="text-xs text-gray-400 mb-1">New CPU Offers</div>
                    <div className="text-base font-semibold text-white">
                      {generatedOffers.length}
                    </div>
                  </div>

                  <div className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                    <div className="text-xs text-gray-400 mb-1">Free Agents Left</div>
                    <div className="text-base font-semibold text-white">
                      {stateSummary?.freeAgentCount ?? "-"}
                    </div>
                  </div>

                  <div className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                    <div className="text-xs text-gray-400 mb-1">Pending User Decisions</div>
                    <div className="text-base font-semibold text-white">
                      {stateSummary?.pendingUserDecisionCount ?? 0}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-6 mb-6 shadow-lg">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div className="text-lg font-semibold text-orange-400">
                  Your Pending Signings
                </div>
                <div className="text-sm text-gray-400">
                  {selectedTeam?.name || "No Team Selected"}
                </div>
              </div>

              {pendingUserTeamSnapshot?.ok && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
                  <div className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                    <div className="text-xs text-gray-400 mb-1">Payroll</div>
                    <div className="text-base font-semibold text-white">
                      {formatDollars(selectionPreview?.payrollAfter ?? pendingUserTeamSnapshot?.payroll ?? 0)}
                    </div>
                  </div>

                  <div className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                    <div className="text-xs text-gray-400 mb-1">Cap Space</div>
                    <div className={`text-base font-semibold ${(selectionPreview?.capRoomAfter ?? pendingUserTeamSnapshot?.capRoom ?? 0) < 0 ? "text-red-300" : "text-white"}`}>
                      {formatDollars(selectionPreview?.capRoomAfter ?? pendingUserTeamSnapshot?.capRoom ?? 0)}
                    </div>
                  </div>

                  <div className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                    <div className="text-xs text-gray-400 mb-1">Hard Cap Room</div>
                    <div className={`text-base font-semibold ${
                      selectionPreview?.hardCapRoomAfter !== null &&
                      selectionPreview?.hardCapRoomAfter !== undefined &&
                      selectionPreview?.hardCapRoomAfter < 0
                        ? "text-red-300"
                        : "text-white"
                    }`}>
                      {selectionPreview?.hardCapRoomAfter === null ||
                      selectionPreview?.hardCapRoomAfter === undefined
                        ? "Not Hard Capped"
                        : formatDollars(selectionPreview.hardCapRoomAfter)}
                    </div>
                  </div>

                  <div className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                    <div className="text-xs text-gray-400 mb-1">Roster</div>
                    <div className={`text-base font-semibold ${(selectionPreview?.rosterAfter ?? pendingUserTeamSnapshot?.rosterCount ?? 0) > (selectionPreview?.rosterLimit ?? pendingUserTeamSnapshot?.rosterLimit ?? 15) ? "text-red-300" : "text-white"}`}>
                      {(selectionPreview?.rosterAfter ?? pendingUserTeamSnapshot?.rosterCount ?? 0)} / {(selectionPreview?.rosterLimit ?? pendingUserTeamSnapshot?.rosterLimit ?? 15)}
                    </div>
                  </div>

                  <div className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                    <div className="text-xs text-gray-400 mb-1">Selected This Screen</div>
                    <div className="text-base font-semibold text-white">
                      {selectedPendingRows.length}
                    </div>
                  </div>
                </div>
              )}

              {selectionPreview?.warnings?.length > 0 && (
                <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                  <div className="text-sm font-semibold text-red-200">
                    {selectionPreview.warnings.join(" ")}
                  </div>
                </div>
              )}

              {actionError && (
                <div className="mb-4 text-sm font-semibold text-red-300">
                  {actionError}
                </div>
              )}

              {!pendingUserDecisions.length ? (
                <p className="text-gray-400">No user signings are waiting for your decision right now.</p>
              ) : (
                <div className="space-y-3">
                  {pendingUserDecisions.map((row) => {
                    const isSelected = Boolean(selectedDecisionMap[row.playerKey]);
                    const contractSummary = getContractSummary(
                      row?.contract,
                      row?.totalValue,
                      row?.years
                    );

                    return (
                      <div
                        key={row.playerKey}
                        className={`border rounded-xl px-4 py-4 transition ${
                          isSelected
                            ? "bg-green-500/10 border-green-500/40"
                            : "bg-neutral-900 border-neutral-700"
                        }`}
                      >
<div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
  <div className="flex items-center gap-4 min-w-0">
    <button
      onClick={() => toggleDecision(row.playerKey)}
      className={`w-8 h-8 rounded-md border-2 flex items-center justify-center font-bold transition shrink-0 ${
        isSelected
          ? "bg-green-500 border-green-300 text-white"
          : "bg-neutral-800 border-neutral-600 text-neutral-300"
      }`}
      title={isSelected ? "Selected" : "Select this signing"}
    >
      {isSelected ? "✓" : ""}
    </button>

    <div className="w-16 h-16 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 shrink-0 flex items-center justify-center">
      {row?.player?.headshot ? (
        <img
          src={row.player.headshot}
          alt={row?.player?.name || row?.playerName || "Player"}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="text-xs text-gray-400">No Image</div>
      )}
    </div>

    <div className="relative w-20 h-20 shrink-0 hidden sm:flex items-center justify-center">
      {(() => {
        const ring = getOvrRingMetrics(row?.player?.overall);
        const gradientId = `pending-ovr-${row.playerKey}`;

        return (
          <>
            <svg width="80" height="80" viewBox="0 0 60 60">
              <defs>
                <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#FFA500" />
                  <stop offset="100%" stopColor="#FFD54F" />
                </linearGradient>
              </defs>

              <circle
                cx="30"
                cy="30"
                r={ring.radius}
                stroke="rgba(255,255,255,0.10)"
                strokeWidth="5"
                fill="none"
              />

              <circle
                cx="30"
                cy="30"
                r={ring.radius}
                stroke={`url(#${gradientId})`}
                strokeWidth="5"
                strokeLinecap="round"
                fill="none"
                strokeDasharray={ring.circumference}
                strokeDashoffset={ring.strokeOffset}
                transform="rotate(-90 30 30)"
              />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <div className="text-[10px] text-gray-400 leading-none mb-1">OVR</div>
              <div className="text-2xl font-extrabold text-orange-400 leading-none">
                {row?.player?.overall ?? "-"}
              </div>
            </div>
          </>
        );
      })()}
    </div>

    <div className="min-w-0 flex-1">
      <div className="text-white font-semibold text-2xl leading-tight">
        {row?.player?.name || row?.playerName || "Unknown Player"}
      </div>

      <div className="text-sm text-gray-400 mt-1">
        {row?.player?.position || "-"}
        {row?.player?.age ? ` • Age ${row.player.age}` : ""}
      </div>

      <div className="text-base text-gray-300 mt-2">
        {formatContractLine(row?.contract, row?.totalValue, row?.years)}
      </div>

      <div className="text-sm text-gray-500 mt-1">
        Current year cap hit: {formatDollars(contractSummary.currentYearSalary || row?.currentYearSalary || 0)}
      </div>
    </div>
  </div>

  <div className="text-sm text-gray-400 shrink-0">
    {isSelected ? "Selected to sign" : "Waiting"}
  </div>
</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
              {!hideLeagueEvents && (
                <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-6 shadow-lg">
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div className="text-lg font-semibold text-orange-400">
                      League Events
                    </div>

                    <button
                      onClick={() => setHideLeagueEvents(true)}
                      className="px-3 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg text-sm font-semibold transition"
                    >
                      Hide League Events
                    </button>
                  </div>

                  {!signings.length ? (
                    <p className="text-gray-400">No signings recorded.</p>
                  ) : (
                    <div className="space-y-3">
                      {signings.map((signing, idx) => {
                        const logo = getTeamLogo(signing?.signedWith);

                        return (
                          <div
                            key={`${signing.playerName || "player"}-${idx}`}
                            className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
                          >
                            <div className="flex items-start gap-3">
                              {logo ? (
                                <img
                                  src={logo}
                                  alt={signing?.signedWith || "Team logo"}
                                  className="w-10 h-10 object-contain mt-1"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-neutral-700 mt-1" />
                              )}

                              <div className="min-w-0 flex-1">
                                <div className="text-white font-semibold">
                                  {signing.playerName || "Unknown Player"}
                                </div>
                                <div className="text-sm text-gray-400 mt-1">
                                  Signed with {signing.signedWith || "Unknown Team"}
                                </div>
                                <div className="text-sm text-gray-500 mt-2">
                                  {formatContractLine(signing?.contract)}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {!hideCpuOffers && (
                <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-6 shadow-lg">
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div className="text-lg font-semibold text-orange-400">
                      New CPU Offers
                    </div>

                    <button
                      onClick={() => setHideCpuOffers(true)}
                      className="px-3 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg text-sm font-semibold transition"
                    >
                      Hide New CPU Offers
                    </button>
                  </div>

                  {!generatedOffers.length ? (
                    <p className="text-gray-400">No new CPU offers were generated.</p>
                  ) : (
                    <div className="space-y-3">
                      {generatedOffers.map((offer, idx) => {
                        const logo = getTeamLogo(offer?.teamName);

                        return (
                          <div
                            key={`${offer.playerName || "player"}-${offer.teamName || "team"}-${idx}`}
                            className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
                          >
                            <div className="flex items-start gap-3">
                              {logo ? (
                                <img
                                  src={logo}
                                  alt={offer?.teamName || "Team logo"}
                                  className="w-10 h-10 object-contain mt-1"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-neutral-700 mt-1" />
                              )}

                              <div className="min-w-0 flex-1">
                                <div className="text-white font-semibold">
                                  {offer.teamName || "Unknown Team"}
                                </div>
                                <div className="text-sm text-gray-400 mt-1">
                                  Offered {offer.playerName || "Unknown Player"}
                                </div>
                                <div className="text-sm text-gray-500 mt-2">
                                  {formatContractLine(offer?.contract, offer?.totalValue, offer?.years)}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {(hideLeagueEvents || hideCpuOffers) && (
                <div className="xl:col-span-2 flex gap-3 flex-wrap">
                  {hideLeagueEvents && (
                    <button
                      onClick={() => setHideLeagueEvents(false)}
                      className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg text-sm font-semibold transition"
                    >
                      Show League Events
                    </button>
                  )}

                  {hideCpuOffers && (
                    <button
                      onClick={() => setHideCpuOffers(false)}
                      className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg text-sm font-semibold transition"
                    >
                      Show New CPU Offers
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-6 mb-6 shadow-lg">
              <div className="text-lg font-semibold text-orange-400 mb-4">
                Market Status
              </div>

              <div className="text-sm text-gray-300 space-y-2">
                <div>
                  Current Day:{" "}
                  <span className="text-white font-semibold">
                    {stateSummary?.currentDay ?? "-"}
                  </span>
                </div>
                <div>
                  Max Days:{" "}
                  <span className="text-white font-semibold">
                    {stateSummary?.maxDays ?? "-"}
                  </span>
                </div>
                <div>
                  Market Active:{" "}
                  <span className="text-white font-semibold">
                    {stateSummary?.isActive ? "Yes" : "No"}
                  </span>
                </div>
                <div>
                  Total Signed So Far:{" "}
                  <span className="text-white font-semibold">
                    {stateSummary?.signedCount ?? "-"}
                  </span>
                </div>
              </div>
            </div>

<div className="flex gap-3 flex-wrap">
  <button
    onClick={handleBackToFreeAgency}
    disabled={processingBack || processingAdvance}
    className="px-6 py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold transition"
  >
    {processingBack
      ? "Processing..."
      : marketClosed
      ? "Free Agency Complete"
      : "Back to Free Agency"}
  </button>

  <button
    onClick={handleAdvanceFromResults}
    disabled={processingBack || processingAdvance || marketClosed}
    className="px-6 py-3 bg-orange-600 hover:bg-orange-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold transition"
  >
    {marketClosed ? "Free Agency Complete" : processingAdvance ? "Advancing..." : "Advance Day"}
  </button>

<button
  onClick={handleReturnToOffseasonHub}
  disabled={processingBack || processingAdvance}
  className="px-6 py-3 bg-neutral-700 hover:bg-neutral-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold transition"
>
  Back to Offseason Hub
</button>
</div>
          </>
        )}
      </div>
    </div>
  );
}