import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext.jsx";
import {
  previewContractExtensions,
  processCpuContractExtensions,
  submitContractExtensionOffer,
} from "../api/simEnginePy.js";
import PageFade from "../components/PageFade.jsx";
import { getOffseasonTradeContext } from "../utils/offseasonTradeContext.js";
import { getUserTradeCurrentDate, stampExtensionRestriction } from "../utils/userTradeRules.js";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";

const EXTENSION_DEADLINE_CONTEXT_KEY = "bm_contract_extension_deadline_context_v1";

function normalizeIsoDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function readStoredDeadlineContext() {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(EXTENSION_DEADLINE_CONTEXT_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function clearStoredDeadlineContext() {
  if (typeof sessionStorage === "undefined") return;
  try { sessionStorage.removeItem(EXTENSION_DEADLINE_CONTEXT_KEY); } catch {}
}

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

function currentLeagueDate(leagueData, deadlineContext = null) {
  const contextDate = normalizeIsoDate(deadlineContext?.date || deadlineContext?.currentDate || deadlineContext?.deadlineDate);
  if (contextDate) return contextDate;

  const ruleDate = getUserTradeCurrentDate(leagueData);
  if (ruleDate) return ruleDate;

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

function buildExtensionMoodLeague(leagueData, teamName) { return leagueData; }

function optionLabel(value) {
  if (value === "player") return "Player Option";
  if (value === "team") return "Team Option";
  return "No Option";
}

function extensionTypeLabel(value) {
  if (value === "rookie_scale") return "Rookie Scale";
  if (value === "veteran") return "Veteran";
  return "—";
}

function interestTone(label = "") {
  const text = String(label).toLowerCase();
  if (text.includes("available") || text.includes("accepted") || text.includes("open")) return "text-emerald-300";
  if (text.includes("wait") || text.includes("direction") || text.includes("role")) return "text-amber-300";
  return "text-rose-300";
}

function packageTotal(pkg) {
  return Number(pkg?.totalValue || (pkg?.salaryByYear || []).reduce((sum, value) => sum + Number(value || 0), 0));
}

function packageAav(pkg) {
  return Number(pkg?.aav || packageTotal(pkg) / Math.max(1, Number(pkg?.years || pkg?.salaryByYear?.length || 1)));
}


function extensionRowSortBucket(row) {
  if (row?.eligible) return 0;
  if (row?.playerRefusesExtension) return 1;
  if (row?.alreadyExtended) return 2;
  return 3;
}

function sortExtensionRows(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const bucketDiff = extensionRowSortBucket(a) - extensionRowSortBucket(b);
    if (bucketDiff !== 0) return bucketDiff;
    const overallDiff = Number(b?.overall || 0) - Number(a?.overall || 0);
    if (overallDiff !== 0) return overallDiff;
    const potentialDiff = Number(b?.potential || 0) - Number(a?.potential || 0);
    if (potentialDiff !== 0) return potentialDiff;
    return String(a?.playerName || "").localeCompare(String(b?.playerName || ""));
  });
}

export default function ContractExtensions() {
  const navigate = useNavigate();
  const location = useLocation();
  const { leagueData, selectedTeam, setLeagueData } = useGame();
  const [preview, setPreview] = useState(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [selectedPackageId, setSelectedPackageId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);

  const teamName = selectedTeam?.name || null;
  const deadlineContext = useMemo(() => {
    const routeContext = location?.state?.extensionDeadlineContext || null;
    const storedContext = readStoredDeadlineContext();
    const context = routeContext || storedContext || null;
    const contextSeason = Number(context?.seasonYear || 0);
    const currentSeason = Number(leagueData?.seasonStartYear || leagueData?.seasonYear || leagueData?.currentSeasonYear || 0);
    if (context && contextSeason && currentSeason && contextSeason !== currentSeason) {
      clearStoredDeadlineContext();
      return null;
    }
    return context;
  }, [location?.state, leagueData?.seasonStartYear, leagueData?.seasonYear, leagueData?.currentSeasonYear]);
  const extensionWindowLocked = useMemo(() => Boolean(getOffseasonTradeContext(leagueData)?.inOffseason), [leagueData]);
  const selectedRow = useMemo(
    () => preview?.players?.find((row) => String(row.playerId || row.playerName) === String(selectedPlayerId)) || null,
    [preview, selectedPlayerId]
  );

  const askPackages = selectedRow?.askPackages || [];
  const selectedPackage = useMemo(
    () => askPackages.find((pkg) => String(pkg.askPackageId || pkg.packageId) === String(selectedPackageId)) || askPackages[0] || null,
    [askPackages, selectedPackageId]
  );
  const projectedSalaries = selectedPackage?.salaryByYear || [];
  const refusingCount = useMemo(() => (preview?.players || []).filter((row) => row?.playerRefusesExtension).length, [preview]);
  const orderedExtensionPlayers = useMemo(() => sortExtensionRows(preview?.players || []), [preview]);

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
          currentLeagueDate(sourceLeague, deadlineContext)
        );
        if (cpu?.ok && cpu?.leagueData) {
          workingLeague = cpu.leagueData;
          if (!cpu.alreadyProcessed) setLeagueData(workingLeague);
        }
      }

      const next = await previewContractExtensions(
        workingLeague,
        teamName,
        currentLeagueDate(workingLeague, deadlineContext)
      );
      if (!next?.ok) throw new Error(next?.reason || "Could not load contract extensions.");
      setPreview(next);

      const eligible = next.players?.find((row) => row.eligible);
      const currentStillExists = next.players?.some(
        (row) => String(row.playerId || row.playerName) === String(selectedPlayerId)
      );
      if (!currentStillExists) {
        setSelectedPlayerId(eligible?.playerId || eligible?.playerName || next.players?.[0]?.playerId || null);
      }
    } catch (error) {
      setNotice({ type: "error", text: error?.message || "Contract extension preview failed." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!leagueData || !teamName || extensionWindowLocked) return;
    loadPreview(leagueData, { runCpuOpening: false });
    // CPU extension actions now run only at the rookie/veteran deadline prompts, not from opening this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueData?.seasonYear, teamName, extensionWindowLocked, deadlineContext?.date, deadlineContext?.phase]);

  useEffect(() => {
    if (!selectedRow?.eligible || !selectedRow?.askPackages?.length) {
      setSelectedPackageId(null);
      return;
    }
    setSelectedPackageId(selectedRow.askPackages[0].askPackageId || selectedRow.askPackages[0].packageId);
  }, [selectedRow?.playerId, selectedRow?.playerName, selectedRow?.eligible]);

  const submitOffer = async () => {
    if (!leagueData || !teamName || !selectedRow?.eligible || !selectedPackage) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const result = await submitContractExtensionOffer(
        leagueData,
        teamName,
        selectedRow.playerId || selectedRow.playerName,
        selectedPackage,
        currentLeagueDate(leagueData, deadlineContext)
      );
      if (!result?.ok) throw new Error(result?.reason || "The extension package could not be submitted.");
      const resultLeague = result.leagueData || leagueData;
      const stampedLeague = result.accepted
        ? stampExtensionRestriction({
            leagueData: resultLeague,
            teamName,
            player: { id: selectedRow.playerId, playerId: selectedRow.playerId, name: selectedRow.playerName },
            signedDate: currentLeagueDate(resultLeague, deadlineContext),
          })
        : resultLeague;
      if (stampedLeague) setLeagueData(stampedLeague);
      setNotice({
        type: result.accepted ? "success" : "warning",
        text: result.accepted
          ? `${selectedRow.playerName} signed the selected extension package. The new years are now on the salary table.`
          : `${selectedRow.playerName} declined: ${result.decision?.reason || "The offer was not strong enough."}`,
      });
      await loadPreview(stampedLeague || resultLeague);
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

  if (extensionWindowLocked) {
    return (
      <PageFade>
        <div className="bm-page-bg flex min-h-screen items-center justify-center bg-neutral-950 px-6 pb-20 text-white">
          <div className="max-w-2xl rounded-3xl border border-orange-400/25 bg-black/70 p-8 text-center shadow-2xl shadow-black/40">
            <div className="text-xs font-black uppercase tracking-[0.28em] text-orange-300">Front Office</div>
            <h1 className="mt-3 text-3xl font-black text-white">Contract Extensions Locked</h1>
            <p className="mt-3 text-sm font-bold leading-6 text-neutral-300">
              Contract extensions are disabled during the offseason. They reopen when the next regular season begins.
            </p>
            <button
              type="button"
              onClick={() => navigate("/team-hub", { state: { hubSection: "Front Office", offseasonMode: true, returnTo: "/offseason" } })}
              className="mt-6 rounded-2xl border border-white/10 bg-orange-600 px-6 py-3 text-sm font-black text-white transition hover:bg-orange-500"
            >
              Back to Front Office
            </button>
          </div>
        </div>
      </PageFade>
    );
  }

  return (
    <PageFade>
      <div className="bm-page-bg min-h-screen overflow-hidden bg-neutral-950 pb-16 text-white">
        <div className="mx-auto flex h-[calc(100vh-70px)] max-w-[1600px] flex-col px-5 py-3">
          <header className="mb-3 flex shrink-0 items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/55 px-5 py-2.5 backdrop-blur">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.25em] text-orange-300">Front Office</div>
              <h1 className="mt-0.5 text-2xl font-black">Contract Extensions</h1>
              <p className="mt-1 text-sm text-neutral-400">
                {teamName} · Rookie deadline {preview?.state?.rookieDeadlineDate || "—"} · Veteran deadline {preview?.state?.veteranDeadlineDate || "—"}
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
            <div className={`mb-3 shrink-0 rounded-xl border px-4 py-3 text-sm font-bold ${
              notice.type === "success"
                ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                : notice.type === "warning"
                ? "border-amber-400/30 bg-amber-500/10 text-amber-200"
                : "border-rose-400/30 bg-rose-500/10 text-rose-200"
            }`}>
              {notice.text}
            </div>
          )}

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
            <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/90">
              <div className="grid grid-cols-3 gap-2 border-b border-white/10 p-3 text-center">
                <div className="rounded-xl bg-black/30 p-3"><div className="text-2xl font-black">{preview?.summary?.eligibleCount ?? "—"}</div><div className="text-[10px] uppercase tracking-wider text-neutral-500">Eligible</div></div>
                <div className="rounded-xl bg-black/30 p-3"><div className="text-2xl font-black">{preview?.summary?.rookieEligibleCount ?? "—"}</div><div className="text-[10px] uppercase tracking-wider text-neutral-500">Rookie</div></div>
                <div className="rounded-xl bg-black/30 p-3"><div className="text-2xl font-black">{preview?.summary?.veteranEligibleCount ?? "—"}</div><div className="text-[10px] uppercase tracking-wider text-neutral-500">Veteran</div></div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3 orange-scrollbar">
                {loading ? (
                  <div className="p-6 text-center text-neutral-400">Loading extension eligibility…</div>
                ) : (
                  <div className="space-y-2">
                    {orderedExtensionPlayers.map((row) => {
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
                            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${row.eligible ? "bg-emerald-500/15 text-emerald-300" : row.alreadyExtended ? "bg-sky-500/15 text-sky-300" : row.playerRefusesExtension ? "bg-amber-500/15 text-amber-300" : "bg-white/5 text-neutral-500"}`}>
                              {row.eligible ? "Has Ask" : row.alreadyExtended ? "Extended" : row.playerRefusesExtension ? "Refuses" : "Ineligible"}
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

            <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/90">
              {!selectedRow ? (
                <div className="flex h-full items-center justify-center text-neutral-500">Select a player.</div>
              ) : (
                <>
                  <div className="min-h-0 flex-1 overflow-hidden p-3">
                    <div className="flex h-full min-h-0 flex-col gap-2">
                      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 pb-2">
                        <div className="min-w-0">
                          <h2 className="truncate text-xl font-black">{selectedRow.playerName}</h2>
                          {!selectedRow.eligible && (
                            <div className="mt-1 line-clamp-2 text-xs leading-4 text-neutral-400">{selectedRow.reason}</div>
                          )}
                        </div>
                        <div className="shrink-0 rounded-xl border border-orange-400/20 bg-orange-500/10 px-3 py-1.5 text-right">
                          <div className="text-[10px] font-black uppercase tracking-wider text-orange-300">Player Camp</div>
                          <div className={`mt-1 text-sm font-black ${interestTone(selectedRow.interestLabel || selectedRow.extensionInterestLabel || selectedRow.reason)}`}>
                            {selectedRow.eligible ? selectedRow.interestLabel || selectedRow.extensionInterestLabel || "Ask available" : selectedRow.playerRefusesExtension ? selectedRow.extensionInterestLabel || "Prefers to wait" : "Not negotiable"}
                          </div>
                          {selectedRow.extensionInterestScore != null && (
                            <div className="mt-0.5 text-[10px] font-black text-neutral-400">Interest {selectedRow.extensionInterestScore}/100 · Mood {selectedRow.extensionMoodScore ?? "—"}</div>
                          )}
                        </div>
                      </div>

                      <div className="grid shrink-0 gap-2 md:grid-cols-4">
                        <div className="rounded-xl border border-white/8 bg-black/25 p-2.5">
                          <div className="text-[10px] font-black uppercase tracking-wider text-neutral-500">Current Contract</div>
                          <div className="mt-1 text-sm font-black">{selectedRow.remainingContractYears ?? selectedRow.currentContract?.salaryByYear?.length ?? 0} years left</div>
                          <div className="mt-0.5 text-[10px] text-neutral-400">Ends {selectedRow.currentContractEndYear || "—"}</div>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-black/25 p-2.5">
                          <div className="text-[10px] font-black uppercase tracking-wider text-neutral-500">Extension Type</div>
                          <div className="mt-1 text-sm font-black">{extensionTypeLabel(selectedRow.extensionType)}</div>
                          <div className="mt-0.5 text-[10px] text-neutral-400">Starts {selectedRow.extensionStartYear || "—"}</div>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-black/25 p-2.5">
                          <div className="text-[10px] font-black uppercase tracking-wider text-neutral-500">Projected Market</div>
                          <div className="mt-1 text-sm font-black">{compactMoney(selectedRow.marketValue?.expectedAAV)}</div>
                          <div className="mt-0.5 text-[10px] text-neutral-400">Expected AAV</div>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-black/25 p-2.5">
                          <div className="text-[10px] font-black uppercase tracking-wider text-neutral-500">Deadline</div>
                          <div className="mt-1 text-sm font-black">{selectedRow.deadlineType === "rookie" ? "Rookie" : selectedRow.deadlineType === "veteran" ? "Veteran" : "—"}</div>
                          <div className="mt-0.5 text-[10px] text-neutral-400">{selectedRow.deadlineDate || "—"}</div>
                        </div>
                      </div>

                      {selectedRow.currentContract?.salaryByYear?.length > 0 && (
                        <div className="shrink-0">
                          <div className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-neutral-500">Existing guaranteed years</div>
                          <div className="grid grid-cols-5 gap-2">
                            {selectedRow.currentContract.salaryByYear
                              .map((salary, index) => ({
                                salary,
                                year: Number(selectedRow.currentContract.startYear) + index,
                              }))
                              .filter((row) => row.year >= Number(selectedRow.currentContractSeasonYear || selectedRow.currentContract.startYear))
                              .map((row) => (
                                <div key={row.year} className="rounded-xl border border-white/8 bg-black/20 px-2.5 py-2">
                                  <div className="text-[10px] text-neutral-500">{row.year}</div>
                                  <div className="mt-0.5 text-sm font-black">{compactMoney(row.salary)}</div>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}

                      {!selectedRow.eligible ? (
                        <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                          <div className="text-base font-black">Not currently negotiable</div>
                          <p className="mt-1 text-xs leading-5 text-neutral-400">{selectedRow.reason}</p>
                        </div>
                      ) : (
                        <div className="flex min-h-0 flex-1 flex-col">
                          <div className="mb-1 shrink-0 text-[10px] font-black uppercase tracking-[0.18em] text-neutral-500">Player-requested packages</div>
                          <div className="grid min-h-0 flex-1 gap-2 xl:grid-cols-3">
                            {askPackages.map((pkg) => {
                              const id = pkg.askPackageId || pkg.packageId;
                              const active = String(id) === String(selectedPackage?.askPackageId || selectedPackage?.packageId);
                              return (
                                <button
                                  type="button"
                                  key={id}
                                  onClick={() => setSelectedPackageId(id)}
                                  className={`flex min-h-0 flex-col rounded-2xl border p-2.5 text-left transition ${active ? "border-orange-400 bg-orange-500/15" : "border-white/10 bg-black/25 hover:border-white/25"}`}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-black text-white">{pkg.label || `${pkg.years}-year package`}</div>
                                      <div className="mt-1 text-xs text-neutral-500">{pkg.years} years · {optionLabel(pkg.optionType)}</div>
                                    </div>
                                    <div className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[10px] font-black uppercase text-neutral-300">
                                      AAV {compactMoney(packageAav(pkg))}
                                    </div>
                                  </div>
                                  <div className="mt-1.5 text-lg font-black">{compactMoney(packageTotal(pkg))}</div>
                                  <div className="mt-0.5 text-[10px] text-neutral-400">First year {compactMoney(pkg.firstYearSalary)} · {pkg.annualRaisePct}% raises</div>
                                  <div className="mt-auto flex flex-wrap gap-1 pt-2">
                                    {(pkg.salaryByYear || []).map((salary, index) => (
                                      <div key={`${id}-${index}`} className="rounded-md bg-black/30 px-1.5 py-1 text-center">
                                        <span className="text-[8px] text-neutral-500">{Number(selectedRow.extensionStartYear) + index} </span>
                                        <span className="text-[10px] font-black">{compactMoney(salary)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {selectedRow.eligible && selectedPackage && (
                    <div className="shrink-0 border-t border-orange-400/20 bg-neutral-950/95 px-3 py-2 shadow-[0_-16px_40px_rgba(0,0,0,0.35)]">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">Selected Ask</div>
                          <div className="mt-0.5 text-lg font-black">
                            {selectedPackage.years} years · {compactMoney(packageTotal(selectedPackage))}
                          </div>
                          <div className="mt-0.5 text-xs text-neutral-400">
                            {compactMoney(packageAav(selectedPackage))} AAV · {optionLabel(selectedPackage.optionType)} · begins {selectedRow.extensionStartYear}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={submitting || !preview?.state?.isOpen}
                          onClick={submitOffer}
                          className="rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-black text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {submitting ? "Submitting…" : "Offer Extension"}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </PageFade>
  );
}
