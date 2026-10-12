// League Intel Phase 2. Read-only scouting; CPU/simulation/trade rules untouched.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { playSound, SOUND_KEYS } from "../audio/soundManager.js";
import { explainIntelEvidence } from "../utils/teamIntelEvidenceExplanation.js";
import { LEAGUE_INTEL_LAYOUT, leagueIntelTuningVars, leagueIntelRingStrokeWidth, fitIntelStarterNameScale } from "../config/leagueIntelLayout.js";
import PlayerRatingRing from "../components/PlayerRatingRing.jsx";
import PageFade from "../components/PageFade";
import RuntimePlayerPortrait from "../components/RuntimePlayerPortrait.jsx";
import useKeyboardListNavigation from "../utils/useKeyboardListNavigation";
import { buildRecordMap } from "../utils/teamIntel_v1.js";
import { readTradeDeskFeed } from "../utils/tradeDeskFeed.js";
import { presentCpuIntel, scanIntelCpuEvidence, validateCpuIntelDisplay } from "../utils/teamIntelCpuOverlay.js";
import { buildIntelCpuPythonPayload, startIntelCpuPythonProbe } from "../utils/teamIntelPythonProbe.js";
import { resolveIntelLifecycle, intelLiveSignature, intelVisibleDraftPicks } from "../utils/teamIntelLifecycle.js";
import { saveIntelCapture, listIntelCaptures, diffIntelCaptures } from "../utils/teamIntelDiagnostics.js";
import {
  observeLeagueIntel,
  getObservedTeam,
  inspectIntelClaim,
  validateIntelObservation,
} from "../utils/teamIntelObserver.js";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";
import "../styles/BMLeagueIntel.css";

const norm = (x) => String(x ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const money = (amount) => {
  if (!Number.isFinite(Number(amount))) return "—";
  const number = Number(amount);
  const sign = number < 0 ? "−" : "";
  return `${sign}$${(Math.abs(number) / 1e6).toFixed(1)}M`;
};
const formatAge = (age) => age ?? "—";

function readSavedMinutes(teams) {
  // Read-only optional supplement to the observer, consistent with existing
  // gameplan_<team> keys. A stale roster plan must never drive the display.
  const minutesByTeam = {};
  if (typeof localStorage === "undefined") return minutesByTeam;
  for (const team of teams) {
    try {
      const json = localStorage.getItem(`gameplan_${team?.name}`);
      if (!json) continue;
      const saved = JSON.parse(json);
      const minutes = saved?.minutes && typeof saved.minutes === "object" ? saved.minutes : saved;
      if (!minutes || typeof minutes !== "object" || Array.isArray(minutes)) continue;
      const names = new Set((team?.players || []).map((p) => p.name || p.player).filter(Boolean));
      if (!Object.keys(minutes).length || Object.keys(minutes).some((name) => !names.has(name) || !Number.isFinite(Number(minutes[name])))) continue;
      minutesByTeam[team.name] = minutes;
    } catch {
      // Never repair storage, generate gameplans, or change saved rotations.
    }
  }
  return minutesByTeam;
}

function liveTeamsOf(leagueData) {
  return Array.isArray(leagueData?.teams) ? leagueData.teams : Object.values(leagueData?.conferences || {}).flatMap((v) => Array.isArray(v) ? v : []);
}

function PanelTitle({ icon, children, sub, aside }) {
  return <div className="bm-il-panel-heading">
    <div className="bm-il-panel-title"><span aria-hidden="true" className="bm-il-panel-icon">{icon}</span><div className="bm-il-panel-label">{children}</div></div>
    {aside}
    {sub && <p className="bm-il-subtitle">{sub}</p>}
  </div>;
}

// Reuse Roster View's exact OVR + POT ring (including its orange SVG gradient).
// Compact placement is Intel-only; do not modify the shared component or
// the saved roster/player data to render a missing potential.
function OverallRing({ rating, potential, size = "sm", section = "scoutingRows" }) {
  const px = size === "lg" ? 76 : 48;
  return <span className={`bm-il-rating-ring bm-il-rating-ring--${size}`}>
    <PlayerRatingRing
      overall={rating}
      potential={potential}
      size={px}
      strokeWidth={leagueIntelRingStrokeWidth(section)}
      className="bm-il-rating-component"
    />
  </span>;
}

function pickOriginLogo(pickRow, leagueData, liveTeams) {
  const pickId = pickRow?.id || pickRow?.pickId;
  const savedPick = pickId != null ? (leagueData?.draftPicks || []).find((pick) =>
    String(pick.id || pick.pickId) === String(pickId)) : null;
  // Only the actual originating franchise determines the watermark, never the
  // current owner. Falls back to the already-visible pick label for old saves.
  const original = savedPick?.originalTeam || savedPick?.originalTeamName ||
    pickRow?.originalTeam || pickRow?.originalTeamName ||
    String(pickRow?.name || pickRow?.label || "").split(" · ").at(-1).replace(/\s*\([^)]*\)\s*$/, "");
  return liveTeams.find((team) => norm(team.name) === norm(original))?.logo || "";
}

