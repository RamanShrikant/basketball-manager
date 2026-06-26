const DEFAULT_PICK_STATUS = "active";
const DEFAULT_START_YEAR = 2026;
const DEFAULT_END_YEAR = 2032;

export function normalizeTeamName(name = "") {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

export function getTeamNamesFromLeague(leagueData) {
  return getAllTeamsFromLeague(leagueData)
    .map((team) => team?.name || team?.teamName)
    .filter(Boolean);
}

export function getTeamLogoMap(leagueData) {
  const map = {};

  for (const team of getAllTeamsFromLeague(leagueData)) {
    const logo =
      team?.logo ||
      team?.teamLogo ||
      team?.newTeamLogo ||
      team?.logoUrl ||
      team?.image ||
      team?.img ||
      "";

    if (!logo) continue;

    for (const name of [team?.name, team?.teamName, team?.abbreviation, team?.abbr, team?.shortName]) {
      const key = normalizeTeamName(name);
      if (key) map[key] = logo;
    }
  }

  return map;
}

function cleanToken(value = "") {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28) || "TEAM";
}

export function makeDraftPickId({ assetType = "pick", year, round, originalTeam, ownerTeam, swapWithTeam, seed } = {}) {
  const type = String(assetType || "pick").toLowerCase() === "swap" ? "SWAP" : "PICK";
  const y = Number(year || DEFAULT_START_YEAR);
  const r = Number(round || 1);
  const original = cleanToken(originalTeam);
  const owner = cleanToken(ownerTeam || originalTeam);
  const swap = swapWithTeam ? `_${cleanToken(swapWithTeam)}` : "";
  const extra = seed ? `_${cleanToken(seed)}` : "";
  return `${type}_${y}_${original}_R${r}_${owner}${swap}${extra}`;
}

export function normalizeDraftPickAsset(row = {}, index = 0, teamNames = []) {
  row = row && typeof row === "object" ? row : {};
  const assetType = String(row.assetType || row.type || "pick").toLowerCase() === "swap" ? "swap" : "pick";
  const year = Number(row.year || row.seasonYear || DEFAULT_START_YEAR);
  const round = Math.max(1, Math.min(2, Number(row.round || 1)));
  const originalTeam = String(
    row.originalTeam ||
      row.originalTeamName ||
      row.original_team ||
      row.affectedTeam ||
      row.teamName ||
      row.team ||
      row.fromTeam ||
      teamNames[0] ||
      ""
  ).trim();
  const ownerTeam = String(
    row.ownerTeam ||
      row.currentOwnerTeamName ||
      row.owner_team ||
      row.currentOwner ||
      row.rightHolder ||
      row.rightHolderTeam ||
      row.holderTeam ||
      originalTeam ||
      teamNames[0] ||
      ""
  ).trim();
  const swapWithTeam = String(
    row.swapWithTeam ||
      row.swap_with_team ||
      row.swapTeam ||
      row.otherTeam ||
      row.swap?.withTeam ||
      ""
  ).trim();
  const protections = row.protections == null ? String(row.protection || row.conditions || "") : String(row.protections);
  const displayProtection = row.displayProtection == null ? protections : String(row.displayProtection);
  const notes = row.notes == null ? String(row.note || row.details || "") : String(row.notes);
  const status = String(row.status || DEFAULT_PICK_STATUS).toLowerCase();

  const id =
    row.id ||
    makeDraftPickId({
      assetType,
      year,
      round,
      originalTeam,
      ownerTeam,
      swapWithTeam,
      seed: assetType === "swap" ? index + 1 : "",
    });

  return {
    ...row,
    id: String(id),
    assetType,
    type: assetType,
    year,
    round,
    originalTeam,
    ownerTeam,
    protections: protections.trim() || null,
    displayProtection: displayProtection.trim() || protections.trim() || null,
    status: ["active", "resolved", "void", "conveyed"].includes(status) ? status : DEFAULT_PICK_STATUS,
    notes: notes.trim() || null,
    swapWithTeam: assetType === "swap" ? swapWithTeam : "",
    swap:
      assetType === "swap"
        ? {
            ...(row.swap && typeof row.swap === "object" ? row.swap : {}),
            rightHolderTeam: ownerTeam,
            originalTeam,
            withTeam: swapWithTeam,
            details: protections.trim() || notes.trim() || null,
          }
        : null,
  };
}

export function normalizeDraftPicks(rows = [], teamNames = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === "object")
    .map((row, index) => normalizeDraftPickAsset(row, index, teamNames))
    .filter((row) => row.year && row.round && row.originalTeam && row.ownerTeam);
}

export function createDefaultDraftPicksForTeams(teamNames = [], startYear = DEFAULT_START_YEAR, endYear = DEFAULT_END_YEAR) {
  const cleanNames = [...new Set((teamNames || []).map((name) => String(name || "").trim()).filter(Boolean))];
  const rows = [];

  for (let year = Number(startYear || DEFAULT_START_YEAR); year <= Number(endYear || DEFAULT_END_YEAR); year += 1) {
    for (const teamName of cleanNames) {
      for (const round of [1, 2]) {
        rows.push(
          normalizeDraftPickAsset({
            assetType: "pick",
            year,
            round,
            originalTeam: teamName,
            ownerTeam: teamName,
            protections: null,
            status: DEFAULT_PICK_STATUS,
          })
        );
      }
    }
  }

  return rows;
}

