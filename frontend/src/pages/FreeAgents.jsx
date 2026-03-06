import React, { useState, useEffect, useMemo } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";

// If your simEnginePy.js lives elsewhere, only change this one import line.
import {
  evaluateFreeAgencyOffer,
  signFreeAgent,
  generateFreeAgencyMarket,
} from "../api/simEnginePy.js";

export default function FreeAgents() {
  const { leagueData, selectedTeam, setSelectedTeam, setLeagueData } = useGame();
  const [workingLeagueData, setWorkingLeagueData] = useState(leagueData || null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "desc" });
  const [showLetters, setShowLetters] = useState(
    localStorage.getItem("showLetters") === "true"
  );

  const [signModalOpen, setSignModalOpen] = useState(false);
  const [signTargetPlayer, setSignTargetPlayer] = useState(null);
  const [offerSalaryText, setOfferSalaryText] = useState("");
  const [offerYears, setOfferYears] = useState(1);
  const [optionType, setOptionType] = useState("none");
  const [optionYear, setOptionYear] = useState(1);
  const [offerEvaluation, setOfferEvaluation] = useState(null);
  const [offerEvalLoading, setOfferEvalLoading] = useState(false);
  const [signError, setSignError] = useState("");

  const navigate = useNavigate();

  useEffect(() => {
    setWorkingLeagueData(leagueData || null);
  }, [leagueData]);

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

  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

  const formatDollars = (amount) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(Number(amount || 0));
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

  const freeAgents = useMemo(() => {
    return workingLeagueData?.freeAgents || [];
  }, [workingLeagueData]);

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
        const res = await generateFreeAgencyMarket(workingLeagueData);
        if (cancelled) return;
        if (!res?.ok || !res?.leagueData) return;

        setWorkingLeagueData(res.leagueData);

        if (typeof setLeagueData === "function") {
          setLeagueData(res.leagueData);
        }

        localStorage.setItem("leagueData", JSON.stringify(res.leagueData));
      } catch (err) {
        console.error("Failed to generate free agency market", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workingLeagueData, freeAgents, setLeagueData]);

  useEffect(() => {
    if (!freeAgents.length) {
      setSelectedPlayer(null);
      return;
    }

    if (!selectedPlayer || !freeAgents.some((p) => p.name === selectedPlayer.name)) {
      setSelectedPlayer(freeAgents[0]);
    }
  }, [freeAgents, selectedPlayer]);

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
  }, [freeAgents, sortConfig]);

  const getOfferSalaryByYear = (year1Salary, years) => {
    const out = [];
    for (let i = 0; i < years; i++) {
      const salary = year1Salary * ((1 + 0.05) ** i);
      out.push(Math.round(salary / 1000) * 1000);
    }
    return out;
  };

  const buildOfferContract = (year1Salary, years, currentOptionType, currentOptionYear) => {
    const startYear = getCurrentSeasonYear();
    const salaryByYear = getOfferSalaryByYear(year1Salary, years);

    return {
      startYear,
      salaryByYear,
      option:
        currentOptionType === "none"
          ? null
          : {
              type: currentOptionType,
              yearIndex: currentOptionYear - 1,
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
    setOptionYear(defaultYears);
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

    const offer = buildOfferContract(year1Salary, offerYears, optionType, optionYear);

    let cancelled = false;
    setOfferEvalLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await evaluateFreeAgencyOffer(
          workingLeagueData,
          selectedTeam.name,
          signTargetPlayer,
          offer
        );

        if (cancelled) return;
        setOfferEvaluation(res);
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
    optionYear,
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

  const handleSignPlayer = async () => {
    if (!signTargetPlayer || !selectedTeam || !workingLeagueData) return;

    setSignError("");

    const year1Salary = parseMillionsText(offerSalaryText);
    if (!year1Salary) {
      setSignError("Enter a valid first-year salary.");
      return;
    }

    const offer = buildOfferContract(year1Salary, offerYears, optionType, optionYear);

    try {
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

      const updated = res.leagueData;
      setWorkingLeagueData(updated);

      if (typeof setLeagueData === "function") {
        setLeagueData(updated);
      }

      localStorage.setItem("leagueData", JSON.stringify(updated));

      if (typeof setSelectedTeam === "function") {
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

      closeSignModal();
    } catch (err) {
      setSignError(err?.message || "Signing failed.");
    }
  };

  if (!freeAgents.length) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-neutral-900 text-white">
        <p className="text-lg mb-4">No free agents available.</p>
        <button
          onClick={() => navigate("/team-hub")}
          className="px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
        >
          Back to Team Hub
        </button>
      </div>
    );
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

      <div className="w-full max-w-5xl flex items-center justify-center mb-6 select-none">
        <h1 className="text-4xl font-extrabold text-orange-500 text-center">
          Free Agents
        </h1>
      </div>

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
                <h2 className="text-[44px] font-bold leading-tight">
                  {player?.name || "-"}
                </h2>
                <p className="text-gray-400 text-[24px] mt-1">
                  {player?.pos || "-"}
                  {player?.secondaryPos ? ` / ${player.secondaryPos}` : ""} • Age{" "}
                  {player?.age ?? "-"}
                </p>
                <p className="text-gray-500 text-[18px] mt-1">Unsigned Free Agent</p>

                <div className="mt-4">
                  <button
                    onClick={() => openSignModal(player)}
                    disabled={!selectedTeam}
                    className="px-5 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold transition"
                  >
                    Offer Contract
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

      <div className="w-full flex justify-center transition-opacity duration-300 ease-in-out mt-[-1px]">
        <div className="w-full max-w-5xl overflow-x-auto no-scrollbar">
          <div className="min-w-[1200px] max-w-max mx-auto">
            <table className="w-full border-collapse text-center">
              <thead className="bg-neutral-800 text-gray-300 text-[16px] font-semibold">
                <tr>
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
                {sortedPlayers.map((p, idx) => (
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
                      title="Double click to offer contract"
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
                      <td
                        key={a.key}
                        className="py-2 px-3"
                        onDoubleClick={handleCellDoubleClick}
                      >
                        {showLetters ? toLetter(p.attrs?.[a.index] ?? 0) : p.attrs?.[a.index] ?? "-"}
                      </td>
                    ))}
                  </tr>
                ))}
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

      {signModalOpen && signTargetPlayer && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center overflow-y-auto z-50 px-4 py-6">
          <div className="fa-modal-scroll w-full max-w-xl max-h-[88vh] overflow-y-auto bg-neutral-800 rounded-2xl border border-neutral-700 shadow-2xl p-5 sm:p-4">
            <h2 className="text-xl font-bold text-orange-400 mb-1.5">
              Offer Contract
            </h2>

            <p className="text-white text-base mb-1">
              {signTargetPlayer.name}
            </p>

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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
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
                      if (optionYear > y) setOptionYear(y);
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <select
                    value={optionType}
                    onChange={(e) => {
                      setOptionType(e.target.value);
                      setSignError("");
                    }}
                    className="w-full px-4 py-2 rounded-lg bg-neutral-800 border border-neutral-600 text-white outline-none focus:border-orange-500"
                  >
                    <option value="none">No Option</option>
                    <option value="team">Team Option</option>
                    <option value="player">Player Option</option>
                  </select>
                </div>

                <div>
                  <select
                    value={optionYear}
                    onChange={(e) => {
                      setOptionYear(Number(e.target.value));
                      setSignError("");
                    }}
                    disabled={optionType === "none"}
                    className="w-full px-4 py-2 rounded-lg bg-neutral-800 border border-neutral-600 text-white outline-none focus:border-orange-500 disabled:opacity-50"
                  >
                    {Array.from({ length: offerYears }, (_, i) => i + 1).map((y) => (
                      <option key={y} value={y}>
                        Option Year {y}
                      </option>
                    ))}
                  </select>
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
                    optionType !== "none" && optionYear === idx + 1;

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

            {!offerEvalLoading && offerEvaluation?.ok && !offerEvaluation.accepted && (
              <div className="mb-4 text-yellow-300 text-sm font-semibold">
                Current offer is not strong enough yet.
              </div>
            )}

            {!offerEvalLoading && offerEvaluation?.ok && offerEvaluation.accepted && (
              <div className="mb-4 text-green-300 text-sm font-semibold">
                This player is ready to sign this offer.
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
                onClick={handleSignPlayer}
                disabled={!selectedTeam || offerEvalLoading}
                className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold transition"
              >
                Sign Player
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}