import { getCanonicalPlayer, formatPlayerHeight } from "../utils/playerResolver.js";
import PlayerCardModal from "../components/PlayerCardModal.jsx";
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext.jsx";
import {
  previewContractExtensions,
  processCpuContractExtensions,
  submitContractExtensionOffer,
} from "../api/simEnginePy.js";
import PageFade from "../components/PageFade.jsx";
import RuntimePlayerPortrait from "../components/RuntimePlayerPortrait.jsx";
import PlayerRatingRing from "../components/PlayerRatingRing.jsx";
import { CONTRACT_EXTENSIONS_LAYOUT } from "../config/contractExtensionsLayout.js";
import { CONTRACT_EXTENSIONS_TEXT_LAYOUT } from "../config/contractExtensionsTextLayout.js";
import { playSound, primeSound, SOUND_KEYS } from "../audio/soundManager.js";
import { getOffseasonTradeContext } from "../utils/offseasonTradeContext.js";
import { getSeasonCalendarConfig } from "../utils/seasonContext.js";
import { getUserTradeCurrentDate, stampExtensionRestriction } from "../utils/userTradeRules.js";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";
import "./ContractExtensions.css";

const EXTENSION_DEADLINE_CONTEXT_KEY = "bm_contract_extension_deadline_context_v1";
const CE_LAYOUT = CONTRACT_EXTENSIONS_LAYOUT;
const CE_TEXT = CONTRACT_EXTENSIONS_TEXT_LAYOUT;



function extensionSourcePlayer(team, row) {
  const players = Array.isArray(team?.players) ? team.players : [];
  const rowId = String(row?.playerId ?? "");
  const rowName = String(row?.playerName || "").trim().toLowerCase();
  return players.find((player) => {
    if (rowId && String(player?.id ?? player?.playerId ?? "") === rowId) return true;
    return rowName && String(player?.name || player?.player || "").trim().toLowerCase() === rowName;
  }) || null;
}

function extensionHeadshotOf(player, row) {
  return (
    player?.headshot ||
    player?.headshotUrl ||
    player?.photoUrl ||
    player?.portrait ||
    player?.image ||
    player?.img ||
    row?.headshot ||
    ""
  );
}

function extensionTeamLogoOf(team) {
  return (
    team?.logo ||
    team?.teamLogo ||
    team?.newTeamLogo ||
    team?.logoUrl ||
    team?.image ||
    team?.img ||
    ""
  );
}

function extensionVisualTeam(leagueData, selectedTeam) {
  const selectedName = String(selectedTeam?.name || selectedTeam?.teamName || "").trim().toLowerCase();
  if (!selectedName) return selectedTeam || null;

  const teams = Array.isArray(leagueData?.teams)
    ? leagueData.teams
    : leagueData?.conferences
      ? Object.values(leagueData.conferences).flat().filter(Boolean)
      : [];

  return (
    teams.find((team) =>
      String(team?.name || team?.teamName || "").trim().toLowerCase() === selectedName
    ) ||
    selectedTeam ||
    null
  );
}

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

const EXTENSION_FACTOR_DEFS = [
  { key: "roleFit", label: "Role", icon: "▣" },
  { key: "security", label: "Security", icon: "◇" },
  { key: "teamDirection", label: "Team Direction", icon: "↗" },
  { key: "franchiseRelationship", label: "Franchise Relationship", icon: "◎" },
  { key: "freeAgencyLeverage", label: "Free Agency Leverage", icon: "★" },
];

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function parseIsoUtc(value) {
  const text = normalizeIsoDate(value);
  if (!text) return null;
  const [year, month, day] = text.split("-").map(Number);
  const stamp = Date.UTC(year, month - 1, day);
  return Number.isFinite(stamp) ? stamp : null;
}

