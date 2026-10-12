/**
 * League Intel CPU evidence adapter — presentation ONLY.
 *
 * Consumes the save's admitted CPU bank, persisted Trade Desk reports, and
 * the existing (bounded) CPU market scan. Never creates a bank candidate,
 * changes trade preferences, executes a deal, or writes the save.
 *
 * A scanned bilateral CPU-accepted proposal is a HYPOTHETICAL package, not a
 * scheduled CPU trade or an official player wishlist. A user-facing check is
 * also required before attributing a scanned package to the player's assets.
 */
import { scanCpuTradeMarket } from "./cpuTradeDiscovery.js";
import { evaluateTradeTeamImpact } from "./tradeTeamImpact.js";
import { buildOffseasonTradeEvaluationLeague } from "./offseasonTradeContext.js";
import { validateUserTradeRules, getUserTradePickEligibility } from "./userTradeRules.js";
import { isResolvedPickConsumed } from "./liveDraftTradeAvailability.js";
import { getResolvedDraftPickNumber } from "./draftPicks.js";

const normalize = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const teamName = (t) => t?.name || t?.teamName || "";
const getTeams = (league) => Array.isArray(league?.teams) ? league.teams : Object.values(league?.conferences || {}).flatMap((v) => Array.isArray(v) ? v : []);
const findTeam = (league, name) => getTeams(league).find((t) => normalize(teamName(t)) === normalize(name)) || null;
const assetKey = (p) => String(p?.id ?? p?.playerId ?? normalize(p?.name || p?.player || ""));
const itemPlayer = (item) => item?.type === "player" && item?.player ? item.player : null;
const itemPick = (item) => item?.type === "pick" && item?.pick ? item.pick : null;
const isCurrent = (item, team, league) => {
  const p = itemPlayer(item);
  if (p) return (team?.players || []).some((r) => (p.id != null && r.id != null && String(p.id) === String(r.id)) || normalize(p.name || p.player) === normalize(r.name || r.player));
  const pick = itemPick(item);
  if (!pick) return false;
  return (league?.draftPicks || []).some((r) =>
    normalize(r.ownerTeam || r.currentOwnerTeamName || r.owner) === normalize(teamName(team)) &&
    !["traded", "conveyed", "forfeited", "expired", "cancelled"].includes(normalize(r.status)) &&
    (pick.id != null && r.id != null ? String(pick.id) === String(r.id) :
      Number(pick.year || pick.seasonYear) === Number(r.year || r.seasonYear) &&
      Number(pick.round) === Number(r.round) && normalize(pick.originalTeam) === normalize(r.originalTeam))
  );
};

// Mirrors the exact published phase thresholds in trade_team_ai.py, rather than
// the Intel-only conference-rank phase. Do not treat this as CPU-to-CPU direction:
// that generator uses its own five phases and evaluates current league context.
export function negotiationTeamPhase(team, observed = null) {
  const phases = new Set(["contender", "playoff", "middle", "retool", "rebuild", "tank"]);
  const explicit = normalize(team?.phase || team?.status || team?.direction);
  if (phases.has(explicit)) return { phase: explicit, source: "saved team phase" };
  const wins = Number(observed?.record?.wins ?? team?.wins ?? team?.record?.wins ?? team?.seasonRecord?.wins ?? 0);
  const losses = Number(observed?.record?.losses ?? team?.losses ?? team?.record?.losses ?? team?.seasonRecord?.losses ?? 0);
  if (wins + losses > 0) {
    const pct = wins / (wins + losses);
    return { phase: pct >= 0.62 ? "contender" : pct >= 0.52 ? "playoff" : pct >= 0.43 ? "middle" : pct >= 0.32 ? "retool" : "rebuild", source: "trade_team_ai.py record thresholds" };
  }
  const roster = (team?.players || []).filter((p) => p && !p.isTwoWay && !p.isStash && !/two.?way|stash/i.test(String(p.rosterStatus || p.contractType || "")));
  const overalls = roster.map((p) => Number(p.overall ?? p.ovr ?? p.rating ?? 60)).filter(Number.isFinite).sort((a, b) => b - a).slice(0, 8);
  const avg = overalls.reduce((a, b) => a + b, 0) / (overalls.length || 1);
  const ages = roster.map((p) => Number(p.age ?? 27)).filter(Number.isFinite);
  const age = ages.reduce((a, b) => a + b, 0) / (ages.length || 1);
  return { phase: avg >= 85 ? "contender" : avg >= 81 ? "playoff" : avg >= 78 ? "middle" : avg >= 75 || age <= 25 ? "retool" : "rebuild", source: "trade_team_ai.py preseason roster thresholds (mirrored)" };
}

