import React, { useState, useEffect, useMemo } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";
import * as simEngine from "../api/simEnginePy.js";
import { rebuildGameplansForLeague } from "../utils/ensureGameplans";
import PlayerCardModal from "../components/PlayerCardModal.jsx";

const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";

export default function FreeAgents() {
  const { leagueData, selectedTeam, setSelectedTeam, setLeagueData } = useGame();
  const [workingLeagueData, setWorkingLeagueData] = useState(leagueData || null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playerCardPlayer, setPlayerCardPlayer] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "desc" });
  const [showLetters, setShowLetters] = useState(
    localStorage.getItem("showLetters") === "true"
  );

  const [signModalOpen, setSignModalOpen] = useState(false);
  const [signTargetPlayer, setSignTargetPlayer] = useState(null);
  const [offerSalaryText, setOfferSalaryText] = useState("");
  const [offerYears, setOfferYears] = useState(1);
  const [optionType, setOptionType] = useState("none");
  const [offerEvaluation, setOfferEvaluation] = useState(null);
  const [offerEvalLoading, setOfferEvalLoading] = useState(false);
  const [signError, setSignError] = useState("");

  const [marketInitLoading, setMarketInitLoading] = useState(false);
  const [advanceDayLoading, setAdvanceDayLoading] = useState(false);
  const [offersModalOpen, setOffersModalOpen] = useState(false);
  const [offersViewLoading, setOffersViewLoading] = useState(false);
  const [offersViewError, setOffersViewError] = useState("");
  const [offersViewData, setOffersViewData] = useState(null);
  const [daySummary, setDaySummary] = useState(null);
  const [rosterActionError, setRosterActionError] = useState("");
  const [offseasonState, setOffseasonState] = useState(() =>
    safeJSON(localStorage.getItem(OFFSEASON_STATE_KEY), null) || {}
  );

  const navigate = useNavigate();

  const evaluateFreeAgencyOffer = simEngine.evaluateFreeAgencyOffer;
  const signFreeAgent = simEngine.signFreeAgent;
  const generateFreeAgencyMarket = simEngine.generateFreeAgencyMarket;
  const initializeFreeAgencyPeriod = simEngine.initializeFreeAgencyPeriod;
  const getFreeAgentOffers = simEngine.getFreeAgentOffers;
  const submitUserFreeAgentOffer = simEngine.submitUserFreeAgentOffer;
  const advanceFreeAgencyDay = simEngine.advanceFreeAgencyDay;

  useEffect(() => {
    setWorkingLeagueData(leagueData || null);
  }, [leagueData]);

  useEffect(() => {
    setOffseasonState(
      safeJSON(localStorage.getItem(OFFSEASON_STATE_KEY), null) || {}
    );
  }, [workingLeagueData]);

  const attrColumns = [
    { key: "attr0", label: "3PT", index: 0 },
    { key: "attr1", label: "MID", index: 1 },
    { key: "attr2", label: "CLOSE", index: 2 },
    { key: "attr3", label: "FT", index: 3 },
    { key: "attr4", label: "BALL", index: 4 },
    { key: "attr5", label: "PASS", index: 5 },
    { key: "attr8", label: "PER D", index: 8 },
    { key: "attr9", label: "INS D", index: 9 },
    { key: "attr10", label: "BLK", index: 10 },
    { key: "attr11", label: "STL", index: 11 },
    { key: "attr12", label: "REB", index: 12 },
    { key: "attr7", label: "ATH", index: 7 },
    { key: "attr13", label: "OIQ", index: 13 },
    { key: "attr14", label: "DIQ", index: 14 },
  ];

  function safeJSON(raw, fallback = null) {
    try {
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  const updateOffseasonState = (patch) => {
    const current = safeJSON(localStorage.getItem(OFFSEASON_STATE_KEY), {}) || {};
    const next = { ...current, ...patch };
    localStorage.setItem(OFFSEASON_STATE_KEY, JSON.stringify(next));
    setOffseasonState(next);
  };

  const toLetter = (num) => {
    if (num >= 94) return "A+";
    if (num >= 87) return "A";
    if (num >= 80) return "A-";
    if (num >= 77) return "B+";
    if (num >= 73) return "B";
    if (num >= 70) return "B-";
    if (num >= 67) return "C+";
    if (num >= 63) return "C";
    if (num >= 60) return "C-";
    if (num >= 57) return "D+";
    if (num >= 53) return "D";
    if (num >= 50) return "D-";
    return "F";
  };

  const handleCellDoubleClick = () => {
    const next = !showLetters;
    setShowLetters(next);
    localStorage.setItem("showLetters", next);
  };

  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

  const formatDollars = (amount) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(Number(amount || 0));
  };

  const getRights = (player) => {
    return player?.rights && typeof player.rights === "object"
      ? player.rights
      : { heldByTeam: null, birdLevel: "none", seasonsTowardBird: 0, restrictedFreeAgent: false, rookieScale: false };
  };

  const formatBirdLabel = (level) => {
    if (level === "bird") return "Bird";
    if (level === "early_bird") return "Early Bird";
    if (level === "non_bird") return "Non-Bird";
    return "No Rights";
  };

  const Chip = ({ children, tone = "neutral" }) => {
    const cls =
      tone === "orange"
        ? "border-orange-500/30 bg-orange-500/10 text-orange-200"
        : tone === "green"
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
        : tone === "red"
        ? "border-red-500/30 bg-red-500/10 text-red-200"
        : "border-neutral-600 bg-neutral-800 text-neutral-200";
    return <span className={`inline-flex px-2.5 py-1 rounded-full border text-xs font-bold uppercase tracking-wide ${cls}`}>{children}</span>;
  };

  const renderRightsChips = (player, evaluation = null) => {
    const rights = getRights(player);
    const chips = [];
    chips.push(rights.restrictedFreeAgent ? <Chip key="rfa" tone="green">RFA</Chip> : <Chip key="ufa">UFA</Chip>);
    if (rights.heldByTeam) chips.push(<Chip key="rights" tone="orange">{formatBirdLabel(rights.birdLevel)}: {rights.heldByTeam}</Chip>);
    if (player?.qualifyingOffer?.amount) chips.push(<Chip key="qo" tone="green">QO {formatDollars(player.qualifyingOffer.amount)}</Chip>);
    if (evaluation?.spendingType) chips.push(<Chip key="tool" tone={evaluation.spendingType === "bird_rights" ? "orange" : "green"}>Using {String(evaluation.spendingType).replaceAll("_", " ")}</Chip>);
    if (evaluation?.exceptionType) chips.push(<Chip key="ex" tone="green">{String(evaluation.exceptionType).replaceAll("_", " ")}</Chip>);
    if (evaluation?.payrollZone) chips.push(<Chip key="zone">{String(evaluation.payrollZone).replaceAll("_", " ")}</Chip>);
    return chips;
  };

  const isRestrictedFreeAgent = (player) => {
    const rights = getRights(player);
    return Boolean(rights?.restrictedFreeAgent || player?.qualifyingOffer?.amount);
  };

  const formatMillionsInput = (amount) => {
    const val = Number(amount || 0) / 1_000_000;
    return val.toFixed(3).replace(/\.?0+$/, "");
  };

  const parseMillionsText = (text) => {
    const n = Number(String(text || "").trim());
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 1_000_000);
  };

  const getCurrentSeasonYear = () => {
    return Number(
      workingLeagueData?.seasonYear ||
      workingLeagueData?.currentSeasonYear ||
      2026
    );
  };

  const currentSeasonYear = getCurrentSeasonYear();

