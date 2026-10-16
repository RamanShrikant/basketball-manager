import React from "react";
import { createPortal } from "react-dom";
import { boxScoreMinutesToNumber, sortBoxRowsForDisplay } from "../utils/boxScoreDisplay.js";

function formatOTLabel(otCount) {
  const n = Number(otCount || 0);
  if (!n) return "";
  return n === 1 ? " (OT)" : ` (${n}OT)`;
}

function TeamLogo({ src, name }) {
  if (!src) {
    return (
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/25 text-[9px] font-black text-white/55">
        {String(name || "?").slice(0, 2).toUpperCase()}
      </div>
    );
  }

  return <img src={src} alt="" className="h-7 w-7 shrink-0 object-contain" />;
}

function LineScore({ game, result }) {
  const periods = result?.periods;
  if (!periods) return null;

  const awayQ = Array.isArray(periods.away) ? periods.away : [];
  const homeQ = Array.isArray(periods.home) ? periods.home : [];
  const awayOts = Array.isArray(periods.ots?.away) ? periods.ots.away : [];
  const homeOts = Array.isArray(periods.ots?.home) ? periods.ots.home : [];
  const otCount = Number(periods.otCount || Math.max(awayOts.length, homeOts.length, 0));
  const hasIndividualOts = awayOts.length > 0 || homeOts.length > 0;
  const displayOtCount = Math.min(hasIndividualOts ? otCount : otCount > 0 ? 1 : 0, 6);
  const legacyOtAway = Number(periods.otBreakdown?.away || 0);
  const legacyOtHome = Number(periods.otBreakdown?.home || 0);

  const qVal = (arr, idx) =>
    arr[idx] != null && Number.isFinite(Number(arr[idx])) ? Number(arr[idx]) : "--";
  const otVal = (arr, idx, legacyValue) => {
    if (hasIndividualOts) return qVal(arr, idx);
    return idx === 0 && legacyValue ? legacyValue : "--";
  };
  const otHeader = (idx) => (idx === 0 ? "OT" : `${idx + 1}OT`);

  return (
    <div className="mb-2 shrink-0 rounded-lg bg-neutral-800 px-3 py-2">
      <table className="w-full table-fixed text-center text-[11px]">
        <thead className="text-gray-300">
          <tr className="border-b border-neutral-700">
            <th className="w-[24%] py-1 text-left">Team</th>
            <th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th>
            {Array.from({ length: displayOtCount }, (_, idx) => (
              <th key={`ot-head-${idx}`}>{otHeader(idx)}</th>
            ))}
            <th>Final</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["away", game?.away, awayQ, awayOts, legacyOtAway, result?.totals?.away],
            ["home", game?.home, homeQ, homeOts, legacyOtHome, result?.totals?.home],
          ].map(([side, name, quarters, ots, legacyOt, total]) => (
            <tr key={side} className="border-b border-neutral-800 last:border-0">
              <td className="truncate py-1 text-left font-bold" title={name}>{name}</td>
              <td>{qVal(quarters, 0)}</td><td>{qVal(quarters, 1)}</td>
              <td>{qVal(quarters, 2)}</td><td>{qVal(quarters, 3)}</td>
              {Array.from({ length: displayOtCount }, (_, idx) => (
                <td key={`${side}-ot-${idx}`}>{otVal(ots, idx, legacyOt)}</td>
              ))}
              <td className="font-black">{total ?? "--"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamBox({ side, game, result, teamLogos, fallbackOrders }) {
  const name = side === "away" ? game?.away : game?.home;
  const rows = sortBoxRowsForDisplay(
    result?.box?.[side] || [],
    result?.rotationOrder?.[side] || [],
    fallbackOrders?.[side] || []
  );

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg bg-neutral-800 p-2">
      <div className="mb-1 flex shrink-0 items-center gap-2">
        <TeamLogo src={teamLogos?.[name]} name={name} />
        <h4 className="min-w-0 truncate text-sm font-black" title={name}>{name}</h4>
      </div>

      <div className="min-h-0 overflow-auto">
        <table className="w-full table-fixed text-[10px] leading-tight">
          <colgroup>
            <col style={{ width: "27%" }} />
            {Array.from({ length: 11 }, (_, idx) => <col key={idx} />)}
          </colgroup>
          <thead className="sticky top-0 bg-neutral-800">
            <tr className="border-b border-neutral-700 text-white/70">
              <th className="px-1 py-1 text-left">Player</th>
              {['MIN','PTS','REB','AST','STL','BLK','FG','3P','FT','TO','PF'].map((label) => (
                <th key={label} className="px-0.5 text-center">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((player, index) => {
              const dnp = boxScoreMinutesToNumber(player?.min ?? player?.minutes) <= 0;
              const stat = (value) => (dnp ? "--" : value ?? 0);
              return (
                <tr key={`${player?.player || "player"}-${index}`} className="border-b border-neutral-700/35 last:border-0">
                  <td className="truncate px-1 py-[2px] font-semibold" title={player?.player}>{player?.player}</td>
                  <td className="px-0.5 text-center font-bold">{dnp ? "DNP" : player?.min}</td>
                  <td className="px-0.5 text-center">{stat(player?.pts)}</td>
                  <td className="px-0.5 text-center">{stat(player?.reb)}</td>
                  <td className="px-0.5 text-center">{stat(player?.ast)}</td>
                  <td className="px-0.5 text-center">{stat(player?.stl)}</td>
                  <td className="px-0.5 text-center">{stat(player?.blk)}</td>
                  <td className="whitespace-nowrap px-0.5 text-center">{stat(player?.fg)}</td>
                  <td className="whitespace-nowrap px-0.5 text-center">{stat(player?.["3p"])}</td>
                  <td className="whitespace-nowrap px-0.5 text-center">{stat(player?.ft)}</td>
                  <td className="px-0.5 text-center">{stat(player?.to)}</td>
                  <td className="px-0.5 text-center">{stat(player?.pf)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function GameBoxScoreModal({ game, result, onClose, teamLogos = {}, fallbackOrders = {} }) {
  if (!game || !result || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed bottom-0 right-0 top-0 z-[210] flex items-center justify-center bg-black/78 p-3"
      style={{ left: "var(--bm-persistent-sidebar-width, 0px)" }}
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-[1580px] flex-col overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-white shadow-2xl"
        style={{ maxHeight: "calc(100dvh - 24px)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex shrink-0 items-center justify-between gap-4">
          <h3 className="min-w-0 truncate text-lg font-black">
            {game.away} @ {game.home} &bull; {result?.winner?.score}
            {formatOTLabel(result?.winner?.ot ?? result?.periods?.otCount)}
          </h3>
          <button
            type="button"
            className="shrink-0 rounded bg-neutral-700 px-3 py-1.5 text-sm font-bold hover:bg-neutral-600"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <LineScore game={game} result={result} />

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
          <TeamBox side="away" game={game} result={result} teamLogos={teamLogos} fallbackOrders={fallbackOrders} />
          <TeamBox side="home" game={game} result={result} teamLogos={teamLogos} fallbackOrders={fallbackOrders} />
        </div>
      </div>
    </div>,
    document.body
  );
}