function targetSourceLogo(row, liveTeams) {
  const teamName = row?.sourceTeam || row?.sourceTeamName || row?.teamName || row?.team || "";
  return liveTeams.find((team) => norm(team.name) === norm(teamName))?.logo || "";
}

function Portrait({ row, liveTeams, size = "mini", sourceTeam }) {
  const actualName = sourceTeam || row?.sourceTeam || row?.teamName || "";
  const liveTeam = liveTeams.find((team) => norm(team.name) === norm(actualName));
  const actualPlayer = (liveTeam?.players || []).find((p) => (p.id != null && row.id != null && String(p.id) === String(row.id)) || norm(p.name || p.player) === norm(row?.name));
  return <div className={`bm-il-portrait bm-il-portrait--${size}`}>
    <RuntimePlayerPortrait player={actualPlayer || row || {}} teamName={actualName} src={row?.headshot || ""} alt={row?.name || "Player portrait"} layoutPage="intel" className="bm-il-portrait-image" fallback={<span className="bm-il-portrait-fallback">NBA</span>} />
  </div>;
}

function TeamSelector({ team, index, active, onClick }) {
  return <button type="button" className={`bm-il-team-row ${active ? "is-active" : ""}`} data-bm-intel-row-index={index} onClick={onClick} aria-pressed={active}>
    <span className="bm-il-team-logo">{team.logo ? <img src={team.logo} alt="" /> : "BM"}</span>
    <span className="bm-il-team-details"><strong>{team.name}</strong><small>{team.phase.slice(0, 4).toUpperCase()} · {team.conference || "NBA"} #{team.standing?.conferenceRank || "—"}</small></span>
    <span className="bm-il-team-rank">#{team.standing?.overallRank ?? "—"}</span>
  </button>;
}

