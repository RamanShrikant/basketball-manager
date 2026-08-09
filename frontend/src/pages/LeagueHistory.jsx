import React, { useMemo, useState } from "react";
import { useGame } from "../context/GameContext.jsx";
import PageFade from "../components/PageFade.jsx";
import { formatLeagueDate, normalizeIsoDate } from "../utils/leagueClock.js";
import { getTradeRuleState } from "../utils/userTradeRules.js";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";

function assetName(asset = {}) {
  if (typeof asset === "string") return asset;
  return asset?.label || asset?.name || asset?.playerName || asset?.pickLabel || "Asset";
}

function summarizeAssets(items = []) {
  const rows = (Array.isArray(items) ? items : []).map(assetName).filter(Boolean);
  if (!rows.length) return "Assets";
  if (rows.length <= 2) return rows.join(" and ");
  return `${rows.slice(0, 2).join(", ")}, and ${rows.length - 2} more`;
}

function normalizeDateForSort(value = "") {
  const iso = normalizeIsoDate(value);
  if (iso) return iso;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : "0000-00-00";
}


function formatCompactMoney(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `$${Math.round(n / 1000)}K`;
}

function addIsoMonths(value, months) {
  const iso = normalizeIsoDate(value);
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCMonth(date.getUTCMonth() + Number(months || 0));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

function extensionHistoryRows(leagueData = {}) {
  const history = Array.isArray(leagueData?.contractExtensionHistory)
    ? leagueData.contractExtensionHistory
    : [];

  return history.map((row, index) => {
    const date = normalizeIsoDate(row?.date || row?.signedDate) || normalizeDateForSort(row?.recordedAt);
    const playerName = row?.playerName || row?.name || "Player";
    const teamName = row?.teamName || row?.toTeam || "Team";
    const years = Number(row?.years || row?.extensionYears || row?.salaryByYear?.length || 0);
    const totalValue = Number(
      row?.totalValue ||
      row?.totalNewMoney ||
      (Array.isArray(row?.salaryByYear) ? row.salaryByYear.reduce((sum, salary) => sum + Number(salary || 0), 0) : 0)
    );
    const eligibleDate = addIsoMonths(date, 6);
    const details = [
      years > 0 ? `${years} year${years === 1 ? "" : "s"}` : "",
      totalValue > 0 ? `${formatCompactMoney(totalValue)} new money` : "",
      row?.extensionStartYear ? `starts ${row.extensionStartYear}` : "",
    ].filter(Boolean).join(" • ");

    return {
      id: row?.id || `contract_extension_${index}_${teamName}_${playerName}`,
      date,
      type: "extension",
      label: String(row?.actor || "").toLowerCase() === "cpu" ? "CPU Extension" : "Extension",
      title: `${teamName} extended ${playerName}`,
      teams: teamName,
      details: details || `${playerName} signed a contract extension with ${teamName}.`,
      restriction: eligibleDate
        ? `Trade eligible ${formatLeagueDate(eligibleDate)}`
        : "Recently extended — 6-month user-trade restriction applies.",
    };
  });
}

function tradeRows(leagueData = {}) {
  const history = Array.isArray(leagueData?.tradeHistory) ? leagueData.tradeHistory : [];
  return history.map((row, index) => {
    const date = normalizeIsoDate(row?.currentDate || row?.date) || normalizeDateForSort(row?.completedAt);
    const fromTeam = row?.fromTeamName || row?.userTeamName || row?.teamPackages?.[0]?.teamName || "Team A";
    const toTeam = row?.toTeamName || row?.cpuTeamName || row?.teamPackages?.[1]?.teamName || "Team B";
    const movedPlayers = Array.isArray(row?.movedPlayers) ? row.movedPlayers : [];
    const movedPicks = Array.isArray(row?.movedPicks) ? row.movedPicks : [];
    const toReceived = movedPlayers.filter((move) => move?.toTeam === toTeam).map((move) => move.name);
    const fromReceived = movedPlayers.filter((move) => move?.toTeam === fromTeam).map((move) => move.name);
    const title = row?.title || `${toTeam} and ${fromTeam} completed a trade`;
    const details = [
      toReceived.length ? `${toTeam} received ${summarizeAssets(toReceived)}` : "",
      fromReceived.length ? `${fromTeam} received ${summarizeAssets(fromReceived)}` : "",
      movedPicks.length ? `${movedPicks.length} pick${movedPicks.length === 1 ? "" : "s"} moved` : "",
    ].filter(Boolean).join(" • ");

    return {
      id: row?.id || `trade_${index}`,
      date,
      type: "trade",
      label: row?.cpuCpuTrade ? "CPU Trade" : "User Trade",
      title,
      teams: [fromTeam, toTeam].filter(Boolean).join(" ↔ "),
      details: details || "Full trade package recorded in the trade history log.",
      restriction: movedPlayers.length ? "Acquired players are user-trade locked for 30 days." : "",
    };
  });
}

function ledgerRows(leagueData = {}) {
  const state = getTradeRuleState(leagueData);
  return (Array.isArray(state.transactions) ? state.transactions : [])
    .filter((row) => row?.type !== "trade" && row?.type !== "extension" && row?.type !== "contract_extension")
    .map((row, index) => ({
    id: row?.id || `ledger_${index}`,
    date: normalizeIsoDate(row?.date) || normalizeDateForSort(row?.recordedAt),
    type: row?.type || "transaction",
    label:
      row?.type === "signing"
        ? row?.actor === "cpu"
          ? row?.subtype === "inSeasonFreeAgency" ? "CPU In-Season Signing" : "CPU Signing"
          : row?.subtype === "inSeasonFreeAgency" ? "In-Season Signing" : "Free Agent Signing"
        : row?.type === "rookieSigning"
        ? "Rookie Signing"
        : row?.type === "extension"
        ? "Extension"
        : row?.type === "trade"
        ? "Acquisition Lock"
        : "Transaction",
    title: row?.title || row?.playerName || "Transaction",
    teams: row?.teamName || [row?.fromTeam, row?.toTeam].filter(Boolean).join(" → "),
    details: row?.playerName ? `${row.playerName}${row?.teamName ? ` • ${row.teamName}` : ""}` : "Recorded transaction",
    restriction: row?.restrictionLabel || (row?.eligibleDate ? `Trade eligible ${formatLeagueDate(row.eligibleDate)}` : ""),
  }));
}

function buildRows(leagueData = {}) {
  const rows = [...tradeRows(leagueData), ...ledgerRows(leagueData), ...extensionHistoryRows(leagueData)];
  const seen = new Set();
  return rows
    .filter((row) => {
      const key = `${row.type}|${row.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => normalizeDateForSort(b.date).localeCompare(normalizeDateForSort(a.date)) || String(b.id).localeCompare(String(a.id)));
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "trade", label: "Trades" },
  { key: "signing", label: "Signings" },
  { key: "rookieSigning", label: "Rookie Signings" },
  { key: "extension", label: "Extensions" },
];

export default function LeagueHistory() {
  const { leagueData } = useGame();
  const [filter, setFilter] = useState("all");
  const rows = useMemo(() => buildRows(leagueData || {}), [leagueData]);
  const filteredRows = useMemo(
    () => rows.filter((row) => filter === "all" || row.type === filter || (filter === "signing" && row.type === "signing")),
    [filter, rows]
  );

  return (
    <PageFade>
      <div className="h-screen max-h-screen overflow-hidden bmCourtPage px-5 pt-4 pb-[92px] text-white">
        <div className="mx-auto flex h-full max-w-[1600px] min-h-0 flex-col">
          <div className="mb-3 shrink-0 text-center">
            <h1 className="text-4xl font-black text-orange-500">Transaction History</h1>
          </div>

          <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2 rounded-3xl border border-white/10 bg-neutral-950/80 p-3">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={`rounded-2xl px-4 py-2 text-xs font-black uppercase tracking-[0.14em] transition ${
                  filter === item.key
                    ? "bg-orange-500 text-white"
                    : "border border-white/10 bg-black/30 text-neutral-400 hover:border-orange-400/30 hover:text-white"
                }`}
              >
                {item.label}
              </button>
            ))}
            <div className="ml-auto text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
              {filteredRows.length} item{filteredRows.length === 1 ? "" : "s"}
            </div>
          </div>

          <div className="mb-8 min-h-0 flex-1 overflow-y-auto rounded-[28px] border border-white/10 bg-neutral-950/85 pb-3 shadow-2xl">
            <div className="grid grid-cols-[140px_170px_1fr_300px] gap-4 border-b border-white/10 bg-white/[0.04] px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-neutral-400">
              <div>Date</div>
              <div>Type</div>
              <div>Transaction</div>
              <div>Restriction Impact</div>
            </div>
            {filteredRows.length ? (
              filteredRows.map((row) => (
                <div key={`${row.type}_${row.id}`} className="grid grid-cols-[140px_170px_1fr_300px] gap-4 border-b border-white/10 px-5 py-4 last:border-b-0">
                  <div className="text-sm font-black text-orange-200">{formatLeagueDate(row.date)}</div>
                  <div>
                    <div className="text-sm font-black text-white">{row.label}</div>
                    {row.teams ? <div className="mt-1 text-xs font-bold text-neutral-500">{row.teams}</div> : null}
                  </div>
                  <div>
                    <div className="text-base font-black text-white">{row.title}</div>
                    <div className="mt-1 text-sm font-semibold text-neutral-400">{row.details}</div>
                  </div>
                  <div className="text-sm font-bold text-neutral-300">{row.restriction || "No active user-trade restriction recorded."}</div>
                </div>
              ))
            ) : (
              <div className="p-10 text-center text-sm font-bold text-neutral-500">No transactions found for this filter yet.</div>
            )}
          </div>
        </div>
      </div>
    </PageFade>
  );
}
