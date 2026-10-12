/**
 * League Intel lifecycle switch. Read-only composition of the actual game's
 * authoritative trade deadline, offseason, lottery, and draft progression APIs.
 * This module is deliberately NOT a new trading rule engine.
 */
import { getOffseasonTradeContext } from "./offseasonTradeContext.js";
import { getUserTradeDeadlineStatus } from "./userTradeRules.js";
import { getContractSeasonYear, getSeasonStartYear } from "./seasonContext.js";
import { getLiveDraftProgressSignature, isResolvedPickConsumed } from "./liveDraftTradeAvailability.js";
import { isResolvedDraftPickAsset } from "./draftPicks.js";

const clean = (value) => String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");
const readClock = () => {
  try { return JSON.parse(localStorage.getItem("bm_league_clock_v1") || "null") || {}; }
  catch { return {}; }
};

/** Explicit overrides are for deterministic regression fixtures ONLY. */
export function resolveIntelLifecycle(leagueData = {}, overrides = {}) {
  const context = overrides.context || getOffseasonTradeContext(leagueData);
  const deadline = overrides.deadline || getUserTradeDeadlineStatus(leagueData, context);
  const clock = readClock();
  const phase = clean(overrides.clockPhase ?? clock.phase) || clean(
    leagueData?.calendar?.phase || leagueData?.seasonPhase || leagueData?.phase || ""
  );
  const playoffs = !context.inOffseason && (phase.includes("playoff") || phase.includes("postseason") || phase.includes("finals"));
  const mode = context.inOffseason ? "offseason_market"
    : (deadline.locked || playoffs) ? "future_outlook" : "live_market";
  const stage = context.inOffseason ? context.stage || "pre_lottery" : playoffs ? "playoffs" : deadline.locked ? "post_deadline" : "pre_deadline";
  let draftProgress = "";
  if (context.inOffseason && typeof localStorage !== "undefined") {
    try { draftProgress = getLiveDraftProgressSignature(leagueData); } catch { draftProgress = "unavailable"; }
  }
  const seasonYear = getSeasonStartYear(leagueData);
  const payrollYear = context.inOffseason ? context.targetContractSeasonYear : getContractSeasonYear(leagueData);
  return {
    mode, stage, seasonYear, payrollYear,
    inOffseason: Boolean(context.inOffseason),
    draftYear: Number(context.seasonYear || seasonYear + 1),
    lotteryRevealed: Boolean(context.lotteryRevealed),
    draftOrderLocked: Boolean(context.draftOrderLocked),
    draftComplete: Boolean(context.draftComplete),
    draftInProgress: Boolean(context.draftInProgress),
    draftProgress,
    deadlineLocked: Boolean(deadline.locked),
    scansEnabled: mode !== "future_outlook",
    context,
    signature: [mode, stage, seasonYear, payrollYear, context.seasonYear, context.lotteryRevealed ? 1 : 0, context.draftComplete ? 1 : 0, draftProgress, deadline.locked ? 1 : 0, clock.date || deadline.currentDate || leagueData.currentDate || ""].join("|"),
    title: mode === "future_outlook" ? "Offseason Outlook"
      : mode === "offseason_market" ? (stage === "live_draft" || stage === "post_lottery_pre_draft" ? "Draft & Offseason Intel" : "Offseason Market Intel")
      : "Live Trade Intel",
    note: mode === "future_outlook"
      ? "Planning only — trades are locked. Summer candidates are not live offers."
      : mode === "offseason_market"
        ? "Offseason projections and bounded hypothetical checks; no offer is guaranteed."
        : "CPU candidate boards and hypothetical trade checks; no offer is guaranteed.",
  };
}

/** Do not reveal exact lottery selections before the canonical reveal. */
export function intelVisiblePick(pick, lifecycle, leagueData) {
  if (!pick || typeof pick !== "object") return null;
  const year = Number(pick.year ?? pick.seasonYear ?? pick.draftYear ?? 0);
  const currentDraft = lifecycle?.inOffseason && year === Number(lifecycle.draftYear);
  if (currentDraft && lifecycle.draftComplete) return null;
  if (currentDraft && lifecycle.draftInProgress) {
    try { if (isResolvedPickConsumed(pick, leagueData)) return null; } catch { return null; }
  }
  if (currentDraft && !lifecycle.lotteryRevealed) {
    // A hidden precomputed order may exist in saved draft state. No exact slot
    // can reach Intel (even via Python valuation or the console diagnostics).
    if (isResolvedDraftPickAsset(pick)) return null;
    // Explicit allowlist: never forward hidden lottery/order fields that may
    // have been precomputed under arbitrary property names by draft storage.
    const allowed = ["id", "pickId", "assetType", "type", "year", "seasonYear", "round",
      "originalTeam", "originalTeamName", "ownerTeam", "currentOwnerTeamName", "owner",
      "protection", "protections", "displayProtection", "status", "swapWithTeam",
      "swapDirection", "rangeStart", "rangeEnd", "ownedRange", "tradeableRange"];
    return Object.fromEntries(allowed.filter((key) => Object.prototype.hasOwnProperty.call(pick, key)).map((key) => [key, pick[key]]));
  }
  return pick;
}

