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
function InfoChip({ children, tone = "neutral" }) {
  const cls =
    tone === "orange"
      ? "border-orange-500/30 bg-orange-500/10 text-orange-200"
      : tone === "green"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      : tone === "red"
      ? "border-red-500/30 bg-red-500/10 text-red-200"
      : "border-neutral-600 bg-neutral-800 text-neutral-200";
  return <span className={`inline-flex px-2.5 py-1 rounded-full border text-xs font-bold uppercase tracking-wide ${cls}`}>{children}</span>;
}

function formatToolLabel(value) {
  if (!value) return "";
  return String(value).replaceAll("_", " ");
}

function formatNeedScore(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${Math.round(n * 100)}%`;
}

function getOfferPlayerKeyFromParts(playerId, playerName) {
  if (playerId !== undefined && playerId !== null && playerId !== "") {
    return `id:${playerId}`;
  }
  return `name:${playerName || ""}`;
}

function getOfferStatusTone(status) {
  if (["won", "pending_user_decision", "active"].includes(status)) return "green";
  if (["lost", "matched_by_original_team"].includes(status)) return "red";
  return "neutral";
}

function getOfferStatusLabel(status, signedWith = "", userTeamName = "") {
  if (status === "won") return "Won - Signed With You";
  if (status === "pending_user_decision") return "Ready to Sign";
  if (status === "active") return "Still Active";
  if (status === "matched_by_original_team") {
    return signedWith ? `Matched by ${signedWith}` : "Matched by Rights Team";
  }
  if (status === "lost") {
    return signedWith ? `Lost to ${signedWith}` : "Lost";
  }
  return "Tracking";
}

function getSignedWithDisplay(signedWith, userTeamName) {
  if (!signedWith) return "-";
  if (userTeamName && signedWith === userTeamName) return `${signedWith} (You)`;
  return signedWith;
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
  const [offerStatusPopupOpen, setOfferStatusPopupOpen] = useState(false);
  const [dismissedOfferStatusIds, setDismissedOfferStatusIds] = useState(() => {
    try {
      const raw = sessionStorage.getItem("bm_dismissed_offer_status_ids_v1");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const advanceFreeAgencyDay = simEngine.advanceFreeAgencyDay;
  const processPendingUserFreeAgencyDecisions =
    simEngine.processPendingUserFreeAgencyDecisions;
  const processPendingRfaMatchDecision =
    simEngine.processPendingRfaMatchDecision;

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

  const pendingRfaMatchDecisions = Array.isArray(freeAgencyState?.pendingRfaMatchDecisions)
    ? freeAgencyState.pendingRfaMatchDecisions
    : [];

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

  const getPlayerKeyFromFreeAgent = (player) => {
    if (!player) return "";
    return getOfferPlayerKeyFromParts(player.id, player.name);
  };

  const findFreeAgentByKey = (playerKey) => {
    for (const player of leagueData?.freeAgents || []) {
      if (getPlayerKeyFromFreeAgent(player) === playerKey) return player;
    }
    return null;
  };

  const userOfferActivity = useMemo(() => {
    const teamName = selectedTeam?.name;
    if (!teamName) return [];

    const state = leagueData?.freeAgencyState || {};
    const rowsByKey = new Map();

    const addRow = (row) => {
      if (!row?.playerKey) return;
      const old = rowsByKey.get(row.playerKey);
      const priority = {
        lost: 5,
        matched_by_original_team: 5,
        won: 4,
        pending_user_decision: 3,
        active: 2,
      };

      if (!old || (priority[row.status] || 0) >= (priority[old.status] || 0)) {
        rowsByKey.set(row.playerKey, row);
      }
    };

    for (const row of state.pendingUserDecisions || []) {
      if (!row?.playerKey) continue;
      addRow({
        id: `pending|${row.playerKey}|${row.day || ""}`,
        playerKey: row.playerKey,
        playerName: row.playerName || row?.player?.name || "Unknown Player",
        status: "pending_user_decision",
        teamName,
        signedWith: teamName,
        contract: row.contract,
        totalValue: row.totalValue,
        years: row.years,
        day: row.day,
        detail: "Your offer is currently waiting for your final approval on this screen.",
        popupEligible: false,
      });
    }

    const offersByPlayer = state.offersByPlayer || {};
    for (const [playerKey, offers] of Object.entries(offersByPlayer)) {
      for (const offer of offers || []) {
        if (offer?.teamName !== teamName) continue;
        if (offer?.source !== "user") continue;
        if (offer?.status && offer.status !== "active") continue;

        const player = findFreeAgentByKey(playerKey);
        addRow({
          id: `active|${playerKey}|${offer.submittedDay || ""}`,
          playerKey,
          playerName: offer.playerName || player?.name || "Unknown Player",
          status: "active",
          teamName,
          signedWith: null,
          contract: offer.contract,
          totalValue: offer.totalValue,
          years: offer.years,
          day: offer.submittedDay,
          detail: "Your offer is live. The player is still comparing offers.",
          popupEligible: false,
        });
      }
    }

    for (const log of state.signedPlayersLog || []) {
      const allOffers = Array.isArray(log?.allOffers) ? log.allOffers : [];
      const userOffer = allOffers.find((offer) => offer?.teamName === teamName && offer?.source === "user");
      if (!userOffer) continue;

      const playerKey = getOfferPlayerKeyFromParts(log.playerId, log.playerName);
      const signedWith = log.teamName || log.signedWith;
      const won = signedWith === teamName || userOffer.status === "accepted";
      const matchedByOriginal = Boolean(log.rfaMatched && log.originalOfferTeamName === teamName && signedWith !== teamName);
      const status = won ? "won" : matchedByOriginal ? "matched_by_original_team" : "lost";

      const signedContractSummary = getContractSummary(log.contract);
      const userOfferContractSummary = getContractSummary(
        userOffer.contract,
        userOffer.totalValue,
        userOffer.years
      );

      addRow({
        id: `${status}|${playerKey}|${signedWith || ""}|${log.day || ""}`,
        playerKey,
        playerName: log.playerName || userOffer.playerName || "Unknown Player",
        status,
        teamName,
        signedWith,
        contract: log.contract || userOffer.contract,
        totalValue: signedContractSummary.totalValue || userOffer.totalValue,
        years: signedContractSummary.years || userOffer.years,
        userOfferContract: userOffer.contract,
        userOfferTotalValue: userOfferContractSummary.totalValue,
        userOfferYears: userOfferContractSummary.years,
        signedContract: log.contract || userOffer.contract,
        signedTotalValue: signedContractSummary.totalValue || userOffer.totalValue,
        signedYears: signedContractSummary.years || userOffer.years,
        day: log.day,
        detail: won
          ? `${log.playerName || "The player"} signed with ${teamName}. Your offer won.`
          : matchedByOriginal
          ? `${signedWith} matched your RFA offer sheet. ${log.playerName || "The player"} signed with ${signedWith}.`
          : `${log.playerName || "The player"} signed with ${signedWith || "another team"} instead of accepting your offer.`,
        popupEligible: !won,
      });
    }

    return Array.from(rowsByKey.values()).sort((a, b) => {
      const priority = { lost: 1, matched_by_original_team: 1, pending_user_decision: 2, active: 3, won: 4 };
      const diff = (priority[a.status] || 9) - (priority[b.status] || 9);
      if (diff !== 0) return diff;
      return String(a.playerName || "").localeCompare(String(b.playerName || ""));
    });
  }, [leagueData, selectedTeam?.name]);

  const offerPopupRows = useMemo(() => {
    const dismissed = new Set(dismissedOfferStatusIds || []);
    return userOfferActivity.filter((row) => row.popupEligible && !dismissed.has(row.id));
  }, [userOfferActivity, dismissedOfferStatusIds]);

  const dismissOfferStatusPopup = () => {
    const ids = Array.from(new Set([
      ...(dismissedOfferStatusIds || []),
      ...offerPopupRows.map((row) => row.id),
    ]));
    setDismissedOfferStatusIds(ids);
    try {
      sessionStorage.setItem("bm_dismissed_offer_status_ids_v1", JSON.stringify(ids));
    } catch {}
    setOfferStatusPopupOpen(false);
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

  useEffect(() => {
    if (offerPopupRows.length > 0) {
      setOfferStatusPopupOpen(true);
    }
  }, [offerPopupRows.length]);
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
    const capHoldTotal = Number(pendingUserTeamSnapshot?.capHoldTotal || 0);
    const practicalPayrollAfter = Number(pendingUserTeamSnapshot?.practicalPayroll || payrollBefore + capHoldTotal) + selectedCurrentYearTotal;
    const practicalCapRoomAfter = Number(pendingUserTeamSnapshot?.practicalCapRoom ?? capRoomBefore - capHoldTotal) - selectedCurrentYearTotal;
    const firstApron = Number(pendingUserTeamSnapshot?.firstApron || 0);
    const secondApron = Number(pendingUserTeamSnapshot?.secondApron || 0);
    const hardCapRoomAfter =
      hardCapRoomBefore === null ? null : hardCapRoomBefore - selectedCurrentYearTotal;
    const rosterAfter = rosterBefore + selectedCount;

    const warnings = [];  
    const apronNotes = [];


    if (hardCapRoomAfter !== null && hardCapRoomAfter < 0) {
      warnings.push("Selected signings put you over the hard cap.");
    }

    if (rosterAfter > rosterLimit) {
      warnings.push(`Selected signings would take you over the ${rosterLimit}-man roster limit.`);
    }
if (secondApron > 0 && payrollAfter >= secondApron) {
  apronNotes.push("Selected signings would leave you at or above the second apron.");
} else if (firstApron > 0 && payrollAfter >= firstApron) {
  apronNotes.push("Selected signings would leave you at or above the first apron.");
}

    return {
      selectedCount,
      selectedCurrentYearTotal,
      selectedTotalValue,
      payrollBefore,
      payrollAfter,
      capRoomBefore,
      capRoomAfter,
      capHoldTotal,
      practicalPayrollAfter,
      practicalCapRoomAfter,
      firstApron,
      secondApron,
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

  const handleRfaMatchDecision = async (row, decision) => {
    if (!selectedTeam?.name) {
      setActionError("No team selected.");
      return;
    }

    if (!row?.playerKey) {
      setActionError("Missing restricted free agent decision key.");
      return;
    }

    try {
      setProcessingBack(true);
      setActionError("");

      const res = await processPendingRfaMatchDecision(
        leagueData,
        selectedTeam.name,
        row.playerKey,
        decision
      );

      if (!res?.ok) {
        if (res?.leagueData) {
          applyLeagueUpdate(res.leagueData);
        }
        setActionError(res?.reason || "Failed to process RFA match decision.");
        return;
      }

      const latest = {
        dayResolved: dayResolved ?? row?.day ?? null,
        signings: res?.processedSignings || (res?.processedSigning ? [res.processedSigning] : []),
        generatedOffers: res?.generatedOffers || [],
        stateSummary: res?.stateSummary || null,
      };

      applyLeagueUpdateWithLatestResults(res.leagueData, latest);
    } catch (err) {
      setActionError(err?.message || "Failed to process RFA match decision.");
    } finally {
      setProcessingBack(false);
    }
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
    <style>{`
      .bm-orange-scroll {
        scrollbar-width: thin;
        scrollbar-color: #f97316 #171717;
      }

      .bm-orange-scroll::-webkit-scrollbar {
        width: 10px;
      }

      .bm-orange-scroll::-webkit-scrollbar-track {
        background: #171717;
        border-radius: 9999px;
      }

      .bm-orange-scroll::-webkit-scrollbar-thumb {
        background: linear-gradient(to bottom, #f97316, #c2410c);
        border-radius: 9999px;
        border: 2px solid #171717;
      }

      .bm-orange-scroll::-webkit-scrollbar-thumb:hover {
        background: linear-gradient(to bottom, #fb923c, #ea580c);
      }
    `}</style>
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


            {userOfferActivity.length > 0 && (
              <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-6 mb-6 shadow-lg">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div>
                    <div className="text-lg font-semibold text-orange-400">
                      Your Offer Tracker
                    </div>
                    <div className="text-sm text-gray-400 mt-1">
                      Live status for players you submitted offers to.
                    </div>
                  </div>
                  <div className="text-sm text-gray-400">
                    {userOfferActivity.length} tracked
                  </div>
                </div>

                <div className="bm-orange-scroll max-h-[280px] overflow-y-auto pr-2 space-y-3">
                  {userOfferActivity.map((row) => (
                    <div
                      key={row.id}
                      className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
                    >
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div>
                          <div className="text-white font-semibold">
                            {row.playerName}
                          </div>
                          <div className="text-sm text-gray-400 mt-1">
                            {row.detail}
                          </div>
                          <div className="text-sm text-gray-500 mt-2 space-y-1">
                            {row.status === "active" || row.status === "pending_user_decision" ? (
                              <div>
                                Your offer: {formatContractLine(row.contract, row.totalValue, row.years)}
                                {row.day ? ` • Day ${row.day}` : ""}
                              </div>
                            ) : (
                              <>
                                <div>
                                  Signed with: <span className="text-gray-300 font-semibold">{getSignedWithDisplay(row.signedWith, selectedTeam?.name)}</span>
                                </div>
                                <div>
                                  Signed contract: {formatContractLine(row.signedContract || row.contract, row.signedTotalValue || row.totalValue, row.signedYears || row.years)}
                                </div>
                                <div>
                                  Your offer: {formatContractLine(row.userOfferContract || row.contract, row.userOfferTotalValue || row.totalValue, row.userOfferYears || row.years)}
                                  {row.day ? ` • Day ${row.day}` : ""}
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 md:justify-end">
                          <InfoChip tone={getOfferStatusTone(row.status)}>
                            {getOfferStatusLabel(row.status, row.signedWith, selectedTeam?.name)}
                          </InfoChip>
                          {row.signedWith && row.signedWith !== selectedTeam?.name && (
                            <InfoChip tone="orange">Signed With {row.signedWith}</InfoChip>
                          )}
                          {row.signedWith && row.signedWith === selectedTeam?.name && (
                            <InfoChip tone="green">Signed With You</InfoChip>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}


            {pendingRfaMatchDecisions.length > 0 && (
              <div className="bg-neutral-800 border border-orange-500/40 rounded-2xl p-6 mb-6 shadow-lg">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div>
                    <div className="text-lg font-semibold text-orange-400">
                      Restricted Free Agent Match Decisions
                    </div>
                    <div className="text-sm text-gray-400 mt-1">
                      Another team signed one of your restricted free agents to an offer sheet. Match it or let him leave.
                    </div>
                  </div>
                  <div className="text-sm text-gray-400">
                    {pendingRfaMatchDecisions.length} pending
                  </div>
                </div>

                <div className="space-y-3">
                  {pendingRfaMatchDecisions.map((row) => {
                    const contractSummary = getContractSummary(
                      row?.contract || row?.offerSheet?.contract,
                      row?.totalValue,
                      row?.years
                    );

                    return (
                      <div
                        key={row.playerKey}
                        className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-4"
                      >
                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                          <div className="flex items-center gap-4 min-w-0">
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

                            <div className="min-w-0 flex-1">
                              <div className="text-white font-semibold text-2xl leading-tight">
                                {row?.player?.name || row?.playerName || "Unknown Player"}
                              </div>

                              <div className="text-sm text-gray-400 mt-1">
                                Rights Team: <span className="text-orange-200 font-semibold">{row?.rightsTeamName || selectedTeam?.name}</span>
                                {row?.offeringTeamName ? ` • Offer Sheet From: ${row.offeringTeamName}` : ""}
                              </div>

                              <div className="text-base text-gray-300 mt-2">
                                {formatContractLine(row?.contract || row?.offerSheet?.contract, row?.totalValue, row?.years)}
                              </div>

                              <div className="text-sm text-gray-500 mt-1">
                                Current year cap hit: {formatDollars(contractSummary.currentYearSalary || row?.currentYearSalary || 0)}
                              </div>

                              <div className="flex flex-wrap gap-2 mt-3">
                                <InfoChip tone="orange">RFA Offer Sheet</InfoChip>
                                {row?.deadlineDay && <InfoChip>Deadline Day {row.deadlineDay}</InfoChip>}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2 lg:justify-end shrink-0">
                            <button
                              onClick={() => handleRfaMatchDecision(row, "match")}
                              disabled={processingBack}
                              className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold transition"
                            >
                              Match Offer
                            </button>
                            <button
                              onClick={() => handleRfaMatchDecision(row, "decline")}
                              disabled={processingBack}
                              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold transition"
                            >
                              Decline Match
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

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
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
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
                    <div className="text-xs text-gray-400 mb-1">Practical Cap</div>
                    <div className={`text-base font-semibold ${(selectionPreview?.practicalCapRoomAfter ?? pendingUserTeamSnapshot?.practicalCapRoom ?? 0) < 0 ? "text-red-300" : "text-white"}`}>
                      {formatDollars(selectionPreview?.practicalCapRoomAfter ?? pendingUserTeamSnapshot?.practicalCapRoom ?? 0)}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1">incl. holds</div>
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
      <div className="flex flex-wrap gap-2 mt-3">
        {row?.spendingType && <InfoChip tone={row.spendingType === "bird_rights" ? "orange" : "green"}>{formatToolLabel(row.spendingType)}</InfoChip>}
        {row?.exceptionType && <InfoChip tone="green">{formatToolLabel(row.exceptionType)}</InfoChip>}
        {row?.payrollZone && <InfoChip>{formatToolLabel(row.payrollZone)}</InfoChip>}
        {row?.chosenOffer?.rfaMatched && <InfoChip tone="orange">RFA Match</InfoChip>}
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
<div className="bm-orange-scroll max-h-[540px] overflow-y-auto pr-2 space-y-3">
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
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {signing?.spendingType && <InfoChip tone={signing.spendingType === "bird_rights" ? "orange" : "green"}>{formatToolLabel(signing.spendingType)}</InfoChip>}
                                  {signing?.exceptionType && <InfoChip tone="green">{formatToolLabel(signing.exceptionType)}</InfoChip>}
                                  {signing?.exceptionUsage?.amountUsed > 0 && <InfoChip tone="orange">Used {formatDollars(signing.exceptionUsage.amountUsed)}</InfoChip>}
                                  {signing?.rfaMatched && <InfoChip tone="orange">RFA Matched</InfoChip>}
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
<div className="bm-orange-scroll max-h-[540px] overflow-y-auto pr-2 space-y-3">
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
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {offer?.spendingType && <InfoChip tone={offer.spendingType === "bird_rights" ? "orange" : "green"}>{formatToolLabel(offer.spendingType)}</InfoChip>}
                                  {offer?.exceptionType && <InfoChip tone="green">{formatToolLabel(offer.exceptionType)}</InfoChip>}
                                  {offer?.rosterNeed?.position && <InfoChip tone="orange">Need {offer.rosterNeed.position} {formatNeedScore(offer.rosterNeed.needScore)}</InfoChip>}
                                  {offer?.teamDirection && <InfoChip>{formatToolLabel(offer.teamDirection)}</InfoChip>}
                                  {offer?.payrollZone && <InfoChip>{formatToolLabel(offer.payrollZone)}</InfoChip>}
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
      {offerStatusPopupOpen && offerPopupRows.length > 0 && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[70] px-4 py-6">
          <div className="w-full max-w-2xl bg-neutral-800 rounded-2xl border border-orange-500/40 shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-2xl font-extrabold text-orange-400">
                  Offer Update
                </h2>
                <p className="text-sm text-gray-400 mt-1">
                  One or more players you offered have made a decision.
                </p>
              </div>
              <button
                onClick={dismissOfferStatusPopup}
                className="px-3 py-2 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-white font-semibold transition"
              >
                Close
              </button>
            </div>

            <div className="bm-orange-scroll max-h-[360px] overflow-y-auto pr-2 space-y-3">
              {offerPopupRows.map((row) => (
                <div
                  key={row.id}
                  className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-4"
                >
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                      <div className="text-white text-lg font-bold">
                        {row.playerName}
                      </div>
                      <div className="text-sm text-gray-300 mt-1">
                        {row.detail}
                      </div>
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                        <div className="bg-neutral-800/80 border border-neutral-700 rounded-lg px-3 py-2">
                          <div className="text-xs text-gray-500 mb-1">Signed With</div>
                          <div className="text-gray-100 font-semibold">
                            {getSignedWithDisplay(row.signedWith, selectedTeam?.name)}
                          </div>
                        </div>
                        <div className="bg-neutral-800/80 border border-neutral-700 rounded-lg px-3 py-2">
                          <div className="text-xs text-gray-500 mb-1">Signed Contract</div>
                          <div className="text-gray-100 font-semibold">
                            {formatContractLine(row.signedContract || row.contract, row.signedTotalValue || row.totalValue, row.signedYears || row.years)}
                          </div>
                        </div>
                        <div className="bg-neutral-800/80 border border-neutral-700 rounded-lg px-3 py-2">
                          <div className="text-xs text-gray-500 mb-1">Your Offer</div>
                          <div className="text-gray-100 font-semibold">
                            {formatContractLine(row.userOfferContract || row.contract, row.userOfferTotalValue || row.totalValue, row.userOfferYears || row.years)}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 md:justify-end">
                      <InfoChip tone={getOfferStatusTone(row.status)}>
                        {getOfferStatusLabel(row.status, row.signedWith, selectedTeam?.name)}
                      </InfoChip>
                      {row.signedWith && row.signedWith !== selectedTeam?.name && <InfoChip tone="orange">Signed With {row.signedWith}</InfoChip>}
                      {row.signedWith && row.signedWith === selectedTeam?.name && <InfoChip tone="green">Signed With You</InfoChip>}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end mt-5">
              <button
                onClick={dismissOfferStatusPopup}
                className="px-5 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-bold transition"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}