/**
 * Trade Center search-dropdown display data only.
 * Do not change, infer, or write player contracts; preserve the salaryByYear
 * start-year indexing used by the existing trade and salary-table systems.
 */
import { getContractSeasonYear } from "./seasonContext.js";

function money(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

function validMoney(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function ageLabel(player) {
  const age = Number(player?.age);
  return Number.isFinite(age) && age > 0 ? `Age ${Math.round(age)}` : "Age —";
}

function finiteYear(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 2020 && n < 2150 ? Math.trunc(n) : null;
}

export function tradeSearchPlayerMeta(player = {}) {
  return `${String(player.pos || player.position || player.primaryPosition || "—").trim() || "—"} · ${ageLabel(player)}`;
}

export function tradeSearchContractDisplay(player = {}, leagueData = {}, isFreeAgent = false) {
  if (isFreeAgent) return { summary: "Free agent · unsigned", annual: "", average: "Unsigned", full: "Free agent: no current team contract recorded.", years: 0, total: null };

  const year = finiteYear(getContractSeasonYear(leagueData || {})) || 2026;
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract.salaryByYear) ? contract.salaryByYear : [];
  const startYear = finiteYear(contract.startYear) || year;

  if (salaries.length) {
    let offset = year - startYear;
    // One-year contracts saved with the previous offseason's start year are
    // treated as current, mirroring tradeContractValue's display adjustment.
    const singleYearRollover = salaries.length === 1 && offset === 1;
    const displayedStart = singleYearRollover ? year : startYear;
    if (singleYearRollover) offset = 0;
    offset = Math.max(0, Math.min(salaries.length, offset));
    const rows = salaries.slice(offset).map((salary, index) => ({
      year: displayedStart + offset + index,
      salary: validMoney(salary),
    }));
    if (rows.length) {
      const known = rows.every((row) => row.salary !== null);
      const total = known ? rows.reduce((sum, row) => sum + row.salary, 0) : null;
      const years = rows.length;
      const summary = `${years}Y left · ${total === null ? "total unavailable" : `${money(total)} left`}`;
      const annual = rows.map((row) => `${String(row.year).slice(-2)}/${String(row.year + 1).slice(-2)} ${money(row.salary)}`).join(" · ");
      const full = `${summary}\n${rows.map((row) => `${row.year}–${row.year + 1}: ${money(row.salary)}`).join("\n")}`;
      // Mean of remaining scheduled seasons, not the original contract's full AAV.
      // Never average incomplete or missing salary records.
      const average = known ? `Avg. ${money(total / years)}/yr` : "Average unavailable";
      return { summary, annual, average, full, years, total };
    }
  }

  // Older saves may contain an AAV but not the actual per-year breakdown.
  // Do not pretend that salary is a complete contract or repeat it across years.
  const knownYears = Number(player.yearsLeft ?? player.contractYears);
  const years = Number.isFinite(knownYears) && knownYears > 0 ? Math.round(knownYears) : 0;
  const currentSalary = validMoney(player.salary ?? player.currentSalary ?? player.contractSalary ?? player.capHit ?? player.aav);
  if (years || currentSalary !== null) {
    const summary = `${years ? `${years}Y left` : "Contract term unknown"}${currentSalary !== null ? ` · ${money(currentSalary)} current` : ""}`;
    return { summary, annual: "Annual breakdown not recorded", average: currentSalary !== null ? `Current ${money(currentSalary)}/yr` : "Salary unavailable", full: `${summary}\nYear-by-year salary schedule unavailable in saved player data.`, years, total: null };
  }
  return { summary: "Contract not recorded", annual: "", average: "Salary unavailable", full: "No contract details available in this saved roster.", years: 0, total: null };
}
