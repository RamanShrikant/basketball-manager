import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import PageFade from "../components/PageFade";
import styles from "./RosterView.module.css";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";

const TRADE_BUILDER_KEY = "bm_trade_builder_v1";
const MAX_SIDE_ITEMS = 6;

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function getTeamPlayers(team) {
  return [
    ...(Array.isArray(team?.players) ? team.players : []),
    ...(Array.isArray(team?.twoWayPlayers)
      ? team.twoWayPlayers.map((p) => ({ ...p, isTwoWay: true }))
      : []),
    ...(Array.isArray(team?.stashPlayers)
      ? team.stashPlayers.map((p) => ({ ...p, isStash: true }))
      : []),
  ];
}

function playerNameOf(player) {
  return player?.name || player?.player || "Unknown Player";
}

function getCurrentSeasonYear(leagueData) {
  return Number(
    leagueData?.seasonYear ||
      leagueData?.currentSeasonYear ||
      leagueData?.seasonStartYear ||
      2026
  );
}

function getPlayerSalary(player, leagueData) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract.salaryByYear) ? contract.salaryByYear : [];

  if (salaries.length) {
    const startYear = Number(contract.startYear || getCurrentSeasonYear(leagueData));
    let idx = getCurrentSeasonYear(leagueData) - startYear;
    if (!Number.isFinite(idx) || idx < 0) idx = 0;
    if (idx >= salaries.length) idx = salaries.length - 1;
    return Number(salaries[idx] || 0);
  }

  const fallback = Number(
    player?.salary ??
      player?.currentSalary ??
      player?.contractSalary ??
      player?.capHit ??
      player?.aav ??
      0
  );

  return Number.isFinite(fallback) ? fallback : 0;
}

