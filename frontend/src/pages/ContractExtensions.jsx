import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext.jsx";
import {
  previewContractExtensions,
  processCpuContractExtensions,
  submitContractExtensionOffer,
} from "../api/simEnginePy.js";
import PageFade from "../components/PageFade.jsx";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function compactMoney(value) {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1).replace(".0", "")}M`;
  }
  return money(amount);
}

function currentLeagueDate(leagueData) {
  const direct =
    leagueData?.currentDate ||
    leagueData?.calendarDate ||
    leagueData?.calendar?.currentDate ||
    leagueData?.calendar?.cursorDate ||
    null;
  if (direct) return direct;

  try {
    const seasonYear = Number(
      leagueData?.seasonStartYear || leagueData?.seasonYear || leagueData?.currentSeasonYear || 0
    );
    const raw = localStorage.getItem(`bm_calendar_sim_cursor_v1_${seasonYear}`);
    const parsed = raw ? JSON.parse(raw) : null;
    return typeof parsed === "string" ? parsed : parsed?.date || null;
  } catch {
    return null;
  }
}

function optionLabel(value) {
  if (value === "player") return "Player Option";
  if (value === "team") return "Team Option";
  return "No Option";
}

function interestTone(label = "") {
  const text = String(label).toLowerCase();
  if (text.includes("very likely") || text.includes("open")) return "text-emerald-300";
  if (text.includes("stronger")) return "text-amber-300";
  return "text-rose-300";
}

export default function ContractExtensions() {
  const navigate = useNavigate();
  const { leagueData, selectedTeam, setLeagueData } = useGame();
  const [preview, setPreview] = useState(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);
  const [offer, setOffer] = useState({
    years: 3,
    firstYearSalary: 10_000_000,
    annualRaisePct: 8,
    optionType: "none",
  });

  const teamName = selectedTeam?.name || null;
  const selectedRow = useMemo(
    () => preview?.players?.find((row) => String(row.playerId || row.playerName) === String(selectedPlayerId)) || null,
    [preview, selectedPlayerId]
  );

  const loadPreview = async (sourceLeague = leagueData, { runCpuOpening = false } = {}) => {
    if (!sourceLeague || !teamName) return;
    setLoading(true);
    try {
      let workingLeague = sourceLeague;
      if (runCpuOpening) {
        const cpu = await processCpuContractExtensions(
          sourceLeague,
          teamName,
          "opening",
          currentLeagueDate(sourceLeague)
        );
        if (cpu?.ok && cpu?.leagueData) {
          workingLeague = cpu.leagueData;
          if (!cpu.alreadyProcessed) setLeagueData(workingLeague);
        }
      }

      const next = await previewContractExtensions(
        workingLeague,
        teamName,
        currentLeagueDate(workingLeague)
      );
      if (!next?.ok) throw new Error(next?.reason || "Could not load contract extensions.");
      setPreview(next);

      const eligible = next.players?.find((row) => row.eligible);
      const currentStillExists = next.players?.some(
        (row) => String(row.playerId || row.playerName) === String(selectedPlayerId)
      );
      if (!currentStillExists) setSelectedPlayerId(eligible?.playerId || eligible?.playerName || next.players?.[0]?.playerId || null);
    } catch (error) {
      setNotice({ type: "error", text: error?.message || "Contract extension preview failed." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!leagueData || !teamName) return;
    loadPreview(leagueData, { runCpuOpening: true });
    // Opening CPU processing is idempotent in Python for the current season.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueData?.seasonYear, teamName]);

  useEffect(() => {
    if (!selectedRow?.eligible) return;
    const marketYears = Number(selectedRow?.marketValue?.expectedYears || 3);
    setOffer({
      years: Math.max(selectedRow.minYears || 1, Math.min(selectedRow.maxYears || 1, marketYears)),
      firstYearSalary: Number(selectedRow.recommendedFirstYearSalary || selectedRow.minFirstYearSalary || 1_200_000),
      annualRaisePct: Math.min(8, Number(selectedRow.maxAnnualRaisePct || 8)),
      optionType: "none",
    });
  }, [selectedRow?.playerId, selectedRow?.eligible]);

  const projectedSalaries = useMemo(() => {
    const years = Math.max(1, Number(offer.years || 1));
    const first = Number(offer.firstYearSalary || 0);
    const raise = Number(offer.annualRaisePct || 0) / 100;
    return Array.from({ length: years }, (_, index) => Math.round((first * Math.pow(1 + raise, index)) / 1000) * 1000);
  }, [offer]);

  const submitOffer = async () => {
    if (!leagueData || !teamName || !selectedRow?.eligible) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const result = await submitContractExtensionOffer(
        leagueData,
        teamName,
        selectedRow.playerId || selectedRow.playerName,
        offer,
        currentLeagueDate(leagueData)
      );
      if (!result?.ok) throw new Error(result?.reason || "The extension offer could not be submitted.");
      if (result.leagueData) setLeagueData(result.leagueData);
      setNotice({
        type: result.accepted ? "success" : "warning",
        text: result.accepted
          ? `${selectedRow.playerName} accepted the extension. The new years are now on the salary table.`
          : `${selectedRow.playerName} declined: ${result.decision?.reason || "The offer was not strong enough."}`,
      });
      await loadPreview(result.leagueData || leagueData);
    } catch (error) {
      setNotice({ type: "error", text: error?.message || "Extension negotiation failed." });
    } finally {
      setSubmitting(false);
    }
  };

  if (!leagueData || !selectedTeam) {
    return (
      <div className="min-h-screen bg-neutral-950 p-8 text-white">
        <div className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-neutral-900 p-8">
          Select a team before opening Contract Extensions.
        </div>
      </div>
    );
  }

  return (
    <PageFade>
      <div className="bm-page-bg min-h-screen overflow-hidden bg-neutral-950 text-white">
        <div className="mx-auto flex h-screen max-w-[1500px] flex-col px-5 py-5">
          <header className="mb-4 flex shrink-0 items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/55 px-5 py-4 backdrop-blur">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.25em] text-orange-300">Front Office</div>
              <h1 className="mt-1 text-3xl font-black">Contract Extensions</h1>
              <p className="mt-1 text-sm text-neutral-400">
                {teamName} · Deadline {preview?.state?.deadlineDate || "—"} · {preview?.state?.isOpen ? "Negotiations open" : "Window closed"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate("/team-hub", { state: { hubSection: "Front Office" } })}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-black hover:bg-white/10"
            >
              Back to Team Hub
            </button>
          </header>

          {notice && (
            <div className={`mb-4 shrink-0 rounded-xl border px-4 py-3 text-sm font-bold ${
              notice.type === "success"
                ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                : notice.type === "warning"
                ? "border-amber-400/30 bg-amber-500/10 text-amber-200"
                : "border-rose-400/30 bg-rose-500/10 text-rose-200"
            }`}>
              {notice.text}
            </div>
          )}

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[440px_minmax(0,1fr)]">
            <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/90">
              <div className="grid grid-cols-3 gap-2 border-b border-white/10 p-4 text-center">
                <div className="rounded-xl bg-black/30 p-3"><div className="text-2xl font-black">{preview?.summary?.eligibleCount ?? "—"}</div><div className="text-[10px] uppercase tracking-wider text-neutral-500">Eligible</div></div>
                <div className="rounded-xl bg-black/30 p-3"><div className="text-2xl font-black">{preview?.summary?.rookieEligibleCount ?? "—"}</div><div className="text-[10px] uppercase tracking-wider text-neutral-500">Rookie</div></div>
                <div className="rounded-xl bg-black/30 p-3"><div className="text-2xl font-black">{preview?.summary?.alreadyExtendedCount ?? "—"}</div><div className="text-[10px] uppercase tracking-wider text-neutral-500">Extended</div></div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3 orange-scrollbar">
                {loading ? (
                  <div className="p-6 text-center text-neutral-400">Loading extension eligibility…</div>
                ) : (
                  <div className="space-y-2">
                    {(preview?.players || []).map((row) => {
                      const key = row.playerId || row.playerName;
                      const active = String(key) === String(selectedPlayerId);
                      return (
                        <button
                          type="button"
                          key={key}
                          onClick={() => setSelectedPlayerId(key)}
                          className={`w-full rounded-xl border p-3 text-left transition ${active ? "border-orange-400 bg-orange-500/12" : "border-white/8 bg-black/25 hover:border-white/20"}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-black">{row.playerName}</div>
                              <div className="mt-1 text-xs text-neutral-500">{row.position || "—"} · Age {row.age} · {row.overall} OVR · {row.potential} POT</div>
                            </div>
                            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${row.eligible ? "bg-emerald-500/15 text-emerald-300" : row.alreadyExtended ? "bg-sky-500/15 text-sky-300" : "bg-white/5 text-neutral-500"}`}>
                              {row.eligible ? "Eligible" : row.alreadyExtended ? "Extended" : "Ineligible"}
                            </span>
                          </div>
                          <div className="mt-2 line-clamp-2 text-xs leading-5 text-neutral-400">{row.reason}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            <section className="min-h-0 overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900/90 p-5 orange-scrollbar">
              {!selectedRow ? (
                <div className="flex h-full items-center justify-center text-neutral-500">Select a player.</div>
              ) : (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
                    <div>
                      <h2 className="text-3xl font-black">{selectedRow.playerName}</h2>
                      <div className="mt-2 text-sm text-neutral-400">{selectedRow.reason}</div>
                    </div>
                    {selectedRow.eligible && (
                      <div className="rounded-xl border border-orange-400/20 bg-orange-500/10 px-4 py-3 text-right">
                        <div className="text-[10px] font-black uppercase tracking-wider text-orange-300">Player Interest</div>
                        <div className={`mt-1 text-sm font-black ${interestTone(selectedRow.interestLabel)}`}>{selectedRow.interestLabel}</div>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-white/8 bg-black/25 p-4">
                      <div className="text-[10px] font-black uppercase tracking-wider text-neutral-500">Current Contract</div>
                      <div className="mt-2 text-lg font-black">{selectedRow.remainingContractYears ?? selectedRow.currentContract?.salaryByYear?.length ?? 0} years remaining</div>
                      <div className="mt-1 text-xs text-neutral-400">Ends {selectedRow.currentContractEndYear || "—"}</div>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-black/25 p-4">
                      <div className="text-[10px] font-black uppercase tracking-wider text-neutral-500">Extension Type</div>
                      <div className="mt-2 text-lg font-black">{selectedRow.extensionType === "rookie_scale" ? "Rookie Scale" : selectedRow.extensionType === "veteran" ? "Veteran" : "—"}</div>
                      <div className="mt-1 text-xs text-neutral-400">Starts {selectedRow.extensionStartYear || "—"}</div>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-black/25 p-4">
                      <div className="text-[10px] font-black uppercase tracking-wider text-neutral-500">Projected Market</div>
                      <div className="mt-2 text-lg font-black">{compactMoney(selectedRow.marketValue?.expectedAAV)}</div>
                      <div className="mt-1 text-xs text-neutral-400">Expected AAV</div>
                    </div>
                  </div>

                  {selectedRow.currentContract?.salaryByYear?.length > 0 && (
                    <div>
                      <div className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-neutral-500">Existing guaranteed years</div>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {selectedRow.currentContract.salaryByYear
                          .map((salary, index) => ({
                            salary,
                            year: Number(selectedRow.currentContract.startYear) + index,
                          }))
                          .filter((row) => row.year >= Number(selectedRow.currentContractSeasonYear || selectedRow.currentContract.startYear))
                          .map((row) => (
                            <div key={row.year} className="rounded-xl border border-white/8 bg-black/20 p-3">
                              <div className="text-xs text-neutral-500">{row.year}</div>
                              <div className="mt-1 font-black">{compactMoney(row.salary)}</div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {!selectedRow.eligible ? (
                    <div className="rounded-2xl border border-white/10 bg-black/25 p-6">
                      <div className="text-lg font-black">Not currently negotiable</div>
                      <p className="mt-2 text-sm leading-6 text-neutral-400">{selectedRow.reason}</p>
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="rounded-xl border border-white/8 bg-black/20 p-4">
                          <span className="text-xs font-black uppercase tracking-wider text-neutral-500">Extension Years</span>
                          <select
                            value={offer.years}
                            onChange={(event) => setOffer((prev) => ({ ...prev, years: Number(event.target.value) }))}
                            className="mt-3 w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 font-bold"
                          >
                            {Array.from({ length: selectedRow.maxYears - selectedRow.minYears + 1 }, (_, index) => selectedRow.minYears + index).map((year) => <option value={year} key={year}>{year} years</option>)}
                          </select>
                        </label>

                        <label className="rounded-xl border border-white/8 bg-black/20 p-4">
                          <span className="text-xs font-black uppercase tracking-wider text-neutral-500">First-Year Salary</span>
                          <input
                            type="number"
                            min={selectedRow.minFirstYearSalary}
                            max={selectedRow.maxFirstYearSalary}
                            step={100000}
                            value={offer.firstYearSalary}
                            onChange={(event) => setOffer((prev) => ({ ...prev, firstYearSalary: Number(event.target.value) }))}
                            className="mt-3 w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 font-bold"
                          />
                          <div className="mt-2 text-[11px] text-neutral-500">Legal range {compactMoney(selectedRow.minFirstYearSalary)} – {compactMoney(selectedRow.maxFirstYearSalary)}</div>
                        </label>

                        <label className="rounded-xl border border-white/8 bg-black/20 p-4">
                          <span className="text-xs font-black uppercase tracking-wider text-neutral-500">Annual Raise</span>
                          <select
                            value={offer.annualRaisePct}
                            onChange={(event) => setOffer((prev) => ({ ...prev, annualRaisePct: Number(event.target.value) }))}
                            className="mt-3 w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 font-bold"
                          >
                            {[0, 5, 8].filter((value) => value <= selectedRow.maxAnnualRaisePct).map((value) => <option value={value} key={value}>{value}%</option>)}
                          </select>
                        </label>

                        <label className="rounded-xl border border-white/8 bg-black/20 p-4">
                          <span className="text-xs font-black uppercase tracking-wider text-neutral-500">Final-Year Option</span>
                          <select
                            value={offer.optionType}
                            onChange={(event) => setOffer((prev) => ({ ...prev, optionType: event.target.value }))}
                            className="mt-3 w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 font-bold"
                          >
                            <option value="none">No Option</option>
                            <option value="player">Player Option</option>
                            <option value="team">Team Option</option>
                          </select>
                        </label>
                      </div>

                      <div className="rounded-2xl border border-orange-400/20 bg-orange-500/7 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">Offer Preview</div>
                            <div className="mt-1 text-2xl font-black">{offer.years} years · {compactMoney(projectedSalaries.reduce((sum, value) => sum + value, 0))}</div>
                            <div className="mt-1 text-sm text-neutral-400">{optionLabel(offer.optionType)} · begins {selectedRow.extensionStartYear}</div>
                          </div>
                          <button
                            type="button"
                            disabled={submitting || !preview?.state?.isOpen}
                            onClick={submitOffer}
                            className="rounded-xl bg-orange-600 px-6 py-3 text-sm font-black text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {submitting ? "Submitting…" : "Offer Extension"}
                          </button>
                        </div>
                        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                          {projectedSalaries.map((salary, index) => (
                            <div key={index} className="rounded-lg bg-black/30 p-3 text-center">
                              <div className="text-[10px] text-neutral-500">{Number(selectedRow.extensionStartYear) + index}</div>
                              <div className="mt-1 text-sm font-black">{compactMoney(salary)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </PageFade>
  );
}