const isOffseasonMode =
  !!offseasonState?.active &&
  Number(offseasonState?.seasonYear || currentSeasonYear) === currentSeasonYear;
  const optionsComplete = !!offseasonState?.optionsComplete;
  const rightsManagementComplete = !!offseasonState?.rightsManagementComplete;
  const freeAgencyFinished = !!offseasonState?.freeAgencyComplete;

  const freeAgents = useMemo(() => {
    return workingLeagueData?.freeAgents || [];
  }, [workingLeagueData]);

  const liveFreeAgencyState = useMemo(() => {
    return workingLeagueData?.freeAgencyState || {};
  }, [workingLeagueData]);

  const isLiveFreeAgencyActive = !!liveFreeAgencyState?.isActive;
  const currentDay = Number(liveFreeAgencyState?.currentDay || 0);
  const maxDays = Number(liveFreeAgencyState?.maxDays || 0);
  const signedPlayersLog = liveFreeAgencyState?.signedPlayersLog || [];

  const effectiveFreeAgencyFinished =
    freeAgencyFinished ||
    (isOffseasonMode &&
      optionsComplete &&
      !isLiveFreeAgencyActive &&
      freeAgents.length === 0);

  const activeOfferCount = useMemo(() => {
    const offersByPlayer = liveFreeAgencyState?.offersByPlayer || {};
    let count = 0;

    for (const offers of Object.values(offersByPlayer)) {
      for (const offer of offers || []) {
        if (offer?.status === "active" || !offer?.status) count += 1;
      }
    }

    return count;
  }, [liveFreeAgencyState]);

  const currentUserTeam = useMemo(() => {
    if (!workingLeagueData?.conferences || !selectedTeam?.name) return null;

    for (const confKey of Object.keys(workingLeagueData.conferences || {})) {
      const found = (workingLeagueData.conferences[confKey] || []).find(
        (team) => team.name === selectedTeam.name
      );
      if (found) return found;
    }

    return null;
  }, [workingLeagueData, selectedTeam]);

  const minRosterSize = Number(
    workingLeagueData?.minRosterSize ||
    workingLeagueData?.minRosterLimit ||
    14
  );

  const maxRosterSize = Number(
    workingLeagueData?.rosterLimit ||
    workingLeagueData?.maxRosterSize ||
    15
  );

  const userRosterCount = Number(currentUserTeam?.players?.length || 0);
  const userRosterTooFew = !!selectedTeam?.name && userRosterCount < minRosterSize;
  const userRosterTooMany = !!selectedTeam?.name && userRosterCount > maxRosterSize;
  const userRosterInvalid = userRosterTooFew || userRosterTooMany;

  const canSubmitLiveOffer = isOffseasonMode && optionsComplete && rightsManagementComplete && isLiveFreeAgencyActive;
  const canManualCleanupSign = isOffseasonMode && effectiveFreeAgencyFinished && userRosterTooFew;
  const canUseFreeAgencyAction = !isOffseasonMode || canSubmitLiveOffer || canManualCleanupSign;

  const rosterValidationMessage = useMemo(() => {
    if (!selectedTeam?.name) return "";

    if (userRosterTooFew) {
      return `${selectedTeam.name} has ${userRosterCount} players. You need at least ${minRosterSize} players before leaving free agency.`;
    }

    if (userRosterTooMany) {
      return `${selectedTeam.name} has ${userRosterCount} players. You must get down to ${maxRosterSize} players before leaving free agency.`;
    }

    return "";
  }, [
    selectedTeam?.name,
    userRosterCount,
    userRosterTooFew,
    userRosterTooMany,
    minRosterSize,
    maxRosterSize,
  ]);

  const applyLeagueUpdate = (updated) => {
    if (!updated) return;

    setWorkingLeagueData(updated);

    if (typeof setLeagueData === "function") {
      setLeagueData(updated);
    }

    localStorage.setItem("leagueData", JSON.stringify(updated));

    if (typeof setSelectedTeam === "function" && selectedTeam?.name) {
      let nextSelectedTeam = null;

      for (const confKey of Object.keys(updated.conferences || {})) {
        const team = (updated.conferences[confKey] || []).find(
          (t) => t.name === selectedTeam.name
        );
        if (team) {
          nextSelectedTeam = team;
          break;
        }
      }

      if (nextSelectedTeam) {
        setSelectedTeam(nextSelectedTeam);
        localStorage.setItem("selectedTeam", JSON.stringify(nextSelectedTeam));
      }
    }
  };
    const applyLeagueUpdateWithLatestResults = (updated, latestResults = null) => {
    if (!updated) return;

    const nextLeagueData = {
      ...updated,
      freeAgencyState: {
        ...(updated.freeAgencyState || {}),
        latestResults: latestResults || null,
      },
    };

    applyLeagueUpdate(nextLeagueData);
  };

  const getPlayerKey = (player) => {
    if (!player) return "";
    if (player.id !== undefined && player.id !== null && player.id !== "") {
      return `id:${player.id}`;
    }
    return `name:${player.name || ""}`;
  };

  const buildLocalOffersView = (player) => {
    if (!player) return null;

    const offersByPlayer = liveFreeAgencyState?.offersByPlayer || {};
    const key = getPlayerKey(player);
    const offers = Array.isArray(offersByPlayer[key]) ? offersByPlayer[key] : [];

    const enriched = [...offers]
      .map((offer) => ({
        ...offer,
        playerViewScore: Number(offer?.playerViewScore || 0),
      }))
      .sort((a, b) => {
        const scoreDiff = Number(b.playerViewScore || 0) - Number(a.playerViewScore || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return Number(b.totalValue || 0) - Number(a.totalValue || 0);
      });

    const bestOfferId = enriched[0]?.offerId || null;

    return {
      ok: true,
      player: {
        id: player.id,
        name: player.name,
        overall: player.overall,
        age: player.age,
        position: player.pos,
        marketValue: player.marketValue || null,
        rights: player.rights || null,
        qualifyingOffer: player.qualifyingOffer || null,
        qualifyingOfferEligible: player.qualifyingOfferEligible || null,
      },
      offers: enriched.map((offer) => ({
        ...offer,
        isBestOffer: offer.offerId === bestOfferId,
      })),
    };
  };

  // ------------------------------------------------------------
  // User team cap dashboard + affordability model
  // ------------------------------------------------------------
  const MIN_CONTRACT_AMOUNT = 1_200_000;
  const DEFAULT_SALARY_CAP = 154_647_000;
  const DEFAULT_LUXURY_TAX_LINE = 187_895_000;
  const DEFAULT_FIRST_APRON = 195_945_000;
  const DEFAULT_SECOND_APRON = 207_824_000;
  const DEFAULT_ROOM_EXCEPTION = 8_781_000;
  const DEFAULT_NON_TAXPAYER_MLE = 14_104_000;
  const DEFAULT_TAXPAYER_MLE = 5_685_000;

  const getOperatingSeasonYear = () => {
    return getCurrentSeasonYear() + (isOffseasonMode ? 1 : 0);
  };

  const getLeagueAmount = (keys, fallback) => {
    for (const key of keys) {
      const value = Number(workingLeagueData?.[key] || 0);
      if (value > 0) return value;
    }
    return fallback;
  };

  const getSalaryCapAmount = () => getLeagueAmount(["salaryCap", "capLimit"], DEFAULT_SALARY_CAP);
  const getLuxuryTaxLineAmount = () => getLeagueAmount(["luxuryTaxLine", "taxLine"], DEFAULT_LUXURY_TAX_LINE);
  const getFirstApronAmount = () => getLeagueAmount(["firstApron", "apron1"], DEFAULT_FIRST_APRON);
  const getSecondApronAmount = () => getLeagueAmount(["secondApron", "apron2"], DEFAULT_SECOND_APRON);
  const getRoomExceptionAmount = () => getLeagueAmount(["roomException", "roomExceptionAmount"], DEFAULT_ROOM_EXCEPTION);
  const getNonTaxpayerMleAmount = () => getLeagueAmount(["midLevelException", "nonTaxpayerMLE", "nonTaxpayerMidLevelException"], DEFAULT_NON_TAXPAYER_MLE);
  const getTaxpayerMleAmount = () => getLeagueAmount(["taxpayerMLE", "taxpayerMidLevelException"], DEFAULT_TAXPAYER_MLE);

  const getContractSalaryForYear = (contract, seasonYear) => {
    const startYear = Number(contract?.startYear || 0);
    const salaryByYear = Array.isArray(contract?.salaryByYear) ? contract.salaryByYear : [];
    const idx = Number(seasonYear) - startYear;

    if (idx < 0 || idx >= salaryByYear.length) return 0;
    return Number(salaryByYear[idx] || 0);
  };

  const getTeamDeadCapForYear = (teamName, seasonYear) => {
    const deadCapMap = workingLeagueData?.deadCapByTeam || {};
    const rows = Array.isArray(deadCapMap?.[teamName]) ? deadCapMap[teamName] : [];

    return rows.reduce((sum, row) => {
      if (Number(row?.seasonYear || -1) !== Number(seasonYear)) return sum;
      return sum + Number(row?.amount || 0);
    }, 0);
  };

  const getPreviousSalaryForCapHold = (player) => {
    const previousSalaryByYear = Array.isArray(player?.previousContract?.salaryByYear)
      ? player.previousContract.salaryByYear
      : [];
    const currentSalaryByYear = Array.isArray(player?.contract?.salaryByYear)
      ? player.contract.salaryByYear
      : [];

    if (previousSalaryByYear.length) {
      return Number(previousSalaryByYear[previousSalaryByYear.length - 1] || 0);
    }

    if (currentSalaryByYear.length) {
      return Number(currentSalaryByYear[currentSalaryByYear.length - 1] || 0);
    }

    return Number(player?.marketValue?.expectedYear1Salary || MIN_CONTRACT_AMOUNT);
  };

  const getCapHoldForPlayer = (player, teamName) => {
    const rights = getRights(player);

    if (player?.rightsRenounced) return 0;
    if (!teamName || rights?.heldByTeam !== teamName) return 0;
    if (!rights?.birdLevel || rights.birdLevel === "none") return 0;

    if (
      rights?.restrictedFreeAgent &&
      player?.qualifyingOffer?.amount &&
      player?.qualifyingOffer?.status !== "withdrawn"
    ) {
      return Math.max(MIN_CONTRACT_AMOUNT, Number(player.qualifyingOffer.amount || 0));
    }

    const previousSalary = getPreviousSalaryForCapHold(player);
    const marketYearOne = Number(player?.marketValue?.expectedYear1Salary || MIN_CONTRACT_AMOUNT);

    if (rights.birdLevel === "bird") {
      return Math.max(previousSalary, marketYearOne, MIN_CONTRACT_AMOUNT);
    }

    if (rights.birdLevel === "early_bird") {
      return Math.max(previousSalary * 1.3, MIN_CONTRACT_AMOUNT);
    }

    if (rights.birdLevel === "non_bird") {
      return Math.max(previousSalary * 1.2, MIN_CONTRACT_AMOUNT);
    }

    return 0;
  };

  const getActiveOfferSalaryForTeam = (teamName) => {
    const offersByPlayer = liveFreeAgencyState?.offersByPlayer || {};
    let total = 0;

    for (const offers of Object.values(offersByPlayer)) {
      for (const offer of offers || []) {
        if (offer?.teamName !== teamName) continue;
        if (offer?.status && offer.status !== "active") continue;

        const currentSalary = Number(
          offer?.currentYearSalary ||
          offer?.salaryByYear?.[0] ||
          offer?.contract?.salaryByYear?.[0] ||
          0
        );

        total += currentSalary;
      }
    }

    return total;
  };

  const getTeamPayrollForOperatingSeason = (team, seasonYear, teamName) => {
    const playerPayroll = (team?.players || []).reduce((sum, player) => {
      return sum + getContractSalaryForYear(player?.contract, seasonYear);
    }, 0);

    return playerPayroll + getTeamDeadCapForYear(teamName, seasonYear);
  };

  const getHardCapForTeam = (teamName) => {
    if (!teamName) return null;

    const team = currentUserTeam || {};
    const isHardCapped =
      Boolean(team?.isHardCapped) ||
      Boolean(team?.hardCapped) ||
      Boolean(team?.hardCapTriggered) ||
      Boolean(team?.triggeredHardCap) ||
      Boolean(workingLeagueData?.hardCappedByTeam?.[teamName]) ||
      Boolean(workingLeagueData?.hardCapTriggeredByTeam?.[teamName]) ||
      (Array.isArray(workingLeagueData?.hardCappedTeams) &&
        workingLeagueData.hardCappedTeams.includes(teamName));

    if (!isHardCapped) return null;

    const teamKeys = [
      "hardCap",
      "hardCapValue",
      "hardCapAmount",
      "hardCapLine",
      "hardCapLimit",
      "secondApron",
      "secondApronValue",
      "secondApronAmount",
      "secondApronLine",
      "apron2",
    ];

    for (const key of teamKeys) {
      const value = Number(team?.[key] || 0);
      if (value > 0) return value;
    }

    for (const mapKey of ["hardCapByTeam", "teamHardCaps", "hardCapMap", "secondApronByTeam", "teamSecondAprons"]) {
      const value = Number(workingLeagueData?.[mapKey]?.[teamName] || 0);
      if (value > 0) return value;
    }

    return getSecondApronAmount();
  };

  const getPayrollZone = (payroll) => {
    const amount = Number(payroll || 0);

    if (amount >= getSecondApronAmount()) return "second_apron";
    if (amount >= getFirstApronAmount()) return "first_apron";
    if (amount >= getLuxuryTaxLineAmount()) return "tax";
    if (amount >= getSalaryCapAmount()) return "over_cap";
    return "below_cap";
  };

  const getOfferExceptionType = (offer) => {
    const raw = String(offer?.exceptionType || offer?.spendingTool || offer?.spendingType || "").toLowerCase();

    if (raw.includes("non_taxpayer") || raw.includes("non-taxpayer") || raw.includes("non taxpayer") || raw.includes("mid_level") || raw.includes("mid-level")) return "non_taxpayer_mle";
    if (raw.includes("taxpayer")) return "taxpayer_mle";
    if (raw.includes("room")) return "room_exception";
    if (raw.includes("mle")) return "non_taxpayer_mle";

    return "";
  };

  const getRecordedExceptionUsageForTeam = (teamName) => {
    const out = {
      nonTaxpayerMLE: 0,
      taxpayerMLE: 0,
      roomException: 0,
    };

    const usageSources = [
      liveFreeAgencyState?.exceptionUsageByTeam,
      liveFreeAgencyState?.exceptionUsage,
      workingLeagueData?.freeAgencyState?.exceptionUsageByTeam,
      workingLeagueData?.exceptionUsageByTeam,
      workingLeagueData?.exceptionUsage,
    ];

    let foundBackendLedger = false;

    for (const source of usageSources) {
      const row = source?.[teamName];
      if (!row || typeof row !== "object") continue;

      foundBackendLedger = true;

      out.nonTaxpayerMLE += Number(
        row.nonTaxpayerMLE ||
        row.non_taxpayer_mle ||
        row.midLevelException ||
        row.mid_level_exception ||
        0
      );

      out.taxpayerMLE += Number(
        row.taxpayerMLE ||
        row.taxpayer_mle ||
        row.taxpayerMidLevelException ||
        0
      );

      out.roomException += Number(
        row.roomException ||
        row.room_exception ||
        0
      );
    }

    // Fallback for old saves only. Once the Python backend has a real
    // exceptionUsageByTeam ledger, signedPlayersLog is informational and
    // should not be counted again.
    if (!foundBackendLedger) {
      for (const log of liveFreeAgencyState?.signedPlayersLog || []) {
        const signedTeam = log?.teamName || log?.signedWith;
        if (signedTeam !== teamName) continue;

        const firstYearSalary = Number(log?.currentYearSalary || log?.contract?.salaryByYear?.[0] || 0);
        const type = getOfferExceptionType(log);

        if (type === "taxpayer_mle") out.taxpayerMLE += firstYearSalary;
        if (type === "non_taxpayer_mle") out.nonTaxpayerMLE += firstYearSalary;
        if (type === "room_exception") out.roomException += firstYearSalary;
      }
    }

    const offersByPlayer = liveFreeAgencyState?.offersByPlayer || {};
    for (const offers of Object.values(offersByPlayer)) {
      for (const offer of offers || []) {
        if (offer?.teamName !== teamName) continue;
        if (offer?.status && offer.status !== "active") continue;

        const firstYearSalary = Number(
          offer?.currentYearSalary ||
          offer?.salaryByYear?.[0] ||
          offer?.contract?.salaryByYear?.[0] ||
          0
        );
        const type = getOfferExceptionType(offer);

        if (type === "taxpayer_mle") out.taxpayerMLE += firstYearSalary;
        if (type === "non_taxpayer_mle") out.nonTaxpayerMLE += firstYearSalary;
        if (type === "room_exception") out.roomException += firstYearSalary;
      }
    }

    return out;
  };

  const userCapDashboard = useMemo(() => {
    if (!selectedTeam?.name || !currentUserTeam) return null;

    const teamName = selectedTeam.name;
    const seasonYear = getOperatingSeasonYear();
    const salaryCap = getSalaryCapAmount();
    const payroll = getTeamPayrollForOperatingSeason(currentUserTeam, seasonYear, teamName);

    const capHoldTotal = freeAgents.reduce((sum, player) => {
      return sum + getCapHoldForPlayer(player, teamName);
    }, 0);

    const activeOfferSalary = getActiveOfferSalaryForTeam(teamName);
    const hardCap = getHardCapForTeam(teamName);

    // Live offers are not completed contracts. Show them separately, but do not
    // subtract them from practical cap room until the user accepts a signing.
    const practicalPayroll = payroll + capHoldTotal;
    const hardCapRoom = hardCap === null ? null : hardCap - practicalPayroll;
    const exceptionUsage = getRecordedExceptionUsageForTeam(teamName);

    const roomException = Math.max(0, getRoomExceptionAmount() - exceptionUsage.roomException);
    const nonTaxpayerMLE = Math.max(0, getNonTaxpayerMleAmount() - exceptionUsage.nonTaxpayerMLE);
    const taxpayerMLE = Math.max(0, getTaxpayerMleAmount() - exceptionUsage.taxpayerMLE);

    return {
      teamName,
      seasonYear,
      salaryCap,
      luxuryTaxLine: getLuxuryTaxLineAmount(),
      firstApron: getFirstApronAmount(),
      secondApron: getSecondApronAmount(),
      roomException,
      nonTaxpayerMLE,
      taxpayerMLE,
      exceptionUsage,
      payroll,
      capHoldTotal,
      activeOfferSalary,
      capRoom: salaryCap - payroll,
      practicalPayroll,
      practicalCapRoom: salaryCap - practicalPayroll,
      hardCap,
      hardCapRoom,
      rosterCount: userRosterCount,
      rosterLimit: maxRosterSize,
      rosterSpots: Math.max(0, maxRosterSize - userRosterCount),
      payrollZone: getPayrollZone(practicalPayroll),
    };
  }, [
    workingLeagueData,
    liveFreeAgencyState,
    selectedTeam?.name,
    currentUserTeam,
    freeAgents,
    currentSeasonYear,
    isOffseasonMode,
    userRosterCount,
    maxRosterSize,
  ]);

  const getBestExceptionLabel = (dashboard) => {
    if (!dashboard) return "-";

    if (dashboard.payrollZone === "second_apron") return "Min Only";
    if (dashboard.payrollZone === "first_apron" || dashboard.payrollZone === "tax") {
      return `Tax MLE ${formatDollars(dashboard.taxpayerMLE)}`;
    }
    if (dashboard.practicalCapRoom > 0) {
      return `Room ${formatDollars(dashboard.roomException)}`;
    }
    return `MLE ${formatDollars(dashboard.nonTaxpayerMLE)}`;
  };

  const getExpectedYearOneSalary = (player) => {
    return Number(
      player?.marketValue?.expectedYear1Salary ||
      player?.marketValue?.expectedAAV ||
      player?.marketValue?.minAcceptableAAV ||
      MIN_CONTRACT_AMOUNT
    );
  };

  const formatExpectedSalaryShort = (player) => {
    const amount = getExpectedYearOneSalary(player);
    if (!amount) return "-";

    const millions = amount / 1_000_000;
    return millions.toFixed(1).replace(/\.0$/, "");
  };

  const buildAffordabilityForPlayer = (player) => {
    if (!player || !userCapDashboard || !selectedTeam?.name) {
      return {
        label: "-",
        tone: "neutral",
        sortValue: 0,
        title: "No selected team.",
      };
    }

    const rights = getRights(player);
    const isRfa = Boolean(rights?.restrictedFreeAgent || player?.qualifyingOffer?.amount);
    const ownRights =
      rights?.heldByTeam === selectedTeam.name &&
      rights?.birdLevel &&
      rights.birdLevel !== "none";

    const ask = getExpectedYearOneSalary(player);
    const projectedPayroll = Number(userCapDashboard.practicalPayroll || 0) + ask;

    if (!isLiveFreeAgencyActive && userCapDashboard.rosterCount >= userCapDashboard.rosterLimit) {
      return {
        label: "NO",
        tone: "red",
        sortValue: 0,
        title: "Your roster is full.",
      };
    }

    if (
      userCapDashboard.hardCapRoom !== null &&
      ask > Number(userCapDashboard.hardCapRoom || 0)
    ) {
      return {
        label: "NO",
        tone: "red",
        sortValue: 0,
        title: "Expected first-year salary does not fit under your hard cap room.",
      };
    }

    if (ownRights) {
      if (rights.birdLevel === "bird") {
        return {
          label: isRfa ? "RFA/BIRD" : "BIRD",
          tone: "orange",
          sortValue: 95,
          title: isRfa
            ? "You hold Bird rights and RFA match rights. You can exceed the cap, subject to any hard cap."
            : "You hold Bird rights and can exceed the cap to re-sign him, subject to any hard cap.",
        };
      }

      if (rights.birdLevel === "early_bird") {
        return {
          label: "EARLY",
          tone: "orange",
          sortValue: 84,
          title: "You hold Early Bird rights. This is generally re-signable up to the Early Bird limit.",
        };
      }

      if (rights.birdLevel === "non_bird") {
        return {
          label: "NON-BIRD",
          tone: "orange",
          sortValue: 76,
          title: "You hold Non-Bird rights. This is signable only within the Non-Bird raise limit unless another tool is available.",
        };
      }
    }

    if (userCapDashboard.practicalCapRoom >= ask) {
      return {
        label: isRfa ? "YES/RFA" : "YES",
        tone: "green",
        sortValue: isRfa ? 68 : 72,
        title: isRfa
          ? "Fits using practical cap room, but the original team may still match the offer sheet."
          : "Fits using practical cap room after holds and active offers.",
      };
    }

    if (ask <= MIN_CONTRACT_AMOUNT) {
      return {
        label: "MIN",
        tone: "neutral",
        sortValue: 46,
        title: isRfa
          ? "Minimum offer should fit, but the original team may still match because he is RFA."
          : "Minimum contract should be available.",
      };
    }

    const zone = userCapDashboard.payrollZone;

    if (zone === "second_apron") {
      return {
        label: "MIN",
        tone: "neutral",
        sortValue: 35,
        title: "Second-apron team: outside free agents are minimum-only in this model.",
      };
    }

    if (zone === "first_apron" || zone === "tax") {
      if (ask <= userCapDashboard.taxpayerMLE) {
        return {
          label: isRfa ? "TAX/RFA" : "TAX MLE",
          tone: "orange",
          sortValue: isRfa ? 58 : 62,
          title: isRfa
            ? "Fits the taxpayer MLE range, but the original team may still match the offer sheet."
            : "Fits the remaining taxpayer MLE range.",
        };
      }

      return {
        label: "NO",
        tone: "red",
        sortValue: 0,
        title: "Does not fit cap room, minimum, or remaining taxpayer MLE.",
      };
    }

    if (userCapDashboard.practicalCapRoom > 0 && ask <= userCapDashboard.roomException) {
      return {
        label: isRfa ? "ROOM/RFA" : "ROOM",
        tone: "orange",
        sortValue: isRfa ? 56 : 59,
        title: isRfa
          ? "Could fit through room-exception style spending, but the original team may still match."
          : "Could fit through remaining room-exception style spending.",
      };
    }

    if (
      ask <= userCapDashboard.nonTaxpayerMLE &&
      projectedPayroll <= userCapDashboard.firstApron
    ) {
      return {
        label: isRfa ? "MLE/RFA" : "MLE",
        tone: "orange",
        sortValue: isRfa ? 54 : 57,
        title: isRfa
          ? "Fits the remaining non-taxpayer MLE range, but the original team may still match."
          : "Fits the remaining non-taxpayer MLE range and stays under the first-apron style limit.",
      };
    }

    if (ask <= userCapDashboard.taxpayerMLE) {
      return {
        label: isRfa ? "TAX/RFA" : "TAX MLE",
        tone: "orange",
        sortValue: isRfa ? 50 : 53,
        title: isRfa
          ? "Fits the remaining taxpayer MLE range, but the original team may still match."
          : "Fits the remaining taxpayer MLE range.",
      };
    }

    return {
      label: "NO",
      tone: "red",
      sortValue: 0,
      title: "Expected first-year salary is above your cap, exception, minimum, or hard-cap path.",
    };
  };

  const affordabilityByPlayerKey = useMemo(() => {
    const out = {};

    for (const player of freeAgents) {
      out[getPlayerKey(player)] = buildAffordabilityForPlayer(player);
    }

    return out;
  }, [
    freeAgents,
    userCapDashboard,
    selectedTeam?.name,
    userRosterCount,
    maxRosterSize,
  ]);

  const getAffordableChipClass = (tone) => {
    if (tone === "green") {
      return "bg-emerald-500/15 border-emerald-500/30 text-emerald-200";
    }
    if (tone === "orange") {
      return "bg-orange-500/15 border-orange-500/30 text-orange-200";
    }
    if (tone === "red") {
      return "bg-red-500/15 border-red-500/30 text-red-200";
    }
    return "bg-neutral-800 border-neutral-700 text-neutral-300";
  };

  useEffect(() => {
    if (!selectedTeam && typeof setSelectedTeam === "function") {
      const saved = localStorage.getItem("selectedTeam");
      if (saved) {
        try {
          setSelectedTeam(JSON.parse(saved));
        } catch (err) {
          console.error("Failed to restore selectedTeam", err);
        }
      }
    }
  }, [selectedTeam, setSelectedTeam]);

  useEffect(() => {
    if (selectedTeam) {
      localStorage.setItem("selectedTeam", JSON.stringify(selectedTeam));
    }
  }, [selectedTeam]);

  useEffect(() => {
    if (!workingLeagueData || !freeAgents.length) return;

    const needsMarket = freeAgents.some((p) => !p?.marketValue);
    if (!needsMarket) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await generateFreeAgencyMarket?.(workingLeagueData);
        if (cancelled) return;
        if (!res?.ok || !res?.leagueData) return;
        applyLeagueUpdate(res.leagueData);
      } catch (err) {
        console.error("Failed to generate free agency market", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workingLeagueData, freeAgents, generateFreeAgencyMarket]);

  useEffect(() => {
    if (!freeAgents.length) {
      setSelectedPlayer(null);
      setPlayerCardPlayer(null);
      return;
    }

    if (!selectedPlayer || !freeAgents.some((p) => p.name === selectedPlayer.name)) {
      setSelectedPlayer(freeAgents[0]);
    }
  }, [freeAgents, selectedPlayer]);

  useEffect(() => {
    if (!userRosterInvalid) {
      setRosterActionError("");
    }
  }, [userRosterInvalid]);

  useEffect(() => {
    if (!isOffseasonMode) return;
    if (!optionsComplete) return;
    if (freeAgencyFinished) return;
    if (isLiveFreeAgencyActive) return;
    if (freeAgents.length > 0) return;

    updateOffseasonState({
      active: true,
      optionsComplete: true,
      freeAgencyComplete: true,
    });

    setDaySummary((prev) => {
      if (prev) return prev;
      return {
        dayResolved: 0,
        signings: [],
        generatedOffers: [],
        stateSummary: {
          isActive: false,
          currentDay: 0,
          maxDays: 0,
          freeAgentCount: 0,
        },
      };
    });
  }, [
    isOffseasonMode,
    optionsComplete,
    freeAgencyFinished,
    isLiveFreeAgencyActive,
    freeAgents.length,
  ]);

  const positionOrder = ["PG", "SG", "SF", "PF", "C"];

  const handleSort = (key) => {
    let direction = "desc";
    if (sortConfig.key === key && sortConfig.direction === "desc") direction = "asc";
    else if (sortConfig.key === key && sortConfig.direction === "asc") direction = "default";
    setSortConfig({ key, direction });
  };

  const sortedPlayers = useMemo(() => {
    if (!sortConfig.key || sortConfig.direction === "default") return freeAgents;

    const rows = [...freeAgents];

    rows.sort((a, b) => {
      const key = sortConfig.key;

      if (key === "pos") {
        const aIdx = positionOrder.indexOf(a.pos);
        const bIdx = positionOrder.indexOf(b.pos);
        const diff = (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
        return sortConfig.direction === "asc" ? diff : -diff;
      }

      if (key === "rfa") {
        const av = isRestrictedFreeAgent(a) ? 1 : 0;
        const bv = isRestrictedFreeAgent(b) ? 1 : 0;
        return sortConfig.direction === "asc" ? av - bv : bv - av;
      }

      if (key === "affordable") {
        const av = affordabilityByPlayerKey[getPlayerKey(a)]?.sortValue || 0;
        const bv = affordabilityByPlayerKey[getPlayerKey(b)]?.sortValue || 0;
        return sortConfig.direction === "asc" ? av - bv : bv - av;
      }

      if (key === "expectedSalary") {
        const av = getExpectedYearOneSalary(a);
        const bv = getExpectedYearOneSalary(b);
        return sortConfig.direction === "asc" ? av - bv : bv - av;
      }

      if (key === "name") {
        return sortConfig.direction === "asc"
          ? a.name.localeCompare(b.name)
          : -a.name.localeCompare(b.name);
      }

      if (["age", "overall", "stamina", "potential", "offRating", "defRating"].includes(key)) {
        return sortConfig.direction === "asc" ? a[key] - b[key] : b[key] - a[key];
      }

      if (key.startsWith("attr")) {
        const idx = parseInt(key.replace("attr", ""), 10);
        const av = a.attrs?.[idx] ?? 0;
        const bv = b.attrs?.[idx] ?? 0;
        return sortConfig.direction === "asc" ? av - bv : bv - av;
      }

      return 0;
    });

    return rows;
  }, [freeAgents, sortConfig, affordabilityByPlayerKey]);

  const getOfferSalaryByYear = (year1Salary, years) => {
    const out = [];
    for (let i = 0; i < years; i++) {
      const salary = year1Salary * ((1 + 0.05) ** i);
      out.push(Math.round(salary / 1000) * 1000);
    }
    return out;
  };

  const buildOfferContract = (year1Salary, years, currentOptionType) => {
    const startYear = getCurrentSeasonYear() + (isOffseasonMode ? 1 : 0);
    const salaryByYear = getOfferSalaryByYear(year1Salary, years);
    const finalOptionIndex = Math.max(0, Number(years || 1) - 1);

    return {
      startYear,
      salaryByYear,
      option:
        currentOptionType === "none" || Number(years || 1) <= 1
          ? null
          : {
              type: currentOptionType,
              yearIndex: finalOptionIndex,
              yearIndices: [finalOptionIndex],
              picked: null,
            },
    };
  };

  const openSignModal = (player) => {
    const defaultYear1Salary =
      player?.marketValue?.expectedYear1Salary || 5_000_000;
    const defaultYears =
      player?.marketValue?.expectedYears || 2;

    setSelectedPlayer(player);
    setSignTargetPlayer(player);
    setOfferSalaryText(formatMillionsInput(defaultYear1Salary));
    setOfferYears(defaultYears);
    setOptionType("none");
    setOfferEvaluation(null);
    setOfferEvalLoading(false);
    setSignError("");
    setSignModalOpen(true);
  };

  const closeSignModal = () => {
    setSignModalOpen(false);
    setSignTargetPlayer(null);
    setOfferEvaluation(null);
    setOfferEvalLoading(false);
    setSignError("");
  };

  useEffect(() => {
    if (offerYears <= 1 && optionType !== "none") {
      setOptionType("none");
    }
  }, [offerYears, optionType]);

  const openOffersModal = async (player, baseLeagueData = workingLeagueData, forcedOffersView = null) => {
    if (!player) return;

    setSelectedPlayer(player);
    setOffersViewLoading(true);
    setOffersViewError("");
    setOffersViewData(null);
    setOffersModalOpen(true);

    if (forcedOffersView?.ok) {
      setOffersViewData(forcedOffersView);
      setOffersViewLoading(false);
      return;
    }

    try {
      if (typeof getFreeAgentOffers === "function") {
        const res = await getFreeAgentOffers(
          baseLeagueData,
          player.id || null,
          player.name || null
        );

        if (!res?.ok) {
          setOffersViewError(res?.reason || "Failed to load offers.");
        } else {
          setOffersViewData(res);
        }
      } else {
        const localView = buildLocalOffersView(player);
        setOffersViewData(localView);
      }
    } catch (err) {
      const localView = buildLocalOffersView(player);
      if (localView) {
        setOffersViewData(localView);
      } else {
        setOffersViewError(err?.message || "Failed to load offers.");
      }
    } finally {
      setOffersViewLoading(false);
    }
  };

  const closeOffersModal = () => {
    setOffersModalOpen(false);
    setOffersViewLoading(false);
    setOffersViewError("");
    setOffersViewData(null);
  };

  useEffect(() => {
    if (!signModalOpen || !signTargetPlayer || !selectedTeam || !workingLeagueData) {
      setOfferEvaluation(null);
      setOfferEvalLoading(false);
      return;
    }

    const year1Salary = parseMillionsText(offerSalaryText);
    if (!year1Salary) {
      setOfferEvaluation({
        ok: false,
        reason: "Enter a valid first-year salary.",
      });
      setOfferEvalLoading(false);
      return;
    }

    const offer = buildOfferContract(year1Salary, offerYears, optionType);

    let cancelled = false;
    setOfferEvalLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await evaluateFreeAgencyOffer?.(
          workingLeagueData,
          selectedTeam.name,
          signTargetPlayer,
          offer
        );

        if (cancelled) return;
        setOfferEvaluation(res || null);
      } catch (err) {
        if (cancelled) return;
        setOfferEvaluation({
          ok: false,
          reason: err?.message || "Offer evaluation failed.",
        });
      } finally {
        if (!cancelled) setOfferEvalLoading(false);
      }
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    signModalOpen,
    signTargetPlayer,
    selectedTeam,
    workingLeagueData,
    offerSalaryText,
    offerYears,
    optionType,
    evaluateFreeAgencyOffer,
  ]);

  const interestDisplay = useMemo(() => {
    if (offerEvalLoading) {
      return {
        percent: 55,
        label: "Evaluating...",
        barClass: "bg-gray-400",
      };
    }

    if (!offerEvaluation || !offerEvaluation.ok) {
      return {
        percent: 0,
        label: "Unavailable",
        barClass: "bg-red-500",
      };
    }

    const score = Number(offerEvaluation?.details?.acceptanceScore ?? 0);
    const percent = clamp(((score - 0.65) / 0.45) * 100, 0, 100);

    if (percent >= 85) {
      return { percent, label: "Ready to Sign", barClass: "bg-green-500" };
    }
    if (percent >= 65) {
      return { percent, label: "Very Interested", barClass: "bg-green-500" };
    }
    if (percent >= 40) {
      return { percent, label: "Interested", barClass: "bg-lime-500" };
    }
    if (percent >= 20) {
      return { percent, label: "Low Interest", barClass: "bg-yellow-500" };
    }
    return { percent, label: "Not Interested", barClass: "bg-red-500" };
  }, [offerEvaluation, offerEvalLoading]);

const handleContinueToProgression = () => {
  if (userRosterInvalid) {
    setRosterActionError(rosterValidationMessage);
    return;
  }

  try {
    const result = rebuildGameplansForLeague(workingLeagueData, {
      skipUserTeamName: selectedTeam?.name || null,
    });
    console.log("[FreeAgents] rebuilt CPU gameplans before progression:", result);
  } catch (err) {
    console.error("[FreeAgents] failed to rebuild CPU gameplans", err);
  }

  navigate("/player-progression");
};

  const handleInitializeFreeAgency = async () => {
    if (!workingLeagueData) return;

    if (isOffseasonMode && (!optionsComplete || !rightsManagementComplete)) {
      setDaySummary({
        error: !optionsComplete
          ? "Complete the Player / Team Options stage before starting free agency."
          : "Finalize Rights Management before starting free agency.",
      });
      return;
    }

    if (typeof initializeFreeAgencyPeriod !== "function") {
      setDaySummary({
        error: "Free agency preseason wiring is not fully connected in simEnginePy.js yet.",
      });
      return;
    }

    try {
      setMarketInitLoading(true);
      setDaySummary(null);

      if (!(workingLeagueData?.freeAgents || []).length) {
        updateOffseasonState({
          active: true,
          optionsComplete: true,
          freeAgencyComplete: true,
        });

        setDaySummary({
          dayResolved: 0,
          signings: [],
          generatedOffers: [],
          stateSummary: {
            isActive: false,
            currentDay: 0,
            maxDays: 0,
            freeAgentCount: 0,
          },
        });
        return;
      }

      const res = await initializeFreeAgencyPeriod(
        workingLeagueData,
        selectedTeam?.name || null,
        7
      );

      if (!res?.ok || !res?.leagueData) {
        setDaySummary({
          error: res?.reason || "Failed to start free agency.",
        });
        return;
      }

      const latestResults = {
        dayResolved: 0,
        signings: res?.cleanupSignings || [],
        generatedOffers: res?.openingOffers || [],
        stateSummary: res?.stateSummary || null,
      };

      applyLeagueUpdateWithLatestResults(res.leagueData, latestResults);

      updateOffseasonState({
        active: true,
        optionsComplete: true,
        freeAgencyComplete: false,
      });

      setDaySummary(latestResults);
    } catch (err) {
      setDaySummary({
        error: err?.message || "Failed to start free agency.",
      });
    } finally {
      setMarketInitLoading(false);
    }
  };

  const handleAdvanceDay = async () => {
    if (!workingLeagueData) return;

    if (typeof advanceFreeAgencyDay !== "function") {
      setDaySummary({
        error: "Advance day is not wired in simEnginePy.js yet.",
      });
      return;
    }

    try {
      setAdvanceDayLoading(true);
      const res = await advanceFreeAgencyDay(
        workingLeagueData,
        selectedTeam?.name || null
      );

      if (!res?.ok || !res?.leagueData) {
        setDaySummary({
          error: res?.reason || "Failed to advance free agency day.",
        });
        return;
      }

      const latestResults = {
        dayResolved: res?.dayResolved ?? null,
        signings: res?.signings || [],
        generatedOffers: res?.generatedOffers || [],
        stateSummary: res?.stateSummary || null,
      };

      applyLeagueUpdateWithLatestResults(res.leagueData, latestResults);

      if (!res?.stateSummary?.isActive) {
        updateOffseasonState({
          active: true,
          optionsComplete: true,
          freeAgencyComplete: true,
        });
      }

      setDaySummary(latestResults);

      closeSignModal();
      closeOffersModal();
      navigate("/viewing-offers");
    } catch (err) {
      setDaySummary({
        error: err?.message || "Failed to advance free agency day.",
      });
    } finally {
      setAdvanceDayLoading(false);
    }
  };

  const handleSubmitOrSignPlayer = async () => {
    if (!signTargetPlayer || !selectedTeam || !workingLeagueData) return;

    setSignError("");
    setRosterActionError("");

    const year1Salary = parseMillionsText(offerSalaryText);
    if (!year1Salary) {
      setSignError("Enter a valid first-year salary.");
      return;
    }

    const offer = buildOfferContract(year1Salary, offerYears, optionType);

    try {
      if (isOffseasonMode) {
        if (canSubmitLiveOffer) {
          if (typeof submitUserFreeAgentOffer !== "function") {
            setSignError("Live offer submission is not wired in simEnginePy.js yet.");
            return;
          }

          const res = await submitUserFreeAgentOffer(
            workingLeagueData,
            selectedTeam.name,
            signTargetPlayer.id || null,
            signTargetPlayer.name || null,
            offer
          );

          if (!res?.ok || !res?.leagueData) {
            setSignError(res?.reason || "Offer submission failed.");
            return;
          }

          applyLeagueUpdate(res.leagueData);
          closeSignModal();

          // Show the updated live ranking immediately using the fresh backend
          // response, so the user's new/replaced offer appears right away.
          await openOffersModal(
            signTargetPlayer,
            res.leagueData,
            res.offersView || null
          );

          return;
        }

        if (canManualCleanupSign) {
          const res = await signFreeAgent(
            workingLeagueData,
            selectedTeam.name,
            signTargetPlayer.id || null,
            signTargetPlayer.name || null,
            offer
          );

          if (!res?.ok || !res?.leagueData) {
            setSignError(res?.reason || "Signing failed.");
            return;
          }

          applyLeagueUpdate(res.leagueData);
          closeSignModal();

          if (offersModalOpen) {
            closeOffersModal();
          }

          return;
        }

        if (userRosterTooMany) {
          setSignError(
            `${selectedTeam.name} has ${userRosterCount} players. You must get down to ${maxRosterSize} before leaving free agency.`
          );
          return;
        }

        setSignError("The live market is closed.");
        return;
      }

      const res = await signFreeAgent(
        workingLeagueData,
        selectedTeam.name,
        signTargetPlayer.id || null,
        signTargetPlayer.name || null,
        offer
      );

      if (!res?.ok || !res?.leagueData) {
        setSignError(res?.reason || "Signing failed.");
        return;
      }

      applyLeagueUpdate(res.leagueData);
      closeSignModal();
    } catch (err) {
      setSignError(err?.message || (isOffseasonMode ? "Offer submission failed." : "Signing failed."));
    }
  };

  const optionsLockedView = (
    <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-900 text-white px-4">
      <p className="text-lg mb-4 text-center">
        Complete Player / Team Options and Rights Management before opening free agency.
      </p>

      <div className="flex gap-3 flex-wrap justify-center">
        <button
          onClick={() => navigate("/player-team-options")}
          className="px-6 py-3 bg-green-600 hover:bg-green-500 rounded-lg font-semibold transition"
        >
          Go to Options / Rights
        </button>

        <button
          onClick={() => navigate("/offseason")}
          className="px-6 py-3 bg-neutral-700 hover:bg-neutral-600 rounded-lg font-semibold transition"
        >
          Back to Offseason Hub
        </button>

        <button
          onClick={() => navigate("/team-hub")}
          className="px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
        >
          Back to Team Hub
        </button>
      </div>
    </div>
  );

  const noFreeAgentsView = (
    <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-900 text-white px-4">
      <p className="text-lg mb-4">
        {effectiveFreeAgencyFinished
          ? "Free agency is complete."
          : "No free agents available."}
      </p>

      {rosterValidationMessage && (
        <div className="mb-4 max-w-2xl w-full bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-200 text-sm font-semibold text-center">
          {rosterValidationMessage}
        </div>
      )}

      {rosterActionError && rosterActionError !== rosterValidationMessage && (
        <div className="mb-4 text-red-300 text-sm font-semibold">
          {rosterActionError}
        </div>
      )}

      <div className="flex gap-3 flex-wrap justify-center">
        {isOffseasonMode && effectiveFreeAgencyFinished && (
          <button
            onClick={handleContinueToProgression}
            className="px-6 py-3 bg-green-600 hover:bg-green-500 rounded-lg font-semibold transition"
          >
            Continue to Progression
          </button>
        )}
        {isOffseasonMode && (
          <button
            onClick={() => navigate("/offseason")}
            className="px-6 py-3 bg-neutral-700 hover:bg-neutral-600 rounded-lg font-semibold transition"
          >
            Back to Offseason Hub
          </button>
        )}
        <button
          onClick={() => navigate("/team-hub")}
          className="px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
        >
          Back to Team Hub
        </button>
      </div>
    </div>
  );

  if (isOffseasonMode && (!optionsComplete || !rightsManagementComplete) && !isLiveFreeAgencyActive && !freeAgencyFinished) {
    return optionsLockedView;
  }

  if (!freeAgents.length && (!isOffseasonMode || optionsComplete || effectiveFreeAgencyFinished)) {
    return noFreeAgentsView;
  }

  const player = selectedPlayer || freeAgents[0] || {};
  const fillPercent = Math.min((player.overall || 0) / 99, 1);
  const circleCircumference = 2 * Math.PI * 50;
  const strokeOffset = circleCircumference * (1 - fillPercent);

  return (
    <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center py-10">
      <style>{`
        .fa-modal-scroll {
          scrollbar-width: thin;
          scrollbar-color: #ea580c #171717;
        }

        .fa-modal-scroll::-webkit-scrollbar {
          width: 10px;
        }

        .fa-modal-scroll::-webkit-scrollbar-track {
          background: #171717;
          border-radius: 9999px;
        }

        .fa-modal-scroll::-webkit-scrollbar-thumb {
          background: linear-gradient(to bottom, #f97316, #c2410c);
          border-radius: 9999px;
          border: 2px solid #171717;
        }

        .fa-modal-scroll::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(to bottom, #fb923c, #ea580c);
        }
      `}</style>

      <div className="w-full max-w-5xl flex items-center justify-center mb-4 select-none">
        <h1 className="text-4xl font-extrabold text-orange-500 text-center">
          {isOffseasonMode ? "Free Agency - Live Market" : "Free Agents"}
        </h1>
      </div>

      {isOffseasonMode && (
        <div className="w-full max-w-5xl bg-neutral-800 border border-neutral-700 rounded-2xl shadow-lg px-5 py-4 mb-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <p className="text-sm text-gray-400">
                Mode: Offseason Free Agency
              </p>
              <p className="text-lg font-semibold text-white mt-1">
                {effectiveFreeAgencyFinished
                  ? userRosterInvalid
                    ? "Roster action required"
                    : "Free agency complete"
                  : isLiveFreeAgencyActive
                  ? `Day ${currentDay} of ${maxDays || 7}`
                  : "Live market ready to start"}
              </p>
              {isOffseasonMode && optionsComplete && !rightsManagementComplete && (
                <p className="text-sm text-orange-300 mt-2">Finalize Rights Management before starting the market.</p>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full lg:w-auto">
              <div className="bg-neutral-900 rounded-xl border border-neutral-700 px-4 py-3">
                <div className="text-xs text-gray-400 mb-1">Free Agents</div>
                <div className="text-base font-semibold text-white">{freeAgents.length}</div>
              </div>
              <div className="bg-neutral-900 rounded-xl border border-neutral-700 px-4 py-3">
                <div className="text-xs text-gray-400 mb-1">Active Offers</div>
                <div className="text-base font-semibold text-white">{activeOfferCount}</div>
              </div>
              <div className="bg-neutral-900 rounded-xl border border-neutral-700 px-4 py-3">
                <div className="text-xs text-gray-400 mb-1">Signed</div>
                <div className="text-base font-semibold text-white">{signedPlayersLog.length}</div>
              </div>
              <div className="bg-neutral-900 rounded-xl border border-neutral-700 px-4 py-3">
                <div className="text-xs text-gray-400 mb-1">Your Team</div>
                <div className="text-base font-semibold text-white">
                  {selectedTeam?.name || "-"}
                </div>
              </div>
            </div>
          </div>

          {userCapDashboard && (
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mt-4">
              <div className="bg-neutral-900 rounded-xl border border-neutral-700 px-4 py-3">
                <div className="text-xs text-gray-400 mb-1">Payroll</div>
                <div className="text-base font-semibold text-white">
                  {formatDollars(userCapDashboard.payroll)}
                </div>
              </div>

              <div className="bg-neutral-900 rounded-xl border border-neutral-700 px-4 py-3">
                <div className="text-xs text-gray-400 mb-1">Cap Holds</div>
                <div className="text-base font-semibold text-orange-200">
                  {formatDollars(userCapDashboard.capHoldTotal)}
                </div>
              </div>

              <div className="bg-neutral-900 rounded-xl border border-neutral-700 px-4 py-3">
                <div className="text-xs text-gray-400 mb-1">Cap Space</div>
                <div className={`text-base font-semibold ${userCapDashboard.capRoom < 0 ? "text-red-300" : "text-emerald-300"}`}>
                  {formatDollars(userCapDashboard.capRoom)}
                </div>
              </div>

              <div className="bg-neutral-900 rounded-xl border border-neutral-700 px-4 py-3">
                <div className="text-xs text-gray-400 mb-1">Practical Cap</div>
                <div className={`text-base font-semibold ${userCapDashboard.practicalCapRoom < 0 ? "text-red-300" : "text-emerald-300"}`}>
                  {formatDollars(userCapDashboard.practicalCapRoom)}
                </div>
                <div className="text-[11px] text-gray-500 mt-1">holds + offers</div>
              </div>

              <div className="bg-neutral-900 rounded-xl border border-neutral-700 px-4 py-3">
                <div className="text-xs text-gray-400 mb-1">Hard Cap Room</div>
                <div className={`text-base font-semibold ${userCapDashboard.hardCapRoom !== null && userCapDashboard.hardCapRoom < 0 ? "text-red-300" : "text-white"}`}>
                  {userCapDashboard.hardCapRoom === null ? "None" : formatDollars(userCapDashboard.hardCapRoom)}
                </div>
              </div>

              <div className="bg-neutral-900 rounded-xl border border-neutral-700 px-4 py-3">
                <div className="text-xs text-gray-400 mb-1">Best Exception</div>
                <div className="text-base font-semibold text-orange-200">
                  {getBestExceptionLabel(userCapDashboard)}
                </div>
              </div>

              <div className="bg-neutral-900 rounded-xl border border-neutral-700 px-4 py-3">
                <div className="text-xs text-gray-400 mb-1">Offer Commit</div>
                <div className="text-base font-semibold text-orange-200">
                  {formatDollars(userCapDashboard.activeOfferSalary)}
                </div>
              </div>

              <div className="bg-neutral-900 rounded-xl border border-neutral-700 px-4 py-3">
                <div className="text-xs text-gray-400 mb-1">Roster</div>
                <div className={`text-base font-semibold ${userCapDashboard.rosterCount > userCapDashboard.rosterLimit ? "text-red-300" : "text-white"}`}>
                  {userCapDashboard.rosterCount} / {userCapDashboard.rosterLimit}
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-3 mt-4">
            {effectiveFreeAgencyFinished ? (
              <button
                onClick={handleContinueToProgression}
                className="px-5 py-2 bg-green-600 hover:bg-green-500 rounded-lg font-semibold transition"
              >
                Continue to Progression
              </button>
            ) : !isLiveFreeAgencyActive ? (
              <button
                onClick={handleInitializeFreeAgency}
                disabled={marketInitLoading}
                className="px-5 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold transition"
              >
                {marketInitLoading ? "Starting..." : "Start Live Market"}
              </button>
            ) : (
              <button
                onClick={handleAdvanceDay}
                disabled={advanceDayLoading}
                className="px-5 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold transition"
              >
                {advanceDayLoading ? "Advancing..." : "Advance Day"}
              </button>
            )}

            <button
              onClick={() => navigate("/offseason")}
              className="px-5 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg font-semibold transition"
            >
              Back to Offseason Hub
            </button>
          </div>

          {rosterValidationMessage && (
            <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
              <div className="text-sm font-semibold text-red-200">
                {rosterValidationMessage}
              </div>

              {effectiveFreeAgencyFinished && userRosterTooFew && (
                <div className="text-xs text-red-300 mt-1">
                  The live market is over, but you can still sign remaining free agents directly on this page until you reach {minRosterSize} players.
                </div>
              )}
            </div>
          )}

          {rosterActionError && rosterActionError !== rosterValidationMessage && (
            <div className="mt-4 text-red-300 text-sm font-semibold">
              {rosterActionError}
            </div>
          )}

          {daySummary?.error && (
            <div className="mt-4 text-red-300 text-sm font-semibold">
              {daySummary.error}
            </div>
          )}

          {!daySummary?.error && daySummary && (
            <div className="mt-4 bg-neutral-900 rounded-xl border border-neutral-700 px-4 py-3">
              <div className="text-sm font-semibold text-orange-300 mb-2">
                Latest Market Update
              </div>
              <div className="text-sm text-gray-300 space-y-1">
                {daySummary?.prepSummary && (
                  <>
                    <div>
                      Entered free agency after cleanup: {daySummary.prepSummary.enteredFreeAgencyCount || 0}
                    </div>
                    <div>
                      Team options declined: {daySummary.prepSummary.teamOptionDeclinedCount || 0}
                    </div>
                  </>
                )}
                {daySummary?.dayResolved ? (
                  <div>Resolved Day {daySummary.dayResolved}</div>
                ) : (
                  <div>Opening market initialized.</div>
                )}
                <div>New CPU offers: {daySummary?.generatedOffers?.length || 0}</div>
                <div>Signings today: {daySummary?.signings?.length || 0}</div>
                {effectiveFreeAgencyFinished && (
                  <div className="text-green-300 font-semibold pt-1">
                    Free agency is complete.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="w-full flex justify-center px-4">
        <div className="relative bg-neutral-800/95 backdrop-blur-md border border-neutral-700 w-full max-w-5xl px-8 pt-8 pb-3 rounded-t-xl shadow-2xl">
          <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-white opacity-60"></div>

          <div className="flex items-end justify-between relative">
            <div className="flex items-end gap-6">
              <div className="relative -mb-[9px]">
                {player?.headshot ? (
                  <img
                    src={player.headshot}
                    alt={player.name}
                    className="h-[175px] w-auto object-contain"
                  />
                ) : (
                  <div className="h-[175px] w-[130px] bg-neutral-700 rounded flex items-center justify-center text-neutral-300">
                    No Image
                  </div>
                )}
              </div>

              <div className="flex flex-col justify-end mb-3">
                <h2 className="text-[44px] font-bold leading-tight">
                  {player?.name || "-"}
                </h2>
                <p className="text-gray-400 text-[24px] mt-1">
                  {player?.pos || "-"}
                  {player?.secondaryPos ? ` / ${player.secondaryPos}` : ""} • Age{" "}
                  {player?.age ?? "-"}
                </p>
                <p className="text-gray-500 text-[18px] mt-1">Unsigned Free Agent</p>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    onClick={() => openSignModal(player)}
                    disabled={
                      !selectedTeam ||
                      !player?.name ||
                      (isOffseasonMode && !canUseFreeAgencyAction)
                    }
                    className="px-5 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold transition"
                  >
                    {isOffseasonMode
                      ? canSubmitLiveOffer
                        ? "Submit Offer"
                        : canManualCleanupSign
                        ? "Sign Player"
                        : "Submit Offer"
                      : "Offer Contract"}
                  </button>

                  {isOffseasonMode && (
                    <button
                      onClick={() => openOffersModal(player)}
                      disabled={!isLiveFreeAgencyActive || !player?.name}
                      className="px-5 py-2 bg-neutral-700 hover:bg-neutral-600 disabled:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed rounded-lg font-semibold transition"
                    >
                      View Offers
                    </button>
                  )}

                  <button
                    onClick={() => setPlayerCardPlayer(player)}
                    disabled={!player?.name}
                    className="px-5 py-2 bg-white/[0.06] hover:bg-orange-500/15 border border-white/10 hover:border-orange-400/40 rounded-lg font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Player Card
                  </button>
                </div>
              </div>
            </div>

            <div className="relative flex flex-col items-center justify-center mr-4 mb-2">
              <svg width="110" height="110" viewBox="0 0 120 120">
                <defs>
                  <linearGradient id="ovrGradientFA" x1="0%" y1="0%" x2="100%" y2="0%">
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
                  stroke="url(#ovrGradientFA)"
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
                  {player?.overall ?? "-"}
                </p>
                <p className="text-[10px] text-gray-400 mt-[-2px]">
                  POT <span className="text-orange-400 font-semibold">{player?.potential ?? "-"}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

<div className="w-full flex justify-center transition-opacity duration-300 ease-in-out mt-[-1px] px-4">
  <div className="w-full max-w-5xl max-h-[62vh] overflow-auto rounded-b-xl border border-neutral-700 border-t-0 bg-neutral-900 no-scrollbar">
    <div className="min-w-[1420px] w-max">
            <table className="w-full border-collapse text-center">
              <thead className="sticky top-0 z-20 bg-neutral-800 text-gray-300 text-[16px] font-semibold">
                <tr>
                  {[{ key: "name", label: "Name" },
                    { key: "pos", label: "POS" },
                    { key: "rfa", label: "RFA" },
                    { key: "affordable", label: "AFFORD" },
                    { key: "expectedSalary", label: "EXP" },
                    { key: "age", label: "AGE" },
                    { key: "overall", label: "OVR" },
                    { key: "offRating", label: "OFF" },
                    { key: "defRating", label: "DEF" },
                    { key: "stamina", label: "STAM" },
                    { key: "potential", label: "POT" },
                    ...attrColumns].map((col) => (
                    <th
                      key={col.key}
                      className={`py-3 px-3 min-w-[95px] ${
                        col.key === "name" ? "min-w-[150px] text-left pl-4" : "text-center"
                      } cursor-pointer select-none`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSort(col.key);
                      }}
                    >
                      {col.label}
                      {sortConfig.key === col.key && (
                        <span className="ml-1 text-orange-400">
                          {sortConfig.direction === "asc"
                            ? "▲"
                            : sortConfig.direction === "desc"
                            ? "▼"
                            : ""}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="text-[17px] font-medium">
                {sortedPlayers.map((p, idx) => {
                  const affordability = affordabilityByPlayerKey[getPlayerKey(p)] || buildAffordabilityForPlayer(p);

                  return (
                  <tr
                    key={`${p.name}-${idx}`}
                    onClick={() => setSelectedPlayer(p)}
                    className={`cursor-pointer transition ${
                      selectedPlayer && selectedPlayer.name === p.name
                        ? "bg-orange-600 text-white"
                        : "hover:bg-neutral-800"
                    }`}
                  >
                    <td
                      className="py-2 px-3 whitespace-nowrap text-left pl-4"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        openSignModal(p);
                      }}
                      title={isOffseasonMode ? "Double click to submit offer" : "Double click to offer contract"}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPlayer(p);
                          setPlayerCardPlayer(p);
                        }}
                        className="text-left font-bold underline-offset-4 hover:text-orange-200 hover:underline"
                        title="Open player card"
                      >
                        {p.name}
                      </button>
                    </td>
                    <td className="py-2 px-3">{p.pos}</td>
                    <td className="py-2 px-3">
                      {isRestrictedFreeAgent(p) ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-xs font-bold uppercase">
                          Yes
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-300 text-xs font-bold uppercase">
                          No
                        </span>
                      )}
                    </td>

                    <td className="py-2 px-3">
                      <span
                        title={affordability.title}
                        className={`inline-flex px-2 py-0.5 rounded-full border text-xs font-bold uppercase whitespace-nowrap ${getAffordableChipClass(affordability.tone)}`}
                      >
                        {affordability.label}
                      </span>
                    </td>

                    <td
                      className="py-2 px-3 text-emerald-200 font-bold whitespace-nowrap"
                      title={`Expected first-year salary: ${formatDollars(getExpectedYearOneSalary(p))}`}
                    >
                      {formatExpectedSalaryShort(p)}
                    </td>

                    <td className="py-2 px-3">{p.age}</td>

                    <td className="py-2 px-3" onDoubleClick={handleCellDoubleClick}>
                      {showLetters ? toLetter(p.overall) : p.overall}
                    </td>

                    <td className="py-2 px-3" onDoubleClick={handleCellDoubleClick}>
                      {showLetters ? toLetter(p.offRating) : p.offRating}
                    </td>

                    <td className="py-2 px-3" onDoubleClick={handleCellDoubleClick}>
                      {showLetters ? toLetter(p.defRating) : p.defRating}
                    </td>

                    <td className="py-2 px-3" onDoubleClick={handleCellDoubleClick}>
                      {showLetters ? toLetter(p.stamina) : p.stamina}
                    </td>

                    <td className="py-2 px-3" onDoubleClick={handleCellDoubleClick}>
                      {showLetters ? toLetter(p.potential) : p.potential}
                    </td>

                    {attrColumns.map((a) => (
                      <td
                        key={a.key}
                        className="py-2 px-3"
                        onDoubleClick={handleCellDoubleClick}
                      >
                        {showLetters ? toLetter(p.attrs?.[a.index] ?? 0) : p.attrs?.[a.index] ?? "-"}
                      </td>
                    ))}
                  </tr>
                    );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap justify-center mt-10">
        {isOffseasonMode && (
          <button
            onClick={() => navigate("/offseason")}
            className="px-8 py-3 bg-neutral-700 hover:bg-neutral-600 rounded-lg font-semibold transition"
          >
            Back to Offseason Hub
          </button>
        )}
        {isOffseasonMode && effectiveFreeAgencyFinished && (
          <button
            onClick={handleContinueToProgression}
            className="px-8 py-3 bg-green-600 hover:bg-green-500 rounded-lg font-semibold transition"
          >
            Continue to Progression
          </button>
        )}
        <button
          onClick={() => navigate("/team-hub")}
          className="px-8 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
        >
          Back to Team Hub
        </button>
      </div>

      {signModalOpen && signTargetPlayer && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center overflow-y-auto z-50 px-4 py-6">
          <div className="fa-modal-scroll w-full max-w-xl max-h-[88vh] overflow-y-auto bg-neutral-800 rounded-2xl border border-neutral-700 shadow-2xl p-5 sm:p-4">
            <h2 className="text-xl font-bold text-orange-400 mb-1.5">
              {isOffseasonMode ? "Submit Offer" : "Offer Contract"}
            </h2>

            <p className="text-white text-base mb-1">
              {signTargetPlayer.name}
            </p>
            <div className="flex flex-wrap gap-2 mb-3">
              {renderRightsChips(signTargetPlayer, offerEvaluation)}
            </div>

            <p className="text-gray-400 text-sm mb-4">
              Offering from {selectedTeam?.name || "No Team Selected"}
            </p>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-300">Interest</span>
                <span className="text-sm font-semibold text-white">
                  {interestDisplay.label}
                </span>
              </div>
              <div className="w-full h-3.5 bg-neutral-900 rounded-full overflow-hidden border border-neutral-700">
                <div
                  className={`h-full ${interestDisplay.barClass} transition-all duration-200`}
                  style={{ width: `${interestDisplay.percent}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <div className="bg-neutral-900 rounded-xl p-3 border border-neutral-700">
                <div className="text-xs text-gray-400 mb-1">Current Payroll</div>
                <div className="text-base font-semibold text-white">
                  {formatDollars(offerEvaluation?.teamSnapshot?.payroll || 0)}
                </div>
              </div>

              <div className="bg-neutral-900 rounded-xl p-3 border border-neutral-700">
                <div className="text-xs text-gray-400 mb-1">Cap Room</div>
                <div className="text-base font-semibold text-white">
                  {formatDollars(offerEvaluation?.teamSnapshot?.capRoom || 0)}
                </div>
              </div>

              <div className="bg-neutral-900 rounded-xl p-3 border border-neutral-700">
                <div className="text-xs text-gray-400 mb-1">Dead Cap</div>
                <div className="text-base font-semibold text-white">
                  {formatDollars(offerEvaluation?.teamSnapshot?.deadCap || 0)}
                </div>
              </div>
            </div>

            <div className="bg-neutral-900 rounded-xl p-3.5 border border-neutral-700 mb-4">
              <div className="text-sm font-semibold text-gray-300 mb-2.5">Money</div>

              <div className="flex flex-col gap-2.5">
                <input
                  type="text"
                  value={offerSalaryText}
                  onChange={(e) => {
                    setOfferSalaryText(e.target.value);
                    setSignError("");
                  }}
                  placeholder="First-year salary in millions"
                  className="w-full px-4 py-2 rounded-lg bg-neutral-800 border border-neutral-600 text-white outline-none focus:border-orange-500"
                />

                <input
                  type="range"
                  min="1.2"
                  max="50"
                  step="0.01"
                  value={Number(offerSalaryText) || 1.2}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setOfferSalaryText(val.toFixed(2));
                    setSignError("");
                  }}
                  className="w-full accent-green-500"
                />

                <div className="text-sm text-gray-400">
                  First-year salary:{" "}
                  <span className="text-white font-semibold">
                    {formatDollars(parseMillionsText(offerSalaryText))}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-neutral-900 rounded-xl p-3.5 border border-neutral-700 mb-4">
              <div className="text-sm font-semibold text-gray-300 mb-2.5">Years</div>
              <div className="flex gap-2 flex-wrap">
                {[1, 2, 3, 4].map((y) => (
                  <button
                    key={y}
                    onClick={() => {
                      setOfferYears(y);
                      setSignError("");
                    }}
                    className={`px-3.5 py-2 rounded-lg font-semibold transition ${
                      offerYears === y
                        ? "bg-orange-600 text-white"
                        : "bg-neutral-800 text-gray-300 hover:bg-neutral-700"
                    }`}
                  >
                    {y}Y
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-neutral-900 rounded-xl p-3.5 border border-neutral-700 mb-4">
              <div className="text-sm font-semibold text-gray-300 mb-2.5">Option</div>

              <div className="space-y-2">
                <select
                  value={optionType}
                  onChange={(e) => {
                    setOptionType(e.target.value);
                    setSignError("");
                  }}
                  className="w-full px-4 py-2 rounded-lg bg-neutral-800 border border-neutral-600 text-white outline-none focus:border-orange-500"
                >
                  <option value="none">No Option</option>
                  <option value="team" disabled={offerYears <= 1}>Team Option</option>
                  <option value="player" disabled={offerYears <= 1}>Player Option</option>
                </select>

                <div className="text-xs text-gray-500">
                  Options automatically apply to the final year of the contract. Team options lower player interest. Player options improve player interest.
                </div>
              </div>
            </div>

            <div className="bg-neutral-900 rounded-xl p-3.5 border border-neutral-700 mb-4">
              <div className="text-sm font-semibold text-gray-300 mb-2.5">Contract Preview</div>

              <div className="space-y-1 text-sm text-gray-300">
                {(offerEvaluation?.contract?.salaryByYear || []).map((amount, idx) => {
                  const year =
                    (offerEvaluation?.contract?.startYear || getCurrentSeasonYear()) + idx;
                  const isOptionYear =
                    optionType !== "none" && offerYears > 1 && idx === offerYears - 1;

                  return (
                    <div key={year} className="flex justify-between gap-4">
                      <span>
                        {year}
                        {isOptionYear ? ` (${optionType.toUpperCase()} OPTION)` : ""}
                      </span>
                      <span>{formatDollars(amount)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-neutral-900 rounded-xl p-3.5 border border-neutral-700 mb-4">
              <div className="text-sm font-semibold text-gray-300 mb-2">Market View</div>

              <div className="space-y-1 text-sm text-gray-300">
                <div className="flex justify-between gap-4">
                  <span>Expected Years</span>
                  <span>{offerEvaluation?.marketValue?.expectedYears ?? "-"}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Expected AAV</span>
                  <span>{formatDollars(offerEvaluation?.marketValue?.expectedAAV || 0)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Minimum Acceptable AAV</span>
                  <span>{formatDollars(offerEvaluation?.marketValue?.minAcceptableAAV || 0)}</span>
                </div>
              </div>
            </div>

            {signError && (
              <div className="mb-4 text-red-300 text-sm font-semibold">
                {signError}
              </div>
            )}

            {!offerEvalLoading && offerEvaluation?.reason && !offerEvaluation?.ok && (
              <div className="mb-4 text-red-300 text-sm font-semibold">
                {offerEvaluation.reason}
              </div>
            )}

            {!offerEvalLoading && offerEvaluation?.ok && !offerEvaluation.accepted && !isOffseasonMode && (
              <div className="mb-4 text-yellow-300 text-sm font-semibold">
                Current offer is not strong enough yet.
              </div>
            )}

            {!offerEvalLoading && offerEvaluation?.ok && offerEvaluation.accepted && !isOffseasonMode && (
              <div className="mb-4 text-green-300 text-sm font-semibold">
                This player is ready to sign this offer.
              </div>
            )}

            {canSubmitLiveOffer && (
              <div className="mb-4 text-blue-300 text-sm font-semibold">
                In offseason mode, this submits a live market offer. The player may wait and compare it to CPU offers.
              </div>
            )}

            {canManualCleanupSign && (
              <div className="mb-4 text-yellow-300 text-sm font-semibold">
                The live market is over. Because your team is below the minimum roster size, you can still sign remaining free agents directly until you reach {minRosterSize} players.
              </div>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button
                onClick={closeSignModal}
                className="px-4 py-2 rounded-lg bg-gray-600 hover:bg-gray-500 text-white font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitOrSignPlayer}
                disabled={
                  !selectedTeam ||
                  offerEvalLoading ||
                  (isOffseasonMode && !canUseFreeAgencyAction)
                }
                className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold transition"
              >
                {isOffseasonMode
                  ? canSubmitLiveOffer
                    ? "Submit Offer"
                    : canManualCleanupSign
                    ? "Sign Player"
                    : "Submit Offer"
                  : "Sign Player"}
              </button>
            </div>
          </div>
        </div>
      )}

      {offersModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center overflow-y-auto z-50 px-4 py-6">
          <div className="fa-modal-scroll w-full max-w-2xl max-h-[88vh] overflow-y-auto bg-neutral-800 rounded-2xl border border-neutral-700 shadow-2xl p-5 sm:p-4">
            <h2 className="text-xl font-bold text-orange-400 mb-1.5">
              View Offers
            </h2>

            <p className="text-white text-base mb-1">
              {offersViewData?.player?.name || selectedPlayer?.name || "-"}
            </p>

            <p className="text-gray-400 text-sm mb-4">
              Live market offers for this free agent
            </p>

            {offersViewLoading ? (
              <div className="text-gray-300 py-8">Loading offers...</div>
            ) : offersViewError ? (
              <div className="text-red-300 py-4 font-semibold">{offersViewError}</div>
            ) : (
              <>
                {(() => {
                  const modalPlayer = offersViewData?.player || selectedPlayer || {};
                  const modalRights = getRights(modalPlayer);
                  const qoAmount = Number(modalPlayer?.qualifyingOffer?.amount || 0);
                  const isRfa = Boolean(modalRights?.restrictedFreeAgent || qoAmount > 0);

                  return (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                        <div className="bg-neutral-900 rounded-xl p-3 border border-neutral-700">
                          <div className="text-xs text-gray-400 mb-1">Outside Offers</div>
                          <div className="text-base font-semibold text-white">
                            {offersViewData?.offers?.length || 0}
                          </div>
                        </div>

                        <div className="bg-neutral-900 rounded-xl p-3 border border-neutral-700">
                          <div className="text-xs text-gray-400 mb-1">Expected AAV</div>
                          <div className="text-base font-semibold text-white">
                            {formatDollars(modalPlayer?.marketValue?.expectedAAV || 0)}
                          </div>
                        </div>

                        <div className="bg-neutral-900 rounded-xl p-3 border border-neutral-700">
                          <div className="text-xs text-gray-400 mb-1">Expected Years</div>
                          <div className="text-base font-semibold text-white">
                            {modalPlayer?.marketValue?.expectedYears ?? "-"}
                          </div>
                        </div>

                        <div className="bg-neutral-900 rounded-xl p-3 border border-neutral-700">
                          <div className="text-xs text-gray-400 mb-1">RFA</div>
                          <div className={isRfa ? "text-base font-semibold text-emerald-300" : "text-base font-semibold text-white"}>
                            {isRfa ? "Yes" : "No"}
                          </div>
                        </div>
                      </div>

                      {(isRfa || qoAmount > 0 || modalRights?.heldByTeam) && (
                        <div className="flex flex-wrap gap-2 mb-4">
                          {isRfa && <Chip tone="green">Restricted Free Agent</Chip>}
                          {qoAmount > 0 && <Chip tone="green">Qualifying Offer {formatDollars(qoAmount)}</Chip>}
                          {modalRights?.heldByTeam && <Chip tone="orange">Rights Held By {modalRights.heldByTeam}</Chip>}
                        </div>
                      )}
                    </>
                  );
                })()}

                {!offersViewData?.offers?.length ? (
                  <div className="text-gray-300 py-6">
                    {(() => {
                      const modalPlayer = offersViewData?.player || selectedPlayer || {};
                      const modalRights = getRights(modalPlayer);
                      const qoAmount = Number(modalPlayer?.qualifyingOffer?.amount || 0);
                      const isRfa = Boolean(modalRights?.restrictedFreeAgent || qoAmount > 0);

                      if (isRfa || qoAmount > 0) {
                        return "No outside offer sheets yet. The qualifying offer/RFA status is still active.";
                      }

                      return "No current offers on this player yet.";
                    })()}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {offersViewData.offers.map((offer, idx) => (
                      <div
                        key={`${offer.offerId || offer.teamName}-${idx}`}
                        className={`rounded-xl border p-4 ${
                          offer.isBestOffer
                            ? "border-orange-500 bg-orange-500/10"
                            : "border-neutral-700 bg-neutral-900"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4 mb-2">
                          <div className="text-white font-semibold">
                            {offer.teamName}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap justify-end">
                            {offer.source && (
                              <span className="px-2 py-1 rounded-full text-xs font-semibold bg-neutral-700 text-gray-200">
                                {String(offer.source).toUpperCase()}
                              </span>
                            )}
                            {offer.isBestOffer && (
                              <span className="px-2 py-1 rounded-full text-xs font-semibold bg-orange-600 text-white">
                                Best Offer
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div>
                            <div className="text-gray-400 mb-1">Years</div>
                            <div className="text-white font-semibold">{offer.years || "-"}</div>
                          </div>
                          <div>
                            <div className="text-gray-400 mb-1">AAV</div>
                            <div className="text-white font-semibold">{formatDollars(offer.aav || 0)}</div>
                          </div>
                          <div>
                            <div className="text-gray-400 mb-1">Total Value</div>
                            <div className="text-white font-semibold">{formatDollars(offer.totalValue || 0)}</div>
                          </div>
                          <div>
                            <div className="text-gray-400 mb-1">Submitted Day</div>
                            <div className="text-white font-semibold">{offer.submittedDay || "-"}</div>
                          </div>
                        </div>

                        {!!offer.salaryByYear?.length && (
                          <div className="mt-3 text-sm">
                            <div className="text-gray-400 mb-1.5">Year by Year</div>
                            <div className="space-y-1">
                              {offer.salaryByYear.map((amount, yearIdx) => (
                                <div key={`${offer.teamName}-${yearIdx}`} className="flex justify-between gap-4 text-gray-300">
                                  <span>
                                    {(offer?.contract?.startYear ?? (getCurrentSeasonYear() + (isOffseasonMode ? 1 : 0))) + yearIdx}
                                  </span>
                                  <span>{formatDollars(amount)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end gap-3 pt-4">
              <button
                onClick={closeOffersModal}
                className="px-4 py-2 rounded-lg bg-gray-600 hover:bg-gray-500 text-white font-semibold transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <PlayerCardModal
        open={!!playerCardPlayer}
        player={playerCardPlayer}
        teamName={playerCardPlayer?.teamName || playerCardPlayer?.rights?.heldByTeam || "Free Agent"}
        teamLogo={playerCardPlayer?.teamLogo || ""}
        leagueData={workingLeagueData}
        onClose={() => setPlayerCardPlayer(null)}
      />
    </div>
  );
}