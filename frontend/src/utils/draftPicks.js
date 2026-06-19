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
  const out = [];

  for (const row of normalizedExisting) {
    const key = `${row.assetType}|${row.year}|${row.round}|${normalizeTeamName(row.originalTeam)}|${normalizeTeamName(row.ownerTeam)}|${normalizeTeamName(row.swapWithTeam)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }

  for (const row of normalizedDefaults) {
    const defaultKey = `pick|${row.year}|${row.round}|${normalizeTeamName(row.originalTeam)}`;
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
  const pick = Number(
    row.pick ??
      row.pickNumber ??
      row.overallPick ??
      row.draftPickNumber ??
      row.resolvedPickNumber ??
      0
  );
  return Number.isFinite(pick) && pick > 0 ? pick : 0;
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
      asset.protectionType ||
      asset.protection ||
      asset.conditions ||
      ""
  ).trim();
}

export function getDraftPickProtectionLabel(asset = {}) {
  const raw = getProtectionText(asset);
  const lower = raw.toLowerCase();

  if (!raw || lower === "none" || lower === "null" || lower === "unprotected") return "Unprotected";
  if (lower.includes("swap") && lower.includes("worst")) return "Swap Worst";
  if (lower.includes("swap") && lower.includes("best")) return "Swap Best";
  if (lower.includes("lottery")) return "Lottery Protected";
  if (lower.includes("top 10") || lower.includes("top10")) return "Top 10 Protected";
  if (lower.includes("top 5") || lower.includes("top5")) return "Top 5 Protected";
  if (lower.includes("top 3") || lower.includes("top3")) return "Top 3 Protected";
  return raw;
}

function getProtectionLimit(asset = {}) {
  const label = getDraftPickProtectionLabel(asset).toLowerCase();
  if (label.includes("lottery")) return 14;
  if (label.includes("top 10")) return 10;
  if (label.includes("top 5")) return 5;
  if (label.includes("top 3")) return 3;
  return null;
}

export function isDraftPickProtected(asset = {}, pickNumber = 0) {
  const limit = getProtectionLimit(asset);
  const pick = Number(pickNumber || 0);
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
    if (clean) push(clean);
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

  push(asset.ownerTeam);
  push(asset.originalTeam);
  push(asset.swapWithTeam);

  const details = asset.realLifeDetails || {};
  const text = [
    asset.protections,
    asset.displayProtection,
    asset.notes,
    asset.swapWithTeam,
    details.originalProtections,
    details.originalNotes,
    details.originalOriginalTeam,
    details.originalSwapWithTeam,
  ]
    .filter(Boolean)
    .join(" / ");

  for (const ref of extractTeamRefsFromText(text, teamNames, resolveTeamName)) push(ref);
  return refs;
}

function applySwapRightsToOrder(rows = [], { leagueData, year }) {
  const teamNames = getAllTeamsFromLeague(leagueData).map(getDraftOwnershipTeamName).filter(Boolean);
  const resolveTeamName = buildTeamResolver(leagueData);
  const assets = normalizeDraftPicks(leagueData?.draftPicks || [], teamNames).filter((asset) => {
    const type = String(asset.assetType || asset.type || "pick").toLowerCase();
    return type === "swap" && isActiveDraftPickAsset(asset) && Number(asset.year || 0) === Number(year || 0);
  });

  if (!assets.length || !rows.length) return rows;

  let nextRows = rows.map((row) => ({ ...row }));

  for (const asset of assets) {
    const round = Number(asset.round || 0);
    const ownerTeam = resolveTeamName(asset.ownerTeam);
    if (!ownerTeam || !round) continue;

    const involved = getSwapInvolvedTeams(asset, teamNames, resolveTeamName);
    if (involved.length < 2) continue;

    const involvedKeys = new Set(involved.map(normalizeTeamName));
    const candidates = nextRows
      .filter((row) => Number(row.round || getRoundFromPickRow(row)) === round)
      .filter((row) => involvedKeys.has(normalizeTeamName(row.originalTeamName || row.originalPickTeamName || row.teamName)))
      .sort((a, b) => getPickNumberFromRow(a) - getPickNumberFromRow(b));

    if (candidates.length < 2) continue;

    const label = getDraftPickProtectionLabel(asset).toLowerCase();
    const target = label.includes("worst") ? candidates[candidates.length - 1] : candidates[0];
    const targetPick = getPickNumberFromRow(target);
    const targetOriginalTeam = target.originalTeamName || target.originalPickTeamName || target.teamName;
    const displacedOwner = target.currentOwnerTeamName || target.teamName || targetOriginalTeam;

    const ownerOriginalRow = candidates.find(
      (row) => normalizeTeamName(row.originalTeamName || row.originalPickTeamName || row.teamName) === normalizeTeamName(ownerTeam)
    );
    const ownerOriginalPick = ownerOriginalRow ? getPickNumberFromRow(ownerOriginalRow) : 0;

    nextRows = nextRows.map((row) => {
      const rowPick = getPickNumberFromRow(row);
      const rowRound = Number(row.round || getRoundFromPickRow(row));
      if (rowRound !== round) return row;

      if (rowPick === targetPick) {
        return setPickRowOwner(row, ownerTeam, leagueData, {
          swapAssetId: asset.id || null,
          swapProtectionLabel: getDraftPickProtectionLabel(asset),
          ownershipType: "swap_right",
          ownershipSource: "draftPicks.swap",
          swappedFromTeamName: displacedOwner,
        });
      }

      if (
        ownerOriginalPick &&
        rowPick === ownerOriginalPick &&
        normalizeTeamName(row.originalTeamName || row.originalPickTeamName || row.teamName) === normalizeTeamName(ownerTeam) &&
        normalizeTeamName(displacedOwner) !== normalizeTeamName(ownerTeam)
      ) {
        return setPickRowOwner(row, displacedOwner, leagueData, {
          swapAssetId: asset.id || null,
          swapProtectionLabel: getDraftPickProtectionLabel(asset),
          ownershipType: "swap_return",
          ownershipSource: "draftPicks.swap",
          swappedToTeamName: ownerTeam,
        });
      }

      return row;
    });
  }

  return nextRows;
}

export function applyDraftPickOwnershipToOrder(order = [], { leagueData, seasonYear } = {}) {
  if (!Array.isArray(order) || !order.length || !leagueData) return Array.isArray(order) ? order : [];

  const year = Number(seasonYear || leagueData?.seasonYear || leagueData?.currentSeasonYear || 2026);
  const resolveTeamName = buildTeamResolver(leagueData);

  const normallyResolved = order.map((row, index) => {
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
    pickOwnershipVersion: "draft_pick_ownership_v2",
  };
}