// All category labels summarize the existing weights in trade_team_ai.py;
// they are qualitative, not added to CPU trade evaluation.
const GENERIC_NEEDS = Object.freeze({
  contender: ["Ready-now rotation talent", "Quality positional upgrade", "Affordable veteran help"],
  playoff: ["Immediate rotation upgrade", "Positional depth", "Contract-efficient help"],
  middle: ["Good-value roster upgrade", "Young upside", "Future draft capital"],
  retool: ["Young upside", "Future first-round pick", "Salary flexibility"],
  rebuild: ["Young high-potential talent", "First-round draft capital", "Salary flexibility"],
  tank: ["High-upside prospects", "Unprotected first-round picks", "Future salary flexibility"],
});

export function genericCpuNeeds(phase) { return [...(GENERIC_NEEDS[phase] || GENERIC_NEEDS.middle)]; }

function intoLivePlayer(league, item, sourceTeamName) {
  const raw = itemPlayer(item);
  if (!raw) return null;
  const team = findTeam(league, sourceTeamName);
  if (!team) return null;
  const original = (team.players || []).find((p) =>
    (raw.id != null && p.id != null && String(raw.id) === String(p.id)) || normalize(raw.name || raw.player) === normalize(p.name || p.player)
  );
  if (!original || original.isTwoWay || original.isStash) return null;
  return {
    id: original.id ?? original.playerId ?? null,
    name: original.name || original.player,
    teamName: teamName(team),
    sourceTeam: teamName(team),
    pos: original.pos || original.position || "",
    overall: original.overall ?? original.ovr ?? null,
    potential: original.potential ?? original.pot ?? null,
    age: original.age ?? null,
    headshot: original.headshot || original.headshotUrl || original.photoUrl || "",
  };
}

function intoLivePick(league, item, sourceTeamName, lifecycle = null) {
  const pick = itemPick(item);
  const owner = findTeam(league, sourceTeamName);
  if (!pick || !owner || !isCurrent(item, owner, league)) return null;
  const source = (league.draftPicks || []).find((p) => String(p.id || p.pickId || "") === String(pick.id || pick.pickId || ""));
  const actual = source || pick;
  const protection = actual.protection || actual.displayProtection || actual.protections || "";
  const actualSlot = lifecycle?.inOffseason && lifecycle?.lotteryRevealed && Number(actual.year || actual.seasonYear) === Number(lifecycle.draftYear)
    ? getResolvedDraftPickNumber(actual) : 0;
  return { id: actual.id || actual.pickId || null, sourceTeam: teamName(owner), teamName: teamName(owner),
    name: `${actualSlot ? `#${actualSlot} · ` : ""}${actual.year || actual.seasonYear || "Future"} ${Number(actual.round) === 2 ? "2nd" : "1st"} · ${actual.originalTeam || actual.originalTeamName || "Own"}${protection && normalize(protection) !== "unprotected" ? ` (${protection})` : ""}`,
    pos: "PICK", overall: null, age: null, assetKind: "pick", year: actual.year || actual.seasonYear,
    round: actual.round, protection };
}

export function matchingIntelRumors(feed, selectedTeamName, league = null) {
  const year = Number(league?.seasonStartYear || league?.seasonYear || 0);
  const seasonOpening = year ? `${year}-09-01` : "";
  return (Array.isArray(feed) ? feed : [])
    .filter((row) => (row?.teamNames || []).some((name) => normalize(name) === normalize(selectedTeamName)))
    .filter((row) => ["rumor", "negotiation"].includes(normalize(row.type)))
    .filter((row) => {
      const date = String(row.date || "").slice(0, 10);
      // The 2027-28 season starts in fall 2027, not January 2027.
      // Undated reports cannot be claimed as current-season trade rumors.
      return !seasonOpening || (/^\d{4}-\d{2}-\d{2}$/.test(date) && date >= seasonOpening);
    })
    .map((row) => ({ id: String(row.id || ""), headline: String(row.headline || ""), label: String(row.label || ""), date: String(row.date || ""), playerNames: [...(row.playerNames || [])], type: row.type,
      evidence: { kind: "trade_desk_report", label: "Saved Trade Desk rumor/negotiation; not confirmation that a named player is being acquired" } }))
    .filter((row) => row.headline)
    .slice(0, 3);
}

