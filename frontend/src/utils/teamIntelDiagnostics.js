/** League Intel diagnostics: in-memory, READ ONLY, save-independent snapshots.
 * No mutation of GameContext, drafts, trade banks, rosters or localStorage.
 */
const n = (value) => String(value ?? "").trim().toLowerCase();
const allTeams = (league) => Array.isArray(league?.teams) ? league.teams
  : Object.values(league?.conferences || {}).flatMap((x) => Array.isArray(x) ? x : []);
const name = (row) => String(row?.name || row?.teamName || "").trim();
const playerKey = (p) => p?.id != null ? `id:${p.id}` : `name:${n(p.name || p.player)}`;
const pickKey = (p) => p?.id != null || p?.pickId != null ? `id:${p.id ?? p.pickId}`
  : `${p?.year ?? p?.seasonYear}:${p?.round}:${n(p?.originalTeam || p?.originalTeamName)}:${n(p?.assetType || p?.type)}`;
const rowKey = (p) => p?.id != null ? `${p?.assetKind || p?.type || "player"}:${p.id}` : n(p?.name || p?.label);

export function captureIntelSnapshot({ leagueData = {}, observation = null, market = null, lifecycle = {}, controlledTeam = "", scoutedTeam = "", signature = "" } = {}) {
  const players = {};
  const teams = {};
  for (const team of allTeams(leagueData)) {
    const teamName = name(team);
    for (const p of team?.players || []) {
      const key = playerKey(p);
      players[key] = { name: String(p.name || p.player || ""), team: teamName,
        overall: p.overall ?? p.ovr ?? null, potential: p.potential ?? p.pot ?? null,
        position: p.pos || p.position || "", secondaryPosition: p.secondaryPos || p.secondaryPosition || "",
        rosterStatus: p.rosterStatus || p.contractType || "", isTwoWay: Boolean(p.isTwoWay),
        salary: p.salary ?? null, contract: JSON.stringify(p.contract?.salaryByYear || []),
      };
    }
    const observed = observation?.teams?.find((t) => n(t.name) === n(teamName));
    teams[teamName] = {
      record: `${observed?.record?.wins ?? team.wins ?? 0}-${observed?.record?.losses ?? team.losses ?? 0}`,
      scoutDirection: observed?.phase || null,
      payroll: observed?.finance?.standardRosterPayroll ?? null,
    };
  }
  const picks = {};
  for (const pick of leagueData?.draftPicks || []) {
    const key = pickKey(pick);
    picks[key] = { owner: pick.ownerTeam || pick.currentOwnerTeamName || pick.owner || "",
      status: pick.status || "active", year: pick.year ?? pick.seasonYear,
      round: pick.round, pickNumber: pick.pickNumber ?? pick.overallPick ?? null,
      protection: pick.protection || pick.displayProtection || "" };
  }
  const sections = {};
  for (const key of ["available", "targets", "userAssets", "core"]) {
    sections[key] = (market?.[key] || []).map((row) => ({ id: rowKey(row),
      name: row.name || row.label, from: row.sourceTeam || row.teamName || "",
      evidence: row.evidence?.kind || "" }));
  }
  return {
    signature, controlledTeam, scoutedTeam,
    leagueName: leagueData?.leagueName || "", seasonYear: lifecycle.seasonYear ?? leagueData.seasonYear,
    mode: lifecycle.mode || "unknown", stage: lifecycle.stage || "unknown",
    payrollYear: lifecycle.payrollYear ?? null, draftYear: lifecycle.draftYear ?? null,
    cpuPhase: market?.cpuSource?.phase || null, cpuBuyerNeed: market?.cpuSource?.buyerNeed || null,
    tradeCount: Array.isArray(leagueData?.tradeHistory) ? leagueData.tradeHistory.length : 0,
    bankCandidateCount: Array.isArray(leagueData?.cpuTradeBankState?.candidates) ? leagueData.cpuTradeBankState.candidates.length : 0,
    players, teams, picks, sections,
  };
}

function compareRows(before = {}, after = {}, formatter) {
  const changes = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = before[key] ?? null;
    const a = after[key] ?? null;
    if (JSON.stringify(b) !== JSON.stringify(a)) changes.push(formatter(key, b, a));
  }
  return changes;
}