export function mergeDraftPicks(existingRows = [], defaultRows = []) {
  const normalizedExisting = normalizeDraftPicks(existingRows);
  const normalizedDefaults = normalizeDraftPicks(defaultRows);
  const seen = new Set();
  const swapOccupiedKeys = new Set();
  const out = [];

  for (const row of normalizedExisting) {
    if (isSwapDraftPickAsset(row)) {
      for (const key of getDraftAssetParticipantKeys(row)) swapOccupiedKeys.add(key);
    }
  }

  for (const row of normalizedExisting) {
    const key = `${row.assetType}|${row.year}|${row.round}|${normalizeTeamName(row.originalTeam)}|${normalizeTeamName(row.ownerTeam)}|${normalizeTeamName(row.swapWithTeam)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }

  for (const row of normalizedDefaults) {
    const defaultKey = `pick|${row.year}|${row.round}|${normalizeTeamName(row.originalTeam)}`;
    const defaultConflictKey = getDraftPickConflictKey(row);
    if (defaultConflictKey && swapOccupiedKeys.has(defaultConflictKey)) continue;

    const alreadyHasOriginalPick = out.some(
      (existing) =>
        existing.assetType === "pick" &&
        Number(existing.year) === Number(row.year) &&
        Number(existing.round) === Number(row.round) &&
        normalizeTeamName(existing.originalTeam) === normalizeTeamName(row.originalTeam)
    );

    if (alreadyHasOriginalPick || seen.has(defaultKey)) continue;
    seen.add(defaultKey);
    out.push(row);
  }

  return out.sort(sortDraftPickAssets);
}


function isSameTeamName(a = "", b = "") {
  return normalizeTeamName(a) === normalizeTeamName(b);
}

function ownUnprotectedPickRow(teamName, year, round) {
  const roundText = Number(round) === 1 ? "1st" : "2nd";
  return normalizeDraftPickAsset({
    id: makeDraftPickId({
      assetType: "pick",
      year,
      round,
      originalTeam: teamName,
      ownerTeam: teamName,
      seed: "own_future",
    }),
    assetType: "pick",
    type: "pick",
    year,
    round,
    originalTeam: teamName,
    ownerTeam: teamName,
    protections: "Unprotected",
    displayProtection: "Unprotected",
    protectionType: "unprotected",
    logicType: "auto_future_pick",
    status: DEFAULT_PICK_STATUS,
    notes: `${teamName} owns its own ${year} ${roundText} round pick.`,
    source: "Auto-added rolling future draft assets",
    realLifeDetails: {
      source: "Auto-added rolling future draft assets",
      cleanupVersion: "auto_future_pick",
      playableDisplayRule: `${teamName} owns its own ${year} ${roundText} round pick.`,
    },
  });
}

function readDraftPickStorageJson(key, fallback = null) {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function isDraftCompleteForRollForward(leagueData, completedYear, options = {}) {
  if (options?.draftComplete === true || options?.retireCompletedYear === true || options?.force === true) return true;

  const seasonMatches = (value) => Number(value || completedYear) === Number(completedYear);
  const draftState = leagueData?.draftState || {};
  if (seasonMatches(draftState?.seasonYear) && (draftState?.completed || draftState?.draftComplete)) return true;

  const offseasonState = readDraftPickStorageJson("bm_offseason_state_v1", {}) || {};
  if (seasonMatches(offseasonState?.seasonYear) && offseasonState?.draftComplete) return true;

  const savedDraftState = readDraftPickStorageJson("bm_draft_state_v1", {}) || {};
  if (seasonMatches(savedDraftState?.seasonYear) && savedDraftState?.completed) return true;

  return false;
}

export function rollDraftPickAssetsForCompletedSeason(leagueData, completedSeasonYear = DEFAULT_START_YEAR, options = {}) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;

  const completedYear = Number(completedSeasonYear || DEFAULT_START_YEAR);
  if (!Number.isFinite(completedYear) || completedYear < 2020) return leagueData;

  const draftComplete = isDraftCompleteForRollForward(leagueData, completedYear, options);
  const alreadyRolledYear = Number(leagueData?.draftPickMeta?.lastRolledCompletedSeasonYear || 0);
  if (draftComplete && alreadyRolledYear >= completedYear) return leagueData;

  const teamNames = getTeamNamesFromLeague(leagueData);
  if (!teamNames.length) return leagueData;

  const normalized = normalizeDraftPicks(leagueData.draftPicks || [], teamNames);

  // Keep current draft-year ownership rows alive until the draft is actually finished.
  // If these rows are removed right after the regular season, the lottery resolver
  // falls back to natural ownership and traded current-year picks appear to revert.
  if (!draftComplete) {
    return {
      ...leagueData,
      draftPicks: normalized.sort(sortDraftPickAssets),
      draftPickMeta: {
        ...(leagueData.draftPickMeta || {}),
        lastRollSkippedCompletedSeasonYear: completedYear,
        lastRollSkippedReason: "draft_not_complete_keep_current_year_assets",
        rollingWindowVersion: "draft_assets_roll_forward_v5_safe_until_draft_complete",
      },
    };
  }

  const kept = normalized.filter((row) => Number(row.year || 0) > completedYear);
  const maxExistingYear = kept.reduce((max, row) => Math.max(max, Number(row.year || 0)), completedYear + 6);
  const nextFutureYear = maxExistingYear + 1;

  const out = [...kept];
  for (const teamName of teamNames) {
    for (const round of [1, 2]) {
      const alreadyHasOwnPick = out.some(
        (row) =>
          String(row.assetType || row.type || "pick").toLowerCase() === "pick" &&
          Number(row.year || 0) === Number(nextFutureYear) &&
          Number(row.round || 0) === Number(round) &&
          isSameTeamName(row.originalTeam, teamName) &&
          isSameTeamName(row.ownerTeam, teamName)
      );

      if (!alreadyHasOwnPick) out.push(ownUnprotectedPickRow(teamName, nextFutureYear, round));
    }
  }

  return {
    ...leagueData,
    draftPicks: out.sort(sortDraftPickAssets),
    draftPickMeta: {
      ...(leagueData.draftPickMeta || {}),
      lastRolledCompletedSeasonYear: completedYear,
      lastAutoAddedFutureYear: nextFutureYear,
      rollingWindowVersion: "draft_assets_roll_forward_v5_safe_until_draft_complete",
    },
  };
}

export function sortDraftPickAssets(a = {}, b = {}) {
  return (
    Number(a.year || 0) - Number(b.year || 0) ||
    Number(a.round || 0) - Number(b.round || 0) ||
    String(a.originalTeam || "").localeCompare(String(b.originalTeam || "")) ||
    String(a.ownerTeam || "").localeCompare(String(b.ownerTeam || "")) ||
    String(a.assetType || "").localeCompare(String(b.assetType || ""))
  );
}

export function getDraftPickAssetLabel(asset = {}) {
  const type = asset.assetType === "swap" ? "Swap" : "Pick";
  const round = Number(asset.round || 0) === 1 ? "1st" : "2nd";
  const base = `${asset.year} ${round} - ${asset.originalTeam}`;

  if (asset.assetType === "swap") {
    const swapWith = asset.swapWithTeam ? ` with ${asset.swapWithTeam}` : "";
    return `${base} swap right held by ${asset.ownerTeam}${swapWith}`;
  }

  return `${base} owned by ${asset.ownerTeam}`;
}

export function applyDraftPickOwnershipToDraftOrder(result = {}, leagueData = null, seasonYear = DEFAULT_START_YEAR) {
  return applyDraftPickOwnershipToLotteryResult(result, { leagueData, seasonYear });
}

// -----------------------------------------------------------------------------
// Draft lottery ownership resolver
// -----------------------------------------------------------------------------
// These helpers intentionally run AFTER the natural lottery result is generated.
// They do not change odds, record ranks, lottery balls, or draft lottery math.

const NBA_TEAM_CODE_TO_NAME = {
  ATL: "Atlanta Hawks",
  BOS: "Boston Celtics",
  BKN: "Brooklyn Nets",
  BRK: "Brooklyn Nets",
  CHA: "Charlotte Hornets",
  CHO: "Charlotte Hornets",
  CHI: "Chicago Bulls",
  CLE: "Cleveland Cavaliers",
  DAL: "Dallas Mavericks",
  DEN: "Denver Nuggets",
  DET: "Detroit Pistons",
  GSW: "Golden State Warriors",
  GS: "Golden State Warriors",
  GOS: "Golden State Warriors",
  HOU: "Houston Rockets",
  IND: "Indiana Pacers",
  LAC: "Los Angeles Clippers",
  LAL: "Los Angeles Lakers",
  MEM: "Memphis Grizzlies",
  MIA: "Miami Heat",
  MIL: "Milwaukee Bucks",
  MIN: "Minnesota Timberwolves",
  NOP: "New Orleans Pelicans",
  NO: "New Orleans Pelicans",
  NYK: "New York Knicks",
  NY: "New York Knicks",
  OKC: "Oklahoma City Thunder",
  ORL: "Orlando Magic",
  PHI: "Philadelphia 76ers",
  PHL: "Philadelphia 76ers",
  PHX: "Phoenix Suns",
  PHO: "Phoenix Suns",
  POR: "Portland Trail Blazers",
  SAC: "Sacramento Kings",
  SAS: "San Antonio Spurs",
  SA: "San Antonio Spurs",
  TOR: "Toronto Raptors",
  UTA: "Utah Jazz",
  UTH: "Utah Jazz",
  WAS: "Washington Wizards",
  WSH: "Washington Wizards",
};


function getDraftOwnershipTeamName(team = {}) {
  return String(team?.name || team?.teamName || team?.abbreviation || team?.abbr || team?.shortName || "").trim();
}

function isActiveDraftPickAsset(asset = {}) {
  const status = String(asset.status || "active").toLowerCase();
  return !["inactive", "void", "removed", "deleted", "expired"].includes(status);
}

function getTeamAliases(team = {}) {
  return [
    team.name,
    team.teamName,
    team.abbreviation,
    team.abbr,
    team.code,
    team.shortName,
  ].filter(Boolean);
}

function buildTeamResolver(leagueData) {
  const teams = getAllTeamsFromLeague(leagueData);
  const exactMap = new Map();

  for (const team of teams) {
    const name = getDraftOwnershipTeamName(team);
    if (!name) continue;
    exactMap.set(normalizeTeamName(name), name);
    for (const alias of getTeamAliases(team)) {
      exactMap.set(normalizeTeamName(alias), name);
    }
  }

  for (const [code, name] of Object.entries(NBA_TEAM_CODE_TO_NAME)) {
    if (!exactMap.has(normalizeTeamName(code))) exactMap.set(normalizeTeamName(code), name);
  }

  return function resolveTeamName(value) {
    const raw = String(value || "").trim();
    if (!raw || raw === "—" || raw === "-") return "";

    const codeHit = NBA_TEAM_CODE_TO_NAME[raw.toUpperCase()];
    if (codeHit) return exactMap.get(normalizeTeamName(codeHit)) || codeHit;

    return exactMap.get(normalizeTeamName(raw)) || raw;
  };
}

function getPickNumberFromRow(row = {}) {
  const safeRow = row && typeof row === "object" ? row : {};
  const pick = Number(
    safeRow.pick ??
      safeRow.pickNumber ??
      safeRow.overallPick ??
      safeRow.draftPickNumber ??
      safeRow.resolvedPickNumber ??
      0
  );
  return Number.isFinite(pick) && pick > 0 ? pick : 0;
}

function isUsableDraftOrderRow(row = null) {
  if (!row || typeof row !== "object") return false;
  if (getPickNumberFromRow(row) > 0) return true;
  return Boolean(
    row.teamName ||
      row.name ||
      row.originalTeamName ||
      row.originalPickTeamName ||
      row.currentOwnerTeamName ||
      row.ownerTeamName
  );
}

function sanitizeDraftOrderRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter(isUsableDraftOrderRow);
}

function getRoundFromPickRow(row = {}) {
  const explicit = Number(row.round || 0);
  if (explicit === 1 || explicit === 2) return explicit;
  const pick = getPickNumberFromRow(row);
  return pick && pick <= 30 ? 1 : 2;
}

function getProtectionText(asset = {}) {
  return String(
    asset.displayProtection ||
      asset.protections ||
      asset.protection ||
      asset.conditions ||
      asset.protectionType ||
      ""
  ).trim();
}

function cleanProtectionLabelText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\bprotected\b/gi, "Protected")
    .replace(/\bunprotected\b/gi, "Unprotected")
    .replace(/\bswap best\b/gi, "Swap Best")
    .replace(/\bswap worst\b/gi, "Swap Worst")
    .replace(/\bowns\s+(\d+)\s*-\s*(\d+)\b/i, "Owns $1-$2")
    .trim();
}

export function getOwnedPickRange(asset = {}) {
  const explicit = asset.ownedSlots || asset.ownedRange || asset.realLifeDetails?.ownedSlots;
  if (explicit && typeof explicit === "object") {
    const start = Number(explicit.start ?? explicit.from ?? explicit.min ?? explicit.low);
    const end = Number(explicit.end ?? explicit.to ?? explicit.max ?? explicit.high);
    if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
      return { start, end };
    }
  }

  const text = [
    asset.displayProtection,
    asset.protections,
    asset.protection,
    asset.conditions,
    asset.notes,
    asset.realLifeDetails?.playableDisplayRule,
  ]
    .filter(Boolean)
    .join(" | ");

  const ownsMatch = text.match(/\bOwns\s*#?\s*(\d{1,2})\s*-\s*#?\s*(\d{1,2})\b/i);
  if (ownsMatch) {
    const start = Number(ownsMatch[1]);
    const end = Number(ownsMatch[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
      return { start, end };
    }
  }

  return null;
}

export function getDefaultPickOwnedRange(round = 1) {
  return Number(round || 1) === 1 ? { start: 1, end: 30 } : { start: 31, end: 60 };
}

export function getTradeablePickOwnedRange(asset = {}) {
  const type = String(asset.assetType || asset.type || "pick").toLowerCase();
  const round = Number(asset.round || 1) === 2 ? 2 : 1;
  if (type === "resolved") {
    const pickNumber = Number(
      asset.pickNumber || asset.overallPick || asset.resolvedPickNumber || asset.draftPickNumber || 0
    );
    return pickNumber > 0 ? { start: pickNumber, end: pickNumber } : getDefaultPickOwnedRange(round);
  }

  const explicit = getOwnedPickRange(asset);
  return explicit || getDefaultPickOwnedRange(round);
}

export function formatOwnedPickRange(range = null) {
  if (!range) return "";
  return `${Number(range.start)}-${Number(range.end)}`;
}

export function isFullOwnedPickRange(asset = {}) {
  const range = getTradeablePickOwnedRange(asset);
  const full = getDefaultPickOwnedRange(asset.round || 1);
  return Number(range.start) === Number(full.start) && Number(range.end) === Number(full.end);
}

export function getTradePickBaseProtectionLabel(asset = {}) {
  const raw = getProtectionText(asset);
  const lower = raw.toLowerCase();
  if (!raw || lower === "none" || lower === "null") return "Unprotected";
  if (lower.includes("swap") && lower.includes("worst")) return "Swap Worst";
  if (lower.includes("swap") && lower.includes("best")) return "Swap Best";
  if (lower === "unprotected") return "Unprotected";

  const topMatch = raw.match(/\btop\s*(\d{1,2})\s*protected\b/i);
  if (topMatch) return `Top ${Number(topMatch[1])} Protected`;
  if (/lottery\s*protected/i.test(raw)) return "Top 14 Protected";
  const rangeMatch = raw.match(/\b(\d{1,2})\s*-\s*(\d{1,2})\s*protected\b/i);
  if (rangeMatch) return `${Number(rangeMatch[1])}-${Number(rangeMatch[2])} Protected`;
  return cleanProtectionLabelText(raw) || "Unprotected";
}

export function isSwapDraftPickAsset(asset = {}) {
  const type = String(asset.assetType || asset.type || "pick").toLowerCase();
  const label = getDraftPickProtectionLabel(asset).toLowerCase();
  return type === "swap" || label.includes("swap best") || label.includes("swap worst");
}

export function isResolvedDraftPickAsset(asset = {}) {
  return String(asset.assetType || asset.type || "pick").toLowerCase() === "resolved";
}

export function isProtectedDraftPickAsset(asset = {}) {
  if (isSwapDraftPickAsset(asset) || isResolvedDraftPickAsset(asset)) return false;
  const base = getTradePickBaseProtectionLabel(asset).toLowerCase();
  if (base && base !== "unprotected") return true;
  return !isFullOwnedPickRange(asset);
}

export function canAddCustomProtectionToPick(asset = {}) {
  if (isSwapDraftPickAsset(asset) || isResolvedDraftPickAsset(asset)) return false;
  const range = getTradeablePickOwnedRange(asset);
  return Number(range.end) > Number(range.start);
}

export function canCreateSwapWithPick(asset = {}) {
  if (isSwapDraftPickAsset(asset) || isResolvedDraftPickAsset(asset)) return false;
  return !isProtectedDraftPickAsset(asset) && isFullOwnedPickRange(asset);
}


function draftPickConflictKey({ year, round, originalTeam } = {}, leagueData = null) {
  const y = Number(year || 0);
  const r = Number(round || 0) === 2 ? 2 : 1;
  if (!Number.isFinite(y) || y <= 0) return "";

  const resolveTeamName = leagueData ? buildTeamResolver(leagueData) : (value) => String(value || "").trim();
  const original = resolveTeamName(originalTeam || "");
  const teamKey = normalizeTeamName(original);
  if (!teamKey) return "";
  return `${y}|${r}|${teamKey}`;
}

function splitSwapParticipantText(value = "") {
  return String(value || "")
    .split(/[\/,&]+/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function getSwapParticipantNames(asset = {}) {
  const details = asset?.realLifeDetails && typeof asset.realLifeDetails === "object" ? asset.realLifeDetails : {};
  const rawParticipants = Array.isArray(details.swapParticipants)
    ? details.swapParticipants
    : Array.isArray(asset.swapParticipants)
    ? asset.swapParticipants
    : Array.isArray(asset.swap?.participants)
    ? asset.swap.participants
    : [];

  const participants = [];
  for (const participant of rawParticipants) {
    for (const piece of splitSwapParticipantText(participant)) participants.push(piece);
  }

  if (!participants.length) {
    for (const value of [asset.originalTeam, asset.originalTeamName, asset.swapWithTeam, asset.swap?.withTeam]) {
      for (const piece of splitSwapParticipantText(value)) participants.push(piece);
    }
  }

  const seen = new Set();
  return participants.filter((name) => {
    const key = normalizeTeamName(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getDraftPickConflictKey(asset = {}, leagueData = null) {
  const row = asset && typeof asset === "object" ? asset : {};
  return draftPickConflictKey(
    {
      year: row.year || row.seasonYear,
      round: row.round,
      originalTeam: row.originalTeam || row.originalTeamName || row.team || row.teamName,
    },
    leagueData
  );
}

export function getDraftAssetParticipantKeys(asset = {}, leagueData = null) {
  const row = asset && typeof asset === "object" ? asset : {};
  if (!isActiveDraftPickAsset(row)) return [];

  const type = String(row.assetType || row.type || "pick").toLowerCase();
  const year = Number(row.year || row.seasonYear || 0);
  const round = Number(row.round || 1) === 2 ? 2 : 1;
  if (!Number.isFinite(year) || year <= 0) return [];

  if (type === "swap" || isSwapDraftPickAsset(row)) {
    const names = getSwapParticipantNames(row);
    return names
      .map((name) => draftPickConflictKey({ year, round, originalTeam: name }, leagueData))
      .filter(Boolean);
  }

  const key = getDraftPickConflictKey(row, leagueData);
  return key ? [key] : [];
}

export function getActiveSwapParticipantKeySet(rows = [], leagueData = null, options = {}) {
  const ignoreIds = new Set((options?.ignoreAssetIds || []).map((id) => String(id || "")).filter(Boolean));
  const keys = new Set();

  for (const raw of Array.isArray(rows) ? rows : []) {
    if (!raw || typeof raw !== "object") continue;
    if (ignoreIds.has(String(raw.id || ""))) continue;
    const normalized = normalizeDraftPickAsset(raw, 0, getTeamNamesFromLeague(leagueData));
    if (!isActiveDraftPickAsset(normalized) || !isSwapDraftPickAsset(normalized)) continue;
    for (const key of getDraftAssetParticipantKeys(normalized, leagueData)) keys.add(key);
  }

  return keys;
}

export function isDraftPickEncumberedByActiveSwap(asset = {}, rows = [], leagueData = null, options = {}) {
  if (!asset || typeof asset !== "object") return false;
  if (!isActiveDraftPickAsset(asset) || isSwapDraftPickAsset(asset) || isResolvedDraftPickAsset(asset)) return false;
  const key = getDraftPickConflictKey(asset, leagueData);
  if (!key) return false;
  return getActiveSwapParticipantKeySet(rows, leagueData, options).has(key);
}

export function getDraftPickEncumbranceReason(asset = {}, rows = [], leagueData = null, options = {}) {
  if (!isDraftPickEncumberedByActiveSwap(asset, rows, leagueData, options)) return "";
  const roundText = Number(asset?.round || 1) === 1 ? "1st" : "2nd";
  const original = asset?.originalTeam || asset?.originalTeamName || "this pick";
  return `${asset?.year || "Future"} ${roundText} - ${original} is already tied to an active swap right.`;
}

export function removeDirectPickRowsConsumedBySwap(rows = [], sourcePick = {}, swapPick = {}, leagueData = null) {
  const consumed = new Set([
    getDraftPickConflictKey(sourcePick, leagueData),
    getDraftPickConflictKey(swapPick, leagueData),
  ].filter(Boolean));

  if (!consumed.size) return Array.isArray(rows) ? rows : [];

  return (Array.isArray(rows) ? rows : []).filter((row, index) => {
    if (!row || typeof row !== "object") return false;
    const normalized = normalizeDraftPickAsset(row, index, getTeamNamesFromLeague(leagueData));
    if (isSwapDraftPickAsset(normalized) || isResolvedDraftPickAsset(normalized)) return true;
    const key = getDraftPickConflictKey(normalized, leagueData);
    return !consumed.has(key);
  });
}

export function buildCustomProtectionBaseLabel(asset = {}, protectStart, protectEnd) {
  const round = Number(asset.round || 1) === 2 ? 2 : 1;
  const start = Number(protectStart);
  const end = Number(protectEnd);
  if (round === 1 && start === 1) return `Top ${end} Protected`;
  return `${start}-${end} Protected`;
}

export function protectionDisplayForOwnedRange(baseLabel = "Protected", range = null) {
  const clean = cleanProtectionLabelText(baseLabel || "Protected");
  if (!range) return clean;
  return `${clean} (Owns ${Number(range.start)}-${Number(range.end)})`;
}

export function validateCustomPickProtection(asset = {}, protectStart, protectEnd) {
  if (isSwapDraftPickAsset(asset)) {
    return { ok: false, reason: "Swap rights cannot be protected." };
  }
  if (isResolvedDraftPickAsset(asset)) {
    return { ok: false, reason: "Resolved draft picks cannot receive new protections." };
  }

  const owned = getTradeablePickOwnedRange(asset);
  const roundBounds = getDefaultPickOwnedRange(asset.round || 1);
  const start = Number(protectStart);
  const end = Number(protectEnd);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { ok: false, reason: "Enter a valid protection range." };
  }
  if (start !== Number(owned.start)) {
    return { ok: false, reason: `Protection must start at ${owned.start}, because that is the first slot this asset owns.` };
  }
  if (end < start) {
    return { ok: false, reason: "Protection end must be after the protection start." };
  }
  if (start < roundBounds.start || end > roundBounds.end) {
    return { ok: false, reason: `Round ${Number(asset.round || 1)} protections must stay inside ${roundBounds.start}-${roundBounds.end}.` };
  }
  if (start < owned.start || end > owned.end) {
    return { ok: false, reason: `Protection must stay inside the owned range ${owned.start}-${owned.end}.` };
  }
  if (end >= owned.end) {
    return { ok: false, reason: `Protecting ${owned.start}-${owned.end} would protect the entire asset, so nothing could convey.` };
  }

  const retainedRange = { start, end };
  const conveyedRange = { start: end + 1, end: owned.end };
  return {
    ok: true,
    ownedRange: owned,
    retainedRange,
    conveyedRange,
    baseProtectionLabel: buildCustomProtectionBaseLabel(asset, start, end),
  };
}

export function makeTradeGeneratedDraftPickId({ year, round, originalTeam, ownerTeam, kind = "trade", range = null, swapWithTeam = "" } = {}) {
  const rangeSeed = range ? `${range.start}_${range.end}` : "full";
  return makeDraftPickId({
    assetType: kind === "swap" ? "swap" : "pick",
    year,
    round,
    originalTeam,
    ownerTeam,
    swapWithTeam,
    seed: `${kind}_${rangeSeed}_${Date.now()}`,
  });
}

export function buildTradeMachineSwapAssets({
  sourcePick = {},
  swapPick = {},
  fromTeamName = "",
  toTeamName = "",
  direction = "best",
  tradeStamp = {},
} = {}) {
  const year = Number(sourcePick.year || sourcePick.seasonYear || swapPick.year || swapPick.seasonYear || 0);
  const round = Number(sourcePick.round || swapPick.round || 1) === 2 ? 2 : 1;
  const sourceOriginal = String(sourcePick.originalTeam || sourcePick.originalTeamName || sourcePick.team || fromTeamName || "").trim();
  const swapOriginal = String(swapPick.originalTeam || swapPick.originalTeamName || swapPick.team || toTeamName || "").trim();
  const cleanDirection = String(direction || "best").toLowerCase().includes("worst") ? "worst" : "best";
  const bestOwner = cleanDirection === "best" ? toTeamName : fromTeamName;
  const worstOwner = cleanDirection === "best" ? fromTeamName : toTeamName;
  const pairLabel = `${sourceOriginal} / ${swapOriginal}`;
  const ownerPair = [fromTeamName, toTeamName].filter(Boolean);
  const now = new Date().toISOString();

  const makeSwapRow = (ownerTeam, label, seed) => normalizeDraftPickAsset({
    id: makeDraftPickId({
      assetType: "swap",
      year,
      round,
      originalTeam: sourceOriginal,
      ownerTeam,
      swapWithTeam: swapOriginal,
      seed: `trade_${seed}_${Date.now()}`,
    }),
    assetType: "swap",
    type: "swap",
    year,
    round,
    originalTeam: sourceOriginal,
    originalTeamName: sourceOriginal,
    ownerTeam,
    owner: ownerTeam,
    currentOwnerTeamName: ownerTeam,
    swapWithTeam: swapOriginal,
    protections: label,
    protection: label,
    displayProtection: label,
    protectionType: label,
    status: DEFAULT_PICK_STATUS,
    logicType: "trade_machine_swap",
    source: "Trade Machine",
    notes: `${ownerTeam} receives ${label} rights between ${pairLabel}.`,
    realLifeDetails: {
      source: "Trade Machine",
      tradeGenerated: true,
      swapParticipants: [sourceOriginal, swapOriginal],
      swapOwnerParticipants: ownerPair,
      playableDisplayRule: `${label} between ${pairLabel}`,
    },
    lastTrade: { ...tradeStamp, completedAt: tradeStamp.completedAt || now, protection: label, assetType: "swap" },
    tradeHistory: [{ ...tradeStamp, completedAt: tradeStamp.completedAt || now, protection: label, assetType: "swap" }],
  });

  return [makeSwapRow(bestOwner, "Swap Best", "best"), makeSwapRow(worstOwner, "Swap Worst", "worst")];
}


export function getDraftPickProtectionLabel(asset = {}) {
  const raw = getProtectionText(asset);
  const lower = raw.toLowerCase();

  if (!raw || lower === "none" || lower === "null" || lower === "unprotected") return "Unprotected";
  if (lower.includes("swap") && lower.includes("worst")) return "Swap Worst";
  if (lower.includes("swap") && lower.includes("best")) return "Swap Best";

  const ownedRange = getOwnedPickRange(asset);
  const topMatch = raw.match(/\btop\s*(\d{1,2})\s*protected\b/i);
  if (topMatch) {
    const topNumber = Number(topMatch[1]);
    if (ownedRange) return `Top ${topNumber} Protected (Owns ${ownedRange.start}-${ownedRange.end})`;
    return `Top ${topNumber} Protected`;
  }

  if (lower.includes("lottery")) {
    if (ownedRange) return `Lottery Protected (Owns ${ownedRange.start}-${ownedRange.end})`;
    return "Lottery Protected";
  }

  return cleanProtectionLabelText(raw);
}

function getProtectionLimit(asset = {}) {
  const text = getProtectionText(asset);
  const topMatch = text.match(/\btop\s*(\d{1,2})\s*protected\b/i);
  if (topMatch) return Number(topMatch[1]);
  if (/lottery\s*protected/i.test(text)) return 14;
  return null;
}

export function isDraftPickProtected(asset = {}, pickNumber = 0) {
  const ownedRange = getOwnedPickRange(asset);
  const pick = Number(pickNumber || 0);
  if (ownedRange) return !(pick >= ownedRange.start && pick <= ownedRange.end);

  const limit = getProtectionLimit(asset);
  if (!limit || !Number.isFinite(pick) || pick <= 0) return false;
  return pick <= limit;
}

function sameDraftPickAsset(asset = {}, { year, round, originalTeam, resolveTeamName }) {
  if (!isActiveDraftPickAsset(asset)) return false;
  if (String(asset.assetType || asset.type || "pick").toLowerCase() !== "pick") return false;
  if (Number(asset.year || 0) !== Number(year || 0)) return false;
  if (Number(asset.round || 0) !== Number(round || 0)) return false;
  return normalizeTeamName(resolveTeamName(asset.originalTeam)) === normalizeTeamName(originalTeam);
}

export function resolveDraftPickOwner({ leagueData, year, round, originalTeam, pickNumber }) {
  const teamNames = getAllTeamsFromLeague(leagueData).map(getDraftOwnershipTeamName).filter(Boolean);
  const resolveTeamName = buildTeamResolver(leagueData);
  const original = resolveTeamName(originalTeam);
  const pick = Number(pickNumber || 0);
  const assets = normalizeDraftPicks(leagueData?.draftPicks || [], teamNames);
  const matching = assets.filter((asset) => sameDraftPickAsset(asset, { year, round, originalTeam: original, resolveTeamName }));

  if (!matching.length) {
    return {
      ownerTeam: original,
      originalTeam: original,
      asset: null,
      protected: false,
      protectionLabel: "Unprotected",
      ownershipType: "default_original_owner",
    };
  }

  const ranged = matching
    .map((asset) => ({ asset, range: getOwnedPickRange(asset) }))
    .filter((row) => row.range);

  if (ranged.length && Number.isFinite(pick) && pick > 0) {
    const hit = ranged.find(({ range }) => pick >= range.start && pick <= range.end);
    if (hit) {
      return {
        ownerTeam: resolveTeamName(hit.asset.ownerTeam) || original,
        originalTeam: original,
        asset: hit.asset,
        protected: false,
        protectionLabel: getDraftPickProtectionLabel(hit.asset),
        ownershipType: "owned_range_match",
        ownedRange: hit.range,
      };
    }

    return {
      ownerTeam: original,
      originalTeam: original,
      asset: null,
      protected: true,
      protectionLabel: "No owned range matched",
      ownershipType: "owned_range_fallback_original",
    };
  }

  const tradedAsset = matching.find(
    (asset) => normalizeTeamName(resolveTeamName(asset.ownerTeam)) !== normalizeTeamName(original)
  );
  const asset = tradedAsset || matching[0];
  const protectionLabel = getDraftPickProtectionLabel(asset);
  const protectedPick = isDraftPickProtected(asset, pickNumber);
  const ownerTeam = protectedPick ? original : resolveTeamName(asset.ownerTeam) || original;

  return {
    ownerTeam,
    originalTeam: original,
    asset,
    protected: protectedPick,
    protectionLabel,
    ownershipType: protectedPick ? "protected_reverted_to_original" : "draft_pick_asset",
  };
}
function setPickRowOwner(row = {}, ownerTeam, leagueData, extra = {}) {
  const logoMap = getTeamLogoMap(leagueData);
  const ownerLogo = logoMap[normalizeTeamName(ownerTeam)] || row.currentOwnerTeamLogo || row.ownerLogo || row.logo || "";
  const originalLogo = row.originalTeamLogo || row.originalPickTeamLogo || row.logo || "";

  return {
    ...row,
    ...extra,
    teamName: ownerTeam,
    currentOwnerTeamName: ownerTeam,
    ownerTeamName: ownerTeam,
    currentOwnerTeamLogo: ownerLogo,
    ownerLogo,
    originalTeamLogo: originalLogo,
    originalPickTeamLogo: originalLogo,
    logo: ownerLogo || row.logo || "",
  };
}

function extractTeamRefsFromText(text = "", teamNames = [], resolveTeamName = (x) => x) {
  const raw = String(text || "");
  if (!raw) return [];

  const refs = [];
  const push = (value) => {
    const resolved = resolveTeamName(value);
    if (!resolved || normalizeTeamName(resolved) === normalizeTeamName("Multiple Teams")) return;
    if (!refs.some((name) => normalizeTeamName(name) === normalizeTeamName(resolved))) refs.push(resolved);
  };

  for (const [code] of Object.entries(NBA_TEAM_CODE_TO_NAME)) {
    const regex = new RegExp(`\\b${code}\\b`, "i");
    if (regex.test(raw)) push(code);
  }

  for (const teamName of teamNames) {
    if (raw.toLowerCase().includes(String(teamName).toLowerCase())) push(teamName);
  }

  for (const part of raw.split(/[\\/,;|]+|\band\b|\bor\b|\bwith\b|\bvia\b/gi)) {
    const clean = part.trim();
    if (clean && clean.length <= 32) push(clean);
  }

  return refs;
}

function getSwapInvolvedTeams(asset = {}, teamNames = [], resolveTeamName = (x) => x) {
  const refs = [];
  const push = (value) => {
    const resolved = resolveTeamName(value);
    if (!resolved || normalizeTeamName(resolved) === normalizeTeamName("Multiple Teams")) return;
    if (!refs.some((name) => normalizeTeamName(name) === normalizeTeamName(resolved))) refs.push(resolved);
  };

  const participants = Array.isArray(asset.realLifeDetails?.swapParticipants)
    ? asset.realLifeDetails.swapParticipants
    : Array.isArray(asset.swapParticipants)
    ? asset.swapParticipants
    : [];

  for (const participant of participants) push(participant);
  if (refs.length >= 2) return refs.slice(0, 2);

  const participantText = [asset.originalTeam, asset.swapWithTeam, asset.swap?.withTeam]
    .filter(Boolean)
    .join(" / ");
  for (const ref of extractTeamRefsFromText(participantText, teamNames, resolveTeamName)) push(ref);
  if (refs.length >= 2) return refs.slice(0, 2);

  const details = asset.realLifeDetails || {};
  const fallbackText = [
    asset.protections,
    asset.displayProtection,
    asset.notes,
    details.originalProtections,
    details.originalNotes,
    details.originalOriginalTeam,
    details.originalSwapWithTeam,
  ]
    .filter(Boolean)
    .join(" / ");
  for (const ref of extractTeamRefsFromText(fallbackText, teamNames, resolveTeamName)) push(ref);

  if (refs.length < 2) push(asset.ownerTeam);
  return refs.slice(0, 2);
}

function rowOriginalTeam(row = {}) {
  return row.originalTeamName || row.originalPickTeamName || row.naturalLotteryTeamName || row.originalTeam || row.teamName || "";
}

function swapDirection(asset = {}) {
  const label = getDraftPickProtectionLabel(asset).toLowerCase();
  return label.includes("worst") ? "worst" : "best";
}

function setPickRowOwnerByIdentity(rows, targetRow, ownerTeam, leagueData, extra = {}) {
  const targetPick = getPickNumberFromRow(targetRow);
  const targetRound = Number(targetRow.round || getRoundFromPickRow(targetRow));
  const targetOriginal = normalizeTeamName(rowOriginalTeam(targetRow));

  return rows.map((row) => {
    const rowPick = getPickNumberFromRow(row);
    const rowRound = Number(row.round || getRoundFromPickRow(row));
    const original = normalizeTeamName(rowOriginalTeam(row));
    if (rowPick === targetPick && rowRound === targetRound && original === targetOriginal) {
      return setPickRowOwner(row, ownerTeam, leagueData, extra);
    }
    return row;
  });
}

function applySwapRightsToOrder(rows = [], { leagueData, year }) {
  const teamNames = getAllTeamsFromLeague(leagueData).map(getDraftOwnershipTeamName).filter(Boolean);
  const resolveTeamName = buildTeamResolver(leagueData);
  const assets = normalizeDraftPicks(leagueData?.draftPicks || [], teamNames)
    .map((asset, index) => ({ ...asset, __swapInputIndex: index }))
    .filter((asset) => {
      const type = String(asset.assetType || asset.type || "pick").toLowerCase();
      return type === "swap" && isActiveDraftPickAsset(asset) && Number(asset.year || 0) === Number(year || 0);
    });

  if (!assets.length || !rows.length) return rows;

  const baseRows = rows.map((row) => ({ ...row }));
  let nextRows = rows.map((row) => ({ ...row }));
  const groups = new Map();

  for (const asset of assets) {
    const round = Number(asset.round || 0);
    const ownerTeam = resolveTeamName(asset.ownerTeam);
    if (!ownerTeam || !round) continue;

    const involved = getSwapInvolvedTeams(asset, teamNames, resolveTeamName)
      .map(resolveTeamName)
      .filter(Boolean);
    const uniqueInvolved = [];
    for (const team of involved) {
      if (!uniqueInvolved.some((name) => isSameTeamName(name, team))) uniqueInvolved.push(team);
    }
    if (uniqueInvolved.length !== 2) continue;

    const tradeGeneratedSwap = String(asset.logicType || "") === "trade_machine_swap";
    const ownerParticipants = Array.isArray(asset.realLifeDetails?.swapOwnerParticipants)
      ? asset.realLifeDetails.swapOwnerParticipants.map(resolveTeamName).filter(Boolean)
      : [];
    const uniqueOwnerParticipants = [];
    for (const team of ownerParticipants) {
      if (!uniqueOwnerParticipants.some((name) => isSameTeamName(name, team))) uniqueOwnerParticipants.push(team);
    }
    const ownerPairNames = tradeGeneratedSwap && uniqueOwnerParticipants.length === 2
      ? uniqueOwnerParticipants.slice(0, 2)
      : uniqueInvolved;

    // Imported playable swaps stay limited to the two involved natural teams.
    // Trade-machine swaps are tradable rights: after a later trade, the current
    // ownerTeam on the Swap Best / Swap Worst asset is the real right holder,
    // even if that owner is no longer one of the original owner participants.
    if (!tradeGeneratedSwap && !ownerPairNames.some((team) => isSameTeamName(team, ownerTeam))) continue;

    const pairNames = uniqueInvolved;
    const pairKey = pairNames.map(normalizeTeamName).sort().join("|");
    const key = `${round}|${pairKey}`;
    const current = groups.get(key) || {
      round,
      pairNames,
      ownerPairNames,
      pairKey,
      tradeGeneratedSwap,
      assets: [],
      firstIndex: Number.POSITIVE_INFINITY,
    };
    current.ownerPairNames = ownerPairNames;
    current.tradeGeneratedSwap = Boolean(current.tradeGeneratedSwap || tradeGeneratedSwap);
    current.assets.push({
      asset,
      ownerTeam,
      direction: swapDirection(asset),
      inputIndex: Number(asset.__swapInputIndex || 0),
    });
    current.firstIndex = Math.min(current.firstIndex, Number(asset.__swapInputIndex || 0));
    groups.set(key, current);
  }

  function groupWeight(group) {
    const dirs = new Set(group.assets.map((row) => row.direction));
    const owners = [];
    for (const row of group.assets) {
      if (!owners.some((team) => isSameTeamName(team, row.ownerTeam))) owners.push(row.ownerTeam);
    }
    let weight = 0;
    if (dirs.has("best") && dirs.has("worst") && owners.length >= 2) weight += 100;
    else if (group.assets.length >= 2 && owners.length >= 2) weight += 80;
    else weight += 60;
    if (Number(group.round) === 1) weight += 5;
    weight += Math.min(9, group.assets.length);
    return weight;
  }

  function otherPairTeam(pairNames, teamName) {
    return pairNames.find((team) => !isSameTeamName(team, teamName)) || "";
  }

  function chooseSwapOwners(group) {
    const sortedAssets = [...group.assets].sort((a, b) => a.inputIndex - b.inputIndex);
    const bestAsset = sortedAssets.find((row) => row.direction === "best") || null;
    const worstAsset = sortedAssets.find((row) => row.direction === "worst") || null;
    const ownerPairNames = Array.isArray(group.ownerPairNames) && group.ownerPairNames.length === 2
      ? group.ownerPairNames
      : group.pairNames;

    let bestOwner = bestAsset?.ownerTeam || "";
    let worstOwner = worstAsset?.ownerTeam || "";

    const ownerIsAllowed = (teamName) => {
      if (!teamName) return false;
      if (group.tradeGeneratedSwap) return true;
      return ownerPairNames.some((team) => isSameTeamName(team, teamName));
    };

    if (!bestOwner || !ownerIsAllowed(bestOwner)) bestOwner = "";
    if (!worstOwner || !ownerIsAllowed(worstOwner)) worstOwner = "";

    if (bestOwner && (!worstOwner || isSameTeamName(bestOwner, worstOwner))) {
      worstOwner = otherPairTeam(ownerPairNames, bestOwner);
    } else if (worstOwner && (!bestOwner || isSameTeamName(bestOwner, worstOwner))) {
      bestOwner = otherPairTeam(ownerPairNames, worstOwner);
    } else if (!bestOwner && !worstOwner && sortedAssets.length) {
      const primary = sortedAssets[0];
      if (primary.direction === "worst") {
        worstOwner = primary.ownerTeam;
        bestOwner = otherPairTeam(ownerPairNames, worstOwner);
      } else {
        bestOwner = primary.ownerTeam;
        worstOwner = otherPairTeam(ownerPairNames, bestOwner);
      }
    }

    if (!bestOwner || !worstOwner || isSameTeamName(bestOwner, worstOwner)) return null;

    return {
      bestOwner,
      worstOwner,
      bestAsset: bestAsset?.asset || sortedAssets[0]?.asset || null,
      worstAsset: worstAsset?.asset || sortedAssets[1]?.asset || sortedAssets[0]?.asset || null,
    };
  }

  // One playable swap per original pick/team per year/round. This prevents
  // CHA/ORL/MEM-style chain movement where a pick that was already swapped is
  // touched again by another swap group.
  const selectedGroups = [];
  const usedTeamsByRound = new Set();
  const orderedGroups = [...groups.values()].sort((a, b) => {
    const weightDiff = groupWeight(b) - groupWeight(a);
    if (weightDiff) return weightDiff;
    return a.firstIndex - b.firstIndex;
  });

  for (const group of orderedGroups) {
    const pairKeys = group.pairNames.map(normalizeTeamName);
    const alreadyUsed = pairKeys.some((key) => usedTeamsByRound.has(`${group.round}|${key}`));
    if (alreadyUsed) continue;
    const owners = chooseSwapOwners(group);
    if (!owners) continue;
    selectedGroups.push({ ...group, owners });
    for (const key of pairKeys) usedTeamsByRound.add(`${group.round}|${key}`);
  }

  for (const group of selectedGroups) {
    const pairKeys = group.pairNames.map(normalizeTeamName);
    const candidates = baseRows
      .filter((row) => Number(row.round || getRoundFromPickRow(row)) === Number(group.round))
      .filter((row) => pairKeys.includes(normalizeTeamName(rowOriginalTeam(row))))
      .sort((a, b) => getPickNumberFromRow(a) - getPickNumberFromRow(b));

    if (candidates.length !== 2) continue;

    // Safety guard for messy imported data: if a concrete normal pick asset
    // already moved either original pick to a third-party owner, do not let a
    // simplified two-team swap overwrite that third-party ownership. The clean
    // v10 JSON avoids these conflicts, but this keeps older saves from creating
    // hidden swap-chain corruption.
    const thirdPartyBlocked = !group.tradeGeneratedSwap && candidates.some((row) => {
      const currentOwner = row.currentOwnerTeamName || row.ownerTeamName || row.teamName || "";
      const ownerInPair = group.pairNames.some((team) => isSameTeamName(team, currentOwner));
      const wasConcretePickAsset = Boolean(row.draftPickAssetId) || String(row.ownershipSource || "") === "draftPicks.pick";
      return currentOwner && !ownerInPair && wasConcretePickAsset;
    });

    if (thirdPartyBlocked) continue;

    const bestRow = candidates[0];
    const worstRow = candidates[1];
    const pairLabel = group.pairNames.join(" / ");

    nextRows = setPickRowOwnerByIdentity(nextRows, bestRow, group.owners.bestOwner, leagueData, {
      swapAssetId: group.owners.bestAsset?.id || null,
      swapProtectionLabel: "Swap Best",
      swapGroup: pairLabel,
      ownershipType: "swap_best",
      ownershipSource: "draftPicks.swap.v5",
    });

    nextRows = setPickRowOwnerByIdentity(nextRows, worstRow, group.owners.worstOwner, leagueData, {
      swapAssetId: group.owners.worstAsset?.id || group.owners.bestAsset?.id || null,
      swapProtectionLabel: "Swap Worst",
      swapGroup: pairLabel,
      ownershipType: "swap_worst",
      ownershipSource: "draftPicks.swap.v5",
    });
  }

  return nextRows;
}

export function applyDraftPickOwnershipToOrder(order = [], { leagueData, seasonYear } = {}) {
  if (!Array.isArray(order) || !order.length || !leagueData) return Array.isArray(order) ? sanitizeDraftOrderRows(order) : [];

  const year = Number(seasonYear || leagueData?.seasonYear || leagueData?.currentSeasonYear || 2026);
  const resolveTeamName = buildTeamResolver(leagueData);
  const cleanOrder = sanitizeDraftOrderRows(order);

  const normallyResolved = cleanOrder.map((row, index) => {
    const pickNumber = getPickNumberFromRow(row) || index + 1;
    const round = Number(row.round || getRoundFromPickRow({ ...row, pick: pickNumber }));
    const originalTeam = resolveTeamName(row.originalTeamName || row.originalPickTeamName || row.teamName || row.currentOwnerTeamName);
    const resolution = resolveDraftPickOwner({
      leagueData,
      year,
      round,
      originalTeam,
      pickNumber,
    });

    const ownerTeam = resolution.ownerTeam || originalTeam;
    return setPickRowOwner(row, ownerTeam, leagueData, {
      pick: pickNumber,
      round,
      originalTeamName: originalTeam,
      originalPickTeamName: originalTeam,
      naturalLotteryTeamName: originalTeam,
      draftPickAssetId: resolution.asset?.id || null,
      draftPickProtection: resolution.protectionLabel,
      draftPickProtected: Boolean(resolution.protected),
      ownershipType: resolution.ownershipType,
      ownershipSource: resolution.asset ? "draftPicks.pick" : "default",
    });
  });

  return applySwapRightsToOrder(normallyResolved, { leagueData, year });
}

export function applyDraftPickOwnershipToLotteryResult(result = {}, { leagueData, seasonYear } = {}) {
  if (!result || typeof result !== "object" || !leagueData) return result;

  const firstRoundOrder = applyDraftPickOwnershipToOrder(result.firstRoundOrder || [], { leagueData, seasonYear });
  const secondRoundOrder = applyDraftPickOwnershipToOrder(result.secondRoundOrder || [], { leagueData, seasonYear });
  const fullDraftOrder = firstRoundOrder.length || secondRoundOrder.length
    ? [...firstRoundOrder, ...secondRoundOrder]
    : applyDraftPickOwnershipToOrder(result.fullDraftOrder || [], { leagueData, seasonYear });

  return {
    ...result,
    firstRoundOrder,
    secondRoundOrder,
    fullDraftOrder,
    pickOwnershipResolved: true,
    pickOwnershipVersion: "draft_pick_ownership_v5",
  };
}