/**
 * Run an existing, capped league-wide CPU-vs-CPU hypothetical scan, plus one
 * matchup against the controlled franchise for Team Needs. No calls to any
 * execution/bank-generation APIs. Caller must cancel obsolete runs via tokenRef.
 */
export async function scanIntelCpuEvidence({ leagueData, focusTeamName, userTeamName, tokenRef, token, onProgress, lifecycle = null }) {
  if (lifecycle?.mode === "future_outlook") return { focusTeamName, userTeamName, userDeals: [], marketDeals: [], stats: {}, userStats: {}, complete: true, disabled: "trade_window_locked" };
  const offseason = lifecycle?.inOffseason
    ? buildOffseasonTradeEvaluationLeague(leagueData, lifecycle.context) : null;
  const scanLeague = offseason?.leagueData || leagueData;
  const context = offseason?.context || lifecycle?.context || null;
  const legalPackage = (firstName, secondName, firstItems, secondItems) => {
    if (!lifecycle?.inOffseason) return true;
    const all = [...(firstItems || []), ...(secondItems || [])];
    if (all.some((item) => item?.type === "pick" && isResolvedPickConsumed(item.pick || {}, leagueData))) return false;
    return validateUserTradeRules({ leagueData: scanLeague,
      userTeamName: firstName, cpuTeamName: secondName,
      userItems: firstItems, cpuItems: secondItems,
      context, includeDeadline: true }).ok;
  };
  const cancelled = () => tokenRef && tokenRef.current !== token;
  const focus = findTeam(leagueData, focusTeamName);
  const user = findTeam(leagueData, userTeamName);
  const result = { focusTeamName, userTeamName, userDeals: [], marketDeals: [], stats: {}, userStats: {}, complete: false };
  if (!focus || cancelled()) return result;
  if (user && normalize(userTeamName) !== normalize(focusTeamName)) {
    const userScan = await scanCpuTradeMarket({ leagueData: scanLeague, focusTeamName, opponentTeamName: userTeamName,
      userTeamName: "", options: { depth: "instant" }, tokenRef, token, onProgress: (message) => onProgress?.(`Your assets: ${message}`) });
    if (cancelled()) return result;
    result.userStats = userScan.stats || {};
    for (const row of userScan.rows || []) for (const deal of row.trades || []) {
      if (normalize(deal.teamAName) !== normalize(focusTeamName) || normalize(deal.teamBName) !== normalize(userTeamName)) continue;
      // The CPU-to-CPU scanner accepted both parties, but when one is the USER,
      // the game's regular Submit Proposal CPU decision is the important check.
      const userItems = deal.teamBItems || [];
      const cpuItems = deal.teamAItems || [];
      if (![...userItems].every((item) => isCurrent(item, user, leagueData)) || !cpuItems.every((item) => isCurrent(item, focus, leagueData))) continue;
      if (!legalPackage(userTeamName, focusTeamName, userItems, cpuItems)) continue;
      const exact = evaluateTradeTeamImpact({ leagueData: scanLeague, userTeam: findTeam(scanLeague, userTeamName), cpuTeam: findTeam(scanLeague, focusTeamName),
        userTeamName, cpuTeamName: focusTeamName, userItems, cpuItems });
      if (!exact?.accepted) continue;
      result.userDeals.push({ ...deal, userItems, cpuItems, userEvaluation: { accepted: true, score: Number(exact.score || 0) } });
    }
    onProgress?.(`${result.userDeals.length} user-facing CPU-accepted framework(s); searching league...`);
  }
  if (cancelled()) return result;
  const market = await scanCpuTradeMarket({ leagueData: scanLeague, focusTeamName, opponentTeamName: "all", userTeamName,
    options: { depth: "instant" }, tokenRef, token, onProgress });
  if (cancelled()) return result;
  result.stats = market.stats || {};
  result.marketDeals = (market.rows || []).flatMap((row) => row.trades || [])
    .filter((deal) => normalize(deal.teamAName) === normalize(focusTeamName) || normalize(deal.teamBName) === normalize(focusTeamName))
    .filter((deal) => legalPackage(deal.teamAName, deal.teamBName, deal.teamAItems || [], deal.teamBItems || []))
    .filter((deal) => [...(deal.teamAItems || [])].every((item) => isCurrent(item, findTeam(leagueData, deal.teamAName), leagueData))
      && [...(deal.teamBItems || [])].every((item) => isCurrent(item, findTeam(leagueData, deal.teamBName), leagueData)));
  result.provisional = Boolean(lifecycle?.inOffseason);
  result.complete = true;
  return result;
}