// The name strip has a true centre anchor. Long names are measured against
// their own card and uniformly shrunk so they never wrap or disappear at
// laptop widths. Does not touch shared portrait or ring components.
function StarterName({ name }) {
  const footerRef = useRef(null);
  const textRef = useRef(null);
  const [fitScale, setFitScale] = useState(1);
  const manualScale = Math.max(0.1, Number(LEAGUE_INTEL_LAYOUT.starters.name?.scale) || 1);
  useEffect(() => {
    const footer = footerRef.current;
    const text = textRef.current;
    if (!footer || !text) return undefined;
    let active = true;
    const fit = () => {
      if (!active) return;
      const style = window.getComputedStyle(footer);
      const freeWidth = Math.max(1,
        footer.clientWidth - (parseFloat(style.paddingLeft) || 0) -
        (parseFloat(style.paddingRight) || 0) - 4);
      // scrollWidth is the untransformed full text width: it remains stable
      // even when the visible name is scaled to fit its narrow card.
      const naturalWidth = Math.max(1, text.scrollWidth);
      const next = fitIntelStarterNameScale(freeWidth, naturalWidth, manualScale);
      setFitScale((previous) => Math.abs(previous - next) > 0.002 ? next : previous);
    };
    fit();
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    resizeObserver?.observe(footer);
    resizeObserver?.observe(text);
    window.addEventListener("resize", fit);
    // Web fonts may finish loading after first paint and change text width.
    if (document.fonts?.ready) document.fonts.ready.then(fit).catch(() => {});
    return () => {
      active = false;
      resizeObserver?.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [name, manualScale]);
  return <div className="bm-il-starter-foot" ref={footerRef}>
    <strong ref={textRef} title={name} style={{ "--bm-il-starter-name-fit-scale": fitScale, "--bm-il-starter-name-final-scale": fitScale * manualScale }}>{name}</strong>
  </div>;
}

function Starter({ slot, liveTeams, team }) {
  const p = slot.player;
  return <div className="bm-il-starter" data-intel-starter={slot.pos} style={leagueIntelTuningVars("starters")}>
    <span className="bm-il-position">{slot.pos}</span>
    {p ? <>
      <Portrait row={p} liveTeams={liveTeams} size="hero" sourceTeam={team.name} />
      <OverallRing rating={p.overall} potential={p.potential} size="lg" section="starters" />
      <StarterName name={p.name} />
    </> : <div className="bm-il-starter-empty">No eligible player</div>}
  </div>;
}

function MiniPlayer({ row, liveTeams, team, onInspect, source = false, panelTitle = "Scouting", section = "scoutingRows", portraitTeamName = "", needsPlayer = false, showTargetLogo = false }) {
  const teamName = portraitTeamName || (source ? (row.sourceTeam || row.sourceTeamName || row.teamName) : team.name);
  const targetLogo = showTargetLogo ? targetSourceLogo(row, liveTeams) : "";
  return <button type="button" className={`bm-il-mini-player${needsPlayer ? " bm-il-need--split bm-il-need-player-mirror" : ""}${showTargetLogo ? " bm-il-mini-player--target-logo" : ""}`} style={leagueIntelTuningVars(section)} onClick={onInspect} title="Explain why this item is listed" aria-label={`Explain why ${row.name || "this asset"} is shown under ${panelTitle}`}>
    {showTargetLogo && targetLogo ? <span className="bm-il-target-team-logo-bg" aria-hidden="true"><img src={targetLogo} alt="" /></span> : null}
    {row.assetKind === "pick" ? <span className="bm-il-pick-icon">{Number(row.round) === 2 ? "R2" : "R1"}</span> : <><Portrait row={row} liveTeams={liveTeams} size="mini" sourceTeam={teamName} /><OverallRing rating={row.overall} potential={row.potential} section={section} /></>}
    <span className="bm-il-mini-text"><strong>{row.name}</strong><small>{row.assetKind === "pick" ? "Draft right" : <><span className="bm-il-player-position">{row.pos || "—"}</span> · <span className="bm-il-player-age">Age {formatAge(row.age)}</span></>}</small></span>
    <span className="bm-il-evidence-help" aria-hidden="true">?</span>
  </button>;
}

function IntelPlayersPanel({ title, icon, sub, rows, empty, liveTeams, team, onInspect, source = false, aside = null, rumors = [], onInspectRumor = null, section = "scoutingRows", showTargetLogo = false }) {
  const unique = rows.filter((row, index, all) => all.findIndex((p) => (p.id != null && row.id != null ? String(p.id) === String(row.id) : norm(p.name) === norm(row.name))) === index).slice(0, 3);
  return <section className="bm-il-panel bm-il-market-panel">
    <PanelTitle icon={icon} sub={sub} aside={aside}>{title}</PanelTitle>
    {rumors.length > 0 && <button type="button" className="bm-il-rumor-strip" title={rumors[0].headline} onClick={() => onInspectRumor?.(rumors[0])}>TRADE DESK · {rumors[0].headline}</button>}
    <div className="bm-il-mini-list">{unique.length ? unique.map((row, idx) => <MiniPlayer key={`${row.id || row.name}-${idx}`} row={row} team={team} liveTeams={liveTeams} source={source} panelTitle={title} section={section} showTargetLogo={showTargetLogo} onInspect={() => onInspect(row)} />) : <div className="bm-il-empty">{empty}</div>}</div>
  </section>;
}

function FactPanel({ title, icon, sub, children }) {
  return <section className="bm-il-panel bm-il-fact-panel"><PanelTitle icon={icon} sub={sub}>{title}</PanelTitle><div className="bm-il-facts">{children}</div></section>;
}

function EvidenceDialog({ detail, onClose }) {
  useEffect(() => {
    if (!detail) return undefined;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [detail, onClose]);
  if (!detail) return null;
  const { row, title, section, team } = detail;
  const evidence = row?.evidence || { kind: "saved_roster", label: "Current league player/contract record" };
  const explanation = explainIntelEvidence({ row, section, scoutedTeamName: team.name });
  return <div className="bm-il-modal-backdrop" role="presentation" onClick={onClose}>
    <div className="bm-il-modal bm-il-evidence-modal" role="dialog" aria-modal="true" aria-label={`Why ${row.name || row.label || "this asset"} is listed`} onClick={(e) => e.stopPropagation()}>
      <div className="bm-il-modal-top"><span>WHY THIS APPEARS</span><button type="button" onClick={onClose} aria-label="Close explanation">×</button></div>
      <h2>{row.name || row.label || "Intel item"}</h2>
      <p className="bm-il-modal-section">{team.name} · {title}</p>
      <div className="bm-il-modal-evidence bm-il-evidence-explained">
        <strong>{explanation.heading}</strong>
        <p>{explanation.summary}</p>
      </div>
      <p className="bm-il-evidence-confidence">{explanation.confidence}</p>
      <details className="bm-il-evidence-source-details">
        <summary>Source details</summary>
        <p>{evidence.label || "Saved league scouting record."}</p>
        {row.candidateId && <p>Saved bank candidate: <code>{row.candidateId}</code></p>}
        {row.packageId && <p>Hypothetical package: <code>{row.packageId}</code></p>}
      </details>
    </div>
  </div>;
}

function RosterDialog({ team, liveTeams, onClose }) {
  useEffect(() => {
    if (!team) return undefined;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [team, onClose]);
  if (!team) return null;
  const roster = [...team.roster].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
  return <div className="bm-il-modal-backdrop" role="presentation" onClick={onClose}>
    <div className="bm-il-modal bm-il-roster-modal" role="dialog" aria-modal="true" aria-label={`${team.name} full roster`} onClick={(e) => e.stopPropagation()}>
      <div className="bm-il-modal-top"><span>FULL ROSTER · {roster.length} PLAYERS</span><button type="button" onClick={onClose} aria-label="Close roster">×</button></div>
      <h2>{team.name}</h2>
      <p className="bm-il-modal-section">Live roster snapshot · read-only</p>
      <div className="bm-il-roster-rows">{roster.map((row) => <div key={row.id || row.name} className="bm-il-roster-row" style={leagueIntelTuningVars("fullRoster")}><Portrait row={row} sourceTeam={team.name} liveTeams={liveTeams} /><span><strong>{row.name}</strong><small><span className="bm-il-player-position">{row.pos || "—"}</span> · <span className="bm-il-player-age">Age {formatAge(row.age)}</span></small></span><OverallRing rating={row.overall} potential={row.potential} section="fullRoster" /><strong className="bm-il-roster-salary">{money(row.salary)}</strong></div>)}</div>
    </div>
  </div>;
}

function readOnlyConsoleApi(snapshot, leagueData, activeTeamName, market, scan, userTeamName, cpuRuntime, lifecycle, signature, requestRefresh) {
  const summary = () => ({
    version: snapshot.version,
    lifecycle: { mode: lifecycle.mode, stage: lifecycle.stage, seasonYear: lifecycle.seasonYear, payrollYear: lifecycle.payrollYear, draftYear: lifecycle.draftYear, lotteryRevealed: lifecycle.lotteryRevealed, draftInProgress: lifecycle.draftInProgress, scansEnabled: lifecycle.scansEnabled },
    selectedTeam: activeTeamName,
    scoutedTeam: activeTeamName,
    controlledTeam: userTeamName,
    cpuSource: cpuRuntime?.data ? "existing Python CPU models" : cpuRuntime?.loading ? "loading Python CPU models" : cpuRuntime?.error || "unavailable",
    completedTradesInSave: Array.isArray(leagueData?.tradeHistory) ? leagueData.tradeHistory.length : 0,
    recordedCpuCpuTrades: Array.isArray(leagueData?.tradeHistory) ? leagueData.tradeHistory.filter((trade) => trade?.cpuCpuTrade || trade?.source === "cpu_cpu_trade").length : 0,
    observedTeams: snapshot.teams.length,
    bankCandidatesStored: snapshot.bank.candidateCount,
    acceptedRosterMatchingCandidates: snapshot.bank.observedCandidates.length,
    skipped: { ...snapshot.bank.skipped },
    validation: validateIntelObservation(snapshot, leagueData),
  });
  return Object.freeze({
    summary,
    validate: () => {
      const observer = validateIntelObservation(snapshot, leagueData);
      const display = validateCpuIntelDisplay({ market, leagueData, userTeamName });
      return { ...observer, ok: observer.ok && display.ok, issues: [...observer.issues, ...display.issues], market: display };
    },
    team: (name = activeTeamName) => getObservedTeam(snapshot, name),
    sources: () => ({ limitations: [...snapshot.limitations], bank: { ...snapshot.bank, observedCandidates: snapshot.bank.observedCandidates.map((c) => ({ id: c.id, fromTeamName: c.fromTeamName, toTeamName: c.toTeamName, evidence: c.evidence })) } }),
    inspect: (teamName, section, playerName) => inspectIntelClaim(snapshot, teamName, section, playerName),
    capture: (label) => saveIntelCapture(label, { leagueData, observation: snapshot, market, lifecycle,
      controlledTeam: userTeamName, scoutedTeam: activeTeamName, signature }),
    captures: listIntelCaptures,
    diff: diffIntelCaptures,
    refresh: requestRefresh,
    market: () => ({ team: activeTeamName, controlledTeam: userTeamName, lifecycle: { mode: lifecycle.mode, stage: lifecycle.stage, scansEnabled: lifecycle.scansEnabled }, phase: market?.profile, available: market?.available, targets: market?.targets, userAssets: market?.userAssets, userPlayerNeeds: market?.userPlayerNeeds || [], userPickNeeds: market?.userPickNeeds || [], cpuSource: market?.cpuSource || null, cpuRuntime: { loading: Boolean(cpuRuntime?.loading), error: cpuRuntime?.error || null, loaded: Boolean(cpuRuntime?.data) }, rumors: market?.rumors, scanStats: scan?.stats || null, userStats: scan?.userStats || null, scanComplete: Boolean(scan?.complete) }),
    help: () => ['BMIntel.summary()', 'BMIntel.validate()', 'BMIntel.market()',
      'BMIntel.capture("before")', 'BMIntel.refresh()', 'BMIntel.capture("after")',
      'BMIntel.diff("before", "after")', 'BMIntel.captures()',
      'BMIntel.team("Oklahoma City Thunder")', 'BMIntel.sources()'],
  });
}

export default function Intel() {
  const { leagueData, selectedTeam } = useGame();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("all");
  const [activeName, setActiveName] = useState("");
  const [evidenceDetail, setEvidenceDetail] = useState(null);
  const [showRoster, setShowRoster] = useState(false);
  const [feed, setFeed] = useState(() => readTradeDeskFeed());
  const [scanCache, setScanCache] = useState({});
  const scanCacheRef = useRef({});
  const scanTokenRef = useRef(0);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const signatureRef = useRef("");
  const feedSignatureRef = useRef("");
  const lifecycle = useMemo(() => resolveIntelLifecycle(leagueData || {}), [leagueData, refreshRevision]);
  const displayLeague = useMemo(() => {
    if (!leagueData || !lifecycle.inOffseason) return leagueData;
    return { ...leagueData, draftPicks: intelVisibleDraftPicks(leagueData, lifecycle) };
  }, [leagueData, lifecycle, refreshRevision]);
  const cpuInputSignature = useMemo(() => intelLiveSignature(leagueData || {}, lifecycle), [leagueData, lifecycle, refreshRevision]);
  // The game also writes the clock, draft state, and lottery to localStorage.
  // A narrow 4-second read-only fingerprint plus focus/visibility events keeps
  // the display fresh when those change without a React leagueData reference.
  useEffect(() => {
    if (!leagueData) return undefined;
    const tick = () => {
      const next = resolveIntelLifecycle(leagueData);
      const signature = intelLiveSignature(leagueData, next);
      const newestFeed = readTradeDeskFeed();
      const feedSignature = JSON.stringify(newestFeed.map((row) => [row.id, row.date, row.headline, row.type]));
      if (feedSignatureRef.current !== feedSignature) {
        feedSignatureRef.current = feedSignature;
        setFeed(newestFeed);
      }
      if (signatureRef.current !== signature) {
        signatureRef.current = signature;
        setRefreshRevision((revision) => revision + 1);
      }
    };
    tick();
    const interval = setInterval(() => { if (typeof document === "undefined" || !document.hidden) tick(); }, 4000);
    const onVisibility = () => { if (!document.hidden) tick(); };
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("storage", tick);
    return () => { clearInterval(interval); window.removeEventListener("focus", tick); document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("storage", tick); };
  }, [leagueData]);
  const [scanNonce, setScanNonce] = useState(0);
  const [cpuRuntime, setCpuRuntime] = useState({ data: null, loading: false, error: null });
  const liveTeams = useMemo(() => liveTeamsOf(displayLeague), [displayLeague]);
  const observation = useMemo(() => {
    if (!leagueData) return null;
    // Reads existing ResultsV3 and gameplan keys, but does not write to storage.
    const recordsByTeam = buildRecordMap(liveTeams);
    const minutesByTeam = readSavedMinutes(liveTeams);
    return observeLeagueIntel(displayLeague, { recordsByTeam, minutesByTeam, payrollSeasonYear: lifecycle.payrollYear, upcomingFinancialYear: lifecycle.inOffseason });
  }, [displayLeague, liveTeams, refreshRevision, lifecycle.payrollYear]);
  const userTeamName = selectedTeam?.name || "";
  // The original CPU Python candidate boards and valuations remain read-only.
  // Pyodide runs in a separate worker; expensive initialization never blocks UI.
  useEffect(() => {
    if (!leagueData || !observation || !userTeamName) return undefined;
    let ended = false;
    let dispose = () => {};
    setCpuRuntime({ data: null, loading: true, error: null, signature: cpuInputSignature });
    const timer = setTimeout(() => {
      if (ended) return;
      const payload = buildIntelCpuPythonPayload(displayLeague, observation, userTeamName, lifecycle);
      dispose = startIntelCpuPythonProbe(payload, {
        onResult: (data) => { if (!ended) setCpuRuntime({ data, loading: false, error: null, signature: cpuInputSignature }); },
        onError: (error) => { if (!ended) setCpuRuntime({ data: null, loading: false, error: error?.message || String(error), signature: cpuInputSignature }); },
      });
    }, 1200);
    return () => { ended = true; clearTimeout(timer); dispose(); };
  }, [displayLeague, observation, userTeamName, lifecycle.signature, cpuInputSignature]);
  const verifiedCpuRuntime = cpuRuntime.signature === cpuInputSignature &&
    (!cpuRuntime.data || (cpuRuntime.data.userTeamName === userTeamName && Number(cpuRuntime.data.seasonYear) === Number(lifecycle.payrollYear)))
    ? cpuRuntime : { data: null, loading: true, error: null };
  const opponents = useMemo(() => (observation?.teams || []).filter((team) => norm(team.name) !== norm(userTeamName)).sort((a, b) => (a.standing?.overallRank || 999) - (b.standing?.overallRank || 999)), [observation, userTeamName]);
  const counts = useMemo(() => ({ all: opponents.length, contending: opponents.filter((t) => t.phase === "contending").length, retooling: opponents.filter((t) => t.phase === "retooling").length, rebuilding: opponents.filter((t) => t.phase === "rebuilding").length }), [opponents]);
  const visible = useMemo(() => (filter === "all" ? opponents : opponents.filter((team) => team.phase === filter)), [filter, opponents]);
  const active = visible.find((row) => row.name === activeName) || visible[0] || null;

  const scanKey = `${norm(active?.name || "")}|${norm(userTeamName)}|${refreshRevision}|${lifecycle.signature}`;
  const currentScan = scanCache[scanKey] || null;
  const market = useMemo(() => active && observation ? presentCpuIntel({
    snapshot: observation, team: active, leagueData: displayLeague, userTeamName, feed, scan: currentScan?.result, cpuReadOnly: verifiedCpuRuntime.data, lifecycle,
  }) : null, [active, observation, displayLeague, userTeamName, feed, currentScan, verifiedCpuRuntime.data, lifecycle.signature]);

  useEffect(() => { if (active?.name && active.name !== activeName) setActiveName(active.name); }, [active?.name, activeName]);
  useEffect(() => { setEvidenceDetail(null); setShowRoster(false); }, [active?.name]);
  useEffect(() => {
    scanTokenRef.current += 1;
    scanCacheRef.current = {};
    setScanCache({});
    setFeed(readTradeDeskFeed());
  }, [leagueData, userTeamName, lifecycle.signature, refreshRevision]);

  // Only scan a stable, selected opponent. This existing scanner is capped, can
  // take seconds, and never runs for all 29 teams simultaneously. Result cache
  // lives in memory and is invalidated on league changes, never saved to disk.
  useEffect(() => {
    if (!active?.name || !leagueData || !userTeamName || !lifecycle.scansEnabled) return undefined;
    const key = scanKey;
    if (scanCacheRef.current[key]?.complete) return undefined;
    const token = ++scanTokenRef.current;
    let abandoned = false;
    const timer = setTimeout(async () => {
      if (abandoned) return;
      setScanCache((prev) => ({ ...prev, [key]: { loading: true, progress: "Checking existing CPU market...", result: null } }));
      try {
        const result = await scanIntelCpuEvidence({ leagueData: displayLeague, focusTeamName: active.name, userTeamName, lifecycle,
          tokenRef: scanTokenRef, token,
          onProgress: (progress) => {
            if (!abandoned && scanTokenRef.current === token) {
              setScanCache((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), loading: true, progress } }));
            }
          },
        });
        if (abandoned || scanTokenRef.current !== token || !result.complete) return;
        scanCacheRef.current[key] = result;
        setScanCache((prev) => ({ ...prev, [key]: { loading: false, progress: "", result } }));
      } catch (error) {
        if (abandoned || scanTokenRef.current !== token) return;
        setScanCache((prev) => ({ ...prev, [key]: { loading: false, error: error?.message || String(error), result: null } }));
      }
    }, 850);
    return () => { abandoned = true; clearTimeout(timer); scanTokenRef.current += 1; };
  }, [active?.name, displayLeague, userTeamName, scanNonce, lifecycle.signature, refreshRevision]);
  useEffect(() => {
    if (typeof window === "undefined" || !observation) return undefined;
    const previous = window.BMIntel;
    const api = readOnlyConsoleApi(observation, displayLeague, active?.name || "", market, currentScan?.result, userTeamName, verifiedCpuRuntime, lifecycle, cpuInputSignature, () => {
      signatureRef.current = intelLiveSignature(leagueData, resolveIntelLifecycle(leagueData));
      setRefreshRevision((revision) => revision + 1);
      return "Intel refresh requested. Wait for CPU runtime and scan to complete before capturing after-state.";
    });
    window.BMIntel = api;
    return () => { if (window.BMIntel === api) { if (previous === undefined) delete window.BMIntel; else window.BMIntel = previous; } };
  }, [observation, displayLeague, active?.name, market, currentScan?.result, userTeamName, verifiedCpuRuntime, lifecycle.signature, cpuInputSignature]);
  const rescanMarket = () => {
    if (!lifecycle.scansEnabled) return;
    scanCacheRef.current[scanKey] = null;
    setScanCache((prev) => ({ ...prev, [scanKey]: null }));
    setScanNonce((n) => n + 1);
  };

  useKeyboardListNavigation({ items: visible, selectedItem: active, onSelect: (row) => setActiveName(row.name), getKey: (row) => row?.name, rowSelector: "[data-bm-intel-row-index]" });

  if (!leagueData || !observation) return <PageFade><div className="bmCourtPage bm-il-loading">Loading League Intel…</div></PageFade>;
  if (!active) return <PageFade><div className="bmCourtPage bm-il-loading"><div className="text-center"><p>No opposing teams match this filter.</p><button type="button" className="mt-4 rounded-xl border border-orange-500 px-5 py-2" onClick={() => setFilter("all")}>Show All Teams</button></div></div></PageFade>;

  const inspect = (title, section, row) => {
    // Existing UI sound #1, obeying the user's master SFX preference.
    playSound(SOUND_KEYS.SIDEBAR_NAVIGATION);
    setEvidenceDetail({ title, section, row, team: active, snapshot: observation });
  };
  const closeEvidence = () => {
    // Existing UI sound #2. Never play a sound while merely rendering.
    playSound(SOUND_KEYS.UI_BACK_CANCEL);
    setEvidenceDetail(null);
  };
  const availableRows = market?.available || [];
  const targetRows = market?.targets || [];
  const firstRoundCount = active.ownedPicks.filter((p) => p.round === 1).length;
  const bankNote = `${market?.bankCount || 0} current-roster matching CPU-bank package(s)`;
  const factItems = [
    active.finance.standardRosterPayroll !== null ? `${lifecycle.inOffseason ? "Projected upcoming" : "Roster"} payroll ${money(active.finance.standardRosterPayroll)} (not spendable cap space)` : "Complete payroll unavailable",
    `${firstRoundCount} recorded 1st-round entries (may include swap rights; not all tradeable)`,
    bankNote,
  ];
  // Players and picks have independent, capped evidence lists. An accepted
  // hypothetical user-facing framework outranks CPU valuation within each.
  // A generic preference has no concrete asset and must never fill a player
  // or pick slot as if it were an actual CPU need.
  const playerNeeds = (market?.userPlayerNeeds || (market?.userAssets || []).filter((row) => row.type === "player")).slice(0, 2);
  const pickNeeds = (market?.userPickNeeds || (market?.userAssets || []).filter((row) => row.type === "pick")).slice(0, 2);
  const needsSubFor = (rows) => rows.some((row) => row.evidence?.kind === "user_cpu_accepted_framework")
    ? "Your assets · hypothetical CPU-accepted framework"
    : rows.length ? "Your assets · existing CPU valuation ONLY" : "No eligible asset currently identified";
  const targetsSub = !lifecycle.scansEnabled ? "Projected summer watchlist · NO live trade offers" : currentScan?.loading ? "Checking existing CPU market (bounded)..." : currentScan?.error ? `Scan unavailable: ${currentScan.error}` : (market?.targets?.some((r) => r.evidence?.kind === "cpu_market_watch") && !market?.targets?.some((r) => ["cpu_bank_at_generation", "cpu_mutual_scan"].includes(r.evidence?.kind))) ? `${market?.scanStatus || "No accepted package"} · WATCHLIST ONLY` : market?.scanStatus || `${market?.bankCount || 0} bank packages · ${market?.rumors?.length || 0} Trade Desk reports · scanning pending`;
  const filters = [["all", "All"], ["contending", "Contending"], ["retooling", "Retooling"], ["rebuilding", "Rebuilding"]];

  return <PageFade>
    <div className="bmCourtPage bm-il-page text-white" data-bm-league-intel-v2="true">
      <div className="bm-il-topbar">
        <div className="bm-il-page-heading"><span>FRONT OFFICE{lifecycle.mode !== "live_market" ? ` · ${lifecycle.title.toUpperCase()}` : ""}</span><h1>League Intel</h1></div>
        <div className="bm-il-filters" role="group" aria-label="Scout strength filters" title="Scouting categories based on relative roster/league strength; CPU trade direction is displayed separately.">{filters.map(([key, label]) => <button type="button" key={key} className={filter === key ? "is-active" : ""} onClick={() => setFilter(key)} aria-pressed={filter === key}>{label}<small>{counts[key]}</small></button>)}</div>
        <button type="button" className="bm-il-trade-button" onClick={() => navigate("/trades")}>Trade Center</button>
      </div>
      <div className="bm-il-main">
        <aside className="bm-il-sidebar bm-il-panel" aria-label="Opposing teams">
          <div className="bm-il-sidebar-heading"><h2>OPPOSING TEAMS</h2><p>Your team hidden · {opponents.length} shown</p></div>
          <div className="bm-il-team-scroll"><div className="bm-il-team-list">{visible.map((team, index) => <TeamSelector key={team.name} team={team} index={index} active={team.name === active.name} onClick={() => setActiveName(team.name)} />)}</div></div>
        </aside>
        <main className="bm-il-report" aria-label={`${active.name} scouting report`}>
          <section className="bm-il-hero">
            {active.logo && <img className="bm-il-hero-watermark" src={active.logo} alt="" />}
            <div className="bm-il-hero-identity">
              <span className="bm-il-hero-logo">{active.logo ? <img src={active.logo} alt="" /> : "NBA"}</span>
              <div className="bm-il-hero-copy">
                <h2>{active.name}</h2>
                <div className="bm-il-hero-essentials">
                  <span><span className="bm-il-essential-label">Record</span> <strong>{active.record ? `${active.record.wins ?? 0}-${active.record.losses ?? 0}` : "0-0"}</strong></span>
                  <span><span className="bm-il-essential-label">{lifecycle.inOffseason ? `${lifecycle.payrollYear} Payroll` : "Payroll"}</span> <strong>{money(active.finance.standardRosterPayroll)}</strong></span>
                </div>
              </div>
            </div>
          </section>
          <section className="bm-il-panel bm-il-lineup-panel">
            <PanelTitle icon="♟" sub={active.projectedLineup.evidence.label} aside={<button type="button" className="bm-il-roster-link" onClick={() => setShowRoster(true)}>View Full Roster →</button>}>PROJECTED LINEUP</PanelTitle>
            <div className="bm-il-starters">{active.projectedLineup.slots.slice(0, 5).map((slot) => <Starter key={slot.pos} slot={slot} team={active} liveTeams={liveTeams} />)}</div>
          </section>
          <div className="bm-il-market-grid">
            <IntelPlayersPanel title="PROTECTED CORE" icon="♙" sub={market?.cpuSource ? "CPU-to-CPU core guard + roster leaders · not a universal veto" : "Top-rated roster leaders · not a CPU trade veto"} rows={market?.core || active.rosterLeaders} empty="No core players identified." liveTeams={liveTeams} team={active} onInspect={(row) => inspect("Protected Core", "core", row)} />
            <IntelPlayersPanel title="LIKELY AVAILABLE" icon="⇄" sub={lifecycle.mode === "future_outlook" ? "Projected summer departures · CPU board, no live deals" : lifecycle.inOffseason ? "Offseason candidates · existing CPU outgoing board" : market?.cpuSource ? "Bank → bilateral scan → actual CPU outgoing board" : "CPU-bank activity → bilateral scan; not a trade block"} rows={availableRows} empty={currentScan?.loading ? "Evaluating hypothetical CPU packages..." : verifiedCpuRuntime.loading ? "Loading existing CPU outgoing board..." : "No CPU-bank, evaluated package, or current generator candidate found."} liveTeams={liveTeams} team={active} onInspect={(row) => inspect("Likely Available", "available", row)} />
            <IntelPlayersPanel title="TARGETS" icon="◎" sub={targetsSub} rows={targetRows} empty={currentScan?.loading ? "Scanning existing trade evaluator..." : verifiedCpuRuntime.loading ? "Reading CPU market watchlist..." : "No bank deal, evaluator-approved package, or market watch entry identified."} liveTeams={liveTeams} team={active} source section="targetsRows" showTargetLogo rumors={market?.rumors || []} onInspectRumor={(row) => inspect("Trade Desk", "rumor", { ...row, name: row.label || "Trade Desk Report" })} aside={lifecycle.scansEnabled ? <button type="button" className="bm-il-roster-link" onClick={rescanMarket} disabled={currentScan?.loading} title="Recheck with the existing CPU evaluator; no game state changes">{currentScan?.loading ? "SCANNING..." : "RESCAN"}</button> : <span className="bm-il-evidence-tag" title="Trades are currently locked; scouting only">OUTLOOK</span>} onInspect={(row) => inspect("Targets", "targets", row)} />
          </div>
          <div className="bm-il-bottom-grid">
            <FactPanel title="TEAM NEEDS: PLAYERS" icon="▤" sub={needsSubFor(playerNeeds)}>
              {playerNeeds.length ? playerNeeds.map((need, index) => (
                <MiniPlayer
                  key={need.id || need.name || index}
                  row={need}
                  liveTeams={liveTeams}
                  team={active}
                  section="teamNeedsPlayers"
                  portraitTeamName={userTeamName}
                  needsPlayer
                  panelTitle="Team Needs: Players"
                  onInspect={() => inspect("Team Needs: Players", "needs", need)}
                />
              )) : <div className="bm-il-empty">No valued players from your roster identified. This does not mean the CPU would reject every player.</div>}
            </FactPanel>
            <FactPanel title="TEAM NEEDS: PICKS" icon="◈" sub={needsSubFor(pickNeeds)}>
              {pickNeeds.length ? pickNeeds.map((need, index) => {
                const originLogo = pickOriginLogo(need, displayLeague, liveTeams);
                return <button type="button" className="bm-il-need bm-il-need--pick bm-il-need--split"
                  style={leagueIntelTuningVars("teamNeeds")}
                  key={need.id || need.label || index} title="Inspect existing CPU evidence"
                  onClick={() => inspect("Team Needs: Picks", "needs", need)}>
                  <span className="bm-il-need-pick-mark" aria-hidden="true">
                    {originLogo ? <img src={originLogo} alt="" /> : <span>R{Number(need.round) === 2 ? "2" : "1"}</span>}
                  </span>
                  <span className="bm-il-need-copy"><strong>{need.label || need.name}</strong></span>
                </button>;
              }) : <div className="bm-il-empty">No eligible valued draft picks identified. Ownership, swap rights, and trade restrictions still apply.</div>}
            </FactPanel>
            <FactPanel title="ASSETS & CONSTRAINTS" icon="▱" sub="From saved league data">
              <ul className="bm-il-assets">{factItems.map((line) => <li key={line}>{line}</li>)}</ul>
            </FactPanel>
          </div>
        </main>
      </div>
      <EvidenceDialog detail={evidenceDetail} onClose={closeEvidence} />
      <RosterDialog team={showRoster ? active : null} liveTeams={liveTeams} onClose={() => setShowRoster(false)} />
    </div>
  </PageFade>;
}