function formatExtensionDate(value, { compact = false } = {}) {
  const stamp = parseIsoUtc(value);
  if (stamp == null) return "—";
  const date = new Date(stamp);
  if (compact) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function negotiationWindowState(leagueData, selectedRow, deadlineContext) {
  const currentDate = currentLeagueDate(leagueData, deadlineContext);
  const deadlineDate = normalizeIsoDate(selectedRow?.deadlineDate);
  const calendar = getSeasonCalendarConfig(leagueData || {});
  const startDate = normalizeIsoDate(calendar?.regularSeasonStart) || currentDate;

  const start = parseIsoUtc(startDate);
  const current = parseIsoUtc(currentDate);
  const deadline = parseIsoUtc(deadlineDate);

  let progress = 0;
  if (start != null && current != null && deadline != null && deadline > start) {
    progress = clampNumber(((current - start) / (deadline - start)) * 100, 0, 100);
  }

  return { currentDate, deadlineDate, startDate, progress };
}

function extensionFactorVisual(component = {}) {
  const impact = Number(component?.impact);
  const minImpact = Number(component?.minImpact);
  const maxImpact = Number(component?.maxImpact);
  const validImpact = Number.isFinite(impact) ? impact : 0;
  const validMin = Number.isFinite(minImpact) ? minImpact : -5;
  const validMax = Number.isFinite(maxImpact) && maxImpact > validMin ? maxImpact : 5;
  const pct = clampNumber(((validImpact - validMin) / (validMax - validMin)) * 100, 0, 100);

  let label = "Neutral";
  let tone = "neutral";
  if (validImpact >= 2.5) {
    label = "Strong";
    tone = "positive";
  } else if (validImpact >= 0.75) {
    label = "Positive";
    tone = "positive";
  } else if (validImpact <= -5) {
    label = "Strong concern";
    tone = "negative";
  } else if (validImpact <= -0.75) {
    label = "Concern";
    tone = "warning";
  }

  return { impact: validImpact, pct, label, tone };
}

function signedImpact(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) < 0.05) return "0.0";
  return `${number > 0 ? "+" : ""}${number.toFixed(1)}`;
}

function extensionDisplayStatus(row) {
  if (row?.eligible) {
    return { code: "eligible", title: "Extension Talks Open", label: "Has Interest", pillClass: "is-interest" };
  }
  if (row?.playerRefusesExtension) {
    return { code: "not_interested", title: "Not Interested", label: "Not Interested", pillClass: "is-waiting" };
  }

  const code = String(row?.displayStatusCode || "ineligible");
  const title = row?.displayStatusTitle || (row?.alreadyExtended ? "Contract Extended" : "Ineligible");
  const label = row?.displayStatusLabel || (row?.alreadyExtended ? "Contract Extended" : "Ineligible");
  return {
    code,
    title,
    label,
    pillClass: code === "already_extended" || row?.alreadyExtended ? "is-extended" : "is-ineligible",
  };
}