/** Original Python CPU engine intelligence (NOT a confirmed trade proposal). */
function cpuBoardRow(league, item, section, focusTeamName) {
  const team = section === "available" || section === "core" ? focusTeamName : item?.sourceTeam;
  const player = intoLivePlayer(league, { type: "player", player: item }, team);
  if (!player) return null;
  const kind = section === "available" ? "cpu_outgoing_board" : section === "core" ? "cpu_hard_core" : "cpu_market_watch";
  const label = section === "available"
    ? "Existing cpu_cpu_trade_logic.py outgoing candidate board for this team's actual CPU-to-CPU phase. Candidate only; the CPU has not accepted an exchange."
    : section === "core"
      ? "Direct result of cpu_cpu_trade_logic.py:_is_shared_untouchable_core. Hard guard in this CPU-to-CPU generator lane, not a universal trade veto."
      : `Existing ${team} CPU outgoing board, ranked for the receiving team by cpu_cpu_trade_logic.py buyer roster fit and trade_value_model.py value (CPU fit ${Number(item.existingCpuFit ?? 0).toFixed(2)}). Watchlist only; NOT a confirmed acquisition target or accepted deal.`;
  return { ...player, cpuValue: item.value ?? null, evidence: { kind, label, source: "existing_python_cpu_model" } };
}

function cpuValuedUserAsset(league, entry, userTeamName, lifecycle = null) {
  if (!entry || !userTeamName) return null;
  const evidence = {
    kind: "cpu_valuation_only", score: entry.value,
    label: `Evaluated by the existing trade_value_model.py with the selected team's trade_team_ai.py preferences (value ${Number(entry.value || 0).toFixed(1)}). This is NOT confirmation the CPU has requested the asset or would accept a particular package.`,
  };
  if (entry.kind === "player") {
    const row = intoLivePlayer(league, { type: "player", player: entry }, userTeamName);
    return row && Number(entry.value || 0) > 0 ? { ...row, label: `${row.name} · ${row.overall ?? "—"} OVR`, type: "player", evidence } : null;
  }
  if (entry.kind === "pick") {
    const row = intoLivePick(league, { type: "pick", pick: entry }, userTeamName, lifecycle);
    if (!row || Number(entry.value || 0) <= 0) return null;
    const current = (league?.draftPicks || []).find((p) => String(p.id || p.pickId || "") === String(row.id));
    if (!current) return null;
    // A positive trade value is not proof of legal tradability. This standalone
    // check reuses the real Stepien/second-apron/future-pick rules; package-level
    // eligibility still requires Trade Center validation.
    const eligibility = getUserTradePickEligibility({ leagueData: league, teamName: userTeamName,
      pick: current, context: lifecycle?.context || null });
    if (!eligibility.ok) return null;
    return { ...row, type: "pick", label: row.name,
      evidence: { ...evidence, label: `${evidence.label} Standalone pick rule check passed; a proposed package may still be restricted.` } };
  }
  return null;
}

