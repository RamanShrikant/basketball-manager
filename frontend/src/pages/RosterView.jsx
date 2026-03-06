import React, { useState, useEffect, useMemo } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";
import { releasePlayerToFreeAgency } from "../api/simEnginePy.js";

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
  const navigate = useNavigate();

  useEffect(() => {
    setWorkingLeagueData(leagueData || null);
  }, [leagueData]);

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

  const getCurrentSeasonYear = () => {
    return Number(
      workingLeagueData?.seasonYear ||
      workingLeagueData?.currentSeasonYear ||
      2026
    );
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
    const untilSeason = remainingRows.length
      ? remainingRows[remainingRows.length - 1].label
      : null;

    return {
      totalOwed,
      untilSeason,
      remainingRows,
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

  // all players list
  const allLeaguePlayers = useMemo(
    () => teamsSorted.flatMap((t) => t.players || []),
    [teamsSorted]
  );

  // map player -> team info (for logo column)
  const teamOfPlayer = useMemo(() => {
    const map = {};
    for (const t of teamsSorted) {
      const logo = t.logo || t.teamLogo || t.newTeamLogo || t.image || t.logoUrl || "";
      for (const p of t.players || []) map[p.name] = { teamName: t.name, logo };
    }
    return map;
  }, [teamsSorted]);

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
  const viewPlayers = isAllView ? allLeaguePlayers : (selectedTeam?.players || []);

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

  const handleNameDoubleClick = (player, e) => {
    e.stopPropagation();
    if (isAllView) return;
    setSelectedPlayer(player);
    setReleaseTargetPlayer(player);
    setReleaseModalOpen(true);
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
  const headerTitle = isAllView ? "All Players" : `${selectedTeam.name} Roster`;
  const showTeamCol = isAllView; // logo column only in All Players view

  // OVR circle
  const fillPercent = Math.min((player.overall || 0) / 99, 1);
  const circleCircumference = 2 * Math.PI * 50;
  const strokeOffset = circleCircumference * (1 - fillPercent);

  return (
    <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center py-10">
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
                <h2 className="text-[44px] font-bold leading-tight">{player?.name || "-"}</h2>
                <p className="text-gray-400 text-[24px] mt-1">
                  {player?.pos || "-"}
                  {player?.secondaryPos ? ` / ${player.secondaryPos}` : ""} • Age{" "}
                  {player?.age ?? "-"}
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
        <div className="w-full max-w-5xl overflow-x-auto no-scrollbar">
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
                  const tinfo = teamOfPlayer[p.name] || {};
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
                        onDoubleClick={(e) => handleNameDoubleClick(p, e)}
                        title={isAllView ? p.name : "Double click to release to free agency"}
                      >
                        {p.name}
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

      {releaseModalOpen && releaseTargetPlayer && !isAllView && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="w-full max-w-xl bg-neutral-800 rounded-2xl border border-neutral-700 shadow-2xl p-6">
            <h2 className="text-2xl font-bold text-orange-400 mb-3">
              Release to Free Agency
            </h2>

            <p className="text-white text-lg mb-2">
              {releaseTargetPlayer.name}
            </p>

            <p className="text-gray-300 mb-4 leading-relaxed">
              Releasing this player will move him into free agency immediately.
              In this game, the remaining guaranteed contract is kept on your books as dead money.
            </p>

            {releaseInfo?.totalOwed > 0 ? (
              <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-700 mb-5">
                <p className="text-red-300 font-semibold mb-2">
                  Warning: You will still owe {formatDollars(releaseInfo.totalOwed)}
                  {releaseInfo.untilSeason ? ` through ${releaseInfo.untilSeason}` : ""}.
                </p>

                <div className="space-y-1 text-sm text-gray-300">
                  {releaseInfo.remainingRows.map((row) => (
                    <div key={row.label} className="flex justify-between">
                      <span>{row.label}</span>
                      <span>{formatDollars(row.amount)}</span>
                    </div>
                  ))}
                </div>
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
  );
}