function formatMoney(amount) {
  const n = Number(amount || 0);
  if (!Number.isFinite(n) || n === 0) return "$0";

  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);

  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${sign}$${Math.round(abs / 1000)}K`;
}

function readBuilder() {
  try {
    return JSON.parse(localStorage.getItem(TRADE_BUILDER_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveBuilder(builder) {
  localStorage.setItem(
    TRADE_BUILDER_KEY,
    JSON.stringify({ ...builder, updatedAt: Date.now() })
  );
}

function itemKey(item) {
  if (!item) return "";
  if (item.type === "player") {
    return `player:${item.player?.id || item.player?.playerId || playerNameOf(item.player)}`;
  }
  if (item.type === "pick") {
    return `pick:${item.pick?.id || item.pick?.pickId || JSON.stringify(item.pick)}`;
  }
  return JSON.stringify(item);
}

function getSideItems(builder, side) {
  return side === "user" ? builder.userItems || [] : builder.cpuItems || [];
}

function setSideItems(builder, side, items) {
  if (side === "user") return { ...builder, userItems: items };
  return { ...builder, cpuItems: items };
}

function playerKey(player) {
  return String(player?.id || player?.playerId || playerNameOf(player));
}

function RatingRing({ player }) {
  const overall = player?.overall ?? "-";
  const potential = player?.potential ?? "-";
  const value = Number(player?.overall || 0);
  const fillPercent = Math.min(Math.max(value, 0) / 99, 1);
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference * (1 - fillPercent);

  return (
    <div className="relative flex flex-col items-center justify-center mr-4 mb-2">
      <svg width="110" height="110" viewBox="0 0 120 120">
        <defs>
          <linearGradient id="tradeSelectOvrGradient" x1="0%" y1="0%" x2="100%" y2="0%">
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
          stroke="url(#tradeSelectOvrGradient)"
          strokeWidth="8"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeOffset}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center text-center">
        <p className="text-sm text-gray-300 tracking-wide mb-1">OVR</p>
        <p className="text-[47px] font-extrabold text-orange-400 leading-none mt-[-11px]">
          {overall}
        </p>
        <p className="text-[10px] text-gray-400 mt-[-2px]">
          POT <span className="text-orange-400 font-semibold">{potential}</span>
        </p>
      </div>
    </div>
  );
}

export default function TradePlayerSelect() {
  const navigate = useNavigate();
  const location = useLocation();
  const { leagueData } = useGame();

  const tradeSide = location.state?.tradeSide || "user";
  const tradeTeamName = location.state?.tradeTeamName || "";
  const returnTo = location.state?.returnTo || "/propose-trade";

  const teams = useMemo(() => getAllTeamsFromLeague(leagueData), [leagueData]);
  const team = teams.find((t) => t?.name === tradeTeamName) || teams[0] || null;
  const players = useMemo(() => getTeamPlayers(team), [team]);

  const [selectedKey, setSelectedKey] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "overall", direction: "desc" });

  useEffect(() => {
    document.body.classList.add("rv-roster-bg");
    return () => document.body.classList.remove("rv-roster-bg");
  }, []);

  const sortedPlayers = useMemo(() => {
    const rows = [...players];
    const { key, direction } = sortConfig;

    if (!key || direction === "default") return rows;

    rows.sort((a, b) => {
      let diff = 0;

      if (key === "name") {
        diff = playerNameOf(a).localeCompare(playerNameOf(b));
      } else if (key === "pos") {
        diff = String(a.pos || "").localeCompare(String(b.pos || ""));
      } else if (key === "salary") {
        diff = getPlayerSalary(a, leagueData) - getPlayerSalary(b, leagueData);
      } else {
        diff = Number(a?.[key] || 0) - Number(b?.[key] || 0);
      }

      return direction === "asc" ? diff : -diff;
    });

    return rows;
  }, [players, sortConfig]);

  useEffect(() => {
    if (!selectedKey && sortedPlayers[0]) {
      setSelectedKey(playerKey(sortedPlayers[0]));
    }
  }, [sortedPlayers, selectedKey]);

  const selectedPlayer =
    sortedPlayers.find((p) => playerKey(p) === selectedKey) || sortedPlayers[0] || null;

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key !== key) return { key, direction: key === "name" || key === "pos" ? "asc" : "desc" };
      if (prev.direction === "desc") return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "default" };
      return { key, direction: key === "name" || key === "pos" ? "asc" : "desc" };
    });
  };

  const sortArrow = (key) => {
    if (sortConfig.key !== key) return null;
    if (sortConfig.direction === "asc") return <span className="ml-1 text-orange-400">▲</span>;
    if (sortConfig.direction === "desc") return <span className="ml-1 text-orange-400">▼</span>;
    return null;
  };

  const addSelected = () => {
    if (!selectedPlayer || !team) return;

    const builder = readBuilder();
    const currentItems = getSideItems(builder, tradeSide);
    const nextItem = {
      type: "player",
      teamName: team.name,
      player: selectedPlayer,
    };

    const nextKey = itemKey(nextItem);
    const withoutDupes = currentItems.filter((item) => itemKey(item) !== nextKey);
    const nextItems = [...withoutDupes, nextItem].slice(0, MAX_SIDE_ITEMS);

    saveBuilder(setSideItems(builder, tradeSide, nextItems));
    navigate(returnTo);
  };

  return (
    <PageFade>
      <div className={`${styles.rosterPage} min-h-screen text-white flex flex-col items-center py-10 px-4`}>
        <div className="w-full max-w-5xl flex items-center justify-between mb-6 select-none">
          <div className="w-36 flex items-center justify-start">
            <button
              onClick={() => navigate(returnTo)}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-neutral-200 transition hover:bg-white/10 hover:text-white"
            >
              ← Back
            </button>
          </div>

          <div className="text-center">
            <div className="text-xs font-black uppercase tracking-[0.22em] text-orange-300">
              Select Player
            </div>
            <h1 className="mt-1 text-4xl font-extrabold text-orange-500">
              {team?.name || "Team"}
            </h1>
          </div>

          <div className="w-36 flex items-center justify-end">
            <button
              onClick={addSelected}
              disabled={!selectedPlayer}
              className="rounded-xl bg-orange-600 px-5 py-2 text-sm font-black text-white transition hover:bg-orange-500 disabled:opacity-50"
            >
              Add Player
            </button>
          </div>
        </div>

        {selectedPlayer && (
          <div className="relative w-full flex justify-center">
            <div className="relative bg-neutral-800 w-full max-w-5xl px-8 pt-8 pb-3 rounded-t-xl shadow-lg">
              <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-white opacity-60" />

              <div className="flex items-end justify-between relative">
                <div className="flex items-end gap-6 min-w-0">
                  <div className="relative -mb-[9px] shrink-0">
                    {selectedPlayer.headshot ? (
                      <img
                        src={selectedPlayer.headshot}
                        alt={playerNameOf(selectedPlayer)}
                        className="h-[175px] w-auto object-contain"
                      />
                    ) : (
                      <div className="h-[175px] w-[130px] bg-neutral-700 rounded flex items-center justify-center text-neutral-300">
                        No Image
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col justify-end mb-3 min-w-0">
                    <h2 className="text-[44px] font-bold leading-tight truncate">
                      {playerNameOf(selectedPlayer)}
                      {selectedPlayer?.isTwoWay && (
                        <span className="ml-3 align-middle inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-500/15 px-2 py-1 text-[12px] font-extrabold text-emerald-200">
                          2W
                        </span>
                      )}
                      {selectedPlayer?.isStash && (
                        <span className="ml-3 align-middle inline-flex items-center rounded-full border border-amber-400/25 bg-amber-500/15 px-2 py-1 text-[12px] font-extrabold text-amber-200">
                          STASH
                        </span>
                      )}
                    </h2>
                    <p className="text-gray-400 text-[24px] mt-1">
                      {selectedPlayer.pos || "-"}
                      {selectedPlayer.secondaryPos ? ` / ${selectedPlayer.secondaryPos}` : ""} • Age {selectedPlayer.age ?? "-"} • Salary {formatMoney(getPlayerSalary(selectedPlayer, leagueData))}
                    </p>
                  </div>
                </div>

                <RatingRing player={selectedPlayer} />
              </div>
            </div>
          </div>
        )}

        <div className="w-full flex justify-center transition-opacity duration-300 ease-in-out mt-[-1px]">
          <div className={`${styles.tablePanel} w-full max-w-5xl overflow-x-auto no-scrollbar`}>
            <table className="w-full min-w-[1020px] border-collapse text-center">
              <thead className="bg-neutral-800 text-gray-300 text-[16px] font-semibold">
                <tr>
                  {[
                    { key: "name", label: "Name" },
                    { key: "pos", label: "POS" },
                    { key: "age", label: "AGE" },
                    { key: "salary", label: "SALARY" },
                    { key: "overall", label: "OVR" },
                    { key: "offRating", label: "OFF" },
                    { key: "defRating", label: "DEF" },
                    { key: "stamina", label: "STAM" },
                    { key: "potential", label: "POT" },
                  ].map((col) => (
                    <th
                      key={col.key}
                      className={`py-3 px-3 min-w-[95px] cursor-pointer select-none ${
                        col.key === "name" ? "min-w-[180px] text-left pl-4" : col.key === "salary" ? "min-w-[110px] text-center" : "text-center"
                      }`}
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label}
                      {sortArrow(col.key)}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="text-[17px] font-medium">
                {sortedPlayers.map((p) => {
                  const key = playerKey(p);
                  const active = key === selectedKey;

                  return (
                    <tr
                      key={key}
                      onClick={() => setSelectedKey(key)}
                      onDoubleClick={addSelected}
                      className={`cursor-pointer transition ${
                        active
                          ? "bg-orange-600 text-white"
                          : p.isTwoWay
                          ? "bg-emerald-500/5 hover:bg-emerald-500/10"
                          : p.isStash
                          ? "bg-amber-500/5 hover:bg-amber-500/10"
                          : "hover:bg-neutral-800"
                      }`}
                    >
                      <td className="py-2 px-3 whitespace-nowrap text-left pl-4 font-semibold">
                        {playerNameOf(p)}
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
                      <td className="py-2 px-3">{p.pos || "-"}</td>
                      <td className="py-2 px-3">{p.age ?? "-"}</td>
                      <td className="py-2 px-3 font-black text-white">{formatMoney(getPlayerSalary(p, leagueData))}</td>
                      <td className="py-2 px-3">{p.overall ?? "-"}</td>
                      <td className="py-2 px-3">{p.offRating ?? "-"}</td>
                      <td className="py-2 px-3">{p.defRating ?? "-"}</td>
                      <td className="py-2 px-3">{p.stamina ?? "-"}</td>
                      <td className="py-2 px-3">{p.potential ?? "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PageFade>
  );
}