export function presentCpuIntel({ snapshot, team, leagueData, userTeamName, feed = [], scan = null, cpuReadOnly = null, lifecycle = null }) {
  const outlook = lifecycle?.mode === "future_outlook";
  const offseason = lifecycle?.mode === "offseason_market";
  const historical = outlook || offseason;
  // An old CPU bank entry or in-season rumor must not become a summer offer.
  if (outlook) scan = null;
  const seen = (rows) => rows.filter((p, i, all) => all.findIndex((a) => assetKey(a) === assetKey(p) && normalize(a.sourceTeam) === normalize(p.sourceTeam)) === i);
  const cpuTeam = cpuReadOnly?.teams?.[team?.name] || null;
  const cpuCore = (cpuTeam?.hardProtected || []).map((p) => cpuBoardRow(leagueData, p, "core", team?.name)).filter(Boolean);
  const cpuOutgoing = (cpuTeam?.outgoing || []).map((p) => cpuBoardRow(leagueData, p, "available", team?.name)).filter(Boolean);
  const cpuWatch = (cpuTeam?.watchlist || []).map((p) => cpuBoardRow(leagueData, p, "targets", team?.name)).filter(Boolean);
  const valuedUserAssets = (cpuTeam?.valuedUserAssets || []).map((p) => cpuValuedUserAsset(leagueData, p, userTeamName, lifecycle)).filter(Boolean);

  const bankOutgoing = historical ? [] : [...(team?.outgoingMarketPlayers || [])];
  const bankIncoming = historical ? [] : [...(team?.incomingMarketTargets || [])];
  const scannedOutgoing = [];
  const scannedIncoming = [];
  for (const deal of scan?.marketDeals || []) {
    const teamIsA = normalize(deal.teamAName) === normalize(team?.name);
    const sourceName = teamIsA ? deal.teamAName : deal.teamBName;
    const otherName = teamIsA ? deal.teamBName : deal.teamAName;
    const outgoingItems = teamIsA ? deal.teamAItems : deal.teamBItems;
    const incomingItems = teamIsA ? deal.teamBItems : deal.teamAItems;
    const evidence = { kind: "cpu_mutual_scan", label: `${scan?.provisional ? "PROJECTED OFFSEASON package using existing trade evaluation context. Recheck in Trade Center before attempting execution. " : ""}Hypothetical package accepted by BOTH existing CPU evaluators (${team?.name} vs ${otherName}); not a saved CPU-bank trade or guaranteed future action.`, packageId: deal.id, template: deal.template };
    for (const item of outgoingItems || []) {
      const row = intoLivePlayer(leagueData, item, sourceName);
      if (row) scannedOutgoing.push({ ...row, destinationTeam: otherName, packageId: deal.id, evidence });
      const pick = intoLivePick(leagueData, item, sourceName, lifecycle);
      if (pick) scannedOutgoing.push({ ...pick, destinationTeam: otherName, packageId: deal.id, evidence });
    }
    for (const item of incomingItems || []) {
      const row = intoLivePlayer(leagueData, item, otherName);
      if (row) scannedIncoming.push({ ...row, packageId: deal.id, evidence });
      const pick = intoLivePick(leagueData, item, otherName, lifecycle);
      if (pick) scannedIncoming.push({ ...pick, packageId: deal.id, evidence });
    }
  }
  const userAssetRows = [];
  for (const deal of scan?.userDeals || []) for (const item of deal.userItems || []) {
    if (!isCurrent(item, findTeam(leagueData, userTeamName), leagueData)) continue;
    const evidence = { kind: "user_cpu_accepted_framework", label: `A specific ${scan?.provisional ? "PROJECTED OFFSEASON " : ""}hypothetical package with ${team?.name} passed the existing mutual market scan AND the normal user-facing CPU acceptance evaluator. Not an offer or execution guarantee; use the real Trade Center to verify current legality.`, packageId: deal.id };
    const p = intoLivePlayer(leagueData, item, userTeamName);
    if (p) userAssetRows.push({ ...p, label: `${p.name} · ${p.overall ?? "—"} OVR`, evidence, packageId: deal.id, type: "player" });
    const pick = itemPick(item);
    if (pick) userAssetRows.push({ id: pick.id || pick.pickId || deal.id, label: `${pick.year || pick.seasonYear} ${Number(pick.round) === 2 ? "2nd" : "1st"} · ${pick.originalTeam || "Own"}${pick.protection && normalize(pick.protection) !== "unprotected" ? ` (${pick.protection})` : ""}`, type: "pick", evidence, packageId: deal.id });
  }
  // Real bank activity outranks discovered hypothetical packages. An accepted
  // package has NO automatic priority over an actual current CPU bank record.
  const out = seen([...bankOutgoing, ...scannedOutgoing, ...cpuOutgoing]);
  const targets = seen([...bankIncoming, ...scannedIncoming, ...cpuWatch]);
  // Prefer an actually CPU-approved framework; otherwise show a real CPU Python
  // valuation separately. We never claim the latter is an accepted trade.
  // Two independent Team Needs panels must not compete for the same global
  // top-three list. Keep accepted hypothetical frameworks ahead of raw CPU
  // valuations within EACH asset type. Do not invent a trade preference.
  const rankedUserAssets = seen([...userAssetRows, ...valuedUserAssets]);
  const playerNeeds = rankedUserAssets.filter((row) => row.type === "player").slice(0, 2);
  const pickNeeds = rankedUserAssets.filter((row) => row.type === "pick").slice(0, 2);
  const assets = [...playerNeeds, ...pickNeeds];
  const core = seen([...cpuCore, ...(team?.rosterLeaders || [])]).slice(0, 3);
  const profile = negotiationTeamPhase(findTeam(leagueData, team?.name), team);
  return {
    teamName: team?.name || "", available: out.slice(0, 3), targets: targets.slice(0, 3), userAssets: assets, userPlayerNeeds: playerNeeds, userPickNeeds: pickNeeds, core,
    cpuSource: cpuTeam ? { availableCandidates: cpuOutgoing.length, marketWatch: cpuWatch.length, userAssetValuations: valuedUserAssets.length, hardProtected: cpuCore.length, phase: cpuTeam.cpuCpuPhase, negotiationPhase: cpuTeam.negotiationPhase, buyerNeed: cpuTeam.buyerNeed || null, note: "Python market candidate boards, original CPU buyer fit, and valuation are not accepted packages" } : null,
    profile, genericNeeds: genericCpuNeeds(profile.phase), rumors: historical ? [] : matchingIntelRumors(feed, team?.name, leagueData),
    bankCount: historical ? 0 : snapshot?.bank?.observedCandidates?.filter((row) => normalize(row.fromTeamName) === normalize(team?.name) || normalize(row.toTeamName) === normalize(team?.name)).length || 0,
    scanStatus: scan?.complete ? `${scan?.provisional ? "Offseason hypothetical · " : ""}${scan?.stats?.exactEvaluations || 0} league checks · ${scan?.stats?.mutualAcceptsFound || 0} mutual accepts${scan?.stats?.capped || scan?.stats?.timeCapped ? " · limited scan" : ""}` : null,
  };
}

