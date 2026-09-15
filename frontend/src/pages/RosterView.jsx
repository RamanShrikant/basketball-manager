import { createPlayerResolver } from "../utils/playerResolver.js";
import React, { useState, useEffect, useMemo } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";
import { releasePlayerToFreeAgency } from "../api/simEnginePy.js";
import PlayerCardModal from "../components/PlayerCardModal.jsx";
import styles from "./RosterView.module.css";
import PageFade from "../components/PageFade";
import PlayerPortraitFrame from "../components/PlayerPortraitFrame";
import PlayerRatingRing from "../components/PlayerRatingRing.jsx";
import "../styles/BMAnimations.css";
import { getLeagueFinancialRules, getRookieSalaryForPick } from "../utils/leagueFinancials.js";
import { saveLeagueDataInBackground } from "../utils/leagueStorage.js";
import { getContractSeasonYear, getFinancialSeasonYear } from "../utils/seasonContext.js";
import useKeyboardListNavigation from "../utils/useKeyboardListNavigation.js";
import useKeyboardTeamNavigation from "../utils/useKeyboardTeamNavigation.js";
import { countStandardRosterPlayers, isStandardRosterPlayer } from "../utils/rosterRules.js";
import { formatInjuryReturnLabel, isPlayerInjured } from "../utils/injurySystem.js";
import { readLeagueClock } from "../utils/leagueClock.js";

const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
const ALL_PLAYERS_VIEW_KEY = "__ALL_PLAYERS__";


function rosterPlayerKey(player = {}) {
  return String(player?.id ?? player?.playerId ?? player?.name ?? player?.player ?? "");
}

function rosterContractType(player = {}) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  return String(
    player?.contractType ||
      player?.rosterStatus ||
      player?.assignmentStatus ||
      contract?.type ||
      contract?.contractType ||
      ""
  ).toLowerCase().replace(/-/g, "_");
}

function isTwoWayRosterRow(player = {}) {
  const type = rosterContractType(player);
  return Boolean(player?.isTwoWay || type.includes("two_way"));
}

function isStashRosterRow(player = {}) {
  const type = rosterContractType(player);
  return Boolean(
    player?.isStash ||
      type.includes("stash") ||
      type.includes("draft_rights") ||
      type.includes("unsigned_rookie") ||
      type.includes("rookie_pending")
  );
}

function uniqueRosterRows(rows = []) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const key = rosterPlayerKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function getNormalizedRosterBucketsForView(team = {}) {
  const rawStandardBucket = Array.isArray(team?.players) ? team.players : [];
  const rawTwoWayBucket = Array.isArray(team?.twoWayPlayers) ? team.twoWayPlayers : [];
  const rawStashBucket = Array.isArray(team?.stashPlayers) ? team.stashPlayers : [];

  const standardPlayers = rawStandardBucket.filter(isStandardRosterPlayer);
  const twoWayPlayers = uniqueRosterRows([
    ...rawTwoWayBucket,
    ...rawStandardBucket.filter((player) => isTwoWayRosterRow(player) && !isStashRosterRow(player)),
  ]);
  const stashPlayers = uniqueRosterRows([
    ...rawStashBucket,
    ...rawStandardBucket.filter(isStashRosterRow),
  ]);

  return { standardPlayers, twoWayPlayers, stashPlayers };
}

function isOffseasonRosterRelaxed() {
  try {
    const raw = JSON.parse(localStorage.getItem(OFFSEASON_STATE_KEY) || "{}");
    return Boolean(raw?.active);
  } catch {
    return false;
  }
}

