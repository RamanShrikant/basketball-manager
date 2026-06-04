import React, { useState, useEffect, useMemo } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";
import { releasePlayerToFreeAgency } from "../api/simEnginePy.js";
import PlayerCardModal from "../components/PlayerCardModal.jsx";
import styles from "./RosterView.module.css";
import PageFade from "../components/PageFade";
import "../styles/BMAnimations.css";

export default function RosterView() {
  const { leagueData, selectedTeam, setSelectedTeam, setLeagueData } = useGame();
  const [workingLeagueData, setWorkingLeagueData] = useState(leagueData || null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "desc" });
  const [showLetters, setShowLetters] = useState(
    localStorage.getItem("showLetters") === "true"
  );
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [releaseTargetPlayer, setReleaseTargetPlayer] = useState(null);
  const [playerActionOpen, setPlayerActionOpen] = useState(false);
  const [actionTargetPlayer, setActionTargetPlayer] = useState(null);
  const [playerCardOpen, setPlayerCardOpen] = useState(false);
  const [cardTargetPlayer, setCardTargetPlayer] = useState(null);
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

  const getStandardMinimumSalary = () => {
    return Number(
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

  const getPlayerProSeasons = (player) => {
    const keys = [
      "proSeasons",
      "seasonsPro",
      "yearsPro",
      "yearsOfExperience",
      "yoe",
    ];

    for (const key of keys) {
      const value = player?.[key];
      if (value !== undefined && value !== null && value !== "") {
        return Number(value) || 0;
      }
    }

    const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
    for (const key of keys) {
      const value = meta?.[key];
      if (value !== undefined && value !== null && value !== "") {
        return Number(value) || 0;
      }
    }

    return 0;
  };

  const getPlayerRookieReferenceYear = (player) => {
    const keys = [
      "rookieYear",
      "rookie_year",
      "rookieSeason",
      "rookie_season",
      "rookieSeasonYear",
      "rookie_season_year",
      "draftYear",
      "draft_year",
    ];

    for (const key of keys) {
      const value = Number(player?.[key]);
      if (Number.isFinite(value) && value > 1900) return value;
    }

    const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
    for (const key of keys) {
      const value = Number(meta?.[key]);
      if (Number.isFinite(value) && value > 1900) return value;
    }

    return null;
  };

  const isPlayerTwoWayEligible = (player) => {
    if (!player || player.isTwoWay || player.isStash) return false;

    const currentSeasonYear = getCurrentSeasonYear();
    const rookieYear = getPlayerRookieReferenceYear(player);

    if (rookieYear !== null) {
      return Math.max(0, currentSeasonYear - rookieYear) <= 2;
    }

    // Fallback for saves that only track years/pro seasons. Keep this forgiving
    // because some rosters store completed seasons, while others store current
    // season number.
    return getPlayerProSeasons(player) <= 3;
  };

  const getTwoWayAssignmentBlockReason = (player, team = selectedTeam) => {
    if (!player) return "No player selected.";
    if (isAllView) return "Switch to a team roster first before assigning a two-way.";
    if (player.isTwoWay) return "This player is already on a two-way contract.";
    if (player.isStash) return "Stashed players are team-controlled but cannot be assigned again until their offseason return decision.";

    const twoWayCount = getTwoWayPlayers(team).length;
    if (twoWayCount >= 3) {
      return "This team already has the maximum 3 two-way players.";
    }

    if (!isPlayerTwoWayEligible(player)) {
      return "Only players in their first 3 seasons can be assigned to a two-way contract.";
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
    if (selectedTeam) localStorage.setItem("selectedTeam", JSON.stringify(selectedTeam));
  }, [selectedTeam]);

  // teams sorted
  const teamsSorted = useMemo(() => {
    if (!workingLeagueData?.conferences) return [];
    return Object.values(workingLeagueData.conferences)
      .flat()
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [workingLeagueData]);

  // Always render/count from the freshest team object in workingLeagueData.
  // selectedTeam can lag after roster moves, FA signings, or bucket changes.
  const liveSelectedTeam = useMemo(() => {
    if (!selectedTeam?.name) return selectedTeam || null;
    return teamsSorted.find((team) => team?.name === selectedTeam.name) || selectedTeam || null;
  }, [teamsSorted, selectedTeam]);

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
    const idx = teamsSorted.findIndex((t) => t.name === selectedTeam?.name);
    setViewIndex(idx >= 0 ? idx : 0);
  }, [teamsSorted, selectedTeam]);

  const totalSlots = teamsSorted.length + 1; // +1 for All Players
  const isAllView = viewIndex === teamsSorted.length;

  const handleTeamSwitch = (dir) => {
    if (!totalSlots) return;
    setViewIndex((prev) => {
      const next =
        dir === "next"
          ? (prev + 1 + totalSlots) % totalSlots
          : (prev - 1 + totalSlots) % totalSlots;
      if (next < teamsSorted.length) setSelectedTeam(teamsSorted[next]);
      setSelectedPlayer(null);
      return next;
    });
  };

  // active rows
  const viewPlayers = isAllView
    ? allLeaguePlayers
    : [
        ...(liveSelectedTeam?.players || []),
        ...getTwoWayPlayers(liveSelectedTeam).map(markTwoWayPlayer),
        ...getStashPlayers(liveSelectedTeam).map(markStashPlayer),
      ];

  useEffect(() => {
    if (!viewPlayers?.length) {
      setSelectedPlayer(null);
      return;
    }
    if (!selectedPlayer || !viewPlayers.some((p) => p.name === selectedPlayer.name)) {
      setSelectedPlayer(viewPlayers[0]);
    }
  }, [viewPlayers, selectedPlayer]);

  // sorting
  const positionOrder = ["PG", "SG", "SF", "PF", "C"];

  const handleSort = (key) => {
    let direction = "desc";
    if (sortConfig.key === key && sortConfig.direction === "desc") direction = "asc";
    else if (sortConfig.key === key && sortConfig.direction === "asc") direction = "default";
    setSortConfig({ key, direction });
  };

  const sortedPlayers = useMemo(() => {
    if (!sortConfig.key || sortConfig.direction === "default") return viewPlayers;
    const rows = [...viewPlayers];
    rows.sort((a, b) => {
      const key = sortConfig.key;
      if (key === "pos") {
        const aIdx = positionOrder.indexOf(a.pos);
        const bIdx = positionOrder.indexOf(b.pos);
        const diff = (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
        return sortConfig.direction === "asc" ? diff : -diff;
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

  const openPlayerActions = (player, e) => {
    e?.stopPropagation?.();
    if (!player) return;
    setSelectedPlayer(player);
    setActionTargetPlayer(player);
    setPlayerActionOpen(true);
  };

  const closePlayerActions = () => {
    setPlayerActionOpen(false);
    setActionTargetPlayer(null);
  };

  const openPlayerCard = (player) => {
    if (!player) return;
    setCardTargetPlayer(player);
    setPlayerCardOpen(true);
    closePlayerActions();
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
      localStorage.setItem("selectedTeam", JSON.stringify(updatedTeam));
    }

    localStorage.setItem("leagueData", JSON.stringify(updated));
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

  const buildStandardContractFromTwoWay = (player) => {
    const minimumSalary = getStandardMinimumSalary();
    const storedStandardContract =
      player?.previousStandardContract ||
      player?.standardContractBeforeTwoWay ||
      null;

    if (
      storedStandardContract &&
      Array.isArray(storedStandardContract.salaryByYear) &&
      storedStandardContract.salaryByYear.length
    ) {
      return {
        ...storedStandardContract,
        salaryByYear: storedStandardContract.salaryByYear.map((amount) =>
          Math.max(minimumSalary, Number(amount || 0))
        ),
        option: storedStandardContract.option || null,
      };
    }

    const originalSalaries = Array.isArray(player?.contract?.salaryByYear)
      ? player.contract.salaryByYear
      : [];
    const years = Math.max(1, originalSalaries.length || 1);

    return {
      ...(player?.contract || {}),
      startYear: Number(player?.contract?.startYear || getCurrentSeasonYear()),
      salaryByYear: Array.from({ length: years }, (_, idx) =>
        Math.max(minimumSalary, Number(originalSalaries[idx] || 0))
      ),
      option: player?.contract?.option || null,
    };
  };

  const buildTwoWayContractFromStandard = () => ({
    startYear: getCurrentSeasonYear(),
    salaryByYear: [0],
    option: null,
  });

  const handleAssignStandardToTwoWay = (player) => {
    if (!player || isAllView) return;

    const blockReason = getTwoWayAssignmentBlockReason(player, liveSelectedTeam);
    if (blockReason) {
      console.warn("[RosterView] two-way assignment blocked:", blockReason);
      return;
    }

    let assignedPlayer = null;
    const result = updateSelectedTeamInLeague((team) => {
      const standardPlayers = Array.isArray(team.players) ? team.players : [];
      const twoWayPlayers = getTwoWayPlayers(team);

      const previousStandardContract = player?.previousStandardContract || player?.contract || null;
      const previousTwoWayYearsUsed = Number(player?.twoWayMeta?.twoWayYearsUsed || 0) || 0;

      const cleanedPlayer = {
        ...player,
        isTwoWay: true,
        rosterStatus: "two_way",
        contractType: "two_way",
        previousStandardContract,
        previousContract: player?.previousContract || previousStandardContract,
        contract: buildTwoWayContractFromStandard(player),
        twoWayMeta: {
          ...(player?.twoWayMeta || {}),
          assignedByTeam: team.name,
          assignedSeasonYear: getCurrentSeasonYear(),
          twoWayYearsUsed: Math.max(1, previousTwoWayYearsUsed || 1),
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
      setActionTargetPlayer(assignedPlayer);
    }

    closePlayerActions();
  };

  const handleUpgradeTwoWayToStandard = (player) => {
    if (!player || isAllView) return;

    let upgradedPlayer = null;
    const result = updateSelectedTeamInLeague((team) => {
      const twoWayPlayers = getTwoWayPlayers(team).filter((row) => !samePlayer(row, player));
      const standardPlayers = Array.isArray(team.players) ? team.players : [];

      const cleanedPlayer = {
        ...player,
        isTwoWay: false,
        rosterStatus: "standard",
        contractType: "standard",
        contract: buildStandardContractFromTwoWay(player),
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
      setActionTargetPlayer(upgradedPlayer);
    }

    closePlayerActions();
  };

  const handleReleaseTwoWayToFreeAgency = (player) => {
    if (!player || isAllView || !workingLeagueData?.conferences) return;

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
    closePlayerActions();
  };

  const openReleaseFromActions = (player) => {
    if (!player || isAllView) return;
    setReleaseTargetPlayer(player);
    setReleaseModalOpen(true);
    closePlayerActions();
  };

  const closeReleaseModal = () => {
    setReleaseModalOpen(false);
    setReleaseTargetPlayer(null);
  };

  const handleReleaseToFreeAgency = async () => {
    if (!releaseTargetPlayer || !selectedTeam || !workingLeagueData?.conferences) return;

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
        localStorage.setItem("selectedTeam", JSON.stringify(updatedTeam));
      }

      localStorage.setItem("leagueData", JSON.stringify(updated));

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
  const headerTitle = isAllView ? "All Players" : `${liveSelectedTeam?.name || selectedTeam?.name || "Team"} Roster`;
  const showTeamCol = isAllView; // logo column only in All Players view
  const regularSeasonStandardRosterLimit = Number(
    workingLeagueData?.rosterLimit ||
    workingLeagueData?.maxRosterSize ||
    15
  );
  const standardRosterCount = !isAllView && liveSelectedTeam?.players
    ? liveSelectedTeam.players.length
    : 0;
  const twoWayRosterCount = !isAllView ? getTwoWayPlayers(liveSelectedTeam).length : 0;
  const stashRosterCount = !isAllView ? getStashPlayers(liveSelectedTeam).length : 0;
  const rosterOverRegularSeasonLimit =
    !isAllView && standardRosterCount > regularSeasonStandardRosterLimit;

  // OVR circle
  const fillPercent = Math.min((player.overall || 0) / 99, 1);
  const circleCircumference = 2 * Math.PI * 50;
  const strokeOffset = circleCircumference * (1 - fillPercent);

  return (
    <PageFade>
    <div className={`${styles.rosterPage} min-h-screen text-white flex flex-col items-center py-10`}>
      {/* Static header with pinned arrows */}
      <div className="w-full max-w-5xl flex items-center justify-between mb-6 select-none">
        <div className="w-24 flex items-center justify-start">
          <button
            onClick={() => handleTeamSwitch("prev")}
            className="text-4xl text-white hover:text-orange-400 transition-transform active:scale-90 font-bold"
            title="Previous Team"
          >
            ◄
          </button>
        </div>
        <h1 className="text-4xl font-extrabold text-orange-500 text-center">
          {headerTitle}
        </h1>
        <div className="w-24 flex items-center justify-end">
          <button
            onClick={() => handleTeamSwitch("next")}
            className="text-4xl text-white hover:text-orange-400 transition-transform active:scale-90 font-bold"
            title="Next Team"
          >
            ►
          </button>
        </div>
      </div>

      {!isAllView && (
        <div className={`mb-5 w-full max-w-5xl rounded-xl border px-5 py-3 text-sm ${
          rosterOverRegularSeasonLimit
            ? "border-orange-400/40 bg-orange-500/10 text-orange-100"
            : "border-neutral-700 bg-neutral-900/65 text-neutral-300"
        }`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-semibold">
              Standard contracts: {standardRosterCount}/{regularSeasonStandardRosterLimit}
            </span>
            <span className="text-emerald-200">
              Two-way contracts: {twoWayRosterCount}/3
            </span>
            <span className="text-amber-200">
              Stashes: {stashRosterCount}
            </span>
          </div>
          {rosterOverRegularSeasonLimit && (
            <p className="mt-2 text-orange-100">
              You can carry extra players for now, but before simulating you must either release players or assign eligible first-3-season players to two-way contracts until you are at {regularSeasonStandardRosterLimit} or fewer standard contracts.
            </p>
          )}
        </div>
      )}

      {/* Player Card */}
      <div className="relative w-full flex justify-center">
        <div className="relative bg-neutral-800 w-full max-w-5xl px-8 pt-8 pb-3 rounded-t-xl shadow-lg">
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
                <h2 className="text-[44px] font-bold leading-tight flex items-center gap-3">
                  <span>{player?.name || "-"}</span>
                  {player?.isTwoWay && (
                    <span className="inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-500/15 px-2 py-1 text-[12px] font-extrabold text-emerald-200">
                      2W
                    </span>
                  )}
                  {player?.isStash && (
                    <span className="inline-flex items-center rounded-full border border-amber-400/25 bg-amber-500/15 px-2 py-1 text-[12px] font-extrabold text-amber-200">
                      STASH
                    </span>
                  )}
                </h2>
                <p className="text-gray-400 text-[24px] mt-1">
                  {player?.pos || "-"}
                  {player?.secondaryPos ? ` / ${player.secondaryPos}` : ""} • Age{" "}
                  {player?.age ?? "-"}
                  {player?.isTwoWay ? " • Two-Way Contract" : ""}
                  {player?.isStash ? " • Stashed" : ""}
                </p>
              </div>
            </div>

            <div className="relative flex flex-col items-center justify-center mr-4 mb-2">
              <svg width="110" height="110" viewBox="0 0 120 120">
                <defs>
                  <linearGradient id="ovrGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#FFA500" />
                    <stop offset="100%" stopColor="#FFD54F" />
                  </linearGradient>
                </defs>
                <circle cx="60" cy="60" r="50" stroke="rgba(255,255,255,0.08)" strokeWidth="8" fill="none" />
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  stroke="url(#ovrGradient)"
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

      {/* Table */}
      <div className="w-full flex justify-center transition-opacity duration-300 ease-in-out mt-[-1px]">
        <div className={`${styles.tablePanel} w-full max-w-5xl overflow-x-auto no-scrollbar`}>
          <div className="min-w-[1200px] max-w-max mx-auto">
            <table className="w-full border-collapse text-center">
              <thead className="bg-neutral-800 text-gray-300 text-[16px] font-semibold">
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
                          {sortConfig.direction === "asc" ? "▲" : sortConfig.direction === "desc" ? "▼" : ""}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="text-[17px] font-medium">
                {sortedPlayers.map((p, idx) => {
                  const tinfo = teamOfPlayer[getPlayerKey(p)] || teamOfPlayer[`name:${p.name || ""}`] || {};
                  return (
                    <tr
                      key={`${p.name}-${idx}`}
                      onClick={() => setSelectedPlayer(p)}
                      className={`cursor-pointer transition ${
                        selectedPlayer && selectedPlayer.name === p.name
                          ? "bg-orange-600 text-white"
                          : p.isTwoWay
                          ? "bg-emerald-500/5 hover:bg-emerald-500/10"
                          : p.isStash
                          ? "bg-amber-500/5 hover:bg-amber-500/10"
                          : "hover:bg-neutral-800"
                      }`}
                    >
                      {showTeamCol && (
                        <td className="py-2 px-3">
                          {tinfo.logo ? (
                            <img
                              src={tinfo.logo}
                              alt={tinfo.teamName || "Team"}
                              className="h-6 w-6 object-contain inline-block align-middle"
                            />
                          ) : null}
                        </td>
                      )}

                      <td
                        className="py-2 px-3 whitespace-nowrap text-left pl-4"
                        onDoubleClick={(e) => openPlayerActions(p, e)}
                        title="Double click for player actions"
                      >
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
                      </td>
                      <td className="py-2 px-3">{p.pos}</td>
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
                        <td key={a.key} className="py-2 px-3" onDoubleClick={handleCellDoubleClick}>
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
        className="mt-10 px-8 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
      >
        Back to Team Hub
      </button>

      {playerActionOpen && actionTargetPlayer && (
        <div
          className={`${styles.modalLayer} fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePlayerActions();
          }}
        >
          <div className="relative w-full max-w-lg overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950 shadow-[0_28px_90px_rgba(0,0,0,0.65)]">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-600 via-amber-400 to-orange-600" />
            <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-orange-500/20 blur-3xl" />
            <div className="absolute -left-20 bottom-0 h-48 w-48 rounded-full bg-amber-400/10 blur-3xl" />

            <div className="relative p-5 sm:p-6">
              <div className="flex items-center gap-4">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-neutral-900">
                  {actionTargetPlayer?.headshot ? (
                    <img
                      src={actionTargetPlayer.headshot}
                      alt={actionTargetPlayer.name}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs font-bold text-neutral-500">
                      No Image
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-xs font-black uppercase tracking-[0.22em] text-orange-300">
                    Player Actions
                  </div>
                  <h2 className="mt-1 truncate text-2xl font-black text-white">
                    {actionTargetPlayer?.name || "Player"}
                    {actionTargetPlayer?.isTwoWay && (
                      <span className="ml-2 align-middle inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-extrabold text-emerald-200">
                        2W
                      </span>
                    )}
                    {actionTargetPlayer?.isStash && (
                      <span className="ml-2 align-middle inline-flex items-center rounded-full border border-amber-400/25 bg-amber-500/15 px-2 py-0.5 text-[10px] font-extrabold text-amber-200">
                        STASH
                      </span>
                    )}
                  </h2>
                  <div className="mt-1 text-sm font-semibold text-neutral-400">
                    {actionTargetPlayer?.pos || "-"}
                    {actionTargetPlayer?.secondaryPos ? ` / ${actionTargetPlayer.secondaryPos}` : ""}
                    {" • "}Age {actionTargetPlayer?.age ?? "-"}
                    {" • "}OVR {actionTargetPlayer?.overall ?? "-"}
                    {actionTargetPlayer?.isTwoWay ? " • Two-Way" : ""}
                    {actionTargetPlayer?.isStash ? " • Stashed" : ""}
                  </div>
                </div>

                <button
                  onClick={closePlayerActions}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-black text-neutral-300 transition hover:bg-white/10 hover:text-white"
                  title="Close"
                >
                  ✕
                </button>
              </div>

              <div className="mt-6 grid gap-3">
                <button
                  onClick={() => openPlayerCard(actionTargetPlayer)}
                  className="group flex items-center justify-between rounded-2xl border border-orange-400/25 bg-orange-500/10 px-5 py-4 text-left transition hover:-translate-y-0.5 hover:border-orange-300/50 hover:bg-orange-500/20 hover:shadow-[0_18px_40px_rgba(234,88,12,0.18)]"
                >
                  <div>
                    <div className="text-lg font-black text-white">View Player Card</div>
                    <div className="mt-1 text-sm font-semibold text-neutral-400">
                      Mood, history, accolades, contract, ratings, and transactions.
                    </div>
                  </div>
                  <div className="ml-4 rounded-full bg-orange-500 px-3 py-1 text-sm font-black text-white transition group-hover:bg-orange-400">
                    Open
                  </div>
                </button>

                {actionTargetPlayer?.isStash ? (
                  <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 px-5 py-4">
                    <div className="text-lg font-black text-white">Stashed Player</div>
                    <div className="mt-1 text-sm font-semibold text-neutral-300">
                      This player is controlled by the team but is not on the 15-man roster, cannot receive minutes, and returns on the next offseason options screen.
                    </div>
                  </div>
                ) : actionTargetPlayer?.isTwoWay ? (
                  <>
                    <button
                      onClick={() => handleUpgradeTwoWayToStandard(actionTargetPlayer)}
                      disabled={isAllView}
                      className={`flex items-center justify-between rounded-2xl border px-5 py-4 text-left transition ${
                        isAllView
                          ? "cursor-not-allowed border-white/10 bg-white/[0.03] opacity-50"
                          : "border-emerald-400/25 bg-emerald-500/10 hover:-translate-y-0.5 hover:border-emerald-300/50 hover:bg-emerald-500/20 hover:shadow-[0_18px_40px_rgba(16,185,129,0.16)]"
                      }`}
                    >
                      <div>
                        <div className="text-lg font-black text-white">Upgrade to Standard Contract</div>
                        <div className="mt-1 text-sm font-semibold text-neutral-400">
                          Move him from the two-way list to the 15-man roster on a minimum standard contract.
                        </div>
                      </div>
                      <div className="ml-4 rounded-full bg-emerald-600 px-3 py-1 text-sm font-black text-white">
                        Upgrade
                      </div>
                    </button>

                    <button
                      onClick={() => handleReleaseTwoWayToFreeAgency(actionTargetPlayer)}
                      disabled={isAllView}
                      className={`flex items-center justify-between rounded-2xl border px-5 py-4 text-left transition ${
                        isAllView
                          ? "cursor-not-allowed border-white/10 bg-white/[0.03] opacity-50"
                          : "border-red-400/25 bg-red-500/10 hover:-translate-y-0.5 hover:border-red-300/50 hover:bg-red-500/20 hover:shadow-[0_18px_40px_rgba(239,68,68,0.16)]"
                      }`}
                    >
                      <div>
                        <div className="text-lg font-black text-white">Release Two-Way Player</div>
                        <div className="mt-1 text-sm font-semibold text-neutral-400">
                          Remove him from the two-way list and move him to free agency with no dead cap.
                        </div>
                      </div>
                      <div className="ml-4 rounded-full bg-red-600 px-3 py-1 text-sm font-black text-white">
                        Release
                      </div>
                    </button>
                  </>
                ) : (
                  <>
                    {(() => {
                      const blockReason = getTwoWayAssignmentBlockReason(actionTargetPlayer, liveSelectedTeam);
                      const disabled = Boolean(blockReason);

                      return (
                        <button
                          onClick={() => handleAssignStandardToTwoWay(actionTargetPlayer)}
                          disabled={disabled}
                          className={`flex items-center justify-between rounded-2xl border px-5 py-4 text-left transition ${
                            disabled
                              ? "cursor-not-allowed border-white/10 bg-white/[0.03] opacity-50"
                              : "border-emerald-400/25 bg-emerald-500/10 hover:-translate-y-0.5 hover:border-emerald-300/50 hover:bg-emerald-500/20 hover:shadow-[0_18px_40px_rgba(16,185,129,0.16)]"
                          }`}
                        >
                          <div>
                            <div className="text-lg font-black text-white">Assign to Two-Way Contract</div>
                            <div className="mt-1 text-sm font-semibold text-neutral-400">
                              {blockReason || "Move him out of the 15-man standard roster for the rest of the season. Two-way players do not count against team salary cap."}
                            </div>
                          </div>
                          <div className="ml-4 rounded-full bg-emerald-600 px-3 py-1 text-sm font-black text-white">
                            2-Way
                          </div>
                        </button>
                      );
                    })()}

                    <button
                      onClick={() => openReleaseFromActions(actionTargetPlayer)}
                      disabled={isAllView}
                      className={`flex items-center justify-between rounded-2xl border px-5 py-4 text-left transition ${
                        isAllView
                          ? "cursor-not-allowed border-white/10 bg-white/[0.03] opacity-50"
                          : "border-red-400/25 bg-red-500/10 hover:-translate-y-0.5 hover:border-red-300/50 hover:bg-red-500/20 hover:shadow-[0_18px_40px_rgba(239,68,68,0.16)]"
                      }`}
                    >
                      <div>
                        <div className="text-lg font-black text-white">Release to Free Agency</div>
                        <div className="mt-1 text-sm font-semibold text-neutral-400">
                          {isAllView
                            ? "Switch to a team roster first before releasing a player."
                            : "Move him to free agency and keep the original remaining guaranteed salary as dead cap."}
                        </div>
                      </div>
                      <div className="ml-4 rounded-full bg-red-600 px-3 py-1 text-sm font-black text-white">
                        Release
                      </div>
                    </button>
                  </>
                )}
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs font-semibold text-neutral-500">
                Tip: single click selects a player. Double click the player name to open this menu.
              </div>
            </div>
          </div>
        </div>
      )}

      <PlayerCardModal
        open={playerCardOpen}
        player={cardTargetPlayer}
        team={getTeamForPlayer(cardTargetPlayer)}
        teamName={getTeamForPlayer(cardTargetPlayer)?.name || (isAllView ? teamOfPlayer[getPlayerKey(cardTargetPlayer)]?.teamName : liveSelectedTeam?.name || selectedTeam?.name)}
        teamLogo={getTeamForPlayer(cardTargetPlayer)?.logo || teamOfPlayer[getPlayerKey(cardTargetPlayer)]?.logo || liveSelectedTeam?.logo || selectedTeam?.logo}
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