export function compareIntelSnapshots(before, after) {
  if (!before || !after) return { ok: false, error: "Take two snapshots using BMIntel.capture('before') and BMIntel.capture('after')." };
  const movedPlayers = [], addedPlayers = [], removedPlayers = [], changedPlayers = [];
  for (const [key, b] of Object.entries(before.players || {})) {
    const a = after.players?.[key];
    if (!a) { removedPlayers.push({ name: b.name, from: b.team }); continue; }
    if (n(b.team) !== n(a.team)) movedPlayers.push({ name: a.name, from: b.team, to: a.team });
    const fields = {};
    for (const field of ["overall", "potential", "position", "secondaryPosition", "rosterStatus", "isTwoWay", "salary", "contract"]) {
      if (JSON.stringify(b[field]) !== JSON.stringify(a[field])) fields[field] = { before: b[field], after: a[field] };
    }
    if (Object.keys(fields).length) changedPlayers.push({ name: a.name, team: a.team, fields });
  }
  for (const [key, a] of Object.entries(after.players || {})) if (!before.players?.[key]) addedPlayers.push({ name: a.name, to: a.team });
  const pickChanges = compareRows(before.picks, after.picks, (id, b, a) => ({ id, before: b, after: a }));
  const teamChanges = compareRows(before.teams, after.teams, (team, b, a) => ({ team, before: b, after: a }));
  const panelChanges = {};
  for (const section of ["available", "targets", "userAssets", "core"]) {
    const left = before.sections?.[section] || [], right = after.sections?.[section] || [];
    const idsA = new Set(left.map((r) => r.id)), idsB = new Set(right.map((r) => r.id));
    panelChanges[section] = {
      added: right.filter((r) => !idsA.has(r.id)),
      removed: left.filter((r) => !idsB.has(r.id)),
      evidenceChanged: right.filter((r) => idsA.has(r.id) && left.find((p) => p.id === r.id)?.evidence !== r.evidence),
    };
  }
  const stateChanges = {};
  for (const key of ["controlledTeam", "scoutedTeam", "seasonYear", "mode", "stage", "payrollYear", "draftYear", "cpuPhase", "cpuBuyerNeed", "bankCandidateCount"]) {
    if (before[key] !== after[key]) stateChanges[key] = { before: before[key], after: after[key] };
  }
  const warnings = [];
  if (before.controlledTeam !== after.controlledTeam) warnings.push("Controlled franchise changed; user asset panels are not directly comparable.");
  if (before.scoutedTeam !== after.scoutedTeam) warnings.push("Scouted team changed; target/availability panels are not directly comparable.");
  if (before.seasonYear !== after.seasonYear) warnings.push("Season changed; compare contracts and draft assets using the new year.");
  return { ok: true, stateChanges, tradeCountDelta: after.tradeCount - before.tradeCount,
    movedPlayers, addedPlayers, removedPlayers, changedPlayers,
    pickChanges, teamChanges, panelChanges, warnings,
    intelSignatureChanged: before.signature !== after.signature,
  };
}

const captures = new Map();
const MAX_CAPTURES = 16;
export function saveIntelCapture(label, input) {
  const key = String(label ?? "").trim() || `capture-${captures.size + 1}`;
  const snapshot = captureIntelSnapshot(input);
  captures.delete(key);
  captures.set(key, snapshot);
  while (captures.size > MAX_CAPTURES) captures.delete(captures.keys().next().value);
  return { label: key, seasonYear: snapshot.seasonYear, scoutedTeam: snapshot.scoutedTeam,
    controlledTeam: snapshot.controlledTeam, trades: snapshot.tradeCount,
    rosteredPlayers: Object.keys(snapshot.players).length,
    picks: Object.keys(snapshot.picks).length,
    captured: true, note: "In-memory only. Does not save or modify the league." };
}
export function listIntelCaptures() {
  return [...captures].map(([label, s]) => ({ label, team: s.scoutedTeam, franchise: s.controlledTeam, seasonYear: s.seasonYear, trades: s.tradeCount }));
}
export function diffIntelCaptures(from = null, to = null) {
  const keys = [...captures.keys()];
  const a = from ?? keys.at(-2), b = to ?? keys.at(-1);
  if (!captures.has(a) || !captures.has(b)) return { ok: false, error: "Unknown capture. Run BMIntel.captures() to see labels." };
  return { from: a, to: b, ...compareIntelSnapshots(captures.get(a), captures.get(b)) };
}