export default function RosterView() {
  const { leagueData, selectedTeam, setSelectedTeam, setLeagueData } = useGame();
  const [workingLeagueData, setWorkingLeagueData] = useState(leagueData || null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: "overall", direction: "desc" });
  const [showLetters, setShowLetters] = useState(
    localStorage.getItem("showLetters") === "true"
  );
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [releaseTargetPlayer, setReleaseTargetPlayer] = useState(null);
  const [playerCardOpen, setPlayerCardOpen] = useState(false);
  const [cardTargetPlayer, setCardTargetPlayer] = useState(null);
  const [viewTeamName, setViewTeamName] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    setWorkingLeagueData(leagueData || null);
  }, [leagueData]);

  useEffect(() => {
    document.body.classList.add("rv-roster-bg");

    return () => {
      document.body.classList.remove("rv-roster-bg");
    };
  }, []);

  // --- attribute columns ---
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

  const formatDollars = (amount) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(Number(amount || 0));
  };

  const formatSeasonLabel = (startYear) => {
    const endYY = String((Number(startYear) + 1) % 100).padStart(2, "0");
    return `${startYear}-${endYY}`;
  };

  const buildReleasePreviewRows = (remainingRows = []) => {
    const safeRows = Array.isArray(remainingRows) ? remainingRows : [];
    const capRows = safeRows
      .map((row) => ({
        label: row.label,
        amount: Number(row.amount || 0),
      }))
      .filter((row) => row.amount > 0);

    return {
      capRows,
      totalOwed: capRows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    };
  };

  const getCurrentSeasonYear = () => {
    return Number(
      workingLeagueData?.seasonYear ||
      workingLeagueData?.currentSeasonYear ||
      2026
    );
  };

  const getActiveContractSeasonYear = () => {
    return Number(
      getContractSeasonYear(workingLeagueData || {}) ||
        workingLeagueData?.contractSeasonYear ||
        workingLeagueData?.payrollSeasonYear ||
        workingLeagueData?.freeAgencyState?.contractSeasonYear ||
        workingLeagueData?.freeAgencyState?.payrollSeasonYear ||
        getCurrentSeasonYear()
    );
  };

  const getActiveFinancialRulesSeasonYear = () => {
    const contractYear = getActiveContractSeasonYear();
    return Number(
      getFinancialSeasonYear(workingLeagueData || {}) ||
        workingLeagueData?.financialSeasonYear ||
        workingLeagueData?.currentFinancialSeasonYear ||
        workingLeagueData?.freeAgencyState?.financialSeasonYear ||
        workingLeagueData?.freeAgencyState?.currentFinancialSeasonYear ||
        contractYear + 1
    );
  };

  const getStandardMinimumSalary = () => {
    const rules = getLeagueFinancialRules(workingLeagueData || {}, getActiveFinancialRulesSeasonYear());
    return Number(
      rules.minimumException ||
      rules.veteranMinimum ||
      rules.minimumSalary ||
      workingLeagueData?.minimumSalary ||
      workingLeagueData?.veteranMinimum ||
      workingLeagueData?.minimumException ||
      1_500_000
    );
  };

  const getTwoWayPlayers = (team) => {
    return Array.isArray(team?.twoWayPlayers) ? team.twoWayPlayers : [];
  };

  const getStashPlayers = (team) => {
    return Array.isArray(team?.stashPlayers) ? team.stashPlayers : [];
  };

  const markTwoWayPlayer = (player) => ({
    ...player,
    isTwoWay: true,
    isStash: false,
    contractType: player?.contractType || "two_way",
    rosterStatus: player?.rosterStatus || "two_way",
  });

  const markStashPlayer = (player) => ({
    ...player,
    isStash: true,
    isTwoWay: false,
    contractType: player?.contractType || "stash",
    rosterStatus: player?.rosterStatus || "stashed",
  });

  const samePlayer = (a, b) => {
    if (!a || !b) return false;
    if (a.id !== undefined && a.id !== null && a.id !== "" && b.id !== undefined && b.id !== null && b.id !== "") {
      return String(a.id) === String(b.id);
    }
    return Boolean(a.name && b.name && a.name === b.name);
  };

  const readNumberFromObject = (source, keys = []) => {
    if (!source || typeof source !== "object") return null;

    for (const key of keys) {
      const value = Number(source?.[key]);
      if (Number.isFinite(value)) return value;
    }

    return null;
  };

  const getPlayerProSeasons = (player) => {
    const keys = [
      "proSeasons",
      "seasonsPro",
      "yearsPro",
      "yearsOfExperience",
      "experience",
      "nbaExperience",
      "nbaServiceYears",
      "serviceYears",
      "yoe",
    ];

    const direct = readNumberFromObject(player, keys);
    if (direct !== null) return direct;

    const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
    const fromMeta = readNumberFromObject(meta, keys);
    if (fromMeta !== null) return fromMeta;

    return 0;
  };

  const getTwoWayUsageInfo = (player) => {
    const meta = player?.twoWayMeta && typeof player.twoWayMeta === "object" ? player.twoWayMeta : {};
    const playerMeta = player?.meta && typeof player.meta === "object" ? player.meta : {};

    const used =
      readNumberFromObject(meta, [
        "twoWayYearsUsed",
        "yearsUsed",
        "seasonsUsed",
        "twoWaySeasonsUsed",
      ]) ??
      readNumberFromObject(player, [
        "twoWayYearsUsed",
        "twoWaySeasonsUsed",
      ]) ??
      readNumberFromObject(playerMeta, [
        "twoWayYearsUsed",
        "twoWaySeasonsUsed",
      ]) ??
      0;

    const max =
      readNumberFromObject(meta, [
        "maxTwoWayYears",
        "maxYears",
        "twoWayMaxYears",
      ]) ??
      readNumberFromObject(player, [
        "maxTwoWayYears",
        "twoWayMaxYears",
      ]) ??
      3;

    return {
      used: Math.max(0, Number(used || 0)),
      max: Math.max(1, Number(max || 3)),
      convertedToStandard:
        Boolean(meta.convertedToStandardSeasonYear) ||
        Boolean(meta.convertedToStandardByTeam) ||
        Boolean(meta.forcedStandardSeasonYear) ||
        Boolean(playerMeta.twoWayConvertedToStandard) ||
        Boolean(player.twoWayConvertedToStandard),
      forcedIneligible:
        Boolean(player.twoWayIneligible) ||
        Boolean(meta.twoWayIneligible) ||
        Boolean(playerMeta.twoWayIneligible) ||
        Boolean(meta.mustConvertToStandard) ||
        Boolean(playerMeta.mustConvertToStandard),
    };
  };

  const hasExhaustedTwoWayEligibility = (player) => {
    const usage = getTwoWayUsageInfo(player);

    if (usage.forcedIneligible || usage.convertedToStandard) return true;

    return usage.used > 0 && usage.used >= usage.max;
  };

  const readSeasonYear = (source, keys) => {
    if (!source || typeof source !== "object") return null;

    for (const key of keys) {
      const value = Number(source?.[key]);
      if (Number.isFinite(value) && value > 1900) {
        return { year: value, key };
      }
    }

    return null;
  };

  const getPlayerTwoWayReference = (player) => {
    const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};

    // These fields represent the first NBA season. If the current season is
    // two years after that display/start year, the player is still in his
    // third season and should remain two-way eligible.
    const rookieSeasonKeys = [
      "nbaRookieSeasonYear",
      "nba_rookie_season_year",
      "rookieYear",
      "rookie_year",
      "rookieSeason",
      "rookie_season",
      "rookieSeasonYear",
      "rookie_season_year",
    ];

    // Draft year is one year earlier than the first NBA display season for
    // real-player imports such as Emoni Bates: draftYear 2023 maps to the
    // 2023-24 season, which displays as 2024. So draftYear gets one extra year
    // of offset compared with rookieSeasonYear.
    const draftYearKeys = [
      "draftYear",
      "draft_year",
      "draftClassYear",
      "draft_class_year",
      "draftSeasonYear",
      "draft_season_year",
    ];

    const rookieDirect = readSeasonYear(player, rookieSeasonKeys);
    if (rookieDirect) return { ...rookieDirect, isDraftYear: false };

    const rookieMeta = readSeasonYear(meta, rookieSeasonKeys);
    if (rookieMeta) return { ...rookieMeta, isDraftYear: false };

    const draftDirect = readSeasonYear(player, draftYearKeys);
    if (draftDirect) return { ...draftDirect, isDraftYear: true };

    const draftMeta = readSeasonYear(meta, draftYearKeys);
    if (draftMeta) return { ...draftMeta, isDraftYear: true };

    return null;
  };

  const getCompletedHistorySeasonCount = (player) => {
    const seasons = Array.isArray(player?.history?.seasons) ? player.history.seasons : [];

    return seasons.filter((row) => {
      if (!row || row.rowType === "total") return false;
      const gp = Number(row.games ?? row.gp ?? row.GP ?? 0);
      return Number.isFinite(gp) && gp > 0;
    }).length;
  };

  const isPlayerTwoWayEligible = (player) => {
    if (!player || player.isTwoWay || player.isStash) return false;
    if (hasExhaustedTwoWayEligibility(player)) return false;

    const proSeasons = getPlayerProSeasons(player);
    if (proSeasons > 0 && proSeasons > 3) return false;

    const completedHistorySeasons = getCompletedHistorySeasonCount(player);
    if (completedHistorySeasons > 0 && completedHistorySeasons > 3) return false;

    const currentSeasonYear = getCurrentSeasonYear();
    const reference = getPlayerTwoWayReference(player);

    if (reference?.year) {
      const elapsed = Math.max(0, currentSeasonYear - Number(reference.year));

      // In this app, offseason `seasonYear` represents the season just completed.
      // A 2023 draft player in the 2026 offseason has already completed three NBA
      // seasons and is entering year four, so he should no longer be two-way eligible.
      const maxElapsed = reference.isDraftYear ? 2 : 1;
      return elapsed <= maxElapsed;
    }

    // If the save has no reliable experience metadata, stay permissive so the
    // user can use the roster-management tool instead of getting hard-blocked.
    return true;
  };

  const getTwoWayAssignmentBlockReason = (player, team = activeRosterTeam || selectedTeam) => {
    if (!player) return "No player selected.";
    if (isAllView) return "Switch to a team roster first before assigning a two-way.";
    if (!canManageCurrentRoster) return "You are only viewing this roster. Switch to this team from Team Hub before editing contracts.";
    if (player.isTwoWay) return "This player is already on a two-way contract.";
    if (player.isStash) return "Stashed players are team-controlled but cannot be assigned again until their offseason return decision.";

    const twoWayCount = getTwoWayPlayers(team).length;
    if (!isOffseasonRosterRelaxed() && twoWayCount >= 3) {
      return "This team already has the maximum 3 two-way players.";
    }

    if (hasExhaustedTwoWayEligibility(player)) {
      return "This player has already used or expired his two-way eligibility. He must stay on a standard contract or be released.";
    }

    if (!isPlayerTwoWayEligible(player)) {
      return "Only players still inside their two-way eligibility window can be assigned to a two-way contract.";
    }

    return "";
  };

  const getReleaseSalaryInfo = (player) => {
    const contract = player?.contract;
    const currentSeasonYear = getCurrentSeasonYear();

    if (!contract || !Array.isArray(contract.salaryByYear) || !contract.salaryByYear.length) {
      return {
        totalOwed: 0,
        untilSeason: null,
        remainingRows: [],
      };
    }

    const startYear = Number(contract.startYear ?? currentSeasonYear);
    const salaryByYear = contract.salaryByYear.map((x) => Number(x) || 0);

    let startIdx = currentSeasonYear - startYear;
    if (startIdx < 0) startIdx = 0;

    const remainingRows = salaryByYear
      .slice(startIdx)
      .map((amount, idx) => {
        const seasonYear = startYear + startIdx + idx;
        return {
          seasonYear,
          label: formatSeasonLabel(seasonYear),
          amount,
        };
      })
      .filter((row) => row.amount > 0);

    const totalOwed = remainingRows.reduce((sum, row) => sum + row.amount, 0);
    const releasePreview = buildReleasePreviewRows(remainingRows);
    const untilSeason = releasePreview.capRows.length
      ? releasePreview.capRows[releasePreview.capRows.length - 1].label
      : null;

    return {
      totalOwed,
      untilSeason,
      remainingRows,
      releasePreview,
    };
  };

  const releaseInfo = useMemo(() => {
    return releaseTargetPlayer ? getReleaseSalaryInfo(releaseTargetPlayer) : null;
  }, [releaseTargetPlayer, workingLeagueData]);

  // restore/save selected team
  useEffect(() => {
    if (!selectedTeam) {
      const saved = localStorage.getItem("selectedTeam");
      if (saved) setSelectedTeam(JSON.parse(saved));
    }
  }, [selectedTeam, setSelectedTeam]);

  useEffect(() => {
    if (selectedTeam?.name) localStorage.setItem("selectedTeam", JSON.stringify(selectedTeam.name));
  }, [selectedTeam]);

  // teams sorted
  const teamsSorted = useMemo(() => {
    if (!workingLeagueData?.conferences) return [];
    return Object.values(workingLeagueData.conferences)
      .flat()
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [workingLeagueData]);

  // all players list
  const allLeaguePlayers = useMemo(
    () =>
      teamsSorted.flatMap((t) => [
        ...(t.players || []),
        ...getTwoWayPlayers(t).map(markTwoWayPlayer),
        ...getStashPlayers(t).map(markStashPlayer),
      ]),
    [teamsSorted]
  );

  // map player -> team info (for logo column)
  const teamOfPlayer = useMemo(() => {
    const map = {};
    for (const t of teamsSorted) {
      const logo = t.logo || t.teamLogo || t.newTeamLogo || t.image || t.logoUrl || "";
      const teamPlayers = [
        ...(t.players || []),
        ...getTwoWayPlayers(t).map(markTwoWayPlayer),
        ...getStashPlayers(t).map(markStashPlayer),
      ];
      for (const p of teamPlayers) {
        const row = { teamName: t.name, logo, team: t };
        if (p.id !== undefined && p.id !== null) map[`id:${p.id}`] = row;
        if (p.name) map[`name:${p.name}`] = row;
      }
    }
    return map;
  }, [teamsSorted]);

  const getPlayerKey = (target) => {
    if (!target) return "";
    if (target.id !== undefined && target.id !== null && target.id !== "") return `id:${target.id}`;
    return `name:${target.name || ""}`;
  };

  const getTeamForPlayer = (target) => {
    if (!target) return null;

    const direct = teamOfPlayer[getPlayerKey(target)] || teamOfPlayer[`name:${target.name || ""}`];
    if (direct?.team) return direct.team;

    return teamsSorted.find((team) => {
      const teamPlayers = [
        ...(team.players || []),
        ...getTwoWayPlayers(team),
        ...getStashPlayers(team),
      ];

      return teamPlayers.some((row) => {
        if (target.id && row.id) return String(row.id) === String(target.id);
        return row.name === target.name;
      });
    }) || null;
  };

  // view index: 0..N-1 teams, N = All Players
  const [viewIndex, setViewIndex] = useState(0);

  useEffect(() => {
    if (viewTeamName === ALL_PLAYERS_VIEW_KEY) {
      setViewIndex(teamsSorted.length);
      return;
    }

    const targetTeamName = viewTeamName || selectedTeam?.name;
    const idx = teamsSorted.findIndex((t) => t.name === targetTeamName);
    setViewIndex(idx >= 0 ? idx : 0);
  }, [teamsSorted, selectedTeam?.name, viewTeamName]);

  const totalSlots = teamsSorted.length + 1; // +1 for All Players
  const isAllView = viewIndex === teamsSorted.length;

  const activeRosterTeam = useMemo(() => {
    if (isAllView) return null;

    const targetTeamName = viewTeamName === ALL_PLAYERS_VIEW_KEY
      ? null
      : viewTeamName || selectedTeam?.name;
    const byName = teamsSorted.find((team) => team?.name === targetTeamName);

    return byName || teamsSorted[viewIndex] || selectedTeam || null;
  }, [isAllView, teamsSorted, viewTeamName, selectedTeam, viewIndex]);

  const canManageCurrentRoster = Boolean(
    !isAllView &&
      activeRosterTeam?.name &&
      selectedTeam?.name &&
      activeRosterTeam.name === selectedTeam.name
  );

  const handleTeamSwitch = (dir) => {
    if (!totalSlots) return;
    setViewIndex((prev) => {
      const next =
        dir === "next"
          ? (prev + 1 + totalSlots) % totalSlots
          : (prev - 1 + totalSlots) % totalSlots;

      setViewTeamName(next < teamsSorted.length ? teamsSorted[next]?.name || null : ALL_PLAYERS_VIEW_KEY);
      setSelectedPlayer(null);
      return next;
    });
  };

  useKeyboardTeamNavigation({
    enabled: totalSlots > 1 && !releaseModalOpen && !playerCardOpen,
    onPrevious: () => handleTeamSwitch("prev"),
    onNext: () => handleTeamSwitch("next"),
  });

  const normalizedRosterBuckets = useMemo(
    () => getNormalizedRosterBucketsForView(activeRosterTeam),
    [activeRosterTeam]
  );

  // active rows
  const resolvePlayer = useMemo(() => createPlayerResolver(leagueData), [leagueData]);
  const rawViewPlayers = isAllView
    ? allLeaguePlayers
    : [
        ...normalizedRosterBuckets.standardPlayers,
        ...normalizedRosterBuckets.twoWayPlayers.map(markTwoWayPlayer),
        ...normalizedRosterBuckets.stashPlayers.map(markStashPlayer),
      ];

  const viewPlayers = rawViewPlayers.map((row) => ({ ...row, ...resolvePlayer(row) }));

  // sorting
  const positionOrder = ["PG", "SG", "SF", "PF", "C"];

  const handleSort = (key) => {
    let direction = key === "pos" ? "asc" : "desc";
    if (sortConfig.key === key && sortConfig.direction === "desc") direction = "asc";
    else if (sortConfig.key === key && sortConfig.direction === "asc") direction = "default";
    setSortConfig({ key, direction });
  };

  const isPositionGrouped = sortConfig.key === "pos" && sortConfig.direction === "asc";

  const togglePositionGrouping = () => {
    setSortConfig(isPositionGrouped
      ? { key: "overall", direction: "desc" }
      : { key: "pos", direction: "asc" }
    );
  };

  const sortedPlayers = useMemo(() => {
    if (!sortConfig.key || sortConfig.direction === "default") return viewPlayers;
    const rows = [...viewPlayers];
    rows.sort((a, b) => {
      const key = sortConfig.key;
      if (key === "pos") {
        const primaryPos = (value = "") => String(value || "").toUpperCase().split(/[\/,-]/)[0].trim();
        const aIdx = positionOrder.indexOf(primaryPos(a.pos));
        const bIdx = positionOrder.indexOf(primaryPos(b.pos));
        const diff = (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
        if (diff) return sortConfig.direction === "asc" ? diff : -diff;
        const overallDiff = Number(b.overall || 0) - Number(a.overall || 0);
        if (overallDiff) return overallDiff;
        return String(a.name || "").localeCompare(String(b.name || ""));
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
        const idx = parseInt(key.replace("attr", ""));
        const av = a.attrs?.[idx] ?? 0;
        const bv = b.attrs?.[idx] ?? 0;
        return sortConfig.direction === "asc" ? av - bv : bv - av;
      }
      return 0;
    });
    return rows;
  }, [viewPlayers, sortConfig]);

  useEffect(() => {
    if (!sortedPlayers?.length) {
      setSelectedPlayer(null);
      return;
    }
    if (!selectedPlayer || !sortedPlayers.some((p) => p.name === selectedPlayer.name)) {
      setSelectedPlayer(sortedPlayers[0]);
    }
  }, [sortedPlayers, selectedPlayer]);

  useKeyboardListNavigation({
    items: sortedPlayers,
    selectedItem: selectedPlayer,
    onSelect: setSelectedPlayer,
    enabled: !playerCardOpen && !releaseModalOpen,
    getKey: (row) => row?.id || row?.playerId || row?.name,
  });


  const openPlayerCard = (player) => {
    if (!player) return;
    setCardTargetPlayer(player);
    setPlayerCardOpen(true);
  };

  const closePlayerCard = () => {
    setPlayerCardOpen(false);
    setCardTargetPlayer(null);
  };

  const persistUpdatedLeagueAndTeam = (updated, teamName = selectedTeam?.name) => {
    if (!updated) return null;

    setWorkingLeagueData(updated);

    if (typeof setLeagueData === "function") {
      setLeagueData(updated);
    }

    let updatedTeam = null;
    for (const confKey of Object.keys(updated.conferences || {})) {
      const team = (updated.conferences[confKey] || []).find(
        (t) => t.name === teamName
      );
      if (team) {
        updatedTeam = team;
        break;
      }
    }

    if (updatedTeam) {
      setSelectedTeam(updatedTeam);
      localStorage.setItem("selectedTeam", JSON.stringify(updatedTeam.name));
    }

    saveLeagueDataInBackground(updated);
    return updatedTeam;
  };

  const updateSelectedTeamInLeague = (teamUpdater) => {
    if (!selectedTeam?.name || !workingLeagueData?.conferences) return null;

    let foundTeam = false;
    const updated = {
      ...workingLeagueData,
      conferences: { ...workingLeagueData.conferences },
    };

    for (const confKey of Object.keys(updated.conferences || {})) {
      updated.conferences[confKey] = (updated.conferences[confKey] || []).map((team) => {
        if (team.name !== selectedTeam.name) return team;
        foundTeam = true;
        return teamUpdater(team);
      });
    }

    if (!foundTeam) return null;
    const updatedTeam = persistUpdatedLeagueAndTeam(updated, selectedTeam.name);
    return { updated, updatedTeam };
  };

  const rebaseStandardContractFromSeason = (
    contract,
    targetStartYear,
    { guaranteeFirstSeason = false } = {}
  ) => {
    if (!contract || typeof contract !== "object") return null;

    const originalStartYear = Number(contract?.startYear || 0);
    const originalSalaries = Array.isArray(contract?.salaryByYear)
      ? contract.salaryByYear.map((amount) => Number(amount || 0))
      : [];

    if (!Number.isFinite(originalStartYear) || !originalSalaries.length) return null;

    const effectiveStartYear = Math.max(Number(targetStartYear), originalStartYear);
    const offset = effectiveStartYear - originalStartYear;
    const remainingSalaries = originalSalaries.slice(offset);
    if (!remainingSalaries.length) return null;

    const oldOption = contract?.option && typeof contract.option === "object"
      ? contract.option
      : null;
    const oldOptionIndices = Array.isArray(oldOption?.yearIndices)
      ? oldOption.yearIndices.map(Number).filter(Number.isFinite)
      : [];
    const oldPicked = oldOption?.picked && typeof oldOption.picked === "object"
      ? oldOption.picked
      : {};

    const nextOptionIndices = [];
    const nextPicked = {};

    for (const oldIndex of oldOptionIndices) {
      const absoluteYear = originalStartYear + oldIndex;
      if (absoluteYear < effectiveStartYear) continue;

      const nextIndex = absoluteYear - effectiveStartYear;
      if (nextIndex < 0 || nextIndex >= remainingSalaries.length) continue;

      // Converting to a standard contract guarantees the conversion season.
      // Only later unresolved option seasons should remain marked as options.
      if (guaranteeFirstSeason && nextIndex === 0) continue;

      nextOptionIndices.push(nextIndex);
      if (Object.prototype.hasOwnProperty.call(oldPicked, String(oldIndex))) {
        nextPicked[String(nextIndex)] = oldPicked[String(oldIndex)];
      }
    }

    const nextOption = oldOption && nextOptionIndices.length
      ? {
          ...oldOption,
          yearIndices: nextOptionIndices,
          picked: Object.keys(nextPicked).length ? nextPicked : null,
        }
      : null;

    return {
      ...contract,
      type: "standard",
      startYear: effectiveStartYear,
      salaryByYear: remainingSalaries,
      option: nextOption,
      countsAgainstStandardRoster: true,
      countsAgainstSalaryCap: true,
    };
  };

  const buildRemainingRookieContract = (player, targetStartYear) => {
    const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
    const draftRound = Number(meta?.draftRound || player?.draftRound || 0);
    const draftPick = Math.max(1, Number(meta?.draftPick || player?.draftPick || 60));
    const draftYear = Number(meta?.draftYear || player?.draftYear || 0);
    const rookieStartYear = Number(
      meta?.nbaRookieSeasonYear ||
      meta?.rookieSeasonYear ||
      player?.rookieSeasonYear ||
      (draftYear ? draftYear + 1 : targetStartYear)
    );
    const elapsedSeasons = Math.max(0, targetStartYear - rookieStartYear);

    if (draftRound === 1 && elapsedSeasons < 4) {
      const firstSalary = getRookieSalaryForPick(
        workingLeagueData || {},
        1,
        draftPick,
        rookieStartYear
      );
      const fullScale = [
        firstSalary,
        Math.round(firstSalary * 1.05),
        Math.round(firstSalary * 1.1),
        Math.round(firstSalary * 1.22),
      ];
      const salaryByYear = fullScale.slice(elapsedSeasons);
      const optionIndices = [2, 3]
        .filter((originalIndex) => originalIndex >= elapsedSeasons)
        .map((originalIndex) => originalIndex - elapsedSeasons)
        // The act of converting guarantees the first standard season.
        .filter((nextIndex) => nextIndex > 0);

      return {
        type: "standard",
        startYear: targetStartYear,
        salaryByYear,
        option: optionIndices.length
          ? { type: "team", yearIndices: optionIndices, picked: null }
          : null,
        source: "two_way_upgrade_remaining_first_round_scale",
        countsAgainstStandardRoster: true,
        countsAgainstSalaryCap: true,
      };
    }

    if (draftRound === 2 && elapsedSeasons < 2) {
      const firstSalary = getRookieSalaryForPick(
        workingLeagueData || {},
        2,
        draftPick,
        rookieStartYear
      );
      return {
        type: "standard",
        startYear: targetStartYear,
        salaryByYear: [firstSalary, Math.round(firstSalary * 1.08)].slice(elapsedSeasons),
        option: null,
        source: "two_way_upgrade_remaining_second_round_contract",
        countsAgainstStandardRoster: true,
        countsAgainstSalaryCap: true,
      };
    }

    return null;
  };

  const buildStandardContractFromTwoWay = (player) => {
    const targetStartYear = getActiveContractSeasonYear();
    const storedStandardContract =
      player?.previousStandardContract ||
      player?.standardContractBeforeTwoWay ||
      null;

    const restoredRemainingContract = rebaseStandardContractFromSeason(
      storedStandardContract,
      targetStartYear,
      { guaranteeFirstSeason: true }
    );

    if (restoredRemainingContract) {
      return {
        ...restoredRemainingContract,
        source: "manual_two_way_upgrade_restored_remaining_standard_contract",
      };
    }

    const remainingRookieContract = buildRemainingRookieContract(player, targetStartYear);
    if (remainingRookieContract) return remainingRookieContract;

    const minimumSalary = getStandardMinimumSalary();
    return {
      type: "standard",
      startYear: targetStartYear,
      salaryByYear: [minimumSalary],
      option: null,
      source: "manual_two_way_upgrade_new_standard_minimum",
      countsAgainstStandardRoster: true,
      countsAgainstSalaryCap: true,
    };
  };

  const buildTwoWayContractFromStandard = () => ({
    type: "two_way",
    startYear: getActiveContractSeasonYear(),
    salaryByYear: [],
    option: null,
    source: "manual_roster_assignment",
    countsAgainstStandardRoster: false,
    countsAgainstSalaryCap: false,
  });

  const handleAssignStandardToTwoWay = (player) => {
    if (!player || isAllView || !canManageCurrentRoster) return;

    const blockReason = getTwoWayAssignmentBlockReason(player, activeRosterTeam);
    if (blockReason) {
      console.warn("[RosterView] two-way assignment blocked:", blockReason);
      return;
    }

    let assignedPlayer = null;
    const result = updateSelectedTeamInLeague((team) => {
      const standardPlayers = Array.isArray(team.players) ? team.players : [];
      const twoWayPlayers = getTwoWayPlayers(team);

      const targetTwoWaySeasonYear = getActiveContractSeasonYear();
      const previousStandardContract =
        player?.previousStandardContract ||
        rebaseStandardContractFromSeason(player?.contract, targetTwoWaySeasonYear) ||
        null;
      const usage = getTwoWayUsageInfo(player);
      const nextTwoWayYearsUsed = Math.min(
        usage.max,
        usage.used > 0 ? usage.used + 1 : 1
      );

      const cleanedPlayer = {
        ...player,
        isTwoWay: true,
        isStash: false,
        twoWayIneligible: false,
        rosterStatus: "two_way",
        contractType: "two_way",
        previousStandardContract,
        previousContract: player?.previousContract || previousStandardContract,
        contract: buildTwoWayContractFromStandard(player),
        twoWayMeta: {
          ...(player?.twoWayMeta || {}),
          assignedByTeam: team.name,
          assignedSeasonYear: getActiveContractSeasonYear(),
          currentTwoWaySeasonYear: getActiveContractSeasonYear(),
          twoWayYearsUsed: nextTwoWayYearsUsed,
          maxTwoWayYears: usage.max,
          twoWayIneligible: false,
          convertedToStandardSeasonYear: null,
          convertedToStandardByTeam: null,
          source: "manual_roster_assignment",
        },
      };

      assignedPlayer = cleanedPlayer;

      return {
        ...team,
        players: standardPlayers.filter((row) => !samePlayer(row, player)),
        twoWayPlayers: twoWayPlayers.some((row) => samePlayer(row, player))
          ? twoWayPlayers.map((row) => (samePlayer(row, player) ? cleanedPlayer : row))
          : [...twoWayPlayers, cleanedPlayer],
      };
    });

    if (!result) return;

    if (assignedPlayer) {
      setSelectedPlayer(assignedPlayer);
    }
  };

  const handleUpgradeTwoWayToStandard = (player) => {
    if (!player || isAllView || !canManageCurrentRoster) return;

    let upgradedPlayer = null;
    const result = updateSelectedTeamInLeague((team) => {
      const twoWayPlayers = getTwoWayPlayers(team).filter((row) => !samePlayer(row, player));
      const standardPlayers = Array.isArray(team.players) ? team.players : [];

      const usage = getTwoWayUsageInfo(player);

      const cleanedPlayer = {
        ...player,
        isTwoWay: false,
        isStash: false,
        twoWayEligible: false,
        twoWayIneligible: true,
        rosterStatus: "standard",
        contractType: "standard",
        contract: buildStandardContractFromTwoWay(player),
        twoWayMeta: {
          ...(player?.twoWayMeta || {}),
          twoWayYearsUsed: Math.max(1, usage.used),
          maxTwoWayYears: usage.max,
          twoWayIneligible: true,
          convertedToStandardByTeam: team.name,
          convertedToStandardSeasonYear: getActiveContractSeasonYear(),
          source: "manual_two_way_upgrade_to_standard",
        },
      };

      upgradedPlayer = cleanedPlayer;

      return {
        ...team,
        players: standardPlayers.some((row) => samePlayer(row, player))
          ? standardPlayers.map((row) => (samePlayer(row, player) ? cleanedPlayer : row))
          : [...standardPlayers, cleanedPlayer],
        twoWayPlayers,
      };
    });

    if (!result) return;

    if (upgradedPlayer) {
      setSelectedPlayer(upgradedPlayer);
    }
  };

  const handleReleaseTwoWayToFreeAgency = (player) => {
    if (!player || isAllView || !canManageCurrentRoster || !workingLeagueData?.conferences) return;

    const releasedPlayer = {
      ...player,
      isTwoWay: false,
      rosterStatus: "free_agent",
      contractType: null,
      previousContract: player?.previousContract || player?.contract || null,
      contract: null,
    };

    let foundTeam = false;
    const updated = {
      ...workingLeagueData,
      conferences: { ...workingLeagueData.conferences },
      freeAgents: Array.isArray(workingLeagueData.freeAgents)
        ? [...workingLeagueData.freeAgents]
        : [],
    };

    for (const confKey of Object.keys(updated.conferences || {})) {
      updated.conferences[confKey] = (updated.conferences[confKey] || []).map((team) => {
        if (team.name !== selectedTeam?.name) return team;
        foundTeam = true;

        return {
          ...team,
          twoWayPlayers: getTwoWayPlayers(team).filter((row) => !samePlayer(row, player)),
        };
      });
    }

    if (!foundTeam) return;

    if (!updated.freeAgents.some((row) => samePlayer(row, releasedPlayer))) {
      updated.freeAgents.push(releasedPlayer);
    }

    persistUpdatedLeagueAndTeam(updated, selectedTeam.name);
    setSelectedPlayer(null);
  };

  const openReleaseForPlayer = (player) => {
    if (!player || isAllView || !canManageCurrentRoster) return;
    setReleaseTargetPlayer(player);
    setReleaseModalOpen(true);
  };

  const closeReleaseModal = () => {
    setReleaseModalOpen(false);
    setReleaseTargetPlayer(null);
  };

  const handleReleaseToFreeAgency = async () => {
    if (!releaseTargetPlayer || !canManageCurrentRoster || !selectedTeam || !workingLeagueData?.conferences) return;

    try {
      const res = await releasePlayerToFreeAgency(
        workingLeagueData,
        selectedTeam.name,
        releaseTargetPlayer.id || null,
        releaseTargetPlayer.name || null
      );

      if (!res?.ok || !res?.leagueData) {
        console.error("[RosterView] release failed:", res?.reason || res);
        return;
      }

      const updated = res.leagueData;
      setWorkingLeagueData(updated);

      if (typeof setLeagueData === "function") {
        setLeagueData(updated);
      }

      let updatedTeam = null;
      for (const confKey of Object.keys(updated.conferences || {})) {
        const team = (updated.conferences[confKey] || []).find(
          (t) => t.name === selectedTeam.name
        );
        if (team) {
          updatedTeam = team;
          break;
        }
      }

      if (updatedTeam) {
        setSelectedTeam(updatedTeam);
        localStorage.setItem("selectedTeam", JSON.stringify(updatedTeam.name));
      }

      saveLeagueDataInBackground(updated);

      closeReleaseModal();
    } catch (err) {
      console.error("[RosterView] release worker error:", err);
    }
  };

  // guards
  if (!selectedTeam && !teamsSorted.length) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-neutral-900 text-white">
        <p className="text-lg mb-4">No team selected.</p>
        <button
          onClick={() => navigate("/team-selector")}
          className="px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
        >
          Back to Team Select
        </button>
      </div>
    );
  }

  const player = selectedPlayer || viewPlayers[0] || {};
  const headerTitle = isAllView ? "All Players" : `${activeRosterTeam?.name || selectedTeam?.name || "Team"} Roster`;
  const showTeamCol = isAllView; // logo column only in All Players view
  const regularSeasonStandardRosterLimit = Number(
    workingLeagueData?.rosterLimit ||
    workingLeagueData?.maxRosterSize ||
    15
  );
  const standardRosterCount = !isAllView && activeRosterTeam
    ? countStandardRosterPlayers(activeRosterTeam)
    : 0;
  const twoWayRosterCount = !isAllView ? normalizedRosterBuckets.twoWayPlayers.length : 0;
  const stashRosterCount = !isAllView ? normalizedRosterBuckets.stashPlayers.length : 0;
  const rosterOverRegularSeasonLimit =
    !isAllView && standardRosterCount > regularSeasonStandardRosterLimit;
  const currentLeagueDate = readLeagueClock()?.date || null;
  const selectedPlayerInjured = isPlayerInjured(player, currentLeagueDate);
  const activeRosterLogo = !isAllView
    ? (
        activeRosterTeam?.logo ||
        activeRosterTeam?.teamLogo ||
        activeRosterTeam?.newTeamLogo ||
        activeRosterTeam?.image ||
        activeRosterTeam?.logoUrl ||
        ""
      )
    : "";
  const selectedTwoWayBlockReason =
    !isAllView &&
    canManageCurrentRoster &&
    player &&
    !player?.isTwoWay &&
    !player?.isStash
      ? getTwoWayAssignmentBlockReason(player, activeRosterTeam)
      : "";

  return (
    <PageFade>
    <div className={`${styles.rosterPage} ${styles.viewportShell} h-full min-h-0 overflow-hidden text-white flex flex-col items-center px-4 py-3`}>
      {/* Compact roster header: team identity + live roster counts + pinned team arrows */}
      <div className={`${styles.rosterHeaderBar} w-full max-w-7xl shrink-0 mb-2 select-none`}>
        <button
          onClick={() => handleTeamSwitch("prev")}
          className={styles.teamSwitchButton}
          title="Previous Team"
          aria-label="Previous Team"
        >
          ◄
        </button>

        <div className={styles.rosterIdentityCluster}>
          <div className={styles.rosterIdentity}>
            {!isAllView && activeRosterLogo ? (
              <img
                src={activeRosterLogo}
                alt=""
                className={styles.rosterIdentityLogo}
                aria-hidden="true"
              />
            ) : null}
            <h1 className={styles.rosterIdentityTitle}>{headerTitle}</h1>
          </div>

          <button
            onClick={() => handleTeamSwitch("next")}
            className={styles.teamSwitchButton}
            title="Next Team"
            aria-label="Next Team"
          >
            ►
          </button>
        </div>

        {!isAllView && (
          <div className={styles.rosterStatusCluster}>
            <div className={styles.rosterStatusItem}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="7" r="3.2" />
                <path d="M5.5 20c.4-4 2.6-6.2 6.5-6.2s6.1 2.2 6.5 6.2" />
              </svg>
              <div>
                <div className={styles.rosterStatusLabel}>Standard contracts</div>
                <div className={styles.rosterStatusValue}>{standardRosterCount}/{regularSeasonStandardRosterLimit}</div>
              </div>
            </div>

            <div className={styles.rosterStatusDivider} />

            <div className={styles.rosterStatusItem}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="9" cy="7" r="3" />
                <path d="M3.8 19c.4-3.6 2.2-5.6 5.2-5.6 3.1 0 4.9 2 5.3 5.6" />
                <path d="M15.2 4.8a2.8 2.8 0 0 1 0 5.3" />
                <path d="M16.2 13.5c2.3.5 3.7 2.2 4 5" />
              </svg>
              <div>
                <div className={styles.rosterStatusLabel}>Two-way contracts</div>
                <div className={styles.rosterStatusValue}>{twoWayRosterCount}/3</div>
              </div>
            </div>

            <div className={styles.rosterStatusDivider} />

            <div className={styles.rosterStatusItem}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 7h12.5a1.5 1.5 0 0 1 1.5 1.5V19H6.5A1.5 1.5 0 0 1 5 17.5Z" />
                <path d="M5 9V6.5A2.5 2.5 0 0 1 7.5 4H16" />
                <path d="M15.5 11.5H19V15h-3.5a1.75 1.75 0 1 1 0-3.5Z" />
              </svg>
              <div>
                <div className={styles.rosterStatusLabel}>Stashes</div>
                <div className={styles.rosterStatusValue}>{stashRosterCount}</div>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Selected player hero */}
      <div className="relative w-full flex shrink-0 justify-center">
        <div className={`${styles.selectedPlayerHero} w-full max-w-7xl`}>
          {!isAllView && activeRosterLogo ? (
            <img src={activeRosterLogo} alt="" className={styles.selectedPlayerWatermark} aria-hidden="true" />
          ) : null}

          <div className={styles.selectedPlayerHeroContent}>
            <div className={styles.selectedPlayerPrimary}>
              <PlayerPortraitFrame
                src={player?.headshot}
                player={player}
                team={activeRosterTeam || selectedTeam}
                teamName={activeRosterTeam?.name || selectedTeam?.name || ""}
                alt={player?.name || "Player"}
                className={styles.selectedPlayerPortrait}
                fallback={(
                  <div className="flex h-full w-full items-center justify-center rounded-t-lg bg-neutral-800 text-neutral-400">No Image</div>
                )}
              />

              <div className={styles.selectedPlayerInfo}>
                <div className={styles.selectedPlayerNameRow}>
                  <h2>{player?.name || "-"}</h2>
                  {player?.isTwoWay && <span className={styles.twoWayBadge}>2W</span>}
                  {player?.isStash && <span className={styles.stashBadge}>STASH</span>}
                  {selectedPlayerInjured && (
                    <>
                      <span className={styles.injuryBadge}>INJ</span>
                      <span className={styles.injuryReturnBadge}>{formatInjuryReturnLabel(player, currentLeagueDate)}</span>
                    </>
                  )}
                </div>

                <div className={styles.selectedPlayerMeta}>
                  <strong>
                    {player?.pos || "-"}
                    {player?.secondaryPos ? ` / ${player.secondaryPos}` : ""}
                  </strong>
                  <span className={styles.metaDivider}>|</span>
                  <strong>Age {player?.age ?? "-"}</strong>
                  {player?.isTwoWay ? <><span className={styles.metaDivider}>|</span>Two-Way</> : null}
                  {player?.isStash ? <><span className={styles.metaDivider}>|</span>Stashed</> : null}
                </div>

                <div className={styles.selectedPlayerActions}>
                  <button
                    type="button"
                    onClick={() => openPlayerCard(player)}
                    className={styles.playerCardButton}
                  >
                    Player Card
                  </button>

                  {canManageCurrentRoster && !isAllView && (
                    <button
                      type="button"
                      onClick={() => navigate("/coach-gameplan")}
                      className={styles.gameplanButton}
                    >
                      Coach Gameplan
                    </button>
                  )}

                  {canManageCurrentRoster &&
                    !isAllView &&
                    !player?.isTwoWay &&
                    !player?.isStash &&
                    !selectedTwoWayBlockReason && (
                      <button
                        type="button"
                        onClick={() => handleAssignStandardToTwoWay(player)}
                        className={styles.twoWayActionButton}
                      >
                        Assign Two-Way
                      </button>
                    )}

                  {canManageCurrentRoster && !isAllView && player?.isTwoWay && (
                    <button
                      type="button"
                      onClick={() => handleUpgradeTwoWayToStandard(player)}
                      className={styles.upgradeActionButton}
                    >
                      Upgrade Standard
                    </button>
                  )}

                  {canManageCurrentRoster && !isAllView && !player?.isStash && (
                    <button
                      type="button"
                      onClick={() =>
                        player?.isTwoWay
                          ? handleReleaseTwoWayToFreeAgency(player)
                          : openReleaseForPlayer(player)
                      }
                      className={styles.releasePlayerButton}
                    >
                      Release Player
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className={styles.selectedPlayerRating}>
              <PlayerRatingRing overall={player?.overall} potential={player?.potential} size={88} />
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className={`${styles.rosterTableRegion} w-full flex flex-1 min-h-0 items-start justify-center transition-opacity duration-300 ease-in-out mt-[-1px]`}>
        <div className={`${styles.tablePanel} ${styles.rosterScroller} bmTableScroller w-full max-w-7xl min-h-0 overflow-auto rounded-b-xl`}>
          <div className="min-w-[1390px] w-max">
            <table className="w-full border-collapse text-center">
              <thead className="sticky top-0 z-20 bg-neutral-800 text-gray-300 text-[13px] font-semibold">
                <tr>
                  {showTeamCol && <th className="py-3 px-3 min-w-[60px]">Team</th>}
                  {[
                    { key: "name", label: "Name" },
                    { key: "pos", label: "POS" },
                    { key: "age", label: "AGE" },
                    { key: "overall", label: "OVR" },
                    { key: "offRating", label: "OFF" },
                    { key: "defRating", label: "DEF" },
                    { key: "stamina", label: "STAM" },
                    { key: "potential", label: "POT" },
                    ...attrColumns,
                  ].map((col) => (
                    <th
                      key={col.key}
                      className={`py-2 px-3 min-w-[88px] ${
                        col.key === "name" ? "min-w-[230px] text-left pl-4" : "text-center"
                      } ${col.noSort ? "select-none" : "cursor-pointer select-none"}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!col.noSort) handleSort(col.key);
                      }}
                    >
                      {col.label}
                      {sortConfig.key === col.key && (
                        <span className="ml-1 text-orange-400">
                          {sortConfig.direction === "asc" ? "▲" : sortConfig.direction === "desc" ? "▼" : ""}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="text-[14px] font-medium">
                {sortedPlayers.map((p, idx) => {
                  const tinfo = teamOfPlayer[getPlayerKey(p)] || teamOfPlayer[`name:${p.name || ""}`] || {};
                  const injured = isPlayerInjured(p, currentLeagueDate);
                  return (
                    <tr
                      key={`${p.name}-${idx}`}
                      data-bm-nav-row-index={idx}
                      onClick={() => setSelectedPlayer(p)}
                      className={`cursor-pointer transition ${
                        selectedPlayer && selectedPlayer.name === p.name
                          ? "bg-orange-600 text-white"
                          : p.isTwoWay
                          ? "bg-emerald-500/5 hover:bg-emerald-500/10"
                          : injured
                          ? "bg-red-500/7 hover:bg-red-500/12"
                          : p.isStash
                          ? "bg-amber-500/5 hover:bg-amber-500/10"
                          : "hover:bg-neutral-800"
                      }`}
                    >
                      {showTeamCol && (
                        <td className="py-1.5 px-3">
                          {tinfo.logo ? (
                            <img
                              src={tinfo.logo}
                              alt={tinfo.teamName || "Team"}
                              className="h-6 w-6 object-contain inline-block align-middle"
                            />
                          ) : null}
                        </td>
                      )}

                      <td className="py-1.5 px-3 whitespace-nowrap text-left pl-4">
                        <span>{p.name}</span>
                        {p.isTwoWay && (
                          <span className="ml-2 inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-extrabold text-emerald-200">
                            2W
                          </span>
                        )}
                        {p.isStash && (
                          <span className="ml-2 inline-flex items-center rounded-full border border-amber-400/25 bg-amber-500/15 px-2 py-0.5 text-[10px] font-extrabold text-amber-200">
                            STASH
                          </span>
                        )}
                        {injured && (
                          <span className="ml-2 inline-flex items-center rounded-full border border-red-400/30 bg-red-500/20 px-2 py-0.5 text-[10px] font-extrabold text-red-100">
                            INJ
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 px-3 font-bold">{p.pos}</td>
                      <td className="py-1.5 px-3 font-bold">{p.age}</td>
                      <td className="py-1.5 px-3" onDoubleClick={handleCellDoubleClick}>
                        {showLetters ? toLetter(p.overall) : p.overall}
                      </td>
                      <td className="py-1.5 px-3" onDoubleClick={handleCellDoubleClick}>
                        {showLetters ? toLetter(p.offRating) : p.offRating}
                      </td>
                      <td className="py-1.5 px-3" onDoubleClick={handleCellDoubleClick}>
                        {showLetters ? toLetter(p.defRating) : p.defRating}
                      </td>
                      <td className="py-1.5 px-3" onDoubleClick={handleCellDoubleClick}>
                        {showLetters ? toLetter(p.stamina) : p.stamina}
                      </td>
                      <td className="py-1.5 px-3" onDoubleClick={handleCellDoubleClick}>
                        {showLetters ? toLetter(p.potential) : p.potential}
                      </td>
                      {attrColumns.map((a) => (
                        <td key={a.key} className="py-1.5 px-3" onDoubleClick={handleCellDoubleClick}>
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

      <button
        onClick={() => navigate("/team-hub")}
        className={`${styles.legacyBackButton} bmLegacyRouteBack mt-4 px-8 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition`}
      >
        Back to Team Hub
      </button>

      <PlayerCardModal
        open={playerCardOpen}
        player={cardTargetPlayer}
        team={getTeamForPlayer(cardTargetPlayer)}
        teamName={getTeamForPlayer(cardTargetPlayer)?.name || (isAllView ? teamOfPlayer[getPlayerKey(cardTargetPlayer)]?.teamName : activeRosterTeam?.name || selectedTeam?.name)}
        teamLogo={getTeamForPlayer(cardTargetPlayer)?.logo || teamOfPlayer[getPlayerKey(cardTargetPlayer)]?.logo || activeRosterTeam?.logo || selectedTeam?.logo}
        leagueData={workingLeagueData}
        onClose={closePlayerCard}
      />

      {releaseModalOpen && releaseTargetPlayer && !isAllView && (
        <div className={`${styles.modalLayer} fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4`}>
          <div className="w-full max-w-xl bg-neutral-800 rounded-2xl border border-neutral-700 shadow-2xl p-6">
            <h2 className="text-2xl font-bold text-orange-400 mb-3">
              Release to Free Agency
            </h2>

            <p className="text-white text-lg mb-2">
              {releaseTargetPlayer.name}
            </p>

            <p className="text-gray-300 mb-4 leading-relaxed">
              Releasing this player will move him into free agency immediately. You still owe the original remaining guaranteed salary as dead cap on the original contract years. If another team signs him later, a set-off credit may reduce the old team's dead cap.
            </p>

            {releaseInfo?.totalOwed > 0 ? (
              <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-700 mb-5">
                <p className="text-red-300 font-semibold mb-2">
                  Warning: You will still owe {formatDollars(releaseInfo.totalOwed)}.
                </p>

                <div className="mb-3 rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-gray-300">
                  No stretch is applied. The dead cap follows the player's original remaining contract years
                  {releaseInfo.untilSeason ? ` through ${releaseInfo.untilSeason}` : ""}.
                </div>

                <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
                  Original guaranteed salary owed
                </div>
                <div className="space-y-1 text-sm text-gray-300 mb-4">
                  {releaseInfo.remainingRows.map((row) => (
                    <div key={`original-${row.label}`} className="flex justify-between">
                      <span>{row.label}</span>
                      <span>{formatDollars(row.amount)}</span>
                    </div>
                  ))}
                </div>

                {releaseInfo.releasePreview?.capRows?.length > 0 && (
                  <>
                    <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
                      Dead-cap hits after release
                    </div>
                    <div className="space-y-1 text-sm text-gray-300">
                      {releaseInfo.releasePreview.capRows.map((row) => (
                        <div key={`release-dead-cap-${row.label}`} className="flex justify-between">
                          <span>{row.label}</span>
                          <span>{formatDollars(row.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-700 mb-5">
                <p className="text-gray-300">
                  This player has no remaining guaranteed salary stored in the contract.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={closeReleaseModal}
                className="px-5 py-2 rounded-lg bg-gray-600 hover:bg-gray-500 text-white font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleReleaseToFreeAgency}
                className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition"
              >
                Release to Free Agency
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  
    </PageFade>
  );
}
