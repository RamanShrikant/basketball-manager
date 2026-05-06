// src/pages/SalaryTable.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";

export default function SalaryTable() {
  const navigate = useNavigate();
  const { leagueData: ctxLeague, selectedTeam: ctxSelectedTeam } = useGame();

  const [leagueData, setLeagueData] = useState(null);
  const [selectedTeamKey, setSelectedTeamKey] = useState("");

  const rawSeasonYear = Number(
    leagueData?.seasonYear ??
    leagueData?.currentSeasonYear ??
    leagueData?.seasonStartYear ??
    2025
  );

  const currentSeasonYear = Number.isFinite(rawSeasonYear)
    ? rawSeasonYear + 1
    : 2026;

  const getLeagueAmount = (keys, fallback) => {
    for (const key of keys) {
      const value = Number(leagueData?.[key] || 0);
      if (value > 0) return value;
    }
    return fallback;
  };

  const SALARY_CAP = getLeagueAmount(["salaryCap", "capLimit"], 154_647_000);
  const TAX_LINE = getLeagueAmount(["luxuryTaxLine", "taxLine"], 187_895_000);
  const FIRST_APRON = getLeagueAmount(["firstApron", "apron1"], 195_945_000);
  const SECOND_APRON = getLeagueAmount(["secondApron", "apron2"], 207_824_000);
  const HARD_CAP = getLeagueAmount(["hardCap", "hardCapLimit"], SECOND_APRON);

  const fmtM = (n) => {
    const v = Number(n) || 0;
    return `$${(v / 1_000_000).toFixed(1)}M`.replace(".0M", "M");
  };

  const safeJSON = (raw) => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const looksLikeLeague = (obj) => {
    const conf = obj?.conferences;
    const eastOk = Array.isArray(conf?.East);
    const westOk = Array.isArray(conf?.West);
    return eastOk && westOk;
  };

  const readLeagueFromLocalStorage = () => {
    const direct = safeJSON(localStorage.getItem("leagueData"));
    if (looksLikeLeague(direct)) return direct;

    let best = null;
    let bestScore = -1;

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const raw = localStorage.getItem(k);
      const obj = safeJSON(raw);
      if (!looksLikeLeague(obj)) continue;

      const eastN = obj.conferences.East.length;
      const westN = obj.conferences.West.length;
      const score = eastN + westN;

      if (score > bestScore) {
        bestScore = score;
        best = obj;
      }
    }

    return best;
  };

  const readSelectedTeamFromLocalStorage = () => {
    return safeJSON(localStorage.getItem("selectedTeam"));
  };

  useEffect(() => {
    if (looksLikeLeague(ctxLeague)) {
      setLeagueData(ctxLeague);
      return;
    }
    const parsed = readLeagueFromLocalStorage();
    setLeagueData(parsed);
  }, [ctxLeague]);

  const allTeamsFlat = useMemo(() => {
    const out = [];
    const confs = leagueData?.conferences || {};
    for (const conf of ["East", "West"]) {
      const teams = confs?.[conf] || [];
      for (let i = 0; i < teams.length; i++) {
        const t = teams[i];
        out.push({
          key: `${conf}-${i}`,
          conf,
          teamIdx: i,
          name: t?.name || `${conf} Team ${i + 1}`,
          logo: t?.logo || t?.teamLogo || t?.logoUrl || "",
        });
      }
    }
    return out;
  }, [leagueData]);

  useEffect(() => {
    if (allTeamsFlat.length === 0) return;
    if (selectedTeamKey) return;

    const preferredName =
      ctxSelectedTeam?.name ||
      readSelectedTeamFromLocalStorage()?.name ||
      readSelectedTeamFromLocalStorage() ||
      "";

    if (preferredName) {
      const found = allTeamsFlat.find((t) => t.name === preferredName);
      if (found) {
        setSelectedTeamKey(found.key);
        return;
      }
    }

    setSelectedTeamKey(allTeamsFlat[0].key);
  }, [allTeamsFlat, ctxSelectedTeam, selectedTeamKey]);

  const selectedTeam = useMemo(() => {
    if (!leagueData?.conferences) return null;
    const [conf, idxStr] = (selectedTeamKey || "").split("-");
    const idx = Number(idxStr);
    if (!conf || !Number.isFinite(idx)) return null;
    return leagueData.conferences?.[conf]?.[idx] || null;
  }, [leagueData, selectedTeamKey]);

  const normalizeContract = (p) => {
    const contract = p?.contract || null;

    let startYear = Number(contract?.startYear ?? currentSeasonYear);
    const salaryByYear = Array.isArray(contract?.salaryByYear)
      ? contract.salaryByYear.map((x) => Number(x) || 0)
      : [];
    const option = contract?.option ?? null;

    const lastYear = startYear + Math.max(0, salaryByYear.length - 1);

    const hasCurrentSeasonSlot =
      salaryByYear.length > 0 &&
      currentSeasonYear >= startYear &&
      currentSeasonYear <= lastYear;

    const looksLikePreviousOffseasonOneYearDeal =
      salaryByYear.length === 1 &&
      startYear === currentSeasonYear - 1 &&
      !hasCurrentSeasonSlot;

    if (looksLikePreviousOffseasonOneYearDeal) {
      startYear = currentSeasonYear;
    }

    return { startYear, salaryByYear, option };
  };

  const players = useMemo(() => {
    const pls = selectedTeam?.players || [];
    return pls.map((p) => {
      const c = normalizeContract(p);
      const years = Math.max(1, c.salaryByYear.length || 1);
      const endYear = c.salaryByYear.length
        ? c.startYear + c.salaryByYear.length - 1
        : c.startYear;
      const totalRemaining = c.salaryByYear.reduce((s, v, idx) => {
        const seasonYear = c.startYear + idx;
        if (seasonYear < currentSeasonYear) return s;
        return s + (Number(v) || 0);
      }, 0);

      let optionLabel = "None";
      if (c.option?.type) {
        const optionYears = Array.isArray(c.option?.yearIndices)
          ? c.option.yearIndices
          : c.option?.yearIndex != null
          ? [c.option.yearIndex]
          : [];

        if (optionYears.length) {
          optionLabel = `${c.option.type.toUpperCase()} ${optionYears
            .map((y) => `Y${Number(y) + 1}`)
            .join(", ")}`;
        } else {
          optionLabel = c.option.type.toUpperCase();
        }
      }

      const headshot = p?.headshot || "";
      const expType = "UFA";

      return {
        id: p?.id || `${p?.name || "player"}-${Math.random().toString(36).slice(2, 8)}`,
        name: p?.name || "Unknown",
        pos: p?.pos || "",
        overall: p?.overall ?? "-",
        headshot,
        contract: c,
        years,
        endYear,
        totalRemaining,
        optionLabel,
        expType,
      };
    });
  }, [selectedTeam, currentSeasonYear]);

  const DISPLAY_YEARS = 5;

  const yearColumns = useMemo(() => {
    return Array.from({ length: DISPLAY_YEARS }, (_, i) => currentSeasonYear + i);
  }, [currentSeasonYear]);

  const teamTotalsByYear = useMemo(() => {
    const totals = yearColumns.map(() => 0);

    for (const p of players) {
      for (let i = 0; i < yearColumns.length; i++) {
        const seasonYear = yearColumns[i];
        const idx = seasonYear - p.contract.startYear;
        const sal = idx >= 0 ? Number(p.contract.salaryByYear[idx] || 0) : 0;
        totals[i] += sal;
      }
    }

    return totals;
  }, [players, yearColumns]);

  const teamTotalAllYears = useMemo(() => {
    return teamTotalsByYear.reduce((s, v) => s + (Number(v) || 0), 0);
  }, [teamTotalsByYear]);

  const payrollThisYear = teamTotalsByYear?.[0] ?? 0;

  const capStatus = useMemo(() => {
    if (payrollThisYear >= HARD_CAP) return { label: "Hard Cap", tone: "danger" };
    if (payrollThisYear >= SECOND_APRON) return { label: "2nd Apron", tone: "danger" };
    if (payrollThisYear >= FIRST_APRON) return { label: "1st Apron", tone: "warn" };
    if (payrollThisYear >= TAX_LINE) return { label: "Luxury Tax", tone: "warn" };
    if (payrollThisYear >= SALARY_CAP) return { label: "Over Cap", tone: "neutral" };
    return { label: "Below Cap", tone: "good" };
  }, [payrollThisYear, HARD_CAP, SECOND_APRON, FIRST_APRON, TAX_LINE, SALARY_CAP]);

  const toneClass = (tone) => {
    if (tone === "danger") return "bg-red-500/15 text-red-200 border-red-400/25";
    if (tone === "warn") return "bg-orange-500/15 text-orange-200 border-orange-400/25";
    if (tone === "good") return "bg-emerald-500/15 text-emerald-200 border-emerald-400/25";
    return "bg-white/10 text-white/80 border-white/15";
  };

  const emptyTeams =
    (leagueData?.conferences?.East?.length || 0) + (leagueData?.conferences?.West?.length || 0) === 0;

  if (!leagueData) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex items-center justify-center p-6">
        <div className="max-w-xl w-full bg-neutral-800/80 border border-white/10 rounded-2xl p-6 shadow-lg">
          <div className="text-2xl font-extrabold text-orange-500">Salary Table</div>
          <div className="text-white/70 mt-2">
            No league found yet. Import a league in League Editor or load one through Play first.
          </div>
          <div className="text-white/50 text-sm mt-4">
            Tip: make sure the league is saved to localStorage under leagueData or exists in GameContext.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-900 text-white p-6">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-4xl font-extrabold text-orange-500 leading-tight">Salary Table</h1>
            <div className="text-white/60 text-sm mt-1">{leagueData?.leagueName || "League"}</div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="text-sm text-white/60">Team</div>
              <select
                className="bg-neutral-800 border border-white/10 text-white rounded-xl px-3 py-2 min-w-[280px] outline-none focus:ring-2 focus:ring-orange-500/40"
                value={selectedTeamKey}
                onChange={(e) => setSelectedTeamKey(e.target.value)}
              >
                {allTeamsFlat.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name} ({t.conf})
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => navigate("/team-hub")}
              className="px-6 py-2 bg-orange-600 hover:bg-orange-500 rounded-xl font-semibold transition"
            >
              Back
            </button>
          </div>
        </div>

        {emptyTeams && (
          <div className="bg-neutral-800/70 border border-orange-500/20 rounded-2xl p-4 text-white/75">
            Found a league object, but it has 0 teams in East/West. That usually means this page is reading a different localStorage league than the rest of the app.
          </div>
        )}

        {selectedTeam && (
          <div className="bg-neutral-800/80 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-white/10 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  {selectedTeam.logo ? (
                    <img src={selectedTeam.logo} alt="" className="w-10 h-10 object-contain" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/10" />
                  )}

                  <div>
                    <div className="text-2xl font-extrabold">{selectedTeam.name} Salary Table</div>
                    <div className="text-white/60 text-sm">{players.length} players</div>
                  </div>
                </div>

                <div className={`px-3 py-2 rounded-xl border text-sm ${toneClass(capStatus.tone)}`}>
                  <div className="font-semibold">{capStatus.label}</div>
                  <div className="text-xs opacity-80">
                    Payroll {yearColumns[0]}: {fmtM(payrollThisYear)}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Chip label={`Salary Cap: ${fmtM(SALARY_CAP)}`} />
                <Chip label={`Luxury Tax: ${fmtM(TAX_LINE)}`} />
                <Chip label={`1st Apron: ${fmtM(FIRST_APRON)}`} />
                <Chip label={`2nd Apron: ${fmtM(SECOND_APRON)}`} />
                <Chip label={`Hard Cap: ${fmtM(HARD_CAP)}`} />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px]">
                <thead className="bg-white/5 border-b border-white/10">
                  <tr className="text-white/70 text-sm">
                    <th className="text-left px-4 py-3">Player</th>
                    <th className="text-center px-3 py-3">Pos</th>
                    <th className="text-center px-3 py-3">OVR</th>
                    {yearColumns.map((y) => (
                      <th key={y} className="text-right px-3 py-3 whitespace-nowrap">
                        {y}
                      </th>
                    ))}
                    <th className="text-right px-3 py-3 whitespace-nowrap">Total Remaining</th>
                    <th className="text-center px-3 py-3 whitespace-nowrap">Exp.</th>
                  </tr>
                </thead>

                <tbody>
                  {players.map((p) => (
                    <tr key={p.id} className="border-b border-white/5 hover:bg-white/5 transition">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {p.headshot ? (
                            <img
                              src={p.headshot}
                              alt={p.name}
                              className="w-14 h-14 rounded-full object-cover border border-white/10 bg-white/5"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          ) : (
                            <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10" />
                          )}

                          <div className="leading-tight">
                            <div className="font-semibold">{p.name}</div>
                            <div className="text-xs text-white/50">{p.optionLabel}</div>
                          </div>
                        </div>
                      </td>

                      <td className="text-center px-3 py-3 text-white/85">{p.pos}</td>
                      <td className="text-center px-3 py-3 font-semibold text-orange-300">{p.overall}</td>

                      {yearColumns.map((seasonYear) => {
                        const idx = seasonYear - p.contract.startYear;
                        const sal = idx >= 0 ? Number(p.contract.salaryByYear[idx] || 0) : 0;
                        const isBig = sal >= 25_000_000;
                        const salClass = isBig ? "text-emerald-300" : "text-white/85";

                        return (
                          <td
                            key={`${p.id}-${seasonYear}`}
                            className={`text-right px-3 py-3 whitespace-nowrap ${
                              sal > 0 ? salClass : "text-white/35"
                            }`}
                          >
                            {sal > 0 ? fmtM(sal) : "-"}
                          </td>
                        );
                      })}

                      <td className="text-right px-3 py-3 whitespace-nowrap font-extrabold text-emerald-300">
                        {fmtM(p.totalRemaining)}
                      </td>

                      <td className="text-center px-3 py-3 whitespace-nowrap text-white/65">
                        {p.endYear} {p.expType}
                      </td>
                    </tr>
                  ))}

                  <tr className="bg-white/5">
                    <td className="px-4 py-3 font-extrabold text-white/90" colSpan={3}>
                      Team Totals:
                    </td>

                    {yearColumns.map((y, i) => {
                      const total = teamTotalsByYear[i] || 0;
                      const overTax = i === 0 && total >= TAX_LINE;
                      const overCap = i === 0 && total >= SALARY_CAP;

                      return (
                        <td
                          key={`tot-${y}`}
                          className={`text-right px-3 py-3 whitespace-nowrap font-extrabold ${
                            overTax ? "text-red-300" : overCap ? "text-orange-300" : "text-white/85"
                          }`}
                        >
                          {fmtM(total)}
                        </td>
                      );
                    })}

                    <td className="text-right px-3 py-3 whitespace-nowrap font-extrabold text-emerald-300">
                      {fmtM(teamTotalAllYears)}
                    </td>

                    <td className="text-center px-3 py-3 whitespace-nowrap text-white/40">-</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex justify-center pt-2">
          <button
            onClick={() => navigate("/team-hub")}
            className="mt-2 px-8 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
          >
            Back to Team Hub
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip({ label }) {
  return (
    <div className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white/80">
      {label}
    </div>
  );
}
