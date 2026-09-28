import React, { useMemo, useState } from "react";
import PageFade from "../components/PageFade.jsx";
import { useGame } from "../context/GameContext.jsx";
import { getLeagueFinancialRules } from "../utils/leagueFinancials.js";
import { getContractSeasonYear } from "../utils/seasonContext.js";
import "../styles/BMPageBackground.css";

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams.filter(Boolean);
  return Object.values(leagueData.conferences || {}).flatMap((teams) => (teams || []).filter(Boolean));
}

function logoOf(team) {
  return team?.logo || team?.teamLogo || team?.newTeamLogo || team?.logoUrl || team?.image || team?.img || "";
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function moneyShort(value) {
  const n = safeNumber(value, 0);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
}

function getSalaryForSeason(player, seasonYear) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract.salaryByYear)
    ? contract.salaryByYear.map((value) => safeNumber(value, 0))
    : [];

  if (salaries.length) {
    const startYear = safeNumber(contract.startYear || seasonYear, seasonYear);
    const idx = seasonYear - startYear;
    if (idx >= 0 && idx < salaries.length) return salaries[idx] || 0;
    return 0;
  }

  return safeNumber(
    player?.salary ??
      player?.currentSalary ??
      player?.contractSalary ??
      player?.capHit ??
      player?.aav ??
      0,
    0
  );
}

function storedPayroll(team) {
  return safeNumber(
    team?.payroll ??
      team?.totalSalary ??
      team?.salaryTotal ??
      team?.financials?.payroll ??
      team?.financials?.totalSalary ??
      0,
    0
  );
}

function rosterPayroll(team, seasonYear) {
  return (team?.players || []).reduce((sum, player) => sum + getSalaryForSeason(player, seasonYear), 0);
}

function apronTier(payroll, rules) {
  if (payroll >= safeNumber(rules.secondApron, 0)) return "Second Apron";
  if (payroll >= safeNumber(rules.firstApron, 0)) return "First Apron";
  if (payroll >= safeNumber(rules.luxuryTaxLine, 0)) return "Tax";
  if (payroll >= safeNumber(rules.salaryCap, 0)) return "Over Cap";
  return "Cap Room";
}

const APRON_TIER_ORDER = {
  "Cap Room": 0,
  "Over Cap": 1,
  Tax: 2,
  "First Apron": 3,
  "Second Apron": 4,
};

function SortHeader({ label, sortKey, sortConfig, onSort, align = "center", className = "" }) {
  const active = sortConfig.key === sortKey && sortConfig.direction !== "default";
  const marker = active ? (sortConfig.direction === "asc" ? " ▲" : " ▼") : "";
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`cursor-pointer select-none px-1.5 py-2 ${align === "left" ? "text-left" : "text-center"} ${className}`}
      title={`Sort by ${label}`}
    >
      {label}{marker}
    </th>
  );
}

