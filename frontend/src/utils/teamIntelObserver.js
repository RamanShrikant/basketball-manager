/**
 * League Intel Observer v1 (read-only).
 *
 * This module never calls trade evaluators/generators, alters saves, accesses
 * storage, or changes the simulation. Every reported trade signal is either an
 * observed CPU-bank entry or explicitly described as an inference.
 *
 * Important: a bank entry was accepted when generated; it is NOT a current
 * trade offer, promise of acceptance, or a persistent CPU wishlist.
 */
import { getContractSeasonYear } from "./seasonContext.js";
import { getLeagueFinancialRules } from "./leagueFinancials.js";
import { isStandardRosterPlayer } from "./rosterRules.js";

export const INTEL_OBSERVER_VERSION = 4;
export const INTEL_TRADE_BANK_FIELD = "cpuTradeBankState";

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const normalize = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const teamName = (team) => String(team?.name || team?.teamName || "").trim();
const playerName = (player) => String(player?.name || player?.playerName || player?.player || "").trim();
const playerId = (player) => player?.id ?? player?.playerId ?? player?.player_id ?? player?.uuid ?? null;
const positionOf = (player) => String(player?.pos || player?.position || player?.primaryPosition || "").toUpperCase().split(/[\/,|]/)[0].trim();
const isStandard = isStandardRosterPlayer;