/** Verify the actual rendered market panels' provenance and current ownership. */
export function validateCpuIntelDisplay({ market, leagueData, userTeamName }) {
  const issues = [];
  const marketLabels = new Set(["cpu_bank_at_generation", "cpu_mutual_scan", "cpu_outgoing_board", "cpu_market_watch"]);
  for (const [section, rows] of [["available", market?.available || []], ["targets", market?.targets || []]]) {
    for (const row of rows) {
      const kind = row.evidence?.kind;
      if (!marketLabels.has(kind)) { issues.push(`${section}: ${row.name} has unsupported evidence ${kind}`); continue; }
      if (kind === "cpu_bank_at_generation" && !row.candidateId) issues.push(`${section}: ${row.name} missing bank ID`);
      if (kind === "cpu_mutual_scan" && !row.packageId) issues.push(`${section}: ${row.name} missing scan package ID`);
      const sourceName = section === "targets" ? row.sourceTeam : market?.teamName;
      const source = findTeam(leagueData, sourceName);
      if (!source) { issues.push(`${section}: ${row.name} source team missing`); continue; }
      if (row.assetKind === "pick") {
        if (!(leagueData.draftPicks || []).some((pick) =>
          String(pick.id || pick.pickId || "") === String(row.id) &&
          normalize(pick.ownerTeam || pick.currentOwnerTeamName || pick.owner) === normalize(sourceName) &&
          !["traded", "conveyed", "forfeited", "expired", "cancelled"].includes(normalize(pick.status)))) {
          issues.push(`${section}: ${row.name} pick changed ownership`);
        }
      } else if (!(source.players || []).some((p) => (p.id != null && row.id != null && String(p.id) === String(row.id)) || normalize(p.name || p.player) === normalize(row.name))) {
        issues.push(`${section}: ${row.name} changed roster`);
      }
    }
  }
  for (const row of market?.userAssets || []) {
    if (row.evidence?.kind !== "user_cpu_accepted_framework" && row.evidence?.kind !== "cpu_valuation_only") issues.push(`user asset: ${row.name || row.label} has unknown evidence`);
    if (row.evidence?.kind === "user_cpu_accepted_framework" && !row.packageId) issues.push(`user asset: ${row.name || row.label} lacks accepted framework ID`);
    if (row.evidence?.kind === "cpu_valuation_only" && !(Number(row.evidence.score) > 0)) issues.push(`user asset: ${row.name || row.label} has invalid valuation`);
    const user = findTeam(leagueData, userTeamName);
    if (!user) { issues.push("controlled franchise missing"); break; }
    if (row.type === "pick") {
      if (!(leagueData.draftPicks || []).some((p) => String(p.id || p.pickId || "") === String(row.id) && normalize(p.ownerTeam || p.currentOwnerTeamName || p.owner) === normalize(userTeamName))) issues.push(`user pick ${row.id} no longer owned`);
    } else if (!(user.players || []).some((p) => String(p.id || p.playerId) === String(row.id) || normalize(p.name || p.player) === normalize(row.name))) issues.push(`user player ${row.name} no longer rostered`);
  }
  return { ok: issues.length === 0, checkedMarketRows: (market?.available?.length || 0) + (market?.targets?.length || 0), checkedUserAssets: market?.userAssets?.length || 0, issues };
}