export default function LeagueFinances() {
  const { leagueData, selectedTeam } = useGame();
  const [sortConfig, setSortConfig] = useState({ key: "payroll", direction: "desc" });

  const rules = useMemo(() => getLeagueFinancialRules(leagueData || {}), [leagueData]);
  const contractSeasonYear = useMemo(() => getContractSeasonYear(leagueData || {}), [leagueData]);

  const rows = useMemo(() => {
    const teams = getAllTeamsFromLeague(leagueData);
    return teams.map((team) => {
      const computed = rosterPayroll(team, contractSeasonYear);
      const stored = storedPayroll(team);
      const payroll = computed > 0 ? computed : stored;
      const capSpace = safeNumber(rules.salaryCap, 0) - payroll;
      const taxRoom = safeNumber(rules.luxuryTaxLine, 0) - payroll;
      const firstApronRoom = safeNumber(rules.firstApron, 0) - payroll;
      const secondApronRoom = safeNumber(rules.secondApron, 0) - payroll;
      const tier = apronTier(payroll, rules);

      return {
        team: team?.name || team?.team || "Unknown Team",
        logo: logoOf(team),
        payroll,
        capSpace,
        taxRoom,
        firstApronRoom,
        secondApronRoom,
        tier,
        tierOrder: APRON_TIER_ORDER[tier] ?? 0,
      };
    });
  }, [leagueData, contractSeasonYear, rules]);

  const visibleRows = useMemo(() => {
    if (!sortConfig.key || sortConfig.direction === "default") {
      return rows;
    }

    const sorted = [...rows];
    const direction = sortConfig.direction === "asc" ? 1 : -1;
    sorted.sort((a, b) => {
      let diff = 0;
      if (sortConfig.key === "team") diff = a.team.localeCompare(b.team);
      else if (sortConfig.key === "tier") diff = a.tierOrder - b.tierOrder || a.payroll - b.payroll;
      else diff = safeNumber(a[sortConfig.key], 0) - safeNumber(b[sortConfig.key], 0);
      if (!diff) diff = a.team.localeCompare(b.team);
      return diff * direction;
    });
    return sorted;
  }, [rows, sortConfig]);

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key !== key) return { key, direction: key === "team" ? "asc" : "desc" };
      if (prev.direction === "desc") return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "default" };
      return { key, direction: key === "team" ? "asc" : "desc" };
    });
  };

  if (!leagueData) {
    return <div className="bmCourtPage grid h-full place-items-center text-white">Loading league finances...</div>;
  }

  return (
    <PageFade>
      <div className="bmCourtPage h-full min-h-0 overflow-hidden px-4 py-3 text-white">
        <div className="mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col">
          <div className="mb-3 flex shrink-0 items-end justify-between gap-4">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/45">Scouting</div>
              <h1 className="text-3xl font-black leading-none text-orange-500">League Finances</h1>
            </div>
            <div className="shrink-0 rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-right text-[11px] font-bold text-white/60">
              <div>Cap {moneyShort(rules.salaryCap)}</div>
              <div>Tax {moneyShort(rules.luxuryTaxLine)}</div>
              <div>Aprons {moneyShort(rules.firstApron)} / {moneyShort(rules.secondApron)}</div>
            </div>
          </div>

          <div className="bmTableScroller min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl border border-neutral-800 bg-neutral-900/80">
            <table className="w-full table-fixed text-center text-[12px]">
              <thead className="sticky top-0 z-10 bg-neutral-800 text-gray-300">
                <tr>
                  <th className="w-[52px] px-1.5 py-2">Rank</th>
                  <SortHeader label="Team" sortKey="team" sortConfig={sortConfig} onSort={handleSort} align="left" className="w-[250px]" />
                  <SortHeader label="Payroll" sortKey="payroll" sortConfig={sortConfig} onSort={handleSort} className="w-[108px]" />
                  <SortHeader label="Cap" sortKey="capSpace" sortConfig={sortConfig} onSort={handleSort} className="w-[96px]" />
                  <SortHeader label="Tax" sortKey="taxRoom" sortConfig={sortConfig} onSort={handleSort} className="w-[96px]" />
                  <SortHeader label="1st Apron" sortKey="firstApronRoom" sortConfig={sortConfig} onSort={handleSort} className="w-[112px]" />
                  <SortHeader label="2nd Apron" sortKey="secondApronRoom" sortConfig={sortConfig} onSort={handleSort} className="w-[112px]" />
                  <SortHeader label="Tier" sortKey="tier" sortConfig={sortConfig} onSort={handleSort} className="w-[112px]" />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr
                    key={row.team}
                    className={`border-t border-white/[0.035] hover:bg-neutral-800/60 ${selectedTeam?.name === row.team ? "bg-orange-600/70" : ""}`}
                  >
                    <td className="px-1.5 py-2 font-black text-orange-200">{index + 1}</td>
                    <td className="px-1.5 py-2 text-left font-semibold">
                      <div className="flex items-center gap-2">
                        {row.logo && <img src={row.logo} alt="" className="h-5 w-5 shrink-0 object-contain" />}
                        <span className="truncate">{row.team}</span>
                      </div>
                    </td>
                    <td className="px-1.5 py-2 font-bold text-orange-300">{moneyShort(row.payroll)}</td>
                    <td className="px-1.5 py-2">{moneyShort(row.capSpace)}</td>
                    <td className="px-1.5 py-2">{moneyShort(row.taxRoom)}</td>
                    <td className="px-1.5 py-2">{moneyShort(row.firstApronRoom)}</td>
                    <td className="px-1.5 py-2">{moneyShort(row.secondApronRoom)}</td>
                    <td className="px-1.5 py-2 font-bold">{row.tier}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PageFade>
  );
}
