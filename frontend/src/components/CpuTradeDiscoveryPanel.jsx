import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  describeCpuTradeAsset,
  getCpuTradeScannerTeams,
  scanCpuTradeMarket,
} from "../utils/cpuTradeDiscovery.js";

function teamLogoOf(team) {
  return team?.logo || team?.teamLogo || team?.newTeamLogo || team?.logoUrl || team?.image || team?.img || "";
}

function normalizeTeamName(name = "") {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function findTeam(leagueData, teamName = "") {
  const key = normalizeTeamName(teamName);
  return getAllTeamsFromLeague(leagueData).find((team) => normalizeTeamName(team?.name || team?.teamName || "") === key) || null;
}

function formatMs(ms = 0) {
  const value = Number(ms || 0);
  if (value < 1000) return `${Math.max(0, Math.round(value))}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function formatScore(value) {
  const num = Number(value || 0);
  return `${num >= 0 ? "+" : ""}${num.toFixed(3)}`;
}

function AssetPill({ item }) {
  const asset = describeCpuTradeAsset(item);
  const isPlayer = asset.type === "player";
  return (
    <div className="rounded-2xl border border-white/10 bg-black/35 px-3 py-2">
      <div className="flex items-start gap-2">
        <div className={`mt-0.5 rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] ${
          isPlayer
            ? "border-orange-400/30 bg-orange-500/10 text-orange-100"
            : "border-sky-300/25 bg-sky-400/10 text-sky-100"
        }`}>
          {isPlayer ? "Player" : "Pick"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-black text-white">{asset.label}</div>
          {asset.meta && <div className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-500">{asset.meta}</div>}
        </div>
      </div>
    </div>
  );
}

function TeamReceiveBox({ title, team, items }) {
  const logo = teamLogoOf(team);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
      <div className="mb-3 flex items-center gap-2">
        {logo ? <img src={logo} alt="" className="h-7 w-7 object-contain" /> : <div className="h-7 w-7 rounded-lg bg-white/5" />}
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-white">{title}</div>
          <div className="text-[9px] font-black uppercase tracking-[0.14em] text-orange-200">Receives</div>
        </div>
      </div>
      <div className="grid gap-2">
        {items.map((item, index) => (
          <AssetPill key={`${title}_${index}_${item?.displayLabel || item?.player?.id || item?.player?.name}`} item={item} />
        ))}
      </div>
    </div>
  );
}

function DecisionBox({ teamName, view }) {
  const reasons = Array.isArray(view?.reasons) ? view.reasons.slice(0, 5) : [];
  return (
    <details className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3">
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-200">{teamName} Decision</div>
            <div className="mt-0.5 text-sm font-black text-white">ACCEPT</div>
          </div>
          <div className="rounded-full border border-emerald-300/25 bg-black/35 px-3 py-1 text-xs font-black text-emerald-100">
            {formatScore(view?.score)}
          </div>
        </div>
      </summary>
      {reasons.length > 0 && (
        <div className="mt-3 grid gap-1.5 border-t border-white/10 pt-3">
          {reasons.map((reason, index) => (
            <div key={`${teamName}_reason_${index}`} className="text-xs font-semibold leading-relaxed text-emerald-50/85">
              • {reason}
            </div>
          ))}
        </div>
      )}
    </details>
  );
}

function TradeCard({ trade, leagueData }) {
  const [expanded, setExpanded] = useState(false);
  const teamA = findTeam(leagueData, trade.teamAName);
  const teamB = findTeam(leagueData, trade.teamBName);
  const hasDraftSolver = trade.source === "draft_solver" || trade.source === "proposal_draft";

  return (
    <div className="rounded-[22px] border border-white/10 bg-neutral-950/75 p-4 shadow-lg">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-start justify-between gap-4 text-left"
      >
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-orange-200">
            Mutual CPU Accept • {hasDraftSolver ? "Draft asset solved" : "Player only"}
          </div>
          <div className="mt-1 text-sm font-black leading-relaxed text-white">
            {trade.teamAName} ↔ {trade.teamBName}
          </div>
          <div className="mt-1 text-xs font-semibold text-neutral-500">
            Combined score {formatScore(trade.combinedScore)} • {trade.teamAItems.length} assets from {trade.teamAName} • {trade.teamBItems.length} assets from {trade.teamBName}
          </div>
        </div>
        <div className="shrink-0 rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-neutral-300">
          {expanded ? "Collapse" : "Expand"}
        </div>
      </button>

      {expanded && (
        <div className="mt-4 grid gap-3">
          <div className="grid gap-3 lg:grid-cols-2">
            <TeamReceiveBox title={trade.teamAName} team={teamA} items={trade.teamAReceives} />
            <TeamReceiveBox title={trade.teamBName} team={teamB} items={trade.teamBReceives} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <DecisionBox teamName={trade.teamAName} view={trade.teamAView} />
            <DecisionBox teamName={trade.teamBName} view={trade.teamBView} />
          </div>
          {trade.draftPackage?.label && (
            <div className="rounded-2xl border border-sky-300/15 bg-sky-400/10 p-3 text-xs font-semibold leading-relaxed text-sky-50/90">
              Draft solver added: {trade.draftPackage.label} • estimated recipient draft value {formatScore(trade.draftPackage.value)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OpponentGroup({ row, leagueData }) {
  const [open, setOpen] = useState(false);
  const count = row?.trades?.length || 0;
  const stats = row?.stats || {};
  return (
    <div className="overflow-hidden rounded-[22px] border border-white/10 bg-black/30">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition hover:bg-orange-500/10"
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-white">vs {row.opponentTeamName}</div>
          <div className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-neutral-500">
            {stats.proposalCandidates || 0} proposals built • {stats.exactEvaluations || 0} exact checks • {formatMs(stats.elapsedMs)}{stats.capped ? " • capped" : ""}
          </div>
        </div>
        <div className={`rounded-full border px-3 py-1 text-xs font-black ${
          count
            ? "border-emerald-300/30 bg-emerald-500/15 text-emerald-100"
            : "border-white/10 bg-white/5 text-neutral-500"
        }`}>
          {count} mutual accept{count === 1 ? "" : "s"}
        </div>
      </button>
      {open && (
        <div className="grid gap-3 border-t border-white/10 p-4">
          {count ? (
            row.trades.map((trade) => <TradeCard key={trade.id} trade={trade} leagueData={leagueData} />)
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm font-semibold text-neutral-400">
              No mutual CPU accepts found for this matchup under the current scan depth and exact Trade Builder CPU acceptance logic.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CpuTradeDiscoveryPanel({ leagueData, selectedTeam }) {
  const userTeamName = selectedTeam?.name || selectedTeam?.teamName || "";
  const cpuTeams = useMemo(() => getCpuTradeScannerTeams(leagueData, userTeamName), [leagueData, userTeamName]);
  const [focusTeamName, setFocusTeamName] = useState("");
  const [opponentTeamName, setOpponentTeamName] = useState("all");
  const [depth, setDepth] = useState("instant");
  const [includeProtections, setIncludeProtections] = useState(true);
  const [includeSwaps, setIncludeSwaps] = useState(true);
  const [includeSeconds, setIncludeSeconds] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState(null);
  const scanTokenRef = useRef(0);

  useEffect(() => {
    if (!focusTeamName && cpuTeams.length) setFocusTeamName(cpuTeams[0].name);
  }, [cpuTeams, focusTeamName]);

  const focusOpponents = useMemo(() => {
    return cpuTeams.filter((team) => {
      if (!focusTeamName || normalizeTeamName(team.name) === normalizeTeamName(focusTeamName)) return false;
      if (opponentTeamName !== "all" && normalizeTeamName(team.name) !== normalizeTeamName(opponentTeamName)) return false;
      return true;
    });
  }, [cpuTeams, focusTeamName, opponentTeamName]);

  const totals = useMemo(() => {
    return results.reduce((acc, row) => {
      acc.trades += row.trades?.length || 0;
      acc.frameworks += row.stats?.proposalCandidates || row.stats?.playerFrameworksTested || 0;
      acc.exact += row.stats?.exactEvaluations || 0;
      acc.elapsed += row.stats?.elapsedMs || 0;
      if (row.stats?.capped) acc.capped += 1;
      return acc;
    }, { trades: 0, frameworks: 0, exact: 0, elapsed: 0, capped: 0 });
  }, [results]);

  const runScan = async () => {
    if (isScanning) {
      scanTokenRef.current += 1;
      setProgress("Canceling scan after the current matchup...");
      setIsScanning(false);
      return;
    }
    if (!leagueData || !focusTeamName || !focusOpponents.length) return;

    const token = scanTokenRef.current + 1;
    scanTokenRef.current = token;
    setIsScanning(true);
    setResults([]);
    setSummary(null);

    const startedAt = Date.now();
    try {
      const response = await scanCpuTradeMarket({
        leagueData,
        focusTeamName,
        opponentTeamName,
        userTeamName,
        options: {
          depth,
          includeProtections,
          includeSwaps,
          includeSeconds,
        },
        tokenRef: scanTokenRef,
        token,
        onProgress: (message) => {
          if (scanTokenRef.current === token) setProgress(message);
        },
      });

      if (scanTokenRef.current === token) {
        setResults(response.rows || []);
        setSummary({
          focusTeamName,
          opponents: response.stats?.opponentsQueued || focusOpponents.length,
          elapsedMs: response.stats?.elapsedMs || Date.now() - startedAt,
          capped: Boolean(response.stats?.capped),
          timeCapped: Boolean(response.stats?.timeCapped),
          proposalCandidates: response.stats?.proposalCandidates || 0,
          exactEvaluations: response.stats?.exactEvaluations || 0,
        });
        setProgress(response.stats?.timeCapped ? "Scan complete — time budget reached." : "Scan complete.");
      } else {
        setSummary({
          focusTeamName,
          opponents: 0,
          elapsedMs: Date.now() - startedAt,
          canceled: true,
        });
        setProgress("Scan canceled.");
      }
    } catch (error) {
      console.error("CPU trade market scan failed", error);
      if (scanTokenRef.current === token) {
        setProgress(`Scan failed: ${error?.message || error}`);
        setSummary({ focusTeamName, opponents: 0, elapsedMs: Date.now() - startedAt, error: true });
      }
    }
    setIsScanning(false);
  };

  if (!cpuTeams.length) {
    return (
      <div className="rounded-[28px] border border-white/10 bg-neutral-950/85 p-6 text-sm font-semibold text-neutral-400">
        CPU trade scanner needs league teams to load and cannot include the user-controlled team.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950/90 shadow-2xl">
      <div className="border-b border-white/10 bg-gradient-to-r from-sky-600/20 via-neutral-900 to-black px-6 py-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-sm font-black uppercase tracking-[0.2em] text-sky-200">Dev Scanner</div>
            <div className="mt-1 text-2xl font-black text-white">All Possible CPU Trades</div>
            <div className="mt-1 max-w-3xl text-sm font-semibold leading-relaxed text-neutral-400">
              Dry-run CPU-to-CPU trades. It uses a streaming proposal engine: for each opponent it builds a small set of realistic opportunities, immediately exact-checks the best few, and shows only mutual accepts under the same Trade Builder evaluator.
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-right">
            <div className="text-xl font-black text-white">{totals.trades}</div>
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-neutral-500">Mutual accepts</div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-6">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_0.75fr]">
          <label className="grid gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-neutral-500">Focus CPU Team</span>
            <select
              value={focusTeamName}
              onChange={(event) => {
                setFocusTeamName(event.target.value);
                setResults([]);
                setSummary(null);
              }}
              className="rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-orange-400/50"
            >
              {cpuTeams.map((team) => (
                <option key={team.name} value={team.name}>{team.name}</option>
              ))}
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-neutral-500">Opponent</span>
            <select
              value={opponentTeamName}
              onChange={(event) => {
                setOpponentTeamName(event.target.value);
                setResults([]);
                setSummary(null);
              }}
              className="rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-orange-400/50"
            >
              <option value="all">All CPU Teams</option>
              {cpuTeams
                .filter((team) => normalizeTeamName(team.name) !== normalizeTeamName(focusTeamName))
                .map((team) => <option key={team.name} value={team.name}>{team.name}</option>)}
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-neutral-500">Scan Depth</span>
            <select
              value={depth}
              onChange={(event) => {
                setDepth(event.target.value);
                setResults([]);
                setSummary(null);
              }}
              className="rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-orange-400/50"
            >
              <option value="instant">Instant — opportunity scan</option>
              <option value="quick">Quick — wider opportunity scan</option>
              <option value="normal">Normal — widest opportunity scan</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            ["includeProtections", includeProtections, setIncludeProtections, "Protections"],
            ["includeSwaps", includeSwaps, setIncludeSwaps, "Swaps"],
            ["includeSeconds", includeSeconds, setIncludeSeconds, "2nds"],
          ].map(([key, checked, setter, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setter((prev) => !prev);
                setResults([]);
                setSummary(null);
              }}
              className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.12em] transition ${
                checked
                  ? "border-sky-300/35 bg-sky-400/15 text-sky-100"
                  : "border-white/10 bg-black/35 text-neutral-500 hover:border-white/20"
              }`}
            >
              {checked ? "✓ " : ""}{label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="text-xs font-semibold text-neutral-500">
            {focusOpponents.length} opponent{focusOpponents.length === 1 ? "" : "s"} queued. This is an opportunity scan, not a brute-force combo search; all modes use strict time/exact-check budgets so the page stays responsive.
          </div>
          <button
            type="button"
            onClick={runScan}
            disabled={!focusOpponents.length}
            className={`rounded-2xl px-6 py-3 text-sm font-black text-white shadow-[0_15px_40px_rgba(2,132,199,0.22)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${
              isScanning ? "bg-red-700 hover:bg-red-600" : "bg-sky-600 hover:bg-sky-500"
            }`}
          >
            {isScanning ? "Cancel Scan" : "Run CPU Trade Scan"}
          </button>
        </div>

        {(progress || summary) && (
          <div className="rounded-2xl border border-white/10 bg-black/35 p-4">
            <div className="text-sm font-black text-white">{progress || "Ready."}</div>
            <div className="mt-2 grid gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-neutral-500 md:grid-cols-5">
              <div>Proposals: {summary?.proposalCandidates ?? totals.frameworks}</div>
              <div>Mutual accepts: {totals.trades}</div>
              <div>Exact checks: {summary?.exactEvaluations ?? totals.exact}</div>
              <div>Elapsed work: {formatMs(totals.elapsed)}</div>
              <div>Capped groups: {totals.capped}</div>
            </div>
            {summary && (
              <div className="mt-2 text-xs font-semibold text-neutral-500">
                {summary.canceled ? "Canceled after" : summary.timeCapped ? "Stopped at time budget:" : "Full scan wall time:"} {formatMs(summary.elapsedMs)} across {summary.opponents} opponent{summary.opponents === 1 ? "" : "s"}.
              </div>
            )}
          </div>
        )}

        <div className="grid gap-3">
          {results.length ? (
            results.map((row) => <OpponentGroup key={row.opponentTeamName} row={row} leagueData={leagueData} />)
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm font-semibold leading-relaxed text-neutral-400">
              Pick a CPU team and run the opportunity scan. Results are grouped by opponent and only exact mutual accepts are shown; rejected or unverified proposals are discarded.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