export function intelVisibleDraftPicks(leagueData, lifecycle) {
  return (Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks : [])
    .map((pick) => intelVisiblePick(pick, lifecycle, leagueData))
    .filter(Boolean);
}

// A small hash of authoritative *stored* inputs; the UI must detect changes
// written outside GameContext (gameplans, ResultsV3 index and offseason state).
// Nothing is written to storage. A checksum keeps the 4-second poll cheap even
// after many seasons while still reading the entire stored value.
function hashString(value) {
  const raw = String(value ?? "");
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${raw.length}:${(hash >>> 0).toString(36)}`;
}

export function intelStoredInputSignature(teams = []) {
  if (typeof localStorage === "undefined") return "no-browser-storage";
  try {
    const keys = ["bm_results_index_v3", "bm_league_clock_v1", "bm_offseason_state_v1",
      "bm_draft_lottery_v1", "bm_draft_state_v1", "bm_trade_deadline_status_v1"];
    for (const team of teams) if (team?.name) keys.push(`gameplan_${team.name}`);
    return keys.map((key) => `${key}=${hashString(localStorage.getItem(key))}`).join("|");
  } catch {
    return "stored-input-unavailable";
  }
}

// Explicitly captures all fields that influence roster/rotation evidence,
// market valuation, financials or pick status. A single trade can update
// several of these before tradeHistory is persisted, so history length alone
// would not be reliable. Trade history content is hashed to prevent stale
// cooldown or candidate evidence when a transaction is corrected in place.
export function intelLiveSignature(leagueData = {}, lifecycle = {}) {
  const teams = Array.isArray(leagueData?.teams) ? leagueData.teams : Object.values(leagueData?.conferences || {}).flatMap((list) => Array.isArray(list) ? list : []);
  const roster = teams.map((t) => [t?.name, t?.wins, t?.losses, t?.phase, t?.status, t?.direction,
    t?.payroll, t?.salaryCap, t?.financials, t?.rotation, t?.gameplan,
    (t?.players || []).map((p) => [p?.id, p?.name, p?.overall, p?.ovr, p?.potential, p?.pot,
      p?.age, p?.pos, p?.position, p?.secondaryPos, p?.secondaryPosition, p?.salary,
      p?.yearsLeft, p?.rosterStatus, p?.contractType, p?.isTwoWay, p?.isStash,
      p?.contract?.startYear, p?.contract?.salaryByYear, p?.contract?.years,
      p?.contract?.option, p?.contract?.teamOption, p?.contract?.playerOption,
      p?.isInjured, p?.injuryStatus]).join(";")
  ]);
  const picks = (leagueData?.draftPicks || []).map((p) => [p.id, p.pickId, p.ownerTeam,
    p.currentOwnerTeamName, p.owner, p.status, p.year, p.seasonYear, p.round,
    p.assetType, p.type, p.pickNumber, p.overallPick, p.protection, p.protections,
    p.displayProtection, p.swapWithTeam, p.swapDirection, p.rangeStart, p.rangeEnd]).join(";");
  const history = hashString(JSON.stringify(leagueData?.tradeHistory || []));
  const financial = [leagueData?.financials, leagueData?.financialRules, leagueData?.salaryCap,
    leagueData?.salaryRules, leagueData?.leagueSettings, leagueData?.rules,
    leagueData?.gameResults?.length, leagueData?.results?.length];
  return hashString(JSON.stringify([leagueData?.leagueName, leagueData?.seasonYear,
    leagueData?.currentSeasonYear, leagueData?.seasonStartYear, lifecycle.signature,
    roster, picks, history, financial, leagueData?.cpuTradeBankState?.updatedAt,
    leagueData?.cpuTradeBankState?.candidates?.length,
    intelStoredInputSignature(teams)]));
}
