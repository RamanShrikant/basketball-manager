
// src/pages/SalaryTable.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";
import PageFade from "../components/PageFade";
import "../styles/BMAnimations.css";
import styles from "./SalaryTable.module.css";
import { getLeagueFinancialRules } from "../utils/leagueFinancials.js";

export default function SalaryTable() {
  const navigate = useNavigate();
  const { leagueData: ctxLeague, selectedTeam: ctxSelectedTeam } = useGame();

  const [leagueData, setLeagueData] = useState(null);
  const [selectedTeamKey, setSelectedTeamKey] = useState("");
  const [capHoldInfo, setCapHoldInfo] = useState(null);
  const [deadCapInfo, setDeadCapInfo] = useState(null);

  const rawSeasonYear = Number(
    leagueData?.seasonYear ??
    leagueData?.currentSeasonYear ??
    leagueData?.seasonStartYear ??
    2025
  );

  const currentSeasonYear = Number.isFinite(rawSeasonYear)
    ? rawSeasonYear + 1
    : 2026;

  const financialRules = getLeagueFinancialRules(leagueData || {}, currentSeasonYear);

  const getLeagueAmount = (keys, fallback) => {
    for (const key of keys) {
      const value = Number(leagueData?.[key] || 0);
      if (value > 0) return value;
    }
    return fallback;
  };

  const SALARY_CAP = getLeagueAmount(["salaryCap", "capLimit"], financialRules.salaryCap);
  const TAX_LINE = getLeagueAmount(["luxuryTaxLine", "taxLine"], financialRules.luxuryTaxLine);
  const FIRST_APRON = getLeagueAmount(["firstApron", "apron1"], financialRules.firstApron);
  const SECOND_APRON = getLeagueAmount(["secondApron", "apron2"], financialRules.secondApron);
  const HARD_CAP = getLeagueAmount(["hardCap", "hardCapLimit"], financialRules.hardCap || SECOND_APRON);
  const MIN_CONTRACT_AMOUNT = Number(financialRules.minimumSalary || 1_200_000);

  const fmtM = (n) => {
    const v = Number(n) || 0;
    return `$${(v / 1_000_000).toFixed(1)}M`.replace(".0M", "M");
  };

  const fmtMoney = (n) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(Number(n || 0));
  };

  const safeJSON = (raw) => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const looksLikeLeague = (obj) => {
    const conf = obj?.conferences;
    const eastOk = Array.isArray(conf?.East);
    const westOk = Array.isArray(conf?.West);
    return eastOk && westOk;
  };

  const readLeagueFromLocalStorage = () => {
    const direct = safeJSON(localStorage.getItem("leagueData"));
    if (looksLikeLeague(direct)) return direct;

    let best = null;
    let bestScore = -1;

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const raw = localStorage.getItem(k);
      const obj = safeJSON(raw);
      if (!looksLikeLeague(obj)) continue;

      const eastN = obj.conferences.East.length;
      const westN = obj.conferences.West.length;
      const score = eastN + westN;

      if (score > bestScore) {
        bestScore = score;
        best = obj;
      }
    }

    return best;
  };

  const readSelectedTeamFromLocalStorage = () => {
    return safeJSON(localStorage.getItem("selectedTeam"));
  };

  useEffect(() => {
    if (looksLikeLeague(ctxLeague)) {
      setLeagueData(ctxLeague);
      return;
    }
    const parsed = readLeagueFromLocalStorage();
    setLeagueData(parsed);
  }, [ctxLeague]);

  const allTeamsFlat = useMemo(() => {
    const out = [];
    const confs = leagueData?.conferences || {};

    for (const conf of ["East", "West"]) {
      const teams = confs?.[conf] || [];

      for (let i = 0; i < teams.length; i++) {
        const t = teams[i];
        out.push({
          key: `${conf}-${i}`,
          conf,
          teamIdx: i,
          name: t?.name || `${conf} Team ${i + 1}`,
          logo: t?.logo || t?.teamLogo || t?.logoUrl || "",
        });
      }
    }

    return out;
  }, [leagueData]);

  useEffect(() => {
    if (allTeamsFlat.length === 0) return;
    if (selectedTeamKey) return;

    const savedSelectedTeam = readSelectedTeamFromLocalStorage();
    const preferredName =
      ctxSelectedTeam?.name ||
      savedSelectedTeam?.name ||
      savedSelectedTeam ||
      "";

    if (preferredName) {
      const found = allTeamsFlat.find((t) => t.name === preferredName);
      if (found) {
        setSelectedTeamKey(found.key);
        return;
      }
    }

    setSelectedTeamKey(allTeamsFlat[0].key);
  }, [allTeamsFlat, ctxSelectedTeam, selectedTeamKey]);

  const selectedTeam = useMemo(() => {
    if (!leagueData?.conferences) return null;

    const [conf, idxStr] = (selectedTeamKey || "").split("-");
    const idx = Number(idxStr);

    if (!conf || !Number.isFinite(idx)) return null;
    return leagueData.conferences?.[conf]?.[idx] || null;
  }, [leagueData, selectedTeamKey]);

  const isAllTeamsView = selectedTeamKey === "__ALL__";

  const freeAgencyState = leagueData?.freeAgencyState || {};
  const isFreeAgencyMode = Boolean(
    freeAgencyState?.isActive ||
    Number(freeAgencyState?.currentDay || 0) > 0 ||
    Number(freeAgencyState?.maxDays || 0) > 0 ||
    freeAgencyState?.latestResults
  );

  const normalizeContract = (p) => {
    const contract = p?.contract || null;

    let startYear = Number(contract?.startYear ?? currentSeasonYear);
    const salaryByYear = Array.isArray(contract?.salaryByYear)
      ? contract.salaryByYear.map((x) => Number(x) || 0)
      : [];
    const option = contract?.option ?? null;

    const lastYear = startYear + Math.max(0, salaryByYear.length - 1);

    const hasCurrentSeasonSlot =
      salaryByYear.length > 0 &&
      currentSeasonYear >= startYear &&
      currentSeasonYear <= lastYear;

    const looksLikePreviousOffseasonOneYearDeal =
      salaryByYear.length === 1 &&
      startYear === currentSeasonYear - 1 &&
      !hasCurrentSeasonSlot;

    if (looksLikePreviousOffseasonOneYearDeal) {
      startYear = currentSeasonYear;
    }

    return { startYear, salaryByYear, option };
  };

  const getOptionYearIndices = (option) => {
    if (!option || typeof option !== "object") return [];

    if (Array.isArray(option.yearIndices)) {
      return option.yearIndices
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x));
    }

    if (option.yearIndex !== undefined && option.yearIndex !== null) {
      const idx = Number(option.yearIndex);
      return Number.isFinite(idx) ? [idx] : [];
    }

    return [];
  };

  const getOptionLabel = (contract) => {
    const option = contract?.option || null;
    if (!option?.type) return "None";

    const optionYears = getOptionYearIndices(option);
    const type = String(option.type).toUpperCase();

    if (optionYears.length) {
      return `${type} ${optionYears
        .map((y) => `Y${Number(y) + 1}`)
        .join(", ")}`;
    }

    return type;
  };

  const getExpType = (player) => {
    const rights = player?.rights || {};

    const hasRfaFlag =
      Boolean(rights?.restrictedFreeAgent) ||
      Boolean(player?.restrictedFreeAgent) ||
      Boolean(player?.qualifyingOfferEligible) ||
      Boolean(player?.qualifyingOffer?.amount);

    const isRookieScaleControlled =
      Boolean(rights?.rookieScale) ||
      Boolean(player?.rookieScale) ||
      Boolean(player?.contract?.rookieScale);

    if (hasRfaFlag || isRookieScaleControlled) return "RFA";
    return "UFA";
  };

  const getExpNote = (player, expType) => {
    const rights = player?.rights || {};

    if (expType === "RFA") {
      if (rights?.rookieScale || player?.rookieScale || player?.contract?.rookieScale) {
        return "Projected restricted free agent because this player is on a rookie-scale control path.";
      }

      return "Projected restricted free agent because this player has RFA or qualifying-offer control saved in the league file.";
    }

    if (String(expType || "").includes("DEAD")) {
      return "This is dead cap from a released player. The player is no longer on the roster, but the team still owes this salary against the cap.";
    }

    if (String(expType || "").includes("HOLD")) {
      return "This is a temporary cap hold, not a real signed contract.";
    }

    return "Projected unrestricted free agent based on the saved rights data.";
  };

  const getExpChipClass = (type) => {
    if (String(type || "").includes("DEAD")) {
      return "bg-red-500/20 border-red-400/45 text-red-100";
    }

    if (String(type || "").includes("HOLD")) {
      return "bg-red-500/15 border-red-500/35 text-red-200";
    }

    if (type === "2-WAY") {
      return "bg-emerald-500/15 border-emerald-500/30 text-emerald-200";
    }

    if (type === "STASH") {
      return "bg-amber-500/15 border-amber-500/30 text-amber-200";
    }

    if (type === "RFA") {
      return "bg-emerald-500/15 border-emerald-500/30 text-emerald-200";
    }

    return "bg-white/5 border-white/10 text-white/65";
  };

  const getPlayerKey = (player) => {
    if (player?.id !== undefined && player?.id !== null && player?.id !== "") {
      return `id:${player.id}`;
    }
    return `name:${player?.name || ""}`;
  };

  const getPlayerImage = (player) => {
    return player?.headshot || player?.image || player?.img || player?.playerHeadshot || "";
  };

  const getTwoWayPlayers = (team) => {
    return Array.isArray(team?.twoWayPlayers) ? team.twoWayPlayers : [];
  };

  const getStashPlayers = (team) => {
    return Array.isArray(team?.stashPlayers) ? team.stashPlayers : [];
  };

  const buildTwoWaySalaryRow = (player) => {
    const c = normalizeContract(player);
    const years = Math.max(1, c.salaryByYear.length || 1);
    const endYear = c.salaryByYear.length
      ? c.startYear + c.salaryByYear.length - 1
      : c.startYear;

    const totalRemaining = c.salaryByYear.reduce((sum, value, idx) => {
      const seasonYear = c.startYear + idx;
      if (seasonYear < currentSeasonYear) return sum;
      return sum + (Number(value) || 0);
    }, 0);

    return {
      id: player?.id || `two-way-${player?.name || "player"}-${player?.pos || "pos"}`,
      name: player?.name || "Unknown",
      pos: player?.pos || "",
      overall: player?.overall ?? "-",
      headshot: getPlayerImage(player),
      contract: c,
      years,
      endYear,
      totalRemaining,
      optionLabel: "Two-Way Contract",
      expType: "2-WAY",
      expNote: "Two-way players are kept separate from the 15-man standard roster and do not count against standard salary-table totals in this version.",
      isCapHold: false,
      isTwoWay: true,
      excludeFromPayroll: true,
    };
  };

  const buildStashSalaryRow = (player) => {
    const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
    const startYear = Number(contract?.startYear || currentSeasonYear);

    return {
      id: player?.id || `stash-${player?.name || "player"}-${player?.pos || "pos"}`,
      name: player?.name || "Unknown",
      pos: player?.pos || "",
      overall: player?.overall ?? "-",
      headshot: getPlayerImage(player),
      contract: {
        startYear,
        salaryByYear: [],
        option: null,
      },
      years: 1,
      endYear: startYear,
      totalRemaining: 0,
      optionLabel: "One-Year Stash",
      expType: "STASH",
      expNote: "Stashed players are controlled by the team but are not on the 15-man roster, do not receive minutes, and do not count against salary-table payroll totals.",
      isCapHold: false,
      isStash: true,
      excludeFromPayroll: true,
    };
  };

  const getRights = (player) => {
    return player?.rights && typeof player.rights === "object"
      ? player.rights
      : {
          heldByTeam: null,
          birdLevel: "none",
          seasonsTowardBird: 0,
          restrictedFreeAgent: false,
          rookieScale: false,
        };
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
    const birdLevel = String(rights?.birdLevel || "").toLowerCase();

    if (player?.rightsRenounced || player?.rights?.renounced) return 0;
    if (!teamName || rights?.heldByTeam !== teamName) return 0;
    if (!birdLevel || birdLevel === "none" || birdLevel === "no rights" || birdLevel === "no_rights") return 0;

    if (
      rights?.restrictedFreeAgent &&
      player?.qualifyingOffer?.amount &&
      player?.qualifyingOffer?.status !== "withdrawn"
    ) {
      return Math.max(MIN_CONTRACT_AMOUNT, Number(player.qualifyingOffer.amount || 0));
    }

    const previousSalary = getPreviousSalaryForCapHold(player);
    const marketYearOne = Number(player?.marketValue?.expectedYear1Salary || MIN_CONTRACT_AMOUNT);

    if (birdLevel === "bird") {
      return Math.max(previousSalary, marketYearOne, MIN_CONTRACT_AMOUNT);
    }

    if (birdLevel === "early_bird") {
      return Math.max(previousSalary * 1.3, MIN_CONTRACT_AMOUNT);
    }

    if (birdLevel === "non_bird") {
      return Math.max(previousSalary * 1.2, MIN_CONTRACT_AMOUNT);
    }

    return 0;
  };

  const formatBirdLabel = (level) => {
    if (level === "bird") return "Bird";
    if (level === "early_bird") return "Early Bird";
    if (level === "non_bird") return "Non-Bird";
    return "Rights";
  };

  const capHoldRows = useMemo(() => {
    const teamName = selectedTeam?.name;
    if (!teamName || !isFreeAgencyMode) return [];

    return (leagueData?.freeAgents || [])
      .map((player) => {
        const rights = getRights(player);
        const capHold = getCapHoldForPlayer(player, teamName);
        const birdLevel = rights?.birdLevel || "none";
        const restrictedFreeAgent = Boolean(rights?.restrictedFreeAgent || player?.qualifyingOffer?.amount);
        const previousSalary = getPreviousSalaryForCapHold(player);
        const marketYearOne = Number(player?.marketValue?.expectedYear1Salary || MIN_CONTRACT_AMOUNT);
        const rightsLabel = formatBirdLabel(birdLevel);
        const note = restrictedFreeAgent
          ? `${player?.name || "This player"} is on a cap hold because ${teamName} still controls his RFA rights. The hold counts against practical cap room until you re-sign him, he signs elsewhere, or you renounce his rights.`
          : `${player?.name || "This player"} is on a cap hold because ${teamName} still holds ${rightsLabel} rights. The hold counts against practical cap room until you re-sign him, he signs elsewhere, or you renounce his rights.`;

        return {
          player,
          playerKey: getPlayerKey(player),
          playerName: player?.name || "Unknown",
          position: player?.pos || player?.position || "",
          overall: player?.overall ?? "-",
          headshot: player?.headshot || "",
          capHold,
          birdLevel,
          rightsLabel,
          restrictedFreeAgent,
          previousSalary,
          marketYearOne,
          note,
        };
      })
      .filter((row) => row.capHold > 0)
      .sort((a, b) => Number(b.capHold || 0) - Number(a.capHold || 0));
  }, [leagueData, selectedTeam?.name, isFreeAgencyMode]);

  const capHoldTotal = useMemo(() => {
    return capHoldRows.reduce((sum, row) => sum + Number(row.capHold || 0), 0);
  }, [capHoldRows]);

  const getMinimumExceptionAmount = () => getLeagueAmount(
    ["minimumException", "minimumSalary", "veteranMinimum"],
    financialRules.minimumException
  );

  const getContractSalaryForYear = (contract, seasonYear) => {
    const startYear = Number(contract?.startYear || 0);
    const salaryByYear = Array.isArray(contract?.salaryByYear) ? contract.salaryByYear : [];
    const idx = Number(seasonYear) - startYear;

    if (idx < 0 || idx >= salaryByYear.length) return 0;
    return Number(salaryByYear[idx] || 0);
  };

  const sameDeadCapPlayer = (row, player) => {
    const rowId = row?.playerId;
    const playerId = player?.id;

    if (rowId !== undefined && rowId !== null && rowId !== "" && playerId !== undefined && playerId !== null && playerId !== "") {
      return String(rowId) === String(playerId);
    }

    const rowName = row?.playerName || row?.name;
    return Boolean(rowName && player?.name && rowName === player.name);
  };

  const findSignedPlayerForDeadCapRow = (row, deadCapTeamName) => {
    const seasonYear = Number(row?.seasonYear || 0);
    const teams = Object.values(leagueData?.conferences || {}).flatMap((items) => items || []);

    for (const team of teams) {
      const signedTeamName = team?.name;
      if (!signedTeamName || signedTeamName === deadCapTeamName) continue;

      for (const player of team?.players || []) {
        if (!sameDeadCapPlayer(row, player)) continue;

        const signedSalary = getContractSalaryForYear(player?.contract, seasonYear);
        if (signedSalary <= 0) continue;

        return {
          teamName: signedTeamName,
          player,
          signedSalary,
        };
      }
    }

    return null;
  };

  const calculateDeadCapSetOff = (originalAmount, signedSalary) => {
    const minimum = Number(getMinimumExceptionAmount() || financialRules.minimumException);
    const rawSetOff = Math.max(0, Math.floor((Number(signedSalary || 0) - minimum) / 2));
    const rounded = Math.round(rawSetOff / 1000) * 1000;
    return Math.min(Number(originalAmount || 0), rounded);
  };


  const normalizeDeadCapRowsForNoStretch = (rawRows, teamName) => {
    const rows = Array.isArray(rawRows) ? rawRows : [];
    const out = [];
    const seen = new Set();
    const convertedGroups = new Set();

    const addOnce = (row) => {
      const key = [
        row?.playerId ?? "",
        row?.playerName || row?.name || "",
        Number(row?.seasonYear || 0),
        Number(row?.originalAmount ?? row?.amount ?? 0),
        row?.reason || "release",
      ].join("|");

      if (seen.has(key)) return;
      seen.add(key);
      out.push(row);
    };

    for (const row of rows) {
      const originalRows = Array.isArray(row?.originalRemainingRows)
        ? row.originalRemainingRows
        : [];

      if (!row?.stretchApplied || originalRows.length === 0) {
        addOnce(row);
        continue;
      }

      const groupKey = row?.deadCapGroupId || `${row?.playerId || ""}|${row?.playerName || row?.name || ""}|${row?.reason || "release"}`;
      if (convertedGroups.has(groupKey)) continue;
      convertedGroups.add(groupKey);

      const cleanOriginalRows = originalRows
        .map((item) => ({
          seasonYear: Number(item?.seasonYear || 0),
          amount: Number(item?.amount || 0),
        }))
        .filter((item) => item.seasonYear > 0 && item.amount > 0)
        .sort((a, b) => a.seasonYear - b.seasonYear);

      if (!cleanOriginalRows.length) continue;

      const totalGuaranteed = cleanOriginalRows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const firstSeason = cleanOriginalRows[0].seasonYear;
      const lastSeason = cleanOriginalRows[cleanOriginalRows.length - 1].seasonYear;
      const normalGroupId = String(groupKey).replace("release-stretch:", "release-normal:");

      for (const item of cleanOriginalRows) {
        const amount = Number(item.amount || 0);
        addOnce({
          ...row,
          teamName,
          seasonYear: item.seasonYear,
          amount,
          originalAmount: amount,
          setOffCredit: 0,
          setOffAmount: 0,
          offsetAmount: 0,
          netAmount: amount,
          source: "released_player_contract",
          deadCapMethod: "normal_release",
          stretchApplied: false,
          stretchYears: cleanOriginalRows.length,
          stretchAnnualAmount: 0,
          remainingContractYears: cleanOriginalRows.length,
          totalGuaranteedOwed: totalGuaranteed,
          originalRemainingRows: cleanOriginalRows,
          firstDeadCapSeason: firstSeason,
          lastDeadCapSeason: lastSeason,
          deadCapGroupId: normalGroupId,
        });
      }
    }

    return out;
  };

  const deadCapRows = useMemo(() => {
    const teamName = selectedTeam?.name;
    if (!teamName) return [];

    const savedDeadCapRows = Array.isArray(leagueData?.deadCapByTeam?.[teamName])
      ? leagueData.deadCapByTeam[teamName]
      : [];
    const rawRows = normalizeDeadCapRowsForNoStretch(savedDeadCapRows, teamName);

    return rawRows
      .map((row, idx) => {
        const seasonYear = Number(row?.seasonYear || 0);
        const savedSetOff = Number(row?.setOffCredit || row?.setOffAmount || row?.offsetAmount || 0);
        const savedAmount = Number(row?.amount ?? row?.netAmount ?? 0);
        const originalAmount = Number(
          row?.originalAmount ||
          row?.guaranteedAmount ||
          row?.grossAmount ||
          (savedSetOff > 0 ? savedAmount + savedSetOff : savedAmount) ||
          0
        );
        const signedInfo = findSignedPlayerForDeadCapRow(
          { ...row, seasonYear },
          teamName
        );
        const calculatedSetOff = signedInfo
          ? calculateDeadCapSetOff(originalAmount, signedInfo.signedSalary)
          : 0;
        const setOffAmount = Math.max(savedSetOff, calculatedSetOff);
        const amount = Math.max(0, originalAmount - setOffAmount);

        return {
          id: `dead-cap-${teamName}-${row?.playerId || row?.playerName || idx}-${seasonYear}`,
          playerId: row?.playerId ?? null,
          playerName: row?.playerName || row?.name || "Released Player",
          seasonYear,
          amount,
          originalAmount,
          setOffAmount,
          offsetAmount: setOffAmount,
          signedOffsetTeamName: row?.setOffTeamName || row?.setOffSignedWith || row?.offsetTeamName || signedInfo?.teamName || "",
          signedOffsetSalary: Number(row?.setOffSignedSalary || row?.setOffReplacementSalary || row?.offsetSignedSalary || signedInfo?.signedSalary || 0),
          reason: row?.reason || "release",
          sourceRow: {
            ...row,
            amount,
            originalAmount,
            setOffAmount,
            offsetAmount: setOffAmount,
            setOffTeamName: row?.setOffTeamName || row?.setOffSignedWith || row?.offsetTeamName || signedInfo?.teamName || "",
            setOffSignedWith: row?.setOffSignedWith || row?.setOffTeamName || row?.offsetTeamName || signedInfo?.teamName || "",
            setOffSignedSalary: Number(row?.setOffSignedSalary || row?.setOffReplacementSalary || row?.offsetSignedSalary || signedInfo?.signedSalary || 0),
            setOffReplacementSalary: Number(row?.setOffReplacementSalary || row?.setOffSignedSalary || row?.offsetSignedSalary || signedInfo?.signedSalary || 0),
          },
        };
      })
      .filter((row) => row.amount > 0 && row.seasonYear >= currentSeasonYear)
      .sort((a, b) => {
        const yearDiff = Number(a.seasonYear || 0) - Number(b.seasonYear || 0);
        if (yearDiff !== 0) return yearDiff;
        return String(a.playerName || "").localeCompare(String(b.playerName || ""));
      });
  }, [leagueData, selectedTeam?.name, currentSeasonYear]);

  const deadCapTotal = useMemo(() => {
    return deadCapRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  }, [deadCapRows]);

  const DISPLAY_YEARS = 5;

  const deadCapPlayerRows = useMemo(() => {
    if (!deadCapRows.length) return [];

    const allPlayers = [
      ...(leagueData?.freeAgents || []),
      ...Object.values(leagueData?.conferences || {}).flatMap((teams) =>
        (teams || []).flatMap((team) => team?.players || [])
      ),
    ];

    const findPlayerProfile = (row) => {
      const playerId = row?.playerId;
      const playerName = row?.playerName;

      return allPlayers.find((player) => {
        if (
          playerId !== undefined &&
          playerId !== null &&
          playerId !== "" &&
          String(player?.id) === String(playerId)
        ) {
          return true;
        }

        return Boolean(playerName && player?.name === playerName);
      }) || null;
    };

    const grouped = new Map();

    for (const row of deadCapRows) {
      const key =
        row?.playerId !== undefined && row?.playerId !== null && row?.playerId !== ""
          ? `id:${row.playerId}`
          : `name:${row.playerName || "Released Player"}`;

      const profile = findPlayerProfile(row);
      const sourceRow = row?.sourceRow || {};

      if (!grouped.has(key)) {
        grouped.set(key, {
          id: `dead-cap-${selectedTeam?.name || "team"}-${key}`,
          playerId: row?.playerId ?? null,
          playerName: row?.playerName || "Released Player",
          pos: sourceRow?.pos || sourceRow?.position || profile?.pos || profile?.position || "-",
          overall: sourceRow?.overall ?? profile?.overall ?? "-",
          headshot:
            sourceRow?.headshot ||
            sourceRow?.playerHeadshot ||
            sourceRow?.image ||
            profile?.headshot ||
            profile?.playerHeadshot ||
            profile?.image ||
            "",
          salaryBySeason: {},
          grossBySeason: {},
          setOffBySeason: {},
          seasons: [],
          totalRemaining: 0,
          grossTotalRemaining: 0,
          totalSetOff: 0,
          offsetTeamNames: [],
          reason: row?.reason || "release",
          stretchApplied: false,
          stretchYears: 0,
          stretchAnnualAmount: 0,
          remainingContractYears: 0,
          totalGuaranteedOwed: 0,
          firstDeadCapSeason: null,
          lastDeadCapSeason: null,
          sourceRows: [],
        });
      }

      const item = grouped.get(key);
      const seasonYear = Number(row?.seasonYear || 0);
      const amount = Number(row?.amount || 0);
      const originalAmount = Number(row?.originalAmount || amount);
      const setOffAmount = Number(row?.setOffCredit || row?.setOffAmount || row?.offsetAmount || 0);

      if (row?.stretchApplied || sourceRow?.stretchApplied) {
        item.stretchApplied = true;
        item.stretchYears = Math.max(item.stretchYears || 0, Number(row?.stretchYears || sourceRow?.stretchYears || 0));
        item.stretchAnnualAmount = Math.max(item.stretchAnnualAmount || 0, Number(row?.stretchAnnualAmount || sourceRow?.stretchAnnualAmount || originalAmount || 0));
        item.remainingContractYears = Math.max(item.remainingContractYears || 0, Number(row?.remainingContractYears || sourceRow?.remainingContractYears || 0));
        item.totalGuaranteedOwed = Math.max(item.totalGuaranteedOwed || 0, Number(row?.totalGuaranteedOwed || sourceRow?.totalGuaranteedOwed || 0));
        item.firstDeadCapSeason = item.firstDeadCapSeason === null
          ? Number(row?.firstDeadCapSeason || sourceRow?.firstDeadCapSeason || seasonYear)
          : Math.min(item.firstDeadCapSeason, Number(row?.firstDeadCapSeason || sourceRow?.firstDeadCapSeason || seasonYear));
        item.lastDeadCapSeason = item.lastDeadCapSeason === null
          ? Number(row?.lastDeadCapSeason || sourceRow?.lastDeadCapSeason || seasonYear)
          : Math.max(item.lastDeadCapSeason, Number(row?.lastDeadCapSeason || sourceRow?.lastDeadCapSeason || seasonYear));
      }

      item.salaryBySeason[seasonYear] =
        Number(item.salaryBySeason[seasonYear] || 0) + amount;
      item.grossBySeason[seasonYear] =
        Number(item.grossBySeason[seasonYear] || 0) + originalAmount;
      item.setOffBySeason[seasonYear] =
        Number(item.setOffBySeason[seasonYear] || 0) + setOffAmount;

      if (!item.seasons.includes(seasonYear)) {
        item.seasons.push(seasonYear);
      }

      item.totalRemaining += amount;
      item.grossTotalRemaining += originalAmount;
      item.totalSetOff += setOffAmount;
      if (setOffAmount > 0 && row?.signedOffsetTeamName && !item.offsetTeamNames.includes(row.signedOffsetTeamName)) {
        item.offsetTeamNames.push(row.signedOffsetTeamName);
      }
      item.sourceRows.push(row);

      if (!item.headshot && profile?.headshot) {
        item.headshot = profile.headshot;
      }
      if ((item.overall === "-" || item.overall === undefined) && profile?.overall !== undefined) {
        item.overall = profile.overall;
      }
      if ((!item.pos || item.pos === "-") && (profile?.pos || profile?.position)) {
        item.pos = profile.pos || profile.position;
      }
    }

    return Array.from(grouped.values())
      .map((row) => {
        const seasons = [...row.seasons].sort((a, b) => a - b);
        const firstSeason = seasons[0] || currentSeasonYear;
        const lastSeason = seasons[seasons.length - 1] || currentSeasonYear;

        return {
          ...row,
          seasons,
          firstSeason,
          lastSeason,
          seasonRange:
            firstSeason === lastSeason
              ? String(firstSeason)
              : `${firstSeason}-${lastSeason}`,
          displaySeasonNote:
            lastSeason > currentSeasonYear + DISPLAY_YEARS - 1
              ? `Table shows next ${DISPLAY_YEARS} seasons. Dead cap continues through ${lastSeason}.`
              : "",
          salaryByYear: Array.from({ length: DISPLAY_YEARS }, (_, i) => {
            const seasonYear = currentSeasonYear + i;
            return Number(row.salaryBySeason[seasonYear] || 0);
          }),
        };
      })
      .sort((a, b) => {
        const amountDiff = Number(b.totalRemaining || 0) - Number(a.totalRemaining || 0);
        if (amountDiff !== 0) return amountDiff;
        return String(a.playerName || "").localeCompare(String(b.playerName || ""));
      });
  }, [deadCapRows, leagueData, selectedTeam?.name, currentSeasonYear]);


  const getSalaryRowCurrentDisplayValue = (row) => {
    const contract = row?.contract || {};
    const startYear = Number(contract?.startYear || currentSeasonYear);
    const salaryByYear = Array.isArray(contract?.salaryByYear) ? contract.salaryByYear : [];
    const idx = currentSeasonYear - startYear;

    if (idx >= 0 && idx < salaryByYear.length) {
      return Number(salaryByYear[idx] || 0);
    }

    return Number(salaryByYear?.[0] || 0);
  };

  const sortSalaryRowsByContractValue = (rows = []) => {
    return [...rows].sort((a, b) => {
      const currentSalaryDiff = getSalaryRowCurrentDisplayValue(b) - getSalaryRowCurrentDisplayValue(a);
      if (currentSalaryDiff !== 0) return currentSalaryDiff;

      const totalDiff = Number(b?.totalRemaining || 0) - Number(a?.totalRemaining || 0);
      if (totalDiff !== 0) return totalDiff;

      const overallDiff = Number(b?.overall || 0) - Number(a?.overall || 0);
      if (overallDiff !== 0) return overallDiff;

      return String(a?.name || "").localeCompare(String(b?.name || ""));
    });
  };

  const players = useMemo(() => {
    const pls = selectedTeam?.players || [];

    const rosterRows = pls.map((p) => {
      const c = normalizeContract(p);
      const years = Math.max(1, c.salaryByYear.length || 1);
      const endYear = c.salaryByYear.length
        ? c.startYear + c.salaryByYear.length - 1
        : c.startYear;

      const totalRemaining = c.salaryByYear.reduce((s, v, idx) => {
        const seasonYear = c.startYear + idx;
        if (seasonYear < currentSeasonYear) return s;
        return s + (Number(v) || 0);
      }, 0);

      const expType = getExpType(p);
      const expNote = getExpNote(p, expType);

      return {
        id: p?.id || `${p?.name || "player"}-${p?.pos || "pos"}`,
        name: p?.name || "Unknown",
        pos: p?.pos || "",
        overall: p?.overall ?? "-",
        headshot: getPlayerImage(p),
        contract: c,
        years,
        endYear,
        totalRemaining,
        optionLabel: getOptionLabel(c),
        expType,
        expNote,
        isCapHold: false,
      };
    });

    const twoWayRows = getTwoWayPlayers(selectedTeam).map(buildTwoWaySalaryRow);
    const stashRows = getStashPlayers(selectedTeam).map(buildStashSalaryRow);

    const holdRows = capHoldRows.map((row) => ({
      id: `cap-hold-${row.playerKey}`,
      name: row.playerName,
      pos: row.position,
      overall: row.overall,
      headshot: row.headshot,
      contract: {
        startYear: currentSeasonYear,
        salaryByYear: [Number(row.capHold || 0)],
        option: null,
      },
      years: 1,
      endYear: currentSeasonYear,
      totalRemaining: Number(row.capHold || 0),
      optionLabel: `${row.restrictedFreeAgent ? "RFA" : row.rightsLabel} Cap Hold`,
      expType: row.restrictedFreeAgent ? "RFA HOLD" : "HOLD",
      expNote: row.note,
      isCapHold: true,
      capHoldAmount: Number(row.capHold || 0),
      capHoldInfo: row,
    }));

    const deadRows = deadCapPlayerRows.map((row) => ({
      id: row.id,
      name: row.playerName,
      pos: row.pos || "-",
      overall: row.overall ?? "-",
      headshot: row.headshot || "",
      contract: {
        startYear: currentSeasonYear,
        salaryByYear: row.salaryByYear,
        option: null,
      },
      years: Math.max(1, row.seasons?.length || 1),
      endYear: row.lastSeason || currentSeasonYear,
      totalRemaining: Number(row.totalRemaining || 0),
      optionLabel: "Released Player Dead Cap",
      expType: "DEAD CAP",
      expNote: `${row.playerName} was released, but the original remaining guaranteed salary still counts against ${selectedTeam?.name || "the team"}'s cap from ${row.seasonRange}.`,
      isCapHold: false,
      isDeadCap: true,
      deadCapAmount: Number(row.totalRemaining || 0),
      deadCapInfo: row,
    }));

    return sortSalaryRowsByContractValue([...rosterRows, ...twoWayRows, ...stashRows, ...deadRows, ...holdRows]);
  }, [selectedTeam, currentSeasonYear, capHoldRows, deadCapPlayerRows]);

  const yearColumns = useMemo(() => {
    return Array.from({ length: DISPLAY_YEARS }, (_, i) => currentSeasonYear + i);
  }, [currentSeasonYear]);

  const teamTotalsByYear = useMemo(() => {
    const totals = yearColumns.map(() => 0);

    for (const p of players) {
      if (p.excludeFromPayroll) continue;
      for (let i = 0; i < yearColumns.length; i++) {
        const seasonYear = yearColumns[i];
        const idx = seasonYear - p.contract.startYear;
        const sal = idx >= 0 ? Number(p.contract.salaryByYear[idx] || 0) : 0;
        totals[i] += sal;
      }
    }

    return totals;
  }, [players, yearColumns]);

  const teamTotalAllYears = useMemo(() => {
    return teamTotalsByYear.reduce((s, v) => s + (Number(v) || 0), 0);
  }, [teamTotalsByYear]);

  const payrollThisYear = teamTotalsByYear?.[0] ?? 0;

  const capStatus = useMemo(() => {
    if (payrollThisYear >= HARD_CAP) return { label: "Hard Cap", tone: "danger" };
    if (payrollThisYear >= SECOND_APRON) return { label: "2nd Apron", tone: "danger" };
    if (payrollThisYear >= FIRST_APRON) return { label: "1st Apron", tone: "warn" };
    if (payrollThisYear >= TAX_LINE) return { label: "Luxury Tax", tone: "warn" };
    if (payrollThisYear >= SALARY_CAP) return { label: "Over Cap", tone: "neutral" };
    return { label: "Below Cap", tone: "good" };
  }, [payrollThisYear, HARD_CAP, SECOND_APRON, FIRST_APRON, TAX_LINE, SALARY_CAP]);

  const toneClass = (tone) => {
    if (tone === "danger") return "bg-red-500/15 text-red-200 border-red-400/25";
    if (tone === "warn") return "bg-orange-500/15 text-orange-200 border-orange-400/25";
    if (tone === "good") return "bg-emerald-500/15 text-emerald-200 border-emerald-400/25";
    return "bg-white/10 text-white/80 border-white/15";
  };


  const buildCapHoldRowsForTeam = (teamName) => {
    if (!teamName || !isFreeAgencyMode) return [];

    return (leagueData?.freeAgents || [])
      .map((player) => {
        const rights = getRights(player);
        const capHold = getCapHoldForPlayer(player, teamName);
        const birdLevel = rights?.birdLevel || "none";
        const restrictedFreeAgent = Boolean(rights?.restrictedFreeAgent || player?.qualifyingOffer?.amount);
        const previousSalary = getPreviousSalaryForCapHold(player);
        const marketYearOne = Number(player?.marketValue?.expectedYear1Salary || MIN_CONTRACT_AMOUNT);
        const rightsLabel = formatBirdLabel(birdLevel);
        const note = restrictedFreeAgent
          ? `${player?.name || "This player"} is on a cap hold because ${teamName} still controls his RFA rights. The hold counts against practical cap room until you re-sign him, he signs elsewhere, or you renounce his rights.`
          : `${player?.name || "This player"} is on a cap hold because ${teamName} still holds ${rightsLabel} rights. The hold counts against practical cap room until you re-sign him, he signs elsewhere, or you renounce his rights.`;

        return {
          player,
          playerKey: getPlayerKey(player),
          playerName: player?.name || "Unknown",
          position: player?.pos || player?.position || "",
          overall: player?.overall ?? "-",
          headshot: player?.headshot || "",
          capHold,
          birdLevel,
          rightsLabel,
          restrictedFreeAgent,
          previousSalary,
          marketYearOne,
          note,
        };
      })
      .filter((row) => row.capHold > 0)
      .sort((a, b) => Number(b.capHold || 0) - Number(a.capHold || 0));
  };

  const buildDeadCapRowsForTeam = (teamName) => {
    if (!teamName) return [];

    const savedDeadCapRows = Array.isArray(leagueData?.deadCapByTeam?.[teamName])
      ? leagueData.deadCapByTeam[teamName]
      : [];
    const rawRows = normalizeDeadCapRowsForNoStretch(savedDeadCapRows, teamName);

    return rawRows
      .map((row, idx) => {
        const seasonYear = Number(row?.seasonYear || 0);
        const savedSetOff = Number(row?.setOffCredit || row?.setOffAmount || row?.offsetAmount || 0);
        const savedAmount = Number(row?.amount ?? row?.netAmount ?? 0);
        const originalAmount = Number(
          row?.originalAmount ||
          row?.guaranteedAmount ||
          row?.grossAmount ||
          (savedSetOff > 0 ? savedAmount + savedSetOff : savedAmount) ||
          0
        );
        const signedInfo = findSignedPlayerForDeadCapRow(
          { ...row, seasonYear },
          teamName
        );
        const calculatedSetOff = signedInfo
          ? calculateDeadCapSetOff(originalAmount, signedInfo.signedSalary)
          : 0;
        const setOffAmount = Math.max(savedSetOff, calculatedSetOff);
        const amount = Math.max(0, originalAmount - setOffAmount);

        return {
          id: `dead-cap-${teamName}-${row?.playerId || row?.playerName || idx}-${seasonYear}`,
          playerId: row?.playerId ?? null,
          playerName: row?.playerName || row?.name || "Released Player",
          seasonYear,
          amount,
          originalAmount,
          setOffAmount,
          offsetAmount: setOffAmount,
          signedOffsetTeamName: row?.setOffTeamName || row?.setOffSignedWith || row?.offsetTeamName || signedInfo?.teamName || "",
          signedOffsetSalary: Number(row?.setOffSignedSalary || row?.setOffReplacementSalary || row?.offsetSignedSalary || signedInfo?.signedSalary || 0),
          reason: row?.reason || "release",
          sourceRow: {
            ...row,
            amount,
            originalAmount,
            setOffAmount,
            offsetAmount: setOffAmount,
            setOffTeamName: row?.setOffTeamName || row?.setOffSignedWith || row?.offsetTeamName || signedInfo?.teamName || "",
            setOffSignedWith: row?.setOffSignedWith || row?.setOffTeamName || row?.offsetTeamName || signedInfo?.teamName || "",
            setOffSignedSalary: Number(row?.setOffSignedSalary || row?.setOffReplacementSalary || row?.offsetSignedSalary || signedInfo?.signedSalary || 0),
            setOffReplacementSalary: Number(row?.setOffReplacementSalary || row?.setOffSignedSalary || row?.offsetSignedSalary || signedInfo?.signedSalary || 0),
          },
        };
      })
      .filter((row) => row.amount > 0 && row.seasonYear >= currentSeasonYear)
      .sort((a, b) => {
        const yearDiff = Number(a.seasonYear || 0) - Number(b.seasonYear || 0);
        if (yearDiff !== 0) return yearDiff;
        return String(a.playerName || "").localeCompare(String(b.playerName || ""));
      });
  };

  const buildDeadCapPlayerRowsForTeam = (teamName, rows) => {
    if (!rows.length) return [];

    const allPlayers = [
      ...(leagueData?.freeAgents || []),
      ...Object.values(leagueData?.conferences || {}).flatMap((teams) =>
        (teams || []).flatMap((team) => team?.players || [])
      ),
    ];

    const findPlayerProfile = (row) => {
      const playerId = row?.playerId;
      const playerName = row?.playerName;

      return allPlayers.find((player) => {
        if (
          playerId !== undefined &&
          playerId !== null &&
          playerId !== "" &&
          String(player?.id) === String(playerId)
        ) {
          return true;
        }

        return Boolean(playerName && player?.name === playerName);
      }) || null;
    };

    const grouped = new Map();

    for (const row of rows) {
      const key =
        row?.playerId !== undefined && row?.playerId !== null && row?.playerId !== ""
          ? `id:${row.playerId}`
          : `name:${row.playerName || "Released Player"}`;

      const profile = findPlayerProfile(row);
      const sourceRow = row?.sourceRow || {};

      if (!grouped.has(key)) {
        grouped.set(key, {
          id: `dead-cap-${teamName || "team"}-${key}`,
          playerId: row?.playerId ?? null,
          playerName: row?.playerName || "Released Player",
          pos: sourceRow?.pos || sourceRow?.position || profile?.pos || profile?.position || "-",
          overall: sourceRow?.overall ?? profile?.overall ?? "-",
          headshot:
            sourceRow?.headshot ||
            sourceRow?.playerHeadshot ||
            sourceRow?.image ||
            profile?.headshot ||
            profile?.playerHeadshot ||
            profile?.image ||
            "",
          salaryBySeason: {},
          grossBySeason: {},
          setOffBySeason: {},
          seasons: [],
          totalRemaining: 0,
          grossTotalRemaining: 0,
          totalSetOff: 0,
          offsetTeamNames: [],
          reason: row?.reason || "release",
          stretchApplied: false,
          stretchYears: 0,
          stretchAnnualAmount: 0,
          remainingContractYears: 0,
          totalGuaranteedOwed: 0,
          firstDeadCapSeason: null,
          lastDeadCapSeason: null,
          sourceRows: [],
        });
      }

      const item = grouped.get(key);
      const seasonYear = Number(row?.seasonYear || 0);
      const amount = Number(row?.amount || 0);
      const originalAmount = Number(row?.originalAmount || amount);
      const setOffAmount = Number(row?.setOffCredit || row?.setOffAmount || row?.offsetAmount || 0);

      if (row?.stretchApplied || sourceRow?.stretchApplied) {
        item.stretchApplied = true;
        item.stretchYears = Math.max(item.stretchYears || 0, Number(row?.stretchYears || sourceRow?.stretchYears || 0));
        item.stretchAnnualAmount = Math.max(item.stretchAnnualAmount || 0, Number(row?.stretchAnnualAmount || sourceRow?.stretchAnnualAmount || originalAmount || 0));
        item.remainingContractYears = Math.max(item.remainingContractYears || 0, Number(row?.remainingContractYears || sourceRow?.remainingContractYears || 0));
        item.totalGuaranteedOwed = Math.max(item.totalGuaranteedOwed || 0, Number(row?.totalGuaranteedOwed || sourceRow?.totalGuaranteedOwed || 0));
        item.firstDeadCapSeason = item.firstDeadCapSeason === null
          ? Number(row?.firstDeadCapSeason || sourceRow?.firstDeadCapSeason || seasonYear)
          : Math.min(item.firstDeadCapSeason, Number(row?.firstDeadCapSeason || sourceRow?.firstDeadCapSeason || seasonYear));
        item.lastDeadCapSeason = item.lastDeadCapSeason === null
          ? Number(row?.lastDeadCapSeason || sourceRow?.lastDeadCapSeason || seasonYear)
          : Math.max(item.lastDeadCapSeason, Number(row?.lastDeadCapSeason || sourceRow?.lastDeadCapSeason || seasonYear));
      }

      item.salaryBySeason[seasonYear] =
        Number(item.salaryBySeason[seasonYear] || 0) + amount;
      item.grossBySeason[seasonYear] =
        Number(item.grossBySeason[seasonYear] || 0) + originalAmount;
      item.setOffBySeason[seasonYear] =
        Number(item.setOffBySeason[seasonYear] || 0) + setOffAmount;

      if (!item.seasons.includes(seasonYear)) {
        item.seasons.push(seasonYear);
      }

      item.totalRemaining += amount;
      item.grossTotalRemaining += originalAmount;
      item.totalSetOff += setOffAmount;
      if (setOffAmount > 0 && row?.signedOffsetTeamName && !item.offsetTeamNames.includes(row.signedOffsetTeamName)) {
        item.offsetTeamNames.push(row.signedOffsetTeamName);
      }
      item.sourceRows.push(row);

      if (!item.headshot && profile?.headshot) {
        item.headshot = profile.headshot;
      }
      if ((item.overall === "-" || item.overall === undefined) && profile?.overall !== undefined) {
        item.overall = profile.overall;
      }
      if ((!item.pos || item.pos === "-") && (profile?.pos || profile?.position)) {
        item.pos = profile.pos || profile.position;
      }
    }

    return Array.from(grouped.values())
      .map((row) => {
        const seasons = [...row.seasons].sort((a, b) => a - b);
        const firstSeason = seasons[0] || currentSeasonYear;
        const lastSeason = seasons[seasons.length - 1] || currentSeasonYear;

        return {
          ...row,
          seasons,
          firstSeason,
          lastSeason,
          seasonRange:
            firstSeason === lastSeason
              ? String(firstSeason)
              : `${firstSeason}-${lastSeason}`,
          displaySeasonNote:
            lastSeason > currentSeasonYear + DISPLAY_YEARS - 1
              ? `Table shows next ${DISPLAY_YEARS} seasons. Dead cap continues through ${lastSeason}.`
              : "",
          salaryByYear: Array.from({ length: DISPLAY_YEARS }, (_, i) => {
            const seasonYear = currentSeasonYear + i;
            return Number(row.salaryBySeason[seasonYear] || 0);
          }),
        };
      })
      .sort((a, b) => {
        const amountDiff = Number(b.totalRemaining || 0) - Number(a.totalRemaining || 0);
        if (amountDiff !== 0) return amountDiff;
        return String(a.playerName || "").localeCompare(String(b.playerName || ""));
      });
  };

  const buildPlayerRowsForTeam = (team, teamCapHoldRows, teamDeadCapPlayerRows) => {
    const rosterRows = (team?.players || []).map((p) => {
      const c = normalizeContract(p);
      const years = Math.max(1, c.salaryByYear.length || 1);
      const endYear = c.salaryByYear.length
        ? c.startYear + c.salaryByYear.length - 1
        : c.startYear;

      const totalRemaining = c.salaryByYear.reduce((s, v, idx) => {
        const seasonYear = c.startYear + idx;
        if (seasonYear < currentSeasonYear) return s;
        return s + (Number(v) || 0);
      }, 0);

      const expType = getExpType(p);
      const expNote = getExpNote(p, expType);

      return {
        id: p?.id || `${p?.name || "player"}-${p?.pos || "pos"}`,
        name: p?.name || "Unknown",
        pos: p?.pos || "",
        overall: p?.overall ?? "-",
        headshot: getPlayerImage(p),
        contract: c,
        years,
        endYear,
        totalRemaining,
        optionLabel: getOptionLabel(c),
        expType,
        expNote,
        isCapHold: false,
      };
    });

    const twoWayRows = getTwoWayPlayers(team).map(buildTwoWaySalaryRow);
    const stashRows = getStashPlayers(team).map(buildStashSalaryRow);

    const holdRows = teamCapHoldRows.map((row) => ({
      id: `cap-hold-${row.playerKey}`,
      name: row.playerName,
      pos: row.position,
      overall: row.overall,
      headshot: row.headshot,
      contract: {
        startYear: currentSeasonYear,
        salaryByYear: [Number(row.capHold || 0)],
        option: null,
      },
      years: 1,
      endYear: currentSeasonYear,
      totalRemaining: Number(row.capHold || 0),
      optionLabel: `${row.restrictedFreeAgent ? "RFA" : row.rightsLabel} Cap Hold`,
      expType: row.restrictedFreeAgent ? "RFA HOLD" : "HOLD",
      expNote: row.note,
      isCapHold: true,
      capHoldAmount: Number(row.capHold || 0),
      capHoldInfo: row,
    }));

    const deadRows = teamDeadCapPlayerRows.map((row) => ({
      id: row.id,
      name: row.playerName,
      pos: row.pos || "-",
      overall: row.overall ?? "-",
      headshot: row.headshot || "",
      contract: {
        startYear: currentSeasonYear,
        salaryByYear: row.salaryByYear,
        option: null,
      },
      years: row.salaryByYear.length || 1,
      endYear: row.lastSeason || currentSeasonYear,
      totalRemaining: Number(row.totalRemaining || 0),
      optionLabel: row.stretchApplied ? "Stretched Released Salary" : "Released Player Dead Cap",
      expType: `${row.lastSeason || currentSeasonYear} DEAD CAP`,
      expNote: row.displaySeasonNote || getExpNote({ rights: {} }, "DEAD"),
      isDeadCap: true,
      deadCapAmount: Number(row.totalRemaining || 0),
      deadCapInfo: row,
    }));

    return sortSalaryRowsByContractValue([...rosterRows, ...twoWayRows, ...stashRows, ...deadRows, ...holdRows]);
  };

  const buildSalaryTableSnapshotForTeam = (team) => {
    const teamName = team?.name || "Unknown Team";
    const teamCapHoldRows = buildCapHoldRowsForTeam(teamName);
    const teamDeadCapRows = buildDeadCapRowsForTeam(teamName);
    const teamDeadCapPlayerRows = buildDeadCapPlayerRowsForTeam(teamName, teamDeadCapRows);
    const teamPlayers = buildPlayerRowsForTeam(team, teamCapHoldRows, teamDeadCapPlayerRows);
    const totalsByYear = yearColumns.map((seasonYear) => {
      return teamPlayers.reduce((sum, player) => {
        if (player.excludeFromPayroll) return sum;
        const idx = seasonYear - player.contract.startYear;
        const sal = idx >= 0 ? Number(player.contract.salaryByYear[idx] || 0) : 0;
        return sum + sal;
      }, 0);
    });
    const payroll = totalsByYear?.[0] ?? 0;
    const status = (() => {
      if (payroll >= HARD_CAP) return { label: "Hard Cap", tone: "danger" };
      if (payroll >= SECOND_APRON) return { label: "2nd Apron", tone: "danger" };
      if (payroll >= FIRST_APRON) return { label: "1st Apron", tone: "warn" };
      if (payroll >= TAX_LINE) return { label: "Luxury Tax", tone: "warn" };
      if (payroll >= SALARY_CAP) return { label: "Over Cap", tone: "neutral" };
      return { label: "Below Cap", tone: "good" };
    })();

    return {
      team,
      teamName,
      players: teamPlayers,
      capHoldRows: teamCapHoldRows,
      capHoldTotal: teamCapHoldRows.reduce((sum, row) => sum + Number(row.capHold || 0), 0),
      deadCapPlayerRows: teamDeadCapPlayerRows,
      deadCapTotal: teamDeadCapRows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      totalsByYear,
      totalAllYears: totalsByYear.reduce((sum, value) => sum + Number(value || 0), 0),
      payrollThisYear: payroll,
      capStatus: status,
      logo: team?.logo || team?.teamLogo || team?.logoUrl || "",
      rosterCount: Array.isArray(team?.players) ? team.players.length : 0,
      twoWayCount: getTwoWayPlayers(team).length,
      stashCount: getStashPlayers(team).length,
    };
  };

  const allTeamSalaryTables = useMemo(() => {
    if (!isAllTeamsView) return [];

    return allTeamsFlat
      .map((meta) => leagueData?.conferences?.[meta.conf]?.[meta.teamIdx])
      .filter(Boolean)
      .map((team) => buildSalaryTableSnapshotForTeam(team));
  }, [isAllTeamsView, allTeamsFlat, leagueData, currentSeasonYear, isFreeAgencyMode, yearColumns]);

  const renderSalaryTablePanel = (snapshot, compact = false) => {
    if (!snapshot?.team) return null;

    return (
      <div
        key={`salary-table-${snapshot.teamName}`}
        className={`${styles.bmTablePanel} border border-white/10 rounded-2xl shadow-2xl overflow-hidden ${compact ? "scroll-mt-6" : ""}`}
      >
        <div className={`${compact ? "p-4" : "p-5"} border-b border-white/10 flex flex-col gap-3`}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              {snapshot.logo ? (
                <img src={snapshot.logo} alt="" className="w-10 h-10 object-contain" />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/10" />
              )}

              <div>
                <div className={`${compact ? "text-xl" : "text-2xl"} font-extrabold`}>{snapshot.teamName} Salary Table</div>
                <div className="text-white/60 text-sm">
                  {snapshot.rosterCount} standard + {snapshot.twoWayCount || 0} two-way + {snapshot.stashCount || 0} stash
                  {snapshot.deadCapPlayerRows.length > 0 ? ` + ${snapshot.deadCapPlayerRows.length} dead cap` : ""}
                  {snapshot.capHoldRows.length > 0 ? ` + ${snapshot.capHoldRows.length} cap holds` : ""}
                </div>
              </div>
            </div>

            <div className={`px-3 py-2 rounded-xl border text-sm ${toneClass(snapshot.capStatus.tone)}`}>
              <div className="font-semibold">{snapshot.capStatus.label}</div>
              <div className="text-xs opacity-80">
                {snapshot.deadCapPlayerRows.length > 0 || snapshot.capHoldRows.length > 0 ? "Payroll + Adjustments" : "Payroll"} {yearColumns[0]}: {fmtM(snapshot.payrollThisYear)}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Chip label={`Salary Cap: ${fmtM(SALARY_CAP)}`} />
            <Chip label={`Luxury Tax: ${fmtM(TAX_LINE)}`} />
            <Chip label={`1st Apron: ${fmtM(FIRST_APRON)}`} />
            <Chip label={`2nd Apron: ${fmtM(SECOND_APRON)}`} />
            <Chip label={`Hard Cap: ${fmtM(HARD_CAP)}`} />
            {snapshot.deadCapPlayerRows.length > 0 && <Chip label={`Dead Cap: ${fmtM(snapshot.deadCapTotal)}`} />}
            {(snapshot.twoWayCount || 0) > 0 && <Chip label={`Two-Way: ${snapshot.twoWayCount}/3`} />}
            {(snapshot.stashCount || 0) > 0 && <Chip label={`Stash: ${snapshot.stashCount}`} />}
            {snapshot.capHoldRows.length > 0 && <Chip label={`Cap Holds: ${fmtM(snapshot.capHoldTotal)}`} />}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead className="bg-white/5 border-b border-white/10">
              <tr className="text-white/70 text-sm">
                <th className="text-left px-4 py-3">Player</th>
                <th className="text-center px-3 py-3">Pos</th>
                <th className="text-center px-3 py-3">OVR</th>
                {yearColumns.map((y) => (
                  <th key={y} className="text-right px-3 py-3 whitespace-nowrap">
                    {y}
                  </th>
                ))}
                <th className="text-right px-3 py-3 whitespace-nowrap">Total Remaining</th>
                <th className="text-center px-3 py-3 whitespace-nowrap">Exp.</th>
              </tr>
            </thead>

            <tbody>
              {snapshot.players.map((p) => (
                <tr
                  key={`${snapshot.teamName}-${p.id}`}
                  className={`${p.isDeadCap ? "border-b border-red-500/45 bg-red-500/10 hover:bg-red-500/15" : p.isCapHold ? "border-b border-red-500/35 bg-red-500/5 hover:bg-red-500/10" : p.isTwoWay ? "border-b border-emerald-400/10 bg-emerald-500/5 hover:bg-emerald-500/10" : p.isStash ? "border-b border-amber-400/10 bg-amber-500/5 hover:bg-amber-500/10" : "border-b border-white/5 hover:bg-white/5"} transition`}
                  style={p.isDeadCap || p.isCapHold ? { boxShadow: "inset 0 0 0 1px rgba(248, 113, 113, 0.35)" } : undefined}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {p.headshot ? (
                        <img
                          src={p.headshot}
                          alt={p.name}
                          className={`w-12 h-12 rounded-full object-cover border bg-white/5 ${p.isDeadCap || p.isCapHold ? "border-red-400/35" : "border-white/10"}`}
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      ) : (
                        <div className={`w-12 h-12 rounded-full bg-white/5 border ${p.isDeadCap || p.isCapHold ? "border-red-400/35" : "border-white/10"}`} />
                      )}

                      <div className="leading-tight">
                        <div className="font-semibold flex items-center gap-2">
                          <span>{p.name}</span>
                          {p.isTwoWay && (
                            <span className="inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-extrabold text-emerald-200">
                              2W
                            </span>
                          )}
                          {p.isStash && (
                            <span className="inline-flex items-center rounded-full border border-amber-400/25 bg-amber-500/15 px-2 py-0.5 text-[10px] font-extrabold text-amber-200">
                              STASH
                            </span>
                          )}
                          {p.isDeadCap && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeadCapInfo(p);
                              }}
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-red-400/45 bg-red-500/20 text-[11px] font-extrabold text-red-100 hover:bg-red-500/30 transition"
                              title="Explain dead cap"
                              aria-label={`Explain ${p.name} dead cap`}
                            >
                              ?
                            </button>
                          )}
                          {p.isCapHold && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCapHoldInfo(p);
                              }}
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-red-400/45 bg-red-500/15 text-[11px] font-extrabold text-red-100 hover:bg-red-500/25 transition"
                              title="Explain cap hold"
                              aria-label={`Explain ${p.name} cap hold`}
                            >
                              ?
                            </button>
                          )}
                        </div>
                        <div className={p.isDeadCap || p.isCapHold ? "text-xs text-red-200/75" : "text-xs text-white/50"}>
                          {p.optionLabel}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="text-center px-3 py-3 text-white/85">{p.pos}</td>
                  <td className="text-center px-3 py-3 font-semibold text-orange-300">{p.overall}</td>

                  {yearColumns.map((seasonYear) => {
                    const idx = seasonYear - p.contract.startYear;
                    const sal = idx >= 0 ? Number(p.contract.salaryByYear[idx] || 0) : 0;
                    const isBig = sal >= 25_000_000;
                    const salClass = p.isDeadCap || p.isCapHold ? "text-red-200 font-extrabold" : isBig ? "text-emerald-300" : "text-white/85";

                    return (
                      <td
                        key={`${snapshot.teamName}-${p.id}-${seasonYear}`}
                        className={`text-right px-3 py-3 whitespace-nowrap ${
                          sal > 0 ? salClass : "text-white/35"
                        }`}
                      >
                        {sal > 0 ? fmtM(sal) : "-"}
                      </td>
                    );
                  })}

                  <td className={`text-right px-3 py-3 whitespace-nowrap font-extrabold ${p.isDeadCap || p.isCapHold ? "text-red-200" : "text-emerald-300"}`}>
                    {fmtM(p.totalRemaining)}
                  </td>

                  <td className="text-center px-3 py-3 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center justify-center gap-1 rounded-full border px-2.5 py-1 text-xs font-extrabold ${getExpChipClass(p.expType)}`}
                      title={p.expNote}
                    >
                      {p.endYear} {p.expType}
                    </span>
                  </td>
                </tr>
              ))}

              <tr className="bg-white/5">
                <td className="px-4 py-3 font-extrabold text-white/90" colSpan={3}>
                  Team Totals:
                </td>

                {yearColumns.map((y, i) => {
                  const total = snapshot.totalsByYear[i] || 0;
                  const overTax = i === 0 && total >= TAX_LINE;
                  const overCap = i === 0 && total >= SALARY_CAP;

                  return (
                    <td
                      key={`${snapshot.teamName}-tot-${y}`}
                      className={`text-right px-3 py-3 whitespace-nowrap font-extrabold ${
                        overTax ? "text-red-300" : overCap ? "text-orange-300" : "text-white/85"
                      }`}
                    >
                      {fmtM(total)}
                    </td>
                  );
                })}

                <td className="text-right px-3 py-3 whitespace-nowrap font-extrabold text-emerald-300">
                  {fmtM(snapshot.totalAllYears)}
                </td>

                <td className="text-center px-3 py-3 whitespace-nowrap text-white/40">-</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const emptyTeams =
    (leagueData?.conferences?.East?.length || 0) +
    (leagueData?.conferences?.West?.length || 0) === 0;

  if (!leagueData) {
    return (
      <PageFade>
        <div className={`${styles.bmCourtPage} min-h-screen text-white flex items-center justify-center p-6`}>
          <div className={`${styles.bmSolidPanel} max-w-xl w-full border border-white/10 rounded-2xl p-6 shadow-lg`}>
            <div className="text-2xl font-extrabold text-orange-500">Salary Table</div>
            <div className="text-white/70 mt-2">
              No league found yet. Import a league in League Editor or load one through Play first.
            </div>
            <div className="text-white/50 text-sm mt-4">
              Tip: make sure the league is saved to localStorage under leagueData or exists in GameContext.
            </div>
          </div>
        </div>
      </PageFade>
    );
  }

  return (
    <PageFade>
      <div className={`${styles.bmCourtPage} min-h-screen text-white p-6`}>
        <div className={`${isAllTeamsView ? "max-w-[1600px]" : "max-w-6xl"} mx-auto space-y-5`}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-4xl font-extrabold text-orange-500 leading-tight">Salary Table</h1>
              <div className="text-white/60 text-sm mt-1">{leagueData?.leagueName || "League"}</div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="text-sm text-white/60">Team</div>
                <select
                  className="bg-neutral-800 border border-white/10 text-white rounded-xl px-3 py-2 min-w-[280px] outline-none focus:ring-2 focus:ring-orange-500/40"
                  value={selectedTeamKey}
                  onChange={(e) => setSelectedTeamKey(e.target.value)}
                >
                  <option value="__ALL__">All Teams (Full League)</option>
                  {allTeamsFlat.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.name} ({t.conf})
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => navigate("/team-hub")}
                className="px-6 py-2 bg-orange-600 hover:bg-orange-500 rounded-xl font-semibold transition"
              >
                Back
              </button>
            </div>
          </div>

          {emptyTeams && (
            <div className={`${styles.bmSolidPanel} border border-orange-500/20 rounded-2xl p-4 text-white/75`}>
              Found a league object, but it has 0 teams in East/West. That usually means this page is reading a different localStorage league than the rest of the app.
            </div>
          )}

          {isAllTeamsView && (
            <div className="space-y-5">
              <div className={`${styles.bmSolidPanel} border border-orange-500/20 rounded-2xl p-4 text-white/75`}>
                <div className="text-lg font-extrabold text-orange-300">Full League Salary Table</div>
                <div className="mt-1 text-sm text-white/60">
                  Showing every team one after another on the same page. Player contracts, cap holds, dead cap, and team totals use the same display rules as the single-team salary table.
                </div>
              </div>

              {allTeamSalaryTables.map((snapshot) => renderSalaryTablePanel(snapshot, true))}
            </div>
          )}

          {!isAllTeamsView && selectedTeam && (
            <div className={`${styles.bmTablePanel} border border-white/10 rounded-2xl shadow-2xl overflow-hidden`}>
              <div className="p-5 border-b border-white/10 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    {selectedTeam.logo ? (
                      <img src={selectedTeam.logo} alt="" className="w-10 h-10 object-contain" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/10" />
                    )}

                    <div>
                      <div className="text-2xl font-extrabold">{selectedTeam.name} Salary Table</div>
                      <div className="text-white/60 text-sm">
                        {selectedTeam?.players?.length || 0} standard + {getTwoWayPlayers(selectedTeam).length} two-way + {getStashPlayers(selectedTeam).length} stash
                        {deadCapPlayerRows.length > 0 ? ` + ${deadCapPlayerRows.length} dead cap` : ""}
                        {capHoldRows.length > 0 ? ` + ${capHoldRows.length} cap holds` : ""}
                      </div>
                    </div>
                  </div>

                  <div className={`px-3 py-2 rounded-xl border text-sm ${toneClass(capStatus.tone)}`}>
                    <div className="font-semibold">{capStatus.label}</div>
                    <div className="text-xs opacity-80">
                      {deadCapPlayerRows.length > 0 || capHoldRows.length > 0 ? "Payroll + Adjustments" : "Payroll"} {yearColumns[0]}: {fmtM(payrollThisYear)}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Chip label={`Salary Cap: ${fmtM(SALARY_CAP)}`} />
                  <Chip label={`Luxury Tax: ${fmtM(TAX_LINE)}`} />
                  <Chip label={`1st Apron: ${fmtM(FIRST_APRON)}`} />
                  <Chip label={`2nd Apron: ${fmtM(SECOND_APRON)}`} />
                  <Chip label={`Hard Cap: ${fmtM(HARD_CAP)}`} />
                  {deadCapPlayerRows.length > 0 && <Chip label={`Dead Cap: ${fmtM(deadCapTotal)}`} />}
                  {getTwoWayPlayers(selectedTeam).length > 0 && <Chip label={`Two-Way: ${getTwoWayPlayers(selectedTeam).length}/3`} />}
                  {getStashPlayers(selectedTeam).length > 0 && <Chip label={`Stash: ${getStashPlayers(selectedTeam).length}`} />}
                  {capHoldRows.length > 0 && <Chip label={`Cap Holds: ${fmtM(capHoldTotal)}`} />}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px]">
                  <thead className="bg-white/5 border-b border-white/10">
                    <tr className="text-white/70 text-sm">
                      <th className="text-left px-4 py-3">Player</th>
                      <th className="text-center px-3 py-3">Pos</th>
                      <th className="text-center px-3 py-3">OVR</th>
                      {yearColumns.map((y) => (
                        <th key={y} className="text-right px-3 py-3 whitespace-nowrap">
                          {y}
                        </th>
                      ))}
                      <th className="text-right px-3 py-3 whitespace-nowrap">Total Remaining</th>
                      <th className="text-center px-3 py-3 whitespace-nowrap">Exp.</th>
                    </tr>
                  </thead>

                  <tbody>
                    {players.map((p) => (
                      <tr
                        key={p.id}
                        className={`${p.isDeadCap ? "border-b border-red-500/45 bg-red-500/10 hover:bg-red-500/15" : p.isCapHold ? "border-b border-red-500/35 bg-red-500/5 hover:bg-red-500/10" : p.isTwoWay ? "border-b border-emerald-400/10 bg-emerald-500/5 hover:bg-emerald-500/10" : p.isStash ? "border-b border-amber-400/10 bg-amber-500/5 hover:bg-amber-500/10" : "border-b border-white/5 hover:bg-white/5"} transition`}
                        style={p.isDeadCap || p.isCapHold ? { boxShadow: "inset 0 0 0 1px rgba(248, 113, 113, 0.35)" } : undefined}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {p.headshot ? (
                              <img
                                src={p.headshot}
                                alt={p.name}
                                className={`w-14 h-14 rounded-full object-cover border bg-white/5 ${p.isDeadCap || p.isCapHold ? "border-red-400/35" : "border-white/10"}`}
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                }}
                              />
                            ) : (
                              <div className={`w-14 h-14 rounded-full bg-white/5 border ${p.isDeadCap || p.isCapHold ? "border-red-400/35" : "border-white/10"}`} />
                            )}

                            <div className="leading-tight">
                              <div className="font-semibold flex items-center gap-2">
                                <span>{p.name}</span>
                                {p.isTwoWay && (
                                  <span className="inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-extrabold text-emerald-200">
                                    2W
                                  </span>
                                )}
                                {p.isStash && (
                                  <span className="inline-flex items-center rounded-full border border-amber-400/25 bg-amber-500/15 px-2 py-0.5 text-[10px] font-extrabold text-amber-200">
                                    STASH
                                  </span>
                                )}
                                {p.isDeadCap && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDeadCapInfo(p);
                                    }}
                                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-red-400/45 bg-red-500/20 text-[11px] font-extrabold text-red-100 hover:bg-red-500/30 transition"
                                    title="Explain dead cap"
                                    aria-label={`Explain ${p.name} dead cap`}
                                  >
                                    ?
                                  </button>
                                )}
                                {p.isCapHold && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setCapHoldInfo(p);
                                    }}
                                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-red-400/45 bg-red-500/15 text-[11px] font-extrabold text-red-100 hover:bg-red-500/25 transition"
                                    title="Explain cap hold"
                                    aria-label={`Explain ${p.name} cap hold`}
                                  >
                                    ?
                                  </button>
                                )}
                              </div>
                              <div className={p.isDeadCap || p.isCapHold ? "text-xs text-red-200/75" : "text-xs text-white/50"}>
                                {p.optionLabel}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="text-center px-3 py-3 text-white/85">{p.pos}</td>
                        <td className="text-center px-3 py-3 font-semibold text-orange-300">{p.overall}</td>

                        {yearColumns.map((seasonYear) => {
                          const idx = seasonYear - p.contract.startYear;
                          const sal = idx >= 0 ? Number(p.contract.salaryByYear[idx] || 0) : 0;
                          const isBig = sal >= 25_000_000;
                          const salClass = p.isDeadCap || p.isCapHold ? "text-red-200 font-extrabold" : isBig ? "text-emerald-300" : "text-white/85";

                          return (
                            <td
                              key={`${p.id}-${seasonYear}`}
                              className={`text-right px-3 py-3 whitespace-nowrap ${
                                sal > 0 ? salClass : "text-white/35"
                              }`}
                            >
                              {sal > 0 ? fmtM(sal) : "-"}
                            </td>
                          );
                        })}

                        <td className={`text-right px-3 py-3 whitespace-nowrap font-extrabold ${p.isDeadCap || p.isCapHold ? "text-red-200" : "text-emerald-300"}`}>
                          {fmtM(p.totalRemaining)}
                        </td>

                        <td className="text-center px-3 py-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center justify-center gap-1 rounded-full border px-2.5 py-1 text-xs font-extrabold ${getExpChipClass(p.expType)}`}
                            title={p.expNote}
                          >
                            {p.endYear} {p.expType}
                          </span>
                        </td>
                      </tr>
                    ))}

                    <tr className="bg-white/5">
                      <td className="px-4 py-3 font-extrabold text-white/90" colSpan={3}>
                        Team Totals:
                      </td>

                      {yearColumns.map((y, i) => {
                        const total = teamTotalsByYear[i] || 0;
                        const overTax = i === 0 && total >= TAX_LINE;
                        const overCap = i === 0 && total >= SALARY_CAP;

                        return (
                          <td
                            key={`tot-${y}`}
                            className={`text-right px-3 py-3 whitespace-nowrap font-extrabold ${
                              overTax ? "text-red-300" : overCap ? "text-orange-300" : "text-white/85"
                            }`}
                          >
                            {fmtM(total)}
                          </td>
                        );
                      })}

                      <td className="text-right px-3 py-3 whitespace-nowrap font-extrabold text-emerald-300">
                        {fmtM(teamTotalAllYears)}
                      </td>

                      <td className="text-center px-3 py-3 whitespace-nowrap text-white/40">-</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {deadCapInfo && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
              onClick={() => setDeadCapInfo(null)}
            >
              <div
                className="w-full max-w-lg rounded-3xl border border-red-400/25 bg-neutral-950 p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-extrabold uppercase tracking-[0.2em] text-red-300">Dead Cap</div>
                    <div className="mt-1 text-2xl font-extrabold text-white">{deadCapInfo.name}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeadCapInfo(null)}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm font-bold text-white/70 hover:bg-white/10 hover:text-white transition"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-4 space-y-3 text-sm text-white/75">
                  <p>
                    This player was released and is no longer on the roster, but the team is still responsible for the guaranteed salary shown here.
                  </p>
                  <p>
                    A normal release does not stretch the cap hit. The dead cap follows the player's original remaining guaranteed contract years, and later set-off can reduce it if another team signs him above the minimum baseline.
                  </p>
                  <p>
                    If another team signs the released player above a minimum deal, this table applies NBA-lite set-off: half of the new salary above the minimum baseline gets credited back against the old team's dead cap for that season. Minimum pickups usually create no meaningful reduction.
                  </p>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-2 text-sm">
                  <InfoRow label="Net dead cap remaining" value={fmtMoney(deadCapInfo.deadCapAmount)} />
                  <InfoRow label="Original guaranteed amount" value={fmtMoney(deadCapInfo.deadCapInfo?.grossTotalRemaining || deadCapInfo.deadCapAmount)} />
                  {deadCapInfo.deadCapInfo?.displaySeasonNote && (
                    <InfoRow label="Table view" value={deadCapInfo.deadCapInfo.displaySeasonNote} />
                  )}
                  <InfoRow label="Set-off credit" value={fmtMoney(deadCapInfo.deadCapInfo?.totalSetOff || 0)} />
                  {deadCapInfo.deadCapInfo?.totalSetOff > 0 && (
                    <InfoRow label="Set-off formula" value="50% of new salary above the minimum baseline, capped by that season's original dead cap" />
                  )}
                  {deadCapInfo.deadCapInfo?.offsetTeamNames?.length > 0 && (
                    <InfoRow label="Set-off from" value={deadCapInfo.deadCapInfo.offsetTeamNames.join(", ")} />
                  )}
                  <InfoRow label="Seasons" value={deadCapInfo.deadCapInfo?.seasonRange || deadCapInfo.endYear} />
                  <InfoRow label="Reason" value={String(deadCapInfo.deadCapInfo?.reason || "Released player salary").replaceAll("_", " ")} />
                </div>
              </div>
            </div>
          )}

          {capHoldInfo && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
              onClick={() => setCapHoldInfo(null)}
            >
              <div
                className="w-full max-w-lg rounded-3xl border border-red-400/25 bg-neutral-950 p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-extrabold uppercase tracking-[0.2em] text-red-300">Cap Hold</div>
                    <div className="mt-1 text-2xl font-extrabold text-white">{capHoldInfo.name}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCapHoldInfo(null)}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm font-bold text-white/70 hover:bg-white/10 hover:text-white transition"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-4 space-y-3 text-sm text-white/75">
                  <p>
                    This player is not currently signed to your roster. He is shown here because your team still holds his rights, so the game places a temporary cap hold on your salary table during free agency.
                  </p>
                  <p>
                    This is not a real contract. It only represents money temporarily blocking practical cap room until you re-sign him, he signs somewhere else, or you renounce his rights.
                  </p>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-2 text-sm">
                  <InfoRow label="Cap hold amount" value={fmtMoney(capHoldInfo.capHoldAmount)} />
                  <InfoRow label="Rights type" value={capHoldInfo.capHoldInfo?.rightsLabel || "Rights"} />
                  <InfoRow label="RFA status" value={capHoldInfo.capHoldInfo?.restrictedFreeAgent ? "Restricted free agent" : "Not RFA"} />
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-center pt-2">
            <button
              onClick={() => navigate("/team-hub")}
              className="mt-2 px-8 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
            >
              Back to Team Hub
            </button>
          </div>
        </div>
      </div>
    </PageFade>
  );
}

function Chip({ label }) {
  return (
    <div className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white/80">
      {label}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-white/55">{label}</div>
      <div className="font-extrabold text-white text-right">{value}</div>
    </div>
  );
}