function optionPreviewLabel(row) {
  const option = row?.primaryUnresolvedOption;
  if (!option) return null;
  const year = option?.displayYear || "Future";
  return `${year} ${option?.label || "Contract Option"}`;
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
  if (row?.alreadyExtended || row?.displayStatusCode === "already_extended") return 2;
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
  const [playerCardOpen, setPlayerCardOpen] = useState(false);

  const teamName = selectedTeam?.name || null;
  const visualTeam = useMemo(() => extensionVisualTeam(leagueData, selectedTeam), [leagueData, selectedTeam]);
  const visualTeamLogo = extensionTeamLogoOf(visualTeam) || extensionTeamLogoOf(selectedTeam);
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

  const selectedPlayer = useMemo(() => getCanonicalPlayer(leagueData, selectedRow), [leagueData, selectedRow]);
  const negotiationWindow = useMemo(
    () => negotiationWindowState(leagueData, selectedRow, deadlineContext),
    [leagueData, selectedRow?.deadlineDate, deadlineContext]
  );
  const extensionFactors = useMemo(() => {
    const components =
      selectedRow?.extensionInterestComponents && typeof selectedRow.extensionInterestComponents === "object"
        ? selectedRow.extensionInterestComponents
        : {};
    const reasons = Array.isArray(selectedRow?.extensionInterestReasons) ? selectedRow.extensionInterestReasons : [];

    return EXTENSION_FACTOR_DEFS.map((definition) => {
      const direct = components?.[definition.key];
      const reason = reasons.find((row) =>
        String(row?.label || "").toLowerCase() === String(definition.label || "").toLowerCase()
      );
      const component = direct && typeof direct === "object"
        ? direct
        : reason
          ? {
              impact: reason.impact,
              minImpact: -5,
              maxImpact: 5,
              detail: reason.detail,
            }
          : {};
      return {
        ...definition,
        component,
        visual: extensionFactorVisual(component),
        detail: component?.detail || reason?.detail || "This factor contributes to extension interest.",
      };
    });
  }, [selectedRow]);
  const askPackages = selectedRow?.askPackages || [];
  const selectedPackage = useMemo(
    () => askPackages.find((pkg) => String(pkg.askPackageId || pkg.packageId) === String(selectedPackageId)) || askPackages[0] || null,
    [askPackages, selectedPackageId]
  );
  const projectedSalaries = selectedPackage?.salaryByYear || [];
  const refusingCount = useMemo(() => (preview?.players || []).filter((row) => row?.playerRefusesExtension).length, [preview]);
  const orderedExtensionPlayers = useMemo(() => sortExtensionRows(preview?.players || []), [preview]);
  const extensionSummary = useMemo(() => {
    const candidates = (preview?.players || []).filter((row) => row?.eligible || row?.playerRefusesExtension);
    return {
      eligibleLikeCount: candidates.length,
      rookieCount: candidates.filter((row) => row?.extensionType === "rookie_scale" || row?.deadlineType === "rookie").length,
      veteranCount: candidates.filter((row) => row?.extensionType === "veteran" || row?.deadlineType === "veteran").length,
    };
  }, [preview]);

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
    primeSound(SOUND_KEYS.PLAYER_TRANSACTION_SUCCESS);
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
      if (result.accepted) {
        playSound(SOUND_KEYS.PLAYER_TRANSACTION_SUCCESS);
      }
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
        <PlayerCardModal open={playerCardOpen} player={selectedPlayer} team={selectedTeam} leagueData={leagueData} onClose={() => setPlayerCardOpen(false)} />
    </PageFade>
    );
  }

  return (
    <PageFade>
      <div className="bm-page-bg ce-page min-h-screen overflow-hidden bg-neutral-950 text-white">
        <div className="ce-shell mx-auto flex h-[calc(100vh-50px)] max-w-[1600px] flex-col">
          <header className="ce-page-header">
            <div className="ce-page-heading">
              <div className="ce-eyebrow">Front Office</div>
              <h1>Contract Extensions</h1>
            </div>
          </header>

          {notice && (
            <div className={`ce-notice ${notice.type === "success" ? "ce-notice-success" : notice.type === "warning" ? "ce-notice-warning" : "ce-notice-error"}`}>
              {notice.text}
            </div>
          )}

          <div className="ce-workspace">
            <section className="ce-candidate-panel">
              <div className="ce-summary-grid">
                <div className="ce-summary-card"><strong>{extensionSummary.eligibleLikeCount ?? "—"}</strong><span>Eligible</span></div>
                <div className="ce-summary-card"><strong>{extensionSummary.rookieCount ?? "—"}</strong><span>Rookie</span></div>
                <div className="ce-summary-card"><strong>{extensionSummary.veteranCount ?? "—"}</strong><span>Veteran</span></div>
              </div>

              <div className="contract-extension-orange-scrollbar ce-candidate-scroll">
                {loading ? (
                  <div className="ce-loading">Loading extension eligibility…</div>
                ) : (
                  <div className="ce-candidate-list">
                    {orderedExtensionPlayers.map((row) => {
                      const key = row.playerId || row.playerName;
                      const active = String(key) === String(selectedPlayerId);
                      const portraitPlayer = extensionSourcePlayer(selectedTeam, row) || {
                        id: row.playerId,
                        name: row.playerName,
                        overall: row.overall,
                        potential: row.potential,
                      };
                      return (
                        <button
                          type="button"
                          key={key}
                          data-bm-sfx-ui-nav="true"
                          onClick={() => setSelectedPlayerId(key)}
                          className={`ce-candidate-row ${active ? "is-selected" : ""}`}
                        >
                          {visualTeamLogo ? (
                            <img
                              className="ce-candidate-watermark"
                              src={visualTeamLogo}
                              alt=""
                              aria-hidden="true"
                              style={{
                                left: `calc(50% + ${CE_LAYOUT.playerList.teamLogo?.x ?? 0}px)`,
                                top: `calc(50% + ${CE_LAYOUT.playerList.teamLogo?.y ?? 0}px)`,
                                opacity: CE_LAYOUT.playerList.teamLogo?.opacity ?? 0.05,
                                transform: `translate(-50%, -50%) scale(${CE_LAYOUT.playerList.teamLogo?.scale ?? 1})`,
                                transformOrigin: "center",
                              }}
                            />
                          ) : null}
                          <div className="ce-candidate-portrait">
                            <div
                              className="ce-candidate-portrait-stage"
                              style={{
                                transform: `translate(${CE_LAYOUT.playerList.headshot.x}px, ${CE_LAYOUT.playerList.headshot.y}px) scale(${CE_LAYOUT.playerList.headshot.scale})`,
                              }}
                            >
                              <RuntimePlayerPortrait
                                player={portraitPlayer}
                                team={selectedTeam}
                                teamName={teamName}
                                src={extensionHeadshotOf(portraitPlayer, row)}
                                alt={row.playerName}
                                layoutPage="salary-table"
                                className="h-full w-full object-contain object-bottom"
                                fallback={<div className="h-full w-full" />}
                              />
                            </div>
                          </div>
                          <div
                            className="ce-candidate-rating-stage"
                            style={{
                              transform: `translate(${CE_LAYOUT.playerList.overallRing.x}px, ${CE_LAYOUT.playerList.overallRing.y}px) scale(${CE_LAYOUT.playerList.overallRing.scale})`,
                              "--ce-ring-ovr-label-size": `${CE_LAYOUT.playerList.overallRing.ovrLabelSize ?? 6}px`,
                              "--ce-ring-ovr-label-x": `${CE_LAYOUT.playerList.overallRing.ovrLabelX ?? 0}px`,
                              "--ce-ring-ovr-label-y": `${CE_LAYOUT.playerList.overallRing.ovrLabelY ?? -1}px`,
                              "--ce-ring-ovr-number-size": `${CE_LAYOUT.playerList.overallRing.ovrNumberSize ?? 17}px`,
                              "--ce-ring-ovr-number-x": `${CE_LAYOUT.playerList.overallRing.ovrNumberX ?? 0}px`,
                              "--ce-ring-ovr-number-y": `${CE_LAYOUT.playerList.overallRing.ovrNumberY ?? 0}px`,
                              "--ce-ring-pot-size": `${CE_LAYOUT.playerList.overallRing.potSize ?? 6}px`,
                              "--ce-ring-pot-x": `${CE_LAYOUT.playerList.overallRing.potX ?? 0}px`,
                              "--ce-ring-pot-y": `${CE_LAYOUT.playerList.overallRing.potY ?? 1}px`,
                            }}
                          >
                            <PlayerRatingRing
                              overall={row.overall}
                              potential={row.potential}
                              size={50}
                              strokeWidth={4}
                              className="ce-candidate-rating"
                            />
                          </div>
                          <div
                            className="ce-candidate-copy"
                            style={{
                              transform: `translate(${CE_TEXT.playerList.box.x}px, ${CE_TEXT.playerList.box.y}px) scale(${CE_TEXT.playerList.box.scale})`,
                              transformOrigin: "left center",
                            }}
                          >
                            <strong
                              style={{
                                fontSize: `${CE_TEXT.playerList.name.size}px`,
                                transform: `translate(${CE_TEXT.playerList.name.x}px, ${CE_TEXT.playerList.name.y}px)`,
                                transformOrigin: "left center",
                              }}
                            >
                              {row.playerName}
                            </strong>
                            <div
                              className="ce-candidate-meta"
                              style={{
                                fontSize: `${CE_TEXT.playerList.meta.size}px`,
                                transform: `translate(${CE_TEXT.playerList.meta.x}px, ${CE_TEXT.playerList.meta.y}px)`,
                                transformOrigin: "left center",
                              }}
                            >
                              <span>{portraitPlayer?.pos || row?.position || row?.pos || "—"}</span>
                              <span className="ce-meta-divider">|</span>
                              <span>Age {portraitPlayer?.age ?? "—"}</span>
                            </div>
                          </div>
                          {(() => {
                            const status = extensionDisplayStatus(row);
                            const words = String(status.label || "Ineligible").split(" ");
                            return (
                              <span className={`ce-status-pill ${status.pillClass}`}>
                                {words.length > 1 ? <>{words.slice(0, -1).join(" ")}<br />{words[words.length - 1]}</> : status.label}
                              </span>
                            );
                          })()}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            <section className="ce-detail-panel">
              {!selectedRow ? (
                <div className="ce-empty">Select a player.</div>
              ) : (
                <>
                  <div className="ce-detail-scroll">
                    <div className="ce-player-hero">
                      {visualTeamLogo ? (
                        <img
                          className="ce-player-watermark"
                          src={visualTeamLogo}
                          alt=""
                          aria-hidden="true"
                          style={{
                            left: `calc(-20px + ${CE_LAYOUT.selectedPlayer.teamLogo?.x ?? 0}px)`,
                            top: `calc(50% + ${CE_LAYOUT.selectedPlayer.teamLogo?.y ?? 0}px)`,
                            opacity: CE_LAYOUT.selectedPlayer.teamLogo?.opacity ?? 0.075,
                            transform: `translateY(-50%) scale(${CE_LAYOUT.selectedPlayer.teamLogo?.scale ?? 1})`,
                            transformOrigin: "center",
                          }}
                        />
                      ) : null}
                      <div className="ce-player-identity">
                        <div className="ce-player-portrait">
                          <div
                            className="ce-player-portrait-stage"
                            style={{
                              transform: `translate(${CE_LAYOUT.selectedPlayer.headshot.x}px, ${CE_LAYOUT.selectedPlayer.headshot.y}px) scale(${CE_LAYOUT.selectedPlayer.headshot.scale})`,
                            }}
                          >
                            <RuntimePlayerPortrait
                              player={selectedPlayer || selectedRow}
                              team={selectedTeam}
                              teamName={teamName}
                              src={extensionHeadshotOf(selectedPlayer, selectedRow)}
                              alt={selectedPlayer?.name || selectedRow.playerName}
                              className="h-full w-full object-contain object-bottom"
                              fallback={<div className="h-full w-full" />}
                            />
                          </div>
                        </div>
                        <div
                          className="ce-player-copy"
                          style={{
                            transform: `translate(${CE_TEXT.selectedPlayer.box.x}px, ${CE_TEXT.selectedPlayer.box.y}px) scale(${CE_TEXT.selectedPlayer.box.scale})`,
                            transformOrigin: "left center",
                          }}
                        >
                          <h2
                            style={{
                              fontSize: `${CE_TEXT.selectedPlayer.name.size}px`,
                              transform: `translate(${CE_TEXT.selectedPlayer.name.x}px, ${CE_TEXT.selectedPlayer.name.y}px)`,
                              transformOrigin: "left center",
                            }}
                          >
                            {selectedPlayer?.name || selectedRow.playerName}
                          </h2>
                          <p
                            style={{
                              fontSize: `${CE_TEXT.selectedPlayer.meta.size}px`,
                              transform: `translate(${CE_TEXT.selectedPlayer.meta.x}px, ${CE_TEXT.selectedPlayer.meta.y}px)`,
                              transformOrigin: "left center",
                            }}
                          >
                            {selectedPlayer?.pos || "—"}
                            <span>|</span> Age {selectedPlayer?.age ?? "—"}
                          </p>
                          {!selectedRow.eligible && (selectedRow.displayReason || selectedRow.reason) ? (
                            <div className="ce-player-reason">{selectedRow.displayReason || selectedRow.reason}</div>
                          ) : null}
                        </div>
                      </div>

                      <div className="ce-player-hero-side">
                        <div
                          className="ce-player-rating-stage"
                          style={{
                            transform: `translate(${CE_LAYOUT.selectedPlayer.overallRing.x}px, ${CE_LAYOUT.selectedPlayer.overallRing.y}px) scale(${CE_LAYOUT.selectedPlayer.overallRing.scale})`,
                            "--ce-ring-ovr-label-size": `${CE_LAYOUT.selectedPlayer.overallRing.ovrLabelSize ?? 8}px`,
                            "--ce-ring-ovr-label-x": `${CE_LAYOUT.selectedPlayer.overallRing.ovrLabelX ?? 0}px`,
                            "--ce-ring-ovr-label-y": `${CE_LAYOUT.selectedPlayer.overallRing.ovrLabelY ?? 0}px`,
                            "--ce-ring-ovr-number-size": `${CE_LAYOUT.selectedPlayer.overallRing.ovrNumberSize ?? 26}px`,
                            "--ce-ring-ovr-number-x": `${CE_LAYOUT.selectedPlayer.overallRing.ovrNumberX ?? 0}px`,
                            "--ce-ring-ovr-number-y": `${CE_LAYOUT.selectedPlayer.overallRing.ovrNumberY ?? 0}px`,
                            "--ce-ring-pot-size": `${CE_LAYOUT.selectedPlayer.overallRing.potSize ?? 8}px`,
                            "--ce-ring-pot-x": `${CE_LAYOUT.selectedPlayer.overallRing.potX ?? 0}px`,
                            "--ce-ring-pot-y": `${CE_LAYOUT.selectedPlayer.overallRing.potY ?? 0}px`,
                          }}
                        >
                          <PlayerRatingRing
                            overall={selectedPlayer?.overall ?? selectedRow?.overall}
                            potential={selectedPlayer?.potential ?? selectedRow?.potential}
                            size={76}
                            strokeWidth={6}
                            className="ce-player-rating"
                          />
                        </div>
                        <div className="ce-player-camp">
                          <div className="ce-player-camp-label">Player Camp</div>
                          {(() => {
                            const status = extensionDisplayStatus(selectedRow);
                            return (
                              <div className={`ce-player-camp-status ${interestTone(selectedRow.interestLabel || selectedRow.extensionInterestLabel || selectedRow.displayReason || selectedRow.reason)}`}>
                                <span className="ce-flame" aria-hidden="true">●</span>
                                {status.label}
                              </div>
                            );
                          })()}
                          {selectedRow.extensionInterestScore != null && (
                            <div className="ce-player-camp-meta">Interest {selectedRow.extensionInterestScore}/100 · Mood {selectedRow.extensionMoodScore ?? "—"}</div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="ce-info-grid">
                      <div className="ce-info-card">
                        <div className="ce-info-icon" aria-hidden="true">▤</div>
                        <div><span>Current Contract</span><strong>{selectedRow.remainingContractYears ?? selectedRow.currentContract?.salaryByYear?.length ?? 0} years left</strong><small>Ends {selectedRow.currentContractEndDisplayYear ?? (selectedRow.currentContractEndYear != null ? Number(selectedRow.currentContractEndYear) + 1 : "—")}</small></div>
                      </div>
                      <div className="ce-info-card">
                        <div className="ce-info-icon" aria-hidden="true">◇</div>
                        <div><span>Extension Type</span><strong>{extensionTypeLabel(selectedRow.extensionType)}</strong><small>Starts {selectedRow.extensionStartDisplayYear ?? (selectedRow.extensionStartYear != null ? Number(selectedRow.extensionStartYear) + 1 : "—")}</small></div>
                      </div>
                      <div className="ce-info-card">
                        <div className="ce-info-icon" aria-hidden="true">▥</div>
                        <div><span>Projected Market</span><strong>{compactMoney(selectedRow.marketValue?.expectedAAV)}</strong><small>Expected AAV</small></div>
                      </div>
                      <div className="ce-info-card">
                        <div className="ce-info-icon" aria-hidden="true">□</div>
                        <div><span>Deadline</span><strong>{selectedRow.deadlineType === "rookie" ? "Rookie" : selectedRow.deadlineType === "veteran" ? "Veteran" : "—"}</strong><small>{selectedRow.displayDeadlineDate || (selectedRow.deadlineType ? selectedRow.deadlineDate : null) || "—"}</small></div>
                      </div>
                    </div>

                    {!selectedRow.eligible ? (
                      selectedRow.playerRefusesExtension ? (
                        <div className="ce-wait-dashboard">
                          <div className="ce-wait-top-grid">
                            <section className="ce-interest-status-card">
                              <div className="ce-wait-card-kicker">Extension status</div>
                              <div className="ce-interest-title-row">
                                <div>
                                  <h3>Not Interested</h3>
                                  <p>{selectedRow.reason}</p>
                                </div>
                                <span className="ce-negotiation-lock-pill">Not willing to negotiate</span>
                              </div>

                              <div className="ce-interest-meter-block">
                                <div className="ce-interest-meter-head">
                                  <span>Interest level</span>
                                  <strong>
                                    <b>{selectedRow.extensionInterestScore ?? "—"}</b>
                                    <em>/100</em>
                                  </strong>
                                </div>
                                <div className="ce-interest-track" aria-label={`Extension interest ${selectedRow.extensionInterestScore ?? 0} out of 100`}>
                                  <span
                                    className="ce-interest-fill"
                                    style={{ width: `${clampNumber(selectedRow.extensionInterestScore ?? 0, 0, 100)}%` }}
                                  />
                                  <span
                                    className="ce-interest-threshold"
                                    style={{ left: `${clampNumber(selectedRow.extensionInterestRequired ?? 70, 0, 100)}%` }}
                                  />
                                </div>
                                <div className="ce-interest-meter-foot">
                                  <span>{selectedRow.extensionInterestLabel || "Prefers to Wait"}</span>
                                  <strong>{selectedRow.extensionInterestRequired ?? 70}+ needed to negotiate</strong>
                                </div>
                              </div>
                            </section>

                            <section className="ce-negotiation-window-card">
                              <div className="ce-window-heading">
                                <div>
                                  <div className="ce-wait-card-kicker">Negotiation window</div>
                                  <strong>{formatExtensionDate(negotiationWindow.deadlineDate)}</strong>
                                </div>
                                <span>{selectedRow.deadlineType === "rookie" ? "Rookie Extension Deadline" : "Veteran Extension Deadline"}</span>
                              </div>

                              <div className="ce-window-track-wrap">
                                <div className="ce-window-track">
                                  <span className="ce-window-progress" style={{ width: `${negotiationWindow.progress}%` }} />
                                  <span className="ce-window-now-dot" style={{ left: `${negotiationWindow.progress}%` }} />
                                  <span className="ce-window-milestone is-start" />
                                  <span className="ce-window-milestone is-mid" />
                                  <span className="ce-window-milestone is-late" />
                                  <span className="ce-window-milestone is-end" />
                                </div>
                                <div className="ce-window-labels">
                                  <span>Start</span>
                                  <span>Mid season</span>
                                  <span>Pre-deadline</span>
                                  <span>Deadline</span>
                                </div>
                              </div>

                              <div className="ce-window-now-row">
                                <span>Current league date</span>
                                <strong>{formatExtensionDate(negotiationWindow.currentDate, { compact: true })}</strong>
                              </div>

                              <div className="ce-window-note">
                                This timeline follows the live league date. Interest only changes when the existing extension and player-context systems change it.
                              </div>
                            </section>
                          </div>

                          <section className="ce-factor-section">
                            <div className="ce-factor-heading">
                              <div>
                                <div className="ce-wait-card-kicker">What affects interest?</div>
                                <p>These are read-only views of the real factors already used by the extension-interest calculation.</p>
                              </div>
                              <span>Impact on extension interest</span>
                            </div>

                            <div className="ce-factor-grid">
                              {extensionFactors.map((factor) => (
                                <article className="ce-factor-card" key={factor.key}>
                                  <div className="ce-factor-title-row">
                                    <span className="ce-factor-icon" aria-hidden="true">{factor.icon}</span>
                                    <strong>{factor.label}</strong>
                                    <em className={`is-${factor.visual.tone}`}>{factor.visual.label}</em>
                                  </div>
                                  <div className="ce-factor-meter">
                                    <span style={{ width: `${factor.visual.pct}%` }} />
                                  </div>
                                  <div className="ce-factor-impact">
                                    <span>Interest impact</span>
                                    <strong className={factor.visual.impact > 0 ? "is-positive" : factor.visual.impact < 0 ? "is-negative" : ""}>
                                      {signedImpact(factor.visual.impact)}
                                    </strong>
                                  </div>
                                  <p>{factor.detail}</p>
                                </article>
                              ))}
                            </div>
                          </section>
                        </div>
                      ) : (
                        <div className="ce-ineligible-grid">
                          {(() => {
                            const status = extensionDisplayStatus(selectedRow);
                            const optionLabel = optionPreviewLabel(selectedRow);
                            return (
                              <>
                                <div className="ce-ineligible-card">
                                  <span>Extension status</span>
                                  <strong>{status.title}</strong>
                                  <p>{selectedRow.displayReason || selectedRow.reason}</p>

                                  <div className="ce-ineligible-facts">
                                    {selectedRow.remainingContractYears != null ? (
                                      <div>
                                        <span>Contract timing</span>
                                        <strong>{selectedRow.remainingContractYears} {Number(selectedRow.remainingContractYears) === 1 ? "season" : "seasons"} remaining</strong>
                                      </div>
                                    ) : null}
                                    {optionLabel ? (
                                      <div>
                                        <span>Unresolved option</span>
                                        <strong>{optionLabel}</strong>
                                      </div>
                                    ) : null}
                                    {selectedRow.displayEligibleNextSeason ? (
                                      <div>
                                        <span>Next check</span>
                                        <strong>Next season</strong>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>

                                <div className="ce-ineligible-card ce-ineligible-note">
                                  <span>Front office guidance</span>
                                  <strong>{status.code === "already_extended" ? "No action needed" : "What this means"}</strong>
                                  <p>{selectedRow.displayNote || "This player does not currently have an extension pathway available."}</p>
                                  {selectedRow.displayDeadlineDate ? (
                                    <div className="ce-ineligible-deadline">
                                      <span>Applicable deadline</span>
                                      <strong>{formatExtensionDate(selectedRow.displayDeadlineDate)}</strong>
                                    </div>
                                  ) : null}
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      )
                    ) : (
                      <div className="ce-package-section">
                        <div className="ce-package-heading-row">
                          <div className="ce-section-title">Player-requested packages</div>
                          <div className="ce-package-year-heads" aria-hidden="true">
                            {Array.from({ length: 4 }, (_, index) => (
                              <span key={`package-year-head-${index}`}>
                                {Number(selectedRow.extensionStartDisplayYear ?? (Number(selectedRow.extensionStartYear) + 1)) + index}
                              </span>
                            ))}
                          </div>
                          <div className="ce-package-aav-head" aria-hidden="true">AAV</div>
                        </div>
                        <div className="ce-package-list">
                          {askPackages.map((pkg) => {
                            const id = pkg.askPackageId || pkg.packageId;
                            const active = String(id) === String(selectedPackage?.askPackageId || selectedPackage?.packageId);
                            const salaryByYear = Array.isArray(pkg.salaryByYear) ? pkg.salaryByYear : [];
                            return (
                              <button
                                type="button"
                                key={id}
                                data-bm-sfx-ui-nav="true"
                                onClick={() => setSelectedPackageId(id)}
                                className={`ce-package-card ${active ? "is-selected" : ""}`}
                              >
                                <span className="ce-package-radio" aria-hidden="true"><span /></span>
                                <div className="ce-package-summary">
                                  <span>{pkg.years}-Year Extension</span>
                                  <strong>{compactMoney(packageTotal(pkg))}</strong>
                                </div>
                                <div className="ce-package-years">
                                  {Array.from({ length: 4 }, (_, index) => {
                                    const salary = salaryByYear[index];
                                    const hasSalary = Number.isFinite(Number(salary));
                                    return (
                                      <div key={`${id}-${index}`} className={`ce-year-cell ${hasSalary ? "" : "is-empty"}`}>
                                        <strong>{hasSalary ? compactMoney(salary) : "—"}</strong>
                                      </div>
                                    );
                                  })}
                                </div>
                                <div className="ce-aav-box"><strong>{compactMoney(packageAav(pkg))}</strong></div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {selectedRow.eligible && selectedPackage && (
                    <div className="ce-selected-bar">
                      <div className="ce-selected-icon" aria-hidden="true">▤</div>
                      <div className="ce-selected-copy">
                        <span>Selected Ask</span>
                        <strong>{selectedPackage.years} years · {compactMoney(packageTotal(selectedPackage))}</strong>
                        <small>{compactMoney(packageAav(selectedPackage))} AAV · begins {selectedRow.extensionStartDisplayYear ?? (Number(selectedRow.extensionStartYear) + 1)}</small>
                      </div>
                      <button
                        type="button"
                        disabled={submitting || !preview?.state?.isOpen}
                        onClick={submitOffer}
                        className="ce-offer-button"
                      >
                        <span aria-hidden="true">➤</span>
                        {submitting ? "Submitting…" : "Offer Extension"}
                      </button>
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
