import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import PageFade from "../components/PageFade";
import styles from "./RosterView.module.css";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";

const TRADE_BUILDER_KEY = "bm_trade_builder_v1";
const MAX_SIDE_ITEMS = 8;

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

function getTradePayrollSeasonYear(leagueData) {
  const rawYear = Number(getCurrentSeasonYear(leagueData));
  return Number.isFinite(rawYear) ? rawYear + 1 : 2026;
}

function getPlayerSalary(player, leagueData) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract.salaryByYear)
    ? contract.salaryByYear.map((value) => Number(value) || 0)
    : [];
  const payrollSeasonYear = getTradePayrollSeasonYear(leagueData);

  if (salaries.length) {
    let startYear = Number(contract.startYear || payrollSeasonYear);
    let idx = payrollSeasonYear - startYear;
    const lastYear = startYear + salaries.length - 1;
    const hasPayrollSeasonSlot = idx >= 0 && idx < salaries.length;

    if (salaries.length === 1 && startYear === payrollSeasonYear - 1 && !hasPayrollSeasonSlot) {
      startYear = payrollSeasonYear;
      idx = 0;
    }

    if (idx >= 0 && idx < salaries.length) return Number(salaries[idx] || 0);
    if (payrollSeasonYear > lastYear) return Number(salaries[salaries.length - 1] || 0);
    return Number(salaries[0] || 0);
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

function isPlayerItemForPlayer(item, player) {
  if (!item || item.type !== "player" || !player) return false;
  return playerKey(item.player) === playerKey(player);
}

function getAlreadyAddedPlayerKeys(items = []) {
  const keys = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.type === "player" && item.player) keys.add(playerKey(item.player));
  }
  return keys;
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
  const builderSnapshot = useMemo(() => readBuilder(), []);
  const currentSideItems = useMemo(
    () => getSideItems(builderSnapshot, tradeSide),
    [builderSnapshot, tradeSide]
  );
  const alreadyAddedPlayerKeys = useMemo(
    () => getAlreadyAddedPlayerKeys(currentSideItems),
    [currentSideItems]
  );
  const sideItemCount = currentSideItems.length;
  const sideIsFull = sideItemCount >= MAX_SIDE_ITEMS;

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
    if (!sortedPlayers.length) {
      if (selectedKey) setSelectedKey("");
      return;
    }

    const selectedStillExists = selectedKey && sortedPlayers.some((p) => playerKey(p) === selectedKey);
    const selectedIsAvailable = selectedStillExists && !alreadyAddedPlayerKeys.has(selectedKey);
    if (selectedIsAvailable) return;

    const firstAvailable = sortedPlayers.find((p) => !alreadyAddedPlayerKeys.has(playerKey(p)));
    setSelectedKey(playerKey(firstAvailable || sortedPlayers[0]));
  }, [alreadyAddedPlayerKeys, sortedPlayers, selectedKey]);

  const selectedPlayer =
    sortedPlayers.find((p) => playerKey(p) === selectedKey) || sortedPlayers[0] || null;
  const selectedPlayerAlreadyAdded = Boolean(selectedPlayer && alreadyAddedPlayerKeys.has(playerKey(selectedPlayer)));
  const canAddSelectedPlayer = Boolean(selectedPlayer && team && !selectedPlayerAlreadyAdded && !sideIsFull);

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

  const addPlayerToBuilder = (player) => {
    if (!player || !team || sideIsFull || alreadyAddedPlayerKeys.has(playerKey(player))) return;

    const builder = readBuilder();
    const currentItems = getSideItems(builder, tradeSide);

    if (currentItems.some((item) => isPlayerItemForPlayer(item, player))) return;
    if (currentItems.length >= MAX_SIDE_ITEMS) return;

    const nextItem = {
      type: "player",
      teamName: team.name,
      player,
    };

    const nextItems = [...currentItems, nextItem];

    saveBuilder(setSideItems(builder, tradeSide, nextItems));
    navigate(returnTo);
  };

  const addSelected = () => {
    if (!selectedPlayer || !canAddSelectedPlayer) return;
    addPlayerToBuilder(selectedPlayer);
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
              disabled={!canAddSelectedPlayer}
              className="rounded-xl bg-orange-600 px-5 py-2 text-sm font-black text-white transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {selectedPlayerAlreadyAdded ? "Already Added" : sideIsFull ? "Limit Reached" : "Add Player"}
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
                    {selectedPlayerAlreadyAdded && (
                      <div className="mt-3 inline-flex w-fit items-center rounded-full border border-orange-400/40 bg-orange-500/15 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-orange-200">
                        Already in package
                      </div>
                    )}
                    {!selectedPlayerAlreadyAdded && sideIsFull && (
                      <div className="mt-3 inline-flex w-fit items-center rounded-full border border-red-400/40 bg-red-500/15 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-red-200">
                        Package limit reached
                      </div>
                    )}
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
                  const alreadyAdded = alreadyAddedPlayerKeys.has(key);
                  const unavailable = alreadyAdded || (!active && sideIsFull);

                  return (
                    <tr
                      key={key}
                      onClick={() => {
                        if (!alreadyAdded) setSelectedKey(key);
                      }}
                      onDoubleClick={() => {
                        if (!alreadyAdded && !sideIsFull) addPlayerToBuilder(p);
                      }}
                      aria-disabled={alreadyAdded}
                      title={alreadyAdded ? "Already in this trade package" : ""}
                      className={`transition ${
                        alreadyAdded
                          ? "cursor-not-allowed bg-neutral-950/80 text-neutral-500 opacity-70"
                          : active
                          ? "cursor-pointer bg-orange-600 text-white"
                          : p.isTwoWay
                          ? "cursor-pointer bg-emerald-500/5 hover:bg-emerald-500/10"
                          : p.isStash
                          ? "cursor-pointer bg-amber-500/5 hover:bg-amber-500/10"
                          : "cursor-pointer hover:bg-neutral-800"
                      }`}
                    >
                      <td className="py-2 px-3 whitespace-nowrap text-left pl-4 font-semibold">
                        {playerNameOf(p)}
                        {alreadyAdded && (
                          <span className="ml-3 inline-flex items-center rounded-full border border-orange-400/40 bg-orange-500/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-orange-200">
                            Already in package
                          </span>
                        )}
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