function allTeams(league) {
  const raw = Array.isArray(league?.teams)
    ? league.teams
    : Object.values(league?.conferences || {}).flatMap((rows) => Array.isArray(rows) ? rows : []);
  const seen = new Set();
  return raw.filter((team) => {
    const key = normalize(teamName(team));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function salaryAndYears(player, contractYear) {
  const directYears = finite(player?.yearsLeft ?? player?.contractYears);
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const byYear = Array.isArray(contract.salaryByYear) ? contract.salaryByYear : [];
  const start = finite(contract.startYear) ?? contractYear;
  // Do not repeat the final salary after the contract has ended.
  const index = contractYear - start;
  const hasSalarySchedule = byYear.length > 0;
  // salaryByYear is authoritative if present. Never resurrect a stale
  // player.salary/aav after the array has ended (or before it begins).
  const contractSalary = hasSalarySchedule
    ? (index >= 0 && index < byYear.length ? finite(byYear[index]) : 0)
    : null;
  const directSalary = finite(player?.salary ?? player?.currentSalary ?? player?.contractSalary ?? player?.capHit ?? player?.aav);
  return {
    salary: hasSalarySchedule ? contractSalary : directSalary,
    yearsRemaining: hasSalarySchedule ? (index < 0 ? 0 : Math.max(0, byYear.length - index))
      : (directYears === null ? null : Math.max(0, Math.trunc(directYears))),
  };
}

function decoratePlayer(player, name, contractYear) {
  const contract = salaryAndYears(player, contractYear);
  return {
    id: playerId(player),
    name: playerName(player),
    teamName: name,
    pos: positionOf(player),
    secondaryPos: String(player?.secondaryPos || "").toUpperCase(),
    overall: finite(player?.overall ?? player?.ovr ?? player?.rating ?? player?.overallRating),
    potential: finite(player?.potential ?? player?.pot),
    age: finite(player?.age),
    headshot: player?.headshot || player?.headshotUrl || player?.photoUrl || player?.portrait || player?.image || player?.img || "",
    ...contract,
  };
}

function matchesPlayerRef(player, ref) {
  if (!ref || typeof ref !== "object") return false;
  const refId = playerId(ref);
  if (refId !== null && player.id !== null) return String(refId) === String(player.id);
  const refName = playerName(ref);
  return Boolean(refName) && normalize(refName) === normalize(player.name);
}

function rosterLeaderRows(roster) {
  // NOT a CPU trade veto. A plainly labeled roster-strength interpretation.
  return [...roster]
    .filter((p) => p.overall !== null)
    .sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1) || (b.potential ?? -1) - (a.potential ?? -1))
    .slice(0, 3)
    .map((p) => ({ ...p, evidence: { kind: "roster_analysis", label: "Top-rated roster player; CPU protection not guaranteed" } }));
}

function projectedLineup(roster, minutes = null) {
  // A supplied, real saved-minutes map can improve the projection but is not
  // interpreted as proof of who actually started the last game.
  const validMinutes = minutes && typeof minutes === "object" && !Array.isArray(minutes)
    ? minutes : null;
  const hasUsableMinutes = Boolean(validMinutes) && roster.some((p) => (finite(validMinutes[p.name]) ?? 0) > 0);
  const ordered = [...roster].sort((a, b) => {
    const minutesDelta = hasUsableMinutes ? (finite(validMinutes[b.name]) ?? 0) - (finite(validMinutes[a.name]) ?? 0) : 0;
    return minutesDelta || (b.overall ?? -1) - (a.overall ?? -1) || a.name.localeCompare(b.name);
  });
  const used = new Set();
  const slots = POSITIONS.map((pos) => {
    const index = ordered.findIndex((p, j) => !used.has(j) && (p.pos === pos || p.secondaryPos === pos));
    const fallback = ordered.findIndex((p, j) => !used.has(j));
    const chosenIndex = index >= 0 ? index : fallback;
    if (chosenIndex < 0) return { pos, player: null };
    used.add(chosenIndex);
    return { pos, player: ordered[chosenIndex] };
  });
  return { slots, evidence: { kind: "projection", label: hasUsableMinutes ? "Saved minute allocations + position/OVR projection; not confirmed game starters" : "Position + OVR estimate; no saved minute allocation supplied" } };
}

function needsFromDepth(depth) {
  // Only literal roster-depth observations; no made-up shooting/defense weaknesses.
  return depth.filter((row) => row.count < 2).slice(0, 3).map((row) => ({
    key: `depth:${row.position}`,
    label: `${row.position} depth: ${row.count} player${row.count === 1 ? "" : "s"}`,
    position: row.position,
    count: row.count,
    evidence: { kind: "roster_fact", label: "Counts active roster players by primary position; not a confirmed CPU acquisition goal" },
  }));
}

function normalizeOwnedPicks(league, name) {
  return (Array.isArray(league?.draftPicks) ? league.draftPicks : [])
    .filter((pick) => normalize(pick?.ownerTeam || pick?.currentOwnerTeamName || pick?.owner || pick?.currentOwner) === normalize(name))
    .filter((pick) => !["traded", "conveyed", "cancelled", "forfeited", "expired"].includes(normalize(pick?.status)))
    .map((pick) => ({
      id: pick.id ?? pick.pickId ?? null,
      year: finite(pick.year ?? pick.seasonYear),
      round: finite(pick.round),
      originalTeam: pick.originalTeam || pick.originalTeamName || "",
      protection: pick.protection || pick.protections || pick.displayProtection || null,
      assetType: pick.assetType || pick.type || "pick",
      evidence: { kind: "saved_asset", label: "Owned in league draftPicks; tradability and Stepien not verified" },
    }));
}

function readBank(league, teamsByKey, year) {
  const state = league?.[INTEL_TRADE_BANK_FIELD];
  const output = { initialized: Boolean(state), candidateCount: 0, observedCandidates: [], skipped: { unaccepted: 0, wrongSeason: 0, staleRoster: 0, malformed: 0 } };
  if (!state || typeof state !== "object") return output;
  const season = finite(state.seasonYear);
  if (year !== null && season !== null && season !== year) {
    output.skipped.wrongSeason = Array.isArray(state.candidates) ? state.candidates.length : 0;
    return output;
  }
  const candidates = Array.isArray(state.candidates) ? state.candidates : [];
  output.candidateCount = candidates.length;
  for (const candidate of candidates) {
    if (!candidate?.bankMeta?.acceptedAtGeneration) {
      output.skipped.unaccepted++;
      continue;
    }
    const fromName = String(candidate.fromTeamName || "").trim();
    const toName = String(candidate.toTeamName || "").trim();
    const fromTeam = teamsByKey.get(normalize(fromName));
    const toTeam = teamsByKey.get(normalize(toName));
    const fromItems = Array.isArray(candidate.fromItems) ? candidate.fromItems : null;
    const toItems = Array.isArray(candidate.toItems) ? candidate.toItems : null;
    if (!fromTeam || !toTeam || fromTeam === toTeam || !fromItems?.length || !toItems?.length) {
      output.skipped.malformed++;
      continue;
    }
    const rosterMatches = (items, team) => items.every((item) => {
      if (item?.type === "player") return team.roster.some((player) => matchesPlayerRef(player, item.player));
      if (item?.type !== "pick") return false;
      // Only ownership is rechecked. Legal transferability still requires the
      // genuine execution engine, which Intel MUST NEVER invoke.
      const expected = item.pick || {};
      const live = Array.isArray(league?.draftPicks) ? league.draftPicks : [];
      return live.some((pick) => {
        const owner = pick.ownerTeam || pick.currentOwnerTeamName || pick.owner || pick.currentOwner;
        if (normalize(owner) !== normalize(team.name)) return false;
        if (["traded", "conveyed", "cancelled", "forfeited", "expired"].includes(normalize(pick.status))) return false;
        const expectedId = expected.id ?? expected.pickId;
        const liveId = pick.id ?? pick.pickId;
        if (expectedId != null && liveId != null) return String(expectedId) === String(liveId);
        return Number(pick.year ?? pick.seasonYear) === Number(expected.year ?? expected.seasonYear)
          && Number(pick.round) === Number(expected.round)
          && normalize(pick.originalTeam || pick.originalTeamName) === normalize(expected.originalTeam || expected.originalTeamName);
      });
    });
    if (!rosterMatches(fromItems, fromTeam) || !rosterMatches(toItems, toTeam)) {
      output.skipped.staleRoster++;
      continue;
    }
    const describe = (items, team) => items.filter((item) => item.type === "player").map((item) => team.roster.find((p) => matchesPlayerRef(p, item.player))).filter(Boolean);
    const describePicks = (items, team) => items.filter((item) => item.type === "pick").map((item) => {
      const raw = item.pick || {};
      const source = team.ownedPicks.find((p) => raw.id != null && p.id != null ? String(p.id) === String(raw.id) : Number(p.year) === Number(raw.year) && Number(p.round) === Number(raw.round) && normalize(p.originalTeam) === normalize(raw.originalTeam));
      if (!source) return null;
      return { ...source, name: `${source.year || "Future"} ${source.round === 2 ? "2nd" : "1st"} · ${source.originalTeam || "Own"}${source.protection && normalize(source.protection) !== "unprotected" ? ` (${source.protection})` : ""}`, pos: "PICK", assetKind: "pick", teamName: team.name, overall: null, age: null };
    }).filter(Boolean);
    output.observedCandidates.push({
      id: String(candidate.bankId || candidate.id || candidate.signature || ""),
      fromTeamName: fromTeam.name,
      toTeamName: toTeam.name,
      fromPlayers: describe(fromItems, fromTeam),
      toPlayers: describe(toItems, toTeam),
      fromPicks: describePicks(fromItems, fromTeam),
      toPicks: describePicks(toItems, toTeam),
      generatedDate: candidate.bankMeta.generatedDate || null,
      evidence: {
        kind: "cpu_bank_at_generation",
        label: "CPU-bank package accepted when generated; player ownership still matches. Trade rules and picks NOT revalidated.",
      },
    });
  }
  return output;
}

/** Pure, synchronous, no-IO observer. Pass currently available records separately if desired. */
export function observeLeagueIntel(leagueData, { recordsByTeam = {}, minutesByTeam = {}, payrollSeasonYear = null, upcomingFinancialYear = false } = {}) {
  const league = leagueData && typeof leagueData === "object" ? leagueData : {};
  const seasonYear = finite(league.seasonStartYear ?? league.seasonYear ?? league.currentSeasonYear);
  const contractYear = Number.isFinite(Number(payrollSeasonYear)) && payrollSeasonYear !== null
    ? Number(payrollSeasonYear) : getContractSeasonYear(league);
  // In the offseason, the financial cap belongs to the UPCOMING season, while
  // salaryByYear continues to be indexed by season-start year.
  const upcomingCap = upcomingFinancialYear ? finite(getLeagueFinancialRules(league, contractYear + 1)?.salaryCap) : null;
  const teams = allTeams(league).map((team) => {
    const name = teamName(team);
    const roster = (Array.isArray(team.players) ? team.players : []).filter(isStandard).map((p) => decoratePlayer(p, name, contractYear)).filter((p) => p.name);
    const positionDepth = POSITIONS.map((position) => ({ position, count: roster.filter((p) => p.pos === position).length }));
    const expiringContracts = roster.filter((p) => p.yearsRemaining === 1 && p.salary !== null && p.salary > 0).sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
    const standardRosterPayroll = roster.every((p) => p.salary !== null) ? roster.reduce((sum, p) => sum + p.salary, 0) : null;
    const salaryCap = upcomingCap ?? finite(league.salaryCap ?? league.capLimit ?? league.financialRules?.salaryCap ?? league.salaryRules?.salaryCap);
    const record = recordsByTeam[name] || recordsByTeam[normalize(name)] || null;
    return {
      name,
      logo: team.logo || team.teamLogo || team.newTeamLogo || team.logoUrl || team.image || "",
      conference: team.conference || team.conf || null,
      roster,
      positionDepth,
      projectedLineup: projectedLineup(roster, minutesByTeam[name] || null),
      rosterLeaders: rosterLeaderRows(roster),
      needs: needsFromDepth(positionDepth),
      expiringContracts,
      ownedPicks: normalizeOwnedPicks(league, name),
      finance: {
        standardRosterPayroll,
        salaryCap,
        spendableCapSpace: null,
        evidence: { kind: "partial_finance", label: "Standard roster payroll only; cap holds/dead money/apron calculations not evaluated" },
      },
      record: record ? { wins: finite(record.w ?? record.wins), losses: finite(record.l ?? record.losses), evidence: { kind: "provided_result", label: "Record provided by existing standings/schedule system" } } : null,
      outgoingMarketPlayers: [],
      incomingMarketTargets: [],
      scoutedAvailability: [],
      projectedFits: [],
      standing: null,
      phase: "retooling",
    };
  });
  const byName = new Map(teams.map((team) => [normalize(team.name), team]));
  const bank = readBank(league, byName, seasonYear);
  for (const candidate of bank.observedCandidates) {
    const from = byName.get(normalize(candidate.fromTeamName));
    const to = byName.get(normalize(candidate.toTeamName));
    // 'fromItems' are sent by the from team and received by the to team.
    for (const p of [...candidate.fromPlayers, ...candidate.fromPicks]) {
      from.outgoingMarketPlayers.push({ ...p, destinationTeam: to.name, candidateId: candidate.id, evidence: candidate.evidence });
      to.incomingMarketTargets.push({ ...p, sourceTeam: from.name, candidateId: candidate.id, evidence: candidate.evidence });
    }
    for (const p of [...candidate.toPlayers, ...candidate.toPicks]) {
      to.outgoingMarketPlayers.push({ ...p, destinationTeam: from.name, candidateId: candidate.id, evidence: candidate.evidence });
      from.incomingMarketTargets.push({ ...p, sourceTeam: to.name, candidateId: candidate.id, evidence: candidate.evidence });
    }
  }
  // These are SCOUTING estimates, not the game's canonical power rankings or
  // CPU GM decisions. During the preseason, only roster strength is available.
  const ranked = [...teams].map((team) => {
    const top8 = team.roster.map((p) => p.overall).filter((n) => n !== null).sort((a, b) => b - a).slice(0, 8);
    const strength = top8.length ? top8.reduce((a, b) => a + b, 0) / top8.length : 0;
    const games = (team.record?.wins ?? 0) + (team.record?.losses ?? 0);
    const pct = games ? team.record.wins / games : 0;
    return { team, strength, games, pct };
  });
  const withRecords = ranked.length && ranked.every((r) => r.games >= 20);
  ranked.sort((a, b) => {
    const aScore = withRecords ? a.strength * .5 + a.pct * 50 : a.strength;
    const bScore = withRecords ? b.strength * .5 + b.pct * 50 : b.strength;
    return bScore - aScore || a.team.name.localeCompare(b.team.name);
  });
  ranked.forEach(({ team }, index) => {
    const matchingConference = ranked.filter((row) => normalize(row.team.conference) === normalize(team.conference));
    const conferenceRank = matchingConference.findIndex((row) => row.team === team) + 1;
    const overallRank = index + 1;
    team.standing = {
      overallRank,
      conferenceRank: conferenceRank || null,
      conferenceCount: matchingConference.length || null,
      basis: withRecords ? "Top-8 roster OVR + win rate (scouting estimate)" : "Top-8 roster OVR (preseason scouting estimate)",
      isOfficialStandings: false,
    };
    team.phase = conferenceRank <= 6 ? "contending" : conferenceRank <= 11 ? "retooling" : "rebuilding";
    team.avgAge = team.roster.length ? team.roster.reduce((sum, p) => sum + (p.age ?? 0), 0) / team.roster.length : null;
  });

  return { version: INTEL_OBSERVER_VERSION, seasonYear, bank, teams, limitations: [
    "Protected Core displays top-rated roster leaders; these alone do not prove CPU protection. CPU trade screens/evaluations still govern actual offers.",
    "Scouting ranks and phase labels are roster/record estimates, not the official Power Rankings.",
    "Bank items are historical generation-time approvals, not guaranteed executable offers.",
    "Position-depth observations are facts. Team Needs uses existing trade-preference descriptions or accepted hypothetical packages, not a new CPU shopping policy.",
    "Observer only reads data. Optional Intel CPU market scans run evaluators without executing or saving trades; scanned packages are hypothetical.",
  ] };
}

export function getObservedTeam(snapshot, name) {
  return snapshot?.teams?.find((team) => normalize(team.name) === normalize(name)) || null;
}

/** Fast, user-visible sanity checks. Does not mutate inputs or call the game. */
export function validateIntelObservation(snapshot, leagueData) {
  const issues = [];
  const liveTeams = new Map(allTeams(leagueData).map((team) => [normalize(teamName(team)), team]));
  for (const team of snapshot?.teams || []) {
    const actual = liveTeams.get(normalize(team.name));
    if (!actual) { issues.push(`Missing team: ${team.name}`); continue; }
    const roster = (actual.players || []).filter(isStandard);
    for (const player of team.roster || []) {
      if (!roster.some((p) => matchesPlayerRef(player, p))) issues.push(`Stale roster player: ${team.name}/${player.name}`);
    }
    const lineup = (team.projectedLineup?.slots || []).map((slot) => slot.player).filter(Boolean);
    if (lineup.length > 5) issues.push(`Too many starters: ${team.name}`);
    if (new Set(lineup.map((p) => String(p.id ?? normalize(p.name)))).size !== lineup.length) issues.push(`Duplicate starter: ${team.name}`);
    for (const row of team.outgoingMarketPlayers || []) {
      if (row.assetKind === "pick" ? !team.ownedPicks.some((p) => String(p.id) === String(row.id)) : !team.roster.some((p) => matchesPlayerRef(p, row))) issues.push(`Stale outgoing asset: ${team.name}/${row.name}`);
      if (!snapshot?.bank?.observedCandidates?.some((c) => c.id === row.candidateId)) issues.push(`Missing CPU-bank evidence: ${team.name}/${row.name}`);
      if (row.evidence?.kind !== "cpu_bank_at_generation") issues.push(`Incorrect observed-trade label: ${team.name}/${row.name}`);
    }
    for (const row of team.incomingMarketTargets || []) {
      const currentSource = liveTeams.get(normalize(row.sourceTeam));
      if (!currentSource || (row.assetKind === "pick" ? !getObservedTeam(snapshot, row.sourceTeam)?.ownedPicks.some((p) => String(p.id) === String(row.id)) : !(currentSource.players || []).some((p) => matchesPlayerRef(row, p)))) issues.push(`Stale target source: ${team.name}/${row.name}`);
      if (!snapshot?.bank?.observedCandidates?.some((c) => c.id === row.candidateId)) issues.push(`Missing target CPU-bank evidence: ${team.name}/${row.name}`);
    }
    for (const row of team.rosterLeaders || []) {
      if (row.evidence?.kind !== "roster_analysis") issues.push(`Unqualified core claim: ${team.name}/${row.name}`);
    }
    for (const row of team.scoutedAvailability || []) {
      if (row.evidence?.kind !== "scouting_estimate") issues.push(`Unqualified availability estimate: ${team.name}/${row.name}`);
      if (!team.roster.some((p) => matchesPlayerRef(p, row))) issues.push(`Stale scouting availability: ${team.name}/${row.name}`);
    }
    for (const row of team.projectedFits || []) {
      if (row.evidence?.kind !== "scouting_fit") issues.push(`Unqualified target estimate: ${team.name}/${row.name}`);
      const currentSource = liveTeams.get(normalize(row.sourceTeam));
      if (!currentSource || !(currentSource.players || []).some((p) => matchesPlayerRef(row, p))) issues.push(`Stale projected fit: ${team.name}/${row.name}`);
      const sourceScouting = getObservedTeam(snapshot, row.sourceTeam);
      if (!sourceScouting?.scoutedAvailability.some((p) => matchesPlayerRef(p, row))) issues.push(`Projected fit not market-screened: ${team.name}/${row.name}`);
      if (!team.needs.some((n) => n.position === row.pos)) issues.push(`Projected fit not needed: ${team.name}/${row.name}`);
      if ((sourceScouting?.positionDepth.find((d) => d.position === row.pos)?.count ?? 0) < 2) issues.push(`Projected fit drains source position: ${team.name}/${row.name}`);
    }
    for (const row of team.expiringContracts || []) {
      if (!team.roster.some((p) => matchesPlayerRef(p, row)) || row.yearsRemaining !== 1) issues.push(`Invalid expiring deal: ${team.name}/${row.name}`);
    }
    for (const pick of team.ownedPicks || []) {
      const livePicks = Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks : [];
      if (!livePicks.some((p) => normalize(p.ownerTeam || p.currentOwnerTeamName || p.owner || p.currentOwner) === normalize(team.name) && (pick.id != null && (p.id ?? p.pickId) != null ? String(p.id ?? p.pickId) === String(pick.id) : Number(p.year ?? p.seasonYear) === pick.year && Number(p.round) === pick.round))) issues.push(`Stale owned pick: ${team.name}/${pick.id || pick.year}`);
    }
  }
  return { ok: issues.length === 0, teamCount: snapshot?.teams?.length || 0, checkedCandidateCount: snapshot?.bank?.observedCandidates?.length || 0, issues };
}


/** Explain a row without reading storage, invoking the CPU evaluator or creating trades. */
export function inspectIntelClaim(snapshot, teamNameQuery, section, playerQuery) {
  const team = getObservedTeam(snapshot, teamNameQuery);
  if (!team) return { ok: false, reason: "unknown_team" };
  const sections = {
    core: team.rosterLeaders,
    available: team.outgoingMarketPlayers,
    scoutedAvailability: team.scoutedAvailability,
    targets: team.incomingMarketTargets,
    projectedFits: team.projectedFits,
    needs: team.needs,
    expiring: team.expiringContracts,
    picks: team.ownedPicks,
  };
  if (!Object.prototype.hasOwnProperty.call(sections, section)) return { ok: false, reason: "unknown_section", supportedSections: Object.keys(sections) };
  const rows = sections[section] || [];
  const match = rows.find((p) => normalize(p.name || p.label || p.id) === normalize(playerQuery) || (p.id != null && String(p.id) === String(playerQuery)));
  return match ? { ok: true, team: team.name, section, entry: { ...match }, evidence: match.evidence || null } : { ok: false, reason: "not_found", team: team.name, section };
}
